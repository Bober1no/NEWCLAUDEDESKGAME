// Effervescence: instanced bubbles that nucleate on a surface, grow, detach, rise with wobble while
// speeding up, and pop at the liquid surface into tiny droplets. Closed form in s (scene seconds):
// slot j cycles with period `life`; cycle k spawns only if hash(j,k) < rate(birth time). No frame history.
import * as THREE from 'three';
import { SHARED } from '../render/pipeline.js';

const h1 = (a, b) => { let x = Math.imul(a * 73856093 ^ b * 19349663, 2654435761) >>> 0; x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0; x ^= x >>> 13; return (x >>> 0) / 4294967296; };

function bubbleMat(tint = new THREE.Color(1, 1, 1)) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uTint: { value: tint }, uTime: SHARED.uTime },
    vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * mat3(instanceMatrix) * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uTint; varying vec3 vN; varying vec3 vV;
      void main(){ vec3 n = normalize(vN); float f = 1.0 - abs(dot(n, normalize(vV)));
        float rim = pow(f, 2.2); float spec = pow(max(0.0, dot(reflect(-normalize(vV), n), normalize(vec3(-0.4, 0.8, 0.45)))), 60.0);
        float lowSpec = pow(max(0.0, dot(reflect(-normalize(vV), n), normalize(vec3(0.5, -0.6, 0.6)))), 30.0) * 0.4;
        vec3 c = uTint * (0.5 + 1.4 * rim) + vec3(4.0) * spec + vec3(1.5) * lowSpec;
        gl_FragColor = vec4(c, clamp(rim * 0.85 + spec + 0.05, 0.0, 1.0)); }`
  });
}

export class Bubbles {
  /**
   * opts: n, site(j, k, out:Vector3) → nucleation point (vessel local), rate(sBirth) 0..1, life (s), size (m),
   *       surface(s) → liquid surface y, rise (m/s base), radius(y) → keep inside the vessel wall
   */
  constructor(opts) {
    this.o = Object.assign({ n: 160, life: 1.6, size: 0.0011, rise: 0.06, rate: () => 1, surface: () => 0.05, radius: () => 1, site: (j, k, v) => v.set(0, 0, 0) }, opts);
    const geo = new THREE.IcosahedronGeometry(1, 2);
    this.mesh = new THREE.InstancedMesh(geo, bubbleMat(), this.o.n);
    this.drops = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), bubbleMat(new THREE.Color(0.9, 0.95, 1)), this.o.n * 2);
    for (const m of [this.mesh, this.drops]) { m.frustumCulled = false; m.renderOrder = 4; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); }
    this.group = new THREE.Group(); this.group.add(this.mesh, this.drops);
    this._m = new THREE.Matrix4(); this._v = new THREE.Vector3(); this._s = new THREE.Vector3(); this._q = new THREE.Quaternion();
    this.count = 0;
  }
  update(s) {
    const o = this.o, M = this._m, v = this._v, S = this._s, Q = this._q;
    let live = 0;
    for (let j = 0; j < o.n; j++) {
      const ph = h1(j, 7) * o.life, L = o.life * (0.75 + 0.5 * h1(j, 3));
      const x = s + ph, k = Math.floor(x / L), u = x / L - k, birth = k * L - ph;
      let vis = birth >= 0 && h1(j, k + 11) < o.rate(birth);
      let dropT = -1;
      if (vis) {
        o.site(j, k, v);
        const r0 = o.size * (0.55 + 0.9 * h1(j, k + 5));
        const grow = 0.16;
        let r = r0, y = v.y, px = v.x, pz = v.z;
        if (u < grow) { r = r0 * Math.pow(u / grow, 0.6); }
        else {
          const t = (u - grow) * L;                                  // seconds since detaching
          const sp = o.rise * (0.7 + 0.6 * h1(j, k + 9));
          y += sp * t + 0.5 * 0.08 * t * t;                          // accelerates as it grows/rises
          const w = 0.0012 * Math.min(1, t * 3);
          px += Math.sin(t * 19 + j) * w; pz += Math.cos(t * 23 + j * 1.7) * w;
          r *= 1 + t * 0.25;
          const lim = o.radius(y) - r; const d = Math.hypot(px, pz); if (d > lim && d > 0) { px *= lim / d; pz *= lim / d; }
          const surf = o.surface(s);
          if (y > surf - r) { const tp = (y - (surf - r)) / Math.max(1e-4, sp); dropT = tp; vis = false; }
        }
        if (vis) { S.setScalar(r); v.set(px, y, pz); M.compose(v, Q, S); this.mesh.setMatrixAt(live++, M); }
        if (dropT >= 0 && dropT < 0.25 && j % 2 === 0) {
          for (let d = 0; d < 2; d++) {
            const a = h1(j, k + d * 13) * Math.PI * 2, vx = Math.cos(a) * 0.03, vz = Math.sin(a) * 0.03, vy = 0.12 + 0.1 * h1(j, k + d);
            const sy = o.surface(s) + vy * dropT - 4.9 * dropT * dropT;
            if (sy > o.surface(s) - 0.001) { S.setScalar(o.size * 0.25); v.set(px + vx * dropT, sy, pz + vz * dropT); M.compose(v, Q, S); this.drops.setMatrixAt(this._dc = (this._dc || 0), M); this._dc++; }
          }
        }
      }
    }
    this.mesh.count = live; this.drops.count = Math.min(this._dc || 0, this.o.n * 2); this._dc = 0; this.count = live;
    this.mesh.instanceMatrix.needsUpdate = true; this.drops.instanceMatrix.needsUpdate = true;
  }
}
