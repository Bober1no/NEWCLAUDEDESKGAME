/* SALT LINE — palette, luminance ramp, ordered dither matrices.
 *
 * The renderer never writes a colour. It writes a luminance and an ember
 * amount into float buffers, and this file is the only place where either
 * becomes a pixel. That is what keeps six colours to six colours: no pass
 * anywhere downstream can invent a value that is not on the ramp.
 */
(function (S) {
  'use strict';

  var P = {};
  var pal = S.PALETTE;

  P.N = pal.ramp.length;          /* 7 steps */
  P.STEPS = P.N - 1;

  /* split channels so the resolve can dither each one independently, which
   * is what gives the registration-error look at higher tiers */
  P.R = new Uint8Array(P.N);
  P.G = new Uint8Array(P.N);
  P.B = new Uint8Array(P.N);
  for (var i = 0; i < P.N; i++) {
    P.R[i] = pal.ramp[i][0];
    P.G[i] = pal.ramp[i][1];
    P.B[i] = pal.ramp[i][2];
  }

  P.EMBER_R = pal.ember[0];
  P.EMBER_G = pal.ember[1];
  P.EMBER_B = pal.ember[2];
  P.HOT_R = pal.emberHot[0];
  P.HOT_G = pal.emberHot[1];
  P.HOT_B = pal.emberHot[2];

  /* ---- Bayer matrices, normalised to [-0.5, 0.5] ----------------------- */
  function bayer(order) {
    var n = 1, m = [[0]];
    while (n < order) {
      var s = n * 2, out = [];
      for (var y = 0; y < s; y++) {
        out[y] = [];
        for (var x = 0; x < s; x++) {
          var q = (y < n ? 0 : 2) + (x < n ? 0 : 1);
          var base = [0, 2, 3, 1][q];
          out[y][x] = m[y % n][x % n] * 4 + base;
        }
      }
      m = out; n = s;
    }
    var total = order * order;
    var flat = new Float32Array(total);
    for (var yy = 0; yy < order; yy++)
      for (var xx = 0; xx < order; xx++)
        flat[yy * order + xx] = m[yy][xx] / total - 0.5;
    return flat;
  }

  P.bayer2 = bayer(2);
  P.bayer4 = bayer(4);
  P.bayer8 = bayer(8);

  P.matrixFor = function (order) {
    if (order <= 2) return P.bayer2;
    if (order <= 4) return P.bayer4;
    return P.bayer8;
  };

  /* A blue-ish noise field. On DROWNED the dither threshold is nudged by a
   * slow crawl through this, so the grain in the dark breathes instead of
   * sitting still like a screen door. */
  P.NOISE_SIZE = 64;
  P.noiseField = (function () {
    var n = P.NOISE_SIZE, f = new Float32Array(n * n);
    var r = S.M.rng(0x5a17);
    /* start white, then relax toward blue by repeatedly swapping the worst
     * offenders. cheap, done once at load, produces a usable field. */
    for (var i = 0; i < n * n; i++) f[i] = r.f();
    var tmp = new Float32Array(n * n);
    for (var pass = 0; pass < 3; pass++) {
      for (var y = 0; y < n; y++) {
        for (var x = 0; x < n; x++) {
          var s = 0, c = 0;
          for (var dy = -1; dy <= 1; dy++) {
            for (var dx = -1; dx <= 1; dx++) {
              if (!dx && !dy) continue;
              s += f[((y + dy + n) % n) * n + ((x + dx + n) % n)];
              c++;
            }
          }
          /* push each sample away from its neighbourhood mean */
          tmp[y * n + x] = S.M.sat(f[y * n + x] + (f[y * n + x] - s / c) * 0.55);
        }
      }
      f.set(tmp);
    }
    for (var j = 0; j < n * n; j++) f[j] -= 0.5;
    return f;
  })();

  S.Pal = P;
})(SALT);
