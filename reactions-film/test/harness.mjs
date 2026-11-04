// Shared Playwright harness: SwiftShader WebGL, CDN routed to node_modules, every other request blocked.
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }
export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');
const NM = path.join(HERE, 'node_modules/three');
export const FILE_URL = pathToFileURL(path.join(ROOT, 'dist/reactions-film.html')).href;

export async function launch() {
  return pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--allow-file-access-from-files'] });
}
export async function open(browser, { url = FILE_URL, viewport = { width: 1280, height: 720 }, test = true, quality = 'ULTRA', failAsset = null, touch = false, fonts = true, init, noCDN = false } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch });
  const page = await ctx.newPage();
  const log = { errors: [], warnings: [], blocked: [], requests: [] };
  page.on('console', m => { const t = m.text(); if (m.type() === 'error') log.errors.push(t); else if (m.type() === 'warning') log.warnings.push(t); if (process.env.VERBOSE) console.log('[page]', m.type(), t); });
  page.on('pageerror', e => log.errors.push('pageerror: ' + e.message));
  await page.route('**/*', async route => {
    const u = route.request().url(); log.requests.push(u);
    const m = u.match(/cdn\.jsdelivr\.net\/npm\/three@0\.160\.0\/(.*)$/);
    if (m && noCDN) return route.abort();
    if (m) { const f = path.join(NM, m[1].split('?')[0]); return fs.existsSync(f) ? route.fulfill({ path: f, contentType: 'text/javascript' }) : route.fulfill({ status: 404, body: 'nf' }); }
    if (u.startsWith('file:') || u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('http://127.0.0.1')) return route.continue();
    if (/fonts\.(googleapis|gstatic)\.com/.test(u)) return fonts ? route.continue().catch(() => route.abort()) : route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    log.blocked.push(u); return route.abort();
  });
  await page.addInitScript(({ test, quality, failAsset, init }) => {
    if (test) { window.__FILM_TEST__ = true; window.__filmInstall = api => { window.__film = api; }; }
    try { localStorage.setItem('rxf:v1:quality', JSON.stringify(quality)); localStorage.setItem('rxf:v1:qualityPicked', 'true'); } catch {}
    if (failAsset) { const iv = setInterval(() => { if (window.__RXF_ASSETS) { delete window.__RXF_ASSETS[failAsset]; clearInterval(iv); } }, 0); window.__failAsset = failAsset; }
    if (init) eval(init);
  }, { test, quality, failAsset, init: init || null });
  await page.goto(url);
  if (test) await page.waitForFunction(() => !!window.__film, null, { timeout: 240000 });
  return { page, ctx, log };
}
/** Seek to section id at base second s (or t fraction) and render n frames. */
export async function at(page, id, s, n = 2) {
  await page.evaluate(([id, s, n]) => {
    const F = window.__film; const i = F.secs.findIndex(x => x.id === id); const sec = F.secs[i];
    const t = sec.sec ? s / sec.sec.base : 0; F.seek(i, t); F.P.playing = false; F.tick(1);
    for (let k = 0; k < n; k++) F.tick(1 / 30);
  }, [id, s, n]);
}
