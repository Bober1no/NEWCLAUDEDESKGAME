import { launch, open, at, HERE } from './harness.mjs';
import path from 'node:path';
const vp = process.env.VP === 'phone' ? { width: 390, height: 844 } : { width: 1280, height: 720 };
const b = await launch(); const { page, log } = await open(b, { viewport: vp, quality: process.env.Q || 'ULTRA' });
for (const a of process.argv.slice(2)) { const [id, s] = a.split(':'); await at(page, id, +s, 3); await page.waitForTimeout(700); await page.screenshot({ path: path.join(HERE, 'out', `v2_${process.env.VP || ''}${id}_${s}.png`), timeout: 300000 }); console.log(a); }
console.log('errors', log.errors.slice(0, 5)); await b.close();
