/* THE COMBER — the tide arriving, in a hurry, from the wrong direction.
 *
 * It is not hunting you. It does not know you are there. It comes in off the
 * sea along the whole width of the flat at once and there is no hiding from
 * something that wide -- only high ground. The pans are the low ground.
 * Get out of the water.
 *
 * The tell is five full seconds long and it is the best-signposted thing in
 * the game: the brine at your feet starts running backwards.
 */
(function (S) {
  'use strict';

  var M = S.M;

  var SEGS = 44;
  var SPRAY = 160;

  function Comber(startX) {
    S.Entity.call(this, 'comber', startX, 0);
    this.speed = 0;
    this.hit = false;
    this.crest = new Float32Array(SEGS + 1);
    /* x y z vx vy vz life  */
    this.spray = new Float32Array(SPRAY * 7);
    this.sprayN = 0;
    this.sprayT = 0;
  }
  Comber.prototype = Object.create(S.Entity.prototype);
  Comber.prototype.constructor = Comber;

  Comber.prototype.crestAt = function (i) {
    /* One continuous curve sampled at the segment joins, so neighbouring
     * slabs share an edge and the thing reads as a wave instead of a fence. */
    return 0.86 + M.noise2(i * 0.17, this.t * 1.15) * 0.85
                + M.noise2(i * 0.41, this.t * 2.3) * 0.26;
  };

  Comber.prototype.update = function (dt, ctx) {
    this.step(dt);
    var p = ctx.p, w = ctx.world;

    if (this.state === 'idle') {
      this.setState('run');
      this.speed = 6.2;
      if (ctx.audio) ctx.audio.comberBreak();
    }

    if (this.state !== 'run') return;

    this.x -= this.speed * dt;
    for (var i = 0; i <= SEGS; i++) this.crest[i] = this.crestAt(i);

    /* spray torn off the crest. it lags the wave, which is what makes the
     * wave look like it is moving rather than sliding. */
    this.sprayT += dt;
    var want = Math.min(SPRAY, this.sprayN + 5);
    while (this.sprayN < want) {
      var o = this.sprayN * 7;
      var seg = Math.random() * SEGS;
      this.spray[o] = this.x + Math.random() * 0.4;
      this.spray[o + 1] = (seg / SEGS) * w.gh;
      this.spray[o + 2] = this.crest[seg | 0] * 0.9;
      this.spray[o + 3] = -1.9 - Math.random() * 2.6;
      this.spray[o + 4] = (Math.random() - 0.5) * 1.2;
      this.spray[o + 5] = 1.1 + Math.random() * 2.2;
      this.spray[o + 6] = 0.5 + Math.random() * 0.9;
      this.sprayN++;
    }
    for (var s = this.sprayN - 1; s >= 0; s--) {
      var so = s * 7;
      this.spray[so] += this.spray[so + 3] * dt;
      this.spray[so + 1] += this.spray[so + 4] * dt;
      this.spray[so + 2] += this.spray[so + 5] * dt;
      this.spray[so + 5] -= dt * 5.4;
      this.spray[so + 6] -= dt;
      if (this.spray[so + 6] <= 0 || this.spray[so + 2] < 0.02) {
        var last = (this.sprayN - 1) * 7;
        for (var k = 0; k < 7; k++) this.spray[so + k] = this.spray[last + k];
        this.sprayN--;
      }
    }

    if (!this.hit && this.x <= p.x + 0.35) {
      this.hit = true;
      if (ctx.game.onHighGround()) {
        ctx.game.say('IT BREAKS ROUND YOU', 2.6);
        S.PostFX.kick(2.6);
        if (ctx.audio) ctx.audio.comberPass(true);
      } else {
        ctx.game.spend(2 + (Math.random() < 0.35 ? 1 : 0), 'THE TIDE TOOK IT');
        S.PostFX.kick(7.5);
        if (ctx.audio) ctx.audio.comberPass(false);
      }
    }

    if (this.x < -5) { this.dead = true; S.Tide.reset(w.doorNum); }
  };

  Comber.prototype.render = function (fb, tier) {
    var R = S.Ray, w = S.World;
    var gh = w.gh, segH = gh / SEGS;
    var x = this.x, t = this.t;
    var crest = this.crest;

    /* the trough it drags behind it: the flat goes black just in front */
    R.slab(fb, x - 0.9, 0, x - 0.9, gh, 0, 0.06, function (tt, z, dist, out) {
      out[0] = 0.02; out[1] = 0;
    });

    for (var i = 0; i < SEGS; i++) {
      var y0 = i * segH, y1 = (i + 1) * segH;
      var hA = crest[i], hB = crest[i + 1];
      var h = (hA + hB) * 0.5;
      var ii = i;

      /* the face. foam gathers at the crest and drains down it in threads. */
      R.slab(fb, x, y0, x, y1, 0, h, function (tt, z, dist, out) {
        /* the top of this slab follows the interpolated crest, so the wave
         * has one continuous edge across the whole flat */
        var top = hA + (hB - hA) * tt;
        if (z > top) { out[0] = -1; return; }
        var f = z / top;
        var thread = M.noise2(tt * 3 + ii * 1.7, z * 7 - t * 6);
        var v = 0.30 + thread * 0.28;
        if (f > 0.52) v += (f - 0.52) * 2.1 * (0.55 + thread * 1.1);
        if (f > 0.86) v += 0.60 + thread * 0.5;
        out[0] = v > 1.8 ? 1.8 : v;
        out[1] = 0;
        /* churned brine is bright on its own account. this is what makes a
         * wave arriving out of the dark visible from forty metres, which it
         * has to be, or the five second warning is worth nothing. */
        out[2] = 0.055 + (f > 0.60 ? (f - 0.60) * 0.90 : 0) + thread * 0.03;
      });

      /* the shoulder behind the crest, lower and duller: gives it depth */
      R.slab(fb, x + 0.7, y0, x + 0.7, y1, 0, h * 0.66, function (tt, z, dist, out) {
        out[0] = 0.06 + M.noise2(tt * 4 + ii, z * 5 + t * 3) * 0.09;
        out[1] = 0;
      });
    }

    /* torn spray, depth tested against everything already in the frame */
    var L = fb.lum, D = fb.dep, W = fb.w, H = fb.h;
    var pt = [0, 0, 0];
    for (var s = 0; s < this.sprayN; s++) {
      var o = s * 7;
      if (!R.project(fb, this.spray[o], this.spray[o + 1], this.spray[o + 2], pt)) continue;
      var d = pt[2];
      if (d < 0.3 || d > 26) continue;
      var px = pt[0] | 0, py = pt[1] | 0;
      if (px < 0 || py < 0 || px >= W || py >= H) continue;
      var idx = py * W + px;
      if (d >= D[idx]) continue;
      var life = this.spray[o + 6];
      var v = 0.55 * life * (1 - d / 26);
      L[idx] += v;
      if (px + 1 < W && d < D[idx + 1]) L[idx + 1] += v * 0.6;
    }
  };

  S.Comber = Comber;
})(SALT);
