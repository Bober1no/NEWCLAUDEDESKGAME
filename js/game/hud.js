/* SALT LINE — the interface, cut into the same buffer as the world.
 *
 * There is no DOM here and no second canvas. The name strip is stamped into
 * the luminance plane before the dither runs, so your own name gets the same
 * grain, the same bloom and the same chromatic misregistration as the salt.
 * When the vignette closes in on you, it closes in on the interface too.
 *
 * The layout is one thing: your name, shrinking from the right.
 */
(function (S) {
  'use strict';

  var M = S.M, G6 = S.Glyphs;
  var H = {};

  /* a dark plate with a rimed edge, for the few times the game has to put a
   * card in front of you */
  H.panel = function (fb, x, y, w, h, opts) {
    opts = opts || {};
    var L = fb.lum, E = fb.emb, W = fb.w, H2 = fb.h;
    var inner = (opts.lum === undefined) ? 0.030 : opts.lum;
    var rim = (opts.rim === undefined) ? 0.44 : opts.rim;
    var x1 = x + w, y1 = y + h;
    for (var py = Math.max(0, y); py < Math.min(H2, y1); py++) {
      var row = py * W;
      for (var px = Math.max(0, x); px < Math.min(W, x1); px++) {
        var i = row + px;
        var edge = (px - x < 1 || x1 - px <= 1 || py - y < 1 || y1 - py <= 1);
        if (edge) {
          /* the rim is eroded so the card looks scratched out, not drawn */
          if (M.hash2(px * 5, py * 11) > 0.18) { L[i] = rim; E[i] = 0; }
        } else {
          L[i] = L[i] * (opts.keep || 0.10) + inner;
          E[i] *= 0.15;
        }
      }
    }
  };

  H.rule = function (fb, x, y, w, lum) {
    var L = fb.lum;
    for (var i = 0; i < w; i++) {
      var px = x + i;
      if (px < 0 || px >= fb.w || y < 0 || y >= fb.h) continue;
      if (M.hash2(px * 7, y * 3) < 0.24) continue;
      L[y * fb.w + px] = lum;
    }
  };

  /* ---- the name strip ------------------------------------------------------ */
  H.nameStrip = function (fb, G, scale, time) {
    var N = S.Name;
    var disp = N.display();
    var stolen = N.stolen;
    var track = scale;
    var gw = G6.W * scale + track;

    var totalW = disp.length * gw + (stolen.length ? (gw * 0.6 + stolen.length * gw) : 0);
    var x0 = Math.round((fb.w - totalW) * 0.5);
    var y = fb.h - G6.H * scale - 10 * scale;

    /* your own name. the gouges are letters that are already gone. */
    var pen = x0;
    for (var i = 0; i < disp.length; i++) {
      var ch = disp.charAt(i);
      if (ch === '.') {
        /* a hole in the stone where a letter used to be */
        H.gouge(fb, pen, y, scale, i * 37);
      } else if (ch !== ' ') {
        var breathe = 1 + 0.06 * Math.sin(time * 1.3 + i);
        G6.draw(fb, pen, y, ch, {
          scale: scale, lum: 0.94 * breathe, carve: 0.55, track: track, seed: 11 + i * 7
        });
      }
      pen += gw;
    }

    /* what you have taken off other people, waiting to be spent first */
    if (stolen.length) {
      pen += gw * 0.6;
      /* the separator: a cut in the stone */
      H.rule(fb, Math.round(pen - gw * 0.45), y + 2, Math.max(2, scale), 0.42);
      for (var j = 0; j < stolen.length; j++) {
        var s = stolen[j];
        var jig = Math.round(Math.sin(j * 2.7 + time * 0.6) * scale * 0.5);
        G6.draw(fb, Math.round(pen), y + jig, s.ch, {
          scale: scale, lum: 0.52, carve: 0.75, track: track, seed: 91 + j * 13,
          shadow: -0.18
        });
        pen += gw;
      }
    }

    /* letters coming off you, falling out of frame */
    var crumbs = N.crumbs;
    for (var c = 0; c < crumbs.length; c++) {
      var cr = crumbs[c];
      var cx = x0 + (disp.length + cr.idx + 1) * gw + cr.x;
      var cy = y + cr.y;
      if (cy > fb.h) continue;
      G6.draw(fb, Math.round(cx), Math.round(cy), cr.ch, {
        scale: scale,
        lum: (cr.own ? 0.85 : 0.45) * Math.max(0, 1 - cr.t / 1.5),
        carve: 0.9, track: track, seed: 501 + c
      });
    }
  };

  H.gouge = function (fb, x, y, scale, seed) {
    var L = fb.lum, W = fb.w;
    for (var gy = 0; gy < G6.H * scale; gy++) {
      for (var gx = 0; gx < G6.W * scale; gx++) {
        var px = x + gx, py = y + gy;
        if (px < 0 || px >= W || py < 0 || py >= fb.h) continue;
        var h = M.hash2(px * 3 + seed, py * 5 + seed);
        if (h < 0.42) L[py * W + px] = 0.055 + h * 0.10;
      }
    }
  };

  /* ---- transient lines ------------------------------------------------------ */
  H.centered = function (fb, y, text, scale, lum, fade) {
    G6.draw(fb, fb.w >> 1, y, text, {
      scale: scale, lum: lum * fade, align: 'center', carve: 0.5, track: scale,
      seed: 3, shadow: -0.30 * fade
    });
  };

  H.draw = function (fb, G, time) {
    var scale = Math.max(1, Math.round(fb.h / 200));
    var s2 = Math.max(1, scale - 0);

    H.nameStrip(fb, G, scale, time);

    /* What you are standing in front of. Stacked upward from the name strip
     * so it can never collide with it however long the prompt gets. */
    if (G.focus && G.mode === 'play') {
      var label = G.focus.label;
      if (G.focus.type === 'door' && G.choir) label += '   -   DOUBLED';
      var s3 = Math.max(1, scale - 1);
      var nameTop = fb.h - G6.H * scale - 10 * scale;
      var keyY = nameTop - 6 * scale - G6.H * s3;
      var promptY = keyY - 3 * scale - G6.H * s2;
      var fade = 0.78 + 0.22 * Math.sin(time * 3.4);
      H.centered(fb, promptY, label, s2, 0.74 * fade, 1);
      H.centered(fb, keyY, '[ SPACE ]', s3, 0.34, 1);
    }

    /* The gate's own count, at the top of frame whenever the gate is anywhere
     * in front of you. This is the compass: your lamp reaches twelve metres
     * and a section is twenty-six, so turning until this line appears is how
     * you find which way forward is. It is also the only number in the game
     * that matters, so it earns the space. */
    var d = S.World.door;
    if (d && G.mode === 'play') {
      var bearing = Math.atan2(d.y - G.player.y, d.x - G.player.x);
      var off = Math.abs(M.angDiff(G.player.ang, bearing));
      if (off < 0.95) {
        var dd = M.dist(d.x, d.y, G.player.x, G.player.y);
        var f = 1 - M.smoothstep(0.55, 0.95, off);
        f *= 0.45 + 0.55 * M.sat((22 - dd) / 14);
        H.centered(fb, 8 * scale, S.Ledger.legendAt(d.num) + ' COME THIS FAR',
          Math.max(1, scale - 1), 0.62, f);
      }
    }

    /* the Tally's scratch, kept in the corner until you use it */
    if (G.tallyMarkText) {
      G6.draw(fb, 5 * scale, 5 * scale, 'AHEAD: ' + G.tallyMarkText, {
        scale: Math.max(1, scale - 1), lum: 0.46, carve: 0.9, track: 1, seed: 77
      });
    }

    /* transient hints */
    if (G.hint) {
      var h = G.hint;
      var fadeIn = M.sat(h.t * 4);
      var fadeOut = 1 - M.sat((h.t - h.dur) / 0.8);
      var a = Math.min(fadeIn, fadeOut);
      if (a > 0.01) {
        H.centered(fb, (fb.h * 0.235) | 0, h.text, scale, 0.80, a);
      }
    }

    if (G.mode === 'read' && G.reading) H.reading(fb, G, time, scale);
  };

  /* ---- the reading card ------------------------------------------------------
   * Sized from its own contents rather than a magic width, because the names
   * are generated and some of them are long. */
  H.reading = function (fb, G, time, scale) {
    var d = G.reading.data;
    var s1 = Math.max(1, scale - 1);
    var left = d.letters.length - d.taken;
    var pulse = 0.62 + 0.28 * Math.sin(time * 3.2);

    var rows = [];
    if (d.isTarget) {
      rows.push({ t: 'A NUMBER WHERE THE NAME SHOULD BE:  ' + d.number, s: s1, l: 0.60 });
      rows.push({ t: 'SOMEBODY CUT THIS ON THE BACK OF IT', s: s1, l: 0.40 });
    } else {
      rows.push({ t: 'CUT INTO THE STONE', s: s1, l: 0.38 });
    }
    rows.push({ t: S.Props.markerDisplay(d), s: scale, l: 0.94, carve: 0.30, gap: 4 });
    rows.push({ t: d.epitaph, s: s1, l: 0.56 });
    rows.push({ t: 'GATE ' + d.door + '   -   ' + S.Ledger.legendAt(d.door) + ' PASSED IT', s: s1, l: 0.34, gap: 5 });
    rows.push({ rule: true });
    rows.push({
      t: left > 0 ? ('[ SPACE ]  PRISE A LETTER OFF   -   ' + left + ' LEFT ON IT')
                  : 'THERE IS NOTHING LEFT ON IT',
      s: s1, l: left > 0 ? pulse : 0.30
    });
    rows.push({ t: '[ ESC ]  STAND UP', s: s1, l: 0.32 });

    var padX = 9 * scale, padY = 8 * scale;
    var wMax = 0, hSum = 0;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r.rule) { hSum += 5 * scale; continue; }
      var rw = G6.width(r.t, r.s, r.s);
      if (rw > wMax) wMax = rw;
      hSum += G6.H * r.s + (r.gap || 4) * scale;
    }

    var pw = Math.min(fb.w - 8, wMax + padX * 2);
    var ph = hSum + padY * 2;
    var x = ((fb.w - pw) * 0.5) | 0;
    var y = ((fb.h - ph) * 0.5) | 0;

    H.panel(fb, x, y, pw, ph, { lum: 0.022, rim: 0.48, keep: 0.05 });

    var cx = fb.w >> 1;
    var line = y + padY;
    for (var j = 0; j < rows.length; j++) {
      var q = rows[j];
      if (q.rule) {
        H.rule(fb, x + padX, line + 2 * scale, pw - padX * 2, 0.30);
        line += 5 * scale;
        continue;
      }
      G6.draw(fb, cx, line, q.t, {
        scale: q.s, lum: q.l, align: 'center',
        carve: (q.carve === undefined) ? 0.72 : q.carve, track: q.s, seed: 5 + j * 7
      });
      line += G6.H * q.s + (q.gap || 4) * scale;
    }
  };

  S.HUD = H;
})(SALT);
