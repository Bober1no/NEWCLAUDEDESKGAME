/* SALT LINE — the haze in the lamp cone, and what floats in it.
 *
 * Only WET and DROWNED run this. It is a real 3D raymarch at quarter
 * resolution, shadowed against the terrain grid, so the salt stacks and the
 * dike gaps throw actual shafts rather than a screen-space fake. On DROWNED
 * the entities near you become occluders too, which is the single most
 * expensive thing in the game and also the most worth it: a figure standing
 * between you and your own lamp puts a shadow down the flat.
 */
(function (S) {
  'use strict';

  var M = S.M, K = S.K, SOLID = S.SOLID, HEIGHT = S.HEIGHT;

  var V = {
    buf: null, bw: 0, bh: 0,
    motes: null, moteN: 0,
    occX: new Float32Array(4), occY: new Float32Array(4),
    occR: new Float32Array(4), occH: new Float32Array(4), occN: 0,
    enabled: false
  };

  /* exp() and a 3D noise call per march sample were costing more than every
   * other pass in the renderer put together. Both are now table lookups:
   * a 96-entry height falloff, and one read out of the brine field. */
  var EXP_N = 96, EXP_MAX = 3.2;
  var EXP_LUT = new Float32Array(EXP_N);
  (function () {
    for (var i = 0; i < EXP_N; i++) EXP_LUT[i] = Math.exp(-(i / EXP_N) * EXP_MAX * 1.55);
  })();

  V.init = function (fb, tier) {
    V.enabled = tier.volumetric > 0;
    /* WET marches the haze at quarter resolution and lets the bilinear
     * upsample soften it; DROWNED marches at half and resolves the shafts
     * properly. It is the single biggest cost difference between the tiers. */
    V.shift = tier.volShift || 2;
    V.step = 1 << V.shift;
    V.bw = fb.w >> V.shift;
    V.bh = fb.h >> V.shift;
    V.buf = new Float32Array(V.bw * V.bh);

    V.moteN = tier.motes;
    V.motes = new Float32Array(Math.max(1, V.moteN) * 7);   /* x y z vx vy vz phase */
    var r = M.rng(0x33da);
    for (var i = 0; i < V.moteN; i++) {
      var o = i * 7;
      V.motes[o] = r.range(-9, 9);
      V.motes[o + 1] = r.range(-9, 9);
      V.motes[o + 2] = r.range(0.02, 2.4);
      V.motes[o + 3] = r.range(-0.10, 0.10);
      V.motes[o + 4] = r.range(-0.10, 0.10);
      V.motes[o + 5] = r.range(-0.05, 0.02);
      V.motes[o + 6] = r.range(0, 6.28);
    }
  };

  V.clearOccluders = function () { V.occN = 0; };
  V.addOccluder = function (x, y, r, h) {
    if (V.occN >= 4) return;
    V.occX[V.occN] = x; V.occY[V.occN] = y;
    V.occR[V.occN] = r; V.occH[V.occN] = h;
    V.occN++;
  };

  /* ---- the march --------------------------------------------------------- */
  V.march = function (fb, world, tier, lampX, lampY, lampZ, lampPower, time) {
    if (!V.enabled || lampPower <= 0.001) { if (V.buf) V.buf.fill(0); return; }

    var R = S.Ray, cam = R.cam;
    var bw = V.bw, bh = V.bh, buf = V.buf;
    var w = fb.w, h = fb.h, D = fb.dep;
    var grid = world.grid, gw = world.gw, gh = world.gh;
    var steps = tier.volumetric;
    var REACH = 9.5;
    var useOcc = (tier.volumetric >= 20) && V.occN > 0;

    var projK = cam.projK, hz = cam.horizon, eye = cam.eye;
    var invSteps = 1 / steps;
    var hash = M.hash2;
    var frameJitter = (time * 61) & 63;

    var Tex = S.Tex, hazeTex = Tex.brine.d, ns = Tex.size, nm = ns - 1;
    var nDrift = (time * 3.1) | 0;
    var expScale = EXP_N / EXP_MAX;

    var sstep = V.step;
    for (var by = 0; by < bh; by++) {
      var sy = by * sstep;
      /* elevation of this row's ray, small-angle */
      var elev = (hz - sy) / projK;
      var rowOff = by * bw;
      var frow = sy * w;

      for (var bx = 0; bx < bw; bx++) {
        var sx = bx * sstep;
        var rdx = fb.rayDX[sx], rdy = fb.rayDY[sx];
        var len = Math.sqrt(rdx * rdx + rdy * rdy + elev * elev);
        var nx = rdx / len, ny = rdy / len, nz = elev / len;

        var far = D[frow + sx];
        if (far > REACH) far = REACH;
        if (far < 0.25) { buf[rowOff + bx] = 0; continue; }

        /* dithered start offset kills the banding a fixed step would give */
        var jit = hash(sx + frameJitter, sy) * far * invSteps;
        var dt = far * invSteps;
        var t = 0.18 + jit;
        var acc = 0;

        for (var s = 0; s < steps; s++, t += dt) {
          if (t > far) break;
          var px = cam.x + nx * t;
          var py = cam.y + ny * t;
          var pz = eye + nz * t;
          if (pz < 0) break;

          var cxi = px | 0, cyi = py | 0;
          if (cxi >= 0 && cyi >= 0 && cxi < gw && cyi < gh) {
            var c = grid[cyi * gw + cxi];
            if (SOLID[c] && pz < HEIGHT[c]) break;
          }

          if (useOcc) {
            var blocked = false;
            for (var oi = 0; oi < V.occN; oi++) {
              if (pz > V.occH[oi]) continue;
              var ox = px - V.occX[oi], oy = py - V.occY[oi];
              if (ox * ox + oy * oy < V.occR[oi] * V.occR[oi]) { blocked = true; break; }
            }
            if (blocked) break;
          }

          var lx = px - lampX, ly = py - lampY, lz = pz - lampZ;
          var d2 = lx * lx + ly * ly + lz * lz;
          if (d2 > REACH * REACH) continue;

          /* the haze is thickest low over the pans, where the brine is
           * evaporating. that is why the shafts sit in the bottom of frame. */
          var ei = (pz * expScale) | 0;
          var dens = 0.22 + 0.78 * (ei < EXP_N ? (ei < 0 ? 1 : EXP_LUT[ei]) : 0);
          dens *= 0.70 + 0.30 * hazeTex[((((py * 6) | 0) + nDrift) & nm) * ns + ((((px * 6) | 0) + nDrift) & nm)];
          acc += dens / (1 + d2 * 1.15);
        }

        buf[rowOff + bx] = acc * dt * lampPower;
      }
    }
  };

  /* bilinear upsample, added into the luminance plane */
  V.composite = function (fb, strength, emberTint) {
    if (!V.enabled) return;
    var buf = V.buf, bw = V.bw, bh = V.bh;
    var L = fb.lum, E = fb.emb, w = fb.w, h = fb.h;

    var inv = 1 / V.step, half = 0.5 * inv;
    for (var y = 0; y < h; y++) {
      var fy = (y * inv) - half;
      var iy = fy | 0; if (iy < 0) iy = 0; if (iy > bh - 2) iy = bh - 2;
      var ty = fy - iy; if (ty < 0) ty = 0; if (ty > 1) ty = 1;
      var r0 = iy * bw, r1 = (iy + 1) * bw;
      var row = y * w;

      for (var x = 0; x < w; x++) {
        var fx = (x * inv) - half;
        var ix = fx | 0; if (ix < 0) ix = 0; if (ix > bw - 2) ix = bw - 2;
        var tx = fx - ix; if (tx < 0) tx = 0; if (tx > 1) tx = 1;

        var a = buf[r0 + ix] + (buf[r0 + ix + 1] - buf[r0 + ix]) * tx;
        var b = buf[r1 + ix] + (buf[r1 + ix + 1] - buf[r1 + ix]) * tx;
        var v = (a + (b - a) * ty) * strength;
        if (v <= 0.0005) continue;
        var i = row + x;
        L[i] += v;
        if (emberTint > 0) {
          var e = E[i] + v * emberTint;
          E[i] = e > 1 ? 1 : e;
        }
      }
    }
  };

  /* ---- salt motes -------------------------------------------------------- */
  /* Crystals lifted off the pans by the night wind. They are the only thing
   * in the frame that moves when you stand still, which is exactly the point:
   * the flat should never look like a paused screenshot. */
  V.updateMotes = function (dt, camX, camY, time) {
    if (!V.moteN) return;
    var m = V.motes, n = V.moteN;
    var wind = Math.sin(time * 0.21) * 0.28 + 0.16;
    for (var i = 0; i < n; i++) {
      var o = i * 7;
      m[o] += (m[o + 3] + wind) * dt;
      m[o + 1] += m[o + 4] * dt;
      m[o + 2] += m[o + 5] * dt;
      m[o + 6] += dt * 2.3;

      if (m[o + 2] < 0.02) { m[o + 2] = 0.02; m[o + 5] = Math.abs(m[o + 5]) * 0.4 + 0.03; }
      if (m[o + 2] > 2.8) m[o + 5] -= dt * 0.09;

      /* keep the cloud around the player without a visible respawn pop:
       * wrap through a box centred on the camera */
      var dx = m[o] - camX, dy = m[o + 1] - camY;
      if (dx > 9) m[o] -= 18; else if (dx < -9) m[o] += 18;
      if (dy > 9) m[o + 1] -= 18; else if (dy < -9) m[o + 1] += 18;
    }
  };

  var _p = [0, 0, 0];

  V.drawMotes = function (fb, tier, lampX, lampY, lampZ, lampPower) {
    if (!V.moteN || lampPower <= 0.01) return;
    var R = S.Ray;
    var m = V.motes, n = V.moteN;
    var L = fb.lum, D = fb.dep, w = fb.w, h = fb.h;
    var big = tier.motes > 500;

    for (var i = 0; i < n; i++) {
      var o = i * 7;
      var x = m[o], y = m[o + 1], z = m[o + 2];
      if (!R.project(fb, x, y, z, _p)) continue;
      var d = _p[2];
      if (d < 0.3 || d > 11) continue;
      var sx = _p[0] | 0, sy = _p[1] | 0;
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
      var idx = sy * w + sx;
      if (d >= D[idx]) continue;

      var lx = x - lampX, ly = y - lampY, lz = z - lampZ;
      var ld2 = lx * lx + ly * ly + lz * lz;
      var lit = lampPower / (1 + ld2 * 1.7);
      if (lit < 0.02) continue;

      /* they tumble, so they flash rather than glow */
      var flash = 0.45 + 0.55 * Math.abs(Math.sin(m[o + 6]));
      var v = lit * flash * (1.6 - d * 0.09);
      if (v <= 0.02) continue;
      L[idx] += v;
      /* the near ones are big enough to be two pixels at DROWNED */
      if (big && d < 3.2 && sx + 1 < w) L[idx + 1] += v * 0.55;
    }
  };

  S.Vol = V;
})(SALT);
