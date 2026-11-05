import { launch, open } from './harness.mjs';
const b = await launch(); const { page, log } = await open(b, {});
const views = { start: [0, 1.65, 4.2, -0.6, 0.9, 0], bench: null, back: [2.5, 1.65, 1.5, -3.5, 1.2, -5.5], side: [-5.5, 1.65, 3.8, 0, 0.8, -2] };
await page.evaluate(() => { const L = window.__lab; L.lock(); for (let k = 0; k < 3; k++) L.step(1 / 60); const mg = [...L.G.entities].find(e => e.substance === 'Mg'); window.__mp = mg.obj.position.clone(); });
for (const [n, v] of Object.entries(views)) {
  await page.evaluate(v => { const G = window.__lab.G, mp = window.__mp; if (!v) v = [mp.x + 0.35, mp.y + 0.3, mp.z + 0.35, mp.x, mp.y, mp.z]; G.camera.position.set(v[0], v[1], v[2]); G.camera.lookAt(v[3], v[4], v[5]); G.camera.updateMatrixWorld(); window.__lab.render(); }, v);
  await page.screenshot({ path: 'out/l_' + n + '.png', timeout: 300000 });
}
console.log(log.errors); await b.close();
