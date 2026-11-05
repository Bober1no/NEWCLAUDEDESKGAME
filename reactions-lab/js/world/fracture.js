// Fracture geometry.
//  • vesselShards(): a glass vessel pre-scored into jittered curved shards (outer + inner skin + edge faces)
//    following its exact lathe profile, plus base wedges, with an adjacency graph.
//  • voronoi(): convex polygon split into Voronoi cells (seeds biased around an impact = local shatter).
//  • prism(): a 2D cell extruded to a pane/tile shard.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export function rng(seed) { let s = (seed >>> 0) || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; }; }

class GeoBuilder {
  constructor() { this.p = []; this.uv = []; this.idx = []; }
  v(x, y, z, u = 0, w = 0) { this.p.push(x, y, z); this.uv.push(u, w); return this.p.length / 3 - 1; }
  /** triangle oriented so its normal faces `ref` */
  tri(a, b, c, ref) {
    const P = this.p, ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
    const ux = P[b * 3] - ax, uy = P[b * 3 + 1] - ay, uz = P[b * 3 + 2] - az, vx = P[c * 3] - ax, vy = P[c * 3 + 1] - ay, vz = P[c * 3 + 2] - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * ref.x + ny * ref.y + nz * ref.z < 0) this.idx.push(a, c, b); else this.idx.push(a, b, c);
  }
  quad(a, b, c, d, ref) { this.tri(a, b, c, ref); this.tri(a, c, d, ref); }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx); g.computeVertexNormals(); g.computeBoundingSphere(); return g;
  }
}

/** ud = {outer(y), wall, base, top} → {shards:[{geo, c, verts, kind}], adj:[Set]} */
export function vesselShards(ud, seed = 1) {
  const r = rng(seed), { outer, wall, base, top } = ud;
  const Rm = outer((base + top) * 0.5);
  const nA = clamp(Math.round(2 * Math.PI * Rm / 0.024), 6, 16), nH = clamp(Math.round((top - base) / 0.026), 2, 9);
  const TH = [], YS = [];
  for (let j = 0; j <= nH; j++) {
    TH.push([]); YS.push([]);
    const stagger = (j % 2) * 0.5;
    for (let i = 0; i < nA; i++) {
      const jt = j === 0 || j === nH ? 0.18 : 0.4;
      TH[j].push(((i + stagger + (r() - 0.5) * jt) / nA) * Math.PI * 2);
      YS[j].push(j === 0 ? base : j === nH ? top : base + (top - base) * (j + (r() - 0.5) * 0.55) / nH);
    }
  }
  const th = (j, i) => (i >= nA ? TH[j][i - nA] + Math.PI * 2 : TH[j][i]);
  const ys = (j, i) => YS[j][i % nA];
  const shards = [], S = 3, T = 3, ref = new THREE.Vector3();
  const pt = (t, y, rad) => [Math.sin(t) * rad, y, Math.cos(t) * rad];
  for (let j = 0; j < nH; j++) for (let i = 0; i < nA; i++) {
    const A = [th(j, i), ys(j, i)], B = [th(j, i + 1), ys(j, i + 1)], D = [th(j + 1, i), ys(j + 1, i)], C = [th(j + 1, i + 1), ys(j + 1, i + 1)];
    // the stagger shifts the upper row by half a cell; keep corners ordered by unwrapping
    if (C[0] < A[0]) C[0] += Math.PI * 2; if (D[0] < A[0] - Math.PI) D[0] += Math.PI * 2;
    const g = new GeoBuilder(); const O = [], I = [];
    const par = (u, v) => { const t = (A[0] + (B[0] - A[0]) * u) * (1 - v) + (D[0] + (C[0] - D[0]) * u) * v; const y = (A[1] + (B[1] - A[1]) * u) * (1 - v) + (D[1] + (C[1] - D[1]) * u) * v; return [t, y]; };
    for (let tv = 0; tv <= T; tv++) for (let s = 0; s <= S; s++) {
      const [t, y] = par(s / S, tv / T); const ro = Math.max(0.0006, outer(y)), ri = Math.max(0.0003, ro - wall);
      O.push(g.v(...pt(t, y, ro), t, y)); I.push(g.v(...pt(t, y, ri), t, y));
    }
    const id = (s, tv) => tv * (S + 1) + s;
    for (let tv = 0; tv < T; tv++) for (let s = 0; s < S; s++) {
      const [t] = par((s + 0.5) / S, (tv + 0.5) / T); ref.set(Math.sin(t), 0, Math.cos(t));
      g.quad(O[id(s, tv)], O[id(s + 1, tv)], O[id(s + 1, tv + 1)], O[id(s, tv + 1)], ref);
      ref.multiplyScalar(-1); g.quad(I[id(s, tv)], I[id(s + 1, tv)], I[id(s + 1, tv + 1)], I[id(s, tv + 1)], ref);
    }
    // edge faces (fresh vertices so the crack faces get their own flat-ish normals)
    const [tc, yc] = par(0.5, 0.5), cen = new THREE.Vector3(...pt(tc, yc, Math.max(0.0006, outer(yc)) - wall * 0.5));
    const edge = (list) => {
      for (let k = 0; k < list.length - 1; k++) {
        const [u0, v0] = list[k], [u1, v1] = list[k + 1]; const [t0, y0] = par(u0, v0), [t1, y1] = par(u1, v1);
        const ro0 = Math.max(0.0006, outer(y0)), ro1 = Math.max(0.0006, outer(y1));
        const a = g.v(...pt(t0, y0, ro0)), b = g.v(...pt(t1, y1, ro1)), c = g.v(...pt(t1, y1, Math.max(0.0003, ro1 - wall))), d = g.v(...pt(t0, y0, Math.max(0.0003, ro0 - wall)));
        const mid = new THREE.Vector3(...pt((t0 + t1) / 2, (y0 + y1) / 2, (ro0 + ro1) / 2 - wall * 0.5));
        g.quad(a, b, c, d, mid.sub(cen));
      }
    };
    const bot = [], rgt = [], tp = [], lft = [];
    for (let s = 0; s <= S; s++) { bot.push([s / S, 0]); tp.push([s / S, 1]); }
    for (let tv = 0; tv <= T; tv++) { rgt.push([1, tv / T]); lft.push([0, tv / T]); }
    edge(bot); edge(rgt); edge(tp); edge(lft);
    const geo = g.build();
    shards.push({ geo, c: cen.clone(), verts: geo.attributes.position.array, kind: 'wall', i, j, ymin: Math.min(A[1], B[1]), ymax: Math.max(C[1], D[1]) });
  }
  // base wedges
  const rb = Math.max(0.001, outer(base * 0.5) - wall * 0.2);
  for (let i = 0; i < nA; i++) {
    const t0 = th(0, i), t1 = th(0, i + 1), g = new GeoBuilder(), K = 4;
    const ct = g.v(0, base, 0), cb = g.v(0, 0.0002, 0), tops = [], bots = [];
    for (let k = 0; k <= K; k++) { const t = t0 + (t1 - t0) * k / K; tops.push(g.v(...pt(t, base, rb))); bots.push(g.v(...pt(t, 0.0002, rb))); }
    for (let k = 0; k < K; k++) { const t = t0 + (t1 - t0) * (k + 0.5) / K; g.tri(ct, tops[k], tops[k + 1], ref.set(0, 1, 0)); g.tri(cb, bots[k], bots[k + 1], ref.set(0, -1, 0)); g.quad(tops[k], tops[k + 1], bots[k + 1], bots[k], ref.set(Math.sin(t), 0, Math.cos(t))); }
    const tm = (t0 + t1) / 2;
    g.quad(ct, tops[0], bots[0], cb, ref.set(-Math.cos(tm) * 1, 0, Math.sin(tm))); g.quad(ct, tops[K], bots[K], cb, ref.set(Math.cos(tm), 0, -Math.sin(tm)));
    const geo = g.build();
    shards.push({ geo, c: new THREE.Vector3(...pt(tm, base * 0.5, rb * 0.6)), verts: geo.attributes.position.array, kind: 'base', i, j: -1, ymin: 0, ymax: base });
  }
  const W = (i, j) => j * nA + ((i + nA) % nA), Bs = i => nH * nA + ((i + nA) % nA);
  const adj = shards.map(() => new Set());
  const link = (a, b) => { adj[a].add(b); adj[b].add(a); };
  for (let j = 0; j < nH; j++) for (let i = 0; i < nA; i++) { link(W(i, j), W(i + 1, j)); if (j + 1 < nH) { link(W(i, j), W(i, j + 1)); link(W(i, j), W(i + (j % 2 ? 1 : -1), j + 1)); } }
  for (let i = 0; i < nA; i++) { link(W(i, 0), Bs(i)); link(Bs(i), Bs(i + 1)); link(Bs(i), Bs(i + Math.floor(nA / 2))); }
  return { shards, adj, nA, nH };
}

/** Merge shard geometries (indices into shards) into one geometry. */
export function mergeShards(shards, ids) {
  const geos = ids.map(i => shards[i].geo);
  if (!geos.length) return new THREE.BufferGeometry();
  const g = geos.length === 1 ? geos[0].clone() : mergeGeometries(geos, false);
  g.computeBoundingSphere(); return g;
}

// ------------------------------------------------------------------ 2D voronoi on convex polygons
function clipHalf(poly, nx, ny, d) { // keep n·p <= d
  const out = [];
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k], b = poly[(k + 1) % poly.length];
    const da = nx * a[0] + ny * a[1] - d, db = nx * b[0] + ny * b[1] - d;
    if (da <= 0) out.push(a);
    if ((da <= 0) !== (db <= 0)) { const t = da / (da - db); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
  }
  return out;
}
export function polyArea(p) { let a = 0; for (let k = 0; k < p.length; k++) { const q = p[k], w = p[(k + 1) % p.length]; a += q[0] * w[1] - w[0] * q[1]; } return a / 2; }
export function polyCentroid(p) { let x = 0, y = 0, a = 0; for (let k = 0; k < p.length; k++) { const q = p[k], w = p[(k + 1) % p.length], c = q[0] * w[1] - w[0] * q[1]; a += c; x += (q[0] + w[0]) * c; y += (q[1] + w[1]) * c; } a *= 0.5; return Math.abs(a) < 1e-12 ? p[0].slice() : [x / (6 * a), y / (6 * a)]; }
export function pointInPoly(p, x, y) { let inside = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const a = p[i], b = p[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1] + 1e-12) + a[0]) inside = !inside; } return inside; }
/** Voronoi cells of `seeds` clipped to convex `poly`. */
export function voronoi(poly, seeds) {
  const cells = [];
  for (let i = 0; i < seeds.length; i++) {
    let c = poly; const s = seeds[i];
    for (let j = 0; j < seeds.length && c.length >= 3; j++) {
      if (i === j) continue; const t = seeds[j]; const nx = t[0] - s[0], ny = t[1] - s[1];
      c = clipHalf(c, nx, ny, nx * (s[0] + t[0]) / 2 + ny * (s[1] + t[1]) / 2);
    }
    if (c.length >= 3 && Math.abs(polyArea(c)) > 1e-8) cells.push(c);
  }
  return cells;
}
/** Seeds for shattering `poly` around an impact (ix,iy): dense radial cluster near impact, sparse elsewhere. */
export function impactSeeds(poly, ix, iy, radius, r = Math.random) {
  const seeds = []; let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
  for (const p of poly) { minx = Math.min(minx, p[0]); maxx = Math.max(maxx, p[0]); miny = Math.min(miny, p[1]); maxy = Math.max(maxy, p[1]); }
  const near = 14, rays = 7;
  for (let k = 0; k < near; k++) { const a = (k % rays) / rays * Math.PI * 2 + r() * 0.5, d = radius * (0.25 + 1.6 * Math.pow(r(), 1.3)) * (k < rays ? 0.6 : 1.4); const x = ix + Math.cos(a) * d, y = iy + Math.sin(a) * d; if (pointInPoly(poly, x, y)) seeds.push([x, y]); }
  const area = (maxx - minx) * (maxy - miny), far = clamp(Math.round(area / (radius * radius * 9)), 2, 10);
  for (let k = 0; k < far * 3 && seeds.length < near + far; k++) { const x = minx + r() * (maxx - minx), y = miny + r() * (maxy - miny); if (pointInPoly(poly, x, y) && Math.hypot(x - ix, y - iy) > radius * 2.2) seeds.push([x, y]); }
  if (pointInPoly(poly, ix, iy)) seeds.push([ix, iy]);
  return seeds;
}
/** Extrude a 2D cell (x,y) to a prism of thickness t centred on z = 0. */
export function prism(poly, t, uvScale = 1) {
  const g = new GeoBuilder(), n = poly.length, top = [], bot = [], ref = new THREE.Vector3();
  const [cx, cy] = polyCentroid(poly);
  for (const p of poly) { top.push(g.v(p[0], p[1], t / 2, p[0] * uvScale, p[1] * uvScale)); bot.push(g.v(p[0], p[1], -t / 2, p[0] * uvScale, p[1] * uvScale)); }
  for (let k = 1; k < n - 1; k++) { g.tri(top[0], top[k], top[k + 1], ref.set(0, 0, 1)); g.tri(bot[0], bot[k], bot[k + 1], ref.set(0, 0, -1)); }
  for (let k = 0; k < n; k++) {
    const a = poly[k], b = poly[(k + 1) % n];
    const i0 = g.v(a[0], a[1], t / 2, 0, 0), i1 = g.v(b[0], b[1], t / 2, 1, 0), i2 = g.v(b[0], b[1], -t / 2, 1, 1), i3 = g.v(a[0], a[1], -t / 2, 0, 1);
    g.quad(i0, i1, i2, i3, ref.set((a[0] + b[0]) / 2 - cx, (a[1] + b[1]) / 2 - cy, 0));
  }
  return g.build();
}
