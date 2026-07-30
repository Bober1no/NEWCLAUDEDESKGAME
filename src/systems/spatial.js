/**
 * Uniform-grid spatial index.
 *
 * Rebuilt from scratch every tick — with a few hundred entities that is far
 * cheaper than incremental bookkeeping, and it can never go stale.
 */
import { WORLD } from '../core/constants.js';
import { clamp } from '../core/utils.js';

const BUCKET = 12;

export class SpatialIndex {
  constructor() {
    this.w = Math.ceil(WORLD.W / BUCKET) + 2;
    this.d = Math.ceil(WORLD.D / BUCKET) + 2;
    this.cells = new Array(this.w * this.d);
    for (let i = 0; i < this.cells.length; i++) this.cells[i] = [];
    this.halfW = WORLD.W / 2 + BUCKET;
    this.halfD = WORLD.D / 2 + BUCKET;
  }

  _cx(x) { return clamp(Math.floor((x + this.halfW) / BUCKET), 0, this.w - 1); }
  _cz(z) { return clamp(Math.floor((z + this.halfD) / BUCKET), 0, this.d - 1); }

  rebuild(entities) {
    for (const c of this.cells) c.length = 0;
    for (const e of entities) {
      if (!e.alive) continue;
      this.cells[this._cz(e.pos.z) * this.w + this._cx(e.pos.x)].push(e);
    }
  }

  /** Calls `fn(entity)` for everything whose bucket overlaps the circle. */
  forEachNear(x, z, radius, fn) {
    const r = radius + BUCKET * 0.5;
    const x0 = this._cx(x - r), x1 = this._cx(x + r);
    const z0 = this._cz(z - r), z1 = this._cz(z + r);
    for (let gz = z0; gz <= z1; gz++) {
      const row = gz * this.w;
      for (let gx = x0; gx <= x1; gx++) {
        const bucket = this.cells[row + gx];
        for (let i = 0; i < bucket.length; i++) fn(bucket[i]);
      }
    }
  }

  /** Everything strictly inside the circle, optionally filtered. */
  query(x, z, radius, filter = null, out = []) {
    out.length = 0;
    const r2 = radius * radius;
    this.forEachNear(x, z, radius, (e) => {
      const dx = e.pos.x - x, dz = e.pos.z - z;
      if (dx * dx + dz * dz > r2) return;
      if (filter && !filter(e)) return;
      out.push(e);
    });
    return out;
  }

  /** Closest entity passing the filter, or null. */
  nearest(x, z, radius, filter = null) {
    let best = null, bd = radius * radius;
    this.forEachNear(x, z, radius, (e) => {
      if (filter && !filter(e)) return;
      const dx = e.pos.x - x, dz = e.pos.z - z;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = e; }
    });
    return best;
  }
}
