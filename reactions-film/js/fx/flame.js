// Bunsen flame: layered cones with a noise-displaced, height-graded additive shader.
// air = 0 → yellow, luminous, wavering, sooty safety flame. air = 1 → roaring blue flame with a pale inner cone.
// Also drives a flickering PointLight whose colour and intensity follow the flame.
import * as THREE from 'three';
import { SHARED } from '../render/pipeline.js';

const NOISE = `
  float fh(vec3 p){ return fract(sin(dot(p, vec3(12.7, 57.1, 113.3))) * 43758.5453); }
  float fn3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(mix(fh(i), fh(i+vec3(1,0,0)), f.x), mix(fh(i+vec3(0,1,0)), fh(i+vec3(1,1,0)), f.x), f.y),
               mix(mix(fh(i+vec3(0,0,1)), fh(i+vec3(1,0,1)), f.x), mix(fh(i+vec3(0,1,1)), fh(i+vec3(1,1,1)), f.x), f.y), f.z); }`;

function coneGeo(r, h, seg = 40, rows = 40) {
  const pts = [];
  for (let i = 0; i <= rows; i++) { const v = i / rows; const rr = r * Math.pow(Math.sin(Math.min(1, v * 1.15) * Math.PI * 0.5 + 0.0001), 0.6) * (1 - Math.pow(v, 2.2)); pts.push(new THREE.Vector2(Math.max(0.00005, rr), v * h)); }
  const g = new THREE.LatheGeometry(pts, seg); return g;
}

function flameMat(layer) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uTime: SHARED.uTime, uAir: { value: 0 }, uK: { value: 1 }, uH: { value: 0.1 }, uLayer: { value: layer }, uSeed: { value: Math.random() * 10 } },
    vertexShader: `uniform float uTime, uAir, uH, uSeed; varying float vH; varying vec3 vN; varying vec3 vV; varying vec3 vP; ${NOISE}
      void main(){ vec3 p = position; float h = clamp(p.y / uH, 0.0, 1.0); vH = h;
        float wav = mix(1.0, 0.25, uAir);
        float n1 = fn3(vec3(p.x * 160.0, h * 6.0 - uTime * 9.0, p.z * 160.0 + uSeed)) - 0.5;
        float sway = sin(uTime * 3.1 + h * 5.0 + uSeed) * 0.0035 + sin(uTime * 7.3 + h * 9.0) * 0.0015;
        p.x += (sway * h * h * 2.0 + n1 * 0.004 * h) * wav; p.z += (cos(uTime * 2.7 + h * 4.0 + uSeed) * 0.003 * h * h * 2.0) * wav;
        p.xz *= 1.0 + n1 * 0.25 * h * wav;
        vec4 mv = modelViewMatrix * vec4(p, 1.0); vP = p; vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uTime, uAir, uK, uLayer; varying float vH; varying vec3 vN; varying vec3 vV; varying vec3 vP; ${NOISE}
      void main(){
        float f = abs(dot(normalize(vN), normalize(vV)));
        float body = pow(f, 1.4);
        float n = fn3(vec3(vP.x * 220.0, vH * 9.0 - uTime * 14.0, vP.z * 220.0));
        vec3 yel = mix(vec3(3.2, 1.25, 0.25), vec3(4.0, 2.4, 0.8), smoothstep(0.1, 0.5, vH)) * (0.65 + 0.6 * n);
        yel = mix(yel, vec3(1.0, 0.28, 0.05) * 0.8, smoothstep(0.75, 1.0, vH));          // sooty orange tip
        vec3 blu = mix(vec3(0.35, 0.55, 2.4), vec3(0.15, 0.25, 1.1), vH) * (0.8 + 0.3 * n);
        vec3 inner = vec3(0.9, 1.6, 3.4);
        vec3 c = uLayer < 0.5 ? mix(yel, blu, uAir) : inner;
        float a = body * smoothstep(0.0, 0.06, vH) * (1.0 - smoothstep(0.82, 1.0, vH));
        a *= uLayer < 0.5 ? mix(0.55, 0.32, uAir) : 0.5 * uAir;
        gl_FragColor = vec4(c * a * uK, 1.0); }`
  });
}

export class Flame {
  constructor() {
    this.group = new THREE.Group();
    this.outerY = new THREE.Mesh(coneGeo(0.0085, 1), flameMat(0));
    this.inner = new THREE.Mesh(coneGeo(0.0055, 1), flameMat(1));
    this.group.add(this.outerY, this.inner);
    this.light = new THREE.PointLight(0xffa040, 0, 1.6, 2); this.light.position.y = 0.04; this.group.add(this.light);
    for (const m of [this.outerY, this.inner]) { m.renderOrder = 6; m.frustumCulled = false; }
    this.set(0, 0, 0);
  }
  /** air 0..1, on 0..1 (ignition scale), time for flicker (idle motion). */
  set(air, on, time) {
    const H = (0.115 - 0.045 * air) * on, Hi = 0.03 * on;
    this.outerY.scale.set(1 + air * 0.15, Math.max(1e-4, H), 1 + air * 0.15); this.inner.scale.set(1, Math.max(1e-4, Hi), 1);
    for (const m of [this.outerY, this.inner]) { m.material.uniforms.uAir.value = air; m.material.uniforms.uH.value = 1; m.visible = on > 0.01; }
    this.outerY.material.uniforms.uK.value = on; this.inner.material.uniforms.uK.value = on;
    const fl = 0.85 + 0.15 * Math.sin(time * 17.0) * Math.sin(time * 5.3 + 1.0) * (1 - air * 0.8);
    this.light.color.setRGB(1, 0.62, 0.25).lerp(new THREE.Color(0.45, 0.6, 1), air);
    this.light.intensity = on * (0.9 - 0.55 * air) * fl * 3.0;
    this.light.position.y = H * 0.5;
  }
}
