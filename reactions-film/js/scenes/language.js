// Reel 1 · The language of chemistry: molecules assemble atom by atom (formula counter), the equation
// scale (balance with coefficients, the subscript fail state), and conservation of mass on a balance.
import * as THREE from 'three';
import { REELS, MODELS, R1_STEPS, r1Step, PHYS } from './script.js';
import { camKF, sm, lerp, showStages, shake, clamp } from './common.js';
import { MolWorld, molecule } from '../fx/molecules.js';
import { M, canvasTex } from '../render/materials.js';
import { balance, conical, beaker, balloon, lumps, Liquid } from '../render/props.js';
import { Bubbles } from '../fx/bubbles.js';
import { LAYER_GLASS } from '../render/pipeline.js';

const R = REELS.find(r => r.id === 'r1');

export default function (K) {
  const root = new THREE.Group();
  const G = { models: new THREE.Group(), scale: new THREE.Group(), mass: new THREE.Group() };
  for (const k in G) root.add(G[k]);

  // ---------------- models: molecules assemble atom by atom
  const W = new MolWorld(K.pipe); G.models.add(W.group);
  const mols = MODELS.slice(0, 5).map(m => ({ ...m, mol: molecule(W, m.f) }));
  const latW = new MolWorld(K.pipe); latW.fill = 1; G.models.add(latW.group);
  const lattice = [];
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) { const na = (x + y + z + 3) % 2 === 0; lattice.push({ a: latW.atom(na ? 'Na' : 'Cl', ''), x, y, z, na }); }

  // ---------------- scale: balance beam with molecules on each pan
  const SW = new MolWorld(K.pipe); G.scale.add(SW.group);
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.006, 0.09, 20), M.steel); stand.position.y = -0.045; G.scale.add(stand);
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.034, 0.006, 32), M.castIron); foot.position.y = -0.09; G.scale.add(foot);
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.004, 0.006), M.steel); G.scale.add(beam);
  const panGeo = new THREE.LatheGeometry([new THREE.Vector2(0.0001, 0), new THREE.Vector2(0.05, 0.0), new THREE.Vector2(0.056, 0.008), new THREE.Vector2(0.055, 0.009), new THREE.Vector2(0.049, 0.0015), new THREE.Vector2(0.0001, 0.0015)], 48);
  const pans = [-1, 1].map(() => { const p = new THREE.Mesh(panGeo, M.glassThick); p.layers.set(LAYER_GLASS); G.scale.add(p); return p; });
  const strings = [-1, 1].map(() => { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.0004, 0.0004, 1, 6), M.steel); G.scale.add(l); return l; });
  const pool = {}; const need = { H2: 2, O2: 2, H2O: 2, H2O2: 1, CH4: 1, CO2: 1 };
  for (const k in need) pool[k] = Array.from({ length: need[k] }, () => molecule(SW, k));
  const xTex = canvasTex(128, 128, g => { g.strokeStyle = '#ff4859'; g.lineWidth = 18; g.lineCap = 'round'; g.beginPath(); g.moveTo(24, 24); g.lineTo(104, 104); g.moveTo(104, 24); g.lineTo(24, 104); g.stroke(); });
  const redX = new THREE.Sprite(new THREE.SpriteMaterial({ map: xTex, transparent: true, depthTest: false })); redX.scale.setScalar(0.05); redX.renderOrder = 9; G.scale.add(redX);

  // ---------------- mass: sealed flask with balloon, then open beaker
  const bal = balance(); G.mass.add(bal);
  const flask = conical(); flask.position.set(0, bal.userData.panTop, -0.02); G.mass.add(flask);
  const fl = new Liquid(flask.userData.inner, flask.userData.floor, '#f4fbff', 6); fl.set(0.045); flask.add(fl.mesh);
  const chipsF = lumps(14, 0.0045, M.marble, 0.022, 3); chipsF.position.y = flask.userData.floor; flask.add(chipsF);
  const bln = balloon(0xff6a2a); bln.position.y = flask.userData.top - 0.004; flask.add(bln);
  const bubF = new Bubbles({ n: 90, life: 1.2, size: 0.0009, rise: 0.05, surface: () => 0.045, radius: y => flask.userData.inner(y), rate: s => clamp((s - 38.5) / 2) * 0.9,
    site: (j, k, v) => { const a = (j * 2.4 + k) % 6.28, r = 0.004 + ((j * 7 + k) % 13) / 13 * 0.018; v.set(Math.cos(a) * r, flask.userData.floor + 0.006, Math.sin(a) * r); } });
  flask.add(bubF.group);
  const bk = beaker(); bk.position.set(0, bal.userData.panTop, -0.02); G.mass.add(bk);
  const bl = new Liquid(bk.userData.inner, bk.userData.floor, '#f4fbff', 6); bl.set(0.05); bk.add(bl.mesh);
  const chipsB = lumps(16, 0.0045, M.marble, 0.024, 9); chipsB.position.y = bk.userData.floor; bk.add(chipsB);
  const bubB = new Bubbles({ n: 160, life: 1.0, size: 0.001, rise: 0.06, surface: () => 0.05, radius: y => bk.userData.inner(y), rate: s => clamp((s - 44.5) / 1.5) * (1 - clamp((s - 51) / 2)) * 0.95,
    site: (j, k, v) => { const a = (j * 2.4 + k) % 6.28, r = 0.003 + ((j * 7 + k) % 13) / 13 * 0.02; v.set(Math.cos(a) * r, bk.userData.floor + 0.006, Math.sin(a) * r); } });
  bk.add(bubB.group);

  function updModels(s, time) {
    const m = mols;
    for (let i = 0; i < m.length; i++) {
      const it = m[i], next = m[i + 1] ? m[i + 1].at : 16;
      if (s < it.at) { it.mol.hide(); continue; }
      const gallery = s >= next;
      if (!gallery) {
        // assemble: each atom flies in from far away, staggered
        const n = it.mol.atoms.length;
        const ry = (s - it.at) * 0.6;
        it.mol.place(0, 0, 0, 1, ry, 0.2);
        it.mol.atoms.forEach((a, j) => { const u = sm(it.at + j * 0.28, it.at + j * 0.28 + 0.9, s); const ang = j * 2.1 + i; const far = 0.16 * (1 - u); a.p.set(a.p.x + Math.cos(ang) * far, a.p.y + Math.sin(ang * 1.3) * far * 0.6, a.p.z + Math.sin(ang) * far); a.scale = u; });
        it.mol.bonds.forEach(b => { b.k = Math.min(b.a.scale, b.b.scale) > 0.98 ? 1 : 0; });
      } else {
        const u = sm(next, next + 1, s);
        const gx = -0.075 + i * 0.03, gy = 0.045, gz = -0.05;
        it.mol.place(lerp(0, gx, u), lerp(0, gy, u), lerp(0, gz, u), lerp(1, 0.55, u), (s - it.at) * 0.4, 0.2);
      }
    }
    W.fill = sm(10.2, 11.2, s) * (1 - sm(12.4, 13.4, s));
    const lt = sm(16, 18.5, s);
    lattice.forEach((q, i) => { const d = 0.0215; const u = sm(16 + i * 0.06, 16.6 + i * 0.06, s); q.a.set(q.x * d, q.y * d - 0.005 + (1 - u) * 0.08, q.z * d, u * (s >= 16 ? 1 : 0)); });
    latW.group.rotation.y = s * 0.25; latW.group.position.set(0.0, 0, 0);
    W.update(s, time); latW.update(s, time); void lt;
  }

  function placeSide(list, coefs, cx, y, s, t0) {
    const used = {};
    let idx = 0; const total = coefs.reduce((a, b) => a + b, 0);
    list.forEach((f, i) => {
      for (let c = 0; c < coefs[i]; c++) {
        const k = used[f] = (used[f] || 0); used[f]++;
        const mol = pool[f][k]; if (!mol) continue;
        const off = (idx - (total - 1) / 2) * 0.03; idx++;
        const pop = sm(t0, t0 + 0.5, s);
        mol.place(cx + off, y + 0.016, (idx % 2) * 0.006, k > 0 ? pop : 1, s * 0.5 + idx, 0.3);
      }
    });
    return used;
  }
  function updScale(s, time) {
    for (const k in pool) for (const m of pool[k]) m.hide();
    const st = r1Step(s);
    const nL = st.L.length;
    const count = (fs, cs) => fs.reduce((a, f, i) => a + (pool[f][0] ? pool[f][0].atoms.length : 0) * cs[i], 0);
    const aL = count(st.L, st.c.slice(0, nL)), aR = count(st.R, st.c.slice(nL));
    const tilt = clamp((aL - aR) * 0.03, -0.18, 0.18);
    beam.rotation.z = tilt;
    const ends = [-0.1, 0.1].map(x => new THREE.Vector3(x * Math.cos(tilt), x * Math.sin(tilt), 0));
    pans.forEach((p, i) => { p.position.set(ends[i].x, ends[i].y - 0.06, 0); const l = strings[i]; l.position.set(ends[i].x, ends[i].y - 0.03, 0); l.scale.y = 0.06; });
    placeSide(st.L, st.c.slice(0, nL), ends[0].x, ends[0].y - 0.06, s, st.at);
    placeSide(st.R, st.c.slice(nL), ends[1].x, ends[1].y - 0.06, s, st.at);
    redX.visible = !!st.fail; redX.position.set(ends[1].x, ends[1].y - 0.005, 0.02);
    SW.update(s, time);
  }

  function updMass(s, time) {
    const sealed = s < 44;
    flask.visible = sealed; bk.visible = !sealed;
    const g = sealed ? PHYS.sealedMass(s) : PHYS.openMass(s);
    const flick = !sealed && s < 51 && Math.sin(time * 11) > 0.7 ? 0.01 : 0;
    bal.userData.show((g + flick).toFixed(2));
    const inflate = sm(38.5, 43.5, s); bln.scale.set(0.18 + 0.22 * inflate, 0.18 + 0.28 * inflate, 0.18 + 0.22 * inflate);
    bubF.update(s); bubB.update(s);
    fl.set(0.045, 0.0003 * Math.min(1, bubF.count / 60), time); bl.set(0.05, 0.0004 * Math.min(1, bubB.count / 90), time);
  }

  const KEYS = [
    { s: 0, p: [0.05, 0.03, 0.2], l: [0, 0, 0], f: 50, ap: 0.05 },
    { s: 9, p: [0.12, 0.05, 0.13], l: [0, 0.004, 0], f: 60, ap: 0.06 },
    { s: 15.8, p: [-0.06, 0.035, 0.15], l: [-0.01, 0.008, 0], f: 55, ap: 0.05 },
    { s: 16.0, cut: true, p: [0.2, 0.13, 0.26], l: [0, 0, 0], f: 50, ap: 0.03 },
    { s: 20.5, p: [0.16, 0.15, 0.24], l: [0, 0, 0], f: 50, ap: 0.03 },
    { s: 20.5, cut: true, p: [0, 0.03, 0.3], l: [0, -0.02, 0], f: 40, ap: 0.02 },
    { s: 29, p: [0.06, 0.02, 0.26], l: [0.04, -0.04, 0], f: 50, ap: 0.03 },
    { s: 33, p: [-0.03, 0.04, 0.3], l: [0, -0.03, 0], f: 40, ap: 0.02 },
    { s: 38, cut: true, p: [0.55, 0.32, 0.7], l: [0, 0.09, 0], f: 35, ap: 0.01 },
    { s: 41.5, p: [0.3, 0.2, 0.48], l: [0, 0.1, 0], f: 50, ap: 0.03 },
    { s: 44, cut: true, p: [0.05, 0.1, 0.27], l: [0, 0.05, 0.05], f: 85, ap: 0.08, fd: 0.24 },
    { s: 48, p: [0.12, 0.13, 0.26], l: [0, 0.07, 0], f: 85, ap: 0.08 },
    { s: 52.5, p: [0.2, 0.16, 0.3], l: [0, 0.07, 0], f: 60, ap: 0.05 }
  ];

  return {
    id: 'r1', root,
    update(s, time, motion) {
      showStages(s, G, R.stages);
      if (G.models.visible) updModels(s, time);
      if (G.scale.visible) updScale(s, time);
      if (G.mass.visible) updMass(s, time);
      const world = s < R.stages.mass[0] ? 'micro' : 'lab';
      const cam = shake(camKF(s, KEYS), time, world === 'lab' ? 0.0004 : 0, motion);
      return { cam, world, post: { bloom: { threshold: 2.5, strength: 0.4, radius: 0.5 }, exposure: world === 'micro' ? 1.15 : 1.0 }, glass: G.mass.visible || G.scale.visible };
    },
    probe: () => ({ sealed: PHYS.sealedMass(40), open: PHYS.openMass(52.5) })
  };
}
