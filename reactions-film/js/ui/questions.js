// Question renderer: all 12 types. First attempt is what counts; revealing the worked answer first = miss.
// DOM is built once per question and updated in place (classes toggled), so taps are never dropped.
import { fmtText, fmtChem, fmtSpecies, checkCoefficients, parseFormula } from '../chem/formula.js';
import { FEEDBACK } from './bank.js';
import { energySVG } from './hud.js';
import { solubility, RULES } from '../chem/solubility.js';
import { UI_COL } from '../scenes/common.js';

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const pick = a => a[Math.floor(Math.random() * a.length)];
const shuffle = (a, seed = 7) => { const r = a.slice(); let s = seed; for (let i = r.length - 1; i > 0; i--) { s = (s * 9301 + 49297) % 233280; const j = Math.floor(s / 233280 * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; };
const TYPE_NAME = { mcq: 'Multiple choice', short: 'Short answer', order: 'Put in order', match: 'Matching', num: 'Numeric', label: 'Label the diagram', balance: 'Balance the equation', classify: 'Classify the reaction', predict: 'Predict the products', ppt: 'Will it precipitate?', electron: 'Electron transfer', critique: 'Critique the method' };
const PAIR_COLS = ['#FFE14D', '#5EE7FF', '#A98BFF', '#FFB23F', '#33D17A', '#FF8FA0'];

// ------------------------------------------------------------ text marking
const PROTECT = new Set(['species', 'process', 'gas', 'mass', 'class', 'this', 'has', 'was', 'is', 'its', 'as', 'us', 'less', 'loss', 'across', 'plus', 'bias', 'analysis', 'hypothesis', 'thesis', 'always', 'surplus', 'gauss', 'glass', 'pass', 'access', 'success', 'stress', 'press', 'excess', 'dioxides']);
export function normalise(t) {
  t = String(t).toLowerCase().replace(/[₀-₉]/g, c => '0123456789'['₀₁₂₃₄₅₆₇₈₉'.indexOf(c)]).replace(/[⁺]/g, '+').replace(/[⁻−]/g, '-').replace(/[’‘]/g, "'");
  t = t.replace(/[^a-z0-9+\-'%./ ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const stripped = t.split(' ').map(w => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !PROTECT.has(w)) ? w.slice(0, -1) : w).join(' ');
  return t + ' | ' + stripped;
}
export function markConcepts(text, concepts) {
  const n = normalise(text);
  const hit = concepts.map(c => c.any.some(src => new RegExp(src, 'i').test(n)));
  return { hit, all: hit.every(Boolean), count: hit.filter(Boolean).length };
}
export function parseNum(s) {
  s = String(s).trim().replace(/\s+/g, '').replace(',', '.');
  let m;
  if ((m = s.match(/^(-?\d+(?:\.\d+)?)%$/))) return +m[1] / 100;
  if ((m = s.match(/^(-?\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/))) return +m[2] ? +m[1] / +m[2] : NaN;
  if (/^-?\d*\.?\d+(e-?\d+)?$/i.test(s)) return +s;
  return NaN;
}

// ------------------------------------------------------------ renderer
export function renderQuestion(q, n, { onScore, store, key, confetti }) {
  const root = el('div', 'q'); root.dataset.type = q.t;
  const head = el('div', 'qh'); head.append(el('span', 'qn', String(n)));
  const ht = el('div'); ht.append(el('div', 'qtype', TYPE_NAME[q.t]), el('div', 'qt', fmtText(q.q))); head.append(ht); root.append(head);
  const body = el('div', 'qb'); root.append(body);
  const btns = el('div', 'row2'); const fb = el('div', 'fb'); const hint = el('div', 'hint'); hint.hidden = true; const worked = el('div', 'worked'); worked.hidden = true;
  const bCheck = el('button', 'btn', 'Check'); const bHint = el('button', 'btn ghost', 'Hint'); const bShow = el('button', 'btn ghost', 'Show worked answer');
  btns.append(bCheck, bHint, bShow); root.append(btns, fb, hint, worked);
  hint.innerHTML = fmtText(q.hint || ''); worked.innerHTML = fmtText(q.worked || '');
  const S = { attempted: false, done: false, revealed: false };
  const prev = store.get('score:' + key, null);
  if (prev) { S.attempted = true; root.classList.add(prev.ok ? 'right' : 'wrong'); }
  function result(ok, partial) {
    if (!S.attempted) { S.attempted = true; store.set('score:' + key, { ok }); onScore && onScore(ok); }
    root.classList.remove('right', 'wrong', 'shake');
    if (ok) { root.classList.add('right'); fb.className = 'fb right'; fb.textContent = pick(FEEDBACK.right); S.done = true; confetti && confetti(root); root.dispatchEvent(new CustomEvent('qdone', { bubbles: true })); }
    else { void root.offsetWidth; root.classList.add('wrong', 'shake'); fb.className = 'fb ' + (partial ? 'part' : 'wrong'); fb.textContent = partial || pick(FEEDBACK.wrong); }
  }
  bHint.addEventListener('click', () => { hint.hidden = !hint.hidden; });
  bShow.addEventListener('click', () => { if (!S.attempted) { S.attempted = true; store.set('score:' + key, { ok: false, revealed: true }); onScore && onScore(false); root.classList.add('wrong'); } worked.hidden = false; S.done = true; S.revealed = true; root.dispatchEvent(new CustomEvent('qdone', { bubbles: true })); });
  const T = TYPES[q.t]; if (!T) throw new Error('Unknown question type ' + q.t);
  const api = T(q, body, { result, bCheck, root });
  if (api && api.hideCheck) bCheck.hidden = true;
  root.state = S; root.api = api || {}; return root;
}

const TYPES = {
  mcq(q, body, { result }) {
    const box = el('div', 'opts'); const opts = q.opts.map((o, i) => { const b = el('button', 'opt', fmtText(o)); b.dataset.i = i; box.append(b); return b; });
    opts.forEach((b, i) => b.addEventListener('click', () => { if (i === q.ans) { b.classList.add('right'); opts.forEach(x => x.disabled = true); result(true); } else { b.classList.add('wrong'); b.disabled = true; result(false); } }));
    body.append(box); return { hideCheck: true, answer: () => opts[q.ans].click(), wrong: () => opts[(q.ans + 1) % opts.length].click() };
  },
  short(q, body, { result, bCheck }) {
    const ta = el('textarea', 'sa'); ta.rows = 3; ta.placeholder = 'Type your answer…'; body.append(ta);
    bCheck.addEventListener('click', () => {
      const m = markConcepts(ta.value, q.concepts);
      if (m.all) result(true);
      else if (m.count > 0) result(false, `${FEEDBACK.partial}${m.count} of ${q.concepts.length} key ideas there. Idea ${m.hit.indexOf(false) + 1} is missing.`);
      else result(false);
    });
    return { input: ta };
  },
  num(q, body, { result, bCheck }) {
    const inp = el('input', 'num'); inp.inputMode = 'decimal'; inp.placeholder = 'number'; body.append(inp);
    bCheck.addEventListener('click', () => { const v = parseNum(inp.value); result(Number.isFinite(v) && Math.abs(v - q.ans) <= (q.tol || 0) + 1e-9); });
    return { input: inp };
  },
  order(q, body, { result, bCheck }) {
    body.append(el('div', 'qi', 'Tap the cards in order. Tap a numbered card to undo it.'));
    const box = el('div', 'order'); const items = shuffle(q.items, q.items.length * 3 + 1); let seq = [];
    const cards = items.map(t => { const c = el('button', 'ocard', `<span class="on"></span><span>${fmtText(t)}</span>`); c.dataset.v = t; box.append(c); return c; });
    const paint = () => cards.forEach(c => { const k = seq.indexOf(c.dataset.v); c.classList.toggle('picked', k >= 0); c.querySelector('.on').textContent = k >= 0 ? k + 1 : ''; c.classList.remove('good', 'bad'); });
    cards.forEach(c => c.addEventListener('click', () => { const k = seq.indexOf(c.dataset.v); if (k >= 0) seq = seq.slice(0, k); else seq.push(c.dataset.v); paint(); }));
    body.append(box);
    bCheck.addEventListener('click', () => { if (seq.length < q.items.length) { result(false, 'Number every card first.'); return; } let ok = true; cards.forEach(c => { const g = seq.indexOf(c.dataset.v) === q.items.indexOf(c.dataset.v); c.classList.add(g ? 'good' : 'bad'); if (!g) ok = false; }); result(ok); });
    return { tapOrder: (o) => { seq = []; paint(); o.forEach(v => cards.find(c => c.dataset.v === v).click()); }, cards };
  },
  match(q, body, { result, bCheck }) {
    const instr = el('div', 'qi'); body.append(instr);
    const wrap = el('div', 'match'); const L = el('div', 'col'), Rc = el('div', 'col'); wrap.append(L, Rc); body.append(wrap);
    const left = q.pairs.map((p, i) => { const b = el('button', 'mitem', fmtText(p[0])); b.dataset.side = 'L'; b.dataset.i = i; return b; });
    const right = shuffle(q.pairs.map((p, i) => i), 5).map(i => { const b = el('button', 'mitem', fmtText(q.pairs[i][1])); b.dataset.side = 'R'; b.dataset.i = i; return b; });
    left.forEach(b => L.append(b)); right.forEach(b => Rc.append(b));
    const pairs = new Map(); // leftIndex -> rightIndex
    let sel = null;
    const pairOf = b => { const i = +b.dataset.i; if (b.dataset.side === 'L') return pairs.has(i) ? [i, pairs.get(i)] : null; for (const [l, r] of pairs) if (r === i) return [l, r]; return null; };
    const paint = () => {
      const order = [...pairs.keys()];
      for (const b of [...left, ...right]) {
        const pr = pairOf(b); b.classList.toggle('paired', !!pr); b.classList.toggle('sel', sel === b); b.classList.remove('bad', 'good');
        if (pr) { const k = order.indexOf(pr[0]); b.style.setProperty('--pc', PAIR_COLS[k % PAIR_COLS.length]); b.dataset.pn = k + 1; } else { b.style.removeProperty('--pc'); delete b.dataset.pn; }
      }
      instr.textContent = pairs.size === q.pairs.length ? 'All paired. Check, or tap a pair to undo it.' : sel ? `Now tap its partner in the ${sel.dataset.side === 'L' ? 'right' : 'left'} column.` : 'Tap a term or a meaning, then its partner. Tap a pair to undo it.';
    };
    const tap = (b) => {
      const pr = pairOf(b);
      if (pr) { pairs.delete(pr[0]); sel = null; paint(); return; }
      if (!sel) { sel = b; paint(); return; }
      if (sel === b) { sel = null; paint(); return; }
      if (sel.dataset.side === b.dataset.side) { sel = b; paint(); return; }
      const l = sel.dataset.side === 'L' ? sel : b, r = sel.dataset.side === 'L' ? b : sel;
      pairs.set(+l.dataset.i, +r.dataset.i); sel = null; paint();
    };
    [...left, ...right].forEach(b => b.addEventListener('click', () => tap(b)));
    paint();
    bCheck.addEventListener('click', () => {
      if (pairs.size < q.pairs.length) { result(false, 'Pair everything first.'); return; }
      let ok = true; for (const [l, r] of pairs) { const g = l === r; if (!g) ok = false; left[l].classList.add(g ? 'good' : 'bad'); right.find(b => +b.dataset.i === r).classList.add(g ? 'good' : 'bad'); }
      result(ok);
    });
    return { left, right, pairs, tap };
  },
  label(q, body, { result }) {
    let svg = '';
    if (q.svg === 'energy') svg = energySVG(true);
    else if (q.svg === 'rate') svg = `<svg viewBox="0 0 300 170" class="svgq" role="img" aria-label="Rate graph"><line x1="30" y1="150" x2="290" y2="150" style="stroke:rgba(255,255,255,.5)"/><line x1="30" y1="10" x2="30" y2="150" style="stroke:rgba(255,255,255,.5)"/><text x="230" y="164" style="fill:#9AA6B6;font:600 9px JetBrains Mono,monospace">time</text><text x="34" y="18" style="fill:#9AA6B6;font:600 9px JetBrains Mono,monospace">gas volume</text>
      <path data-id="slow" class="hit" d="${curve(28)}" style="fill:none;stroke:#4D9FFF;stroke-width:7"/><path data-id="fast" class="hit" d="${curve(9)}" style="fill:none;stroke:#FFB23F;stroke-width:7"/><text x="200" y="40" style="fill:#dfe5ec;font:600 9px JetBrains Mono,monospace">A</text><text x="200" y="64" style="fill:#dfe5ec;font:600 9px JetBrains Mono,monospace">B</text></svg>`;
    else svg = `<svg viewBox="0 0 300 70" class="svgq" role="img" aria-label="Universal indicator vials">${UI_COL.map((c, i) => `<g data-id="p${i + 1}" class="hit"><rect x="${6 + i * 20.6}" y="8" width="16" height="40" rx="4" style="fill:${c};stroke:rgba(255,255,255,.4)"/><text x="${14 + i * 20.6}" y="62" text-anchor="middle" style="fill:#dfe5ec;font:600 9px JetBrains Mono,monospace">${i + 1}</text></g>`).join('')}</svg>`;
    body.innerHTML = svg;
    body.querySelectorAll('.hit').forEach(h => h.addEventListener('click', () => { const ok = h.dataset.id === q.target; h.style.opacity = ok ? '1' : '0.45'; result(ok); }));
    return { hideCheck: true, hits: () => [...body.querySelectorAll('.hit')] };
  },
  balance(q, body, { result, bCheck }) { return balanceUI(q, body, q.L, q.R, q.st, result, bCheck); },
  predict(q, body, { result, bCheck }) {
    body.append(el('div', 'qi', 'Step 1: tap the product tiles. Step 2: balance.'));
    const L = el('div', 'chem', q.L.map(f => fmtSpecies(f)).join(' + ') + ' → ?'); L.style.fontSize = '18px'; body.append(L);
    const tiles = el('div', 'tiles'); body.append(tiles); const chosen = new Set();
    const tb = q.tiles.map(f => { const b = el('button', 'tile', fmtSpecies(f)); b.dataset.f = f; b.addEventListener('click', () => { chosen.has(f) ? chosen.delete(f) : chosen.add(f); b.classList.toggle('on', chosen.has(f)); }); tiles.append(b); return b; });
    const step2 = el('div'); step2.style.marginTop = '12px'; body.append(step2);
    const go = el('button', 'btn ghost', 'Products picked → balance'); body.insertBefore(go, step2);
    let bal = null;
    go.addEventListener('click', () => {
      const R = q.tiles.filter(f => chosen.has(f));
      step2.textContent = '';
      bal = balanceUI({ ...q }, step2, q.L, R, null, null, null);
    });
    bCheck.addEventListener('click', () => {
      const R = q.tiles.filter(f => chosen.has(f));
      const rightSet = R.length === q.R.length && q.R.every(f => chosen.has(f));
      if (!rightSet) { result(false, 'Not those products. Which pattern does this reaction follow?'); return; }
      if (!bal) { result(false, 'Right products. Now balance it.'); return; }
      const order = R.map(f => q.R.indexOf(f));
      const coefs = [...bal.coefs.slice(0, q.L.length), ...q.R.map((f, k) => bal.coefs[q.L.length + order.indexOf(k)])];
      const c = checkCoefficients(q.L, q.R, coefs);
      result(c.lowest, c.balanced && !c.lowest ? 'Balanced, but not the lowest whole-number ratio.' : null);
    });
    return { tiles: tb, go, bal: () => bal };
  },
  classify(q, body, { result, bCheck }) {
    body.append(el('div', 'qi', q.multi ? 'Tap every type that applies to each reaction.' : 'Tap one type for each reaction.'));
    const box = el('div', 'cls'); body.append(box);
    const rows = q.items.map(it => {
      const r = el('div', 'citem'); r.append(el('div', 'chem', fmtChem(it.eq))); const bs = el('div', 'cbtns'); r.append(bs); box.append(r);
      const sel = new Set();
      const buttons = q.cats.map(c => { const b = el('button', 'cbtn', c); b.addEventListener('click', () => { if (!q.multi) { sel.clear(); buttons.forEach(x => x.classList.remove('on')); } sel.has(c) ? sel.delete(c) : sel.add(c); b.classList.toggle('on', sel.has(c)); r.classList.remove('good', 'bad'); }); bs.append(b); return b; });
      return { it, sel, r, buttons };
    });
    bCheck.addEventListener('click', () => {
      let ok = true;
      rows.forEach(({ it, sel, r }) => { const g = it.ok.some(set => set.length === sel.size && set.every(c => sel.has(c))); r.classList.toggle('good', g); r.classList.toggle('bad', !g); if (!g) ok = false; });
      result(ok);
    });
    return { rows };
  },
  ppt(q, body, { result, bCheck }) {
    const rows = q.pairs.map(p => {
      const r = el('div', 'pptrow'); r.append(el('span', 'chem', `${fmtSpecies(p.a + '(aq)')} + ${fmtSpecies(p.b + '(aq)')}`));
      const y = el('button', 'ybtn', 'Precipitate'), n = el('button', 'ybtn', 'No precipitate'); let v = null;
      y.addEventListener('click', () => { v = true; y.classList.add('on'); n.classList.remove('on'); }); n.addEventListener('click', () => { v = false; n.classList.add('on'); y.classList.remove('on'); });
      r.append(y, n); body.append(r); return { p, r, get v() { return v; }, y, n };
    });
    body.append(el('div', 'soltab', RULES.map(x => `<span>${x.label}</span><span>${x.rule}${x.except.length ? ' except ' + x.except.map(e => /\^/.test(e) ? fmtSpecies(e) : e).join(', ') : ''}</span>`).join('')));
    bCheck.addEventListener('click', () => { if (rows.some(r => r.v === null)) { result(false, 'Answer every pair.'); return; } let ok = true; rows.forEach(r => { const g = r.v === r.p.ans; r.r.classList.toggle('good', g); r.r.classList.toggle('bad', !g); if (!g) ok = false; }); result(ok); });
    return { rows };
  },
  electron(q, body, { result, bCheck }) {
    body.append(el('div', 'chem', fmtChem(q.eq)));
    body.append(el('div', 'qi', 'Drag (or tap, then tap a box) each electron. Then label both boxes.'));
    const wrap = el('div', 'edrag'); body.append(wrap);
    const boxes = [q.from, q.to].map(sp => { const b = el('div', 'ebox'); b.dataset.sp = sp; b.append(el('div', 'sp chem', fmtSpecies(sp))); const slot = el('div', 'eslot'); b.append(slot); const lab = el('div', 'elab'); let tag = null; const bo = el('button', 'cbtn', 'oxidation'), br = el('button', 'cbtn', 'reduction'); bo.addEventListener('click', () => { tag = 'ox'; bo.classList.add('on'); br.classList.remove('on'); }); br.addEventListener('click', () => { tag = 'red'; br.classList.add('on'); bo.classList.remove('on'); }); lab.append(bo, br); b.append(lab); wrap.append(b); return { b, slot, get tag() { return tag; }, bo, br }; });
    let held = null;
    const els = Array.from({ length: q.n }, () => { const e = el('span', 'el', 'e⁻'); boxes[0].slot.append(e); return e; });
    const moveTo = (e, k) => { boxes[k].slot.append(e); };
    els.forEach(e => {
      e.addEventListener('click', ev => { ev.stopPropagation(); held = held === e ? null : e; els.forEach(x => x.style.outline = x === held ? '2px solid #fff' : ''); });
      e.addEventListener('pointerdown', ev => {
        ev.preventDefault(); const ghost = e.cloneNode(true); ghost.classList.add('drag'); document.body.append(ghost);
        const mv = p => { ghost.style.left = (p.clientX - 15) + 'px'; ghost.style.top = (p.clientY - 15) + 'px'; boxes.forEach(B => { const r = B.b.getBoundingClientRect(); B.b.classList.toggle('hot', p.clientX > r.left && p.clientX < r.right && p.clientY > r.top && p.clientY < r.bottom); }); };
        mv(ev);
        const up = p => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); ghost.remove(); boxes.forEach((B, k) => { const r = B.b.getBoundingClientRect(); if (p.clientX > r.left && p.clientX < r.right && p.clientY > r.top && p.clientY < r.bottom) moveTo(e, k); B.b.classList.remove('hot'); }); };
        window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
      });
    });
    boxes.forEach((B, k) => B.b.addEventListener('click', () => { if (held) { moveTo(held, k); held.style.outline = ''; held = null; } }));
    bCheck.addEventListener('click', () => {
      const moved = boxes[1].slot.children.length === q.n;
      const labelled = boxes[0].tag === 'ox' && boxes[1].tag === 'red';
      result(moved && labelled, moved && !labelled ? 'Electrons are right. Check your labels: OIL RIG.' : !moved && labelled ? 'Labels right. Move all the electrons.' : null);
    });
    return { els, boxes, moveTo };
  },
  critique(q, body, { result, bCheck }) {
    const ol = el('ol', 'cmeth'); body.append(ol);
    const types = ['random', 'systematic', 'limitation', 'mistake', 'fine'];
    const rows = q.method.map((m, i) => { const li = el('li'); li.innerHTML = `<b>${i + 1}.</b> ${fmtText(m)}`; const bs = el('div', 'cbtns'); let v = null; const btn = types.map(t => { const b = el('button', 'cbtn', t === 'fine' ? 'no problem' : t === 'mistake' ? 'personal mistake' : t + (t === 'limitation' ? '' : ' error')); b.addEventListener('click', () => { v = t; btn.forEach(x => x.classList.toggle('on', x === b)); }); bs.append(b); return b; }); li.append(bs); ol.append(li); return { get v() { return v; }, btn, li }; });
    body.append(el('div', 'qi', 'Then write one improvement: what changes, and why it improves the data.'));
    const ta = el('textarea', 'sa'); ta.rows = 3; body.append(ta);
    bCheck.addEventListener('click', () => {
      let ok = true;
      rows.forEach((r, i) => { const f = q.flaws.find(x => x.step === i); const want = f ? f.type : 'fine'; const g = r.v === want || (!f && r.v === null); r.li.style.borderColor = g ? 'var(--green)' : 'var(--red)'; if (!g) ok = false; });
      const m = markConcepts(ta.value, q.improve);
      if (ok && m.all) result(true);
      else if (ok && !m.all) result(false, m.count ? 'Flaws identified. Your improvement needs to say why it helps the data.' : 'Flaws identified. Now write a specific improvement.');
      else result(false, m.all ? 'Good improvement, but check which kind of problem each step has.' : null);
    });
    return { rows, ta };
  }
};

function curve(k) { let d = ''; for (let i = 0; i <= 60; i++) { const t = i / 60 * 120, v = 60 * (1 - Math.exp(-t / k)); d += (i ? 'L' : 'M') + (30 + t / 120 * 255).toFixed(1) + ' ' + (150 - v / 60 * 118).toFixed(1); } return d; }

function balanceUI(q, body, Lf, Rf, st, result, bCheck) {
  const coefs = [...Lf, ...Rf].map(() => 1);
  const row = el('div', 'bal chem'); body.append(row);
  const cv = [];
  [...Lf, ...Rf].forEach((f, i) => {
    if (i === Lf.length) row.append(el('span', 'ar', '→')); else if (i > 0) row.append(el('span', 'op', '+'));
    const sp = el('span', 'sp'); const stp = el('span', 'stp'); const up = el('button', '', '+'), dn = el('button', '', '−'), v = el('span', 'cv', '1');
    up.setAttribute('aria-label', 'increase coefficient of ' + f); dn.setAttribute('aria-label', 'decrease coefficient of ' + f);
    up.addEventListener('click', () => { coefs[i] = Math.min(12, coefs[i] + 1); paint(); }); dn.addEventListener('click', () => { coefs[i] = Math.max(1, coefs[i] - 1); paint(); });
    stp.append(up, v, dn); sp.append(stp, el('span', '', fmtSpecies(f + (st ? '(' + st[i] + ')' : '')))); row.append(sp); cv.push(v);
  });
  const tally = el('div', 'tally'); body.append(tally);
  function paint() {
    cv.forEach((v, i) => v.textContent = coefs[i]);
    const c = checkCoefficients(Lf, Rf, coefs);
    tally.innerHTML = c.perEl.map(x => `<span class="${x.l === x.r ? 'ok' : ''}">${x.el}: ${x.l} | ${x.r}</span>`).join('');
  }
  paint();
  if (bCheck && result) bCheck.addEventListener('click', () => { const c = checkCoefficients(Lf, Rf, coefs); result(c.lowest, c.balanced && !c.lowest ? 'Balanced, but not the lowest whole-number ratio.' : null); });
  return { coefs, set(a) { a.forEach((x, i) => coefs[i] = x); paint(); }, paint };
}
export { parseFormula };
