// Overlays: freeze-frame recall checkpoints, the final exam (sticky first-try score) and the end credits.
import { renderQuestion } from './questions.js';
import { EXAM } from './bank.js';

const CAST = [
  ['The Spectator Ions', 'as Themselves (Did Nothing)'],
  ['Magnesium', 'as The One Who Can’t Keep Their Electrons'],
  ['Oxygen', 'as The Electron Thief'],
  ['Manganese Dioxide', 'as Helped Out, Left Unchanged'],
  ['Limewater', 'as The Snitch'],
  ['Hydrogen', 'as Squeaky Pop'],
  ['Zinc Oxide', 'as Yellow When Hot, Fine When Cool'],
  ['Lead(II) Iodide', 'as Golden Rain (Toxic, Fabulous)'],
  ['Universal Indicator', 'as Every Colour, Depending'],
  ['The Unzeroed Balance', 'as Systematic Error (+0.12 g)'],
  ['Copper(II) Sulfate', 'as Blue, Then Not'],
  ['Carbon Dioxide', 'as Invisible (Please Stop Drawing It Brown)'],
  ['The Catalyst', 'as Not Used Up, Thanks for Asking'],
  ['Iron', 'as Slowly Eaten Away']
];
const ASSETS = [
  ['Bunsen Burner', 'Dreamsoft Innovations Private Limited', 'sketchfab.com/3d-models/bunsen-burner-5185e41b2beb48fa8f15ca3707f43e10', 'CC BY 4.0'],
  ['Tripod stand', 'AmirulIqwan', 'sketchfab.com/3d-models/tripod-stand-c2773043c472429c86b4ee3b28f9b156', 'CC BY 4.0'],
  ['Burette stand', 'VeeRuby Technologies Pvt Ltd', 'sketchfab.com/3d-models/burette-stand-9d204d9be6744ea1a491bd152c61228f', 'CC BY 4.0'],
  ['Burette', '3dLabWare', 'sketchfab.com/3d-models/burette-4bb5f945638a46ba9ea5684d0f38ebad', 'CC BY 4.0'],
  ['“lab” and “studio” HDRIs', 'Poly Haven, via @pmndrs/assets', 'polyhaven.com · npmjs.com/package/@pmndrs/assets', 'CC0'],
  ['Inter Black (3D title font)', 'Rasmus Andersson, via @pmndrs/assets', 'rsms.me/inter', 'SIL OFL 1.1'],
  ['three.js r160', 'three.js authors', 'threejs.org', 'MIT'],
  ['Everything else (glassware, balance, goggles, dropper bottles, tongs, gauze, bench, room, flames, fluids)', 'built procedurally for this film', '', '']
];

export class Overlay {
  constructor(root, { store, onContinue, onRestart, film, confetti }) {
    this.root = root; this.store = store; this.onContinue = onContinue; this.onRestart = onRestart; this.film = film; this.cv = confetti; this.mode = null;
    this.parts = []; this.loopConfetti();
  }
  close() { this.root.hidden = true; this.root.textContent = ''; this.mode = null; this.film.classList.remove('frozen', 'credits'); }
  burst(elm) {
    if (!this.store.get('motion', true)) return;
    const r = elm.getBoundingClientRect(); const cols = ['#FF4859', '#4D9FFF', '#33D17A', '#A98BFF', '#FFB23F', '#FFE14D', '#5EE7FF'];
    for (let i = 0; i < 60; i++) this.parts.push({ x: r.left + r.width * (0.2 + Math.random() * 0.6), y: r.top + 20, vx: (Math.random() - 0.5) * 9, vy: -4 - Math.random() * 7, c: cols[i % cols.length], life: 1, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4 });
  }
  loopConfetti() {
    const c = this.cv, g = c.getContext('2d');
    const step = () => {
      if (this.parts.length) {
        if (c.width !== innerWidth) { c.width = innerWidth; c.height = innerHeight; }
        g.clearRect(0, 0, c.width, c.height);
        this.parts = this.parts.filter(p => (p.life -= 0.012) > 0);
        for (const p of this.parts) { p.vy += 0.28; p.x += p.vx; p.y += p.vy; p.rot += p.vr; g.save(); g.globalAlpha = Math.min(1, p.life * 1.5); g.translate(p.x, p.y); g.rotate(p.rot); g.fillStyle = p.c; g.fillRect(-4, -2.5, 8, 5); g.restore(); }
        if (!this.parts.length) g.clearRect(0, 0, c.width, c.height);
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  freeze(cp) {
    this.mode = 'cp'; this.root.hidden = false; this.root.textContent = '';
    const w = document.createElement('section'); w.className = 'ff cp';
    w.innerHTML = `<div class="stamp">● Freeze frame · Recall</div><h2>${cp.title.split('·')[1] || cp.title}</h2><p class="sub">${cp.qs.length} questions on what you just watched. Only your first try counts.</p>`;
    cp.qs.forEach((q, i) => w.append(renderQuestion(q, i + 1, { store: this.store, key: cp.id + ':' + i, confetti: e => this.burst(e) })));
    const go = document.createElement('button'); go.className = 'btn big'; go.textContent = 'Continue the film ▸'; go.addEventListener('click', () => this.onContinue()); go.dataset.role = 'continue';
    const row = document.createElement('div'); row.className = 'row2'; row.style.justifyContent = 'center'; row.append(go); w.append(row);
    this.root.append(w); this.root.scrollTop = 0;
  }
  exam(qs = EXAM) {
    this.mode = 'exam'; this.root.hidden = false; this.root.textContent = '';
    const w = document.createElement('section'); w.className = 'ff flow';
    const bar = document.createElement('div'); bar.className = 'scorebar'; bar.innerHTML = `<b class="sc">0 / ${qs.length} first try</b><div class="meter"><i></i></div>`;
    w.innerHTML = `<div class="stamp" style="border-color:var(--hl);color:var(--hl)">Final exam</div><h2>Now prove it</h2><p class="sub">${qs.length} questions across every reel. First attempts only. Finish them all and the credits roll.</p>`;
    w.append(bar);
    let score = 0, done = 0;
    const paint = () => { bar.querySelector('.sc').textContent = `${score} / ${qs.length} first try`; bar.querySelector('i').style.width = (score / qs.length * 100) + '%'; };
    // restore persisted first-try results
    qs.forEach((q, i) => { const p = this.store.get('score:exam:' + i, null); if (p && p.ok) score++; });
    const cards = qs.map((q, i) => renderQuestion(q, i + 1, { store: this.store, key: 'exam:' + i, onScore: ok => { if (ok) score++; paint(); }, confetti: e => this.burst(e) }));
    cards.forEach(c => w.append(c));
    w.addEventListener('qdone', () => { done = cards.filter(c => c.state.done).length; if (done === qs.length && !this.rolled) { this.rolled = true; setTimeout(() => this.credits(score, qs.length), 1400); } });
    const row = document.createElement('div'); row.className = 'row2'; row.style.justifyContent = 'center';
    const rc = document.createElement('button'); rc.className = 'btn big'; rc.textContent = 'Roll credits'; rc.addEventListener('click', () => this.credits(score, qs.length));
    const again = document.createElement('button'); again.className = 'btn big ghost'; again.textContent = 'Watch it again'; again.addEventListener('click', () => this.onRestart());
    row.append(rc, again); w.append(row);
    this.root.append(w); paint(); this.score = () => score;
  }
  credits(score = 0, total = EXAM.length) {
    this.mode = 'credits'; this.root.hidden = false; this.root.textContent = ''; this.film.classList.add('credits');
    const c = document.createElement('div'); c.className = 'credits';
    const roll = document.createElement('div'); roll.className = 'roll';
    roll.innerHTML = `<h3>The Reactions Film</h3><p>A Year 10 Chemistry production</p>
      <h3>Starring</h3>${CAST.map(([a, b]) => `<p><b>${a}</b> ${b}</p>`).join('')}
      <h3>Featuring</h3><p>Every atom, accounted for</p><p>Four types of reaction, one redox, one rate</p>
      <h3>Assets</h3>${ASSETS.map(([t, a, u, l]) => `<p><b>${t}</b><br>${a}${u ? ` · <span style="font-family:var(--mono);font-size:12px">${u}</span>` : ''}${l ? ` · ${l}` : ''}</p>`).join('')}
      <h3>Directed by</h3><p><b>You</b></p>
      <h3>Final score</h3><p><b style="font-size:28px">${score} / ${total}</b> first try</p>
      <div class="end">THE END</div>`;
    c.append(roll);
    const bar = document.createElement('div'); bar.className = 'cbar';
    const again = document.createElement('button'); again.className = 'btn'; again.textContent = 'Watch it again'; again.addEventListener('click', () => this.onRestart());
    const back = document.createElement('button'); back.className = 'btn ghost'; back.textContent = 'Back to the exam'; back.addEventListener('click', () => { this.film.classList.remove('credits'); this.exam(); });
    bar.append(again, back); c.append(bar);
    this.root.append(c);
  }
}
