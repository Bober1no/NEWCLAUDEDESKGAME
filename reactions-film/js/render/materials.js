// Materials library + procedural texture helpers. Every surface gets colour, roughness and normal detail.
import * as THREE from 'three';
import { SHARED } from './pipeline.js';

// ------------------------------------------------------------------ noise
function hash(x, y, s) { let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
/** Tileable value noise, period p. */
export function vnoise(x, y, p = 64, s = 1) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const m = k => ((k % p) + p) % p;
  const a = hash(m(xi), m(yi), s), b = hash(m(xi + 1), m(yi), s), c = hash(m(xi), m(yi + 1), s), d = hash(m(xi + 1), m(yi + 1), s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, y, oct = 4, p = 16, s = 1) { let a = 0, w = 0.5, f = 1; for (let i = 0; i < oct; i++) { a += w * vnoise(x * f, y * f, p * f, s + i); w *= 0.5; f *= 2; } return a; }
export function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; }; }

// ------------------------------------------------------------------ texture builders
function dataTex(w, h, data, { srgb = false, repeat = [1, 1] } = {}) {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]);
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 4;
  t.needsUpdate = true; return t;
}
/** Height function (u,v in 0..1, tileable) → linear normal map via Sobel. */
export function normalFromHeight(w, h, heightFn, strength = 2, opts) {
  const H = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) H[y * w + x] = heightFn(x / w, y / h);
  const d = new Uint8Array(w * h * 4), at = (x, y) => H[((y + h) % h) * w + ((x + w) % w)];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
    const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
    let nx = -dx * strength, ny = -dy * strength, nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * w + x) * 4; d[i] = (nx * 0.5 + 0.5) * 255; d[i + 1] = (ny * 0.5 + 0.5) * 255; d[i + 2] = (nz * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  return dataTex(w, h, d, opts);
}
/** Scalar fn → linear grey map (roughness / AO / metalness). */
export function greyMap(w, h, fn, opts) {
  const d = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = Math.max(0, Math.min(1, fn(x / w, y / h))) * 255; const i = (y * w + x) * 4; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
  return dataTex(w, h, d, opts);
}
/** RGB fn → sRGB colour map. */
export function colourMap(w, h, fn, opts = {}) {
  const d = new Uint8Array(w * h * 4); const c = [0, 0, 0];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { fn(x / w, y / h, c); const i = (y * w + x) * 4; d[i] = c[0] * 255; d[i + 1] = c[1] * 255; d[i + 2] = c[2] * 255; d[i + 3] = 255; }
  return dataTex(w, h, d, { srgb: true, ...opts });
}
/** Canvas texture. */
export function canvasTex(w, h, draw, { srgb = true, repeat } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); draw(g, w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  t.userData.canvas = c; t.userData.ctx = g; return t;
}

// ------------------------------------------------------------------ glass patch
/** Borosilicate glass refracts the glass-free scene texture (so liquids inside stay visible). */
function patchGlass(m) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uGlassScene = SHARED.uGlassScene;
    // includes are expanded after onBeforeCompile, so inline the transmission chunk and rename its sampler
    sh.fragmentShader = sh.fragmentShader.replace('#include <transmission_pars_fragment>', THREE.ShaderChunk.transmission_pars_fragment.replace(/transmissionSamplerMap/g, 'uGlassScene'));
  };
  m.customProgramCacheKey = () => 'boroGlass';
  return m;
}

// ------------------------------------------------------------------ library
export const M = {};
export const TX = {};

export function initMaterials() {
  // ---------- textures
  TX.smudgeR = greyMap(256, 256, (u, v) => 0.012 + 0.03 * Math.pow(fbm(u * 6, v * 6, 4, 6, 3), 3));
  TX.benchN = normalFromHeight(512, 512, (u, v) => {
    let s = 0; for (let k = 0; k < 22; k++) { const r = rng(k * 97 + 5); const a = r() * Math.PI, ox = r(), oy = r(); const d = Math.abs(((u - ox) * Math.sin(a) - (v - oy) * Math.cos(a))); const along = Math.abs((u - ox) * Math.cos(a) + (v - oy) * Math.sin(a)); if (along < 0.25 * r() + 0.05) s += Math.exp(-d * d * 3e5) * 0.6; }
    return s * 0.15 + fbm(u * 8, v * 8, 3, 8, 11) * 0.04;
  }, 4, { repeat: [9, 3] });
  TX.benchR = greyMap(512, 512, (u, v) => 0.14 + 0.16 * fbm(u * 5, v * 5, 4, 5, 21) + 0.14 * Math.pow(fbm(u * 18, v * 18, 2, 18, 4), 4), { repeat: [3, 1.2] });
  TX.brushedN = normalFromHeight(256, 256, (u, v) => fbm(u * 1.5, v * 96, 3, 96, 7) * 0.3, 1.2, { repeat: [2, 2] });
  TX.brushedFine = normalFromHeight(256, 256, (u, v) => fbm(u * 2, v * 128, 2, 128, 9) * 0.15, 0.8, { repeat: [24, 24] });
  TX.castN = normalFromHeight(256, 256, (u, v) => fbm(u * 24, v * 24, 4, 24, 13) * 0.4, 1.6, { repeat: [2, 2] });
  TX.castR = greyMap(128, 128, (u, v) => 0.45 + 0.25 * fbm(u * 10, v * 10, 3, 10, 2), { repeat: [2, 2] });
  TX.woodC = colourMap(256, 64, (u, v, c) => { const g = Math.sin((v * 40 + fbm(u * 3, v * 2, 3, 3, 5) * 6) * Math.PI) * 0.5 + 0.5; const k = 0.75 + 0.25 * g; c[0] = 0.78 * k; c[1] = 0.6 * k; c[2] = 0.38 * k; });
  TX.woodN = normalFromHeight(256, 64, (u, v) => Math.sin((v * 40 + fbm(u * 3, v * 2, 3, 3, 5) * 6) * Math.PI) * 0.06, 1.5);
  TX.tileC = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#9aa3a6'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { const r = rng(x * 7 + y * 13 + 1); const k = 228 + r() * 14; g.fillStyle = `rgb(${k},${k + 2},${k + 3})`; g.fillRect(x * 128 + 3, y * 128 + 3, 122, 122); }
  }, { repeat: [10, 3] });
  TX.tileN = normalFromHeight(256, 256, (u, v) => { const fx = (u * 4) % 1, fy = (v * 4) % 1; const e = Math.min(fx, 1 - fx, fy, 1 - fy); return Math.min(1, e * 60) * 0.2 + fbm(u * 30, v * 30, 2, 30, 3) * 0.01; }, 3, { repeat: [10, 3] });
  TX.rustN = normalFromHeight(256, 256, (u, v) => fbm(u * 12, v * 12, 5, 12, 31) * 0.6 + Math.pow(fbm(u * 30, v * 30, 2, 30, 8), 3) * 0.6, 3, { repeat: [1, 2] });
  TX.grainN = normalFromHeight(256, 256, (u, v) => hash(Math.floor(u * 256), Math.floor(v * 256), 3) * 0.12 + fbm(u * 40, v * 40, 2, 40, 9) * 0.2, 3, { repeat: [3, 3] });
  TX.marbleC = colourMap(256, 256, (u, v, c) => { const vein = Math.pow(Math.abs(Math.sin((u * 3 + fbm(u * 4, v * 4, 5, 4, 41) * 4) * Math.PI)), 0.25); const k = 0.78 + 0.18 * vein; c[0] = k; c[1] = k * 0.99; c[2] = k * 0.97; });
  TX.labelC = canvasTex(256, 128, (g) => { g.fillStyle = '#f2efe6'; g.fillRect(0, 0, 256, 128); g.fillStyle = '#222'; g.font = 'bold 26px JetBrains Mono, monospace'; g.fillText('HCl', 18, 48); g.font = '15px JetBrains Mono, monospace'; g.fillText('dilute · 1.0 M', 18, 78); g.fillStyle = '#ff9f1a'; g.fillRect(190, 20, 46, 46); g.fillStyle = '#000'; g.font = 'bold 30px sans-serif'; g.fillText('!', 207, 56); });

  const env = 1.0;
  // ---------- glass & liquids
  M.glass = patchGlass(new THREE.MeshPhysicalMaterial({
    color: 0xffffff, metalness: 0, roughness: 1, roughnessMap: TX.smudgeR, transmission: 1, ior: 1.47, thickness: 0.0022,
    attenuationColor: new THREE.Color(0.9, 1.0, 0.94), attenuationDistance: 0.6, specularIntensity: 1, clearcoat: 0.3, clearcoatRoughness: 0.04,
    envMapIntensity: 1.0, depthWrite: false
  }));
  M.glassThick = patchGlass(M.glass.clone()); M.glassThick.thickness = 0.008;
  M.liquid = (col = '#ffffff', dist = 3) => new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: 0.02, transmission: 1, ior: 1.33, thickness: 0.05, attenuationColor: new THREE.Color(col), attenuationDistance: dist,
    specularIntensity: 1, envMapIntensity: 1.0, depthWrite: false, side: THREE.FrontSide
  });
  // ---------- metals
  M.steel = new THREE.MeshPhysicalMaterial({ color: 0xc9ccd0, metalness: 1, roughness: 0.28, normalMap: TX.brushedN, normalScale: new THREE.Vector2(0.4, 0.4), envMapIntensity: env });
  M.chrome = new THREE.MeshPhysicalMaterial({ color: 0xd6d8dc, metalness: 1, roughness: 0.12, normalMap: TX.brushedN, normalScale: new THREE.Vector2(0.15, 0.15), envMapIntensity: env });
  M.castIron = new THREE.MeshPhysicalMaterial({ color: 0x23262b, metalness: 0.3, roughness: 0.55, roughnessMap: TX.castR, normalMap: TX.castN, normalScale: new THREE.Vector2(0.7, 0.7), envMapIntensity: env * 0.8 });
  M.blackPaint = new THREE.MeshPhysicalMaterial({ color: 0x14161a, metalness: 0.2, roughness: 0.42, roughnessMap: TX.castR, normalMap: TX.castN, normalScale: new THREE.Vector2(0.4, 0.4), clearcoat: 0.25, envMapIntensity: env * 0.8 });
  M.magnesium = new THREE.MeshPhysicalMaterial({ color: 0xb9bcc0, metalness: 1, roughness: 0.38, normalMap: TX.grainN, normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: env });
  M.zinc = new THREE.MeshPhysicalMaterial({ color: 0x9aa3ab, metalness: 1, roughness: 0.33, normalMap: TX.grainN, normalScale: new THREE.Vector2(0.7, 0.7), envMapIntensity: env });
  M.copper = new THREE.MeshPhysicalMaterial({ color: 0xe0866a, metalness: 1, roughness: 0.3, normalMap: TX.grainN, envMapIntensity: env });
  M.copperSponge = new THREE.MeshPhysicalMaterial({ color: 0x8a3b22, metalness: 0.35, roughness: 0.9, normalMap: TX.rustN, normalScale: new THREE.Vector2(1.4, 1.4), envMapIntensity: env * 0.6 });
  // ---------- bench & set
  M.bench = new THREE.MeshPhysicalMaterial({ color: 0x040405, roughness: 1, roughnessMap: TX.benchR, normalMap: TX.benchN, normalScale: new THREE.Vector2(0.07, 0.07), clearcoat: 0.6, clearcoatRoughness: 0.1, envMapIntensity: 0.35 });
  M.panSteel = new THREE.MeshPhysicalMaterial({ color: 0xc9ccd0, metalness: 1, roughness: 0.3, normalMap: TX.brushedFine, normalScale: new THREE.Vector2(0.25, 0.25), envMapIntensity: 1 });
  M.tile = new THREE.MeshPhysicalMaterial({ map: TX.tileC, color: 0x6f777d, roughness: 0.3, normalMap: TX.tileN, normalScale: new THREE.Vector2(0.6, 0.6), clearcoat: 0.35, envMapIntensity: 0.35 });
  M.cabinet = new THREE.MeshStandardMaterial({ color: 0x5d6770, roughness: 0.55, normalMap: TX.castN, normalScale: new THREE.Vector2(0.15, 0.15) });
  M.wood = new THREE.MeshStandardMaterial({ map: TX.woodC, normalMap: TX.woodN, roughness: 0.75 });
  M.rubber = new THREE.MeshStandardMaterial({ color: 0x23201e, roughness: 0.75, normalMap: TX.grainN, normalScale: new THREE.Vector2(0.2, 0.2) });
  M.redRubber = new THREE.MeshStandardMaterial({ color: 0x9b2c22, roughness: 0.6, normalMap: TX.grainN, normalScale: new THREE.Vector2(0.15, 0.15) });
  M.whitePlastic = new THREE.MeshPhysicalMaterial({ color: 0xe9ebec, roughness: 0.42, clearcoat: 0.2, normalMap: TX.castN, normalScale: new THREE.Vector2(0.05, 0.05) });
  M.blackPlastic = new THREE.MeshPhysicalMaterial({ color: 0x17181a, roughness: 0.5, clearcoat: 0.15, normalMap: TX.castN, normalScale: new THREE.Vector2(0.08, 0.08) });
  M.heatMat = new THREE.MeshStandardMaterial({ map: colourMap(256, 256, (u, v, c) => { const k = 0.62 + 0.15 * fbm(u * 20, v * 20, 4, 20, 77); c[0] = k; c[1] = k * 0.97; c[2] = k * 0.92; }), roughness: 0.95, normalMap: TX.grainN, normalScale: new THREE.Vector2(0.6, 0.6) });
  M.marble = new THREE.MeshPhysicalMaterial({ map: TX.marbleC, roughness: 0.55, transmission: 0.1, thickness: 0.006, normalMap: TX.grainN, normalScale: new THREE.Vector2(0.5, 0.5), envMapIntensity: 0.7 });
  M.zincCarb = new THREE.MeshStandardMaterial({ color: 0xece9e1, roughness: 0.95, normalMap: TX.grainN, normalScale: new THREE.Vector2(1.2, 1.2) });
  M.cuOxide = new THREE.MeshPhysicalMaterial({ color: 0x111111, roughness: 0.6, metalness: 0.3, normalMap: TX.grainN, normalScale: new THREE.Vector2(1.4, 1.4), clearcoat: 0.3, clearcoatRoughness: 0.2 });
  M.cuCarb = new THREE.MeshStandardMaterial({ color: 0x4f9a76, roughness: 0.95, normalMap: TX.grainN, normalScale: new THREE.Vector2(1.2, 1.2) });
  M.ash = new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 1, normalMap: TX.grainN, normalScale: new THREE.Vector2(2, 2) });
  M.latex = new THREE.MeshPhysicalMaterial({ color: 0xff4f5e, roughness: 0.35, sheen: 0.6, sheenColor: new THREE.Color(0xffb0b8), clearcoat: 0.6, transmission: 0.25, thickness: 0.002, envMapIntensity: 0.8 });
  M.amberGlass = patchGlass(M.glass.clone()); M.amberGlass.attenuationColor = new THREE.Color(0.55, 0.28, 0.06); M.amberGlass.attenuationDistance = 0.006;
  M.label = new THREE.MeshStandardMaterial({ map: TX.labelC, roughness: 0.7 });
  M.cloth = new THREE.MeshPhysicalMaterial({ color: 0xf1f3f2, roughness: 0.9, sheen: 1, sheenRoughness: 0.6, sheenColor: new THREE.Color(0xffffff), normalMap: TX.grainN, normalScale: new THREE.Vector2(0.6, 0.6) });
  return M;
}

// ------------------------------------------------------------------ rust shader (procedural mask that grows over time)
const RUST_GLSL = `
  float rh(vec3 p){ return fract(sin(dot(p, vec3(17.1, 113.7, 51.3))) * 43758.5453); }
  float rn(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(mix(rh(i), rh(i+vec3(1,0,0)), f.x), mix(rh(i+vec3(0,1,0)), rh(i+vec3(1,1,0)), f.x), f.y),
               mix(mix(rh(i+vec3(0,0,1)), rh(i+vec3(1,0,1)), f.x), mix(rh(i+vec3(0,1,1)), rh(i+vec3(1,1,1)), f.x), f.y), f.z); }
  float rf(vec3 p){ return rn(p) * 0.5 + rn(p * 2.03) * 0.25 + rn(p * 4.1) * 0.125 + rn(p * 8.3) * 0.0625; }
  float rustMask(vec3 p){
    float n = rf(p * uRustScale);
    float line = exp(-pow((p.y - uWaterline) / 0.004, 2.0));                  // grows from the waterline
    float scr = exp(-pow(fract(p.x * 140.0 + p.y * 37.0) - 0.5, 2.0) * 900.0) * step(0.6, rn(p * 30.0)); // and scratches
    return clamp(n + line * 0.45 + scr * 0.3 - (1.0 - uRust) * 1.15, 0.0, 1.0);
  }`;
/** Steel/iron material with a rust mask driven by uniforms {uRust 0..1, uWaterline (object y), uWet}. */
export function rustMaterial(base = 0x7d8288) {
  const m = new THREE.MeshPhysicalMaterial({ color: base, metalness: 1, roughness: 0.32, normalMap: TX.brushedN, normalScale: new THREE.Vector2(0.3, 0.3), envMapIntensity: 1 });
  const u = { uRust: { value: 0 }, uWaterline: { value: -10 }, uWet: { value: 0 }, uRustScale: { value: 160 } };
  m.userData.rust = u;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vRustP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvRustP = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRustP; uniform float uRust, uWaterline, uWet, uRustScale;' + RUST_GLSL)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float rM = rustMask(vRustP); float rS = smoothstep(0.02, 0.35, rM);
        vec3 rc = mix(vec3(0.42, 0.16, 0.05), vec3(0.62, 0.27, 0.08), rn(vRustP * 400.0));
        rc = mix(rc, vec3(0.25, 0.09, 0.03), smoothstep(0.5, 1.0, rM));
        float wet = uWet * step(vRustP.y, uWaterline);
        rc *= 1.0 - 0.35 * wet;
        diffuseColor.rgb = mix(diffuseColor.rgb, rc, rS);`)
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.0, rS);')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.95 - 0.4 * wet, rS);')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        { float e = 0.0008; float h0 = rustMask(vRustP); vec3 g = vec3(rustMask(vRustP + vec3(e,0,0)) - h0, rustMask(vRustP + vec3(0,e,0)) - h0, rustMask(vRustP + vec3(0,0,e)) - h0) / e;
          normal = normalize(normal - (mat3(viewMatrix) * g) * 0.0009 * rS); }`);
  };
  m.customProgramCacheKey = () => 'rust';
  return m;
}
