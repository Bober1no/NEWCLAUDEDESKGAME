/**
 * The desk: surface, rim, terrain features, resource nodes and control zones.
 *
 * The layout is rotationally symmetric — every feature placed on the player's
 * half is mirrored through the origin onto the AI's half — so neither side
 * gets a better desk. A seed string shuffles the cosmetic clutter and the
 * richness jitter without breaking that symmetry.
 */
import * as THREE from 'three';
import {
  box, cyl, cone, sphere, torus, plane, ring, solid, unlit, translucent, glow,
  PAL, deskWoodTexture, radialTexture, mergeStaticGroup,
} from './materials.js';
import { WORLD, RES_META, TEAM_COLORS } from '../core/constants.js';
import { makeRng, TAU, shade, clamp } from '../core/utils.js';

const HALF_W = WORLD.W / 2;
const HALF_D = WORLD.D / 2;

/* Income per second at richness 1.0, before upgrades and AI handicaps. */
export const NODE_YIELD = { paper: 3.1, ink: 1.85, battery: 0.30, graphite: 0.70 };

function mesh(geometry, material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  return m;
}

/* ─────────────────────────────────────────────────────────────────────
   Layout tables — the player half only; everything is mirrored.
   ───────────────────────────────────────────────────────────────────── */

const HALF_NODES = [
  { type: 'paper',    x: -68, z: -30, rich: 1.00 },
  { type: 'paper',    x: -68, z:  30, rich: 1.00 },
  { type: 'ink',      x: -52, z:  -6, rich: 1.00 },
  { type: 'graphite', x: -44, z:  32, rich: 1.00 },
  { type: 'paper',    x: -30, z: -44, rich: 1.15 },
  { type: 'battery',  x: -26, z:  12, rich: 0.95 },
  { type: 'ink',      x: -16, z: -28, rich: 1.20 },
  { type: 'ink',      x: -10, z:  42, rich: 1.10 },
];

const CENTRE_NODES = [
  { type: 'battery', x: 0, z:   0, rich: 2.0 },
  { type: 'paper',   x: 0, z: -46, rich: 1.35 },
  { type: 'paper',   x: 0, z:  46, rich: 1.35 },
];

const HALF_BOOKS = [
  { x: -46, z: -16, w: 15, d: 12, layers: 3 },
  { x: -58, z:  20, w: 12, d: 10, layers: 2 },
  { x: -18, z:  26, w: 13, d: 11, layers: 4 },
  { x: -30, z:  -2, w: 10, d: 16, layers: 2 },
];

const CENTRE_BOOKS = [
  { x: 0, z: -22, w: 17, d: 12, layers: 4 },
  { x: 0, z:  22, w: 17, d: 12, layers: 4 },
];

const HALF_BOTTLES = [
  { x: -60, z:   0 },
  { x: -24, z: -14 },
];

const CENTRE_BOTTLES = [
  { x: 0, z: -38 },
  { x: 0, z:  38 },
];

const HALF_BLOCKERS = [
  { kind: 'pen',    x: -40, z:  48, rot: 0.35, len: 16 },
  { kind: 'ruler',  x: -14, z: -12, rot: 1.15, len: 22 },
  { kind: 'eraser', x: -34, z: -34, rot: 0.4 },
  { kind: 'pad',    x: -56, z: -44, rot: -0.2 },
  { kind: 'pen',    x: -8,  z:  10, rot: -0.9, len: 14 },
];

const ZONES = [
  { id: 'centre', name: 'Centre Desk', x: 0, z: 0, radius: 19 },
  { id: 'nw', name: 'Notebook Corner', x: -38, z: -30, radius: 15 },
  { id: 'se', name: 'Sharpener Corner', x: 38, z: 30, radius: 15 },
  { id: 'sw', name: 'Ink Corner', x: -38, z: 30, radius: 15 },
  { id: 'ne', name: 'Battery Corner', x: 38, z: -30, radius: 15 },
];

export const BASE_SPOTS = {
  0: { x: -72, z: 0, facing: 0 },        // player, looking toward +X
  1: { x: 72, z: 0, facing: Math.PI },   // AI
};

/* ─────────────────────────────────────────────────────────────────────
   DeskMap
   ───────────────────────────────────────────────────────────────────── */
export class DeskMap {
  constructor(scene, grid, seed = 'desk-01') {
    this.scene = scene;
    this.grid = grid;
    this.rng = makeRng(seed);
    this.root = new THREE.Group();
    this.propRoot = new THREE.Group();   // live props: nodes, bottles
    this.staticRoot = new THREE.Group(); // baked into merged meshes below
    this.decalRoot = new THREE.Group();
    this.root.add(this.decalRoot, this.propRoot, this.staticRoot);
    scene.add(this.root);

    this.nodes = [];
    this.bottleSites = [];
    this.zones = [];
    this.plateaus = [];

    this._buildDesk();
    this._buildBooks();
    this._buildNodes();
    this._buildBottles();
    this._buildBlockers();
    this._buildZones();
    this._scatterClutter();
    this._edgeDressing();

    // scenery never moves — bake it down to a handful of draw calls
    this.mergeStats = mergeStaticGroup(this.staticRoot);
  }

  /* ── surface ──────────────────────────────────────────────────────── */
  _buildDesk() {
    // The desk slab runs well past the playable area: the rim marks the
    // boundary, and the apron beyond it gives the mug and the textbook stack
    // something to stand on instead of floating in the dark.
    const APRON_X = 96, APRON_Z = 76;
    this.apron = { x: APRON_X, z: APRON_Z };
    const tex = deskWoodTexture(this.rng);
    tex.repeat.set(4.4, 2.9);
    const top = mesh(
      box(WORLD.W + APRON_X * 2, WORLD.DESK_THICKNESS, WORLD.D + APRON_Z * 2),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.82, metalness: 0.02 }),
      0, -WORLD.DESK_THICKNESS / 2, 0
    );
    top.receiveShadow = true;
    this.root.add(top);

    const rimMat = solid(PAL.woodDark, { rough: 0.86 });
    const rimH = 2.2, rimT = 3.0;
    const rims = [
      [WORLD.W + rimT * 2, rimH, rimT, 0, rimH / 2, -HALF_D - rimT / 2],
      [WORLD.W + rimT * 2, rimH, rimT, 0, rimH / 2, HALF_D + rimT / 2],
      [rimT, rimH, WORLD.D, -HALF_W - rimT / 2, rimH / 2, 0],
      [rimT, rimH, WORLD.D, HALF_W + rimT / 2, rimH / 2, 0],
    ];
    for (const [w, h, d, x, y, z] of rims) {
      const r = mesh(box(w, h, d), rimMat, x, y, z);
      r.castShadow = true; r.receiveShadow = true;
      this.root.add(r);
    }

    // drawer front along the desk's near edge, purely to sell the scale
    const edgeZ = HALF_D + APRON_Z;
    const drawer = mesh(box(WORLD.W * 0.62, 11, 2.4), solid(PAL.woodDark), 0, -10, edgeZ - 1.2);
    this.root.add(drawer);
    this.root.add(mesh(box(11, 1.6, 1.4), solid(PAL.brass, { metal: 0.7, rough: 0.3 }), 0, -10, edgeZ + 0.1));

    // faint coffee ring, because of course
    const rx = this.rng.range(-40, 40), rz = this.rng.range(-46, -30);
    const cring = mesh(ring(5.4, 6.4, 40), unlit(0x6b4a2c, 0.22, { depthWrite: false }), rx, 0.02, rz, -Math.PI / 2, 0, 0);
    this.decalRoot.add(cring);

    // a couple of graphite smudges
    for (let i = 0; i < 5; i++) {
      const s = mesh(
        plane(this.rng.range(7, 16), this.rng.range(5, 11)),
        new THREE.MeshBasicMaterial({
          map: radialTexture('rgba(40,42,48,0.30)', 'rgba(40,42,48,0)'),
          transparent: true, depthWrite: false,
        }),
        this.rng.range(-HALF_W + 12, HALF_W - 12), 0.015, this.rng.range(-HALF_D + 10, HALF_D - 10),
        -Math.PI / 2, 0, this.rng() * TAU
      );
      this.decalRoot.add(s);
    }
  }

  /* ── book stacks (the high ground) ────────────────────────────────── */
  _buildBooks() {
    const all = [];
    for (const b of HALF_BOOKS) { all.push(b); all.push({ ...b, x: -b.x, z: -b.z }); }
    for (const b of CENTRE_BOOKS) all.push(b);

    for (const b of all) this._bookStack(b);
  }

  _bookStack({ x, z, w, d, layers }) {
    const rng = this.rng;
    const spineCols = [PAL.bookRed, PAL.bookBlue, PAL.bookGreen, PAL.bookMustard, PAL.bookPurple];
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const yaw = rng.range(-0.14, 0.14);
    g.rotation.y = yaw;

    let y = 0;
    let topW = w, topD = d;
    for (let i = 0; i < layers; i++) {
      const t = 1 - i * 0.075;
      const bw = w * t, bd = d * t;
      const bh = rng.range(1.15, 1.7);
      const col = spineCols[(rng.int(0, 4) + i) % spineCols.length];

      const cover = mesh(box(bw, bh, bd), solid(col, { rough: 0.88 }), rng.range(-0.7, 0.7), y + bh / 2, rng.range(-0.7, 0.7));
      cover.castShadow = true; cover.receiveShadow = true;
      g.add(cover);

      // page block, inset on three sides
      const pages = mesh(box(bw - 0.9, bh * 0.72, bd - 0.9), solid(PAL.paperCream, { rough: 0.97 }),
        cover.position.x + 0.35, y + bh / 2, cover.position.z);
      g.add(pages);

      // spine ridges
      for (let s = 0; s < 3; s++) {
        g.add(mesh(box(0.16, bh * 0.5, bd - 1.6), unlit(shade(col, -0.35)),
          cover.position.x - bw / 2 + 0.2, y + bh / 2, cover.position.z + (s - 1) * (bd / 4)));
      }
      y += bh;
      topW = bw; topD = bd;
    }

    this.staticRoot.add(g);

    const height = y;
    const hw = topW / 2 - 0.6, hd = topD / 2 - 0.6;
    this.grid.stampRect(x, z, hw, hd, { elevated: true, height, cost: 1.35 });
    this.plateaus.push({ x, z, hw, hd, height });
  }

  /* ── resource nodes ───────────────────────────────────────────────── */
  _buildNodes() {
    const list = [];
    for (const n of HALF_NODES) {
      list.push({ ...n });
      list.push({ ...n, x: -n.x, z: -n.z });
    }
    for (const n of CENTRE_NODES) list.push({ ...n });

    let i = 0;
    for (const spec of list) {
      const jitter = this.rng.range(0.92, 1.08);
      const node = {
        id: `node${i++}`,
        type: spec.type,
        x: spec.x, z: spec.z,
        richness: spec.rich * jitter,
        yield: NODE_YIELD[spec.type] * spec.rich * jitter,
        extractor: null,
        mesh: null,
        contestedBy: -1,
      };
      node.mesh = this._nodeProp(node);
      this.propRoot.add(node.mesh);
      this.nodes.push(node);
      // nodes are walkable but slow; the extractor itself will block later
      this.grid.stampRect(node.x, node.z, 2.6, 2.6, { cost: 1.25 });
    }
  }

  _nodeProp(node) {
    const g = new THREE.Group();
    g.position.set(node.x, 0, node.z);
    g.rotation.y = this.rng.range(0, TAU);
    const meta = RES_META[node.type];

    switch (node.type) {
      case 'paper': {
        // a spiral notebook plus a loose stack
        const nb = mesh(box(9, 1.1, 7), solid(PAL.paperWhite, { rough: 0.96 }), 0, 0.55, 0);
        nb.castShadow = true; nb.receiveShadow = true;
        g.add(nb);
        g.add(mesh(box(9.2, 0.35, 7.2), solid(0x4e6f9c, { rough: 0.8 }), 0, 1.28, 0));
        for (let i = 0; i < 7; i++) {
          g.add(mesh(torus(0.42, 0.11, 5, 9), solid(PAL.steel, { metal: 0.85 }),
            -4.5, 0.85, (i - 3) * 0.92, 0, Math.PI / 2, 0));
        }
        for (let i = 0; i < 3; i++) {
          const sheet = mesh(box(7.4, 0.1, 5.6), solid(PAL.paperCream, { rough: 0.97 }),
            5.5 + i * 0.5, 0.08 + i * 0.11, 2 - i * 1.4);
          sheet.rotation.y = this.rng.range(-0.4, 0.4);
          g.add(sheet);
        }
        break;
      }
      case 'ink': {
        const pot = mesh(cyl(2.1, 2.5, 3.0, 14), translucent(0x1b2440, 0.85, 0.2), 0, 1.5, 0);
        pot.castShadow = true;
        g.add(pot);
        g.add(mesh(cyl(2.35, 2.35, 0.5, 14), solid(PAL.steelDark, { metal: 0.7 }), 0, 3.1, 0));
        g.add(mesh(cyl(1.75, 1.75, 0.2, 14), glow(PAL.inkBlue, 0.6), 0, 2.95, 0));
        // spill decal
        const spill = mesh(plane(11, 9), new THREE.MeshBasicMaterial({
          map: radialTexture('rgba(40,60,180,0.42)', 'rgba(40,60,180,0)'),
          transparent: true, depthWrite: false,
        }), 0, 0.02, 0, -Math.PI / 2, 0, 0);
        g.add(spill);
        break;
      }
      case 'battery': {
        const count = node.richness > 1.5 ? 4 : 2;
        for (let i = 0; i < count; i++) {
          const a = (i / count) * TAU;
          const r = count > 2 ? 2.6 : 1.7;
          const cell = new THREE.Group();
          cell.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
          cell.rotation.z = Math.PI / 2;
          cell.rotation.y = a;
          cell.add(mesh(cyl(1.05, 1.05, 3.4, 12), solid(PAL.battery, { metal: 0.35, rough: 0.5 }), 0, 0, 0));
          cell.add(mesh(cyl(1.08, 1.08, 0.8, 12), solid(0x1d1f24), 0, -1.4, 0));
          cell.add(mesh(cyl(0.45, 0.45, 0.5, 10), solid(PAL.steel, { metal: 0.9 }), 0, 1.9, 0));
          cell.position.y = 1.05;
          cell.traverse((c) => { if (c.isMesh) c.castShadow = true; });
          g.add(cell);
        }
        break;
      }
      case 'graphite': {
        const body = mesh(box(4.4, 2.4, 3.2), solid(0x3f4652, { rough: 0.55 }), 0, 1.2, 0);
        body.castShadow = true;
        g.add(body);
        g.add(mesh(cyl(0.75, 0.55, 1.0, 10), solid(0x22262d), 0, 1.8, 1.7, Math.PI / 2, 0, 0));
        g.add(mesh(box(2.6, 0.2, 1.2), solid(PAL.steel, { metal: 0.9, rough: 0.2 }), 0, 2.42, 0));
        // shavings ring
        for (let i = 0; i < 12; i++) {
          const a = this.rng() * TAU, r = this.rng.range(3, 6.5);
          const sh = mesh(cyl(0.42, 0.16, 0.18, 6), solid(this.rng.chance(0.5) ? PAL.brass : 0xd8a05a),
            Math.cos(a) * r, 0.09, Math.sin(a) * r, 0, this.rng() * TAU, 0);
          g.add(sh);
        }
        break;
      }
      default: break;
    }

    // The scenery is static and gets baked with the rest of the desk; only the
    // halo and beacon stay live, because claiming a node recolours them.
    g.updateMatrixWorld(true);
    this.staticRoot.add(g);

    const live = new THREE.Group();
    live.position.set(node.x, 0, node.z);
    const halo = mesh(ring(3.6, 4.6, 32), unlit(meta.hex, 0.42, { depthWrite: false }), 0, 0.05, 0, -Math.PI / 2, 0, 0);
    live.add(halo);
    node.halo = halo;

    const beacon = mesh(cyl(0.28, 0.28, 6, 6), unlit(meta.hex, 0.16, { depthWrite: false }), 0, 3, 0);
    live.add(beacon);
    node.beacon = beacon;
    return live;
  }

  /* ── water bottles (discounted tower sites) ───────────────────────── */
  _buildBottles() {
    const list = [];
    for (const b of HALF_BOTTLES) { list.push({ ...b }); list.push({ x: -b.x, z: -b.z }); }
    for (const b of CENTRE_BOTTLES) list.push({ ...b });

    let i = 0;
    for (const spec of list) {
      const site = { id: `bottle${i++}`, x: spec.x, z: spec.z, used: false, mesh: null };
      site.mesh = this._bottleProp(spec.x, spec.z);
      this.propRoot.add(site.mesh);
      this.bottleSites.push(site);
      this.grid.stampRect(spec.x, spec.z, 2.0, 2.0, { blocked: true, id: -1 });
    }
  }

  _bottleProp(x, z) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = this.rng.range(0, TAU);
    const body = mesh(cyl(2.0, 2.2, 7.0, 14), translucent(PAL.bottleBlue, 0.42, 0.1), 0, 3.5, 0);
    body.castShadow = true;
    g.add(body);
    g.add(mesh(cyl(1.85, 2.0, 4.4, 14), translucent(0x62b8d8, 0.6, 0.08), 0, 2.4, 0));
    g.add(mesh(cyl(1.15, 2.0, 1.5, 14), translucent(PAL.bottleBlue, 0.4, 0.1), 0, 7.75, 0));
    g.add(mesh(cyl(1.1, 1.1, 1.0, 12), solid(0x4a90c8, { rough: 0.45 }), 0, 8.9, 0));
    g.add(mesh(cyl(2.22, 2.22, 2.2, 14), solid(PAL.paperWhite, { rough: 0.9 }), 0, 3.2, 0));
    g.add(mesh(ring(2.9, 3.7, 28), unlit(0x8fd6ea, 0.3, { depthWrite: false }), 0, 0.05, 0, -Math.PI / 2, 0, 0));
    return g;
  }

  /** Called when a tower is built on a bottle: remove the prop, free the grid. */
  consumeBottle(site) {
    site.used = true;
    if (site.mesh) { this.propRoot.remove(site.mesh); site.mesh = null; }
    this.grid.clearRect(site.x, site.z, 2.0, 2.0, -1);
  }

  nearestBottle(x, z, maxDist = 6) {
    let best = null, bd = maxDist * maxDist;
    for (const s of this.bottleSites) {
      if (s.used) continue;
      const d = (s.x - x) ** 2 + (s.z - z) ** 2;
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  /* ── impassable clutter ───────────────────────────────────────────── */
  _buildBlockers() {
    const list = [];
    for (const b of HALF_BLOCKERS) { list.push({ ...b }); list.push({ ...b, x: -b.x, z: -b.z, rot: b.rot + Math.PI }); }
    for (const spec of list) this._blockerProp(spec);
  }

  _blockerProp({ kind, x, z, rot, len = 14 }) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rot;
    let hw = 2, hd = 2;

    if (kind === 'pen') {
      const col = this.rng.pick([PAL.inkBlue, PAL.inkBlack, 0xc23b6d, 0x2f9e6a]);
      g.add(mesh(cyl(0.85, 0.85, len, 10), solid(col, { rough: 0.4 }), 0, 0.85, 0, Math.PI / 2, 0, 0));
      g.add(mesh(cone(0.8, 2.2, 8), solid(PAL.steel, { metal: 0.8 }), 0, 0.85, len / 2 + 1.0, Math.PI / 2, 0, 0));
      g.add(mesh(cyl(0.9, 0.9, 2.4, 10), solid(shade(col, -0.4)), 0, 0.85, -len / 2 + 1.0, Math.PI / 2, 0, 0));
      hw = 1.2; hd = len / 2;
    } else if (kind === 'ruler') {
      g.add(mesh(box(3.4, 0.7, len), translucent(0xd9f0a8, 0.85, 0.18), 0, 0.35, 0));
      for (let i = 0; i < 10; i++) {
        g.add(mesh(box(2.2, 0.02, 0.16), unlit(0x2f3a22), -0.3, 0.72, (i - 4.5) * (len / 11)));
      }
      hw = 1.8; hd = len / 2;
    } else if (kind === 'eraser') {
      const e = mesh(box(6.5, 2.6, 3.4), solid(PAL.eraserPink, { rough: 0.92 }), 0, 1.3, 0);
      e.castShadow = true;
      g.add(e);
      g.add(mesh(box(6.6, 1.1, 3.5), solid(PAL.paperWhite, { rough: 0.95 }), 0, 1.3, 0));
      hw = 3.4; hd = 1.8;
    } else if (kind === 'pad') {
      for (let i = 0; i < 5; i++) {
        g.add(mesh(box(8, 0.4, 8), solid(i % 2 ? 0xf6ee7a : 0xf0e76a, { rough: 0.96 }), 0, 0.2 + i * 0.4, 0));
      }
      hw = 4.1; hd = 4.1;
    }

    g.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
    this.staticRoot.add(g);

    // rotate the footprint into world space (axis-aligned bound is fine here)
    const ca = Math.abs(Math.cos(rot)), sa = Math.abs(Math.sin(rot));
    const wx = hw * ca + hd * sa;
    const wz = hw * sa + hd * ca;
    this.grid.stampRect(x, z, wx, wz, { blocked: true, id: -1 });
  }

  /* ── control zones ────────────────────────────────────────────────── */
  _buildZones() {
    for (const spec of ZONES) {
      const zone = { ...spec, owner: -1, tension: 0, counts: [0, 0], mesh: null };
      const g = new THREE.Group();
      g.position.set(spec.x, 0, spec.z);
      const band = mesh(ring(spec.radius - 1.1, spec.radius, 56), unlit(0xffffff, 0.16, { depthWrite: false }), 0, 0.04, 0, -Math.PI / 2, 0, 0);
      g.add(band);
      const fill = mesh(ring(0, spec.radius - 1.2, 48), unlit(0xffffff, 0.045, { depthWrite: false }), 0, 0.03, 0, -Math.PI / 2, 0, 0);
      g.add(fill);
      zone.band = band; zone.fill = fill;
      zone.mesh = g;
      this.decalRoot.add(g);
      this.zones.push(zone);
    }
  }

  /** Recolour a zone ring when its owner changes. */
  paintZone(zone) {
    const col = zone.owner < 0 ? 0xffffff : TEAM_COLORS[zone.owner].primary;
    zone.band.material = unlit(col, zone.owner < 0 ? 0.14 : 0.38, { depthWrite: false });
    zone.fill.material = unlit(col, zone.owner < 0 ? 0.035 : 0.06, { depthWrite: false });
  }

  /* ── cosmetic clutter ─────────────────────────────────────────────── */
  _scatterClutter() {
    const rng = this.rng;
    const clip = solid(PAL.steel, { metal: 0.85, rough: 0.25 });

    for (let i = 0; i < 46; i++) {
      const x = rng.range(-HALF_W + 8, HALF_W - 8);
      const z = rng.range(-HALF_D + 8, HALF_D - 8);
      if (this.grid.blockedAt(x, z)) continue;
      const roll = rng();
      if (roll < 0.4) {
        // paper clip
        const g = new THREE.Group();
        g.position.set(x, 0, z);
        g.rotation.y = rng() * TAU;
        const o = mesh(torus(0.75, 0.11, 5, 12), clip, 0, 0.12, 0, -Math.PI / 2, 0, 0);
        o.scale.set(1, 1.7, 1);
        g.add(o);
        const inr = mesh(torus(0.42, 0.1, 5, 10), clip, 0, 0.12, 0.1, -Math.PI / 2, 0, 0);
        inr.scale.set(1, 1.5, 1);
        g.add(inr);
        this.staticRoot.add(g);
        this.grid.stampRect(x, z, 1.4, 1.4, { clutter: true, cost: 1.5 });
      } else if (roll < 0.72) {
        // eraser shavings
        const g = new THREE.Group();
        g.position.set(x, 0, z);
        for (let k = 0; k < 5; k++) {
          g.add(mesh(cyl(0.28, 0.12, 0.16, 5), solid(rng.chance(0.6) ? PAL.eraserPink : PAL.eraserWhite),
            rng.range(-1.6, 1.6), 0.08, rng.range(-1.6, 1.6), 0, rng() * TAU, rng.range(-0.4, 0.4)));
        }
        this.staticRoot.add(g);
        this.grid.stampRect(x, z, 1.8, 1.8, { clutter: true, cost: 1.45 });
      } else if (roll < 0.88) {
        // graphite crumbs
        const g = new THREE.Group();
        g.position.set(x, 0, z);
        for (let k = 0; k < 6; k++) {
          g.add(mesh(sphere(rng.range(0.14, 0.3), 5), solid(PAL.graphite),
            rng.range(-1.4, 1.4), 0.16, rng.range(-1.4, 1.4)));
        }
        this.staticRoot.add(g);
        this.grid.stampRect(x, z, 1.4, 1.4, { clutter: true, cost: 1.3 });
      } else {
        // staple
        const g = new THREE.Group();
        g.position.set(x, 0, z);
        g.rotation.y = rng() * TAU;
        g.add(mesh(box(1.3, 0.14, 0.14), clip, 0, 0.3, 0));
        g.add(mesh(box(0.14, 0.14, 0.6), clip, -0.6, 0.3, 0.3));
        g.add(mesh(box(0.14, 0.14, 0.6), clip, 0.6, 0.3, 0.3));
        this.staticRoot.add(g);
      }
    }
  }

  /* ── things just past the rim, for depth ──────────────────────────── */
  _edgeDressing() {
    const g = new THREE.Group();

    // mug of tea, off the north-west corner
    const mug = new THREE.Group();
    mug.position.set(-HALF_W - 34, 0, -HALF_D - 30);
    mug.add(mesh(cyl(6, 5, 11, 18), solid(0xd9dee6, { rough: 0.4 }), 0, 5.5, 0));
    mug.add(mesh(cyl(5.4, 5.4, 0.6, 18), solid(0x5d3b23, { rough: 0.35 }), 0, 9.4, 0));
    mug.add(mesh(torus(3.0, 0.9, 8, 16), solid(0xd9dee6, { rough: 0.4 }), 6.4, 6.2, 0, 0, Math.PI / 2, 0));
    g.add(mug);

    // stack of textbooks off the south-east corner
    const stack = new THREE.Group();
    stack.position.set(HALF_W + 40, 0, HALF_D + 28);
    stack.rotation.y = 0.4;
    let y = 0;
    for (let i = 0; i < 4; i++) {
      const h = 3 + this.rng.range(0, 1.5);
      stack.add(mesh(box(26 - i * 1.6, h, 19 - i), solid([PAL.bookRed, PAL.bookBlue, PAL.bookGreen, PAL.bookPurple][i]), 0, y + h / 2, 0));
      y += h;
    }
    g.add(stack);

    // desk lamp pool of light on the far side
    const pool = mesh(plane(150, 110), new THREE.MeshBasicMaterial({
      map: radialTexture('rgba(255,236,200,0.10)', 'rgba(255,236,200,0)'),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }), -30, 0.06, -10, -Math.PI / 2, 0, 0);
    this.decalRoot.add(pool);

    g.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
    this.staticRoot.add(g);
  }

  /* ── queries ──────────────────────────────────────────────────────── */
  heightAt(x, z) { return this.grid.heightAt(x, z); }

  nodeAt(x, z, maxDist = 7) {
    let best = null, bd = maxDist * maxDist;
    for (const n of this.nodes) {
      if (n.extractor) continue;
      const d = (n.x - x) ** 2 + (n.z - z) ** 2;
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  nodeById(id) { return this.nodes.find((n) => n.id === id) || null; }

  inBounds(x, z, margin = 3) {
    return x > -HALF_W + margin && x < HALF_W - margin && z > -HALF_D + margin && z < HALF_D - margin;
  }

  clampToDesk(x, z, margin = 3) {
    return [clamp(x, -HALF_W + margin, HALF_W - margin), clamp(z, -HALF_D + margin, HALF_D - margin)];
  }

  /** Highest plateau within `r` of a point — used by the AI to find sniper perches. */
  bestPerchNear(x, z, r = 40) {
    let best = null, bestScore = 0;
    for (const p of this.plateaus) {
      const d = Math.hypot(p.x - x, p.z - z);
      if (d > r) continue;
      const score = p.height * 2 - d * 0.05;
      if (score > bestScore) { bestScore = score; best = p; }
    }
    return best;
  }

  dispose() {
    this.scene.remove(this.root);
    this.root.traverse((c) => { if (c.isMesh && c.geometry && c.geometry.dispose && !c.geometry.__cached) { /* cache owns these */ } });
  }
}
