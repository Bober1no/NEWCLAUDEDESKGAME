// Chemistry: substances, spills/puddles, and reactions between whatever meets on the bench or floor.
// Every reaction fires once per pairing, shows its balanced equation and counts towards "reactions discovered".
import * as THREE from 'three';
import { fmtChem } from './formula.js';

export const SUBS = {
  HCl: { name: 'Hydrochloric acid', formula: 'HCl(aq)', liquid: true, colour: '#dceeff', acid: true, hazard: 'Corrosive · 1.0 M', mol: 'HCl', fact: 'A strong acid. Reacts with metals, carbonates and bases.' },
  H2SO4: { name: 'Sulfuric acid', formula: 'H2SO4(aq)', liquid: true, colour: '#e4f0ff', acid: true, hazard: 'Corrosive · 0.5 M', fact: 'Its salts are sulfates.' },
  NaOH: { name: 'Sodium hydroxide', formula: 'NaOH(aq)', liquid: true, colour: '#eef6ff', base: true, hazard: 'Corrosive · 1.0 M', fact: 'A strong base (an alkali). Neutralises acids.' },
  CuSO4: { name: 'Copper(II) sulfate', formula: 'CuSO4(aq)', liquid: true, colour: '#3f9be8', hazard: 'Harmful', fact: 'Clear sky blue because of the Cu²⁺ ion.' },
  PbNO3: { name: 'Lead(II) nitrate', formula: 'Pb(NO3)2(aq)', liquid: true, colour: '#eef3f7', hazard: 'Toxic · teacher only', fact: 'With iodide ions it makes bright yellow lead(II) iodide.' },
  KI: { name: 'Potassium iodide', formula: 'KI(aq)', liquid: true, colour: '#f1f4f2', hazard: 'Low hazard', fact: 'Source of iodide ions, I⁻.' },
  AgNO3: { name: 'Silver nitrate', formula: 'AgNO3(aq)', liquid: true, colour: '#eef0f4', hazard: 'Corrosive · stains skin', fact: 'With chloride ions it makes white silver chloride.' },
  NaCl: { name: 'Sodium chloride solution', formula: 'NaCl(aq)', liquid: true, colour: '#f3f7fa', hazard: 'Low hazard', mol: 'NaCl', fact: 'Salt water. Speeds up rusting.' },
  BaCl2: { name: 'Barium chloride', formula: 'BaCl2(aq)', liquid: true, colour: '#f0f3f6', hazard: 'Toxic', fact: 'With sulfate ions it makes white barium sulfate.' },
  UI: { name: 'Universal indicator', formula: 'universal indicator', liquid: true, colour: '#3faa49', hazard: 'Flammable (ethanol)', fact: 'Red in acid, green at pH 7, purple in strong alkali.' },
  limewater: { name: 'Limewater', formula: 'Ca(OH)2(aq)', liquid: true, colour: '#f6fbff', base: true, hazard: 'Irritant', fact: 'Turns milky with carbon dioxide.' },
  H2O2: { name: 'Hydrogen peroxide', formula: 'H2O2(aq)', liquid: true, colour: '#f2f8ff', hazard: 'Oxidiser', mol: 'H2O2', fact: 'Decomposes into water and oxygen; a catalyst speeds it up.' },
  water: { name: 'Water', formula: 'H2O(l)', liquid: true, colour: '#e8f4ff', hazard: 'None', mol: 'H2O', fact: 'Two hydrogen atoms, one oxygen atom.' },
  Mg: { name: 'Magnesium ribbon', formula: 'Mg(s)', hazard: 'Flammable solid', mol: 'Mg', fact: 'Burns with a blinding white light. Fizzes in acid.' },
  CaCO3: { name: 'Marble chips', formula: 'CaCO3(s)', hazard: 'None', fact: 'Calcium carbonate. Fizzes in acid, giving off CO₂.' },
  Zn: { name: 'Zinc granules', formula: 'Zn(s)', hazard: 'Low hazard', fact: 'More reactive than copper and hydrogen.' },
  Fe: { name: 'Iron nail', formula: 'Fe(s)', hazard: 'None', fact: 'Rusts with oxygen and water; salt speeds it up.' },
  H2: { name: 'Hydrogen balloon', formula: 'H2(g)', hazard: 'Extremely flammable', mol: 'H2', fact: '2H₂ + O₂ → 2H₂O. Squeaky pop, or a fireball.' },
  CH4: { name: 'Methane (Bunsen gas)', formula: 'CH4(g)', hazard: 'Flammable', mol: 'CH4', fact: 'CH₄ + 2O₂ → CO₂ + 2H₂O. Open the air hole for a blue flame.' },
  glass: { name: 'Borosilicate glass', formula: 'SiO2 · B2O3', hazard: 'Sharp when broken', fact: 'Tough against heat, not against hammers.' },
  steel: { name: 'Steel', formula: 'Fe + C', hazard: 'None', fact: 'Sparks when struck.' },
  wood: { name: 'Wood', formula: 'cellulose', hazard: 'None', fact: 'Splinters along the grain.' },
  ceramic: { name: 'Ceramic tile', formula: 'aluminosilicate', hazard: 'Sharp when broken', fact: 'Brittle: shatters around the impact.' }
};

// reactions: key → {needs:[a,b] (substance tags), eq, label, fx}
export const REACTIONS = [
  { id: 'mg_acid', a: 'acid', b: 'Mg', eq: 'Mg(s) + 2HCl(aq) -> MgCl2(aq) + H2(g)', label: 'Single displacement · metal + acid', fx: 'fizz' },
  { id: 'zn_acid', a: 'acid', b: 'Zn', eq: 'Zn(s) + 2HCl(aq) -> ZnCl2(aq) + H2(g)', label: 'Single displacement · metal + acid', fx: 'fizz' },
  { id: 'caco3_acid', a: 'acid', b: 'CaCO3', eq: 'CaCO3(s) + 2HCl(aq) -> CaCl2(aq) + H2O(l) + CO2(g)', label: 'Neutralisation · carbonate + acid', fx: 'fizz' },
  { id: 'neutral', a: 'acid', b: 'base', eq: 'NaOH(aq) + HCl(aq) -> NaCl(aq) + H2O(l)', label: 'Neutralisation · acid + base', fx: 'steam' },
  { id: 'pbi2', a: 'PbNO3', b: 'KI', eq: 'Pb(NO3)2(aq) + 2KI(aq) -> PbI2(s) + 2KNO3(aq)', label: 'Precipitation · golden rain', fx: 'ppt', col: '#ffd21a' },
  { id: 'agcl', a: 'AgNO3', b: 'NaCl', eq: 'AgNO3(aq) + NaCl(aq) -> AgCl(s) + NaNO3(aq)', label: 'Precipitation · silver chloride', fx: 'ppt', col: '#f4f4f0' },
  { id: 'agcl2', a: 'AgNO3', b: 'HCl', eq: 'AgNO3(aq) + HCl(aq) -> AgCl(s) + HNO3(aq)', label: 'Precipitation · silver chloride', fx: 'ppt', col: '#f4f4f0' },
  { id: 'cuoh2', a: 'CuSO4', b: 'NaOH', eq: 'CuSO4(aq) + 2NaOH(aq) -> Cu(OH)2(s) + Na2SO4(aq)', label: 'Precipitation · copper(II) hydroxide', fx: 'ppt', col: '#7fb8e6' },
  { id: 'baso4', a: 'BaCl2', b: 'H2SO4', eq: 'BaCl2(aq) + H2SO4(aq) -> BaSO4(s) + 2HCl(aq)', label: 'Precipitation · barium sulfate', fx: 'ppt', col: '#f2f2ee' },
  { id: 'zncu', a: 'CuSO4', b: 'Zn', eq: 'Zn(s) + CuSO4(aq) -> ZnSO4(aq) + Cu(s)', label: 'Single displacement · redox', fx: 'copper' },
  { id: 'ui_acid', a: 'UI', b: 'acid', eq: null, label: 'Indicator: red means acid (pH 1–3)', fx: 'tint', col: '#e3262b' },
  { id: 'ui_base', a: 'UI', b: 'base', eq: null, label: 'Indicator: purple means strong alkali', fx: 'tint', col: '#5b2c7a' },
  { id: 'mg_burn', a: 'fire', b: 'Mg', eq: '2Mg(s) + O2(g) -> 2MgO(s)', label: 'Synthesis + redox · magnesium burns', fx: 'mgburn' },
  { id: 'h2o2', a: 'fire', b: 'H2', eq: '2H2(g) + O2(g) -> 2H2O(l)', label: 'Synthesis · hydrogen explodes', fx: 'none' },
  { id: 'ch4', a: 'fire', b: 'CH4', eq: 'CH4(g) + 2O2(g) -> CO2(g) + 2H2O(g)', label: 'Combustion · redox', fx: 'none' },
  { id: 'rust', a: 'NaCl', b: 'Fe', eq: '4Fe(s) + 3O2(g) + 2H2O(l) -> 2Fe2O3.H2O(s)', label: 'Corrosion · salt water rusts iron', fx: 'rust' }
];
const tagsOf = (id) => { const s = SUBS[id] || {}; const t = new Set([id]); if (s.acid) t.add('acid'); if (s.base) t.add('base'); return t; };

export class Chem {
  constructor(W) {
    this.W = W; this.puddles = []; this.done = new Set(); this.found = new Set(); this.active = []; this.burning = [];
    // fixed pool of burn lights: adding/removing lights at runtime would recompile every shader (a visible hitch)
    this.burnLights = [0, 1].map(() => { const l = new THREE.PointLight(0xf4f6ff, 0, 6, 2); l.userData.free = true; W.scene.add(l); return l; });
    this.burnCoreGeo = new THREE.SphereGeometry(1, 16, 12); this.burnCoreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(14, 14, 15) });
    this.blobs = []; // a few irregular puddle outlines, shared
    for (let k = 0; k < 6; k++) {
      const g = new THREE.CircleGeometry(1, 48), a = g.attributes.position, ph = [Math.random() * 6, Math.random() * 6, Math.random() * 6];
      for (let i = 1; i < a.count; i++) { const x = a.getX(i), y = a.getY(i), t = Math.atan2(y, x); const r = 1 + 0.16 * Math.sin(t * 2 + ph[0]) + 0.09 * Math.sin(t * 3 + ph[1]) + 0.05 * Math.sin(t * 7 + ph[2]); a.setXY(i, x * r, y * r); }
      this.blobs.push(g);
    }
  }
  sub(id) { return SUBS[id]; }
  blob() { return this.blobs[Math.floor(Math.random() * this.blobs.length)]; }
  /** A vessel spills `vol` m³ (0 = start of a leak) at a world point: splash + a puddle on whatever is below. */
  spill(vessel, point, vol) {
    const W = this.W, id = vessel.substance; if (!id) return;
    const S = SUBS[id], col = new THREE.Color(S.colour);
    const hit = W.physics.raycast(new THREE.Vector3(point.x, point.y + 0.02, point.z), new THREE.Vector3(0, -1, 0), 4, undefined, vessel.body);
    const y = hit ? hit.point.y : 0;
    W.fx.splash(new THREE.Vector3(point.x, Math.max(point.y, y + 0.01), point.z), col, vol > 0 ? 30 : 10, y);
    if (vol <= 0) return;
    // merge into an existing puddle of the same substance nearby
    let p = this.puddles.find(q => q.sub === id && Math.abs(q.y - y) < 0.05 && Math.hypot(q.x - point.x, q.z - point.z) < q.r + 0.05);
    if (!p) {
      // clear liquids read as a dark wet sheen (mostly reflection); coloured ones keep their tint
      const chroma = Math.max(col.r, col.g, col.b) - Math.min(col.r, col.g, col.b), clear = chroma < 0.15 && Math.max(col.r, col.g, col.b) > 0.55;
      const mat = new THREE.MeshStandardMaterial({ color: clear ? col.clone().multiplyScalar(0.12) : col, transparent: true, opacity: clear ? 0.3 : 0.62, roughness: 0.06, metalness: 0, envMapIntensity: clear ? 0.7 : 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      const mesh = new THREE.Mesh(this.blob(), mat); mesh.rotation.set(-Math.PI / 2, 0, Math.random() * 6.283); mesh.position.set(point.x, y + 0.0015, point.z); mesh.scale.setScalar(0.001); mesh.renderOrder = 1; mesh.receiveShadow = true;
      W.scene.add(mesh);
      p = { sub: id, x: point.x, z: point.z, y, vol: 0, r: 0.001, target: 0, mesh, col, age: 0, tags: tagsOf(id) };
      this.puddles.push(p);
      if (this.puddles.length > 48) { const old = this.puddles.shift(); old.mesh.removeFromParent(); }
    }
    p.vol += vol; p.target = Math.min(0.6, Math.sqrt(p.vol / (Math.PI * 0.0012)));
  }
  /** Fire a reaction once (also used by explosions / flames). */
  react(id, point, a, b) {
    const R = REACTIONS.find(r => r.id === id); if (!R) return;
    const key = id + ':' + (a?.id ?? 'x') + ':' + (b?.id ?? 'y');
    if (this.done.has(key)) return; this.done.add(key);
    const first = !this.found.has(id); this.found.add(id);
    this.W.toast(R.eq ? `<span class="chem">${fmtChem(R.eq)}</span><small>${R.label}${first ? ' · NEW' : ''}</small>` : `<small>${R.label}</small>`, 'react', first);
    this.W.onDiscover?.(this.found.size, REACTIONS.length);
    return R;
  }
  /** Something hot is at `point` with heat `amount` (Bunsen, torch, burning Mg). */
  fire(point, radius, amount, source) {
    for (const e of this.W.physics.overlapSphere(point, radius)) { if (e === source || !e.heat) continue; e.heat(amount, point); }
  }
  update(dt) {
    const W = this.W;
    for (const p of this.puddles) { p.age += dt; p.r += (p.target - p.r) * Math.min(1, dt * 3); p.mesh.scale.setScalar(Math.max(0.001, p.r)); }
    // puddle ↔ puddle
    for (let i = 0; i < this.puddles.length; i++) for (let j = i + 1; j < this.puddles.length; j++) {
      const a = this.puddles[i], b = this.puddles[j]; if (a.sub === b.sub || Math.abs(a.y - b.y) > 0.05) continue;
      if (Math.hypot(a.x - b.x, a.z - b.z) > a.r + b.r) continue;
      for (const R of REACTIONS) if ((a.tags.has(R.a) && b.tags.has(R.b)) || (a.tags.has(R.b) && b.tags.has(R.a))) this.runPuddle(R, a, b);
    }
    // puddle ↔ solids lying in it
    for (const p of this.puddles) {
      for (const e of W.physics.overlapSphere(new THREE.Vector3(p.x, p.y + 0.01, p.z), Math.max(0.01, p.r))) {
        if (!e.substance || !e.alive || e.consumed) continue;
        for (const R of REACTIONS) if ((p.tags.has(R.a) && R.b === e.substance) || (p.tags.has(R.b) && R.a === e.substance)) {
          if (R.fx === 'fizz' || R.fx === 'copper') this.startFizz(e, p, R);
          else if (R.fx === 'rust' && e.rust) { e.rust.uRust.value = Math.min(0.9, e.rust.uRust.value + dt * 0.05); this.react(R.id, e.obj.position, p, e); }
        }
      }
    }
    // fizzing reactions on solids
    for (let i = this.active.length - 1; i >= 0; i--) {
      const f = this.active[i]; f.t += dt;
      if (!f.e.alive || f.t > f.life) { if (f.e.alive && f.R.id !== 'zncu' && f.R.id !== 'caco3_acid') { f.e.consumed = true; f.e.remove(); } this.active.splice(i, 1); continue; }
      const pos = f.e.obj.position, rate = 60 * dt * (1 - f.t / f.life);
      for (let k = 0; k < rate; k++) W.fx.bubbles.emit(pos.x + (Math.random() - 0.5) * 0.03, f.p.y + 0.001, pos.z + (Math.random() - 0.5) * 0.03, 0.0015 + Math.random() * 0.0015, f.p.y + 0.02 + Math.random() * 0.03);
      if (Math.random() < dt * 4) W.fx.plume(new THREE.Vector3(pos.x, f.p.y + 0.02, pos.z), [0.9, 0.93, 0.95], 1, 0.04, 0.2, 0.08);
      if (f.R.id !== 'zncu' && f.R.id !== 'caco3_acid') { const s = Math.max(0.05, 1 - f.t / f.life); f.e.obj.scale.setScalar(s); }
      if (f.R.id === 'zncu') { f.e.obj.traverse(o => { if (o.isMesh && o.material && o.material.color && !o.userData.copper) { o.material = o.material.clone(); o.userData.copper = true; } if (o.userData.copper) o.material.color.lerp(new THREE.Color('#8a3b22'), dt * 0.2); }); f.p.mesh.material.color.lerp(new THREE.Color('#f2f6f8'), dt * 0.1); }
    }
    // burning magnesium
    for (let i = this.burning.length - 1; i >= 0; i--) {
      const b = this.burning[i]; b.t += dt;
      if (!b.e.alive || b.t > 6) { if (b.e.alive) { this.ash(b.e.obj.position); b.e.consumed = true; b.e.remove(); } this.freeBurn(b); this.burning.splice(i, 1); continue; }
      const p = b.e.obj.position, fl = 0.7 + 0.3 * Math.sin(W.time * 40) * Math.sin(W.time * 13);
      b.core.position.copy(p); b.core.scale.setScalar(0.012 * fl); if (b.light) { b.light.position.copy(p); b.light.intensity = 6 * fl; }
      W.fx.sparks(p, 3, 1.5, [4, 3.8, 3.4], 0.4, 0.006); if (Math.random() < 0.6) W.fx.plume(p, [0.95, 0.95, 0.95], 1, 0.05, 0.35, 0.18);
      b.e.obj.scale.setScalar(Math.max(0.05, 1 - b.t / 6)); this.fire(p, 0.08, dt * 2, b.e);
      W.flashExposure = Math.max(W.flashExposure || 0, 0.35);
    }
  }
  runPuddle(R, a, b) {
    const W = this.W, mid = new THREE.Vector3((a.x + b.x) / 2, a.y + 0.005, (a.z + b.z) / 2);
    const r = this.react(R.id, mid, a, b); if (!r) return;
    if (R.fx === 'ppt') { const c = new THREE.Color(R.col); W.fx.cloud(mid, c, 160, Math.min(a.r, b.r) + 0.03, a.y); for (const q of [a, b]) q.mesh.material.color.lerp(c, 0.85), q.mesh.material.opacity = 0.85; }
    if (R.fx === 'tint') { const ui = a.sub === 'UI' ? a : b; ui.mesh.material.color.set(R.col); ui.mesh.material.opacity = 0.75; }
    if (R.fx === 'steam') { W.fx.plume(mid, [0.95, 0.97, 1], 10, 0.08, 0.3, 0.1); }
  }
  startFizz(e, p, R) {
    if (this.active.some(f => f.e === e)) return;
    this.react(R.id, e.obj.position, p, e);
    this.active.push({ e, p, R, t: 0, life: R.id === 'mg_acid' ? 7 : 14 });
  }
  ignite(e) {
    if (this.burning.some(b => b.e === e) || e.consumed) return;
    this.react('mg_burn', e.obj.position, { id: 'fire' }, e);
    const core = new THREE.Mesh(this.burnCoreGeo, this.burnCoreMat), light = this.burnLights.find(l => l.userData.free) || null;
    if (light) light.userData.free = false;
    this.W.scene.add(core); this.burning.push({ e, t: 0, core, light });
  }
  freeBurn(b) { b.core.removeFromParent(); if (b.light) { b.light.intensity = 0; b.light.userData.free = true; } }
  ash(p) { const m = new THREE.Mesh(new THREE.DodecahedronGeometry(0.01, 1), new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 1 })); m.scale.set(1.4, 0.35, 0.9); m.position.copy(p); m.position.y -= 0.004; this.W.scene.add(m); }
  clear() { for (const p of this.puddles) p.mesh.removeFromParent(); this.puddles = []; this.active = []; for (const b of this.burning) this.freeBurn(b); this.burning = []; this.done.clear(); }
}
