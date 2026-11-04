// Precipitation: the moment two clear solutions meet a cloud blooms (noise particles + MarchingCubes
// clumps), swirls, then settles into a sediment layer while the liquid above clears. Also the crown splash.
import * as THREE from 'three';
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js';
import { Particles } from '../render/lab.js';
import { LAYER_FX } from '../render/pipeline.js';
import { hh } from './smoke.js';
import { TX } from '../render/materials.js';

const sm = (a, b, x) => { const u = !(x > a) ? 0 : x >= b ? 1 : (x - a) / (b - a); return u * u * (3 - 2 * u); };

export class Precipitate {
  /** inner(y) vessel inner radius; floor, level (liquid top); colour hex; t0 = when solutions meet (s); T = settle time (s); shimmer = golden rain */
  constructor(pipeline, { inner, floor, level, colour = '#ffd21a', t0 = 1, T = 8, n = 900, shimmer = false, origin = [0, 0, 0] }) {
    this.o = { inner, floor, level, t0, T, shimmer };
    const c = new THREE.Color(colour);
    this.group = new THREE.Group();
    this.cloud = new Particles(n, (i, s, time, o) => this._p(i, s, time, o, c), {});
    this.cloud.points.layers.set(LAYER_FX); pipeline.noDepth.add(this.cloud.points); this.group.add(this.cloud.points);
    if (shimmer) {
      this.glint = new Particles(160, (i, s, time, o) => { if (!this._p(i * 5, s, time, o, c)) return false; const g = Math.max(0, Math.sin(time * 6 + i * 2.3)); o.alpha *= 4 * g * g * g; o.size *= 0.35; o.r = 3; o.g = 2.6; o.b = 0.8; return true; }, { additive: true });
      this.glint.points.layers.set(LAYER_FX); pipeline.noDepth.add(this.glint.points); this.group.add(this.glint.points);
    }
    // MarchingCubes clumps (bloom), in a cube spanning the vessel interior
    const R = inner(level * 0.5);
    this.mcMat = new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, normalMap: TX.grainN, normalScale: new THREE.Vector2(0.6, 0.6), transparent: true, opacity: 0.85, depthWrite: false });
    this.mc = new MarchingCubes(28, this.mcMat, false, false, 6000);
    const half = (level - floor) / 2; this.mcR = R / (2 * half); this.mc.scale.setScalar(half); this.mc.position.set(0, floor + half, 0);
    this.mc.frustumCulled = false; this.mc.renderOrder = 4; this.group.add(this.mc);
    // sediment: a low mound on the floor
    const pts = []; for (let i = 0; i <= 16; i++) { const u = i / 16; pts.push(new THREE.Vector2(Math.max(0.0001, inner(floor + 0.002) * 0.97 * (1 - u)), 1 - u * u * 0.6)); }
    pts.unshift(new THREE.Vector2(inner(floor + 0.002) * 0.97, 0)); pts.unshift(new THREE.Vector2(0.0001, 0));
    this.sed = new THREE.Mesh(new THREE.LatheGeometry(pts.reverse().reverse(), 40), new THREE.MeshStandardMaterial({ color: c, roughness: 0.95, normalMap: TX.grainN, normalScale: new THREE.Vector2(1.5, 1.5) }));
    this.sed.position.y = floor + 0.0002; this.group.add(this.sed);
    this.state = { bloom: 0, settle: 0, sediment: 0, suspended: 0 };
  }
  _p(i, s, time, o, c) {
    const { inner, floor, level, t0, T } = this.o; const t = s - t0; if (t < 0) return false;
    const bloom = sm(0, 1.2, t), settle = sm(1.5, T, t);
    const a = hh(i, 1) * 6.283, rr = Math.sqrt(hh(i, 2)), y0 = level - 0.004 - hh(i, 3) * (level - floor) * (0.25 + 0.75 * bloom);
    const swirl = a + t * (0.6 + hh(i, 4)) * (1 - settle * 0.8);
    const fall = settle * (1 - Math.pow(hh(i, 5), 3) * 0.05);
    const y = y0 + (floor + 0.002 + hh(i, 6) * 0.004 - y0) * fall;
    const R = inner(y) * 0.92 * rr * Math.min(1, bloom * 1.3);
    o.x = Math.cos(swirl) * R; o.z = Math.sin(swirl) * R; o.y = y;
    o.size = 0.0045 * (0.6 + hh(i, 7)) * (1 - settle * 0.5); o.alpha = 0.22 * bloom * (1 - settle * 0.85);
    const k = 0.85 + 0.25 * hh(i, 8); o.r = c.r * k; o.g = c.g * k; o.b = c.b * k; return true;
  }
  update(s, time) {
    const { floor, level, t0, T } = this.o; const t = s - t0;
    const bloom = sm(0, 1.2, t), settle = sm(1.5, T, t);
    this.cloud.update(s, time); if (this.glint) this.glint.update(s, time);
    const mc = this.mc; mc.reset();
    const clumpVis = bloom * (1 - settle);
    if (clumpVis > 0.02) {
      for (let b = 0; b < 7; b++) {
        const a = hh(b, 21) * 6.28 + t * 0.5, r = 0.15 + hh(b, 22) * 0.35;
        const y = 0.85 - hh(b, 23) * 0.5 * bloom - settle * 0.7;
        mc.addBall(0.5 + Math.cos(a) * r * this.mcR, Math.max(0.08, y), 0.5 + Math.sin(a) * r * this.mcR, 0.05 * clumpVis * Math.min(1, this.mcR * 3), 14);
      }
    }
    mc.update(); mc.visible = clumpVis > 0.02;
    this.mcMat.opacity = 0.75 * clumpVis;
    const sed = sm(2, T * 1.05, t);
    this.sed.scale.y = Math.max(0.0001, 0.006 * sed); this.sed.visible = sed > 0.01;
    this.state = { bloom, settle, sediment: sed, suspended: bloom * (1 - settle) };
  }
}

/** Crown splash from a falling drop (cold open): a thin water crown with a scalloped rim, round droplets
 *  flung off its tips, and a Worthington jet. Pure function of age (seconds since impact). */
export class Splash {
  constructor(mat, size = 0.05) {
    this.group = new THREE.Group(); this.size = size; this.mat = mat;
    this.crown = new THREE.Mesh(new THREE.BufferGeometry(), mat); this.crown.renderOrder = 4; this.group.add(this.crown);
    this.drops = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 16, 12), mat, 40); this.drops.frustumCulled = false; this.group.add(this.drops);
    this.jet = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 16), mat); this.group.add(this.jet);
    this.o = new THREE.Object3D(); this.mc = this.group; // keeps the old .mc handle working
  }
  set(age) {
    const S = this.size, vis = age >= 0 && age < 1.6; this.group.visible = vis; if (!vis) return;
    const rise = Math.sin(Math.min(1, age / 0.55) * Math.PI * 0.5) * (age < 0.55 ? 1 : Math.max(0, 1 - (age - 0.55) / 0.5));
    const R = S * (0.18 + 0.35 * Math.sqrt(age)), H = S * 0.32 * rise, wall = S * 0.012, N = 12;
    if (H > S * 0.01) {
      const seg = 64, rows = 10, pos = [], idx = [];
      for (let r = 0; r <= rows; r++) for (let k = 0; k <= seg; k++) {
        const v = r / rows, th = k / seg * Math.PI * 2, tip = Math.pow(Math.max(0, Math.cos(th * N / 2)), 6);
        const hh2 = H * v * (1 + 0.35 * tip * v), rr = R + R * 0.25 * v * v + wall * (r % 2 ? 0 : 0);
        pos.push(Math.cos(th) * rr, hh2, Math.sin(th) * rr);
      }
      for (let r = 0; r < rows; r++) for (let k = 0; k < seg; k++) { const a = r * (seg + 1) + k, b = a + seg + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
      this.crown.geometry.dispose(); this.crown.geometry = g; this.crown.visible = true;
      this.crown.material.side = THREE.DoubleSide;
    } else this.crown.visible = false;
    const o = this.o; let n = 0;
    for (let k = 0; k < N * 3; k++) {
      const t0 = 0.12 + (k % 3) * 0.07, a = age - t0; if (a < 0 || a > 0.9) continue;
      const th = (Math.floor(k / 3) + 0.5 * (k % 3 === 2 ? 1 : 0)) / N * Math.PI * 2 + hh(k, 2) * 0.1, v = S * (1.3 + hh(k, 3) * 0.8), up = S * (2.6 + hh(k, 4) * 1.2);
      const y = S * 0.3 + up * a - 4.9 * a * a; if (y < 0) continue;
      o.position.set(Math.cos(th) * (R + v * a), y, Math.sin(th) * (R + v * a)); o.scale.setScalar(S * (0.025 + 0.015 * hh(k, 5))); o.updateMatrix(); this.drops.setMatrixAt(n++, o.matrix);
    }
    this.drops.count = n; this.drops.instanceMatrix.needsUpdate = true;
    const jt = age - 0.5, jh = jt > 0 ? Math.sin(Math.min(1, jt / 0.7) * Math.PI) : 0;
    this.jet.visible = jh > 0.02; this.jet.scale.set(S * 0.05, S * (0.05 + 0.35 * jh), S * 0.05); this.jet.position.y = S * 0.35 * jh;
  }
}
