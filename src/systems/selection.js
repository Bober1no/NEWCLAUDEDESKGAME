/**
 * Selection, orders and building placement — everything the mouse does.
 *
 * Left button selects (click or drag box), right button commands. The camera
 * owns right-DRAG for orbiting, so a right click only becomes an order if the
 * pointer barely moved; that keeps both idioms on one button without either
 * one feeling stolen.
 */
import * as THREE from 'three';
import { ORDER, BALANCE, WORLD } from '../core/constants.js';
import { formationOffsets, clamp } from '../core/utils.js';
import { EV } from '../core/events.js';
import { makeGhost } from '../entities/meshFactory.js';
import { getBuildingDef } from '../entities/registry.js';

const DRAG_THRESHOLD = 6;

export class Selection {
  constructor(game) {
    this.game = game;
    this.items = [];
    this.groups = new Map();      // 1..9 → array of entities
  }

  get size() { return this.items.length; }
  get primary() { return this.items[0] || null; }
  has(e) { return this.items.includes(e); }

  set(list) {
    for (const e of this.items) e.setSelected(false);
    this.items = list.filter((e) => e && e.alive);
    for (const e of this.items) e.setSelected(true);
    this._sort();
    this.game.events.emit(EV.SELECTION_CHANGED, { items: this.items });
  }

  add(list) {
    const set = new Set(this.items);
    for (const e of list) if (e && e.alive && !set.has(e)) { set.add(e); e.setSelected(true); }
    this.items = [...set];
    this._sort();
    this.game.events.emit(EV.SELECTION_CHANGED, { items: this.items });
  }

  toggle(e) {
    if (this.has(e)) this.remove(e);
    else this.add([e]);
  }

  remove(e) {
    const i = this.items.indexOf(e);
    if (i < 0) return;
    e.setSelected(false);
    this.items.splice(i, 1);
    this.game.events.emit(EV.SELECTION_CHANGED, { items: this.items });
  }

  clear() {
    for (const e of this.items) e.setSelected(false);
    this.items = [];
    this.game.events.emit(EV.SELECTION_CHANGED, { items: this.items });
  }

  prune() {
    const before = this.items.length;
    this.items = this.items.filter((e) => e.alive);
    if (this.items.length !== before) {
      this.game.events.emit(EV.SELECTION_CHANGED, { items: this.items });
    }
  }

  /** Combat units first, then support, then structures. */
  _sort() {
    const rank = (e) => {
      if (e.isBuilding) return 3;
      if (!e.def.attack) return 2;
      return 1;
    };
    this.items.sort((a, b) => rank(a) - rank(b) || a.def.id.localeCompare(b.def.id));
  }

  units() { return this.items.filter((e) => e.isUnit); }
  buildings() { return this.items.filter((e) => e.isBuilding); }

  /* Control groups are keyed per commander so a hot-seat handover cannot
     leave the incoming player holding the other side's group 1. */
  _groupKey(n) { return `${this.game.humanId}:${n}`; }

  assignGroup(n) {
    const mine = this.items.filter((e) => e.owner === this.game.humanId);
    if (!mine.length) return;
    this.groups.set(this._groupKey(n), mine);
    this.game.events.emit(EV.ALERT, { text: `Group ${n} set (${mine.length})`, kind: '' });
  }

  recallGroup(n, additive = false) {
    const key = this._groupKey(n);
    const g = (this.groups.get(key) || []).filter((e) => e.alive && e.owner === this.game.humanId);
    if (!g.length) return false;
    this.groups.set(key, g);
    if (additive) this.add(g); else this.set(g);
    return true;
  }
}

/* ─────────────────────────────────────────────────────────────────────
   Input controller
   ───────────────────────────────────────────────────────────────────── */
export class InputController {
  constructor(game, canvas) {
    this.game = game;
    this.canvas = canvas;
    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    this.dragStart = null;
    this.dragRect = null;
    this.rightStart = null;
    this.pendingCommand = null;     // 'attack' | 'patrol' | 'bridge'
    this.placement = null;          // { id, def, ghost, valid, node, bottle }
    this.hover = null;
    this.lastClickTime = 0;
    this.lastClickEntity = null;
    this.lastGroupTap = { n: -1, t: -1 };
    this.enabled = true;

    this._bind();
  }

  /* ── plumbing ─────────────────────────────────────────────────────── */
  _bind() {
    const c = this.canvas;
    this._down = (e) => this.onPointerDown(e);
    this._move = (e) => this.onPointerMove(e);
    this._up = (e) => this.onPointerUp(e);
    this._key = (e) => this.onKeyDown(e);

    c.addEventListener('pointerdown', this._down);
    window.addEventListener('pointermove', this._move);
    window.addEventListener('pointerup', this._up);
    window.addEventListener('keydown', this._key);
  }

  dispose() {
    this.canvas.removeEventListener('pointerdown', this._down);
    window.removeEventListener('pointermove', this._move);
    window.removeEventListener('pointerup', this._up);
    window.removeEventListener('keydown', this._key);
    this.cancelPlacement();
  }

  /* ── picking ──────────────────────────────────────────────────────── */
  toNdc(e) {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    return this.ndc;
  }

  groundPoint(e, out = new THREE.Vector3()) {
    this.raycaster.setFromCamera(this.toNdc(e), this.game.camera);
    return this.raycaster.ray.intersectPlane(this.ground, out) ? out : null;
  }

  pickEntity(e) {
    this.raycaster.setFromCamera(this.toNdc(e), this.game.camera);
    const hits = this.raycaster.intersectObjects(this.game.entityRoot.children, true);
    for (const h of hits) {
      let o = h.object;
      while (o && !o.userData.entity) o = o.parent;
      const ent = o?.userData.entity;
      if (ent && ent.alive && o.visible !== false) {
        if (ent.owner !== this.game.humanId && !this.game.isVisibleToHuman(ent)) continue;
        return ent;
      }
    }
    return null;
  }

  /* ── pointer ──────────────────────────────────────────────────────── */
  onPointerDown(e) {
    if (!this.enabled) return;
    if (e.button === 0) {
      if (this.placement) { this.tryPlace(e); return; }
      if (this.pendingCommand) { this.resolvePendingCommand(e); return; }
      this.dragStart = { x: e.clientX, y: e.clientY };
      this.dragRect = null;
    } else if (e.button === 2) {
      this.rightStart = { x: e.clientX, y: e.clientY };
    }
  }

  onPointerMove(e) {
    if (!this.enabled) return;
    if (this.dragStart) {
      const dx = e.clientX - this.dragStart.x;
      const dy = e.clientY - this.dragStart.y;
      if (Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD) {
        this.dragRect = {
          x0: Math.min(this.dragStart.x, e.clientX), y0: Math.min(this.dragStart.y, e.clientY),
          x1: Math.max(this.dragStart.x, e.clientX), y1: Math.max(this.dragStart.y, e.clientY),
        };
      }
    }
    if (this.placement) this.updateGhost(e);
    else this.hover = this.pickEntity(e);
  }

  onPointerUp(e) {
    if (!this.enabled) { this.dragStart = null; this.rightStart = null; return; }

    if (e.button === 0 && this.dragStart) {
      if (this.dragRect) this.boxSelect(this.dragRect, e.shiftKey);
      else this.clickSelect(e);
      this.dragStart = null;
      this.dragRect = null;
    }

    if (e.button === 2 && this.rightStart) {
      const moved = Math.abs(e.clientX - this.rightStart.x) + Math.abs(e.clientY - this.rightStart.y);
      this.rightStart = null;
      if (moved > DRAG_THRESHOLD) return;          // that was a camera orbit
      if (this.placement) { this.cancelPlacement(); return; }
      if (this.pendingCommand) { this.pendingCommand = null; this.updateCursor(); return; }
      this.issueContextCommand(e);
    }
  }

  /* ── selecting ────────────────────────────────────────────────────── */
  clickSelect(e) {
    const ent = this.pickEntity(e);
    const sel = this.game.selection;

    if (!ent) { if (!e.shiftKey) sel.clear(); return; }

    // double-click: grab every visible unit of the same type
    const now = performance.now();
    if (this.lastClickEntity === ent && now - this.lastClickTime < 350 && ent.isUnit) {
      this.selectSameType(ent, e.shiftKey);
      this.lastClickTime = 0;
      return;
    }
    this.lastClickEntity = ent;
    this.lastClickTime = now;

    if (e.shiftKey) sel.toggle(ent);
    else sel.set([ent]);
    this.game.audio.play('select');
  }

  selectSameType(proto, additive) {
    const found = [];
    for (const u of this.game.players[this.game.humanId].units) {
      if (u.def.id !== proto.def.id) continue;
      if (!this.onScreen(u.pos)) continue;
      found.push(u);
    }
    if (additive) this.game.selection.add(found);
    else this.game.selection.set(found);
    this.game.audio.play('select');
  }

  onScreen(pos) {
    const v = pos.clone().project(this.game.camera);
    return v.x >= -1 && v.x <= 1 && v.y >= -1 && v.y <= 1 && v.z < 1;
  }

  boxSelect(rect, additive) {
    const r = this.canvas.getBoundingClientRect();
    const cam = this.game.camera;
    const me = this.game.humanId;
    const found = [];
    const v = new THREE.Vector3();

    for (const u of this.game.players[me].units) {
      if (!u.alive) continue;
      v.copy(u.pos).project(cam);
      if (v.z > 1) continue;
      const sx = r.left + (v.x * 0.5 + 0.5) * r.width;
      const sy = r.top + (-v.y * 0.5 + 0.5) * r.height;
      if (sx >= rect.x0 && sx <= rect.x1 && sy >= rect.y0 && sy <= rect.y1) found.push(u);
    }

    // only fall back to structures if the box caught no troops at all
    if (!found.length) {
      for (const b of this.game.players[me].buildings) {
        if (!b.alive) continue;
        v.copy(b.pos).project(cam);
        if (v.z > 1) continue;
        const sx = r.left + (v.x * 0.5 + 0.5) * r.width;
        const sy = r.top + (-v.y * 0.5 + 0.5) * r.height;
        if (sx >= rect.x0 && sx <= rect.x1 && sy >= rect.y0 && sy <= rect.y1) found.push(b);
      }
    }

    if (!found.length && !additive) { this.game.selection.clear(); return; }
    if (additive) this.game.selection.add(found);
    else this.game.selection.set(found);
    if (found.length) this.game.audio.play('select');
  }

  /* ── commanding ───────────────────────────────────────────────────── */
  issueContextCommand(e) {
    const sel = this.game.selection;
    if (!sel.size) return;
    const target = this.pickEntity(e);
    const point = this.groundPoint(e);
    const queued = e.shiftKey;

    const units = sel.units().filter((u) => u.owner === this.game.humanId);
    const buildings = sel.buildings().filter((b) => b.owner === this.game.humanId);

    if (buildings.length && !units.length && point) {
      for (const b of buildings) if (b.def.produces) b.setRally(point.x, point.z);
      this.game.fx.shockwave(point.x, 0.2, point.z, 4, 0xa8d0ff);
      this.game.audio.play('order');
      return;
    }
    if (!units.length) return;

    if (target && target.owner !== this.game.humanId && target.owner <= 1) {
      this.commandAttack(units, target, queued);
    } else if (target && target.owner === this.game.humanId && target.isBuilding) {
      this.commandFriendlyBuilding(units, target, queued);
    } else if (point) {
      this.commandMove(units, point.x, point.z, ORDER.MOVE, queued);
    }
  }

  commandAttack(units, target, queued) {
    for (const u of units) {
      if (u.def.sabotage && target.isBuilding) u.issue({ type: ORDER.SABOTAGE, target }, { queued });
      else if (u.def.attack) u.issue({ type: ORDER.ATTACK, target }, { queued });
      else u.issue({ type: ORDER.MOVE, x: target.pos.x, z: target.pos.z }, { queued });
    }
    this.game.fx.shockwave(target.pos.x, 0.25, target.pos.z, 4.5, 0xe2564a);
    this.game.audio.play('order');
  }

  commandFriendlyBuilding(units, target, queued) {
    let acted = false;
    for (const u of units) {
      if (u.def.repair && target.hp < target.maxHp) {
        u.issue({ type: ORDER.REPAIR, target }, { queued });
        acted = true;
      } else {
        u.issue({ type: ORDER.MOVE, x: target.pos.x, z: target.pos.z + 6 }, { queued });
      }
    }
    if (acted) this.game.fx.shockwave(target.pos.x, 0.25, target.pos.z, 4.5, 0x7ee08a);
    this.game.audio.play('order');
  }

  commandMove(units, x, z, type, queued) {
    const [cx, cz] = this.game.map.clampToDesk(x, z, 2.5);
    const angle = units.length > 1
      ? Math.atan2(cz - units[0].pos.z, cx - units[0].pos.x)
      : 0;
    const offsets = formationOffsets(units.length, 3.2, angle);
    units.forEach((u, i) => {
      const [ox, oz] = offsets[i];
      u.issue({ type, x: cx + ox, z: cz + oz }, { queued });
    });
    const col = type === ORDER.ATTACK_MOVE ? 0xf2b544 : 0xa8d0ff;
    this.game.fx.shockwave(cx, 0.2, cz, 4.5, col);
    this.game.fx.emit(cx, 0.4, cz, { count: 6, color: col, size: 1.1, life: 0.5, speed: 4, gravity: -6, up: 0.8 });
    this.game.audio.play('order');
  }

  resolvePendingCommand(e) {
    const mode = this.pendingCommand;
    this.pendingCommand = null;
    this.updateCursor();
    const point = this.groundPoint(e);
    const target = this.pickEntity(e);
    const units = this.game.selection.units().filter((u) => u.owner === this.game.humanId);
    if (!units.length) return;

    if (mode === 'attack') {
      if (target && target.owner !== this.game.humanId) this.commandAttack(units, target, e.shiftKey);
      else if (point) this.commandMove(units, point.x, point.z, ORDER.ATTACK_MOVE, e.shiftKey);
    } else if (mode === 'patrol' && point) {
      for (const u of units) u.issue({ type: ORDER.PATROL, x: point.x, z: point.z }, { queued: e.shiftKey });
      this.game.fx.shockwave(point.x, 0.2, point.z, 4.5, 0xb58cf0);
      this.game.audio.play('order');
    } else if (mode === 'bridge' && point) {
      for (const u of units) {
        if (u.def.bridge) { u.issue({ type: ORDER.BUILD_BRIDGE, x: point.x, z: point.z }); break; }
      }
    }
  }

  /* ── building placement ───────────────────────────────────────────── */
  beginPlacement(buildingId) {
    const def = getBuildingDef(buildingId);
    if (!def) return;
    this.cancelPlacement();
    const ghost = makeGhost(buildingId, def, this.game.humanId, true);
    this.game.scene.add(ghost);
    this.placement = { id: buildingId, def, ghost, valid: false, node: null, bottle: null };
    this.updateCursor();
    this.game.events.emit(EV.ALERT, { text: `Placing ${def.name} — right-click or Esc to cancel`, kind: '' });
  }

  cancelPlacement() {
    if (!this.placement) return;
    this.game.scene.remove(this.placement.ghost);
    this.placement = null;
    this.updateCursor();
    this.game.ui?.hud?.setPlacementHint(null);
  }

  updateGhost(e) {
    const p = this.placement;
    if (!p) return;
    const point = this.groundPoint(e);
    if (!point) return;

    const snapNode = p.def.onNode ? this.game.map.nodeAt(point.x, point.z, BALANCE.EXTRACTOR_RANGE * 1.6) : null;
    const snapBottle = p.id === 'tower' ? this.game.map.nearestBottle(point.x, point.z, 8) : null;
    const x = snapNode ? snapNode.x : (snapBottle ? snapBottle.x : point.x);
    const z = snapNode ? snapNode.z : (snapBottle ? snapBottle.z : point.z);

    const check = this.game.canPlaceBuilding(p.id, this.game.humanId, x, z, { node: snapNode, bottle: snapBottle });
    p.node = snapNode;
    p.bottle = snapBottle;
    p.valid = check.ok;
    p.x = x; p.z = z;

    const y = this.game.grid.heightAt(x, z);
    p.ghost.position.set(x, y, z);
    const col = check.ok ? 0x74e08a : 0xe2564a;
    p.ghost.traverse((c) => {
      if (c.isMesh && c !== p.ghost.userData.pad) c.material.color.setHex(col);
    });
    if (p.ghost.userData.pad) p.ghost.userData.pad.material.color.setHex(col);
    this.game.ui?.hud?.setPlacementHint(check.reason || (snapBottle ? 'Bottle site — cheaper and tougher' : null));
  }

  tryPlace(e) {
    const p = this.placement;
    if (!p) return;
    this.updateGhost(e);
    if (!p.valid) { this.game.audio.play('deny'); return; }
    const placed = this.game.placeBuilding(p.id, this.game.humanId, p.x, p.z, { node: p.node, bottle: p.bottle });
    if (placed) {
      this.game.audio.play('build');
      if (!e.shiftKey) this.cancelPlacement();
    } else {
      this.game.audio.play('deny');
    }
  }

  updateCursor() {
    const c = this.canvas;
    c.classList.toggle('cmd-attack', this.pendingCommand === 'attack');
    c.classList.toggle('cmd-place', !!this.placement);
  }

  /* ── keyboard ─────────────────────────────────────────────────────── */
  onKeyDown(e) {
    if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    const game = this.game;
    const sel = game.selection;

    if (e.code === 'Escape') {
      if (this.placement) { this.cancelPlacement(); return; }
      if (this.pendingCommand) { this.pendingCommand = null; this.updateCursor(); return; }
      game.togglePause();
      return;
    }
    if (!this.enabled) return;

    // control groups
    if (/^Digit[1-9]$/.test(e.code)) {
      const n = Number(e.code.slice(5));
      if (e.ctrlKey || e.metaKey) { sel.assignGroup(n); e.preventDefault(); return; }
      const now = performance.now();
      if (sel.recallGroup(n, e.shiftKey)) {
        if (this.lastGroupTap.n === n && now - this.lastGroupTap.t < 400) game.focusSelection();
        this.lastGroupTap = { n, t: now };
      }
      return;
    }

    switch (e.code) {
      case 'KeyA':
        if (e.ctrlKey) { this.selectAllArmy(); e.preventDefault(); }
        else if (sel.units().length) { this.pendingCommand = 'attack'; this.updateCursor(); }
        break;
      case 'KeyS':
        if (sel.size) { for (const u of sel.units()) u.stop(); game.audio.play('order'); }
        break;
      case 'KeyH':
        for (const u of sel.units()) u.issue({ type: ORDER.HOLD });
        break;
      case 'KeyP':
        if (sel.units().length) { this.pendingCommand = 'patrol'; this.updateCursor(); }
        break;
      case 'KeyB':
        if (sel.units().some((u) => u.def.bridge)) { this.pendingCommand = 'bridge'; this.updateCursor(); }
        break;
      case 'KeyF':
        game.focusSelection();
        break;
      case 'Home':
        game.focusBase();
        break;
      case 'KeyT':
        if (e.ctrlKey) { game.ui.toggleTech(); e.preventDefault(); }
        break;
      case 'Tab':
        this.cycleIdleWorker(e.shiftKey);
        e.preventDefault();
        break;
      case 'Delete':
        for (const b of sel.buildings()) b.salvage();
        for (const u of sel.units()) u.die(null);
        break;
      case 'Space':
        game.focusLastEvent();
        e.preventDefault();
        break;
      default:
        break;
    }
  }

  selectAllArmy() {
    const list = [];
    for (const u of this.game.players[this.game.humanId].units) {
      if (u.def.attack || u.def.heal) list.push(u);
    }
    this.game.selection.set(list);
    this.game.audio.play('select');
  }

  cycleIdleWorker(back) {
    const idle = [];
    for (const u of this.game.players[this.game.humanId].units) {
      if (u.order.type === ORDER.IDLE && !u.target) idle.push(u);
    }
    if (!idle.length) return;
    idle.sort((a, b) => a.id - b.id);
    const cur = this.game.selection.primary;
    let i = idle.indexOf(cur);
    i = (i + (back ? -1 : 1) + idle.length) % idle.length;
    this.game.selection.set([idle[i]]);
    this.game.focusSelection();
  }

  /** Screen-space rectangle for the HUD to draw. */
  get boxRect() { return this.dragRect; }
}

export const CLAMP_ZOOM = (d) => clamp(d, 16, WORLD.W * 1.4);
