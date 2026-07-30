/**
 * Tiny procedural sound bank. No assets — everything is synthesised with
 * oscillators and noise buffers so the game stays a single static folder.
 */
import { clamp, frand } from './utils.js';

class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.volume = 0.5;
    this.noiseBuf = null;
    this._last = new Map();   // per-sound throttle
  }

  /** Must be triggered from a user gesture (browser autoplay policy). */
  init() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) { this.enabled = false; return; }
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    // gentle limiter so overlapping explosions do not clip
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 8;
    this.master.connect(comp).connect(this.ctx.destination);

    const len = this.ctx.sampleRate * 1.2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? this.volume : 0;
  }

  get t() { return this.ctx.currentTime; }

  /** Rate-limits a sound key so a 40-unit volley is one sound, not forty. */
  _gate(key, minGap) {
    const now = this.ctx.currentTime;
    const prev = this._last.get(key) ?? -1;
    if (now - prev < minGap) return false;
    this._last.set(key, now);
    return true;
  }

  _env(gainNode, t0, attack, decay, peak) {
    const g = gainNode.gain;
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
    g.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  }

  tone({ freq = 440, type = 'sine', dur = 0.12, gain = 0.2, sweep = 0, attack = 0.005, delay = 0, detune = 0 }) {
    if (!this.ctx || !this.enabled) return;
    const t0 = this.t + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (sweep) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + sweep), t0 + dur);
    if (detune) osc.detune.value = detune;
    this._env(g, t0, attack, dur, gain);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + attack + 0.05);
  }

  noise({ dur = 0.2, gain = 0.2, filter = 900, q = 1, type = 'lowpass', delay = 0, sweepTo = null }) {
    if (!this.ctx || !this.enabled) return;
    const t0 = this.t + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = frand(0.85, 1.15);
    const biq = this.ctx.createBiquadFilter();
    biq.type = type;
    biq.frequency.setValueAtTime(filter, t0);
    if (sweepTo) biq.frequency.exponentialRampToValueAtTime(Math.max(40, sweepTo), t0 + dur);
    biq.Q.value = q;
    const g = this.ctx.createGain();
    this._env(g, t0, 0.004, dur, gain);
    src.connect(biq).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.1);
  }

  /* ── the bank ─────────────────────────────────────────────────────── */

  play(name, opts = {}) {
    if (!this.ctx || !this.enabled) return;
    const v = clamp(opts.volume ?? 1, 0, 1);
    switch (name) {
      case 'click':
        this.tone({ freq: 620, type: 'square', dur: 0.035, gain: 0.05 * v });
        break;
      case 'select':
        this.tone({ freq: 880, type: 'triangle', dur: 0.06, gain: 0.06 * v, sweep: 220 });
        break;
      case 'order':
        this.tone({ freq: 420, type: 'triangle', dur: 0.08, gain: 0.06 * v, sweep: 180 });
        break;
      case 'deny':
        this.tone({ freq: 190, type: 'sawtooth', dur: 0.11, gain: 0.07 * v, sweep: -70 });
        break;
      case 'shot':
        if (!this._gate('shot', 0.045)) return;
        this.noise({ dur: 0.055, gain: 0.045 * v, filter: 2400, type: 'bandpass', q: 1.4 });
        break;
      case 'melee':
        if (!this._gate('melee', 0.06)) return;
        this.noise({ dur: 0.07, gain: 0.05 * v, filter: 3600, type: 'highpass' });
        break;
      case 'siege':
        if (!this._gate('siege', 0.12)) return;
        this.tone({ freq: 130, type: 'square', dur: 0.14, gain: 0.09 * v, sweep: -60 });
        this.noise({ dur: 0.18, gain: 0.07 * v, filter: 700 });
        break;
      case 'explode':
        if (!this._gate('explode', 0.07)) return;
        this.noise({ dur: 0.42, gain: 0.16 * v, filter: 1500, sweepTo: 90 });
        this.tone({ freq: 88, type: 'sine', dur: 0.3, gain: 0.11 * v, sweep: -50 });
        break;
      case 'build':
        this.tone({ freq: 300, type: 'square', dur: 0.07, gain: 0.05 * v });
        this.tone({ freq: 460, type: 'square', dur: 0.09, gain: 0.045 * v, delay: 0.08 });
        break;
      case 'complete':
        [523, 659, 784].forEach((f, i) =>
          this.tone({ freq: f, type: 'triangle', dur: 0.16, gain: 0.06 * v, delay: i * 0.075 }));
        break;
      case 'unitReady':
        this.tone({ freq: 700, type: 'triangle', dur: 0.07, gain: 0.045 * v });
        this.tone({ freq: 940, type: 'triangle', dur: 0.09, gain: 0.04 * v, delay: 0.06 });
        break;
      case 'research':
        [392, 523, 659, 880].forEach((f, i) =>
          this.tone({ freq: f, type: 'sine', dur: 0.2, gain: 0.05 * v, delay: i * 0.08 }));
        break;
      case 'alert':
        this.tone({ freq: 740, type: 'square', dur: 0.1, gain: 0.06 * v });
        this.tone({ freq: 560, type: 'square', dur: 0.14, gain: 0.06 * v, delay: 0.13 });
        break;
      case 'die':
        if (!this._gate('die', 0.09)) return;
        this.noise({ dur: 0.16, gain: 0.06 * v, filter: 1100, sweepTo: 200 });
        break;
      case 'buildingDown':
        this.noise({ dur: 0.85, gain: 0.2 * v, filter: 900, sweepTo: 60 });
        this.tone({ freq: 70, type: 'sine', dur: 0.7, gain: 0.13 * v, sweep: -35 });
        break;
      case 'victory':
        [523, 659, 784, 1046].forEach((f, i) =>
          this.tone({ freq: f, type: 'triangle', dur: 0.5, gain: 0.09 * v, delay: i * 0.16 }));
        break;
      case 'defeat':
        [440, 392, 330, 262].forEach((f, i) =>
          this.tone({ freq: f, type: 'sawtooth', dur: 0.55, gain: 0.07 * v, delay: i * 0.22 }));
        break;
      default:
        break;
    }
  }
}

export const audio = new Audio();
