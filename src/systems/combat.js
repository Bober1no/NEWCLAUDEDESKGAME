/**
 * Attack resolution, projectiles, splash and status effects.
 *
 * Damage pipeline, in order:
 *   base damage
 *   × unit family upgrade multiplier          (tech tree)
 *   × veterancy                               (kills earned)
 *   × melee upgrade, charge bonus             (situational)
 *   × high-ground bonus                       (terrain)
 *   × bonusVs[target armour class]            (unit design)
 *   × damage-type / armour-type table         (rock-paper-scissors)
 *   × target "marked" vulnerability           (protractor radar)
 *   × splash falloff                          (distance from impact)
 */
import * as THREE from 'three';
import {
  damageMultiplier, HEIGHT_BONUS, STATUS, BALANCE, TEAM_COLORS, DMG,
} from '../core/constants.js';
import { clamp, clamp01, frand } from '../core/utils.js';
import { projectileMesh } from '../scene/fx.js';

const PROJECTILE_COLORS = {
  pierce: 0xfff0b0,
  blunt: 0xd8b98a,
  slash: 0xdfe9f7,
  explosive: 0xff9a3c,
  chemical: 0x9cf07a,
};

export class Combat {
  constructor(game) {
    this.game = game;
    this.projectiles = [];
    this.pool = new Map();     // kind → array of unused meshes
    this._tmp = new THREE.Vector3();
    this._scratch = [];
  }

  /* ── modifiers ────────────────────────────────────────────────────── */

  /** Attack cooldown after tech, statuses and veterancy. */
  cooldownFor(attacker) {
    const def = attacker.def;
    const mods = this.game.players[attacker.owner].mods;
    let cd = def.attack.cooldown;
    const rof = mods.rof[def.family] || 1;
    cd /= rof;
    if (attacker.hasStatus(STATUS.SLOW)) cd *= 1 + attacker.statusPower(STATUS.SLOW) * 0.6;
    return cd;
  }

  /** Effective weapon range including tech and the high-ground bonus. */
  rangeFor(attacker) {
    const def = attacker.def;
    if (!def.attack) return 0;
    const mods = this.game.players[attacker.owner].mods;
    let r = def.attack.range * (mods.range[def.family] || 1);
    if (attacker.heightAdvantage > 0) {
      r *= 1 + HEIGHT_BONUS.RANGE * mods.heightBonus * clamp01(attacker.heightAdvantage / 4);
    }
    if (attacker.isBuilding && attacker.onBottle) r *= 1.18;
    return r;
  }

  sightFor(entity) {
    const mods = this.game.players[entity.owner]?.mods;
    let s = entity.def.sight || 18;
    if (entity.heightAdvantage > 0) s *= 1 + HEIGHT_BONUS.VISION * clamp01(entity.heightAdvantage / 4);
    if (entity.def.detector && mods) s = Math.max(s, s * 1);
    return s;
  }

  detectRangeFor(entity) {
    if (!entity.def.detector) return 0;
    const mods = this.game.players[entity.owner].mods;
    return (entity.def.reveal || BALANCE.CLOAK_DETECT_RANGE) * mods.detectorRange;
  }

  /* ── can A shoot B ────────────────────────────────────────────────── */
  canTarget(attacker, target) {
    if (!target || !target.alive || !attacker.def.attack) return false;
    if (target.owner === attacker.owner) return false;
    const t = attacker.def.attack.targets;
    if (target.isAir ? !t.air : !t.ground) return false;
    if (target.isCloaked && !this.game.isDetectedBy(target, attacker.owner)) return false;
    return true;
  }

  /**
   * Range is measured on the desk plane, with a separate vertical allowance —
   * otherwise a Scissor Striker could never reach a paper plane 13 units up,
   * and a unit on a book stack would lose reach for being tall.
   */
  inRange(attacker, target) {
    const dx = attacker.pos.x - target.pos.x;
    const dz = attacker.pos.z - target.pos.z;
    const d = Math.hypot(dx, dz);
    const r = this.rangeFor(attacker) + (target.def.radius || 1) * 0.75;
    const min = attacker.def.attack.minRange || 0;
    if (d > r || d < min) return false;
    const dy = Math.abs(target.pos.y - attacker.pos.y);
    const vertical = r + (attacker.def.leap || 0) + (attacker.isAir || target.isAir ? 5 : 2);
    return dy <= vertical;
  }

  /* ── firing ───────────────────────────────────────────────────────── */
  fire(attacker, target) {
    const def = attacker.def;
    const atk = def.attack;
    const game = this.game;

    attacker.cooldown = this.cooldownFor(attacker);
    attacker.lastFire = game.time;

    const muzzle = attacker.muzzleWorld(this._tmp);
    const damage = this.computeDamage(attacker, target);
    const kind = atk.projectile;

    if (!kind) {
      // instant melee swipe
      this.applyHit(attacker, target, damage, target.pos.x, target.pos.z);
      game.fx.impact(target.pos.x, target.pos.y + target.def.height * 0.5, target.pos.z,
        PROJECTILE_COLORS[atk.type], 0.9);
      game.audio.play('melee');
      return;
    }

    const color = PROJECTILE_COLORS[atk.type] || 0xffffff;
    const speed = atk.projectileSpeed || 50;
    const from = muzzle.clone();
    const to = this.leadTarget(target, from, speed);

    this.spawnProjectile({
      kind, from, to, speed, color, damage,
      attacker, target,
      arc: kind === 'arc' || kind === 'bomb',
      splash: atk.splash || null,
      status: atk.status || null,
      type: atk.type,
    });

    game.fx.muzzleFlash(from.x, from.y, from.z, color);
    if (kind === 'bolt' && speed > 70) {
      game.fx.tracer(from.x, from.y, from.z, to.x, to.y, to.z, color, 0.07);
    }
    game.audio.play(atk.type === 'explosive' ? 'siege' : 'shot');
  }

  /** Simple constant-velocity intercept so fast units are not un-hittable. */
  leadTarget(target, from, speed) {
    const p = target.pos.clone();
    p.y += (target.def.height || 2) * 0.55;
    if (!target.vel || speed <= 0) return p;
    const t = from.distanceTo(p) / speed;
    p.x += target.vel.x * t * 0.85;
    p.z += target.vel.z * t * 0.85;
    return p;
  }

  computeDamage(attacker, target) {
    const def = attacker.def;
    const atk = def.attack;
    const player = this.game.players[attacker.owner];
    const mods = player.mods;

    let dmg = atk.damage;
    dmg *= mods.dmg[def.family] || 1;
    dmg *= 1 + attacker.rank * BALANCE.VETERANCY_BONUS;
    if (def.melee) dmg *= mods.meleeDmg;
    if (attacker.chargeBonus > 1) dmg *= attacker.chargeBonus;

    // shooting downhill: the bonus scales with how much higher you actually are
    const delta = attacker.terrainH - (target?.terrainH || 0);
    if (delta >= HEIGHT_BONUS.MIN_DELTA) {
      const affinity = def.heightAffinity || 1;
      dmg *= 1 + HEIGHT_BONUS.DAMAGE * mods.heightBonus * affinity * clamp01(delta / 4);
    }
    return dmg;
  }

  /* ── projectiles ──────────────────────────────────────────────────── */
  spawnProjectile(spec) {
    let mesh = (this.pool.get(spec.kind) || []).pop();
    if (!mesh) mesh = projectileMesh(spec.kind, spec.color);
    mesh.visible = true;
    mesh.position.copy(spec.from);
    this.game.scene.add(mesh);

    const dist = spec.from.distanceTo(spec.to);
    const p = {
      ...spec,
      mesh,
      t: 0,
      duration: Math.max(0.05, dist / spec.speed),
      spin: spec.kind === 'arc' ? frand(-8, 8) : 0,
      peak: spec.arc ? clamp(dist * 0.22, 3, 22) : 0,
    };
    this.projectiles.push(p);
    return p;
  }

  updateProjectiles(dt) {
    const list = this.projectiles;
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.t += dt;
      const k = clamp01(p.t / p.duration);

      // home in slightly on a live target so slow shots still connect
      if (p.target && p.target.alive && !p.arc) {
        p.to.lerp(p.target.aimPoint(this._tmp), Math.min(1, dt * 6));
      }

      const x = p.from.x + (p.to.x - p.from.x) * k;
      const z = p.from.z + (p.to.z - p.from.z) * k;
      let y = p.from.y + (p.to.y - p.from.y) * k;
      if (p.peak) y += Math.sin(k * Math.PI) * p.peak;

      const prev = p.mesh.position.clone();
      p.mesh.position.set(x, y, z);
      if (p.kind === 'bolt') {
        p.mesh.lookAt(p.mesh.position.clone().add(p.mesh.position.clone().sub(prev)));
      } else if (p.spin) {
        p.mesh.rotation.x += p.spin * dt;
        p.mesh.rotation.z += p.spin * 0.6 * dt;
      }
      if (p.kind === 'spray') {
        this.game.fx.emit(x, y, z, { count: 1, color: p.color, size: 1.0, life: 0.28, speed: 1.2, gravity: -3, up: 0.4 });
      }

      if (k >= 1) {
        this.detonate(p);
        p.mesh.visible = false;
        this.game.scene.remove(p.mesh);
        let bucket = this.pool.get(p.kind);
        if (!bucket) this.pool.set(p.kind, (bucket = []));
        if (bucket.length < 40) bucket.push(p.mesh);
        list[i] = list[list.length - 1];
        list.pop();
      }
    }
  }

  detonate(p) {
    const game = this.game;
    const x = p.to.x, z = p.to.z;

    if (p.splash) {
      const radius = p.splash.radius * game.players[p.attacker?.owner ?? 0].mods.splash;
      game.fx.explosion(x, Math.max(0.4, p.to.y), z, radius, p.color);
      game.camera && game.controls.shake(clamp(radius * 0.012, 0.02, 0.16));
      const attackerOwner = p.attacker ? p.attacker.owner : -1;
      const hits = game.spatial.query(x, z, radius, (e) =>
        e.alive && e.owner !== attackerOwner && e.owner !== 2 &&
        (e.isAir ? p.arc === false : true), this._scratch);
      for (const e of hits) {
        const d = Math.hypot(e.pos.x - x, e.pos.z - z);
        const falloff = 1 - (1 - p.splash.falloff) * clamp01(d / radius);
        this.applyHit(p.attacker, e, p.damage * falloff, x, z);
      }
      if (p.status) this.spreadStatus(p, x, z, radius);
      game.audio.play('explode', { volume: clamp01(radius / 9) });
    } else {
      if (p.target && p.target.alive) {
        this.applyHit(p.attacker, p.target, p.damage, x, z);
      }
      game.fx.impact(x, Math.max(0.3, p.to.y), z, p.color, 0.8);
      if (p.status && p.target && p.target.alive) {
        this.applyStatusTo(p.target, p.status, p.attacker);
      }
    }
  }

  spreadStatus(p, x, z, radius) {
    const attackerOwner = p.attacker ? p.attacker.owner : -1;
    const hits = this.game.spatial.query(x, z, radius, (e) =>
      e.alive && e.isUnit && e.owner !== attackerOwner && e.owner !== 2, this._scratch);
    for (const e of hits) this.applyStatusTo(e, p.status, p.attacker);

    if (p.status.type === STATUS.SLOW) {
      this.game.fx.decal(x, z, radius * 0.8, 0xe8e4d0, 7, null, 0.42);
    } else if (p.status.type === STATUS.BURN) {
      this.game.fx.decal(x, z, radius * 0.8, 0xd9f24e, 5, null, 0.34);
    }
  }

  applyStatusTo(target, status, attacker) {
    if (!target.isUnit) return;
    const power = this.game.players[attacker?.owner ?? 0]?.mods.statusPower ?? 1;
    target.applyStatus(status.type, status.duration * (0.7 + power * 0.3), status.power * power, attacker);
  }

  /* ── damage application ───────────────────────────────────────────── */
  applyHit(attacker, target, rawDamage, hx, hz) {
    if (!target || !target.alive) return 0;
    const def = attacker?.def;
    const atk = def?.attack;
    let dmg = rawDamage;

    if (atk?.bonusVs) {
      const bonus = atk.bonusVs[target.def.armor] ?? (target.isBuilding ? atk.bonusVs.structure : null);
      if (bonus) dmg *= bonus;
    }
    dmg *= damageMultiplier(atk?.type || DMG.BLUNT, target.def.armor);
    if (target.hasStatus(STATUS.MARKED)) dmg *= 1 + target.statusPower(STATUS.MARKED);

    const dealt = target.takeDamage(dmg, atk?.type || DMG.BLUNT, attacker, hx, hz);

    if (attacker && attacker.isUnit) {
      attacker.damageDealt += dealt;
      if (!target.alive) attacker.registerKill(target);
    }
    if (attacker) this.game.players[attacker.owner].stats.damage += dealt;
    return dealt;
  }

  /** Direct, un-typed damage (mine triggers, sabotage backlash, etc). */
  raw(target, amount, source) {
    if (!target?.alive) return;
    target.takeDamage(amount, DMG.EXPLOSIVE, source);
  }

  clear() {
    for (const p of this.projectiles) this.game.scene.remove(p.mesh);
    this.projectiles.length = 0;
    this.pool.clear();
  }
}

/** Threat weighting used by both the auto-acquire logic and the AI. */
export function threatScore(target, from) {
  const def = target.def;
  let score = 0;
  if (def.attack) score += def.attack.damage / Math.max(0.4, def.attack.cooldown);
  if (def.heal) score += 22;
  if (def.repair) score += 14;
  if (def.detector) score += 10;
  if (target.isBuilding) score = target.def.produces ? 26 : 12;
  const d = from ? from.pos.distanceTo(target.pos) : 0;
  const hpFactor = 1 + (1 - target.hp / target.maxHp) * 0.6;   // finish the wounded
  return (score * hpFactor) / (1 + d * 0.05);
}

export const PROJECTILE_TINTS = PROJECTILE_COLORS;
export const TEAM_TINTS = TEAM_COLORS;
