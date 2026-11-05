// Renderer: ACES, sRGB, soft shadows, bloom, shockwave distortion, grade. Quality tiers and dynamic
// resolution keep the frame rate up (it lowers the internal resolution before it drops a tier).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { setGlassQuality } from '../world/materials.js';

const PostShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uAspect: { value: 1 }, uShock: { value: new THREE.Vector3(0.5, 0.5, 0) }, uShockAmp: { value: 0 }, uVig: { value: 0.28 }, uHurt: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime, uAspect, uShockAmp, uVig, uHurt; uniform vec3 uShock; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){ vec2 uv = vUv;
      if (uShockAmp > 0.0) { vec2 d = uv - uShock.xy; d.x *= uAspect; float r = length(d); float ring = exp(-pow((r - uShock.z) / 0.04, 2.0)); uv -= normalize(d + 1e-5) * vec2(1.0 / uAspect, 1.0) * ring * uShockAmp * 0.05; }
      vec3 c = texture2D(tDiffuse, uv).rgb;
      if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);
      c = clamp(c, 0.0, 64.0);
      vec2 q = vUv - 0.5; c *= 1.0 - uVig * smoothstep(0.1, 0.7, dot(q, q) * 2.2);
      c = mix(c, c * vec3(1.4, 0.5, 0.45), uHurt);
      c += (h(vUv * 1000.0 + uTime) - 0.5) / 255.0;
      gl_FragColor = vec4(c, 1.0); }`
};

export class Renderer {
  constructor(canvas, { phone = false } = {}) {
    const r = this.r = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap; r.info.autoReset = false; // counted per frame across all passes
    r.shadowMap.autoUpdate = false; this.shadowDirty = true; // shadow map is redrawn only when something moved
    this.maxDPR = Math.min(window.devicePixelRatio || 1, phone ? 1.5 : 1.75); this.dpr = this.maxDPR; this.tier = 'HIGH';
    this.ft = 16; this.adaptT = 0; this.size = new THREE.Vector2(1, 1); this.shadowLights = [];
  }
  build(scene, camera) {
    this.scene = scene; this.camera = camera;
    const rt = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.r, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.5, 2.4); this.composer.addPass(this.bloom);
    this.post = new ShaderPass(PostShader); this.composer.addPass(this.post);
    this.composer.addPass(new OutputPass());
    this.fxaa = new ShaderPass(FXAAShader); this.composer.addPass(this.fxaa);
  }
  setTier(t) {
    this.tier = t; const ultra = t === 'ULTRA', low = t === 'LOW';
    setGlassQuality(!low);
    const ms = ultra ? 4096 : low ? 1024 : 2048;
    for (const l of this.shadowLights) { if (l.shadow.mapSize.x !== ms) { l.shadow.mapSize.set(ms, ms); l.shadow.map?.dispose(); l.shadow.map = null; } }
    this.r.shadowMap.type = low ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap; this.shadowDirty = true;
    this.dpr = Math.min(this.maxDPR, ultra ? this.maxDPR : low ? 0.85 : 1.25);
    this.resize(this.size.x, this.size.y, true);
  }
  resize(w, h, force) {
    w = Math.max(1, w | 0); h = Math.max(1, h | 0);
    if (!force && w === this.size.x && h === this.size.y) return; this.size.set(w, h);
    this.r.setPixelRatio(this.dpr); this.r.setSize(w, h, false);
    this.composer.setPixelRatio(this.dpr); this.composer.setSize(w, h);
    const bs = this.tier === 'ULTRA' ? 0.5 : 0.35; this.bloom.setSize(Math.max(64, w * this.dpr * bs), Math.max(64, h * this.dpr * bs));
    this.fxaa.uniforms.resolution.value.set(1 / (w * this.dpr), 1 / (h * this.dpr));
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  /** Dynamic resolution: nudge pixel ratio to hold ~60 fps (never above the tier's cap). */
  adapt(dt) {
    this.ft = this.ft * 0.95 + dt * 1000 * 0.05; this.adaptT += dt; if (this.adaptT < 1) return; this.adaptT = 0;
    const cap = this.tier === 'ULTRA' ? this.maxDPR : this.tier === 'LOW' ? 0.85 : 1.25;
    let d = this.dpr; if (this.ft > 19) d = Math.max(0.5, d - 0.1); else if (this.ft < 13) d = Math.min(cap, d + 0.05);
    if (Math.abs(d - this.dpr) > 0.01) { this.dpr = d; this.resize(this.size.x, this.size.y, true); }
  }
  render(time, fx) {
    const u = this.post.uniforms; u.uTime.value = time; u.uAspect.value = this.size.x / this.size.y;
    u.uShockAmp.value = fx.shockAmp || 0; if (fx.shock) u.uShock.value.copy(fx.shock); u.uHurt.value = fx.hurt || 0;
    this.r.toneMappingExposure = fx.exposure ?? 1; this.r.info.reset();
    if (fx.shadows !== false || this.shadowDirty) { this.r.shadowMap.needsUpdate = true; this.shadowDirty = false; }
    if (this.tier === 'LOW') { this.r.setRenderTarget(null); this.r.render(this.scene, this.camera); } else this.composer.render();
  }
}
