// Reel 4 · Single displacement: Mg fizzing in dilute HCl (thinning, tube warms), the squeaky-pop test,
// Zn in CuSO4 time-lapse (spongy copper grows, blue fades), the reactivity ladder + "no reaction",
// and Mg swapping into the compound at particle level.
import * as THREE from 'three';
import { REELS, PHYS } from './script.js';
import { camKF, sm, lerp, showStages, shake } from './common.js';
import { M, canvasTex, rng } from '../render/materials.js';
import { ribbon, splint, lumps } from '../render/props.js';
import { Bubbles } from '../fx/bubbles.js';
import { Fireball } from '../fx/smoke.js';
import { Flame } from '../fx/flame.js';
import { MolWorld } from '../fx/molecules.js';
import { vessel, rack } from './kit.js';

const R = REELS.find(r => r.id === 'r4');
const POP = 20.3;
const SERIES = ['K', 'Na', 'Ca', 'Mg', 'Al', 'Zn', 'Fe', 'Pb', '(H)', 'Cu', 'Ag', 'Au'];

export default function (K) {
  const root = new THREE.Group();
  const G = { fizz: new THREE.Group(), pop: new THREE.Group(), copper: new THREE.Group(), series: new THREE.Group(), particles: new THREE.Group() };
  for (const k in G) root.add(G[k]);

  // ---------------- Mg + HCl in a test tube (fizz + pop share the tube)
  const tt = vessel('tube', { level: 0.07, colour: '#f6fbff', dist: 8 });
  const rk = rack(3); const tubeHolder = new THREE.Group(); tubeHolder.add(rk); tt.g.position.set(rk.userData.x(1), 0.004, 0); tubeHolder.add(tt.g);
  G.fizz.add(tubeHolder);
  const rib = ribbon(0.035); rib.rotation.set(0, 0.4, Math.PI / 2 - 0.15); rib.position.set(0, 0.03, 0); tt.g.add(rib);
  const fizzBub = new Bubbles({ n: 220, life: 0.8, size: 0.0007, rise: 0.09, surface: () => 0.07, radius: y => tt.u.inner(y),
    rate: s => PHYS.mgFizz(s), site: (j, k, v) => { const y = 0.014 + ((j * 13 + k * 7) % 31) / 31 * 0.034 * Math.max(0.15, PHYS.mgLeft(Math.max(0, 3))); v.set(Math.sin(j) * 0.0016, y, Math.cos(j * 1.3) * 0.0016); } });
  tt.g.add(fizzBub.group);
  // pop: a lit splint brought to the mouth
  const sp = splint(0.12); G.pop.add(sp); const spFlame = new Flame(); spFlame.group.scale.setScalar(0.3); spFlame.group.rotation.z = Math.PI / 2; G.pop.add(spFlame.group);
  const pop = new Fireball(); G.pop.add(pop.group);

  // ---------------- Zn strip in CuSO4 (time-lapse)
  const bk = vessel('beaker', { level: 0.06, colour: '#5fb2ff', dist: 0.09 }); bk.g.position.set(0, 0, 0); G.copper.add(bk.g);
  const strip = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.1, 0.0015), M.zinc); strip.position.set(0, 0.052, 0); strip.rotation.z = 0.18; bk.g.add(strip);
  const sponge = lumps(160, 0.0018, M.copperSponge, 0.001, 77, 'grain'); sponge.frustumCulled = false; bk.g.add(sponge);
  { const o = new THREE.Object3D(), r = rng(5); for (let i = 0; i < 160; i++) { o.position.set((r() - 0.5) * 0.018, 0.006 + r() * 0.052, (r() < 0.5 ? -1 : 1) * 0.0012); o.position.applyEuler(new THREE.Euler(0, 0, 0.18)); o.position.y += 0.002; o.position.x += 0.0; o.rotation.set(r() * 6, r() * 6, r() * 6); o.scale.setScalar(0.0012 + r() * 0.0018); o.updateMatrix(); sponge.setMatrixAt(i, o.matrix); } sponge.userData.base = sponge.instanceMatrix.array.slice(); }

  // ---------------- reactivity ladder + no-reaction beaker
  const ladder = new THREE.Group(); ladder.position.set(-0.05, 0, -0.12); G.series.add(ladder);
  SERIES.forEach((el, i) => {
    const t = canvasTex(256, 96, g => { g.fillStyle = 'rgba(10,16,24,.75)'; g.fillRect(0, 0, 256, 96); g.strokeStyle = el === 'Zn' || el === 'Cu' ? '#FFE14D' : el === '(H)' ? '#5EE7FF' : 'rgba(255,255,255,.5)'; g.lineWidth = 5; g.strokeRect(3, 3, 250, 90); g.fillStyle = '#fff'; g.font = 'bold 54px JetBrains Mono, monospace'; g.textAlign = 'center'; g.fillText(el, 128, 66); });
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.03), new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.35, transparent: true, roughness: 0.3 }));
    plate.position.set(0, 0.38 - i * 0.031, 0); ladder.add(plate); plate.userData.i = i;
  });
  const arrowT = canvasTex(64, 512, g => { const gr = g.createLinearGradient(0, 0, 0, 512); gr.addColorStop(0, '#FF4859'); gr.addColorStop(1, '#4D9FFF'); g.fillStyle = gr; g.fillRect(24, 30, 16, 470); g.beginPath(); g.moveTo(32, 0); g.lineTo(60, 40); g.lineTo(4, 40); g.fill(); });
  const arrow = new THREE.Mesh(new THREE.PlaneGeometry(0.016, 0.38), new THREE.MeshBasicMaterial({ map: arrowT, transparent: true })); arrow.position.set(-0.06, 0.2, 0); ladder.add(arrow);
  const nr = vessel('beaker', { level: 0.055, colour: '#fafcff', dist: 10 }); nr.g.position.set(0.12, 0, 0.04); G.series.add(nr.g);
  const cuStrip = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.095, 0.0015), M.copper); cuStrip.position.set(0, 0.05, 0); cuStrip.rotation.z = -0.15; nr.g.add(cuStrip);

  // ---------------- particles: Mg + 2HCl → MgCl2 + H2
  const W = new MolWorld(K.pipe); G.particles.add(W.group);
  const mg = W.atom('Mg'); const cl = [W.atom('Cl', '−'), W.atom('Cl', '−')]; const h = [W.atom('H', '+'), W.atom('H', '+')];
  const bHH = W.bond(h[0], h[1]);

  const KEYS = [
    { s: 0, p: [0.32, 0.22, 0.48], l: [0, 0.06, 0], f: 35, ap: 0.01 },
    { s: 4.5, cut: true, p: [0.05, 0.06, 0.12], l: [0, 0.04, 0], f: 100, ap: 0.07 },
    { s: 10, p: [0.035, 0.045, 0.1], l: [0, 0.035, 0], f: 100, ap: 0.08 },
    { s: 16.5, cut: true, p: [0.15, 0.15, 0.3], l: [0, 0.1, 0], f: 50, ap: 0.03 },
    { s: 19.5, p: [0.1, 0.16, 0.2], l: [0, 0.13, 0], f: 85, ap: 0.05 },
    { s: 24, cut: true, p: [0.15, 0.1, 0.3], l: [0, 0.05, 0], f: 60, ap: 0.03 },
    { s: 30, p: [0.08, 0.07, 0.18], l: [0, 0.045, 0], f: 100, ap: 0.06 },
    { s: 36, cut: true, p: [0.25, 0.25, 0.6], l: [0.02, 0.18, -0.06], f: 40, ap: 0.015 },
    { s: 41.5, p: [0.3, 0.12, 0.35], l: [0.11, 0.06, 0.03], f: 60, ap: 0.03 },
    { s: 46, cut: true, p: [0, 0.02, 0.24], l: [0, 0, 0], f: 50, ap: 0.03 },
    { s: 52.5, p: [0.06, 0.04, 0.22], l: [0, 0, 0], f: 50, ap: 0.03 }
  ];
  const blue = new THREE.Color('#5fb2ff'), clear = new THREE.Color('#f2f8fb');

  return {
    id: 'r4', root,
    update(s, time, motion) {
      showStages(s, G, R.stages);
      G.fizz.visible = s < 24; // the tube stays for the pop test
      const post = { bloom: { threshold: 2.2, strength: 0.5, radius: 0.55 } };
      let world = 'lab';
      if (G.fizz.visible) {
        const left = PHYS.mgLeft(s); rib.scale.set(Math.max(0.02, left), Math.max(0.15, left), 1); rib.visible = left > 0.02;
        fizzBub.update(s); tt.liq.set(0.07, 0.0002 * Math.min(1, fizzBub.count / 60), time);
        if (s > 5 && s < 16) post.shimmer = { x: 0.5, y: 0.6, w: 0.12, h: 0.35, amp: 0.25 * PHYS.mgFizz(s) };
      }
      if (G.pop.visible) {
        const app = sm(17, 20.2, s), mouthY = 0.004 + 0.15;
        sp.position.set(lerp(0.18, 0.012, app), mouthY + 0.008 + lerp(0.05, 0, app), 0); sp.rotation.z = Math.PI + 0.25;
        sp.userData.glow(0.6);
        spFlame.group.position.set(sp.position.x - Math.cos(0.25) * 0.13, sp.position.y - Math.sin(0.25) * 0.13 + 0.002, 0); spFlame.set(0, s < POP + 0.05 ? 1 : 0.35, time);
        pop.group.position.set(rk.userData.x(1), mouthY + 0.01, 0); pop.set(s - POP, 0.035);
      }
      if (G.copper.visible) {
        const c = PHYS.znCopper(s);
        bk.liq.colour(blue.clone().lerp(clear, c), lerp(0.09, 2, c * c));
        const base = sponge.userData.base, arr = sponge.instanceMatrix.array, M4 = new THREE.Matrix4(), sc = new THREE.Vector3(), q = new THREE.Quaternion(), p = new THREE.Vector3();
        for (let i = 0; i < 160; i++) { M4.fromArray(base, i * 16); M4.decompose(p, q, sc); const grow = Math.min(1, Math.max(0, c * 1.4 - (i / 160) * 0.4)); sc.multiplyScalar(Math.max(0.001, grow)); M4.compose(p, q, sc); M4.toArray(arr, i * 16); }
        sponge.instanceMatrix.needsUpdate = true;
      }
      if (G.series.visible) {
        ladder.children.forEach(p => { if (p.userData.i == null) return; const on = sm(37 + p.userData.i * 0.25, 37.6 + p.userData.i * 0.25, s); p.material.opacity = on; p.position.x = (1 - on) * -0.05; p.material.emissiveIntensity = (SERIES[p.userData.i] === 'Zn' || SERIES[p.userData.i] === 'Cu') && s > 41 ? 0.9 : 0.35; });
      }
      if (G.particles.visible) {
        world = 'micro';
        const u = sm(47.5, 50.5, s), lv = sm(50, 52.5, s);
        cl[0].set(-0.025, 0, 0); cl[1].set(0.025, 0, 0);
        mg.set(lerp(0, 0, u), lerp(0.07, 0.0, u), lerp(0.03, 0, u)); mg.setCharge(u > 0.6 ? '2+' : '');
        h[0].set(lerp(-0.012, -0.007, u), lerp(0, 0.02, u) + lv * 0.05, lerp(0, 0.01, u)); h[1].set(lerp(0.012, 0.007, u), lerp(0, 0.02, u) + lv * 0.05, lerp(0, 0.01, u));
        for (const a of h) a.setCharge(u > 0.6 ? '' : '+');
        bHH.k = u > 0.75 ? 1 : 0;
        W.eFns = [0, 1].map(k => (ss) => { const a = sm(47.8 + k * 0.3, 49.3 + k * 0.3, ss); if (a <= 0 || a >= 1) return null; const from = [mg.p.x, mg.p.y, mg.p.z], to = [h[k].p.x, h[k].p.y, h[k].p.z]; return [lerp(from[0], to[0], a), lerp(from[1], to[1], a) + Math.sin(a * Math.PI) * 0.015, lerp(from[2], to[2], a)]; });
        W.update(s, time); post.exposure = 1.15;
      }
      const cam = shake(camKF(s, KEYS), time, world === 'lab' ? 0.0005 : 0, motion);
      return { cam, world, post, goggles: [-0.16, 0.12, 0.6], glass: true, warm: G.pop.visible ? { i: 0.08, p: [0.05, 0.17, 0] } : null };
    },
    probe: () => ({ mgLeftEnd: PHYS.mgLeft(16), copperEnd: PHYS.znCopper(36) })
  };
}
