/* THE TALLY — not hostile, and the only thing out here that is not.
 *
 * A stooped figure walking the line ahead of you, scratching numbers into the
 * crust as it goes. It has never touched anybody. It also cannot stand your
 * lamp: come at it lit and it goes away and takes what it knows with it.
 *
 * Follow it doused, close, for three seconds, and it will mark the next gate
 * for you -- what is holding it, or that nothing is. The counterplay is
 * trust: you have to walk blind, next to something, on purpose.
 */
(function (S) {
  'use strict';

  var M = S.M;

  function Tally(x, y) {
    S.Entity.call(this, 'tally', x, y);
    this.follow = 0;
    this.marked = false;
    this.fade = 1;
    this.phase = 0;
    this.scratch = 0;
    this.goalY = y;
  }
  Tally.prototype = Object.create(S.Entity.prototype);
  Tally.prototype.constructor = Tally;

  Tally.prototype.update = function (dt, ctx) {
    this.step(dt);
    var p = ctx.p, w = ctx.world;
    var lit = this.inLamp(p);
    var d = this.distTo(p.x, p.y);

    if (this.state === 'idle') this.setState('walk');

    if (this.state === 'walk') {
      /* it is going where you are going, just slower and without a light */
      var gateX = w.door ? w.door.x - 1.4 : this.x + 4;
      if (this.stateT > 2.6) {
        this.goalY = M.clamp(this.y + (M.noise2(this.t * 0.3, this.seed) - 0.5) * 6, 3, w.gh - 4);
        this.stateT = 0;
      }
      this.moveToward(gateX, this.goalY, 0.62, dt, w);
      this.phase += dt * 2.4;
      this.scratch = 0.5 + 0.5 * Math.sin(this.t * 3.1);

      if (lit > 0.16) { this.setState('flee'); if (ctx.audio) ctx.audio.tallyFlee(); }

      if (!p.lampOn && d < 4.2 && !this.marked) {
        this.follow += dt;
        ctx.game.say('IT IS LETTING YOU FOLLOW', 0.6);
        if (this.follow > 3.0) {
          this.marked = true;
          ctx.game.tallyMark();
          if (ctx.audio) ctx.audio.tallyMark();
          this.setState('leave');
        }
      } else if (this.follow > 0) {
        this.follow = Math.max(0, this.follow - dt * 1.6);
      }

      if (this.x > (w.door ? w.door.x - 1.0 : 1e9)) this.setState('leave');
    }

    if (this.state === 'flee') {
      var ax = this.x - p.x, ay = this.y - p.y;
      var al = Math.sqrt(ax * ax + ay * ay) || 1;
      this.moveToward(this.x + ax / al * 8, this.y + ay / al * 8, 2.6, dt, w);
      this.phase += dt * 7.5;
      this.fade -= dt * 0.55;
      if (this.fade <= 0) this.dead = true;
    }

    if (this.state === 'leave') {
      this.moveToward(this.x + 3, this.y, 1.1, dt, w);
      this.phase += dt * 3.0;
      this.fade -= dt * 0.34;
      if (this.fade <= 0) this.dead = true;
    }
  };

  Tally.prototype.render = function (fb, tier, alpha) {
    var self = this;
    var ph = this.phase;
    var scratch = this.scratch;

    var shape = function (u, v) {
      /* bent right over: the head is nearly at the height of its own hand */
      var body = S.human(u, v, {
        hunch: 0.30, lean: -0.05, headTop: 0.13, headSize: 0.92,
        shoulder: 1.06, hip: 0.95, phase: ph, armSwing: 0.5, stride: 0.5,
        sway: 0.05, wide: 1
      });
      if (body) return 1;
      /* the arm that does the scratching, reaching down and forward */
      var ax = 0.5 + 0.30 + Math.sin(ph * 0.9) * 0.05;
      var ay = 0.30 + (v - 0.30);
      if (v > 0.30 && v < 0.86) {
        var t = (v - 0.30) / 0.56;
        var hx = M.lerp(0.62, 0.80 + scratch * 0.05, t);
        if (Math.abs(u - hx) < 0.030) return 1;
      }
      return 0;
    };

    S.Spr.draw(fb, this.x, this.y, 0, 0.95, 1.52, shape, {
      alpha: this.fade,
      bodyLum: 0.14,
      rimLum: 0.30,
      rim: 0.75,
      sway: Math.sin(this.t * 1.3) * 1.2
    });
  };

  S.Tally = Tally;
})(SALT);
