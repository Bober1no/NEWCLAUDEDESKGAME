/** Ties the HUD, command card, minimap and modals to the running game. */
import { HUD } from './hud.js';
import { BuildMenu } from './buildMenu.js';
import { Minimap } from './minimap.js';
import { TECH_BRANCHES, TECHS, techAvailable, techLockReason } from '../systems/techTree.js';
import { costEntries } from '../systems/resources.js';
import { RES_META, VICTORY, TEAM_COLORS } from '../core/constants.js';
import { fmtTime, fmtNum } from '../core/utils.js';
import { EV } from '../core/events.js';
import { BUILDINGS } from '../entities/buildings.js';

const HELP = [
  ['Camera', [
    ['Right-drag', 'Orbit the desk'],
    ['Middle-drag', 'Pan'],
    ['Wheel', 'Zoom toward the cursor'],
    ['WASD / Arrows', 'Pan (Shift to sprint)'],
    ['Q / E', 'Rotate'],
    ['F', 'Focus selection'],
    ['Home', 'Jump to your HQ'],
    ['Screen edge', 'Edge pan'],
  ]],
  ['Selection', [
    ['Left-click', 'Select'],
    ['Left-drag', 'Box select'],
    ['Shift+click', 'Add / remove'],
    ['Double-click', 'All of that type on screen'],
    ['Ctrl+A', 'Select whole army'],
    ['Ctrl+1…9', 'Assign control group'],
    ['1…9', 'Recall group (twice to centre)'],
    ['Tab', 'Cycle idle units'],
  ]],
  ['Commands', [
    ['Right-click', 'Move, or attack an enemy'],
    ['Shift+right-click', 'Queue waypoints'],
    ['A', 'Attack-move'],
    ['S', 'Stop'],
    ['H', 'Hold position'],
    ['P', 'Patrol'],
    ['B', 'Tape bridge (engineer)'],
    ['Delete', 'Salvage structure'],
  ]],
  ['Systems', [
    ['Ctrl+T', 'Research tree'],
    ['F2', 'Hand over command (hot seat)'],
    ['Esc', 'Pause'],
    ['F1 / ?', 'This panel'],
    ['Build on a bottle', 'Cheaper, tougher tower'],
    ['Stand on books', 'Range, damage and sight bonus'],
    ['Extractors', 'The whole economy — take nodes'],
  ]],
];

export class UI {
  constructor(game) {
    this.game = game;
    // one abort controller retires every DOM listener the UI owns when the
    // match ends, so a restart never leaves a second HUD listening
    this.ac = new AbortController();
    const signal = this.ac.signal;

    this.hud = new HUD(game, signal);
    this.buildMenu = new BuildMenu(game, signal);
    this.minimap = new Minimap(game, signal);

    this.techModal = document.getElementById('modal-tech');
    this.helpModal = document.getElementById('modal-help');
    this.pauseModal = document.getElementById('modal-pause');
    this.endModal = document.getElementById('modal-end');
    this.handoverModal = document.getElementById('modal-handover');

    this._buildHelp();
    this._wireChrome();

    game.events.on(EV.GAME_OVER, (r) => this.showEnd(r));
    game.events.on(EV.SELECTION_CHANGED, () => this.buildMenu.refresh());
    game.events.on(EV.BUILDING_COMPLETE, () => this.buildMenu.refresh(true));
    game.events.on(EV.TECH_DONE, () => { this.buildMenu.refresh(true); this.renderTech(); });
    game.events.on(EV.TECH_STARTED, () => this.renderTech());
  }

  /* ── chrome ───────────────────────────────────────────────────────── */
  _wireChrome() {
    const g = this.game;
    document.getElementById('btn-pause').onclick = () => g.togglePause();
    document.getElementById('btn-help').onclick = () => this.toggleHelp();
    document.getElementById('btn-sound').onclick = (e) => {
      const on = g.toggleSound();
      e.currentTarget.classList.toggle('off', !on);
    };
    document.getElementById('btn-speed').onclick = (e) => {
      const s = g.cycleSpeed();
      e.currentTarget.textContent = `${s}×`;
    };
    document.getElementById('btn-resume').onclick = () => g.setPaused(false);
    document.getElementById('btn-restart').onclick = () => g.restart();
    document.getElementById('btn-quit').onclick = () => g.quitToMenu();
    document.getElementById('btn-again').onclick = () => g.restart();
    document.getElementById('btn-menu').onclick = () => g.quitToMenu();

    for (const el of document.querySelectorAll('[data-close]')) {
      el.onclick = () => {
        el.closest('.screen').classList.add('hidden');
        this.game.setPaused(false, true);
      };
    }
    document.getElementById('btn-swap').onclick = () => g.swapCommander();
    document.getElementById('btn-handover').onclick = () => g.endHandover();

    window.addEventListener('keydown', (e) => {
      if (e.code === 'F1' || (e.key === '?' && e.shiftKey)) { this.toggleHelp(); e.preventDefault(); }
      if (e.code === 'F2' && g.isHotSeat) { g.swapCommander(); e.preventDefault(); }
      if (e.code === 'Enter' && g.awaitingHandover) { g.endHandover(); e.preventDefault(); }
    }, { signal: this.ac.signal });
  }

  /* ── hot-seat handover card ───────────────────────────────────────── */
  showHandover(id) {
    const team = TEAM_COLORS[id];
    const player = this.game.players[id];
    document.getElementById('handover-title').textContent = `Pass to ${player.name}`;
    document.getElementById('handover-sub').textContent =
      `${player.name} takes ${team.name}. The fog of war has already switched sides — press ready once the mouse has changed hands.`;
    document.getElementById('handover-swatch').style.background = team.css;
    this.handoverModal.classList.remove('hidden');
  }

  hideHandover() { this.handoverModal.classList.add('hidden'); }

  dispose() {
    this.ac.abort();
    this.hideModals();
    this.hud.hide();
  }

  _buildHelp() {
    const body = document.getElementById('help-body');
    body.innerHTML = HELP.map(([title, rows]) => `
      <div>
        <h3>${title}</h3>
        <dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
      </div>`).join('');
  }

  toggleHelp() {
    const open = this.helpModal.classList.toggle('hidden');
    this.game.setPaused(!open, true);
  }

  toggleTech() {
    const wasHidden = this.techModal.classList.contains('hidden');
    this.techModal.classList.toggle('hidden', !wasHidden);
    if (wasHidden) this.renderTech();      // must be visible before it renders
    this.game.setPaused(wasHidden, true);
  }

  /* ── research modal ───────────────────────────────────────────────── */
  renderTech() {
    if (this.techModal.classList.contains('hidden')) return;
    const p = this.game.players[this.game.humanId];
    const body = document.getElementById('tech-body');
    const job = p.researchingTech();

    body.innerHTML = '';
    for (const [branch, list] of TECH_BRANCHES) {
      const box = document.createElement('div');
      box.className = 'tech-branch';
      box.innerHTML = `<h3>${branch}</h3>`;
      for (const def of list) {
        const done = p.tech.has(def.id);
        const avail = techAvailable(p, def.id);
        const busy = job && job.def.id === def.id;
        const row = document.createElement('div');
        row.className = `tech-item${done ? ' done' : ''}${!avail && !done ? ' locked' : ''}${busy ? ' researching' : ''}`;
        const cost = costEntries(def.cost)
          .map(([k, v]) => `<span class="c-${k}">${RES_META[k].glyph}${v}</span>`).join(' ');
        row.innerHTML = `
          <div class="ic">${def.glyph}</div>
          <div>
            <div class="nm">${def.name}</div>
            <div class="ds">${busy ? `Researching… ${Math.round(job.progress * 100)}%` : (done ? 'Complete' : (avail ? def.desc : techLockReason(p, def.id)))}</div>
          </div>
          <div class="cs">${done ? '' : cost}</div>`;
        if (!done && avail) {
          row.onclick = () => {
            const lab = p.findBuildings(def.building).find((b) => b.built && !b.research);
            if (!lab) {
              this.hud.alert(`Needs a free ${BUILDINGS[def.building]?.name || def.building}`, 'warn');
              this.game.audio.play('deny');
              return;
            }
            if (lab.startResearch(def.id)) this.renderTech();
          };
        }
        box.appendChild(row);
      }
      body.appendChild(box);
    }
  }

  /* ── end of match ─────────────────────────────────────────────────── */
  showEnd(result) {
    const g = this.game;
    const won = result.winner === g.humanId;
    const title = document.getElementById('end-title');

    if (g.isHotSeat) {
      // no "you" in hot seat — name the winning commander outright
      title.textContent = result.winner < 0
        ? 'Stalemate'
        : `${g.players[result.winner].name} takes the desk`;
      title.className = result.winner < 0 ? '' : (result.winner === 0 ? 'win' : 'lose');
      document.getElementById('end-sub').textContent =
        `${result.winner < 0 ? 'Nobody' : TEAM_COLORS[result.winner].name} — ${result.reason} · ${fmtTime(result.time)}`;
    } else {
      title.textContent = result.winner < 0 ? 'Stalemate' : (won ? 'Desk Secured' : 'Desk Lost');
      title.className = won ? 'win' : (result.winner < 0 ? '' : 'lose');
      document.getElementById('end-sub').textContent =
        `${result.winner < 0 ? 'Nobody' : (won ? 'You' : g.players[result.winner].name)} — ${result.reason} · ${fmtTime(result.time)}`;
    }

    const me = g.players[0];
    const foe = g.players[1];
    const rows = [
      ['Units built', me.stats.unitsBuilt, foe.stats.unitsBuilt],
      ['Units lost', me.stats.losses, foe.stats.losses],
      ['Kills', me.stats.kills, foe.stats.kills],
      ['Structures built', me.stats.buildingsBuilt, foe.stats.buildingsBuilt],
      ['Structures lost', me.stats.buildingsLost, foe.stats.buildingsLost],
      ['Damage dealt', Math.round(me.stats.damage), Math.round(foe.stats.damage)],
      ['Resources gathered', Math.round(me.stats.harvested), Math.round(foe.stats.harvested)],
      ['Upgrades researched', me.tech.size, foe.tech.size],
    ];
    if (g.victory.mode === VICTORY.CONTROL) {
      rows.push(['Zone control banked', fmtTime(me.controlSeconds), fmtTime(foe.controlSeconds)]);
    }
    document.getElementById('end-stats').innerHTML = rows
      .map(([label, a, b]) => `<div class="row"><span>${label}</span><span>${fmtNum2(a)} vs ${fmtNum2(b)}</span></div>`)
      .join('');
    document.getElementById('end-stats').insertAdjacentHTML('afterbegin',
      `<div class="row" style="grid-column:1/-1"><span>${me.name} (${TEAM_COLORS[0].name})</span><span>vs ${foe.name} (${TEAM_COLORS[1].name})</span></div>`);
    this.endModal.classList.remove('hidden');
    g.audio.play(won ? 'victory' : 'defeat');
  }

  hideModals() {
    for (const m of [this.techModal, this.helpModal, this.pauseModal, this.endModal, this.handoverModal]) {
      m.classList.add('hidden');
    }
  }

  /* ── frame ────────────────────────────────────────────────────────── */
  update(dt) {
    this.hud.update();
    this.buildMenu.refresh();
    this.buildMenu.update();
    this.minimap.draw(dt);
    if (!this.techModal.classList.contains('hidden')) this._techTick(dt);
  }

  _techTick(dt) {
    this._techAcc = (this._techAcc || 0) + dt;
    if (this._techAcc > 0.35) { this._techAcc = 0; this.renderTech(); }
  }
}

function fmtNum2(v) {
  return typeof v === 'number' ? fmtNum(v) : v;
}
