/* THE CHOIR OF PANS — an entity with no body that never touches you.
 *
 * Somewhere out in the evaporators, a chord starts. While it is sounding,
 * every letter you spend costs two. It cannot be fought, hidden from, looked
 * away from or outrun. It can be waited out, and waiting is the tide.
 *
 * It is here because a horror game where every threat is a thing with legs
 * gets solved as a movement problem. This one attacks the economy.
 */
(function (S) {
  'use strict';

  function Choir(dur) {
    S.Entity.call(this, 'choir', 0, 0);
    this.dur = dur || 34;
    this.warm = 0;
  }
  Choir.prototype = Object.create(S.Entity.prototype);
  Choir.prototype.constructor = Choir;

  Choir.prototype.update = function (dt, ctx) {
    this.step(dt);
    if (this.state === 'idle') {
      this.setState('sing');
      if (ctx.audio) ctx.audio.choirStart();
      ctx.game.say('SOMETHING IN THE PANS IS SINGING', 4.0);
    }
    if (this.state === 'sing') {
      this.warm = Math.min(1, this.warm + dt * 0.7);
      ctx.game.choir = true;
      if (this.stateT > this.dur) this.setState('fade');
    }
    if (this.state === 'fade') {
      this.warm -= dt * 0.5;
      ctx.game.choir = false;
      if (ctx.audio) ctx.audio.choirStop();
      if (this.warm <= 0) this.dead = true;
    }
  };

  /* It has nothing to draw. What it does instead is bend the light: while it
   * sings, the whole frame breathes on the chord. */
  Choir.prototype.render = function () {};

  Choir.prototype.pulse = function () {
    return this.warm * (0.5 + 0.5 * Math.sin(this.t * 1.15));
  };

  S.Choir = Choir;
})(SALT);
