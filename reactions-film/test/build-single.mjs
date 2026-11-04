// Builds dist/reactions-film.html: ONE self-contained file you can double-click (file://).
// - all JS bundled and inlined (two inline module scripts: the 3D stage, then the film engine)
// - CSS inlined; models / HDRIs / font embedded as base64 data URIs (window.__RXF_ASSETS)
// - three.js r160 still comes from jsDelivr via the import map (needs internet, like the Google Fonts)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DIST = path.join(ROOT, 'dist');
const ext = ['three', 'three/addons/*'];

async function bundle(contents, extra = {}) {
  const r = await esbuild.build({ stdin: { contents, resolveDir: ROOT, loader: 'js' }, bundle: true, format: 'esm', write: false, minify: true, target: 'es2020', external: ext, legalComments: 'none', ...extra });
  return r.outputFiles[0].text;
}
const stageJS = await bundle(`import * as S from './js/stage.js'; window.__RXF_STAGE = S;`);
const mainJS = await bundle(`import './js/main.js';`, { external: [...ext, './stage.js'] });

const mime = { '.glb': 'model/gltf-binary', '.exr': 'image/x-exr', '.json': 'application/json' };
const assets = {};
for (const rel of ['assets/hdri/lab.exr', 'assets/models/bunsen.glb', 'assets/models/tripod.glb', 'assets/models/retort.glb', 'assets/models/burette.glb', 'assets/fonts/inter_black_subset.json']) {
  const buf = fs.readFileSync(path.join(ROOT, rel));
  assets[rel] = `data:${mime[path.extname(rel)] || 'application/octet-stream'};base64,${buf.toString('base64')}`;
}
let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'css/film.css'), 'utf8');
const safe = s => s.replace(/<\/script/gi, '<\\/script');
html = html.replace('<link rel="stylesheet" href="css/film.css">', `<style>\n${css}\n</style>`);
html = html.replace('<script type="module" src="js/main.js"></script>',
  `<script>window.__RXF_SINGLE = true; window.__RXF_ASSETS = ${JSON.stringify(assets)};</script>\n` +
  `<script type="module">\n${safe(stageJS)}\n</script>\n<script type="module">\n${safe(mainJS)}\n</script>`);
fs.mkdirSync(DIST, { recursive: true });
fs.writeFileSync(path.join(DIST, 'reactions-film.html'), html);
console.log('dist/reactions-film.html', (fs.statSync(path.join(DIST, 'reactions-film.html')).size / 1048576).toFixed(2), 'MB');
