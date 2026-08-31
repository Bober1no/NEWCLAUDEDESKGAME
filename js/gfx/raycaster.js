/* SALT LINE — the caster.
 *
 * A DDA raycaster writing luminance and depth into float planes. Chosen over
 * WebGL on purpose: the whole art direction is a per-pixel decision about how
 * light decays into grain, and that is easier to state honestly in a tight JS
 * loop than in a shader. It also means the DRY tier is genuinely the same
 * renderer at a coarser buffer rather than a second code path.
 *
 * Screen geometry, stated once so every pass agrees:
 *   plane   = perp(dir) * FOV                      (FOV is a tangent)
 *   projK   = w / (2 * FOV)
 *   screenY(z, d) = horizon - (z - eye) * projK / d
 *   depth from a floor row: d = eye * projK / (y - horizon)
 */
(function (S) {
  'use strict';

  var M = S.M, K = S.K, CELL = S.CELL, HEIGHT = S.HEIGHT, SOLID = S.SOLID;

  var R = {};

  /* ---- light rig ------------------------------------------------------- */
  /* Packed flat so the inner loops touch one contiguous array.
   * stride: x, y, z, power, radius, ember */
  var LIGHTS = new Float32Array(16 * 6);
  var NLIGHTS = 0;

  R.clearLights = function () { NLIGHTS = 0; };
  R.addLight = function (x, y, z, power, radius, ember) {
    if (NLIGHTS >= 16) return;
    var i = NLIGHTS * 6;
    LIGHTS[i] = x; LIGHTS[i + 1] = y; LIGHTS[i + 2] = z;
    LIGHTS[i + 3] = power; LIGHTS[i + 4] = radius; LIGHTS[i + 5] = ember || 0;
    NLIGHTS++;
  };
  R.lightCount = function () { return NLIGHTS; };

  /* Ambient. There is no moon over the flat; what little sky-light exists
   * comes off the sea haze and it is almost nothing. */
  var AMB = 0.023;
  var HAZE = 0.098;          /* what everything decays into at distance */
  var HAZE_START = 6.0;
  var HAZE_END = 34.0;

  /* scratch, so the shading helpers allocate nothing */
  var _lum = 0, _emb = 0;

  /* Accumulate light at a world point with an up-facing-ish normal factor.
   * facing: 1 for surfaces square to the light, lower for grazing. */
  function shade(wx, wy, wz, facing) {
    var l = AMB, e = 0;
    for (var i = 0, n = NLIGHTS * 6; i < n; i += 6) {
      var dx = LIGHTS[i] - wx, dy = LIGHTS[i + 1] - wy, dz = LIGHTS[i + 2] - wz;
      var d2 = dx * dx + dy * dy + dz * dz;
      var rad = LIGHTS[i + 4];
      if (d2 > rad * rad) continue;
      var d = Math.sqrt(d2);
      /* inverse-square with a soft knee, then a hard edge at the radius so a
       * light never contributes a value the dither cannot resolve anyway */
      /* Inverse-linear rather than inverse-square. A physically correct lamp
       * on an open flat lights three metres and nothing else, which makes a
       * doorframe at eight metres unreadable. The radius taper below does the
       * falloff work instead, and it does it where I want it. */
      var f = LIGHTS[i + 3] / (1 + d * 0.62 + d * d * 0.035);
      f *= 1 - (d / rad) * (d / rad);
      if (f <= 0) continue;
      f *= facing;
      l += f;
      /* The ember falls off as the square of the light, so warmth stays in
       * the first couple of metres while the light itself reaches ten. That
       * is the whole reason there is so little colour in this game. */
      if (LIGHTS[i + 5] > 0) e += f * f * LIGHTS[i + 5];
    }
    _lum = l;
    _emb = e > 1 ? 1 : e;
    return l;
  }

  function fogMix(d) {
    if (d <= HAZE_START) return 0;
    if (d >= HAZE_END) return 1;
    var t = (d - HAZE_START) / (HAZE_END - HAZE_START);
    return t * t;
  }

  /* ---- camera prep ------------------------------------------------------ */
  var cam = {
    x: 0, y: 0, ang: 0, eye: K.EYE,
    dx: 1, dy: 0, px: 0, py: 1,
    horizon: 0, projK: 1, pitch: 0, roll: 0
  };
  R.cam = cam;

  R.setCamera = function (fb, x, y, ang, eye, pitch, roll) {
    cam.x = x; cam.y = y; cam.ang = ang; cam.eye = eye;
    cam.dx = Math.cos(ang); cam.dy = Math.sin(ang);
    cam.px = -cam.dy * K.FOV; cam.py = cam.dx * K.FOV;
    cam.projK = fb.w / (2 * K.FOV);
    cam.pitch = pitch || 0;
    cam.roll = roll || 0;
    cam.horizon = (fb.h * 0.5) + cam.pitch;

    var w = fb.w;
    for (var i = 0; i < w; i++) {
      var cx = 2 * i / w - 1;
      fb.camX[i] = cx;
      fb.rayDX[i] = cam.dx + cam.px * cx;
      fb.rayDY[i] = cam.dy + cam.py * cx;
    }
  };

  /* ---- sky -------------------------------------------------------------- */
  /* A night with no moon and a low sea-haze band on the horizon. Stars are
   * single pixels placed by hash in (azimuth, elevation) so they hold still
   * in the world while you turn. */
  R.sky = function (fb, tier, time) {
    var w = fb.w, h = fb.h, L = fb.lum, D = fb.dep;
    var hz = cam.horizon;
    var top = 0, bot = Math.min(h, Math.ceil(hz));
    if (bot <= 0) return;

    var starDensity = tier.starCount / 26000;
    var projK = cam.projK;
    var hash2 = M.hash2;

    /* one cloud sample every 8 px, lerped across */
    var cloudRow = R._cloudRow;
    if (!cloudRow || cloudRow.length < ((w >> 3) + 2)) {
      cloudRow = R._cloudRow = new Float32Array((w >> 3) + 2);
    }

    for (var y = top; y < bot; y++) {
      var elev = (hz - y) / projK;                 /* small-angle elevation */
      /* deep at zenith, a cold haze bar just above the flat. the bar is what
       * every vertical thing on the line gets silhouetted against, so it is
       * doing more work than it looks like it is. */
      var g = 0.055 - elev * 0.052;
      if (g < 0.006) g = 0.006;
      var band = 1 - M.sat(elev * 5.0);
      g += band * band * band * 0.115;

      var cw = (w >> 3) + 2;
      for (var ci = 0; ci < cw; ci++) {
        var az = cam.ang + Math.atan2(fb.camX[Math.min(w - 1, ci * 8)] * K.FOV, 1);
        cloudRow[ci] = M.fbm(az * 2.4 + time * 0.006, elev * 7 + 4.0, 2);
      }

      var row = y * w;
      for (var x = 0; x < w; x++) {
        var c0 = cloudRow[x >> 3], c1 = cloudRow[(x >> 3) + 1];
        var ct = (x & 7) / 8;
        var cloud = c0 + (c1 - c0) * ct;

        var v = g * (0.62 + cloud * 0.78);

        /* stars: fixed by hashing quantised sky coordinates */
        if (elev > 0.02) {
          var sx = (cam.ang + fb.camX[x] * K.FOV) * 210;
          var sy = elev * 210;
          var hv = hash2(sx | 0, sy | 0);
          if (hv > 1 - starDensity) {
            var mag = (hv - (1 - starDensity)) / starDensity;
            /* slow scintillation */
            var tw = 0.65 + 0.35 * Math.sin(time * 1.7 + hv * 90);
            v += (0.18 + mag * 0.62) * tw * M.sat(elev * 9);
          }
        }

        L[row + x] = v;
        D[row + x] = 1e9;
      }
    }
  };

  /* ---- floor / brine ----------------------------------------------------- */
  R.floor = function (fb, world, tier, time) {
    var w = fb.w, h = fb.h, L = fb.lum, E = fb.emb, D = fb.dep, WET = fb.wet;
    var hz = cam.horizon;
    var y0 = Math.max(0, Math.floor(hz) + 1);
    var step = tier.floorStep;
    var Tex = S.Tex;
    var crust = Tex.crust, brine = Tex.brine, tsize = Tex.size, tmask = tsize - 1;
    var cd = crust.d, bd = brine.d, gritD = Tex.grit.d;
    var gw = world.gw, gh = world.gh, grid = world.grid;
    var eye = cam.eye, projK = cam.projK;

    var rdx0 = fb.rayDX[0], rdy0 = fb.rayDY[0];
    var rdx1 = fb.rayDX[w - 1], rdy1 = fb.rayDY[w - 1];

    var wave = time * 0.55;
    var wave2 = time * 0.31;

    for (var y = y0; y < h; y++) {
      var dy = y - hz;
      if (dy < 0.5) dy = 0.5;
      var dist = eye * projK / dy;

      var row = y * w;

      if (dist > K.VIEW) {
        /* past the cutoff there is nothing to solve: pure haze, and the
         * dither turns it into the grain that the far flat actually is */
        for (var fx = 0; fx < w; fx++) { L[row + fx] = HAZE * 0.72; D[row + fx] = dist; }
        continue;
      }

      var fogT = fogMix(dist);
      var stepX = (rdx1 - rdx0) * dist / w;
      var stepY = (rdy1 - rdy0) * dist / w;
      var wx = cam.x + rdx0 * dist;
      var wy = cam.y + rdy0 * dist;

      var prevL = 0, prevE = 0;

      for (var x = 0; x < w; x += step) {
        /* The cell lookup is jittered by a noise field before it is quantised,
         * so the edge between dry crust and standing brine is ragged instead
         * of following the grid. Straight axis-aligned boundaries on the floor
         * are the single loudest tell that a world is made of cells, and one
         * texture read per pixel buys them all away. */
        var jx = gritD[(((wy * 9) | 0) & 63) * 64 + (((wx * 9) | 0) & 63)] - 0.5;
        var jy = gritD[(((wx * 11) | 0) & 63) * 64 + (((wy * 11) | 0) & 63)] - 0.5;
        var cx = (wx + jx * 0.62) | 0, cy = (wy + jy * 0.62) | 0;
        var cell = CELL.CRUST;
        if (cx >= 0 && cy >= 0 && cx < gw && cy < gh) cell = grid[cy * gw + cx];

        var alb, facing = 1, spec = 0, wet = 0;

        if (cell === CELL.BRINE || cell === CELL.DEEP) {
          wet = (cell === CELL.DEEP) ? 2 : 1;
          /* standing brine. it is a black mirror with a wind chop on it. */
          var tx = ((wx * tsize * 0.22 + wave * 3) | 0) & tmask;
          var ty = ((wy * tsize * 0.22 + wave2 * 2) | 0) & tmask;
          var swell = bd[ty * tsize + tx];
          var tx2 = ((wx * tsize * 0.61 - wave * 5) | 0) & tmask;
          var ty2 = ((wy * tsize * 0.61 + wave * 3) | 0) & tmask;
          swell = swell * 0.6 + bd[ty2 * tsize + tx2] * 0.4;

          alb = (cell === CELL.DEEP ? 0.05 : 0.13) + swell * 0.10;
          /* grazing angle: water seen far away is brighter, water at your
           * feet is a hole. this is what makes the pans read as wet. */
          facing = 0.30 + 0.70 * M.sat(dist * 0.10);
          /* a specular smear from the lamp along the view axis */
          var lampD = M.dist(wx, wy, cam.x, cam.y);
          spec = Math.exp(-lampD * 0.55) * (0.22 + swell * 0.55);
        } else {
          var ux = ((wx * tsize * 0.30) | 0) & tmask;
          var uy = ((wy * tsize * 0.30) | 0) & tmask;
          alb = 0.30 + cd[uy * tsize + ux] * 0.44;
          if (cell === CELL.PILE) alb += 0.10;
          facing = 1;
        }

        shade(wx, wy, 0, facing);
        var lum = _lum * alb + spec * _lum * 0.9;
        var emb = _emb * (0.6 + alb);

        if (fogT > 0) {
          lum = lum + (HAZE - lum) * fogT;
          emb *= (1 - fogT);
        }

        L[row + x] = lum;
        E[row + x] = emb;
        D[row + x] = dist;
        WET[row + x] = wet;

        if (step > 1) {
          /* DRY solves every other pixel and smears; at 320x180 with heavy
           * dither on top it reads as a coarser grain, not as a gap */
          for (var k = 1; k < step && x + k < w; k++) {
            L[row + x + k] = lum;
            E[row + x + k] = emb;
            D[row + x + k] = dist;
            WET[row + x + k] = wet;
          }
        }
        prevL = lum; prevE = emb;

        wx += stepX * step;
        wy += stepY * step;
      }
    }
  };

  /* ---- walls ------------------------------------------------------------- */
  R.walls = function (fb, world, tier, time) {
    var w = fb.w, h = fb.h, L = fb.lum, E = fb.emb, D = fb.dep;
    var gw = world.gw, gh = world.gh, grid = world.grid;
    var Tex = S.Tex, tsize = Tex.size, tmask = tsize - 1;
    var wallT = Tex.wall.d, pileT = Tex.pile.d;
    var hz = cam.horizon, projK = cam.projK, eye = cam.eye;

    for (var x = 0; x < w; x++) {
      var rdx = fb.rayDX[x], rdy = fb.rayDY[x];
      var mapX = cam.x | 0, mapY = cam.y | 0;

      var ddx = rdx === 0 ? 1e30 : Math.abs(1 / rdx);
      var ddy = rdy === 0 ? 1e30 : Math.abs(1 / rdy);
      var stepX, stepY, sideX, sideY;

      if (rdx < 0) { stepX = -1; sideX = (cam.x - mapX) * ddx; }
      else { stepX = 1; sideX = (mapX + 1 - cam.x) * ddx; }
      if (rdy < 0) { stepY = -1; sideY = (cam.y - mapY) * ddy; }
      else { stepY = 1; sideY = (mapY + 1 - cam.y) * ddy; }

      var side = 0, dist = 0, cell = 0, guard = 0;
      var hit = false;

      /* Walk until we hit something solid or run out of view. Low walls do
       * not stop the walk conceptually, but they do occlude what is directly
       * behind them at their own height, so we take the nearest hit and
       * accept that a dike never hides a stack behind it. On a salt flat that
       * is exactly right: the dikes are knee high. */
      while (guard++ < 220) {
        if (sideX < sideY) { sideX += ddx; mapX += stepX; side = 0; }
        else { sideY += ddy; mapY += stepY; side = 1; }

        dist = side === 0 ? (sideX - ddx) : (sideY - ddy);
        if (dist > K.VIEW) break;

        if (mapX < 0 || mapY < 0 || mapX >= gw || mapY >= gh) continue;
        cell = grid[mapY * gw + mapX];
        if (SOLID[cell]) { hit = true; break; }
      }

      if (!hit || dist < 0.02) continue;

      var wallH = HEIGHT[cell];
      var wallX;
      if (side === 0) wallX = cam.y + dist * rdy;
      else wallX = cam.x + dist * rdx;
      wallX -= Math.floor(wallX);

      var yTop = hz - (wallH - eye) * projK / dist;
      var yBot = hz + eye * projK / dist;
      var i0 = Math.max(0, Math.ceil(yTop));
      var i1 = Math.min(h - 1, Math.floor(yBot));
      if (i1 < i0) continue;

      /* surface normal faces the ray's opposite axis */
      var nfx = side === 0 ? -stepX : 0;
      var nfy = side === 1 ? -stepY : 0;

      var fogT = fogMix(dist);
      var tex = (cell === CELL.PILE) ? pileT : wallT;
      var texU = ((wallX * tsize) | 0) & tmask;
      var span = yBot - yTop;
      var invSpan = span > 0 ? (wallH / span) : 0;

      /* the world x/y of this column's wall face, constant down the span */
      var fwx = cam.x + rdx * dist;
      var fwy = cam.y + rdy * dist;

      for (var y = i0; y <= i1; y++) {
        var wz = (yBot - y) * invSpan;
        if (wz < 0) wz = 0; else if (wz > wallH) wz = wallH;

        var texV = ((wz * tsize * 0.55) | 0) & tmask;
        var alb = tex[texV * tsize + texU];

        /* facing term: light arriving square to the face reads brighter.
         * cheap dot against the direction to the strongest light. */
        var lx = LIGHTS[0] - fwx, ly = LIGHTS[1] - fwy;
        var ll = Math.sqrt(lx * lx + ly * ly) || 1;
        var facing = 0.34 + 0.66 * Math.abs((lx / ll) * nfx + (ly / ll) * nfy);

        shade(fwx, fwy, wz, facing);
        var lum = _lum * (0.22 + alb * 0.80);
        var emb = _emb * (0.4 + alb * 0.6);

        /* the top course of a wall catches sky, which reads as a rim */
        if (wallH - wz < 0.06) lum += 0.045;

        if (fogT > 0) { lum = lum + (HAZE - lum) * fogT; emb *= (1 - fogT); }

        var idx = y * w + x;
        if (dist < D[idx]) {
          L[idx] = lum;
          E[idx] = emb;
          D[idx] = dist;
        }
      }
    }
  };

  /* ---- generic world-space slab ------------------------------------------
   * A vertical quad between two ground points, spanning h0..h1. Every
   * doorframe post, lintel and swinging panel in the game is one of these,
   * which is why the door swing has real perspective instead of being a
   * sprite that scales.
   *
   * shade fn signature: (t, z, dist, out) where out is a 3-slot array
   * [albedo, ember, emissive]. Returning a negative albedo means "transparent
   * here", which is how a doorframe gets its opening and how a wave gets its
   * crest line. The emissive slot bypasses the lighting entirely: it is for
   * things that are bright because of what they are, not what is shining on
   * them -- churned brine, essentially, and nothing else.
   */
  var _slabOut = [0, 0, 0];

  R.slab = function (fb, ax, ay, bx, by, h0, h1, shadeFn, opaqueAlb) {
    var w = fb.w, h = fb.h, L = fb.lum, E = fb.emb, D = fb.dep;
    var hz = cam.horizon, projK = cam.projK, eye = cam.eye;

    /* into camera space */
    var det = cam.dx * cam.py - cam.px * cam.dy;
    if (det === 0) return;
    var rax = ax - cam.x, ray = ay - cam.y;
    var rbx = bx - cam.x, rby = by - cam.y;

    var da = (cam.py * rax - cam.px * ray) / det;
    var sa = (-cam.dy * rax + cam.dx * ray) / det;
    var db = (cam.py * rbx - cam.px * rby) / det;
    var sb = (-cam.dy * rbx + cam.dx * rby) / det;

    var ta = 0, tb = 1;
    var NEAR = 0.06;
    if (da < NEAR && db < NEAR) return;
    if (da < NEAR) {
      var t = (NEAR - da) / (db - da);
      sa = sa + (sb - sa) * t; da = NEAR; ta = t;
    } else if (db < NEAR) {
      var t2 = (NEAR - db) / (da - db);
      sb = sb + (sa - sb) * t2; db = NEAR; tb = 1 - t2;
    }

    var xa = (sa / da + 1) * w * 0.5;
    var xb = (sb / db + 1) * w * 0.5;
    if (xa === xb) return;
    var flip = false;
    if (xa > xb) {
      var tmp = xa; xa = xb; xb = tmp;
      tmp = da; da = db; db = tmp;
      tmp = ta; ta = tb; tb = tmp;
      flip = true;
    }

    var ix0 = Math.max(0, Math.ceil(xa));
    var ix1 = Math.min(w - 1, Math.floor(xb));
    if (ix1 < ix0) return;

    var invA = 1 / da, invB = 1 / db;
    var invW = 1 / (xb - xa);

    for (var x = ix0; x <= ix1; x++) {
      var u = (x - xa) * invW;
      var inv = invA + (invB - invA) * u;
      var dist = 1 / inv;
      if (dist > K.VIEW) continue;
      var tt = (ta * invA * (1 - u) + tb * invB * u) / inv;

      var yTop = hz - (h1 - eye) * projK / dist;
      var yBot = hz - (h0 - eye) * projK / dist;
      var i0 = Math.max(0, Math.ceil(yTop));
      var i1 = Math.min(h - 1, Math.floor(yBot));
      if (i1 < i0) continue;

      var spanInv = (h1 - h0) / (yBot - yTop);
      var fogT = fogMix(dist);
      var wx = cam.x + (cam.dx + cam.px * (2 * x / w - 1)) * dist;
      var wy = cam.y + (cam.dy + cam.py * (2 * x / w - 1)) * dist;

      for (var y = i0; y <= i1; y++) {
        var idx = y * w + x;
        if (dist >= D[idx]) continue;
        var z = h1 - (y - yTop) * spanInv;

        _slabOut[2] = 0;
        shadeFn(tt, z, dist, _slabOut);
        var alb = _slabOut[0];
        if (alb < 0) continue;                       /* transparent */

        shade(wx, wy, z, 0.82);
        var lum = _lum * alb + _slabOut[2];
        var emb = Math.max(_emb * 0.6, _slabOut[1]);
        if (fogT > 0) { lum = lum + (HAZE - lum) * fogT; emb *= (1 - fogT); }

        L[idx] = lum;
        E[idx] = emb;
        D[idx] = dist;
      }
    }
  };

  /* depth-tested world point -> screen, used by sprites and markers */
  R.project = function (fb, wx, wy, wz, out) {
    var det = cam.dx * cam.py - cam.px * cam.dy;
    var rx = wx - cam.x, ry = wy - cam.y;
    var d = (cam.py * rx - cam.px * ry) / det;
    var s = (-cam.dy * rx + cam.dx * ry) / det;
    out[0] = (s / d + 1) * fb.w * 0.5;
    out[1] = cam.horizon - (wz - cam.eye) * cam.projK / d;
    out[2] = d;
    return d > 0.05;
  };

  R.shadeAt = shade;
  R.fogMix = fogMix;
  R.HAZE = HAZE;
  R.AMB = AMB;
  R.lumOut = function () { return _lum; };
  R.embOut = function () { return _emb; };

  S.Ray = R;
})(SALT);
