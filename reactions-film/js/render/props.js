// Apparatus: procedural glassware (lathe profiles with real wall thickness + rolled rims), liquids with a
// meniscus, the procedural props (balance, goggles, dropper bottles, tongs, gauze, splints...) and the
// downloaded CC-BY models (Bunsen, tripod, retort stand, burette) with procedural fallbacks.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { M, TX, canvasTex, rustMaterial, rng } from './materials.js';
import { LAYER_GLASS } from './pipeline.js';

export const asset = p => (window.__RXF_ASSETS && window.__RXF_ASSETS[p]) || p;
const V2 = (x, y) => new THREE.Vector2(x, y);
const WHITE = new THREE.Color(1, 1, 1);
const SEG = 56;

function glassMesh(geo, mat = M.glass) {
  const m = new THREE.Mesh(geo, mat); m.layers.set(LAYER_GLASS); m.renderOrder = 2; m.castShadow = true; return m;
}
export function markGlass(o) { o.traverse(c => { if (c.isMesh) { c.layers.set(LAYER_GLASS); c.renderOrder = 2; } }); return o; }

// ------------------------------------------------------------------ profiles
function rimRoll(pts, r, h, wall) {
  pts.push(V2(r, h - 0.0006), V2(r + 0.0009, h + 0.0002), V2(r + 0.0006, h + 0.0012), V2(r - wall * 0.5, h + 0.0015), V2(r - wall - 0.0002, h + 0.0006), V2(r - wall, h - 0.0008));
}
/** Generic vessel from an outer radius function; returns {geo, inner(y), floor, top}. */
function vesselProfile(outer, h, wall, base = 0.0025, steps = 26) {
  const pts = [V2(0.0001, 0)];
  const r0 = outer(0);
  pts.push(V2(r0 - 0.003, 0), V2(r0 - 0.0008, 0.0006), V2(r0, 0.003));
  for (let i = 1; i <= steps; i++) { const y = 0.003 + (h - 0.004) * i / steps; pts.push(V2(outer(y), y)); }
  rimRoll(pts, outer(h), h, wall);
  for (let i = steps; i >= 1; i--) { const y = base + 0.002 + (h - 0.004 - base) * i / steps; pts.push(V2(outer(y) - wall, y)); }
  pts.push(V2(outer(base) - wall - 0.0025, base), V2(0.0001, base));
  return { pts, inner: y => outer(y) - wall, floor: base, top: h };
}

/** Graduation marks + logo printed on a band around the vessel. */
function gradBand(radius, y0, y1, label, maxMl, step) {
  const tex = canvasTex(1024, 512, (g, w, h) => {
    g.clearRect(0, 0, w, h); g.fillStyle = 'rgba(255,255,255,0.92)'; g.strokeStyle = 'rgba(255,255,255,0.92)';
    const n = Math.round(maxMl / step);
    for (let i = 1; i <= n; i++) {
      const y = h - (i / n) * (h - 20) - 4, major = (i * step) % (step * 5) === 0 || n <= 6;
      g.fillRect(40, y, major ? 70 : 38, major ? 4 : 2.5);
      if (major) { g.font = 'bold 24px Archivo, Arial, sans-serif'; g.fillText(String(i * step), 120, y + 8); }
    }
    g.font = 'italic 900 24px Archivo, Arial, sans-serif'; g.fillText('BOROLUX', 600, h * 0.5);
    g.font = 'bold 17px JetBrains Mono, monospace'; g.fillText(label, 600, h * 0.5 + 26);
    g.font = '14px JetBrains Mono, monospace'; g.fillText('±5%  · 20 °C', 600, h * 0.5 + 46);
  });
  tex.wrapS = THREE.ClampToEdgeWrapping;
  const geo = new THREE.CylinderGeometry(radius, radius, y1 - y0, SEG, 1, true, -Math.PI * 0.45, Math.PI * 0.9);
  const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const m = new THREE.Mesh(geo, mat); m.position.y = (y0 + y1) / 2; m.renderOrder = 3; m.layers.set(LAYER_GLASS); return m;
}

// ------------------------------------------------------------------ liquid
export class Liquid {
  /** inner(y) = inner radius of the vessel at y; floor = inner bottom y. */
  constructor(inner, floor, colour = '#ffffff', dist = 4, { meniscus = 0.0016 } = {}) {
    this.inner = inner; this.floor = floor; this.men = meniscus;
    this.mat = M.liquid(colour, dist); this.mat.thickness = Math.max(0.01, inner(floor + 0.02) * 2);
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.mat);
    this.mesh.renderOrder = 1; this.mesh.receiveShadow = true;
    this.level = -1; this.rip = 0; this.ripT = 0; this.colour(colour, dist);
  }
  /** Set fill height (vessel local y), ripple amplitude (m) and ripple phase time. Rebuilds only when needed. */
  set(level, ripAmp = 0, ripT = 0) {
    const q = Math.round(level * 1e5) / 1e5, ra = Math.round(ripAmp * 1e5) / 1e5;
    if (q === this.level && ra === 0 && this.rip === 0) return;
    this.level = q; this.rip = ra; this.ripT = ripT;
    const pts = [], b = this.floor + 0.0004, gap = 0.00035;
    const top = Math.max(b + 0.001, q);
    pts.push(V2(0.0001, b));
    for (let i = 0; i <= 12; i++) { const y = b + (top - b) * (i / 12); pts.push(V2(Math.max(0.001, this.inner(y) - gap), y)); }
    const R = Math.max(0.001, this.inner(top) - gap);
    for (let i = 1; i <= 14; i++) {
      const u = i / 14, r = R * (1 - u), dw = R - r;
      const curl = this.men * Math.exp(-dw / 0.0011) - this.men * 0.25 * (1 - Math.exp(-dw / 0.004));
      const wave = ra ? ra * Math.sin(r * 900 - ripT * 14) * Math.exp(-r * 120) : 0;
      pts.push(V2(Math.max(0.0001, r), top + curl + wave));
    }
    const g = new THREE.LatheGeometry(pts, 48);
    this.mesh.geometry.dispose(); this.mesh.geometry = g;
  }
  colour(c, dist) {
    this.mat.attenuationColor.set(c); if (dist) this.mat.attenuationDistance = dist;
    // a little body colour so coloured solutions read in front of a dark bench (dissolved ions scatter a touch)
    const hsl = {}; this.mat.attenuationColor.getHSL(hsl); const sat = hsl.s * (1 - Math.abs(hsl.l - 0.5) * 1.2);
    this.mat.color.copy(this.mat.attenuationColor).lerp(WHITE, 0.25); this.mat.transmission = 1 - 0.22 * Math.max(0, sat) * Math.min(1, 0.1 / (this.mat.attenuationDistance || 1));
  }
}

// ------------------------------------------------------------------ glassware
export function beaker({ r = 0.034, h = 0.088, wall = 0.0017, ml = 250, step = 25 } = {}) {
  const P = vesselProfile(() => r, h, wall);
  const geo = new THREE.LatheGeometry(P.pts, SEG);
  // pour spout at +z
  const pos = geo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i); if (v.y < h - 0.016) continue;
    const phi = Math.atan2(v.x, v.z), k = Math.exp(-((phi / 0.32) ** 2)) * ((v.y - (h - 0.016)) / 0.016) ** 2, rr = Math.hypot(v.x, v.z);
    const s = (rr + 0.006 * k) / Math.max(rr, 1e-6); pos.setXYZ(i, v.x * s, v.y + 0.0018 * k, v.z * s);
  }
  geo.computeVertexNormals();
  const g = new THREE.Group();
  g.add(glassMesh(geo)); const band = gradBand(r + 0.0004, 0.012, h * 0.82, ml + ' mL', ml * 0.8, step); band.rotation.y = -1.05; g.add(band);
  g.userData = { inner: P.inner, floor: P.floor, top: h, r };
  return g;
}
export function conical({ R = 0.04, neck = 0.0115, h = 0.135, cone = 0.095, wall = 0.0017, ml = 250 } = {}) {
  const outer = y => y < cone ? R + (neck - R) * Math.pow(y / cone, 1.12) - (y < 0.01 ? 0 : 0) : neck;
  const P = vesselProfile(outer, h, wall, 0.003, 36);
  const g = new THREE.Group(); g.add(glassMesh(new THREE.LatheGeometry(P.pts, SEG)));
  g.userData = { inner: P.inner, floor: P.floor, top: h, r: R };
  return g;
}
export function tube({ r = 0.0085, h = 0.15, wall = 0.0011, boiling = false } = {}) {
  if (boiling) { r = 0.0125; wall = 0.0014; }
  const pts = [V2(0.0001, 0)];
  for (let i = 1; i <= 10; i++) { const a = (i / 10) * Math.PI / 2; pts.push(V2(r * Math.sin(a), r - r * Math.cos(a))); }
  pts.push(V2(r, h - 0.002)); rimRoll(pts, r, h, wall);
  pts.push(V2(r - wall, r));
  for (let i = 10; i >= 1; i--) { const a = (i / 10) * Math.PI / 2; const ri = r - wall; pts.push(V2(ri * Math.sin(a), r - ri * Math.cos(a) + 0.0002)); }
  pts.push(V2(0.0001, wall + 0.0002));
  const g = new THREE.Group(); g.add(glassMesh(new THREE.LatheGeometry(pts, 40)));
  g.userData = { inner: y => y < r ? Math.max(0.0008, Math.sqrt(Math.max(0, (r - wall) ** 2 - (r - y) ** 2))) : r - wall, floor: wall, top: h, r };
  return g;
}
export function cylinder({ r = 0.0125, h = 0.2, wall = 0.0014, ml = 100 } = {}) {
  const P = vesselProfile(() => r, h, wall, 0.004);
  const g = new THREE.Group(); g.add(glassMesh(new THREE.LatheGeometry(P.pts, 40)));
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.032, 0.008, 6), M.glassThick); foot.layers.set(LAYER_GLASS); foot.position.y = -0.003; g.add(foot);
  g.add(gradBand(r + 0.0004, 0.01, h * 0.92, ml + ' mL', ml, 2));
  g.userData = { inner: P.inner, floor: P.floor, top: h, r };
  return g;
}
export function deliveryTube(points, r = 0.0032) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
  const m = glassMesh(new THREE.TubeGeometry(curve, 80, r, 12, false), M.glassThick); return m;
}
export function bung(r = 0.0135, h = 0.02, hole = true) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.82, h, 28), M.rubber); m.castShadow = true; return m;
}

// ------------------------------------------------------------------ procedural props
function roundedBox(w, h, d, r = 0.006, seg = 3) {
  const s = new THREE.Shape(); const x = -w / 2, y = -d / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + d - r); s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  const g = new THREE.ExtrudeGeometry(s, { depth: h - 2 * Math.min(r, h / 3), bevelEnabled: true, bevelThickness: Math.min(r, h / 3), bevelSize: Math.min(r, h / 3) * 0.9, bevelSegments: seg, curveSegments: 8 });
  g.rotateX(-Math.PI / 2); g.translate(0, Math.min(r, h / 3), 0); return g;
}
/** Digital balance: black body, brushed steel pan, live LCD (fixed-size canvas so text changes never resize the sprite). */
export function balance() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(roundedBox(0.2, 0.05, 0.24, 0.012), M.blackPlastic); body.castShadow = body.receiveShadow = true; g.add(body);
  const pg = new THREE.Group(); pg.position.set(0, 0.024, 0.142); pg.rotation.x = 0.38; g.add(pg); // display ledge in front of the body
  const ledge = new THREE.Mesh(roundedBox(0.17, 0.02, 0.05, 0.005), M.blackPlastic); ledge.position.set(0, 0.002, 0.135); g.add(ledge);
  const panel = new THREE.Mesh(roundedBox(0.16, 0.012, 0.045, 0.004), M.whitePlastic); pg.add(panel);
  const lcdTex = canvasTex(512, 160, (c) => { c.fillStyle = '#8f9c86'; c.fillRect(0, 0, 512, 160); });
  const lcd = new THREE.Mesh(new THREE.PlaneGeometry(0.075, 0.0235), new THREE.MeshStandardMaterial({ map: lcdTex, emissive: 0xffffff, emissiveMap: lcdTex, emissiveIntensity: 0.5, roughness: 0.3, polygonOffset: true, polygonOffsetFactor: -2 }));
  lcd.rotation.x = -Math.PI / 2; lcd.position.set(-0.025, 0.0122, 0); pg.add(lcd);
  for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.003, 20), M.blackPlastic); b.position.set(0.032 + i * 0.013, 0.0128, 0); pg.add(b); }
  const pan = new THREE.Mesh(roundedBox(0.15, 0.006, 0.15, 0.004), M.panSteel); pan.position.set(0, 0.05, -0.02); pan.castShadow = pan.receiveShadow = true; g.add(pan);
  for (const [x, z] of [[-0.085, -0.1], [0.085, -0.1], [-0.085, 0.1], [0.085, 0.1]]) { const f = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.01, 0.006, 16), M.rubber); f.position.set(x, 0.001, z); g.add(f); }
  body.position.y = 0.004;
  let last = '';
  g.userData = {
    panTop: 0.056,
    show(text) {
      if (text === last) return; last = text; const c = lcdTex.userData.ctx;
      c.fillStyle = '#8f9c86'; c.fillRect(0, 0, 512, 160); c.fillStyle = 'rgba(30,40,30,.08)'; c.font = 'bold 112px JetBrains Mono, monospace'; c.textAlign = 'right'; c.fillText('888.88', 440, 125);
      c.fillStyle = '#1b2219'; c.fillText(text, 440, 125); c.font = 'bold 48px JetBrains Mono, monospace'; c.fillText('g', 495, 125); lcdTex.needsUpdate = true;
    }
  };
  g.userData.show('0.00');
  return g;
}
export function goggles() {
  // curved polycarbonate visor + soft vinyl frame + vents + elastic strap, resting tilted on the bench
  const g = new THREE.Group();
  const R = 0.085, H = 0.042, TH = 1.55;
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(R, R, H, 48, 1, true, -TH / 2, TH), M.glass); lens.layers.set(LAYER_GLASS); lens.renderOrder = 2; g.add(lens);
  const frameMat = new THREE.MeshPhysicalMaterial({ color: 0x2a3440, roughness: 0.55, clearcoat: 0.3, normalMap: TX.grainN, normalScale: new THREE.Vector2(0.15, 0.15) });
  const rimPts = (y) => { const pts = []; for (let i = 0; i <= 40; i++) { const a = -TH / 2 + TH * i / 40; pts.push(new THREE.Vector3(Math.sin(a) * (R + 0.002), y, Math.cos(a) * (R + 0.002))); } return new THREE.CatmullRomCurve3(pts); };
  for (const y of [-H / 2, H / 2]) { const t = new THREE.Mesh(new THREE.TubeGeometry(rimPts(y), 60, 0.0045, 10, false), frameMat); g.add(t); }
  for (const s of [-1, 1]) { const a = s * TH / 2; const side = new THREE.Mesh(new THREE.BoxGeometry(0.012, H + 0.009, 0.02), frameMat); side.position.set(Math.sin(a) * (R - 0.004), 0, Math.cos(a) * (R - 0.004)); side.rotation.y = a; g.add(side);
    for (let k = 0; k < 3; k++) { const v = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0022, 0.003, 10), M.blackPlastic); v.rotation.z = Math.PI / 2; v.position.set(Math.sin(a) * (R + 0.003), -0.012 + k * 0.012, Math.cos(a) * (R + 0.003)); v.rotation.y = a; g.add(v); } }
  const nose = new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.004, 8, 20, Math.PI), frameMat); nose.position.set(0, -H / 2, R + 0.001); g.add(nose);
  const strapC = new THREE.CatmullRomCurve3([new THREE.Vector3(Math.sin(-TH / 2) * R, 0, Math.cos(-TH / 2) * R), new THREE.Vector3(-0.1, -0.012, -0.02), new THREE.Vector3(-0.05, -0.02, -0.075), new THREE.Vector3(0.05, -0.02, -0.075), new THREE.Vector3(0.1, -0.012, -0.02), new THREE.Vector3(Math.sin(TH / 2) * R, 0, Math.cos(TH / 2) * R)]);
  const strap = new THREE.Mesh(new THREE.TubeGeometry(strapC, 60, 0.0018, 6, false), new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.85 })); strap.scale.y = 3; g.add(strap);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  g.rotation.x = -0.32; g.position.y = H / 2 + 0.006;
  const w = new THREE.Group(); w.add(g); return w;
}
export function dropperBottle(amber = true, text = 'UNIV. IND.') {
  const g = new THREE.Group();
  const outer = y => y < 0.05 ? 0.016 : y < 0.058 ? 0.016 - (y - 0.05) / 0.008 * 0.007 : 0.009;
  const P = vesselProfile(outer, 0.066, 0.0018, 0.003, 20);
  g.add(glassMesh(new THREE.LatheGeometry(P.pts, 40), amber ? M.amberGlass : M.glass));
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.0105, 0.0105, 0.012, 24), M.blackPlastic); cap.position.y = 0.072; g.add(cap);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.007, 20, 14), M.redRubber); bulb.scale.y = 1.6; bulb.position.y = 0.088; g.add(bulb);
  const lab = canvasTex(256, 128, (c) => { c.fillStyle = '#efe9da'; c.fillRect(0, 0, 256, 128); c.fillStyle = '#1b1b1b'; c.font = 'bold 30px JetBrains Mono, monospace'; c.fillText(text, 14, 56); c.font = '18px JetBrains Mono, monospace'; c.fillText('pH 1–14', 14, 92); });
  const label = new THREE.Mesh(new THREE.CylinderGeometry(0.0163, 0.0163, 0.03, 32, 1, true, -1.1, 2.2), new THREE.MeshStandardMaterial({ map: lab, roughness: 0.7 })); label.position.y = 0.025; g.add(label);
  if (amber) { const liq = new Liquid(P.inner, P.floor, '#6a3b10', 0.02); liq.set(0.04); g.add(liq.mesh); }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}
export function tongs() {
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    const c = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.05, 0.004, s * 0.004), new THREE.Vector3(0.11, 0.008, s * 0.014), new THREE.Vector3(0.16, 0.006, s * 0.012), new THREE.Vector3(0.19, 0.002, s * 0.004), new THREE.Vector3(0.2, 0.0, s * 0.006)]);
    const m = new THREE.Mesh(new THREE.TubeGeometry(c, 60, 0.0024, 10, false), M.steel); m.castShadow = true; g.add(m);
    const tip = new THREE.Mesh(new THREE.TorusGeometry(0.006, 0.0018, 8, 20, Math.PI), M.steel); tip.position.set(0.2, 0.0, s * 0.006); tip.rotation.y = Math.PI / 2; g.add(tip);
  }
  const pivot = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.03, 12), M.steel); pivot.rotation.x = Math.PI / 2; pivot.position.x = 0.0; g.add(pivot);
  g.position.y = 0.003; return g;
}
export function gauze(size = 0.13) {
  const tex = canvasTex(512, 512, (c, w, h) => {
    c.clearRect(0, 0, w, h); c.strokeStyle = '#7d8187'; c.lineWidth = 2.2;
    for (let i = 0; i <= w; i += 9) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i, h); c.stroke(); c.beginPath(); c.moveTo(0, i); c.lineTo(w, i); c.stroke(); }
    const gr = c.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w * 0.3); gr.addColorStop(0, '#b9b5ab'); gr.addColorStop(0.9, '#a9a49a'); gr.addColorStop(1, 'rgba(169,164,154,0)');
    c.fillStyle = gr; c.beginPath(); c.arc(w / 2, h / 2, w * 0.3, 0, 7); c.fill();
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.35, metalness: 0.1, roughness: 0.8, side: THREE.DoubleSide }));
  m.rotation.x = -Math.PI / 2; m.castShadow = m.receiveShadow = true; return m;
}
export function splint(len = 0.15) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.0022, 0.005), M.wood); m.position.x = len / 2; m.castShadow = true; g.add(m);
  const charMat = new THREE.MeshStandardMaterial({ color: 0x1a120c, roughness: 1, emissive: 0xff5a10, emissiveIntensity: 0 });
  const tip = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.0024, 0.0052), charMat); tip.position.x = len + 0.005; g.add(tip);
  g.userData = { tip: new THREE.Vector3(len + 0.011, 0, 0), glow: v => { charMat.emissiveIntensity = v * 6; } };
  return g;
}
export function heatMat(s = 0.2) { const m = new THREE.Mesh(new THREE.BoxGeometry(s, 0.006, s), M.heatMat); m.position.y = 0.003; m.receiveShadow = true; return m; }
export function ribbon(len = 0.05) {
  const geo = new THREE.PlaneGeometry(len, 0.003, 60, 1); const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i); p.setZ(i, Math.sin(x * 260) * 0.0006 + Math.sin(x * 93) * 0.0012); }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, M.magnesium); m.material.side = THREE.DoubleSide; m.castShadow = true; return m;
}
export function nail(len = 0.07) {
  const g = new THREE.Group(); const mat = rustMaterial(0x7c8187);
  const shank = new THREE.Mesh(new THREE.CylinderGeometry(0.0016, 0.0016, len, 18, 8), mat); shank.position.y = len / 2; g.add(shank);
  const pt = new THREE.Mesh(new THREE.ConeGeometry(0.0016, 0.006, 18), mat); pt.rotation.x = Math.PI; pt.position.y = -0.003; g.add(pt);
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.0042, 0.0038, 0.0014, 24), mat); head.position.y = len + 0.0007; g.add(head);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  g.userData = { rust: mat.userData.rust }; return g;
}
/** Instanced lumps (marble chips, zinc granules, powder grains). */
export function lumps(n, size, mat, spread, seed = 1, shape = 'chip') {
  const geo = shape === 'grain' ? new THREE.IcosahedronGeometry(1, 0) : new THREE.DodecahedronGeometry(1, 0);
  const im = new THREE.InstancedMesh(geo, mat, n); const r = rng(seed); const o = new THREE.Object3D();
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * spread;
    o.position.set(Math.cos(a) * d, size * 0.6 + r() * size * 0.3 * (shape === 'grain' ? 2 : 1), Math.sin(a) * d);
    o.rotation.set(r() * 6, r() * 6, r() * 6); const s = size * (0.6 + r() * 0.7); o.scale.set(s, s * (0.6 + r() * 0.5), s * (0.7 + r() * 0.5)); o.updateMatrix(); im.setMatrixAt(i, o.matrix);
  }
  im.castShadow = im.receiveShadow = true; im.frustumCulled = false; im.computeBoundingSphere(); return im;
}
export function balloon(col = 0xff4f5e) {
  const pts = []; for (let i = 0; i <= 30; i++) { const t = i / 30, a = t * Math.PI; const r = Math.sin(a) * (0.11 - 0.035 * t) + (t > 0.93 ? 0.004 : 0); pts.push(V2(Math.max(0.002, r), -Math.cos(a) * 0.13 + (t > 0.9 ? (t - 0.9) * 0.06 : 0))); }
  pts.push(V2(0.006, 0.142), V2(0.008, 0.152), V2(0.0001, 0.152));
  const geo = new THREE.LatheGeometry(pts.reverse(), 48); geo.rotateX(Math.PI); geo.translate(0, 0.152, 0); // knot at the bottom, origin at the knot
  const m = new THREE.Mesh(geo, M.latex.clone()); m.material.color.set(col); m.castShadow = true;
  const knot = new THREE.Mesh(new THREE.SphereGeometry(0.0045, 12, 8), m.material); knot.scale.y = 0.7; m.add(knot);
  return m;
}
export function reagentBottle(text, amber, h = 0.14) {
  const g = new THREE.Group(); const r = 0.032;
  const outer = y => y < h * 0.72 ? r : y < h * 0.86 ? r - (y - h * 0.72) / (h * 0.14) * (r - 0.012) : 0.012;
  const P = vesselProfile(outer, h, 0.0022, 0.004, 18);
  g.add(glassMesh(new THREE.LatheGeometry(P.pts, 40), amber ? M.amberGlass : M.glass));
  const st = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.011, 0.02, 24), amber ? M.blackPlastic : M.glassThick); st.position.y = h + 0.008; if (!amber) st.layers.set(LAYER_GLASS); g.add(st);
  const lab = canvasTex(256, 160, (c) => { c.fillStyle = '#f1ece0'; c.fillRect(0, 0, 256, 160); c.fillStyle = '#c4202f'; c.fillRect(0, 0, 256, 22); c.fillStyle = '#151515'; c.font = 'bold 34px JetBrains Mono, monospace'; c.fillText(text, 16, 80); c.font = '18px JetBrains Mono, monospace'; c.fillText('0.1 mol/L', 16, 118); });
  const label = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.0003, r + 0.0003, h * 0.4, 32, 1, true, -1.0, 2.0), new THREE.MeshStandardMaterial({ map: lab, roughness: 0.75 })); label.position.y = h * 0.38; g.add(label);
  if (amber) { const l = new Liquid(P.inner, P.floor, '#5a2e08', 0.03); l.set(h * 0.6); g.add(l.mesh); }
  return g;
}

// ------------------------------------------------------------------ downloaded models (CC-BY-4.0) + fallbacks
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
export const MODELS = { status: {} };

function fbBunsen() {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.012, 6), M.castIron); base.position.y = 0.006; g.add(base);
  const pts = [V2(0.0001, 0.012), V2(0.012, 0.012), V2(0.012, 0.03), V2(0.0085, 0.034), V2(0.0085, 0.146), V2(0.0072, 0.146), V2(0.0072, 0.03), V2(0.0001, 0.03)];
  g.add(new THREE.Mesh(new THREE.LatheGeometry(pts, 40), M.chrome));
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.0105, 0.0105, 0.012, 32), M.copper); collar.position.y = 0.036; g.add(collar);
  const hose = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.05, 16), M.chrome); hose.rotation.z = Math.PI / 2; hose.position.set(0.03, 0.02, 0); g.add(hose);
  g.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } }); return g;
}
function fbTripod() {
  const g = new THREE.Group(); const ring = new THREE.Mesh(new THREE.TorusGeometry(0.065, 0.004, 10, 48), M.blackPaint); ring.rotation.x = Math.PI / 2; ring.position.y = 0.218; g.add(ring);
  for (let i = 0; i < 3; i++) { const a = i * Math.PI * 2 / 3; const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.225, 10), M.blackPaint); leg.position.set(Math.cos(a) * 0.075, 0.11, Math.sin(a) * 0.075); leg.rotation.set(Math.sin(a) * 0.09, 0, -Math.cos(a) * 0.09); g.add(leg); }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; }); return g;
}
function fbRetort() {
  const g = new THREE.Group(); const base = new THREE.Mesh(roundedBox(0.2, 0.018, 0.13, 0.004), M.castIron); g.add(base);
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0055, 0.58, 20), M.steel); rod.position.set(-0.06, 0.3, 0); g.add(rod);
  const boss = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.022, 0.022), M.castIron); boss.position.set(-0.06, 0.4, 0); g.add(boss);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.11, 12), M.steel); arm.rotation.z = Math.PI / 2; arm.position.set(-0.005, 0.4, 0); g.add(arm);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; }); return g;
}
function fbBurette() { const t = tube({ r: 0.0065, h: 0.56, wall: 0.001 }); t.rotation.x = Math.PI; t.position.y = 0.56; return t; }

const SWAPS = {
  bunsen: (m) => { m.material.envMapIntensity = 1.0; },
  tripod: (m) => { m.material = M.blackPaint; },
  retort: (m) => { m.material = /chrom/i.test(m.material.name) ? M.steel : M.castIron; },
  burette: (m) => { if (/^GLASS:/.test(m.material.name)) { m.material = M.glass; m.layers.set(LAYER_GLASS); m.renderOrder = 2; } else m.material = M.whitePlastic; }
};
const FALLBACK = { bunsen: fbBunsen, tripod: fbTripod, retort: fbRetort, burette: fbBurette };

/** Centre of the highest geometry (the Bunsen barrel mouth), in model space. */
function topOf(obj) {
  obj.updateMatrixWorld(true); let maxY = -1e9; const v = new THREE.Vector3(), pts = [];
  obj.traverse(o => { if (!o.isMesh) return; const p = o.geometry.attributes.position; for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); pts.push(v.x, v.y, v.z); if (v.y > maxY) maxY = v.y; } });
  let x = 0, z = 0, n = 0; for (let i = 0; i < pts.length; i += 3) if (pts[i + 1] > maxY - 0.004) { x += pts[i]; z += pts[i + 2]; n++; }
  return new THREE.Vector3(n ? x / n : 0, maxY, n ? z / n : 0);
}
export function bunsenTop() { return (MODELS.bunsenTop || new THREE.Vector3(0, 0.146, 0)).clone(); }
export async function loadModels() {
  await Promise.all(Object.keys(FALLBACK).map(async id => {
    try {
      const gl = await loader.loadAsync(asset(`assets/models/${id}.glb`));
      gl.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; SWAPS[id](o); } });
      MODELS[id] = gl.scene; MODELS.status[id] = 'model';
      if (id === 'bunsen') MODELS.bunsenTop = topOf(gl.scene);
    } catch (e) {
      console.info('[film] model ' + id + ' unavailable, using procedural build');
      MODELS[id] = FALLBACK[id](); MODELS.status[id] = 'procedural';
      if (id === 'bunsen') MODELS.bunsenTop = new THREE.Vector3(0, 0.146, 0);
    }
  }));
}
/** Fresh copy of a loaded model (materials shared). */
export function model(id) { const src = MODELS[id] || FALLBACK[id](); const c = src.clone(true); return c; }
