// 3D stage: owns the renderer, pipeline, lab, environment and scenes. Loaded dynamically so the film's
// captions/questions still work if WebGL or the three.js import fails.
import * as THREE from 'three';
import { Pipeline, TIERS, LAYER_GLASS, LAYER_FX, SHARED } from './render/pipeline.js';
import { initMaterials, M } from './render/materials.js';
import { buildLab, buildEnvironment } from './render/lab.js';
import { loadModels, MODELS } from './render/props.js';
import { microBackdrop } from './fx/molecules.js';
import cold from './scenes/coldopen.js';
import r1 from './scenes/language.js';
import r2 from './scenes/synthesis.js';
import r3 from './scenes/decomposition.js';
import r4 from './scenes/displacement.js';
import r5 from './scenes/neutralisation.js';
import r6 from './scenes/precipitation.js';
import r7 from './scenes/redox.js';
import r8 from './scenes/rates.js';
import r9 from './scenes/skills.js';
import epi from './scenes/epilogue.js';

const FACTORIES = { cold, r1, r2, r3, r4, r5, r6, r7, r8, r9, epi };
export { TIERS };

export async function createStage(canvas, { phone = false, onProgress = () => {} } = {}) {
  const gl = canvas.getContext('webgl2');
  if (!gl) throw new Error('WebGL2 unavailable');
  const pipe = new Pipeline(canvas, { phone });
  const renderer = pipe.renderer;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x07090d);
  const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.004, 40);
  camera.layers.enable(LAYER_GLASS); camera.layers.enable(LAYER_FX);
  onProgress(0.15, 'Polishing the glassware…');
  initMaterials();
  onProgress(0.35, 'Loading the lab HDRI…');
  const env = await buildEnvironment(renderer);
  scene.environment = env.texture;
  onProgress(0.55, 'Unpacking the Bunsen burner…');
  await loadModels();
  const lab = buildLab(pipe);
  scene.add(lab.group, lab.rig);
  const micro = microBackdrop(pipe); micro.visible = false; scene.add(micro);
  const K = { THREE, pipe, scene, camera, lab, micro, M, env };
  pipe.size.set(canvas.clientWidth || 1280, canvas.clientHeight || 720);
  pipe.build(scene, camera);
  onProgress(0.75, 'Rehearsing the reactions…');

  const built = {};
  let cur = null, curId = null;
  const camState = { p: new THREE.Vector3(), l: new THREE.Vector3(), snap: true, shot: -1 };
  const tmpL = new THREE.Vector3();

  function get(id) { if (!built[id]) { const sc = FACTORIES[id](K); scene.add(sc.root); sc.root.visible = false; built[id] = sc; } return built[id]; }

  function setSection(id) {
    if (id === curId) return;
    if (cur) { cur.exit?.(); cur.root.visible = false; }
    curId = id; cur = id && FACTORIES[id] ? get(id) : null;
    if (cur) { cur.root.visible = true; cur.enter?.(); }
    camState.snap = true;
  }

  function applyCamera(c, dt) {
    const aspect = pipe.size.x / pipe.size.y;
    const P = new THREE.Vector3(...c.p), L = new THREE.Vector3(...c.l);
    // portrait: pull the camera back (x1.75 at aspect < 0.5, easing to 1 at aspect 1) and widen the lens
    const port = aspect >= 1 ? 0 : aspect <= 0.5 ? 1 : (1 - aspect) / 0.5;
    const k = 1 + 0.75 * port * port * (3 - 2 * port);
    P.sub(L).multiplyScalar(k).add(L);
    let fov = 2 * Math.atan(12 / Math.max(8, c.focal || 35)) * 180 / Math.PI;
    fov = fov * (1 + 0.3 * port);
    if (camState.snap || c.shot !== camState.shot) { camState.p.copy(P); camState.l.copy(L); camState.snap = false; camState.shot = c.shot; }
    else { const a = 1 - Math.exp(-dt * 14); camState.p.lerp(P, a); camState.l.lerp(L, a); }
    camera.position.copy(camState.p); tmpL.copy(camState.l); camera.up.set(Math.sin(c.roll || 0), Math.cos(c.roll || 0), 0); camera.lookAt(tmpL);
    if (Math.abs(camera.fov - fov) > 1e-3) { camera.fov = fov; camera.updateProjectionMatrix(); }
    return { focus: (c.focus || camState.p.distanceTo(camState.l)) * k };
  }

  let lastF = null;
  function frame(id, s, time, dt, { motion = true, render = true } = {}) {
    setSection(id);
    if (!cur) return null;
    SHARED.uTime.value = time;
    const F = cur.update(s, time, motion);
    lastF = F;
    const world = F.world || 'lab';
    lab.group.visible = world === 'lab'; micro.visible = world === 'micro';
    lab.props.visible = world === 'lab' && F.benchProps !== false;
    if (F.goggles) { lab.goggles.position.set(F.goggles[0], 0, F.goggles[1]); lab.goggles.rotation.y = F.goggles[2] || 0; }
    if (F.bottles) { lab.bottles.indicator.position.set(F.bottles[0], 0, F.bottles[1]); lab.bottles.phenol.position.set(F.bottles[0] + 0.05, 0, F.bottles[1] - 0.05); }
    if (micro.visible) micro.userData.update(time);
    if (lab.group.visible) lab.update(time);
    lab.warm.intensity = F.warm ? F.warm.i * 0.2 : 0; if (F.warm) lab.warm.position.set(...F.warm.p);
    // framing correction: the authored shots were too tight. Pull back and widen (lab/void more than micro).
    const pull = F.pull ?? (world === 'micro' ? 1.25 : 1.45), widen = F.pull === 1 ? 1 : world === 'micro' ? 0.92 : 0.8;
    const c0 = F.cam, L = c0.l;
    const cam = { ...c0, p: [L[0] + (c0.p[0] - L[0]) * pull, L[1] + (c0.p[1] - L[1]) * pull, L[2] + (c0.p[2] - L[2]) * pull], focal: Math.max(22, (c0.focal || 35) * widen), focus: (c0.focus || 0) * pull, aperture: (c0.aperture || 0) * 0.85 };
    F.cam = cam;
    const foc = applyCamera(cam, dt);
    pipe.setShot(F.post || {}, { focus: F.cam.focus != null ? foc.focus : undefined, aperture: F.cam.aperture, maxblur: F.cam.maxblur }, time, motion);
    if (render) pipe.render(F.glass !== false);
    return F;
  }

  function resize(w, h) { pipe.resize(w, h); }
  function setTier(t) { pipe.applyTier(t); }

  // ------------------------------------------------ test probes (used by the Playwright harness only)
  const probes = {
    info: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries }),
    framebuffers() {
      const g = renderer.getContext(); const out = [];
      const check = (rt, name) => { if (!rt) return; renderer.setRenderTarget(rt); out.push({ name, ok: g.checkFramebufferStatus(g.FRAMEBUFFER) === g.FRAMEBUFFER_COMPLETE }); };
      if (pipe.composer) { check(pipe.composer.renderTarget1, 'composer1'); check(pipe.composer.renderTarget2, 'composer2'); }
      check(pipe.glassRT, 'glassRT'); renderer.setRenderTarget(null); return out;
    },
    /** Render the current scene into a FloatType target and return {nan, mean, max}. */
    sample(noEnv = false) {
      const w = 160, h = 90; const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType });
      const envSave = scene.environment; if (noEnv) scene.environment = null;
      const glassSave = pipe.glassRT; pipe.render(lastF ? lastF.glass !== false : true);
      renderer.setRenderTarget(rt); renderer.render(scene, camera); renderer.setRenderTarget(null);
      const buf = new Float32Array(w * h * 4); renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf); rt.dispose();
      scene.environment = envSave; void glassSave;
      let nan = 0, sum = 0, max = 0;
      for (let i = 0; i < buf.length; i += 4) { const l = 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2]; if (!Number.isFinite(l)) { nan++; continue; } sum += l; if (l > max) max = l; }
      return { nan, mean: sum / (w * h), max };
    },
    /** NaN in any transform / instance matrix / particle buffer of the current scene. */
    transforms() {
      let bad = 0, n = 0;
      scene.traverse(o => {
        n++; const e = o.matrixWorld.elements; for (let i = 0; i < 16; i++) if (!Number.isFinite(e[i])) { bad++; break; }
        if (o.isInstancedMesh) { const a = o.instanceMatrix.array; for (let i = 0; i < o.count * 16; i++) if (!Number.isFinite(a[i])) { bad++; break; } }
        if (o.isPoints) { const a = o.geometry.attributes.position.array; for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) { bad++; break; } }
      });
      const c = camera.position; return { bad, n, cam: [c.x, c.y, c.z].every(Number.isFinite) };
    },
    state: () => (cur && cur.probe ? cur.probe() : null),
    models: () => ({ ...MODELS.status }),
    env: () => env.source,
    tier: () => pipe.tier
  };
  onProgress(1, 'Rolling…');
  return { frame, setSection, resize, setTier, probes, renderer, scene, camera, pipe, get, lastFrame: () => lastF };
}
