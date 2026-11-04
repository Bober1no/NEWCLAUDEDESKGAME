// Particle-level world: CPK atoms (glossy, sheen, soft inner glow), capsule bonds that stretch / snap /
// re-form, ion charge badges, electrons (bright cyan with motion trails), and the micro-world backdrop.
import * as THREE from 'three';
import { Particles } from '../render/lab.js';
import { LAYER_FX } from '../render/pipeline.js';
import { canvasTex } from '../render/materials.js';

export const CPK = { H: 0xf2f4f7, O: 0xe8333f, C: 0x2b2d31, N: 0x3a6fe0, Cl: 0x2fbf4f, Na: 0x8b5cf6, Cu: 0xe0866a, Zn: 0x7d8fa3, Mg: 0x2f7d4a, Fe: 0xe07a2a, S: 0xf1d23b, Ag: 0xc8ccd2, Pb: 0x4a4e57, K: 0x8d3fd6, Ca: 0x55665a, Ba: 0x9be33a, I: 0x6b2e8f, Mn: 0x9c7ac7 };
// radii in film units (scaled): ball-and-stick vs space-filling (≈ van der Waals)
export const RAD = { H: [0.0055, 0.012], O: [0.0085, 0.0152], C: [0.009, 0.017], N: [0.0085, 0.0155], Cl: [0.011, 0.0175], Na: [0.012, 0.02], Cu: [0.011, 0.016], Zn: [0.011, 0.016], Mg: [0.011, 0.0175], Fe: [0.011, 0.016], S: [0.01, 0.018], Ag: [0.011, 0.017], Pb: [0.012, 0.0185], K: [0.013, 0.021], Ca: [0.012, 0.019], Ba: [0.013, 0.02], I: [0.012, 0.0195], Mn: [0.011, 0.016] };

const matCache = {};
export function atomMat(el) {
  if (matCache[el]) return matCache[el];
  const c = new THREE.Color(CPK[el] ?? 0xffffff);
  const m = new THREE.MeshPhysicalMaterial({ color: c, roughness: el === 'C' ? 0.32 : 0.22, metalness: 0, clearcoat: 0.9, clearcoatRoughness: 0.12, sheen: 0.5, sheenColor: c.clone().lerp(new THREE.Color(1, 1, 1), 0.5), sheenRoughness: 0.4, emissive: c, emissiveIntensity: el === 'C' ? 0.04 : 0.09, envMapIntensity: 0.9 });
  return (matCache[el] = m);
}
const SPHERE = new THREE.SphereGeometry(1, 40, 28);
const CAPS = new THREE.CapsuleGeometry(1, 1, 6, 16);
const bondMat = new THREE.MeshPhysicalMaterial({ color: 0xd8dde4, roughness: 0.25, clearcoat: 0.6, envMapIntensity: 0.8 });

function badgeTex(text, col) {
  return canvasTex(128, 128, (g) => { g.clearRect(0, 0, 128, 128); g.fillStyle = col; g.beginPath(); g.arc(64, 64, 52, 0, 7); g.fill(); g.lineWidth = 6; g.strokeStyle = 'rgba(255,255,255,.85)'; g.stroke(); g.fillStyle = '#fff'; g.font = 'bold 54px JetBrains Mono, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 64, 68); });
}
const badgeCache = {};
function badge(text) { const pos = /\+/.test(text); const k = text; if (!badgeCache[k]) badgeCache[k] = new THREE.SpriteMaterial({ map: badgeTex(text, pos ? '#d8334a' : '#2f6fd6'), depthWrite: false, depthTest: false, transparent: true }); const s = new THREE.Sprite(badgeCache[k]); s.renderOrder = 9; return s; }

export class Atom {
  constructor(world, el, charge = '') {
    this.el = el; this.world = world; this.mesh = new THREE.Mesh(SPHERE, atomMat(el)); this.mesh.castShadow = true; world.group.add(this.mesh);
    this.r = RAD[el] || [0.01, 0.016]; this.p = this.mesh.position; this.scale = 1; this.badge = null; this.setCharge(charge);
  }
  setCharge(ch) {
    if (this.charge === ch) return; this.charge = ch;
    if (this.badge) { this.world.group.remove(this.badge); this.badge = null; }
    if (ch) { this.badge = badge(ch); this.world.group.add(this.badge); }
  }
  set(x, y, z, s = 1) { this.p.set(x, y, z); this.scale = s; return this; }
  apply(fill) {
    const r = (this.r[0] + (this.r[1] - this.r[0]) * fill) * this.scale; this.mesh.scale.setScalar(Math.max(1e-5, r)); this.mesh.visible = this.scale > 0.01;
    if (this.badge) { this.badge.visible = this.mesh.visible; this.badge.position.set(this.p.x + r * 0.8, this.p.y + r * 0.9, this.p.z + r * 0.5); this.badge.scale.setScalar(0.011 * Math.max(0.6, this.scale)); }
  }
}

export class MolWorld {
  constructor(pipeline) {
    this.pipeline = pipeline; this.group = new THREE.Group(); this.atoms = []; this.bonds = []; this.fill = 0;
    this.bondMesh = new THREE.InstancedMesh(CAPS, bondMat, 400); this.bondMesh.frustumCulled = false; this.bondMesh.castShadow = true; this.group.add(this.bondMesh);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._v = new THREE.Vector3(); this._s = new THREE.Vector3(); this._up = new THREE.Vector3(0, 1, 0);
    // electrons: bright cyan points with trails (positions supplied as functions of time)
    this.eFns = [];
    this.electrons = new Particles(64 * 9, (i, s, time, o) => {
      const e = this.eFns[Math.floor(i / 9)], k = i % 9; if (!e) return false;
      const p = e(s - k * 0.035, time); if (!p) return false;
      o.x = p[0]; o.y = p[1]; o.z = p[2]; o.size = k ? 0.0032 * (1 - k / 10) : 0.0062; o.alpha = k ? 0.55 * (1 - k / 9) : 1; o.r = 0.6; o.g = 3.2; o.b = 3.6; return true;
    }, { additive: true });
    this.electrons.points.layers.set(LAYER_FX); this.electrons.points.renderOrder = 8; pipeline.noDepth.add(this.electrons.points); this.group.add(this.electrons.points);
    this.flashes = new Particles(32, (i, s, time, o) => { const f = this.flashFns[i]; if (!f) return false; const q = f(s); if (!q) return false; o.x = q[0]; o.y = q[1]; o.z = q[2]; o.size = q[3]; o.alpha = q[4]; o.r = q[5] ?? 3; o.g = q[6] ?? 3; o.b = q[7] ?? 3; return true; }, { additive: true });
    this.flashes.points.layers.set(LAYER_FX); pipeline.noDepth.add(this.flashes.points); this.group.add(this.flashes.points); this.flashFns = [];
  }
  atom(el, charge) { const a = new Atom(this, el, charge); this.atoms.push(a); return a; }
  /** bond(a, b, order, strength fn) — strength 0..1: 1 = formed, 0 = broken. */
  bond(a, b, order = 1) { const bd = { a, b, order, k: 1 }; this.bonds.push(bd); return bd; }
  update(s, time) {
    for (const a of this.atoms) a.apply(this.fill);
    let n = 0; const M = this._m, Q = this._q, V = this._v, S = this._s;
    const thick = 0.0022 * (1 - this.fill);
    for (const bd of this.bonds) {
      if (bd.k <= 0.02 || !bd.a.mesh.visible || !bd.b.mesh.visible || thick < 0.0002) continue;
      const A = bd.a.p, B = bd.b.p; V.subVectors(B, A); const len = V.length(); if (len < 1e-5) continue;
      V.normalize(); Q.setFromUnitVectors(this._up, V);
      const perp = new THREE.Vector3(1, 0, 0).applyQuaternion(Q);
      for (let o = 0; o < bd.order; o++) {
        const off = (o - (bd.order - 1) / 2) * thick * 2.6;
        const mid = new THREE.Vector3().addVectors(A, B).multiplyScalar(0.5).addScaledVector(perp, off);
        const stretch = bd.k < 1 ? bd.k : 1;
        S.set(thick * (0.6 + 0.4 * stretch), Math.max(1e-5, len * 0.5 * stretch), thick * (0.6 + 0.4 * stretch));
        M.compose(mid, Q, S); if (n < 400) this.bondMesh.setMatrixAt(n++, M);
      }
    }
    this.bondMesh.count = n; this.bondMesh.instanceMatrix.needsUpdate = true;
    this.electrons.update(s, time); this.flashes.update(s, time);
  }
}

/** Micro-world backdrop: deep gradient dome (vertex colours, built-in material) + drifting out-of-focus water. */
export function microBackdrop(pipeline, tint = [0.03, 0.06, 0.12]) {
  const g = new THREE.Group();
  const geo = new THREE.SphereGeometry(3, 32, 16); const col = []; const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i) / 3; const k = 0.5 + 0.5 * y; col.push(tint[0] * (0.4 + k), tint[1] * (0.4 + k), tint[2] * (0.5 + k * 1.2)); }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false })));
  const motes = new Particles(220, (i, s, time, o) => {
    const a = (i * 2.399) % 6.283, r = 0.15 + (i % 17) / 17 * 0.5, y = ((i * 0.618) % 1 - 0.5) * 0.6;
    o.x = Math.cos(a + time * 0.03) * r; o.z = Math.sin(a + time * 0.03) * r - 0.1; o.y = y + Math.sin(time * 0.2 + i) * 0.01;
    o.size = 0.01 + (i % 5) * 0.003; o.alpha = 0.12; o.r = 0.4; o.g = 0.7; o.b = 1.0; return true;
  }, { additive: true });
  motes.points.layers.set(LAYER_FX); pipeline.noDepth.add(motes.points); g.add(motes.points);
  g.userData.update = (time) => motes.update(0, time);
  return g;
}

// simple molecule templates (positions relative to centre)
export const SHAPES = {
  H2O: [['O', 0, 0, 0], ['H', -0.0142, -0.011, 0], ['H', 0.0142, -0.011, 0]],
  CO2: [['C', 0, 0, 0], ['O', -0.021, 0, 0], ['O', 0.021, 0, 0]],
  CH4: [['C', 0, 0, 0], ['H', 0.0105, 0.0105, 0.0105], ['H', -0.0105, -0.0105, 0.0105], ['H', -0.0105, 0.0105, -0.0105], ['H', 0.0105, -0.0105, -0.0105]],
  O2: [['O', -0.0105, 0, 0], ['O', 0.0105, 0, 0]],
  H2: [['H', -0.007, 0, 0], ['H', 0.007, 0, 0]]
};
export const BONDS = { H2O: [[0, 1, 1], [0, 2, 1]], CO2: [[0, 1, 2], [0, 2, 2]], CH4: [[0, 1, 1], [0, 2, 1], [0, 3, 1], [0, 4, 1]], O2: [[0, 1, 2]], H2: [[0, 1, 1]] };

SHAPES.H2O2 = [['O', -0.0074, 0, 0], ['O', 0.0074, 0, 0], ['H', -0.0125, 0.0105, 0.004], ['H', 0.0125, -0.0105, 0.004]];
BONDS.H2O2 = [[0, 1, 1], [0, 2, 1], [1, 3, 1]];
SHAPES.HCl = [['H', -0.0085, 0, 0], ['Cl', 0.006, 0, 0]]; BONDS.HCl = [[0, 1, 1]];
SHAPES.CO3 = [['C', 0, 0, 0], ['O', 0.0128, 0, 0], ['O', -0.0064, 0.0111, 0], ['O', -0.0064, -0.0111, 0]]; BONDS.CO3 = [[0, 1, 2], [0, 2, 1], [0, 3, 1]];
SHAPES.OH = [['O', 0, 0, 0], ['H', 0.0105, 0.004, 0]]; BONDS.OH = [[0, 1, 1]];

const _e = new THREE.Euler(), _v3 = new THREE.Vector3();
/** A molecule built from SHAPES[key]: place(x, y, z, scale, rotY, rotX) positions every atom. */
export function molecule(world, key, charges = {}) {
  const atoms = SHAPES[key].map(([el], i) => world.atom(el, charges[i] || ''));
  const bonds = (BONDS[key] || []).map(([a, b, o]) => world.bond(atoms[a], atoms[b], o));
  return {
    key, atoms, bonds,
    place(x, y, z, s = 1, ry = 0, rx = 0) {
      _e.set(rx, ry, 0);
      SHAPES[key].forEach(([, ax, ay, az], i) => { _v3.set(ax, ay, az).applyEuler(_e).multiplyScalar(s > 0 ? 1 : 0); atoms[i].set(x + _v3.x * Math.max(s, 0.001) / Math.max(s, 0.001) * (0.6 + 0.4 * Math.min(1, s)), y + _v3.y * (0.6 + 0.4 * Math.min(1, s)), z + _v3.z * (0.6 + 0.4 * Math.min(1, s)), s); });
      for (const b of bonds) b.k = s > 0.3 ? 1 : 0;
      return this;
    },
    hide() { for (const a of atoms) a.set(0, -9, 0, 0); for (const b of bonds) b.k = 0; return this; }
  };
}
