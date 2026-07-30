/**
 * Visual effects: particles, tracers, impacts, ground decals and corpses.
 *
 * All of it runs off three pools so a busy fight allocates nothing:
 *   · one THREE.Points buffer for every spark, ember and puff
 *   · a recycled list of ground decal quads
 *   · a recycled list of ring shockwaves
 */
import * as THREE from 'three';
import { plane, ring, unlit, radialTexture, solid } from './materials.js';
import { clamp01, frand, TAU } from '../core/utils.js';
import { BALANCE } from '../core/constants.js';

const MAX_PARTICLES = 2400;

const PARTICLE_VERT = /* glsl */`
  attribute float aSize;
  attribute vec3 aColor;
  attribute float aAlpha;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = aColor;
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (320.0 / max(1.0, -mv.z));
    gl_Position = projectionMatrix * mv;
  }
`;

const PARTICLE_FRAG = /* glsl */`
  uniform sampler2D uTex;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 t = texture2D(uTex, gl_PointCoord);
    if (t.a * vAlpha < 0.01) discard;
    gl_FragColor = vec4(vColor, t.a * vAlpha);
  }
`;

export class FX {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.root.frustumCulled = false;
    scene.add(this.root);

    /* ── particles ─────────────────────────────────────────────────── */
    const g = new THREE.BufferGeometry();
    this.pPos = new Float32Array(MAX_PARTICLES * 3);
    this.pCol = new Float32Array(MAX_PARTICLES * 3);
    this.pSize = new Float32Array(MAX_PARTICLES);
    this.pAlpha = new Float32Array(MAX_PARTICLES);
    g.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.pCol, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.pSize, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.pAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);

    this.pMat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)', 64) } },
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(g, this.pMat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.root.add(this.points);
    this.pGeo = g;

    this.particles = [];        // live particle records
    this.freeSlots = [];
    for (let i = MAX_PARTICLES - 1; i >= 0; i--) this.freeSlots.push(i);

    /* ── decals & rings ────────────────────────────────────────────── */
    this.decals = [];
    this.decalPool = [];
    this.rings = [];
    this.ringPool = [];
    this.corpses = [];
    this.tracers = [];
    this.tracerPool = [];

    this._soft = radialTexture('rgba(255,255,255,0.95)', 'rgba(255,255,255,0)', 64);
    this._scorch = radialTexture('rgba(30,26,22,0.75)', 'rgba(30,26,22,0)', 64);
  }

  /* ── particles ────────────────────────────────────────────────────── */
  emit(x, y, z, {
    count = 1, color = 0xffffff, size = 1.4, life = 0.55, spread = 3,
    speed = 6, gravity = -14, drag = 2.2, up = 1, alpha = 1, sizeGrow = 0,
  } = {}) {
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const slot = this.freeSlots.pop();
      if (slot === undefined) return;
      const a = Math.random() * TAU;
      const el = Math.random() * up;
      const sp = speed * frand(0.35, 1);
      this.particles.push({
        slot,
        x, y, z,
        vx: Math.cos(a) * sp * frand(0.2, 1) + frand(-spread, spread) * 0.35,
        vy: el * sp + frand(0, spread),
        vz: Math.sin(a) * sp * frand(0.2, 1) + frand(-spread, spread) * 0.35,
        life: life * frand(0.7, 1.25),
        maxLife: life,
        size: size * frand(0.65, 1.35),
        sizeGrow,
        gravity, drag, alpha,
        r: c.r, g: c.g, b: c.b,
      });
    }
  }

  /* ── one-shot effects ─────────────────────────────────────────────── */
  muzzleFlash(x, y, z, color = 0xffe9a8) {
    this.emit(x, y, z, { count: 4, color, size: 1.5, life: 0.14, speed: 5, gravity: 0, up: 0.4, drag: 6 });
  }

  impact(x, y, z, color = 0xffd9a0, scale = 1) {
    this.emit(x, y, z, {
      count: Math.round(6 * scale), color, size: 1.1 * scale, life: 0.4,
      speed: 8 * scale, gravity: -20, up: 1.2,
    });
  }

  explosion(x, y, z, radius = 5, color = 0xff9a3c) {
    const s = clamp01(radius / 8) + 0.4;
    this.emit(x, y, z, { count: Math.round(16 * s), color, size: 2.6 * s, life: 0.55, speed: 9 * s, gravity: -12, up: 1.4 });
    this.emit(x, y, z, { count: Math.round(10 * s), color: 0x6b6560, size: 3.4 * s, life: 0.95, speed: 4 * s, gravity: -2, drag: 3.4, up: 1 });
    this.shockwave(x, 0.2, z, radius * 1.5, color);
    this.decal(x, z, radius * 0.85, 0x1e1a16, 9, this._scorch, 0.5);
  }

  shockwave(x, y, z, radius, color = 0xffffff) {
    // each pooled ring owns its material: the pool fades opacity per instance
    const r = this.ringPool.pop() || (() => {
      const m = new THREE.Mesh(ring(0.86, 1, 40), new THREE.MeshBasicMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
      }));
      m.rotation.x = -Math.PI / 2;
      m.renderOrder = 4;
      this.root.add(m);
      return m;
    })();
    r.visible = true;
    r.position.set(x, y + 0.12, z);
    r.scale.setScalar(0.6);
    r.material.color.setHex(color);
    r.material.opacity = 0.75;
    this.rings.push({ mesh: r, t: 0, life: 0.5, target: radius });
  }

  decal(x, z, radius, color, life = 6, texture = null, opacity = 0.6) {
    const d = this.decalPool.pop() || (() => {
      const m = new THREE.Mesh(plane(1, 1), new THREE.MeshBasicMaterial({
        transparent: true, depthWrite: false, opacity: 0.6,
      }));
      m.rotation.x = -Math.PI / 2;
      m.renderOrder = 1;
      this.root.add(m);
      return m;
    })();
    d.visible = true;
    d.position.set(x, 0.05 + Math.random() * 0.02, z);
    d.rotation.z = Math.random() * TAU;
    d.scale.setScalar(radius * 2);
    d.material.map = texture || this._soft;
    d.material.color.setHex(color);
    d.material.opacity = opacity;
    d.material.needsUpdate = true;
    this.decals.push({ mesh: d, t: 0, life, opacity });
  }

  tracer(x0, y0, z0, x1, y1, z1, color = 0xfff0b0, life = 0.09) {
    const t = this.tracerPool.pop() || (() => {
      const m = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.06, 1, 4),
        new THREE.MeshBasicMaterial({
          transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        })
      );
      m.renderOrder = 4;
      this.root.add(m);
      return m;
    })();
    const a = new THREE.Vector3(x0, y0, z0), b = new THREE.Vector3(x1, y1, z1);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const len = a.distanceTo(b);
    t.visible = true;
    t.position.copy(mid);
    t.scale.set(1, Math.max(0.01, len), 1);
    t.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    t.material.color.setHex(color);
    t.material.opacity = 0.9;
    this.tracers.push({ mesh: t, t: 0, life });
  }

  healPulse(x, y, z) {
    this.emit(x, y + 1, z, { count: 4, color: 0x8df0a4, size: 1.2, life: 0.7, speed: 1.6, gravity: 5.5, up: 1.6, drag: 1.2 });
  }

  buildPuff(x, z, radius) {
    this.emit(x, 0.6, z, { count: 10, color: 0xd8cbb0, size: 2.4, life: 0.8, speed: radius * 0.8, gravity: -3, drag: 3.2, up: 0.6, spread: radius * 0.4 });
  }

  spark(x, y, z, color) {
    this.emit(x, y, z, { count: 2, color, size: 0.9, life: 0.25, speed: 5, gravity: -18, up: 1 });
  }

  /** A dying unit's mesh tips over and sinks into the desk. */
  addCorpse(mesh, dir = 0) {
    mesh.userData.__fall = { t: 0, dir: dir || frand(0, TAU), tilt: frand(1.0, 1.5) * (Math.random() < 0.5 ? 1 : -1) };
    this.corpses.push(mesh);
  }

  /* ── frame update ─────────────────────────────────────────────────── */
  update(dt) {
    /* particles */
    const ps = this.particles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.pAlpha[p.slot] = 0;
        this.freeSlots.push(p.slot);
        ps[i] = ps[ps.length - 1];
        ps.pop();
        continue;
      }
      const k = Math.exp(-p.drag * dt);
      p.vx *= k; p.vz *= k;
      p.vy = p.vy * k + p.gravity * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.08) { p.y = 0.08; p.vy = Math.abs(p.vy) * 0.24; p.vx *= 0.6; p.vz *= 0.6; }

      const s = p.slot;
      this.pPos[s * 3] = p.x; this.pPos[s * 3 + 1] = p.y; this.pPos[s * 3 + 2] = p.z;
      this.pCol[s * 3] = p.r; this.pCol[s * 3 + 1] = p.g; this.pCol[s * 3 + 2] = p.b;
      const lifeT = clamp01(p.life / p.maxLife);
      this.pSize[s] = p.size * (1 + p.sizeGrow * (1 - lifeT));
      this.pAlpha[s] = p.alpha * (lifeT > 0.75 ? (1 - lifeT) * 4 : lifeT / 0.75);
    }
    if (ps.length || this._hadParticles) {
      this.pGeo.setDrawRange(0, MAX_PARTICLES);
      this.pGeo.attributes.position.needsUpdate = true;
      this.pGeo.attributes.aColor.needsUpdate = true;
      this.pGeo.attributes.aSize.needsUpdate = true;
      this.pGeo.attributes.aAlpha.needsUpdate = true;
      this._hadParticles = ps.length > 0;
    }

    /* rings */
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const k = clamp01(r.t / r.life);
      r.mesh.scale.setScalar(0.6 + r.target * k);
      r.mesh.material.opacity = 0.75 * (1 - k);
      if (k >= 1) {
        r.mesh.visible = false;
        this.ringPool.push(r.mesh);
        this.rings.splice(i, 1);
      }
    }

    /* decals */
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i];
      d.t += dt;
      const k = clamp01(d.t / d.life);
      d.mesh.material.opacity = d.opacity * (1 - k * k);
      if (k >= 1) {
        d.mesh.visible = false;
        this.decalPool.push(d.mesh);
        this.decals.splice(i, 1);
      }
    }

    /* tracers */
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.t += dt;
      const k = clamp01(t.t / t.life);
      t.mesh.material.opacity = 0.9 * (1 - k);
      if (k >= 1) {
        t.mesh.visible = false;
        this.tracerPool.push(t.mesh);
        this.tracers.splice(i, 1);
      }
    }

    /* corpses */
    for (let i = this.corpses.length - 1; i >= 0; i--) {
      const m = this.corpses[i];
      const f = m.userData.__fall;
      f.t += dt;
      const k = clamp01(f.t / BALANCE.CORPSE_FADE);
      const tip = Math.min(1, f.t * 2.2);
      m.rotation.x = Math.cos(f.dir) * f.tilt * tip;
      m.rotation.z = Math.sin(f.dir) * f.tilt * tip;
      m.position.y = -k * k * 3.4;
      m.scale.setScalar(1 - k * 0.25);
      if (k >= 1) {
        m.parent?.remove(m);
        this.corpses.splice(i, 1);
      }
    }
  }

  clear() {
    for (const p of this.particles) this.freeSlots.push(p.slot);
    this.particles.length = 0;
    this.pAlpha.fill(0);
    for (const c of this.corpses) c.parent?.remove(c);
    this.corpses.length = 0;
    for (const d of this.decals) { d.mesh.visible = false; this.decalPool.push(d.mesh); }
    this.decals.length = 0;
    for (const r of this.rings) { r.mesh.visible = false; this.ringPool.push(r.mesh); }
    this.rings.length = 0;
    for (const t of this.tracers) { t.mesh.visible = false; this.tracerPool.push(t.mesh); }
    this.tracers.length = 0;
  }

  dispose() {
    this.clear();
    this.scene.remove(this.root);
    this.pGeo.dispose();
    this.pMat.dispose();
  }
}

/* ── projectile meshes ─────────────────────────────────────────────── */
export function projectileMesh(kind, color) {
  switch (kind) {
    case 'arc': {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 6), solid(color, { ei: 0.5, emissive: color }));
      return m;
    }
    case 'bomb': {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 6), solid(0x33373d, { ei: 0.1 }));
      return m;
    }
    case 'spray': {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.38, 6, 5), unlit(color, 0.8, { depthWrite: false }));
      return m;
    }
    case 'bolt':
    default: {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.5, 5), unlit(color, 0.95, { depthWrite: false }));
      m.rotation.x = Math.PI / 2;
      const holder = new THREE.Group();
      holder.add(m);
      return holder;
    }
  }
}
