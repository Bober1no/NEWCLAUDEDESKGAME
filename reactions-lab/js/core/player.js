// First-person player: Rapier kinematic character controller (walk, sprint, crouch, jump, auto-step,
// pushes dynamic props), mouse look, explosion knockback, head-bob.
import * as THREE from 'three';
import { RAPIER } from './physics.js';

export class Player {
  constructor(G, spawn) {
    this.G = G; const w = G.physics.world;
    this.radius = 0.28; this.half = 0.62; this.eye = 1.62;
    this.body = w.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y + this.half + this.radius, spawn.z));
    this.collider = w.createCollider(RAPIER.ColliderDesc.capsule(this.half, this.radius).setFriction(0), this.body);
    this.ctrl = w.createCharacterController(0.02);
    this.ctrl.setUp({ x: 0, y: 1, z: 0 }); this.ctrl.enableAutostep(0.32, 0.15, false); this.ctrl.enableSnapToGround(0.25);
    this.ctrl.setMaxSlopeClimbAngle(50 * Math.PI / 180); this.ctrl.setApplyImpulsesToDynamicBodies(true); this.ctrl.setCharacterMass(70);
    this.yaw = 0; this.pitch = -0.08; this.vy = 0; this.grounded = false; this.crouch = 0; this.velocity = new THREE.Vector3(); this.knock = new THREE.Vector3(); this.bob = 0; this.moving = false;
    this.position = new THREE.Vector3();
  }
  look(dx, dy, sens) { this.yaw -= dx * sens; this.pitch = THREE.MathUtils.clamp(this.pitch - dy * sens, -1.5, 1.5); }
  push(v) { this.knock.add(v); this.vy = Math.max(this.vy, v.y + 2); }
  update(dt, keys) {
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)), right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const wish = new THREE.Vector3();
    if (keys.KeyW) wish.add(fwd); if (keys.KeyS) wish.sub(fwd); if (keys.KeyD) wish.add(right); if (keys.KeyA) wish.sub(right);
    const crouching = keys.ControlLeft || keys.KeyC; this.crouch += ((crouching ? 1 : 0) - this.crouch) * Math.min(1, dt * 10);
    const speed = (keys.ShiftLeft && !crouching ? 5.2 : 2.9) * (1 - this.crouch * 0.5);
    if (wish.lengthSq()) wish.normalize().multiplyScalar(speed);
    this.moving = wish.lengthSq() > 0 && this.grounded;
    // horizontal velocity with a little acceleration, plus decaying knockback
    const a = this.grounded ? 14 : 3; this.velocity.x += (wish.x - this.velocity.x) * Math.min(1, dt * a); this.velocity.z += (wish.z - this.velocity.z) * Math.min(1, dt * a);
    if (this.grounded) { this.vy = Math.max(this.vy, -1); if (keys.Space) { this.vy = 4.6; this.grounded = false; } } else this.vy -= 9.81 * dt;
    this.knock.multiplyScalar(Math.max(0, 1 - dt * 3));
    const move = { x: (this.velocity.x + this.knock.x) * dt, y: (this.vy + this.knock.y) * dt, z: (this.velocity.z + this.knock.z) * dt };
    this.ctrl.computeColliderMovement(this.collider, move);
    const m = this.ctrl.computedMovement(), t = this.body.translation();
    this.body.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z });
    this.grounded = this.ctrl.computedGrounded(); if (this.grounded && this.vy < 0) this.vy = 0;
    if (m.y < move.y - 1e-4 && this.vy > 0) this.vy = 0; // bonked a ceiling
    if (t.y < -3) this.body.setNextKinematicTranslation({ x: 0, y: 1.2, z: 3.5 });
    this.position.set(t.x + m.x, t.y + m.y - this.half - this.radius, t.z + m.z);
    // camera
    this.bob += dt * (this.moving ? speed * 2.2 : 0);
    const cam = this.G.camera, eye = this.eye - this.crouch * 0.55 + (this.moving ? Math.sin(this.bob) * 0.025 : 0);
    cam.position.set(this.position.x, this.position.y + eye, this.position.z);
    cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}
