// Reading-time stretch. Every caption must be fully visible for >= 2.8 s + words / 2.3 s at 1x.
// Where its slot is shorter, the playhead slows down while it's on screen (slow-motion, not rushing).
// The map is piecewise linear between base seconds (s) and real seconds (r).
import { wordCount } from '../chem/formula.js';

export const FADE = 0.5;                  // caption fade, base seconds (never shorter in real time)
export const CAPTION_KINDS = new Set(['title', 'lower', 'eq', 'mid', 'myth', 'key', 'tag', 'say']);

export function beatText(b) {
  switch (b.k) {
    case 'title': return [b.kicker, b.title, b.log].join(' ');
    case 'lower': return b.term + ' ' + b.text;
    case 'eq': return [b.word, ...b.lines.map(l => (l.word || l.sym || l.skel || '') + ' ' + (l.note || ''))].join(' ');
    case 'myth': return 'Myth ' + b.myth + ' Fact ' + b.fact;
    case 'key': return b.html + ' ' + (b.sub || '');
    case 'mid': return b.html;
    case 'tag': return b.text;
    case 'say': return 'Vague ' + b.vague + ' Precise ' + b.precise;
    default: return '';
  }
}
export const readNeed = b => 2.8 + wordCount(beatText(b)) / 2.3;

export function buildTimeMap(sec) {
  const base = sec.base;
  if (sec.special) {                           // timed sequences are exempt
    return mk([0, base], [1], base);
  }
  const caps = sec.beats.filter(b => CAPTION_KINDS.has(b.k)).map(b => {
    const s0 = Math.max(0, b.a + (b.a <= 0 ? 0 : FADE)), s1 = Math.min(base, b.b - (b.b >= base ? 0 : FADE));
    const span = Math.max(0.05, s1 - s0);
    return { s0, s1, f: Math.max(1, readNeed(b) / span) };
  });
  const pts = new Set([0, base]);
  for (const c of caps) { pts.add(c.s0); pts.add(c.s1); }
  const P = [...pts].filter(x => x >= 0 && x <= base).sort((a, b) => a - b);
  const F = [];
  for (let i = 0; i < P.length - 1; i++) {
    const m = (P[i] + P[i + 1]) / 2; let f = 1;
    for (const c of caps) if (m > c.s0 && m < c.s1) f = Math.max(f, c.f);
    F.push(f);
  }
  return mk(P, F, base);
}

function mk(P, F, base) {
  const R = [0];
  for (let i = 0; i < F.length; i++) R.push(R[i] + (P[i + 1] - P[i]) * F[i]);
  const total = R[R.length - 1];
  const seg = (arr, v) => { let lo = 0, hi = arr.length - 2; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (arr[m] <= v) lo = m; else hi = m - 1; } return lo; };
  return {
    base, total, P, F, R,
    realOfS(s) { s = !(s > 0) ? 0 : s > base ? base : s; const i = seg(P, s); return R[i] + (s - P[i]) * F[i]; },
    sOfReal(r) { r = !(r > 0) ? 0 : r > total ? total : r; const i = seg(R, r); return P[i] + (r - R[i]) / F[i]; },
    speedAt(t) { const s = t * base; const i = seg(P, Math.min(base - 1e-9, Math.max(0, s))); return 1 / F[i]; }
  };
}
