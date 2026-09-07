/* CASCADE — deterministic pseudo-random number generation.
   Every stochastic element in the simulation derives from the master seed
   through this file. Nothing calls Math.random(). */
(function (root) {
  'use strict';

  function hash32(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  function mulberry32(a) {
    a = a >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function RNG(seed) {
    if (typeof seed === 'string') seed = hash32(seed);
    this._seed = seed >>> 0;
    this._next = mulberry32(this._seed);
    this._spare = null;
  }

  RNG.prototype.next = function () { return this._next(); };
  RNG.prototype.int = function (n) { return Math.floor(this._next() * n); };
  RNG.prototype.range = function (a, b) { return a + this._next() * (b - a); };
  RNG.prototype.pick = function (arr) { return arr[Math.floor(this._next() * arr.length)]; };
  RNG.prototype.chance = function (p) { return this._next() < p; };

  /* Box-Muller, cached spare. Deterministic given call order. */
  RNG.prototype.normal = function () {
    if (this._spare !== null) { var s = this._spare; this._spare = null; return s; }
    var u = 0, v = 0, m = 0;
    do {
      u = this._next() * 2 - 1;
      v = this._next() * 2 - 1;
      m = u * u + v * v;
    } while (m >= 1 || m === 0);
    var f = Math.sqrt((-2 * Math.log(m)) / m);
    this._spare = v * f;
    return u * f;
  };

  RNG.prototype.shuffle = function (arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(this._next() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  };

  /* Derive an independent stream. Used so that cloned-world evaluation never
     perturbs the master stream: agent deliberation is side-effect free. */
  function derive(seed, label) {
    if (typeof seed === 'string') seed = hash32(seed);
    return new RNG((hash32(label) ^ Math.imul(seed >>> 0, 2654435761)) >>> 0);
  }

  root.CSC = root.CSC || {};
  root.CSC.RNG = RNG;
  root.CSC.hash32 = hash32;
  root.CSC.derive = derive;
})(typeof globalThis !== 'undefined' ? globalThis : this);
