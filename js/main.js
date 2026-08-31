/* SALT LINE — boot and wiring.
 *
 * Fixed 60Hz simulation, variable render. Nothing in the sim ever reads a
 * frame time, so DROWNED at 24fps and DRY at 240fps play identically.
 */
(function (S) {
  'use strict';

  var G = S.Game;
  var In = S.Input;
  var loop = null;
  var started = false;

  function boot() {
    var canvas = document.getElementById('salt');
    if (!canvas) return;

    S.Renderer.attach(canvas);
    S.Renderer.setTier(S.Renderer.savedTier());
    In.attach(canvas);
    In.lockWanted = true;

    /* the title screen is a live view of the flat, so the world has to exist
     * before anybody has pressed anything */
    S.World.init(0x5a17c0de, 9);
    S.Menu.open('title');
    G.mode = 'title';
    G.best = G.loadBest();

    window.addEventListener('resize', function () { S.Renderer.resize(); }, false);

    /* audio cannot exist until somebody clicks. everything else already does. */
    function wake() {
      if (started) { S.Synth.resume(); return; }
      started = true;
      if (S.Synth.init()) {
        S.Sound.startBeds();
        S.Music.start();
      }
    }
    window.addEventListener('mousedown', wake, false);
    window.addEventListener('keydown', wake, false);
    window.addEventListener('touchstart', wake, false);

    /* losing the pointer lock is how most people will pause */
    document.addEventListener('pointerlockchange', function () {
      if (!document.pointerLockElement && G.mode === 'play' && G.runT > 1.5) {
        G.mode = 'pause';
        S.Menu.page = null;
        S.Menu.sel = 0;
        S.Music.setTension(0.05);
      }
    }, false);

    loop = new S.Loop(sim, render);
    S.Loop_ref = loop;
    loop.start();

    var splash = document.getElementById('boot');
    if (splash && splash.parentNode) splash.parentNode.removeChild(splash);
  }

  function sim(dt) {
    S.PostFX.update(dt);

    var m = G.mode;

    if (m === 'title' || m === 'name') {
      S.Menu.updateDemo(dt);
      S.Menu.update(dt, G);
      /* the flat keeps drifting behind the menu */
      S.Music.setTension(0.05);
    } else if (m === 'pause' || m === 'dead' || m === 'win') {
      S.Menu.update(dt, G);
      G.update(dt);
    } else if (m === 'read') {
      if (In.hit('menu')) { G.closeReading(); }
      else G.update(dt);
    } else if (m === 'play') {
      if (In.hit('menu')) {
        G.mode = 'pause';
        S.Menu.page = null;
        S.Menu.sel = 0;
        In.releaseLock();
        S.Music.setTension(0.05);
      } else {
        G.update(dt);
        /* quality is switchable mid-walk, which is the point of having it */
        for (var q = 0; q < 3; q++) {
          if (In.hit('q' + (q + 1))) S.Menu.setTier(S.TIER_ORDER[q]);
        }
      }
    }

    In.endFrame();
  }

  function render(alpha, dt) {
    S.Renderer.frame(G, alpha, dt);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, false);
  } else {
    boot();
  }
})(SALT);
