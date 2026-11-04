// Reel 3 · Decomposition: ZnCO3 heated in a clamped boiling tube over a blue Bunsen flame, gas through a
// delivery tube into limewater (goes milky), ZnO yellow when hot / white when cool; CO3^2- splitting at
// particle level; CuCO3 green → black; H2O2 decomposing slowly.
import * as THREE from 'three';
import { REELS, PHYS } from './script.js';
import { camKF, sm, lerp, showStages, shake, clamp } from './common.js';
import { M } from '../render/materials.js';
import { model, deliveryTube, bung } from '../render/props.js';
import { Bubbles } from '../fx/bubbles.js';
import { dye } from '../fx/smoke.js';
import { MolWorld, molecule } from '../fx/molecules.js';
import { bunsenRig, vessel, rack, clampArm } from './kit.js';

const R = REELS.find(r => r.id === 'r3');

export default function (K) {
  const root = new THREE.Group();
  const G = { heat: new THREE.Group(), particles: new THREE.Group(), apps: new THREE.Group() };
  for (const k in G) root.add(G[k]);

  // ---------------- heating rig
  const bun = bunsenRig(); bun.group.position.set(0.0, 0, 0); G.heat.add(bun.group);
  const stand = model('retort'); stand.position.set(-0.02, 0, -0.17); G.heat.add(stand);
  const tilt = -1.15, tubeBase = new THREE.Vector3(bun.top.x + 0.004, 0.235, bun.top.z);
  const bt = vessel('boiling', { level: 0.001 }); bt.liq.mesh.visible = false;
  const tubeG = new THREE.Group(); tubeG.position.copy(tubeBase); tubeG.rotation.z = tilt; tubeG.add(bt.g); G.heat.add(tubeG);
  const powder = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), M.zincCarb.clone());
  powder.scale.set(0.0105, 0.004, 0.032); powder.rotation.set(-Math.PI / 2, 0, 0); powder.rotation.set(0, 0, 0);
  const pw = new THREE.Group(); pw.add(powder); powder.scale.set(0.0105, 0.0055, 0.0105); powder.position.y = 0.0;
  const pile = new THREE.Mesh(new THREE.CylinderGeometry(0.0108, 0.0108, 0.04, 20, 1, false, Math.PI * 0.15, Math.PI * 0.7), powder.material); pile.position.set(0, 0.026, 0); pile.rotation.y = Math.PI * 0.5; tubeG.add(pile);
  const plug = bung(0.0135, 0.022); plug.position.set(0, 0.155, 0); tubeG.add(plug);
  const mouth = new THREE.Vector3(0, 0.162, 0).applyEuler(new THREE.Euler(0, 0, tilt)).add(tubeBase);
  const lime = vessel('tube', { level: 0.11, colour: '#fbfdff', dist: 8 }); lime.g.position.set(0.38, 0.0, 0.0); G.heat.add(lime.g);
  const rk = rack(3); rk.position.set(0.38 - rk.userData.x(1), 0, 0); G.heat.add(rk);
  const dt = deliveryTube([[mouth.x, mouth.y, mouth.z], [mouth.x + 0.06, mouth.y + 0.035, 0], [0.32, mouth.y + 0.03, 0], [0.38, mouth.y - 0.02, 0], [0.38, 0.12, 0], [0.381, 0.03, 0]]); G.heat.add(dt);
  const arm = clampArm([-0.02 + 0.0, 0.29, -0.17], [tubeBase.x + Math.sin(-tilt) * 0.12, tubeBase.y + Math.cos(tilt) * 0.12, 0]); G.heat.add(arm);
  const limeBub = new Bubbles({ n: 70, life: 0.9, size: 0.0014, rise: 0.08, surface: () => 0.11, radius: y => lime.u.inner(y), rate: s => PHYS.limeMilk(s + 1) > 0 && s < 19 ? 0.9 : 0,
    site: (j, k, v) => v.set(0.0008 * Math.sin(j), 0.032, 0.0008 * Math.cos(j)) });
  lime.g.add(limeBub.group);
  const milk = dye(K.pipe, { n: 400, origin: [0, 0.035, 0], radius: 0.006, floor: lime.u.floor, top: 0.11, prog: s => PHYS.limeMilk(s), colour: (i, o) => { o.r = o.g = o.b = 0.95; }, alpha: 0.3, size: 0.008 });
  milk.points.position.y = 0.075; lime.g.add(milk.points);

  // ---------------- particles: carbonate splits
  const W = new MolWorld(K.pipe); G.particles.add(W.group);
  const ions = [];
  for (let i = 0; i < 6; i++) {
    const zx = (i % 3 - 1) * 0.05, zy = (Math.floor(i / 3) - 0.5) * 0.05;
    const zn = W.atom('Zn', '2+'); const co3 = molecule(W, 'CO3', { 0: '' }); co3.atoms[3].setCharge('2−');
    ions.push({ zn, co3, x: zx, y: zy, split: 25.5 + i * 0.7 });
  }

  // ---------------- applications: CuCO3 green → black, H2O2 slow decomposition
  const bun2 = bunsenRig(); bun2.group.position.set(-0.08, 0, 0.02); G.apps.add(bun2.group);
  const ct = vessel('tube', { level: 0.001 }); ct.liq.mesh.visible = false;
  const ctBase = new THREE.Vector3(bun2.group.position.x + bun2.top.x + 0.003, bun2.top.y + 0.062, bun2.group.position.z + bun2.top.z);
  const ctG = new THREE.Group(); ctG.position.copy(ctBase); ctG.rotation.z = -1.0; ctG.add(ct.g); G.apps.add(ctG);
  const cuMat = M.cuCarb.clone(); const cuPile = new THREE.Mesh(new THREE.CylinderGeometry(0.0072, 0.0072, 0.03, 16, 1, false, Math.PI * 0.15, Math.PI * 0.7), cuMat); cuPile.position.y = 0.02; cuPile.rotation.y = Math.PI * 0.5; ctG.add(cuPile);
  const st2 = model('retort'); st2.position.set(ctBase.x + 0.05, 0, -0.15); G.apps.add(st2);
  const grip = new THREE.Vector3(0, 0.1, 0).applyEuler(new THREE.Euler(0, 0, -1.0)).add(ctBase);
  G.apps.add(clampArm([ctBase.x + 0.05 - 0.06, grip.y, -0.15], [grip.x, grip.y, grip.z]));
  const cyl = vessel('cylinder', { level: 0.15, colour: '#f6fbff', dist: 10 }); cyl.g.position.set(0.18, 0, 0.0); G.apps.add(cyl.g);
  const h2o2Bub = new Bubbles({ n: 30, life: 2.6, size: 0.0005, rise: 0.02, surface: () => 0.15, radius: y => cyl.u.inner(y), rate: () => 0.12, site: (j, k, v) => v.set(Math.sin(j * 3.1) * 0.006, 0.012 + (j % 7) * 0.012, Math.cos(j * 2.3) * 0.006) });
  cyl.g.add(h2o2Bub.group);

  const KEYS = [
    { s: 0, p: [0.62, 0.36, 0.85], l: [0.17, 0.17, 0], f: 35, ap: 0.01 },
    { s: 6, p: [0.42, 0.3, 0.6], l: [0.14, 0.18, 0], f: 35, ap: 0.015 },
    { s: 9, cut: true, p: [0.08, 0.28, 0.22], l: [0.04, 0.24, 0], f: 100, ap: 0.06 },
    { s: 13, p: [0.1, 0.27, 0.2], l: [0.05, 0.245, 0], f: 100, ap: 0.06 },
    { s: 13, cut: true, p: [0.43, 0.15, 0.28], l: [0.38, 0.095, 0], f: 100, ap: 0.06 },
    { s: 18.5, p: [0.45, 0.145, 0.26], l: [0.38, 0.095, 0], f: 100, ap: 0.06 },
    { s: 18.5, cut: true, p: [0.07, 0.27, 0.2], l: [0.04, 0.245, 0], f: 100, ap: 0.06 },
    { s: 24.5, p: [0.05, 0.28, 0.21], l: [0.035, 0.245, 0], f: 100, ap: 0.06 },
    { s: 24.5, cut: true, p: [0, 0.02, 0.25], l: [0, 0, 0], f: 50, ap: 0.03 },
    { s: 33, p: [0.08, 0.05, 0.22], l: [0, 0.01, 0], f: 50, ap: 0.03 },
    { s: 33, cut: true, p: [0.18, 0.28, 0.5], l: [-0.03, 0.19, 0.0], f: 45, ap: 0.02 },
    { s: 38.5, p: [0.06, 0.26, 0.3], l: [-0.04, 0.21, 0.02], f: 70, ap: 0.04 },
    { s: 39, cut: true, p: [0.28, 0.15, 0.32], l: [0.18, 0.1, 0], f: 85, ap: 0.05 },
    { s: 45, p: [0.25, 0.13, 0.28], l: [0.18, 0.09, 0], f: 85, ap: 0.05 }
  ];
  const white = new THREE.Color(0xece9e1), hotYel = new THREE.Color(0xf2d75a), green = new THREE.Color(0x4f9a76), black = new THREE.Color(0x121212);

  return {
    id: 'r3', root,
    update(s, time, motion) {
      showStages(s, G, R.stages);
      const post = { bloom: { threshold: 2.2, strength: 0.55, radius: 0.55 } };
      let world = 'lab', warm = null;
      if (G.heat.visible) {
        const on = sm(2.5, 3.2, s); bun.set(1, on, time);
        powder.material.color.copy(white).lerp(hotYel, PHYS.znoHot(s)); pile.material.emissive?.setRGB(0.25 * PHYS.znoHot(s), 0.18 * PHYS.znoHot(s), 0);
        const milkV = PHYS.limeMilk(s);
        lime.liq.mat.transmission = lerp(1, 0.25, milkV); lime.liq.mat.roughness = lerp(0.02, 0.45, milkV); lime.liq.mat.color.setRGB(1, 1, 1);
        limeBub.update(s); milk.update(s, time); lime.liq.set(0.11, limeBub.count ? 0.0003 : 0, time);
        if (on > 0.5) { post.shimmer = { x: 0.5, y: 0.45, w: 0.1, h: 0.3, amp: 0.6 }; }
        warm = { i: 0.15 * on, p: [0, 0.2, 0] };
      }
      if (G.particles.visible) {
        world = 'micro';
        for (const it of ions) {
          const u = sm(it.split, it.split + 1.6, s);
          it.zn.set(it.x - 0.012, it.y, 0);
          it.co3.place(it.x + 0.012, it.y, 0, 1, 0.3, 0);
          // CO2 (C + O1 + O2) drifts up and away; O3 (now O^2-) stays beside Zn^2+
          const up = u * 0.08, drift = u * 0.02;
          for (const k of [0, 1, 2]) { const a = it.co3.atoms[k]; a.p.set(a.p.x + drift, a.p.y + up, a.p.z + u * 0.02); }
          it.co3.bonds[2].k = u > 0.15 ? 0 : 1;
          it.co3.atoms[3].setCharge(u > 0.15 ? '2−' : '');
          it.co3.atoms[0].setCharge(''); if (u <= 0.15 && !it.co3.atoms[1].charge) it.co3.atoms[1].setCharge('');
        }
        W.group.rotation.y = Math.sin(s * 0.3) * 0.3;
        W.update(s, time);
        post.exposure = 1.15;
      }
      if (G.apps.visible) {
        bun2.set(1, sm(33.2, 34, s), time);
        cuMat.color.copy(green).lerp(black, PHYS.cuCarbBlack(s));
        h2o2Bub.update(s);
        warm = { i: 0.12, p: [-0.08, 0.2, 0.02] };
        post.shimmer = s < 39 ? { x: 0.42, y: 0.4, w: 0.1, h: 0.25, amp: 0.5 } : undefined;
      }
      const cam = shake(camKF(s, KEYS), time, world === 'lab' ? 0.0005 : 0, motion);
      return { cam, world, post, warm, goggles: s < 33 ? [-0.15, 0.18, 0.4] : [-0.3, 0.2, 0.3], glass: true };
    },
    probe: () => ({ milkEnd: PHYS.limeMilk(24), znoHotPeak: PHYS.znoHot(15), znoCold: PHYS.znoHot(24.4) })
  };
}
