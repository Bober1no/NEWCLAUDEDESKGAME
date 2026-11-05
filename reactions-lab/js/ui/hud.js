// HUD: crosshair, hotbar, reaction toasts, discovery counter, scanner panel, pause/title menus.
import { TOOL_DEFS } from '../tools/tools.js';
import { fmtChem } from '../world/formula.js';

const ICONS = {
  hammer: '<path d="M6 10l8-6 4 4-3 2 7 9-2 2-9-7-2 3z" fill="currentColor"/>',
  grab: '<circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M2 12h5M17 12h5M12 2v5M12 17v5" stroke="currentColor" stroke-width="2"/>',
  launcher: '<rect x="3" y="10" width="14" height="4" rx="1" fill="currentColor"/><circle cx="20" cy="12" r="2.2" fill="currentColor"/><rect x="6" y="14" width="3" height="5" fill="currentColor"/>',
  grenade: '<ellipse cx="12" cy="10" rx="6" ry="7" fill="currentColor"/><path d="M12 17l-1 4" stroke="currentColor" stroke-width="1.5"/>',
  torch: '<path d="M12 2c3 4 4 6 4 9a4 4 0 01-8 0c0-3 1-5 4-9z" fill="currentColor"/><rect x="10.5" y="15" width="3" height="7" fill="currentColor"/>',
  scan: '<rect x="4" y="5" width="16" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7 11h3l1-3 2 6 1-3h3" fill="none" stroke="currentColor" stroke-width="1.6"/>'
};

export class HUD {
  constructor(root, G) {
    this.G = G; this.root = root;
    root.innerHTML = `
      <div class="xh" aria-hidden="true"></div>
      <div class="bar">${TOOL_DEFS.map((t, i) => `<button class="slot${i ? '' : ' on'}" data-i="${i}" title="${t.name}"><svg viewBox="0 0 24 24">${ICONS[t.id]}</svg><b>${t.key}</b><span>${t.name}</span></button>`).join('')}</div>
      <div class="hint"></div>
      <div class="toasts"></div>
      <div class="disc"><b>0</b> / <i>0</i> reactions discovered</div>
      <div class="scanp" hidden><h4></h4><div class="f"></div><div class="hz"></div><p></p></div>
      <div class="flash"></div>
      <div class="stats" hidden></div>`;
    this.slots = [...root.querySelectorAll('.slot')]; this.hintEl = root.querySelector('.hint'); this.toastEl = root.querySelector('.toasts'); this.discEl = root.querySelector('.disc');
    this.scanEl = root.querySelector('.scanp'); this.flashEl = root.querySelector('.flash'); this.statsEl = root.querySelector('.stats');
    this.slots.forEach(s => s.addEventListener('click', e => { e.stopPropagation(); G.tools.select(+s.dataset.i); }));
    this.tool(0); this.lastScan = '';
  }
  tool(i) { this.slots.forEach((s, k) => s.classList.toggle('on', k === i)); this.hintEl.textContent = TOOL_DEFS[i].hint; this.hintEl.classList.remove('fade'); void this.hintEl.offsetWidth; this.hintEl.classList.add('fade'); }
  toast(html, kind = 'info', big = false) {
    const t = document.createElement('div'); t.className = 'toast ' + kind + (big ? ' big' : ''); t.innerHTML = html; this.toastEl.prepend(t);
    while (this.toastEl.children.length > 5) this.toastEl.lastChild.remove();
    setTimeout(() => t.classList.add('out'), big ? 5200 : 3200); setTimeout(() => t.remove(), big ? 5800 : 3800);
  }
  flash(text) { this.flashEl.textContent = text; this.flashEl.classList.remove('on'); void this.flashEl.offsetWidth; this.flashEl.classList.add('on'); }
  discovered(n, total) { this.discEl.querySelector('b').textContent = n; this.discEl.querySelector('i').textContent = total; this.discEl.classList.remove('pop'); void this.discEl.offsetWidth; this.discEl.classList.add('pop'); }
  scan(name, sub) {
    if (name == null) { if (!this.scanEl.hidden) this.scanEl.hidden = true; this.lastScan = ''; return; }
    const key = name + '|' + (sub ? sub.formula : ''); if (key === this.lastScan) return; this.lastScan = key;
    this.scanEl.hidden = false; this.scanEl.querySelector('h4').textContent = name;
    this.scanEl.querySelector('.f').innerHTML = sub ? `<span class="chem">${/[A-Z]/.test(sub.formula) && !/\s/.test(sub.formula.replace(/\(.*?\)$/, '')) ? fmtChem(sub.formula) : sub.formula}</span>` : '';
    this.scanEl.querySelector('.hz').textContent = sub ? sub.hazard : '';
    this.scanEl.querySelector('p').textContent = sub ? sub.fact : 'No chemical data.';
  }
  stats(text) { this.statsEl.textContent = text; }
}
