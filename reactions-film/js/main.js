// THE REACTIONS FILM · boot, playback engine, controls.
// No static three.js import here: the 3D stage loads separately, so captions, freeze frames and the exam
// still play over a dark gradient if WebGL or the module import fails.
import { REELS, COLD_OPEN, EPILOGUE, SCREEN } from './scenes/script.js';
import { buildTimeMap } from './ui/timing.js';
import { Captions } from './ui/captions.js';
import { HUD } from './ui/hud.js';
import { CHECKPOINTS, EXAM } from './ui/bank.js';
import { Overlay } from './ui/overlay.js';

const $ = id => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem('rxf:v1:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('rxf:v1:' + k, JSON.stringify(v)); } catch { /* private mode */ } }
};
const phone = Math.min(screen.width, screen.height) < 600 || /Mobi|Android|iPhone/i.test(navigator.userAgent);

// ------------------------------------------------------------ sections
const R = id => REELS.find(r => r.id === id);
const SECS = [];
const addCh = (sec) => { const map = buildTimeMap(sec); SECS.push({ kind: 'ch', id: sec.id, sec, map, dur: map.total }); };
addCh(COLD_OPEN);
const order = [['r1', 'r2'], ['r3', 'r4'], ['r5', 'r6'], ['r7'], ['r8', 'r9']];
order.forEach((grp, gi) => { for (const id of grp) addCh(R(id)); const cp = CHECKPOINTS[gi]; SECS.push({ kind: 'cp', id: cp.id, cp, dur: 0 }); });
addCh(EPILOGUE);
SECS.push({ kind: 'flow', id: 'exam', dur: 0 });
const totalReal = SECS.reduce((a, s) => a + s.dur, 0);

// ------------------------------------------------------------ state
const P = { i: 0, t: 0, playing: true, held: false, rate: 1 };
let tDisp = 0, time = 0, real = 0;          // real = real seconds into the current ch section
let stage = null, stageFailed = false;
const motionOn = () => store.get('motion', true);
const RATES = [1, 1.5, 2, 0.75];
let rateIdx = 0;
const fired = new Set();                    // one-shot events fired (section:index), cleared on seek back
const film = $('film');
const caps = new Captions($('captions'));
const hud = new HUD($('hud'));
const overlay = new Overlay($('overlay'), { store, onContinue: () => next(), onRestart: () => restart(), film, confetti: $('confetti') });

function cur() { return SECS[P.i]; }
function realBefore(i) { let a = 0; for (let k = 0; k < i; k++) a += SECS[k].dur; return a; }

// ------------------------------------------------------------ timeline UI
const tl = $('timeline'); const tip = document.createElement('div'); tip.className = 'tip'; tl.appendChild(tip);
const segEls = [];
SECS.forEach((s, i) => {
  const b = document.createElement('button');
  if (s.kind === 'cp') { b.className = 'tcp'; b.setAttribute('aria-label', 'Freeze frame ' + s.cp.title); }
  else { b.className = 'tseg'; b.style.flex = s.kind === 'flow' ? '0 0 18px' : `${s.dur} 1 0`; b.innerHTML = '<i></i>'; b.setAttribute('aria-label', s.kind === 'flow' ? 'Final exam' : s.sec.name); }
  b.addEventListener('mouseenter', () => { tip.textContent = s.kind === 'cp' ? s.cp.title : s.kind === 'flow' ? 'Final exam' : (s.sec.n ? `Reel ${String(s.sec.n).padStart(2, '0')} · ` : '') + s.sec.name; tip.style.left = (b.offsetLeft + b.offsetWidth / 2) + 'px'; tip.classList.add('on'); });
  b.addEventListener('mouseleave', () => tip.classList.remove('on'));
  b.addEventListener('click', (e) => {
    e.stopPropagation(); b.blur();
    if (s.kind === 'ch') { const r = b.getBoundingClientRect(); const f = Math.min(0.999, Math.max(0, (e.clientX - r.left) / r.width)); seek(i, s.map.sOfReal(f * s.dur) / s.sec.base); }
    else seek(i, 0);
  });
  tl.appendChild(b); segEls.push(b);
});
function paintTimeline() {
  segEls.forEach((b, i) => {
    const s = SECS[i];
    if (s.kind === 'ch') { const f = i < P.i ? 1 : i > P.i ? 0 : s.map.realOfS(P.t * s.sec.base) / s.dur; b.firstChild.style.width = (f * 100).toFixed(2) + '%'; b.classList.toggle('done', i < P.i); }
    else b.classList.toggle('done', i < P.i);
  });
  const now = realBefore(P.i) + (cur().kind === 'ch' ? cur().map.realOfS(P.t * cur().sec.base) : 0);
  const f = x => `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(Math.floor(x % 60)).padStart(2, '0')}`;
  $('tc').textContent = `${f(now)} / ${f(totalReal)}`;
  const s = cur(); const n = s.kind === 'ch' && s.sec.n ? s.sec.n : s.kind === 'ch' && s.id === 'epi' ? 10 : s.kind === 'ch' ? 0 : SECS.slice(0, P.i).filter(x => x.sec && x.sec.n).length;
  $('recLabel').textContent = s.kind === 'cp' ? 'FREEZE FRAME' : s.kind === 'flow' ? 'FINAL EXAM' : 'REEL ' + String(n).padStart(2, '0');
  film.classList.toggle('paused', !P.playing || P.held);
}

// ------------------------------------------------------------ section changes
let dipT = 0;   // seconds of cut dip remaining
function enterSection(i, t = 0, { cut = true } = {}) {
  P.i = i; P.t = t; tDisp = t; real = cur().kind === 'ch' ? cur().map.realOfS(t * cur().sec.base) : 0;
  const s = cur();
  overlay.close();
  film.classList.remove('frozen');
  if (s.kind === 'ch') { caps.load(s.sec); hud.load(s.sec); P.held = false; if (cut) dipT = 0.75; }
  else if (s.kind === 'cp') { P.held = true; film.classList.add('frozen'); overlay.freeze(s.cp); }
  else { P.held = true; overlay.exam(EXAM); }
  if (stage) stage.setSection(s.kind === 'ch' ? s.id : lastCh(i));
  paintTimeline();
}
function lastCh(i) { for (let k = i; k >= 0; k--) if (SECS[k].kind === 'ch') return SECS[k].id; return 'cold'; }
function next() { if (P.i < SECS.length - 1) enterSection(P.i + 1, 0); }
function seek(i, t) {
  for (const k of [...fired]) { const [si, , at] = k.split(':'); if (+si > i || (+si === i && +at >= t * (SECS[i].sec ? SECS[i].sec.base : 1))) fired.delete(k); }
  enterSection(i, Math.max(0, Math.min(0.999, t)), { cut: false });
}
function restart() { fired.clear(); P.playing = true; enterSection(0, 0); }

// ------------------------------------------------------------ one-shot events (only when playing forward)
const flashEl = $('flash');
let flashA = 0;
function fireEvents(s0, s1) {
  const s = cur(); if (s.kind !== 'ch' || !s.sec.events) return;
  s.sec.events.forEach((e, k) => {
    const key = `${P.i}:${k}:${e.at}`;
    if (s0 < e.at && s1 >= e.at && !fired.has(key)) {
      fired.add(key); window.__rxfEvents = (window.__rxfEvents || 0) + 1;
      const strength = { flash: 0.85, supernova: 1, pop: 0.35, splash: 0.25, slam: 0.3, spark: 0.4, glow: 0.2 }[e.fx] ?? 0.5;
      flashA = Math.max(flashA, motionOn() ? strength : strength * 0.25);
      if (e.fx === 'slam' && motionOn()) { film.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(4px)' }, { transform: 'translateY(-2px)' }, { transform: 'none' }], { duration: 260 }); }
    }
  });
}

// ------------------------------------------------------------ main loop
let last = performance.now();
const perf = { warm: 0, acc: 0, n: 0 };
function tick(dtIn) {
  const now = performance.now();
  const dt = dtIn != null ? dtIn : Math.min(0.1, (now - last) / 1000); last = now;
  const s = cur();
  const playingNow = P.playing && !P.held && s.kind === 'ch';
  if (playingNow) {
    const base = s.sec.base, s0 = P.t * base;
    real = Math.min(s.dur, real + dt * P.rate);
    P.t = s.map.sOfReal(real) / base;
    fireEvents(s0, P.t * base);
    if (real >= s.dur - 1e-6) { P.t = 1; next(); return; }
    time += dt * P.rate;
  }
  // smoothed display time (snaps on seeks/scene changes via enterSection)
  tDisp += (P.t - tDisp) * Math.min(1, dt * 6);
  if (Math.abs(P.t - tDisp) > 0.2) tDisp = P.t;
  const creditsOn = overlay.mode === 'credits';
  if (creditsOn) time += dt;
  const S = cur();
  if (S.kind === 'ch') { const sb = tDisp * S.sec.base; caps.update(sb, S.sec.base); hud.update(sb, S.sec.base); }
  // dip to black: fade in after a cut, fade out in the last 0.35 s of a reel
  dipT = Math.max(0, dipT - dt);
  let dip = dipT > 0 ? Math.min(1, dipT / 0.5) : 0;
  if (S.kind === 'ch' && !S.sec.special) dip = Math.max(dip, Math.min(1, Math.max(0, (real - (S.dur - 0.35)) / 0.35)));
  $('dip').style.opacity = dip.toFixed(3);
  flashA = Math.max(0, flashA - dt * 2.2); flashEl.style.opacity = flashA.toFixed(3);
  if (stage && !stageFailed) {
    const sid = S.kind === 'ch' ? S.id : lastCh(P.i);
    const tt = S.kind === 'ch' ? tDisp : 1;
    try { stage.frame(sid, tt * (SECTION_BASE[sid] || 1), time, dt, { motion: motionOn(), render: playingNow || creditsOn || dtIn != null || needsRender }); needsRender = false; }
    catch (e) { console.error(e); stageFailed = true; fallback('The 3D picture hit an error; captions and questions keep playing.'); }
    if (playingNow && dtIn == null) adapt(dt);
  }
  paintTimeline();
  grain();
}
let needsRender = true;
const SECTION_BASE = Object.fromEntries(SECS.filter(s => s.kind === 'ch').map(s => [s.id, s.sec.base]));
function loop() { tick(); requestAnimationFrame(loop); }

// adaptive quality: 6 s warm-up, then if 2 s average < 24 fps step down once per window (never up, never if user-picked)
let perfReset = () => { perf.warm = 0; perf.acc = 0; perf.n = 0; };
function adapt(dt) {
  if (store.get('qualityPicked', false)) return;
  perf.warm += dt; if (perf.warm < 6) return;
  perf.acc += dt; perf.n++;
  if (perf.acc >= 2) {
    const fps = perf.n / perf.acc; perf.acc = 0; perf.n = 0;
    if (fps < 24) { const tiers = ['ULTRA', 'HIGH', 'LOW']; const i = tiers.indexOf(quality); if (i < 2) { setQuality(tiers[i + 1], false); toast(`Dropped to ${tiers[i + 1]} to keep it smooth (${fps.toFixed(0)} fps).`); perf.warm = 0; } }
  }
}

// ------------------------------------------------------------ controls
let quality = store.get('quality', phone ? 'HIGH' : 'ULTRA');
function setQuality(q, byUser) { quality = q; store.set('quality', q); if (byUser) store.set('qualityPicked', true); $('quality').textContent = q; if (stage) stage.setTier(q); needsRender = true; perfReset(); }
function setMotion(on) { store.set('motion', on); $('motion').textContent = innerWidth < 480 ? (on ? 'MO:ON' : 'MO:OFF') : (on ? 'Motion: on' : 'Motion: off'); film.classList.toggle('nomotion', !on); }
function togglePlay() {
  if (P.held) return;
  P.playing = !P.playing; const g = $('glyph'); g.classList.remove('show', 'pause'); void g.offsetWidth; if (!P.playing) g.classList.add('pause'); g.classList.add('show'); paintTimeline();
}
$('play').addEventListener('click', e => { e.stopPropagation(); togglePlay(); e.currentTarget.blur(); });
$('picture').addEventListener('click', () => togglePlay());
$('speed').addEventListener('click', e => { rateIdx = (rateIdx + 1) % RATES.length; P.rate = RATES[rateIdx]; e.currentTarget.textContent = P.rate + '×'; e.currentTarget.blur(); });
$('quality').addEventListener('click', e => { const t = ['ULTRA', 'HIGH', 'LOW']; setQuality(t[(t.indexOf(quality) + 1) % 3], true); e.currentTarget.blur(); });
$('motion').addEventListener('click', e => { setMotion(!motionOn()); e.currentTarget.blur(); });
window.addEventListener('keydown', e => {
  const a = document.activeElement;
  if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'BUTTON' || a.isContentEditable)) return;
  if (!$('overlay').hidden) return;
  const s = cur();
  if (e.code === 'Space' || e.key === 'k' || e.key === 'K') { e.preventDefault(); togglePlay(); }
  else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    if (s.kind !== 'ch') return; e.preventDefault();
    let r = s.map.realOfS(P.t * s.sec.base) + (e.key === 'ArrowRight' ? 5 : -5);
    if (r >= s.dur) { next(); return; }
    if (r < 0) { let k = P.i - 1; while (k >= 0 && SECS[k].kind !== 'ch') k--; if (k >= 0) { const q = SECS[k]; seek(k, q.map.sOfReal(Math.max(0, q.dur + r)) / q.sec.base); return; } r = 0; }
    seek(P.i, s.map.sOfReal(r) / s.sec.base);
  } else if (e.key === 'n' || e.key === 'N') { let k = P.i + 1; while (k < SECS.length - 1 && SECS[k].kind === 'cp') k++; if (k < SECS.length) enterSection(k, 0); }
});

// ------------------------------------------------------------ grain, toast, fallback
const gc = $('grain'), gg = gc.getContext('2d'); let gT = 0;
function grain() {
  gT++; if (gT % 2 && motionOn()) return;
  if (!motionOn() && gc.dataset.static) return;
  const w = 160, h = 90; if (gc.width !== w) { gc.width = w; gc.height = h; }
  const id = gg.createImageData(w, h); const d = id.data; for (let i = 0; i < d.length; i += 4) { const v = (Math.random() * 255) | 0; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
  gg.putImageData(id, 0, 0); gc.dataset.static = motionOn() ? '' : '1';
}
let toastT = 0;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 4200); }
function fallback(msg) { const n = $('notice'); n.hidden = false; n.textContent = msg; $('fallbackBg').hidden = false; $('gl').style.visibility = 'hidden'; film.classList.add('flat'); }

function resize() { if (stage) { stage.resize(innerWidth, innerHeight); needsRender = true; } caps.fit(); setMotion(motionOn()); }
let rs = [innerWidth, innerHeight];
window.addEventListener('resize', () => { if (innerWidth !== rs[0] || innerHeight !== rs[1]) { rs = [innerWidth, innerHeight]; resize(); } });

// ------------------------------------------------------------ boot
async function boot() {
  $('quality').textContent = quality; setMotion(motionOn());
  const ld = (f, m) => { $('ldBar').style.width = Math.round(f * 100) + '%'; if (m) $('ldMsg').textContent = m; };
  ld(0.05, 'Warming up the Bunsen…');
  try {
    const mod = window.__RXF_STAGE || await import('./stage.js');
    const canvas = $('gl'); canvas.style.width = '100%'; canvas.style.height = '100%';
    stage = await mod.createStage(canvas, { phone, onProgress: ld });
    stage.resize(innerWidth, innerHeight); stage.setTier(quality);
    film.classList.add('has3d');
  } catch (e) {
    console.warn('[film] 3D unavailable:', e && e.message);
    stageFailed = true; fallback(e && /WebGL/i.test(e.message || '') ? 'WebGL is unavailable here, so the film plays as captions and questions only.' : 'The 3D engine could not load (offline?). Captions and questions still play.');
  }
  $('loader').classList.add('gone'); film.classList.remove('booting');
  enterSection(0, 0);
  const api = { SC: SECS, secs: SECS, P, tick, seek, enterSection, next, stage: () => stage, setQuality, setMotion, caps, hud, overlay, store, events: () => window.__rxfEvents || 0, restart, fired };
  if (typeof window.__filmInstall === 'function') window.__filmInstall(api);
  if (!window.__FILM_TEST__) requestAnimationFrame(loop);
}
boot();
