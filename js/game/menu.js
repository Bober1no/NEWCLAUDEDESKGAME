/* SALT LINE — every screen that is not the walk.
 *
 * All of it is stamped into the framebuffer with the same carved alphabet as
 * the world, over a live view of the flat with the camera drifting. There is
 * no HTML in this game apart from one canvas element.
 */
(function (S) {
  'use strict';

  var M = S.M, G6 = S.Glyphs;

  var Menu = {
    sel: 0,
    page: null,
    demo: { x: 8, y: 17, ang: 0.35, t: 0 },
    flash: 0,
    nameError: 0
  };

  var TIER_IDS = S.TIER_ORDER;

  var HOWTO = [
    'YOU ARE WALKING OUT ALONG A SALTWORKS AT NIGHT.',
    'A LINE OF DOORFRAMES STANDS IN THE LEVEES.',
    'EACH ONE COSTS A LETTER OF YOUR NAME.',
    '',
    'THE NUMBER CUT INTO A DOOR IS NOT ITS POSITION.',
    'IT IS HOW MANY PEOPLE HAVE BEEN THROUGH IT,',
    'AND IT GOES DOWN.',
    '',
    'LETTERS TAKEN OFF OTHER PEOPLE ARE SPENT FIRST.',
    'WHEN THOSE RUN OUT THE FLAT STARTS ON YOUR OWN',
    'NAME, FROM THE BACK. AT NOTHING LEFT, YOU ARE',
    'SOMETHING THE LINE CAN FILE.',
    '',
    'PAST THE GATE THAT READS NONE THERE IS A STONE',
    'WITH A NUMBER WHERE THE NAME SHOULD BE.',
    'YOU CAME OUT TO TAKE THE NAME BACK.'
  ];

  var CONTROLS = [
    ['W A S D  /  ARROWS', 'WALK'],
    ['MOUSE   OR   Q E', 'TURN'],
    ['F', 'LAMP -- OUT IS SOMETIMES SAFER'],
    ['SHIFT', 'HOLD STILL -- STOPS THE WATER'],
    ['SPACE', 'PAY A GATE  /  TAKE A LETTER'],
    ['1  2  3', 'CHANGE TIDE, EVEN MID WALK'],
    ['ESC', 'STOP']
  ];

  Menu.open = function (page) {
    Menu.page = page;
    Menu.sel = 0;
    if (page === 'quality') {
      Menu.sel = Math.max(0, TIER_IDS.indexOf(S.Renderer.tierId));
    }
  };

  /* ---- the drifting menu camera --------------------------------------------- */
  Menu.updateDemo = function (dt) {
    var d = Menu.demo;
    d.t += dt;
    d.x = 7 + Math.sin(d.t * 0.055) * 4.5;
    d.y = S.World.gh * 0.5 + Math.sin(d.t * 0.041) * 5.0;
    d.ang = 0.10 + Math.sin(d.t * 0.032) * 0.42;
  };

  /* ---- input ---------------------------------------------------------------- */
  Menu.update = function (dt, G) {
    var In = S.Input;
    Menu.flash = Math.max(0, Menu.flash - dt * 3);
    Menu.nameError = Math.max(0, Menu.nameError - dt * 2);

    if (G.mode === 'name') {
      if (In.submitted) {
        var raw = In.endCapture().trim();
        var letters = raw.replace(/[^A-Z]/g, '');
        if (letters.length < 2) { Menu.nameError = 1; In.beginCapture(raw, 14); return; }
        S.Sound.uiPick();
        G.newRun(raw);
        return;
      }
      if (In.canceled) { In.endCapture(); G.mode = 'title'; Menu.open('title'); return; }
      return;
    }

    var items = Menu.items(G);
    if (!items.length) return;

    if (In.hit('fwd') || In.hit('turnL')) { Menu.sel = (Menu.sel + items.length - 1) % items.length; S.Sound.uiMove(); }
    if (In.hit('back') || In.hit('turnR')) { Menu.sel = (Menu.sel + 1) % items.length; S.Sound.uiMove(); }

    if (In.hit('use') || In.hit('enter')) {
      S.Sound.uiPick();
      Menu.flash = 1;
      items[Menu.sel].go();
    }

    if (In.hit('menu')) {
      if (G.mode === 'pause') { G.mode = 'play'; S.Music.resume(); S.Input.lockWanted && S.Input.requestLock(); }
      else if (Menu.page === 'quality' || Menu.page === 'howto') Menu.open('title');
    }

    /* quality is switchable from anywhere with the number keys */
    for (var q = 0; q < 3; q++) {
      if (In.hit('q' + (q + 1))) { Menu.setTier(TIER_IDS[q]); }
    }
  };

  Menu.setTier = function (id) {
    if (S.Renderer.tierId === id) return;
    S.Renderer.setTier(id);
    S.Sound.uiPick();
  };

  Menu.items = function (G) {
    if (G.mode === 'title') {
      if (Menu.page === 'quality') return Menu.tierItems(G);
      if (Menu.page === 'howto') return [{ label: 'BACK', go: function () { Menu.open('title'); } }];
      return [
        { label: 'WALK OUT', go: function () {
            G.mode = 'name';
            S.Input.beginCapture('', 14);
          } },
        { label: 'THE THREE TIDES', go: function () { Menu.open('quality'); } },
        { label: 'WHAT YOU ARE DOING', go: function () { Menu.open('howto'); } }
      ];
    }
    if (G.mode === 'pause') {
      if (Menu.page === 'quality') return Menu.tierItems(G);
      return [
        { label: 'WALK ON', go: function () { G.mode = 'play'; S.Music.resume(); if (S.Input.lockWanted) S.Input.requestLock(); } },
        { label: 'THE THREE TIDES', go: function () { Menu.open('quality'); } },
        { label: 'GIVE UP', go: function () { G.finish('quit'); } }
      ];
    }
    if (G.mode === 'dead' || G.mode === 'win') {
      return [
        { label: 'WALK OUT AGAIN', go: function () { G.mode = 'name'; Menu.page = null; S.Input.beginCapture(S.Name.raw, 14); } },
        { label: 'STOP HERE', go: function () { G.mode = 'title'; Menu.open('title'); S.Sound.startBeds(); } }
      ];
    }
    return [];
  };

  Menu.tierItems = function (G) {
    var out = [];
    for (var i = 0; i < TIER_IDS.length; i++) {
      (function (id) {
        out.push({ label: S.TIERS[id].name, tier: id, go: function () { Menu.setTier(id); } });
      })(TIER_IDS[i]);
    }
    out.push({ label: 'BACK', go: function () { Menu.page = null; Menu.sel = 0; } });
    return out;
  };

  /* ---- drawing ---------------------------------------------------------------- */
  function title(fb, y, text, scale) {
    G6.draw(fb, fb.w >> 1, y, text, {
      scale: scale, lum: 0.95, align: 'center', carve: 0.30, track: scale * 2, seed: 3
    });
  }

  function line(fb, y, text, scale, lum, seed) {
    G6.draw(fb, fb.w >> 1, y, text, {
      scale: scale, lum: lum, align: 'center', carve: 0.65, track: scale, seed: seed || 7
    });
  }

  function list(fb, y, items, sel, scale, time) {
    var step = (G6.H + 6) * scale;
    for (var i = 0; i < items.length; i++) {
      var on = (i === sel);
      var lum = on ? (0.90 + 0.10 * Math.sin(time * 4)) : 0.42;
      var t = items[i].label;
      G6.draw(fb, fb.w >> 1, y + i * step, t, {
        scale: scale, lum: lum, align: 'center', carve: on ? 0.35 : 0.75,
        track: scale, seed: 31 + i * 5
      });
      if (on) {
        var w = G6.width(t, scale, scale);
        var cx = (fb.w >> 1);
        G6.draw(fb, cx - (w >> 1) - 6 * scale, y + i * step, '>', {
          scale: scale, lum: 0.88, carve: 0.4, track: 1, seed: 41
        });
      }
    }
    return y + items.length * step;
  }

  Menu.draw = function (fb, G, time) {
    var scale = Math.max(1, Math.round(fb.h / 200));
    var big = scale * 2;

    if (G.mode === 'title') {
      if (Menu.page === 'howto') { Menu.drawHowto(fb, G, time, scale); return; }

      /* the flat gets a scrim so the type reads over it */
      scrim(fb, 0.42);

      var y = (fb.h * 0.16) | 0;
      title(fb, y, 'SALT LINE', big);
      line(fb, y + (G6.H * big) + 6 * scale, 'A WALK OUT ALONG THE PANS', scale, 0.44, 11);

      if (Menu.page === 'quality') { Menu.drawTiers(fb, G, time, scale); return; }

      var ly = (fb.h * 0.50) | 0;
      list(fb, ly, Menu.items(G), Menu.sel, scale, time);

      var best = G.best;
      if (best) {
        line(fb, fb.h - 30 * scale,
          'FURTHEST: ' + best.name + ' - GATE ' + best.door, Math.max(1, scale - 1), 0.34, 71);
      }
      line(fb, fb.h - 18 * scale, 'ARROWS / WASD TO CHOOSE   SPACE TO TAKE IT',
        Math.max(1, scale - 1), 0.28, 73);
      return;
    }

    if (G.mode === 'name') { Menu.drawName(fb, G, time, scale, big); return; }

    if (G.mode === 'pause') {
      scrim(fb, 0.55);
      var py = (fb.h * 0.20) | 0;
      title(fb, py, 'STOPPED', big);
      if (Menu.page === 'quality') { Menu.drawTiers(fb, G, time, scale); return; }
      list(fb, (fb.h * 0.44) | 0, Menu.items(G), Menu.sel, scale, time);
      Menu.drawStats(fb, G, scale);
      return;
    }

    if (G.mode === 'dead' || G.mode === 'win') { Menu.drawEnding(fb, G, time, scale, big); return; }
  };

  function scrim(fb, amount) {
    var L = fb.lum, E = fb.emb, n = fb.n;
    var k = 1 - amount;
    for (var i = 0; i < n; i++) { L[i] *= k; E[i] *= k * 0.6; }
  }

  Menu.drawName = function (fb, G, time, scale, big) {
    scrim(fb, 0.60);
    var In = S.Input;
    var y = (fb.h * 0.26) | 0;

    line(fb, y, 'WRITE YOUR NAME IN THE SALT', scale, 0.60, 3);

    var buf = In.buffer;
    var shown = buf.length ? buf : '';
    var caret = (Math.floor(time * 2) % 2) === 0 ? '_' : ' ';
    var text = shown + caret;

    var w = G6.width(text, big, big);
    var bx = ((fb.w - w) * 0.5) | 0;
    var by = y + 18 * scale;
    S.HUD.rule(fb, bx - 4 * scale, by + G6.H * big + 3 * scale, w + 8 * scale, 0.40);

    G6.draw(fb, fb.w >> 1, by, text, {
      scale: big, lum: 0.95, align: 'center', carve: 0.35, track: big, seed: 5
    });

    var msg = Menu.nameError > 0
      ? 'THE FLAT WILL NOT TAKE THAT'
      : 'IT IS WHAT YOU WILL BE SPENDING.';
    line(fb, by + G6.H * big + 14 * scale, msg, Math.max(1, scale - 1),
      Menu.nameError > 0 ? 0.85 : 0.44, 9);
    line(fb, by + G6.H * big + 26 * scale,
      String(buf.replace(/[^A-Z]/g, '').length) + ' LETTERS. THAT IS ' +
      String(buf.replace(/[^A-Z]/g, '').length) + ' GATES BEFORE YOU START BORROWING.',
      Math.max(1, scale - 1), 0.34, 13);

    line(fb, fb.h - 20 * scale, '[ ENTER ] GO OUT      [ ESC ] BACK',
      Math.max(1, scale - 1), 0.36, 17);
  };

  /* ---- what you are doing ------------------------------------------------- */
  Menu.drawHowto = function (fb, G, time, scale) {
    scrim(fb, 0.66);
    var s1 = Math.max(1, scale - 1);
    var step = (G6.H + 2) * s1;
    var y = 5 * scale;

    line(fb, y, 'WHAT YOU ARE DOING', scale, 0.90, 3);
    y += G6.H * scale + 5 * scale;

    /* the prose is left-aligned inside a centred column: centring every line
     * of a paragraph makes it read like a poster, not like an instruction */
    var colW = 0;
    for (var m = 0; m < HOWTO.length; m++) {
      var lw = G6.width(HOWTO[m], s1, 1);
      if (lw > colW) colW = lw;
    }
    var colX = ((fb.w - colW) * 0.5) | 0;
    for (var i = 0; i < HOWTO.length; i++) {
      if (HOWTO[i].length) {
        G6.draw(fb, colX, y, HOWTO[i], {
          scale: s1, lum: 0.56, carve: 0.7, track: 1, seed: 60 + i
        });
      }
      y += step;
    }

    y += 3 * scale;
    S.HUD.rule(fb, colX, y, colW, 0.28);
    y += 4 * scale;

    var keyW = 0;
    for (var k = 0; k < CONTROLS.length; k++) {
      var kw = G6.width(CONTROLS[k][0], s1, 1);
      if (kw > keyW) keyW = kw;
    }
    for (var c = 0; c < CONTROLS.length; c++) {
      G6.draw(fb, colX + keyW, y, CONTROLS[c][0], {
        scale: s1, lum: 0.82, carve: 0.5, track: 1, align: 'right', seed: 80 + c
      });
      G6.draw(fb, colX + keyW + 9 * scale, y, CONTROLS[c][1], {
        scale: s1, lum: 0.44, carve: 0.75, track: 1, seed: 90 + c
      });
      y += step;
    }

    list(fb, fb.h - G6.H * scale - 4 * scale, Menu.items(G), Menu.sel, scale, time);
  };

  /* ---- the three tides ----------------------------------------------------- */
  Menu.drawTiers = function (fb, G, time, scale) {
    var items = Menu.items(G);
    var s1 = Math.max(1, scale - 1);
    var y = (fb.h * 0.375) | 0;
    line(fb, y - 15 * scale, 'THE THREE TIDES', scale, 0.66, 21);

    var endY = list(fb, y, items, Menu.sel, scale, time) + 5 * scale;

    /* BACK has no tier of its own, so it shows you what you are running */
    var id = (items[Menu.sel] && items[Menu.sel].tier) || S.Renderer.tierId;
    var t = S.TIERS[id];
    var lines = t.blurb.split('\n');
    for (var i = 0; i < lines.length; i++) {
      line(fb, endY + i * (G6.H + 3) * s1, lines[i], s1, 0.54, 90 + i);
    }
    endY += lines.length * (G6.H + 3) * s1 + 5 * scale;

    line(fb, endY, t.w + ' X ' + t.h + '    ' + t.lights + ' LIGHT' + (t.lights > 1 ? 'S' : '') +
      '    ' + (t.volumetric ? t.volumetric + '-STEP HAZE' : 'NO HAZE') +
      '    ' + (t.motes ? t.motes + ' MOTES' : 'NO MOTES'), s1, 0.36, 95);
    endY += (G6.H + 4) * s1;

    if (id === 'DROWNED') {
      var pulse = 0.58 + 0.36 * Math.sin(time * 3);
      line(fb, endY, 'NOT TRIMMED FOR SPEED. THAT IS THE TIER WORKING.', s1, pulse, 97);
      endY += (G6.H + 4) * s1;
    }
    if (S.Renderer.tierId === id) {
      line(fb, endY, '-  CURRENTLY RUNNING  -', s1, 0.44, 99);
    }

    line(fb, fb.h - (G6.H + 9) * s1, '1  2  3  SWITCHES AT ANY TIME, EVEN MID WALK',
      s1, 0.30, 101);
  };

  Menu.drawStats = function (fb, G, scale) {
    var s = Math.max(1, scale - 1);
    var L = S.Loop_ref;
    var rows = [
      'GATE ' + S.World.doorNum + ' OF ' + S.K.MAX_DOORS,
      'YOUR NAME: ' + S.Name.ownRemaining() + ' OF ' + S.Name.ownLength() + ' LETTERS',
      'BORROWED:  ' + S.Name.stolen.length,
      'GRAVES ROBBED: ' + G.robbed,
      S.Renderer.tier.name + '   ' +
        (L ? (L.fps.toFixed(0) + ' FPS   ' + L.msRender.toFixed(1) + ' MS RENDER   ' +
              L.msSim.toFixed(2) + ' MS SIM') : '')
    ];
    for (var i = 0; i < rows.length; i++) {
      G6.draw(fb, fb.w >> 1, fb.h - (44 - i * 8) * scale, rows[i], {
        scale: s, lum: 0.36, align: 'center', carve: 0.8, track: 1, seed: 120 + i
      });
    }
  };

  /* ---- endings ------------------------------------------------------------------ */
  var ENDINGS = {
    taken: {
      head: 'THERE IS ONLY ONE LAMP NOW',
      body: [
        'IT HAD YOUR WALK ALREADY. IT ONLY NEEDED',
        'THE REST. SOMEWHERE BACK ALONG THE LINE',
        'A NUMBER ON A DOOR WENT UP BY ONE, AND',
        'IT WILL BE A WHILE BEFORE ANYONE NOTICES',
        'WHICH ONE.'
      ]
    },
    filed: {
      head: 'YOU RAN OUT OF NAME',
      body: [
        'THE LAST LETTER WENT INTO THE THRESHOLD',
        'AND THE SALT CLOSED OVER IT. THE FLAT DOES',
        'NOT KEEP PEOPLE. IT KEEPS ACCOUNTS, AND AN',
        'ACCOUNT WITH NOTHING IN IT GETS A NUMBER.'
      ]
    },
    quit: {
      head: 'YOU TURNED BACK',
      body: [
        'THE LEVEES DO NOT LET YOU. YOU KNEW THAT',
        'WHEN YOU CAME OUT. YOU STOOD THERE UNTIL',
        'THE TIDE MADE THE DECISION.'
      ]
    },
    out: {
      head: 'YOU CAME OFF THE LINE',
      body: []
    }
  };

  Menu.drawEnding = function (fb, G, time, scale, big) {
    var fade = M.sat(G.deathT * 0.6);
    scrim(fb, 0.30 + fade * 0.55);

    var e = ENDINGS[G.ending] || ENDINGS.filed;
    var y = (fb.h * 0.17) | 0;
    if (G.deathT < 0.4) return;

    title(fb, y, e.head, scale + (fb.h > 300 ? 1 : 0));

    var body = e.body;
    if (G.ending === 'out') {
      var own = S.Name.ownRemaining(), full = S.Name.ownLength();
      body = [
        'THE LAST GATE READ NONE AND YOU WENT',
        'THROUGH IT ANYWAY.'
      ];
      if (G.haveTarget) {
        body.push('');
        body.push('YOU ARE CARRYING ' + G.targetName + ' OUT WITH YOU.');
        body.push('THEY WILL GO UNDER A WORD INSTEAD OF A NUMBER.');
      } else {
        body.push('');
        body.push('YOU LEFT THE STONE WHERE IT WAS.');
        body.push('IT IS STILL A NUMBER.');
      }
      body.push('');
      if (own === full) body.push('YOU NEVER SPENT A LETTER OF YOURSELF.');
      else if (own > full * 0.6) body.push('YOU CAME BACK ALMOST WHOLE.');
      else if (own > 1) body.push('THERE IS NOT MUCH OF YOU LEFT TO SIGN WITH.');
      else body.push('ONE LETTER. IT WILL HAVE TO DO.');
    }

    var by = y + 18 * scale;
    for (var i = 0; i < body.length; i++) {
      if (!body[i].length) continue;
      var a = M.sat((G.deathT - 0.6 - i * 0.18) * 2.2);
      if (a <= 0) continue;
      G6.draw(fb, fb.w >> 1, by + i * (G6.H + 3) * Math.max(1, scale - 1), body[i], {
        scale: Math.max(1, scale - 1), lum: 0.62 * a, align: 'center',
        carve: 0.6, track: 1, seed: 140 + i
      });
    }

    if (G.deathT > 1.6) {
      var sy = by + (body.length + 1) * (G6.H + 3) * Math.max(1, scale - 1) + 12 * scale;
      G6.draw(fb, fb.w >> 1, sy, S.Name.display() +
        '   -   GATE ' + S.World.doorNum + '   -   ' + G.robbed + ' STONES ROBBED', {
        scale: Math.max(1, scale - 1), lum: 0.44, align: 'center', carve: 0.7, track: 1, seed: 161
      });
      list(fb, sy + 16 * scale, Menu.items(G), Menu.sel, scale, time);
    }
  };

  S.Menu = Menu;
})(SALT);
