/**
 * Minimap: desk outline, terrain, fog, zones, entities and the camera frustum.
 * Left-click (or drag) jumps the camera; right-click issues a move order.
 */
import * as THREE from 'three';
import { WORLD, TEAM_COLORS, RES_META, ORDER } from '../core/constants.js';
import { clamp, formationOffsets } from '../core/utils.js';

export class Minimap {
  constructor(game, signal) {
    this.game = game;
    this.signal = signal;
    this.canvas = document.getElementById('minimap');
    this.ctx = this.canvas.getContext('2d');
    this.w = this.canvas.width;
    this.h = this.canvas.height;
    this.dragging = false;
    this.pings = [];
    this._terrain = null;
    this._corner = new THREE.Vector3();
    this._ray = new THREE.Raycaster();
    this._plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    this._bind(signal);
    this._bakeTerrain();
  }

  /* world ↔ minimap */
  toMap(x, z) {
    return [
      ((x + WORLD.W / 2) / WORLD.W) * this.w,
      ((z + WORLD.D / 2) / WORLD.D) * this.h,
    ];
  }
  toWorld(mx, my) {
    const r = this.canvas.getBoundingClientRect();
    const nx = (mx - r.left) / r.width;
    const nz = (my - r.top) / r.height;
    return [nx * WORLD.W - WORLD.W / 2, nz * WORLD.D - WORLD.D / 2];
  }

  _bind(signal) {
    const c = this.canvas;
    const opt = { signal };
    c.addEventListener('contextmenu', (e) => e.preventDefault(), opt);
    c.addEventListener('pointerdown', (e) => {
      const [x, z] = this.toWorld(e.clientX, e.clientY);
      if (e.button === 2) {
        const units = this.game.selection.units().filter((u) => u.owner === this.game.humanId);
        if (units.length) {
          const offsets = formationOffsets(units.length, 3.2, 0);
          units.forEach((u, i) => u.issue({
            type: e.shiftKey ? ORDER.ATTACK_MOVE : ORDER.MOVE,
            x: x + offsets[i][0], z: z + offsets[i][1],
          }, { queued: e.shiftKey }));
          this.game.audio.play('order');
          this.ping(x, z, '#a8d0ff');
        }
      } else {
        this.dragging = true;
        this.game.controls.focusOn(x, z);
        c.setPointerCapture(e.pointerId);
      }
    }, opt);
    c.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const [x, z] = this.toWorld(e.clientX, e.clientY);
      this.game.controls.focusOn(x, z);
    }, opt);
    c.addEventListener('pointerup', (e) => {
      this.dragging = false;
      c.releasePointerCapture?.(e.pointerId);
    }, opt);
  }

  /** Terrain never changes, so draw it once into an offscreen canvas. */
  _bakeTerrain() {
    const off = document.createElement('canvas');
    off.width = this.w; off.height = this.h;
    const ctx = off.getContext('2d');
    const grid = this.game.grid;

    ctx.fillStyle = '#8d6a44';
    ctx.fillRect(0, 0, this.w, this.h);

    const cw = this.w / grid.w, ch = this.h / grid.d;
    for (let gz = 0; gz < grid.d; gz++) {
      for (let gx = 0; gx < grid.w; gx++) {
        const i = grid.idx(gx, gz);
        const h = grid.height[i];
        const blocked = grid.flags[i] & 1;
        if (h > 0.4) {
          const t = clamp(h / 6, 0, 1);
          ctx.fillStyle = `rgba(${180 + t * 40 | 0},${150 + t * 40 | 0},${110 + t * 30 | 0},0.95)`;
          ctx.fillRect(gx * cw, gz * ch, cw + 0.6, ch + 0.6);
        } else if (blocked) {
          ctx.fillStyle = 'rgba(70,60,48,0.85)';
          ctx.fillRect(gx * cw, gz * ch, cw + 0.6, ch + 0.6);
        }
      }
    }

    // zone outlines
    for (const zone of this.game.map.zones) {
      const [x, y] = this.toMap(zone.x, zone.z);
      ctx.beginPath();
      ctx.arc(x, y, (zone.radius / WORLD.W) * this.w, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.16)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    this._terrain = off;
  }

  ping(x, z, color = '#ffffff') {
    this.pings.push({ x, z, color, t: 0 });
  }

  /* ── draw ─────────────────────────────────────────────────────────── */
  draw(dt) {
    const ctx = this.ctx;
    const game = this.game;
    const me = game.humanId;

    ctx.clearRect(0, 0, this.w, this.h);
    ctx.drawImage(this._terrain, 0, 0);

    // zone ownership tint
    for (const zone of game.map.zones) {
      if (zone.owner < 0) continue;
      const [x, y] = this.toMap(zone.x, zone.z);
      const r = (zone.radius / WORLD.W) * this.w;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = zone.owner === me ? 'rgba(74,143,231,0.20)' : 'rgba(226,86,74,0.20)';
      ctx.fill();
    }

    // resource nodes
    for (const node of game.map.nodes) {
      if (!game.fog.isExplored(me, node.x, node.z)) continue;
      const [x, y] = this.toMap(node.x, node.z);
      ctx.beginPath();
      ctx.arc(x, y, 2.6, 0, Math.PI * 2);
      ctx.fillStyle = RES_META[node.type].css;
      ctx.fill();
      if (node.extractor && node.extractor.alive) {
        ctx.strokeStyle = TEAM_COLORS[node.extractor.owner].css;
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }
    }

    // entities
    for (const e of game.allEntities()) {
      if (!e.alive) continue;
      const visible = e.owner === me
        || (e.isBuilding ? game.fog.isExplored(me, e.pos.x, e.pos.z) : e.mesh?.visible);
      if (!visible) continue;
      const [x, y] = this.toMap(e.pos.x, e.pos.z);
      const col = TEAM_COLORS[e.owner].css;
      if (e.isBuilding) {
        const s = e.def.id === 'hq' ? 5 : 3.4;
        ctx.fillStyle = col;
        ctx.fillRect(x - s / 2, y - s / 2, s, s);
        if (e.selected) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.strokeRect(x - s / 2 - 1, y - s / 2 - 1, s + 2, s + 2); }
      } else {
        ctx.beginPath();
        ctx.arc(x, y, e.selected ? 2.6 : 1.8, 0, Math.PI * 2);
        ctx.fillStyle = e.selected ? '#ffffff' : col;
        ctx.fill();
      }
      // recently hit → flash
      if (game.time - e.lastDamaged < 1.2) {
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,120,90,0.7)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    // fog veil
    this._drawFog(ctx);

    // pings
    for (let i = this.pings.length - 1; i >= 0; i--) {
      const p = this.pings[i];
      p.t += dt;
      if (p.t > 1.1) { this.pings.splice(i, 1); continue; }
      const [x, y] = this.toMap(p.x, p.z);
      ctx.beginPath();
      ctx.arc(x, y, 3 + p.t * 12, 0, Math.PI * 2);
      ctx.strokeStyle = p.color;
      ctx.globalAlpha = 1 - p.t / 1.1;
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    this._drawViewport(ctx);
  }

  _drawFog(ctx) {
    const fog = this.game.fog;
    if (!fog.enabled) return;
    const me = this.game.humanId;
    const g = fog.grids[me];
    const fw = this.w / (WORLD.W / WORLD.VISION_CELL);
    const fh = this.h / (WORLD.D / WORLD.VISION_CELL);
    const cols = Math.round(WORLD.W / WORLD.VISION_CELL);
    const rows = Math.round(WORLD.D / WORLD.VISION_CELL);
    for (let gz = 0; gz < rows; gz++) {
      for (let gx = 0; gx < cols; gx++) {
        const v = g[gz * cols + gx];
        if (v === 2) continue;
        ctx.fillStyle = v === 1 ? 'rgba(6,8,12,0.42)' : 'rgba(6,8,12,0.86)';
        ctx.fillRect(gx * fw, gz * fh, fw + 0.5, fh + 0.5);
      }
    }
  }

  /** Project the four screen corners onto the desk to outline what you see. */
  _drawViewport(ctx) {
    const cam = this.game.camera;
    const pts = [];
    for (const [nx, ny] of [[-1, 1], [1, 1], [1, -1], [-1, -1]]) {
      this._ray.setFromCamera({ x: nx, y: ny }, cam);
      const hit = this._ray.ray.intersectPlane(this._plane, this._corner);
      if (!hit) return;
      pts.push(this.toMap(
        clamp(this._corner.x, -WORLD.W, WORLD.W),
        clamp(this._corner.z, -WORLD.D, WORLD.D)
      ));
    }
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
}
