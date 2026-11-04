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

/** Crown splash from a falling drop (cold open): MarchingCubes ring that rises and collapses. */
export class Splash {
  constructor(mat, size = 0.05) {
    this.mc = new MarchingCubes(36, mat, false, false, 9000);
    this.mc.scale.setScalar(size); this.mc.frustumCulled = false; this.mc.renderOrder = 4;
  }
  set(age) {
    const mc = this.mc; mc.reset(); if (age < 0 || age > 1.6) { mc.visible = false; return; } mc.visible = true;
    const rise = Math.sin(Math.min(1, age / 0.7) * Math.PI) * (age < 0.7 ? 1 : Math.max(0, 1 - (age - 0.7) / 0.6));
    const R = 0.12 + age * 0.22;
    for (let k = 0; k < 14; k++) {
      const a = k / 14 * Math.PI * 2;
      mc.addBall(0.5 + Math.cos(a) * R, 0.06 + rise * 0.22 * (0.8 + 0.4 * hh(k, 3)), 0.5 + Math.sin(a) * R, 0.09 * (1 - age * 0.4), 10);
      mc.addBall(0.5 + Math.cos(a + 0.22) * R, 0.04 + rise * 0.12, 0.5 + Math.sin(a + 0.22) * R, 0.07 * (1 - age * 0.4), 10);
      if (rise > 0.3) mc.addBall(0.5 + Math.cos(a) * R * 1.08, 0.12 + rise * 0.38, 0.5 + Math.sin(a) * R * 1.08, 0.025, 12);
    }
    const jet = Math.max(0, Math.sin(Math.max(0, age - 0.45) / 0.8 * Math.PI)); if (jet > 0) mc.addBall(0.5, 0.15 + jet * 0.5, 0.5, 0.05 * jet, 12);
    mc.update();
  }
}
