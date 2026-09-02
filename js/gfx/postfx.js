/* SALT LINE — the post chain, and the only place a colour is decided.
 *
 * The stack, in order:
 *   vignette   (multiply, precomputed per tier)
 *   motion blur (DROWNED, temporal accumulation)
 *   bloom       (threshold -> separable blur -> add)
 *   resolve     (shake + shimmer + chromatic split + grain + ordered dither
 *                + palette quantise + scanline)
 *
 * The resolve is one pass on purpose. Doing the chromatic split by sampling
 * the luminance plane at three different offsets and dithering each channel
 * independently, rather than by shifting a finished RGB image, is what makes
 * it look like a misregistered print instead of a video filter -- and it is
 * the only way to get it without leaving the palette.
 */
(function (S) {
  'use strict';

  var M = S.M, Pal = S.Pal;

  var PX = {
    shakeX: 0, shakeY: 0, shakeMag: 0, shakeT: 0,
    pressure: 0,           /* 0..1 -- tightens the vignette. fear, not damage. */
    flash: 0,              /* 0..1 -- one-frame whiteout on a toll being paid  */
    invert: 0              /* 0..1 -- the Understudy taking you                */
  };

  /* The tone curve, as a lookup.
   *
   * The raycaster works in linear light, and linear light quantised to six
   * steps throws away everything below the first step -- which on a salt flat
   * at night is most of the frame. This curve lifts the shadows hard and
   * rolls off above 1.0, so darkness stays full of information instead of
   * collapsing to a black rectangle. It is the single most load-bearing
   * decision in the whole renderer.
   */
  var TONE_MAX_IN = 2.6;
  var TONE_N = 2048;
  var TONE_SCALE = TONE_N / TONE_MAX_IN;
  var TONE = new Float32Array(TONE_N + 1);
  (function () {
    for (var i = 0; i <= TONE_N; i++) {
      var x = i / TONE_SCALE;
      var y;
      if (x <= 1) y = Math.pow(x, 0.77);
      else y = 1 + (1 - Math.exp(-(x - 1) * 0.9)) * 0.34;   /* soft shoulder */
      TONE[i] = y * (Pal.N - 1);
    }
  })();

  function tone(v) {
    var i = (v * TONE_SCALE) | 0;
    if (i < 0) return 0;
    if (i > TONE_N) return TONE[TONE_N];
    return TONE[i];
  }
  PX.tone = tone;

  /* the ember carries its own short ramp so that a hot lamp core is not just
   * "orange", it has a value structure of its own */
  var ER = [0x3a, 0x7d, 0xb4, 0xe8, 0xf7];
  var EG = [0x18, 0x2d, 0x46, 0x93, 0xdc];
  var EB = [0x10, 0x1b, 0x2a, 0x4a, 0xb2];
  var EN = 5, ESTEP = EN - 1;

  PX.buildVignette = function (fb, tier) {
    var w = fb.w, h = fb.h;
    var v = new Float32Array(w * h);
    var cx = w * 0.5, cy = h * 0.5;
    var maxR = Math.sqrt(cx * cx + cy * cy);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var dx = (x - cx) / maxR, dy = (y - cy) / maxR;
        var r = Math.sqrt(dx * dx + dy * dy);
        /* a soft round falloff plus a harder corner cut -- the frame should
         * feel like a lamp's reach, not like a filter */
        var f = 1 - M.smoothstep(0.30, 1.02, r) * 0.94;
        f *= 1 - M.smoothstep(0.66, 1.24, r) * 0.66;
        v[y * w + x] = f;
      }
    }
    fb.vig = v;
    /* radial magnitude, reused by the chromatic split */
    var rad = new Float32Array(w * h);
    for (var yy = 0; yy < h; yy++)
      for (var xx = 0; xx < w; xx++) {
        var ax = (xx - cx) / maxR, ay = (yy - cy) / maxR;
        rad[yy * w + xx] = Math.sqrt(ax * ax + ay * ay);
      }
    fb.rad = rad;
  };

  PX.kick = function (mag) {
    PX.shakeMag = Math.max(PX.shakeMag, mag);
  };

  PX.update = function (dt) {
    PX.shakeT += dt;
    PX.shakeMag *= Math.exp(-dt * 7.0);
    if (PX.shakeMag < 0.01) PX.shakeMag = 0;
    var t = PX.shakeT;
    PX.shakeX = Math.sin(t * 61.3) * PX.shakeMag + Math.sin(t * 23.7) * PX.shakeMag * 0.5;
    PX.shakeY = Math.cos(t * 47.1) * PX.shakeMag * 0.8 + Math.sin(t * 91.2) * PX.shakeMag * 0.3;
    PX.flash *= Math.exp(-dt * 9.0);
    if (PX.flash < 0.004) PX.flash = 0;
    /* the negative is the moment of being taken, not a state you sit in */
    if (PX.invert > 0) {
      PX.invert -= dt * 0.55;
      if (PX.invert < 0) PX.invert = 0;
    }
  };

  /* ---- vignette ---------------------------------------------------------- */
  PX.vignette = function (fb) {
    var L = fb.lum, v = fb.vig, n = fb.n;
    if (!v) return;
    var extra = PX.pressure;
    if (extra <= 0.001) {
      for (var i = 0; i < n; i++) L[i] *= v[i];
    } else {
      for (var j = 0; j < n; j++) {
        var f = v[j];
        L[j] *= f * (1 - extra) + f * f * f * extra;
      }
    }
  };

  /* ---- motion blur ------------------------------------------------------- */
  PX.motionBlur = function (fb, k) {
    if (k <= 0) return;
    var L = fb.lum, E = fb.emb, P = fb.prev, PE = fb.prevE, n = fb.n;
    var inv = 1 - k;
    for (var i = 0; i < n; i++) {
      var l = L[i] * inv + P[i] * k;
      L[i] = l; P[i] = l;
      var e = E[i] * inv + PE[i] * k;
      E[i] = e; PE[i] = e;
    }
  };

  /* ---- bloom ------------------------------------------------------------- */
  PX.bloom = function (fb, tier) {
    if (!tier.bloom) return;
    var w = fb.w, h = fb.h, bw = fb.bw, bh = fb.bh;
    var L = fb.lum, E = fb.emb, A = fb.bloomA, B = fb.bloomB;
    var thresh = 0.60;

    /* downsample + threshold. the ember is always bloomed, whatever its
     * luminance, because it is the only warm thing on the flat and it should
     * behave like a coal rather than like a bright grey. */
    for (var y = 0; y < bh; y++) {
      var s0 = (y * 2) * w, s1 = (y * 2 + 1) * w;
      var d = y * bw;
      for (var x = 0; x < bw; x++) {
        var i0 = s0 + x * 2, i1 = s1 + x * 2;
        var l = (L[i0] + L[i0 + 1] + L[i1] + L[i1 + 1]) * 0.25;
        var e = (E[i0] + E[i0 + 1] + E[i1] + E[i1 + 1]) * 0.25;
        var v = l - thresh;
        if (v < 0) v = 0;
        A[d + x] = v + e * 0.75;
      }
    }

    var passes = tier.bloom;
    for (var p = 0; p < passes; p++) {
      var rad = p === 0 ? 1 : 3;
      blurH(A, B, bw, bh, rad);
      blurV(B, A, bw, bh, rad);
    }

    /* add back, bilinear */
    var strength = passes >= 2 ? 0.95 : 0.62;
    for (var yy = 0; yy < h; yy++) {
      var fy = yy * 0.5 - 0.25;
      var iy = fy | 0; if (iy < 0) iy = 0; if (iy > bh - 2) iy = bh - 2;
      var ty = fy - iy; if (ty < 0) ty = 0; if (ty > 1) ty = 1;
      var r0 = iy * bw, r1 = (iy + 1) * bw, row = yy * w;
      for (var xx = 0; xx < w; xx++) {
        var fx = xx * 0.5 - 0.25;
        var ix = fx | 0; if (ix < 0) ix = 0; if (ix > bw - 2) ix = bw - 2;
        var tx = fx - ix; if (tx < 0) tx = 0; if (tx > 1) tx = 1;
        var a = A[r0 + ix] + (A[r0 + ix + 1] - A[r0 + ix]) * tx;
        var b = A[r1 + ix] + (A[r1 + ix + 1] - A[r1 + ix]) * tx;
        L[row + xx] += (a + (b - a) * ty) * strength;
      }
    }
  };

  function blurH(src, dst, w, h, r) {
    for (var y = 0; y < h; y++) {
      var off = y * w;
      for (var x = 0; x < w; x++) {
        var s = 0, n = 0;
        for (var k = -r; k <= r; k++) {
          var xx = x + k;
          if (xx < 0 || xx >= w) continue;
          var wgt = r + 1 - Math.abs(k);
          s += src[off + xx] * wgt; n += wgt;
        }
        dst[off + x] = s / n;
      }
    }
  }
  function blurV(src, dst, w, h, r) {
    for (var x = 0; x < w; x++) {
      for (var y = 0; y < h; y++) {
        var s = 0, n = 0;
        for (var k = -r; k <= r; k++) {
          var yy = y + k;
          if (yy < 0 || yy >= h) continue;
          var wgt = r + 1 - Math.abs(k);
          s += src[yy * w + x] * wgt; n += wgt;
        }
        dst[y * w + x] = s / n;
      }
    }
  }

  /* ---- resolve ----------------------------------------------------------- */
  PX.resolve = function (fb, tier, time) {
    var w = fb.w, h = fb.h;
    var L = fb.lum, E = fb.emb, OUT = fb.out, RAD = fb.rad, DEP = fb.dep;
    var order = tier.bayer;
    var mat = Pal.matrixFor(order);
    var mask = order - 1;
    var R = Pal.R, G = Pal.G, B = Pal.B, N = Pal.N, STEPS = Pal.STEPS;
    var grain = tier.grain;
    var scan = tier.scanline;
    var chroma = tier.chroma;
    var shimmer = tier.shimmer;
    var hash = M.hash2;

    var sxi = Math.round(PX.shakeX);
    var syi = Math.round(PX.shakeY);
    var flash = PX.flash;
    var inv = PX.invert;

    var noise = Pal.noiseField, nsz = Pal.NOISE_SIZE, nmask = nsz - 1;
    var animate = tier.bayerAnim;
    var nOffX = animate ? ((time * 37) | 0) : 0;
    var nOffY = animate ? ((time * 23) | 0) : 0;
    var gseed = (time * 60) | 0;

    var hz = S.Ray.cam.horizon;

    for (var y = 0; y < h; y++) {
      var sy = y + syi;
      if (sy < 0) sy = 0; else if (sy >= h) sy = h - 1;
      var srow = sy * w;
      var orow = y * w;

      /* heat/brine shimmer: a horizontal refraction that only exists near
       * the horizon, where the flat is still giving up its water */
      var shim = 0;
      if (shimmer) {
        var dh = Math.abs(y - hz);
        if (dh < h * 0.30) {
          var fall = 1 - dh / (h * 0.30);
          shim = Math.sin(y * 0.31 + time * 2.1) * 2.4 * fall * fall
               + Math.sin(y * 0.07 - time * 1.1) * 1.5 * fall;
        }
      }
      var shimI = shim | 0;

      var mrow = (y & mask) * order;

      for (var x = 0; x < w; x++) {
        var bx = x + sxi + shimI;
        if (bx < 0) bx = 0; else if (bx >= w) bx = w - 1;
        var base = srow + bx;

        var d = mat[mrow + (x & mask)];
        if (animate) {
          d = d * 0.62 + noise[(((y + nOffY) & nmask) * nsz) + ((x + nOffX) & nmask)] * 0.55;
        }
        if (grain > 0) {
          d += (hash(x * 3 + gseed, y * 7 - gseed) - 0.5) * grain * STEPS;
        }

        var lg = L[base];
        var lr = lg, lb = lg;

        /* The split is gated on luminance and weighted to the corners: a
         * misregistered print misregisters where there is ink. Letting it
         * run in the dark just makes coloured dither noise. */
        if (chroma > 0 && lg > 0.13 && DEP[base] < 1e8) {
          var rr = RAD[orow + x];
          var ox = (rr * rr * chroma * 1.6) | 0;
          if (ox > 0) {
            var xr = bx + ox; if (xr >= w) xr = w - 1;
            var xb = bx - ox; if (xb < 0) xb = 0;
            lr = L[srow + xr];
            lb = L[srow + xb];
          }
        }

        if (flash > 0) { lr += flash; lg += flash; lb += flash; }

        var e = E[base];
        var er, eg, eb;

        /* The ember is stippled in, not switched on: the fraction of pixels
         * that turn warm rises with the ember amount, so a lamp core reads as
         * a halftone of orange dots thinning out into grey rather than as an
         * orange circle with an edge. It is also why there is so little of it. */
        if (e > 0.06 && (e * 1.62 + d) > 0.72) {
          /* ember pixel: same dithering, its own ramp */
          var ei = ((tone(lg) / STEPS * 1.15) * ESTEP + d + 0.5) | 0;
          if (ei < 0) ei = 0; else if (ei >= EN) ei = EN - 1;
          er = ER[ei]; eg = EG[ei]; eb = EB[ei];
        } else {
          var ir = (tone(lr) + d + 0.5) | 0;
          var ig = (tone(lg) + d + 0.5) | 0;
          var ib = (tone(lb) + d + 0.5) | 0;
          if (ir < 0) ir = 0; else if (ir >= N) ir = N - 1;
          if (ig < 0) ig = 0; else if (ig >= N) ig = N - 1;
          if (ib < 0) ib = 0; else if (ib >= N) ib = N - 1;
          er = R[ir]; eg = G[ig]; eb = B[ib];
        }

        if (scan > 0 && (y & 1)) {
          var s = 1 - scan;
          er = (er * s) | 0; eg = (eg * s) | 0; eb = (eb * s) | 0;
        }

        if (inv > 0) {
          er = (er + (255 - er - er) * inv) | 0;
          eg = (eg + (255 - eg - eg) * inv) | 0;
          eb = (eb + (255 - eb - eb) * inv) | 0;
          if (er < 0) er = 0; if (eg < 0) eg = 0; if (eb < 0) eb = 0;
        }

        OUT[orow + x] = 0xff000000 | (eb << 16) | (eg << 8) | er;
      }
    }
  };

  S.PostFX = PX;
})(SALT);
