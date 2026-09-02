/* THE ASSESSOR — a toll, not a monster.
 *
 * It stands in the gap with a slate and it does not move. It will not chase
 * you, touch you, or follow you through. What it does is put a price on the
 * gate, and the price is scaled by how many graves you have robbed to get
 * here: the flat keeps accounts, and it has been reading yours.
 *
 * You can pay it or you can wait it out at a distance. Waiting costs tide,
 * and the tide brings something that does not negotiate.
 *
 * Do not crowd it. It reassesses.
 */
(function (S) {
  'use strict';

  var M = S.M;

  function Assessor(door) {
    S.Entity.call(this, 'assessor', door.x - 0.55, door.y);
    this.door = door;
    this.wait = 0;
    this.slate = 0;
    this.reassessCool = 0;
    this.leaving = 0;
    this.fade = 1;
    this.crowdWarn = 0;
  }
  Assessor.prototype = Object.create(S.Entity.prototype);
  Assessor.prototype.constructor = Assessor;

  Assessor.prototype.price = function (game) {
    return 1 + Math.min(4, Math.floor(game.robbed / 3));
  };

  Assessor.prototype.update = function (dt, ctx) {
    this.step(dt);
    var p = ctx.p, d = this.distTo(p.x, p.y);
    var door = this.door;

    if (this.state === 'idle') {
      this.setState('hold');
      door.surcharge = this.price(ctx.game);
      if (ctx.audio) ctx.audio.slate();
    }

    if (this.state === 'hold') {
      /* it writes. that is the only thing about it that moves. */
      this.slate = Math.max(0, this.slate - dt);
      if (this.slate <= 0 && Math.random() < dt * 0.55) {
        this.slate = 0.5 + Math.random() * 0.7;
        if (d < 14 && ctx.audio) ctx.audio.chalk(M.sat(1 - d / 14));
      }

      this.reassessCool -= dt;
      if (d < 2.6 && this.reassessCool <= 0) {
        door.surcharge += 1;
        this.reassessCool = 4.5;
        ctx.game.say('IT WRITES SOMETHING ELSE DOWN', 2.4);
        if (ctx.audio) ctx.audio.slate();
        S.PostFX.kick(0.9);
      }

      if (d > 6.2) {
        this.wait += dt;
        if (this.wait > 20) { this.setState('leave'); }
      } else {
        this.wait = Math.max(0, this.wait - dt * 0.6);
      }

      if (door.opened) this.setState('leave');
    }

    if (this.state === 'leave') {
      door.surcharge = 0;
      this.fade -= dt * 0.7;
      this.y += dt * 0.35;
      if (this.fade <= 0) this.dead = true;
    }
  };

  Assessor.prototype.render = function (fb, tier) {
    var t = this.t;
    var slateUp = this.slate > 0;
    var write = Math.sin(t * 14) * 0.5 + 0.5;

    var shape = function (u, v) {
      /* far too tall, far too narrow, and no legs you can find */
      var body = S.human(u, v, {
        headTop: 0.015, headSize: 1.05, shoulder: 1.30, hip: 1.05,
        legs: false, arms: false, wide: 1.35
      });

      /* the slate: the pale rectangle you see before you see the figure */
      var sx0 = 0.62, sx1 = 0.94, sy0 = 0.32, sy1 = 0.47;
      if (u > sx0 && u < sx1 && v > sy0 && v < sy1) {
        var edge = (u - sx0 < 0.022 || sx1 - u < 0.022 || v - sy0 < 0.012 || sy1 - v < 0.012);
        return edge ? 2 : 1;
      }
      /* the arm holding it */
      if (v > 0.27 && v < 0.38 && u > 0.48 && u < 0.66) return 1;
      /* the hand that writes */
      if (slateUp) {
        var wx = 0.66 + write * 0.22;
        if (v > 0.28 && v < 0.33 && Math.abs(u - wx) < 0.030) return 1;
      }
      return body;
    };

    S.Spr.draw(fb, this.x, this.y, 0, 1.05, 2.62, shape, {
      alpha: this.fade,
      bodyLum: 0.055,
      rimLum: 0.55,
      rim: 0.9,
      sway: 0
    });
  };

  S.Assessor = Assessor;
})(SALT);
