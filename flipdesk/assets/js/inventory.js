/* Inventory ledger: items + expenses CRUD, filters, import/export. */
(function () {
  const { store, fmt, esc, num, today, uid, daysBetween, itemCost, itemProfit, isClosed, CATEGORIES, STATUSES, toast, download } = FD;
  const $ = (id) => document.getElementById(id);
  const STATUS_LABEL = { sourcing: 'Sourcing', testing: 'Testing / repair', listed: 'Listed', sold: 'Sold', parted: 'Parted out', 'written-off': 'Written off' };

  function renderItems() {
    const q = $('search').value.toLowerCase();
    const fs = $('fStatus').value, fc = $('fCat').value;
    const all = store.items();
    const list = all
      .filter((i) => (!fs || i.status === fs) && (!fc || i.category === fc) && (!q || `${i.name} ${i.notes} ${i.source}`.toLowerCase().includes(q)))
      .sort((a, b) => (Number(isClosed(a)) - Number(isClosed(b))) || (b.buyDate || '').localeCompare(a.buyDate || ''));

    $('itemSummary').textContent = `${list.length} of ${all.length} items`;
    $('itemsTable').innerHTML = `<thead><tr><th>Item</th><th>Status</th><th>Bought</th><th class="num">Cost</th><th class="num">List</th><th class="num">Sold</th><th class="num">Profit</th><th class="num">ROI</th><th class="num">Days</th><th></th></tr></thead><tbody>${
      list.length ? list.map((i) => {
        const p = itemProfit(i);
        const cost = itemCost(i);
        const days = daysBetween(i.buyDate, i.saleDate || today());
        return `<tr>
          <td><strong>${esc(i.name)}</strong>${i.defect ? ' <span class="badge written-off">defect</span>' : ''}<br><small>${esc(i.category)}${i.source ? ' · ' + esc(i.source) : ''}</small></td>
          <td><span class="badge ${i.status}">${STATUS_LABEL[i.status] || i.status}</span></td>
          <td>${fmt.date(i.buyDate)}</td>
          <td class="num">${fmt.money(cost)}</td>
          <td class="num">${i.listPrice ? fmt.money(num(i.listPrice)) : '—'}</td>
          <td class="num">${isClosed(i) ? fmt.money(num(i.salePrice)) : '—'}</td>
          <td class="num ${p === null ? '' : p >= 0 ? 'pos' : 'neg'}">${p === null ? '—' : fmt.money(p)}</td>
          <td class="num">${p === null || !cost ? '—' : fmt.pct(p / cost * 100, 0)}</td>
          <td class="num ${!isClosed(i) && days > 30 ? 'neg' : ''}">${days ?? '—'}</td>
          <td><button class="btn btn-sm" data-edit="${i.id}" type="button">Edit</button>${!isClosed(i) ? ` <button class="btn btn-sm" data-sell="${i.id}" type="button">Sold</button>` : ''}</td>
        </tr>`;
      }).join('') : '<tr><td colspan="10" class="muted">Nothing here yet. Hit "Log purchase".</td></tr>'
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
  const F = { id: 'iId', name: 'iName', category: 'iCat', status: 'iStatus', source: 'iSource', buyPrice: 'iBuy', buyDate: 'iBuyDate', repairCost: 'iRepair', listPrice: 'iList', salePrice: 'iSale', saleDate: 'iSaleDate', sellCost: 'iSellCost', notes: 'iNotes' };

  function openDialog(item, markSold) {
    const it = item || { id: '', name: '', category: 'GPU', status: 'testing', source: 'FB Marketplace', buyPrice: '', buyDate: today(), repairCost: '', listPrice: '', salePrice: '', saleDate: '', sellCost: '', notes: '', defect: false };
    Object.entries(F).forEach(([k, id]) => { $(id).value = it[k] ?? ''; });
    $('iDefect').checked = !!it.defect;
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
      html += ` Profit: <strong class="${p >= 0 ? 'pos' : 'neg'}">${fmt.money(p, 2)}</strong> · ROI ${cost ? fmt.pct(p / cost * 100) : '—'} · margin ${num($('iSale').value) ? fmt.pct(p / num($('iSale').value) * 100) : '—'}`;
    } else if (cost) {
      const tm = num(s.targetMarginPct) / 100;
      const need = Math.max(cost / (1 - tm), cost + num(s.minProfit));
      html += ` To hit your ${s.targetMarginPct}% margin / ${fmt.money(num(s.minProfit))} minimum, sell for at least <strong>${fmt.money(Math.ceil(need))}</strong> (before selling costs).`;
    }
    $('iPreview').innerHTML = html;
  }

  function saveDialog() {
    const items = store.items();
    const data = {};
    Object.entries(F).forEach(([k, id]) => { data[k] = $(id).value.trim(); });
    ['buyPrice', 'repairCost', 'listPrice', 'salePrice', 'sellCost'].forEach((k) => { data[k] = data[k] === '' ? '' : num(data[k]); });
    data.defect = $('iDefect').checked;
    if (isClosed(data) && !data.saleDate) data.saleDate = today();
    if (data.id) {
      const idx = items.findIndex((i) => i.id === data.id);
      if (idx >= 0) items[idx] = { ...items[idx], ...data };
    } else { data.id = uid(); items.push(data); }
    store.saveItems(items); renderItems(); toast('Saved');
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
      const ed = e.target.closest('[data-edit]'), sd = e.target.closest('[data-sell]');
      const id = ed?.dataset.edit || sd?.dataset.sell; if (!id) return;
      openDialog(store.items().find((i) => i.id === id), !!sd);
    });
    $('itemForm').addEventListener('input', preview);
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

    $('exportJson').addEventListener('click', () => download(`flipdesk-backup-${today()}.json`, JSON.stringify({ version: 1, exported: new Date().toISOString(), settings: store.settings(), items: store.items(), expenses: store.expenses() }, null, 2)));
    $('exportCsv').addEventListener('click', () => {
      const rows = store.items().map((i) => ({ ...i, totalCost: itemCost(i), profit: itemProfit(i) ?? '' }));
      download(`flipdesk-items-${today()}.csv`, toCsv(rows, ['name', 'category', 'status', 'source', 'buyDate', 'buyPrice', 'repairCost', 'totalCost', 'listPrice', 'saleDate', 'salePrice', 'sellCost', 'profit', 'defect', 'notes']), 'text/csv');
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
  }

  document.addEventListener('DOMContentLoaded', init);
})();
