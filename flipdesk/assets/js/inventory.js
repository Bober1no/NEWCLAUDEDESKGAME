/* Inventory ledger: items + expenses CRUD, filters, comps, enquiries, import/export. */
(function () {
  const { store, fmt, esc, num, today, uid, daysBetween, daysHeld, itemCost, itemProfit, itemRoiPerDay, repriceDue, compsStale, isClosed, CATEGORIES, STATUSES, toast, download } = FD;
  const $ = (id) => document.getElementById(id);
  const STATUS_LABEL = { sourcing: 'Sourcing', testing: 'Testing / repair', listed: 'Listed', sold: 'Sold', parted: 'Parted out', 'written-off': 'Written off' };
  const LISTED_QUIET_DAYS = 5; // listed this long with 0 enquiries = something's wrong

  function compsLine(i) {
    if (!i.compsDate && !i.expectedSale) return '';
    const stale = compsStale(i.compsDate);
    return `<br><small>${i.expectedSale ? `exp. ${fmt.money(num(i.expectedSale))}` : ''}${i.compsDate ? ` · comps ${fmt.date(i.compsDate)}` : ' · no comps'}</small>${stale && !isClosed(i) ? ' <span class="badge written-off">stale comps</span>' : ''}`;
  }

  function renderItems() {
    const q = $('search').value.toLowerCase();
    const fs = $('fStatus').value, fc = $('fCat').value;
    const aging = num(store.settings().agingDays) || 14;
    const all = store.items();
    const list = all
      .filter((i) => (!fs || i.status === fs) && (!fc || i.category === fc) && (!q || `${i.name} ${i.notes} ${i.source}`.toLowerCase().includes(q)))
      .sort((a, b) => (Number(isClosed(a)) - Number(isClosed(b))) || (b.buyDate || '').localeCompare(a.buyDate || ''));

    $('itemSummary').textContent = `${list.length} of ${all.length} items`;
    $('itemsTable').innerHTML = `<thead><tr><th>Item</th><th>Status</th><th>Bought</th><th class="num">Cost</th><th class="num">List</th><th class="num">Sold</th><th class="num">Profit</th><th class="num">ROI</th><th class="num" title="Profit ÷ cost ÷ days held">ROI/day</th><th class="num">Days</th><th class="num" title="Enquiries / messages">Enq</th><th></th></tr></thead><tbody>${
      list.length ? list.map((i) => {
        const p = itemProfit(i);
        const cost = itemCost(i);
        const days = daysHeld(i);
        const rpd = itemRoiPerDay(i);
        const due = repriceDue(i);
        const enq = num(i.enquiries);
        const listedDays = i.status === 'listed' ? daysBetween(i.listedDate || i.buyDate, today()) : null;
        const quiet = i.status === 'listed' && enq === 0 && listedDays >= LISTED_QUIET_DAYS;
        return `<tr>
          <td><strong>${esc(i.name)}</strong>${i.defect ? ' <span class="badge written-off">defect</span>' : ''}<br><small>${esc(i.category)}${i.source ? ' · ' + esc(i.source) : ''}</small>${compsLine(i)}</td>
          <td><span class="badge ${i.status}">${STATUS_LABEL[i.status] || i.status}</span>${due ? `<br><span class="badge testing" title="Repricing rule: drop 5–7% at 7 days listed, again at 14">drop price (${due}d)</span>` : ''}</td>
          <td>${fmt.date(i.buyDate)}</td>
          <td class="num">${fmt.money(cost)}</td>
          <td class="num">${i.listPrice ? fmt.money(num(i.listPrice)) : '—'}</td>
          <td class="num">${isClosed(i) ? fmt.money(num(i.salePrice)) : '—'}</td>
          <td class="num ${p === null ? '' : p >= 0 ? 'pos' : 'neg'}">${p === null ? '—' : fmt.money(p)}</td>
          <td class="num">${p === null || !cost ? '—' : fmt.pct(p / cost * 100, 0)}</td>
          <td class="num ${rpd === null ? '' : rpd >= 0 ? '' : 'neg'}">${rpd === null ? '—' : fmt.pct(rpd, 2)}</td>
          <td class="num ${!isClosed(i) && days > aging ? 'neg' : ''}">${days ?? '—'}</td>
          <td class="num ${quiet ? 'neg' : ''}" ${quiet ? `title="Listed ${listedDays} days with no messages"` : ''}>${i.status === 'listed' || enq ? enq : '—'}${i.status === 'listed' ? ` <button class="btn btn-sm" data-enq="${i.id}" type="button" title="Someone messaged">+1</button>` : ''}</td>
          <td style="white-space:nowrap"><button class="btn btn-sm" data-edit="${i.id}" type="button">Edit</button>${!isClosed(i) ? ` <a class="btn btn-sm" href="calculators.html?item=${i.id}" title="Paste comps for this item">Comps</a> <button class="btn btn-sm" data-sell="${i.id}" type="button">Sold</button>` : ''}</td>
        </tr>`;
      }).join('') : '<tr><td colspan="12" class="muted">Nothing here yet. Hit "Log purchase".</td></tr>'
    }</tbody>`;
  }

  function renderExpenses() {
    const list = store.expenses().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const total = list.reduce((s, e) => s + num(e.amount), 0);
    $('expTable').innerHTML = `<thead><tr><th>Date</th><th>Description</th><th>Category</th><th class="num">Amount</th><th></th></tr></thead><tbody>${
      list.length ? list.map((e) => `<tr><td>${fmt.date(e.date)}</td><td>${esc(e.desc)}</td><td>${esc(e.category)}</td><td class="num">${fmt.money(num(e.amount), 2)}</td><td><button class="btn btn-sm btn-danger" data-delexp="${e.id}" type="button">Delete</button></td></tr>`).join('')
        + `<tr><td colspan="3"><strong>Total</strong></td><td class="num"><strong>${fmt.money(total, 2)}</strong></td><td></td></tr>`
        : '<tr><td colspan="5" class="muted">No expenses logged.</td></tr>'
    }</tbody>`;
  }

  /* ---------- dialog ---------- */
  const F = { id: 'iId', name: 'iName', category: 'iCat', status: 'iStatus', source: 'iSource', buyPrice: 'iBuy', buyDate: 'iBuyDate', repairCost: 'iRepair', expectedSale: 'iExp', listPrice: 'iList', salePrice: 'iSale', saleDate: 'iSaleDate', sellCost: 'iSellCost', enquiries: 'iEnq', notes: 'iNotes' };

  function fillCompsSelect(currentId) {
    const all = FDComps.list();
    const opts = all.slice(0, 30);
    if (currentId && !opts.some((c) => c.id === currentId)) { const c = FDComps.get(currentId); if (c) opts.unshift(c); }
    $('iComps').innerHTML = '<option value="">None</option>' + opts.map((c) => `<option value="${c.id}">${esc(c.data.item)} · ${fmt.money(c.stats.expectedSale)} · ${fmt.date(c.data.date)}${compsStale(c.data.date) ? ' (stale)' : ''}</option>`).join('');
    $('iComps').value = currentId && opts.some((c) => c.id === currentId) ? currentId : '';
  }

  function compsInfo(date) {
    if (!date) { $('iCompsInfo').innerHTML = 'No comps attached. Expected sale is a guess.'; return; }
    $('iCompsInfo').innerHTML = `Comps from ${fmt.date(date)}${compsStale(date) ? ' <span class="badge written-off">stale, over 30 days</span>' : ''}`;
  }

  function openDialog(item, markSold, presetComps) {
    const it = item || { id: '', name: '', category: 'GPU', status: 'testing', source: 'FB Marketplace', buyPrice: '', buyDate: today(), repairCost: '', expectedSale: '', listPrice: '', salePrice: '', saleDate: '', sellCost: '', enquiries: '', notes: '', defect: false };
    Object.entries(F).forEach(([k, id]) => { $(id).value = it[k] ?? ''; });
    $('iDefect').checked = !!it.defect;
    fillCompsSelect(it.compsId);
    compsInfo(it.compsDate);
    if (presetComps) {
      fillCompsSelect(presetComps.id);
      if (!$('iName').value) $('iName').value = presetComps.data.item;
      $('iExp').value = Math.round(presetComps.stats.expectedSale);
      compsInfo(presetComps.data.date);
    }
    if (markSold) { $('iStatus').value = 'sold'; if (!$('iSaleDate').value) $('iSaleDate').value = today(); if (!$('iSale').value && it.listPrice) $('iSale').value = it.listPrice; }
    $('dlgTitle').textContent = item ? (markSold ? 'Mark as sold' : 'Edit item') : 'Log purchase';
    $('iDelete').classList.toggle('hide', !item);
    preview();
    $('itemDialog').returnValue = '';
    $('itemDialog').showModal();
    (markSold ? $('iSale') : $('iName')).focus();
  }

  function preview() {
    const cost = num($('iBuy').value) + num($('iRepair').value);
    const s = store.settings();
    const status = $('iStatus').value;
    let html = `Total cost: <strong>${fmt.money(cost, 2)}</strong>.`;
    if (['sold', 'parted', 'written-off'].includes(status) && $('iSale').value !== '') {
      const p = num($('iSale').value) - cost - num($('iSellCost').value);
      const d = Math.max(1, daysBetween($('iBuyDate').value, $('iSaleDate').value || today()) ?? 1);
      html += ` Profit: <strong class="${p >= 0 ? 'pos' : 'neg'}">${fmt.money(p, 2)}</strong> · ROI ${cost ? fmt.pct(p / cost * 100) : '—'} · ${cost ? fmt.pct(p / cost / d * 100, 2) : '—'}/day over ${d} day${d === 1 ? '' : 's'} · margin ${num($('iSale').value) ? fmt.pct(p / num($('iSale').value) * 100) : '—'}`;
    } else if (cost) {
      const tm = num(s.targetMarginPct) / 100;
      const need = Math.max(cost / (1 - tm), cost + num(s.minProfit));
      html += ` To hit your ${s.targetMarginPct}% margin / ${fmt.money(num(s.minProfit))} minimum, sell for at least <strong>${fmt.money(Math.ceil(need))}</strong> (before selling costs).`;
      const exp = num($('iExp').value);
      if (exp) html += ` Comps say about <strong>${fmt.money(exp)}</strong>${exp < need ? ' <span class="neg">— below what you need</span>' : ''}.`;
    }
    $('iPreview').innerHTML = html;
  }

  function saveDialog() {
    const items = store.items();
    const data = {};
    Object.entries(F).forEach(([k, id]) => { data[k] = $(id).value.trim(); });
    ['buyPrice', 'repairCost', 'expectedSale', 'listPrice', 'salePrice', 'sellCost', 'enquiries'].forEach((k) => { data[k] = data[k] === '' ? '' : num(data[k]); });
    data.defect = $('iDefect').checked;
    if (isClosed(data) && !data.saleDate) data.saleDate = today();
    const prev = data.id ? items.find((i) => i.id === data.id) : null;

    // Comps link: carry the comps date so staleness can be flagged later.
    const chosen = $('iComps').value ? FDComps.get($('iComps').value) : null;
    if (chosen) { data.compsId = chosen.id; data.compsDate = chosen.data.date; }
    else if (prev && prev.compsId && !FDComps.get(prev.compsId)) { data.compsId = prev.compsId; data.compsDate = prev.compsDate; } // saved comps deleted; keep the record
    else { data.compsId = ''; data.compsDate = ''; }

    // Listing clock for the repricing rule.
    if (data.status === 'listed') {
      // Items listed before listedDate existed fall back to their buy date rather than restarting the clock.
      data.listedDate = prev?.listedDate || (prev?.status === 'listed' ? prev.buyDate : '') || today();
      data.lastRepriced = prev?.lastRepriced || '';
      if (prev && prev.status === 'listed' && num(prev.listPrice) && num(data.listPrice) !== num(prev.listPrice)) data.lastRepriced = today();
    }

    if (prev) Object.assign(prev, data);
    else { data.id = uid(); items.push(data); }
    store.saveItems(items);
    if (chosen && !chosen.itemId) FDComps.link(chosen.id, prev ? prev.id : data.id); // expected sale stays as typed in the dialog
    renderItems(); toast('Saved');
  }

  function toCsv(rows, cols) {
    const q = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    return [cols.join(','), ...rows.map((r) => cols.map((c) => q(r[c])).join(','))].join('\n');
  }

  function init() {
    $('fStatus').innerHTML += STATUSES.map((s) => `<option value="${s}">${STATUS_LABEL[s]}</option>`).join('');
    $('fCat').innerHTML += CATEGORIES.map((c) => `<option>${c}</option>`).join('');
    $('iCat').innerHTML = CATEGORIES.map((c) => `<option>${c}</option>`).join('');
    $('iStatus').innerHTML = STATUSES.map((s) => `<option value="${s}">${STATUS_LABEL[s]}</option>`).join('');
    $('eDate').value = today();

    ['search', 'fStatus', 'fCat'].forEach((id) => $(id).addEventListener('input', renderItems));
    $('addItem').addEventListener('click', () => openDialog(null));
    $('itemsTable').addEventListener('click', (e) => {
      const enq = e.target.closest('[data-enq]');
      if (enq) {
        const items = store.items(); const it = items.find((i) => i.id === enq.dataset.enq);
        if (it) { it.enquiries = num(it.enquiries) + 1; store.saveItems(items); renderItems(); }
        return;
      }
      const ed = e.target.closest('[data-edit]'), sd = e.target.closest('[data-sell]');
      const id = ed?.dataset.edit || sd?.dataset.sell; if (!id) return;
      openDialog(store.items().find((i) => i.id === id), !!sd);
    });
    $('itemForm').addEventListener('input', preview);
    $('iComps').addEventListener('change', () => {
      const c = $('iComps').value ? FDComps.get($('iComps').value) : null;
      if (c) { $('iExp').value = Math.round(c.stats.expectedSale); compsInfo(c.data.date); } else compsInfo('');
      preview();
    });
    $('itemDialog').addEventListener('close', () => {
      const v = $('itemDialog').returnValue;
      if (v === 'save') saveDialog();
      if (v === 'delete' && confirm('Delete this item?')) { store.saveItems(store.items().filter((i) => i.id !== $('iId').value)); renderItems(); }
    });
    $('itemForm').addEventListener('submit', (e) => {
      if (e.submitter?.value === 'save' && !$('itemForm').checkValidity()) { e.preventDefault(); $('itemForm').reportValidity(); }
    });

    $('expForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const list = store.expenses();
      list.push({ id: uid(), date: $('eDate').value, desc: $('eDesc').value.trim(), category: $('eCat').value, amount: num($('eAmt').value) });
      store.saveExpenses(list); $('eDesc').value = ''; $('eAmt').value = ''; renderExpenses(); toast('Expense added');
    });
    $('expTable').addEventListener('click', (e) => {
      const b = e.target.closest('[data-delexp]'); if (!b) return;
      store.saveExpenses(store.expenses().filter((x) => x.id !== b.dataset.delexp)); renderExpenses();
    });

    $('exportJson').addEventListener('click', () => download(`flipdesk-backup-${today()}.json`, JSON.stringify({ version: 2, exported: new Date().toISOString(), settings: store.settings(), items: store.items(), expenses: store.expenses(), comps: FDComps.list() }, null, 2)));
    $('exportCsv').addEventListener('click', () => {
      const rows = store.items().map((i) => ({ ...i, totalCost: itemCost(i), profit: itemProfit(i) ?? '', roiPerDayPct: itemRoiPerDay(i)?.toFixed(3) ?? '', daysHeld: daysHeld(i) ?? '' }));
      download(`flipdesk-items-${today()}.csv`, toCsv(rows, ['name', 'category', 'status', 'source', 'buyDate', 'buyPrice', 'repairCost', 'totalCost', 'expectedSale', 'compsDate', 'listedDate', 'listPrice', 'enquiries', 'saleDate', 'salePrice', 'sellCost', 'profit', 'daysHeld', 'roiPerDayPct', 'defect', 'notes']), 'text/csv');
    });
    $('exportExpCsv').addEventListener('click', () => download(`flipdesk-expenses-${today()}.csv`, toCsv(store.expenses(), ['date', 'desc', 'category', 'amount']), 'text/csv'));
    $('importFile').addEventListener('change', async (e) => {
      const file = e.target.files[0]; if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        if (!Array.isArray(data.items)) throw new Error('No items array');
        if (!confirm(`Replace current data with ${data.items.length} items and ${(data.expenses || []).length} expenses from this backup?`)) return;
        store.saveItems(data.items); store.saveExpenses(data.expenses || []);
        if (data.settings) store.saveSettings(data.settings);
        if (Array.isArray(data.comps)) store.set('fd.comps', data.comps);
        renderItems(); renderExpenses(); toast('Backup restored');
      } catch (err) { alert('That file is not a valid FlipDesk backup: ' + err.message); }
      e.target.value = '';
    });
    $('wipe').addEventListener('click', () => {
      if (confirm('Delete ALL items and expenses? Export a backup first if you want them.') && confirm('Really? This cannot be undone.')) {
        store.saveItems([]); store.saveExpenses([]); renderItems(); renderExpenses(); toast('Cleared');
      }
    });

    renderItems(); renderExpenses();

    // Arrived from "Log purchase with these comps" on the Max buy tab.
    const cid = new URLSearchParams(location.search).get('comps');
    if (cid) {
      const c = FDComps.get(cid);
      if (c) { document.querySelector('.tab[data-tab="items"]').click(); openDialog(null, false, c); }
      history.replaceState(null, '', location.pathname);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
