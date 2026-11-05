// Game entities: props, breakable glass vessels (local shard breakage), panes/tiles (local Voronoi breakage),
// multi-part objects (stools/racks: parts detach, planks split), hydrogen balloons, debris management.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RAPIER, hullDesc } from '../core/physics.js';
import { vesselShards, mergeShards, voronoi, impactSeeds, prism, polyCentroid, pointInPoly, polyArea, rng } from './fracture.js';
import { M } from './materials.js';
import { Liquid } from './props.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
const rand = (a, b) => a + Math.random() * (b - a);
let SEED = 1;
const isSeeThrough = m => !!(m.transparent || m.transmission > 0);
const BASE_OBC = THREE.Material.prototype.onBeforeCompile;

/** Draw-call saver: merge an object's plain opaque meshes into one mesh per material (in obj space) and hide the
 *  originals. Returns an undo function (restores the originals) or null when there was nothing worth merging. */
export function proxify(obj) {
  obj.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(obj.matrixWorld).invert(), groups = new Map(); let n = 0;
  obj.traverse(c => {
    if (!c.isMesh || c.isInstancedMesh || c.isSkinnedMesh || !c.visible || c.userData.keep || c.userData.proxy) return;
    const m = c.material;
    if (Array.isArray(m) || isSeeThrough(m) || m.isShaderMaterial || m.vertexColors || m.onBeforeCompile !== BASE_OBC || c.layers.mask !== 1) return;
    for (let a = c.parent; a && a !== obj; a = a.parent) if (!a.visible) return;
    const g = c.geometry.index ? c.geometry.toNonIndexed() : c.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv || g.attributes.uv.itemSize !== 2) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.morphAttributes = {}; g.clearGroups(); g.applyMatrix4(_m.multiplyMatrices(inv, c.matrixWorld));
    if (!groups.has(m)) groups.set(m, { geos: [], meshes: [], cast: false });
    const e = groups.get(m); e.geos.push(g); e.meshes.push(c); e.cast = e.cast || c.castShadow; n++;
  });
  if (n < 2) { for (const e of groups.values()) e.geos.forEach(g => g.dispose()); return null; }
  const proxies = [], hidden = [];
  for (const [m, e] of groups) {
    const merged = mergeGeometries(e.geos, false); e.geos.forEach(g => g.dispose()); if (!merged) continue;
    const mesh = new THREE.Mesh(merged, m); mesh.castShadow = e.cast; mesh.receiveShadow = true; mesh.userData.noCollide = true; mesh.userData.proxy = true;
    obj.add(mesh); proxies.push(mesh); for (const c of e.meshes) { c.visible = false; hidden.push(c); }
  }
  return () => { for (const p of proxies) { p.removeFromParent(); p.geometry.dispose(); } for (const c of hidden) c.visible = true; };
}

export class Entity {
  constructor(W, obj, o = {}) {
    this.W = W; this.obj = obj; this.name = o.name || 'Object'; this.substance = o.substance || null; this.breakable = false;
    this.heatLevel = 0; this.alive = true; this.cool = 0;
    W.scene.add(obj); W.entities.add(this);
  }
  get pos() { return this.obj.position; }
  isDynamic() { return this.body && this.body.isDynamic(); }
  impulse(dir, mag, point) {
    if (!this.isDynamic()) return;
    const m = this.body.mass(); const k = Math.min(mag, m * 25);
    if (point) this.body.applyImpulseAtPoint({ x: dir.x * k, y: dir.y * k, z: dir.z * k }, { x: point.x, y: point.y, z: point.z }, true);
    else this.body.applyImpulse({ x: dir.x * k, y: dir.y * k, z: dir.z * k }, true);
  }
  /** Generic hit from a tool/projectile/explosion. */
  hit(point, dir, power, cause) { this.impulse(dir, power * 0.6, point); if (this.metal && power > 0.4) this.W.fx.sparks(point, 10, 2, [3, 2.2, 1.2], 0.35, 0.006); }
  onForce(force, point, other) { }
  heat(amount, point) { this.heatLevel += amount; }
  update(dt) { this.heatLevel = Math.max(0, this.heatLevel - dt * 0.15); }
  remove() { this.alive = false; this.W.shadowDirty = true; this.W.physics.detach(this); this.obj.removeFromParent(); this.W.entities.delete(this); }
}

/** Plain rigid prop (metal stands, Bunsen, balance, nails...). */
export class Prop extends Entity {
  constructor(W, obj, o = {}) {
    super(W, obj, o); this.metal = !!o.metal;
    const descs = o.colliders || [hullFromObject(obj)];
    for (const d of descs) { d.setDensity(o.density ?? 1500); d.setFriction(o.friction ?? 0.7); d.setRestitution(o.restitution ?? 0.1); }
    W.physics.attach(this, descs, { type: o.fixed ? 'fixed' : 'dynamic', sleeping: true, events: !!o.events, threshold: o.threshold });
    if (o.proxy !== false) proxify(obj); // props never come apart, so their meshes can stay merged
  }
}
/** Convex hull collider from every mesh vertex under obj (in obj-local coords). */
export function hullFromObject(obj, maxPts = 96) {
  obj.updateMatrixWorld(true); const inv = new THREE.Matrix4().copy(obj.matrixWorld).invert(), pts = [];
  obj.traverse(c => { if (!c.isMesh || c.userData.noCollide) return; const p = c.geometry.attributes.position; _m.multiplyMatrices(inv, c.matrixWorld); const step = Math.max(1, Math.floor(p.count / 200)); for (let i = 0; i < p.count; i += step) { _v.fromBufferAttribute(p, i).applyMatrix4(_m); pts.push(_v.x, _v.y, _v.z); } });
  return hullDesc(new Float32Array(pts), maxPts);
}

// ===================================================================== debris (shards)
export class Debris {
  constructor(W) { this.W = W; this.live = []; this.frozen = []; this.batches = []; this.total = 0; }
  spawn(geo, mat, matrixWorld, linvel, angvel, o = {}) {
    const W = this.W, mesh = new THREE.Mesh(geo, mat);
    _m.copy(matrixWorld); _m.decompose(mesh.position, mesh.quaternion, mesh.scale);
    mesh.castShadow = !isSeeThrough(mat); mesh.renderOrder = mat === M.glass || mat === M.amberGlass ? 2 : 0;
    const e = { obj: mesh, name: o.name || 'shard', debris: true, alive: true, age: 0, sleep: 0, W };
    e.hit = (p, d, pw) => { if (e.body) e.body.applyImpulseAtPoint({ x: d.x * pw * 0.02, y: d.y * pw * 0.02, z: d.z * pw * 0.02 }, p, true); };
    e.heat = () => { }; e.onForce = () => { };
    W.scene.add(mesh);
    const d = hullDesc(geo.attributes.position.array, 24); d.setDensity(o.density ?? 2230).setFriction(0.6).setRestitution(0.15);
    W.physics.attach(e, [d], { type: 'dynamic', linvel, angvel, linDamp: 0.1, angDamp: 0.4, pos: mesh.position, quat: mesh.quaternion });
    this.live.push(e); this.total++;
    if (this.live.length > 260) this.freeze(this.live[0]);
    return e;
  }
  freeze(e) {
    const i = this.live.indexOf(e); if (i >= 0) this.live.splice(i, 1);
    this.W.physics.detach(e); e.obj.updateMatrixWorld(true); e.obj.matrixAutoUpdate = false; this.frozen.push(e);
  }
  update(dt) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const e = this.live[i]; e.age += dt;
      if (!e.body) continue;
      const p = e.body.translation(); if (p.y < -5) { this.W.physics.detach(e); e.obj.removeFromParent(); this.live.splice(i, 1); continue; }
      e.sleep = e.body.isSleeping() ? e.sleep + dt : 0;
      if (e.sleep > 1.2 || e.age > 14) this.freeze(e);
    }
    // batch-merge frozen shards per material (keeps draw calls flat)
    if (this.frozen.length >= 24) {
      const byMat = new Map();
      for (const e of this.frozen) { const m = e.obj.material; if (!byMat.has(m)) byMat.set(m, []); byMat.get(m).push(e); }
      for (const [mat, list] of byMat) {
        const geos = list.map(e => { const g = e.obj.geometry.clone(); g.applyMatrix4(e.obj.matrixWorld); return g; });
        const merged = mergeGeometries(geos, false); geos.forEach(g => g.dispose());
        if (merged) { const mesh = new THREE.Mesh(merged, mat); mesh.castShadow = !isSeeThrough(mat); mesh.receiveShadow = true; mesh.renderOrder = list[0].obj.renderOrder; mesh.matrixAutoUpdate = false; this.W.scene.add(mesh); this.batches.push({ mesh, n: list.length }); }
        for (const e of list) e.obj.removeFromParent();
      }
      this.frozen = [];
      let count = this.batches.reduce((a, b) => a + b.n, 0);
      while (count > 2400 && this.batches.length) { const b = this.batches.shift(); b.mesh.removeFromParent(); b.mesh.geometry.dispose(); count -= b.n; }
    }
  }
  clear() { for (const e of this.live) { this.W.physics.detach(e); e.obj.removeFromParent(); } for (const e of this.frozen) e.obj.removeFromParent(); for (const b of this.batches) { b.mesh.removeFromParent(); b.mesh.geometry.dispose(); } this.live = []; this.frozen = []; this.batches = []; }
}

function scatterVel(base, dir, speed) {
  return { x: base.x + dir.x * speed + rand(-0.6, 0.6) * speed * 0.5, y: base.y + dir.y * speed + rand(0, 0.8) * speed * 0.5, z: base.z + dir.z * speed + rand(-0.6, 0.6) * speed * 0.5 };
}
function bodyVelAt(body, p) {
  if (!body) return new THREE.Vector3();
  const v = body.linvel(), w = body.angvel(), c = body.translation();
  const rx = p.x - c.x, ry = p.y - c.y, rz = p.z - c.z;
  return new THREE.Vector3(v.x + w.y * rz - w.z * ry, v.y + w.z * rx - w.x * rz, v.z + w.x * ry - w.y * rx);
}

// ===================================================================== glass vessel (local shard breakage)
export class Vessel extends Entity {
  /** group: a props.js vessel group (glass lathe + decor). tpl: shared shard template for fragments. */
  constructor(W, group, o = {}) {
    const obj = o.obj || new THREE.Group(); if (!o.obj) { obj.add(group); obj.position.copy(o.pos || new THREE.Vector3()); obj.rotation.y = o.rotY || 0; }
    super(W, obj, o);
    this.breakable = true; this.forceThreshold = o.forceThreshold ?? 9; this.ud = group ? group.userData : o.ud;
    this.glassMat = M[this.ud.glassMat || 'glass'];
    this.group = group; this.tpl = o.tpl || null; this.ids = o.ids || null; this.clusterMesh = null; this.lastBreak = 0;
    this.glassMesh = group ? group.children.find(c => c.isMesh && (c.material === M.glass || c.material === M.amberGlass || c.material === M.glassThick)) : null;
    // liquid
    this.level = 0; this.liq = null;
    if (o.substance && group) {
      const S = W.chem.sub(o.substance);
      if (S && S.liquid) { this.liq = new Liquid(this.ud.inner, this.ud.floor, S.colour); this.level = this.ud.floor + (this.ud.top - this.ud.floor) * (o.fill ?? 0.55); this.liq.set(this.level); group.add(this.liq.mesh); }
    }
    const d = o.collider || hullDesc(this.glassMesh ? this.glassMesh.geometry.attributes.position.array : mergeShards(this.tpl.shards, this.ids).attributes.position.array, 48);
    d.setDensity(o.density ?? 1600).setFriction(0.6).setRestitution(0.05);
    W.physics.attach(this, [d], { type: 'dynamic', sleeping: !o.linvel, linvel: o.linvel, angvel: o.angvel, pos: o.pos2, quat: o.quat2, threshold: this.forceThreshold });
    if (this.tpl && !group) this.buildClusterMesh();
    if (group) this.unproxy = proxify(group); // caps/labels merged until the first break
  }
  ensureTemplate() {
    if (this.tpl) return;
    if (this.unproxy) { this.unproxy(); this.unproxy = null; }
    this.tpl = vesselShards(this.ud, SEED++);
    this.ids = new Set(this.tpl.shards.map((_, i) => i));
    if (this.glassMesh) this.glassMesh.visible = false;
    // labels / bands peel off; caps and bulbs become loose props
    if (this.group) for (const c of [...this.group.children]) {
      if (c.userData.decor) c.visible = false;
      if (c.userData.cap) { c.updateMatrixWorld(true); const g = c.geometry.clone(); g.applyMatrix4(new THREE.Matrix4().makeScale(c.scale.x, c.scale.y, c.scale.z)); const mw = c.matrixWorld.clone(); c.removeFromParent(); this.W.debris.spawn(g, c.material, mw, bodyVelAt(this.body, this.pos), undefined, { density: 900 }); }
    }
    this.buildClusterMesh();
  }
  buildClusterMesh() {
    if (this.clusterMesh) { this.clusterMesh.geometry.dispose(); this.clusterMesh.removeFromParent(); }
    const g = mergeShards(this.tpl.shards, [...this.ids]);
    this.clusterMesh = new THREE.Mesh(g, this.glassMat); this.clusterMesh.castShadow = false; this.clusterMesh.renderOrder = 2;
    (this.group || this.obj).add(this.clusterMesh);
  }
  onForce(force, point) {
    if (force < this.forceThreshold || this.W.time - this.lastBreak < 0.06) return;
    const r = Math.min(0.06, 0.012 + (force - this.forceThreshold) * 0.0006);
    this.breakAt(point, _v2.set(0, 0, 0), r, force * 0.01);
  }
  hit(point, dir, power, cause) {
    super.hit(point, dir, power * 0.3, cause);
    this.breakAt(point, dir, cause === 'explosion' ? 0.05 + power * 0.02 : cause === 'bearing' ? 0.016 : cause === 'thermal' ? 0.014 : 0.022 + power * 0.006, power);
  }
  heat(amount, point) {
    this.heatLevel += amount;
    if (this.liq && this.level > this.ud.floor + 0.002 && Math.random() < amount * 3) { _v.set(rand(-0.4, 0.4) * this.ud.r, this.ud.floor + 0.004, rand(-0.4, 0.4) * this.ud.r); this.obj.localToWorld(_v); this.W.fx.bubbles.emit(_v.x, _v.y, _v.z, 0.0015, this.obj.localToWorld(_v2.set(0, this.level, 0)).y); if (Math.random() < 0.3) this.W.fx.plume(this.obj.localToWorld(_v2.set(0, this.ud.top, 0)), [0.95, 0.97, 1], 1, 0.06, 0.25, 0.08); }
    if (this.heatLevel > 1.4 && this.W.time - this.lastBreak > 0.5) { this.W.toast('Thermal shock: hot glass cracks', 'crack'); this.breakAt(point, new THREE.Vector3(0, 0.3, 0), 0.016, 0.4); this.heatLevel = 0.9; }
  }
  /** Break locally around a world point. */
  breakAt(point, dir, radius, power = 1) {
    if (!this.alive) return;
    this.ensureTemplate(); this.lastBreak = this.W.time;
    const W = this.W, sh = this.tpl.shards, local = this.obj.worldToLocal(point.clone());
    // shards near the impact
    let near = []; let best = -1, bd = 1e9;
    for (const i of this.ids) { const d = sh[i].c.distanceTo(local); if (d < radius) near.push(i); if (d < bd) { bd = d; best = i; } }
    if (!near.length && best >= 0) near = [best];
    const big = power > 6 || radius > 0.055;
    const base = bodyVelAt(this.body, point), outDir = dir.lengthSq() > 0 ? dir.clone().normalize() : point.clone().sub(this.obj.position).setY(0.4).normalize();
    this.obj.updateMatrixWorld(true);
    const spawnShard = (i, speed) => W.debris.spawn(sh[i].geo, this.glassMat, this.obj.matrixWorld, scatterVel(base, outDir, speed), { x: rand(-15, 15), y: rand(-15, 15), z: rand(-15, 15) });
    let removedMinY = 1e9;
    for (const i of near) { this.ids.delete(i); removedMinY = Math.min(removedMinY, sh[i].ymin); spawnShard(i, 0.8 + power * 0.6); }
    W.fx.glassGlints(point, 10 + near.length * 2, outDir); W.audio?.glass(point, power);
    // connectivity: largest component stays; others fall away as fragments or loose shards
    const comps = components(this.ids, this.tpl.adj);
    comps.sort((a, b) => b.length - a.length);
    const total = this.tpl.shards.length;
    if (!comps.length || comps[0].length < total * 0.22 || big) {
      for (const c of comps) for (const i of c) { removedMinY = Math.min(removedMinY, sh[i].ymin); spawnShard(i, 0.5 + power * 0.5); }
      this.spill(1, point); this.remove(); return;
    }
    for (const c of comps.slice(1)) {
      for (const i of c) { this.ids.delete(i); removedMinY = Math.min(removedMinY, sh[i].ymin); }
      if (c.length <= 3) for (const i of c) spawnShard(i, 0.4);
      else this.spawnFragment(c, base);
    }
    this.buildClusterMesh(); this.rebuildCollider();
    if (this.liq && removedMinY < this.level) this.leakTo(Math.max(this.ud.floor, removedMinY - 0.002), point);
  }
  spawnFragment(ids, base) {
    const obj = new THREE.Group(); this.obj.updateMatrixWorld(true); this.obj.matrixWorld.decompose(obj.position, obj.quaternion, obj.scale);
    const f = new Vessel(this.W, null, { obj, tpl: this.tpl, ids: new Set(ids), ud: this.ud, name: this.name + ' (fragment)', linvel: { x: base.x, y: base.y, z: base.z }, collider: hullDesc(mergeShards(this.tpl.shards, ids).attributes.position.array, 40), pos2: obj.position, quat2: obj.quaternion });
    f.glassMat = this.glassMat; f.buildClusterMesh();
  }
  rebuildCollider() {
    const old = [...this.colliders]; for (const c of old) this.W.physics.removeCollider(this, c);
    const d = hullDesc(this.clusterMesh.geometry.attributes.position.array, 40); d.setDensity(1600).setFriction(0.6);
    this.W.physics.addCollider(this, d); this.body.wakeUp();
  }
  leakTo(y, point) {
    const before = this.level; this.leakTarget = Math.min(this.leakTarget ?? 1e9, y);
    if (!this.leaking) { this.leaking = true; this.W.chem.spill(this, point, 0); }
    void before;
  }
  spill(fraction, point) {
    if (!this.liq || this.level <= this.ud.floor + 0.001) return;
    const vol = (this.level - this.ud.floor) * Math.PI * this.ud.inner(this.ud.floor + 0.01) ** 2 * fraction;
    this.W.chem.spill(this, point || this.obj.position, vol);
    this.level = this.ud.floor + (this.level - this.ud.floor) * (1 - fraction);
    if (this.level <= this.ud.floor + 0.0015) this.liq.mesh.visible = false; else this.liq.set(this.level);
  }
  update(dt) {
    super.update(dt);
    if (!this.liq || !this.liq.mesh.visible) return;
    // leaking through a hole
    if (this.leaking && this.level > this.leakTarget) { const d = Math.min(this.level - this.leakTarget, dt * 0.02); this.spill(d / Math.max(1e-4, this.level - this.ud.floor), this.obj.localToWorld(_v.set(0, this.leakTarget, this.ud.r))); }
    // tipping over pours it out
    _v.set(0, 1, 0).applyQuaternion(this.obj.quaternion);
    if (_v.y < 0.35 && this.level > this.ud.floor + 0.002) this.spill(Math.min(1, dt * 1.6), this.obj.localToWorld(_v2.set(0, this.ud.top, 0)));
  }
  remove() { if (this.liq) this.spill(1); super.remove(); }
}

export function components(ids, adj) {
  const seen = new Set(), out = [];
  for (const s of ids) {
    if (seen.has(s)) continue; const comp = [], st = [s]; seen.add(s);
    while (st.length) { const x = st.pop(); comp.push(x); for (const y of adj[x]) if (ids.has(y) && !seen.has(y)) { seen.add(y); st.push(y); } }
    out.push(comp);
  }
  return out;
}

// ===================================================================== panes & tiles (local Voronoi breakage)
export class Pane extends Entity {
  /** w×h×t in local XY, anchored = held by its frame on all edges. */
  constructor(W, o) {
    const obj = new THREE.Group(); obj.position.copy(o.pos); obj.quaternion.copy(o.quat || new THREE.Quaternion());
    super(W, obj, o);
    this.w = o.w; this.h = o.h; this.t = o.t; this.mat = o.mat || M.glass; this.anchored = o.anchored !== false; this.breakable = true; this.forceThreshold = o.forceThreshold ?? 14;
    this.isGlass = this.mat === M.glass || this.mat === M.glassThick; this.ceramic = !!o.ceramic;
    this.intact = new THREE.Mesh(new THREE.BoxGeometry(o.w, o.h, o.t), this.mat); this.intact.castShadow = !this.isGlass; this.intact.receiveShadow = true; this.intact.renderOrder = this.isGlass ? 2 : 0; obj.add(this.intact);
    this.cells = null; this.crackEdges = []; this.lastBreak = 0; this.rnd = rng(SEED++ * 7);
    W.physics.attach(this, [RAPIER.ColliderDesc.cuboid(o.w / 2, o.h / 2, o.t / 2).setFriction(0.5)], { type: 'fixed', threshold: this.forceThreshold });
  }
  onForce(force, point) { if (force > this.forceThreshold && this.W.time - this.lastBreak > 0.05) this.breakAt(point, new THREE.Vector3(), Math.min(0.12, 0.03 + force * 0.0008), force * 0.01); }
  hit(point, dir, power, cause) { this.breakAt(point, dir, cause === 'explosion' ? 0.12 + power * 0.04 : cause === 'bearing' ? 0.035 : 0.05 + power * 0.01, power); }
  heat(a, p) { this.heatLevel += a; if (this.isGlass && this.heatLevel > 2 && this.W.time - this.lastBreak > 0.6) { this.breakAt(p, new THREE.Vector3(), 0.04, 0.3); this.heatLevel = 1.2; } }
  breakAt(point, dir, radius, power = 1) {
    if (!this.alive) return; this.lastBreak = this.W.time;
    const W = this.W, l = this.obj.worldToLocal(point.clone()), x = THREE.MathUtils.clamp(l.x, -this.w / 2, this.w / 2), y = THREE.MathUtils.clamp(l.y, -this.h / 2, this.h / 2);
    if (!this.cells) { const hw = this.w / 2, hh = this.h / 2; this.cells = [{ poly: [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]] }]; this.intact.visible = false; }
    // sub-fracture the cells around the impact (dense near it, sparse further out = local shatter)
    const next = []; let refined = 0;
    for (const c of this.cells) {
      const inside = pointInPoly(c.poly, x, y), near = inside || polyDist(c.poly, x, y) < radius * 0.8;
      if (near && refined < 4 && Math.abs(polyArea(c.poly)) > radius * radius * 0.4) {
        refined++; const sub = voronoi(c.poly, impactSeeds(c.poly, x, y, radius * 0.7, this.rnd));
        for (const p of sub) next.push({ poly: p });
        for (const p of sub) for (let k = 0; k < p.length; k++) if (Math.hypot(p[k][0] - x, p[k][1] - y) < radius * 3) this.crackEdges.push(p[k], p[(k + 1) % p.length]);
      } else next.push(c);
    }
    this.cells = next;
    // detach cells near the impact
    const keep = [], drop = [];
    for (const c of this.cells) { const [cx, cy] = polyCentroid(c.poly); (Math.hypot(cx - x, cy - y) < radius || pointInPoly(c.poly, x, y) ? drop : keep).push(c); }
    this.cells = keep;
    const dirN = dir.lengthSq() ? dir.clone().normalize() : new THREE.Vector3(0, 0, 1).applyQuaternion(this.obj.quaternion);
    this.obj.updateMatrixWorld(true);
    for (const c of drop) this.dropCell(c, dirN, 0.6 + power * 0.5);
    // connectivity: cells still touching the frame (or the largest piece) stay; the rest fall
    this.settleConnectivity(dirN);
    if (this.isGlass) W.fx.glassGlints(point, 14, dirN); else W.fx.dust(point, 8, [0.85, 0.85, 0.82], 0.03);
    W.audio?.glass(point, power);
    this.rebuild();
  }
  dropCell(c, dir, speed) {
    const geo = prism(c.poly, this.t, 4);
    this.W.debris.spawn(geo, this.mat, this.obj.matrixWorld, scatterVel(new THREE.Vector3(), dir, speed), { x: rand(-8, 8), y: rand(-8, 8), z: rand(-8, 8) }, { density: this.ceramic ? 2400 : 2500 });
  }
  settleConnectivity(dir) {
    if (!this.cells.length) return;
    const G = 0.012, nx = Math.ceil(this.w / G), ny = Math.ceil(this.h / G), lab = new Int32Array(nx * ny).fill(-1);
    this.cells.forEach((c, ci) => { let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9; for (const p of c.poly) { minx = Math.min(minx, p[0]); maxx = Math.max(maxx, p[0]); miny = Math.min(miny, p[1]); maxy = Math.max(maxy, p[1]); }
      for (let gx = Math.max(0, Math.floor((minx + this.w / 2) / G)); gx <= Math.min(nx - 1, Math.floor((maxx + this.w / 2) / G)); gx++) for (let gy = Math.max(0, Math.floor((miny + this.h / 2) / G)); gy <= Math.min(ny - 1, Math.floor((maxy + this.h / 2) / G)); gy++) { const px = -this.w / 2 + (gx + 0.5) * G, py = -this.h / 2 + (gy + 0.5) * G; if (pointInPoly(c.poly, px, py)) lab[gy * nx + gx] = ci; } });
    const reach = new Uint8Array(nx * ny), st = [];
    if (this.anchored) { for (let gx = 0; gx < nx; gx++) for (const gy of [0, ny - 1]) if (lab[gy * nx + gx] >= 0) st.push(gy * nx + gx); for (let gy = 0; gy < ny; gy++) for (const gx of [0, nx - 1]) if (lab[gy * nx + gx] >= 0) st.push(gy * nx + gx); }
    else { let bi = 0, ba = 0; this.cells.forEach((c, i) => { const a = Math.abs(polyArea(c.poly)); if (a > ba) { ba = a; bi = i; } }); for (let k = 0; k < lab.length; k++) if (lab[k] === bi) { st.push(k); break; } }
    for (const k of st) reach[k] = 1;
    while (st.length) { const k = st.pop(), gx = k % nx, gy = (k / nx) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = gx + dx, Y = gy + dy; if (X < 0 || Y < 0 || X >= nx || Y >= ny) continue; const q = Y * nx + X; if (!reach[q] && lab[q] >= 0) { reach[q] = 1; st.push(q); } } }
    const held = new Set(); for (let k = 0; k < lab.length; k++) if (reach[k] && lab[k] >= 0) held.add(lab[k]);
    const keep = []; this.cells.forEach((c, i) => { if (held.has(i) || Math.abs(polyArea(c.poly)) < 1e-6) keep.push(c); else this.dropCell(c, dir, 0.2); });
    this.cells = keep;
  }
  rebuild() {
    if (this.cellMesh) { this.cellMesh.geometry.dispose(); this.cellMesh.removeFromParent(); this.cellMesh = null; }
    if (this.crackLines) { this.crackLines.geometry.dispose(); this.crackLines.removeFromParent(); this.crackLines = null; }
    for (const c of [...this.colliders]) this.W.physics.removeCollider(this, c);
    if (!this.cells.length) { this.remove(); return; }
    const geos = this.cells.map(c => c.geo || (c.geo = prism(c.poly, this.t, 4)));
    const g = mergeGeometries(geos, false); this.cellMesh = new THREE.Mesh(g, this.mat); this.cellMesh.renderOrder = this.isGlass ? 2 : 0; this.cellMesh.castShadow = !this.isGlass; this.cellMesh.receiveShadow = true; this.obj.add(this.cellMesh);
    if (this.crackEdges.length && this.isGlass) {
      const pts = []; for (let k = 0; k < this.crackEdges.length; k += 2) { const a = this.crackEdges[k], b = this.crackEdges[k + 1]; pts.push(a[0], a[1], this.t / 2 + 0.0004, b[0], b[1], this.t / 2 + 0.0004); }
      const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      this.crackLines = new THREE.LineSegments(lg, CRACK_MAT); this.obj.add(this.crackLines);
    }
    for (const c of this.cells) { const d = hullDesc(c.geo.attributes.position.array, 24); if (d) this.W.physics.addCollider(this, d.setFriction(0.5)); }
  }
}
const CRACK_MAT = new THREE.LineBasicMaterial({ color: 0xdff2ff, transparent: true, opacity: 0.55, depthWrite: false });
function polyDist(p, x, y) { let d = 1e9; for (let k = 0; k < p.length; k++) { const a = p[k], b = p[(k + 1) % p.length]; const dx = b[0] - a[0], dy = b[1] - a[1]; const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy + 1e-12))); d = Math.min(d, Math.hypot(a[0] + dx * t - x, a[1] + dy * t - y)); } return d; }

/** A wall of tiles: one InstancedMesh; a hit tile turns into an anchored ceramic Pane and shatters locally. */
export class TileWall {
  constructor(W, { origin, quat, cols, rows, size, gap = 0.003, t = 0.007, mat }) {
    this.W = W; this.size = size; this.t = t; this.mat = mat; this.quat = quat.clone(); this.origin = origin.clone();
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(size - gap, size - gap, t), mat, cols * rows); this.mesh.receiveShadow = true;
    this.tiles = []; const right = new THREE.Vector3(1, 0, 0).applyQuaternion(quat), up = new THREE.Vector3(0, 1, 0);
    let k = 0; for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const p = origin.clone().addScaledVector(right, (c + 0.5) * size).addScaledVector(up, (r + 0.5) * size);
      _m.compose(p, quat, new THREE.Vector3(1, 1, 1)); this.mesh.setMatrixAt(k, _m);
      const tile = { k, p, obj: { position: p }, alive: true, wall: this, name: 'Ceramic tile', breakable: true };
      tile.hit = (pt, d, pw, cause) => this.crack(tile, pt, d, pw, cause); tile.onForce = (f, pt) => { if (f > 40) this.crack(tile, pt, new THREE.Vector3(), f * 0.01); }; tile.heat = () => { };
      const { collider } = W.physics.staticBox(p.x, p.y, p.z, size / 2, size / 2, t / 2, Math.atan2(right.x, right.z) - Math.PI / 2, tile);
      collider.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS); collider.setContactForceEventThreshold(40);
      tile.collider = collider; this.tiles.push(tile); k++;
    }
    W.scene.add(this.mesh);
  }
  crack(tile, pt, d, pw, cause) {
    if (!tile.alive) return; tile.alive = false;
    _m.makeScale(0, 0, 0); this.mesh.setMatrixAt(tile.k, _m); this.mesh.instanceMatrix.needsUpdate = true;
    this.W.physics.byCollider.delete(tile.collider.handle); this.W.physics.world.removeCollider(tile.collider, true);
    const pane = new Pane(this.W, { pos: tile.p, quat: this.quat, w: this.size - 0.003, h: this.size - 0.003, t: this.t, mat: this.mat, ceramic: true, name: 'Ceramic tile', forceThreshold: 40 });
    pane.breakAt(pt, d, cause === 'explosion' ? 0.08 : 0.03 + pw * 0.006, pw);
  }
}

// ===================================================================== multi-part objects (stools, racks)
export class Parts extends Entity {
  /** parts: [{mesh, half:Vector3}] — meshes are children of obj, positioned in obj-local space. */
  constructor(W, obj, parts, o = {}) {
    super(W, obj, o); this.parts = parts; this.breakable = true; this.forceThreshold = o.forceThreshold ?? 60; this.wood = !!o.wood; this.lastBreak = 0;
    for (const p of parts) if (p.mesh.parent !== obj) obj.add(p.mesh);
    this.adj = parts.map(() => new Set());
    for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) if (boxesTouch(parts[i], parts[j])) { this.adj[i].add(j); this.adj[j].add(i); }
    W.physics.attach(this, parts.map(p => partDesc(p, o.density ?? 650)), { type: 'dynamic', sleeping: !o.linvel, linvel: o.linvel, angvel: o.angvel, threshold: this.forceThreshold, pos: o.pos2, quat: o.quat2 });
    this.unproxy = proxify(obj); // merged while intact; the real parts come back on the first break
  }
  onForce(force, point) { if (force > this.forceThreshold && this.W.time - this.lastBreak > 0.1) this.breakAt(point, new THREE.Vector3(), 0.04, force * 0.004); }
  hit(point, dir, power, cause) { this.impulse(dir, power * 0.5, point); this.breakAt(point, dir, cause === 'explosion' ? 0.3 : 0.05, power); }
  breakAt(point, dir, radius, power) {
    if (!this.alive || power < 0.35) return; this.lastBreak = this.W.time;
    if (this.unproxy) { this.unproxy(); this.unproxy = null; }
    const local = this.obj.worldToLocal(point.clone()); let best = -1, bd = 1e9; const hitIds = [];
    this.parts.forEach((p, i) => { const d = boxDist(p, local); if (d < bd) { bd = d; best = i; } if (d < radius) hitIds.push(i); });
    if (!hitIds.length && best >= 0) hitIds.push(best);
    if (this.wood) this.W.fx.dust(point, 10, [0.55, 0.42, 0.28], 0.025, 0.8);
    this.W.audio?.wood(point, power);
    const base = bodyVelAt(this.body, point), d = dir.lengthSq() ? dir.clone().normalize() : new THREE.Vector3(0, 1, 0);
    const keepIds = new Set(this.parts.map((_, i) => i));
    // a strong blow splits the part it lands on (planks snap where they're hit); otherwise it knocks it loose
    for (const i of hitIds) {
      keepIds.delete(i); const p = this.parts[i];
      if (power > 1.2 && maxHalf(p) > 0.05) this.splitPart(p, local, base, d, power); else this.spawnPieces([p], base, d, power);
    }
    const comps = components(keepIds, this.adj).sort((a, b) => b.length - a.length);
    if (!comps.length) { this.remove(); return; }
    for (const c of comps.slice(1)) { for (const i of c) keepIds.delete(i); this.spawnPieces(c.map(i => this.parts[i]), base, d, 0.3); }
    // rebuild self from the largest component
    const keep = comps[0].map(i => this.parts[i]);
    const old = [...this.colliders]; for (const c of old) this.W.physics.removeCollider(this, c);
    for (const p of this.parts) if (!keep.includes(p)) p.mesh.removeFromParent();
    this.parts = keep; this.adj = keep.map(() => new Set());
    for (let i = 0; i < keep.length; i++) for (let j = i + 1; j < keep.length; j++) if (boxesTouch(keep[i], keep[j])) { this.adj[i].add(j); this.adj[j].add(i); }
    for (const p of keep) this.W.physics.addCollider(this, partDesc(p, 650));
    this.body.wakeUp();
  }
  spawnPieces(list, base, dir, power) {
    if (!list.length) return;
    this.obj.updateMatrixWorld(true);
    const obj = new THREE.Group(); this.obj.matrixWorld.decompose(obj.position, obj.quaternion, obj.scale);
    for (const p of list) obj.add(p.mesh);
    new Parts(this.W, obj, list, { name: this.name + ' (piece)', wood: this.wood, linvel: scatterVel(base, dir, 0.5 + power * 0.8), angvel: { x: rand(-4, 4), y: rand(-4, 4), z: rand(-4, 4) }, pos2: obj.position, quat2: obj.quaternion, forceThreshold: this.forceThreshold });
  }
  splitPart(p, local, base, dir, power) {
    // split the box across its longest axis at the impact point (clamped), jagged ends via two thin wedges
    const h = p.half, ax = h.x >= h.y && h.x >= h.z ? 'x' : h.y >= h.z ? 'y' : 'z';
    const lp = p.mesh.worldToLocal(this.obj.localToWorld(local.clone()));
    const cut = THREE.MathUtils.clamp(lp[ax], -h[ax] * 0.7, h[ax] * 0.7);
    const mk = (a, b) => { const len = (b - a) / 2, mid = (a + b) / 2; const half = h.clone(); half[ax] = len; const g = new THREE.BoxGeometry(half.x * 2, half.y * 2, half.z * 2); const m = new THREE.Mesh(g, p.mesh.material); m.castShadow = true; m.position.copy(p.mesh.position); m.quaternion.copy(p.mesh.quaternion); const off = new THREE.Vector3(); off[ax] = mid; off.applyQuaternion(p.mesh.quaternion); m.position.add(off); return { mesh: m, half }; };
    const a = mk(-h[ax], cut), b = mk(cut, h[ax]);
    p.mesh.removeFromParent();
    this.obj.add(a.mesh, b.mesh);
    this.spawnPieces([a], base, dir, power); this.spawnPieces([b], base, dir.clone().negate(), power * 0.6);
    this.W.fx.dust(this.obj.localToWorld(local.clone()), 14, [0.6, 0.46, 0.3], 0.02, 1.2);
  }
}
function partDesc(p, density) {
  const d = RAPIER.ColliderDesc.cuboid(Math.max(0.002, p.half.x), Math.max(0.002, p.half.y), Math.max(0.002, p.half.z)).setDensity(density).setFriction(0.7);
  d.setTranslation(p.mesh.position.x, p.mesh.position.y, p.mesh.position.z); const q = p.mesh.quaternion; d.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }); return d;
}
const maxHalf = p => Math.max(p.half.x, p.half.y, p.half.z);
function boxDist(p, local) { const l = p.mesh.worldToLocal ? local.clone().sub(p.mesh.position).applyQuaternion(p.mesh.quaternion.clone().invert()) : local; const dx = Math.max(0, Math.abs(l.x) - p.half.x), dy = Math.max(0, Math.abs(l.y) - p.half.y), dz = Math.max(0, Math.abs(l.z) - p.half.z); return Math.hypot(dx, dy, dz); }
function boxesTouch(a, b) {
  const ca = a.mesh.position, cb = b.mesh.position;
  const ra = new THREE.Vector3(a.half.x, a.half.y, a.half.z).applyQuaternion(a.mesh.quaternion), rb = new THREE.Vector3(b.half.x, b.half.y, b.half.z).applyQuaternion(b.mesh.quaternion);
  const ea = new THREE.Vector3(Math.abs(ra.x), Math.abs(ra.y), Math.abs(ra.z)), eb = new THREE.Vector3(Math.abs(rb.x), Math.abs(rb.y), Math.abs(rb.z));
  return Math.abs(ca.x - cb.x) <= ea.x + eb.x + 0.004 && Math.abs(ca.y - cb.y) <= ea.y + eb.y + 0.004 && Math.abs(ca.z - cb.z) <= ea.z + eb.z + 0.004;
}

// ===================================================================== hydrogen balloon
export class Balloon extends Entity {
  constructor(W, mesh, o = {}) {
    const obj = new THREE.Group(); obj.add(mesh); obj.position.copy(o.pos); super(W, obj, { name: 'Hydrogen balloon', substance: 'H2' });
    this.breakable = true; this.forceThreshold = o.thrown ? 0.6 : 6; this.fuse = o.fuse ?? null; this.anchor = o.anchor || null;
    const d = RAPIER.ColliderDesc.ball(0.1).setTranslation(0, 0.14, 0).setDensity(o.thrown ? 30 : 4).setRestitution(0.4);
    W.physics.attach(this, [d], { type: 'dynamic', linvel: o.linvel, linDamp: o.thrown ? 0.1 : 1.6, angDamp: 1.5, threshold: this.forceThreshold });
    if (!o.thrown) this.body.setGravityScale(-0.25, true);
    this.quiet = !o.thrown; obj.traverse(c => { c.castShadow = false; }); // tethered balloons sway forever: don't let them force shadow redraws
    if (this.anchor) { // tied to a stand with a string: rope joint
      const jd = RAPIER.JointData.rope(o.ropeLen ?? 0.35, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
      this.joint = W.physics.world.createImpulseJoint(jd, this.body, this.anchor.body, true);
      const lg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]); this.string = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xdddddd })); W.scene.add(this.string);
      this.anchorPt = o.anchorPt;
    }
  }
  onForce(f) { if (f > this.forceThreshold) this.explode(); }
  hit() { this.explode(); }
  heat(a) { this.heatLevel += a; if (this.heatLevel > 0.15) this.explode(); }
  explode() { if (!this.alive) return; const p = this.obj.localToWorld(new THREE.Vector3(0, 0.14, 0)); this.remove(); this.W.explode(p, 1, 'hydrogen'); this.W.chem.react('h2o2', p); }
  update(dt) {
    super.update(dt);
    if (this.fuse != null) { this.fuse -= dt; if (this.fuse <= 0) this.explode(); }
    if (this.string && this.anchor && this.anchor.alive) { const a = this.anchor.obj.localToWorld(this.anchorPt.clone()); const pos = this.string.geometry.attributes.position; pos.setXYZ(0, this.obj.position.x, this.obj.position.y, this.obj.position.z); pos.setXYZ(1, a.x, a.y, a.z); pos.needsUpdate = true; }
  }
  remove() { if (this.joint) { try { this.W.physics.world.removeImpulseJoint(this.joint, true); } catch { } } if (this.string) this.string.removeFromParent(); super.remove(); }
}
