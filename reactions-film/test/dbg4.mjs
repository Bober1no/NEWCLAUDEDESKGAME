import { launch, open, at } from './harness.mjs';
const b = await launch(); const { page } = await open(b, { viewport: { width: 1280, height: 720 }, quality: 'LOW' });
await at(page, 'r5', 2, 3);
console.log(await page.evaluate(() => { const h = document.querySelector('#captions .beat.title h1'); const r = h.getBoundingClientRect(); return { sw: h.scrollWidth, ow: h.offsetWidth, rw: r.width, tf: h.style.transform, k: h.dataset.k, avail: document.getElementById('captions').clientWidth, txt: h.textContent }; }));
await b.close();
