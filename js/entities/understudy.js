/* THE UNDERSTUDY — the one that ends the run.
 *
 * Far down the line there is a second lamp. It is your lamp. It moves when
 * you move and it stops when you stop, except it is a half-beat late, and the
 * lateness is the only reason you can tell which one is yours.
 *
 * It closes on you by copying you. Every metre you walk, it walks further.
 * The counterplay is to do something it has nothing to copy:
 *
 *   stand completely still  -- it desynchronises and comes apart
 *   put your lamp out       -- there is nothing left to imitate
 *
 * Both answers require you to stop making progress, which is why it is the
 * thing that actually kills you: the whole game is built to keep you moving.
 *
 * If it reaches you it takes the whole name at once and wears it, and the
 * count on the door you were standing at goes up by one.
 */
(function (S) {
  'use strict';

  var M = S.M;

  function Understudy(x, y, gap) {
    S.Entity.call(this, 'understudy', x, y);
    this.gap = gap || 15;
    this.bearing = Math.atan2(y - 0, x - 0);
    this.anchorX = x; this.anchorY = y;
    this.still = 0;
    this.dark = 0;
    this.coherence = 1;      /* 1 solid, 0 gone */
    this.phase = 0;
    this.lampFlicker = 1;
    this.warned = false;
  }
  Understudy.prototype = Object.create(S.Entity.prototype);
  Understudy.prototype.constructor = Understudy;

  Understudy.prototype.update = function (dt, ctx) {
    this.step(dt);
    var p = ctx.p, w = ctx.world, g = ctx.game;

    if (this.state === 'idle') {
      this.setState('copy');
      this.bearing = Math.atan2(this.y - p.y, this.x - p.x);
      if (ctx.audio) ctx.audio.understudyAppear();
    }

    /* your own lamp starts echoing itself. this is the tell, and it is on
     * your lamp rather than on the thing, so you cannot avoid seeing it. */
    g.lampDesync = Math.max(g.lampDesync, this.coherence * 0.9);

    if (this.state === 'copy') {
      /* every metre you walk, it walks one and a bit */
      var closed = p.speed * dt * 1.34;
      this.gap -= closed;

      var stillNow = (p.speed < 0.06 && Math.abs(p.turnRate) < 0.20);
      if (stillNow) {
        this.still += dt;
        this.gap += dt * 0.5;
      } else {
        this.still = Math.max(0, this.still - dt * 1.9);
      }

      if (!p.lampOn) { this.dark += dt; this.gap += dt * 0.9; }
      else this.dark = Math.max(0, this.dark - dt * 1.2);

      if (this.still > 3.0 || this.dark > 2.5) { this.setState('unravel'); }

      /* it holds its bearing: it is always ahead of you, on the line */
      this.bearing += (M.noise2(this.t * 0.2, this.seed) - 0.5) * dt * 0.35;
      this.x = p.x + Math.cos(this.bearing) * this.gap;
      this.y = M.clamp(p.y + Math.sin(this.bearing) * this.gap, 2.4, w.gh - 2.4);

      this.phase = p.walkPhase - 0.55;      /* the half-beat */
      this.lampFlicker = p.lampFlickerDelayed;

      if (!this.warned && this.gap < 8) {
        this.warned = true;
        g.say('THERE IS A SECOND LAMP ON THE LINE', 4.0);
      }
      if (this.gap < 4.5) {
        S.PostFX.pressure = Math.max(S.PostFX.pressure, M.sat((4.5 - this.gap) / 3.4));
        if (ctx.audio) ctx.audio.understudyNear(M.sat((6 - this.gap) / 6));
      }

      if (this.gap <= 1.15) {
        this.setState('take');
        if (ctx.audio) ctx.audio.understudyTake();
      }
    }

    if (this.state === 'unravel') {
      this.coherence -= dt * 0.85;
      this.gap += dt * 3.4;
      this.x = p.x + Math.cos(this.bearing) * this.gap;
      this.y = p.y + Math.sin(this.bearing) * this.gap;
      if (this.coherence <= 0) {
        this.dead = true;
        g.lampDesync = 0;
        g.say('IT CAME APART', 3.0);
        if (ctx.audio) ctx.audio.understudyGone();
      }
    }

    if (this.state === 'take') {
      this.gap = Math.max(0.4, this.gap - dt * 1.6);
      this.x = p.x + Math.cos(this.bearing) * this.gap;
      this.y = p.y + Math.sin(this.bearing) * this.gap;
      S.PostFX.pressure = 1;
      S.PostFX.invert = Math.min(1, this.stateT * 0.55);
      if (this.stateT > 1.5) {
        g.takenByUnderstudy();
        this.dead = true;
      }
    }
  };

  Understudy.prototype.render = function (fb, tier) {
    var ph = this.phase;
    var coh = this.coherence;
    var flick = this.lampFlicker;
    var t = this.t;

    var shape = function (u, v) {
      /* a person. exactly a person. that is the entire design. */
      var body = S.human(u, v, {
        headTop: 0.03, headSize: 1, shoulder: 1, hip: 1,
        phase: ph, armSwing: 0.55, stride: 0.8, sway: 0.03
      });

      /* the lamp, held low and out to the side, exactly as you hold yours */
      var lx = 0.775, ly = 0.455;
      var du = (u - lx) * 1.8, dv = (v - ly) * 1.1;
      var r2 = du * du + dv * dv;
      if (r2 < 0.00075) return 3;
      if (r2 < 0.0022) return 2;
      /* the arm out to it */
      if (v > 0.42 && v < 0.47 && u > 0.60 && u < lx) return 1;

      if (body && coh < 1) {
        /* coming apart: it loses coherence as vertical threads, so it reads
         * as something unravelling rather than something fading out */
        var thread = M.noise2(u * 26, v * 5 + t * 3);
        if (thread > coh) return 0;
      }
      return body;
    };

    S.Spr.draw(fb, this.x, this.y, 0, 0.95, 1.76, shape, {
      alpha: 1,
      bodyLum: 0.05,
      rimLum: 0.30 + coh * 0.16,
      rim: 0.85,
      ember: 0.75 + flick * 0.25,
      sway: Math.sin(t * 0.9) * 0.8
    });
  };

  S.Understudy = Understudy;
})(SALT);
