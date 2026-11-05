// Rapier physics wrapper: fixed 60 Hz step, collider → entity registry, contact-force events for breaking,
// raycasts / overlap queries, and mesh sync (sleeping bodies are skipped).
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

export { RAPIER };
const STEP = 1 / 60;
const _v = new THREE.Vector3(), _q = new THREE.Quaternion();

export class Physics {
  static async create() { await RAPIER.init(); return new Physics(); }
  constructor() {
    this.R = RAPIER;
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = STEP;
    this.eq = new RAPIER.EventQueue(true);
    this.byCollider = new Map();     // collider handle → entity
    this.moving = new Set();         // entities with dynamic/kinematic bodies
    this.acc = 0; this.steps = 0;
  }
  /** Static box collider (environment). */
  staticBox(cx, cy, cz, hx, hy, hz, rotY = 0, entity = null, friction = 0.8) {
    const bd = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(cx, cy, cz).setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY)));
    const c = this.world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setFriction(friction), bd);
    if (entity) this.byCollider.set(c.handle, entity);
    return { body: bd, collider: c };
  }
  /** Create a body for an entity from collider descs. opts: {type, pos, quat, linvel, angvel, ccd, linDamp, angDamp, threshold} */
  attach(entity, descs, opts = {}) {
    const type = opts.type || 'dynamic';
    const bdesc = type === 'fixed' ? RAPIER.RigidBodyDesc.fixed() : type === 'kinematic' ? RAPIER.RigidBodyDesc.kinematicPositionBased() : RAPIER.RigidBodyDesc.dynamic();
    const p = opts.pos || entity.obj.position, q = opts.quat || entity.obj.quaternion;
    bdesc.setTranslation(p.x, p.y, p.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
    if (opts.linvel) bdesc.setLinvel(opts.linvel.x, opts.linvel.y, opts.linvel.z);
    if (opts.angvel) bdesc.setAngvel(opts.angvel);
    if (opts.ccd) bdesc.setCcdEnabled(true);
    bdesc.setLinearDamping(opts.linDamp ?? 0.05).setAngularDamping(opts.angDamp ?? 0.15);
    if (opts.sleeping) bdesc.setSleeping(true);
    const body = this.world.createRigidBody(bdesc);
    const colliders = [];
    for (const d of descs) {
      if (!d) continue;
      if (entity.breakable || opts.events) { d.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS); d.setContactForceEventThreshold(opts.threshold ?? entity.forceThreshold ?? 15); }
      const c = this.world.createCollider(d, body); colliders.push(c); this.byCollider.set(c.handle, entity);
    }
    entity.body = body; entity.colliders = colliders;
    if (type !== 'fixed') this.moving.add(entity);
    return body;
  }
  detach(entity) {
    if (!entity.body) return;
    for (const c of entity.colliders || []) this.byCollider.delete(c.handle);
    this.world.removeRigidBody(entity.body); entity.body = null; entity.colliders = []; this.moving.delete(entity);
  }
  removeCollider(entity, c) { this.byCollider.delete(c.handle); this.world.removeCollider(c, true); entity.colliders = entity.colliders.filter(x => x !== c); }
  addCollider(entity, desc) {
    if (entity.breakable) { desc.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS); desc.setContactForceEventThreshold(entity.forceThreshold ?? 15); }
    const c = this.world.createCollider(desc, entity.body); entity.colliders.push(c); this.byCollider.set(c.handle, entity); return c;
  }
  /** Fixed-step simulation. onForce(entityA, entityB, force, point, colliderA, colliderB) for contacts over threshold. */
  step(dt, onForce) {
    this.acc = Math.min(this.acc + dt, STEP * 4);
    let n = 0;
    while (this.acc >= STEP && n < 4) {
      this.world.step(this.eq); this.acc -= STEP; n++; this.steps++;
      this.eq.drainContactForceEvents(ev => {
        const c1 = this.world.getCollider(ev.collider1()), c2 = this.world.getCollider(ev.collider2());
        if (!c1 || !c2) return;
        const a = this.byCollider.get(c1.handle), b = this.byCollider.get(c2.handle);
        const f = ev.totalForceMagnitude();
        const pt = this.contactPoint(c1, c2);
        if (pt && onForce) onForce(a, b, f, pt, c1, c2);
      });
    }
    return n;
  }
  contactPoint(c1, c2) {
    let pt = null;
    this.world.contactPair(c1, c2, (m) => { if (!pt && m.numSolverContacts() > 0) { const p = m.solverContactPoint(0); pt = new THREE.Vector3(p.x, p.y, p.z); } });
    return pt;
  }
  sync() {
    let awake = 0;
    for (const e of this.moving) {
      const b = e.body; if (!b || b.isSleeping()) continue; if (!e.quiet) awake++;
      const t = b.translation(), r = b.rotation();
      e.obj.position.set(t.x, t.y, t.z); e.obj.quaternion.set(r.x, r.y, r.z, r.w);
      if (e.afterSync) e.afterSync();
    }
    this.awake = awake; // the renderer only redraws the shadow map while something is moving
  }
  /** First hit along a ray. Returns {entity, collider, point, normal, dist} or null. */
  raycast(origin, dir, maxDist, excludeCollider, excludeBody) {
    const ray = new RAPIER.Ray({ x: origin.x, y: origin.y, z: origin.z }, { x: dir.x, y: dir.y, z: dir.z });
    const hit = this.world.castRayAndGetNormal(ray, maxDist, true, undefined, undefined, excludeCollider, excludeBody);
    if (!hit) return null;
    const d = hit.timeOfImpact ?? hit.toi;
    return { entity: this.byCollider.get(hit.collider.handle) || null, collider: hit.collider, point: new THREE.Vector3(origin.x + dir.x * d, origin.y + dir.y * d, origin.z + dir.z * d), normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z), dist: d };
  }
  /** All entities with a collider overlapping a sphere. */
  overlapSphere(c, r) {
    const out = new Set();
    this.world.intersectionsWithShape({ x: c.x, y: c.y, z: c.z }, { x: 0, y: 0, z: 0, w: 1 }, new RAPIER.Ball(r), (col) => { const e = this.byCollider.get(col.handle); if (e) out.add(e); return true; });
    return out;
  }
}

/** Convex hull collider from vertex positions (subsampled), with fallback to a ball. */
export function hullDesc(positions, maxPts = 64) {
  const n = positions.length / 3, step = Math.max(1, Math.floor(n / maxPts));
  const pts = []; for (let i = 0; i < n; i += step) pts.push(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
  const d = RAPIER.ColliderDesc.convexHull(new Float32Array(pts));
  if (d) return d;
  let r = 0.01; for (let i = 0; i < pts.length; i += 3) r = Math.max(r, Math.hypot(pts[i], pts[i + 1], pts[i + 2]));
  return RAPIER.ColliderDesc.ball(r);
}
export { _v, _q };
