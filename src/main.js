/**
 * DESK WARS — entry point.
 *
 * Owns the WebGL renderer (kept alive between matches so we never churn a
 * GL context) and swaps Game instances in and out as the player starts,
 * restarts or quits a match.
 */
import { createRenderer } from './scene/setupScene.js';
import { SetupScreen } from './ui/setupScreen.js';
import { Game } from './core/game.js';
import { audio } from './core/audio.js';

class App {
  constructor() {
    this.canvas = document.getElementById('gl');
    this.renderer = createRenderer(this.canvas);
    this.game = null;

    window.addEventListener('resize', () => this.onResize());
    window.addEventListener('beforeunload', () => this.game?.stop());

    this.setup = new SetupScreen((config) => this.start(config));
    document.getElementById('loading').classList.add('hidden');

    // audio contexts need a gesture; the deploy button is the obvious one
    const unlock = () => { audio.init(); audio.resume(); };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
  }

  onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    if (this.game) {
      this.game.camera.aspect = w / h;
      this.game.camera.updateProjectionMatrix();
    }
  }

  start(config) {
    document.getElementById('loading').classList.remove('hidden');
    // let the loading screen paint before the (synchronous) world build
    requestAnimationFrame(() => requestAnimationFrame(() => {
      this.game?.dispose();
      audio.init();
      audio.resume();

      this.game = new Game(this.renderer, config, {
        onRestart: (cfg) => this.start(cfg),
        onQuit: () => this.quit(),
      });
      this.onResize();
      this.game.start();
      document.getElementById('loading').classList.add('hidden');
    }));
  }

  quit() {
    this.game?.dispose();
    this.game = null;
    this.renderer.clear();
    this.setup.show();
  }
}

window.addEventListener('error', (e) => {
  console.error('[desk wars]', e.error || e.message);
});

// eslint-disable-next-line no-new
const app = new App();
window.__DESKWARS__ = app;
