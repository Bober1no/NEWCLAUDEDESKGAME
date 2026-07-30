/**
 * Zone control tracking and the three win conditions.
 *
 *   Domination    lose your HQ *and* every production building → defeat
 *   Desk Control  hold the majority of zones long enough to bank the timer
 *   Annihilation  lose every structure → defeat
 *
 * A hard match time limit always applies; whoever is ahead on score takes it.
 */
import { VICTORY, CONTROL_TARGET_SECONDS, MATCH_TIME_LIMIT } from '../core/constants.js';
import { EV } from '../core/events.js';

const PRODUCTION_IDS = ['infantry', 'ink', 'siege', 'tech', 'hangar'];

export class VictorySystem {
  constructor(game, mode = VICTORY.DOMINATION) {
    this.game = game;
    this.mode = mode;
    this.timer = 0;
    this.over = false;
    this.result = null;
    this.zoneTimer = 0;
    this.majorityNeeded = Math.floor(game.map.zones.length / 2) + 1;
  }

  get target() { return CONTROL_TARGET_SECONDS; }

  update(dt) {
    if (this.over) return;
    this.zoneTimer -= dt;
    if (this.zoneTimer <= 0) {
      this.zoneTimer = 0.4;
      this.updateZones();
    }

    if (this.mode === VICTORY.CONTROL) this.tickControl(dt);
    this.checkElimination();

    if (this.game.time >= MATCH_TIME_LIMIT) this.timeout();
  }

  /* ── zones ────────────────────────────────────────────────────────── */
  updateZones() {
    const map = this.game.map;
    let changed = false;
    const held = [0, 0];

    for (const zone of map.zones) {
      const counts = [0, 0];
      this.game.spatial.forEachNear(zone.x, zone.z, zone.radius, (e) => {
        if (!e.alive || e.owner > 1) return;
        const dx = e.pos.x - zone.x, dz = e.pos.z - zone.z;
        if (dx * dx + dz * dz > zone.radius * zone.radius) return;
        // structures anchor a zone far harder than a passing scout
        counts[e.owner] += e.isBuilding ? (e.built ? 4 : 1.5) : (e.def.pop || 1);
      });
      zone.counts = counts;

      let owner = zone.owner;
      if (counts[0] > counts[1] * 1.25 && counts[0] > 0) owner = 0;
      else if (counts[1] > counts[0] * 1.25 && counts[1] > 0) owner = 1;
      else if (counts[0] === 0 && counts[1] === 0) owner = zone.owner;   // sticky when empty

      if (owner !== zone.owner) {
        zone.owner = owner;
        map.paintZone(zone);
        changed = true;
        if (owner === this.game.humanId) {
          this.game.events.emit(EV.ALERT, { text: `${zone.name} secured`, kind: 'good' });
        } else if (owner >= 0) {
          this.game.events.emit(EV.ALERT, { text: `${zone.name} lost`, kind: 'warn' });
        }
      }
      if (zone.owner >= 0) held[zone.owner]++;
    }

    this.held = held;
    if (changed) this.game.events.emit(EV.ZONE_CHANGED, { held });
  }

  tickControl(dt) {
    const held = this.held || [0, 0];
    for (let p = 0; p < 2; p++) {
      if (held[p] >= this.majorityNeeded) {
        this.game.players[p].controlSeconds += dt;
        if (this.game.players[p].controlSeconds >= CONTROL_TARGET_SECONDS) {
          this.finish(p, 'held the desk');
        }
      } else {
        // slow bleed-off so a single lucky minute does not decide the match
        this.game.players[p].controlSeconds = Math.max(0, this.game.players[p].controlSeconds - dt * 0.35);
      }
    }
  }

  /* ── elimination ──────────────────────────────────────────────────── */
  isDefeated(player) {
    switch (this.mode) {
      case VICTORY.ANNIHILATION:
        return player.buildings.size === 0 && player.units.size === 0;
      case VICTORY.CONTROL:
      case VICTORY.DOMINATION:
      default: {
        const hasHq = !!player.hq;
        if (hasHq) return false;
        for (const id of PRODUCTION_IDS) if (player.countBuildings(id)) return false;
        return true;
      }
    }
  }

  checkElimination() {
    for (let p = 0; p < 2; p++) {
      const player = this.game.players[p];
      if (player.defeated) continue;
      if (this.isDefeated(player)) {
        player.defeated = true;
        this.finish(1 - p, this.mode === VICTORY.ANNIHILATION ? 'razed the desk' : 'destroyed the command line');
      }
    }
  }

  timeout() {
    const s = [this.score(0), this.score(1)];
    const winner = s[0] === s[1] ? -1 : (s[0] > s[1] ? 0 : 1);
    this.finish(winner, 'time limit — highest desk score wins');
  }

  score(p) {
    const player = this.game.players[p];
    let s = player.controlSeconds * 2;
    s += player.armyValue() * 0.35;
    for (const b of player.buildings) if (b.built) s += 80;
    s += player.stats.kills * 12;
    return s;
  }

  finish(winner, reason) {
    if (this.over) return;
    this.over = true;
    this.result = { winner, reason, time: this.game.time };
    this.game.events.emit(EV.GAME_OVER, this.result);
  }

  /* ── HUD helpers ──────────────────────────────────────────────────── */
  objectiveText() {
    switch (this.mode) {
      case VICTORY.CONTROL:
        return `Desk Control — hold ${this.majorityNeeded} of ${this.game.map.zones.length} zones`;
      case VICTORY.ANNIHILATION:
        return 'Annihilation — raze every enemy structure';
      default:
        return 'Domination — destroy the enemy HQ and factories';
    }
  }

  progress(p) {
    if (this.mode !== VICTORY.CONTROL) return null;
    return this.game.players[p].controlSeconds / CONTROL_TARGET_SECONDS;
  }
}
