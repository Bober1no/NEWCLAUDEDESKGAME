/* Calculators: max buy, margin/ROI, EV, part-out, sunk cost, growth. */
(function () {
  const { store, fmt, esc, num } = FD;
  const $ = (id) => document.getElementById(id);
  const on = (ids, fn) => ids.forEach((id) => $(id).addEventListener('input', fn));

  /* ---------- Max buy ---------- */
  function maxBuy() {
    const sale = num($('mbSale').value), rep = num($('mbRepair').value), sell = num($('mbSell').value);
    const target = $('mbMode').value === 'pct' ? sale * num($('mbTarget').value) / 100 : num($('mbTarget').value);
    const risk = sale * num($('mbRisk').value) / 100;
    const max = sale - rep - sell - target - risk;
    $('mbOut').textContent = fmt.money(Math.floor(max));
    $('mbOut').className = 'result-big ' + (max <= 0 ? 'neg' : '');
    $('mbBreak').innerHTML = `
      <dt>Expected sale</dt><dd>${fmt.money(sale)}</dd>
      <dt>Repairs / parts</dt><dd>−${fmt.money(rep)}</dd>
      <dt>Selling costs</dt><dd>−${fmt.money(sell)}</dd>
      <dt>Target profit</dt><dd>−${fmt.money(target)}</dd>
      <dt>Risk allowance</dt><dd>−${fmt.money(risk)}</dd>
      <dt class="total">Max buy</dt><dd class="total">${fmt.money(max)}</dd>
      <dt>Open with (≈85%)</dt><dd>${fmt.money(Math.floor(max * 0.85 / 5) * 5)}</dd>`;
    const ask = num($('mbAsk').value);
    let v = '';
    if (ask) {
      if (ask <= max * 0.85) v = `<div class="callout good"><p><strong>Buy.</strong> Asking ${fmt.money(ask)} is well under your max. Don't haggle hard and lose it to someone else.</p></div>`;
      else if (ask <= max) v = `<div class="callout good"><p><strong>Buy at asking, or nudge.</strong> ${fmt.money(ask)} is within your max. Expected profit if it sells as planned: ${fmt.money(sale - rep - sell - ask)}.</p></div>`;
      else if (ask <= max * 1.2) v = `<div class="callout warn"><p><strong>Negotiate.</strong> You need ${fmt.money(ask - max)} off (${fmt.pct((ask - max) / ask * 100, 0)}). Offer ${fmt.money(Math.floor(max * 0.9 / 5) * 5)} and walk away above ${fmt.money(Math.floor(max))}.</p></div>`;
      else v = `<div class="callout bad"><p><strong>Pass.</strong> ${fmt.money(ask)} is ${fmt.pct((ask / max - 1) * 100, 0)} over your max. It might look like a deal, but it doesn't meet your rules.</p></div>`;
    }
    $('mbVerdict').innerHTML = v;
  }

  /* ---------- Comps (paste-back) ---------- */
  const SPEED_BADGE = { fast: 'sold', slow: 'testing', dead: 'written-off', unknown: '' };
  const speedBadge = (st) => `<span class="badge ${SPEED_BADGE[st.speed] || ''}">${st.speed}${st.sellThrough !== null ? ' · ' + fmt.pct(st.sellThrough, 0) : ''}</span>`;
  const staleBadge = (date) => (FDComps.isStale(date) ? ' <span class="badge written-off">stale</span>' : '');
  const itemName = (id) => (store.items().find((i) => i.id === id) || {}).name;

  function fillFromEntry(entry) {
    const st = entry.stats, d = entry.data;
    $('mbSale').value = Math.round(st.expectedSale);
    $('mbRepair').value = d.repairEstimate;
    $('mbRisk').value = st.riskPct;
    $('mbSaleSrc').innerHTML = `From comps: trimmed median of ${st.kept} sale${st.kept === 1 ? '' : 's'}${st.dropped ? ` (${st.dropped} outliers dropped)` : ''}, looked up ${fmt.date(d.date)}.${staleBadge(d.date)}`;
    maxBuy();
  }

  function renderCompsResult(entry, warnings) {
    const st = entry.stats, d = entry.data;
    const notes = [...(warnings || []), ...st.notes];
    if (FDComps.isStale(d.date)) notes.unshift(`These comps are from ${fmt.date(d.date)}, more than 30 days ago. Prices move, so run the comps prompt again before buying.`);
    $('compsResult').innerHTML = `
      <div class="muted">${esc(d.item)}${d.condition ? ' · ' + esc(d.condition) : ''}</div>
      <div class="result-big">${fmt.money(st.expectedSale)}</div>
      <div class="muted" style="margin-bottom:10px">Expected sale: trimmed median of sold prices</div>
      <dl class="kv">
        <dt>Sales used</dt><dd>${st.kept} of ${st.n}${st.dropped ? ` (top/bottom ${st.dropped / 2} dropped)` : ''}</dd>
        <dt>Range</dt><dd>${fmt.money(st.min)} – ${fmt.money(st.max)}</dd>
        <dt>Sell-through (30d)</dt><dd>${speedBadge(st)}</dd>
        <dt>Sold 30d / active</dt><dd>${d.soldCount30d ?? '?'} / ${d.activeCount ?? '?'}</dd>
        <dt>Repair estimate</dt><dd>${fmt.money(d.repairEstimate)}</dd>
        <dt>Risk allowance</dt><dd class="${st.riskBumped ? 'neg' : ''}">${st.riskPct}%${st.riskBumped ? ` (+${FDComps.RISK_BUMP})` : ''}</dd>
        <dt>Claude's confidence</dt><dd>${esc(d.confidence)}</dd>
        <dt>Looked up</dt><dd>${fmt.date(d.date)}${staleBadge(d.date)}</dd>
      </dl>
      ${d.notes ? `<p class="muted mt" style="font-size:.85rem">Claude's note: ${esc(d.notes)}</p>` : ''}
      ${notes.map((n) => `<div class="callout warn"><p>${esc(n)}</p></div>`).join('')}
      <div class="callout good"><p>Max buy updated. ${entry.itemId ? `Saved against <strong>${esc(itemName(entry.itemId) || 'item')}</strong> in Inventory.` : 'Saved as a standalone lookup.'}</p></div>
      ${entry.itemId ? '' : `<a class="btn btn-primary btn-sm" href="inventory.html?comps=${entry.id}">Log purchase with these comps</a>`}`;
  }

  function renderCompsError(r) {
    $('compsResult').innerHTML = `<div class="callout bad"><p><strong>Not applied. Nothing was changed.</strong></p><ul style="margin:6px 0 0;padding-left:1.2em">${r.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>
      ${(r.warnings || []).map((w) => `<div class="callout warn"><p>${esc(w)}</p></div>`).join('')}`;
  }

  function renderCompsTable() {
    const all = FDComps.list();
    $('compsTable').innerHTML = `<thead><tr><th>Item</th><th>Looked up</th><th class="num">Expected sale</th><th class="num">Sales</th><th>Sell-through</th><th>Confidence</th><th>Linked to</th><th></th></tr></thead><tbody>${
      all.length ? all.slice(0, 30).map((c) => `<tr>
        <td>${esc(c.data.item)}</td><td>${fmt.date(c.data.date)}${staleBadge(c.data.date)}</td>
        <td class="num">${fmt.money(c.stats.expectedSale)}</td><td class="num">${c.stats.kept}</td><td>${speedBadge(c.stats)}</td><td>${esc(c.data.confidence)}</td>
        <td>${c.itemId ? esc(itemName(c.itemId) || '(deleted item)') : '<span class="muted">standalone</span>'}</td>
        <td><button class="btn btn-sm" type="button" data-load="${c.id}">Load</button> <button class="btn btn-sm btn-danger" type="button" data-delcomps="${c.id}">×</button></td></tr>`).join('')
        : '<tr><td colspan="8" class="muted">No comps saved yet.</td></tr>'
    }</tbody>`;
  }

  function initComps() {
    const open = store.items().filter((i) => !FD.isClosed(i));
    $('compsFor').innerHTML += open.map((i) => `<option value="${i.id}">${esc(i.name)} (${esc(i.status)})</option>`).join('');
    const want = new URLSearchParams(location.search).get('item');
    const syncPromptLink = () => {
      const it = open.find((i) => i.id === $('compsFor').value);
      $('compsPromptLink').href = it ? `prompt.html?mode=comps&item=${encodeURIComponent(it.name)}&id=${it.id}` : 'prompt.html?mode=comps';
    };
    if (want && open.some((i) => i.id === want)) {
      $('compsFor').value = want;
      document.querySelector('.tab[data-tab="maxbuy"]').click();
    }
    $('compsFor').addEventListener('change', syncPromptLink);
    syncPromptLink();

    $('compsApply').addEventListener('click', () => {
      const r = FDComps.process($('compsPaste').value, store.settings().riskPct);
      if (!r.ok) { renderCompsError(r); return; }
      const entry = FDComps.save(r, $('compsFor').value || null);
      fillFromEntry(entry);
      renderCompsResult(entry, r.warnings);
      renderCompsTable();
      FD.toast('Comps applied and saved');
    });
    $('compsClear').addEventListener('click', () => { $('compsPaste').value = ''; $('compsResult').innerHTML = '<p class="muted">Results show up here once you paste comps.</p>'; });
    $('compsTable').addEventListener('click', (e) => {
      const l = e.target.closest('[data-load]'), d = e.target.closest('[data-delcomps]');
      if (l) { const c = FDComps.get(l.dataset.load); if (c) { fillFromEntry(c); renderCompsResult(c, []); window.scrollTo({ top: 0, behavior: 'smooth' }); } }
      if (d && confirm('Delete these saved comps? Items linked to them keep their expected sale.')) { FDComps.remove(d.dataset.delcomps); renderCompsTable(); }
    });
    renderCompsTable();
  }

  /* ---------- Margin ---------- */
  function margin() {
    const cost = num($('mBuy').value), sale = num($('mSell').value), fees = num($('mFees').value), days = Math.max(1, num($('mDays').value));
    const p = sale - cost - fees;
    const roi = cost ? p / cost : NaN;
    const annual = Number.isFinite(roi) && roi > -1 ? (Math.pow(1 + roi, 365 / days) - 1) * 100 : NaN;
    $('mOut').innerHTML = `
      <dt>Profit</dt><dd class="${p >= 0 ? 'pos' : 'neg'}">${fmt.money(p, 2)}</dd>
      <dt>Markup (profit ÷ cost)</dt><dd>${fmt.pct(cost ? p / cost * 100 : NaN)}</dd>
      <dt>Gross margin (profit ÷ sale)</dt><dd>${fmt.pct(sale ? p / sale * 100 : NaN)}</dd>
      <dt>ROI over ${days} days</dt><dd>${fmt.pct(roi * 100)}</dd>
      <dt>Profit per day held</dt><dd>${fmt.money(p / days, 2)}</dd>
      <dt>Annualised ROI (if repeatable)</dt><dd>${Number.isFinite(annual) && annual < 1e6 ? fmt.pct(annual, 0) : '—'}</dd>`;
  }

  /* ---------- EV ---------- */
  const EV_KEY = 'fd.calc.ev';
  const evDefault = [
    { name: 'Deal A: tested card', price: 200, rows: [['Works', 95, 80], ['Dead / faulty', 5, -100]] },
    { name: 'Deal B: untested card', price: 100, rows: [['Works', 70, 150], ['Faulty, sell for parts', 30, -100]] },
    { name: 'Deal C', price: 0, rows: [['Works', 80, 0], ['Minor fault', 15, 0], ['Dead', 5, 0]] },
  ];
  let evState = store.get(EV_KEY, evDefault);

  function renderEv() {
    $('evDeals').innerHTML = evState.map((d, di) => {
      const total = d.rows.reduce((s, r) => s + num(r[1]), 0);
      const ev = d.rows.reduce((s, r) => s + num(r[1]) / 100 * num(r[2]), 0);
      const worst = Math.min(...d.rows.map((r) => num(r[2])));
      return `<div class="card" style="background:var(--surface-2)">
        <div class="field"><input type="text" value="${esc(d.name)}" data-d="${di}" data-k="name" style="font-weight:700"></div>
        <div class="field"><label>Capital needed ($)</label><input type="number" value="${d.price}" data-d="${di}" data-k="price"></div>
        <table><thead><tr><th>Outcome</th><th class="num">Prob %</th><th class="num">Profit $</th><th></th></tr></thead><tbody>
          ${d.rows.map((r, ri) => `<tr>
            <td><input type="text" value="${esc(r[0])}" data-d="${di}" data-r="${ri}" data-c="0" style="min-width:90px"></td>
            <td><input type="number" value="${r[1]}" data-d="${di}" data-r="${ri}" data-c="1" style="width:64px"></td>
            <td><input type="number" value="${r[2]}" data-d="${di}" data-r="${ri}" data-c="2" style="width:76px"></td>
            <td><button class="btn btn-sm" type="button" data-del="${di}:${ri}">×</button></td></tr>`).join('')}
        </tbody></table>
        <button class="btn btn-sm mt" type="button" data-addrow="${di}">+ outcome</button>
        <dl class="kv mt">
          <dt>Expected profit</dt><dd class="${ev >= 0 ? 'pos' : 'neg'}">${fmt.money(ev, 2)}</dd>
          <dt>Expected ROI</dt><dd>${num(d.price) ? fmt.pct(ev / num(d.price) * 100) : '—'}</dd>
          <dt>Worst case</dt><dd class="${worst < 0 ? 'neg' : ''}">${fmt.money(worst)}</dd>
          <dt>Probabilities sum</dt><dd class="${Math.abs(total - 100) > 0.01 ? 'neg' : ''}">${total}%</dd>
        </dl></div>`;
    }).join('');
    const scored = evState.map((d) => ({ name: d.name, ev: d.rows.reduce((s, r) => s + num(r[1]) / 100 * num(r[2]), 0), price: num(d.price), worst: Math.min(...d.rows.map((r) => num(r[2]))) }))
      .filter((d) => d.ev !== 0 || d.price);
    if (scored.length) {
      const best = [...scored].sort((a, b) => b.ev - a.ev)[0];
      const bestRoi = [...scored].filter((d) => d.price).sort((a, b) => b.ev / b.price - a.ev / a.price)[0];
      $('evVerdict').innerHTML = `<p><strong>${esc(best.name)}</strong> has the highest expected profit (${fmt.money(best.ev, 2)}).${bestRoi && bestRoi !== best ? ` <strong>${esc(bestRoi.name)}</strong> earns more per dollar of capital (${fmt.pct(bestRoi.ev / bestRoi.price * 100)}).` : ''} EV only holds over many deals. If the worst case (${fmt.money(best.worst)}) would wipe out your reserve, the smaller deal is the better choice.</p>`;
    }
    store.set(EV_KEY, evState);
  }

  function evEvents() {
    $('evDeals').addEventListener('change', (e) => {
      const t = e.target; const d = evState[t.dataset.d]; if (!d) return;
      if (t.dataset.k) d[t.dataset.k] = t.dataset.k === 'price' ? num(t.value) : t.value;
      else d.rows[t.dataset.r][t.dataset.c] = t.dataset.c === '0' ? t.value : num(t.value);
      renderEv();
    });
    $('evDeals').addEventListener('click', (e) => {
      const add = e.target.closest('[data-addrow]'); const del = e.target.closest('[data-del]');
      if (add) { evState[add.dataset.addrow].rows.push(['Outcome', 0, 0]); renderEv(); }
      if (del) { const [d, r] = del.dataset.del.split(':'); if (evState[d].rows.length > 1) { evState[d].rows.splice(r, 1); renderEv(); } }
    });
  }

  /* ---------- Part-out ---------- */
  let parts = [
    { name: 'GPU (GTX 1070)', price: 220, fees: 10, hours: 1, sell: 100 },
    { name: 'CPU + board (i5-8400 / B360)', price: 150, fees: 10, hours: 1, sell: 90 },
    { name: '16GB DDR4', price: 45, fees: 0, hours: 0.5, sell: 95 },
    { name: '500GB SSD', price: 35, fees: 0, hours: 0.5, sell: 95 },
    { name: '550W PSU', price: 50, fees: 0, hours: 0.5, sell: 85 },
    { name: 'Case + fans', price: 40, fees: 0, hours: 1, sell: 60 },
  ];
  function renderPartout() {
    $('poTable').innerHTML = `<thead><tr><th>Part</th><th class="num">Sold price</th><th class="num">Fees/ship</th><th class="num">Hours</th><th class="num">Sell chance %</th><th></th></tr></thead><tbody>${
      parts.map((p, i) => `<tr>
        <td><input type="text" value="${esc(p.name)}" data-i="${i}" data-k="name" style="min-width:150px"></td>
        <td><input type="number" value="${p.price}" data-i="${i}" data-k="price" style="width:80px"></td>
        <td><input type="number" value="${p.fees}" data-i="${i}" data-k="fees" style="width:70px"></td>
        <td><input type="number" value="${p.hours}" data-i="${i}" data-k="hours" step="0.5" style="width:60px"></td>
        <td><input type="number" value="${p.sell}" data-i="${i}" data-k="sell" style="width:64px"></td>
        <td><button class="btn btn-sm" data-rm="${i}" type="button">×</button></td></tr>`).join('')
    }</tbody>`;
    calcPartout();
  }
  function calcPartout() {
    const rate = num($('poRate').value);
    const gross = parts.reduce((s, p) => s + num(p.price) * num(p.sell) / 100, 0);
    const fees = parts.reduce((s, p) => s + num(p.fees), 0);
    const hours = parts.reduce((s, p) => s + num(p.hours), 0);
    const partNet = gross - fees - hours * rate;
    const whole = num($('poWhole').value) - num($('poWholeCost').value) - 1 * rate;
    $('poOut').innerHTML = `
      <dt>Parts gross (probability-weighted)</dt><dd>${fmt.money(gross)}</dd>
      <dt>Fees &amp; shipping</dt><dd>−${fmt.money(fees)}</dd>
      <dt>Your time (${hours} h)</dt><dd>−${fmt.money(hours * rate)}</dd>
      <dt class="total">Part-out net</dt><dd class="total">${fmt.money(partNet)}</dd>
      <dt>Sell-whole net (1 h)</dt><dd>${fmt.money(whole)}</dd>`;
    const diff = partNet - whole;
    $('poVerdict').innerHTML = `<div class="callout ${diff > 50 ? 'good' : diff < 0 ? 'bad' : 'warn'} mt"><p>${
      diff > 50 ? `<strong>Part it out.</strong> You make about ${fmt.money(diff)} more after paying yourself for your time. List the most valuable part first so your cash comes back quickly.`
        : diff < 0 ? `<strong>Sell it whole.</strong> Parting out loses about ${fmt.money(-diff)} once fees and your time are counted.`
          : `<strong>Close call (${fmt.money(diff)}).</strong> Sell whole unless you need the parts yourself. It's quicker, less hassle, and less to go wrong.`
    }</p></div>`;
  }

  /* ---------- Sunk cost ---------- */
  let opts = [
    { name: 'Drop price and sell now', recover: 550, extra: 0, days: 5 },
    { name: 'Repair board, then sell', recover: 800, extra: 150, days: 30 },
    { name: 'Part it out', recover: 620, extra: 20, days: 21 },
  ];
  function renderSunk() {
    $('skTable').innerHTML = `<thead><tr><th>Option</th><th class="num">Expected sale</th><th class="num">Extra cost</th><th class="num">Days</th><th></th></tr></thead><tbody>${
      opts.map((o, i) => `<tr>
        <td><input type="text" value="${esc(o.name)}" data-i="${i}" data-k="name" style="min-width:150px"></td>
        <td><input type="number" value="${o.recover}" data-i="${i}" data-k="recover" style="width:80px"></td>
        <td><input type="number" value="${o.extra}" data-i="${i}" data-k="extra" style="width:70px"></td>
        <td><input type="number" value="${o.days}" data-i="${i}" data-k="days" style="width:60px"></td>
        <td><button class="btn btn-sm" data-rm="${i}" type="button">×</button></td></tr>`).join('')
    }</tbody>`;
    calcSunk();
  }
  function calcSunk() {
    const r = num($('skRet').value) / 100 / 30; // daily opportunity rate
    const scored = opts.map((o) => {
      const net = num(o.recover) - num(o.extra);
      const opp = net * r * num(o.days); // cash that could have been compounding elsewhere
      return { ...o, net, opp, score: net - opp };
    }).sort((a, b) => b.score - a.score);
    const paid = num($('skPaid').value);
    $('skOut').innerHTML = `<table><thead><tr><th>Option</th><th class="num">Net cash</th><th class="num">Opportunity cost</th><th class="num">Real value</th></tr></thead><tbody>${
      scored.map((o, i) => `<tr><td>${i === 0 ? '<strong>' : ''}${esc(o.name)}${i === 0 ? '</strong>' : ''}</td><td class="num">${fmt.money(o.net)}</td><td class="num">−${fmt.money(o.opp)}</td><td class="num"><strong>${fmt.money(o.score)}</strong></td></tr>`).join('')
    }</tbody></table>
    ${scored[0] ? `<div class="callout good mt"><p><strong>${esc(scored[0].name)}</strong> is the best move from here. Against what you paid (${fmt.money(paid)}), that's ${fmt.money(scored[0].net - paid)}. That number is for your records. It should not change the decision.</p></div>` : ''}`;
  }

  /* ---------- Growth ---------- */
  function growth() {
    let c = num($('gStart').value); const r = num($('gRate').value) / 100, w = num($('gWithdraw').value), n = Math.min(60, Math.max(1, num($('gMonths').value)));
    const pts = [{ x: 'Start', y: c }];
    for (let i = 1; i <= n; i++) { c = Math.max(0, c * (1 + r) - w); pts.push({ x: `Month ${i}`, y: c }); }
    $('gN').textContent = n; $('gOut').textContent = fmt.money(c);
    FDCharts.line($('gChart'), pts, { format: (v) => fmt.money(v) });
  }

  /* ---------- wire up ---------- */
  function tableEditor(tableId, arr, rerender, recalc) {
    $(tableId).addEventListener('input', (e) => {
      const t = e.target; if (t.dataset.i === undefined) return;
      arr()[t.dataset.i][t.dataset.k] = t.type === 'number' ? num(t.value) : t.value; recalc();
    });
    $(tableId).addEventListener('click', (e) => {
      const b = e.target.closest('[data-rm]'); if (!b) return; arr().splice(+b.dataset.rm, 1); rerender();
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    const s = store.settings();
    $('mbTarget').value = s.targetMarginPct; $('mbRisk').value = s.riskPct; $('gStart').value = s.startingCapital;
    $('mbMode').addEventListener('change', () => { $('mbTarget').value = $('mbMode').value === 'pct' ? s.targetMarginPct : Math.max(num(s.minProfit), 150); maxBuy(); });
    on(['mbSale', 'mbRepair', 'mbSell', 'mbTarget', 'mbRisk', 'mbAsk'], maxBuy); maxBuy();
    $('mbSale').addEventListener('input', () => { $('mbSaleSrc').textContent = 'Typed in by hand. Paste comps below to replace this with real sold prices.'; });
    initComps();
    on(['mBuy', 'mSell', 'mFees', 'mDays'], margin); margin();
    evEvents(); renderEv();
    tableEditor('poTable', () => parts, renderPartout, calcPartout);
    on(['poWhole', 'poWholeCost', 'poRate'], calcPartout);
    $('poAdd').addEventListener('click', () => { parts.push({ name: 'Part', price: 0, fees: 0, hours: 0.5, sell: 90 }); renderPartout(); });
    renderPartout();
    tableEditor('skTable', () => opts, renderSunk, calcSunk);
    on(['skPaid', 'skRet'], calcSunk);
    $('skAdd').addEventListener('click', () => { opts.push({ name: 'Option', recover: 0, extra: 0, days: 7 }); renderSunk(); });
    renderSunk();
    on(['gStart', 'gRate', 'gWithdraw', 'gMonths'], growth); growth();
  });
})();
