// Reel 8 · Rates: a seeded, deterministic collision box (successful collisions flash), then the four
// factors as side-by-side experiments (concentration, temperature, surface area with an exploding cube,
// MnO2 catalyst foam + relighting splint + same mass after), and gas syringes for the rate-graph lesson.
import * as THREE from 'three';
import { REELS, PHYS } from './script.js';
import { camKF, sm, lerp, showStages, shake } from './common.js';
import { M, canvasTex, rng } from '../render/materials.js';
import { lumps, balance, splint, tube, Liquid, conical, deliveryTube } from '../render/props.js';
import { Bubbles } from '../fx/bubbles.js';
import { plume, hh } from '../fx/smoke.js';
import { Particles } from '../render/lab.js';
import { LAYER_FX, LAYER_GLASS } from '../render/pipeline.js';
import { Flame } from '../fx/flame.js';
import { atomMat } from '../fx/molecules.js';
import { vessel } from './kit.js';

const R = REELS.find(r => r.id === 'r8');
const tri = u => { const f = ((u % 2) + 2) % 2; return f < 1 ? f : 2 - f; };

function label(text, w = 0.06) {
  const t = canvasTex(256, 64, g => { g.fillStyle = 'rgba(8,12,18,.8)'; g.fillRect(0, 0, 256, 64); g.fillStyle = '#FFE14D'; g.font = 'bold 30px JetBrains Mono, monospace'; g.textAlign = 'center'; g.fillText(text, 128, 43); });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshBasicMaterial({ map: t, transparent: true })); return m;
}
function fizzBeaker(K, rate, chips) {
  const v = vessel('beaker', { level: 0.05, dist: 8 });
  if (chips) { chips.position.y = v.u.floor; v.g.add(chips); }
  const b = new Bubbles({ n: 200, life: 0.9, size: 0.001, rise: 0.07, surface: () => 0.05, radius: y => v.u.inner(y), rate,
    site: (j, k, vv) => { const a = (j * 2.4 + k * 0.7) % 6.28, r = ((j * 7 + k) % 13) / 13 * 0.022; vv.set(Math.cos(a) * r, v.u.floor + 0.004 + ((j + k) % 5) * 0.0015, Math.sin(a) * r); } });
  v.g.add(b.group); return { ...v, b };
}

export default function (K) {
  const root = new THREE.Group();
  const G = { box: new THREE.Group(), conc: new THREE.Group(), temp: new THREE.Group(), surface: new THREE.Group(), catalyst: new THREE.Group(), graph: new THREE.Group() };
  for (const k in G) root.add(G[k]);

  // ---------------- collision box
  const L = 0.05, N = 36;
  const cube = new THREE.Mesh(new THREE.BoxGeometry(L * 2.1, L * 2.1, L * 2.1), M.glassThick); cube.layers.set(LAYER_GLASS); G.box.add(cube);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(L * 2.1, L * 2.1, L * 2.1)), new THREE.LineBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.5 })); G.box.add(edges);
  const balls = [atomMat('O'), atomMat('N')].map((m, k) => { const im = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 20, 14), m, N / 2); im.frustumCulled = false; G.box.add(im); return im; });
  const r = rng(808); const P = Array.from({ length: N }, (_, i) => ({ x: r(), y: r(), z: r(), vx: (r() - 0.5) * 0.5, vy: (r() - 0.5) * 0.5, vz: (r() - 0.5) * 0.5, sp: i % 2 }));
  const pos = new Float32Array(N * 3); let flashes = [];
  const flashFx = new Particles(40, (i, s, time, o) => { const f = flashes[i]; if (!f) return false; o.x = f[0]; o.y = f[1]; o.z = f[2]; o.size = 0.02 * (1 - f[3]); o.alpha = 1 - f[3]; o.r = 4; o.g = 3.6; o.b = 1.6; return true; }, { additive: true });
  flashFx.points.layers.set(LAYER_FX); K.pipe.noDepth.add(flashFx.points); G.box.add(flashFx.points);
  const posAt = (p, t, out, k) => { out[k] = (tri(p.x * 2 + p.vx * t) * 2 - 1) * L * 0.92; out[k + 1] = (tri(p.y * 2 + p.vy * t) * 2 - 1) * L * 0.92; out[k + 2] = (tri(p.z * 2 + p.vz * t) * 2 - 1) * L * 0.92; };

  // ---------------- concentration / temperature / surface area
  const dil = fizzBeaker(K, s => 0.28, lumps(14, 0.0045, M.marble, 0.02, 4)); dil.g.position.x = -0.06; G.conc.add(dil.g);
  const con = fizzBeaker(K, s => 0.95, lumps(14, 0.0045, M.marble, 0.02, 5)); con.g.position.x = 0.06; G.conc.add(con.g);
  const l1 = label('0.5 M'); l1.position.set(-0.06, 0.003, 0.05); l1.rotation.x = -Math.PI / 2; G.conc.add(l1); const l2 = label('2.0 M'); l2.position.set(0.06, 0.003, 0.05); l2.rotation.x = -Math.PI / 2; G.conc.add(l2);
  const cold = fizzBeaker(K, s => 0.25, lumps(14, 0.0045, M.marble, 0.02, 6)); cold.g.position.x = -0.06; G.temp.add(cold.g);
  const hot = fizzBeaker(K, s => 0.95, lumps(14, 0.0045, M.marble, 0.02, 7)); hot.g.position.x = 0.06; G.temp.add(hot.g);
  const steam = plume(K.pipe, { n: 120, origin: [0.06, 0.06, 0], col: [0.95, 0.97, 1], alpha: 0.07, size: 0.02, rise: 0.04, spread: 0.02, life: 3, grow: 3 }); G.temp.add(steam.points);
  const thermo = [-0.06, 0.06].map((x, i) => { const g = new THREE.Group(); const t = tube({ r: 0.0035, h: 0.16, wall: 0.0008 }); g.add(t); const red = new THREE.Mesh(new THREE.CylinderGeometry(0.0011, 0.0011, 1, 8), new THREE.MeshStandardMaterial({ color: 0xd8262f, roughness: 0.3 })); red.position.y = 0.01; g.add(red); g.userData.red = red; g.position.set(x + 0.016, 0.01, -0.01); g.rotation.z = -0.15; G.temp.add(g); return g; });
  const l3 = label('20 °C'); l3.position.set(-0.06, 0.003, 0.05); l3.rotation.x = -Math.PI / 2; G.temp.add(l3); const l4 = label('50 °C'); l4.position.set(0.06, 0.003, 0.05); l4.rotation.x = -Math.PI / 2; G.temp.add(l4);
  const lump = new THREE.Mesh(new THREE.DodecahedronGeometry(0.013, 1), M.marble); const lumpG = new THREE.Group(); lumpG.add(lump);
  const sA = fizzBeaker(K, s => 0.12, null); sA.g.position.x = -0.1; lump.position.y = sA.u.floor + 0.01; sA.g.add(lumpG); G.surface.add(sA.g);
  const sB = fizzBeaker(K, s => 0.45, lumps(14, 0.0045, M.marble, 0.02, 8)); G.surface.add(sB.g);
  const sC = fizzBeaker(K, s => 1, lumps(200, 0.0011, M.marble, 0.022, 9, 'grain')); sC.g.position.x = 0.1; G.surface.add(sC.g);
  [['lump', -0.1], ['chips', 0], ['powder', 0.1]].forEach(([t, x]) => { const l = label(t); l.position.set(x, 0.003, 0.05); l.rotation.x = -Math.PI / 2; G.surface.add(l); });
  const cubeBits = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), M.marble, 27); cubeBits.frustumCulled = false; cubeBits.position.set(0, 0.14, 0.03); G.surface.add(cubeBits);
  const exposed = new THREE.InstancedMesh(new THREE.BoxGeometry(1.02, 1.02, 1.02), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.6, 0.15).multiplyScalar(1.4), transparent: true, opacity: 0.35, wireframe: true }), 27); exposed.frustumCulled = false; exposed.position.copy(cubeBits.position); G.surface.add(exposed);

  // ---------------- catalyst
  const cyl = vessel('cylinder', { level: 0.06, dist: 10, opts: { r: 0.018, h: 0.25, ml: 250 } }); G.catalyst.add(cyl.g);
  const slow = new Bubbles({ n: 20, life: 2.5, size: 0.0006, rise: 0.03, surface: () => 0.06, radius: y => cyl.u.inner(y), rate: () => 0.15, site: (j, k, v) => v.set(Math.sin(j) * 0.008, 0.015 + (j % 5) * 0.008, Math.cos(j) * 0.008) }); cyl.g.add(slow.group);
  const foamMat = new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.95, normalMap: null });
  const foam = new THREE.Mesh(new THREE.CylinderGeometry(cyl.u.inner(0.1) - 0.0004, cyl.u.inner(0.1) - 0.0004, 1, 32), foamMat); cyl.g.add(foam);
  const foamTop = plume(K.pipe, { n: 200, origin: [0, 0.25, 0], density: s => sm(48, 49, s), col: [0.98, 0.98, 0.98], alpha: 0.45, size: 0.007, rise: 0.012, spread: 0.01, life: 2, grow: 1, lit: false }); cyl.g.add(foamTop.points);
  const mno2 = new Particles(80, (i, s, time, o) => { const a = s - 46 - hh(i, 1) * 0.4; if (a < 0 || a > 0.7) return false; o.x = (hh(i, 2) - 0.5) * 0.01; o.z = (hh(i, 3) - 0.5) * 0.01; o.y = 0.3 - 0.5 * a * a * 4; o.size = 0.0025; o.alpha = 1; o.r = o.g = o.b = 0.03; return true; }); mno2.points.layers.set(LAYER_FX); cyl.g.add(mno2.points);
  const sp = splint(0.12); G.catalyst.add(sp); const spF = new Flame(); spF.group.scale.setScalar(0.3); spF.group.rotation.z = Math.PI / 2 + 0.6; G.catalyst.add(spF.group);
  const bal = balance(); bal.position.set(0.2, 0, 0.02); G.catalyst.add(bal);

  // ---------------- gas syringes
  const syr = [0, 1].map(i => {
    const g = new THREE.Group(); g.position.set(0, 0.12, (i - 0.5) * 0.14); G.graph.add(g);
    const barrel = tube({ r: 0.012, h: 0.2, wall: 0.001 }); barrel.rotation.z = -Math.PI / 2; barrel.position.x = 0.02; g.add(barrel);
    const plunger = new THREE.Mesh(new THREE.CylinderGeometry(0.0108, 0.0108, 0.012, 24), M.rubber); plunger.rotation.z = Math.PI / 2; g.add(plunger);
    const rodm = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.2, 10), M.whitePlastic); rodm.rotation.z = Math.PI / 2; g.add(rodm);
    const fl = conical({ R: 0.03, h: 0.1, cone: 0.07 }); fl.position.set(-0.16, -0.12, 0); g.add(fl);
    const fliq = new Liquid(fl.userData.inner, fl.userData.floor, '#f6fbff', 8); fliq.set(0.03); fl.add(fliq.mesh);
    const ch = lumps(i ? 12 : 140, i ? 0.0045 : 0.0011, M.marble, 0.018, 20 + i, i ? 'chip' : 'grain'); ch.position.y = fl.userData.floor; fl.add(ch);
    g.add(deliveryTube([[-0.16, -0.015, 0], [-0.16, 0.0, 0], [-0.1, 0.0, 0], [0.02, 0.0, 0]], 0.0025));
    const b = new Bubbles({ n: 80, life: 0.8, size: 0.0009, rise: 0.06, surface: () => 0.03, radius: y => fl.userData.inner(y), rate: s => (s > 58.5 ? (i ? 0.35 : 1) : 0), site: (j, k, v) => v.set(Math.sin(j * 2.4) * 0.012, fl.userData.floor + 0.004, Math.cos(j * 2.4) * 0.012) }); fl.add(b.group);
    const lab = label(i ? 'chips' : 'powder', 0.07); lab.position.set(-0.16, -0.115, 0.04); g.add(lab);
    return { g, plunger, rodm, b, k: i ? 28 : 10 };
  });

  const KEYS = [
    { s: 0, p: [0.12, 0.08, 0.2], l: [0, 0, 0], f: 50, ap: 0.02 },
    { s: 15, p: [-0.1, 0.06, 0.22], l: [0, 0, 0], f: 50, ap: 0.02 },
    { s: 15, cut: true, p: [0, 0.13, 0.3], l: [0, 0.04, 0], f: 50, ap: 0.025 },
    { s: 24, p: [0.02, 0.12, 0.28], l: [0, 0.04, 0], f: 50, ap: 0.025 },
    { s: 24, cut: true, p: [0, 0.13, 0.3], l: [0, 0.045, 0], f: 50, ap: 0.025 },
    { s: 33, p: [-0.02, 0.12, 0.28], l: [0, 0.045, 0], f: 50, ap: 0.025 },
    { s: 33, cut: true, p: [0, 0.16, 0.4], l: [0, 0.06, 0], f: 45, ap: 0.02 },
    { s: 38, p: [0.03, 0.17, 0.3], l: [0, 0.11, 0.03], f: 50, ap: 0.025 },
    { s: 43, p: [0.0, 0.18, 0.28], l: [0, 0.12, 0.03], f: 50, ap: 0.025 },
    { s: 43, cut: true, p: [0.12, 0.18, 0.4], l: [0.03, 0.12, 0], f: 50, ap: 0.025 },
    { s: 49, p: [0.07, 0.2, 0.3], l: [0, 0.16, 0], f: 60, ap: 0.03 },
    { s: 52, cut: true, p: [0.06, 0.29, 0.13], l: [0, 0.26, 0], f: 100, ap: 0.06 },
    { s: 54.5, cut: true, p: [0.3, 0.14, 0.24], l: [0.2, 0.06, 0.02], f: 85, ap: 0.05 },
    { s: 58, cut: true, p: [0.02, 0.24, 0.5], l: [-0.04, 0.06, 0], f: 40, ap: 0.015 },
    { s: 67.5, p: [0.08, 0.26, 0.46], l: [-0.04, 0.07, 0], f: 40, ap: 0.015 }
  ];
  let lastHits = 0;

  return {
    id: 'r8', root,
    update(s, time, motion) {
      showStages(s, G, R.stages);
      const post = { bloom: { threshold: 2.2, strength: 0.5, radius: 0.55 } };
      let world = 'lab';
      if (G.box.visible) {
        world = 'micro';
        const t = s * 1.2, o = new THREE.Object3D(); const cnt = [0, 0];
        P.forEach((p, i) => { posAt(p, t, pos, i * 3); o.position.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]); o.scale.setScalar(0.0055); o.updateMatrix(); balls[p.sp].setMatrixAt(cnt[p.sp]++, o.matrix); });
        balls.forEach(b => { b.instanceMatrix.needsUpdate = true; });
        flashes = [];
        for (let a = 0; a < N && flashes.length < 40; a += 2) for (let b = 1; b < N; b += 2) {
          for (const dtb of [0, 0.05, 0.1, 0.15]) {
            const tt = t - dtb * 1.2; const A = [], B = []; posAt(P[a], tt, A, 0); posAt(P[b], tt, B, 0);
            const d = Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
            if (d < 0.013 && hh(a * 97 + b, Math.floor(tt * 4)) < 0.2) { flashes.push([(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2, dtb / 0.15]); break; }
          }
        }
        flashFx.update(s, time); lastHits = flashes.length;
        G.box.rotation.y = s * 0.12; post.bloom = { threshold: 1.6, strength: 0.7, radius: 0.55 }; post.exposure = 1.15;
      }
      for (const v of [dil, con, cold, hot, sA, sB, sC]) if (v.g.parent.visible) { v.b.update(s); v.liq.set(0.05, 0.0004 * Math.min(1, v.b.count / 70), time); }
      if (G.temp.visible) { steam.update(s, time); thermo.forEach((g, i) => { const h = i ? 0.1 : 0.055; g.userData.red.scale.y = h; g.userData.red.position.y = 0.006 + h / 2; }); }
      if (G.surface.visible) {
        const ex = sm(38, 41, s), o = new THREE.Object3D(); let k = 0;
        for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) { o.position.set(x, y, z).multiplyScalar(0.012 * (1 + ex * 0.9)); o.rotation.set(ex * x * 0.3, ex * y * 0.4, 0); o.scale.setScalar(0.012); o.updateMatrix(); cubeBits.setMatrixAt(k, o.matrix); exposed.setMatrixAt(k, o.matrix); k++; }
        cubeBits.instanceMatrix.needsUpdate = exposed.instanceMatrix.needsUpdate = true; exposed.material.opacity = 0.45 * ex; cubeBits.rotation.y = s * 0.3; exposed.rotation.y = s * 0.3;
        cubeBits.visible = exposed.visible = s > 36.5;
      }
      if (G.catalyst.visible) {
        const f = sm(46.6, 51, s); foam.visible = f > 0; foam.scale.y = Math.max(0.001, f * 0.19); foam.position.y = 0.06 + f * 0.19 / 2;
        slow.update(s); mno2.update(s, time); foamTop.update(s, time);
        const app = sm(51.5, 52.6, s) * (1 - sm(54.4, 55, s));
        sp.position.set(lerp(0.1, 0.01, app), 0.27 + lerp(0.06, 0, app), 0); sp.rotation.z = Math.PI + 0.6;
        const relit = s > 53;
        sp.userData.glow(relit ? 0 : 1);
        spF.group.position.set(sp.position.x - Math.cos(0.6) * 0.13, sp.position.y - Math.sin(0.6) * 0.13, 0); spF.set(0, relit ? sm(53, 53.4, s) : 0, time);
        bal.userData.show(s > 54.5 ? '0.50' : '0.00'); bal.visible = s > 54;
      }
      if (G.graph.visible) {
        syr.forEach((q) => { const v = PHYS.gasVol(q.k, Math.max(0, (s - 58.5) / 5 * 120)); const x = 0.03 + v / 60 * 0.15; q.plunger.position.x = x; q.rodm.position.x = x + 0.1; q.b.update(s); });
      }
      const cam = shake(camKF(s, KEYS), time, world === 'lab' ? 0.0005 : 0, motion);
      return { cam, world, post, goggles: [-0.2, 0.12, 0.5], glass: true };
    },
    probe: () => ({ hits: lastHits, fastFirst: PHYS.gasVol(10, 60) > PHYS.gasVol(28, 60), plateau: Math.abs(PHYS.gasVol(10, 1e4) - PHYS.gasVol(28, 1e4)) < 1e-6 })
  };
}
