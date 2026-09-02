/* SALT LINE — billboards.
 *
 * Everything that is not terrain is drawn through here: entities, markers,
 * rakes, posts, motes. Entities are described as shape functions rather than
 * images, which is the whole reason they can be silhouette-only and still
 * read: the function returns a code, not a colour, and the compositor decides
 * what a silhouette means.
 *
 *   0  nothing
 *   1  body      -- a hole. darker than whatever is behind it.
 *   2  rime      -- salt crust on the edge. the only thing that catches light.
 *   3  ember     -- attention. rationed to almost nothing.
 */
(function (S) {
  'use strict';

  var M = S.M, K = S.K;
  var Spr = {};

  var mask = new Uint8Array(256 * 256);
  var maskW = 256, maskH = 256;

  function ensureMask(w, h) {
    if (w <= maskW && h <= maskH) return;
    maskW = Math.max(w, maskW);
    maskH = Math.max(h, maskH);
    mask = new Uint8Array(maskW * maskH);
  }

  var _p = [0, 0, 0];

  /* Multiplied into every sprite's alpha. The renderer drops it below 1 for
   * the motion-blur ghost passes and puts it back afterwards, so no entity
   * has to know that it is being drawn three times. */
  Spr.globalAlpha = 1;

  /* opts:
   *   bodyLum   how much of the background survives inside the silhouette
   *   rimLum    absolute luminance of the salt rime
   *   ember     ember amount for code 3
   *   alpha     0..1 fade (dither-thresholded, never blended)
   *   sway      horizontal shear in framebuffer pixels, applied by row
   */
  Spr.draw = function (fb, wx, wy, zBase, worldW, worldH, shapeFn, opts) {
    var R = S.Ray;
    if (!R.project(fb, wx, wy, zBase + worldH * 0.5, _p)) return false;
    var dist = _p[2];
    if (dist > K.VIEW || dist < 0.12) return false;

    var sw = Math.round(worldW * R.cam.projK / dist);
    var sh = Math.round(worldH * R.cam.projK / dist);
    if (sw < 1 || sh < 1) return false;
    if (sw > 1400 || sh > 1400) { sw = Math.min(sw, 1400); sh = Math.min(sh, 1400); }

    var cx = _p[0];
    var yBottom = R.cam.horizon - (zBase - R.cam.eye) * R.cam.projK / dist;
    var x0 = Math.round(cx - sw * 0.5);
    var y0 = Math.round(yBottom - sh);

    /* fully off screen? */
    if (x0 + sw < 0 || x0 >= fb.w || y0 + sh < 0 || y0 >= fb.h) return false;

    opts = opts || {};
    var bodyLum = (opts.bodyLum === undefined) ? 0.10 : opts.bodyLum;
    var rimLum = (opts.rimLum === undefined) ? 0.42 : opts.rimLum;
    var ember = (opts.ember === undefined) ? 0.95 : opts.ember;
    var alpha = ((opts.alpha === undefined) ? 1 : opts.alpha) * Spr.globalAlpha;
    var sway = opts.sway || 0;

    ensureMask(sw, sh);

    /* pass 1: rasterise the silhouette code field */
    var invW = 1 / sw, invH = 1 / sh;
    for (var my = 0; my < sh; my++) {
      var v = (my + 0.5) * invH;
      var rowOff = my * maskW;
      for (var mx = 0; mx < sw; mx++) {
        mask[rowOff + mx] = shapeFn((mx + 0.5) * invW, v, dist) | 0;
      }
    }

    /* pass 2: composite with an automatic rime on the outer edge */
    var L = fb.lum, E = fb.emb, D = fb.dep, W = fb.w, H = fb.h;
    var fog = S.Ray.fogMix(dist);
    var hazeMix = fog;
    var hash = M.hash2;
    var rimStrength = (opts.rim === undefined) ? 1 : opts.rim;

    for (var y = 0; y < sh; y++) {
      var py = y0 + y;
      if (py < 0 || py >= H) continue;
      var shear = sway ? Math.round(sway * (1 - y / sh)) : 0;
      var mrow = y * maskW;
      var frow = py * W;

      for (var x = 0; x < sw; x++) {
        var code = mask[mrow + x];
        if (!code) continue;
        var px = x0 + x + shear;
        if (px < 0 || px >= W) continue;
        var idx = frow + px;
        if (dist >= D[idx]) continue;

        if (alpha < 1) {
          /* fade by dithered dropout: never a blend, always a decision */
          if (hash(px * 3 + (y << 3), py * 5) > alpha) continue;
        }

        if (code === 1) {
          /* is this an outer edge pixel? then it is rimed. */
          var edge = 0;
          if (rimStrength > 0) {
            if (x === 0 || x === sw - 1 || y === 0 || y === sh - 1) edge = 1;
            else if (!mask[mrow + x - 1] || !mask[mrow + x + 1] ||
                     !mask[mrow - maskW + x] || !mask[mrow + maskW + x]) edge = 1;
          }
          if (edge) {
            var r = rimLum * rimStrength;
            L[idx] = hazeMix > 0 ? r + (S.Ray.HAZE - r) * hazeMix : r;
            E[idx] = 0;
          } else {
            var b = L[idx] * bodyLum;
            /* a body is never pure black: it is the darkest step plus grain */
            L[idx] = b < 0.012 ? 0.012 : b;
            E[idx] = 0;
          }
        } else if (code === 2) {
          var r2 = rimLum;
          L[idx] = hazeMix > 0 ? r2 + (S.Ray.HAZE - r2) * hazeMix : r2;
          E[idx] = 0;
        } else if (code === 3) {
          L[idx] = 0.72 * (1 - hazeMix * 0.7);
          E[idx] = ember * (1 - hazeMix);
        }
        D[idx] = dist;
      }
    }
    return true;
  };

  /* --- shared shape helpers, used by the entity shape functions --------- */
  Spr.H = {
    /* a tapered standing column: the base silhouette every figure starts from */
    figure: function (u, v, width, hunch) {
      var cx = 0.5 + hunch * Math.sin(v * 2.4) * 0.5;
      var w = width * (0.55 + 0.45 * Math.sin(v * 3.1 + 0.4));
      return Math.abs(u - cx) < w * 0.5;
    },
    /* the head: a slightly wider mass at the top of a figure */
    head: function (u, v, top, r) {
      var dy = (v - top) / r, dx = (u - 0.5) / (r * 0.62);
      return dx * dx + dy * dy < 1;
    },
    band: function (v, a, b) { return v >= a && v <= b; }
  };

  S.Spr = Spr;
})(SALT);
