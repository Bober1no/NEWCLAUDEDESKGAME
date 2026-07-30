/**
 * Runtime structure: construction, production queues, research, defences.
 */
import * as THREE from 'three';
import { Entity } from './entity.js';
import { buildBuildingMesh, rallyFlag } from './meshFactory.js';
import { aimTurret } from './entity.js';
import { STATUS, ORDER, TEAM_COLORS, BALANCE } from '../core/constants.js';
import { clamp, clamp01, damp, frand } from '../core/utils.js';
import { EV } from '../core/events.js';
import { ResearchJob, TECHS } from '../systems/techTree.js';
import { getUnitDef } from './registry.js';

export class Building extends Entity {
  constructor(game, def, owner, x, z, { instant = false, node = null, bottle = null } = {}) {
    super(game, def, owner, x, z);

    this.node = node;
    this.onBottle = !!bottle;
    this.queue = [];
    this.research = null;
    this.rally = null;
    this.rallyMesh = null;
    this.built = instant;
    this.progress = instant ? 1 : 0;
    this.buildRate = 1;
    this._scratch = [];

    const mods = game.players[owner].mods;
    this.maxHp = def.hp * mods.buildingHp * (this.onBottle ? 1.25 : 1);
    this.hp = instant ? this.maxHp : this.maxHp * 0.08;

    this.mesh = buildBuildingMesh(def.id, def, owner);
    this.mesh.position.set(x, 0, z);
    this.mesh.rotation.y = owner === 1 ? Math.PI : 0;
    this.mesh.userData.entity = this;
    game.entityRoot.add(this.mesh);

    this.turret = this.mesh.userData.turret;
    this.terrainH = game.grid.heightAt(x, z);
    this.mesh.position.y = this.terrainH;
    this.pos.y = this.terrainH;

    if (!instant) {
      this.mesh.scale.set(1, 0.06, 1);
      this.mesh.position.y = this.terrainH - def.height * 0.35;
    }

    // block the grid under the footprint
    const [hw, hd] = def.footprint;
    game.grid.stampRect(x, z, hw * 0.92, hd * 0.92, { blocked: true, id: this.id });

    if (node) node.extractor = this;
    if (bottle) game.map.consumeBottle(bottle);

    // sensible default rally: a few units toward the middle of the desk
    const dir = owner === 0 ? 1 : -1;
    this.defaultRally = { x: x + dir * (hw + 6), z };
  }

  get isBuilding() { return true; }
  get productionSpeed() {
    return this.game.players[this.owner].mods.trainSpeed;
  }
  get rallyPoint() { return this.rally || this.defaultRally; }

  /* ═════════════════ construction ═════════════════ */
  advanceConstruction(dt) {
    const mods = this.game.players[this.owner].mods;
    const rate = mods.buildSpeed / this.def.buildTime;
    this.progress = clamp01(this.progress + rate * dt);
    this.hp = Math.max(this.hp, this.maxHp * (0.08 + 0.92 * this.progress));

    const s = 0.06 + 0.94 * this.progress;
    this.mesh.scale.set(1, s, 1);
    this.mesh.position.y = this.terrainH - this.def.height * 0.35 * (1 - this.progress);

    if (Math.random() < dt * 3.5) {
      const [hw, hd] = this.def.footprint;
      this.game.fx.emit(this.pos.x + frand(-hw, hw), 0.4, this.pos.z + frand(-hd, hd), {
        count: 1, color: 0xd8cbb0, size: 1.6, life: 0.6, speed: 2.5, gravity: 2, up: 1,
      });
    }

    if (this.progress >= 1) this.finish();
  }

  finish() {
    this.built = true;
    this.progress = 1;
    this.mesh.scale.set(1, 1, 1);
    this.mesh.position.y = this.terrainH;
    this.hp = this.maxHp;
    const [hw, hd] = this.def.footprint;
    this.game.fx.buildPuff(this.pos.x, this.pos.z, Math.max(hw, hd));
    this.game.players[this.owner].onBuildingFinished(this);
    this.game.events.emit(EV.BUILDING_COMPLETE, { building: this });
    if (this.owner === this.game.humanId) this.game.audio.play('complete');
  }

  /* ═════════════════ production ═════════════════ */
  canQueue(unitId) {
    if (!this.built) return false;
    if (!this.def.produces?.includes(unitId)) return false;
    return true;
  }

  queueUnit(unitId) {
    const def = getUnitDef(unitId);
    if (!def || !this.canQueue(unitId)) return false;
    const player = this.game.players[this.owner];
    if (this.queue.length >= 8) return false;
    if (player.popUsed + def.pop > player.popCap) {
      if (this.owner === this.game.humanId) {
        this.game.events.emit(EV.ALERT, { text: 'Population capped — build a Desk Tray', kind: 'warn' });
        this.game.audio.play('deny');
      }
      return false;
    }
    if (!player.trySpend(def.cost)) {
      if (this.owner === this.game.humanId) {
        this.game.events.emit(EV.ALERT, { text: `Not enough resources for ${def.name}`, kind: 'warn' });
        this.game.audio.play('deny');
      }
      return false;
    }
    this.queue.push({ id: unitId, remaining: def.buildTime, total: def.buildTime });
    player.reservePop(def.pop);
    this.game.events.emit(EV.QUEUE_CHANGED, { building: this });
    if (this.owner === this.game.humanId) this.game.audio.play('build');
    return true;
  }

  cancelQueue(index = this.queue.length - 1) {
    if (index < 0 || index >= this.queue.length) return;
    const item = this.queue.splice(index, 1)[0];
    const def = getUnitDef(item.id);
    const player = this.game.players[this.owner];
    player.refund(def.cost);
    player.reservePop(-def.pop);
    this.game.events.emit(EV.QUEUE_CHANGED, { building: this });
  }

  tickProduction(dt) {
    if (!this.queue.length) return;
    const job = this.queue[0];
    job.remaining -= dt * this.productionSpeed;
    if (job.remaining > 0) return;

    const def = getUnitDef(job.id);
    const spot = this.spawnSpot(def);
    const unit = this.game.spawnUnit(job.id, this.owner, spot.x, spot.z);
    this.queue.shift();
    this.game.players[this.owner].reservePop(-def.pop);

    if (unit) {
      const r = this.rallyPoint;
      if (Math.hypot(r.x - spot.x, r.z - spot.z) > 3) {
        unit.issue({ type: ORDER.MOVE, x: r.x, z: r.z });
      }
      if (this.owner === this.game.humanId) this.game.audio.play('unitReady');
    }
    this.game.events.emit(EV.QUEUE_CHANGED, { building: this });
  }

  spawnSpot(def) {
    const [hw, hd] = this.def.footprint;
    const r = this.rallyPoint;
    const ang = Math.atan2(r.z - this.pos.z, r.x - this.pos.x);
    const out = Math.max(hw, hd) + (def.radius || 1) + 1.6;
    for (let i = 0; i < 10; i++) {
      const a = ang + (i % 2 === 0 ? 1 : -1) * Math.ceil(i / 2) * 0.55;
      const x = this.pos.x + Math.cos(a) * out;
      const z = this.pos.z + Math.sin(a) * out;
      if (def.air) return { x, z };
      if (!this.game.grid.blockedAt(x, z) && this.game.map.inBounds(x, z, 2)) return { x, z };
    }
    const [fx, fz] = this.game.grid.nearestFree(this.pos.x + Math.cos(ang) * out, this.pos.z + Math.sin(ang) * out);
    return { x: fx, z: fz };
  }

  /* ═════════════════ research ═════════════════ */
  /**
   * Upgrades are researched at the structure that owns them: pencil lines at
   * the Pencil Case Factory, pen lines at the Ink Works, logistics at the HQ,
   * folds at the Hangar, and everything advanced at the Surface Pro Lab.
   */
  canResearch(techId) {
    if (!this.built || this.research || !this.alive) return false;
    const def = TECHS[techId];
    return !!def && def.building === this.def.id;
  }

  startResearch(techId) {
    if (!this.canResearch(techId)) return false;
    const player = this.game.players[this.owner];
    const def = TECHS[techId];
    if (!player.trySpend(def.cost)) {
      if (this.owner === this.game.humanId) {
        this.game.events.emit(EV.ALERT, { text: `Not enough resources for ${def.name}`, kind: 'warn' });
        this.game.audio.play('deny');
      }
      return false;
    }
    this.research = new ResearchJob(def, player.mods.buildSpeed);
    this.game.events.emit(EV.TECH_STARTED, { player: this.owner, tech: techId });
    if (this.owner === this.game.humanId) this.game.audio.play('build');
    return true;
  }

  tickResearch(dt) {
    if (!this.research) return;
    if (this.research.tick(dt)) {
      const def = this.research.def;
      this.research = null;
      this.game.players[this.owner].completeTech(def.id);
    }
  }

  /* ═════════════════ rally ═════════════════ */
  setRally(x, z) {
    this.rally = { x, z };
    if (!this.rallyMesh) {
      this.rallyMesh = rallyFlag(TEAM_COLORS[this.owner].accent);
      this.game.entityRoot.add(this.rallyMesh);
    }
    this.rallyMesh.position.set(x, this.game.grid.heightAt(x, z), z);
    this.rallyMesh.visible = this.selected;
  }

  setSelected(on) {
    super.setSelected(on);
    if (this.rallyMesh) this.rallyMesh.visible = on;
  }

  /* ═════════════════ frame ═════════════════ */
  update(dt) {
    this.tickStatuses(dt);
    if (!this.alive) return;

    if (!this.built) { this.advanceConstruction(dt); return; }
    if (this.hasStatus(STATUS.DISABLED)) {
      if (Math.random() < dt * 6) {
        this.game.fx.spark(this.pos.x + frand(-3, 3), this.def.height * 0.8, this.pos.z + frand(-3, 3), 0xffe066);
      }
      return;
    }

    this.tickProduction(dt);
    this.tickResearch(dt);

    if (this.def.attack) this._defend(dt);
    this._animate(dt);
  }

  _defend(dt) {
    this.cooldown -= dt;
    this.acquireTimer = (this.acquireTimer || 0) - dt;
    if (this.acquireTimer <= 0) {
      this.acquireTimer = 0.3;
      const combat = this.game.combat;
      const range = combat.rangeFor(this);
      const me = this;
      let best = null, bd = Infinity;
      this.game.spatial.forEachNear(this.pos.x, this.pos.z, range + 4, (e) => {
        if (!combat.canTarget(me, e)) return;
        const d = me.distanceTo(e);
        if (d > range + (e.def.radius || 1)) return;
        // prefer whatever is closest to the structure we are guarding
        if (d < bd) { bd = d; best = e; }
      });
      this.target = best;
    }
    const t = this.target;
    if (t && t.alive && this.game.combat.inRange(this, t)) {
      if (this.turret) aimTurret(this.turret, this.pos, t.pos, dt, 4.5);
      if (this.cooldown <= 0) this.game.combat.fire(this, t);
    }
  }

  _animate(dt) {
    const model = this.mesh.userData.model;
    if (!model) return;
    if (model.userData.drum) model.userData.drum.rotation.x += dt * 2.2;
    if (model.userData.screen && this.def.research) {
      const busy = this.research ? 1 : 0.55;
      model.userData.screen.material = model.userData.screen.material;
      model.userData.screen.material.emissiveIntensity =
        damp(model.userData.screen.material.emissiveIntensity ?? 0.8, busy + Math.sin(this.game.time * 4) * 0.12, 4, dt);
    }
    if (model.userData.dart) {
      model.userData.dart.position.y = 2.1 + Math.sin(this.game.time * 1.5) * 0.12;
    }
  }

  /* ═════════════════ death ═════════════════ */
  onDeath(killer) {
    const game = this.game;
    const [hw, hd] = this.def.footprint;

    // refund whatever was still in the queue
    while (this.queue.length) this.cancelQueue(0);
    if (this.research) {
      game.players[this.owner].refund(this.research.def.cost);
      this.research = null;
    }

    game.grid.clearRect(this.pos.x, this.pos.z, hw * 0.92, hd * 0.92, this.id);
    if (this.node) this.node.extractor = null;
    game.players[this.owner].onBuildingLost(this);

    game.fx.explosion(this.pos.x, 1.5, this.pos.z, Math.max(hw, hd) * 1.35, 0xff8a3c);
    for (let i = 0; i < 4; i++) {
      game.fx.emit(this.pos.x + frand(-hw, hw), frand(0.5, 3), this.pos.z + frand(-hd, hd), {
        count: 5, color: 0x50565f, size: 3.2, life: 1.5, speed: 4, gravity: -3, drag: 2.4, up: 1,
      });
    }
    game.fx.decal(this.pos.x, this.pos.z, Math.max(hw, hd) * 1.2, 0x14110e, 20, null, 0.55);
    game.audio.play('buildingDown');
    game.controls.shake(0.35);

    if (this.rallyMesh) { game.entityRoot.remove(this.rallyMesh); this.rallyMesh = null; }
    game.fx.addCorpse(this.mesh, 0);
    if (this._ring) this._ring.visible = false;
    game.events.emit(EV.BUILDING_DESTROYED, { building: this, killer });
  }

  /** Player-initiated demolition — hands back some of the cost. */
  salvage() {
    const player = this.game.players[this.owner];
    const back = {};
    for (const [k, v] of Object.entries(this.def.cost)) back[k] = v * BALANCE.SALVAGE_REFUND;
    player.refund(back);
    this.die(null);
  }
}
