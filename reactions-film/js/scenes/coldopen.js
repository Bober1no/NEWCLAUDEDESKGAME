// Cold open (18 s): a drop of universal indicator falls in slow motion into clear water (crown splash,
// rainbow tendrils), five quick macro inserts, then REACTIONS slams in as 3D glass letters.
import * as THREE from 'three';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { camKF, sm, lerp, shake, UI_COL } from './common.js';
import { M, canvasTex } from '../render/materials.js';
import { asset, ribbon, nail, lumps, Liquid, markGlass } from '../render/props.js';
import { dye, sparks } from '../fx/smoke.js';
import { Splash, Precipitate } from '../fx/precipitate.js';
import { Bubbles } from '../fx/bubbles.js';
import { vessel, bunsenRig } from './kit.js';
import { LAYER_GLASS } from '../render/pipeline.js';

const HIT = 4.1;
const INSERTS = [[6.0, 7.0], [7.0, 8.0], [8.0, 9.0], [9.0, 10.0], [10.0, 11.0]];

export default function (K) {
  const root = new THREE.Group();
  const G = { drop: new THREE.Group(), i0: new THREE.Group(), i1: new THREE.Group(), i2: new THREE.Group(), i3: new THREE.Group(), i4: new THREE.Group(), title: new THREE.Group() };
  for (const k in G) root.add(G[k]);
  const X = [0, 0.4, 0.5, 0.6, 0.7, 0.8]; // inserts sit on the bench; only the current one is ever visible

  // ---------------- drop
  const bk = vessel('beaker', { level: 0.062, dist: 12 }); G.drop.add(bk.g);
  // macro-photography backlight: a soft graded light card behind the beaker (out of focus)
  const card = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.5), new THREE.MeshBasicMaterial({ map: canvasTex(256, 256, g => { const gr = g.createRadialGradient(128, 110, 10, 128, 128, 180); gr.addColorStop(0, '#f4f8ff'); gr.addColorStop(0.55, '#9fb6cf'); gr.addColorStop(1, '#22303e'); g.fillStyle = gr; g.fillRect(0, 0, 256, 256); }), color: new THREE.Color(1.25, 1.25, 1.3) }));
  card.position.set(0, 0.12, -0.32); G.drop.add(card);
  const pip = new THREE.Group(); const glassT = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0012, 0.07, 24, 1, true), M.glass); glassT.layers.set(LAYER_GLASS); glassT.position.y = 0.035; pip.add(glassT);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.008, 24, 16), M.redRubber); bulb.scale.y = 1.6; bulb.position.y = 0.08; pip.add(bulb);
  pip.position.set(0, 0.105, 0); G.drop.add(pip);
  const dropM = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshPhysicalMaterial({ color: 0xffffff, transmission: 1, ior: 1.33, thickness: 0.004, attenuationColor: new THREE.Color('#3b7f3a'), attenuationDistance: 0.004, roughness: 0.02 }));
  G.drop.add(dropM);
  const splashMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, transmission: 1, ior: 1.33, thickness: 0.004, roughness: 0.02, specularIntensity: 1, envMapIntensity: 1.2, attenuationColor: new THREE.Color('#cfe8d0'), attenuationDistance: 0.2 });
  const spl = new Splash(splashMat, 0.035); spl.group.position.set(0, 0.0625, 0); G.drop.add(spl.group);
  const tend = dye(K.pipe, { n: 900, origin: [0, 0.06, 0], radius: 0.03, floor: bk.u.floor, top: 0.062, prog: s => sm(HIT, HIT + 2.2, s), alpha: 0.32, size: 0.009, colour: (i, o) => { const c = new THREE.Color(UI_COL[Math.floor((i % 9) / 9 * 14)]); o.r = c.r; o.g = c.g; o.b = c.b; } });
  bk.g.add(tend.points);

  // ---------------- inserts
  // 0: magnesium igniting
  const rib = ribbon(0.04); rib.position.set(X[1], 0.04, 0); rib.rotation.z = -0.3; G.i0.add(rib);
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.004, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(12, 12, 13) })); core.position.set(X[1] + 0.018, 0.035, 0); G.i0.add(core);
  const spk = sparks(K.pipe, { n: 160, origin: [X[1] + 0.018, 0.035, 0], active: s => (s > 6.2 && s < 7.0 ? 1 : 0), speed: 0.4, life: 0.5 }); G.i0.add(spk.points);
  // 1: yellow precipitate bloom
  const t1 = vessel('tube', { level: 0.11, dist: 12 }); t1.g.position.set(X[2], 0, 0); G.i1.add(t1.g);
  const pp = new Precipitate(K.pipe, { inner: t1.u.inner, floor: t1.u.floor, level: 0.11, colour: '#ffd21a', t0: 7.05, T: 6, n: 500, shimmer: true }); t1.g.add(pp.group);
  // 2: bubbles streaming off zinc
  const t2 = vessel('beaker', { level: 0.05, dist: 12, opts: { r: 0.026, h: 0.07, ml: 100, step: 10 } }); t2.g.position.set(X[3], 0, 0); G.i2.add(t2.g);
  const zn = lumps(6, 0.006, M.zinc, 0.012, 3); zn.position.y = t2.u.floor; t2.g.add(zn);
  const zb = new Bubbles({ n: 160, life: 0.7, size: 0.0009, rise: 0.08, surface: () => 0.05, radius: y => t2.u.inner(y), rate: () => 1, site: (j, k, v) => { const a = j * 2.4; v.set(Math.cos(a) * 0.01, t2.u.floor + 0.006 + (j % 3) * 0.002, Math.sin(a) * 0.01); } }); t2.g.add(zb.group);
  // 3: rusting nail time-lapse
  const nl = nail(0.07); nl.position.set(X[4], 0.004, 0); nl.rotation.z = Math.PI / 2 - 0.1; nl.position.y = 0.006; G.i3.add(nl);
  // 4: Bunsen yellow → blue
  const bun = bunsenRig(); bun.group.position.set(X[5], 0, 0); G.i4.add(bun.group);

  // ---------------- title: glass letters
  const word = 'REACTIONS'; const letters = [];
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(4, 2), new THREE.MeshBasicMaterial({ map: canvasTex(512, 256, g => { const gr = g.createRadialGradient(256, 128, 10, 256, 128, 260); gr.addColorStop(0, '#2a3f66'); gr.addColorStop(0.5, '#0d1424'); gr.addColorStop(1, '#05070b'); g.fillStyle = gr; g.fillRect(0, 0, 512, 256); for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(${150 + (i * 37) % 100},${180 + (i * 17) % 70},255,${0.05 + (i % 5) * 0.03})`; g.beginPath(); g.arc((i * 97) % 512, (i * 53) % 256, 6 + (i % 7) * 4, 0, 7); g.fill(); } }) }));
  bg.position.set(0, 0, -1.2); G.title.add(bg);
  const sweep = new THREE.PointLight(0xbfe6ff, 0, 2, 2); G.title.add(sweep);
  const titleMat = M.glassThick.clone(); titleMat.onBeforeCompile = M.glassThick.onBeforeCompile; titleMat.customProgramCacheKey = M.glassThick.customProgramCacheKey; titleMat.thickness = 0.05; titleMat.attenuationColor = new THREE.Color(0.75, 0.93, 1); titleMat.attenuationDistance = 0.3; titleMat.depthWrite = true;
  const edgeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 0.9, 1.2), wireframe: false, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  new THREE.FileLoader().setResponseType('json').load(asset('assets/fonts/inter_black_subset.json'), (json) => {
    const font = new FontLoader().parse(json); let x = 0; const gap = 0.012, items = [];
    for (const ch of word) {
      const g = new TextGeometry(ch, { font, size: 0.058, height: 0.016, curveSegments: 6, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.0025, bevelSegments: 3 });
      g.computeBoundingBox(); const w = g.boundingBox.max.x - g.boundingBox.min.x; g.translate(-g.boundingBox.min.x - w / 2, -0.045, -0.011);
      const m = new THREE.Mesh(g, titleMat); m.layers.set(LAYER_GLASS); m.castShadow = false;
      const e = new THREE.Mesh(g, edgeMat.clone()); e.scale.setScalar(1.0); m.add(e);
      items.push({ m, e, x: x + w / 2 }); x += w + gap;
    }
    const total = x - gap; items.forEach(it => { it.m.position.x = it.x - total / 2; it.home = it.m.position.x; G.title.add(it.m); letters.push(it); });
  });

  const KEYS = [
    { s: 0, p: [0.0, 0.14, 0.3], l: [0, 0.12, 0], f: 100, ap: 0.07, fd: 0.3 },
    { s: 3.6, p: [0.0, 0.12, 0.28], l: [0, 0.1, 0], f: 100, ap: 0.07 },
    { s: 4.1, p: [0.04, 0.11, 0.27], l: [0, 0.06, 0], f: 100, ap: 0.06 },
    { s: 6.0, p: [0.09, 0.14, 0.3], l: [0, 0.05, 0], f: 85, ap: 0.05 },
    { s: 6.0, cut: true, p: [X[1] + 0.06, 0.08, 0.2], l: [X[1] + 0.012, 0.035, 0], f: 100, ap: 0.06 },
    { s: 7.0, cut: true, p: [X[2] + 0.05, 0.11, 0.24], l: [X[2], 0.07, 0], f: 100, ap: 0.06 },
    { s: 8.0, cut: true, p: [X[3] + 0.05, 0.08, 0.2], l: [X[3], 0.035, 0], f: 100, ap: 0.06 },
    { s: 9.0, cut: true, p: [X[4] + 0.02, 0.06, 0.15], l: [X[4], 0.008, 0], f: 100, ap: 0.06 },
    { s: 10.0, cut: true, p: [X[5] + 0.16, 0.22, 0.3], l: [X[5] + 0.0, 0.18, 0], f: 85, ap: 0.04 },
    { s: 11.0, cut: true, p: [0, 0.015, 0.95], l: [0, 0.005, 0], f: 50, ap: 0.0 },
    { s: 18, p: [0, 0.01, 0.86], l: [0, 0.005, 0], f: 50, ap: 0.0 }
  ];

  return {
    id: 'cold', root,
    enter() { G.title.position.set(0, 0.0, 0); },
    update(s, time, motion) {
      const vis = { drop: s < 6, i0: s >= 6 && s < 7, i1: s >= 7 && s < 8, i2: s >= 8 && s < 9, i3: s >= 9 && s < 10, i4: s >= 10 && s < 11, title: s >= 11 };
      for (const k in G) G[k].visible = vis[k];
      const post = { bloom: { threshold: 2.0, strength: 0.6, radius: 0.6 }, exposure: lerp(0.0, 1.05, sm(0.2, 2.2, s)) };
      let world = 'lab';
      if (vis.drop) {
        const fall = sm(3.0, HIT, s), hang = 1 - fall;
        const y = s < 3 ? 0.103 - 0.002 * sm(1, 3, s) : lerp(0.101, 0.064, Math.pow(Math.min(1, (s - 3) / (HIT - 3)), 1.6));
        dropM.visible = s < HIT; dropM.position.set(0, y, 0); dropM.scale.set(0.0038, 0.0038 * (1 + 0.35 * hang * sm(1, 3, s)), 0.0038);
        spl.set(s - HIT); tend.update(s, time); bk.liq.set(0.062, s > HIT ? 0.0012 * Math.exp(-(s - HIT) * 1.5) : 0, s * 3);
        const p = sm(HIT, HIT + 2.2, s); bk.liq.colour(new THREE.Color('#f6fbff').lerp(new THREE.Color('#9bc98f'), p * 0.55), lerp(12, 0.25, p));
      }
      if (vis.i0) { const a = sm(6.2, 6.35, s); core.visible = s > 6.2; core.scale.setScalar(0.25 + 0.35 * a + 0.1 * Math.sin(time * 40)); spk.update(s, time); post.exposure = s > 6.2 ? 0.45 : 1; post.bloom = { threshold: 2.5, strength: 0.8, radius: 0.6 }; }
      if (vis.i1) pp.update(s, time);
      if (vis.i2) { zb.update(s); t2.liq.set(0.05, 0.0004, time); }
      if (vis.i3) nl.userData.rust.uRust.value = sm(9.0, 9.95, s) * 0.85;
      if (vis.i4) { bun.set(sm(10.45, 10.55, s), 1, time); post.shimmer = { x: 0.5, y: 0.45, w: 0.14, h: 0.4, amp: 0.6 }; }
      if (vis.title) {
        world = 'void';
        letters.forEach((it, i) => {
          const t0 = 11.4 + i * 0.11, u = sm(t0, t0 + 0.32, s);
          it.m.position.set(it.home, 0.012, lerp(0.35, 0, u)); it.m.scale.setScalar(lerp(2.4, 1, u)); it.m.visible = u > 0.01;
          it.m.rotation.y = Math.sin(time * 0.4 + i) * 0.04;
          it.e.material.opacity = 0.25 * Math.exp(-Math.pow((s - 13 - i * 0.12) / 0.35, 2)) + 0.04;
        });
        sweep.position.set(lerp(-0.6, 0.6, sm(12.6, 15.5, s)), 0.15, 0.25); sweep.intensity = 2.5;
        post.bloom = { threshold: 1.2, strength: 0.9, radius: 0.7 }; post.exposure = 1.1;
      }
      const cam = shake(camKF(s, KEYS), time, s < 11 ? 0.0003 : 0, motion);
      return { cam, world, post, glass: true, benchProps: s < 6 ? false : true, goggles: [-0.12, 0.1, 0.5], pull: vis.title ? 1 : undefined };
    },
    probe: () => ({ letters: letters.length })
  };
}
