import { launch, open } from './harness.mjs';
const b = await launch(); const { page, log } = await open(b, { viewport: { width: 320, height: 180 }, quality: 'LOW' });
page.on('requestfailed', r => console.log('FAILED', r.url().slice(0, 120)));
await page.waitForTimeout(500); console.log(log.errors, log.requests.filter(u => u.startsWith('file:')).map(u => u.slice(-60))); await b.close();
