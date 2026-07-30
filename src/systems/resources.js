/**
 * Player state and the economy tick.
 *
 * Income comes from two places: the HQ's built-in trickle and Harvester
 * Clamps sitting on desk nodes. Multipliers stack in this order:
 *   node richness × tech-tree logistics upgrade × difficulty handicap
 */
import { RES, POP, TEAM_COLORS } from '../core/constants.js';
import { freshMods, TECHS } from './techTree.js';
import { EV } from '../core/events.js';
import { clamp } from '../core/utils.js';

export class PlayerState {
  constructor(game, id, { isAI = false, name = 'Player', economyMul = 1, start = {} } = {}) {
    this.game = game;
    this.id = id;
    this.isAI = isAI;
    this.name = name;
    this.color = TEAM_COLORS[id];
    this.economyMul = economyMul;

    this.res = { paper: 0, ink: 0, battery: 0, graphite: 0, ...start };
    this.rate = { paper: 0, ink: 0, battery: 0, graphite: 0 };
    this.spentTotal = { paper: 0, ink: 0, battery: 0, graphite: 0 };

    this.units = new Set();
    this.buildings = new Set();
    this.tech = new Set();
    this.mods = freshMods();

    this.popUsed = 0;
    this.popReserved = 0;
    this.popCap = POP.START_CAP;

    this.defeated = false;
    this.stats = {
      kills: 0, losses: 0, unitsBuilt: 0, buildingsBuilt: 0,
      buildingsLost: 0, damage: 0, harvested: 0, peakArmy: 0,
    };
    this.controlSeconds = 0;
  }

  /* ── money ────────────────────────────────────────────────────────── */
  canAfford(cost) {
    for (const k of RES) if ((cost[k] || 0) > this.res[k] + 1e-6) return false;
    return true;
  }

  missingFor(cost) {
    const out = [];
    for (const k of RES) if ((cost[k] || 0) > this.res[k] + 1e-6) out.push(k);
    return out;
  }

  trySpend(cost) {
    if (!this.canAfford(cost)) return false;
    for (const k of RES) {
      const v = cost[k] || 0;
      if (!v) continue;
      this.res[k] -= v;
      this.spentTotal[k] += v;
    }
    this.game.events.emit(EV.RESOURCE_CHANGED, { player: this.id, delta: cost, sign: -1 });
    return true;
  }

  refund(cost) {
    for (const k of RES) {
      const v = cost[k] || 0;
      if (v) this.res[k] += v;
    }
    this.game.events.emit(EV.RESOURCE_CHANGED, { player: this.id, delta: cost, sign: 1 });
  }

  grant(res) {
    for (const k of RES) if (res[k]) this.res[k] += res[k];
  }

  /* ── population ───────────────────────────────────────────────────── */
  get popTotal() { return this.popUsed + this.popReserved; }
  reservePop(n) { this.popReserved = Math.max(0, this.popReserved + n); }

  recomputePop() {
    let used = 0;
    for (const u of this.units) used += u.def.pop || 0;
    this.popUsed = used;
    let cap = POP.START_CAP;
    for (const b of this.buildings) if (b.built && b.def.popBonus) cap += b.def.popBonus;
    this.popCap = Math.min(POP.MAX, cap);
  }

  /* ── rosters ──────────────────────────────────────────────────────── */
  addUnit(u) { this.units.add(u); this.stats.unitsBuilt++; this.recomputePop(); }

  onUnitLost(u) {
    this.units.delete(u);
    this.stats.losses++;
    this.recomputePop();
  }

  addBuilding(b) { this.buildings.add(b); }

  onBuildingFinished(b) {
    this.stats.buildingsBuilt++;
    this.recomputePop();
  }

  onBuildingLost(b) {
    this.buildings.delete(b);
    this.stats.buildingsLost++;
    this.recomputePop();
  }

  hasFinishedBuilding(id) {
    for (const b of this.buildings) if (b.built && b.def.id === id && b.alive) return true;
    return false;
  }

  countBuildings(id, includeUnfinished = true) {
    let n = 0;
    for (const b of this.buildings) {
      if (b.def.id !== id || !b.alive) continue;
      if (!includeUnfinished && !b.built) continue;
      n++;
    }
    return n;
  }

  findBuildings(id) {
    const out = [];
    for (const b of this.buildings) if (b.def.id === id && b.alive) out.push(b);
    return out;
  }

  countUnits(id) {
    let n = 0;
    for (const u of this.units) if (u.def.id === id) n++;
    return n;
  }

  get hq() {
    for (const b of this.buildings) if (b.def.id === 'hq' && b.alive) return b;
    return null;
  }

  /** Total resource value of the standing army — the AI's push metric. */
  armyValue() {
    let v = 0;
    for (const u of this.units) {
      if (!u.def.attack && !u.def.heal) continue;
      const c = u.def.cost;
      v += (c.paper || 0) + (c.ink || 0) * 1.6 + (c.battery || 0) * 4.2;
    }
    if (v > this.stats.peakArmy) this.stats.peakArmy = v;
    return v;
  }

  /* ── tech ─────────────────────────────────────────────────────────── */
  completeTech(id) {
    if (this.tech.has(id)) return;
    const def = TECHS[id];
    this.tech.add(id);
    def.apply(this.mods);

    // health upgrades apply retroactively to what is already alive
    if (def.id === 'coloredPencils' || def.id === 'aerodynamics') {
      for (const u of this.units) {
        const mul = this.mods.hp[u.def.family] || 1;
        const target = u.def.hp * mul;
        if (target > u.maxHp) {
          const frac = u.hp / u.maxHp;
          u.maxHp = target;
          u.hp = target * frac;
        }
      }
    }
    if (def.id === 'reinforcedTape') {
      for (const b of this.buildings) {
        const target = b.def.hp * this.mods.buildingHp * (b.onBottle ? 1.25 : 1);
        const frac = b.hp / b.maxHp;
        b.maxHp = target;
        b.hp = target * frac;
      }
    }

    this.game.events.emit(EV.TECH_DONE, { player: this.id, tech: id });
    if (this.id === this.game.humanId) {
      this.game.audio.play('research');
      this.game.events.emit(EV.ALERT, { text: `${def.name} researched`, kind: 'good' });
    }
  }

  researchingTech() {
    for (const b of this.buildings) if (b.research) return b.research;
    return null;
  }
}

/* ─────────────────────────────────────────────────────────────────────
   Economy tick
   ───────────────────────────────────────────────────────────────────── */
export class ResourceSystem {
  constructor(game) {
    this.game = game;
    this.acc = 0;
  }

  update(dt) {
    for (const player of this.game.players) {
      if (!player || player.defeated) continue;
      const rate = { paper: 0, ink: 0, battery: 0, graphite: 0 };

      for (const b of player.buildings) {
        if (!b.built || !b.alive || b.hasStatus('disabled')) continue;
        if (b.def.income) {
          for (const k of RES) if (b.def.income[k]) rate[k] += b.def.income[k];
        }
        if (b.node) rate[b.node.type] += b.node.yield;
      }

      for (const k of RES) {
        rate[k] *= player.mods.income[k] * player.economyMul;
        player.res[k] += rate[k] * dt;
        player.stats.harvested += rate[k] * dt;
      }
      player.rate = rate;
    }
  }
}

/** Nicely formatted "12 paper · 3 ink" style cost string data. */
export function costEntries(cost) {
  return RES.filter((k) => (cost[k] || 0) > 0).map((k) => [k, Math.round(cost[k])]);
}

export function scaleCost(cost, mul) {
  const out = {};
  for (const k of RES) if (cost[k]) out[k] = cost[k] * mul;
  return out;
}

export const clampRes = (v) => clamp(v, 0, 999999);
