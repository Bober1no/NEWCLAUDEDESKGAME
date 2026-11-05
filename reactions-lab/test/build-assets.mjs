// Asset pipeline (tooling only, not shipped).
// Downloads each third-party model from a PINNED commit on raw.githubusercontent.com, verifies its
// licence record (Sketchfab export metadata + license.txt), rescales to real-world metres with the base
// on y = 0, tags glass for the runtime borosilicate swap, resizes textures to WebP and compresses
// geometry with meshopt. Writes assets/models/*.glb and assets/models/credits.json.
//
//   cd test && npm ci && node build-assets.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, center, textureCompress, meshopt, getBounds } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '../assets/models');
const TMP = path.resolve(HERE, '.asset-cache');          // downloads are untrusted data: own folder, never executed
const ALLOWED = /^(CC0|CC-BY-4\.0|CC-BY-3\.0)\b/;

// height/width in metres = real-world size of the prop. `fit` picks the bbox axis to match.
export const MODELS = [
  { id: 'bunsen', repo: 'mucel29/chemistry', sha: '11c09bc044f5042fcb47bce0b115873cc5ca6a3c', path: 'public/assets/burner/scene.gltf', fit: 'y', size: 0.146, tex: 2048, prop: 'Bunsen burner' },
  { id: 'tripod', repo: 'mucel29/chemistry', sha: '11c09bc044f5042fcb47bce0b115873cc5ca6a3c', path: 'public/assets/stand/scene.gltf', fit: 'y', size: 0.22, tex: 1024, prop: 'Tripod' },
  { id: 'retort', repo: 'Visuals-Smart-Tech/chem-quest-lab-adventures-main', sha: 'e3236abd18dda768eb01eb09bee6007a5a37eaf4', path: 'public/models/burette_stand/scene.gltf', fit: 'y', size: 0.60, tex: 1024, prop: 'Retort (burette) stand with clamp' },
  { id: 'burette', repo: 'Visuals-Smart-Tech/chem-quest-lab-adventures-main', sha: 'e3236abd18dda768eb01eb09bee6007a5a37eaf4', path: 'public/models/burette/scene.gltf', fit: 'y', size: 0.56, tex: 1024, prop: 'Burette', glass: ['Material.003'] }
];

const enc = s => s.split('/').map(encodeURIComponent).join('/');
async function get(m, rel) {
  const u = `https://raw.githubusercontent.com/${m.repo}/${m.sha}/${enc(rel)}`;
  const r = await fetch(u); if (!r.ok) throw new Error(`${r.status} ${u}`);
  return Buffer.from(await r.arrayBuffer());
}

async function download(m) {
  const dir = path.join(TMP, m.id); fs.mkdirSync(dir, { recursive: true });
  const base = path.posix.dirname(m.path);
  const gltf = await get(m, m.path); fs.writeFileSync(path.join(dir, 'scene.gltf'), gltf);
  const j = JSON.parse(gltf.toString());
  for (const x of [...(j.buffers || []), ...(j.images || [])]) {
    if (!x.uri || x.uri.startsWith('data:')) continue;
    const rel = decodeURIComponent(x.uri), dest = path.join(dir, rel);
    if (!dest.startsWith(dir)) throw new Error('path escape in ' + x.uri);
    fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, await get(m, base + '/' + rel));
  }
  let licTxt = '';
  try { licTxt = (await get(m, base + '/license.txt')).toString(); fs.writeFileSync(path.join(dir, 'license.txt'), licTxt); } catch { /* some folders lack it; metadata still required */ }
  const ex = (j.asset && j.asset.extras) || {};
  const lic = (ex.license || (licTxt.match(/license type:\s*(.+)/) || [])[1] || '').trim();
  if (!ALLOWED.test(lic)) throw new Error(`${m.id}: licence "${lic || 'none'}" is not CC0/CC-BY. Refusing.`);
  return {
    dir, credit: {
      id: m.id, prop: m.prop, title: ex.title || (licTxt.match(/title:\s*(.+)/) || [])[1],
      author: ex.author || (licTxt.match(/author:\s*(.+)/) || [])[1], source: ex.source || (licTxt.match(/source:\s*(.+)/) || [])[1],
      license: lic, via: `https://github.com/${m.repo}/tree/${m.sha}/${path.posix.dirname(m.path)}`, modified: 'rescaled to metres, re-centred, textures resized to WebP, geometry meshopt-compressed; glass and metal materials replaced at runtime'
    }
  };
}

async function build(m, io) {
  const { dir, credit } = await download(m);
  const doc = await io.read(path.join(dir, 'scene.gltf'));
  const root = doc.getRoot();
  // tag glass so the runtime swaps in the borosilicate MeshPhysicalMaterial recipe
  for (const mat of root.listMaterials()) {
    const isGlass = (m.glass || []).includes(mat.getName()) || mat.getAlphaMode() === 'BLEND' || !!mat.getExtension('KHR_materials_transmission');
    if (isGlass) mat.setName('GLASS:' + mat.getName());
  }
  // scale to real-world size, base on y = 0, centred in x/z
  const scene = root.listScenes()[0];
  let b = getBounds(scene);
  const ax = { x: 0, y: 1, z: 2 }[m.fit];
  const s = m.size / (b.max[ax] - b.min[ax]);
  const wrap = doc.createNode('fit').setScale([s, s, s]);
  for (const n of scene.listChildren()) { scene.removeChild(n); wrap.addChild(n); }
  scene.addChild(wrap);
  await doc.transform(center({ pivot: 'below' }));
  await doc.transform(
    dedup(), prune(), weld(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [m.tex, m.tex], quality: 82 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' })
  );
  b = getBounds(scene);
  const tris = root.listMeshes().reduce((a, me) => a + me.listPrimitives().reduce((q, p) => q + (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3, 0), 0);
  const file = path.join(OUT, m.id + '.glb');
  await io.write(file, doc);
  const kb = Math.round(fs.statSync(file).size / 1024);
  console.log(`${m.id.padEnd(8)} ${kb} KB  ${Math.round(tris)} tris  size ${b.max.map((v, i) => (v - b.min[i]).toFixed(3)).join(' x ')} m  ${credit.license}`);
  return { ...credit, file: 'assets/models/' + m.id + '.glb', kb, tris: Math.round(tris) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await MeshoptEncoder.ready; await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
  fs.mkdirSync(OUT, { recursive: true });
  const credits = [], failed = [];
  for (const m of MODELS) {
    try { credits.push(await build(m, io)); }
    catch (e) { console.error('FAILED', m.id, e.message); failed.push({ id: m.id, prop: m.prop, reason: e.message }); }
  }
  fs.writeFileSync(path.join(OUT, 'credits.json'), JSON.stringify({ credits, failed }, null, 2));
  if (failed.length) process.exitCode = 1;
}
