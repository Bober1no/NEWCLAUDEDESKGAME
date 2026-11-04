import { launch, open, at } from './harness.mjs';
const b = await launch(); const { page, log } = await open(b, { quality: 'HIGH' });
await at(page, 'r4', 27, 2);
await page.screenshot({ path: 'out/dbg1.png', timeout: 300000 });
console.log(await page.evaluate(() => {
  const st = window.__film.stage(); const sc = st.scene; let info = [];
  sc.traverse(o => { if (o.isMesh && o.material && o.material.transmission === 1 && o.material.ior === 1.33) { let v = true, p = o; while (p) { if (!p.visible) { v = false; break; } p = p.parent; } if (v) { o.geometry.computeBoundingBox(); info.push({ verts: o.geometry.attributes.position ? o.geometry.attributes.position.count : 0, bb: o.geometry.boundingBox.max.toArray().map(x => +x.toFixed(3)), col: o.material.attenuationColor.getHexString(), dist: o.material.attenuationDistance, layer: o.layers.mask }); } } });
  st.camera.layers.disable(1); window.__film.tick(1 / 30); return info.slice(0, 5);
}));
await page.screenshot({ path: 'out/dbg2.png', timeout: 300000 });
await b.close();
