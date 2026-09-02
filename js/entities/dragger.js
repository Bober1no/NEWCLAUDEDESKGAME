/* THE DRAGGER — under the brine, and it cannot hear a thing.
 *
 * It hunts displacement. Not sound, not light, not sight: the shove your legs
 * put through two inches of standing water. Walk in the pans and it comes
 * straight at you. Stop -- actually stop, feet and head both -- and it goes
 * over the top of you and away.
 *
 * It cannot come onto dry crust. The whole entity is a lesson in reading the
 * ground, and it is why the haul road is not always dry.
 */
(function (S) {
  'use strict';

  var M = S.M;

  function Dragger(x, y) {
    S.Entity.call(this, 'dragger', x, y);
    this.heading = 0;
    this.lost = 0;
    this.cool = 0;
    this.surface = 0;      /* 0 fully under, 1 ridge showing */
    this.circle = 0;
  }
  Dragger.prototype = Object.create(S.Entity.prototype);
  Dragger.prototype.constructor = Dragger;

  Dragger.prototype.update = function (dt, ctx) {
    this.step(dt);
    var p = ctx.p, w = ctx.world;
    var d = this.distTo(p.x, p.y);

    if (this.state === 'idle') this.setState('under');

    if (this.state === 'under') {
      this.surface = M.toward(this.surface, 0.10, dt * 0.7);
      this.cool -= dt;
      /* drifts, slowly, wherever the water is */
      this.circle += dt * 0.4;
      var wx = this.x + Math.cos(this.circle) * 0.4;
      var wy = this.y + Math.sin(this.circle) * 0.4;
      if (w.isWet(wx, wy)) this.moveToward(wx, wy, 0.35, dt, w);

      if (this.cool <= 0 && p.wet && p.disturbance > 0.34 && d < 16) {
        this.setState('hunt');
        if (ctx.audio) ctx.audio.draggerWake();
      }
    }

    if (this.state === 'hunt') {
      this.surface = M.toward(this.surface, 1, dt * 1.6);
      ctx.game.say('SOMETHING IS COMING THROUGH THE WATER', 0.5);

      /* it will not leave the water. if you are dry it paces the edge. */
      var tx = p.x, ty = p.y;
      if (!p.wet) {
        var ax = Math.atan2(this.y - p.y, this.x - p.x);
        tx = p.x + Math.cos(ax) * 1.6;
        ty = p.y + Math.sin(ax) * 1.6;
      }
      var nx = this.x + (tx - this.x), ny = this.y + (ty - this.y);
      var stepLen = Math.sqrt((tx - this.x) * (tx - this.x) + (ty - this.y) * (ty - this.y)) || 1;
      var sp = 2.05;
      var cx = this.x + (tx - this.x) / stepLen * sp * dt;
      var cy = this.y + (ty - this.y) / stepLen * sp * dt;
      if (w.isWet(cx, this.y) && !w.solidAt(cx, this.y)) this.x = cx;
      if (w.isWet(this.x, cy) && !w.solidAt(this.x, cy)) this.y = cy;
      this.heading = Math.atan2(ty - this.y, tx - this.x);

      if (ctx.audio) ctx.audio.draggerNear(M.sat(1 - d / 14));

      if (p.disturbance < 0.13) {
        this.lost += dt;
        if (this.lost > 1.4) { this.setState('under'); this.cool = 9; this.lost = 0; }
      } else {
        this.lost = 0;
      }

      if (d < 0.95 && p.wet) {
        ctx.game.spend(2, 'IT TOOK THEM OUT OF YOUR HANDS');
        ctx.game.shove(this.heading, 2.3);
        S.PostFX.kick(9);
        if (ctx.audio) ctx.audio.draggerStrike();
        this.setState('under');
        this.cool = 22;
      }

      if (this.stateT > 34) { this.setState('under'); this.cool = 14; }
    }
  };

  Dragger.prototype.render = function (fb, tier) {
    var R = S.Ray;
    if (this.surface < 0.04) return;
    var h = this.surface;
    var hd = this.heading;
    var cx = Math.cos(hd), sy = Math.sin(hd);
    var t = this.t;

    /* the ridge: a long low back, only ever a few inches out of the water */
    var len = 1.75;
    var ax = this.x - cx * len * 0.5, ay = this.y - sy * len * 0.5;
    var bx = this.x + cx * len * 0.5, by = this.y + sy * len * 0.5;
    var top = 0.055 + h * 0.20;

    R.slab(fb, ax, ay, bx, by, 0, top, function (tt, z, dist, out) {
      var arc = Math.sin(tt * Math.PI);
      if (z > top * arc) { out[0] = -1; return; }
      out[0] = 0.045 + M.noise2(tt * 8, z * 30 + t * 4) * 0.05;
      out[1] = 0;
    });

    /* the wake. two lines of pushed water, which is the actual tell: you see
     * this long before you see the back. */
    var wl = 2.6 + h * 1.4;
    for (var s = -1; s <= 1; s += 2) {
      var a2 = hd + s * 0.42 + Math.PI;
      var wx = this.x + Math.cos(a2) * wl, wy = this.y + Math.sin(a2) * wl;
      R.slab(fb, this.x, this.y, wx, wy, 0, 0.035 + h * 0.05,
        function (tt, z, dist, out) {
          var fade = 1 - tt;
          out[0] = (0.16 + M.noise2(tt * 14, t * 6) * 0.22) * fade * h;
          out[1] = 0;
        });
    }
  };

  S.Dragger = Dragger;
})(SALT);
