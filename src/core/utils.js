/** Small maths / helper library shared by every system. */

/* ── ids ────────────────────────────────────────────────────────────── */
let _id = 0;
export const nextId = () => ++_id;

/* ── numbers ────────────────────────────────────────────────────────── */
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v) => clamp(v, 0, 1);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const smoothstep = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const TAU = Math.PI * 2;

export function angleLerp(a, b, t) {
  let d = ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return a + d * t;
}

export function approachAngle(a, b, maxStep) {
  let d = ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI;
  if (Math.abs(d) <= maxStep) return b;
  return a + Math.sign(d) * maxStep;
}

export const dist2 = (ax, az, bx, bz) => { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; };
export const dist = (ax, az, bx, bz) => Math.sqrt(dist2(ax, az, bx, bz));

/* ── seeded RNG (mulberry32 over an FNV-1a string hash) ─────────────── */
export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function makeRng(seed) {
  let a = typeof seed === 'string' ? hashString(seed) : (seed >>> 0) || 1;
  const rng = () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.range = (lo, hi) => lo + rng() * (hi - lo);
  rng.int = (lo, hi) => Math.floor(rng.range(lo, hi + 1));
  rng.pick = (arr) => arr[Math.floor(rng() * arr.length)];
  rng.chance = (p) => rng() < p;
  rng.sign = () => (rng() < 0.5 ? -1 : 1);
  rng.shuffle = (arr) => {
    const a2 = arr.slice();
    for (let i = a2.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a2[i], a2[j]] = [a2[j], a2[i]];
    }
    return a2;
  };
  return rng;
}

/** Non-deterministic RNG for cosmetic effects only. */
export const frand = (lo = 0, hi = 1) => lo + Math.random() * (hi - lo);
export const fpick = (arr) => arr[(Math.random() * arr.length) | 0];

/* ── formatting ─────────────────────────────────────────────────────── */
export function fmtTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function fmtNum(n) {
  if (n >= 100000) return `${Math.round(n / 1000)}k`;
  if (n >= 10000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

/* ── collections ────────────────────────────────────────────────────── */
export function removeFrom(arr, item) {
  const i = arr.indexOf(item);
  if (i >= 0) arr.splice(i, 1);
  return i >= 0;
}

export function groupBy(items, keyFn) {
  const out = new Map();
  for (const it of items) {
    const k = keyFn(it);
    let bucket = out.get(k);
    if (!bucket) out.set(k, (bucket = []));
    bucket.push(it);
  }
  return out;
}

/** Cheapest-first partial sort: returns the n smallest by score. */
export function nSmallest(items, n, scoreFn) {
  return items
    .map((it) => ({ it, s: scoreFn(it) }))
    .sort((a, b) => a.s - b.s)
    .slice(0, n)
    .map((x) => x.it);
}

/* ── geometry helpers ───────────────────────────────────────────────── */

/** Points spread over a loose grid formation facing `angle`. */
export function formationOffsets(count, spacing = 3.1, angle = 0) {
  const pts = [];
  if (count <= 1) return [[0, 0]];
  const cols = Math.max(1, Math.ceil(Math.sqrt(count * 1.35)));
  const rows = Math.ceil(count / cols);
  const ca = Math.cos(angle), sa = Math.sin(angle);
  for (let i = 0; i < count; i++) {
    const r = Math.floor(i / cols), c = i % cols;
    const inRow = Math.min(cols, count - r * cols);
    const x = (c - (inRow - 1) / 2) * spacing;
    const z = (r - (rows - 1) / 2) * spacing;
    pts.push([x * ca - z * sa, x * sa + z * ca]);
  }
  return pts;
}

/** Deterministic-ish ring of points used for scattering props. */
export function ringPoints(cx, cz, radius, count, phase = 0) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const a = phase + (i / count) * TAU;
    out.push([cx + Math.cos(a) * radius, cz + Math.sin(a) * radius]);
  }
  return out;
}

export function pointInRect(px, pz, cx, cz, hw, hd) {
  return px >= cx - hw && px <= cx + hw && pz >= cz - hd && pz <= cz + hd;
}

/* ── timing ─────────────────────────────────────────────────────────── */
/** Fires `fn` at most every `period` seconds; call `tick(dt)` each frame. */
export class Throttle {
  constructor(period, phase = 0) { this.period = period; this.t = phase; }
  tick(dt) {
    this.t += dt;
    if (this.t >= this.period) { this.t -= this.period; return true; }
    return false;
  }
}

/** Round-robin work spreader: yields a slice of a list each call. */
export class Slicer {
  constructor(perTick = 12) { this.perTick = perTick; this.cursor = 0; }
  *take(list) {
    const n = list.length;
    if (n === 0) { this.cursor = 0; return; }
    const count = Math.min(this.perTick, n);
    for (let i = 0; i < count; i++) {
      yield list[(this.cursor + i) % n];
    }
    this.cursor = (this.cursor + count) % n;
  }
}

/* ── colour ─────────────────────────────────────────────────────────── */
export function mixHex(a, b, t) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return ((lerp(ar, br, t) | 0) << 16) | ((lerp(ag, bg, t) | 0) << 8) | (lerp(ab, bb, t) | 0);
}

export function hexToCss(h) { return `#${h.toString(16).padStart(6, '0')}`; }

export function shade(hex, amount) {
  return mixHex(hex, amount > 0 ? 0xffffff : 0x000000, Math.abs(amount));
}
