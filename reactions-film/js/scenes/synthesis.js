// Reel 2 · Synthesis: hydrogen balloon fireball (teacher demo), H2 + O2 → H2O at particle level,
// then magnesium burning in air (blinding white, sparks, MgO smoke, white ash; exposure dips).
import * as THREE from 'three';
import { REELS } from './script.js';
import { camKF, sm, lerp, showStages, shake, clamp } from './common.js';
import { M } from '../render/materials.js';
import { model, balloon, splint, heatMat, tongs, ribbon } from '../render/props.js';
import { Fireball, plume, sparks } from '../fx/smoke.js';
import { Flame } from '../fx/flame.js';
import { bunsenRig } from './kit.js';
import { MolWorld, molecule } from '../fx/molecules.js';

const R = REELS.find(r => r.id === 'r2');
const IGN = 15.2, MG_IGN = 34.5;

export default function (K) {
  const root = new THREE.Group();
  const G = { balloon: new THREE.Group(), particles: new THREE.Group(), mg: new THREE.Group() };
  for (const k in G) root.add(G[k]);

  // ---------------- balloon on a retort stand, splint on a long pole
  const st = model('retort'); st.position.set(-0.12, 0, -0.05); G.balloon.add(st);
  const bln = balloon(0xd9363e); bln.position.set(0, 0.31, 0); G.balloon.add(bln); // knot at 0.31, body centred near 0.45
  const string = new THREE.Mesh(new THREE.CylinderGeometry(0.0006, 0.0006, 0.13, 6), M.rubber); string.position.set(-0.045, 0.255, 0); string.rotation.z = Math.atan2(0.09, 0.11); G.balloon.add(string);
  const pole = new THREE.Group(); const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.8, 10), M.wood); stick.rotation.z = Math.PI / 2; stick.position.x = 0.4; pole.add(stick);
  const sp = splint(0.08); sp.position.x = -0.08; pole.add(sp); G.balloon.add(pole);
  const tipFlame = new Flame(); tipFlame.group.scale.setScalar(0.35); G.balloon.add(tipFlame.group);
  const fire = new Fireball(); fire.group.position.set(0, 0.45, 0); G.balloon.add(fire.group);
  const mist = plume(K.pipe, { n: 200, origin: [0, 0.4, 0], density: s => (s > IGN + 0.2 && s < IGN + 3) ? 1 : 0, col: [0.9, 0.93, 0.96], alpha: 0.14, size: 0.05, rise: 0.04, spread: 0.06, life: 3.5, grow: 3 });
  G.balloon.add(mist.points);
  const drops = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), M.glass, 40); drops.frustumCulled = false; G.balloon.add(drops); drops.layers.set(1);
  { const o = new THREE.Object3D(); for (let i = 0; i < 40; i++) { o.position.set(-0.06 + (i % 8) * 0.004, 0.2 + Math.floor(i / 8) * 0.03 + (i % 3) * 0.005, 0.005); o.scale.setScalar(0.0008 + (i % 4) * 0.0003); o.updateMatrix(); drops.setMatrixAt(i, o.matrix); } }

  // ---------------- particles: 2H2 + O2 → 2H2O
  const W = new MolWorld(K.pipe); G.particles.add(W.group);
  const H = [0, 1, 2, 3].map(() => W.atom('H')), O = [0, 1].map(() => W.atom('O'));
  const bHH = [W.bond(H[0], H[1]), W.bond(H[2], H[3])], bOO = W.bond(O[0], O[1], 2);
  const bOH = [W.bond(O[0], H[0]), W.bond(O[0], H[1]), W.bond(O[1], H[2]), W.bond(O[1], H[3])];
  W.flashFns = [0, 1, 2].map(k => s => { const t0 = 23 + k * 0.2, a = s - t0; if (a < 0 || a > 0.6) return null; const p = k < 2 ? [k ? 0.04 : -0.04, 0.02, 0] : [0, -0.02, 0]; return [...p, 0.03 * (1 + a * 3), 1 - a / 0.6, 4, 4, 3]; });

  // ---------------- magnesium ribbon burning
  const mat = heatMat(0.24); G.mg.add(mat);
  const bunR = bunsenRig(); bunR.group.position.set(0.12, 0.006, -0.06); G.mg.add(bunR.group); const bf = bunR.flame;
  const tg = tongs(); tg.position.set(-0.17, 0.09, 0); tg.rotation.z = -0.25; G.mg.add(tg);
  const rib = ribbon(0.055); rib.position.set(0.035, 0.045, 0); rib.rotation.z = -0.25; G.mg.add(rib);
  const ash = new THREE.Mesh(new THREE.DodecahedronGeometry(0.008, 1), M.ash); ash.scale.set(1.2, 0.35, 0.8); ash.position.set(0.04, 0.009, 0.004); G.mg.add(ash);
  const core = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1).multiplyScalar(12) })); G.mg.add(core);
  const mgLight = new THREE.PointLight(0xf4f6ff, 0, 3, 2); G.mg.add(mgLight);
  const burnPt = new THREE.Vector3(0.06, 0.039, 0);
  const sparkFx = sparks(K.pipe, { n: 220, origin: burnPt.toArray(), active: s => (s > MG_IGN && s < MG_IGN + 6) ? 1 : 0, speed: 0.45, life: 0.6, col: [4, 3.8, 3.4] }); G.mg.add(sparkFx.points);
  const smoke = plume(K.pipe, { n: 260, origin: burnPt.toArray(), density: s => (s > MG_IGN + 0.3 && s < MG_IGN + 6.5) ? 1 : 0, col: [0.95, 0.95, 0.95], alpha: 0.16, size: 0.03, rise: 0.09, spread: 0.035, life: 4, grow: 4 }); G.mg.add(smoke.points);

  const KEYS = [
    { s: 0, p: [0.55, 0.42, 0.95], l: [-0.02, 0.33, 0], f: 35, ap: 0.01 },
    { s: 8, p: [0.32, 0.43, 0.62], l: [0, 0.4, 0], f: 50, ap: 0.02 },
    { s: 12, cut: true, p: [0.2, 0.47, 0.32], l: [0.05, 0.45, 0], f: 85, ap: 0.05 },
    { s: 15, p: [0.17, 0.46, 0.3], l: [0.02, 0.45, 0], f: 85, ap: 0.05 },
    { s: 15.2, cut: true, p: [0.5, 0.5, 0.95], l: [0, 0.43, 0], f: 35, ap: 0.01 },
    { s: 21, p: [0.42, 0.46, 0.85], l: [0, 0.4, 0], f: 35, ap: 0.01 },
    { s: 21, cut: true, p: [0, 0.03, 0.22], l: [0, 0, 0], f: 50, ap: 0.03 },
    { s: 30.5, p: [0.07, 0.05, 0.2], l: [0, 0, 0], f: 50, ap: 0.03 },
    { s: 30.5, cut: true, p: [0.38, 0.22, 0.48], l: [0.02, 0.05, 0], f: 35, ap: 0.01 },
    { s: 33.5, p: [0.18, 0.1, 0.22], l: [0.05, 0.04, 0], f: 85, ap: 0.05 },
    { s: 34.4, p: [0.15, 0.08, 0.19], l: [0.06, 0.04, 0], f: 100, ap: 0.06 },
    { s: 38, p: [0.22, 0.14, 0.3], l: [0.05, 0.07, 0], f: 60, ap: 0.03 },
    { s: 41, cut: true, p: [0.09, 0.06, 0.12], l: [0.04, 0.01, 0], f: 100, ap: 0.07 },
    { s: 45, p: [0.07, 0.07, 0.11], l: [0.04, 0.01, 0], f: 100, ap: 0.07 }
  ];

  return {
    id: 'r2', root,
    update(s, time, motion) {
      showStages(s, G, R.stages);
      const post = { bloom: { threshold: 2.2, strength: 0.5, radius: 0.55 }, exposure: 1 };
      let world = 'lab', warm = null;
      if (G.balloon.visible) {
        const age = s - IGN;
        bln.visible = age < 0; string.visible = age < 0;
        const app = sm(9, 14.8, s);
        pole.position.set(lerp(0.7, 0.07, app), lerp(0.47, 0.452, app), 0.0); pole.rotation.z = -0.02;
        tipFlame.group.position.set(pole.position.x - 0.012, pole.position.y, 0); tipFlame.set(0, s > 8 && s < IGN + 0.1 ? 1 : 0, time); tipFlame.group.rotation.z = Math.PI / 2;
        fire.set(age, 0.32);
        drops.visible = age > 1.2;
        mist.update(s, time);
        if (age > 0 && age < 1) post.shock = { x: 0.5, y: 0.52, r: age * 0.9, amp: (1 - age) * 1.2 };
        post.exposure = age > 0 && age < 0.9 ? 1 - 0.5 * Math.sin(age / 0.9 * Math.PI) : 1;
        post.bloom = { threshold: 2.4, strength: 0.6, radius: 0.6 };
      }
      if (G.particles.visible) {
        world = 'micro';
        const u = sm(23.4, 26.5, s), form = sm(26, 26.8, s), rot = s * 0.25;
        const startH = [[-0.05, 0.03, 0], [-0.036, 0.03, 0], [0.036, 0.03, 0], [0.05, 0.03, 0]], startO = [[-0.0105, -0.03, 0], [0.0105, -0.03, 0]];
        const endO = [[-0.03, 0, 0], [0.03, 0, 0]], endH = [[-0.044, -0.011, 0], [-0.016, -0.011, 0], [0.016, -0.011, 0], [0.044, -0.011, 0]];
        const wob = k => Math.sin(time * 2 + k) * 0.0015 * (1 - u);
        H.forEach((a, k) => a.set(lerp(startH[k][0], endH[k][0], u) + wob(k), lerp(startH[k][1], endH[k][1], u) + Math.sin(u * Math.PI) * 0.02 * (k % 2 ? 1 : -1), Math.sin(u * Math.PI) * 0.015 * (k < 2 ? 1 : -1)));
        O.forEach((a, k) => a.set(lerp(startO[k][0], endO[k][0], u), lerp(startO[k][1], endO[k][1], u) + wob(k + 4), 0));
        const broken = s > 23 ? 0 : 1;
        bHH.forEach(b => b.k = broken); bOO.k = broken; bOH.forEach(b => b.k = form);
        W.group.rotation.y = Math.sin(rot) * 0.4;
        W.update(s, time);
        post.exposure = 1.15;
      }
      if (G.mg.visible) {
        const a = s - MG_IGN, burning = a > 0 && a < 6, burnt = sm(MG_IGN, MG_IGN + 6, s);
        bf.set(1, 1, time);
        rib.scale.x = Math.max(0.02, 1 - burnt * 0.9); rib.position.x = 0.035 + 0.0275 * burnt * 0.9; rib.visible = burnt < 0.98;
        const fl = burning ? (0.75 + 0.25 * Math.sin(time * 37) * Math.sin(time * 13)) : 0;
        core.visible = burning; core.scale.setScalar(0.0018 + 0.0012 * fl); const bx = 0.035 + 0.055 * (1 - (1 - burnt * 0.9)) ; core.position.set(lerp(0.062, 0.012, burnt), 0.04 - burnt * 0.012, 0);
        mgLight.position.copy(core.position); mgLight.intensity = burning ? 18 * fl : 0;
        ash.visible = burnt > 0.3; ash.scale.set(1.2 * burnt, 0.35 * burnt + 0.01, 0.8 * burnt);
        sparkFx.points.position.set(core.position.x - burnPt.x, core.position.y - burnPt.y, 0); sparkFx.update(s, time); smoke.update(s, time);
        post.exposure = burning ? lerp(1, 0.45, sm(0, 0.6, a)) * (1 - 0.05 * Math.sin(time * 23)) : 1;
        post.bloom = { threshold: 1.5, strength: burning ? 1.1 : 0.5, radius: 0.7 };
        warm = { i: 0.4, p: [0.12, 0.2, -0.04] }; void bx;
      }
      const cam = shake(camKF(s, KEYS), time, world === 'lab' ? 0.0005 : 0, motion);
      if (G.balloon.visible && s > IGN && s < IGN + 0.8 && motion) { const k = (1 - (s - IGN) / 0.8) * 0.006; cam.p = [cam.p[0] + Math.sin(time * 60) * k, cam.p[1] + Math.cos(time * 53) * k, cam.p[2]]; }
      return { cam, world, post, warm, glass: true };
    },
    probe: () => ({ ign: IGN })
  };
}
