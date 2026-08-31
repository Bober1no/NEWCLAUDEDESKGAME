/* SALT LINE — math, deterministic RNG, noise fields.
 * No allocations in anything called per-pixel.
 */
(function (S) {
  'use strict';

  var M = {};

  M.TAU = Math.PI * 2;

  M.clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
  M.sat = function (v) { return v < 0 ? 0 : (v > 1 ? 1 : v); };
  M.lerp = function (a, b, t) { return a + (b - a) * t; };
  M.smooth = function (t) { return t * t * (3 - 2 * t); };
  M.smoother = function (t) { return t * t * t * (t * (t * 6 - 15) + 10); };

  M.step01 = function (a, b, v) {
    if (b === a) return v < a ? 0 : 1;
    var t = (v - a) / (b - a);
    return t < 0 ? 0 : (t > 1 ? 1 : t);
  };

  M.smoothstep = function (a, b, v) { return M.smooth(M.step01(a, b, v)); };

  /* shortest signed angular difference */
  M.angDiff = function (a, b) {
    var d = (b - a) % M.TAU;
    if (d > Math.PI) d -= M.TAU;
    if (d < -Math.PI) d += M.TAU;
    return d;
  };

  /* move a toward b by at most m */
  M.toward = function (a, b, m) {
    var d = b - a;
    if (d > m) return a + m;
    if (d < -m) return a - m;
    return b;
  };

  /* ---- xorshift32. seeded, cheap, good enough for a salt flat ---------- */
  function Rng(seed) {
    this.s = (seed | 0) || 0x9e3779b9;
    if (this.s === 0) this.s = 0x6d2b79f5;
  }
  Rng.prototype.next = function () {
    var x = this.s;
    x ^= x << 13; x |= 0;
    x ^= x >>> 17;
    x ^= x << 5; x |= 0;
    this.s = x;
    return (x >>> 0);
  };
  Rng.prototype.f = function () { return this.next() / 4294967296; };
  Rng.prototype.range = function (a, b) { return a + (b - a) * this.f(); };
  Rng.prototype.int = function (n) { return (this.next() % n) | 0; };
  Rng.prototype.between = function (a, b) { return a + (this.next() % (b - a + 1)) | 0; };
  Rng.prototype.pick = function (arr) { return arr[this.next() % arr.length]; };
  Rng.prototype.chance = function (p) { return this.f() < p; };
  Rng.prototype.sign = function () { return this.f() < 0.5 ? -1 : 1; };
  Rng.prototype.shuffle = function (arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = this.next() % (i + 1);
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  };
  M.Rng = Rng;
  M.rng = function (seed) { return new Rng(seed); };

  /* ---- integer hash -> [0,1). used by every noise field below --------- */
  function hash2(x, y) {
    var h = (x | 0) * 374761393 + (y | 0) * 668265263;
    h = (h ^ (h >>> 13)) | 0;
    h = (h * 1274126177) | 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function hash3(x, y, z) {
    var h = (x | 0) * 374761393 + (y | 0) * 668265263 + (z | 0) * 2147483647;
    h = (h ^ (h >>> 13)) | 0;
    h = (h * 1274126177) | 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  M.hash2 = hash2;
  M.hash3 = hash3;

  /* ---- value noise ----------------------------------------------------- */
  M.noise2 = function (x, y) {
    var xi = Math.floor(x), yi = Math.floor(y);
    var xf = x - xi, yf = y - yi;
    var u = xf * xf * (3 - 2 * xf);
    var v = yf * yf * (3 - 2 * yf);
    var a = hash2(xi, yi), b = hash2(xi + 1, yi);
    var c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
    return (a + (b - a) * u) + ((c + (d - c) * u) - (a + (b - a) * u)) * v;
  };

  M.noise3 = function (x, y, z) {
    var xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    var xf = x - xi, yf = y - yi, zf = z - zi;
    var u = xf * xf * (3 - 2 * xf);
    var v = yf * yf * (3 - 2 * yf);
    var w = zf * zf * (3 - 2 * zf);
    var n0 = hash3(xi, yi, zi) + (hash3(xi + 1, yi, zi) - hash3(xi, yi, zi)) * u;
    var n1 = hash3(xi, yi + 1, zi) + (hash3(xi + 1, yi + 1, zi) - hash3(xi, yi + 1, zi)) * u;
    var n2 = hash3(xi, yi, zi + 1) + (hash3(xi + 1, yi, zi + 1) - hash3(xi, yi, zi + 1)) * u;
    var n3 = hash3(xi, yi + 1, zi + 1) + (hash3(xi + 1, yi + 1, zi + 1) - hash3(xi, yi + 1, zi + 1)) * u;
    var a = n0 + (n1 - n0) * v;
    var b = n2 + (n3 - n2) * v;
    return a + (b - a) * w;
  };

  /* fractal brownian motion. octaves is the per-tier detail dial. */
  M.fbm = function (x, y, octaves) {
    var sum = 0, amp = 0.5, norm = 0;
    for (var i = 0; i < octaves; i++) {
      sum += M.noise2(x, y) * amp;
      norm += amp;
      amp *= 0.5;
      x *= 2.03; y *= 1.97;
    }
    return sum / norm;
  };

  /* ridged noise. makes salt crystal edges rather than clouds. */
  M.ridge = function (x, y, octaves) {
    var sum = 0, amp = 0.5, norm = 0;
    for (var i = 0; i < octaves; i++) {
      var n = 1 - Math.abs(M.noise2(x, y) * 2 - 1);
      sum += n * n * amp;
      norm += amp;
      amp *= 0.5;
      x *= 2.11; y *= 2.07;
    }
    return sum / norm;
  };

  /* ---- misc ------------------------------------------------------------ */
  M.dist2 = function (ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay;
    return dx * dx + dy * dy;
  };

  M.dist = function (ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay;
    return Math.sqrt(dx * dx + dy * dy);
  };

  S.M = M;
})(SALT);
