// Procedural sound effects (WebAudio): glass shatter, thuds, wood cracks, explosions, launcher shots.
// Distance-attenuated from the listener; nothing to download.
export class Audio {
  constructor(G) { this.G = G; this.ctx = null; this.vol = 0.6; this.last = {}; }
  start() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
    const c = this.ctx; this.master = c.createGain(); this.master.gain.value = this.vol; this.master.connect(c.destination);
    const len = c.sampleRate * 1.5; this.noise = c.createBuffer(1, len, c.sampleRate); const d = this.noise.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  gainAt(p, base = 1) { if (!p) return base; const d = this.G.camera.position.distanceTo(p); return base / (1 + d * d * 0.15); }
  rate(key, ms) { const t = performance.now(); if (this.last[key] && t - this.last[key] < ms) return false; this.last[key] = t; return true; }
  burst(gain, f0, q, dur, type = 'bandpass', delay = 0) {
    const c = this.ctx; if (!c) return; const t = c.currentTime + delay;
    const s = c.createBufferSource(); s.buffer = this.noise; s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = f0; f.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.master); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  tone(gain, f0, f1, dur, type = 'sine', delay = 0) {
    const c = this.ctx; if (!c) return; const t = c.currentTime + delay;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.connect(g).connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }
  glass(p, power = 1) {
    if (!this.ctx || !this.rate('glass', 40)) return; const g = this.gainAt(p, 0.5 + Math.min(1, power) * 0.4);
    this.burst(g, 3500, 0.8, 0.25, 'highpass'); for (let i = 0; i < 6; i++) this.tone(g * 0.08, 2500 + Math.random() * 5000, 1800 + Math.random() * 3000, 0.15 + Math.random() * 0.4, 'sine', Math.random() * 0.12);
    for (let i = 0; i < 4; i++) this.burst(g * 0.25, 5000 + Math.random() * 3000, 4, 0.05, 'bandpass', 0.05 + Math.random() * 0.3);
  }
  thud(p) { if (!this.ctx || !this.rate('thud', 60)) return; const g = this.gainAt(p, 0.7); this.tone(g, 140, 50, 0.18, 'triangle'); this.burst(g * 0.5, 600, 1, 0.08, 'lowpass'); }
  wood(p) { if (!this.ctx || !this.rate('wood', 60)) return; const g = this.gainAt(p, 0.6); this.burst(g, 1200, 3, 0.09); this.tone(g * 0.4, 220, 90, 0.12, 'square'); }
  boom(p, power = 1) { if (!this.ctx) return; const g = this.gainAt(p, 1.2 * power); this.burst(g, 180, 0.7, 1.2, 'lowpass'); this.tone(g * 0.9, 90, 30, 0.9, 'sine'); this.burst(g * 0.4, 2500, 0.5, 0.25, 'highpass'); }
  pew() { if (!this.ctx || !this.rate('pew', 50)) return; this.burst(0.25, 2000, 2, 0.06); this.tone(0.12, 900, 300, 0.07, 'square'); }
  whoosh() { if (!this.ctx) return; this.burst(0.2, 800, 0.6, 0.18); }
  fizz(p) { if (!this.ctx || !this.rate('fizz', 120)) return; this.burst(this.gainAt(p, 0.12), 6000, 0.6, 0.3, 'highpass'); }
}
