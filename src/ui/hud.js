/**
 * Heads-up display: resource bar, clock, objective, alerts, the selection
 * panel, and the 2D overlay canvas that draws health bars and the drag box.
 */
import * as THREE from 'three';
import { RES, RES_META, VICTORY, CONTROL_TARGET_SECONDS, TEAM_COLORS, ORDER } from '../core/constants.js';
import { fmtTime, fmtNum, clamp, clamp01 } from '../core/utils.js';
import { EV } from '../core/events.js';
import { costEntries } from '../systems/resources.js';

const BAR_MAX_DIST = 210;

export class HUD {
  constructor(game, signal) {
    this.game = game;
    this.signal = signal;
    this.root = document.getElementById('hud');
    this.overlay = document.getElementById('overlay');
    this.ctx = this.overlay.getContext('2d');

    this.resEls = {};
    for (const k of RES) {
      const el = document.getElementById(`res-${k}`);
      this.resEls[k] = { el, val: el.querySelector('.val'), rate: el.querySelector('.rate'), last: 0 };
    }
    this.popEl = document.getElementById('res-pop');
    this.clockEl = document.getElementById('clock');
    this.objectiveEl = document.getElementById('objective');
    this.controlBarsEl = document.getElementById('control-bars');
    this.alertsEl = document.getElementById('alerts');
    this.selPortrait = document.getElementById('sel-portrait');
    this.selInfo = document.getElementById('sel-info');
    this.selRoster = document.getElementById('sel-roster');
    this.placementHint = document.getElementById('placement-hint');
    this.commanderEl = document.getElementById('commander');
    this.swapBtn = document.getElementById('btn-swap');

    this._alerts = [];
    this._lastAlertText = '';
    this._lastAlertAt = -99;
    this._v = new THREE.Vector3();
    this._selDirty = true;

    this.resize();
    window.addEventListener('resize', () => this.resize(), { signal });

    game.events.on(EV.ALERT, (a) => this.alert(a.text, a.kind));
    game.events.on(EV.SELECTION_CHANGED, () => { this._selDirty = true; });
    game.events.on(EV.QUEUE_CHANGED, () => { this._selDirty = true; });

    if (game.isHotSeat) {
      this.commanderEl.classList.remove('hidden');
      this.swapBtn.classList.remove('hidden');
      this.setCommander(game.humanId);
    }
  }

  /** Hot seat: show whose desk this currently is. */
  setCommander(id) {
    if (!this.game.isHotSeat) return;
    const team = TEAM_COLORS[id];
    this.commanderEl.querySelector('i').style.background = team.css;
    this.commanderEl.querySelector('b').textContent = this.game.players[id].name;
    this._selDirty = true;
  }

  show() { this.root.classList.remove('hidden'); }
  hide() { this.root.classList.add('hidden'); }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.overlay.width = Math.floor(window.innerWidth * dpr);
    this.overlay.height = Math.floor(window.innerHeight * dpr);
    this.dpr = dpr;
  }

  /* ── alerts ───────────────────────────────────────────────────────── */
  alert(text, kind = '') {
    const now = performance.now() / 1000;
    if (text === this._lastAlertText && now - this._lastAlertAt < 4) return;
    this._lastAlertText = text;
    this._lastAlertAt = now;

    const el = document.createElement('div');
    el.className = `alert ${kind}`;
    el.textContent = text;
    this.alertsEl.appendChild(el);
    if (kind === 'bad' || kind === 'warn') this.game.audio.play('alert', { volume: 0.6 });
    setTimeout(() => el.remove(), 4200);
    while (this.alertsEl.children.length > 5) this.alertsEl.firstChild.remove();
  }

  setPlacementHint(text) {
    if (!text) { this.placementHint.classList.add('hidden'); return; }
    this.placementHint.textContent = text;
    this.placementHint.classList.remove('hidden');
  }

  /* ── top bar ──────────────────────────────────────────────────────── */
  updateTop() {
    const p = this.game.players[this.game.humanId];
    for (const k of RES) {
      const slot = this.resEls[k];
      const v = Math.floor(p.res[k]);
      if (v !== slot.last) {
        slot.val.textContent = fmtNum(v);
        slot.last = v;
      }
      slot.rate.textContent = `+${(p.rate[k] || 0).toFixed(1)}`;
    }
    const popVal = this.popEl.querySelector('.val');
    popVal.textContent = `${p.popTotal}/${p.popCap}`;
    this.popEl.classList.toggle('capped', p.popTotal >= p.popCap);

    this.clockEl.textContent = fmtTime(this.game.time);

    if (this.game.isHotSeat) {
      const em = this.commanderEl.querySelector('em');
      if (this.game.handoverStyle === 'timed') {
        const left = Math.max(0, this.game.turnRemaining);
        em.textContent = `turn ${fmtTime(left)}`;
        this.commanderEl.classList.toggle('urgent', left < 15);
      } else if (em.textContent !== 'F2 to swap') {
        em.textContent = 'F2 to swap';
      }
    }
  }

  updateObjective() {
    const v = this.game.victory;
    if (this._objText !== v.objectiveText()) {
      this._objText = v.objectiveText();
      this.objectiveEl.textContent = this._objText;
    }
    if (v.mode !== VICTORY.CONTROL) {
      if (this.controlBarsEl.childElementCount) this.controlBarsEl.innerHTML = '';
      return;
    }
    if (!this.controlBarsEl.childElementCount) {
      this.controlBarsEl.innerHTML =
        '<span class="ctrl-label">Control</span><div class="ctrl-bar"><i class="you"></i><i class="foe"></i></div><span class="ctrl-label" id="ctrl-zones"></span>';
      this._you = this.controlBarsEl.querySelector('.you');
      this._foe = this.controlBarsEl.querySelector('.foe');
      this._zoneLabel = document.getElementById('ctrl-zones');
    }
    const me = this.game.players[this.game.humanId];
    const foe = this.game.players[1 - this.game.humanId];
    this._you.style.width = `${clamp01(me.controlSeconds / CONTROL_TARGET_SECONDS) * 50}%`;
    this._foe.style.width = `${clamp01(foe.controlSeconds / CONTROL_TARGET_SECONDS) * 50}%`;
    const held = this.game.victory.held || [0, 0];
    this._zoneLabel.textContent = `${held[this.game.humanId]} / ${this.game.map.zones.length} zones`;
  }

  /* ── selection panel ──────────────────────────────────────────────── */
  updateSelection(force = false) {
    if (!this._selDirty && !force) {
      // still refresh live numbers on the primary entity
      if (this._hpFill && this._primary && this._primary.alive) {
        const f = this._primary.hpFrac;
        this._hpFill.style.width = `${f * 100}%`;
        this._hpBar.className = `hpbar ${f < 0.34 ? 'low' : f < 0.67 ? 'mid' : ''}`;
        if (this._hpText) this._hpText.textContent = `${Math.ceil(this._primary.hp)}/${Math.ceil(this._primary.maxHp)}`;
      }
      if (this._progressEl && this._primary?.isBuilding) this._refreshBuildingProgress();
      return;
    }
    this._selDirty = false;

    const sel = this.game.selection;
    const items = sel.items;
    this._primary = items[0] || null;

    if (!items.length) {
      this.selPortrait.textContent = '';
      this.selInfo.innerHTML = '<div class="sel-role">Nothing selected — left-click or drag a box over your units.</div>';
      this.selRoster.innerHTML = '';
      this._hpFill = null; this._progressEl = null;
      return;
    }

    const e = items[0];
    const def = e.def;
    this.selPortrait.textContent = def.glyph || '▪';

    const tags = [];
    if (e.isBuilding) tags.push(e.built ? 'Structure' : 'Building…');
    if (def.air) tags.push('Air');
    if (def.cloak) tags.push('Cloaked');
    if (def.detector) tags.push('Detector');
    if (e.rank > 0) tags.push(`Vet ${e.rank}`);

    const stats = [];
    if (def.attack) {
      stats.push(`<span>DMG <b>${Math.round(def.attack.damage)}</b></span>`);
      stats.push(`<span>RNG <b>${Math.round(this.game.combat.rangeFor(e))}</b></span>`);
      stats.push(`<span>ROF <b>${(1 / this.game.combat.cooldownFor(e)).toFixed(1)}/s</b></span>`);
    }
    if (def.heal) stats.push(`<span>HEAL <b>${def.heal.rate}/s</b></span>`);
    if (def.repair) stats.push(`<span>REPAIR <b>${def.repair.rate}/s</b></span>`);
    if (def.speed) stats.push(`<span>SPD <b>${def.speed.toFixed(1)}</b></span>`);
    stats.push(`<span>ARM <b>${def.armor}</b></span>`);
    if (e.heightAdvantage > 1.4) stats.push('<span class="up">HIGH GROUND</span>');
    if (e.isBuilding && e.node) stats.push(`<span>YIELD <b>+${e.node.yield.toFixed(1)} ${e.node.type}</b></span>`);

    const multi = items.length > 1 ? ` ×${items.length}` : '';
    this.selInfo.innerHTML = `
      <div class="sel-name">${def.name}${multi}
        ${tags.map((t) => `<span class="tag">${t}</span>`).join('')}
      </div>
      <div class="sel-role">${def.role} — ${def.blurb}</div>
      <div class="hpbar"><i></i></div>
      <div class="statline">${stats.join('')}<span id="sel-hp-text"></span></div>
      <div id="sel-progress"></div>`;
    this._hpBar = this.selInfo.querySelector('.hpbar');
    this._hpFill = this._hpBar.querySelector('i');
    this._hpText = this.selInfo.querySelector('#sel-hp-text');
    this._progressEl = this.selInfo.querySelector('#sel-progress');

    // roster chips when a mixed group is selected
    if (items.length > 1) {
      const counts = new Map();
      for (const it of items) counts.set(it.def, (counts.get(it.def) || 0) + 1);
      this.selRoster.innerHTML = '';
      for (const [d, n] of counts) {
        const chip = document.createElement('div');
        chip.className = 'roster-chip';
        chip.innerHTML = `<span class="dot" style="background:${TEAM_COLORS[items[0].owner].css}"></span>${d.glyph || ''} ${d.name} <span class="n">×${n}</span>`;
        chip.onclick = () => {
          const subset = items.filter((it) => it.def === d);
          this.game.selection.set(subset);
        };
        this.selRoster.appendChild(chip);
      }
    } else {
      this.selRoster.innerHTML = '';
    }
    this._refreshBuildingProgress();
  }

  _refreshBuildingProgress() {
    const b = this._primary;
    if (!b || !b.isBuilding || !this._progressEl) return;
    let html = '';
    if (!b.built) {
      html = `<div class="hpbar mid" style="max-width:260px"><i style="width:${b.progress * 100}%"></i></div>
              <div class="statline"><span>Constructing ${Math.round(b.progress * 100)}%</span></div>`;
    } else if (b.research) {
      html = `<div class="hpbar mid" style="max-width:260px"><i style="width:${b.research.progress * 100}%"></i></div>
              <div class="statline"><span>Researching <b>${b.research.def.name}</b> ${Math.round(b.research.progress * 100)}%</span></div>`;
    } else if (b.queue.length) {
      const job = b.queue[0];
      const p = 1 - job.remaining / job.total;
      const rest = b.queue.slice(1).map((q) => q.id).length;
      html = `<div class="hpbar" style="max-width:260px"><i style="width:${p * 100}%"></i></div>
              <div class="statline"><span>Training <b>${this.game.defName(job.id)}</b></span>${rest ? `<span>+${rest} queued</span>` : ''}</div>`;
    }
    if (this._progressEl.innerHTML !== html) this._progressEl.innerHTML = html;
  }

  /* ── overlay canvas ───────────────────────────────────────────────── */
  drawOverlay() {
    const ctx = this.ctx;
    const w = this.overlay.width, h = this.overlay.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.scale(this.dpr, this.dpr);

    this._drawHealthBars(ctx);
    this._drawSelectionBox(ctx);
    this._drawHover(ctx);
  }

  _project(pos, yOffset = 0) {
    this._v.set(pos.x, pos.y + yOffset, pos.z).project(this.game.camera);
    if (this._v.z > 1) return null;
    return {
      x: (this._v.x * 0.5 + 0.5) * window.innerWidth,
      y: (-this._v.y * 0.5 + 0.5) * window.innerHeight,
    };
  }

  _drawHealthBars(ctx) {
    const game = this.game;
    const cam = game.camera;
    const now = game.time;
    const me = game.humanId;

    for (const e of game.allEntities()) {
      if (!e.alive || !e.mesh || !e.mesh.visible) continue;
      const damaged = e.hp < e.maxHp - 0.5;
      const recent = now - e.lastDamaged < 6;
      if (!e.selected && !damaged && !recent) continue;
      const d = cam.position.distanceTo(e.pos);
      if (d > BAR_MAX_DIST) continue;

      const top = (e.isBuilding ? e.def.height : (e.def.height || 2)) + (e.isAir ? 1.2 : 1.0);
      const p = this._project(e.pos, top);
      if (!p) continue;

      const scale = clamp(58 / Math.max(18, d) * 1.9, 0.42, 1.5);
      const bw = (e.isBuilding ? 46 : 26) * scale;
      const bh = 4.2 * scale;
      const x = p.x - bw / 2, y = p.y - 6 * scale;

      ctx.fillStyle = 'rgba(0,0,0,0.62)';
      ctx.fillRect(x - 1, y - 1, bw + 2, bh + 2);

      const f = e.hpFrac;
      const own = e.owner === me;
      ctx.fillStyle = own
        ? (f > 0.6 ? '#6ec97a' : f > 0.3 ? '#f2b544' : '#e2564a')
        : (f > 0.6 ? '#e2564a' : f > 0.3 ? '#f28a44' : '#ff6a5c');
      ctx.fillRect(x, y, bw * f, bh);

      // construction / production sliver under the health bar
      if (e.isBuilding && !e.built) {
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(x - 1, y + bh + 1, bw + 2, bh * 0.75 + 2);
        ctx.fillStyle = '#a8d0ff';
        ctx.fillRect(x, y + bh + 2, bw * e.progress, bh * 0.75);
      } else if (e.isBuilding && e.queue?.length) {
        const job = e.queue[0];
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(x - 1, y + bh + 1, bw + 2, bh * 0.6 + 2);
        ctx.fillStyle = '#4a8fe7';
        ctx.fillRect(x, y + bh + 2, bw * (1 - job.remaining / job.total), bh * 0.6);
      }

      // veterancy chevrons
      if (e.rank > 0) {
        ctx.fillStyle = '#f2d24a';
        for (let i = 0; i < e.rank; i++) ctx.fillRect(x + i * 4 * scale, y - 4 * scale, 2.6 * scale, 2.6 * scale);
      }
      // status pips
      let pip = 0;
      const pipAt = (color) => {
        ctx.fillStyle = color;
        ctx.fillRect(x + bw + 2 + pip * 5 * scale, y, 3.2 * scale, bh);
        pip++;
      };
      if (e.hasStatus('slow')) pipAt('#dfe6ef');
      if (e.hasStatus('burn')) pipAt('#d9f24e');
      if (e.hasStatus('disabled')) pipAt('#ff7a4d');
      if (e.hasStatus('marked')) pipAt('#b58cf0');
    }
  }

  _drawSelectionBox(ctx) {
    const r = this.game.input?.boxRect;
    if (!r) return;
    ctx.strokeStyle = 'rgba(168,208,255,0.95)';
    ctx.lineWidth = 1.4;
    ctx.fillStyle = 'rgba(74,143,231,0.14)';
    ctx.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
    ctx.strokeRect(r.x0 + 0.5, r.y0 + 0.5, r.x1 - r.x0, r.y1 - r.y0);
  }

  _drawHover(ctx) {
    const e = this.game.input?.hover;
    if (!e || !e.alive || e.selected) return;
    const p = this._project(e.pos, (e.def.height || 2) + 2.4);
    if (!p) return;
    const label = `${e.def.name}  ${Math.ceil(e.hp)}/${Math.ceil(e.maxHp)}`;
    ctx.font = '600 12px Inter, system-ui, sans-serif';
    const w = ctx.measureText(label).width + 14;
    ctx.fillStyle = 'rgba(13,16,21,0.9)';
    ctx.fillRect(p.x - w / 2, p.y - 20, w, 19);
    ctx.strokeStyle = e.owner === this.game.humanId ? 'rgba(74,143,231,0.7)' : 'rgba(226,86,74,0.7)';
    ctx.lineWidth = 1;
    ctx.strokeRect(p.x - w / 2 + 0.5, p.y - 19.5, w, 18);
    ctx.fillStyle = '#e8eef6';
    ctx.textAlign = 'center';
    ctx.fillText(label, p.x, p.y - 6.5);
    ctx.textAlign = 'left';
  }

  /* ── per-frame ────────────────────────────────────────────────────── */
  update() {
    this.updateTop();
    this.updateObjective();
    this.updateSelection();
    this.drawOverlay();
  }
}

/** Shared helper for cost rendering in tooltips. */
export function costHtml(cost) {
  return costEntries(cost)
    .map(([k, v]) => `<em class="c-${k}">${RES_META[k].glyph}${v}</em>`)
    .join(' ');
}

export const ORDER_LABELS = {
  [ORDER.IDLE]: 'Idle',
  [ORDER.MOVE]: 'Moving',
  [ORDER.ATTACK_MOVE]: 'Attack-moving',
  [ORDER.ATTACK]: 'Attacking',
  [ORDER.HOLD]: 'Holding',
  [ORDER.PATROL]: 'Patrolling',
  [ORDER.REPAIR]: 'Repairing',
  [ORDER.SABOTAGE]: 'Infiltrating',
};
