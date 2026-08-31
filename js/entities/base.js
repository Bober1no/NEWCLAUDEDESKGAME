/* SALT LINE — what walks the flat.
 *
 * Every entity is a state machine with a telegraph. Nothing in this game
 * kills you without having told you for at least two seconds first; the
 * horror is meant to come from recognising the tell and knowing you are too
 * far from the answer, not from being surprised.
 *
 * Entities are silhouettes. There is no face anywhere in this game at any
 * quality tier. The shape functions below return codes, not colours:
 *   0 nothing   1 body (a hole)   2 rime (salt crust, catches light)
 *   3 ember     (attention. there are four of these in an average run.)
 */
(function (S) {
  'use strict';

  var M = S.M;

  function Entity(kind, x, y) {
    this.kind = kind;
    this.x = x; this.y = y;
    this.px = x; this.py = y;      /* previous tick, for render interpolation */
    this.dead = false;
    this.t = 0;
    this.state = 'idle';
    this.stateT = 0;
    this.alpha = 1;
    this.seed = (Math.random() * 1e9) | 0;
    this.announced = false;
    /* A short ring of recent positions. DROWNED draws two ghosts out of it,
     * which is the only per-object motion blur in the game and the reason
     * something crossing a pan at the top tier smears the way it should. */
    this.hist = new Float32Array(HIST * 2);
    this.histI = 0;
    for (var h = 0; h < HIST; h++) { this.hist[h * 2] = x; this.hist[h * 2 + 1] = y; }
  }

  var HIST = 10;
  Entity.HIST = HIST;

  Entity.prototype.setState = function (s) {
    if (this.state === s) return;
    this.state = s;
    this.stateT = 0;
  };

  Entity.prototype.step = function (dt) {
    this.t += dt;
    this.stateT += dt;
    this.px = this.x; this.py = this.y;
    this.histI = (this.histI + 1) % HIST;
    this.hist[this.histI * 2] = this.x;
    this.hist[this.histI * 2 + 1] = this.y;
  };

  /* position `back` ticks ago, clamped to the ring */
  Entity.prototype.histX = function (back) {
    var i = (this.histI - back + HIST * 2) % HIST;
    return this.hist[i * 2];
  };
  Entity.prototype.histY = function (back) {
    var i = (this.histI - back + HIST * 2) % HIST;
    return this.hist[i * 2 + 1];
  };

  Entity.prototype.moveToward = function (tx, ty, speed, dt, world) {
    var dx = tx - this.x, dy = ty - this.y;
    var d = Math.sqrt(dx * dx + dy * dy);
    if (d < 1e-4) return;
    var nx = this.x + (dx / d) * speed * dt;
    var ny = this.y + (dy / d) * speed * dt;
    /* entities do not walk through salt either -- they slide along it */
    if (!world.solidAt(nx, this.y)) this.x = nx;
    if (!world.solidAt(this.x, ny)) this.y = ny;
  };

  Entity.prototype.distTo = function (x, y) { return M.dist(this.x, this.y, x, y); };

  /* is this entity inside the player's lamp cone and lit? */
  Entity.prototype.inLamp = function (p) {
    if (!p.lampOn) return 0;
    var dx = this.x - p.x, dy = this.y - p.y;
    var d = Math.sqrt(dx * dx + dy * dy);
    if (d > 9) return 0;
    var dot = (dx / d) * Math.cos(p.ang) + (dy / d) * Math.sin(p.ang);
    var cone = M.sat((dot - 0.10) / 0.55);
    return cone * (1 - d / 9);
  };

  /* is the player looking anywhere near this thing? */
  Entity.prototype.inView = function (p, tol) {
    var a = Math.atan2(this.y - p.y, this.x - p.x);
    return Math.abs(M.angDiff(p.ang, a)) < (tol || 0.62);
  };

  Entity.prototype.update = function () {};
  Entity.prototype.render = function () {};

  /* ---- shared silhouette geometry ---------------------------------------
   * One parametric standing figure that every humanoid on the flat is a
   * distortion of. Keeping them all the same underlying body is deliberate:
   * the things out here used to be the same thing you are.
   */
  function human(u, v, p) {
    var lean = p.lean || 0;
    var hunch = p.hunch || 0;
    var scale = p.wide === undefined ? 1 : p.wide;

    /* spine: a curve the whole figure is hung on */
    var spine = 0.5 + lean * (1 - v) + hunch * Math.pow(1 - v, 2.2) * 0.9;
    var sway = (p.sway || 0) * Math.sin(v * 2.2 + (p.phase || 0)) * (1 - v) * 0.5;
    spine += sway;

    var headTop = p.headTop === undefined ? 0.02 : p.headTop;
    var headBot = headTop + 0.115 * (p.headSize || 1);

    /* head */
    if (v >= headTop && v < headBot) {
      var hv = (v - headTop) / (headBot - headTop);
      var hw = 0.085 * scale * (p.headSize || 1) * Math.sqrt(Math.max(0, 1 - Math.pow(hv * 2 - 1, 2) * 0.82));
      if (Math.abs(u - spine) < hw) return 1;
      return 0;
    }

    /* neck + shoulders */
    if (v >= headBot && v < headBot + 0.075) {
      var t = (v - headBot) / 0.075;
      var w = M.lerp(0.045, 0.155 * (p.shoulder || 1), M.smooth(t)) * scale;
      if (Math.abs(u - spine) < w) return 1;
      return 0;
    }

    var torsoTop = headBot + 0.075;
    var torsoBot = p.legs === false ? 1.0 : 0.575;

    if (v >= torsoTop && v < torsoBot) {
      var tt = (v - torsoTop) / (torsoBot - torsoTop);
      var tw = M.lerp(0.155 * (p.shoulder || 1), 0.118 * (p.hip || 1), tt) * scale;
      if (p.legs === false) tw = M.lerp(0.155 * (p.shoulder || 1), 0.055, Math.pow(tt, 0.7)) * scale;
      if (Math.abs(u - spine) < tw) return 1;

      /* arms hang outside the torso and swing with the walk */
      if (p.arms !== false) {
        var swingA = Math.sin((p.phase || 0)) * (p.armSwing || 0);
        var aw = 0.036 * scale;
        var la = spine - tw - 0.028 + swingA * 0.05;
        var ra = spine + tw + 0.028 - swingA * 0.05;
        if (v > torsoTop + 0.04) {
          if (Math.abs(u - la) < aw || Math.abs(u - ra) < aw) return 1;
        }
      }
      return 0;
    }

    if (p.legs === false) return 0;

    if (v >= torsoBot) {
      var lt = (v - torsoBot) / (1 - torsoBot);
      var stride = Math.sin((p.phase || 0)) * (p.stride || 0);
      var lw = 0.048 * scale;
      var gap = 0.052 * scale * (1 - lt * 0.35);
      var lx = spine - gap + stride * lt * 0.10;
      var rx = spine + gap - stride * lt * 0.10;
      if (Math.abs(u - lx) < lw || Math.abs(u - rx) < lw) return 1;
      return 0;
    }
    return 0;
  }

  S.Entity = Entity;
  S.human = human;
  S.entities = [];
})(SALT);
