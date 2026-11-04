// Reel 7 · Redox: each Mg gives two glowing cyan electrons to oxygen (Mg2+ / O2- badges, electron counter),
// Zn + Cu2+ as redox, the four-nail corrosion time-lapse (procedural rust shader), and methane combustion
// with the air hole closed (yellow) vs open (blue).
import * as THREE from 'three';
import { REELS, PHYS } from './script.js';
import { camKF, sm, lerp, showStages, shake } from './common.js';
import { M, canvasTex } from '../render/materials.js';
import { nail, lumps, bung, Liquid } from '../render/props.js';
import { MolWorld, molecule } from '../fx/molecules.js';
import { vessel, rack, bunsenRig } from './kit.js';

const R = REELS.find(r => r.id === 'r7');
const KINDS = [['dry', 'Dry air'], ['oil', 'Boiled water + oil'], ['tap', 'Tap water'], ['salt', 'Salt water']];

export default function (K) {
  const root = new THREE.Group();
  const G = { electrons: new THREE.Group(), zncu: new THREE.Group(), rust: new THREE.Group(), combust: new THREE.Group() };
  for (const k in G) root.add(G[k]);

  // ---------------- Mg atoms hand electrons to O2
  const W = new MolWorld(K.pipe); G.electrons.add(W.group);
  const mg = [0, 1, 2, 3].map(() => W.atom('Mg'));
  const o2 = [molecule(W, 'O2'), molecule(W, 'O2')];
  const MGP = [[-0.06, 0.025, 0], [-0.06, -0.025, 0], [-0.025, 0.045, 0.01], [-0.025, -0.045, 0.01]];
  const OP = [[0.035, 0.02, 0], [0.035, -0.02, 0]];
  // electron k leaves Mg floor(k/2) at 7 + k*1.3 s and lands on oxygen atom k%4
  const eFn = k => (s) => {
    const t0 = 7 + Math.floor(k / 2) * 2.6 + (k % 2) * 1.3, a = (s - t0) / 1.4; if (a < 0) return null;
    const m = MGP[Math.floor(k / 2)], target = o2[Math.floor((k % 4) / 2)].atoms[k % 2].p;
    if (a >= 1) return null;
    const u = a * a * (3 - 2 * a);
    return [lerp(m[0], target.x, u), lerp(m[1], target.y, u) + Math.sin(u * Math.PI) * 0.025, lerp(m[2], target.z, u) + Math.sin(u * Math.PI * 2) * 0.01];
  };
  W.eFns = Array.from({ length: 8 }, (_, k) => eFn(k));

  // ---------------- Zn surface + Cu2+ ions
  const W2 = new MolWorld(K.pipe); G.zncu.add(W2.group);
  const zn = []; for (let i = 0; i < 12; i++) zn.push(W2.atom('Zn').set((i % 6 - 2.5) * 0.022, -0.03 - Math.floor(i / 6) * 0.02, (i % 2) * 0.008));
  const cu = [0, 1, 2].map(i => W2.atom('Cu', '2+'));
  const so4 = [0, 1, 2].map(i => W2.atom('S', '2−'));

  // ---------------- nails in four test tubes
  const rk = rack(4, 0.045); G.rust.add(rk);
  const tubes = KINDS.map(([kind, label], i) => {
    const water = kind !== 'dry';
    const v = vessel('tube', { level: water ? 0.1 : 0.001, colour: kind === 'salt' ? '#eef6f9' : '#f6fbff', dist: 6 }); v.g.position.set(rk.userData.x(i), 0.004, 0); if (!water) v.liq.mesh.visible = false; G.rust.add(v.g);
    const n = nail(0.075); n.position.set(0, 0.012, 0); n.rotation.z = 0.05; v.g.add(n);
    if (kind === 'oil') { const oil = new Liquid(v.u.inner, 0.1, '#e8c25a', 0.04); oil.set(0.112); v.g.add(oil.mesh); }
    if (kind === 'dry' || kind === 'oil') { const b = bung(0.0095, 0.018); b.position.y = 0.152; v.g.add(b); }
    if (kind === 'dry') { const cc = lumps(14, 0.003, M.whitePlastic, 0.004, 3); cc.position.y = 0.004; v.g.add(cc); }
    const t = canvasTex(256, 64, g => { g.fillStyle = '#efe9da'; g.fillRect(0, 0, 256, 64); g.fillStyle = '#111'; g.font = 'bold 26px Archivo, Arial'; g.fillText(label, 10, 42); });
    const lab = new THREE.Mesh(new THREE.PlaneGeometry(0.042, 0.0105), new THREE.MeshStandardMaterial({ map: t, roughness: 0.7 })); lab.position.set(rk.userData.x(i), 0.072, 0.026); G.rust.add(lab);
    n.userData.rust.uWaterline.value = water ? 0.088 : -1; n.userData.rust.uWet.value = water ? 1 : 0;
    return { kind, v, n };
  });

  // ---------------- Bunsen combustion
  const bun = bunsenRig(); G.combust.add(bun.group);
  const collarMark = new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.0012, 8, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.88, 0.3).multiplyScalar(2) })); collarMark.rotation.x = Math.PI / 2; collarMark.position.set(bun.top.x, 0.035, bun.top.z); G.combust.add(collarMark);

  const KEYS = [
    { s: 0, p: [0, 0.03, 0.26], l: [-0.01, 0, 0], f: 50, ap: 0.03 },
    { s: 12, p: [0.05, 0.05, 0.22], l: [-0.01, 0, 0], f: 50, ap: 0.03 },
    { s: 20, p: [0.04, 0.06, 0.2], l: [-0.01, 0, 0], f: 50, ap: 0.03 },
    { s: 20, cut: true, p: [0.0, 0.03, 0.22], l: [0, -0.01, 0], f: 50, ap: 0.03 },
    { s: 26.5, p: [0.05, 0.02, 0.2], l: [0, -0.01, 0], f: 50, ap: 0.03 },
    { s: 26.5, cut: true, p: [0.22, 0.2, 0.38], l: [0, 0.08, 0], f: 50, ap: 0.02 },
    { s: 33, p: [0.12, 0.17, 0.27], l: [0, 0.09, 0], f: 60, ap: 0.03 },
    { s: 37, cut: true, p: [0.12, 0.034, 0.11], l: [0.067, 0.033, 0], f: 100, ap: 0.06 },
    { s: 40.5, p: [0.1, 0.036, 0.1], l: [0.067, 0.033, 0], f: 100, ap: 0.06 },
    { s: 40.5, cut: true, p: [0.1, 0.15, 0.17], l: [0.067, 0.09, 0], f: 85, ap: 0.05 },
    { s: 44, p: [0.08, 0.15, 0.16], l: [0.067, 0.09, 0], f: 85, ap: 0.05 },
    { s: 44, cut: true, p: [0.2, 0.18, 0.4], l: [bun.top.x, 0.17, bun.top.z], f: 60, ap: 0.03 },
    { s: 50, p: [0.12, 0.2, 0.3], l: [bun.top.x, 0.19, bun.top.z], f: 85, ap: 0.04 },
    { s: 54, p: [0.1, 0.19, 0.25], l: [bun.top.x, 0.18, bun.top.z], f: 85, ap: 0.04 },
    { s: 60, p: [0.18, 0.2, 0.34], l: [bun.top.x, 0.18, bun.top.z], f: 60, ap: 0.03 }
  ];

  return {
    id: 'r7', root,
    update(s, time, motion) {
      showStages(s, G, R.stages);
      const post = { bloom: { threshold: 2.2, strength: 0.55, radius: 0.55 } };
      let world = 'lab', warm = null;
      if (G.electrons.visible) {
        world = 'micro';
        const form = sm(17.5, 19.5, s);
        mg.forEach((a, i) => { const lost = s > 7 + i * 2.6 + 2.7; a.setCharge(lost ? '2+' : ''); const m = MGP[i]; a.set(lerp(m[0], m[0] + 0.03, form), m[1], m[2]); });
        o2.forEach((m, j) => { m.place(OP[j][0] - form * 0.01, OP[j][1], OP[j][2], 1, 0, 0); const got = s > 7 + (j ? 3 : 2) * 2.6 + 2.7; m.atoms.forEach(a => a.setCharge(got ? '2−' : '')); m.bonds[0].k = got ? 0 : 1; if (got) { m.atoms[0].p.y += 0.012; m.atoms[1].p.y -= 0.012; } });
        W.group.rotation.y = Math.sin(s * 0.2) * 0.3;
        W.update(s, time); post.exposure = 1.15; post.bloom = { threshold: 1.6, strength: 0.75, radius: 0.6 };
      }
      if (G.zncu.visible) {
        world = 'micro';
        cu.forEach((a, i) => { const u = sm(21 + i * 1.3, 22.4 + i * 1.3, s); a.set(lerp((i - 1) * 0.03, (i - 1) * 0.022 + 0.011, u), lerp(0.04, -0.012, u), 0.0); a.setCharge(u > 0.9 ? '' : '2+'); });
        so4.forEach((a, i) => a.set((i - 1) * 0.04 + Math.sin(time + i) * 0.004, 0.06 + Math.cos(time * 0.8 + i) * 0.004, -0.02));
        zn.forEach((a, i) => { const leave = i < 3 ? sm(21.2 + i * 1.3, 23 + i * 1.3, s) : 0; a.setCharge(leave > 0.1 ? '2+' : ''); const b = [(i % 6 - 2.5) * 0.022, -0.03 - Math.floor(i / 6) * 0.02]; a.set(b[0] + leave * 0.01, b[1] + leave * 0.05, (i % 2) * 0.008 + leave * 0.03); });
        W2.eFns = [0, 1, 2].flatMap(i => [0, 1].map(k => (ss) => { const a = sm(21 + i * 1.3 + k * 0.2, 22.2 + i * 1.3 + k * 0.2, ss); if (a <= 0 || a >= 1) return null; const z = zn[i].p, c = cu[i].p; return [lerp(z.x, c.x, a), lerp(z.y, c.y, a) + Math.sin(a * Math.PI) * 0.01, lerp(z.z, c.z, a)]; }));
        W2.update(s, time); post.exposure = 1.15; post.bloom = { threshold: 1.6, strength: 0.75, radius: 0.6 };
      }
      if (G.rust.visible) {
        const days = PHYS.rustDays(s);
        for (const t of tubes) { t.n.userData.rust.uRust.value = PHYS.rustCoverage(t.kind, days); t.v.liq.set(t.kind === 'dry' ? 0.001 : 0.1); }
      }
      if (G.combust.visible) {
        const air = sm(50.3, 51.2, s); bun.set(air, 1, time); collarMark.visible = s > 49.5 && s < 52;
        warm = { i: 0.3 * (1 - air) + 0.1, p: [bun.top.x, 0.2, bun.top.z] };
        post.shimmer = { x: 0.5, y: 0.25, w: 0.12, h: 0.35, amp: 0.5 + air * 0.3 };
        post.bloom = { threshold: 1.6, strength: 0.7, radius: 0.6 };
      }
      const cam = shake(camKF(s, KEYS), time, world === 'lab' ? 0.0005 : 0, motion);
      return { cam, world, post, warm, goggles: [-0.16, 0.13, 0.5], glass: true };
    },
    probe: () => ({ salt: PHYS.rustCoverage('salt', 7), tap: PHYS.rustCoverage('tap', 7), dry: PHYS.rustCoverage('dry', 7), oil: PHYS.rustCoverage('oil', 7) })
  };
}
