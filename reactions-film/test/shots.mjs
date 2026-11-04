// node shots.mjs id:s id:s ... → out/<id>_<s>.png
import { launch, open, at, HERE } from './harness.mjs';
import fs from 'node:fs'; import path from 'node:path';
const out = path.join(HERE, 'out'); fs.mkdirSync(out, { recursive: true });
const args = process.argv.slice(2);
const vp = process.env.VP === 'phone' ? { width: 390, height: 844 } : { width: 1280, height: 720 };
const b = await launch(); const { page, log } = await open(b, { viewport: vp, quality: process.env.Q || 'ULTRA' });
for (const a of args) { const [id, s] = a.split(':'); const t0 = Date.now(); await at(page, id, +s, 3); await page.screenshot({ path: path.join(out, `${process.env.VP || ''}${id}_${s}.png`), timeout: 300000 }); console.log(a, Date.now() - t0, 'ms'); }
console.log('errors:', log.errors.slice(0, 10)); console.log('blocked:', log.blocked.slice(0, 5));
await b.close();
