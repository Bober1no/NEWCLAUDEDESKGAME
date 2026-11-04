// Epilogue (32 s) · "The Chain Reaction": a chain-reaction machine built from every reel's apparatus on a
// long dark bench into fog. Spark → Bunsen → ZnCO3 + limewater → lever → Mg in acid → balloon fireball →
// shockwave knocks the burette → 12-beaker indicator wave → tipped beaker → precipitate cascade →
// electron river rusting iron sculptures → central collision sphere → supernova → flame-test fireworks
// over a glass periodic table, key ideas orbiting. Every visual is a pure function of s.
import * as THREE from 'three';
import { camKF, sm, lerp, shake, uiColour, UI_COL } from './common.js';
import { M, canvasTex, rustMaterial, rng } from '../render/materials.js';
import { model, deliveryTube, ribbon, balloon, splint, lumps, markGlass } from '../render/props.js';
import { Bubbles } from '../fx/bubbles.js';
import { Fireball, sparks, plume, hh } from '../fx/smoke.js';
import { Precipitate } from '../fx/precipitate.js';
import { Particles } from '../render/lab.js';
import { LAYER_FX, LAYER_GLASS } from '../render/pipeline.js';
import { atomMat } from '../fx/molecules.js';
import { vessel, bunsenRig, clampArm, rack } from './kit.js';
import { PPT_COLOUR } from '../chem/solubility.js';

export const EPI_T = { spark: 0.6, ignite: 0.8, airOpen: 2.2, heat: 3.0, milk: 4.2, lever: 6.6, drop: 7.0, balloonUp: 8.6, boom: 9.8, knock: 11.0, wave: 11.3, tip: 15.0, ppt: 15.4, river: 19.0, converge: 23.0, nova: 25.6, reveal: 27.0, end: 32 };
const FLAME_TEST = [['Li', '#ff2a3a', 'lithium red'], ['Na', '#ffb21a', 'sodium orange-yellow'], ['K', '#b98cff', 'potassium lilac'], ['Ca', '#ff5a2a', 'calcium brick red'], ['Cu', '#3ff0b0', 'copper blue-green'], ['Ba', '#9dff4a', 'barium apple green'], ['Sr', '#ff1f4f', 'strontium crimson']];
const IDEAS = ['OIL RIG', 'A + B → AB', 'AB → A + B', 'A + BC → AC + B', 'acid + base → salt + water', 'atoms are conserved', 'catalysts aren’t used up'];
// periodic table positions (period, group) for the first four periods
const PT = 'H,1,1 He,1,18 Li,2,1 Be,2,2 B,2,13 C,2,14 N,2,15 O,2,16 F,2,17 Ne,2,18 Na,3,1 Mg,3,2 Al,3,13 Si,3,14 P,3,15 S,3,16 Cl,3,17 Ar,3,18 K,4,1 Ca,4,2 Sc,4,3 Ti,4,4 V,4,5 Cr,4,6 Mn,4,7 Fe,4,8 Co,4,9 Ni,4,10 Cu,4,11 Zn,4,12 Ga,4,13 Ge,4,14 As,4,15 Se,4,16 Br,4,17 Kr,4,18 Rb,5,1 Sr,5,2 Ag,5,11 Sn,5,14 I,5,17 Cs,6,1 Ba,6,2 Au,6,11 Pb,6,14'.split(' ').map(x => { const [e, p, g] = x.split(','); return { e, p: +p, g: +g }; });

export default function (K) {
  const root = new THREE.Group();
  const T = EPI_T;
  // long bench into fog
  const bench = new THREE.Mesh(new THREE.BoxGeometry(9, 0.04, 1.0), M.bench); bench.position.set(2.0, -0.02, 0); bench.receiveShadow = true; root.add(bench);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(14, 4), new THREE.MeshStandardMaterial({ color: 0x0b0e13, roughness: 0.9 })); back.position.set(2, 1.5, -1.2); root.add(back);
  const keyL = new THREE.SpotLight(0xfff1e2, 30, 0, 0.6, 1, 2); keyL.castShadow = true; keyL.shadow.bias = -0.0002; keyL.shadow.normalBias = 0.002; root.add(keyL, keyL.target); K.pipe.lights.push(keyL);
  const fillL = new THREE.PointLight(0x7fb0ff, 3, 3, 2); root.add(fillL);

  // S0/S1: Bunsen + boiling tube + limewater + lever
  const bun = bunsenRig(); root.add(bun.group);
  const piezo = sparks(K.pipe, { n: 60, origin: [bun.top.x, bun.top.y + 0.004, bun.top.z], active: s => (s > T.spark && s < T.spark + 0.25 ? 1 : 0), speed: 0.15, life: 0.25, size: 0.002, col: [2.5, 3, 4] }); root.add(piezo.points);
  const stand = model('retort'); stand.position.set(-0.02, 0, -0.17); root.add(stand);
  const tilt = -1.15, base = new THREE.Vector3(bun.top.x + 0.004, 0.235, bun.top.z);
  const bt = vessel('boiling', { level: 0.001 }); bt.liq.mesh.visible = false; const tg = new THREE.Group(); tg.position.copy(base); tg.rotation.z = tilt; tg.add(bt.g); root.add(tg);
  const zmat = M.zincCarb.clone(); const pile = new THREE.Mesh(new THREE.CylinderGeometry(0.0108, 0.0108, 0.04, 20, 1, false, Math.PI * 0.15, Math.PI * 0.7), zmat); pile.position.y = 0.026; pile.rotation.y = Math.PI / 2; tg.add(pile);
  const mouth = new THREE.Vector3(0, 0.162, 0).applyEuler(new THREE.Euler(0, 0, tilt)).add(base);
  root.add(clampArm([-0.02, 0.29, -0.17], [base.x + Math.sin(-tilt) * 0.12, base.y + Math.cos(tilt) * 0.12, 0]));
  const lime = vessel('tube', { level: 0.11, colour: '#fbfdff', dist: 8 }); lime.g.position.set(0.36, 0, 0); root.add(lime.g);
  root.add(deliveryTube([[mouth.x, mouth.y, 0], [mouth.x + 0.06, mouth.y + 0.035, 0], [0.32, mouth.y + 0.03, 0], [0.36, mouth.y - 0.02, 0], [0.36, 0.12, 0], [0.361, 0.03, 0]]));
  const limeB = new Bubbles({ n: 60, life: 0.8, size: 0.0014, rise: 0.08, surface: () => 0.11, radius: y => lime.u.inner(y), rate: s => (s > T.heat && s < T.lever ? 0.9 : 0), site: (j, k, v) => v.set(0.0008 * Math.sin(j), 0.032, 0.0008 * Math.cos(j)) }); lime.g.add(limeB.group);
  const lever = new THREE.Group(); lever.position.set(0.44, 0.13, 0); root.add(lever);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.006, 0.02), M.steel); bar.position.x = 0.08; lever.add(bar);
  const pivot = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.012, 0.13, 12), M.castIron); pivot.position.set(0.44, 0.065, 0); root.add(pivot);
  const rib = ribbon(0.04); root.add(rib);

  // S2: Mg into acid, balloon, splint, fireball
  const acid = vessel('beaker', { level: 0.05, dist: 10 }); acid.g.position.set(0.66, 0, 0); root.add(acid.g);
  const acidB = new Bubbles({ n: 260, life: 0.7, size: 0.0012, rise: 0.1, surface: () => 0.05, radius: y => acid.u.inner(y), rate: s => (s > T.drop + 0.2 && s < T.boom + 1 ? 1 : 0), site: (j, k, v) => v.set(Math.sin(j * 2.4) * 0.012, acid.u.floor + 0.006, Math.cos(j * 2.4) * 0.012) }); acid.g.add(acidB.group);
  const bln = balloon(0xd9363e); root.add(bln);
  const sp = splint(0.12); sp.position.set(0.86, 0.42, 0); sp.rotation.z = Math.PI - 0.15; root.add(sp);
  const fire = new Fireball(); fire.group.position.set(0.68, 0.4, 0); root.add(fire.group);

  // S3: burette + 12 beakers pH wave
  const bur = model('burette'); bur.position.set(1.0, 0.16, 0); root.add(bur);
  const st2 = model('retort'); st2.position.set(0.96, 0, -0.08); root.add(st2);
  const wave = Array.from({ length: 12 }, (_, i) => { const v = vessel('beaker', { level: 0.042, colour: '#f6fbff', dist: 10, opts: { r: 0.022, h: 0.06, ml: 100, step: 10 } }); v.g.position.set(1.08 + i * 0.058, 0, (i % 2) * 0.02); root.add(v.g); return v; });
  // S4: precipitate cascade
  const prk = rack(5, 0.042); prk.position.set(1.97, 0, 0); root.add(prk);
  const pcols = [PPT_COLOUR.AgCl.hex, PPT_COLOUR.PbI2.hex, PPT_COLOUR['Cu(OH)2'].hex, PPT_COLOUR['Fe(OH)3'].hex, PPT_COLOUR.PbI2.hex];
  const ppts = pcols.map((c, i) => { const v = vessel('tube', { level: 0.1, dist: 10 }); v.g.position.set(1.97 + prk.userData.x(i), 0.004, 0); root.add(v.g); const p = new Precipitate(K.pipe, { inner: v.u.inner, floor: v.u.floor, level: 0.1, colour: c, t0: T.ppt + i * 0.6, T: 5, n: 300, shimmer: i === 4 }); v.g.add(p.group); return { v, p }; });
  const pourStream = new Particles(80, (i, s, time, o) => { if (s < T.tip || s > T.ppt + 3.4) return false; const u = ((i / 80) + s * 2) % 1; const x0 = 1.08 + 11 * 0.058; const tx = 1.97 + prk.userData.x(Math.min(4, Math.floor((s - T.ppt) / 0.6 + 0.0))); o.x = lerp(x0 + 0.03, tx, u); o.y = lerp(0.07, 0.16, Math.sin(u * Math.PI) * 0.6 + (1 - u) * 0.0); o.z = 0; o.size = 0.003; o.alpha = 0.6; o.r = 0.8; o.g = 0.9; o.b = 1; return true; }); pourStream.points.layers.set(LAYER_FX); K.pipe.noDepth.add(pourStream.points); root.add(pourStream.points);
  // S5: electron river + iron sculptures
  const sculpts = [0, 1, 2, 3].map(i => { const mat = rustMaterial(0x6f747a); const geo = new THREE.TorusKnotGeometry(0.03, 0.007, 120, 14, 2 + (i % 2), 3); const m = new THREE.Mesh(geo, mat); m.position.set(2.32 + i * 0.16, 0.06, -0.06 + (i % 2) * 0.1); m.castShadow = true; root.add(m); return m; });
  const riverPath = new THREE.CatmullRomCurve3([new THREE.Vector3(2.2, 0.02, 0.1), new THREE.Vector3(2.4, 0.08, 0.04), new THREE.Vector3(2.55, 0.03, -0.05), new THREE.Vector3(2.75, 0.12, 0.05), new THREE.Vector3(2.9, 0.2, 0.0), new THREE.Vector3(3.1, 0.24, 0)]);
  const river = new Particles(700, (i, s, time, o) => { const on = sm(T.river, T.river + 0.8, s) * (1 - sm(T.nova, T.nova + 0.6, s)); if (on <= 0) return false; const u = ((i / 700) + s * 0.35) % 1; const head = sm(T.river, T.river + 3.2, s); if (u > head) return false; const p = riverPath.getPointAt(u); o.x = p.x + Math.sin(i * 1.3 + time * 3) * 0.006; o.y = p.y + Math.cos(i * 2.1 + time * 2.6) * 0.006; o.z = p.z + Math.sin(i * 0.7 + time * 2) * 0.008; o.size = 0.004 + (i % 3) * 0.0015; o.alpha = on * 0.9; o.r = 0.4; o.g = 2.6; o.b = 3.4; return true; }, { additive: true });
  river.points.layers.set(LAYER_FX); K.pipe.noDepth.add(river.points); root.add(river.points);
  // S6: central glass sphere of colliding particles
  const C = new THREE.Vector3(3.2, 0.26, 0);
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.12, 64, 48), M.glassThick); sphere.layers.set(LAYER_GLASS); sphere.position.copy(C); root.add(sphere);
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.14, 32), M.castIron); plinth.position.set(C.x, 0.07, 0); root.add(plinth);
  const NB = 80; const balls = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 14, 10), atomMat('O'), NB); balls.frustumCulled = false; balls.instanceColor = null; root.add(balls);
  const coll = new Particles(60, (i, s, time, o) => { const rate = sm(T.converge, T.nova, s) * (1 - sm(T.nova, T.nova + 0.5, s)); if (rate <= 0) return false; const per = lerp(0.5, 0.06, rate); const k = Math.floor((s + hh(i, 1) * per) / per); const a = ((s + hh(i, 1) * per) % per) / per; if (hh(i, k) > rate) return false; const th = hh(i, k + 1) * 6.28, ph = Math.acos(2 * hh(i, k + 2) - 1), r = 0.1 * Math.cbrt(hh(i, k + 3)); o.x = C.x + r * Math.sin(ph) * Math.cos(th); o.y = C.y + r * Math.cos(ph); o.z = C.z + r * Math.sin(ph) * Math.sin(th); o.size = 0.02 * (1 - a); o.alpha = 1 - a; o.r = 4; o.g = 3.5; o.b = 1.5; return true; }, { additive: true });
  coll.points.layers.set(LAYER_FX); K.pipe.noDepth.add(coll.points); root.add(coll.points);
  const streams = new Particles(400, (i, s, time, o) => { const on = sm(T.converge, T.converge + 0.6, s) * (1 - sm(T.nova - 0.2, T.nova, s)); if (on <= 0) return false; const src = [[0.1, 0.25, 0], [0.66, 0.2, 0], [1.4, 0.15, 0], [2.05, 0.15, 0], [2.6, 0.2, 0]][i % 5]; const u = ((i / 400) * 5 + s * 0.6) % 1; o.x = lerp(src[0], C.x, u); o.y = lerp(src[1], C.y, u) + Math.sin(u * Math.PI) * 0.12; o.z = Math.sin(u * 9 + i) * 0.02; o.size = 0.004; o.alpha = on * 0.8; const c = [[3, 1.4, 0.4], [3, 3, 3], [1, 3, 1.4], [3, 2.6, 0.6], [0.4, 2.6, 3.4]][i % 5]; o.r = c[0]; o.g = c[1]; o.b = c[2]; return true; }, { additive: true });
  streams.points.layers.set(LAYER_FX); K.pipe.noDepth.add(streams.points); root.add(streams.points);
  const nova = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(7, 7, 7.5), transparent: true, depthWrite: false })); nova.position.copy(C); root.add(nova);
  const shards = new Particles(300, (i, s, time, o) => { const a = s - T.nova; if (a < 0 || a > 3) return false; const th = hh(i, 1) * 6.28, ph = Math.acos(2 * hh(i, 2) - 1), v = 0.4 + hh(i, 3) * 0.8; o.x = C.x + Math.sin(ph) * Math.cos(th) * v * a; o.y = C.y + Math.cos(ph) * v * a - 0.4 * a * a; o.z = C.z + Math.sin(ph) * Math.sin(th) * v * a; o.size = 0.006; o.alpha = (1 - a / 3) * (0.5 + 0.5 * Math.sin(time * 20 + i)); const c = new THREE.Color(UI_COL[i % 14]); o.r = c.r * 2.5; o.g = c.g * 2.5; o.b = c.b * 2.5; return true; }, { additive: true });
  shards.points.layers.set(LAYER_FX); K.pipe.noDepth.add(shards.points); root.add(shards.points);
  // S7: glass periodic table + fireworks + orbiting ideas
  const tableG = new THREE.Group(); tableG.position.set(C.x, 0.62, -0.55); root.add(tableG);
  const tiles = PT.map(it => {
    const ft = FLAME_TEST.find(f => f[0] === it.e);
    const t = canvasTex(128, 128, g => { g.fillStyle = 'rgba(200,230,255,0.06)'; g.fillRect(0, 0, 128, 128); g.strokeStyle = 'rgba(200,235,255,0.6)'; g.lineWidth = 4; g.strokeRect(2, 2, 124, 124); g.fillStyle = '#e8f6ff'; g.font = 'bold 56px Archivo, Arial'; g.textAlign = 'center'; g.fillText(it.e, 64, 84); });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.052, 0.052), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, color: new THREE.Color(1, 1, 1) }));
    m.position.set((it.g - 9.5) * 0.058, (3.5 - it.p) * 0.058, 0); tableG.add(m); return { m, ft, it };
  });
  const tableGlass = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.4, 0.02), M.glassThick); tableGlass.layers.set(LAYER_GLASS); tableGlass.position.set(0, 0.0, -0.015); tableG.add(tableGlass);
  const fireworks = FLAME_TEST.map((f, k) => { const c = new THREE.Color(f[1]); const p = new Particles(160, (i, s, time, o) => { const t0 = T.reveal + 0.3 + k * 0.6, a = s - t0; if (a < 0 || a > 2.2) return false; const th = hh(i, 1 + k) * 6.28, ph = Math.acos(2 * hh(i, 2 + k) - 1), v = 0.25 + hh(i, 3) * 0.12; const cx = C.x + (k - 3) * 0.18, cy = 0.95 + (k % 2) * 0.1; o.x = cx + Math.sin(ph) * Math.cos(th) * v * a; o.y = cy + Math.cos(ph) * v * a - 0.15 * a * a; o.z = -0.4 + Math.sin(ph) * Math.sin(th) * v * a * 0.5; o.size = 0.008 * (1 - a / 2.4); o.alpha = (1 - a / 2.2) * (0.7 + 0.3 * Math.sin(time * 30 + i)); o.r = c.r * 4; o.g = c.g * 4; o.b = c.b * 4; return true; }, { additive: true }); p.points.layers.set(LAYER_FX); K.pipe.noDepth.add(p.points); root.add(p.points); return p; });
  const ring = IDEAS.map((txt, i) => { const t = canvasTex(512, 96, g => { g.clearRect(0, 0, 512, 96); g.fillStyle = 'rgba(5,10,18,.55)'; g.fillRect(0, 10, 512, 76); g.strokeStyle = 'rgba(94,231,255,.8)'; g.lineWidth = 3; g.strokeRect(2, 12, 508, 72); g.fillStyle = '#FFE14D'; g.font = 'bold 40px JetBrains Mono, monospace'; const fs = Math.min(40, Math.floor(40 * 470 / g.measureText(txt).width)); g.font = `bold ${fs}px JetBrains Mono, monospace`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, 256, 49); }); const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false })); m.scale.set(0.26, 0.049, 1); root.add(m); return m; });

  const X = s => lerp(0, 3.2, sm(0, 27, s));
  const KEYS = [
    { s: 0, p: [0.12, 0.2, 0.2], l: [bun.top.x, 0.16, 0], f: 85, ap: 0.05 },
    { s: 3, p: [0.22, 0.29, 0.36], l: [0.1, 0.22, 0], f: 60, ap: 0.03 },
    { s: 5, p: [0.45, 0.17, 0.3], l: [0.36, 0.08, 0], f: 70, ap: 0.04 },
    { s: 6.8, p: [0.55, 0.2, 0.38], l: [0.48, 0.11, 0], f: 50, ap: 0.025 },
    { s: 9.4, p: [0.75, 0.42, 0.55], l: [0.68, 0.32, 0], f: 40, ap: 0.015 },
    { s: 11, p: [1.05, 0.32, 0.6], l: [1.12, 0.12, 0], f: 35, ap: 0.012 },
    { s: 15, p: [1.62, 0.3, 0.5], l: [1.6, 0.06, 0], f: 35, ap: 0.012 },
    { s: 19, p: [2.1, 0.24, 0.4], l: [2.0, 0.07, 0], f: 40, ap: 0.015 },
    { s: 23, p: [2.7, 0.28, 0.5], l: [2.65, 0.1, 0], f: 35, ap: 0.012 },
    { s: 25.5, p: [3.2, 0.33, 0.55], l: [3.2, 0.26, 0], f: 35, ap: 0.012 },
    { s: 27, p: [3.2, 0.4, 0.9], l: [3.2, 0.5, -0.4], f: 28, ap: 0.0 },
    { s: 32, p: [3.2, 0.95, 1.45], l: [3.2, 0.55, -0.45], f: 24, ap: 0.0 }
  ];
  const o3 = new THREE.Object3D(); let stageFired = [];

  return {
    id: 'epi', root,
    enter() { K.scene.fog = new THREE.FogExp2(0x07090d, 0.55); },
    exit() { K.scene.fog = null; },
    update(s, time, motion) {
      const post = { bloom: { threshold: 1.8, strength: 0.65, radius: 0.6 }, exposure: 1 };
      const camT = camKF(s, KEYS);
      keyL.position.set(camT.l[0] - 0.6, 1.1, 0.9); keyL.target.position.set(camT.l[0], 0.05, 0); fillL.position.set(camT.l[0] + 0.5, 0.6, -0.4);
      // S0 spark + ignition, air hole opens
      bun.set(sm(T.airOpen, T.airOpen + 0.3, s), sm(T.ignite, T.ignite + 0.2, s), time); piezo.update(s, time);
      // S1 heat, limewater milky, lever tips
      const hot = sm(T.heat, T.heat + 2, s); zmat.color.set(0xece9e1).lerp(new THREE.Color(0xf2d75a), hot * (1 - sm(14, 18, s)));
      const milk = sm(T.milk, T.milk + 2, s); lime.liq.mat.transmission = lerp(1, 0.25, milk); lime.liq.mat.roughness = lerp(0.02, 0.45, milk);
      lime.liq.set(lerp(0.11, 0.122, sm(T.milk, T.lever, s)), 0.0003, time); limeB.update(s);
      const lv = sm(T.lever, T.lever + 0.35, s); lever.rotation.z = lerp(0.12, -0.35, lv);
      // ribbon rides on the lever end, then drops into the acid
      const fallU = sm(T.drop, T.drop + 0.45, s);
      if (s < T.drop) { const e = new THREE.Vector3(0.18, 0.006, 0).applyEuler(lever.rotation).add(lever.position); rib.position.copy(e); rib.rotation.z = lever.rotation.z; rib.visible = true; }
      else { rib.position.set(lerp(0.62, 0.66, fallU), lerp(0.1, acid.u.floor + 0.01, fallU * fallU), 0); rib.rotation.z = lerp(-0.35, -1.4, fallU); rib.scale.x = Math.max(0.05, 1 - sm(T.drop + 0.5, T.boom, s)); rib.visible = rib.scale.x > 0.06; }
      acidB.update(s); acid.liq.set(0.05, 0.0006, time);
      // balloon inflates on the beaker, floats into the splint, boom
      const inf = sm(T.drop + 0.3, T.balloonUp, s), up = sm(T.balloonUp, T.boom, s);
      bln.visible = s < T.boom; bln.scale.setScalar(lerp(0.15, 0.6, inf)); bln.position.set(lerp(0.66, 0.74, up), lerp(0.1, 0.4, up), 0);
      sp.userData.glow(1); fire.set(s - T.boom, 0.32);
      if (s > T.boom && s < T.boom + 1) post.shock = { x: 0.5, y: 0.45, r: (s - T.boom) * 0.9, amp: (1 - (s - T.boom)) * 1.3 };
      // S3 knock + wave down the pH rainbow
      bur.rotation.z = Math.sin(Math.max(0, s - T.knock) * 18) * 0.05 * Math.exp(-Math.max(0, s - T.knock) * 2) * (s > T.knock ? 1 : 0);
      wave.forEach((v, i) => { const t0 = T.wave + i * 0.3, u = sm(t0, t0 + 0.45, s); const ph = lerp(7, i + 1.5, u); v.liq.colour(u > 0 ? uiColour(i < 6 ? lerp(1, 6, i / 5) : lerp(8, 14, (i - 6) / 5), THREE) : new THREE.Color('#f6fbff'), u > 0 ? 0.05 : 10); v.liq.set(0.042, u > 0 && u < 1 ? 0.0006 : 0, time); void ph; });
      const last = wave[11]; last.g.rotation.z = lerp(0, 1.9, sm(T.tip, T.tip + 0.5, s)); last.g.position.y = sm(T.tip, T.tip + 0.5, s) * 0.03;
      // S4 precipitates
      ppts.forEach(p => p.p.update(s, time)); pourStream.update(s, time);
      // S5 electron river + rust
      river.update(s, time);
      sculpts.forEach((m, i) => { const pass = sm(T.river + 0.6 + i * 0.7, T.river + 2.2 + i * 0.7, s); m.material.userData.rust.uRust.value = pass * 0.85; m.rotation.y = time * 0.2 + i; });
      if (s > T.river && s < T.nova) post.bloom = { threshold: 1.4, strength: 0.9, radius: 0.7 };
      // S6 converge
      const wild = sm(T.converge, T.nova, s), postNova = s > T.nova;
      for (let i = 0; i < NB; i++) { const sp2 = lerp(0.6, 6, wild); const th = hh(i, 1) * 6.28 + s * sp2 * (0.5 + hh(i, 2)), ph = hh(i, 3) * 3.1 + s * sp2 * 0.7 * hh(i, 4); const r = 0.095 * (0.3 + 0.7 * hh(i, 5)); o3.position.set(C.x + r * Math.sin(ph) * Math.cos(th), C.y + r * Math.cos(ph), C.z + r * Math.sin(ph) * Math.sin(th)); o3.scale.setScalar(postNova ? 0.00001 : 0.006); o3.updateMatrix(); balls.setMatrixAt(i, o3.matrix); }
      balls.instanceMatrix.needsUpdate = true; coll.update(s, time); streams.update(s, time); shards.update(s, time);
      sphere.visible = !postNova;
      const na = s - T.nova; nova.visible = na > 0 && na < 0.7; nova.scale.setScalar(Math.max(0.001, 0.04 + na * 0.45)); nova.material.opacity = Math.max(0, 1 - na / 0.7) ** 2;
      if (na > 0 && na < 1.4) { post.shock = { x: 0.5, y: 0.5, r: na * 0.8, amp: (1.4 - na) * 1.4 }; post.exposure = 1 + 0.6 * Math.exp(-na * 6); }
      // S7 reveal
      const rv = sm(T.reveal, T.reveal + 1, s);
      tableG.visible = s > T.reveal - 0.5; tableG.position.y = lerp(0.4, 0.62, rv);
      tiles.forEach(({ m, ft }, i) => { let on = rv * 0.6; let c = new THREE.Color(1, 1, 1); if (ft) { const k = FLAME_TEST.indexOf(ft); const t0 = T.reveal + 0.3 + k * 0.6; const lit = sm(t0, t0 + 0.3, s); c = new THREE.Color(1, 1, 1).lerp(new THREE.Color(ft[1]).multiplyScalar(3), lit); on = Math.max(on, lit); } m.material.color.copy(c); m.material.opacity = on; });
      fireworks.forEach(p => p.update(s, time));
      ring.forEach((m, i) => { const a = i / IDEAS.length * Math.PI * 2 + s * 0.35; m.position.set(C.x + Math.cos(a) * 0.55, 0.45 + Math.sin(a * 2) * 0.03, -0.1 + Math.sin(a) * 0.45); m.material.opacity = sm(T.reveal + 0.5, T.reveal + 1.5, s); m.visible = s > T.reveal; });
      if (s > T.reveal) post.bloom = { threshold: 1.3, strength: 0.85, radius: 0.7 };
      // which stages have fired (for the test harness)
      stageFired = Object.entries(T).filter(([, v]) => s >= v).map(([k]) => k);
      const cam = shake(camT, time, 0.0005, motion);
      if (motion && s > T.converge && s < T.nova + 0.6) { const k = sm(T.converge, T.nova, s) * 0.006 * (s < T.nova ? 1 : 1 - (s - T.nova) / 0.6); cam.p = [cam.p[0] + Math.sin(time * 47) * k, cam.p[1] + Math.cos(time * 41) * k, cam.p[2]]; }
      if (s > T.reveal) { const o = (s - T.reveal) * 0.06; cam.p = [cam.p[0] + Math.sin(time * 0.15) * o * 0.3, cam.p[1], cam.p[2]]; }
      return { cam, world: 'void', post, glass: true, warm: { i: 0.2, p: [bun.top.x, 0.2, 0] } };
    },
    probe: () => ({ fired: stageFired.slice(), T })
  };
}
