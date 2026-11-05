// The lab: static shell (merged per material), benches, windows, fume cupboards, shelving, and every
// experiment station from the film as interactive, breakable props.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { M, TX, canvasTex, colourMap, normalFromHeight, greyMap, fbm, rng } from './materials.js';
import * as P from './props.js';
import { Entity, Prop, Vessel, Pane, TileWall, Parts, Balloon, hullFromObject } from './entities.js';
import { RAPIER } from '../core/physics.js';
import { Flame } from '../fx/flame.js';
import { SUBS } from './chem.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
export const ROOM = { x0: -7, x1: 7, z0: -5.5, z1: 5.5, h: 3.2, bench: 0.92 };

/** Box geometry whose UVs are in metres (textures repeat per metre). */
function boxUV(sx, sy, sz, k = 1) {
  const g = new THREE.BoxGeometry(sx, sy, sz), uv = g.attributes.uv;
  const dims = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) { const i = f * 4 + v; uv.setXY(i, uv.getX(i) * dims[f][0] * k, uv.getY(i) * dims[f][1] * k); }
  return g;
}

class StaticBuilder {
  constructor(W) { this.W = W; this.byMat = new Map(); }
  add(mat, geo, opts = {}) { if (!this.byMat.has(mat)) this.byMat.set(mat, { geos: [], shadow: opts.shadow !== false }); this.byMat.get(mat).geos.push(geo); }
  box(mat, x, y, z, sx, sy, sz, o = {}) {
    const g = boxUV(sx, sy, sz, o.uvk ?? 1); if (o.rotY) g.rotateY(o.rotY); g.translate(x, y, z); this.add(mat, g, o);
    if (o.collide !== false) this.W.physics.staticBox(x, y, z, sx / 2, sy / 2, sz / 2, o.rotY || 0, o.entity || null);
  }
  geo(mat, g, o = {}) { this.add(mat, g, o); }
  finish() {
    for (const [mat, { geos, shadow }] of this.byMat) {
      const parts = geos.map(g => g.index ? g.toNonIndexed() : g);
      for (const g of parts) { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); }
      const merged = mergeGeometries(parts, false); if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat); mesh.receiveShadow = true; mesh.castShadow = shadow; mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      this.W.scene.add(mesh);
    }
  }
}

function roomMaterials() {
  const R = {};
  R.floor = new THREE.MeshStandardMaterial({ map: canvasTex(512, 512, (g, w, h) => { for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) { const k = ((x + y) % 2) ? 0.55 : 0.5; const c = Math.round(k * 255); g.fillStyle = `rgb(${c},${c + 4},${c + 8})`; g.fillRect(x * 256, y * 256, 256, 256); } for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? 255 : 0},${Math.random() < 0.5 ? 255 : 0},255,0.04)`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); } g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 3; g.strokeRect(0, 0, 256, 256); g.strokeRect(256, 256, 256, 256); }, { repeat: [1, 1] }), roughness: 0.45, normalMap: TX.grainN, normalScale: new THREE.Vector2(0.1, 0.1) });
  R.floor.map.repeat.set(1.6, 1.6);
  R.wall = new THREE.MeshStandardMaterial({ map: colourMap(256, 256, (u, v, c) => { const k = 0.82 + 0.06 * fbm(u * 8, v * 8, 4, 8, 3); c[0] = k * 0.93; c[1] = k * 0.95; c[2] = k * 0.92; }, { repeat: [1, 1] }), roughness: 0.85 });
  R.ceiling = new THREE.MeshStandardMaterial({ map: canvasTex(256, 256, (g) => { g.fillStyle = '#e9ebe8'; g.fillRect(0, 0, 256, 256); for (let i = 0; i < 900; i++) { g.fillStyle = 'rgba(80,80,80,.18)'; g.fillRect(Math.random() * 256, Math.random() * 256, 1.5, 1.5); } g.strokeStyle = '#b9bcbc'; g.lineWidth = 4; g.strokeRect(0, 0, 256, 256); }), roughness: 0.9 });
  R.ceiling.map.repeat.set(1 / 0.6, 1 / 0.6); R.ceiling.map.wrapS = R.ceiling.map.wrapT = THREE.RepeatWrapping;
  R.trim = new THREE.MeshStandardMaterial({ color: 0x2d3238, roughness: 0.6 });
  R.frame = new THREE.MeshStandardMaterial({ color: 0xe8eaea, roughness: 0.4, metalness: 0.1 });
  R.cabinet = new THREE.MeshStandardMaterial({ color: 0x49606f, roughness: 0.5, normalMap: TX.castN, normalScale: new THREE.Vector2(0.08, 0.08) });
  R.cabinet2 = new THREE.MeshStandardMaterial({ color: 0xd7d9d4, roughness: 0.55 });
  R.bench = M.bench.clone(); R.bench.normalMap = TX.benchN.clone(); R.bench.normalMap.repeat.set(2, 2); R.bench.normalMap.needsUpdate = true; R.bench.roughnessMap = TX.benchR.clone(); R.bench.roughnessMap.repeat.set(1, 1); R.bench.roughnessMap.needsUpdate = true;
  R.sky = new THREE.MeshBasicMaterial({ map: canvasTex(512, 256, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#9cc8f2'); gr.addColorStop(0.65, '#e6f1fb'); gr.addColorStop(0.66, '#7e9a74'); gr.addColorStop(1, '#55704f'); g.fillStyle = gr; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(70,95,70,.9)'; for (let i = 0; i < 40; i++) { const x = (i / 40) * w + Math.random() * 10, r = 10 + Math.random() * 22; g.beginPath(); g.arc(x, h * 0.66, r, Math.PI, 0); g.fill(); } }), color: new THREE.Color(1.9, 1.9, 1.95) });
  R.light = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 3.15, 3.0) });
  R.ceramicTile = new THREE.MeshPhysicalMaterial({ color: 0xe8eceb, roughness: 0.18, clearcoat: 0.5, normalMap: TX.grainN, normalScale: new THREE.Vector2(0.05, 0.05) });
  R.poster = (draw, w = 512, h = 512) => new THREE.MeshStandardMaterial({ map: canvasTex(w, h, draw), roughness: 0.8 });
  return R;
}

/** Everything placed in the lab, returned so the game can reset it. */
export function buildRoom(W) {
  const R = roomMaterials(), S = new StaticBuilder(W), r = rng(42);
  const { x0, x1, z0, z1, h, bench: BH } = ROOM;
  // ---------------- shell
  S.box(R.floor, 0, -0.05, 0, x1 - x0 + 0.4, 0.1, z1 - z0 + 0.4);
  S.box(R.ceiling, 0, h + 0.05, 0, x1 - x0 + 0.4, 0.1, z1 - z0 + 0.4); // must cast: the sun only gets in through the windows
  S.box(R.wall, x0 - 0.1, h / 2, 0, 0.2, h, z1 - z0 + 0.4); S.box(R.wall, x1 + 0.1, h / 2, 0, 0.2, h, z1 - z0 + 0.4); S.box(R.wall, 0, h / 2, z1 + 0.1, x1 - x0, h, 0.2);
  // back wall with four windows
  const WX = [-4.6, -1.55, 1.55, 4.6], WW = 1.7, sill = 1.28, top = 2.6;
  S.box(R.wall, 0, sill / 2, z0 - 0.1, x1 - x0, sill, 0.2); S.box(R.wall, 0, (top + h) / 2, z0 - 0.1, x1 - x0, h - top, 0.2);
  let xa = x0; for (const wx of [...WX, x1 + WW / 2]) { const xb = Math.min(x1, wx - WW / 2); if (xb > xa) S.box(R.wall, (xa + xb) / 2, (sill + top) / 2, z0 - 0.1, xb - xa, top - sill, 0.2); xa = wx + WW / 2; }
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(30, 12), R.sky); sky.position.set(0, 2.5, z0 - 6); W.scene.add(sky);
  for (const wx of WX) {
    for (const [dx, dy, sx, sy] of [[0, sill, WW, 0.06], [0, top, WW, 0.06], [-WW / 2, (sill + top) / 2, 0.06, top - sill], [WW / 2, (sill + top) / 2, 0.06, top - sill], [0, (sill + top) / 2, 0.04, top - sill]]) S.box(R.frame, wx + dx, dy, z0 - 0.1, sx, sy, 0.12);
    for (const s of [-1, 1]) new Pane(W, { pos: V(wx + s * WW / 4, (sill + top) / 2, z0 - 0.1), w: WW / 2 - 0.05, h: top - sill - 0.05, t: 0.006, mat: M.glass, name: 'Window pane', forceThreshold: 30 });
  }
  // skirting + ceiling lights
  S.box(R.trim, 0, 0.06, z1 - 0.01, x1 - x0, 0.12, 0.02, { collide: false }); S.box(R.trim, x0 + 0.01, 0.06, 0, 0.02, 0.12, z1 - z0, { collide: false }); S.box(R.trim, x1 - 0.01, 0.06, 0, 0.02, 0.12, z1 - z0, { collide: false });
  for (const lx of [-3.6, 0, 3.6]) for (const lz of [-2.6, 0.4, 3.2]) { S.box(R.light, lx, h - 0.01, lz, 1.2, 0.02, 0.3, { collide: false, shadow: false }); S.box(R.frame, lx, h - 0.005, lz, 1.26, 0.03, 0.36, { collide: false, shadow: false }); }

  // ---------------- perimeter bench along the back wall + sinks + tiled splashback
  const pz = z0 + 0.38;
  S.box(R.cabinet, 0, BH / 2 - 0.03, pz + 0.02, x1 - x0 - 0.2, BH - 0.06, 0.66); S.box(R.bench, 0, BH - 0.02, pz, x1 - x0 - 0.1, 0.04, 0.76);
  for (const sx of [-3.1, 3.1]) sink(W, S, R, sx, pz);
  new TileWall(W, { origin: V(x0 + 0.05, BH, z0 + 0.005), quat: new THREE.Quaternion(), cols: Math.floor((x1 - x0 - 0.1) / 0.11), rows: 3, size: 0.11, mat: R.ceramicTile });

  // ---------------- island benches
  const benches = [[-2.7, -2.5], [2.7, -2.5], [-2.7, 0.3], [2.7, 0.3], [-2.7, 3.0], [2.7, 3.0]];
  for (const [bx, bz] of benches) islandBench(W, S, R, bx, bz);
  // ---------------- fume cupboards on the left wall
  for (const fz of [-2.2, 1.2]) fumeCupboard(W, S, R, x0 + 0.45, fz);
  // ---------------- shelving + glass cabinet on the right wall
  shelving(W, S, R, x1 - 0.25, -2.6, r); shelving(W, S, R, x1 - 0.25, 0.4, r); glassCabinet(W, S, R, x1 - 0.3, 3.2);
  // ---------------- front wall: whiteboard, periodic table, door, safety sign, clock
  frontWall(W, S, R);
  S.finish();
  // see-through things don't cast the sun's shadow (and it saves a shadow draw each)
  W.scene.traverse(o => { if (o.isMesh && !Array.isArray(o.material) && (o.material.transparent || o.material.transmission > 0)) o.castShadow = false; });

  // ---------------- experiment stations (one per reel)
  const T = (x, z) => V(x, BH, z);
  stationTitration(W, T(-2.7, -2.5));
  stationDecomposition(W, T(2.7, -2.5));
  stationDisplacement(W, T(-2.7, 0.3));
  stationPrecipitation(W, T(2.7, 0.3));
  stationRedox(W, T(-2.7, 3.0));
  stationHydrogen(W, T(2.7, 3.0));
  perimeterGlass(W, pz);
  // stools around the islands
  for (const [bx, bz] of benches) for (const dx of [-0.9, 0.9]) for (const dz of [-0.95, 0.95]) stool(W, V(bx + dx + (r() - 0.5) * 0.2, 0, bz + dz + (r() - 0.5) * 0.15), r() * 6);
  // a few loose things on the floor
  props(W, P.model('retort'), V(-6.2, 0, 4.6), 0.4, { metal: true, name: 'Retort stand' });
  extinguisher(W, V(6.6, 0, 4.9));
}

// ======================================================================= furniture
function sink(W, S, R, x, z) {
  const B = ROOM.bench;
  S.box(M.steel, x, B - 0.005, z, 0.62, 0.012, 0.5, { collide: false });
  S.box(M.steel, x, B - 0.16, z - 0.0, 0.5, 0.012, 0.38); // basin floor
  for (const [dx, dz, sx, sz] of [[-0.25, 0, 0.012, 0.38], [0.25, 0, 0.012, 0.38], [0, -0.19, 0.5, 0.012], [0, 0.19, 0.5, 0.012]]) S.box(M.steel, x + dx, B - 0.08, z + dz, sx, 0.16, sz);
  const tap = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(x, B, z - 0.28), V(x, B + 0.28, z - 0.28), V(x, B + 0.36, z - 0.18), V(x, B + 0.26, z - 0.08)]), 30, 0.012, 10); S.geo(M.chrome, tap);
}
function islandBench(W, S, R, x, z) {
  const B = ROOM.bench, L = 3.0, D = 1.25;
  S.box(R.cabinet, x, B / 2 - 0.03, z, L - 0.2, B - 0.06, D - 0.2);
  S.box(R.bench, x, B - 0.02, z, L, 0.04, D);
  for (let i = 0; i < 6; i++) for (const s of [-1, 1]) { S.box(R.cabinet2, x - L / 2 + 0.25 + i * 0.5, B / 2 - 0.02, z + s * (D / 2 - 0.095), 0.46, B - 0.16, 0.012, { collide: false }); S.box(M.steel, x - L / 2 + 0.25 + i * 0.5, B - 0.14, z + s * (D / 2 - 0.085), 0.12, 0.012, 0.012, { collide: false }); }
  // gas taps along the centre line
  for (const dx of [-1, 0, 1]) { const g = new THREE.CylinderGeometry(0.012, 0.016, 0.08, 12); g.translate(x + dx, B + 0.04, z); S.geo(M.chrome, g); const t = new THREE.CylinderGeometry(0.006, 0.006, 0.07, 8); t.rotateZ(Math.PI / 2); t.translate(x + dx + 0.03, B + 0.06, z); S.geo(M.chrome, t); }
}
function fumeCupboard(W, S, R, x, z) {
  const B = ROOM.bench, w = 1.4, d = 0.85;
  S.box(R.cabinet2, x, 1.25, z - w / 2, d, 2.5, 0.06); S.box(R.cabinet2, x, 1.25, z + w / 2, d, 2.5, 0.06); S.box(R.cabinet2, x - d / 2 + 0.03, 1.25, z, 0.06, 2.5, w);
  S.box(R.cabinet2, x, 2.4, z, d, 0.25, w); S.box(R.cabinet, x, B / 2 - 0.03, z, d - 0.08, B - 0.06, w - 0.08); S.box(M.bench, x, B - 0.02, z, d, 0.04, w);
  S.box(R.light, x - 0.1, 2.25, z, 0.3, 0.02, w - 0.2, { collide: false, shadow: false });
  S.box(M.steel, x + d / 2 - 0.02, 1.32, z, 0.04, 0.03, w - 0.1, { collide: false });
  new Pane(W, { pos: V(x + d / 2 - 0.02, 1.68, z), quat: new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), Math.PI / 2), w: w - 0.12, h: 0.7, t: 0.006, mat: M.glass, name: 'Fume cupboard sash', forceThreshold: 25 });
  // a Bunsen and some glassware inside
  const p = V(x - 0.05, B, z);
  bunsen(W, p.clone().add(V(0, 0, -0.3)), 1, 0.3);
  vessel(W, P.beaker(), p.clone().add(V(0.1, 0, 0.15)), 'HCl', 0.5);
  vessel(W, P.conical(), p.clone().add(V(-0.12, 0, 0.3)), 'H2O2', 0.4);
}
function shelving(W, S, R, x, z, r) {
  const w = 2.0, d = 0.4;
  for (const sy of [0.02, 0.55, 1.05, 1.55, 2.05]) S.box(M.wood, x, sy, z, d, 0.03, w);
  for (const s of [-1, 1]) S.box(R.cabinet2, x, 1.05, z + s * w / 2, d, 2.1, 0.03);
  S.box(R.cabinet2, x + d / 2 - 0.01, 1.05, z, 0.02, 2.1, w, { collide: false });
  const subs = ['HCl', 'H2SO4', 'NaOH', 'CuSO4', 'KI', 'AgNO3', 'NaCl', 'BaCl2', 'PbNO3', 'limewater', 'H2O2', 'water'];
  for (const sy of [0.57, 1.07, 1.57]) for (let i = 0; i < 9; i++) {
    const sub = subs[Math.floor(r() * subs.length)], amber = sub === 'AgNO3' || sub === 'H2O2' || r() < 0.15;
    const label = SUBS[sub].formula.replace(/\(aq\)|\(l\)/, '');
    const b = P.reagentBottle(label.length > 9 ? label.slice(0, 9) : label, amber, 0.12 + (i % 2) * 0.03);
    vessel(W, b, V(x - 0.05 + (r() - 0.5) * 0.06, sy + 0.015, z - w / 2 + 0.15 + i * 0.21), sub, 0.6, { forceThreshold: 7 });
  }
}
function glassCabinet(W, S, R, x, z) {
  const w = 1.4, d = 0.45, hh = 1.9;
  S.box(R.cabinet, x, hh / 2, z, d, hh, w);
  S.box(R.cabinet2, x - 0.02, hh / 2 + 0.05, z, d - 0.04, hh - 0.1, w - 0.06, { collide: false });
  for (const sy of [0.45, 0.95, 1.45]) S.box(M.wood, x - 0.03, sy, z, d - 0.06, 0.02, w - 0.08);
  for (const s of [-1, 1]) new Pane(W, { pos: V(x - d / 2 - 0.005, hh / 2 + 0.05, z + s * w / 4), quat: new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), Math.PI / 2), w: w / 2 - 0.04, h: hh - 0.15, t: 0.005, mat: M.glass, name: 'Cabinet door glass', forceThreshold: 22 });
  for (const sy of [0.47, 0.97, 1.47]) for (let i = 0; i < 5; i++) vessel(W, i % 2 ? P.conical() : P.beaker(), V(x + 0.02, sy + 0.01, z - 0.5 + i * 0.25), null, 0, { forceThreshold: 7 });
}
function frontWall(W, S, R) {
  const z = ROOM.z1 - 0.01;
  const wb = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1.2), R.poster((g, w, h) => {
    g.fillStyle = '#f7f8f6'; g.fillRect(0, 0, w, h); g.strokeStyle = '#c8cbc8'; g.lineWidth = 8; g.strokeRect(0, 0, w, h);
    g.fillStyle = '#1f3c8a'; g.font = 'bold 34px Caveat, cursive'; g.fillText('Types of reaction', 30, 52);
    g.fillStyle = '#222'; g.font = '30px Caveat, cursive';
    ['A + B → AB   synthesis', 'AB → A + B   decomposition', 'A + BC → AC + B   single displacement', 'acid + base → salt + water', 'OIL RIG: oxidation is loss, reduction is gain'].forEach((t, i) => g.fillText(t, 40, 110 + i * 44));
    g.fillStyle = '#c4202f'; g.font = 'bold 30px Caveat, cursive'; g.fillText('GOGGLES ON. ALWAYS.', 620, 300);
  }, 1024, 340));
  wb.position.set(-1.2, 1.6, z); wb.rotation.y = Math.PI; W.scene.add(wb);
  S.box(R.frame, -1.2, 1.6, z + 0.005, 3.7, 1.3, 0.02, { collide: false });
  const pt = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.95), R.poster((g, w, h) => {
    g.fillStyle = '#0f1a2a'; g.fillRect(0, 0, w, h); const els = 'H,1,1 He,1,18 Li,2,1 Be,2,2 B,2,13 C,2,14 N,2,15 O,2,16 F,2,17 Ne,2,18 Na,3,1 Mg,3,2 Al,3,13 Si,3,14 P,3,15 S,3,16 Cl,3,17 Ar,3,18 K,4,1 Ca,4,2 Sc,4,3 Ti,4,4 V,4,5 Cr,4,6 Mn,4,7 Fe,4,8 Co,4,9 Ni,4,10 Cu,4,11 Zn,4,12 Ga,4,13 Ge,4,14 As,4,15 Se,4,16 Br,4,17 Kr,4,18'.split(' ');
    const cw = w / 19, ch = h / 6; g.font = `bold ${Math.round(cw * 0.42)}px Archivo, Arial`; g.textAlign = 'center';
    for (const e of els) { const [s, p, gr] = e.split(','); const x = (+gr) * cw - cw * 0.5, y = (+p) * ch; g.fillStyle = +gr <= 2 ? '#d8334a' : +gr >= 13 ? '#2f6fd6' : '#d68a2f'; g.fillRect(x - cw / 2 + 2, y - ch / 2 + 2, cw - 4, ch - 4); g.fillStyle = '#fff'; g.fillText(s, x, y + cw * 0.15); }
    g.font = 'bold 26px Archivo, Arial'; g.fillStyle = '#ffe14d'; g.textAlign = 'left'; g.fillText('PERIODIC TABLE', 20, h - 20);
  }, 1024, 600));
  pt.position.set(2.4, 1.7, z); pt.rotation.y = Math.PI; W.scene.add(pt);
  // door + safety sign
  S.box(M.wood, 5.4, 1.05, z + 0.01, 1.0, 2.1, 0.05, { collide: false }); S.box(M.steel, 5.05, 1.0, z - 0.03, 0.14, 0.03, 0.03, { collide: false });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.35), R.poster((g, w, h) => { g.fillStyle = '#0a6b3a'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.font = 'bold 50px Archivo, Arial'; g.textAlign = 'center'; g.fillText('EYE PROTECTION', w / 2, h / 2 - 10); g.font = 'bold 40px Archivo, Arial'; g.fillText('MUST BE WORN', w / 2, h / 2 + 50); }, 512, 360));
  sign.position.set(5.4, 2.4, z - 0.02); sign.rotation.y = Math.PI; W.scene.add(sign);
  // emergency shower (left front corner)
  S.box(M.steel, ROOM.x0 + 0.3, 1.3, ROOM.z1 - 0.3, 0.05, 2.6, 0.05); const head = new THREE.CylinderGeometry(0.15, 0.05, 0.1, 20); head.translate(ROOM.x0 + 0.3, 2.45, ROOM.z1 - 0.55); S.geo(M.chrome, head);
}

// ======================================================================= dynamic props
function props(W, obj, pos, rotY, o) { obj.position.copy(pos); obj.rotation.y = rotY; return new Prop(W, obj, o); }
export function vessel(W, group, pos, sub, fill, o = {}) { return new Vessel(W, group, { pos, rotY: Math.random() * 6.28, substance: sub, fill, name: sub ? SUBS[sub].name + ' (' + labelFor(group) + ')' : 'Empty ' + labelFor(group), ...o }); }
function labelFor(g) { return ({ beaker: 'beaker', conical: 'conical flask', tube: 'test tube', cylinder: 'measuring cylinder', bottle: 'reagent bottle', dropper: 'dropper bottle' })[g.userData.kind] || 'glassware'; }
function stool(W, pos, rotY) {
  const obj = new THREE.Group(); obj.position.copy(pos); obj.rotation.y = rotY; const parts = [], seatH = 0.62;
  const mk = (geo, mat, x, y, z, half, rx = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, 0, rz); m.castShadow = true; m.receiveShadow = true; parts.push({ mesh: m, half }); };
  mk(new THREE.CylinderGeometry(0.17, 0.17, 0.035, 20), M.wood, 0, seatH, 0, V(0.15, 0.0175, 0.15));
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) mk(new THREE.BoxGeometry(0.03, seatH, 0.03), M.wood, sx * 0.11, seatH / 2, sz * 0.11, V(0.015, seatH / 2, 0.015));
  for (const [sx, sz, ry] of [[0, 1, 0], [0, -1, 0], [1, 0, 1], [-1, 0, 1]]) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.02, 0.02), M.wood); m.position.set(sx * 0.11, 0.22, sz * 0.11); m.rotation.y = ry * Math.PI / 2; m.castShadow = true; parts.push({ mesh: m, half: V(0.11, 0.01, 0.01) }); }
  return new Parts(W, obj, parts, { name: 'Lab stool', substance: 'wood', wood: true, forceThreshold: 140 });
}
function rack(W, pos, rotY, n = 4) {
  const obj = new THREE.Group(); obj.position.copy(pos); obj.rotation.y = rotY; const parts = [], w = n * 0.04 + 0.03;
  const add = (sx, sy, sz, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), M.wood); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parts.push({ mesh: m, half: V(sx / 2, sy / 2, sz / 2) }); };
  add(w, 0.008, 0.05, 0, 0.004, 0); add(w, 0.008, 0.05, 0, 0.064, 0); add(0.008, 0.06, 0.05, -w / 2 + 0.004, 0.034, 0); add(0.008, 0.06, 0.05, w / 2 - 0.004, 0.034, 0);
  new Parts(W, obj, parts, { name: 'Test-tube rack', substance: 'wood', wood: true, forceThreshold: 80, density: 600 });
  return (i) => new THREE.Vector3(-((n - 1) * 0.04) / 2 + i * 0.04, 0.012, 0).applyAxisAngle(V(0, 1, 0), rotY).add(pos);
}
function extinguisher(W, pos) {
  const g = new THREE.Group(); const body = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.5, 24), new THREE.MeshPhysicalMaterial({ color: 0xc81e25, roughness: 0.3, clearcoat: 0.8 })); body.position.y = 0.25; body.castShadow = true; g.add(body);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.08, 16), M.blackPlastic); top.position.y = 0.54; g.add(top);
  props(W, g, pos, 0, { name: 'Fire extinguisher', density: 2500, metal: true });
}
export function bunsen(W, pos, air = 1, rotY = 0, on = true) {
  const g = new THREE.Group(); const m = P.model('bunsen'); g.add(m); const top = P.bunsenTop();
  const flame = new Flame(); flame.group.position.copy(top); g.add(flame.group);
  g.position.copy(pos); g.rotation.y = rotY;
  const e = new Prop(W, g, { name: 'Bunsen burner', substance: 'CH4', metal: true, density: 3000 });
  e.flame = flame; e.air = air; e.on = on; e.top = top;
  e.interact = () => { if (!e.on) { e.on = true; e.air = 0; W.toast('Bunsen lit · air hole closed: yellow safety flame', 'info'); } else if (e.air < 0.5) { e.air = 1; W.toast('Air hole open: roaring blue flame', 'info'); W.chem.react('ch4', g.position, { id: 'fire' }, e); } else { e.on = false; W.toast('Gas off', 'info'); } };
  e.update = (dt) => {
    Entity.prototype.update.call(e, dt);
    flame.set(e.air, e.on ? 1 : 0, W.time);
    if (e.on) { const tip = g.localToWorld(top.clone().add(V(0, 0.06 - e.air * 0.02, 0))); W.chem.fire(tip, 0.05, dt * (e.air > 0.5 ? 1.2 : 0.7), e); }
  };
  return e;
}
function ribbon(W, pos) {
  const m = P.ribbon(0.06); m.rotation.x = -Math.PI / 2; const g = new THREE.Group(); g.add(m); g.position.copy(pos).add(V(0, 0.003, 0)); g.rotation.y = Math.random() * 6;
  const e = new Prop(W, g, { name: 'Magnesium ribbon', substance: 'Mg', metal: true, density: 1740, colliders: [RAPIER.ColliderDesc.cuboid(0.03, 0.0015, 0.004)] });
  e.heat = (a) => { e.heatLevel += a; if (e.heatLevel > 0.5) W.chem.ignite(e); };
  return e;
}
function chips(W, pos, n, sub = 'CaCO3', mat = M.marble, size = 0.006) {
  for (let i = 0; i < n; i++) {
    const g = new THREE.Group(); const m = new THREE.Mesh(new THREE.DodecahedronGeometry(size * (0.7 + Math.random() * 0.6), 0), mat); m.scale.set(1, 0.7, 0.85); m.castShadow = true; g.add(m);
    g.position.copy(pos).add(V((Math.random() - 0.5) * 0.06, 0.008 + i * 0.002, (Math.random() - 0.5) * 0.06)); g.rotation.set(Math.random() * 6, Math.random() * 6, 0);
    new Prop(W, g, { name: SUBS[sub].name, substance: sub, density: 2700 });
  }
}
function nail(W, pos) {
  const n = P.nail(0.07); n.rotation.z = Math.PI / 2; const g = new THREE.Group(); g.add(n); g.position.copy(pos).add(V(0, 0.003, 0)); g.rotation.y = Math.random() * 6;
  const e = new Prop(W, g, { name: 'Iron nail', substance: 'Fe', metal: true, density: 7800 }); e.rust = n.userData.rust; return e;
}

// ======================================================================= stations (one per reel)
function stationTitration(W, T) {
  const st = props(W, P.model('retort'), T.clone().add(V(-0.05, 0, -0.25)), 0, { name: 'Retort stand', metal: true, substance: 'steel', density: 4000 });
  props(W, P.model('burette'), T.clone().add(V(0.0, 0.17, -0.12)), 0, { name: 'Burette (glass)', density: 2200 });
  void st;
  vessel(W, P.conical(), T.clone().add(V(0, 0, -0.12)), 'UI', 0.3);
  vessel(W, P.beaker(), T.clone().add(V(0.35, 0, 0.1)), 'NaOH', 0.6);
  vessel(W, P.beaker(), T.clone().add(V(-0.4, 0, 0.15)), 'HCl', 0.6);
  vessel(W, P.dropperBottle(true), T.clone().add(V(0.6, 0, -0.25)), 'UI', 0.7);
  vessel(W, P.dropperBottle(false, 'PHENOL.'), T.clone().add(V(0.68, 0, -0.18)), 'water', 0.7);
  goggles(W, T.clone().add(V(-0.9, 0, 0.3)));
  props(W, P.balance(), T.clone().add(V(1.0, 0, -0.1)), -0.3, { name: 'Digital balance', density: 900 });
  vessel(W, P.cylinder(), T.clone().add(V(-1.0, 0, -0.2)), 'water', 0.5);
}
function stationDecomposition(W, T) {
  bunsen(W, T.clone().add(V(-0.2, 0, -0.1)), 1);
  props(W, P.model('tripod'), T.clone().add(V(0.4, 0, -0.1)), 0.3, { name: 'Tripod', metal: true, substance: 'steel', density: 4000 });
  const gz = P.gauze(0.13); gz.position.set(0, 0.006, 0); const gg = new THREE.Group(); gg.add(gz); gg.position.copy(T).add(V(0.4, 0.222, -0.1)); new Prop(W, gg, { name: 'Wire gauze', metal: true, substance: 'steel', colliders: [RAPIER.ColliderDesc.cuboid(0.065, 0.003, 0.065).setTranslation(0, 0.006, 0)] });
  vessel(W, P.beaker(), T.clone().add(V(0.4, 0.232, -0.1)), 'water', 0.6);
  const slot = rack(W, T.clone().add(V(-0.7, 0, 0.2)), 0.2, 4);
  for (let i = 0; i < 4; i++) vessel(W, P.tube(), slot(i), i < 2 ? 'limewater' : 'water', 0.6);
  props(W, P.balance(), T.clone().add(V(0.9, 0, 0.2)), 0.2, { name: 'Digital balance', density: 900 });
  vessel(W, P.conical(), T.clone().add(V(0.9, 0.056, 0.18)), 'HCl', 0.3);
  goggles(W, T.clone().add(V(-1.1, 0, -0.25)));
}
function stationDisplacement(W, T) {
  const slot = rack(W, T.clone().add(V(-0.6, 0, -0.15)), 0, 4);
  for (let i = 0; i < 4; i++) vessel(W, P.tube(), slot(i), 'HCl', 0.55);
  props(W, P.heatMat(0.24), T.clone().add(V(0.1, 0, 0.1)), 0, { name: 'Heat-proof mat', density: 1200 });
  for (let i = 0; i < 4; i++) ribbon(W, T.clone().add(V(0.0 + i * 0.06, 0.006, 0.1)));
  vessel(W, P.beaker(), T.clone().add(V(0.6, 0, -0.15)), 'CuSO4', 0.6);
  chips(W, T.clone().add(V(0.85, 0, 0.2)), 6, 'Zn', M.zinc, 0.005);
  vessel(W, P.beaker(), T.clone().add(V(-0.25, 0, 0.3)), 'HCl', 0.5);
  chips(W, T.clone().add(V(1.1, 0, -0.2)), 8, 'CaCO3', M.marble, 0.007);
  goggles(W, T.clone().add(V(-1.0, 0, 0.35)));
}
function stationPrecipitation(W, T) {
  const subs = ['PbNO3', 'KI', 'AgNO3', 'NaCl', 'CuSO4', 'NaOH', 'BaCl2', 'H2SO4'];
  subs.forEach((s, i) => { const lab = SUBS[s].formula.replace('(aq)', ''); vessel(W, P.reagentBottle(lab.length > 9 ? lab.slice(0, 9) : lab, s === 'AgNO3', 0.13), T.clone().add(V(-1.05 + i * 0.12, 0, -0.35)), s, 0.6, { forceThreshold: 8 }); });
  for (let i = 0; i < 4; i++) vessel(W, P.beaker({ r: 0.026, h: 0.07, ml: 100, step: 10 }), T.clone().add(V(-0.6 + i * 0.18, 0, 0.1)), null, 0);
  const slot = rack(W, T.clone().add(V(0.6, 0, 0.15)), -0.1, 4);
  ['PbNO3', 'KI', 'AgNO3', 'NaCl'].forEach((s, i) => vessel(W, P.tube(), slot(i), s, 0.5));
  goggles(W, T.clone().add(V(1.05, 0, -0.2)));
}
function stationRedox(W, T) {
  const slot = rack(W, T.clone().add(V(-0.5, 0, -0.1)), 0, 4);
  ['water', 'water', 'NaCl', 'NaCl'].forEach((s, i) => vessel(W, P.tube(), slot(i), s, 0.6));
  for (let i = 0; i < 5; i++) nail(W, T.clone().add(V(-0.1 + i * 0.05, 0, 0.25)));
  vessel(W, P.beaker(), T.clone().add(V(0.3, 0, -0.2)), 'NaCl', 0.7);
  bunsen(W, T.clone().add(V(0.8, 0, 0.0)), 0, 0, true);
  props(W, P.heatMat(0.24), T.clone().add(V(0.8, 0, 0.3)), 0, { name: 'Heat-proof mat', density: 1200 });
  ribbon(W, T.clone().add(V(0.8, 0.006, 0.3))); ribbon(W, T.clone().add(V(0.86, 0.006, 0.32)));
  props(W, P.tongs(), T.clone().add(V(1.1, 0, 0.3)), 0.4, { name: 'Crucible tongs', metal: true, substance: 'steel', density: 7800 });
  goggles(W, T.clone().add(V(-1.0, 0, 0.3)));
}
function stationHydrogen(W, T) {
  const st = props(W, P.model('retort'), T.clone().add(V(0, 0, -0.2)), 0, { name: 'Retort stand', metal: true, substance: 'steel', density: 6000 });
  for (let i = 0; i < 3; i++) { const b = P.balloon([0xd9363e, 0x3a7be0, 0xf2c230][i]); new Balloon(W, b, { pos: T.clone().add(V(-0.25 + i * 0.25, 0.75, -0.2)), anchor: st, anchorPt: V(0, 0.55, 0), ropeLen: 0.45 }); }
  for (let i = 0; i < 3; i++) props(W, P.splint(0.15), T.clone().add(V(0.5 + i * 0.02, 0.003, 0.3)), 0.2, { name: 'Wooden splint', substance: 'wood', density: 500 });
  for (let i = 0; i < 3; i++) vessel(W, P.cylinder(), T.clone().add(V(-0.9 + i * 0.12, 0, 0.25)), 'H2O2', 0.6);
  vessel(W, P.conical(), T.clone().add(V(0.9, 0, -0.1)), 'water', 0.4);
  goggles(W, T.clone().add(V(1.1, 0, 0.3)));
}
function perimeterGlass(W, pz) {
  const B = ROOM.bench, r = rng(7);
  for (let x = -6.2; x < 6.3; x += 0.55) {
    if (Math.abs(Math.abs(x) - 3.1) < 0.45) continue;
    const k = r(), sub = ['water', 'HCl', 'CuSO4', 'limewater', null][Math.floor(r() * 5)];
    const g = k < 0.4 ? P.beaker() : k < 0.65 ? P.conical() : k < 0.85 ? P.cylinder() : P.beaker({ r: 0.026, h: 0.07, ml: 100, step: 10 });
    vessel(W, g, V(x + (r() - 0.5) * 0.15, B, pz + (r() - 0.5) * 0.2), sub, 0.5);
  }
}
function goggles(W, pos) { const g = P.goggles(); g.position.copy(pos); g.rotation.y = Math.random() * 6; return new Prop(W, g, { name: 'Safety goggles', density: 500 }); }
export { hullFromObject };
