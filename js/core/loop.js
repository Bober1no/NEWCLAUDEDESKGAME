/* SALT LINE — the clock.
 *
 * Simulation runs at a fixed 60Hz and never varies. Render runs whenever the
 * browser lets it. On DROWNED a render frame can cost 40ms and the salt flat
 * does not care: entity timing, the tide, and door tolls are all counted in
 * sim ticks, so the top tier is slower to look at and identical to play.
 */
(function (S) {
  'use strict';

  function Loop(sim, render) {
    this.sim = sim;
    this.render = render;
    this.acc = 0;
    this.last = 0;
    this.running = false;
    this.frame = 0;

    /* rolling stats, shown on the pause card */
    this.fps = 0;
    this.msRender = 0;
    this.msSim = 0;
    this._fpsAcc = 0;
    this._fpsN = 0;
    this._fpsT = 0;

    this._tick = this._tick.bind(this);
  }

  Loop.prototype.start = function () {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.acc = 0;
    requestAnimationFrame(this._tick);
  };

  Loop.prototype.stop = function () { this.running = false; };

  Loop.prototype._tick = function (now) {
    if (!this.running) return;
    requestAnimationFrame(this._tick);

    var dt = (now - this.last) / 1000;
    this.last = now;

    /* A heavy DROWNED frame must not let the sim run away. Cap the catch-up
     * at 5 ticks; beyond that we drop simulated time rather than spiral. */
    if (dt > 0.25) dt = 0.25;
    this.acc += dt;

    var t0 = performance.now();
    var steps = 0;
    while (this.acc >= S.K.SIM_DT && steps < 5) {
      this.sim(S.K.SIM_DT);
      this.acc -= S.K.SIM_DT;
      steps++;
    }
    if (steps >= 5) this.acc = 0;
    var t1 = performance.now();

    /* fraction of a tick we are into the next one, for render interpolation */
    var alpha = this.acc / S.K.SIM_DT;
    this.render(alpha, dt);
    var t2 = performance.now();

    this.msSim = this.msSim * 0.9 + (t1 - t0) * 0.1;
    this.msRender = this.msRender * 0.9 + (t2 - t1) * 0.1;

    this._fpsAcc += dt; this._fpsN++;
    if (this._fpsAcc >= 0.5) {
      this.fps = this._fpsN / this._fpsAcc;
      this._fpsAcc = 0; this._fpsN = 0;
    }
    this.frame++;
  };

  S.Loop = Loop;
})(SALT);
