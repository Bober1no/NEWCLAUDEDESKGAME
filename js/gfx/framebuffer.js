/* SALT LINE — the internal buffer.
 *
 * Four parallel planes at the tier's internal resolution:
 *   lum  scene luminance, linear-ish, 0..1+ (values above 1 feed the bloom)
 *   emb  ember amount 0..1. the only warm colour in the game rides here.
 *   dep  per-pixel depth in cells. walls, floor, slabs and sprites all use it.
 *   out  the resolved RGBA, blitted to the visible canvas with smoothing off.
 *
 * Everything is a typed array allocated once per tier change. There are no
 * allocations in any per-frame path.
 */
(function (S) {
  'use strict';

  function FB(w, h) {
    this.resize(w, h);
  }

  FB.prototype.resize = function (w, h) {
    this.w = w; this.h = h;
    this.n = w * h;
    this.lum = new Float32Array(this.n);
    this.emb = new Float32Array(this.n);
    this.dep = new Float32Array(this.n);
    this.prev = new Float32Array(this.n);      /* motion blur accumulation */
    this.prevE = new Float32Array(this.n);
    this.wet = new Uint8Array(this.n);         /* brine mask, for reflection */
    this.vig = null;                           /* built by PostFX per tier   */

    /* half-res scratch for bloom */
    this.bw = w >> 1; this.bh = h >> 1;
    this.bloomA = new Float32Array(this.bw * this.bh);
    this.bloomB = new Float32Array(this.bw * this.bh);

    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    this.canvas = cv;
    this.ctx = cv.getContext('2d');
    this.image = this.ctx.createImageData(w, h);
    this.out = new Uint32Array(this.image.data.buffer);

    /* per-column scratch reused by the caster */
    this.colDepth = new Float32Array(w);
    this.colTop = new Int32Array(w);
    this.colBottom = new Int32Array(w);
    this.rayDX = new Float32Array(w);
    this.rayDY = new Float32Array(w);
    this.camX = new Float32Array(w);
  };

  FB.prototype.clear = function (skyLum) {
    this.lum.fill(skyLum || 0);
    this.emb.fill(0);
    this.dep.fill(1e9);
    this.wet.fill(0);
  };

  FB.prototype.present = function () {
    this.ctx.putImageData(this.image, 0, 0);
  };

  S.FB = FB;
})(SALT);
