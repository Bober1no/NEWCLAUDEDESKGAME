// Caption beats: DOM built once per section, opacity driven by a --o variable from base seconds.
import { fmtText, fmtChem, fmtSpecies } from '../chem/formula.js';
import { FADE } from './timing.js';

const sm = (a, b, x) => { const u = !(x > a) ? 0 : x >= b ? 1 : (x - a) / (b - a); return u * u * (3 - 2 * u); };
const beyondTag = b => b.beyond ? ' <span class="beyond">beyond the notes</span>' : '';

function skelHTML(s) {
  return `<span class="chem skl">${fmtChem(s)}</span><span class="nb">not balanced yet</span>`;
}

export function beatHTML(b) {
  switch (b.k) {
    case 'title': return `<div class="kick">${b.kicker}</div><h1>${b.title}</h1><div class="log">${fmtText(b.log)}</div>`;
    case 'lower': return `<div class="term">${b.term}${beyondTag(b)}</div><p>${fmtText(b.text)}</p>`;
    case 'eq': return `<div class="w">${b.word}</div>` + b.lines.map((l, i) =>
      `<div class="ln" data-i="${i}">${l.sym ? `<span class="chem">${fmtChem(l.sym)}</span>` : l.skel ? skelHTML(l.skel) : `<span class="w">${l.word}</span>`}${l.note ? `<span class="nt">${l.note}</span>` : ''}</div>`).join('');
    case 'mid': return fmtText(b.html);
    case 'myth': return `<div class="mh">Myth vs fact</div><p class="my">${fmtText(b.myth)}</p><p class="fc">${fmtText(b.fact)}</p>`;
    case 'key': return `<div class="kk">Key idea${b.beyond ? ' · beyond the notes' : ''}</div><div class="kv">${b.html}</div>${b.sub ? `<div class="ks">${b.sub}</div>` : ''}`;
    case 'tag': return b.text;
    case 'say': return `<div class="kk" style="font:800 12px/1 var(--disp);letter-spacing:.16em;color:var(--hl);text-transform:uppercase;text-align:center">Say it like a scientist</div><div class="vg"><span class="lb">Vague</span>${fmtText(b.vague)}</div><div class="pr"><span class="lb">Precise</span>${fmtText(b.precise)}</div>`;
    case 'brand': return b.html;
    case 'bigtitle': return [...b.html].map(c => `<span>${c}</span>`).join('');
    case 'hand': return b.html;
    case 'now': return b.html;
    case 'endtitle': return `<div class="kick">${b.kicker}</div><h1>${b.title}</h1><div class="log">${b.log}</div>`;
    default: return '';
  }
}

export class Captions {
  constructor(root) { this.root = root; this.items = []; this.sec = null; window.addEventListener('resize', () => this.fit()); }
  load(sec) {
    if (this.sec === sec) return;
    this.sec = sec;
    this.root.textContent = '';
    this.items = [];
    for (const b of sec.beats) {
      if (b.k === 'hud') continue;
      const el = document.createElement('div');
      el.className = 'beat ' + b.k + (b.side ? ' side' : '');
      el.innerHTML = beatHTML(b);
      this.root.appendChild(el);
      this.items.push({ b, el, lines: b.k === 'eq' ? [...el.querySelectorAll('.ln')] : null, letters: b.k === 'bigtitle' ? [...el.querySelectorAll('span')] : null, last: -1 });
    }
    this.fit();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => this.fit());
  }
  /** Scale big titles so they never overflow their box (measured after fonts load). */
  fit() {
    for (const it of this.items) {
      const h = it.el.querySelector('h1');
      if (!h) continue;
      const avail = this.root.clientWidth - 8, w = h.scrollWidth;
      h.style.transform = `translateX(-50%) scale(${w > avail && w > 0 ? (avail / w).toFixed(4) : 1})`; h.dataset.k = '';
    }
  }
  update(s, base) {
    for (const it of this.items) {
      const { b, el } = it;
      const fi = b.a <= 0 ? 1 : sm(b.a, b.a + FADE, s);
      const fo = b.b >= base ? 1 : 1 - sm(b.b - FADE, b.b, s);
      const o = Math.min(fi, fo);
      const q = Math.round(o * 1000) / 1000;
      if (q !== it.last) { el.style.setProperty('--o', q); el.style.visibility = q <= 0 ? 'hidden' : 'visible'; it.last = q; }
      if (q > 0 && it.h1 !== null) { // keep big titles inside the frame (fonts may load late; letter-spacing animates)
        const h = it.h1 || (it.h1 = el.querySelector('h1'));
        if (h) { const avail = this.root.clientWidth - 8, w = h.scrollWidth; const k = w > avail && w > 0 ? (avail / w).toFixed(4) : '1'; if (h.dataset.k !== k) { h.dataset.k = k; h.style.transform = `translateX(-50%) scale(${k})`; } }
        else it.h1 = null;
      }
      if (it.lines) it.lines.forEach((ln, i) => { const on = s >= b.lines[i].at; if (ln.classList.contains('on') !== on) ln.classList.toggle('on', on); });
      if (it.letters) it.letters.forEach((sp, i) => { const t0 = b.a + 0.2 + i * 0.11; sp.style.setProperty('--lo', sm(t0, t0 + 0.32, s).toFixed(3)); });
    }
  }
  /** For tests: every caption's (a, b, text) */
  list() { return this.items.map(i => ({ k: i.b.k, a: i.b.a, b: i.b.b, el: i.el })); }
}
export { fmtSpecies };
