/**
 * Shared runtime behaviour for anything that has hit points and a mesh.
 */
import * as THREE from 'three';
import { nextId, clamp, clamp01 } from '../core/utils.js';
import { STATUS, BALANCE, TEAM_COLORS, HEIGHT_BONUS } from '../core/constants.js';
import { selectionRing } from './meshFactory.js';
import { EV } from '../core/events.js';

export class Entity {
  constructor(game, def, owner, x, z) {
    this.id = nextId();
    this.game = game;
    this.def = def;
    this.owner = owner;
    this.pos = new THREE.Vector3(x, 0, z);
    this.facing = owner === 1 ? Math.PI : 0;

    this.maxHp = def.hp;
    this.hp = def.hp;
    this.alive = true;
    this.selected = false;
    this.rank = 0;
    this.kills = 0;
    this.damageDealt = 0;
    this.cooldown = 0;
    this.lastFire = -99;
    this.lastDamaged = -99;
    this.lastAttacker = null;
    this.terrainH = 0;
    this.chargeBonus = 1;
    this.statuses = new Map();
    this.mesh = null;
    this._ring = null;
    this._tmp = new THREE.Vector3();
  }

  get isUnit() { return false; }
  get isBuilding() { return false; }
  get isAir() { return false; }
  get isCloaked() { return false; }
  get heightAdvantage() { return this.terrainH >= HEIGHT_BONUS.MIN_DELTA ? this.terrainH : 0; }
  get hpFrac() { return clamp01(this.hp / this.maxHp); }
  get player() { return this.game.players[this.owner]; }

  /* ── geometry helpers ─────────────────────────────────────────────── */
  aimPoint(out = new THREE.Vector3()) {
    return out.set(this.pos.x, this.pos.y + (this.def.height || 2) * 0.55, this.pos.z);
  }

  muzzleWorld(out = new THREE.Vector3()) {
    const local = this.mesh?.userData.muzzle;
    if (!local) return this.aimPoint(out);
    out.copy(local);
    this.mesh.localToWorld(out);
    return out;
  }

  distanceTo(other) {
    const dx = this.pos.x - other.pos.x, dz = this.pos.z - other.pos.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  /* ── status effects ───────────────────────────────────────────────── */
  applyStatus(type, duration, power, source = null) {
    const now = this.game.time;
    const cur = this.statuses.get(type);
    if (cur && cur.until > now + duration && cur.power >= power) return;
    this.statuses.set(type, { until: now + duration, power, source, tick: 0 });
  }

  hasStatus(type) {
    const s = this.statuses.get(type);
    return !!s && s.until > this.game.time;
  }

  statusPower(type) {
    const s = this.statuses.get(type);
    return s && s.until > this.game.time ? s.power : 0;
  }

  clearStatus(type) { this.statuses.delete(type); }

  tickStatuses(dt) {
    if (this.statuses.size === 0) return;
    const now = this.game.time;
    for (const [type, s] of this.statuses) {
      if (s.until <= now) { this.statuses.delete(type); continue; }
      if (type === STATUS.BURN) {
        s.tick += dt;
        if (s.tick >= 0.5) {
          s.tick -= 0.5;
          this.takeDamage(s.power * 0.5, 'chemical', s.source, this.pos.x, this.pos.z, true);
          this.game.fx.emit(this.pos.x, this.pos.y + 1.4, this.pos.z, {
            count: 1, color: 0xd9f24e, size: 0.9, life: 0.4, speed: 1.4, gravity: 3, up: 1.4,
          });
        }
      }
    }
  }

  /* ── damage ───────────────────────────────────────────────────────── */
  takeDamage(amount, type, attacker, hx, hz, silent = false) {
    if (!this.alive || amount <= 0) return 0;
    const dealt = Math.min(this.hp, amount);
    this.hp -= dealt;
    this.lastDamaged = this.game.time;
    if (attacker) this.lastAttacker = attacker;

    if (!silent) {
      this.game.events.emit(EV.DAMAGE, { target: this, attacker, amount: dealt });
      this.game.notifyDamage(this, attacker);
    }
    if (this.hp <= 0) this.die(attacker);
    return dealt;
  }

  heal(amount) {
    if (!this.alive) return 0;
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    return this.hp - before;
  }

  registerKill(victim) {
    this.kills++;
    const ranks = BALANCE.VETERANCY_KILLS;
    let r = 0;
    for (let i = ranks.length - 1; i >= 0; i--) if (this.kills >= ranks[i]) { r = i; break; }
    if (r !== this.rank) {
      this.rank = r;
      const gain = 1 + BALANCE.VETERANCY_BONUS;
      this.maxHp *= gain;
      this.hp = Math.min(this.maxHp, this.hp * gain);
      this.game.fx.emit(this.pos.x, this.pos.y + 2.4, this.pos.z, {
        count: 6, color: 0xf2d24a, size: 1.1, life: 0.7, speed: 3, gravity: 2, up: 1.4,
      });
    }
  }

  die(killer) {
    if (!this.alive) return;
    this.alive = false;
    this.onDeath(killer);
  }

  onDeath() { /* subclasses */ }

  /* ── selection ────────────────────────────────────────────────────── */
  setSelected(on) {
    if (this.selected === on) return;
    this.selected = on;
    if (on) {
      if (!this._ring) {
        // team colour, not "mine vs theirs": in hot seat the sides swap and a
        // cached ring would end up lying about who owns the unit
        const r = this.selectionRadius();
        this._ring = selectionRing(r, TEAM_COLORS[this.owner].accent);
        this.mesh.add(this._ring);
      }
      this._ring.visible = true;
    } else if (this._ring) {
      this._ring.visible = false;
    }
  }

  selectionRadius() {
    if (this.isBuilding) {
      const [hw, hd] = this.def.footprint;
      return Math.max(hw, hd) + 1.0;
    }
    return (this.def.radius || 1) + 0.7;
  }

  teamColor() { return TEAM_COLORS[this.owner].primary; }

  destroy() {
    if (this.mesh && this.mesh.parent) this.mesh.parent.remove(this.mesh);
  }
}

/** Shared turret aim helper used by towers and by units with a visible barrel. */
export function aimTurret(turret, from, to, dt, speed = 6) {
  if (!turret) return;
  const want = Math.atan2(to.x - from.x, to.z - from.z);
  let cur = turret.rotation.y;
  let d = ((want - cur + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  turret.rotation.y = cur + clamp(d, -speed * dt, speed * dt);
}
