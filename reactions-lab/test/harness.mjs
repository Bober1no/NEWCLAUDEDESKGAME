// Playwright harness for the game: SwiftShader WebGL; jsDelivr (three + rapier) routed to node_modules; all else blocked.
import { createRequire } from 'node:module';
import path from 'node:path'; import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }
export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');
export const FILE_URL = pathToFileURL(path.join(ROOT, 'dist/reactions-lab.html')).href;
export async function launch() { return pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] }); }
export async function open(browser, { viewport = { width: 1280, height: 720 }, quality = 'HIGH', fonts = false, url = FILE_URL, failAsset = null } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 }); const page = await ctx.newPage();
  const log = { errors: [], warnings: [], blocked: [], requests: [] };
  page.on('console', m => { const t = m.text(); if (m.type() === 'error') log.errors.push(t); else if (m.type() === 'warning') log.warnings.push(t); if (process.env.VERBOSE) console.log('[page]', t); });
  page.on('pageerror', e => log.errors.push('pageerror: ' + e.message));
  await page.route('**/*', async route => {
    const u = route.request().url(); log.requests.push(u);
    let m = u.match(/cdn\.jsdelivr\.net\/npm\/three@0\.160\.0\/(.*)$/);
    if (m) return route.fulfill({ path: path.join(HERE, 'node_modules/three', m[1].split('?')[0]), contentType: 'text/javascript' });
    m = u.match(/cdn\.jsdelivr\.net\/npm\/@dimforge\/rapier3d-compat@0\.14\.0\/(.*)$/);
    if (m) return route.fulfill({ path: path.join(HERE, 'node_modules/@dimforge/rapier3d-compat', m[1]), contentType: 'text/javascript' });
    if (u.startsWith('file:') || u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('http://127.0.0.1')) return route.continue();
    if (/fonts\.(googleapis|gstatic)\.com/.test(u)) return fonts ? route.continue().catch(() => route.abort()) : route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    log.blocked.push(u); return route.abort();
  });
  await page.addInitScript(({ quality, failAsset }) => {
    window.__LAB_TEST__ = true; window.__labInstall = api => { window.__lab = api; };
    try { localStorage.setItem('rxlab:quality', JSON.stringify(quality)); } catch { }
    if (failAsset) { const iv = setInterval(() => { if (window.__RXF_ASSETS) { delete window.__RXF_ASSETS[failAsset]; clearInterval(iv); } }, 0); }
  }, { quality, failAsset });
  await page.goto(url);
  await page.waitForFunction(() => !!window.__lab || document.getElementById('notice')?.hidden === false, null, { timeout: 240000 });
  return { page, ctx, log };
}
/** Place the camera: position + yaw/pitch, then step n frames. */
export async function view(page, x, y, z, yaw, pitch, n = 2) {
  await page.evaluate(([x, y, z, yaw, pitch, n]) => { const L = window.__lab, G = L.G; L.lock(); G.player.body.setNextKinematicTranslation({ x, y: y + G.player.half + G.player.radius, z }); G.player.body.setTranslation({ x, y: y + G.player.half + G.player.radius, z }, true); G.player.yaw = yaw; G.player.pitch = pitch; for (let k = 0; k < n; k++) L.step(1 / 60); L.render(); }, [x, y, z, yaw, pitch, n]);
}
