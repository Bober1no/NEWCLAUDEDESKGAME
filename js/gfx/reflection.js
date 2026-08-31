/* SALT LINE — what the pans hold.
 *
 * A screen-space mirror. Everything below the horizon that the floor pass
 * marked wet samples the row reflected through the horizon, offset by a wave
 * field. It costs almost nothing and it is the single effect that sells the
 * setting: the doorframes and the standing figures come back at you out of
 * two inches of brine, which is worse than seeing them directly.
 *
 * reflect = 1  flat mirror, one wave scale, per-row offset   (WET)
 * reflect = 2  per-pixel wave, depth-weighted fresnel, and the reflection
 *              itself fades with the depth of what it is reflecting (DROWNED)
 */
(function (S) {
  'use strict';

  var M = S.M;
  var Rf = {};

  Rf.apply = function (fb, tier, time) {
    if (!tier.reflect) return;
    var R = S.Ray;
    var w = fb.w, h = fb.h;
    var L = fb.lum, E = fb.emb, D = fb.dep, WET = fb.wet;
    var hz = R.cam.horizon;
    var y0 = Math.max(0, Math.floor(hz) + 1);
    if (y0 >= h) return;

    var Tex = S.Tex, bd = Tex.brine.d, ts = Tex.size, tm = ts - 1;
    var perPixel = tier.reflect >= 2;
    var camX = R.cam.x, camY = R.cam.y;
    var eye = R.cam.eye, projK = R.cam.projK;

    var rdx0 = fb.rayDX[0], rdy0 = fb.rayDY[0];
    var rdx1 = fb.rayDX[w - 1], rdy1 = fb.rayDY[w - 1];

    var t1 = time * 0.6, t2 = time * 0.37;

    for (var y = y0; y < h; y++) {
      var dy = y - hz; if (dy < 0.5) dy = 0.5;
      var dist = eye * projK / dy;
      if (dist > 30) continue;

      var my = Math.round(2 * hz - y);
      if (my < 0) continue;

      /* fresnel: brine at your feet reflects almost nothing, brine out at the
       * horizon reflects almost everything. */
      var fres = 0.14 + 0.62 * M.sat((dist - 0.8) * 0.14);

      var rowOff = y * w;
      var stepX = (rdx1 - rdx0) * dist / w;
      var stepY = (rdy1 - rdy0) * dist / w;
      var wx = camX + rdx0 * dist;
      var wy = camY + rdy0 * dist;

      /* per-row wave when we are not doing it per pixel */
      var rowWave = perPixel ? 0 :
        Math.round(Math.sin(y * 0.37 + t1 * 3) * 1.6 + Math.sin(y * 0.11 - t2 * 2) * 2.4);

      for (var x = 0; x < w; x++, wx += stepX, wy += stepY) {
        var idx = rowOff + x;
        if (!WET[idx]) continue;

        var srcY, srcX = x;
        if (perPixel) {
          var ax = ((wx * ts * 0.30 + t1 * 6) | 0) & tm;
          var ay = ((wy * ts * 0.30 - t2 * 4) | 0) & tm;
          var bx = ((wx * ts * 0.73 - t2 * 9) | 0) & tm;
          var by = ((wy * ts * 0.73 + t1 * 5) | 0) & tm;
          var wv = (bd[ay * ts + ax] - 0.5) * 2 + (bd[by * ts + bx] - 0.5);
          /* the chop is bigger close up, where you can resolve it */
          var amp = 5.5 / (1 + dist * 0.35);
          srcY = my + Math.round(wv * amp);
          srcX = x + Math.round(wv * amp * 0.45);
          if (srcX < 0) srcX = 0; else if (srcX >= w) srcX = w - 1;
        } else {
          srcY = my + rowWave;
        }

        if (srcY < 0) srcY = 0;
        if (srcY >= h) continue;
        var si = srcY * w + srcX;

        var rl = L[si], re = E[si];
        if (perPixel) {
          /* something reflected from far away has further to travel back */
          var sd = D[si];
          if (sd < 1e8) {
            var atten = 1 / (1 + sd * 0.05);
            rl *= atten; re *= atten;
          }
        }

        var f = fres;
        L[idx] += rl * f;
        if (re > 0) {
          var e = E[idx] + re * f;
          E[idx] = e > 1 ? 1 : e;
        }
      }
    }
  };

  S.Reflect = Rf;
})(SALT);
