// Render pipeline: renderer, quality tiers, post chain, NaN guard, grade, distortion, glass-scene pass.
//
// Glass in three r160 refracts only OPAQUE objects (its transmission buffer), so a liquid inside a beaker
// would vanish behind the glass. Fix: render the scene without glass (layer 1 hidden) into `glassRT`
// (mipmapped, with a depth texture) and point every borosilicate glass material at that texture.
// The same depth texture gives the smoke/steam particles soft depth fading.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';

export const LAYER_GLASS = 1, LAYER_FX = 2;
export const TIERS = ['ULTRA', 'HIGH', 'LOW'];

// Shared uniforms for soft particles and glass refraction (filled every frame).
export const SHARED = {
  uDepth: { value: null }, uSoft: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) }, uFull: { value: new THREE.Vector2(1, 1) },
  uNear: { value: 0.01 }, uFar: { value: 100 }, uGlassScene: { value: null }, uTime: { value: 0 }
};

const SanitizeShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv);
      bvec4 bad = bvec4(c.r != c.r || abs(c.r) > 1e20, c.g != c.g || abs(c.g) > 1e20, c.b != c.b || abs(c.b) > 1e20, c.a != c.a || abs(c.a) > 1e20);
      if (any(bad) || any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0);
      gl_FragColor = vec4(clamp(c.rgb, 0.0, 64.0), clamp(c.a, 0.0, 1.0)); }`
};

// Heat shimmer (rect mask), shockwave ring, zoom-through-glass warp and "liquid over the lens".
const DistortShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uAspect: { value: 1 },
    uShim: { value: new THREE.Vector4(0, 0, 0, 0) }, uShimAmp: { value: 0 },
    uShock: { value: new THREE.Vector3(0.5, 0.5, 0) }, uShockAmp: { value: 0 },
    uWarp: { value: 0 }, uUnder: { value: 0 }, uUnderCol: { value: new THREE.Color(0.5, 0.75, 1) }
  },
  vertexShader: SanitizeShader.vertexShader,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime, uAspect, uShimAmp, uShockAmp, uWarp, uUnder; uniform vec4 uShim; uniform vec3 uShock, uUnderCol; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
    void main(){
      vec2 uv = vUv;
      if (uShimAmp > 0.0) {
        vec2 q = (uv - uShim.xy) / max(uShim.zw, vec2(1e-4));
        float m = smoothstep(1.0, 0.4, abs(q.x)) * smoothstep(0.0, 0.25, q.y) * smoothstep(1.0, 0.55, q.y);
        vec2 o = vec2(n(vec2(uv.x * 38.0, uv.y * 22.0 - uTime * 5.0)) - 0.5, n(vec2(uv.x * 31.0 + 7.0, uv.y * 26.0 - uTime * 6.3)) - 0.5);
        uv += o * m * uShimAmp * 0.012;
      }
      if (uShockAmp > 0.0) {
        vec2 d = uv - uShock.xy; d.x *= uAspect; float r = length(d);
        float ring = exp(-pow((r - uShock.z) / 0.035, 2.0));
        uv -= normalize(d + 1e-5) * vec2(1.0 / uAspect, 1.0) * ring * uShockAmp * 0.04;
      }
      if (uWarp > 0.0) {
        vec2 c = uv - 0.5; float r2 = dot(c, c);
        uv = 0.5 + c * (1.0 - uWarp * 0.35 * r2 * 4.0) + vec2(sin(uv.y * 30.0 + uTime * 3.0), cos(uv.x * 26.0 + uTime * 2.0)) * uWarp * 0.006;
      }
      if (uUnder > 0.0) uv += vec2(n(uv * 9.0 + uTime * 0.6) - 0.5, n(uv * 9.0 - uTime * 0.5 + 3.0) - 0.5) * uUnder * 0.018;
      vec4 col = texture2D(tDiffuse, clamp(uv, 0.001, 0.999));
      if (uUnder > 0.0) { float caust = pow(n(uv * 24.0 + vec2(uTime * 0.7, -uTime * 0.4)), 6.0); col.rgb = mix(col.rgb, col.rgb * uUnderCol + caust * 0.25 * uUnderCol, uUnder * 0.6); }
      gl_FragColor = col;
    }`
};

// Grade: lift/gamma/gain, teal-orange split, edge CA, lens vignette, animated grain, dither, sanitise.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) },
    uLift: { value: new THREE.Vector3(0.0, 0.001, 0.003) }, uGamma: { value: new THREE.Vector3(1, 1, 1) }, uGain: { value: new THREE.Vector3(1.02, 1.0, 0.98) },
    uSplit: { value: 0.35 }, uCA: { value: 1.0 }, uVig: { value: 0.32 }, uGrain: { value: 0.035 }, uGrainOn: { value: 1 }
  },
  vertexShader: SanitizeShader.vertexShader,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime, uSplit, uCA, uVig, uGrain, uGrainOn; uniform vec2 uRes; uniform vec3 uLift, uGamma, uGain; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5; float r2 = dot(c, c);
      vec2 ca = c * r2 * 0.012 * uCA;
      vec3 col = vec3(texture2D(tDiffuse, vUv + ca).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - ca).b);
      col = clamp(col, 0.0, 64.0);
      col = col * uGain + uLift * (1.0 - clamp(col, 0.0, 1.0));
      col = pow(max(col, vec3(0.0)), 1.0 / uGamma);
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      vec3 shadowT = vec3(0.86, 1.0, 1.08), highT = vec3(1.08, 1.0, 0.9);
      float w = smoothstep(0.02, 0.6, l / (1.0 + l));
      col *= mix(vec3(1.0), mix(shadowT, highT, w), uSplit);
      col *= 1.0 - uVig * smoothstep(0.12, 0.72, r2 * 2.2);
      float g = h(vUv * uRes + fract(uTime * 7.13) * 91.7) - 0.5;
      col *= 1.0 + g * uGrain * uGrainOn * 2.0;
      col += (h(vUv * uRes + 3.7) - 0.5) / 255.0;
      if (any(isnan(col)) || any(isinf(col))) col = vec3(0.0);
      gl_FragColor = vec4(clamp(col, 0.0, 64.0), 1.0);
    }`
};

export class Pipeline {
  constructor(canvas, { phone = false } = {}) {
    this.canvas = canvas; this.phone = phone;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.maxDPR = phone ? 1.5 : 1.75;
    this.tier = 'ULTRA';
    this.noDepth = new Set();   // hidden in AO / DoF depth passes (particles, glass)
    this.glassRT = null;
    this.size = new THREE.Vector2(1, 1);
    this.shot = {};
    this.lights = [];           // shadow-casting lights (mapSize per tier)
  }

  build(scene, camera) {
    this.scene = scene; this.camera = camera;
    const r = this.renderer;
    const w = Math.max(1, this.size.x), h = Math.max(1, this.size.y);
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 });
    if (this.composer) this.composer.dispose?.();
    const c = this.composer = new EffectComposer(r, rt);
    this.renderPass = new RenderPass(scene, camera);
    this.sanitize = new ShaderPass(SanitizeShader);
    this.gtao = new GTAOPass(scene, camera, w, h);
    this.gtao.output = GTAOPass.OUTPUT.Default;
    // contact shadows only: radius at the scale of glassware feet / touching atoms (film units are metres)
    this.gtao.blendIntensity = 0.7;
    this.gtao.updateGtaoMaterial({ radius: 0.012, distanceExponent: 1.5, thickness: 0.006, scale: 1, samples: 16, distanceFallOff: 0.6, screenSpaceRadius: false });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    this.bokeh = new BokehPass(scene, camera, { focus: 0.3, aperture: 0.02, maxblur: 0.008 });
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.6, 0.5, 2.0);
    this.distort = new ShaderPass(DistortShader);
    this.grade = new ShaderPass(GradeShader);
    this.output = new OutputPass();
    this.smaa = new SMAAPass(w * r.getPixelRatio(), h * r.getPixelRatio());
    // hide particles/glass while the AO and DoF passes render their own depth/normal buffers
    // AO must only see solid surfaces: hide particles, glass, liquids and anything transparent while it renders
    // its depth/normal buffers (otherwise glass and liquids get blocky black occlusion). DoF hides particles only.
    const isSeeThrough = o => o.isPoints || (o.material && (o.material.transmission > 0 || o.material.transparent || o.material.depthWrite === false || o.layers.mask === 2));
    for (const p of [this.gtao, this.bokeh]) {
      const orig = p.render.bind(p), ao = p === this.gtao;
      p.render = (...a) => {
        const hid = [];
        for (const o of this.noDepth) if (o.visible) { o.visible = false; hid.push(o); }
        if (ao) scene.traverseVisible(o => { if ((o.isMesh || o.isPoints) && isSeeThrough(o)) hid.push(o); });
        for (const o of hid) o.visible = false;
        try { orig(...a); } finally { for (const o of hid) o.visible = true; }
      };
    }
    this.sanitize2 = new ShaderPass(SanitizeShader);
    for (const p of [this.renderPass, this.sanitize, this.gtao, this.bokeh, this.sanitize2, this.bloom, this.distort, this.grade, this.output, this.smaa]) c.addPass(p);
    this.applyTier(this.tier);
    this.resize(this.size.x, this.size.y, true);
  }

  applyTier(t) {
    this.tier = t;
    const ultra = t === 'ULTRA', high = t === 'HIGH';
    if (this.gtao) {
      this.gtao.enabled = ultra; this.bokeh.enabled = ultra; this.smaa.enabled = ultra;
      this.bloom.resolution && this.bloom.setSize(Math.max(1, this.size.x * (ultra ? 1 : 0.5)), Math.max(1, this.size.y * (ultra ? 1 : 0.5)));
    }
    const ms = ultra ? 4096 : high ? 2048 : 1024;
    for (const l of this.lights) {
      if (l.shadow.mapSize.x !== ms) { l.shadow.mapSize.set(ms, ms); if (l.shadow.map) { l.shadow.map.dispose(); l.shadow.map = null; } }
    }
    this.resize(this.size.x, this.size.y, true);
  }

  resize(w, h, force) {
    w = Math.max(1, Math.floor(w)); h = Math.max(1, Math.floor(h));
    if (!force && w === this.size.x && h === this.size.y) return;
    this.size.set(w, h);
    const r = this.renderer;
    const dpr = Math.min(window.devicePixelRatio || 1, this.maxDPR);
    r.setPixelRatio(dpr); r.setSize(w, h, false);
    if (this.composer) {
      this.composer.setPixelRatio(dpr); this.composer.setSize(w, h);
      const ultra = this.tier === 'ULTRA';
      this.bloom.setSize(Math.max(1, w * dpr * (ultra ? 1 : 0.5)), Math.max(1, h * dpr * (ultra ? 1 : 0.5)));
      this.grade.uniforms.uRes.value.set(w * dpr, h * dpr);
    }
    const scale = this.tier === 'LOW' ? 0.4 : this.tier === 'HIGH' ? 0.6 : 1.0;
    const gw = Math.max(2, Math.floor(w * dpr * scale)), gh = Math.max(2, Math.floor(h * dpr * scale));
    if (!this.glassRT) {
      this.glassRT = new THREE.WebGLRenderTarget(gw, gh, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
      this.glassRT.depthTexture = new THREE.DepthTexture(gw, gh);
      this.glassRT.depthTexture.type = THREE.UnsignedIntType;
    } else this.glassRT.setSize(gw, gh);
    SHARED.uGlassScene.value = this.glassRT.texture;
    SHARED.uRes.value.set(gw, gh); SHARED.uFull.value.set(w * dpr, h * dpr);
    if (this.camera) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
  }

  /** Per-shot settings from the scene: bloom, DoF, exposure, distortions. */
  setShot(post = {}, cam = {}, time = 0, motion = true) {
    const b = post.bloom || {};
    if (this.bloom) {
      this.bloom.threshold = b.threshold ?? 2.2; this.bloom.strength = b.strength ?? 0.55; this.bloom.radius = b.radius ?? 0.55;
      const bu = this.bokeh.uniforms;
      bu.focus.value = cam.focus ?? 0.3; bu.aperture.value = cam.aperture ?? 0.0; bu.maxblur.value = cam.maxblur ?? 0.009;
      this.bokeh.enabled = this.tier === 'ULTRA' && (cam.aperture ?? 0) > 0;
      const d = this.distort.uniforms; d.uTime.value = time; d.uAspect.value = this.size.x / this.size.y;
      const sh = post.shimmer; d.uShimAmp.value = sh ? sh.amp : 0; if (sh) d.uShim.value.set(sh.x, sh.y, sh.w, sh.h);
      const sk = post.shock; d.uShockAmp.value = sk ? sk.amp : 0; if (sk) d.uShock.value.set(sk.x, sk.y, sk.r);
      d.uWarp.value = post.warp || 0; d.uUnder.value = post.under || 0; if (post.underCol) d.uUnderCol.value.set(post.underCol);
      this.distort.enabled = !!(sh || sk || post.warp || post.under);
      const g = this.grade.uniforms; g.uTime.value = time; g.uGrainOn.value = motion ? 1 : 0.5;
      g.uVig.value = post.vig ?? 0.32; g.uSplit.value = post.split ?? 0.35;
    }
    this.renderer.toneMappingExposure = (post.exposure ?? 1.0) * 0.9;
  }

  render(glassVisible = true) {
    const { renderer: r, scene, camera } = this;
    SHARED.uNear.value = camera.near; SHARED.uFar.value = camera.far;
    // 1) glass-free scene → glassRT (also provides soft-particle depth)
    if (glassVisible) {
      const mask = camera.layers.mask;
      camera.layers.disable(LAYER_GLASS);
      SHARED.uSoft.value = 0; SHARED.uDepth.value = null;
      r.setRenderTarget(this.glassRT); r.clear(); r.render(scene, camera);
      camera.layers.mask = mask;
      r.setRenderTarget(null);
      SHARED.uDepth.value = this.glassRT.depthTexture; SHARED.uSoft.value = 1;
    } else { SHARED.uSoft.value = 0; SHARED.uDepth.value = null; }
    // 2) main
    if (this.tier === 'LOW' || !this.composer) { r.setRenderTarget(null); r.render(scene, camera); }
    else this.composer.render();
  }

  dispose() { this.composer?.dispose?.(); this.renderer.dispose(); }
}
