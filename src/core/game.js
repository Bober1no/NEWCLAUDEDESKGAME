/**
 * The match: owns the world, the players, every system, and the frame loop.
 */
import * as THREE from 'three';

import { createScene, createCamera, FreeCam } from '../scene/setupScene.js';
import { DeskMap, BASE_SPOTS } from '../scene/deskMap.js';
import { FX } from '../scene/fx.js';
import { box, translucent, PAL } from '../scene/materials.js';

import { TerrainGrid, PathService } from '../systems/pathfinding.js';
import { SpatialIndex } from '../systems/spatial.js';
import { Combat } from '../systems/combat.js';
import { PlayerState, ResourceSystem } from '../systems/resources.js';
import { Fog } from '../systems/fog.js';
import { VictorySystem } from '../systems/victory.js';
import { Selection, InputController } from '../systems/selection.js';

import { Unit } from '../entities/unit.js';
import { Building } from '../entities/building.js';
import { getUnitDef, getBuildingDef, getDef } from '../entities/registry.js';

import { AIController } from '../ai/aiController.js';
import { UI } from '../ui/index.js';

import { EventBus, EV } from './events.js';
import { audio } from './audio.js';
import { START_RESOURCES, BALANCE, TEAM_COLORS } from './constants.js';
import { frand } from './utils.js';

const SPEEDS = [1, 1.5, 2, 3];

export class Game {
  constructor(renderer, config, hooks = {}) {
    this.renderer = renderer;
    this.config = config;
    this.hooks = hooks;
    this.events = new EventBus();
    this.audio = audio;

    this.time = 0;
    this.realTime = 0;
    this.speedIndex = SPEEDS.indexOf(config.speed) >= 0 ? SPEEDS.indexOf(config.speed) : 0;
    this.speed = config.speed || 1;
    this.paused = false;
    this.running = false;
    this.lastEvent = null;
    this._lastAttackAlert = -99;

    /* ── who is at the controls ────────────────────────────────────── */
    // `humanId` is the single source of truth for "my side": fog, HUD, build
    // menu, minimap and picking all read it. Hot seat simply moves it.
    this.mode = config.mode === 'pvp' ? 'pvp' : 'ai';
    this.isHotSeat = this.mode === 'pvp';
    this.humanId = 0;
    this.handoverStyle = config.handover === 'timed' ? 'timed' : 'free';
    this.turnLength = config.turnLength || 90;
    this.turnRemaining = this.isHotSeat && this.handoverStyle === 'timed' ? this.turnLength : Infinity;
    this.awaitingHandover = false;

    /* ── scene ─────────────────────────────────────────────────────── */
    const { scene, sun } = createScene();
    this.scene = scene;
    this.sun = sun;
    this.camera = createCamera();
    this.controls = new FreeCam(this.camera, renderer.domElement);

    this.entityRoot = new THREE.Group();
    this.scene.add(this.entityRoot);
    this.fx = new FX(this.scene);

    /* ── world ─────────────────────────────────────────────────────── */
    this.grid = new TerrainGrid();
    this.map = new DeskMap(this.scene, this.grid, config.seed);
    this.paths = new PathService(this.grid, 6);
    this.spatial = new SpatialIndex();
    this.combat = new Combat(this);

    /* ── players ───────────────────────────────────────────────────── */
    const start = START_RESOURCES[config.start] || START_RESOURCES.standard;
    const names = config.names || ['Player 1', 'Player 2'];
    this.players = [
      new PlayerState(this, 0, {
        name: this.isHotSeat ? names[0] : 'You',
        start: { ...start },
      }),
      new PlayerState(this, 1, {
        name: this.isHotSeat ? names[1] : `${config.preset.label} AI`,
        isAI: !this.isHotSeat,
        economyMul: this.isHotSeat ? 1 : config.preset.economy,
        start: { ...start },
      }),
    ];

    this.resources = new ResourceSystem(this);
    this.fog = new Fog(this);
    this.victory = new VictorySystem(this, config.victory);
    this.selection = new Selection(this);
    this.input = new InputController(this, renderer.domElement);

    this.units = new Set();
    this.buildings = new Set();
    this._all = [];

    this.ai = this.isHotSeat ? null : new AIController(this, 1, config.preset);
    this.ui = new UI(this);

    this._seedBases();
    this._wireEvents();

    this.controls.snapTo(BASE_SPOTS[0].x + 26, BASE_SPOTS[0].z, 96);
    this._rebuildEntityList();
    this.spatial.rebuild(this._all);
    this.fog.update(10);
    this.ui.hud.show();
    this.ui.hud.alert(this.victory.objectiveText(), '');
    if (this.isHotSeat) {
      this.ui.hud.alert(`${this.players[0].name} commands Graphite Blue — F2 hands over`, 'good');
    }

    this._loop = this._loop.bind(this);
    this._lastFrame = performance.now();
  }

  /* ═════════════════ setup ═════════════════ */
  baseSpot(id) { return BASE_SPOTS[id]; }

  _seedBases() {
    for (let p = 0; p < 2; p++) {
      const spot = BASE_SPOTS[p];
      const dir = p === 0 ? 1 : -1;

      this.placeBuilding('hq', p, spot.x, spot.z, { instant: true, free: true });
      this.placeBuilding('infantry', p, spot.x + dir * 15, spot.z - 15, { instant: true, free: true });

      const squad = ['grunt', 'grunt', 'grunt', 'scout', 'engineer'];
      squad.forEach((id, i) => {
        const a = -0.7 + i * 0.35;
        this.spawnUnit(id, p, spot.x + dir * (14 + Math.cos(a) * 5), spot.z + 8 + Math.sin(a) * 8);
      });
    }
  }

  _wireEvents() {
    this.events.on(EV.BUILDING_DESTROYED, ({ building }) => {
      if (building.owner === this.humanId) {
        this.ui.hud.alert(`${building.def.name} destroyed`, 'bad');
        this.lastEvent = { x: building.pos.x, z: building.pos.z };
      }
    });
    this.events.on(EV.GAME_OVER, () => {
      this.input.enabled = false;
      this.fog.revealAll();
    });
  }

  /* ═════════════════ entity API ═════════════════ */
  allEntities() { return this._all; }

  defName(id) { return getDef(id)?.name || id; }

  spawnUnit(defId, owner, x, z) {
    const def = getUnitDef(defId);
    if (!def) return null;
    let px = x, pz = z;
    if (!def.air) {
      const [fx, fz] = this.grid.nearestFree(x, z);
      px = fx + frand(-0.6, 0.6); pz = fz + frand(-0.6, 0.6);
    }
    const u = new Unit(this, def, owner, px, pz);
    this.units.add(u);
    this.players[owner].addUnit(u);
    this.events.emit(EV.UNIT_SPAWNED, { unit: u });
    return u;
  }

  /**
   * @returns {{ok: boolean, reason: string, cost: object}}
   */
  canPlaceBuilding(id, owner, x, z, { node = null, bottle = null, free = false } = {}) {
    const def = getBuildingDef(id);
    if (!def) return { ok: false, reason: 'Unknown structure' };
    const player = this.players[owner];

    if (def.requires) {
      for (const r of def.requires) {
        if (!player.hasFinishedBuilding(r)) {
          return { ok: false, reason: `Requires ${getBuildingDef(r).name}` };
        }
      }
    }
    if (def.unique && player.countBuildings(id)) return { ok: false, reason: 'Only one allowed' };

    const [hw, hd] = def.footprint;
    if (!this.map.inBounds(x, z, Math.max(hw, hd) + 2)) return { ok: false, reason: 'Off the desk' };

    if (def.onNode) {
      const n = node || this.map.nodeAt(x, z, BALANCE.EXTRACTOR_RANGE);
      if (!n) return { ok: false, reason: 'Must sit on a resource node' };
      if (n.extractor && n.extractor.alive) return { ok: false, reason: 'Node already claimed' };
    }

    // footprint must be clear — bottle sites are allowed because we eat them
    const g = this.grid;
    const x0 = g.cellX(x - hw), x1 = g.cellX(x + hw);
    const z0 = g.cellZ(z - hd), z1 = g.cellZ(z + hd);
    for (let gz = z0; gz <= z1; gz++) {
      for (let gx = x0; gx <= x1; gx++) {
        const i = g.idx(gx, gz);
        if (!(g.flags[i] & 1)) continue;
        const occ = g.occupant[i];
        if (bottle && occ === -1) continue;           // the bottle itself
        return { ok: false, reason: 'Blocked ground' };
      }
    }

    // build radius: near something you already own
    if (!free) {
      let near = false;
      for (const b of player.buildings) {
        if (!b.alive) continue;
        if (b.distanceTo({ pos: { x, z } }) < BALANCE.BUILD_RADIUS + Math.max(...b.def.footprint)) { near = true; break; }
      }
      if (!near) return { ok: false, reason: 'Too far from your structures' };
    }

    // no overlapping units where a structure would drop
    let blockedByUnit = false;
    this.spatial.forEachNear(x, z, Math.max(hw, hd) + 1.5, (e) => {
      if (blockedByUnit || !e.alive || !e.isUnit || e.isAir) return;
      if (Math.abs(e.pos.x - x) < hw + e.def.radius && Math.abs(e.pos.z - z) < hd + e.def.radius) {
        blockedByUnit = true;
      }
    });
    if (blockedByUnit) return { ok: false, reason: 'Units in the way' };

    const cost = this.buildingCost(id, { bottle });
    if (!free && !player.canAfford(cost)) {
      const missing = player.missingFor(cost).join(' & ');
      return { ok: false, reason: `Not enough ${missing}`, cost };
    }
    return { ok: true, reason: '', cost };
  }

  buildingCost(id, { bottle = null } = {}) {
    const def = getBuildingDef(id);
    const cost = { ...def.cost };
    if (bottle && id === 'tower') {
      for (const k of Object.keys(cost)) cost[k] = Math.round(cost[k] * 0.6);
    }
    return cost;
  }

  placeBuilding(id, owner, x, z, opts = {}) {
    const check = this.canPlaceBuilding(id, owner, x, z, opts);
    if (!check.ok) return null;
    const def = getBuildingDef(id);
    const player = this.players[owner];

    if (!opts.free && !player.trySpend(check.cost)) return null;

    const node = def.onNode ? (opts.node || this.map.nodeAt(x, z, BALANCE.EXTRACTOR_RANGE)) : null;
    const bottle = opts.bottle && id === 'tower' ? opts.bottle : null;
    const px = node ? node.x : (bottle ? bottle.x : x);
    const pz = node ? node.z : (bottle ? bottle.z : z);

    const b = new Building(this, def, owner, px, pz, { instant: !!opts.instant, node, bottle });
    this.buildings.add(b);
    player.addBuilding(b);
    if (opts.instant) player.onBuildingFinished(b);
    if (node) {
      node.halo.material = translucent(TEAM_COLORS[owner].primary, 0.5, 0.4);
      node.beacon.visible = false;
    }
    this.events.emit(EV.BUILDING_PLACED, { building: b });
    return b;
  }

  /** Tape Engineer ability: a walkway over blocked clutter. */
  layBridge(unit, x, z) {
    const player = this.players[unit.owner];
    const cost = unit.def.bridge.cost;
    if (!player.trySpend(cost)) {
      if (unit.owner === this.humanId) {
        this.ui.hud.alert('Not enough paper for a tape bridge', 'warn');
        this.audio.play('deny');
      }
      return;
    }
    const dx = x - unit.pos.x, dz = z - unit.pos.z;
    const len = Math.min(unit.def.bridge.length, Math.hypot(dx, dz) + 4);
    const ang = Math.atan2(dz, dx);
    const ex = unit.pos.x + Math.cos(ang) * len;
    const ez = unit.pos.z + Math.sin(ang) * len;

    this.grid.bridge(unit.pos.x, unit.pos.z, ex, ez, 3.0);

    const strip = new THREE.Mesh(box(len, 0.16, 3.0), translucent(PAL.tape, 0.85, 0.35));
    strip.position.set((unit.pos.x + ex) / 2, 0.14, (unit.pos.z + ez) / 2);
    strip.rotation.y = -ang;
    strip.receiveShadow = true;
    this.scene.add(strip);
    this.fx.buildPuff((unit.pos.x + ex) / 2, (unit.pos.z + ez) / 2, 4);
    this.audio.play('build');
  }

  /* ═════════════════ queries ═════════════════ */
  isVisibleToHuman(e) {
    if (e.owner === this.humanId) return true;
    if (!this.fog.enabled) return true;
    if (e.isBuilding) return this.fog.isExplored(this.humanId, e.pos.x, e.pos.z);
    if (!this.fog.isVisible(this.humanId, e.pos.x, e.pos.z)) return false;
    return this.fog.detectedBy(e, this.humanId);
  }

  isDetectedBy(entity, ownerId) { return this.fog.detectedBy(entity, ownerId); }

  notifyDamage(target, attacker) {
    if (target.owner !== this.humanId) return;
    this.lastEvent = { x: target.pos.x, z: target.pos.z };
    if (this.time - this._lastAttackAlert < 9) return;
    this._lastAttackAlert = this.time;
    const what = target.isBuilding ? target.def.name : 'Your forces';
    this.ui.hud.alert(`${what} under attack`, 'bad');
    this.ui.minimap.ping(target.pos.x, target.pos.z, '#ff6a5c');
    void attacker;
  }

  /* ═════════════════ camera helpers ═════════════════ */
  focusSelection() {
    const items = this.selection.items;
    if (!items.length) return this.focusBase();
    let x = 0, z = 0;
    for (const e of items) { x += e.pos.x; z += e.pos.z; }
    this.controls.focusOn(x / items.length, z / items.length);
    return true;
  }

  focusBase() {
    const hq = this.players[this.humanId].hq;
    const spot = hq ? hq.pos : BASE_SPOTS[this.humanId];
    this.controls.focusOn(spot.x, spot.z);
    return true;
  }

  focusLastEvent() {
    if (!this.lastEvent) return this.focusSelection();
    this.controls.focusOn(this.lastEvent.x, this.lastEvent.z);
    return true;
  }

  /* ═════════════════ hot seat ═════════════════ */

  /**
   * Hand the desk to the other commander.
   *
   * Everything that defines "my side" hangs off `humanId`, so the swap is:
   * drop the outgoing player's selection and build ghost, move the id,
   * repaint the fog from the new owner's grid, and put the camera on their
   * base. In timed mode the match holds on a handover card so the mouse can
   * physically change hands without the incoming player losing units.
   */
  swapCommander({ announce = true } = {}) {
    if (!this.isHotSeat || this.victory.over) return;
    const next = 1 - this.humanId;

    this.selection.clear();
    this.input.cancelPlacement();
    this.input.pendingCommand = null;
    this.input.hover = null;
    this.humanId = next;
    this.turnRemaining = this.handoverStyle === 'timed' ? this.turnLength : Infinity;

    this.fog._paint();
    this.fog.refreshVisibility();
    this.ui.minimap.pings.length = 0;
    // face up the desk toward the opponent, from behind your own HQ
    this.controls.azimuth = next === 0 ? Math.PI : 0;
    this.focusBase();
    this.controls.snapTo(this.controls.target.x, this.controls.target.z);
    this.ui.hud.setCommander(next);
    this.ui.buildMenu.refresh(true);
    this.ui.hud.updateSelection(true);
    this._lastAttackAlert = -99;

    if (this.handoverStyle === 'timed') {
      this.beginHandover(next);
    } else if (announce) {
      this.ui.hud.alert(`${this.players[next].name} is in command`, 'good');
      this.audio.play('complete');
    }
  }

  beginHandover(id) {
    this.awaitingHandover = true;
    this.paused = true;
    this.input.enabled = false;
    this.ui.showHandover(id);
    this.audio.play('alert');
  }

  endHandover() {
    this.awaitingHandover = false;
    this.paused = false;
    this.input.enabled = !this.victory.over;
    this.ui.hideHandover();
  }

  _tickTurnClock(dt) {
    if (!this.isHotSeat || this.handoverStyle !== 'timed') return;
    if (this.awaitingHandover || this.victory.over) return;
    this.turnRemaining -= dt;
    if (this.turnRemaining <= 0) this.swapCommander();
    else if (this.turnRemaining < 10 && !this._turnWarned) {
      this._turnWarned = true;
      this.ui.hud.alert('10 seconds left in this turn', 'warn');
    }
    if (this.turnRemaining > 10) this._turnWarned = false;
  }

  /* ═════════════════ controls ═════════════════ */
  togglePause() { this.setPaused(!this.paused); }

  setPaused(v, soft = false) {
    // a modal may already be holding the game; do not fight it
    if (this.awaitingHandover) return;   // the handover card owns the pause
    const modalOpen = !document.getElementById('modal-tech').classList.contains('hidden')
      || !document.getElementById('modal-help').classList.contains('hidden')
      || !document.getElementById('modal-end').classList.contains('hidden');
    if (!v && modalOpen && soft) return;

    this.paused = v;
    this.input.enabled = !v && !this.victory.over;
    const modal = document.getElementById('modal-pause');
    if (soft) modal.classList.add('hidden');
    else modal.classList.toggle('hidden', !v);
  }

  cycleSpeed() {
    this.speedIndex = (this.speedIndex + 1) % SPEEDS.length;
    this.speed = SPEEDS[this.speedIndex];
    return this.speed;
  }

  toggleSound() {
    const on = !this.audio.enabled;
    this.audio.setEnabled(on);
    return on;
  }

  restart() {
    this.hooks.onRestart?.(this.config);
  }

  quitToMenu() {
    this.hooks.onQuit?.();
  }

  /* ═════════════════ loop ═════════════════ */
  start() {
    if (this.running) return;
    this.running = true;
    this._lastFrame = performance.now();
    requestAnimationFrame(this._loop);
  }

  stop() { this.running = false; }

  _loop(now) {
    if (!this.running) return;
    requestAnimationFrame(this._loop);

    const realDt = Math.min(0.05, (now - this._lastFrame) / 1000);
    this._lastFrame = now;
    this.realTime += realDt;

    if (!this.paused && !this.victory.over) {
      // Fixed-ceiling substeps: at 3× speed a single 0.15s step would let a
      // fast unit hop straight over a 2-unit wall cell.
      let remaining = realDt * this.speed;
      let guard = 0;
      while (remaining > 0.0005 && guard++ < 8) {
        const step = Math.min(0.05, remaining);
        this.tick(step);
        remaining -= step;
      }
    } else if (!this.paused) {
      // match is over: keep the world alive so explosions finish
      this.fx.update(realDt);
      this.combat.updateProjectiles(realDt);
    }

    this.controls.update(realDt);
    this.ui.update(realDt);
    this.renderer.render(this.scene, this.camera);
  }

  _rebuildEntityList() {
    const all = this._all;
    all.length = 0;
    for (const u of this.units) if (u.alive) all.push(u);
    for (const b of this.buildings) if (b.alive) all.push(b);
    return all;
  }

  tick(dt) {
    this.time += dt;

    // rebuild the entity list + spatial index once per tick
    this.spatial.rebuild(this._rebuildEntityList());

    this.paths.update();
    this.resources.update(dt);

    for (const u of this.units) if (u.alive) u.update(dt);
    for (const b of this.buildings) if (b.alive) b.update(dt);

    this.combat.updateProjectiles(dt);
    this.fx.update(dt);
    this.fog.update(dt);
    if (this.ai) this.ai.update(dt);
    this.victory.update(dt);
    this._tickTurnClock(dt);

    this._reap();
    this.selection.prune();
  }

  _reap() {
    for (const u of this.units) if (!u.alive) this.units.delete(u);
    for (const b of this.buildings) if (!b.alive) this.buildings.delete(b);
  }

  /* ═════════════════ teardown ═════════════════ */
  dispose() {
    this.stop();
    this.input.dispose();
    this.controls.dispose();
    this.ui.dispose();
    this.fog.dispose();
    this.fx.dispose();
    this.combat.clear();
    this.events.clear();

    // geometries and materials live in the shared cache and are reused by the
    // next match; only the scene graph is torn down here
    while (this.scene.children.length) this.scene.remove(this.scene.children[0]);
  }
}

export const GAME_SPEEDS = SPEEDS;
