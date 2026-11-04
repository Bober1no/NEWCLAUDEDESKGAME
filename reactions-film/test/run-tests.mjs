// Browser test suite against the SHIPPED single file (dist/reactions-film.html, opened via file://),
// SwiftShader WebGL, CDN routed to node_modules, every other network request blocked.
//   node run-tests.mjs [boot|assets|nan|determinism|choreo|play|ui|perf|multi]
import { launch, open, at, ROOT } from './harness.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const only = process.argv.slice(2);
const want = k => !only.length || only.includes(k);
let fails = 0, passes = 0;
const ok = (c, msg, extra) => { if (c) { passes++; } else { fails++; console.log('  ✗', msg, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); } };
const b = await launch();
const small = { width: 480, height: 270 };

// ------------------------------------------------------------------ boot + network isolation
if (want('boot')) {
  console.log('boot');
  const { page, log } = await open(b, { viewport: small, quality: 'LOW', fonts: true });
  const r = await page.evaluate(() => { const st = window.__film.stage(); return st ? { env: st.probes.env(), models: st.probes.models(), fb: st.probes.framebuffers(), tier: st.probes.tier() } : null; });
  ok(!!r, 'stage booted');
  ok(r && r.env === 'hdri', 'HDRI environment loaded from the file', r && r.env);
  ok(r && Object.values(r.models).every(v => v === 'model') && Object.keys(r.models).length === 4, 'all four downloaded models loaded', r && r.models);
  ok(log.blocked.length === 0, 'no blocked network requests (all assets embedded)', log.blocked.slice(0, 3));
  ok(log.requests.every(u => /^(file:|data:|blob:)/.test(u) || /cdn\.jsdelivr\.net\/npm\/three@0\.160\.0\//.test(u) || /fonts\.(googleapis|gstatic)\.com/.test(u)), 'only file/data + jsDelivr three requests', log.requests.filter(u => !/^(file:|data:|blob:)/.test(u) && !/jsdelivr/.test(u)).slice(0, 3));
  await page.evaluate(() => { const F = window.__film; F.setQuality('ULTRA'); F.tick(1); });
  const fb = await page.evaluate(() => window.__film.stage().probes.framebuffers());
  ok(fb.length >= 3 && fb.every(x => x.ok), 'all composer / glass targets framebuffer-complete', fb);
  ok(log.errors.length === 0, 'no console errors (shader compile, GL_INVALID_*, framebuffer)', log.errors.slice(0, 3));
  ok(!log.warnings.some(w => /GL_INVALID|framebuffer|shader/i.test(w)), 'no GL warnings', log.warnings.filter(w => /GL_|shader/i.test(w)).slice(0, 3));
  await page.context().close();
}

// ------------------------------------------------------------------ single-asset failure → procedural fallback, still renders
if (want('assets')) {
  console.log('assets');
  for (const fa of ['assets/models/bunsen.glb', 'assets/hdri/lab.exr']) {
    const { page, log } = await open(b, { viewport: small, quality: 'LOW', failAsset: fa, fonts: false, init: `window.__RXF_FAIL = ${JSON.stringify(fa)}` });
    await at(page, 'r7', 50, 2);
    const r = await page.evaluate(() => { const st = window.__film.stage(); return { models: st.probes.models(), env: st.probes.env(), s: st.probes.sample() }; });
    if (fa.includes('bunsen')) ok(r.models.bunsen === 'procedural', 'missing Bunsen model → procedural build', r.models);
    else ok(r.env === 'room', 'missing HDRI → RoomEnvironment', r.env);
    ok(r.s.nan === 0 && r.s.mean > 0.002, `still renders with ${fa} missing`, r.s);
    ok(log.errors.filter(e => !/404|Failed to load|ERR_FILE|net::|Fetch API cannot load/.test(e)).length === 0, 'no unexpected errors with a missing asset', log.errors.slice(0, 2));
    await page.context().close();
  }
}

// ------------------------------------------------------------------ NaN / black-frame checks, env comparison
if (want('nan')) {
  console.log('nan');
  const { page, log } = await open(b, { viewport: small, quality: 'HIGH', fonts: false });
  const ids = await page.evaluate(() => window.__film.secs.filter(s => s.kind === 'ch').map(s => [s.id, s.sec.base]));
  for (const [id, base] of ids) for (const t of [0.1, 0.5, 0.9]) {
    await at(page, id, t * base, 1);
    const r = await page.evaluate(() => window.__film.stage().probes.sample());
    ok(r.nan === 0, `${id}@${t}: zero NaN/Inf`, r);
    ok(r.mean > 0.004 && r.mean < 4, `${id}@${t}: mean luminance sane`, r);
  }
  await at(page, 'r5', 30, 1);
  const lit = await page.evaluate(() => window.__film.stage().probes.sample(false)), dark = await page.evaluate(() => window.__film.stage().probes.sample(true));
  ok(lit.mean > dark.mean * 1.02 && lit.mean > 0.01, 'environment lighting brightens the scene (no "everything lit is black")', { lit, dark });
  ok(log.errors.length === 0, 'no errors while sampling', log.errors.slice(0, 2));
  await page.context().close();
}

// ------------------------------------------------------------------ determinism: 200 steps forward and back per scene, no NaN anywhere
if (want('determinism')) {
  console.log('determinism');
  const { page, log } = await open(b, { viewport: small, quality: 'LOW', fonts: false });
  const res = await page.evaluate(() => {
    const F = window.__film, st = F.stage(), out = [];
    for (const s of F.secs.filter(x => x.kind === 'ch')) {
      let err = null, bad = 0, cam = true; const base = s.sec.base;
      try {
        for (let k = 0; k <= 200; k++) { st.frame(s.id, base * k / 200, k * 0.05, 1 / 30, { render: false }); if (k % 25 === 0) { const t = st.probes.transforms(); bad += t.bad; cam = cam && t.cam; } }
        for (let k = 200; k >= 0; k--) { st.frame(s.id, base * k / 200, k * 0.05, 1 / 30, { render: false }); if (k % 25 === 0) { const t = st.probes.transforms(); bad += t.bad; cam = cam && t.cam; } }
        // seek exactness: same s → same camera
        const a = st.frame(s.id, base * 0.37, 1, 1, { render: false }).cam.p.join(); st.frame(s.id, base * 0.9, 1, 1, { render: false }); const c = st.frame(s.id, base * 0.37, 1, 1, { render: false }).cam.p.join();
        if (a !== c) err = 'camera not a pure function of t';
      } catch (e) { err = e.message; }
      out.push({ id: s.id, err, bad, cam });
    }
    return out;
  });
  for (const r of res) { ok(!r.err, `${r.id}: deterministic sweep without exceptions`, r.err); ok(r.bad === 0, `${r.id}: no NaN in transforms / instances / particles`, r.bad); ok(r.cam, `${r.id}: finite camera`); }
  ok(log.errors.length === 0, 'no errors during sweeps', log.errors.slice(0, 2));
  await page.context().close();
}

// ------------------------------------------------------------------ choreography end states
if (want('choreo')) {
  console.log('choreo');
  const { page } = await open(b, { viewport: small, quality: 'LOW', fonts: false });
  const r = await page.evaluate(() => {
    const st = window.__film.stage(); const f = (id, s) => { st.frame(id, s, 1, 1, { render: false }); return st.probes.state(); };
    return { ppt: f('r6', 15.9), ppt0: f('r6', 7.5), rust: f('r7', 43), rates: f('r8', 66), neut: f('r5', 15), epi: f('epi', 32), epiMid: f('epi', 12) };
  });
  ok(r.ppt.settled > 0.97 && r.ppt.sediment > 0.9 && r.ppt.suspended < 0.05, 'precipitate has settled to the bottom by the end', r.ppt);
  ok(r.ppt0.suspended > 0.3, 'precipitate cloud blooms first', r.ppt0);
  ok(r.rust.salt > r.rust.tap && r.rust.tap > 0 && r.rust.dry === 0 && r.rust.oil === 0, 'salt-water nail rusts more than tap; dry and oil none', r.rust);
  ok(r.rates.fastFirst && r.rates.plateau, 'powder curve reaches the plateau first; same final volume', r.rates);
  ok(Math.abs(r.neut.phEnd - 7) < 0.05 && r.neut.neutral === '4fb748', 'indicator at neutral matches pH 7 green', r.neut);
  const order = Object.entries(r.epi.T).sort((a, b2) => a[1] - b2[1]).map(x => x[0]);
  ok(order.every(k => r.epi.fired.includes(k)), 'epilogue: every stage fires', r.epi.fired);
  ok(r.epiMid.fired.every((k, i) => order[i] === k), 'epilogue: stages fire in order', r.epiMid.fired);
  await page.context().close();
}

// ------------------------------------------------------------------ full playthrough at 100×
if (want('play')) {
  console.log('play');
  const { page, log } = await open(b, { viewport: { width: 320, height: 180 }, quality: 'LOW', fonts: false });
  const r = await page.evaluate(async () => {
    const F = window.__film; const out = { order: [], cps: [], epiReal: null, eventsAtEnd: 0, totalEvents: 0, held: false };
    F.secs.forEach(s => { if (s.kind === 'ch' && s.sec.events) out.totalEvents += s.sec.events.length; });
    F.P.rate = 100; F.P.playing = true;
    let guard = 0, lastI = -1, epiStart = null, epiT = 0;
    while (guard++ < 20000) {
      const s = F.secs[F.P.i];
      if (F.P.i !== lastI) { out.order.push(s.id); lastI = F.P.i; }
      if (s.kind === 'cp') {
        const ov = document.getElementById('overlay'); out.cps.push({ id: s.id, visible: !ov.hidden, frozen: document.getElementById('film').classList.contains('frozen'), qs: ov.querySelectorAll('.q').length });
        ov.querySelector('[data-role=continue]').click(); continue;
      }
      if (s.kind === 'flow') break;
      if (s.id === 'epi') { if (epiStart == null) { epiStart = 0; } epiT += 0.05 * 100; }
      F.tick(0.05);
    }
    out.epiReal = F.secs.find(s => s.id === 'epi').dur;
    out.eventsAtEnd = F.events();
    out.held = F.P.held && F.secs[F.P.i].kind === 'flow' && F.overlay.mode === 'exam';
    // seeking backwards across a flash point fires nothing
    const before = F.events(); const i2 = F.secs.findIndex(s => s.id === 'r2');
    F.seek(i2, 16 / 45); F.P.playing = true; F.P.rate = 1; for (let k = 0; k < 5; k++) F.tick(0.05);
    F.seek(i2, 14 / 45); for (let k = 0; k < 5; k++) F.tick(0.05);
    out.afterSeekBack = F.events() - before;
    // playing forward across it again fires once
    for (let k = 0; k < 400; k++) F.tick(0.05);
    out.afterReplay = F.events() - before;
    return out;
  });
  const reels = ['cold', 'r1', 'r2', 'cp1', 'r3', 'r4', 'cp2', 'r5', 'r6', 'cp3', 'r7', 'cp4', 'r8', 'r9', 'cp5', 'epi', 'exam'];
  ok(JSON.stringify(r.order) === JSON.stringify(reels), 'every section plays in order', r.order);
  ok(r.cps.length === 5 && r.cps.every(c => c.visible && c.frozen && c.qs >= 4), 'every freeze frame holds with its overlay visible', r.cps);
  ok(Math.abs(r.epiReal - 32) < 1e-6, 'epilogue lasts exactly 32 s', r.epiReal);
  ok(r.eventsAtEnd === r.totalEvents, 'each one-shot event fired exactly once', { fired: r.eventsAtEnd, total: r.totalEvents });
  ok(r.held, 'the film ends holding on the exam');
  ok(r.afterSeekBack === 0, 'seeking backwards across a flash fires nothing', r.afterSeekBack);
  ok(r.afterReplay === 1, 'playing forward across it again fires it once', r.afterReplay);
  ok(log.errors.length === 0, 'no errors in the playthrough', log.errors.slice(0, 3));
  await page.context().close();
}

// ------------------------------------------------------------------ UI: real taps at phone size
if (want('ui')) {
  console.log('ui');
  const { page, log } = await open(b, { viewport: { width: 390, height: 844 }, quality: 'LOW', touch: true });
  await page.evaluate(() => document.fonts && document.fonts.ready);
  const tapIn = async (q, sel, n = 0) => { const loc = q.locator(sel).nth(n); await loc.scrollIntoViewIfNeeded(); await loc.tap(); };
  // controls + keys first (no overlay)
  await page.evaluate(() => { const F = window.__film; F.seek(1, 0.2); F.P.playing = true; F.tick(1); });
  const pl0 = await page.evaluate(() => window.__film.P.playing);
  await page.keyboard.press('Space'); const pl1 = await page.evaluate(() => window.__film.P.playing);
  await page.keyboard.press('k'); const pl2 = await page.evaluate(() => window.__film.P.playing);
  ok(pl0 !== pl1 && pl1 !== pl2, 'Space and K toggle play');
  const t0 = await page.evaluate(() => window.__film.P.t); await page.keyboard.press('ArrowRight'); const t1 = await page.evaluate(() => window.__film.P.t);
  await page.keyboard.press('ArrowLeft'); const t2 = await page.evaluate(() => window.__film.P.t);
  ok(t1 > t0 && Math.abs(t2 - t0) < 0.02, 'arrows seek ±5 s', [t0, t1, t2]);
  await page.keyboard.press('n'); ok(await page.evaluate(() => window.__film.secs[window.__film.P.i].id) === 'r2', 'N jumps to the next reel');
  await page.locator('#speed').tap(); ok(await page.evaluate(() => window.__film.P.rate) === 1.5, 'speed 1× → 1.5×');
  for (let k = 0; k < 3; k++) await page.locator('#speed').tap(); ok(await page.evaluate(() => window.__film.P.rate) === 1, 'speed cycles back to 1×');
  const q0 = await page.locator('#quality').textContent(); await page.locator('#quality').tap(); const q1 = await page.locator('#quality').textContent();
  ok(q0 !== q1 && await page.evaluate(() => JSON.parse(localStorage.getItem('rxf:v1:quality'))) === q1, 'quality toggles and persists', [q0, q1]);
  await page.locator('#motion').tap(); ok(await page.evaluate(() => JSON.parse(localStorage.getItem('rxf:v1:motion'))) === false, 'motion toggle stored');
  await page.locator('#motion').tap();
  await page.locator('.tl button.tseg').nth(4).tap(); ok(await page.evaluate(() => window.__film.secs[window.__film.P.i].id) === 'r4', 'timeline segment click seeks to that reel');
  await page.locator('.tl button.tcp').first().tap(); ok(await page.evaluate(() => window.__film.secs[window.__film.P.i].id === 'cp1' && !document.getElementById('overlay').hidden), 'tick opens its freeze frame');
  // ---- freeze frame 1: num, balance, mcq wrong, match L→R + undo, short partial, predict
  const qs = page.locator('#overlay .q');
  await tapIn(qs.nth(0), 'input'); await qs.nth(0).locator('input').fill('5'); await tapIn(qs.nth(0), '.row2 > button', 0);
  ok(await qs.nth(0).evaluate(e => e.classList.contains('right')), 'numeric right');
  { const q = qs.nth(1); const vals = await q.locator('.cv').allTextContents(); // set exactly 4,3,2 with real taps
    const target = [4, 3, 2]; for (let i = 0; i < 3; i++) { let v = +(await q.locator('.cv').nth(i).textContent()); while (v < target[i]) { await q.locator('.stp').nth(i).locator('button').nth(0).tap(); v++; } while (v > target[i]) { await q.locator('.stp').nth(i).locator('button').nth(1).tap(); v--; } }
    ok((await q.locator('.tally span.ok').count()) === 2, 'balance steppers drive the live tally green', vals);
    await tapIn(q, '.row2 > button', 0); ok(await q.evaluate(e => e.classList.contains('right')), 'balance: lowest-ratio answer accepted'); }
  { const q = qs.nth(2); await tapIn(q, '.opt', 0); ok(await q.evaluate(e => e.classList.contains('wrong')), 'mcq wrong turns red'); await tapIn(q, '.opt', 1); ok(await q.evaluate(e => e.classList.contains('right')), 'mcq right after a retry (first try already scored)'); }
  { const q = qs.nth(3); const L = q.locator('.col').nth(0).locator('.mitem'), R = q.locator('.col').nth(1).locator('.mitem');
    const rights = await R.evaluateAll(els => els.map(e => +e.dataset.i));
    await L.nth(0).tap(); ok(await L.nth(0).evaluate(e => e.classList.contains('sel')), 'match: selected item glows');
    ok(/partner/.test(await q.locator('.qi').textContent()), 'match: instruction says what to tap next');
    await R.nth(rights.indexOf(0)).tap(); ok(await L.nth(0).evaluate(e => e.classList.contains('paired') && !e.classList.contains('sel')), 'match: pair coloured, differs from selection');
    await L.nth(0).tap(); ok(await L.nth(0).evaluate(e => !e.classList.contains('paired')), 'match: tapping a pair undoes it');
    // right-column first (meaning → term)
    for (let i = 0; i < 4; i++) { await R.nth(rights.indexOf(i)).tap(); await L.nth(i).tap(); }
    const cols = await L.evaluateAll(els => els.map(e => getComputedStyle(e).getPropertyValue('--pc')));
    ok(new Set(cols).size === 4, 'match: each pair gets its own colour', cols);
    await tapIn(q, '.row2 > button', 0); ok(await q.evaluate(e => e.classList.contains('right')), 'match: both tap orders work'); }
  { const q = qs.nth(4); await q.locator('textarea').fill('The atoms are conserved.'); await tapIn(q, '.row2 > button', 0); ok(await q.locator('.fb').evaluate(e => e.classList.contains('part')), 'short answer: partial says an idea is missing');
    await q.locator('textarea').fill('Atoms are conserved and the flask is sealed so no gas escapes.'); await tapIn(q, '.row2 > button', 0); ok(await q.evaluate(e => e.classList.contains('right')), 'short answer: full answer marked right'); }
  { const q = qs.nth(5); await tapIn(q, '.tile', 0); await tapIn(q, 'button.btn.ghost', 0); for (let k = 0; k < 1; k++) { await q.locator('.stp').nth(0).locator('button').nth(0).tap(); await q.locator('.stp').nth(2).locator('button').nth(0).tap(); }
    await tapIn(q, '.row2 > button', 0); ok(await q.evaluate(e => e.classList.contains('right')), 'predict the products: pick + balance'); }
  // badge centring (glyph box centre within 0.5 px of badge centre)
  const cen = await page.evaluate(() => {
    const out = []; const els = [...document.querySelectorAll('.qn, .chip, .logo, .qtype, .beyond, .stp .cv, .stp button, .el')].filter(e => e.offsetParent && e.textContent.trim());
    for (const e of els.slice(0, 60)) { const r = e.getBoundingClientRect(); const rg = document.createRange(); const tn = [...e.childNodes].find(n => n.nodeType === 3 && n.textContent.trim()); if (!tn) continue; rg.selectNodeContents(tn); const g = rg.getBoundingClientRect(); out.push({ cls: e.className, dx: Math.abs((g.left + g.right) / 2 - (r.left + r.right) / 2), dy: Math.abs((g.top + g.bottom) / 2 - (r.top + r.bottom) / 2) }); }
    return out;
  });
  const off = cen.filter(c => c.dx > 0.5 || c.dy > 0.5);
  ok(cen.length > 10 && off.length === 0, `badge glyphs centred within 0.5 px (${cen.length} measured)`, off.slice(0, 4));
  await page.locator('[data-role=continue]').tap(); ok(await page.evaluate(() => window.__film.secs[window.__film.P.i].id) === 'r3', 'Continue the film resumes');
  // ---- exam: every remaining type, first-try scoring
  await page.evaluate(() => { const F = window.__film; F.seek(F.secs.length - 1, 0); });
  const E = page.locator('#overlay .q');
  const set = async (q, target) => { for (let i = 0; i < target.length; i++) { let v = +(await q.locator('.cv').nth(i).textContent()); while (v < target[i]) { await q.locator('.stp').nth(i).locator('button').nth(0).tap(); v++; } } };
  await set(E.nth(0), [1, 2, 1, 2]); await tapIn(E.nth(0), '.row2 > button', 0);
  { const q = E.nth(1); await tapIn(q, '.row2 > button', 0); // wrong first (nothing selected)
    const items = q.locator('.citem'); const want2 = [['synthesis', 'redox'], ['decomposition'], ['single displacement', 'redox'], ['neutralisation'], ['precipitation']];
    for (let i = 0; i < 5; i++) for (const c of want2[i]) await items.nth(i).locator('.cbtn', { hasText: new RegExp('^' + c + '$') }).tap();
    await tapIn(q, '.row2 > button', 0); ok(await q.evaluate(e => e.classList.contains('right')), 'classify with multi-category sets'); }
  { const q = E.nth(2); for (const f of ['NaCl', 'H2O', 'CO2']) await q.locator(`.tile[data-f="${f}"]`).tap(); await tapIn(q, 'button.btn.ghost', 0);
    const st = q.locator('.stp'); await st.nth(1).locator('button').nth(0).tap(); await st.nth(2).locator('button').nth(0).tap(); await tapIn(q, '.row2 > button', 0); ok(await q.evaluate(e => e.classList.contains('right')), 'exam predict'); }
  { const q = E.nth(3); for (let i = 0; i < 3; i++) await q.locator('.pptrow').nth(i).locator('.ybtn').nth(i < 2 ? 0 : 1).tap(); await tapIn(q, '.row2 > button', 0); ok(await q.evaluate(e => e.classList.contains('right')), 'will it precipitate?'); }
  { const q = E.nth(4); await q.scrollIntoViewIfNeeded(); const to = await q.locator('.ebox').nth(1).boundingBox();
    for (let k = 0; k < 2; k++) { const e = q.locator('.ebox').nth(0).locator('.el').first(); const bb = await e.boundingBox(); await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await page.mouse.down(); await page.mouse.move(to.x + to.width / 2, to.y + 30, { steps: 8 }); await page.mouse.up(); }
    ok((await q.locator('.ebox').nth(1).locator('.el').count()) === 2, 'electron drag moves electrons');
    await q.locator('.ebox').nth(0).locator('.cbtn', { hasText: 'oxidation' }).tap(); await q.locator('.ebox').nth(1).locator('.cbtn', { hasText: 'reduction' }).tap();
    await tapIn(q, '.row2 > button', 0); ok(await q.evaluate(e => e.classList.contains('right')), 'electron transfer labelled'); }
  { const q = E.nth(5); await q.locator('input').fill('16'); await tapIn(q, '.row2 > button', 0); ok(await q.evaluate(e => e.classList.contains('wrong')), 'numeric wrong'); await q.locator('input').fill('17'); await tapIn(q, '.row2 > button', 0); }
  { const q = E.nth(6); const L = q.locator('.col').nth(0).locator('.mitem'), R = q.locator('.col').nth(1).locator('.mitem'); const rights = await R.evaluateAll(els => els.map(e => +e.dataset.i));
    await L.nth(0).tap(); await R.nth(rights.indexOf(1)).tap(); await L.nth(1).tap(); await R.nth(rights.indexOf(0)).tap(); await L.nth(2).tap(); await R.nth(rights.indexOf(2)).tap(); await L.nth(3).tap(); await R.nth(rights.indexOf(3)).tap();
    await tapIn(q, '.row2 > button', 0); ok((await q.locator('.mitem.bad').count()) === 4, 'wrong pairs turn red after checking');
    for (const i of [0, 1]) await L.nth(i).tap(); await L.nth(0).tap(); await R.nth(rights.indexOf(0)).tap(); await L.nth(1).tap(); await R.nth(rights.indexOf(1)).tap(); await tapIn(q, '.row2 > button', 0); }
  { const q = E.nth(7); const rows = q.locator('.cmeth li'); const pickT = async (i, t) => rows.nth(i).locator('.cbtn', { hasText: t }).tap();
    await pickT(0, 'no problem'); await pickT(1, 'limitation'); await pickT(2, 'no problem'); await pickT(3, 'personal mistake');
    await q.locator('textarea').fill('Use a water bath so the temperature stays constant, keeping it a controlled variable.'); await tapIn(q, '.row2 > button', 0); ok(await q.evaluate(e => e.classList.contains('right')), 'critique the method: error types + justified improvement'); }
  { const q = E.nth(8); await q.locator('textarea').fill('it is the same'); await tapIn(q, '.row2 > button', 0); await q.locator('textarea').fill('It shifts every reading by the same amount in the same direction, so averaging keeps the bias.'); await tapIn(q, '.row2 > button', 0); }
  { const q = E.nth(9); await tapIn(q, 'button.btn.ghost', 1); ok(await q.evaluate(e => e.classList.contains('wrong')) && !(await q.locator('.worked').evaluate(e => e.hidden)), 'reveal first counts as a miss and shows the worked answer'); }
  { const q = E.nth(10); const svg = q.locator('svg.svgq'); await svg.scrollIntoViewIfNeeded(); const bb = await svg.boundingBox(); await page.touchscreen.tap(bb.x + bb.width * 148 / 300, bb.y + bb.height * 71 / 170); ok(await q.evaluate(e => e.classList.contains('right')), 'label the diagram (SVG hit)'); }
  { const q = E.nth(11); const items = ['powder, 2.0 M acid, 50 °C', 'chips, 2.0 M acid, 50 °C', 'chips, 2.0 M acid, 20 °C', 'chips, 0.5 M acid, 20 °C'];
    for (const t of items) await q.locator('.ocard', { hasText: t }).tap(); await tapIn(q, '.row2 > button', 0); ok(await q.evaluate(e => e.classList.contains('right')), 'ordering by tapping'); }
  const score = await page.locator('.scorebar .sc').textContent();
  ok(/^7 \/ 12/.test(score), 'first-try score counts only first attempts', score);
  await page.waitForTimeout(1800);
  ok(await page.evaluate(() => window.__film.overlay.mode === 'credits' && /Assets/.test(document.querySelector('.roll').textContent) && /Dreamsoft/.test(document.querySelector('.roll').textContent)), 'finishing every question rolls the credits (with Assets)');
  ok(await page.evaluate(() => Object.keys(localStorage).some(k => k.startsWith('rxf:v1:score:exam:'))), 'scores persist under a unique prefix');
  await page.locator('.cbar .btn').first().tap(); ok(await page.evaluate(() => window.__film.P.i === 0 && document.getElementById('overlay').hidden), 'Watch it again restarts');
  ok(log.errors.length === 0, 'no errors during UI tests', log.errors.slice(0, 3));
  await page.screenshot({ path: path.join(ROOT, 'test/out/phone_after_ui.png') });
  await page.context().close();
}

// ------------------------------------------------------------------ fallback: three.js CDN unreachable → captions + questions over a gradient
if (want('fallback')) {
  console.log('fallback');
  const { page } = await open(b, { viewport: small, quality: 'LOW', fonts: false, noCDN: true });
  const r = await page.evaluate(() => { const F = window.__film; F.seek(1, 0.1); F.P.playing = true; for (let k = 0; k < 20; k++) F.tick(0.1); return { stage: !!F.stage(), notice: !document.getElementById('notice').hidden && document.getElementById('notice').textContent, bg: !document.getElementById('fallbackBg').hidden, caps: [...document.querySelectorAll('#captions .beat')].some(e => +getComputedStyle(e).opacity > 0.5), t: F.P.t }; });
  ok(!r.stage && !!r.notice && r.bg, 'no 3D → one-line notice over a dark gradient', r);
  ok(r.caps && r.t > 0.1, 'captions keep playing in fallback mode', r);
  await page.evaluate(() => { const F = window.__film; F.seek(F.secs.findIndex(s => s.kind === 'cp'), 0); });
  ok(await page.evaluate(() => document.querySelectorAll('#overlay .q').length >= 4), 'freeze-frame questions still work in fallback mode');
  await page.context().close();
}

// ------------------------------------------------------------------ performance sanity
if (want('perf')) {
  console.log('perf');
  const { page } = await open(b, { viewport: { width: 640, height: 360 }, quality: 'ULTRA', fonts: false });
  const ids = await page.evaluate(() => window.__film.secs.filter(s => s.kind === 'ch').map(s => [s.id, s.sec.base]));
  for (const [id, base] of ids) {
    await at(page, id, base * 0.5, 1);
    const i = await page.evaluate(() => window.__film.stage().probes.info());
    console.log(`   ${id.padEnd(5)} calls ${String(i.calls).padStart(4)}  tris ${String(i.triangles).padStart(8)}  textures ${i.textures}  geometries ${i.geometries}`);
    ok(i.calls < 900, `${id}: draw calls reasonable`, i.calls);
  }
  await page.context().close();
}

// ------------------------------------------------------------------ multi-file source tree served statically (dev layout)
if (want('multi')) {
  console.log('multi');
  const srv = http.createServer((q, res) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); } const ext = path.extname(f); res.writeHead(200, { 'content-type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }[ext] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); }).listen(8131);
  const { page, log } = await open(b, { url: 'http://127.0.0.1:8131/index.html', viewport: small, quality: 'LOW', fonts: false });
  const r = await page.evaluate(() => { const st = window.__film.stage(); return st && { models: st.probes.models(), env: st.probes.env() }; });
  ok(r && r.env === 'hdri' && Object.values(r.models).every(v => v === 'model'), 'multi-file layout boots and loads assets by relative path', r);
  ok(log.errors.length === 0, 'multi-file: no errors', log.errors.slice(0, 2));
  await page.context().close(); srv.close();
}

await b.close();
console.log(`\nbrowser: ${passes} passed, ${fails} failed`);
process.exitCode = fails ? 1 : 0;
