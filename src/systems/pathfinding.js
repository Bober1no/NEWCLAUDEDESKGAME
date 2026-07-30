/**
 * Terrain grid, A* pathing and the request queue that keeps it cheap.
 *
 * The desk is diced into 2-unit cells. Each cell stores a flag byte, a
 * height (book stacks are plateaus) and a movement cost. Ground units path
 * through this; aircraft ignore it entirely.
 *
 * Path requests are queued and serviced with a per-frame budget, so a
 * forty-unit move order never blows the frame time. While a unit waits for
 * its path it steers straight at the goal, which looks like a normal
 * "everyone starts walking immediately" RTS response.
 */
import { WORLD, GRID_W, GRID_D, CELLFLAG } from '../core/constants.js';
import { clamp } from '../core/utils.js';

const HALF_W = WORLD.W / 2;
const HALF_D = WORLD.D / 2;
const C = WORLD.CELL;
const SQRT2 = Math.SQRT2;

/* ─────────────────────────────────────────────────────────────────────
   Grid
   ───────────────────────────────────────────────────────────────────── */
export class TerrainGrid {
  constructor() {
    this.w = GRID_W;
    this.d = GRID_D;
    const n = this.w * this.d;
    this.flags = new Uint8Array(n);
    this.height = new Float32Array(n);
    this.cost = new Float32Array(n).fill(1);
    this.occupant = new Int32Array(n);   // entity id of a blocking structure, 0 = free
    this.version = 0;                    // bumped on any structural change
  }

  idx(gx, gz) { return gz * this.w + gx; }
  inBounds(gx, gz) { return gx >= 0 && gz >= 0 && gx < this.w && gz < this.d; }

  cellX(x) { return clamp(Math.floor((x + HALF_W) / C), 0, this.w - 1); }
  cellZ(z) { return clamp(Math.floor((z + HALF_D) / C), 0, this.d - 1); }
  worldX(gx) { return (gx + 0.5) * C - HALF_W; }
  worldZ(gz) { return (gz + 0.5) * C - HALF_D; }

  isBlocked(gx, gz) {
    if (!this.inBounds(gx, gz)) return true;
    return (this.flags[this.idx(gx, gz)] & CELLFLAG.BLOCKED) !== 0;
  }

  blockedAt(x, z) { return this.isBlocked(this.cellX(x), this.cellZ(z)); }

  heightAt(x, z) {
    const gx = this.cellX(x), gz = this.cellZ(z);
    return this.height[this.idx(gx, gz)];
  }

  costAt(x, z) {
    const gx = this.cellX(x), gz = this.cellZ(z);
    return this.cost[this.idx(gx, gz)];
  }

  flagsAt(x, z) { return this.flags[this.idx(this.cellX(x), this.cellZ(z))]; }

  /** Rectangular stamp in world space. */
  stampRect(cx, cz, hw, hd, { blocked = false, clutter = false, elevated = false, height = null, cost = null, id = 0 } = {}) {
    const x0 = this.cellX(cx - hw), x1 = this.cellX(cx + hw);
    const z0 = this.cellZ(cz - hd), z1 = this.cellZ(cz + hd);
    for (let gz = z0; gz <= z1; gz++) {
      for (let gx = x0; gx <= x1; gx++) {
        const i = this.idx(gx, gz);
        if (blocked) { this.flags[i] |= CELLFLAG.BLOCKED; this.occupant[i] = id; }
        if (clutter) this.flags[i] |= CELLFLAG.CLUTTER;
        if (elevated) this.flags[i] |= CELLFLAG.ELEVATED;
        if (height != null) this.height[i] = Math.max(this.height[i], height);
        if (cost != null) this.cost[i] = Math.max(this.cost[i], cost);
      }
    }
    this.version++;
  }

  clearRect(cx, cz, hw, hd, id = 0) {
    const x0 = this.cellX(cx - hw), x1 = this.cellX(cx + hw);
    const z0 = this.cellZ(cz - hd), z1 = this.cellZ(cz + hd);
    for (let gz = z0; gz <= z1; gz++) {
      for (let gx = x0; gx <= x1; gx++) {
        const i = this.idx(gx, gz);
        if (id === 0 || this.occupant[i] === id) {
          this.flags[i] &= ~CELLFLAG.BLOCKED;
          this.occupant[i] = 0;
          this.cost[i] = (this.flags[i] & CELLFLAG.CLUTTER) ? 1.7 : 1;
        }
      }
    }
    this.version++;
  }

  /** Lay a walkable tape bridge across blocked cells. */
  bridge(x0, z0, x1, z1, width = 2.4) {
    const steps = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / (C * 0.5));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
      const gx0 = this.cellX(x - width / 2), gx1 = this.cellX(x + width / 2);
      const gz0 = this.cellZ(z - width / 2), gz1 = this.cellZ(z + width / 2);
      for (let gz = gz0; gz <= gz1; gz++) {
        for (let gx = gx0; gx <= gx1; gx++) {
          const i = this.idx(gx, gz);
          if (this.occupant[i]) continue;      // never bridge through a building
          this.flags[i] &= ~CELLFLAG.BLOCKED;
          this.flags[i] |= CELLFLAG.BRIDGE;
          this.cost[i] = 0.95;
        }
      }
    }
    this.version++;
  }

  /** Nearest free cell to a world point, spiralling outwards. */
  nearestFree(x, z, maxRings = 14) {
    let gx = this.cellX(x), gz = this.cellZ(z);
    if (!this.isBlocked(gx, gz)) return [this.worldX(gx), this.worldZ(gz)];
    for (let r = 1; r <= maxRings; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const nx = gx + dx, nz = gz + dz;
          if (!this.inBounds(nx, nz)) continue;
          if (!this.isBlocked(nx, nz)) return [this.worldX(nx), this.worldZ(nz)];
        }
      }
    }
    return [x, z];
  }

  /** Bresenham-ish walkability test used for path smoothing. */
  lineWalkable(x0, z0, x1, z1) {
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    const steps = Math.ceil(len / (C * 0.6));
    if (steps === 0) return !this.blockedAt(x0, z0);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (this.blockedAt(x0 + dx * t, z0 + dz * t)) return false;
    }
    return true;
  }

  /** True if the straight line never crosses a taller plateau (for shots). */
  lineOfSight(x0, z0, y0, x1, z1, y1) {
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len < 0.001) return true;
    const steps = Math.min(48, Math.ceil(len / C));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const h = this.heightAt(x0 + dx * t, z0 + dz * t);
      const rayY = y0 + (y1 - y0) * t;
      if (h > rayY + 1.1) return false;
    }
    return true;
  }
}

/* ─────────────────────────────────────────────────────────────────────
   Binary min-heap for A*
   ───────────────────────────────────────────────────────────────────── */
class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  clear() { this.a.length = 0; }
  push(node, f) {
    const a = this.a;
    a.push({ node, f });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let s = i;
        if (l < a.length && a[l].f < a[s].f) s = l;
        if (r < a.length && a[r].f < a[s].f) s = r;
        if (s === i) break;
        [a[s], a[i]] = [a[i], a[s]];
        i = s;
      }
    }
    return top.node;
  }
}

/* ─────────────────────────────────────────────────────────────────────
   A*
   ───────────────────────────────────────────────────────────────────── */
const NEIGHBOURS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2],
];

export class Pathfinder {
  constructor(grid) {
    this.grid = grid;
    const n = grid.w * grid.d;
    this.gScore = new Float32Array(n);
    this.fScore = new Float32Array(n);
    this.cameFrom = new Int32Array(n);
    this.stamp = new Int32Array(n);
    this.closed = new Uint8Array(n);
    this.run = 0;
    this.heap = new Heap();
    this.maxExpansions = 2000;
    this.climbPenalty = 2.6;   // extra cost per metre of height climbed
  }

  /**
   * @returns {Array<[number,number]>} world-space waypoints, or null.
   */
  find(sx, sz, tx, tz, { climb = true } = {}) {
    const g = this.grid;
    const start = { x: g.cellX(sx), z: g.cellZ(sz) };
    let goal = { x: g.cellX(tx), z: g.cellZ(tz) };

    if (g.isBlocked(goal.x, goal.z)) {
      const [fx, fz] = g.nearestFree(tx, tz);
      goal = { x: g.cellX(fx), z: g.cellZ(fz) };
    }
    const startI = g.idx(start.x, start.z);
    const goalI = g.idx(goal.x, goal.z);
    if (startI === goalI) return [[tx, tz]];

    // Fast path: clear line of sight, skip the search entirely.
    if (g.lineWalkable(sx, sz, tx, tz)) return [[tx, tz]];

    const run = ++this.run;
    const { gScore, fScore, cameFrom, stamp, closed, heap } = this;
    heap.clear();

    const h = (i) => {
      const cx = i % g.w, cz = (i / g.w) | 0;
      const dx = Math.abs(cx - goal.x), dz = Math.abs(cz - goal.z);
      return (dx + dz) + (SQRT2 - 2) * Math.min(dx, dz);
    };

    stamp[startI] = run;
    closed[startI] = 0;
    gScore[startI] = 0;
    fScore[startI] = h(startI);
    cameFrom[startI] = -1;
    heap.push(startI, fScore[startI]);

    let expansions = 0;
    let best = startI, bestH = fScore[startI];

    while (heap.size) {
      const cur = heap.pop();
      if (closed[cur] === run) continue;
      closed[cur] = run;

      if (cur === goalI) { best = cur; break; }
      if (++expansions > this.maxExpansions) break;

      const cx = cur % g.w, cz = (cur / g.w) | 0;
      const curH = g.height[cur];

      for (let n = 0; n < 8; n++) {
        const [dx, dz, base] = NEIGHBOURS[n];
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= g.w || nz >= g.d) continue;
        const ni = nz * g.w + nx;
        if (g.flags[ni] & CELLFLAG.BLOCKED) continue;
        // no cutting a corner between two blocked orthogonals
        if (dx && dz) {
          if ((g.flags[cz * g.w + nx] & CELLFLAG.BLOCKED) ||
              (g.flags[nz * g.w + cx] & CELLFLAG.BLOCKED)) continue;
        }
        const dh = g.height[ni] - curH;
        if (!climb && dh > 0.6) continue;
        let step = base * g.cost[ni];
        if (dh > 0.1) step += dh * this.climbPenalty;
        else if (dh < -0.1) step += -dh * 0.35;

        const tentative = gScore[cur] + step;
        if (stamp[ni] !== run) {
          stamp[ni] = run; closed[ni] = 0; gScore[ni] = Infinity;
        }
        if (tentative < gScore[ni]) {
          gScore[ni] = tentative;
          cameFrom[ni] = cur;
          const hv = h(ni);
          fScore[ni] = tentative + hv * 1.06;   // slight weight: faster, near-optimal
          heap.push(ni, fScore[ni]);
          if (hv < bestH) { bestH = hv; best = ni; }
        }
      }
    }

    // reconstruct (from the goal, or the closest node reached)
    const cells = [];
    let cur = best;
    let guard = 0;
    while (cur !== -1 && guard++ < 6000) {
      cells.push(cur);
      if (cur === startI) break;
      cur = stamp[cur] === run ? cameFrom[cur] : -1;
    }
    cells.reverse();
    if (cells.length < 2) return null;

    const pts = cells.map((i) => [g.worldX(i % g.w), g.worldZ((i / g.w) | 0)]);
    pts[pts.length - 1] = best === goalI ? [tx, tz] : pts[pts.length - 1];
    return this.smooth(pts);
  }

  /** String-pull: drop waypoints we can see past. */
  smooth(pts) {
    if (pts.length <= 2) return pts;
    const g = this.grid;
    const out = [pts[0]];
    let anchor = 0;
    for (let i = 2; i < pts.length; i++) {
      const [ax, az] = pts[anchor];
      const [bx, bz] = pts[i];
      const sameHeight = Math.abs(g.heightAt(ax, az) - g.heightAt(bx, bz)) < 0.5;
      if (!sameHeight || !g.lineWalkable(ax, az, bx, bz)) {
        out.push(pts[i - 1]);
        anchor = i - 1;
      }
    }
    out.push(pts[pts.length - 1]);
    out.shift();               // the first point is where we already stand
    return out.length ? out : [pts[pts.length - 1]];
  }
}

/* ─────────────────────────────────────────────────────────────────────
   Request queue
   ───────────────────────────────────────────────────────────────────── */
export class PathService {
  constructor(grid, budgetPerFrame = 7) {
    this.grid = grid;
    this.finder = new Pathfinder(grid);
    this.queue = [];
    this.pending = new Set();
    this.budget = budgetPerFrame;
    this.solved = 0;
  }

  request(unit, tx, tz, priority = 0) {
    if (this.pending.has(unit.id)) {
      // replace the outstanding request with the newer destination
      const existing = this.queue.find((q) => q.unit.id === unit.id);
      if (existing) { existing.tx = tx; existing.tz = tz; existing.priority = priority; return; }
    }
    this.pending.add(unit.id);
    this.queue.push({ unit, tx, tz, priority });
  }

  cancel(unit) {
    if (!this.pending.has(unit.id)) return;
    this.pending.delete(unit.id);
    const i = this.queue.findIndex((q) => q.unit.id === unit.id);
    if (i >= 0) this.queue.splice(i, 1);
  }

  update() {
    if (!this.queue.length) return;
    if (this.queue.length > 4) this.queue.sort((a, b) => b.priority - a.priority);
    let n = Math.min(this.budget, this.queue.length);
    while (n-- > 0) {
      const job = this.queue.shift();
      if (!job) break;
      this.pending.delete(job.unit.id);
      const u = job.unit;
      if (!u.alive) continue;
      const path = this.finder.find(u.pos.x, u.pos.z, job.tx, job.tz);
      this.solved++;
      u.onPathResult(path, job.tx, job.tz);
    }
  }
}
