// Scripted gameplay checks with screenshots.
import { launch, open, view, HERE } from './harness.mjs';
import path from 'node:path';
const b = await launch(); const { page, log } = await open(b, { quality: process.env.Q || 'HIGH' });
const shot = async n => { await page.evaluate(() => window.__lab.render()); await page.screenshot({ path: path.join(HERE, 'out', n + '.png'), timeout: 300000 }); };
const R = await page.evaluate(() => {
  const L = window.__lab, G = L.G; L.lock(); const out = {};
  const ents = [...G.entities];
  // 1) hammer a liquid-filled beaker: local break
  const v = ents.find(e => e.ensureTemplate && e.liq && e.ud && e.ud.kind === 'beaker' && Math.abs(e.obj.position.x + 2.1) < 0.1 && Math.abs(e.obj.position.z - 0.15) < 0.1);
  const p = v.obj.position.clone();
  const eye = p.clone().add({ x: 0, y: 0.35, z: 0.55 });
  G.player.body.setTranslation({ x: eye.x, y: eye.y - 1.62 + 0.9, z: eye.z }, true);
  G.player.yaw = 0; G.player.pitch = -0.6; for (let k = 0; k < 3; k++) L.step(1 / 60);
  G.camera.position.copy(eye); G.camera.lookAt(p.x, p.y + 0.05, p.z); G.camera.updateMatrixWorld();
  const before = v.tpl ? v.ids.size : null;
  G.tools.hammerHit(); for (let k = 0; k < 20; k++) L.step(1 / 60);
  out.hammer = { alive: v.alive, total: v.tpl && v.tpl.shards.length, left: v.ids && v.ids.size, shards: G.debris.live.length, puddles: G.chem.puddles.length, name: v.name };
  G.camera.position.set(p.x + 0.25, p.y + 0.3, p.z + 0.5); G.camera.lookAt(p.x, p.y, p.z); G.camera.updateMatrixWorld();
  return out;
});
console.log(JSON.stringify(R)); await shot('hammer');
const R2 = await page.evaluate(() => {
  const L = window.__lab, G = L.G, ents = [...G.entities], out = {};
  // 2) fire bearings at a window pane
  const pane = ents.find(e => e.name === 'Window pane');
  const pp = pane.obj.position.clone(); const eye = pp.clone().add({ x: 0.3, y: -0.2, z: 3 });
  G.player.body.setTranslation({ x: eye.x, y: eye.y - 1.62 + 0.9, z: eye.z }, true); G.player.velocity.set(0, 0, 0); G.player.knock.set(0, 0, 0);
  const aimAt = (x, y, z) => { G.player.yaw = Math.atan2(-(x - eye.x), -(z - eye.z)); G.player.pitch = Math.atan2(y - eye.y, Math.hypot(x - eye.x, z - eye.z)); L.step(1 / 60); };
  for (let i = 0; i < 4; i++) { aimAt(pp.x + (i - 1.5) * 0.15, pp.y + (i % 2) * 0.25 - 0.1, pp.z); G.tools.fireBearing(); for (let k = 0; k < 12; k++) L.step(1 / 60); }
  aimAt(pp.x, pp.y, pp.z);
  out.pane = { alive: pane.alive, cells: pane.cells && pane.cells.length, colliders: pane.colliders.length, shards: G.debris.live.length };
  out.eye = eye.toArray(); out.target = pp.toArray();
  return out;
});
console.log(JSON.stringify(R2)); await shot('window');
const R3 = await page.evaluate(() => {
  const L = window.__lab, G = L.G, ents = [...G.entities], out = {};
  // 3) torch a hydrogen balloon → explosion → chain reaction
  const balloons = ents.filter(e => e.name === 'Hydrogen balloon'); out.balloons = balloons.length;
  const bp = balloons[0].obj.position.clone(); balloons[0].heat(1, bp); for (let k = 0; k < 30; k++) L.step(1 / 60);
  out.after = ents.filter(e => e.name === 'Hydrogen balloon' && e.alive).length; out.found = [...G.chem.found];
  G.camera.position.set(bp.x + 1.5, bp.y + 0.3, bp.z + 1.8); G.camera.lookAt(bp); G.camera.updateMatrixWorld();
  return out;
});
console.log(JSON.stringify(R3)); await shot('explosion');
const R4 = await page.evaluate(() => {
  const L = window.__lab, G = L.G, ents = [...G.entities], out = {};
  // 4) knock an acid tube over next to magnesium ribbons
  const mg = ents.find(e => e.substance === 'Mg' && e.alive); const acid = ents.find(e => e.substance === 'HCl' && e.liq && e.alive && e.ud.kind === 'beaker');
  const mp = mg.obj.position.clone(); acid.body.setTranslation({ x: mp.x, y: mp.y + 0.15, z: mp.z }, true); acid.body.setRotation({ x: 0.7071, y: 0, z: 0, w: 0.7071 }, true);
  for (let k = 0; k < 120; k++) L.step(1 / 60);
  out.puddles = G.chem.puddles.map(p => [p.sub, +p.r.toFixed(3)]); out.found = [...G.chem.found]; out.fizz = G.chem.active.length; out.bubbles = G.fx.bubbles.n;
  G.camera.position.set(mp.x + 0.35, mp.y + 0.3, mp.z + 0.35); G.camera.lookAt(mp); G.camera.updateMatrixWorld();
  return out;
});
console.log(JSON.stringify(R4)); await shot('fizz');
const R5 = await page.evaluate(() => {
  const L = window.__lab, G = L.G, ents = [...G.entities], out = {};
  // 5) smash a stool with a strong hit
  const st = ents.find(e => e.name === 'Lab stool'); const sp = st.obj.position.clone(); const n0 = st.parts.length;
  const D = G.camera.position.clone().set(1,0,0); st.hit(sp.clone().add({ x: 0.11, y: 0.3, z: 0.11 }), D, 3, 'hammer');
  for (let k = 0; k < 30; k++) L.step(1 / 60);
  out.stool = { before: n0, after: st.parts.length, pieces: ents.length };
  out.parts = [...G.entities].filter(e => e.name === 'Lab stool').length;
  const tc = sp.clone().multiplyScalar(0.7); tc.y = 1.3; const dd = tc.clone().sub(sp).setY(0).normalize().multiplyScalar(1.6); G.camera.position.set(sp.x + dd.x, 1.3, sp.z + dd.z); G.camera.lookAt(sp.x, 0.35, sp.z); G.camera.updateMatrixWorld();
  return out;
});
console.log(JSON.stringify(R5)); await shot('stool');
console.log('errors', log.errors.slice(0, 10)); await b.close();
// assertions: breaks are local, tools connect, reactions fire, no page errors
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };
ok(R.hammer.alive && R.hammer.left > 0 && R.hammer.left < R.hammer.total && R.hammer.total - R.hammer.left <= R.hammer.total * 0.4, 'hammer should knock a local hole in the beaker, not destroy it');
ok(R.hammer.puddles > 0, 'a holed beaker should leak into a puddle');
ok(R2.pane.cells > 0 && R2.pane.colliders > 1, 'bearings should crack the window pane');
ok(R3.after === 0 && R3.found.includes('h2o2'), 'a torched balloon should explode and chain to its neighbours');
ok(R4.found.includes('mg_acid') && R4.bubbles > 0, 'acid spilled on magnesium should fizz');
ok(R5.stool.after < R5.stool.before && R5.stool.after > 0, 'a hammered stool should lose a part, not vanish');
ok(log.errors.length === 0, 'no console errors');
if (fails.length) { console.log('FAIL\n - ' + fails.join('\n - ')); process.exit(1); } else console.log('PASS: all gameplay checks');
