// Reel 5 · Neutralisation: burette titration with universal indicator (red → green at the neutral point,
// diffusion swirls at each drop), salt crystals on a watch glass; CuO dissolving in warm acid → blue;
// marble chips fizzing; bicarb fizzing over; pH 1–14 glass vials; H+ + OH- → H2O partner swap.
import * as THREE from 'three';
import { REELS, PHYS } from './script.js';
import { camKF, sm, lerp, showStages, shake, uiColour, UI_COL } from './common.js';
import { M, canvasTex, rng } from '../render/materials.js';
import { model, lumps, gauze, tube, Liquid } from '../render/props.js';
import { Bubbles } from '../fx/bubbles.js';
import { dye, plume, hh } from '../fx/smoke.js';
import { MolWorld, molecule } from '../fx/molecules.js';
import { vessel, bunsenRig, clampArm } from './kit.js';
import { LAYER_GLASS } from '../render/pipeline.js';

const R = REELS.find(r => r.id === 'r5');

export default function (K) {
  const root = new THREE.Group();
  const G = { titration: new THREE.Group(), cuo: new THREE.Group(), marble: new THREE.Group(), bicarb: new THREE.Group(), ui: new THREE.Group(), particles: new THREE.Group() };
  for (const k in G) root.add(G[k]);

  // ---------------- titration
  const stand = model('retort'); stand.position.set(-0.04, 0, -0.07); G.titration.add(stand);
  const bur = model('burette'); bur.position.set(0, 0.17, 0); G.titration.add(bur);
  G.titration.add(clampArm([-0.07, 0.55, -0.07], [0, 0.55, 0]));
  const fl = vessel('conical', { level: 0.04, colour: '#e3262b', dist: 0.06 }); fl.g.position.set(0, 0.0, 0); G.titration.add(fl.g);
  const tile = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.006, 0.15), M.whitePlastic); tile.position.y = 0.003; G.titration.add(tile); fl.g.position.y = 0.006;
  const dropGeo = new THREE.SphereGeometry(1, 16, 12);
  const drop = new THREE.Mesh(dropGeo, M.glass); drop.layers.set(LAYER_GLASS); drop.scale.set(0.0018, 0.0024, 0.0018); G.titration.add(drop);
  const swirl = dye(K.pipe, { n: 500, origin: [0, 0.042, 0], radius: 0.03, floor: 0.004, top: 0.042, prog: s => (s % 1.1) / 1.1 * (s > 3 && s < 15 ? 1 : 0), colour: (i, o, q) => { const c = uiColour(PHYS.titrationPH(0) + 0, THREE); o.r = 0.25; o.g = 0.65; o.b = 0.35; }, alpha: 0.18, size: 0.006 });
  fl.g.add(swirl.points);
  const watch = new THREE.Mesh(new THREE.SphereGeometry(0.04, 40, 12, 0, Math.PI * 2, Math.PI * 0.82, Math.PI * 0.18), M.glassThick); watch.layers.set(LAYER_GLASS); watch.position.set(0.14, 0.039, 0.06); G.titration.add(watch);
  const salt = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.15, transmission: 0.6, thickness: 0.002, ior: 1.54 }), 40);
  { const o = new THREE.Object3D(), r = rng(9); for (let i = 0; i < 40; i++) { o.position.set((r() - 0.5) * 0.02, 0.0015, (r() - 0.5) * 0.02); o.rotation.y = r() * 1.6; o.scale.setScalar(0.0009 + r() * 0.0014); o.updateMatrix(); salt.setMatrixAt(i, o.matrix); } }
  salt.position.set(0.14, 0.0015, 0.06); salt.frustumCulled = false; G.titration.add(salt);

  // ---------------- CuO in warm acid on tripod + gauze
  const bun = bunsenRig(); G.cuo.add(bun.group);
  const tri = model('tripod'); G.cuo.add(tri); const gz = gauze(0.13); gz.position.y = 0.222; G.cuo.add(gz);
  const cuB = vessel('beaker', { level: 0.05, colour: '#f2f8fb', dist: 2 }); cuB.g.position.y = 0.223; G.cuo.add(cuB.g);
  const cuo = lumps(90, 0.0016, M.cuOxide, 0.02, 31, 'grain'); cuo.position.y = cuB.u.floor; cuB.g.add(cuo);
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.0025, 0.0025, 0.16, 12), M.glassThick); rod.layers.set(LAYER_GLASS); cuB.g.add(rod);
  const blueSw = dye(K.pipe, { n: 500, origin: [0, 0.04, 0], radius: 0.03, floor: cuB.u.floor, top: 0.05, prog: s => PHYS.cuoDissolve(s), colour: (i, o) => { o.r = 0.18; o.g = 0.5; o.b = 0.95; }, alpha: 0.12, size: 0.007 });
  cuB.g.add(blueSw.points);

  // ---------------- marble chips + HCl, bicarb + HCl
  const mb = vessel('beaker', { level: 0.05, dist: 8 }); G.marble.add(mb.g);
  const chips = lumps(18, 0.005, M.marble, 0.022, 4); chips.position.y = mb.u.floor; mb.g.add(chips);
  const mbBub = new Bubbles({ n: 200, life: 0.9, size: 0.001, rise: 0.07, surface: () => 0.05, radius: y => mb.u.inner(y), rate: s => sm(28.4, 29.2, s) * 0.85,
    site: (j, k, v) => { const a = (j * 2.4 + k * 0.7) % 6.28, r = ((j * 7 + k) % 13) / 13 * 0.022; v.set(Math.cos(a) * r, mb.u.floor + 0.004 + ((j + k) % 5) * 0.0015, Math.sin(a) * r); } });
  mb.g.add(mbBub.group);
  const bc = vessel('beaker', { level: 0.04, dist: 8 }); G.bicarb.add(bc.g);
  const powder = lumps(220, 0.0012, M.zincCarb, 0.02, 12, 'grain'); powder.position.y = bc.u.floor; bc.g.add(powder);
  const bcBub = new Bubbles({ n: 320, life: 0.6, size: 0.0012, rise: 0.1, surface: s => lerp(0.04, 0.085, sm(36.6, 39, s)) , radius: y => bc.u.inner(y), rate: s => sm(36.5, 37, s),
    site: (j, k, v) => { const a = (j * 2.4 + k * 0.7) % 6.28, r = ((j * 7 + k) % 13) / 13 * 0.024; v.set(Math.cos(a) * r, bc.u.floor + 0.003, Math.sin(a) * r); } });
  bc.g.add(bcBub.group);
  const foam = plume(K.pipe, { n: 260, origin: [0, 0.07, 0], density: s => sm(37, 38, s), col: [0.98, 0.98, 0.98], alpha: 0.35, size: 0.006, rise: 0.012, spread: 0.02, life: 2.2, grow: 1.2, lit: false });
  bc.g.add(foam.points);

  // ---------------- pH 1–14 vials
  const vials = UI_COL.map((c, i) => { const v = vessel('tube', { level: 0.08, colour: c, dist: 0.03, opts: { h: 0.1 } }); v.g.position.set((i - 6.5) * 0.026, 0, 0); G.ui.add(v.g);
    const t = canvasTex(64, 64, g => { g.fillStyle = '#fff'; g.font = 'bold 34px JetBrains Mono, monospace'; g.textAlign = 'center'; g.fillText(String(i + 1), 32, 44); });
    const lab = new THREE.Mesh(new THREE.PlaneGeometry(0.012, 0.012), new THREE.MeshBasicMaterial({ map: t, transparent: true })); lab.position.set((i - 6.5) * 0.026, -0.0, 0.03); lab.rotation.x = -Math.PI / 2; G.ui.add(lab); return v; });
  const uiStand = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.012, 0.035), M.wood); uiStand.position.y = 0.006; G.ui.add(uiStand);
  vials.forEach(v => v.g.position.y = 0.012);

  // ---------------- particles: partner swap
  const W = new MolWorld(K.pipe); G.particles.add(W.group);
  const na = W.atom('Na', '+'), cl = W.atom('Cl', '−');
  const oh = molecule(W, 'OH', { 0: '−' }); const hp = W.atom('H', '+');
  const bOH2 = W.bond(oh.atoms[0], hp);

  const KEYS = [
    { s: 0, p: [0.3, 0.3, 0.55], l: [0, 0.2, 0], f: 35, ap: 0.01 },
    { s: 3.5, cut: true, p: [0.04, 0.15, 0.12], l: [0, 0.16, 0], f: 100, ap: 0.08 },
    { s: 6, p: [0.06, 0.08, 0.16], l: [0, 0.05, 0], f: 85, ap: 0.06 },
    { s: 13, p: [0.08, 0.09, 0.2], l: [0, 0.04, 0], f: 85, ap: 0.05 },
    { s: 15, cut: true, p: [0.19, 0.08, 0.13], l: [0.14, 0.04, 0.06], f: 100, ap: 0.08 },
    { s: 18, cut: true, p: [0.3, 0.36, 0.42], l: [0, 0.22, 0], f: 50, ap: 0.03 },
    { s: 23, p: [0.13, 0.31, 0.22], l: [0, 0.255, 0], f: 85, ap: 0.05 },
    { s: 28, cut: true, p: [0.1, 0.08, 0.17], l: [0, 0.035, 0], f: 100, ap: 0.07 },
    { s: 36, cut: true, p: [0.12, 0.1, 0.2], l: [0, 0.05, 0], f: 85, ap: 0.05 },
    { s: 44, cut: true, p: [0.0, 0.12, 0.42], l: [0, 0.05, 0], f: 60, ap: 0.02 },
    { s: 50, p: [0.05, 0.1, 0.38], l: [0, 0.05, 0], f: 60, ap: 0.02 },
    { s: 50, cut: true, p: [0, 0.02, 0.24], l: [0, 0, 0], f: 50, ap: 0.03 },
    { s: 60, p: [0.05, 0.03, 0.22], l: [0, 0, 0], f: 50, ap: 0.03 }
  ];
  const col = new THREE.Color();

  return {
    id: 'r5', root,
    update(s, time, motion) {
      showStages(s, G, R.stages);
      const post = { bloom: { threshold: 2.3, strength: 0.45, radius: 0.5 } };
      let world = 'lab', warm = null;
      if (G.titration.visible) {
        const ph = PHYS.titrationPH(s); col.copy(uiColour(ph, THREE));
        fl.liq.colour(col, 0.1);
        const period = 1.1, ph2 = ((s - 3) % period) / period, dropping = s > 3 && s < 14.5;
        drop.visible = dropping; drop.position.set(0, lerp(0.168, 0.05, ph2 * ph2), 0);
        swirl.fn = swirl.fn; swirl.update(s, time);
        const next = uiColour(Math.min(7, ph + 1.2), THREE);
        swirl.points.geometry.attributes.color.array.fill(0); for (let i = 0; i < swirl.n; i++) { swirl.col[i * 3] = next.r; swirl.col[i * 3 + 1] = next.g; swirl.col[i * 3 + 2] = next.b; }
        swirl.points.geometry.attributes.color.needsUpdate = true;
        fl.liq.set(0.04 + sm(3, 14, s) * 0.006, 0.0003 * (1 - ph2), ph2 * 6);
        salt.visible = s > 15; watch.visible = true;
      }
      if (G.cuo.visible) {
        bun.set(1, 1, time); warm = { i: 0.12, p: [0, 0.18, 0] };
        const d = PHYS.cuoDissolve(s); cuB.liq.colour(new THREE.Color('#f2f8fb').lerp(new THREE.Color('#5fb2ff'), d), lerp(2, 0.09, d));
        const o = new THREE.Object3D(); const ang = s * 4;
        rod.position.set(Math.cos(ang) * 0.012, 0.075, Math.sin(ang) * 0.012); rod.rotation.set(Math.sin(ang) * 0.25, 0, Math.cos(ang) * 0.25);
        cuo.scale.setScalar(Math.max(0.001, 1 - d)); cuo.rotation.y = ang * 0.3; blueSw.update(s, time);
        cuB.liq.set(0.05, 0.0004, time * 3);
        post.shimmer = { x: 0.5, y: 0.3, w: 0.15, h: 0.2, amp: 0.4 }; void o;
      }
      if (G.marble.visible) { mbBub.update(s); mb.liq.set(0.05, 0.0005 * Math.min(1, mbBub.count / 80), time); }
      if (G.bicarb.visible) { bcBub.update(s); foam.update(s, time); bc.liq.set(lerp(0.04, 0.07, sm(36.6, 38.5, s)), 0.0008, time); }
      if (G.particles.visible) {
        world = 'micro';
        const u = sm(52, 55, s), dr = sm(55, 60, s);
        na.set(lerp(-0.05, -0.06, u) - dr * 0.02, lerp(0.02, 0.035, u) + Math.sin(time) * 0.002, lerp(0, -0.02, u));
        oh.place(lerp(-0.025, -0.006, u), lerp(0.02, 0.0, u), 0, 1, 0, 0);
        hp.set(lerp(0.03, 0.006, u), lerp(-0.02, -0.005, u), 0);
        cl.set(lerp(0.05, 0.06, u) + dr * 0.02, lerp(-0.02, -0.035, u) + Math.sin(time + 1) * 0.002, lerp(0, -0.02, u));
        oh.atoms[0].setCharge(u > 0.8 ? '' : '−'); hp.setCharge(u > 0.8 ? '' : '+'); bOH2.k = u > 0.8 ? 1 : 0;
        W.flashFns = [s2 => { const a = s2 - 54.6; if (a < 0 || a > 0.6) return null; return [0, -0.003, 0, 0.03 * (1 + a), (1 - a / 0.6) * 0.6, 1.5, 2.5, 3.5]; }];
        W.update(s, time); post.exposure = 1.15;
      }
      const cam = shake(camKF(s, KEYS), time, world === 'lab' ? 0.0005 : 0, motion);
      return { cam, world, post, warm, goggles: [-0.18, 0.14, 0.5], bottles: [-0.2, -0.08], glass: true };
    },
    probe: () => ({ phEnd: PHYS.titrationPH(14.5), neutral: uiColour(7, THREE).getHexString() })
  };
}
