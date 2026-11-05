// Formula parser, equation checker and chemistry text formatter.
// No three.js here: used by the film, the question renderer, the fallback player and the tests.
//
// Notation used everywhere in the source (so the tests can find and check every equation):
//   $2H2(g) + O2(g) -> 2H2O(l)$     inline chemistry; "->" is the arrow
//   Cu^2+  SO4^2-  e^-  OH^-       charges after a caret
//   CuSO4.5H2O                      hydrates with a dot

const ELEMENTS = new Set(('H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr ' +
  'Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pt Au Hg Tl Pb Bi Rn Fr Ra U').split(' '));

export const STATE_RE = /\((s|l|g|aq)\)$/;

/** Parse one species ("Ca(OH)2", "SO4^2-", "e^-", "CuSO4.5H2O") into {atoms, charge}. */
export function parseFormula(raw) {
  let s = String(raw).trim().replace(STATE_RE, '');
  let charge = 0;
  const cm = s.match(/\^(\d*)([+-])$/);
  if (cm) { charge = (cm[1] ? +cm[1] : 1) * (cm[2] === '+' ? 1 : -1); s = s.slice(0, cm.index); }
  if (s === 'e') return { atoms: {}, charge: charge || -1, electron: true };
  const atoms = {};
  const parts = s.split(/[.·]/);
  for (let pi = 0; pi < parts.length; pi++) {
    let part = parts[pi];
    let mult = 1;
    const lead = part.match(/^(\d+)/);
    if (pi > 0 && lead) { mult = +lead[1]; part = part.slice(lead[1].length); }
    const res = parseGroup(part, 0);
    if (res.i !== part.length) throw new Error('Bad formula: ' + raw);
    for (const k in res.atoms) atoms[k] = (atoms[k] || 0) + res.atoms[k] * mult;
  }
  if (!Object.keys(atoms).length) throw new Error('Empty formula: ' + raw);
  return { atoms, charge };
}

function parseGroup(s, i) {
  const atoms = {};
  while (i < s.length) {
    const c = s[i];
    if (c === '(' || c === '[') {
      const inner = parseGroup(s, i + 1);
      i = inner.i;
      if (s[i] !== ')' && s[i] !== ']') throw new Error('Unclosed bracket in ' + s);
      i++;
      const n = s.slice(i).match(/^\d+/); let k = 1;
      if (n) { k = +n[0]; i += n[0].length; }
      for (const e in inner.atoms) atoms[e] = (atoms[e] || 0) + inner.atoms[e] * k;
    } else if (c === ')' || c === ']') {
      return { atoms, i };
    } else if (/[A-Z]/.test(c)) {
      let el = c; i++;
      if (i < s.length && /[a-z]/.test(s[i])) { el += s[i]; i++; }
      if (!ELEMENTS.has(el)) throw new Error('Unknown element ' + el + ' in ' + s);
      const n = s.slice(i).match(/^\d+/); let k = 1;
      if (n) { k = +n[0]; i += n[0].length; }
      atoms[el] = (atoms[el] || 0) + k;
    } else {
      throw new Error('Unexpected "' + c + '" in ' + s);
    }
  }
  return { atoms, i };
}

/** Split a side of an equation into terms. Terms are separated by " + " (spaces required, so charges like ^2+ survive). */
function splitSide(side) { return side.split(/\s\+\s/).map(x => x.trim()).filter(Boolean); }

export function parseTerm(term) {
  const m = term.match(/^(\d+)?\s*(.+)$/);
  const coef = m[1] ? +m[1] : 1;
  const body = m[2];
  const st = body.match(STATE_RE);
  const f = parseFormula(body);
  return { coef, formula: body.replace(STATE_RE, ''), state: st ? st[1] : null, ...f };
}

export function parseEquation(eq) {
  const sides = eq.split(/\s*(?:->|→|⟶)\s*/);
  if (sides.length !== 2) throw new Error('Equation needs exactly one arrow: ' + eq);
  return sides.map(side => splitSide(side).map(parseTerm));
}

export function tally(terms) {
  const t = {}; let charge = 0;
  for (const term of terms) {
    for (const e in term.atoms) t[e] = (t[e] || 0) + term.atoms[e] * term.coef;
    charge += term.charge * term.coef;
  }
  return { atoms: t, charge };
}

/** Full check: {balanced, atomsOk, chargeOk, statesOk, lhs, rhs}. */
export function checkEquation(eq) {
  const [L, R] = parseEquation(eq);
  const lhs = tally(L), rhs = tally(R);
  const els = new Set([...Object.keys(lhs.atoms), ...Object.keys(rhs.atoms)]);
  let atomsOk = true;
  for (const e of els) if ((lhs.atoms[e] || 0) !== (rhs.atoms[e] || 0)) atomsOk = false;
  const chargeOk = lhs.charge === rhs.charge;
  const statesOk = [...L, ...R].every(t => t.electron || !!t.state);
  const ions = [...L, ...R].some(t => t.charge !== 0);
  return { balanced: atomsOk && chargeOk, atomsOk, chargeOk, statesOk, ions, lhs, rhs, L, R };
}

export function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a; }

/** For the balance-the-equation question: coefficients array, species formulas per side. */
export function checkCoefficients(lhsF, rhsF, coefs) {
  const L = lhsF.map((f, i) => ({ coef: coefs[i], ...parseFormula(f) }));
  const R = rhsF.map((f, i) => ({ coef: coefs[lhsF.length + i], ...parseFormula(f) }));
  const a = tally(L), b = tally(R);
  const els = [...new Set([...Object.keys(a.atoms), ...Object.keys(b.atoms)])];
  const perEl = els.map(e => ({ el: e, l: a.atoms[e] || 0, r: b.atoms[e] || 0 }));
  const balanced = perEl.every(x => x.l === x.r) && a.charge === b.charge && coefs.every(c => c > 0);
  const g = coefs.reduce((x, y) => gcd(x, y), 0);
  return { balanced, lowest: balanced && g === 1, perEl };
}

// ---------- formatting ----------
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** One species (no coefficient) to HTML with sub/sup. */
export function fmtSpecies(f) {
  let s = String(f);
  let state = '';
  const st = s.match(STATE_RE);
  if (st) { state = st[0]; s = s.slice(0, st.index); }
  let charge = '';
  const cm = s.match(/\^(\d*[+-])$/);
  if (cm) { charge = cm[1]; s = s.slice(0, cm.index); }
  if (s === 'e') return `e<sup>${charge === '-' ? '−' : esc(charge)}</sup>`;
  let out = '';
  const parts = s.split(/[.·]/);
  parts.forEach((p, pi) => {
    if (pi > 0) out += '·';
    let i = 0;
    if (pi > 0) { const lead = p.match(/^\d+/); if (lead) { out += lead[0]; i = lead[0].length; } }
    for (; i < p.length; i++) {
      const c = p[i];
      if (/\d/.test(c)) { let n = c; while (i + 1 < p.length && /\d/.test(p[i + 1])) n += p[++i]; out += `<sub>${n}</sub>`; }
      else out += esc(c);
    }
  });
  if (charge) out += `<sup>${charge.replace('-', '−')}</sup>`;
  if (state) out += `<span class="st">${state}</span>`;
  return out;
}

export function fmtTerm(term, coefClass = 'co') {
  const m = term.trim().match(/^(\d+)?\s*(.+)$/);
  return (m[1] ? `<b class="${coefClass}">${m[1]}</b>` : '') + fmtSpecies(m[2]);
}

/** Equation or lone formula to HTML. */
export function fmtChem(s) {
  s = String(s).trim();
  if (/->|→/.test(s)) {
    const [l, r] = s.split(/\s*(?:->|→)\s*/);
    const side = x => splitSide(x).map(t => fmtTerm(t)).join(' <span class="op">+</span> ');
    return `${side(l)} <span class="ar">→</span> ${side(r)}`;
  }
  if (/\s\+\s/.test(s)) return splitSide(s).map(t => fmtTerm(t)).join(' <span class="op">+</span> ');
  return fmtTerm(s);
}

/** Text with $chem$ islands and **bold** to HTML. Plain text is NOT escaped (it may contain markup on purpose). */
export function fmtText(s) {
  return String(s)
    .replace(/\$([^$]+)\$/g, (_, c) => `<span class="chem">${fmtChem(c)}</span>`)
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
}

/** Pull every $...$ island that contains an arrow, for the tests. */
export function extractEquations(src) {
  const out = [];
  const re = /\$([^$\n]+?->[^$\n]+?)\$/g; let m;
  while ((m = re.exec(src))) out.push(m[1]);
  return out;
}

export function wordCount(html) {
  return String(html).replace(/<[^>]+>/g, ' ').replace(/\$[^$]*\$/g, m => m.replace(/[+\-<>^()]/g, ' '))
    .split(/\s+/).filter(w => /[A-Za-z0-9]/.test(w)).length;
}
