// Reel 6 · Precipitation: Pb(NO3)2 poured into KI → golden-rain PbI2; AgCl / Cu(OH)2 / BaSO4 trio;
// a holographic solubility table you fly over; the BaCO3 prediction; ions locking into a sinking lattice.
import * as THREE from 'three';
import { REELS } from './script.js';
import { camKF, sm, lerp, showStages, shake } from './common.js';
import { M, canvasTex } from '../render/materials.js';
import { PPT_COLOUR, RULES } from '../chem/solubility.js';
import { Precipitate } from '../fx/precipitate.js';
import { Particles } from '../render/lab.js';
import { LAYER_FX } from '../render/pipeline.js';
import { MolWorld } from '../fx/molecules.js';
import { vessel, rack } from './kit.js';
import { hh } from '../fx/smoke.js';

const R = REELS.find(r => r.id === 'r6');

function stream(K, from, to, t0, t1, col = [0.9, 0.95, 1]) {
  const p = new Particles(120, (i, s, time, o) => { if (s < t0 || s > t1) return false; const u = ((i / 120) + s * 2.2) % 1; o.x = lerp(from[0], to[0], u) + Math.sin(i) * 0.0006; o.y = lerp(from[1], to[1], u) - 0.02 * Math.sin(u * Math.PI) * 0; o.z = lerp(from[2], to[2], u); o.size = 0.0028; o.alpha = 0.5; o.r = col[0]; o.g = col[1]; o.b = col[2]; return true; }, { additive: false });
  p.points.layers.set(LAYER_FX); K.pipe.noDepth.add(p.points); return p;
}

export default function (K) {
  const root = new THREE.Group();
  const G = { pbi2: new THREE.Group(), trio: new THREE.Group(), table: new THREE.Group(), particles: new THREE.Group() };
  for (const k in G) root.add(G[k]);

  // ---------------- PbI2 golden rain (beaker of KI, test tube of Pb(NO3)2 poured in)
  const bk = vessel('beaker', { level: 0.055, dist: 10 }); G.pbi2.add(bk.g);
  const pour = vessel('tube', { level: 0.06, dist: 10 }); G.pbi2.add(pour.g);
  const pp = new Precipitate(K.pipe, { inner: bk.u.inner, floor: bk.u.floor, level: 0.055, colour: PPT_COLOUR.PbI2.hex, t0: 7, T: 9, shimmer: true }); bk.g.add(pp.group);
  const st1 = stream(K, [0.0, 0.11, 0], [0.0, 0.055, 0], 6.6, 8.2); G.pbi2.add(st1.points);

  // ---------------- trio
  const rk = rack(3, 0.045); G.trio.add(rk);
  const trio = [['AgCl', 16.8], ['Cu(OH)2', 18.3], ['BaSO4', 19.8]].map(([f, t0], i) => {
    const v = vessel('tube', { level: 0.09, colour: f === 'Cu(OH)2' ? '#7fb6e8' : '#f6fbff', dist: f === 'Cu(OH)2' ? 0.08 : 10 }); v.g.position.set(rk.userData.x(i), 0.004, 0); G.trio.add(v.g);
    const p = new Precipitate(K.pipe, { inner: v.u.inner, floor: v.u.floor, level: 0.09, colour: PPT_COLOUR[f].hex, t0, T: 7, n: 420 }); v.g.add(p.group);
    const dr = stream(K, [0, 0.16, 0], [0, 0.09, 0], t0 - 0.3, t0 + 0.6); v.g.add(dr.points);
    const t = canvasTex(256, 64, g => { g.fillStyle = '#efe9da'; g.fillRect(0, 0, 256, 64); g.fillStyle = '#111'; g.font = 'bold 34px JetBrains Mono, monospace'; g.fillText(f.replace('2', '₂').replace('4', '₄'), 14, 44); });
    const lab = new THREE.Mesh(new THREE.PlaneGeometry(0.04, 0.01), new THREE.MeshStandardMaterial({ map: t, roughness: 0.7 })); lab.position.set(rk.userData.x(i), 0.068, 0.026); G.trio.add(lab);
    return { v, p, dr };
  });

  // ---------------- holographic solubility table + prediction beakers
  const holo = new THREE.Group(); holo.position.set(0, 0.06, -0.05); holo.rotation.x = -1.0; G.table.add(holo);
  const rows = RULES.map((r, i) => {
    const t = canvasTex(1024, 128, g => { g.clearRect(0, 0, 1024, 128); g.fillStyle = 'rgba(94,231,255,0.10)'; g.fillRect(0, 0, 1024, 128); g.strokeStyle = 'rgba(94,231,255,0.8)'; g.lineWidth = 4; g.strokeRect(2, 2, 1020, 124);
      g.fillStyle = '#e8fbff'; g.font = 'bold 46px JetBrains Mono, monospace'; g.fillText(r.label, 26, 58); g.font = '36px JetBrains Mono, monospace'; g.fillStyle = /insol/i.test(r.rule) ? '#FFB23F' : '#33D17A'; g.fillText(r.rule + (r.except.length ? '  except ' + r.except.map(x => x.replace(/\^.*$/, '')).join(', ') : ''), 26, 106); });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.0375), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: new THREE.Color(0.9, 0.9, 0.9) }));
    m.position.set(0, 0.11 - i * 0.042, 0); holo.add(m); return m;
  });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.28), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.05, 0.25, 0.35), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false })); glow.position.set(0, 0.0, -0.002); holo.add(glow);
  const p1 = vessel('beaker', { level: 0.05, dist: 10, opts: { r: 0.026, h: 0.07, ml: 100, step: 10 } }); p1.g.position.set(0.0, 0, 0.12); G.table.add(p1.g);
  const p2 = vessel('tube', { level: 0.07, dist: 10 }); p2.g.position.set(0.05, 0, 0.13); G.table.add(p2.g);
  const pp2 = new Precipitate(K.pipe, { inner: p1.u.inner, floor: p1.u.floor, level: 0.05, colour: '#f2f2ee', t0: 42.6, T: 5, n: 380 }); p1.g.add(pp2.group);
  const st2 = stream(K, [0.0, 0.1, 0.12], [0.0, 0.05, 0.12], 42.2, 43.4); G.table.add(st2.points);

  // ---------------- particles: Pb2+ and I- lock into a lattice that sinks
  const W = new MolWorld(K.pipe); G.particles.add(W.group);
  const pb = Array.from({ length: 8 }, (_, i) => W.atom('Pb', i < 2 ? '2+' : '')), io = Array.from({ length: 16 }, (_, i) => W.atom('I', i < 3 ? '−' : ''));
  const kk = Array.from({ length: 6 }, (_, i) => W.atom('K', i < 2 ? '+' : '')), no3 = Array.from({ length: 6 }, (_, i) => W.atom('N', i < 2 ? '−' : ''));

  const KEYS = [
    { s: 0, p: [0.26, 0.2, 0.42], l: [0, 0.06, 0], f: 40, ap: 0.015 },
    { s: 6, cut: true, p: [0.16, 0.12, 0.26], l: [0, 0.05, 0], f: 85, ap: 0.05 },
    { s: 11, p: [0.12, 0.09, 0.22], l: [0, 0.04, 0], f: 85, ap: 0.05 },
    { s: 16, cut: true, p: [0.18, 0.2, 0.34], l: [0, 0.1, 0], f: 50, ap: 0.025 },
    { s: 22, p: [0.12, 0.16, 0.26], l: [0, 0.1, 0], f: 70, ap: 0.04 },
    { s: 28, cut: true, p: [0.0, 0.42, 0.36], l: [0, 0.07, -0.05], f: 40, ap: 0.01 },
    { s: 35, p: [0.06, 0.32, 0.3], l: [0, 0.05, -0.05], f: 40, ap: 0.01 },
    { s: 41, cut: true, p: [0.1, 0.1, 0.3], l: [0.01, 0.04, 0.12], f: 85, ap: 0.05 },
    { s: 46, cut: true, p: [0, 0.03, 0.36], l: [0, 0, 0], f: 50, ap: 0.025 },
    { s: 52.5, p: [0.08, 0.0, 0.34], l: [0, -0.02, 0], f: 50, ap: 0.025 }
  ];

  return {
    id: 'r6', root,
    update(s, time, motion) {
      showStages(s, G, R.stages);
      const post = { bloom: { threshold: 2.3, strength: 0.45, radius: 0.5 } };
      let world = 'lab';
      if (G.pbi2.visible) {
        const tip = sm(5.5, 6.8, s) * (1 - sm(8.4, 9.5, s));
        pour.g.position.set(lerp(0.09, 0.03, tip), lerp(0.09, 0.1, tip), 0); pour.g.rotation.z = lerp(0.3, 2.2, tip);
        pour.liq.set(lerp(0.06, 0.01, sm(6.6, 8.2, s)));
        pp.update(s, time); st1.update(s, time); bk.liq.set(0.055, s > 6.6 && s < 8.5 ? 0.0005 : 0, time);
      }
      if (G.trio.visible) for (const t of trio) { t.p.update(s, time); t.dr.update(s, time); }
      if (G.table.visible) {
        const row = Math.min(5, Math.floor(Math.max(0, s - 29) / 2));
        rows.forEach((m, i) => { m.material.opacity = i <= row ? 1 : 0.18; });
        holo.visible = s < 41.5; p1.g.visible = p2.g.visible = s > 40;
        const tip = sm(41.6, 42.3, s) * (1 - sm(43.6, 44.2, s)); p2.g.position.set(lerp(0.05, 0.02, tip), lerp(0, 0.075, tip), 0.12); p2.g.rotation.z = lerp(0, 2.1, tip);
        pp2.update(s, time); st2.update(s, time);
        post.bloom = { threshold: 2.5, strength: 0.4, radius: 0.5 };
      }
      if (G.particles.visible) {
        world = 'micro';
        const lock = sm(47.5, 50, s), sink = sm(50, 52.5, s);
        const dart = (i, ph) => [Math.sin(time * 1.3 + ph * 7) * 0.05 + Math.sin(i * 2.1) * 0.02, Math.cos(time * 1.1 + ph * 5) * 0.03, Math.sin(time * 0.9 + ph * 3) * 0.03];
        pb.forEach((a, i) => { const d = dart(i, i * 0.37), g = [(i % 4 - 1.5) * 0.024, Math.floor(i / 4) * 0.024 - 0.012, 0]; a.set(lerp(d[0], g[0], lock), lerp(d[1], g[1], lock) - sink * 0.05, lerp(d[2], g[2], lock)); });
        io.forEach((a, i) => { const d = dart(i + 9, i * 0.53), g = [(i % 4 - 1.5) * 0.024 + 0.012, Math.floor(i / 4) * 0.012 - 0.018, (i % 2 ? 0.012 : -0.012)]; a.set(lerp(d[0], g[0], lock), lerp(d[1], g[1], lock) - sink * 0.05, lerp(d[2], g[2], lock)); });
        kk.forEach((a, i) => { const d = dart(i + 30, i * 0.71); a.set(d[0] * 1.6, d[1] + 0.03, d[2]); });
        no3.forEach((a, i) => { const d = dart(i + 40, i * 0.91); a.set(d[0] * 1.6, d[1] + 0.04, d[2] + 0.02); });
        W.update(s, time); post.exposure = 1.15;
      }
      const cam = shake(camKF(s, KEYS), time, world === 'lab' ? 0.0005 : 0, motion);
      return { cam, world, post, goggles: [-0.17, 0.13, 0.4], bottles: [-0.22, -0.1], glass: true };
    },
    probe: () => ({ settled: pp.state.settle, sediment: pp.state.sediment, suspended: pp.state.suspended })
  };
}
