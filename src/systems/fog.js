/**
 * Fog of war.
 *
 * Two coarse grids (one per side) hold 0 = never seen, 1 = explored,
 * 2 = currently visible. The human grid also drives a canvas texture laid
 * over the desk, and decides which enemy meshes are allowed to render.
 *
 * Cloaked units (sticky spies, tack traps) additionally require a detector
 * in range — the Protractor Radar, the Surface Pro Lab, guard towers and
 * the HQ all count.
 */
import * as THREE from 'three';
import { FOG_W, FOG_D, WORLD, BALANCE } from '../core/constants.js';
import { clamp } from '../core/utils.js';

const VC = WORLD.VISION_CELL;
const HALF_W = WORLD.W / 2;
const HALF_D = WORLD.D / 2;

export class Fog {
  constructor(game) {
    this.game = game;
    this.enabled = true;
    this.grids = [new Uint8Array(FOG_W * FOG_D), new Uint8Array(FOG_W * FOG_D)];
    this.detectors = [[], []];
    this.timer = 0;
    this.interval = 0.12;

    const SS = 4;   // supersample so the blur has something to work with
    this.canvas = document.createElement('canvas');
    this.canvas.width = FOG_W * SS;
    this.canvas.height = FOG_D * SS;
    this.ss = SS;
    this.ctx = this.canvas.getContext('2d');

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;

    this.plane = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD.W + 6, WORLD.D + 6),
      new THREE.MeshBasicMaterial({
        map: this.texture, transparent: true, depthWrite: false,
        color: 0x05070b, opacity: 1,
      })
    );
    this.plane.rotation.x = -Math.PI / 2;
    this.plane.position.y = 0.3;
    this.plane.renderOrder = 2;
    game.scene.add(this.plane);

    this._paint();
  }

  idx(gx, gz) { return gz * FOG_W + gx; }
  cellX(x) { return clamp(Math.floor((x + HALF_W) / VC), 0, FOG_W - 1); }
  cellZ(z) { return clamp(Math.floor((z + HALF_D) / VC), 0, FOG_D - 1); }

  valueAt(player, x, z) {
    if (!this.enabled) return 2;
    return this.grids[player][this.idx(this.cellX(x), this.cellZ(z))];
  }

  isVisible(player, x, z) { return this.valueAt(player, x, z) === 2; }
  isExplored(player, x, z) { return this.valueAt(player, x, z) >= 1; }

  /* ── vision stamping ──────────────────────────────────────────────── */
  update(dt) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = this.interval;

    for (let p = 0; p < 2; p++) {
      const g = this.grids[p];
      for (let i = 0; i < g.length; i++) if (g[i] === 2) g[i] = 1;
      this.detectors[p].length = 0;
    }

    const combat = this.game.combat;
    const stamp = (p, x, z, radius) => {
      const g = this.grids[p];
      const r = radius / VC;
      const cx = (x + HALF_W) / VC, cz = (z + HALF_D) / VC;
      const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(FOG_W - 1, Math.ceil(cx + r));
      const z0 = Math.max(0, Math.floor(cz - r)), z1 = Math.min(FOG_D - 1, Math.ceil(cz + r));
      const r2 = r * r;
      for (let gz = z0; gz <= z1; gz++) {
        const dz = gz + 0.5 - cz;
        for (let gx = x0; gx <= x1; gx++) {
          const dx = gx + 0.5 - cx;
          if (dx * dx + dz * dz <= r2) g[gz * FOG_W + gx] = 2;
        }
      }
    };

    for (const e of this.game.allEntities()) {
      if (!e.alive || e.owner > 1) continue;
      const sight = combat.sightFor(e) * (e.isBuilding && !e.built ? 0.6 : 1);
      stamp(e.owner, e.pos.x, e.pos.z, sight);
      if (e.def.reveal) stamp(e.owner, e.pos.x, e.pos.z, e.def.reveal * this.game.players[e.owner].mods.detectorRange);
      if (e.def.detector) {
        this.detectors[e.owner].push({
          x: e.pos.x, z: e.pos.z,
          r: Math.max(combat.detectRangeFor(e), BALANCE.CLOAK_DETECT_RANGE),
        });
      }
    }

    this._paint();
    this.refreshVisibility();
  }

  /** Is `entity` (cloaked or not) currently detectable by `playerId`? */
  detectedBy(entity, playerId) {
    if (!entity.isCloaked) return true;
    for (const d of this.detectors[playerId]) {
      const dx = d.x - entity.pos.x, dz = d.z - entity.pos.z;
      if (dx * dx + dz * dz <= d.r * d.r) return true;
    }
    return false;
  }

  /* ── mesh culling for the human player ────────────────────────────── */
  refreshVisibility() {
    const me = this.game.humanId;
    for (const e of this.game.allEntities()) {
      if (!e.alive || !e.mesh) continue;
      if (e.owner === me) { e.mesh.visible = true; continue; }

      const v = this.valueAt(me, e.pos.x, e.pos.z);
      let show;
      if (e.isBuilding) show = v >= 1;       // structures stay on the map once seen
      else show = v === 2;

      if (show && e.isCloaked) {
        const det = this.detectedBy(e, me);
        e._detected = det;
        show = det;
      } else if (e.isUnit) {
        e._detected = show;
      }
      e.mesh.visible = show;
      if (!show && e.selected) this.game.selection.remove(e);
    }
  }

  /* ── texture ──────────────────────────────────────────────────────── */
  _paint() {
    const ctx = this.ctx;
    const g = this.grids[this.game.humanId];
    const s = this.ss;
    ctx.filter = 'none';
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!this.enabled) { this.texture.needsUpdate = true; return; }

    ctx.filter = 'blur(3px)';
    for (let gz = 0; gz < FOG_D; gz++) {
      for (let gx = 0; gx < FOG_W; gx++) {
        const v = g[gz * FOG_W + gx];
        if (v === 2) continue;
        ctx.fillStyle = v === 1 ? 'rgba(0,0,0,0.44)' : 'rgba(0,0,0,0.93)';
        ctx.fillRect(gx * s - 1, gz * s - 1, s + 2, s + 2);
      }
    }
    ctx.filter = 'none';
    this.texture.needsUpdate = true;
  }

  setEnabled(on) {
    this.enabled = on;
    this.plane.visible = on;
    if (!on) {
      for (const gr of this.grids) gr.fill(2);
      this.refreshVisibility();
    }
    this._paint();
  }

  /** Reveal everything permanently — used by the post-match camera. */
  revealAll() {
    for (const gr of this.grids) gr.fill(2);
    this.plane.visible = false;
    this.refreshVisibility();
  }

  dispose() {
    this.game.scene.remove(this.plane);
    this.plane.geometry.dispose();
    this.plane.material.dispose();
    this.texture.dispose();
  }
}
