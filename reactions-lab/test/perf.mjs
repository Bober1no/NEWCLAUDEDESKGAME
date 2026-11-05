// CPU-side cost of the simulation (physics + entities + fx) before/after heavy destruction, plus draw calls.
import { launch, open } from './harness.mjs';
const b = await launch(); const { page, log } = await open(b, {});
const r = await page.evaluate(async () => {
  const L = window.__lab, G = L.G; L.lock();
  const timeSteps = n => { const t0 = performance.now(); for (let k = 0; k < n; k++) L.step(1 / 60); return +((performance.now() - t0) / n).toFixed(2); };
  const draws = () => { L.render(); return G.renderer.r.info.render.calls; };
  const out = { idle: timeSteps(60), drawsIdle: draws(), bodies: G.physics.world.bodies.len() };
  // carnage: explode several spots, hammer every vessel once
  const ents = [...G.entities];
  const V = (x, y, z) => G.camera.position.clone().set(x, y, z);
  for (const e of ents.filter(e => e.ensureTemplate && e.alive).slice(0, 60)) { const p = e.obj.position.clone().add({ x: 0.03, y: 0.05, z: 0.03 }); e.hit(p, V(0, 0, -1), 2.2, 'hammer'); }
  for (const e of ents.filter(e => e.name === 'Window pane')) e.hit(e.obj.position.clone(), V(0, 0, -1), 3, 'hammer');
  for (const e of ents.filter(e => e.name === 'Hydrogen balloon')) e.heat(1, e.obj.position);
  out.burst = timeSteps(30); out.liveShards = G.debris.live.length; out.bodiesBurst = G.physics.world.bodies.len(); out.drawsBurst = draws();
  for (let k = 0; k < 6; k++) timeSteps(60);
  out.settled = timeSteps(60); out.liveSettled = G.debris.live.length; out.bodiesSettled = G.physics.world.bodies.len(); out.drawsSettled = draws();
  G.camera.position.set(0, 1.65, 4.2); G.camera.lookAt(-0.6, 0.9, 0); G.camera.updateMatrixWorld();
  out.found = [...G.chem.found]; out.puddles = G.chem.puddles.length;
  return out;
});
console.log(JSON.stringify(r)); await page.evaluate(() => window.__lab.render()); await page.screenshot({ path: 'out/carnage.png', timeout: 300000 }); console.log('errors', log.errors.slice(0, 8)); await b.close();
