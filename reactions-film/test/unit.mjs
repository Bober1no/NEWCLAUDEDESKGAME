// Node-only tests: chemistry accuracy, balance checker, reading time, data consistency, module graph.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as acorn from 'acorn';
import { ROOT } from './harness.mjs';

const J = p => path.join(ROOT, p);
const imp = p => import(pathToFileURL(J(p)).href);
let fails = 0, passes = 0;
const ok = (c, msg) => { if (c) passes++; else { fails++; console.log('  ✗', msg); } };

const F = await imp('js/chem/formula.js');
const S = await imp('js/scenes/script.js');
const T = await imp('js/ui/timing.js');
const B = await imp('js/ui/bank.js');
const SOL = await imp('js/chem/solubility.js');
const Q = await imp('js/ui/questions.js').catch(e => ({ err: e }));

// ---------------------------------------------------------- 1. module graph: syntax + relative imports + named exports
console.log('1. module graph');
const files = []; (function walk(d) { for (const f of fs.readdirSync(J(d))) { const p = path.join(d, f); if (fs.statSync(J(p)).isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p); } })('js');
const exportsOf = {};
for (const f of files) {
  const src = fs.readFileSync(J(f), 'utf8'); let ast;
  try { ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'module' }); } catch (e) { ok(false, `${f}: syntax ${e.message}`); continue; }
  const ex = new Set(); for (const n of ast.body) { if (n.type === 'ExportNamedDeclaration') { if (n.declaration) { if (n.declaration.id) ex.add(n.declaration.id.name); if (n.declaration.declarations) n.declaration.declarations.forEach(d => ex.add(d.id.name)); } n.specifiers.forEach(s => ex.add(s.exported.name)); } if (n.type === 'ExportDefaultDeclaration') ex.add('default'); }
  exportsOf[path.normalize(f)] = { ex, ast };
}
for (const f of files) {
  const e = exportsOf[path.normalize(f)]; if (!e) continue;
  for (const n of e.ast.body) {
    if (n.type !== 'ImportDeclaration' || !n.source.value.startsWith('.')) continue;
    const target = path.normalize(path.join(path.dirname(f), n.source.value));
    ok(fs.existsSync(J(target)), `${f}: missing import ${n.source.value}`);
    const te = exportsOf[target]; if (!te) continue;
    for (const s of n.specifiers) { if (s.type === 'ImportSpecifier') ok(te.ex.has(s.imported.name), `${f}: ${target} has no export ${s.imported.name}`); if (s.type === 'ImportDefaultSpecifier') ok(te.ex.has('default'), `${f}: ${target} has no default export`); }
  }
}
ok(files.length >= 25, 'expected a full module tree');

// ---------------------------------------------------------- 2. every equation in the source
console.log('2. equations');
const eqs = new Set(), skels = new Set();
for (const f of files) {
  const src = fs.readFileSync(J(f), 'utf8');
  for (const e of F.extractEquations(src)) if (!/[\\\[\]]/.test(e)) eqs.add(e);
  for (const m of src.matchAll(/\bsym:\s*'([^']+)'/g)) eqs.add(m[1]);
  for (const m of src.matchAll(/\beq:\s*'([^']+->[^']+)'/g)) eqs.add(m[1]);
  for (const m of src.matchAll(/\bskel:\s*'([^']+)'/g)) skels.add(m[1]);
}
for (const e of eqs) {
  let r; try { r = F.checkEquation(e); } catch (er) { ok(false, `parse ${e}: ${er.message}`); continue; }
  ok(r.atomsOk, `atoms not balanced: ${e}`); ok(r.chargeOk, `charge not balanced: ${e}`); ok(r.statesOk, `missing state symbols: ${e}`);
}
for (const e of skels) ok(!F.checkEquation(e).balanced, `skeleton should be unbalanced (and is labelled so): ${e}`);
ok(eqs.size >= 30, `expected many equations, found ${eqs.size}`);
console.log(`   ${eqs.size} equations, ${skels.size} skeletons checked`);
// formula parser edge cases
ok(JSON.stringify(F.parseFormula('Ca(OH)2').atoms) === JSON.stringify({ Ca: 1, O: 2, H: 2 }), 'Ca(OH)2');
ok(F.parseFormula('Al2(SO4)3').atoms.O === 12, 'Al2(SO4)3');
ok(F.parseFormula('SO4^2-').charge === -2 && F.parseFormula('e^-').electron, 'charges + electrons');
ok(F.parseFormula('CuSO4.5H2O').atoms.H === 10, 'hydrate');
ok(F.fmtChem('2H2O(l)').includes('<sub>2</sub>') && F.fmtSpecies('Cu^2+').includes('<sup>2+</sup>'), 'sub/sup formatting');

// ---------------------------------------------------------- 3. balance checker & bank answers
console.log('3. question checkers');
ok(F.checkCoefficients(['H2', 'O2'], ['H2O'], [2, 1, 2]).lowest, 'accepts 2,1,2');
ok(!F.checkCoefficients(['H2', 'O2'], ['H2O'], [1, 1, 1]).balanced, 'rejects unbalanced');
const nl = F.checkCoefficients(['H2', 'O2'], ['H2O'], [4, 2, 4]); ok(nl.balanced && !nl.lowest, 'rejects non-lowest ratio');
const allQ = [...B.CHECKPOINTS.flatMap(c => c.qs), ...B.EXAM];
ok(B.EXAM.length === 12, 'exam has 12 questions');
const types = new Set(allQ.map(q => q.t)); for (const t of ['mcq', 'short', 'order', 'match', 'num', 'label', 'balance', 'classify', 'predict', 'ppt', 'electron', 'critique']) ok(types.has(t), 'question type used: ' + t);
const kss = B.EXAM.filter(q => /Key Science Skills/.test(q.q)); ok(kss.length >= 3, 'exam has ≥3 Key Science Skills questions');
for (const q of allQ) {
  ok(q.hint && q.worked, 'hint + worked answer: ' + q.q.slice(0, 40));
  if (q.t === 'balance') ok(F.checkCoefficients(q.L, q.R, q.ans).lowest, 'bank balance answer: ' + q.q);
  if (q.t === 'predict') { ok(F.checkCoefficients(q.L, q.R, q.ans).lowest, 'bank predict answer: ' + q.q); ok(q.R.every(r => q.tiles.includes(r)), 'predict tiles include answer'); }
  if (q.t === 'classify') for (const it of q.items) { ok(F.checkEquation(it.eq).balanced, 'classify eq: ' + it.eq); ok(it.ok.every(set => set.every(c => q.cats.includes(c))), 'classify cats valid'); }
  if (q.t === 'ppt') for (const p of q.pairs) { const ion = f => f; void ion; }
  if (q.t === 'num') { const m = q.q.match(/\$([^$]+)\$/); if (m && /atoms in total/.test(q.q)) { const a = F.parseFormula(m[1]).atoms; ok(Object.values(a).reduce((x, y) => x + y, 0) === q.ans, 'numeric atom count ' + m[1]); } }
  if (q.t === 'mcq') ok(q.ans >= 0 && q.ans < q.opts.length, 'mcq answer index');
}
// precipitation answers agree with the solubility table
const CAT = { Ag: 'Ag^+', Na: 'Na^+', K: 'K^+', Cu: 'Cu^2+', Pb: 'Pb^2+', Ba: 'Ba^2+' };
const ANI = { NO3: 'NO3^-', Cl: 'Cl^-', OH: 'OH^-', SO4: 'SO4^2-', I: 'I^-' };
const split = f => { const cat = Object.keys(CAT).find(c => f.startsWith(c) && !/^[a-z]/.test(f.slice(c.length))); const rem = f.slice(cat.length).replace(/^\d/, '').replace(/[()]/g, ''); const an = ['SO4', 'NO3', 'OH', 'Cl', 'I'].find(a => rem.startsWith(a)); return [CAT[cat], ANI[an]]; };
for (const q of allQ.filter(q => q.t === 'ppt')) for (const p of q.pairs) {
  const [c1, a1] = split(p.a), [c2, a2] = split(p.b);
  const any = SOL.solubility(c1, a2) === 'insoluble' || SOL.solubility(c2, a1) === 'insoluble';
  ok(any === p.ans, `ppt answer ${p.a} + ${p.b}`);
}
// short-answer marking
if (!Q.err) {
  const sq = B.CHECKPOINTS[4].qs.find(q => q.t === 'short');
  ok(Q.markConcepts('Powder has more surface area so particles collide more frequently', sq.concepts).all, 'short: full answer');
  const part = Q.markConcepts('powder has a bigger surface area', sq.concepts); ok(!part.all && part.count === 1, 'short: partial answer');
  ok(Q.normalise('species process CO₂').includes('species process co2'), 'normalise protects species/process, CO₂ == CO2');
  ok(Math.abs(Q.parseNum('3/4') - 0.75) < 1e-9 && Math.abs(Q.parseNum('75%') - 0.75) < 1e-9 && Q.parseNum('17') === 17, 'numeric parsing');
} else ok(false, 'questions.js imports in node: ' + Q.err.message);

// ---------------------------------------------------------- 4. reading time
console.log('4. reading time');
const secs = [S.COLD_OPEN, ...S.REELS, S.EPILOGUE];
let total = 0;
for (const sec of secs) {
  const map = T.buildTimeMap(sec); total += map.total;
  if (sec.special) { ok(Math.abs(map.total - sec.base) < 1e-9, sec.id + ' special section keeps its exact duration'); continue; }
  for (const b of sec.beats.filter(b => T.CAPTION_KINDS.has(b.k))) {
    const s0 = b.a <= 0 ? 0 : b.a + T.FADE, s1 = b.b >= sec.base ? sec.base : b.b - T.FADE;
    const real = map.realOfS(s1) - map.realOfS(s0), need = T.readNeed(b);
    ok(real >= need - 1e-6, `${sec.id} "${(b.term || b.title || b.k)}": ${real.toFixed(2)} s < ${need.toFixed(2)} s`);
    ok(map.realOfS(b.a + T.FADE) - map.realOfS(b.a) >= 0.5 - 1e-9 || b.a <= 0, 'fade ≥ 0.5 s');
  }
  // map invertible
  for (let r = 0; r <= map.total; r += map.total / 37) ok(Math.abs(map.realOfS(map.sOfReal(r)) - r) < 1e-6, sec.id + ' time map invertible');
}
console.log(`   film runtime with reading stretch: ${(total / 60).toFixed(1)} min`);
ok(total / 60 > 9 && total / 60 < 22, 'runtime is a 10–15ish minute film');

// ---------------------------------------------------------- 5. data consistency (captions quote the data)
console.log('5. data');
const r9 = S.REELS.find(r => r.id === 'r9'); const arg = r9.beats.find(b => b.term === 'Evidence-based argument').text;
ok(arg.includes(S.INV.powder[1].mean.toFixed(2) + ' g') && arg.includes(S.INV.chips[1].mean.toFixed(2) + ' g'), `r9 caption numbers match data (powder ${S.INV.powder[1].mean}, chips ${S.INV.chips[1].mean})`);
ok(S.INV.chips[1].outlier && S.INV.chips[1].trials[1] < S.INV.chips[1].lo, 'outlier is excluded from the range');
ok(S.PHYS.gasVol(10, 60) > S.PHYS.gasVol(28, 60) && Math.abs(S.PHYS.gasVol(10, 1e5) - S.PHYS.gasVol(28, 1e5)) < 1e-9, 'faster curve, same plateau');
ok(S.PHYS.rustCoverage('salt', 7) > S.PHYS.rustCoverage('tap', 7) && S.PHYS.rustCoverage('dry', 7) === 0 && S.PHYS.rustCoverage('oil', 7) === 0, 'rust ordering salt > tap > dry = oil = 0');
ok(Math.abs(S.PHYS.titrationPH(14.5) - 7) < 0.05, 'titration reaches pH 7');
ok(S.PHYS.sealedMass(38) === S.PHYS.sealedMass(44) && S.PHYS.openMass(52.5) < S.PHYS.openMass(44), 'sealed constant, open falls');
ok(Math.abs((S.PHYS.openMass(44) - S.PHYS.openMass(1e9)) - 0.44) < 1e-6, 'open beaker loses exactly the CO2 from 1.00 g CaCO3 (0.44 g)');
ok(S.PHYS.limeMilk(24) > 0.99 && S.PHYS.znoHot(24.5) < 0.01 && S.PHYS.znoHot(15) > 0.99, 'limewater milky; ZnO yellow hot, white cold');
const ui = (await imp('js/scenes/common.js')).UI_COL; ok(ui[6].toLowerCase() === '#4fb748', 'pH 7 is green');
// display rounding sanity: no huge raw numbers in HUD text sources
ok(!/toFixed\((?:[4-9])\)/.test(fs.readFileSync(J('js/ui/hud.js'), 'utf8')), 'HUD rounds to sensible significant figures');

console.log(`\nunit: ${passes} passed, ${fails} failed`);
process.exitCode = fails ? 1 : 0;
