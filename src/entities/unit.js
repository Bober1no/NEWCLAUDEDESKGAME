/**
 * Runtime unit: orders, movement, steering, combat and special abilities.
 */
import * as THREE from 'three';
import { Entity } from './entity.js';
import { buildUnitMesh } from './meshFactory.js';
import { ORDER, STATUS, WORLD, BALANCE, CELLFLAG } from '../core/constants.js';
import { clamp, clamp01, approachAngle, damp, frand, TAU } from '../core/utils.js';
import { threatScore } from '../systems/combat.js';
import { EV } from '../core/events.js';

const ARRIVE = 1.7;
const REPATH_INTERVAL = 0.9;

export class Unit extends Entity {
  constructor(game, def, owner, x, z) {
    super(game, def, owner, x, z);

    this.vel = new THREE.Vector3();
    this.path = null;
    this.pathIdx = 0;
    this.goal = null;             // final destination {x,z}
    this.order = { type: ORDER.IDLE };
    this.queue = [];
    this.forcedTarget = null;
    this.target = null;
    this.anchor = { x, z };       // leash point for idle aggression

    this.repathTimer = frand(0, REPATH_INTERVAL);
    this.acquireTimer = frand(0, 0.4);
    this.abilityTimer = 0;
    this.stuckTimer = 0;
    this.pathFails = 0;
    this.moveTime = 0;
    this.awaitingPath = false;
    this.lastProgress = 0;
    this._prevX = x; this._prevZ = z;
    this._sep = new THREE.Vector3();
    this._scratch = [];
    this._bob = frand(0, TAU);
    this._detected = false;

    this.mesh = buildUnitMesh(def.id, def, owner);
    this.mesh.position.set(x, 0, z);
    this.mesh.rotation.y = this.facing;
    this.mesh.userData.entity = this;
    game.entityRoot.add(this.mesh);

    if (def.air) {
      this.pos.y = WORLD.AIR_ALTITUDE;
      this.mesh.position.y = WORLD.AIR_ALTITUDE;
    }
    this.terrainH = def.air ? 0 : game.grid.heightAt(x, z);

    // tech-tree health bonus is baked in at spawn time
    const hpMod = game.players[owner].mods.hp[def.family] || 1;
    this.maxHp = def.hp * hpMod;
    this.hp = this.maxHp;
  }

  get isUnit() { return true; }
  get isAir() { return !!this.def.air; }
  get isCloaked() {
    return !!this.def.cloak && this.game.time - this.lastFire > 1.2;
  }
  get speedNow() {
    const mods = this.game.players[this.owner].mods;
    let s = this.def.speed * (mods.speed[this.def.family] || 1);
    if (this.hasStatus(STATUS.SLOW)) s *= 1 - clamp01(this.statusPower(STATUS.SLOW));
    if (this.hasStatus(STATUS.DISABLED)) s = 0;
    if (!this.isAir) {
      const c = this.game.grid.costAt(this.pos.x, this.pos.z);
      if (c > 1) s /= c * 0.72 + 0.28;
    }
    return s;
  }

  /* ═════════════════ orders ═════════════════ */

  issue(order, { queued = false } = {}) {
    if (this.def.immobile && order.type !== ORDER.ATTACK && order.type !== ORDER.HOLD) return;
    if (queued && this.order.type !== ORDER.IDLE) { this.queue.push(order); return; }
    this.queue.length = 0;
    this._startOrder(order);
  }

  _startOrder(order) {
    this.order = order;
    this.forcedTarget = null;
    this.pathFails = 0;
    this.stuckTimer = 0;

    switch (order.type) {
      case ORDER.MOVE:
      case ORDER.ATTACK_MOVE:
        this.setGoal(order.x, order.z);
        break;
      case ORDER.PATROL:
        this.patrolA = { x: this.pos.x, z: this.pos.z };
        this.patrolB = { x: order.x, z: order.z };
        this.patrolTo = 'b';
        this.setGoal(order.x, order.z);
        break;
      case ORDER.ATTACK:
        this.forcedTarget = order.target;
        this.target = order.target;
        this.clearPath();
        break;
      case ORDER.REPAIR:
      case ORDER.SABOTAGE:
        this.forcedTarget = order.target;
        this.clearPath();
        break;
      case ORDER.HOLD:
      case ORDER.IDLE:
        this.clearPath();
        this.anchor = { x: this.pos.x, z: this.pos.z };
        break;
      case ORDER.BUILD_BRIDGE:
        this.setGoal(order.x, order.z);
        break;
      default:
        break;
    }
  }

  nextOrder() {
    if (this.queue.length) this._startOrder(this.queue.shift());
    else this._startOrder({ type: ORDER.IDLE });
  }

  stop() {
    this.queue.length = 0;
    this.clearPath();
    this.target = null;
    this.forcedTarget = null;
    this.order = { type: ORDER.IDLE };
    this.anchor = { x: this.pos.x, z: this.pos.z };
  }

  setGoal(x, z) {
    if (this.def.immobile) return;
    const [cx, cz] = this.game.map.clampToDesk(x, z, 2);
    this.goal = { x: cx, z: cz };
    this.requestPath();
  }

  requestPath() {
    if (!this.goal) return;
    if (this.isAir) { this.path = [[this.goal.x, this.goal.z]]; this.pathIdx = 0; return; }
    this.awaitingPath = true;
    this.game.paths.request(this, this.goal.x, this.goal.z, this.owner === this.game.humanId ? 1 : 0);
  }

  onPathResult(path) {
    this.awaitingPath = false;
    if (!path || !path.length) {
      this.pathFails++;
      if (this.pathFails > 2) { this.goal = null; this.nextOrder(); }
      return;
    }
    this.pathFails = 0;
    this.path = path;
    this.pathIdx = 0;
  }

  clearPath() {
    this.path = null;
    this.pathIdx = 0;
    this.goal = null;
    this.awaitingPath = false;
    this.game.paths.cancel(this);
  }

  /* ═════════════════ per-frame ═════════════════ */

  update(dt) {
    this.tickStatuses(dt);
    if (!this.alive) return;

    this.cooldown -= dt;
    this.acquireTimer -= dt;
    this.abilityTimer -= dt;
    this.repathTimer -= dt;

    if (this.hasStatus(STATUS.DISABLED)) {
      this.vel.set(0, 0, 0);
      this._syncMesh(dt);
      return;
    }

    this.terrainH = this.isAir ? 0 : this.game.grid.heightAt(this.pos.x, this.pos.z);

    if (this.acquireTimer <= 0) {
      this.acquireTimer = 0.28 + frand(0, 0.14);
      this.acquire();
    }

    switch (this.order.type) {
      case ORDER.IDLE: this._idle(dt); break;
      case ORDER.MOVE: this._move(dt, false); break;
      case ORDER.ATTACK_MOVE: this._move(dt, true); break;
      case ORDER.PATROL: this._patrol(dt); break;
      case ORDER.ATTACK: this._attackOrder(dt); break;
      case ORDER.HOLD: this._hold(dt); break;
      case ORDER.REPAIR: this._repair(dt); break;
      case ORDER.SABOTAGE: this._sabotage(dt); break;
      case ORDER.BUILD_BRIDGE: this._bridge(dt); break;
      default: this._idle(dt); break;
    }

    this._special(dt);
    this._syncMesh(dt);
  }

  /* ── behaviours ──────────────────────────────────────────────────── */
  _idle(dt) {
    const t = this.target;
    if (t && t.alive) {
      if (this.game.combat.inRange(this, t)) {
        this.vel.multiplyScalar(Math.exp(-8 * dt));
        this.faceTowards(t.pos, dt);
        this.tryFire(t);
        return;
      }
      // leash: chase a little way from where we were told to stand
      const dFromAnchor = Math.hypot(this.pos.x - this.anchor.x, this.pos.z - this.anchor.z);
      if (!this.def.immobile && dFromAnchor < 16 && this.distanceTo(t) < this.game.combat.sightFor(this)) {
        this._chase(t, dt);
        return;
      }
      this.target = null;
    }
    // drift home if we wandered
    const dh = Math.hypot(this.pos.x - this.anchor.x, this.pos.z - this.anchor.z);
    if (dh > 5 && !this.def.immobile) {
      if (!this.goal) this.setGoal(this.anchor.x, this.anchor.z);
      this._followPath(dt);
    } else {
      this.vel.multiplyScalar(Math.exp(-6 * dt));
      this._integrate(dt);
    }
  }

  _move(dt, aggressive) {
    const t = this.target;
    if (aggressive && t && t.alive && this.distanceTo(t) < this.game.combat.sightFor(this)) {
      if (this.game.combat.inRange(this, t)) {
        this.vel.multiplyScalar(Math.exp(-8 * dt));
        this.faceTowards(t.pos, dt);
        this.tryFire(t);
        return;
      }
      this._chase(t, dt);
      return;
    }
    if (!this.goal) { this.nextOrder(); return; }
    const arrived = this._followPath(dt);
    // fire on the move if something wandered into range
    if (t && t.alive && this.game.combat.inRange(this, t) && !this.def.melee) this.tryFire(t);
    if (arrived) {
      this.anchor = { x: this.pos.x, z: this.pos.z };
      this.nextOrder();
    }
  }

  _patrol(dt) {
    const t = this.target;
    if (t && t.alive && this.distanceTo(t) < this.game.combat.sightFor(this)) {
      if (this.game.combat.inRange(this, t)) {
        this.faceTowards(t.pos, dt);
        this.vel.multiplyScalar(Math.exp(-8 * dt));
        this.tryFire(t);
        return;
      }
      this._chase(t, dt);
      return;
    }
    if (!this.goal) {
      const dest = this.patrolTo === 'b' ? this.patrolB : this.patrolA;
      this.setGoal(dest.x, dest.z);
    }
    if (this._followPath(dt)) {
      this.patrolTo = this.patrolTo === 'b' ? 'a' : 'b';
      const dest = this.patrolTo === 'b' ? this.patrolB : this.patrolA;
      this.setGoal(dest.x, dest.z);
    }
  }

  _attackOrder(dt) {
    const t = this.forcedTarget;
    if (!t || !t.alive) {
      this.forcedTarget = null;
      this.nextOrder();
      return;
    }
    if (this.game.combat.inRange(this, t) && this.hasLineOfSight(t)) {
      this.vel.multiplyScalar(Math.exp(-8 * dt));
      this.faceTowards(t.pos, dt);
      this.tryFire(t);
    } else {
      this._chase(t, dt);
    }
  }

  _hold(dt) {
    this.vel.multiplyScalar(Math.exp(-9 * dt));
    this._integrate(dt);
    const t = this.target;
    if (t && t.alive && this.game.combat.inRange(this, t)) {
      this.faceTowards(t.pos, dt);
      this.tryFire(t);
    }
  }

  _repair(dt) {
    const t = this.forcedTarget;
    if (!t || !t.alive || t.hp >= t.maxHp) { this.forcedTarget = null; this.nextOrder(); return; }
    const range = this.def.repair.range + Math.max(...t.def.footprint);
    if (this.distanceTo(t) > range) { this._chase(t, dt, range * 0.8); return; }

    this.vel.multiplyScalar(Math.exp(-8 * dt));
    this._integrate(dt);
    this.faceTowards(t.pos, dt);

    const mods = this.game.players[this.owner].mods;
    const rate = this.def.repair.rate * mods.repairRate * dt;
    const cost = rate * BALANCE.REPAIR_COST_PER_HP;
    if (this.game.players[this.owner].trySpend({ paper: cost })) {
      t.heal(rate);
      if (Math.random() < dt * 8) {
        this.game.fx.emit(t.pos.x + frand(-3, 3), 1.5, t.pos.z + frand(-3, 3),
          { count: 1, color: 0xe6dcc0, size: 1.1, life: 0.5, speed: 2, gravity: 3, up: 1.5 });
      }
    }
  }

  _sabotage(dt) {
    const t = this.forcedTarget;
    if (!t || !t.alive) { this.forcedTarget = null; this.nextOrder(); return; }
    const range = this.def.sabotage.range + Math.max(...t.def.footprint);
    if (this.distanceTo(t) > range) { this._chase(t, dt, range * 0.85); return; }

    this.vel.multiplyScalar(Math.exp(-8 * dt));
    this._integrate(dt);
    if (this.abilityTimer <= 0) {
      this.abilityTimer = this.def.sabotage.cooldown;
      t.applyStatus(STATUS.DISABLED, this.def.sabotage.duration, 1, this);
      this.lastFire = this.game.time;   // breaks cloak
      this.game.fx.emit(t.pos.x, 2.5, t.pos.z, { count: 14, color: 0xf6ee7a, size: 1.6, life: 0.8, speed: 6, up: 1.4 });
      this.game.audio.play('alert');
      if (t.owner === this.game.humanId) {
        this.game.events.emit(EV.ALERT, { text: `${t.def.name} sabotaged!`, kind: 'bad', x: t.pos.x, z: t.pos.z });
      }
      this.forcedTarget = null;
      this.nextOrder();
    }
  }

  _bridge(dt) {
    if (!this.goal) { this.nextOrder(); return; }
    const d = Math.hypot(this.pos.x - this.goal.x, this.pos.z - this.goal.z);
    if (d > 7) { this._followPath(dt); return; }
    this.vel.multiplyScalar(Math.exp(-8 * dt));
    this._integrate(dt);
    this.game.layBridge(this, this.goal.x, this.goal.z);
    this.nextOrder();
  }

  /** Walk toward an entity, repathing when it has moved far enough. */
  _chase(t, dt, stopAt = null) {
    const want = stopAt ?? (this.game.combat.rangeFor(this) * 0.85);
    const d = this.distanceTo(t);
    if (d <= want) {
      this.vel.multiplyScalar(Math.exp(-8 * dt));
      this._integrate(dt);
      this.faceTowards(t.pos, dt);
      return;
    }
    const moved = !this.goal || Math.hypot(this.goal.x - t.pos.x, this.goal.z - t.pos.z) > 4;
    if (moved && this.repathTimer <= 0) {
      this.repathTimer = REPATH_INTERVAL;
      this.setGoal(t.pos.x, t.pos.z);
    }
    if (this.isAir) {
      this.goal = { x: t.pos.x, z: t.pos.z };
      this.path = [[t.pos.x, t.pos.z]];
      this.pathIdx = 0;
    }
    this._followPath(dt);
  }

  /* ── movement core ───────────────────────────────────────────────── */
  _followPath(dt) {
    if (this.def.immobile) return true;
    if (!this.goal) return true;

    // no path yet: steer straight at the goal so the order feels instant
    let tx = this.goal.x, tz = this.goal.z;
    let finalLeg = true;
    if (this.path && this.pathIdx < this.path.length) {
      const wp = this.path[this.pathIdx];
      tx = wp[0]; tz = wp[1];
      finalLeg = this.pathIdx === this.path.length - 1;
    }

    const dx = tx - this.pos.x, dz = tz - this.pos.z;
    const d = Math.hypot(dx, dz);

    if (d < (finalLeg ? ARRIVE : 1.35)) {
      if (this.path && this.pathIdx < this.path.length - 1) {
        this.pathIdx++;
      } else {
        this.vel.multiplyScalar(Math.exp(-9 * dt));
        this._integrate(dt);
        this.goal = null;
        this.path = null;
        return true;
      }
    }

    const speed = this.speedNow;
    if (speed <= 0.01) { this._integrate(dt); return false; }

    const inv = d > 0.0001 ? 1 / d : 0;
    let wx = dx * inv * speed;
    let wz = dz * inv * speed;

    // gentle arrival so units do not skate past the last waypoint
    if (finalLeg && d < 5) { const k = clamp(d / 5, 0.25, 1); wx *= k; wz *= k; }

    if (!this.isAir) {
      const sep = this._separation();
      wx += sep.x; wz += sep.z;
    }

    const accel = this.isAir ? 3.2 : 11;
    this.vel.x = damp(this.vel.x, wx, accel, dt);
    this.vel.z = damp(this.vel.z, wz, accel, dt);

    const vlen = Math.hypot(this.vel.x, this.vel.z);
    if (vlen > speed) { this.vel.x *= speed / vlen; this.vel.z *= speed / vlen; }

    this.moveTime = vlen > speed * 0.55 ? this.moveTime + dt : 0;
    this._integrate(dt);

    if (vlen > 0.2) this.faceVelocity(dt);
    this._checkStuck(dt);
    return false;
  }

  _separation() {
    const sep = this._sep.set(0, 0, 0);
    const r = (this.def.radius || 1) * 2.5;
    const me = this;
    this.game.spatial.forEachNear(this.pos.x, this.pos.z, r, (e) => {
      if (e === me || !e.alive || !e.isUnit || e.isAir !== me.isAir) return;
      const dx = me.pos.x - e.pos.x, dz = me.pos.z - e.pos.z;
      const d2 = dx * dx + dz * dz;
      const want = (me.def.radius + e.def.radius) * 1.05;
      if (d2 > want * want || d2 < 1e-6) return;
      const d = Math.sqrt(d2);
      const push = (want - d) / want;
      const w = e.owner === me.owner ? 1 : 1.5;
      sep.x += (dx / d) * push * w;
      sep.z += (dz / d) * push * w;
    });
    const mag = Math.hypot(sep.x, sep.z);
    if (mag > 0.001) {
      const k = Math.min(1, mag) * this.def.speed * 0.85;
      sep.x = (sep.x / mag) * k;
      sep.z = (sep.z / mag) * k;
    }
    return sep;
  }

  _integrate(dt) {
    const nx = this.pos.x + this.vel.x * dt;
    const nz = this.pos.z + this.vel.z * dt;

    if (this.isAir) {
      this.pos.x = nx; this.pos.z = nz;
    } else {
      const grid = this.game.grid;
      // slide along walls instead of sticking to them
      if (!grid.blockedAt(nx, this.pos.z)) this.pos.x = nx; else this.vel.x *= -0.15;
      if (!grid.blockedAt(this.pos.x, nz)) this.pos.z = nz; else this.vel.z *= -0.15;
    }

    const [cx, cz] = this.game.map.clampToDesk(this.pos.x, this.pos.z, 2);
    this.pos.x = cx; this.pos.z = cz;
  }

  _checkStuck(dt) {
    const moved = Math.hypot(this.pos.x - this._prevX, this.pos.z - this._prevZ);
    this._prevX = this.pos.x; this._prevZ = this.pos.z;
    if (moved < this.speedNow * dt * 0.28) {
      this.stuckTimer += dt;
      if (this.stuckTimer > 1.1) {
        this.stuckTimer = 0;
        if (this.goal) {
          // nudge sideways then ask for a fresh path
          const a = frand(0, TAU);
          this.vel.x += Math.cos(a) * this.def.speed * 0.8;
          this.vel.z += Math.sin(a) * this.def.speed * 0.8;
          this.requestPath();
        }
      }
    } else {
      this.stuckTimer = Math.max(0, this.stuckTimer - dt);
    }
  }

  faceVelocity(dt) {
    const want = Math.atan2(this.vel.x, this.vel.z);
    this.facing = approachAngle(this.facing, want, (this.def.turn || 6) * dt);
  }

  faceTowards(p, dt) {
    const want = Math.atan2(p.x - this.pos.x, p.z - this.pos.z);
    this.facing = approachAngle(this.facing, want, (this.def.turn || 6) * 1.4 * dt);
  }

  /* ── combat ──────────────────────────────────────────────────────── */
  acquire() {
    if (this.forcedTarget && this.forcedTarget.alive) { this.target = this.forcedTarget; return; }
    if (!this.def.attack) { this.target = null; return; }

    const combat = this.game.combat;
    const sight = Math.max(combat.sightFor(this), combat.rangeFor(this) * 1.15);
    const me = this;
    let best = null, bestScore = -Infinity;

    // stay locked on a valid target unless something much juicier appears
    if (this.target && this.target.alive && combat.canTarget(this, this.target) &&
        this.distanceTo(this.target) < sight * 1.15) {
      best = this.target;
      bestScore = threatScore(this.target, this) * 1.25;
    }

    this.game.spatial.forEachNear(this.pos.x, this.pos.z, sight, (e) => {
      if (!combat.canTarget(me, e)) return;
      const d = me.distanceTo(e);
      if (d > sight) return;
      const s = threatScore(e, me);
      if (s > bestScore) { bestScore = s; best = e; }
    });
    this.target = best;
  }

  hasLineOfSight(t) {
    if (this.isAir || t.isAir) return true;
    if (this.def.attack?.projectile === 'arc') return true;
    return this.game.grid.lineOfSight(
      this.pos.x, this.pos.z, this.pos.y + 2,
      t.pos.x, t.pos.z, t.pos.y + 1.5
    );
  }

  tryFire(t) {
    if (this.cooldown > 0 || !this.def.attack) return;
    if (this.def.oneShot) return;   // mines go off via their trigger, not by aiming
    if (!this.game.combat.canTarget(this, t)) return;
    if (!this.hasLineOfSight(t)) return;

    // charge bonus for lancers
    if (this.def.charge && this.moveTime >= this.def.charge.minTime) {
      this.chargeBonus = this.def.charge.bonus;
    }
    this.game.combat.fire(this, t);
    this.chargeBonus = 1;
    this.moveTime = 0;
  }

  /* ── per-unit specials ───────────────────────────────────────────── */
  _special(dt) {
    const def = this.def;

    if (def.heal) {
      if (this.abilityTimer <= 0) {
        this.abilityTimer = 0.35;
        const mods = this.game.players[this.owner].mods;
        const amount = def.heal.rate * mods.healRate * 0.35;
        const me = this;
        const wounded = this.game.spatial.query(this.pos.x, this.pos.z, def.heal.range,
          (e) => e.alive && e.isUnit && e.owner === me.owner && e !== me && e.hp < e.maxHp, this._scratch);
        wounded.sort((a, b) => a.hpFrac - b.hpFrac);
        for (let i = 0; i < Math.min(def.heal.targets, wounded.length); i++) {
          wounded[i].heal(amount);
          this.game.fx.healPulse(wounded[i].pos.x, wounded[i].pos.y, wounded[i].pos.z);
        }
      }
    }

    if (def.mark) {
      if (this.abilityTimer <= 0) {
        this.abilityTimer = 0.6;
        const me = this;
        const foes = this.game.spatial.query(this.pos.x, this.pos.z, def.mark.radius,
          (e) => e.alive && e.owner !== me.owner && e.owner !== 2, this._scratch);
        for (const f of foes) f.applyStatus(STATUS.MARKED, 1.2, def.mark.bonus, this);
      }
      const sweep = this.mesh.userData.model?.userData.sweep;
      if (sweep) sweep.parent.rotation.y += dt * 2.4;
    }

    if (def.oneShot && def.trigger) {
      // a tack trap waits, then goes off once
      if (this.abilityTimer <= 0) {
        this.abilityTimer = 0.2;
        const me = this;
        const victim = this.game.spatial.nearest(this.pos.x, this.pos.z, def.trigger,
          (e) => e.alive && e.isUnit && !e.isAir && e.owner !== me.owner && e.owner !== 2);
        if (victim) this.detonateTrap();
      }
    }

    if (this.isCloaked && this.mesh.userData.model) {
      this._applyCloakVisual(true);
    } else if (this._cloakVisual) {
      this._applyCloakVisual(false);
    }
  }

  detonateTrap() {
    const def = this.def;
    const game = this.game;
    game.combat.spawnProjectile({
      kind: 'bomb',
      from: this.pos.clone().setY(0.6),
      to: this.pos.clone().setY(0.4),
      speed: 999, color: 0xffb03c,
      damage: game.combat.computeDamage(this, this),
      attacker: this, target: null, arc: false,
      splash: def.attack.splash, status: null, type: def.attack.type,
    });
    this.die(null);
  }

  /**
   * Cloaked units render as a ghost. Materials come from the shared cache, so
   * the first time a unit cloaks it takes private copies — otherwise every
   * pencil on the desk would turn translucent with it. Whether an enemy can
   * see this unit at all is the fog's decision, not ours.
   */
  _applyCloakVisual(on) {
    if (this._cloakVisual === on) return;
    this._cloakVisual = on;
    if (!this._ownMaterials) {
      this._ownMaterials = [];
      this.mesh.traverse((c) => {
        if (!c.isMesh || c === this._ring) return;
        c.material = c.material.clone();
        this._ownMaterials.push(c.material);
      });
    }
    for (const mat of this._ownMaterials) {
      mat.transparent = on;
      mat.opacity = on ? 0.4 : 1;
      mat.depthWrite = !on;
      mat.needsUpdate = true;
    }
  }

  /* ── presentation ────────────────────────────────────────────────── */
  _syncMesh(dt) {
    if (this.isAir) {
      this._bob += dt * 1.7;
      const wobble = Math.sin(this._bob) * 0.45;
      this.pos.y = damp(this.pos.y, WORLD.AIR_ALTITUDE + wobble, 3, dt);
      const bank = clamp(-this._turnRate * 2.6, -0.6, 0.6);
      this.mesh.rotation.z = damp(this.mesh.rotation.z, bank, 5, dt);
      this.mesh.rotation.x = damp(this.mesh.rotation.x, -0.08 - Math.abs(bank) * 0.1, 4, dt);
    } else {
      this.pos.y = damp(this.pos.y, this.terrainH, 9, dt);
      // little bob while walking so infantry does not look like it is skating
      const speed = Math.hypot(this.vel.x, this.vel.z);
      if (speed > 0.4 && !this.def.immobile) {
        this._bob += dt * (5 + speed * 0.55);
        this.mesh.rotation.z = Math.sin(this._bob) * 0.055;
        this.mesh.rotation.x = Math.abs(Math.cos(this._bob)) * 0.03;
      } else {
        this.mesh.rotation.z = damp(this.mesh.rotation.z, 0, 8, dt);
        this.mesh.rotation.x = damp(this.mesh.rotation.x, 0, 8, dt);
      }
    }

    const prevFacing = this.mesh.rotation.y;
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.facing;
    this._turnRate = dt > 0 ? (this.facing - prevFacing) / dt * 0.06 : 0;
  }

  onDeath(killer) {
    const game = this.game;
    game.players[this.owner].onUnitLost(this);
    if (killer && killer.owner != null && game.players[killer.owner]) {
      game.players[killer.owner].stats.kills++;
    }
    game.paths.cancel(this);

    const world = this.mesh.position.clone();
    this.mesh.position.copy(world);
    game.fx.addCorpse(this.mesh, this.facing);
    game.fx.emit(this.pos.x, this.pos.y + 1.2, this.pos.z, {
      count: 8, color: 0xb9a98f, size: 1.3, life: 0.6, speed: 6, gravity: -18, up: 1.2,
    });
    game.audio.play('die');
    if (this._ring) this._ring.visible = false;
    game.events.emit(EV.UNIT_DIED, { unit: this, killer });
  }
}
