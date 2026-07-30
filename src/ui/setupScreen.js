/** Match setup screen — difficulty, win condition, and the custom AI sliders. */
import { AI_PRESETS, customPreset } from '../core/constants.js';

export class SetupScreen {
  constructor(onStart) {
    this.el = document.getElementById('setup');
    this.onStart = onStart;
    this.config = {
      mode: 'ai',                 // 'ai' | 'pvp' (hot seat)
      difficulty: 'medium',
      custom: { reaction: 55, economy: 55, aggression: 55, tech: 55 },
      victory: 'domination',
      start: 'standard',
      speed: 1,
      seed: 'desk-01',
      handover: 'free',           // 'free' | 'timed'
      turnLength: 90,
      names: ['Player 1', 'Player 2'],
    };

    this._wireOptions('opt-mode', 'mode', (v) => {
      const pvp = v === 'pvp';
      document.getElementById('pvp-options').classList.toggle('hidden', !pvp);
      // the AI panel stays visible but is clearly out of play in hot seat
      document.getElementById('panel-difficulty').classList.toggle('dimmed', pvp);
    });
    this._wireOptions('opt-difficulty', 'difficulty', (v) => {
      document.getElementById('custom-sliders').classList.toggle('hidden', v !== 'custom');
    });
    this._wireOptions('opt-victory', 'victory');

    document.getElementById('sel-handover').addEventListener('change', (e) => {
      this.config.handover = e.target.value;
    });
    document.getElementById('sel-turn').addEventListener('change', (e) => {
      this.config.turnLength = Number(e.target.value);
    });
    for (const i of [0, 1]) {
      document.getElementById(`in-name${i}`).addEventListener('input', (e) => {
        this.config.names[i] = e.target.value.trim() || `Player ${i + 1}`;
      });
    }

    for (const [id, key] of [
      ['sl-reaction', 'reaction'], ['sl-economy', 'economy'],
      ['sl-aggression', 'aggression'], ['sl-tech', 'tech'],
    ]) {
      const input = document.getElementById(id);
      const out = input.parentElement.querySelector('output');
      input.addEventListener('input', () => {
        this.config.custom[key] = Number(input.value);
        out.textContent = input.value;
      });
    }

    document.getElementById('sel-start').addEventListener('change', (e) => {
      this.config.start = e.target.value;
    });
    document.getElementById('sel-speed').addEventListener('change', (e) => {
      this.config.speed = Number(e.target.value);
    });
    document.getElementById('in-seed').addEventListener('change', (e) => {
      this.config.seed = e.target.value.trim() || 'desk-01';
    });

    document.getElementById('btn-start').addEventListener('click', () => {
      this.hide();
      this.onStart(this.resolved());
    });
  }

  _wireOptions(containerId, key, after) {
    const box = document.getElementById(containerId);
    box.addEventListener('click', (e) => {
      const btn = e.target.closest('.opt');
      if (!btn) return;
      for (const b of box.querySelectorAll('.opt')) b.classList.remove('selected');
      btn.classList.add('selected');
      this.config[key] = btn.dataset.value;
      after?.(btn.dataset.value);
    });
  }

  resolved() {
    const c = { ...this.config, names: [...this.config.names] };
    c.preset = c.difficulty === 'custom'
      ? customPreset(c.custom)
      : { ...AI_PRESETS[c.difficulty] };
    // hot seat has no AI: both sides play on even economy
    if (c.mode === 'pvp') c.preset = { ...c.preset, label: 'Hot Seat', economy: 1 };
    return c;
  }

  show() { this.el.classList.remove('hidden'); }
  hide() { this.el.classList.add('hidden'); }
}
