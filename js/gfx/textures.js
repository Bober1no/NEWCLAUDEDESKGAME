/* SALT LINE — procedural surface bank.
 *
 * Nothing is loaded. Every surface in the game is a small float field
 * generated once when a tier is selected. Texture resolution and octave count
 * are two of the real knobs the tier selector turns: DRY gets 32px fields
 * with one octave, DROWNED gets 128px with cellular cracks resolved properly.
 *
 * All fields are power-of-two and sampled with & masking, so there is never a
 * bounds check in a per-pixel path.
 */
(function (S) {
  'use strict';

  var M = S.M;

  function Field(size) {
    this.size = size;
    this.mask = size - 1;
    this.d = new Float32Array(size * size);
  }
  Field.prototype.at = function (x, y) {
    return this.d[((y & this.mask) * this.size) + (x & this.mask)];
  };

  var T = {
    ready: false,
    size: 64,
    crust: null,
    wall: null,
    pile: null,
    brine: null,
    grit: null
  };

  /* --- cellular (worley) distance, used for the salt polygon cracks ----- */
  function cellular(size, cells, seed) {
    var f = new Field(size);
    var step = size / cells;
    var px = new Float32Array(cells * cells * 2);
    var r = M.rng(seed);
    for (var cy = 0; cy < cells; cy++) {
      for (var cx = 0; cx < cells; cx++) {
        var i = (cy * cells + cx) * 2;
        px[i] = (cx + 0.15 + r.f() * 0.7) * step;
        px[i + 1] = (cy + 0.15 + r.f() * 0.7) * step;
      }
    }
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        var b1 = 1e9, b2 = 1e9;
        var gx = Math.floor(x / step), gy = Math.floor(y / step);
        for (var dy = -1; dy <= 1; dy++) {
          for (var dx = -1; dx <= 1; dx++) {
            var ax = (gx + dx + cells) % cells;
            var ay = (gy + dy + cells) % cells;
            var pi = (ay * cells + ax) * 2;
            var ox = px[pi] + dx * step + (gx + dx < 0 ? 0 : 0);
            var oy = px[pi + 1] + dy * step;
            /* wrap the reference point into local space */
            ox = px[pi] + (gx + dx - ax) * step;
            oy = px[pi + 1] + (gy + dy - ay) * step;
            var ddx = x - ox, ddy = y - oy;
            var d2 = ddx * ddx + ddy * ddy;
            if (d2 < b1) { b2 = b1; b1 = d2; }
            else if (d2 < b2) { b2 = d2; }
          }
        }
        /* F2-F1: zero on the ridge between cells, i.e. the crack */
        f.d[y * size + x] = (Math.sqrt(b2) - Math.sqrt(b1)) / step;
      }
    }
    return f;
  }

  /* --- build all fields for a tier -------------------------------------- */
  T.build = function (tier) {
    var size = tier.wallDetail >= 3 ? 128 : (tier.wallDetail >= 2 ? 64 : 32);
    var oct = tier.wallDetail;
    T.size = size;

    /* --- dry crust: cracked salt polygons over a fine granular base ---- */
    var crack = cellular(size, Math.max(4, size >> 4), 0x51a1);
    var crust = new Field(size);
    var s = size;
    for (var y = 0; y < s; y++) {
      for (var x = 0; x < s; x++) {
        var i = y * s + x;
        var u = x / s * 6, v = y / s * 6;
        var grain = M.fbm(u * 3.5, v * 3.5, oct);
        var cr = crack.d[i];
        /* the crack itself darkens; the lip either side catches the lamp */
        var line = M.smoothstep(0.0, 0.16, cr);
        var lip = 1 - Math.abs(cr - 0.19) / 0.19;
        if (lip < 0) lip = 0;
        var v2 = 0.62 + grain * 0.30;
        v2 *= 0.42 + 0.58 * line;
        v2 += lip * lip * 0.30;
        crust.d[i] = M.sat(v2);
      }
    }
    T.crust = crust;

    /* --- stacked salt block wall: courses, mortar, ridged crystal ------ */
    var wall = new Field(size);
    var course = Math.max(4, size >> 3);
    for (var wy = 0; wy < s; wy++) {
      for (var wx = 0; wx < s; wx++) {
        var wi = wy * s + wx;
        var row = Math.floor(wy / course);
        var offset = (row & 1) ? (course * 1.5) : 0;
        var bx = (wx + offset) % (course * 2);
        var by = wy % course;
        var mortar = 1;
        if (by < 1 || bx < 1) mortar = 0.30;
        else if (by < 2 || bx < 2) mortar = 0.72;
        var ridge = M.ridge(wx / s * 9 + row * 3.1, wy / s * 9, oct);
        var base = 0.50 + ridge * 0.42;
        /* the top lip of each course takes the light */
        if (by > course - 3) base += 0.16;
        wall.d[wi] = M.sat(base * mortar);
      }
    }
    T.wall = wall;

    /* --- heaped salt: granular, no structure --------------------------- */
    var pile = new Field(size);
    for (var py = 0; py < s; py++) {
      for (var pxx = 0; pxx < s; pxx++) {
        var pi2 = py * s + pxx;
        var g = M.ridge(pxx / s * 14, py / s * 14, oct);
        var g2 = M.fbm(pxx / s * 30, py / s * 30, Math.min(2, oct));
        pile.d[pi2] = M.sat(0.55 + g * 0.34 + g2 * 0.18);
      }
    }
    T.pile = pile;

    /* --- brine height field: two scales of slow swell ------------------ */
    var brine = new Field(size);
    for (var by2 = 0; by2 < s; by2++) {
      for (var bx2 = 0; bx2 < s; bx2++) {
        var bi = by2 * s + bx2;
        brine.d[bi] = M.fbm(bx2 / s * 5, by2 / s * 5, Math.min(3, oct + 1));
      }
    }
    T.brine = brine;

    /* --- fine grit, used to break up flat lighting everywhere ---------- */
    var grit = new Field(64);
    var gr = M.rng(0x7711);
    for (var gi = 0; gi < 64 * 64; gi++) grit.d[gi] = gr.f();
    T.grit = grit;

    T.ready = true;
  };

  S.Tex = T;
})(SALT);
