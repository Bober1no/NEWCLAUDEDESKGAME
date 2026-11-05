// REACTIONS LAB · destruction sandbox. Boot, world, input, loop.
import * as THREE from 'three';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { Physics } from './core/physics.js';
import { Renderer } from './core/render.js';
import { Player } from './core/player.js';
import { Audio } from './core/audio.js';
import { initMaterials } from './world/materials.js';
import { loadModels, asset } from './world/props.js';
import { Debris } from './world/entities.js';
import { Chem, REACTIONS } from './world/chem.js';
import { buildRoom } from './world/room.js';
import { FX } from './fx/particles.js';
import { FXU } from './fx/shared.js';
import { Tools, TOOL_DEFS, explode } from './tools/tools.js';
import { HUD } from './ui/hud.js';

const $ = id => document.getElementById(id);
const store = { get(k, d) { try { const v = localStorage.getItem('rxlab:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('rxlab:' + k, JSON.stringify(v)); } catch { } } };
const phone = Math.min(screen.width, screen.height) < 600 || /Mobi|Android|iPhone/i.test(navigator.userAgent);
const progress = (f, m) => { $('ldBar').style.width = Math.round(f * 100) + '%'; if (m) $('ldMsg').textContent = m; };

async function envMap(r) {
  const pm = new THREE.PMREMGenerator(r);
  try {
    const tex = await new EXRLoader().loadAsync(asset('assets/hdri/lab.exr'));
    const es = new THREE.Scene(); const sph = new THREE.Mesh(new THREE.SphereGeometry(50, 48, 24), new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, color: new THREE.Color(0.6, 0.6, 0.6) })); sph.rotation.y = 1.9; es.add(sph);
    const card = new THREE.Mesh(new THREE.PlaneGeometry(30, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.75, 0.75, 0.72), side: THREE.DoubleSide })); card.position.set(0, 30, 0); card.rotation.x = Math.PI / 2; es.add(card);
    const t = pm.fromScene(es, 0, 0.1, 100).texture; tex.dispose(); pm.dispose(); return { texture: t, source: 'hdri' };
  } catch { const t = pm.fromScene(new RoomEnvironment(), 0.04).texture; pm.dispose(); return { texture: t, source: 'room' }; }
}

async function boot() {
  progress(0.05, 'Unlocking the prep room…');
  const canvas = $('gl');
  if (!canvas.getContext('webgl2')) throw new Error('WebGL2 is not available');
  const G = window.G = { time: 0, entities: new Set(), flashExposure: 0, shakeAmt: 0, shockT: 9, decals: [], stats: { broken: 0 } };
  G.renderer = new Renderer(canvas, { phone });
  G.scene = new THREE.Scene(); G.scene.background = new THREE.Color(0x0b0d10);
  G.camera = new THREE.PerspectiveCamera(store.get('fov', 75), 16 / 9, 0.03, 80); G.scene.add(G.camera);
  progress(0.15, 'Starting the physics engine…');
  G.physics = await Physics.create();
  progress(0.3, 'Polishing the glassware…');
  initMaterials();
  progress(0.45, 'Loading the lab HDRI…');
  const env = await envMap(G.renderer.r); G.scene.environment = env.texture; G.envSource = env.source;
  progress(0.55, 'Unpacking Bunsen burners…');
  await loadModels();
  G.fx = new FX(G.scene); G.chem = new Chem(G); G.debris = new Debris(G); G.audio = new Audio(G);
  // lights: sun through the windows, ceiling panels, soft fill
  RectAreaLightUniformsLib.init();
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.6); sun.position.set(3, 8, -14); sun.target.position.set(0, 0, 0);
  sun.castShadow = true; const sc = sun.shadow.camera; sc.left = -9; sc.right = 9; sc.top = 9; sc.bottom = -9; sc.near = 1; sc.far = 40; sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02; sun.shadow.mapSize.set(2048, 2048);
  G.scene.add(sun, sun.target); G.renderer.shadowLights.push(sun);
  for (const lz of [-2.6, 0.4, 3.2]) { const a = new THREE.RectAreaLight(0xfff6ea, 3.8, 8, 0.4); a.position.set(0, 3.17, lz); a.lookAt(0, 0, lz); G.scene.add(a); }
  G.scene.add(new THREE.HemisphereLight(0xdfe8f2, 0x3a3530, 0.5));
  progress(0.65, 'Setting up the experiments…');
  G.toast = (html, kind, big) => G.hud?.toast(html, kind, big);
  G.explode = (p, power, kind) => explode(G, p, power, kind);
  G.shake = (a) => { if (store.get('motion', true)) G.shakeAmt = Math.min(0.6, G.shakeAmt + a); };
  G.shock = (p, power) => { const v = p.clone().project(G.camera); if (v.z < 1 && Math.abs(v.x) < 1.4 && Math.abs(v.y) < 1.4) { G.shockP = new THREE.Vector3(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5, 0); G.shockT = 0; G.shockPow = power; } const d = G.camera.position.distanceTo(p); if (d < 2.5) G.hurt = Math.max(G.hurt || 0, 0.6 * (1 - d / 2.5)); };
  G.decal = makeDecals(G);
  G.onDiscover = (n, total) => { G.hud.discovered(n, total); if (n === total) G.toast('<b>Every reaction discovered.</b><small>Unit complete. The lab, however, is not.</small>', 'react', true); };
  buildRoom(G);
  G.player = new Player(G, new THREE.Vector3(0, 0, 4.3));
  G.tools = new Tools(G);
  G.hud = new HUD($('hud'), G); G.hud.discovered(0, REACTIONS.length);
  G.renderer.build(G.scene, G.camera); G.renderer.setTier(store.get('quality', phone ? 'LOW' : 'HIGH'));
  progress(0.9, 'Compiling shaders…');
  G.renderer.resize(innerWidth, innerHeight, true); G.renderer.render(0, {});
  progress(1, 'Goggles on.');
  return G;
}

function makeDecals(G) {
  const tex = (draw) => { const c = document.createElement('canvas'); c.width = c.height = 128; draw(c.getContext('2d')); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
  const mats = {
    dent: new THREE.MeshStandardMaterial({ map: tex(g => { const gr = g.createRadialGradient(64, 64, 4, 64, 64, 60); gr.addColorStop(0, 'rgba(20,20,20,.9)'); gr.addColorStop(0.35, 'rgba(60,60,60,.5)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); g.strokeStyle = 'rgba(30,30,30,.7)'; g.lineWidth = 2; for (let i = 0; i < 7; i++) { const a = Math.random() * 6.28; g.beginPath(); g.moveTo(64, 64); g.lineTo(64 + Math.cos(a) * 55, 64 + Math.sin(a) * 55); g.stroke(); } }), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 0.9 }),
    scorch: new THREE.MeshStandardMaterial({ map: tex(g => { const gr = g.createRadialGradient(64, 64, 2, 64, 64, 62); gr.addColorStop(0, 'rgba(8,6,4,.95)'); gr.addColorStop(0.5, 'rgba(30,20,10,.6)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); }), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 1 })
  };
  const geo = new THREE.PlaneGeometry(1, 1);
  return (p, n, size, kind) => {
    const m = new THREE.Mesh(geo, mats[kind] || mats.dent); m.position.copy(p).addScaledVector(n, 0.002); m.lookAt(p.clone().add(n)); m.rotateZ(Math.random() * 6.28); m.scale.setScalar(size * (0.8 + Math.random() * 0.4));
    G.scene.add(m); G.decals.push(m); if (G.decals.length > 150) G.decals.shift().removeFromParent();
  };
}

// ------------------------------------------------------------------ input + loop
function run(G) {
  const keys = {}; let locked = false;
  const menu = $('menu'), canvas = $('gl');
  const sens = () => store.get('sens', 0.0022);
  const lock = () => { G.audio.start(); if (window.__LAB_TEST__) { locked = true; menu.hidden = true; return; } canvas.requestPointerLock?.(); };
  document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === canvas; menu.hidden = locked; document.body.classList.toggle('playing', locked); if (!locked) { for (const k in keys) keys[k] = false; G.tools.fireDown = false; G.tools.release(); } });
  $('play').addEventListener('click', lock); canvas.addEventListener('click', () => { if (!locked) lock(); });
  document.addEventListener('mousemove', e => { if (locked) G.player.look(e.movementX, e.movementY, sens()); });
  document.addEventListener('mousedown', e => { if (locked) G.tools.down(e.button); });
  document.addEventListener('mouseup', e => { if (locked) G.tools.up(e.button); });
  document.addEventListener('contextmenu', e => e.preventDefault());
  document.addEventListener('wheel', e => { if (!locked) return; if (TOOL_DEFS[G.tools.cur].id === 'grab' && G.tools.held) G.tools.wheel(e.deltaY); else G.tools.select((G.tools.cur + (e.deltaY > 0 ? 1 : -1) + TOOL_DEFS.length) % TOOL_DEFS.length); }, { passive: true });
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return; keys[e.code] = true;
    if (!locked) return;
    if (/^Digit[1-6]$/.test(e.code)) G.tools.select(+e.code.slice(5) - 1);
    if (e.code === 'KeyE') { const { hit } = G.tools.ray(2.6); if (hit && hit.entity && hit.entity.interact) hit.entity.interact(); }
    if (e.code === 'KeyR' && e.shiftKey) resetLab();
    if (e.code === 'F3') { e.preventDefault(); G.hud.statsEl.hidden = !G.hud.statsEl.hidden; }
    if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
  });
  document.addEventListener('keyup', e => { keys[e.code] = false; });
  // menu controls
  const q = $('quality'), setQ = (t) => { store.set('quality', t); G.renderer.setTier(t); q.textContent = 'Quality: ' + t; };
  q.textContent = 'Quality: ' + G.renderer.tier; q.addEventListener('click', () => { const t = ['LOW', 'HIGH', 'ULTRA']; setQ(t[(t.indexOf(G.renderer.tier) + 1) % 3]); });
  const s = $('sens'); s.value = sens() * 10000; s.addEventListener('input', () => store.set('sens', s.value / 10000));
  const f = $('fov'); f.value = store.get('fov', 75); f.addEventListener('input', () => { store.set('fov', +f.value); G.camera.fov = +f.value; G.camera.updateProjectionMatrix(); });
  const mo = $('motion'), setM = () => mo.textContent = 'Screen shake: ' + (store.get('motion', true) ? 'on' : 'off'); setM(); mo.addEventListener('click', () => { store.set('motion', !store.get('motion', true)); setM(); });
  $('reset').addEventListener('click', resetLab);
  function resetLab() { location.reload(); }
  window.addEventListener('resize', () => G.renderer.resize(innerWidth, innerHeight));

  let last = performance.now(), fpsT = 0, frames = 0;
  const step = (dt) => {
    G.time += dt; FXU.uTime.value = G.time;
    if (locked || window.__LAB_TEST__) G.player.update(dt, keys);
    G.physics.step(dt, (a, b, f, pt) => { if (a && a.onForce) a.onForce(f, pt, b); if (b && b.onForce) b.onForce(f, pt, a); });
    G.physics.sync();
    for (const e of G.entities) if (e.alive) e.update(dt);
    G.tools.update(dt); G.chem.update(dt); G.debris.update(dt); G.fx.update(dt, G.time);
    // camera shake, exposure flash, shockwave
    if (G.shakeAmt > 0) { G.camera.position.x += (Math.random() - 0.5) * G.shakeAmt * 0.05; G.camera.position.y += (Math.random() - 0.5) * G.shakeAmt * 0.05; G.camera.rotation.z = (Math.random() - 0.5) * G.shakeAmt * 0.02; G.shakeAmt = Math.max(0, G.shakeAmt - dt * 1.5); }
    G.flashExposure = Math.max(0, G.flashExposure - dt * 1.6); G.hurt = Math.max(0, (G.hurt || 0) - dt * 0.8); G.shockT += dt;
  };
  const frame = () => {
    const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
    step(dt);
    G.renderer.render(G.time, { exposure: 1 + G.flashExposure * 0.8, shock: G.shockP, shockAmp: G.shockT < 0.8 ? (1 - G.shockT / 0.8) * (G.shockPow || 1) : 0, hurt: G.hurt, shadows: G.physics.awake > 0 || G.shadowDirty || G.debris.live.length > 0 });
    G.shadowDirty = false;
    if (G.shockT < 0.8) G.renderer.post.uniforms.uShock.value.z = G.shockT * 0.9;
    G.renderer.adapt(dt);
    frames++; fpsT += dt; if (fpsT > 0.5) { G.hud.stats(`${Math.round(frames / fpsT)} fps · ${G.renderer.r.info.render.calls} draws · ${G.physics.world.bodies.len()} bodies · ${G.debris.live.length} live shards · res ${G.renderer.dpr.toFixed(2)}x`); frames = 0; fpsT = 0; }
    requestAnimationFrame(frame);
  };
  if (typeof window.__labInstall === 'function') window.__labInstall({ G, step, keys, lock, render: () => G.renderer.render(G.time, {}) });
  if (!window.__LAB_TEST__) requestAnimationFrame(frame);
}

boot().then(G => { $('loader').classList.add('gone'); $('menu').hidden = false; run(G); }).catch(e => {
  console.error(e); $('loader').classList.add('gone');
  const n = $('notice'); n.hidden = false; n.textContent = /WebGL/i.test(e.message) ? 'WebGL 2 is not available in this browser, so the lab cannot run. Try Chrome or Edge on a desktop.' : 'The 3D engine could not load (are you offline?). Reconnect and reload the page.';
});
