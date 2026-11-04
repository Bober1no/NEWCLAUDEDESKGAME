// Scene kit: common rigs built from props + fx.
import * as THREE from 'three';
import { model, bunsenTop, beaker, conical, tube, cylinder, Liquid } from '../render/props.js';
import { Flame } from '../fx/flame.js';
import { M } from '../render/materials.js';

/** Bunsen burner (downloaded model) with a flame sitting exactly on the barrel mouth. */
export function bunsenRig() {
  const g = new THREE.Group(); const b = model('bunsen'); g.add(b);
  const t = bunsenTop(); const f = new Flame(); f.group.position.copy(t); g.add(f.group);
  return { group: g, flame: f, top: t, set: (air, on, time) => f.set(air, on, time) };
}
/** Vessel + liquid. type: beaker | conical | tube | boiling | cylinder */
export function vessel(type, { colour = '#f4fbff', dist = 6, level = 0.05, opts = {} } = {}) {
  const g = type === 'beaker' ? beaker(opts) : type === 'conical' ? conical(opts) : type === 'cylinder' ? cylinder(opts) : tube({ ...opts, boiling: type === 'boiling' });
  const liq = new Liquid(g.userData.inner, g.userData.floor, colour, dist); liq.set(level); g.add(liq.mesh);
  return { g, liq, u: g.userData };
}
/** Wooden test-tube rack for n tubes spaced dx apart. */
export function rack(n, dx = 0.035) {
  const g = new THREE.Group(); const w = n * dx + 0.03;
  const top = new THREE.Mesh(new THREE.BoxGeometry(w, 0.008, 0.05), M.wood); top.position.y = 0.06; g.add(top);
  const base = new THREE.Mesh(new THREE.BoxGeometry(w, 0.008, 0.05), M.wood); base.position.y = 0.004; g.add(base);
  for (const x of [-w / 2 + 0.004, w / 2 - 0.004]) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.06, 0.05), M.wood); s.position.set(x, 0.032, 0); g.add(s); }
  g.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
  g.userData.x = i => -((n - 1) * dx) / 2 + i * dx;
  return g;
}
/** Simple clamp arm from a stand rod position to a gripping point. */
export function clampArm(from, to) {
  const g = new THREE.Group(); const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
  const len = a.distanceTo(b); const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, len, 12), M.steel);
  arm.position.copy(a).add(b).multiplyScalar(0.5); arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()); g.add(arm);
  const boss = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.024, 0.024), M.castIron); boss.position.copy(a); g.add(boss);
  for (const s of [-1, 1]) { const j = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.006, 0.008), M.castIron); j.position.copy(b).add(new THREE.Vector3(0, s * 0.016, 0)); g.add(j); const pad = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.004, 0.009), M.cloth); pad.position.copy(b).add(new THREE.Vector3(0, s * 0.012, 0)); g.add(pad); }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}
