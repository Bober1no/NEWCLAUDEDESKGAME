// The lab: environment map (CC0 HDRI, rotated to match the key light, plus emissive softbox cards, built
// from BUILT-IN materials only), bench, splashback, sink, reagent shelf, fume cupboard, window, light shaft,
// dust motes and the light rig.
import * as THREE from 'three';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { M, TX, canvasTex, rng } from './materials.js';
import { asset, reagentBottle, dropperBottle, goggles, Liquid, beaker } from './props.js';
import { SHARED, LAYER_FX } from './pipeline.js';

export async function buildEnvironment(renderer, file = 'assets/hdri/lab.exr', rotY = 1.9) {
  const pm = new THREE.PMREMGenerator(renderer);
  try {
    const tex = await new EXRLoader().loadAsync(asset(file));
    tex.mapping = THREE.UVMapping;
    const es = new THREE.Scene();
    const sph = new THREE.Mesh(new THREE.SphereGeometry(50, 64, 32), new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, color: new THREE.Color(0.55, 0.55, 0.55) }));
    sph.rotation.y = rotY; es.add(sph);
    // softbox cards so glass and steel get a clean key highlight (MeshBasicMaterial, values > 1)
    const card = (w, h, c, k, p, look) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), side: THREE.DoubleSide })); m.position.set(...p); m.lookAt(...look); es.add(m); };
    card(14, 8, 0xfff4e6, 1.4, [-16, 14, 18], [0, 0, 0]);
    card(6, 18, 0xe6f0ff, 0.6, [24, 8, -10], [0, 0, 0]);
    card(30, 2, 0xffffff, 1.0, [0, 30, -20], [0, 0, 0]);
    const rt = pm.fromScene(es, 0, 0.1, 100);
    tex.dispose(); pm.dispose();
    return { texture: rt.texture, source: 'hdri' };
  } catch (e) {
    console.info('[film] HDRI unavailable, using RoomEnvironment', e && e.message);
    const rt = pm.fromScene(new RoomEnvironment(), 0.04); pm.dispose();
    return { texture: rt.texture, source: 'room' };
  }
}

// soft light shaft: fades by height and by the angle between normal and view direction
export function shaftMaterial(col = 0xdfeeff, k = 0.12) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uCol: { value: new THREE.Color(col) }, uK: { value: k }, uTime: SHARED.uTime },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec2 vUv; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uCol; uniform float uK, uTime; varying vec3 vN; varying vec3 vV; varying vec2 vUv;
      void main(){ float f = pow(abs(dot(normalize(vN), normalize(vV))), 1.5); float hgt = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.55, vUv.y);
        float side = smoothstep(0.0, 0.3, vUv.x) * smoothstep(1.0, 0.7, vUv.x); float fl = 0.85 + 0.15 * sin(uTime * 0.7 + vUv.x * 6.0);
        gl_FragColor = vec4(uCol * uK * f * hgt * side * fl, 1.0); }`
  });
}

/** Soft round particles with depth fading against opaque geometry (SHARED.uDepth). */
export function softPointsMaterial({ additive = false, size = 1 } = {}) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, vertexColors: true,
    uniforms: { uScale: { value: 600 * size }, uDepth: SHARED.uDepth, uSoft: SHARED.uSoft, uFull: SHARED.uFull, uNear: SHARED.uNear, uFar: SHARED.uFar },
    vertexShader: `attribute float aSize; attribute float aAlpha; varying vec4 vC; varying float vZ; uniform float uScale;
      void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vZ = -mv.z; gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(aSize * uScale / max(0.001, -mv.z), 0.0, 512.0); vC = vec4(color, aAlpha); }`,
    fragmentShader: `uniform sampler2D uDepth; uniform float uSoft, uNear, uFar; uniform vec2 uFull; varying vec4 vC; varying float vZ;
      float lin(float d){ return uNear * uFar / max(1e-6, (uFar - d * (uFar - uNear))); }
      void main(){ vec2 p = gl_PointCoord * 2.0 - 1.0; float r = dot(p, p); if (r > 1.0) discard; float a = (1.0 - r); a *= a;
        if (uSoft > 0.5) { float sd = lin(texture2D(uDepth, gl_FragCoord.xy / uFull).r); a *= clamp((sd - vZ) / max(0.004, vZ * 0.05), 0.0, 1.0); }
        a *= smoothstep(0.02, 0.08, vZ);
        gl_FragColor = vec4(vC.rgb, vC.a * a); }`
  });
}
/** Points whose state is a pure function: fn(i, s, time, out{x,y,z,size,alpha,r,g,b}) → visible bool. */
export class Particles {
  constructor(n, fn, opts = {}) {
    this.n = n; this.fn = fn;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 3); this.size = new Float32Array(n); this.alpha = new Float32Array(n);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1)); g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    this.points = new THREE.Points(g, softPointsMaterial(opts));
    this.points.frustumCulled = false; this.points.renderOrder = opts.order ?? 5;
    this.o = { x: 0, y: 0, z: 0, size: 0, alpha: 0, r: 1, g: 1, b: 1 };
  }
  update(s, time) {
    const o = this.o;
    for (let i = 0; i < this.n; i++) {
      o.alpha = 0; const vis = this.fn(i, s, time, o);
      const a = vis && Number.isFinite(o.x + o.y + o.z + o.size + o.alpha) ? o.alpha : 0;
      this.pos[i * 3] = vis ? o.x : 0; this.pos[i * 3 + 1] = vis ? o.y : -50; this.pos[i * 3 + 2] = vis ? o.z : 0;
      this.size[i] = a > 0 ? o.size : 0; this.alpha[i] = a; this.col[i * 3] = o.r; this.col[i * 3 + 1] = o.g; this.col[i * 3 + 2] = o.b;
    }
    const g = this.points.geometry; for (const k of ['position', 'color', 'aSize', 'aAlpha']) g.attributes[k].needsUpdate = true;
  }
}

// ------------------------------------------------------------------ the set
export function buildLab(pipeline) {
  RectAreaLightUniformsLib.init();
  const lab = new THREE.Group(); lab.name = 'lab';
  // bench
  const top = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.035, 0.95), M.bench); top.position.y = -0.0175; top.receiveShadow = true; lab.add(top);
  const front = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.82, 0.02), M.cabinet); front.position.set(0, -0.45, 0.46); lab.add(front);
  for (let i = -3; i <= 3; i++) { const h = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.012, 0.012), M.steel); h.position.set(i * 0.48, -0.1, 0.476); lab.add(h); }
  // wet sheen near the sink: a thin clear-coat decal
  const wet = new THREE.Mesh(new THREE.CircleGeometry(0.18, 40), new THREE.MeshPhysicalMaterial({ color: 0x000000, roughness: 0.02, transparent: true, opacity: 0.55, clearcoat: 1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
  wet.rotation.x = -Math.PI / 2; wet.position.set(1.05, 0.0004, 0.12); wet.scale.set(1.6, 0.8, 1); lab.add(wet);
  // splashback tiles + back wall
  const tiles = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.62), M.tile); tiles.position.set(0, 0.31, -0.475); tiles.receiveShadow = true; lab.add(tiles);
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x3a4148, roughness: 0.9 });
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(8, 3), wallMat); wall.position.set(0, 2.1, -0.48); lab.add(wall);
  const side = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), wallMat); side.position.set(-2.4, 1, 0.5); side.rotation.y = Math.PI / 2; lab.add(side);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshStandardMaterial({ color: 0x1b1e22, roughness: 0.8 })); floor.rotation.x = -Math.PI / 2; floor.position.y = -0.86; lab.add(floor);
  // window with daylight (emissive panes + mullions)
  const win = new THREE.Group(); win.position.set(0.95, 1.18, -0.47);
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xd8e8ff).multiplyScalar(3.2) })); win.add(pane);
  for (const x of [-0.6, 0, 0.6]) { const mu = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.84, 0.03), M.whitePlastic); mu.position.x = x; win.add(mu); }
  for (const y of [-0.4, 0.4]) { const mu = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.035, 0.03), M.whitePlastic); mu.position.y = y; win.add(mu); }
  lab.add(win);
  // light shaft from the window across the bench
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.62, 1.6, 24, 1, true), shaftMaterial(0xdfe9ff, 0.05));
  shaft.position.set(0.6, 0.6, 0.0); shaft.rotation.set(0.62, 0, 0.32); lab.add(shaft); pipeline.noDepth.add(shaft);
  // fume cupboard (soft focus, left)
  const fc = new THREE.Group(); fc.position.set(-1.25, 0, -0.32);
  const fcBox = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.1, 0.05), M.cabinet); fcBox.position.set(0, 1.25, -0.12); fc.add(fcBox);
  const fcInner = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.68, 0.02), new THREE.MeshStandardMaterial({ color: 0x8c949b, emissive: 0xcfe0ff, emissiveIntensity: 0.35, roughness: 0.8 })); fcInner.position.set(0, 0.36, -0.13); fc.add(fcInner);
  for (const x of [-0.45, 0.45]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.72, 0.18), M.cabinet); p.position.set(x, 0.36, -0.05); fc.add(p); }
  const sash = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 0.36), new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.05, transparent: true, opacity: 0.12, clearcoat: 1, envMapIntensity: 1.6, depthWrite: false })); sash.position.set(0, 0.54, 0.04); fc.add(sash);
  const sashBar = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.03, 0.03), M.steel); sashBar.position.set(0, 0.36, 0.04); fc.add(sashBar);
  lab.add(fc);
  // stainless sink + tap
  const sink = new THREE.Group(); sink.position.set(1.15, 0, 0.0);
  const rim = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.006, 0.34), M.steel); rim.position.y = 0.002; sink.add(rim);
  const bowl = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.16, 0.28), M.steel.clone()); bowl.material.side = THREE.BackSide; bowl.position.y = -0.078; sink.add(bowl);
  const tap = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, -0.2), new THREE.Vector3(0, 0.22, -0.2), new THREE.Vector3(0, 0.3, -0.12), new THREE.Vector3(0, 0.22, -0.05)]), 40, 0.009, 14), M.chrome); sink.add(tap);
  lab.add(sink);
  // reagent shelf (background bokeh)
  const shelf = new THREE.Group(); shelf.position.set(-0.35, 0.46, -0.4);
  const plank = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.02, 0.16), M.wood); shelf.add(plank);
  const names = ['HCl', 'H₂SO₄', 'NaOH', 'CuSO₄', 'KI', 'AgNO₃', 'HNO₃', 'Ca(OH)₂', 'BaCl₂'];
  names.forEach((n, i) => { const b = reagentBottle(n.replace('₂', '2').replace('₄', '4').replace('₃', '3'), i % 3 === 1, 0.12 + (i % 2) * 0.03); b.position.set(-0.66 + i * 0.165, 0.01, 0); b.rotation.y = (i % 3 - 1) * 0.25; shelf.add(b); });
  lab.add(shelf);
  // dropper bottles + goggles that live on the bench (repositioned per scene)
  const props = new THREE.Group(); props.name = 'benchProps';
  const db1 = dropperBottle(true, 'UNIV. IND.'); db1.position.set(-0.42, 0, -0.2); props.add(db1);
  const db2 = dropperBottle(false, 'PHENOL.'); db2.position.set(-0.37, 0, -0.26); props.add(db2);
  const gg = goggles(); gg.position.set(-0.3, 0, 0.1); gg.rotation.y = 0.5; props.add(gg);
  lab.add(props);
  lab.traverse(o => { if (o.isMesh && o.receiveShadow === false && o !== pane) o.receiveShadow = true; });

  // ---------------- lights
  const rig = new THREE.Group(); rig.name = 'rig';
  const key = new THREE.RectAreaLight(0xfff1e2, 10, 0.9, 0.6); key.position.set(-0.7, 1.0, 0.85); key.lookAt(0, 0.05, 0); rig.add(key);
  const spot = new THREE.SpotLight(0xfff1e2, 14, 0, 0.55, 1, 2); spot.position.copy(key.position); spot.target.position.set(0, 0, 0);
  spot.castShadow = true; spot.shadow.bias = -0.00012; spot.shadow.normalBias = 0.0015; spot.shadow.camera.near = 0.3; spot.shadow.camera.far = 4; spot.shadow.radius = 4;
  rig.add(spot, spot.target); pipeline.lights.push(spot);
  const fill = new THREE.RectAreaLight(0xcfe2ff, 4, 1.2, 0.8); fill.position.set(0.95, 1.18, -0.42); fill.lookAt(0, 0, 0.2); rig.add(fill);
  const rim2 = new THREE.DirectionalLight(0xbfd6ff, 0.9); rim2.position.set(0.6, 1.4, -1.6); rig.add(rim2);
  const warm = new THREE.PointLight(0xffa04a, 0, 1.2, 2); warm.position.set(0, 0.2, 0); rig.add(warm);
  const amb = new THREE.HemisphereLight(0x9fb2c8, 0x1a1410, 0.15); rig.add(amb);

  // ---------------- dust motes in the window light (closed-form drift)
  const dust = new Particles(260, (i, s, time, o) => {
    const r = rng(i * 31 + 7); const bx = r(), by = r(), bz = r(), sp = 0.3 + r();
    const t = time * 0.02 * sp;
    o.x = 0.1 + bx * 1.1 + Math.sin(t * 3 + i) * 0.05; o.y = 0.05 + ((by + t) % 1) * 1.1; o.z = -0.4 + bz * 0.8 + Math.cos(t * 2 + i) * 0.04;
    const inBeam = Math.exp(-Math.pow((o.x - 0.55 - (1.1 - o.y) * 0.25) / 0.35, 2));
    o.size = 0.0012 + r() * 0.0015; o.alpha = 0.55 * inBeam * (0.6 + 0.4 * Math.sin(time * 1.3 + i)); o.r = 1; o.g = 0.96; o.b = 0.9; return true;
  }, { additive: true });
  dust.points.layers.set(LAYER_FX); pipeline.noDepth.add(dust.points); lab.add(dust.points);

  return {
    group: lab, rig, key, spot, fill, rim: rim2, warm, amb, dust, shelf, props, sink, fc, win,
    bottles: { indicator: db1, phenol: db2 }, goggles: gg,
    update(time) { dust.update(0, time); }
  };
}
