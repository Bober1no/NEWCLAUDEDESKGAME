// Pooled particle FX (one draw call per pool), a bubble pool for fizzing reactions, and the hydrogen fireball.
// All CPU-integrated on typed arrays; no allocation per frame.
import * as THREE from 'three';
import { FXU } from './shared.js';

function pointsMaterial(additive) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, vertexColors: true,
    uniforms: { uScale: { value: 600 } },
    vertexShader: `attribute float aSize; attribute float aAlpha; varying vec4 vC; uniform float uScale;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(aSize * uScale / max(0.02, -mv.z), 0.0, 96.0); vC = vec4(color, aAlpha * smoothstep(0.06, 0.32, -mv.z)); }`,
    fragmentShader: `varying vec4 vC; void main(){ vec2 p = gl_PointCoord * 2.0 - 1.0; float r = dot(p, p); if (r > 1.0) discard; float a = 1.0 - r; gl_FragColor = vec4(vC.rgb, vC.a * a * a); }`
  });
}

export class ParticlePool {
  constructor(max, additive) {
    this.max = max; this.n = 0;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 3); this.size = new Float32Array(max); this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3); this.age = new Float32Array(max); this.life = new Float32Array(max); this.s0 = new Float32Array(max); this.s1 = new Float32Array(max);
    this.grav = new Float32Array(max); this.drag = new Float32Array(max); this.a0 = new Float32Array(max); this.floor = new Float32Array(max);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    this.points = new THREE.Points(g, pointsMaterial(additive)); this.points.frustumCulled = false; this.points.renderOrder = additive ? 8 : 7;
  }
  /** emit one particle. o: {p:[x,y,z], v:[x,y,z], life, size, size1, col:[r,g,b], alpha, grav, drag, floor} */
  emit(px, py, pz, vx, vy, vz, life, size, size1, r, g, b, alpha, grav = 0, drag = 0, floor = -1e9) {
    let i = this.n < this.max ? this.n++ : Math.floor(Math.random() * this.max);
    this.pos[i * 3] = px; this.pos[i * 3 + 1] = py; this.pos[i * 3 + 2] = pz; this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.age[i] = 0; this.life[i] = life; this.s0[i] = size; this.s1[i] = size1; this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b;
    this.a0[i] = alpha; this.grav[i] = grav; this.drag[i] = drag; this.floor[i] = floor;
  }
  update(dt) {
    let n = this.n;
    for (let i = 0; i < n; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) { // swap-remove
        n--; this.copy(n, i); i--; continue;
      }
      const k = i * 3, d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[k] *= d; this.vel[k + 1] = this.vel[k + 1] * d - this.grav[i] * dt; this.vel[k + 2] *= d;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
      if (this.pos[k + 1] < this.floor[i]) { this.pos[k + 1] = this.floor[i]; this.vel[k + 1] *= -0.25; this.vel[k] *= 0.5; this.vel[k + 2] *= 0.5; }
      const u = this.age[i] / this.life[i];
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * u;
      this.alpha[i] = this.a0[i] * Math.min(1, u * 8) * (1 - u * u);
    }
    this.n = n;
    const g = this.points.geometry; g.setDrawRange(0, n);
    for (const a of ['position', 'color', 'aSize', 'aAlpha']) { const at = g.attributes[a]; at.needsUpdate = true; at.clearUpdateRanges?.(); at.addUpdateRange?.(0, n * at.itemSize); }
  }
  copy(from, to) {
    for (const [arr, w] of [[this.pos, 3], [this.vel, 3], [this.col, 3]]) for (let c = 0; c < w; c++) arr[to * w + c] = arr[from * w + c];
    for (const arr of [this.size, this.alpha, this.age, this.life, this.s0, this.s1, this.grav, this.drag, this.a0, this.floor]) arr[to] = arr[from];
  }
}

/** Fizz bubbles: instanced spheres with a rim-lit bubble shader, simple rise + wobble, pop at a surface height. */
export class BubblePool {
  constructor(max = 600) {
    this.max = max; this.n = 0;
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * instanceMatrix * vec4(position,1.0); vN = normalize(normalMatrix * mat3(instanceMatrix) * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec3 vN; varying vec3 vV; void main(){ vec3 n = normalize(vN); float f = 1.0 - abs(dot(n, normalize(vV))); float rim = pow(f, 2.2); float sp = pow(max(0.0, dot(reflect(-normalize(vV), n), normalize(vec3(-0.4,0.8,0.45)))), 50.0); gl_FragColor = vec4(vec3(0.6 + 1.4 * rim) + 3.0 * sp, clamp(rim * 0.8 + sp + 0.05, 0.0, 1.0)); }`
    });
    this.mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), mat, max); this.mesh.frustumCulled = false; this.mesh.count = 0; this.mesh.renderOrder = 6;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.p = new Float32Array(max * 3); this.r = new Float32Array(max); this.top = new Float32Array(max); this.v = new Float32Array(max); this.ph = new Float32Array(max);
    this._m = new THREE.Matrix4();
  }
  emit(x, y, z, r, top) { const i = this.n < this.max ? this.n++ : Math.floor(Math.random() * this.max); this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z; this.r[i] = r; this.top[i] = top; this.v[i] = 0.02; this.ph[i] = Math.random() * 6.28; }
  update(dt, time) {
    let n = this.n; const m = this._m;
    for (let i = 0; i < n; i++) {
      this.v[i] = Math.min(0.25, this.v[i] + dt * 0.35); this.p[i * 3 + 1] += this.v[i] * dt; this.r[i] *= 1 + dt * 0.15;
      if (this.p[i * 3 + 1] > this.top[i]) { n--; const a = i, b = n; for (let c = 0; c < 3; c++) this.p[a * 3 + c] = this.p[b * 3 + c]; this.r[a] = this.r[b]; this.top[a] = this.top[b]; this.v[a] = this.v[b]; this.ph[a] = this.ph[b]; i--; continue; }
      const w = 0.0012 * Math.sin(time * 18 + this.ph[i]);
      m.makeScale(this.r[i], this.r[i], this.r[i]); m.setPosition(this.p[i * 3] + w, this.p[i * 3 + 1], this.p[i * 3 + 2] + w * 0.7); this.mesh.setMatrixAt(i, m);
    }
    this.n = n; this.mesh.count = n; this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** Hydrogen fireball: noise-displaced expanding shell with a hot core → orange → smoky edge. */
export class Fireball {
  constructor() {
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uAge: { value: 0 }, uTime: FXU.uTime },
      vertexShader: `uniform float uAge, uTime; varying float vN; varying vec3 vNo; varying vec3 vV;
        float h(vec3 p){ return fract(sin(dot(p, vec3(12.9, 78.2, 37.7))) * 43758.5); }
        float n3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z); }
        void main(){ float n = n3(position * 4.0 + vec3(0.0, -uAge * 6.0, uAge * 2.0)) * 0.6 + n3(position * 9.0 - uAge * 4.0) * 0.4; vN = n;
          vec3 p = position * (1.0 + (n - 0.5) * 0.45); vec4 mv = modelViewMatrix * vec4(p, 1.0); vNo = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform float uAge; varying float vN; varying vec3 vNo; varying vec3 vV;
        void main(){ float f = abs(dot(normalize(vNo), normalize(vV))); float core = pow(f, 2.0); float heat = clamp(1.0 - uAge * 1.4, 0.0, 1.0);
          float t = clamp(vN * 0.8 + core * 0.6, 0.0, 1.0) * heat;
          vec3 c = mix(vec3(0.55, 0.08, 0.02), vec3(2.6, 0.9, 0.12), smoothstep(0.1, 0.5, t)); c = mix(c, vec3(4.0, 3.2, 1.4), smoothstep(0.55, 0.95, t));
          c = mix(c, vec3(0.35, 0.6, 2.0), (1.0 - f) * 0.35 * heat * heat);
          float a = smoothstep(0.3, 0.7, vN + core * 0.35) * (1.0 - smoothstep(0.35, 1.0, uAge)); gl_FragColor = vec4(c * a * 0.8, 1.0); }`
    });
    this.mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 4), this.mat); this.mesh.visible = false; this.mesh.renderOrder = 9;
    this.light = new THREE.PointLight(0xffa860, 0, 8, 2);
    this.group = new THREE.Group(); this.group.add(this.mesh, this.light); this.age = 99; this.size = 1;
  }
  start(pos, size) { this.group.position.copy(pos); this.age = 0; this.size = size; }
  update(dt) {
    this.age += dt; const a = this.age, on = a < 1.2; this.mesh.visible = on;
    if (!on) { this.light.intensity = 0; return; }
    this.mesh.scale.setScalar(Math.max(0.001, this.size * (1 - Math.exp(-a * 7)))); this.mat.uniforms.uAge.value = a;
    this.light.intensity = 25 * this.size * Math.exp(-a * 5);
  }
}

/** Convenience emitters on top of two pools (additive "glow" and normal "smoke"). */
export class FX {
  constructor(scene) {
    this.glow = new ParticlePool(5000, true); this.smoke = new ParticlePool(5000, false); this.bubbles = new BubblePool(700);
    this.fireballs = [new Fireball(), new Fireball(), new Fireball(), new Fireball()]; this.fbi = 0;
    scene.add(this.glow.points, this.smoke.points, this.bubbles.mesh); for (const f of this.fireballs) scene.add(f.group);
  }
  sparks(p, n = 20, speed = 3, col = [3, 2.4, 1.4], life = 0.5, size = 0.012) {
    for (let i = 0; i < n; i++) { const a = Math.random() * 6.283, e = Math.random() * 1.2 + 0.1, v = speed * (0.3 + Math.random()); this.glow.emit(p.x, p.y, p.z, Math.cos(a) * Math.cos(e) * v, Math.sin(e) * v, Math.sin(a) * Math.cos(e) * v, life * (0.5 + Math.random()), size, size * 0.3, col[0], col[1], col[2], 1, 9.8, 0.5, 0); }
  }
  dust(p, n = 12, col = [0.8, 0.8, 0.78], size = 0.05, speed = 0.6) {
    for (let i = 0; i < n; i++) { const a = Math.random() * 6.283; this.smoke.emit(p.x, p.y, p.z, Math.cos(a) * speed * Math.random(), Math.random() * speed * 0.6, Math.sin(a) * speed * Math.random(), 1.2 + Math.random(), size * 0.5, size * 2, col[0], col[1], col[2], 0.35, -0.1, 1.5); }
  }
  glassGlints(p, n = 16, dir) {
    for (let i = 0; i < n; i++) { const v = 1 + Math.random() * 3; this.glow.emit(p.x, p.y, p.z, (dir ? dir.x * 2 : 0) + (Math.random() - 0.5) * v, Math.random() * v, (dir ? dir.z * 2 : 0) + (Math.random() - 0.5) * v, 0.4 + Math.random() * 0.5, 0.006, 0.002, 2.2, 2.4, 2.6, 1, 9.8, 0.3, 0); }
  }
  splash(p, col, n = 40, floor = 0) {
    for (let i = 0; i < n; i++) { const a = Math.random() * 6.283, v = 0.4 + Math.random() * 1.6; this.smoke.emit(p.x, p.y, p.z, Math.cos(a) * v, 0.5 + Math.random() * 2, Math.sin(a) * v, 0.6 + Math.random() * 0.4, 0.012, 0.006, col.r, col.g, col.b, 0.85, 9.8, 0.2, floor); }
  }
  plume(p, col, n = 8, size = 0.12, rise = 0.4, alpha = 0.25) {
    for (let i = 0; i < n; i++) this.smoke.emit(p.x + (Math.random() - 0.5) * 0.04, p.y, p.z + (Math.random() - 0.5) * 0.04, (Math.random() - 0.5) * 0.15, rise * (0.6 + Math.random() * 0.8), (Math.random() - 0.5) * 0.15, 2 + Math.random() * 2, size * 0.4, size * 2.2, col[0], col[1], col[2], alpha, -0.02, 0.3);
  }
  embers(p, n, col = [3, 1.4, 0.4]) { for (let i = 0; i < n; i++) this.glow.emit(p.x, p.y, p.z, (Math.random() - 0.5) * 0.6, 0.4 + Math.random(), (Math.random() - 0.5) * 0.6, 0.6 + Math.random() * 0.8, 0.01, 0.002, col[0], col[1], col[2], 1, -0.5, 0.8); }
  cloud(p, col, n = 60, radius = 0.12, floor = 0) {
    for (let i = 0; i < n; i++) { const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * radius; this.smoke.emit(p.x + Math.cos(a) * r, p.y + Math.random() * 0.03, p.z + Math.sin(a) * r, (Math.random() - 0.5) * 0.05, 0.02 + Math.random() * 0.05, (Math.random() - 0.5) * 0.05, 3 + Math.random() * 3, 0.02, 0.05, col.r, col.g, col.b, 0.55, 0.01, 0.2, floor); }
  }
  fireball(pos, size) { const f = this.fireballs[this.fbi++ % this.fireballs.length]; f.start(pos, size); }
  update(dt, time) { this.glow.update(dt); this.smoke.update(dt); this.bubbles.update(dt, time); for (const f of this.fireballs) f.update(dt); }
}
