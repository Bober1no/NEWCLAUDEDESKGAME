// HUD panels (top-right live readouts). Built once per section; updated in place every frame.
import { hudData, PHYS, INV, EPI_INDEX } from '../scenes/script.js';
import { parseFormula, fmtSpecies } from '../chem/formula.js';
import { RULES } from '../chem/solubility.js';

const sm = (a, b, x) => { const u = !(x > a) ? 0 : x >= b ? 1 : (x - a) / (b - a); return u * u * (3 - 2 * u); };
const fix = (v, d) => (Math.round(v * 10 ** d) / 10 ** d).toFixed(d);
const ATOM_COL = { H: '#e8eef5', O: '#ff4859', C: '#7a828c', N: '#4D9FFF', Cl: '#33D17A', Na: '#A98BFF' };

function cvs(w, h) { const c = document.createElement('canvas'); const d = Math.min(2, window.devicePixelRatio || 1); c.width = w * d; c.height = h * d; c.style.aspectRatio = `${w}/${h}`; const g = c.getContext('2d'); g.scale(d, d); return [c, g]; }

const BUILD = {
  formula(el) {
    el.innerHTML = `<h4>Formula counter</h4><div class="big f" style="font-size:28px">–</div><div class="rows"></div><div class="warn n"></div>`;
    const f = el.querySelector('.f'), rows = el.querySelector('.rows'), n = el.querySelector('.n'); let last = '';
    return d => { const k = d ? d.f : ''; if (k === last) return; last = k; if (!d) return; f.innerHTML = fmtSpecies(d.f);
      rows.innerHTML = Object.entries(d.counts).map(([e, c]) => `<div class="row"><span style="color:${ATOM_COL[e] || '#fff'}">● ${e}</span><span>× ${c}</span></div>`).join('');
      n.textContent = d.note || ''; };
  },
  tally(el) {
    el.innerHTML = `<h4>Atom tally</h4><div class="eqx" style="font-size:12px;margin-bottom:4px"></div><table><thead><tr><th>atom</th><th>left</th><th>right</th></tr></thead><tbody></tbody></table><div class="verdict"></div>`;
    const tb = el.querySelector('tbody'), v = el.querySelector('.verdict'), ex = el.querySelector('.eqx'); let last = '';
    return d => {
      const key = JSON.stringify(d); if (key === last) return; last = key;
      const side = (fs, cs) => { const t = {}; fs.forEach((f, i) => { const p = parseFormula(f); for (const e in p.atoms) t[e] = (t[e] || 0) + p.atoms[e] * cs[i]; }); return t; };
      const nL = d.L.length, L = side(d.L, d.c.slice(0, nL)), R = side(d.R, d.c.slice(nL));
      const els = [...new Set([...Object.keys(L), ...Object.keys(R)])];
      let ok = true;
      tb.innerHTML = els.map(e => { const a = L[e] || 0, b = R[e] || 0; if (a !== b) ok = false; const c = a === b ? 'ok' : 'bad'; return `<tr><td>${e}</td><td class="${c}">${a}</td><td class="${c}">${b}</td></tr>`; }).join('');
      const term = (f, c) => (c > 1 ? `<b style="color:var(--hl)">${c}</b>` : '') + fmtSpecies(f);
      ex.innerHTML = '<span class="chem">' + d.L.map((f, i) => term(f, d.c[i])).join(' + ') + ' → ' + d.R.map((f, i) => term(f, d.c[nL + i])).join(' + ') + '</span>';
      if (d.fail) { v.className = 'verdict bad'; v.textContent = '✕ subscript changed: that’s H₂O₂'; }
      else { v.className = 'verdict ' + (ok ? 'ok' : 'bad'); v.textContent = ok ? '✓ BALANCED' : 'NOT BALANCED'; }
    };
  },
  balance(el) {
    el.innerHTML = `<h4 class="lb">Balance</h4><div class="big"><span class="g">0.00</span><small>g</small></div><div class="warn"></div>`;
    const g = el.querySelector('.g'), lb = el.querySelector('.lb'), w = el.querySelector('.warn');
    return d => { g.textContent = fix(d.g, 2); lb.textContent = d.label; w.textContent = d.warn || ''; };
  },
  temp(el) {
    el.innerHTML = `<h4>Temperature</h4><div class="big"><span class="v">21</span><small>°C</small></div>`;
    const v = el.querySelector('.v');
    return d => { v.textContent = d.c >= 100 ? String(Math.round(d.c / 10) * 10) : String(Math.round(d.c)); };
  },
  ph(el) {
    el.innerHTML = `<h4>pH meter</h4><div class="row"><div class="big"><span class="v">1.0</span></div><span class="c" style="font-size:12px"></span></div><div class="phbar"><i></i></div>`;
    const v = el.querySelector('.v'), i = el.querySelector('.phbar i'), c = el.querySelector('.c');
    return d => { v.textContent = fix(d.ph, 1); i.style.left = ((d.ph - 1) / 13 * 100).toFixed(1) + '%'; c.textContent = d.ph < 3.5 ? 'red · acidic' : d.ph < 6.5 ? 'orange/yellow' : d.ph <= 7.5 ? 'green · neutral' : 'blue · basic'; c.style.color = d.ph < 6.5 ? '#ff9a5c' : '#33D17A'; };
  },
  clock(el) {
    el.innerHTML = `<h4 class="lb">Time-lapse</h4><div class="big"><span class="v">0</span><small class="u">h</small></div>`;
    const v = el.querySelector('.v'), u = el.querySelector('.u');
    return d => { v.textContent = d.unit === 'days' ? fix(d.v, 1) : String(d.v); u.textContent = d.unit; };
  },
  electrons(el) {
    el.innerHTML = `<h4>Electron counter</h4><div class="row"><span>lost</span><span class="big l" style="font-size:22px;color:var(--cyan)">0</span></div><div class="row"><span>gained</span><span class="big g" style="font-size:22px;color:var(--cyan)">0</span></div><div class="verdict ok w"></div>`;
    const l = el.querySelector('.l'), g = el.querySelector('.g'), w = el.querySelector('.w');
    return d => { l.textContent = d.lost + ' e⁻'; g.textContent = d.gained + ' e⁻'; w.textContent = d.who + ' · lost = gained'; };
  },
  collide(el) {
    el.innerHTML = `<h4>Collisions</h4><div class="row"><span>attempts</span><span class="t">0</span></div><div class="row"><span style="color:var(--hl)">successful</span><span class="h" style="color:var(--hl)">0</span></div><div class="warn p"></div>`;
    const t = el.querySelector('.t'), h = el.querySelector('.h'), p = el.querySelector('.p');
    return d => { t.textContent = d.tries; h.textContent = d.hits; p.textContent = d.tries ? 'success rate ≈ ' + Math.round(100 * d.hits / d.tries) + '%' : ''; };
  },
  wave(el) {
    el.innerHTML = `<h4>Sound · squeaky pop</h4>`; const [c, g] = cvs(230, 70); el.appendChild(c);
    return d => { g.clearRect(0, 0, 230, 70); g.strokeStyle = '#5EE7FF'; g.lineWidth = 1.5; g.beginPath();
      for (let x = 0; x < 230; x++) { const u = x / 230; const env = d.pop > 0 ? Math.exp(-Math.pow((u - 0.35) / 0.07, 2)) * d.pop : 0; const y = 35 + Math.sin(x * 1.9) * (1 + 30 * env) * (0.4 + 0.6 * Math.sin(x * 0.37) ** 2); x ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.stroke(); if (d.pop > 0) { g.fillStyle = '#FFE14D'; g.font = '700 13px JetBrains Mono, monospace'; g.fillText('POP!', 150, 18); } };
  },
  rate(el) {
    el.classList.add('wide'); el.innerHTML = `<h4 class="lb">Rate graph</h4>`; const [c, g] = cvs(300, 160); el.appendChild(c);
    return d => {
      el.querySelector('.lb').textContent = d.title;
      g.clearRect(0, 0, 300, 160); const X = 34, Y = 140, W = 255, H = 118;
      g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 1; g.beginPath(); g.moveTo(X, Y - H); g.lineTo(X, Y); g.lineTo(X + W, Y); g.stroke();
      g.fillStyle = '#9AA6B6'; g.font = '600 9px JetBrains Mono, monospace'; g.fillText('time (s)', X + W / 2 - 20, Y + 13); g.save(); g.translate(10, Y - 20); g.rotate(-Math.PI / 2); g.fillText('CO₂ / gas (cm³)', 0, 0); g.restore();
      g.fillText('0', X - 9, Y + 3); g.fillText('60', X - 17, Y - H + 6); g.fillText(String(d.tmax), X + W - 16, Y + 13);
      d.curves.forEach((cv, ci) => {
        g.strokeStyle = cv.col; g.lineWidth = 2.2; g.beginPath(); const n = Math.max(2, Math.floor(80 * Math.max(0, d.prog)));
        for (let i = 0; i <= n; i++) { const x = i / 80 * d.tmax; const v = PHYS.gasVol(cv.k, x); const px = X + (x / d.tmax) * W, py = Y - v / 60 * H; i ? g.lineTo(px, py) : g.moveTo(px, py); }
        g.stroke();
        if (d.prog > 0.15) { g.fillStyle = cv.col; g.font = '700 10px JetBrains Mono, monospace'; const x = Math.min(d.prog, 1) * d.tmax * 0.18 + ci * 4; g.fillText(cv.label, X + (x / d.tmax) * W + 6 + ci * 10, Y - PHYS.gasVol(cv.k, x) / 60 * H + 2 + ci * 4); }
      });
      if (d.plateau && d.prog > 0.8) { g.setLineDash([4, 4]); g.strokeStyle = '#FFE14D'; g.beginPath(); g.moveTo(X, Y - H); g.lineTo(X + W, Y - H); g.stroke(); g.setLineDash([]); g.fillStyle = '#FFE14D'; g.fillText('same final volume', X + W - 104, Y - H - 4); }
    };
  },
  energy(el) {
    el.classList.add('wide'); el.innerHTML = `<h4>Energy profile</h4>` + energySVG(false);
    const cat = el.querySelector('[data-id=curveCat]'), lab = el.querySelector('.catlab');
    return d => { cat.style.strokeDashoffset = String(400 * (1 - d.prog)); lab.style.opacity = d.prog; };
  },
  data(el) {
    el.classList.add('wide'); el.innerHTML = `<h4>Mass of CO₂ lost (g) · 3 trials, mean ± range</h4>`; const [c, g] = cvs(300, 170); el.appendChild(c);
    const note = document.createElement('div'); note.className = 'warn'; el.appendChild(note);
    return d => {
      g.clearRect(0, 0, 300, 170); const X = 34, Y = 145, W = 255, H = 125, tm = 300, mm = 0.5;
      g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 1; g.beginPath(); g.moveTo(X, Y - H); g.lineTo(X, Y); g.lineTo(X + W, Y); g.stroke();
      g.fillStyle = '#9AA6B6'; g.font = '600 9px JetBrains Mono, monospace'; g.fillText('time (s)', X + W / 2 - 20, Y + 13); g.fillText('0.50', 4, Y - H + 4); g.fillText('0', X - 9, Y + 3); g.fillText('300', X + W - 18, Y + 13);
      const px = x => X + x / tm * W, py = m => Y - m / mm * H;
      const series = [['powder', '#33D17A'], ['chips', '#FFE14D']];
      for (const [k, col] of series) {
        const pts = INV[k]; const n = Math.ceil(pts.length * d.prog);
        g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 1.6; g.beginPath(); g.moveTo(px(0), py(0));
        for (let i = 0; i < n; i++) g.lineTo(px(pts[i].x), py(pts[i].mean)); g.stroke();
        for (let i = 0; i < n; i++) { const p = pts[i]; g.beginPath(); g.moveTo(px(p.x), py(p.lo)); g.lineTo(px(p.x), py(p.hi)); g.moveTo(px(p.x) - 3, py(p.lo)); g.lineTo(px(p.x) + 3, py(p.lo)); g.moveTo(px(p.x) - 3, py(p.hi)); g.lineTo(px(p.x) + 3, py(p.hi)); g.stroke(); g.beginPath(); g.arc(px(p.x), py(p.mean), 2.4, 0, 7); g.fill(); }
        g.font = '700 10px JetBrains Mono, monospace'; if (n > 3) g.fillText(k, px(pts[3].x) + 4, py(pts[3].mean) - 6);
      }
      if (d.outlier && d.prog > 0.2) { const p = INV.chips[1]; const v = p.trials[1]; g.strokeStyle = '#FF4859'; g.lineWidth = 1.5; g.beginPath(); g.arc(px(p.x), py(v), 7, 0, 7); g.stroke(); g.fillStyle = '#FF4859'; g.fillRect(px(p.x) - 2, py(v) - 2, 4, 4); g.font = '700 9px JetBrains Mono, monospace'; g.fillText('outlier (excluded)', px(p.x) + 9, py(v) + 3); }
      if (d.argue) { g.strokeStyle = 'rgba(255,255,255,.6)'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(px(0), py(0)); g.lineTo(px(60), py(INV.powder[1].mean)); g.moveTo(px(0), py(0)); g.lineTo(px(60), py(INV.chips[1].mean)); g.stroke(); g.setLineDash([]); }
      note.textContent = d.argue ? `60 s: powder ${INV.powder[1].mean.toFixed(2)} g · chips ${INV.chips[1].mean.toFixed(2)} g` : '';
    };
  },
  solubility(el) {
    el.classList.add('wide'); el.innerHTML = `<h4>Solubility rules</h4><div class="sol">${RULES.map((r, i) => `<div data-r="${i}"><b>${r.label}</b></div><div data-r="${i}" class="${/insol/i.test(r.rule) ? 'ins' : ''}">${r.rule}${r.except.length ? ` <span style="opacity:.8">except ${r.except.map(x => /\^/.test(x) ? fmtSpecies(x) : x).join(', ')}</span>` : ''}</div>`).join('')}</div>`;
    const cells = [...el.querySelectorAll('[data-r]')];
    return d => cells.forEach(c => c.classList.toggle('on', +c.dataset.r <= d.row));
  },
  index(el) {
    el.classList.add('index'); el.innerHTML = `<h4>Reaction index</h4>` + EPI_INDEX.map(x => `<div class="ix"><span>${x.reel}</span><span>${x.type}</span></div>`).join('');
    const rows = [...el.querySelectorAll('.ix')];
    return (d, s) => rows.forEach((r, i) => r.classList.toggle('on', s >= EPI_INDEX[i].at));
  }
};

export function energySVG(interactive) {
  const hit = interactive ? ' class="hit"' : '';
  return `<svg viewBox="0 0 300 170" class="svgq" role="img" aria-label="Energy profile diagram">
  <line x1="30" y1="150" x2="290" y2="150" style="stroke:rgba(255,255,255,.5)"/><line x1="30" y1="10" x2="30" y2="150" style="stroke:rgba(255,255,255,.5)"/>
  <text x="34" y="18" style="fill:#9AA6B6;font:600 9px JetBrains Mono,monospace">energy</text><text x="232" y="164" style="fill:#9AA6B6;font:600 9px JetBrains Mono,monospace">progress</text>
  <path data-id="curveUncat"${hit} d="M40 110 L80 110 C120 110 125 26 150 26 C175 26 180 128 220 128 L280 128" style="fill:none;stroke:#FF4859;stroke-width:${interactive ? 6 : 2.5}"/>
  <path data-id="curveCat"${hit} d="M40 110 L80 110 C118 110 128 70 150 70 C172 70 182 128 220 128 L280 128" style="fill:none;stroke:#33D17A;stroke-width:${interactive ? 6 : 2.5};stroke-dasharray:400;stroke-dashoffset:${interactive ? 0 : 400}"/>
  <g data-id="eaUncat"${hit}><line x1="100" y1="110" x2="100" y2="30" style="stroke:#FF4859;stroke-width:2;marker-end:none"/><path d="M95 36 L100 26 L105 36Z" style="fill:#FF4859"/><rect x="93" y="84" width="14" height="28" style="fill:transparent"/></g>
  <g data-id="eaCat"${hit}><line x1="160" y1="110" x2="160" y2="74" style="stroke:#33D17A;stroke-width:2"/><path d="M155 80 L160 70 L165 80Z" style="fill:#33D17A"/><rect x="153" y="88" width="14" height="24" style="fill:transparent"/></g>
  <text x="62" y="70" style="fill:#FF4859;font:700 9px JetBrains Mono,monospace">Ea</text>
  <text class="catlab" x="168" y="96" style="fill:#33D17A;font:700 9px JetBrains Mono,monospace;opacity:${interactive ? 1 : 0}">Ea (catalyst)</text>
  <text x="44" y="104" style="fill:#dfe5ec;font:600 9px JetBrains Mono,monospace">reactants</text><text x="226" y="122" style="fill:#dfe5ec;font:600 9px JetBrains Mono,monospace">products</text></svg>`;
}

export class HUD {
  constructor(root) { this.root = root; this.panels = []; this.sec = null; }
  load(sec) {
    if (this.sec === sec) return; this.sec = sec;
    this.root.textContent = ''; this.panels = [];
    for (const b of sec.beats) {
      if (b.k !== 'hud') continue;
      const el = document.createElement('div'); el.className = 'hp ' + b.type; this.root.appendChild(el);
      const upd = BUILD[b.type] ? BUILD[b.type](el) : () => {};
      this.panels.push({ b, el, upd, last: -1 });
    }
  }
  update(s, base) {
    for (const p of this.panels) {
      const { b } = p;
      const o = Math.min(b.a <= 0 ? 1 : sm(b.a, b.a + 0.5, s), b.b >= base ? 1 : 1 - sm(b.b - 0.5, b.b, s));
      const q = Math.round(o * 1000) / 1000;
      if (q !== p.last) { p.el.style.setProperty('--o', q); p.el.style.visibility = q <= 0 ? 'hidden' : 'visible'; p.last = q; }
      if (q > 0) p.upd(b.type === 'index' ? null : hudData(this.sec.id, b.type, s, b.variant), s);
    }
  }
}
