import { launch, open, at } from './harness.mjs';
const b = await launch(); const { page } = await open(b, { viewport: { width: 320, height: 180 }, quality: 'HIGH', fonts: false });
for (const [id, s] of [['r2', 14], ['r2', 33]]) {
  await at(page, id, s, 2);
  console.log(id, s, await page.evaluate(() => {
    const st = window.__film.stage(); const base = st.probes.sample().mean; const res = [];
    const cands = []; st.scene.traverseVisible(o => { if ((o.isMesh || o.isPoints || o.isLight) && o.visible) cands.push(o); });
    for (const o of cands) { o.visible = false; const m = st.probes.sample().mean; o.visible = true; if (m < base * 0.7) res.push([o.type, o.material ? o.material.type : '', o.name, +m.toFixed(3), o.isLight ? o.intensity : '']); }
    return { base: +base.toFixed(3), culprits: res.slice(0, 8) };
  }));
}
await b.close();
