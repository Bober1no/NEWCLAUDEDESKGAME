/**
 * The opposing commander.
 *
 * Structure: a sense pass builds a picture of the desk, then four planners
 * (economy, construction, production, research) spend resources, and a
 * military planner moves the army. Difficulty is not a reaction-time slider
 * bolted onto one brain — each preset changes:
 *
 *   think        how often the whole loop runs
 *   economy      a straight income handicap
 *   aggression   push threshold, harassment, how far it commits
 *   tech         whether it bothers with upgrades and air at all
 *   micro        0 none · 1 retreat wounded · 2 focus fire + siege discipline
 *   counterBuild how strongly scouting feeds back into unit composition
 *
 * On Easy the AI builds a couple of extractors, masses pencils and walks at
 * you. On Hard it takes six nodes, opens an Ink Works, scouts your factories,
 * builds the counters to what it sees, harasses your extractors with scouts
 * while its main army pushes, and pulls wounded units out of the line.
 */
import { ORDER, VICTORY, POP, RES } from '../core/constants.js';
import { clamp, clamp01, frand, TAU, removeFrom } from '../core/utils.js';
import { ALL_UNITS, COUNTERS, getUnitDef, getBuildingDef } from '../entities/registry.js';
import { TECHS, techAvailable } from '../systems/techTree.js';
import { BUILDINGS } from '../entities/buildings.js';

/* Composition targets per difficulty tier: unit id → weight. */
const COMPOSITIONS = {
  low: { grunt: 0.52, lancer: 0.20, scout: 0.10, medic: 0.08, clipShield: 0.10 },
  mid: {
    grunt: 0.26, lancer: 0.14, clipShield: 0.10, medic: 0.08, scissor: 0.06,
    highlighter: 0.12, glue: 0.08, compass: 0.06, catapult: 0.06, breacher: 0.04,
  },
  high: {
    grunt: 0.18, lancer: 0.10, clipShield: 0.09, medic: 0.07, scissor: 0.07,
    highlighter: 0.10, glue: 0.08, compass: 0.08, catapult: 0.07, breacher: 0.06,
    radar: 0.03, dart: 0.04, heavyWing: 0.03,
  },
};

const TECH_PRIORITY = [
  'bulkReams', 'mechanicalPencil', 'prefabFolding', 'gelPen', 'inkSiphon',
  'sharpenedEdges', 'reinforcedTape', 'graphiteGrind', 'coloredPencils',
  'fieldKits', 'tallerStacks', 'fountainPen', 'powerCells', 'radarArray',
  'adhesivePolymer', 'aerodynamics', 'heavyFolds',
];

export class AIController {
  constructor(game, playerId, preset) {
    this.game = game;
    this.id = playerId;
    this.preset = preset;
    this.p = game.players[playerId];
    this.enemyId = 1 - playerId;

    this.thinkTimer = frand(0, preset.think);
    this.slowTimer = 0;
    this.scoutTimer = 12;
    this.harassTimer = 40;
    // Opening grace: even Hard should not be knocking on the door at 0:25.
    this.attackCooldown = 95 - preset.aggression * 35;

    this.squads = { main: [], defense: [], harass: [] };
    this.state = 'build';            // build | massing | attacking | defending
    this.attackTarget = null;
    this.stagingPoint = null;
    this.seenEnemy = new Map();      // unit id → count last scouted
    this.lastScoutAt = 0;
    this.threat = 0;
    this.log = [];

    const base = game.baseSpot(playerId);
    this.base = base;
    this.rally = { x: base.x + (playerId === 0 ? 18 : -18), z: base.z };
    this.desired = this._desiredStructures();
  }

  /* ═════════════════ frame ═════════════════ */
  update(dt) {
    if (this.p.defeated || this.game.victory.over) return;
    this.thinkTimer -= dt;
    this.slowTimer -= dt;

    // squad upkeep is cheap and wants to be smooth
    this.stepSquads(dt);

    if (this.thinkTimer > 0) return;
    this.thinkTimer = this.preset.think;

    this.sense();
    this.military();

    if (this.slowTimer <= 0) {
      this.slowTimer = Math.max(0.8, this.preset.think * 2.2);
      this.economy();
      this.construction();
      this.production();
      this.research();
      this.scouting();
    }
  }

  /* ═════════════════ sense ═════════════════ */
  sense() {
    const game = this.game;
    const enemy = game.players[this.enemyId];

    this.armyValue = this.p.armyValue();
    this.enemyArmyValue = enemy.armyValue();
    this.income = this.p.rate;

    // threat: enemy strength inside our half / near our buildings
    let threat = 0;
    let threatX = 0, threatZ = 0, tw = 0;
    for (const b of this.p.buildings) {
      if (!b.alive) continue;
      game.spatial.forEachNear(b.pos.x, b.pos.z, 42, (e) => {
        if (!e.alive || e.owner !== this.enemyId || !e.isUnit) return;
        const d = b.distanceTo(e);
        if (d > 42) return;
        const w = (e.def.attack ? e.def.attack.damage : 6) * (1 - d / 60);
        threat += w;
        threatX += e.pos.x * w; threatZ += e.pos.z * w; tw += w;
      });
    }
    this.threat = threat;
    this.threatPoint = tw > 0 ? { x: threatX / tw, z: threatZ / tw } : null;

    // what have we seen of theirs recently?
    if (this.preset.counterBuild > 0) {
      for (const u of enemy.units) {
        if (!game.fog.isVisible(this.id, u.pos.x, u.pos.z)) continue;
        this.seenEnemy.set(u.def.id, (this.seenEnemy.get(u.def.id) || 0) + 1);
      }
      // decay so old intel stops steering the build
      if (this.seenEnemy.size) {
        for (const [k, v] of this.seenEnemy) {
          const nv = v * 0.92;
          if (nv < 0.4) this.seenEnemy.delete(k); else this.seenEnemy.set(k, nv);
        }
      }
    }
  }

  /* ═════════════════ economy ═════════════════ */
  _desiredStructures() {
    const a = this.preset;
    const tier = a.tech;
    return {
      extractor: 2 + Math.round(a.economy * 3.2),
      infantry: 1 + (tier > 0.4 ? 1 : 0) + (tier > 0.75 ? 1 : 0),
      ink: tier > 0.35 ? 1 + (tier > 0.8 ? 1 : 0) : 0,
      siege: tier > 0.45 ? 1 : 0,
      tech: tier > 0.5 ? 1 : 0,
      hangar: tier > 0.72 ? 1 : 0,
      tower: Math.round(a.aggression < 0.5 ? 2 : 1) + (tier > 0.6 ? 1 : 0),
      flak: tier > 0.6 ? 1 : 0,
    };
  }

  economy() {
    // keep population headroom
    const headroom = this.p.popCap - this.p.popTotal;
    if (headroom < 6 && this.p.popCap < POP.MAX && !this._isBuilding('tray')) {
      this.tryBuild('tray');
    }
  }

  /**
   * Un-claimed nodes it could actually clamp onto right now, best first.
   *
   * Reachability matters as much as value: a Harvester Clamp still has to
   * land inside the build radius of something the AI already owns, so the
   * juicy centre battery is worthless until the base has crept toward it.
   * Returning a list (rather than one pick) lets the caller fall through to
   * the next candidate when units are standing on the best one.
   */
  freeNodesByValue(limit = 4) {
    const game = this.game;
    const enemyBase = game.baseSpot(this.enemyId);
    const scored = [];

    for (const node of game.map.nodes) {
      if (node.extractor && node.extractor.alive) continue;
      const dHome = Math.hypot(node.x - this.base.x, node.z - this.base.z);
      const dEnemy = Math.hypot(node.x - enemyBase.x, node.z - enemyBase.z);
      // Demand-driven: a node is worth more when the bank is empty of that
      // resource. Without this the AI happily sits on 7000 paper and 20 ink
      // because it only ever expanded onto the nearest paper stack.
      const base = { paper: 1.25, ink: 1.15, graphite: 1.0, battery: 1.1 }[node.type] || 1;
      const starved = clamp01(1 - this.p.res[node.type] / 700);
      const typeWeight = base * (0.7 + 1.9 * starved);
      const risk = clamp01(1 - dEnemy / 150);
      const score = typeWeight * node.richness * 100
        - dHome * 1.15
        - risk * 90 * (1.25 - this.preset.aggression);
      scored.push({ node, score });
    }

    scored.sort((a, b) => b.score - a.score);
    const out = [];
    for (const { node } of scored) {
      if (game.canPlaceBuilding('extractor', this.id, node.x, node.z, { node }).ok) {
        out.push(node);
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  bestFreeNode() { return this.freeNodesByValue(1)[0] || null; }

  /* ═════════════════ construction ═════════════════ */

  /** Ordered list of what this AI wants next, highest priority first. */
  buildWishlist() {
    const d = this.desired;
    const have = (id) => this.p.countBuildings(id);
    const wish = [];

    // 1. economy first — extractors pay for everything else
    if (have('extractor') < d.extractor) wish.push({ id: 'extractor', onNode: true });
    // 2. a way to make troops at all
    if (have('infantry') < 1) wish.push({ id: 'infantry' });
    // 3. supply before the queue jams against the cap
    if (this.p.popCap - this.p.popTotal < 8 && this.p.popCap < POP.MAX) wish.push({ id: 'tray' });
    // 4. tech buildings, in the order this preset cares about them
    for (const id of ['ink', 'siege', 'tech', 'hangar']) {
      if (have(id) < (d[id] || 0)) wish.push({ id });
    }
    // 5. more production capacity
    if (have('infantry') < d.infantry) wish.push({ id: 'infantry' });
    if (have('ink') < d.ink) wish.push({ id: 'ink' });
    // 6. static defence, weighted by how turtly this preset is
    if (this.game.time > 120 || this.threat > 40) {
      if (have('tower') < d.tower) wish.push({ id: 'tower' });
      if (this._enemyHasAir() && have('flak') < d.flak) wish.push({ id: 'flak' });
    }
    // 7. late game: keep creeping outward onto more nodes
    if (this.game.time > 200 && have('extractor') < d.extractor + 3) {
      wish.push({ id: 'extractor', onNode: true });
    }
    return wish;
  }

  /**
   * Walk the wishlist and start the first thing that is both affordable and
   * placeable. Crucially, the first thing it *cannot* yet afford becomes
   * `savingFor` — production reads that and stops spending the bank down to
   * zero on pencils, which is otherwise the reason an RTS AI never reaches
   * its second factory.
   */
  construction() {
    const wish = this.buildWishlist();
    const canStart = this._underConstruction() < this.preset.maxSimulBuilds;
    this.savingFor = null;

    for (const w of wish) {
      const def = getBuildingDef(w.id);
      if (!def) continue;
      if (def.requires && def.requires.some((r) => !this.p.hasFinishedBuilding(r))) continue;

      if (!this.p.canAfford(def.cost)) {
        this.savingFor = { id: w.id, cost: def.cost };
        break;
      }
      if (!canStart) break;

      if (w.onNode) {
        for (const node of this.freeNodesByValue(3)) {
          if (this.tryBuild('extractor', node.x, node.z, { node })) return;
        }
        continue;   // nothing reachable right now — try the next wish
      }
      if (this.tryBuild(w.id)) return;
    }
  }

  _underConstruction() {
    let n = 0;
    for (const b of this.p.buildings) if (b.alive && !b.built) n++;
    return n;
  }

  _isBuilding(id) {
    for (const b of this.p.buildings) if (b.alive && !b.built && b.def.id === id) return true;
    return false;
  }

  _enemyHasAir() {
    for (const [id, n] of this.seenEnemy) if (ALL_UNITS[id]?.air && n > 0.5) return true;
    const enemy = this.game.players[this.enemyId];
    for (const u of enemy.units) if (u.def.air) return true;   // AI gets a whiff of it
    return false;
  }

  tryBuild(id, atX = null, atZ = null, opts = {}) {
    const def = getBuildingDef(id);
    if (!def) return false;
    if (!this.p.canAfford(def.cost)) return false;
    if (def.requires) {
      for (const r of def.requires) if (!this.p.hasFinishedBuilding(r)) return false;
    }

    const spot = atX != null
      ? this._validateSpot(id, atX, atZ, opts)
      : this._findSpot(id, opts);
    if (!spot) return false;

    const b = this.game.placeBuilding(id, this.id, spot.x, spot.z, { ...opts, ...spot.opts });
    if (b) this.log.push(`${Math.round(this.game.time)}s build ${id}`);
    return !!b;
  }

  _validateSpot(id, x, z, opts) {
    const check = this.game.canPlaceBuilding(id, this.id, x, z, opts);
    if (check.ok) return { x, z, opts: {} };
    // nudge around the target a little before giving up
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU;
      const r = 4 + i * 0.8;
      const nx = x + Math.cos(a) * r, nz = z + Math.sin(a) * r;
      if (this.game.canPlaceBuilding(id, this.id, nx, nz, opts).ok) return { x: nx, z: nz, opts: {} };
    }
    return null;
  }

  /** Spiral out from the HQ looking for legal ground. */
  _findSpot(id, opts) {
    const hq = this.p.hq;
    const cx = hq ? hq.pos.x : this.base.x;
    const cz = hq ? hq.pos.z : this.base.z;
    const inward = this.id === 0 ? 1 : -1;

    // towers want to sit between the base and the enemy, ideally on a bottle
    if (id === 'tower') {
      const bottle = this.game.map.nearestBottle(cx + inward * 26, cz, 40);
      if (bottle && this.game.canPlaceBuilding(id, this.id, bottle.x, bottle.z, { bottle }).ok) {
        return { x: bottle.x, z: bottle.z, opts: { bottle } };
      }
    }

    const bias = (id === 'tower' || id === 'flak') ? inward * 22 : inward * 6;
    for (let ring = 1; ring <= 12; ring++) {
      const r = 12 + ring * 5.5;
      const n = 8 + ring * 2;
      const phase = frand(0, TAU);
      for (let i = 0; i < n; i++) {
        const a = phase + (i / n) * TAU;
        const x = cx + bias + Math.cos(a) * r;
        const z = cz + Math.sin(a) * r;
        if (this.game.canPlaceBuilding(id, this.id, x, z, opts).ok) return { x, z, opts: {} };
      }
    }
    return null;
  }

  /* ═════════════════ production ═════════════════ */
  composition() {
    const tier = this.preset.tech;
    const base = tier < 0.4 ? COMPOSITIONS.low : tier < 0.72 ? COMPOSITIONS.mid : COMPOSITIONS.high;
    const comp = { ...base };

    // counter-build: bias toward the answers to whatever we have scouted
    const cb = this.preset.counterBuild;
    if (cb > 0 && this.seenEnemy.size) {
      let total = 0;
      for (const v of this.seenEnemy.values()) total += v;
      for (const [seenId, n] of this.seenEnemy) {
        const answers = COUNTERS[seenId];
        if (!answers) continue;
        const share = (n / total) * cb * 0.9;
        for (const a of answers) {
          if (comp[a] == null && !this._canTrain(a)) continue;
          comp[a] = (comp[a] || 0.02) + share / answers.length;
        }
      }
    }

    // if they are flying, make sure something can shoot up
    if (this._enemyHasAir()) {
      comp.scissor = (comp.scissor || 0.05) + 0.10;
      comp.compass = (comp.compass || 0.05) + 0.08;
    }
    return comp;
  }

  _canTrain(unitId) {
    const def = getUnitDef(unitId);
    if (!def) return false;
    return this.p.hasFinishedBuilding(def.factory) || def.factory === 'hq';
  }

  production() {
    const comp = this.composition();
    const factories = [];
    for (const b of this.p.buildings) {
      if (b.alive && b.built && b.def.produces?.length && b.queue.length < 3) factories.push(b);
    }
    if (!factories.length) return;

    // headroom check — do not deadlock the queue against the pop cap
    if (this.p.popCap - this.p.popTotal < 2) return;

    // Hold back whatever construction is saving for — unless we are under
    // attack or have nothing to fight with, in which case units come first.
    // Bank for the next structure unless we are actually under attack or have
    // nothing at all to fight with. Once a build is most of the way funded we
    // keep saving regardless, or the AI perpetually re-buys line infantry and
    // never reaches its tech lab.
    const nearlyFunded = this.savingFor
      && RES.every((k) => !(this.savingFor.cost[k] > 0) || this.p.res[k] >= this.savingFor.cost[k] * 0.6);
    const reserve = (this.savingFor && this.threat < 40 && this.bankableSoon(this.savingFor.cost, 30)
      && (this.armyValue > 150 || nearlyFunded))
      ? this.savingFor.cost : null;
    const affordable = (cost, extra = null) => {
      for (const k of RES) {
        const need = cost[k] || 0;
        if (!need) continue;
        const held = (reserve ? (reserve[k] || 0) : 0) + (extra ? (extra[k] || 0) : 0);
        if (need > this.p.res[k] - held) return false;
      }
      return true;
    };

    const counts = {};
    let total = 0;
    for (const u of this.p.units) { counts[u.def.id] = (counts[u.def.id] || 0) + 1; total++; }
    total = Math.max(total, 1);

    const budgetPasses = 1 + Math.round(this.preset.economy * 2);

    for (let pass = 0; pass < budgetPasses; pass++) {
      // Rank by how far behind the composition target each unit is, ignoring
      // price. Cost only decides *when* we buy, never *what* we want.
      const ranked = [];
      for (const [id, weight] of Object.entries(comp)) {
        if (weight <= 0) continue;
        const def = getUnitDef(id);
        if (!def) continue;
        const factory = factories.find((f) => f.def.produces.includes(id) && f.queue.length < 3);
        if (!factory) continue;
        if (this.p.popTotal + def.pop > this.p.popCap) continue;
        ranked.push({ id, def, factory, deficit: weight - (counts[id] || 0) / total });
      }
      if (!ranked.length) break;
      ranked.sort((a, b) => b.deficit - a.deficit);

      /*
       * Every unit costs paper, so a naive "buy the best thing I can afford
       * right now" loop buys nothing but Pencil Grunts forever: paper never
       * gets the chance to climb past 55. Reserving the top pick's cost from
       * everything cheaper lets the bank actually reach a Highlighter.
       */
      let unitReserve = null;
      let unitReserveReachable = false;
      let queued = false;
      // If we have been saving for the same thing for a while without ever
      // affording it (no income in that resource, say), stop holding out.
      const stubborn = this._saveTicks > 8;
      for (const cand of ranked) {
        // Skip the cheap filler only while the thing we actually want is
        // within reach; otherwise we would stockpile forever waiting on a
        // resource nothing is producing.
        if (unitReserve && unitReserveReachable && cand.deficit <= 0 && !stubborn) continue;
        if (affordable(cand.def.cost, unitReserve)) {
          if (!cand.factory.queueUnit(cand.id)) break;
          counts[cand.id] = (counts[cand.id] || 0) + 1;
          total++;
          const r = this._rallyPoint();
          cand.factory.setRally(r.x, r.z);
          queued = true;
          break;
        }
        // first thing we want but cannot pay for becomes the savings target
        if (!unitReserve) {
          unitReserve = cand.def.cost;
          unitReserveReachable = this.bankableSoon(cand.def.cost, 25);
          this._savingUnit = cand.id;
        }
      }
      // a successful buy clears the stubbornness counter, so the AI alternates
      // between banking for its next real pick and topping up with cheap line
      // infantry instead of getting stuck in either mode
      if (queued) this._saveTicks = 0;
      else this._saveTicks = unitReserve ? (this._saveTicks || 0) + 1 : 0;
      if (!queued) break;
    }
  }

  /** Could we pay this within `seconds` at the current income? */
  bankableSoon(cost, seconds) {
    for (const k of RES) {
      const need = cost[k] || 0;
      if (!need) continue;
      if (need > this.p.res[k] + (this.p.rate[k] || 0) * seconds) return false;
    }
    return true;
  }

  _rallyPoint() {
    if (this.state === 'defending' && this.threatPoint) {
      return { x: this.threatPoint.x, z: this.threatPoint.z };
    }
    return this.stagingPoint || this.rally;
  }

  /* ═════════════════ research ═════════════════ */
  research() {
    if (this.preset.tech < 0.2) return;
    const labs = [];
    for (const b of this.p.buildings) {
      if (b.alive && b.built && !b.research && (b.def.research || b.def.id === 'hq' || b.def.produces)) labs.push(b);
    }
    if (!labs.length) return;
    if (this.p.researchingTech()) return;

    // Upgrades queue behind whatever construction is banking for, so a lab
    // never eats the paper earmarked for the next factory.
    const reserve = this.savingFor ? this.savingFor.cost : null;
    const spare = (cost) => {
      for (const k of RES) {
        const need = cost[k] || 0;
        if (need && need > this.p.res[k] - (reserve ? (reserve[k] || 0) : 0)) return false;
      }
      return true;
    };

    for (const id of TECH_PRIORITY) {
      if (!techAvailable(this.p, id)) continue;
      const def = TECHS[id];
      if (!spare(def.cost)) continue;
      const lab = labs.find((l) => l.def.id === def.building);
      if (!lab) continue;
      if (lab.startResearch(id)) return;
    }
  }

  /* ═════════════════ scouting ═════════════════ */
  scouting() {
    if (this.preset.scout < 0.15) return;
    this.scoutTimer -= Math.max(0.8, this.preset.think * 2.2);
    if (this.scoutTimer > 0) return;
    this.scoutTimer = 45 - this.preset.scout * 25;

    let scout = null;
    for (const u of this.p.units) {
      if ((u.def.id === 'scout' || u.def.id === 'glider') && !this.squads.harass.includes(u)) { scout = u; break; }
    }
    if (!scout) return;
    // sweep enemy nodes and their base
    const enemyBase = this.game.baseSpot(this.enemyId);
    const targets = this.game.map.nodes
      .filter((n) => Math.hypot(n.x - enemyBase.x, n.z - enemyBase.z) < 90)
      .slice(0, 3);
    scout.issue({ type: ORDER.MOVE, x: enemyBase.x, z: enemyBase.z });
    for (const t of targets) scout.issue({ type: ORDER.MOVE, x: t.x, z: t.z }, { queued: true });
    scout.issue({ type: ORDER.MOVE, x: this.rally.x, z: this.rally.z }, { queued: true });
  }

  /* ═════════════════ military ═════════════════ */
  military() {
    this.assignSquads();

    const defenceNeeded = this.threat > 25;
    if (defenceNeeded) {
      this.state = 'defending';
      this.defend();
      return;
    }

    if (this.state === 'defending') this.state = 'massing';

    this.attackCooldown -= this.preset.think;

    const pushValue = this.preset.armyPushValue * (this.game.victory.mode === VICTORY.CONTROL ? 0.7 : 1);
    const ready = this.armyValue >= pushValue ||
      (this.armyValue > this.enemyArmyValue * (1.35 - this.preset.aggression * 0.5) && this.armyValue > 700);

    if (this.state === 'attacking') {
      this.pressAttack();
    } else if (ready && this.attackCooldown <= 0) {
      this.launchAttack();
    } else {
      this.mass();
    }

    if (this.preset.aggression > 0.6) this.harass();
    if (this.preset.micro >= 1) this.microRetreat();
  }

  assignSquads() {
    const main = this.squads.main.filter((u) => u.alive);
    const harass = this.squads.harass.filter((u) => u.alive);
    const assigned = new Set([...main, ...harass]);

    for (const u of this.p.units) {
      if (assigned.has(u)) continue;
      if (!u.def.attack && !u.def.heal && !u.def.mark) continue;
      if (u.def.immobile) continue;
      main.push(u);
    }
    this.squads.main = main;
    this.squads.harass = harass;
  }

  squadValue(squad) {
    let v = 0;
    for (const u of squad) {
      const c = u.def.cost;
      v += (c.paper || 0) + (c.ink || 0) * 1.6 + (c.battery || 0) * 4.2;
    }
    return v;
  }

  squadCentre(squad) {
    if (!squad.length) return { x: this.rally.x, z: this.rally.z };
    let x = 0, z = 0;
    for (const u of squad) { x += u.pos.x; z += u.pos.z; }
    return { x: x / squad.length, z: z / squad.length };
  }

  mass() {
    this.state = 'massing';
    const r = this.rally;
    for (const u of this.squads.main) {
      if (u.order.type === ORDER.IDLE || (u.goal == null && u.order.type !== ORDER.ATTACK)) {
        const d = Math.hypot(u.pos.x - r.x, u.pos.z - r.z);
        if (d > 16) u.issue({ type: ORDER.ATTACK_MOVE, x: r.x + frand(-7, 7), z: r.z + frand(-9, 9) });
      }
    }
  }

  pickAttackTarget() {
    const enemy = this.game.players[this.enemyId];
    const centre = this.squadCentre(this.squads.main);
    let best = null, bestScore = -Infinity;

    const weigh = (b) => {
      let w = 40;
      if (b.def.id === 'hq') w = 90;
      else if (b.def.produces) w = 78;
      else if (b.node) w = 72;              // starving them is the AI's favourite play
      else if (b.def.attack) w = 30;
      else if (b.def.popBonus) w = 55;
      const d = Math.hypot(b.pos.x - centre.x, b.pos.z - centre.z);
      const soft = 1 + (1 - b.hp / b.maxHp) * 0.5;
      return w * soft - d * 0.55;
    };

    for (const b of enemy.buildings) {
      if (!b.alive) continue;
      const s = weigh(b);
      if (s > bestScore) { bestScore = s; best = b; }
    }
    return best;
  }

  launchAttack() {
    const target = this.pickAttackTarget();
    if (!target) return;
    this.attackTarget = target;
    this.state = 'attacking';
    this.attackCooldown = 60 - this.preset.aggression * 30;
    this.log.push(`${Math.round(this.game.time)}s attack ${target.def.id}`);

    const squad = this.squads.main;
    const centre = this.squadCentre(squad);
    const ang = Math.atan2(target.pos.z - centre.z, target.pos.x - centre.x);
    // stage just outside the target so the army arrives together
    this.stagingPoint = {
      x: target.pos.x - Math.cos(ang) * 34,
      z: target.pos.z - Math.sin(ang) * 34,
    };

    squad.forEach((u, i) => {
      const spread = this.preset.micro >= 2 && u.def.attack?.range > 18 ? 12 : 6;
      u.issue({
        type: ORDER.ATTACK_MOVE,
        x: this.stagingPoint.x + frand(-spread, spread),
        z: this.stagingPoint.z + frand(-spread, spread),
      });
      u.issue({ type: ORDER.ATTACK_MOVE, x: target.pos.x + frand(-6, 6), z: target.pos.z + frand(-6, 6) }, { queued: true });
    });
  }

  pressAttack() {
    const squad = this.squads.main;
    if (!squad.length) { this.state = 'massing'; this.stagingPoint = null; return; }

    let target = this.attackTarget;
    if (!target || !target.alive) {
      target = this.pickAttackTarget();
      this.attackTarget = target;
      if (!target) { this.state = 'massing'; return; }
      for (const u of squad) u.issue({ type: ORDER.ATTACK_MOVE, x: target.pos.x + frand(-7, 7), z: target.pos.z + frand(-7, 7) });
    }

    // abort if we are clearly losing the engagement
    const local = this.localEnemyValue(this.squadCentre(squad), 40);
    if (this.squadValue(squad) < local * (0.55 + (1 - this.preset.aggression) * 0.35)) {
      this.retreat();
      return;
    }

    if (this.preset.micro >= 2) this.focusFire(squad);

    for (const u of squad) {
      if (u.order.type === ORDER.IDLE && !u.target) {
        u.issue({ type: ORDER.ATTACK_MOVE, x: target.pos.x + frand(-7, 7), z: target.pos.z + frand(-7, 7) });
      }
    }
  }

  /** Everyone in range shoots the single juiciest thing. */
  focusFire(squad) {
    const centre = this.squadCentre(squad);
    let best = null, bestScore = -Infinity;
    this.game.spatial.forEachNear(centre.x, centre.z, 34, (e) => {
      if (!e.alive || e.owner !== this.enemyId || !e.isUnit) return;
      const s = (e.def.heal ? 60 : 0) + (e.def.attack ? e.def.attack.damage : 0)
        + (1 - e.hpFrac) * 45 - Math.hypot(e.pos.x - centre.x, e.pos.z - centre.z) * 0.4;
      if (s > bestScore) { bestScore = s; best = e; }
    });
    if (!best) return;
    for (const u of squad) {
      if (!u.def.attack) continue;
      if (u.distanceTo(best) > this.game.combat.rangeFor(u) * 1.5) continue;
      if (u.forcedTarget === best) continue;
      u.issue({ type: ORDER.ATTACK, target: best });
    }
  }

  localEnemyValue(centre, radius) {
    let v = 0;
    this.game.spatial.forEachNear(centre.x, centre.z, radius, (e) => {
      if (!e.alive || e.owner !== this.enemyId) return;
      if (Math.hypot(e.pos.x - centre.x, e.pos.z - centre.z) > radius) return;
      if (e.isBuilding) { v += e.def.attack ? 180 : 30; return; }
      const c = e.def.cost;
      v += (c.paper || 0) + (c.ink || 0) * 1.6 + (c.battery || 0) * 4.2;
    });
    return v;
  }

  retreat() {
    this.state = 'massing';
    this.stagingPoint = null;
    this.attackCooldown = 35;
    for (const u of this.squads.main) {
      u.issue({ type: ORDER.ATTACK_MOVE, x: this.rally.x + frand(-8, 8), z: this.rally.z + frand(-10, 10) });
    }
  }

  defend() {
    const point = this.threatPoint || this.base;
    for (const u of this.squads.main) {
      const d = Math.hypot(u.pos.x - point.x, u.pos.z - point.z);
      if (d > 14 && (u.order.type === ORDER.IDLE || u.order.type === ORDER.ATTACK_MOVE || !u.target)) {
        u.issue({ type: ORDER.ATTACK_MOVE, x: point.x + frand(-8, 8), z: point.z + frand(-8, 8) });
      }
    }
    // recall the harassers when home is burning
    if (this.threat > 90) {
      for (const u of this.squads.harass) {
        u.issue({ type: ORDER.ATTACK_MOVE, x: point.x + frand(-8, 8), z: point.z + frand(-8, 8) });
      }
      this.squads.harass.length = 0;
    }
  }

  /** Send a couple of fast units to chew on undefended extractors. */
  harass() {
    this.harassTimer -= this.preset.think;
    if (this.harassTimer > 0) return;
    this.harassTimer = 55 - this.preset.aggression * 25;

    const enemy = this.game.players[this.enemyId];
    const targets = [];
    for (const b of enemy.buildings) {
      if (!b.alive || !b.node) continue;
      const defended = this.localEnemyDefence(b.pos, 22);
      if (defended < 120) targets.push(b);
    }
    if (!targets.length) return;
    const target = targets[Math.floor(Math.random() * targets.length)];

    const raiders = [];
    for (const u of this.squads.main) {
      if (raiders.length >= 3) break;
      if (u.def.speed >= 12 && u.def.attack) raiders.push(u);
    }
    if (raiders.length < 2) return;

    for (const u of raiders) {
      removeFrom(this.squads.main, u);
      this.squads.harass.push(u);
      u.issue({ type: ORDER.ATTACK_MOVE, x: target.pos.x + frand(-5, 5), z: target.pos.z + frand(-5, 5) });
      u.issue({ type: ORDER.ATTACK, target }, { queued: true });
    }
    this.log.push(`${Math.round(this.game.time)}s harass`);
  }

  localEnemyDefence(pos, radius) {
    let v = 0;
    this.game.spatial.forEachNear(pos.x, pos.z, radius, (e) => {
      if (!e.alive || e.owner !== this.enemyId) return;
      if (e.isBuilding && e.def.attack) v += 220;
      else if (e.isUnit && e.def.attack) v += 45;
    });
    return v;
  }

  /** Pull badly hurt units out of the line so they can be healed. */
  microRetreat() {
    const hqPos = this.p.hq ? this.p.hq.pos : this.base;
    for (const u of this.p.units) {
      if (!u.alive || u.def.immobile) continue;
      if (u.hpFrac > 0.26) { u._retreating = false; continue; }
      if (u._retreating) continue;
      const nearFoe = this.game.spatial.nearest(u.pos.x, u.pos.z, 22,
        (e) => e.alive && e.owner === this.enemyId && e.def.attack);
      if (!nearFoe) continue;
      u._retreating = true;
      removeFrom(this.squads.main, u);
      u.issue({ type: ORDER.MOVE, x: hqPos.x + frand(-10, 10), z: hqPos.z + frand(-10, 10) });
    }
  }

  /** Cheap per-frame upkeep: rejoin healed units, drop the dead. */
  stepSquads(dt) {
    for (const key of Object.keys(this.squads)) {
      this.squads[key] = this.squads[key].filter((u) => u.alive);
    }
    if (this.preset.micro >= 1) {
      for (const u of this.p.units) {
        if (u._retreating && u.hpFrac > 0.72) {
          u._retreating = false;
          if (!this.squads.main.includes(u)) this.squads.main.push(u);
        }
      }
    }
  }

  /* Debug summary shown in the end-of-match panel. */
  summary() {
    return {
      state: this.state,
      army: Math.round(this.armyValue || 0),
      extractors: this.p.countBuildings('extractor'),
      tech: this.p.tech.size,
    };
  }
}

export function presetLabel(preset) {
  return preset.label || 'Custom';
}

export const AI_COMPOSITIONS = COMPOSITIONS;
export const AI_BUILDINGS = BUILDINGS;
export const clampAI = clamp;
