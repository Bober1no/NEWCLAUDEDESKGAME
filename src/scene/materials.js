/**
 * Shared geometry + material cache.
 *
 * Every unit and prop is assembled from a handful of primitives. Caching them
 * by signature keeps the GPU buffer count in the dozens instead of the
 * thousands, which is what makes a 150-unit battle survivable in a browser.
 */
import * as THREE from 'three';

const geoCache = new Map();
const matCache = new Map();

export function geo(key, factory) {
  let g = geoCache.get(key);
  if (!g) { g = factory(); geoCache.set(key, g); }
  return g;
}

export function mat(key, factory) {
  let m = matCache.get(key);
  if (!m) { m = factory(); matCache.set(key, m); }
  return m;
}

/* ── primitive shortcuts ────────────────────────────────────────────── */
export const box = (w, h, d) => geo(`b|${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d));

export const cyl = (rt, rb, h, seg = 10) =>
  geo(`c|${rt}|${rb}|${h}|${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));

export const cone = (r, h, seg = 10) =>
  geo(`k|${r}|${h}|${seg}`, () => new THREE.ConeGeometry(r, h, seg));

export const sphere = (r, seg = 10) =>
  geo(`s|${r}|${seg}`, () => new THREE.SphereGeometry(r, seg, Math.max(4, seg >> 1)));

export const torus = (r, tube, seg = 8, rings = 14) =>
  geo(`t|${r}|${tube}|${seg}|${rings}`, () => new THREE.TorusGeometry(r, tube, seg, rings));

export const plane = (w, h) => geo(`p|${w}|${h}`, () => new THREE.PlaneGeometry(w, h));

export const ring = (ri, ro, seg = 36) =>
  geo(`r|${ri}|${ro}|${seg}`, () => new THREE.RingGeometry(ri, ro, seg));

/* ── material shortcuts ─────────────────────────────────────────────── */
export function solid(color, { rough = 0.72, metal = 0.02, flat = true, emissive = 0x000000, ei = 0 } = {}) {
  const key = `s|${color}|${rough}|${metal}|${flat}|${emissive}|${ei}`;
  return mat(key, () => new THREE.MeshStandardMaterial({
    color, roughness: rough, metalness: metal, flatShading: flat,
    emissive, emissiveIntensity: ei,
  }));
}

export function glow(color, intensity = 0.9) {
  return mat(`g|${color}|${intensity}`, () => new THREE.MeshStandardMaterial({
    color, emissive: color, emissiveIntensity: intensity,
    roughness: 0.4, metalness: 0, flatShading: true,
  }));
}

export function unlit(color, opacity = 1, { depthWrite = true, side = THREE.FrontSide, blending = THREE.NormalBlending } = {}) {
  return mat(`u|${color}|${opacity}|${depthWrite}|${side}|${blending}`, () => new THREE.MeshBasicMaterial({
    color, transparent: opacity < 1 || blending === THREE.AdditiveBlending,
    opacity, depthWrite, side, blending,
  }));
}

export function translucent(color, opacity = 0.45, rough = 0.25) {
  return mat(`tl|${color}|${opacity}|${rough}`, () => new THREE.MeshStandardMaterial({
    color, transparent: true, opacity, roughness: rough, metalness: 0.05,
    flatShading: true, depthWrite: false,
  }));
}

/* ── shared palette for stationery ──────────────────────────────────── */
export const PAL = {
  wood: 0xba8a5c,
  woodDark: 0x8f6740,
  woodLight: 0xd7ae82,
  graphite: 0x3a3f46,
  eraserPink: 0xf3a9b4,
  eraserWhite: 0xf3efe6,
  paperWhite: 0xf6f2e6,
  paperCream: 0xe9dfc6,
  cardboard: 0xc9a06a,
  steel: 0xb6bec9,
  steelDark: 0x7f8896,
  brass: 0xd8b25f,
  rubberTan: 0xd8a55f,
  glueWhite: 0xf2f4f2,
  glueCap: 0xf07a2a,
  highYellow: 0xf4ee52,
  highGreen: 0x7ef07a,
  highPink: 0xff77c2,
  inkBlue: 0x3550c4,
  inkBlack: 0x22242a,
  plasticRed: 0xd8483f,
  plasticBlue: 0x3f7fd8,
  plasticGreen: 0x46b26b,
  screen: 0x0e2233,
  screenGlow: 0x39c7ff,
  bottleBlue: 0x9ad8e6,
  battery: 0x2f9e6a,
  tape: 0xe6dcc0,
  bookRed: 0x9b3b34,
  bookBlue: 0x33557f,
  bookGreen: 0x3d7050,
  bookMustard: 0xbe9339,
  bookPurple: 0x5c4173,
};

/**
 * Bakes a group of static meshes into one mesh per material.
 *
 * The desk scenery — book stacks, spilled pens, paper clips, crumbs — is
 * several hundred little primitives that never move. Merging them by material
 * takes the draw-call count from the high hundreds to roughly twenty, which
 * matters twice over because the shadow pass renders the scene again.
 *
 * UVs are dropped: none of the merged props are textured.
 */
export function mergeStaticGroup(root) {
  root.updateMatrixWorld(true);

  const buckets = new Map();
  const originals = [];
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3();

  const skipped = (o) => {
    for (let n = o; n && n !== root.parent; n = n.parent) if (n.userData.noMerge) return true;
    return false;
  };

  root.traverse((o) => {
    if (!o.isMesh || skipped(o)) return;
    originals.push(o);

    const src = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
    const pos = src.attributes.position;
    const nrm = src.attributes.normal;
    normalMatrix.getNormalMatrix(o.matrixWorld);

    let bucket = buckets.get(o.material);
    if (!bucket) buckets.set(o.material, (bucket = { pos: [], norm: [] }));

    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      bucket.pos.push(v.x, v.y, v.z);
      if (nrm) {
        n.fromBufferAttribute(nrm, i).applyMatrix3(normalMatrix).normalize();
        bucket.norm.push(n.x, n.y, n.z);
      } else {
        bucket.norm.push(0, 1, 0);
      }
    }
    if (src !== o.geometry) src.dispose();
  });

  for (const o of originals) o.parent?.remove(o);
  // drop now-childless holder groups
  for (const child of [...root.children]) {
    if (child.isGroup && child.children.length === 0) root.remove(child);
  }

  let merged = 0;
  for (const [material, bucket] of buckets) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(bucket.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(bucket.norm, 3));
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    root.add(mesh);
    merged++;
  }
  return { from: originals.length, to: merged };
}

/** Disposes everything the cache owns — used when returning to the menu. */
export function disposeCaches() {
  for (const g of geoCache.values()) g.dispose();
  for (const m of matCache.values()) m.dispose();
  geoCache.clear();
  matCache.clear();
}

/* ── custom geometry: the paper dart ────────────────────────────────── */
/**
 * A folded paper aeroplane. Six triangles: two top wing halves, two under
 * folds and a keel. Nose points down +Z so the mesh can be aimed with lookAt.
 */
export function paperPlaneGeometry(len = 3.2, span = 2.4, keel = 0.55) {
  return geo(`plane|${len}|${span}|${keel}`, () => {
    const L = len / 2, S = span / 2;
    const nose = [0, 0, L];
    const tailC = [0, 0, -L];
    const wingL = [-S, 0.05, -L * 0.72];
    const wingR = [S, 0.05, -L * 0.72];
    const keelB = [0, -keel, -L * 0.45];

    const tris = [
      [nose, wingL, tailC],       // left wing top
      [nose, tailC, wingR],       // right wing top
      [nose, tailC, keelB],       // keel left
      [nose, keelB, tailC],       // keel right (double-sided fold)
      [tailC, wingL, keelB],      // rear left fold
      [tailC, keelB, wingR],      // rear right fold
    ];

    const pos = [];
    for (const t of tris) for (const v of t) pos.push(v[0], v[1], v[2]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  });
}

/** A soft radial-gradient sprite texture — used for blob shadows and glows. */
export function radialTexture(inner = 'rgba(0,0,0,0.55)', outer = 'rgba(0,0,0,0)', size = 64) {
  const key = `tex|${inner}|${outer}|${size}`;
  let t = matCache.get(key);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  matCache.set(key, t);
  return t;
}

/** Procedural desk-wood texture: warm base with soft grain streaks. */
export function deskWoodTexture(rng, size = 1024) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');

  const base = ctx.createLinearGradient(0, 0, size, size);
  base.addColorStop(0, '#c79a68');
  base.addColorStop(0.45, '#b98a58');
  base.addColorStop(1, '#a87a4c');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  // long grain
  ctx.globalAlpha = 0.16;
  for (let i = 0; i < 220; i++) {
    const y = rng() * size;
    const h = 1 + rng() * 3.5;
    ctx.fillStyle = rng() < 0.5 ? '#8f6740' : '#d7b085';
    ctx.beginPath();
    let x = 0;
    ctx.moveTo(0, y);
    while (x < size) {
      x += 24 + rng() * 60;
      ctx.lineTo(x, y + Math.sin(x * 0.01 + i) * 4 * rng());
    }
    ctx.lineWidth = h;
    ctx.strokeStyle = ctx.fillStyle;
    ctx.stroke();
  }

  // knots
  ctx.globalAlpha = 0.1;
  for (let i = 0; i < 7; i++) {
    const kx = rng() * size, ky = rng() * size;
    for (let r = 3; r < 30 + rng() * 40; r += 2.4) {
      ctx.beginPath();
      ctx.ellipse(kx, ky, r, r * (0.42 + rng() * 0.2), rng() * 3, 0, Math.PI * 2);
      ctx.strokeStyle = '#7d5a37';
      ctx.lineWidth = 1.1;
      ctx.stroke();
    }
  }

  // fine speckle
  ctx.globalAlpha = 0.05;
  for (let i = 0; i < 5000; i++) {
    ctx.fillStyle = rng() < 0.5 ? '#000' : '#fff';
    ctx.fillRect(rng() * size, rng() * size, 1.6, 1.6);
  }
  ctx.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}
