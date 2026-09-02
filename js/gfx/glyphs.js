/* SALT LINE — the carved alphabet.
 *
 * There is no DOM text anywhere in this game. Every letter, including the
 * menus and your own name, is stamped into the same float buffer as the
 * world, so it takes the same dither, the same vignette, the same grain.
 * The UI is made of salt.
 *
 * 5x7 cells, authored as strings so they stay readable, packed once at load.
 */
(function (S) {
  'use strict';

  var SRC = {
    'A': '01110/10001/10001/11111/10001/10001/10001',
    'B': '11110/10001/10001/11110/10001/10001/11110',
    'C': '01110/10001/10000/10000/10000/10001/01110',
    'D': '11110/10001/10001/10001/10001/10001/11110',
    'E': '11111/10000/10000/11110/10000/10000/11111',
    'F': '11111/10000/10000/11110/10000/10000/10000',
    'G': '01110/10001/10000/10111/10001/10001/01111',
    'H': '10001/10001/10001/11111/10001/10001/10001',
    'I': '01110/00100/00100/00100/00100/00100/01110',
    'J': '00111/00010/00010/00010/00010/10010/01100',
    'K': '10001/10010/10100/11000/10100/10010/10001',
    'L': '10000/10000/10000/10000/10000/10000/11111',
    'M': '10001/11011/10101/10101/10001/10001/10001',
    'N': '10001/11001/10101/10011/10001/10001/10001',
    'O': '01110/10001/10001/10001/10001/10001/01110',
    'P': '11110/10001/10001/11110/10000/10000/10000',
    'Q': '01110/10001/10001/10001/10101/10010/01101',
    'R': '11110/10001/10001/11110/10100/10010/10001',
    'S': '01111/10000/10000/01110/00001/00001/11110',
    'T': '11111/00100/00100/00100/00100/00100/00100',
    'U': '10001/10001/10001/10001/10001/10001/01110',
    'V': '10001/10001/10001/10001/10001/01010/00100',
    'W': '10001/10001/10001/10101/10101/11011/10001',
    'X': '10001/10001/01010/00100/01010/10001/10001',
    'Y': '10001/10001/01010/00100/00100/00100/00100',
    'Z': '11111/00001/00010/00100/01000/10000/11111',
    '0': '01110/10001/10011/10101/11001/10001/01110',
    '1': '00100/01100/00100/00100/00100/00100/01110',
    '2': '01110/10001/00001/00010/00100/01000/11111',
    '3': '11111/00010/00100/00010/00001/10001/01110',
    '4': '00010/00110/01010/10010/11111/00010/00010',
    '5': '11111/10000/11110/00001/00001/10001/01110',
    '6': '00110/01000/10000/11110/10001/10001/01110',
    '7': '11111/00001/00010/00100/01000/01000/01000',
    '8': '01110/10001/10001/01110/10001/10001/01110',
    '9': '01110/10001/10001/01111/00001/00010/01100',
    ' ': '00000/00000/00000/00000/00000/00000/00000',
    '.': '00000/00000/00000/00000/00000/01100/01100',
    ',': '00000/00000/00000/00000/00110/00110/01100',
    ':': '00000/01100/01100/00000/01100/01100/00000',
    ';': '00000/01100/01100/00000/00110/00110/01100',
    '-': '00000/00000/00000/11111/00000/00000/00000',
    '_': '00000/00000/00000/00000/00000/00000/11111',
    '=': '00000/00000/11111/00000/11111/00000/00000',
    '+': '00000/00100/00100/11111/00100/00100/00000',
    "'": '00100/00100/01000/00000/00000/00000/00000',
    '"': '01010/01010/10100/00000/00000/00000/00000',
    '!': '00100/00100/00100/00100/00100/00000/00100',
    '?': '01110/10001/00001/00010/00100/00000/00100',
    '/': '00001/00010/00010/00100/01000/01000/10000',
    '\\': '10000/01000/01000/00100/00010/00010/00001',
    '(': '00010/00100/01000/01000/01000/00100/00010',
    ')': '01000/00100/00010/00010/00010/00100/01000',
    '[': '01110/01000/01000/01000/01000/01000/01110',
    ']': '01110/00010/00010/00010/00010/00010/01110',
    '<': '00010/00100/01000/10000/01000/00100/00010',
    '>': '01000/00100/00010/00001/00010/00100/01000',
    '*': '00000/10101/01110/11111/01110/10101/00000',
    '#': '01010/01010/11111/01010/11111/01010/01010',
    '%': '11001/11010/00010/00100/01000/01011/10011',
    '@': '01110/10001/10111/10101/10111/10000/01110',
    '|': '00100/00100/00100/00100/00100/00100/00100',
    '~': '00000/00000/01001/10110/00000/00000/00000',
    '^': '00100/01010/10001/00000/00000/00000/00000'
  };

  var GW = 5, GH = 7;
  var GLYPH = Object.create(null);

  (function pack() {
    for (var ch in SRC) {
      var rows = SRC[ch].split('/');
      var bits = new Uint8Array(GW * GH);
      for (var y = 0; y < GH; y++) {
        var r = rows[y] || '00000';
        for (var x = 0; x < GW; x++) bits[y * GW + x] = (r.charCodeAt(x) === 49) ? 1 : 0;
      }
      GLYPH[ch] = bits;
    }
  })();

  var G = {};
  G.W = GW;
  G.H = GH;

  G.has = function (ch) { return GLYPH[ch] !== undefined; };

  /* The alphabet is cut in capitals only -- it is meant to look chiselled,
   * and a chisel does not do lowercase. Anything handed to the renderer gets
   * folded up rather than falling through to the missing-glyph box. */
  G.up = function (s) { return String(s === undefined || s === null ? '' : s).toUpperCase(); };

  /* advance width of a string in framebuffer pixels */
  G.width = function (str, scale, track) {
    str = G.up(str);
    scale = scale || 1;
    track = (track === undefined) ? 1 : track;
    if (!str.length) return 0;
    return str.length * (GW * scale + track) - track;
  };

  G.height = function (scale) { return GH * (scale || 1); };

  /* Stamp a string into the float planes.
   *
   * opts:
   *   scale    integer pixel size of one font pixel
   *   lum      luminance of the cut face
   *   emb      ember amount
   *   track    letters spacing in pixels
   *   align    'left' | 'center' | 'right'
   *   carve    0..1, how much the cut is eroded and shadowed. 0 = clean stamp.
   *   seed     erosion seed, so a given string erodes the same way each frame
   *   shadow   luminance of the cut shadow, defaults to a dark step
   *   clipTop / clipBottom  framebuffer row bounds
   */
  G.draw = function (fb, x, y, str, opts) {
    str = G.up(str);
    opts = opts || {};
    var scale = opts.scale || 1;
    var lum = (opts.lum === undefined) ? 0.86 : opts.lum;
    var emb = opts.emb || 0;
    var track = (opts.track === undefined) ? 1 : opts.track;
    var carve = (opts.carve === undefined) ? 0.5 : opts.carve;
    var seed = opts.seed || 1;
    var shadow = (opts.shadow === undefined) ? -0.34 : opts.shadow;

    var total = G.width(str, scale, track);
    if (opts.align === 'center') x -= total >> 1;
    else if (opts.align === 'right') x -= total;
    x = Math.round(x); y = Math.round(y);

    var W = fb.w, H = fb.h, L = fb.lum, E = fb.emb;
    var top = (opts.clipTop === undefined) ? 0 : opts.clipTop;
    var bot = (opts.clipBottom === undefined) ? H : opts.clipBottom;
    var hash = S.M.hash2;

    var pen = x;
    for (var i = 0; i < str.length; i++) {
      var ch = str.charAt(i);
      var bits = GLYPH[ch] || GLYPH['?'];
      if (ch === ' ') { pen += GW * scale + track; continue; }

      for (var gy = 0; gy < GH; gy++) {
        for (var gx = 0; gx < GW; gx++) {
          if (!bits[gy * GW + gx]) continue;

          for (var sy = 0; sy < scale; sy++) {
            var py = y + gy * scale + sy;
            if (py < top || py >= bot) continue;
            var rowOff = py * W;
            for (var sx = 0; sx < scale; sx++) {
              var px = pen + gx * scale + sx;
              if (px < 0 || px >= W) continue;

              /* erosion: knock holes in the cut face so it reads as scratched
               * salt rather than a bitmap font */
              if (carve > 0) {
                var hv = hash(px * 7 + seed, py * 13 + seed * 3);
                if (hv < carve * 0.22) continue;
              }

              var idx = rowOff + px;
              L[idx] = lum;
              if (emb > 0) E[idx] = emb;
            }
          }
        }
      }

      /* the cut shadow: one step down-right, only where the glyph is not */
      if (carve > 0 && shadow !== 0) {
        var off = Math.max(1, scale >> 1);
        for (var hy = 0; hy < GH; hy++) {
          for (var hx = 0; hx < GW; hx++) {
            if (!bits[hy * GW + hx]) continue;
            var already = (hy + 1 < GH && hx + 1 < GW) ? bits[(hy + 1) * GW + (hx + 1)] : 0;
            if (already) continue;
            for (var qy = 0; qy < scale; qy++) {
              var spy = y + hy * scale + qy + off;
              if (spy < top || spy >= bot) continue;
              var srow = spy * W;
              for (var qx = 0; qx < scale; qx++) {
                var spx = pen + hx * scale + qx + off;
                if (spx < 0 || spx >= W) continue;
                var si = srow + spx;
                if (L[si] === lum && E[si] === emb) continue;   /* don't shadow the face */
                L[si] = Math.max(0, L[si] + shadow);
              }
            }
          }
        }
      }

      pen += GW * scale + track;
    }
    return total;
  };

  /* Word-wrap helper for the reading cards. Returns an array of lines. */
  G.wrap = function (str, maxChars) {
    var out = [], para = str.split('\n');
    for (var p = 0; p < para.length; p++) {
      var words = para[p].split(' ');
      var line = '';
      for (var i = 0; i < words.length; i++) {
        var w = words[i];
        if (!line.length) { line = w; }
        else if (line.length + 1 + w.length <= maxChars) { line += ' ' + w; }
        else { out.push(line); line = w; }
      }
      out.push(line);
    }
    return out;
  };

  /* Bake a string into a standalone 1-bit plate. Used for text that lives in
   * the world rather than on the screen: the ledger number carved into a door,
   * the name on a grave marker. The slab shader samples these directly, so the
   * number on a door gets real perspective and real lamp falloff. */
  G.plate = function (str, scale, pad) {
    str = G.up(str);
    scale = scale || 1;
    pad = (pad === undefined) ? 1 : pad;
    var w = G.width(str, scale, scale) + pad * 2;
    var h = GH * scale + pad * 2;
    var bits = new Uint8Array(w * h);
    var pen = pad;
    for (var i = 0; i < str.length; i++) {
      var ch = str.charAt(i);
      var g = GLYPH[ch] || GLYPH['?'];
      if (ch !== ' ') {
        for (var gy = 0; gy < GH; gy++) {
          for (var gx = 0; gx < GW; gx++) {
            if (!g[gy * GW + gx]) continue;
            for (var sy = 0; sy < scale; sy++) {
              var py = pad + gy * scale + sy;
              for (var sx = 0; sx < scale; sx++) {
                var px = pen + gx * scale + sx;
                if (px >= 0 && px < w && py >= 0 && py < h) bits[py * w + px] = 1;
              }
            }
          }
        }
      }
      pen += GW * scale + scale;
    }
    return { w: w, h: h, bits: bits };
  };

  S.Glyphs = G;
})(SALT);
