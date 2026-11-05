// Tools: hammer, grabber (physics gun), ball-bearing launcher, hydrogen balloon grenades, Bunsen torch,
// chemical scanner. Each has a first-person viewmodel. Plus explosions.
import * as THREE from 'three';
import { RAPIER } from '../core/physics.js';
import { M } from '../world/materials.js';
import * as P from '../world/props.js';
import { Entity, Balloon } from '../world/entities.js';
import { Flame } from '../fx/flame.js';
import { SUBS } from '../world/chem.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _d = new THREE.Vector3(), _o = new THREE.Vector3();

function viewmodelRoot() { const g = new THREE.Group(); g.traverse(o => { o.castShadow = false; }); return g; }
const noShadow = g => { g.traverse(o => { if (o.isMesh) { o.castShadow = false; o.frustumCulled = false; } }); return g; };

export const TOOL_DEFS = [
  { id: 'hammer', name: 'Hammer', key: '1', hint: 'Click: smash. Breaks things where you hit them.' },
  { id: 'grab', name: 'Grabber', key: '2', hint: 'Hold click: pick up. Right-click: launch. Wheel: distance.' },
  { id: 'launcher', name: 'Bearing launcher', key: '3', hint: 'Click / hold: fire steel ball bearings.' },
  { id: 'grenade', name: 'H₂ balloon', key: '4', hint: 'Click: throw a hydrogen balloon. It explodes on impact.' },
  { id: 'torch', name: 'Bunsen torch', key: '5', hint: 'Hold click: flame. Heats glass, burns Mg, pops balloons.' },
  { id: 'scan', name: 'Scanner', key: '6', hint: 'Look at anything: substance, formula, hazard.' }
];

export class Tools {
  constructor(G) {
    this.G = G; this.cur = 0; this.t = 0; this.cool = 0; this.swing = 1; this.held = null; this.holdDist = 1.4; this.fireDown = false; this.altDown = false;
    this.root = new THREE.Group(); G.camera.add(this.root);
    this.vm = TOOL_DEFS.map(d => { const g = this.build(d.id); g.visible = false; this.root.add(g); return g; });
    this.vm[0].visible = true;
    // grabber beam
    this.beam = new THREE.Line(new THREE.BufferGeometry().setFromPoints([V(0, 0, 0), V(0, 0, -1)]), new THREE.LineBasicMaterial({ color: new THREE.Color(0.6, 3, 3.4), transparent: true, opacity: 0.8 })); this.beam.frustumCulled = false; this.beam.visible = false; G.scene.add(this.beam);
    this.bearings = [];
  }
  build(id) {
    const g = new THREE.Group();
    if (id === 'hammer') {
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.019, 0.36, 12), M.wood); handle.position.y = -0.1; g.add(handle);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.045, 0.045), M.steel); head.position.y = 0.08; g.add(head);
      const claw = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.026, 0.03, 12), M.chrome); claw.rotation.z = Math.PI / 2; claw.position.set(0.075, 0.08, 0); g.add(claw);
      g.position.set(0.28, -0.25, -0.45); g.rotation.set(0.15, 0, -0.35);
    } else if (id === 'grab') {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.08, 0.3), M.blackPlastic); g.add(body);
      for (let i = 0; i < 3; i++) { const ring = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.006, 8, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 2.6, 3) })); ring.position.z = -0.12 - i * 0.035; g.add(ring); }
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.11, 0.05), M.rubber); grip.position.set(0, -0.08, 0.08); grip.rotation.x = 0.3; g.add(grip);
      g.position.set(0.22, -0.2, -0.42);
    } else if (id === 'launcher') {
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.022, 0.42, 16), M.steel); barrel.rotation.x = Math.PI / 2; barrel.position.z = -0.12; g.add(barrel);
      const hop = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.03, 0.09, 16), M.glassThick); hop.position.set(0, 0.06, 0.02); g.add(hop);
      for (let i = 0; i < 6; i++) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.009, 10, 8), M.chrome); b.position.set((i % 3 - 1) * 0.018, 0.045 + Math.floor(i / 3) * 0.016, 0.02); g.add(b); }
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 0.18), M.blackPlastic); stock.position.z = 0.12; g.add(stock);
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.1, 0.045), M.rubber); grip.position.set(0, -0.07, 0.08); grip.rotation.x = 0.25; g.add(grip);
      g.position.set(0.2, -0.2, -0.38);
    } else if (id === 'grenade') {
      const b = P.balloon(0x3a7be0); b.scale.setScalar(0.55); g.add(b); g.position.set(0.22, -0.32, -0.42);
    } else if (id === 'torch') {
      const m = P.model('bunsen'); g.add(m); m.rotation.x = -Math.PI / 2 + 0.25; m.position.set(0, -0.05, 0.05);
      const f = new Flame(); f.group.rotation.x = -Math.PI / 2 + 0.25; f.group.position.set(0, P.bunsenTop().y * 0.97 - 0.05, -P.bunsenTop().y + 0.05); f.group.position.set(0, -0.012, -0.11); f.group.scale.set(2.2, 4.5, 2.2); g.add(f.group); g.userData.flame = f;
      g.position.set(0.2, -0.18, -0.36);
    } else if (id === 'scan') {
      const tab = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.11, 0.012), M.blackPlastic); g.add(tab);
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.145, 0.095), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.15, 0.9, 1.1) })); scr.position.z = 0.007; g.add(scr);
      g.position.set(0.18, -0.2, -0.38); g.rotation.set(-0.3, -0.2, 0);
    }
    g.userData.home = g.position.clone(); g.userData.homeRot = g.rotation.clone();
    return noShadow(g);
  }
  select(i) { if (i === this.cur || i < 0 || i >= TOOL_DEFS.length) return; this.release(); this.vm[this.cur].visible = false; this.cur = i; this.vm[i].visible = true; this.swing = 1; this.G.hud.tool(i); }
  aim() { const c = this.G.camera; c.getWorldPosition(_o); c.getWorldDirection(_d); return { o: _o.clone(), d: _d.clone() }; }
  ray(dist) { const { o, d } = this.aim(); return { hit: this.G.physics.raycast(o, d, dist, this.G.player.collider, this.G.player.body), o, d }; }
  down(btn) { if (btn === 0) { this.fireDown = true; this.press(); } if (btn === 2) { this.altDown = true; if (TOOL_DEFS[this.cur].id === 'grab') this.launch(); } }
  up(btn) { if (btn === 0) { this.fireDown = false; if (TOOL_DEFS[this.cur].id === 'grab') this.release(); } if (btn === 2) this.altDown = false; }
  wheel(dy) { this.holdDist = THREE.MathUtils.clamp(this.holdDist - dy * 0.001, 0.6, 4); }
  press() {
    const id = TOOL_DEFS[this.cur].id, G = this.G;
    if (id === 'hammer' && this.cool <= 0) { this.swing = 0; this.cool = 0.42; this.hitDone = false; }
    if (id === 'grab') this.grab();
    if (id === 'grenade' && this.cool <= 0) { this.cool = 0.6; const { o, d } = this.aim(); const p = o.clone().addScaledVector(d, 0.5).add(V(0, -0.1, 0)); const v = d.clone().multiplyScalar(9).add(V(0, 2.5, 0)); const pv = G.player.velocity; new Balloon(G, P.balloon([0xd9363e, 0x3a7be0, 0xf2c230, 0x33d17a][Math.floor(Math.random() * 4)]), { pos: p, thrown: true, linvel: { x: v.x + pv.x, y: v.y, z: v.z + pv.z }, fuse: 4 }); this.swing = 0; }
    if (id === 'scan') this.scan();
  }
  hammerHit() {
    const G = this.G, { hit, d } = this.ray(2.1); if (!hit) { G.audio?.whoosh(); return; }
    G.shake(0.12);
    if (hit.entity) { hit.entity.hit(hit.point, d, 2.2, 'hammer'); G.audio?.thud(hit.point); }
    else { G.fx.sparks(hit.point, 6, 1.2, [2, 1.8, 1.4], 0.25, 0.005); G.fx.dust(hit.point, 6, [0.7, 0.7, 0.68], 0.025); G.decal(hit.point, hit.normal, 0.05, 'dent'); G.audio?.thud(hit.point); }
  }
  grab() {
    const { hit } = this.ray(6);
    if (hit && hit.entity && hit.entity.body && hit.entity.body.isDynamic() && hit.entity.body.mass() < 40) { this.held = hit.entity; this.holdDist = Math.max(0.6, hit.dist); this.held.body.wakeUp(); this.G.hud.flash('Holding: ' + (this.held.name || 'object')); }
  }
  release() { this.held = null; this.beam.visible = false; }
  launch() {
    if (!this.held || !this.held.body) return; const { d } = this.aim(); const b = this.held.body;
    b.setLinvel({ x: d.x * 22, y: d.y * 22, z: d.z * 22 }, true); b.setAngvel({ x: (Math.random() - 0.5) * 8, y: (Math.random() - 0.5) * 8, z: (Math.random() - 0.5) * 8 }, true);
    this.G.fx.sparks(this.held.obj.position, 14, 2, [0.5, 2.6, 3.2], 0.3, 0.006); this.G.shake(0.06); this.release(); this.swing = 0;
  }
  fireBearing() {
    const G = this.G, { o, d } = this.aim(); const start = o.clone().addScaledVector(d, 0.45);
    const mesh = new THREE.Mesh(BEARING_GEO, M.chrome); mesh.position.copy(start); mesh.castShadow = true;
    const e = new Entity(G, mesh, { name: 'Ball bearing', substance: 'steel' }); e.metal = true; e.bearing = true; e.life = 6;
    G.physics.attach(e, [RAPIER.ColliderDesc.ball(0.011).setDensity(7800).setRestitution(0.3).setFriction(0.4)], { type: 'dynamic', ccd: true, linvel: { x: d.x * 55, y: d.y * 55, z: d.z * 55 }, events: true, threshold: 2 });
    e.onForce = (f, p, other) => { if (other && other.breakable && !e.spent) { e.spent = true; other.hit(p, d, 1.2, 'bearing'); } else if (other && other.metal && f > 20) G.fx.sparks(p, 5, 1.5, [3, 2.4, 1.6], 0.2, 0.004); };
    // CCD contacts don't raise force events, so sweep ahead each frame: glass in the path breaks and the bearing punches through
    e.update = (dt) => {
      e.life -= dt; if (e.life <= 0) { e.remove(); return; }
      if (e.spent) return; const v = e.body.linvel(), sp = Math.hypot(v.x, v.y, v.z); if (sp < 6) { e.spent = true; return; }
      const t = e.body.translation(); _o.set(t.x, t.y, t.z); _d.set(v.x / sp, v.y / sp, v.z / sp);
      const h = G.physics.raycast(_o, _d, sp * dt * 1.6 + 0.02, e.colliders[0], e.body); if (!h || h.entity === e) return; if (!h.entity) { G.decal(h.point, h.normal, 0.012, 'dent'); e.spent = true; return; }
      const other = h.entity;
      if (other.breakable && other.hit) { other.hit(h.point, _d.clone(), Math.min(2, sp / 40), 'bearing'); e.body.setLinvel({ x: v.x * 0.55, y: v.y * 0.55, z: v.z * 0.55 }, true); if (sp < 25) e.spent = true; }
      else if (other.metal) { G.fx.sparks(h.point, 5, 1.5, [3, 2.4, 1.6], 0.2, 0.004); e.spent = true; }
      else if (other.body && other.body.isDynamic()) e.spent = true;
    };
    this.bearings.push(e); if (this.bearings.length > 40) { const old = this.bearings.shift(); if (old.alive) old.remove(); }
    G.fx.sparks(start, 6, 1.5, [3, 2.2, 1.2], 0.12, 0.005); G.shake(0.03); G.audio?.pew();
    this.recoil = 1;
  }
  scan() {
    const { hit } = this.ray(8);
    const e = hit && hit.entity; let id = e && e.substance;
    if (!id && e) id = /window|sash|glass|beaker|flask|tube|cylinder/i.test(e.name) ? 'glass' : null;
    if (!id && e && e.name === 'Ceramic tile') id = 'ceramic';
    this.G.hud.scan(e ? (e.name || 'Object') : (hit ? 'Lab structure' : 'Nothing'), id ? SUBS[id] : null);
  }
  update(dt) {
    const G = this.G, id = TOOL_DEFS[this.cur].id, vm = this.vm[this.cur];
    this.t += dt; this.cool -= dt; this.swing = Math.min(1, this.swing + dt / 0.4); this.recoil = Math.max(0, (this.recoil || 0) - dt * 8);
    // idle bob + swing animation
    const bob = G.player.moving ? Math.sin(this.t * 9) * 0.008 : Math.sin(this.t * 1.6) * 0.003;
    vm.position.copy(vm.userData.home).add(V(0, bob, this.recoil * 0.05)); vm.rotation.copy(vm.userData.homeRot);
    if (id === 'hammer') {
      const s = this.swing, k = s < 0.35 ? -Math.sin(s / 0.35 * Math.PI * 0.5) * 0.9 : s < 0.55 ? -0.9 + (s - 0.35) / 0.2 * 2.2 : 1.3 * (1 - (s - 0.55) / 0.45);
      vm.rotation.x += k; vm.position.z -= Math.max(0, k) * 0.06;
      if (s > 0.42 && !this.hitDone) { this.hitDone = true; this.hammerHit(); }
    }
    if (id === 'grenade') vm.position.y -= (1 - this.swing) * 0.3;
    if (id === 'launcher' && this.fireDown && this.cool <= 0) { this.cool = 0.11; this.fireBearing(); }
    if (id === 'torch') {
      const f = vm.userData.flame; f.set(1, this.fireDown ? 1 : 0.15, G.time);
      if (this.fireDown) {
        const { o, d } = this.aim();
        for (let k = 1; k <= 4; k++) { const p = o.clone().addScaledVector(d, 0.35 + k * 0.12); G.chem.fire(p, 0.07 + k * 0.02, dt * 1.6, null); }
        const { hit } = this.ray(0.95); if (hit && !hit.entity && Math.random() < dt * 6) G.decal(hit.point, hit.normal, 0.06, 'scorch');
        if (Math.random() < dt * 20) G.fx.embers(o.clone().addScaledVector(d, 0.6), 1);
      }
    }
    if (id === 'grab' && this.held) {
      if (!this.held.alive || !this.held.body) { this.release(); return; }
      const { o, d } = this.aim(); const target = o.clone().addScaledVector(d, this.holdDist), b = this.held.body, p = b.translation();
      const k = 14, vx = (target.x - p.x) * k, vy = (target.y - p.y) * k, vz = (target.z - p.z) * k; b.setLinvel({ x: vx, y: vy, z: vz }, true);
      const w = b.angvel(); b.setAngvel({ x: w.x * 0.9, y: w.y * 0.9, z: w.z * 0.9 }, true);
      const pos = this.beam.geometry.attributes.position; vm.updateMatrixWorld(); const tip = vm.localToWorld(V(0, 0, -0.2)); pos.setXYZ(0, tip.x, tip.y, tip.z); pos.setXYZ(1, p.x, p.y, p.z); pos.needsUpdate = true; this.beam.visible = true;
      if (Math.random() < dt * 30) G.fx.glow.emit(p.x + (Math.random() - 0.5) * 0.05, p.y + (Math.random() - 0.5) * 0.05, p.z + (Math.random() - 0.5) * 0.05, 0, 0.05, 0, 0.4, 0.008, 0.002, 0.5, 2.6, 3.2, 1);
    }
    if (id === 'scan' && Math.floor(this.t * 6) !== Math.floor((this.t - dt) * 6)) this.scan();
    if (id !== 'scan') G.hud.scan(null);
  }
}
const BEARING_GEO = new THREE.SphereGeometry(0.011, 14, 10);

/** Explosion: fireball, light, shock, radial impulse, local breaks on everything nearby, chain reactions. */
export function explode(G, p, power = 1, kind = 'hydrogen') {
  G.fx.fireball(p, 0.35 * power + 0.1); G.fx.sparks(p, 50, 4 * power, [4, 2.6, 1.2], 0.6, 0.012); G.fx.plume(p, [0.85, 0.88, 0.9], 14, 0.25, 0.5, 0.18);
  G.flashExposure = Math.max(G.flashExposure || 0, 0.8 * power); G.shock(p, power); G.audio?.boom(p, power);
  const R = 2.2 * power, dist = G.camera.position.distanceTo(p); G.shake(Math.max(0, 0.5 * power * (1 - dist / 8)));
  const ents = G.physics.overlapSphere(p, R);
  for (const e of ents) {
    if (!e.alive && !e.debris) continue;
    const ep = e.obj?.position || e.p; if (!ep) continue; const dir = ep.clone().sub(p); const d = Math.max(0.15, dir.length()); dir.normalize(); const fall = 1 / (d * d);
    if (e.body && e.body.isDynamic()) { const m = e.body.mass(); const imp = Math.min(m * 12, 0.9 * power * fall); e.body.applyImpulse({ x: dir.x * imp, y: dir.y * imp + imp * 0.3, z: dir.z * imp }, true); }
    if (e.breakable && d < R * 0.65 && e.hit) { const hp = ep.clone().addScaledVector(dir, -0.02); e.hit(hp, dir, power * 3 * Math.min(1, 1 / d), 'explosion'); }
    if (e.heat) e.heat(0.6 * power * fall, ep);
  }
  // knock the player
  const pd = G.player.position.clone().sub(p); const pl = pd.length(); if (pl < R) G.player.push(pd.normalize().multiplyScalar(6 * power * (1 - pl / R)));
}
