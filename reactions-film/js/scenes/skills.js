// Reel 9 · Key Science Skills, "The Investigation": marble + HCl on a balance (documentary handheld),
// random error (flickering last digit), systematic error (unzeroed balance, parallax on a cylinder),
// a spill (mistake, not error), acid spray vs cotton-wool plug, then chips vs powder side by side.
import * as THREE from 'three';
import { REELS, hudData } from './script.js';
import { camKF, sm, lerp, showStages, shake } from './common.js';
import { M, canvasTex } from '../render/materials.js';
import { balance, lumps } from '../render/props.js';
import { Bubbles } from '../fx/bubbles.js';
import { sparks } from '../fx/smoke.js';
import { vessel } from './kit.js';

const R = REELS.find(r => r.id === 'r9');

function flaskOnBalance(K, powder, x) {
  const bal = balance(); bal.position.x = x;
  const v = vessel('conical', { level: 0.035, dist: 8 }); v.g.position.set(0, bal.userData.panTop, -0.02); bal.add(v.g);
  const ch = powder ? lumps(180, 0.0011, M.marble, 0.02, 41, 'grain') : lumps(12, 0.0045, M.marble, 0.02, 42); ch.position.y = v.u.floor; v.g.add(ch);
  const b = new Bubbles({ n: 160, life: 0.9, size: 0.001, rise: 0.06, surface: () => 0.035, radius: y => v.u.inner(y), rate: () => (powder ? 0.9 : 0.4), site: (j, k, vv) => vv.set(Math.sin(j * 2.4) * 0.015 * ((j % 7) / 7), v.u.floor + 0.004, Math.cos(j * 2.4) * 0.015 * ((j % 7) / 7)) });
  v.g.add(b.group);
  const plug = new THREE.Mesh(new THREE.DodecahedronGeometry(0.009, 2), M.cloth); plug.scale.set(1, 1.3, 1); plug.position.y = v.u.top + 0.004; v.g.add(plug);
  return { bal, v, b, plug };
}

export default function (K) {
  const root = new THREE.Group();
  const set = new THREE.Group(); root.add(set);
  const A = flaskOnBalance(K, false, 0); set.add(A.bal);
  const cyl = vessel('cylinder', { level: 0.13, dist: 10, opts: { r: 0.0125, h: 0.2, ml: 100 } }); cyl.g.position.set(-0.19, 0, 0.02); set.add(cyl.g);
  const puddle = new THREE.Mesh(new THREE.CircleGeometry(0.05, 40), new THREE.MeshPhysicalMaterial({ color: 0x000000, roughness: 0.02, clearcoat: 1, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 })); puddle.rotation.x = -Math.PI / 2; puddle.position.set(-0.12, 0.0006, 0.12); puddle.scale.set(1.4, 0.8, 1); set.add(puddle);
  const spray = sparks(K.pipe, { n: 120, origin: [0, A.bal.userData.panTop + 0.11, -0.02], active: s => (s > 30.5 && s < 33.5 ? 1 : 0), speed: 0.12, life: 0.5, size: 0.0016, col: [0.85, 0.92, 1.0] }); set.add(spray.points);
  // second rig for chips vs powder (analysis shots)
  const B = flaskOnBalance(K, true, 0.26); root.add(B.bal);
  const cards = [['chips', 0], ['powder', 0.26]].map(([t, x]) => { const tex = canvasTex(256, 64, g => { g.fillStyle = 'rgba(8,12,18,.85)'; g.fillRect(0, 0, 256, 64); g.fillStyle = '#FFE14D'; g.font = 'bold 32px JetBrains Mono, monospace'; g.textAlign = 'center'; g.fillText(t, 128, 44); }); const m = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.02), new THREE.MeshBasicMaterial({ map: tex, transparent: true })); m.position.set(x, 0.002, 0.15); m.rotation.x = -Math.PI / 2; root.add(m); return m; });

  const KEYS = [
    { s: 0, p: [0.24, 0.17, 0.38], l: [-0.03, 0.07, 0], f: 40, ap: 0.015 },
    { s: 12, cut: true, p: [0.05, 0.12, 0.36], l: [-0.01, 0.045, 0.1], f: 85, ap: 0.05 },
    { s: 18, p: [0.07, 0.12, 0.34], l: [-0.01, 0.045, 0.1], f: 85, ap: 0.05 },
    { s: 21.5, cut: true, p: [-0.19, 0.26, 0.09], l: [-0.19, 0.13, 0.03], f: 85, ap: 0.05 },
    { s: 24.5, cut: true, p: [-0.02, 0.12, 0.35], l: [-0.12, 0.01, 0.1], f: 50, ap: 0.03 },
    { s: 30, cut: true, p: [0.07, 0.2, 0.15], l: [0, 0.16, -0.02], f: 100, ap: 0.07 },
    { s: 38, cut: true, p: [0.4, 0.3, 0.6], l: [0.13, 0.07, 0], f: 35, ap: 0.012 },
    { s: 52, p: [0.13, 0.28, 0.65], l: [0.13, 0.07, 0], f: 35, ap: 0.012 },
    { s: 60, p: [-0.15, 0.3, 0.55], l: [0.13, 0.07, 0], f: 35, ap: 0.012 },
    { s: 67.5, p: [0.13, 0.4, 0.5], l: [0.13, 0.07, 0], f: 35, ap: 0.012 },
    { s: 75, p: [0.3, 0.42, 0.55], l: [0.13, 0.07, 0], f: 35, ap: 0.012 }
  ];

  return {
    id: 'r9', root,
    update(s, time, motion) {
      const showB = s >= 38; B.bal.visible = showB; cards.forEach(c => c.visible = showB);
      cyl.g.visible = s < 38; puddle.visible = s > 25.5 && s < 38;
      const d = hudData('r9', 'balance', s);
      A.bal.userData.show(d.g.toFixed(2)); B.bal.userData.show((151.27 - 0.42 * (1 - Math.exp(-Math.max(0, s - 38) / 6))).toFixed(2));
      A.plug.visible = s > 33.5; B.plug.visible = true;
      A.b.update(s); B.b.update(s); A.v.liq.set(0.035, 0.0004, time); B.v.liq.set(0.035, 0.0005, time);
      spray.update(s, time);
      const cam = shake(camKF(s, KEYS), time, 0.0009, motion);
      return { cam, world: 'lab', post: { bloom: { threshold: 2.3, strength: 0.45, radius: 0.5 } }, goggles: [-0.32, -0.06, 0.5], bottles: [-0.3, -0.16], glass: true };
    }
  };
}
