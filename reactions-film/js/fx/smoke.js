// Particle effects as pure functions of time: smoke / steam plumes, sparks, dye tendrils (diffusion front),
// condensation mist, and the hydrogen fireball. All soft, depth-faded sprites (see Particles).
import * as THREE from 'three';
import { Particles } from '../render/lab.js';
import { SHARED, LAYER_FX } from '../render/pipeline.js';

export const hh = (a, b = 0) => { let x = Math.imul((a | 0) * 73856093 ^ (b | 0) * 19349663, 2654435761) >>> 0; x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0; x ^= x >>> 13; return (x >>> 0) / 4294967296; };
const sm = (a, b, x) => { const u = !(x > a) ? 0 : x >= b ? 1 : (x - a) / (b - a); return u * u * (3 - 2 * u); };

function fx(p, pipeline) { p.points.layers.set(LAYER_FX); if (pipeline) pipeline.noDepth.add(p.points); return p; }

/** Rising plume. density(s) 0..1 controls emission; colour [r,g,b]; spread, rise speed, life. */
export function plume(pipeline, { n = 220, origin = [0, 0, 0], density = () => 1, col = [1, 1, 1], alpha = 0.18, size = 0.02, rise = 0.08, spread = 0.03, life = 4, grow = 3, lit = true } = {}) {
  return fx(new Particles(n, (i, s, time, o) => {
    const L = life * (0.7 + 0.6 * hh(i, 1)), ph = hh(i, 2) * L, x = s + ph, k = Math.floor(x / L), u = x / L - k, birth = k * L - ph;
    if (birth < 0 || hh(i, k + 3) > density(birth)) return false;
    const age = u * L, a = hh(i, k) * 6.283, r0 = hh(i, k + 1) * 0.004;
    const drift = age * spread;
    o.x = origin[0] + Math.cos(a) * r0 + Math.sin(age * 1.3 + i) * drift * 0.6 + Math.sin(age * 0.4 + k) * drift * 0.5;
    o.z = origin[2] + Math.sin(a) * r0 + Math.cos(age * 1.1 + i * 0.7) * drift * 0.6;
    o.y = origin[1] + rise * age * (0.8 + 0.4 * hh(i, k + 5)) + Math.sin(age * 2 + i) * 0.002;
    o.size = size * (0.4 + grow * u); o.alpha = alpha * sm(0, 0.12, u) * (1 - sm(0.45, 1, u));
    const shade = lit ? 0.75 + 0.25 * Math.sin(a) : 1; o.r = col[0] * shade; o.g = col[1] * shade; o.b = col[2] * shade; return true;
  }), pipeline);
}

/** Ballistic sparks (additive). active(s) 0..1. */
export function sparks(pipeline, { n = 160, origin = [0, 0, 0], active = () => 1, speed = 0.35, life = 0.7, size = 0.0025, col = [3, 2.6, 2] } = {}) {
  return fx(new Particles(n, (i, s, time, o) => {
    const L = life * (0.5 + hh(i, 1)), ph = hh(i, 2) * L, x = s + ph, k = Math.floor(x / L), u = x / L - k, birth = k * L - ph;
    if (birth < 0 || hh(i, k + 3) > active(birth)) return false;
    const t = u * L, a = hh(i, k) * 6.283, el = 0.2 + hh(i, k + 1) * 1.2, v = speed * (0.4 + hh(i, k + 2));
    o.x = origin[0] + Math.cos(a) * Math.cos(el) * v * t; o.z = origin[2] + Math.sin(a) * Math.cos(el) * v * t; o.y = origin[1] + Math.sin(el) * v * t - 2.5 * t * t;
    o.size = size * (1 - u * 0.7); o.alpha = 1 - u; o.r = col[0]; o.g = col[1] * (1 - u * 0.4); o.b = col[2] * (1 - u * 0.7); return true;
  }, { additive: true }), pipeline);
}

/** Dye tendrils spreading from a drop point inside a vessel: the colour change is a diffusion front.
 *  prog(s) 0..1 = how far the front has travelled; colour(i, out) sets particle colour. */
export function dye(pipeline, { n = 700, origin = [0, 0.05, 0], radius = 0.03, floor = 0.003, top = 0.06, prog = () => 0, colour = (i, o) => { o.r = 1; o.g = 0; o.b = 0; }, alpha = 0.2, size = 0.006, seed = 1 } = {}) {
  return fx(new Particles(n, (i, s, time, o) => {
    const p = prog(s); if (p <= 0) return false;
    const tend = i % 9, d = hh(i, seed) , lag = hh(i, seed + 1) * 0.6;
    const q = Math.max(0, Math.min(1, (p - lag * 0.4) / (1 - lag * 0.4)));
    if (q <= 0) return false;
    const a0 = tend / 9 * 6.283 + hh(tend, seed) * 0.6, curl = 2.2 + hh(tend, seed + 4) * 2;
    const depth = q * (top - floor) * (0.4 + 0.8 * d);
    const rad = radius * Math.min(1, q * (0.3 + d * 1.2)) * (0.4 + 0.6 * hh(i, 3));
    const a = a0 + curl * q * (0.5 + d) + Math.sin(time * 0.3 + i) * 0.05;
    o.x = origin[0] + Math.cos(a) * rad; o.z = origin[2] + Math.sin(a) * rad;
    o.y = Math.max(floor + 0.002, origin[1] - depth + Math.sin(q * 9 + i) * 0.002);
    o.size = size * (0.6 + 1.6 * q); o.alpha = alpha * Math.min(1, q * 3) * (0.5 + 0.5 * hh(i, 9));
    colour(i, o, q); return true;
  }), pipeline);
}

/** Hydrogen fireball: noise-displaced expanding shell, white-yellow core → orange → blue-tinged edge → smoke. */
export class Fireball {
  constructor() {
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uAge: { value: 0 }, uTime: SHARED.uTime },
      vertexShader: `uniform float uAge, uTime; varying float vN; varying vec3 vNo; varying vec3 vV;
        float h(vec3 p){ return fract(sin(dot(p, vec3(12.9, 78.2, 37.7))) * 43758.5); }
        float n3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z); }
        void main(){ float n = n3(position * 4.0 + vec3(0.0, -uAge * 6.0, uAge * 2.0)) * 0.6 + n3(position * 9.0 - uAge * 4.0) * 0.4; vN = n;
          vec3 p = position * (1.0 + (n - 0.5) * 0.45); vec4 mv = modelViewMatrix * vec4(p, 1.0); vNo = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform float uAge; varying float vN; varying vec3 vNo; varying vec3 vV;
        void main(){ float f = abs(dot(normalize(vNo), normalize(vV))); float core = pow(f, 2.0);
          float heat = clamp(1.0 - uAge * 1.4, 0.0, 1.0);
          float t = clamp(vN * 0.8 + core * 0.6, 0.0, 1.0) * heat;
          vec3 c = mix(vec3(0.55, 0.08, 0.02), vec3(2.6, 0.9, 0.12), smoothstep(0.1, 0.5, t));
          c = mix(c, vec3(4.0, 3.2, 1.4), smoothstep(0.55, 0.95, t));
          c = mix(c, vec3(0.35, 0.6, 2.0), (1.0 - f) * 0.35 * heat * heat);
          float a = smoothstep(0.3, 0.7, vN + core * 0.35) * (1.0 - smoothstep(0.35, 1.0, uAge));
          gl_FragColor = vec4(c * a * 0.8, 1.0); }`
    });
    this.mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 5), this.mat); this.mesh.renderOrder = 7; this.mesh.visible = false;
    this.light = new THREE.PointLight(0xffb060, 0, 3, 2);
    this.group = new THREE.Group(); this.group.add(this.mesh, this.light);
  }
  /** age seconds since ignition (negative = not yet). */
  set(age, scale = 0.25) {
    const on = age >= 0 && age < 1.2; this.mesh.visible = on;
    if (!on) { this.light.intensity = 0; return; }
    const r = scale * (1 - Math.exp(-age * 7));
    this.mesh.scale.setScalar(Math.max(0.001, r)); this.mat.uniforms.uAge.value = age;
    this.light.intensity = 10 * Math.exp(-age * 5); this.light.color.setRGB(1, 0.75, 0.45);
  }
}
