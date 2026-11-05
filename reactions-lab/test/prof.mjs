// Where do draw calls come from? Counts visible meshes by owner and shadow casting.
import { launch, open } from './harness.mjs';
const b = await launch(); const { page, log } = await open(b, {});
console.log(JSON.stringify(await page.evaluate(() => {
  const L = window.__lab, G = L.G; L.lock(); L.step(1 / 60);
  const out = { meshes: 0, cast: 0, transparent: 0, byEntity: {}, static: 0, other: {} };
  const owner = new Map(); for (const e of G.entities) e.obj?.traverse(o => owner.set(o, e));
  G.scene.traverseVisible(o => { if (!(o.isMesh || o.isPoints || o.isLine || o.isInstancedMesh)) return; out.meshes++; if (o.castShadow) out.cast++; if (o.material?.transparent) out.transparent++;
    const e = owner.get(o); if (e) { const k = e.name.replace(/\(.*\)/, '').trim(); out.byEntity[k] = (out.byEntity[k] || 0) + 1; } else { const k = (o.material?.type || '?') + (o.isInstancedMesh ? '/inst' : ''); out.other[k] = (out.other[k] || 0) + 1; } });
  out.passes = G.renderer.composer.passes.map(p => p.constructor.name);
  return out;
}), null, 0));
console.log(log.errors); await b.close();
