/**
 * The command card: build structures, train units, research, issue orders.
 *
 * Contents follow the selection — pick a factory and you get its roster,
 * pick troops and you get their orders — but the Build tab is always there
 * so you are never more than one click from placing a structure.
 */
import { RES_META, ORDER, BALANCE } from '../core/constants.js';
import { BUILD_ORDER_UI, BUILDINGS } from '../entities/buildings.js';
import { getUnitDef, getBuildingDef } from '../entities/registry.js';
import { TECHS, TECH_IDS, techAvailable, techLockReason } from '../systems/techTree.js';
import { costEntries } from '../systems/resources.js';

const ORDER_BUTTONS = [
  { id: 'move', glyph: '➜', label: 'Move', hotkey: 'M', tip: 'Right-click the desk to move. Shift queues waypoints.' },
  { id: 'attack', glyph: '⚔', label: 'Attack', hotkey: 'A', tip: 'Attack-move: advance and engage anything on the way.' },
  { id: 'stop', glyph: '■', label: 'Stop', hotkey: 'S', tip: 'Cancel all orders and hold position.' },
  { id: 'hold', glyph: '⛨', label: 'Hold', hotkey: 'H', tip: 'Stand still and shoot whatever comes into range.' },
  { id: 'patrol', glyph: '↺', label: 'Patrol', hotkey: 'P', tip: 'Walk a beat between here and the point you click.' },
  { id: 'bridge', glyph: '🩶', label: 'Tape Bridge', hotkey: 'B', tip: 'Tape Engineer only: lay a walkway across blocked clutter.' },
];

export class BuildMenu {
  constructor(game, signal) {
    this.game = game;
    this.signal = signal;
    this.tabsEl = document.getElementById('cc-tabs');
    this.gridEl = document.getElementById('cc-grid');
    this.tipEl = document.getElementById('cc-tip');
    this.tab = 'build';
    this.buttons = [];
    this._sig = '';

    this.gridEl.addEventListener('mouseleave', () => this.showTip(null));
    window.addEventListener('keydown', (e) => this.onKey(e), { signal });
  }

  get player() { return this.game.players[this.game.humanId]; }

  /* ── tabs ─────────────────────────────────────────────────────────── */
  availableTabs() {
    const sel = this.game.selection;
    const tabs = [];
    const prodBuilding = sel.buildings().find((b) => b.def.produces && b.built);
    const lab = sel.buildings().find((b) => b.def.research && b.built);
    if (prodBuilding) tabs.push({ id: 'train', label: prodBuilding.def.name.split(' ')[0] });
    if (lab) tabs.push({ id: 'research', label: 'Research' });
    tabs.push({ id: 'build', label: 'Build' });
    if (sel.units().length) tabs.push({ id: 'orders', label: 'Orders' });
    if (!tabs.find((t) => t.id === 'research')) tabs.push({ id: 'research', label: 'Research' });
    return tabs;
  }

  refresh(force = false) {
    const sel = this.game.selection;
    const selSig = sel.items.map((e) => `${e.id}:${e.def.id}`).join(',');
    const sig = `${selSig}|${this.tab}|${this.player.tech.size}|${this.player.buildings.size}`;
    if (sig === this._sig && !force) return;

    // A new selection picks its own natural tab — click a factory and you get
    // its roster. Manually chosen tabs stick until the selection changes.
    if (selSig !== this._selSig) {
      this._selSig = selSig;
      const prod = sel.buildings().find((b) => b.def.produces && b.built);
      if (prod) this.tab = 'train';
      else if (this.tab === 'train') this.tab = 'build';
    }
    this._sig = sig;

    const tabs = this.availableTabs();
    if (!tabs.find((t) => t.id === this.tab)) this.tab = tabs[0].id;

    this.tabsEl.innerHTML = '';
    for (const t of tabs) {
      const el = document.createElement('div');
      el.className = `cc-tab${t.id === this.tab ? ' active' : ''}`;
      el.textContent = t.label;
      el.onclick = () => { this.tab = t.id; this.refresh(true); };
      this.tabsEl.appendChild(el);
    }

    this.gridEl.innerHTML = '';
    this.buttons = [];
    switch (this.tab) {
      case 'train': this.buildTrainTab(); break;
      case 'research': this.buildResearchTab(); break;
      case 'orders': this.buildOrdersTab(); break;
      default: this.buildBuildTab(); break;
    }
    this.update();
  }

  /* ── button factory ───────────────────────────────────────────────── */
  addButton({ glyph, label, hotkey, onClick, tip, locked, cost, badge }) {
    const b = document.createElement('div');
    b.className = 'cc-btn';
    b.innerHTML = `${hotkey ? `<span class="hot">${hotkey}</span>` : ''}
      <span class="glyph">${glyph}</span><span class="lab">${label}</span>`;
    b.onclick = () => {
      if (b.classList.contains('locked')) { this.game.audio.play('deny'); return; }
      onClick();
    };
    b.onmouseenter = () => this.showTip({ label, tip, cost, locked: b.dataset.lock });
    this.gridEl.appendChild(b);
    const rec = { el: b, hotkey, onClick, locked, cost, label, tip, badge };
    this.buttons.push(rec);
    return rec;
  }

  showTip(info) {
    if (!info) {
      const sel = this.game.selection.primary;
      this.tipEl.innerHTML = sel
        ? `<span class="tip-name">${sel.def.name}</span> — ${sel.def.role}`
        : '<span class="dim">Hover a command for details. Hotkeys are shown top-left of each button.</span>';
      return;
    }
    const cost = info.cost ? `<span class="tip-cost">${costEntries(info.cost)
      .map(([k, v]) => `<em class="c-${k}">${RES_META[k].glyph} ${v}</em>`).join('')}</span>` : '';
    const lock = info.locked ? `<div class="warn">${info.locked}</div>` : '';
    this.tipEl.innerHTML = `<span class="tip-name">${info.label}</span>${cost}<div>${info.tip || ''}</div>${lock}`;
  }

  /* ── tabs content ─────────────────────────────────────────────────── */
  buildBuildTab() {
    for (const id of BUILD_ORDER_UI) {
      const def = BUILDINGS[id];
      const rec = this.addButton({
        glyph: def.glyph, label: def.name.replace(/^(Bottle |Pin |Desk |Surface Pro |Paper |Pencil Case |Harvester )/, ''),
        hotkey: def.hotkey, cost: def.cost, tip: def.blurb,
        onClick: () => this.game.input.beginPlacement(id),
      });
      rec.buildingId = id;
    }
    this.addButton({
      glyph: '🧪', label: 'Research', hotkey: 'Z',
      tip: 'Open the full research tree (Ctrl+T).',
      onClick: () => this.game.ui.toggleTech(),
    });
  }

  buildTrainTab() {
    const b = this.game.selection.buildings().find((x) => x.def.produces && x.built);
    if (!b) { this.tab = 'build'; this.refresh(true); return; }
    this.trainBuilding = b;

    for (const uid of b.def.produces) {
      const def = getUnitDef(uid);
      if (!def) continue;
      const rec = this.addButton({
        glyph: def.glyph, label: def.name.split(' ').slice(-1)[0],
        hotkey: def.hotkey, cost: def.cost,
        tip: `${def.role} — ${def.blurb}<br>HP ${def.hp} · ${def.attack ? `DMG ${def.attack.damage} (${def.attack.type}) · RNG ${def.attack.range}` : 'No weapon'} · POP ${def.pop}`,
        onClick: () => { b.queueUnit(uid); this.refresh(true); },
      });
      rec.unitId = uid;
      rec.building = b;
    }

    // queued items — click one to refund it
    b.queue.forEach((job, i) => {
      const def = getUnitDef(job.id);
      this.addButton({
        glyph: def.glyph, label: 'Cancel', hotkey: '',
        tip: `Cancel queued ${def.name} and refund its cost.`,
        onClick: () => { b.cancelQueue(i); this.refresh(true); },
      }).queueIndex = i;
    });
  }

  buildResearchTab() {
    const lab = this.game.selection.buildings().find((x) => x.def.research && x.built)
      || this.player.findBuildings('tech').find((x) => x.built);

    for (const id of TECH_IDS) {
      const def = TECHS[id];
      const done = this.player.tech.has(id);
      const avail = techAvailable(this.player, id);
      const rec = this.addButton({
        glyph: def.glyph, label: def.name.split(' ')[0],
        hotkey: '', cost: def.cost,
        tip: `${def.branch} — ${def.desc}`,
        onClick: () => {
          const target = this.player.findBuildings(def.building).find((x) => x.built && !x.research);
          if (!target) {
            this.game.events.emit('ui:alert', { text: `Needs a free ${BUILDINGS[def.building]?.name || def.building}`, kind: 'warn' });
            this.game.audio.play('deny');
            return;
          }
          if (target.startResearch(id)) this.refresh(true);
        },
      });
      rec.techId = id;
      rec.el.classList.toggle('researched', done);
      if (!avail && !done) rec.el.classList.add('locked');
      rec.lockReason = done ? 'Researched' : (avail ? '' : techLockReason(this.player, id));
      void lab;
    }
  }

  buildOrdersTab() {
    const units = this.game.selection.units();
    for (const o of ORDER_BUTTONS) {
      if (o.id === 'bridge' && !units.some((u) => u.def.bridge)) continue;
      this.addButton({
        glyph: o.glyph, label: o.label, hotkey: o.hotkey, tip: o.tip,
        onClick: () => this.runOrder(o.id),
      });
    }
    if (units.some((u) => u.def.sabotage)) {
      this.addButton({
        glyph: '🕵', label: 'Sabotage', hotkey: '',
        tip: 'Right-click an enemy structure with a Sticky Spy to jam it.',
        onClick: () => { this.game.input.pendingCommand = 'attack'; this.game.input.updateCursor(); },
      });
    }
    if (this.game.selection.buildings().length) {
      this.addButton({
        glyph: '⚒', label: 'Salvage', hotkey: '',
        tip: `Demolish the selected structure and recover ${Math.round(BALANCE.SALVAGE_REFUND * 100)}% of its cost.`,
        onClick: () => { for (const b of this.game.selection.buildings()) b.salvage(); },
      });
    }
  }

  runOrder(id) {
    const input = this.game.input;
    const units = this.game.selection.units();
    switch (id) {
      case 'stop': for (const u of units) u.stop(); break;
      case 'hold': for (const u of units) u.issue({ type: ORDER.HOLD }); break;
      case 'attack': input.pendingCommand = 'attack'; input.updateCursor(); break;
      case 'patrol': input.pendingCommand = 'patrol'; input.updateCursor(); break;
      case 'bridge': input.pendingCommand = 'bridge'; input.updateCursor(); break;
      default: break;
    }
    this.game.audio.play('click');
  }

  /* ── live state ───────────────────────────────────────────────────── */
  update() {
    const p = this.player;
    for (const rec of this.buttons) {
      const el = rec.el;
      let locked = false;
      let reason = '';

      if (rec.buildingId) {
        const def = getBuildingDef(rec.buildingId);
        if (def.requires) {
          for (const r of def.requires) {
            if (!p.hasFinishedBuilding(r)) { locked = true; reason = `Needs ${BUILDINGS[r].name}`; }
          }
        }
        if (!p.hq && rec.buildingId !== 'hq') { locked = true; reason = 'Your HQ is gone'; }
      } else if (rec.unitId) {
        const def = getUnitDef(rec.unitId);
        if (p.popTotal + def.pop > p.popCap) { locked = true; reason = 'Population capped'; }
        if (rec.building && !rec.building.alive) locked = true;
      } else if (rec.techId) {
        const done = p.tech.has(rec.techId);
        locked = done || !techAvailable(p, rec.techId);
        reason = rec.lockReason || '';
        el.classList.toggle('researched', done);
      }

      el.classList.toggle('locked', locked);
      el.dataset.lock = reason;

      if (rec.cost) {
        const poor = !p.canAfford(rec.cost);
        el.classList.toggle('unaffordable', poor && !locked);
      }

      // queue badge on the factory's unit buttons
      if (rec.unitId && rec.building) {
        const n = rec.building.queue.filter((q) => q.id === rec.unitId).length;
        let badge = el.querySelector('.qbadge');
        if (n > 0) {
          if (!badge) { badge = document.createElement('span'); badge.className = 'qbadge'; el.appendChild(badge); }
          badge.textContent = `×${n}`;
        } else if (badge) badge.remove();
      }

      if (rec.techId) {
        const job = p.researchingTech();
        let bar = el.querySelector('.prog');
        if (job && job.def.id === rec.techId) {
          if (!bar) { bar = document.createElement('i'); bar.className = 'prog'; el.appendChild(bar); }
          bar.style.width = `${job.progress * 100}%`;
        } else if (bar) bar.remove();
      }
    }

    // placement mode highlight
    const placing = this.game.input.placement?.id;
    for (const rec of this.buttons) {
      rec.el.classList.toggle('active-mode', !!placing && rec.buildingId === placing);
    }
  }

  /* ── hotkeys ──────────────────────────────────────────────────────── */
  onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (!this.game.running || this.game.paused) return;
    const key = e.key.toUpperCase();

    // order hotkeys are handled by InputController; only grid keys here
    if (this.tab === 'orders') return;
    for (const rec of this.buttons) {
      if (rec.hotkey && rec.hotkey === key) {
        if (rec.el.classList.contains('locked')) { this.game.audio.play('deny'); return; }
        rec.onClick();
        e.preventDefault();
        return;
      }
    }
  }
}
