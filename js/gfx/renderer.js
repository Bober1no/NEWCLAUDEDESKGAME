/* SALT LINE — pass orchestration.
 *
 * One place that knows the order of everything and which tier turns what off.
 * Switching tier rebuilds the framebuffer, the texture bank, the vignette
 * table and the mote field; nothing else in the game knows it happened.
 */
(function (S) {
  'use strict';

  var M = S.M, K = S.K;

  var PROF = { on: false, t: {} };
  var _pt = 0;
  function mark(name) {
    if (!PROF.on) return;
    var now = performance.now();
    if (name) PROF.t[name] = (PROF.t[name] || 0) * 0.85 + (now - _pt) * 0.15;
    _pt = now;
  }

  var R = {
    fb: null,
    tier: null,
    tierId: null,
    display: null,
    dctx: null,
    dw: 0, dh: 0,
    time: 0,
    lastSwitch: 0
  };

  R.attach = function (canvas) {
    R.display = canvas;
    R.dctx = canvas.getContext('2d', { alpha: false });
    R.resize();
  };

  R.resize = function () {
    if (!R.display) return;
    var w = Math.max(320, window.innerWidth | 0);
    var h = Math.max(180, window.innerHeight | 0);
    R.display.width = w;
    R.display.height = h;
    R.dw = w; R.dh = h;
    R.dctx.imageSmoothingEnabled = false;
    R.dctx.mozImageSmoothingEnabled = false;
    R.dctx.webkitImageSmoothingEnabled = false;
  };

  R.setTier = function (id) {
    var tier = S.TIERS[id];
    if (!tier) return;
    R.tier = tier;
    R.tierId = id;
    R.fb = new S.FB(tier.w, tier.h);
    S.Tex.build(tier);
    S.PostFX.buildVignette(R.fb, tier);
    S.Vol.init(R.fb, tier);
    try { window.localStorage.setItem('saltline.tier', id); } catch (e) {}
  };

  R.savedTier = function () {
    try {
      var v = window.localStorage.getItem('saltline.tier');
      if (v && S.TIERS[v]) return v;
    } catch (e) {}
    return S.DEFAULT_TIER;
  };

  /* ---- lights ------------------------------------------------------------- */
  function buildLights(G, tier, worldCam) {
    var Ray = S.Ray;
    Ray.clearLights();
    var p = G.player;
    if (!worldCam) {
      /* the menu camera carries a lamp too, so the title card is lit by the
       * same thing that lights the walk */
      var d = S.Menu.demo;
      var mrx = -Math.sin(d.ang), mry = Math.cos(d.ang);
      var mp = 0.88 + Math.sin(d.t * 3.1) * 0.06;
      R.lampX = d.x + mrx * 0.30; R.lampY = d.y + mry * 0.30; R.lampZ = 0.52;
      R.lampPower = mp;
      Ray.addLight(R.lampX, R.lampY, R.lampZ, 1.24 * mp, 12.5, 0.44);
      return;
    }

    /* your lamp, held out to the right and a little low */
    var rx = -Math.sin(p.ang), ry = Math.cos(p.ang);
    var power = p.lampPower * p.lampFlicker;
    var lampX = p.x + rx * 0.30 + Math.cos(p.ang) * 0.10;
    var lampY = p.y + ry * 0.30 + Math.sin(p.ang) * 0.10;
    var lampZ = 0.52 - p.crouch * 0.20 + p.bob;
    Ray.addLight(lampX, lampY, lampZ, 1.28 * power, 12.5, 0.44);
    R.lampX = lampX; R.lampY = lampY; R.lampZ = lampZ; R.lampPower = power;

    if (tier.lights <= 1) return;

    var budget = tier.lights - 1;

    /* The gate lamps come first, before anything else can eat the budget.
     * They are cold -- zero ember -- because a warm light out here that is
     * not in your own hand means something else entirely. */
    var gates = [S.World.door, S.World.nextDoor];
    for (var g = 0; g < gates.length && budget > 0; g++) {
      var gd = gates[g];
      if (!gd) continue;
      var gdist = M.dist(gd.x, gd.y, p.x, p.y);
      /* Kept on a short radius and only added when you are near: the lamp
       * housing's emissive is what makes the gate findable from across a
       * section, so the light itself only has to make the pool you walk into.
       * Every extra light is a per-pixel cost in every shading loop. */
      if (gdist > 12.5) continue;
      Ray.addLight(gd.x, gd.y, gd.lampZ, 0.92 * gd.lampFlick, 10.0, 0);
      budget--;
    }

    for (var i = 0; i < G.entities.length && budget > 0; i++) {
      var e = G.entities[i];
      if (e.kind === 'understudy') {
        /* its lamp is the only other warm thing on the flat */
        Ray.addLight(e.x, e.y, 0.52, 1.30 * e.coherence, 10.0, 0.9);
        budget--;
      } else if (e.kind === 'comber' && tier.lights >= 4) {
        /* the crest carries its own light: churned brine is bright */
        var n = Math.min(budget, tier.lights >= 8 ? 4 : 2);
        for (var c = 0; c < n; c++) {
          var yy = (S.World.gh * (c + 0.5)) / n;
          Ray.addLight(e.x - 0.3, yy, 0.45, 0.85, 11, 0);
          budget--;
        }
      }
    }

    /* the threshold stone catches a little of your own lamp back at you when
     * you are close enough to pay */
    if (budget > 0 && S.World.door) {
      var d = S.World.door;
      var dist = M.dist(d.x, d.y, p.x, p.y);
      if (dist < 5.5 && d.state === 'shut') {
        Ray.addLight(d.x - 0.35, d.y, 0.12, 0.30 * (1 - dist / 5.5) * power, 3.2, 0.9);
        budget--;
      }
    }
  }

  /* ---- the frame ---------------------------------------------------------- */
  R.frame = function (G, alpha, dt) {
    var fb = R.fb, tier = R.tier;
    if (!fb) return;
    R.time += dt;
    var time = R.time;
    var p = G.player;

    /* The menus are not a separate screen. They are the same flat with the
     * camera drifting through it, which is why the title card has weather. */
    var worldCam = (G.mode === 'play' || G.mode === 'read' || G.mode === 'outro' ||
                    G.mode === 'pause' || G.mode === 'dead' || G.mode === 'win');

    fb.clear(0);

    {
      var eye, cx, cy, cang, cpitch, croll;
      if (worldCam) {
        eye = K.EYE - p.crouch * 0.22 + p.bob;
        cx = p.x; cy = p.y; cang = p.ang; cpitch = p.pitch; croll = p.roll;
      } else {
        var d0 = S.Menu.demo;
        eye = K.EYE;
        cx = d0.x; cy = d0.y; cang = d0.ang;
        cpitch = Math.sin(d0.t * 0.07) * 3; croll = 0;
      }
      S.Ray.setCamera(fb, cx, cy, cang, eye, cpitch, croll);
      buildLights(G, tier, worldCam);

      mark(null);
      S.Ray.sky(fb, tier, time); mark('sky');
      S.Ray.floor(fb, S.World, tier, time); mark('floor');
      S.Ray.walls(fb, S.World, tier, time); mark('walls');

      if (S.World.door) S.World.door.render(fb, tier);
      if (S.World.nextDoor) S.World.nextDoor.render(fb, tier);

      var props = S.World.props;
      for (var i = 0; i < props.length; i++) {
        S.Props.render(fb, tier, props[i], p.x, p.y);
      }

      if (worldCam) {
        var sub = tier.subSteps;
        for (var e = 0; e < G.entities.length; e++) {
          var en = G.entities[e];
          if (sub <= 1) {
            /* DRY does not interpolate at all: entities land on sim ticks and
             * stay there. At 320x180 the step is under a pixel anyway, and it
             * keeps the tier honest about what it is not doing. */
            en.render(fb, tier, alpha);
            continue;
          }
          var ox = en.x, oy = en.y;
          if (sub >= 4) {
            /* two ghosts out of the position ring, oldest and faintest first */
            for (var k = 2; k >= 1; k--) {
              var back = k * 3;
              en.x = en.histX(back); en.y = en.histY(back);
              if (Math.abs(en.x - ox) + Math.abs(en.y - oy) < 0.01) continue;
              S.Spr.globalAlpha = k === 2 ? 0.16 : 0.30;
              en.render(fb, tier, alpha);
            }
            S.Spr.globalAlpha = 1;
          }
          /* the live frame, interpolated between the last two sim ticks */
          en.x = en.px + (ox - en.px) * alpha;
          en.y = en.py + (oy - en.py) * alpha;
          en.render(fb, tier, alpha);
          en.x = ox; en.y = oy;
        }
      }

      mark('sprites');
      S.Reflect.apply(fb, tier, time); mark('reflect');

      if (tier.volumetric > 0) {
        S.Vol.clearOccluders();
        if (tier.volumetric >= 20 && worldCam) {
          for (var o = 0; o < G.entities.length; o++) {
            var en = G.entities[o];
            if (en.kind === 'understudy' || en.kind === 'assessor' || en.kind === 'tally') {
              if (M.dist(en.x, en.y, p.x, p.y) < 9) S.Vol.addOccluder(en.x, en.y, 0.28, 1.8);
            }
          }
        }
        S.Vol.march(fb, S.World, tier, R.lampX, R.lampY, R.lampZ, R.lampPower, time);
        /* the march is normalised by its own step length, so this constant is
         * the same at 12 steps and at 26: the haze reads identically, the top
         * tier just resolves the shafts instead of banding them */
        S.Vol.composite(fb, 0.075, 0.05); mark('volume');
      }

      S.Vol.updateMotes(dt, cx, cy, time);
      S.Vol.drawMotes(fb, tier, R.lampX, R.lampY, R.lampZ, R.lampPower);

      S.PostFX.vignette(fb);
      if (tier.motionBlur > 0) S.PostFX.motionBlur(fb, tier.motionBlur);
    }

    /* everything above this line is the world. everything below is cut into
     * the same buffer, so the interface dithers, blooms and grains with it. */
    if (G.mode === 'play' || G.mode === 'read') S.HUD.draw(fb, G, time);
    S.Menu.draw(fb, G, time);

    mark('hud');
    S.PostFX.bloom(fb, tier); mark('bloom');
    S.PostFX.resolve(fb, tier, time); mark('resolve');
    fb.present();

    R.present();
  };

  R.present = function () {
    var fb = R.fb, ctx = R.dctx;
    if (!ctx) return;
    var scale = Math.min(R.dw / fb.w, R.dh / fb.h);
    /* integer scaling wherever it fits: the pixel grid is the art direction
     * and a half-pixel of bilinear smear would undo the whole dither */
    var iscale = Math.max(1, Math.floor(scale));
    if (scale - iscale > 0.34 || iscale < 1) iscale = scale;
    var w = Math.round(fb.w * iscale), h = Math.round(fb.h * iscale);
    var ox = ((R.dw - w) * 0.5) | 0, oy = ((R.dh - h) * 0.5) | 0;

    if (ox > 0 || oy > 0) {
      ctx.fillStyle = '#05070b';
      ctx.fillRect(0, 0, R.dw, R.dh);
    }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(fb.canvas, 0, 0, fb.w, fb.h, ox, oy, w, h);
  };

  R.PROF = PROF;
  S.Renderer = R;
})(SALT);
