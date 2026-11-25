/* Dashboard: KPIs, charts, alerts, settings. */
(function () {
  const { store, fmt, esc, num, today, daysBetween, itemCost, itemProfit, isClosed, computeStats, repriceDue, compsStale } = FD;
  const $ = (id) => document.getElementById(id);
  const MIN_DEALS_FOR_MARGIN = 5; // one breakeven sale says nothing about pricing
  const SETTING_FIELDS = ['businessName', 'startingCapital', 'reservePct', 'targetMarginPct', 'minProfit', 'riskPct', 'suburb', 'state', 'fbCity', 'radiusKm', 'transport', 'agingDays'];

  function tile(label, value, sub, cls = '') {
    return `<div class="card stat"><div class="label">${label}</div><div class="value ${cls}">${value}</div><div class="sub">${sub}</div></div>`;
  }

  function render() {
    const s = store.settings();
    const items = store.items();
    const expenses = store.expenses();
    const st = computeStats(items, expenses, s);
    $('emptyState').classList.toggle('hide', items.length > 0);

    $('tiles').innerHTML = [
      tile('Net profit', fmt.money(st.netProfit), `${fmt.pct(st.returnOnCapital)} on starting capital`, st.netProfit >= 0 ? 'pos' : 'neg'),
      tile('Cash available', fmt.money(st.cash), `Reserve target ${fmt.money(st.reserveTarget)}`, st.cash < st.reserveTarget ? 'neg' : ''),
      tile('Inventory at cost', fmt.money(st.inventoryCost), `${st.openCount} unsold item${st.openCount === 1 ? '' : 's'}`),
      tile('Business value', fmt.money(st.equity), 'Cash + inventory at cost'),
      tile('Gross margin', fmt.pct(st.grossMargin), st.closedCount < MIN_DEALS_FOR_MARGIN ? `Target ${s.targetMarginPct}% · ${st.closedCount}/${MIN_DEALS_FOR_MARGIN} deals before judging` : `Target ${s.targetMarginPct}% · revenue ${fmt.money(st.revenue)}`, st.closedCount >= MIN_DEALS_FOR_MARGIN && Number.isFinite(st.grossMargin) && st.grossMargin < num(s.targetMarginPct) ? 'neg' : ''),
      tile('Avg profit / item', fmt.money(st.avgProfit), `Avg ROI ${fmt.pct(st.avgRoi)} · win rate ${fmt.pct(st.winRate, 0)}`),
      tile('ROI per day', fmt.pct(st.roiPerDay, 2), Number.isFinite(st.roiPerDay) ? `Profit ÷ cost ÷ days · ≈${fmt.pct(st.roiPerDay * 30, 0)}/month` : 'Profit ÷ cost ÷ days, closed deals', st.roiPerDay < 0 ? 'neg' : ''),
      tile('Avg days to sell', fmt.num(st.avgHold, 0), `Turnover ~${fmt.num(st.turnover, 1)}× / yr`),
      tile('Conversion', fmt.pct(st.conversion), st.enquiries ? `${st.trackedSales} sale${st.trackedSales === 1 ? '' : 's'} from ${st.enquiries} enquiries` : 'Log enquiries with +1 in Inventory'),
      tile('Defect rate', fmt.pct(st.defectRate), `Risk allowance ${s.riskPct}% of sale`, st.defectRate > num(s.riskPct) * 1.5 ? 'neg' : ''),
    ].join('');

    // Cumulative profit series (deals by sale date minus expenses by date)
    const events = [];
    items.filter(isClosed).forEach((i) => events.push({ date: i.saleDate || i.buyDate || today(), v: itemProfit(i), label: i.name }));
    expenses.forEach((e) => events.push({ date: e.date || today(), v: -num(e.amount), label: e.desc }));
    events.sort((a, b) => a.date.localeCompare(b.date));
    let run = 0;
    const pts = events.map((e) => { run += e.v; return { x: fmt.date(e.date), y: run, label: e.label }; });
    FDCharts.line($('profitChart'), pts, { format: (v) => fmt.money(v) });

    const cats = st.categories.filter((c) => c.closed > 0);
    FDCharts.hbars($('catChart'), cats.map((c) => ({ label: c.category, value: c.profit, detail: `${fmt.money(c.profit)} from ${c.closed} sale${c.closed === 1 ? '' : 's'} · ${fmt.pct(c.margin, 0)} margin` })), { format: (v) => fmt.money(v) });

    $('catTable').innerHTML = `<thead><tr><th>Category</th><th class="num">Items</th><th class="num">Sold</th><th class="num">Revenue</th><th class="num">Profit</th><th class="num">Margin</th><th class="num">ROI</th><th class="num">ROI/day</th><th class="num">Avg days</th><th class="num">Defects</th></tr></thead><tbody>${
      st.categories.length ? st.categories.map((c) => `<tr><td>${esc(c.category)}</td><td class="num">${c.count}</td><td class="num">${c.closed}</td><td class="num">${fmt.money(c.revenue)}</td><td class="num ${c.profit < 0 ? 'neg' : ''}">${fmt.money(c.profit)}</td><td class="num">${fmt.pct(c.margin, 0)}</td><td class="num">${fmt.pct(c.roi, 0)}</td><td class="num ${c.roiPerDay < 0 ? 'neg' : ''}">${fmt.pct(c.roiPerDay, 2)}</td><td class="num">${fmt.num(c.avgDays, 0)}</td><td class="num">${fmt.pct(c.defectRate, 0)}</td></tr>`).join('')
        : '<tr><td colspan="10" class="muted">No items logged yet.</td></tr>'
    }</tbody>`;

    // Alerts
    const alerts = [];
    if (items.length && st.cash < st.reserveTarget) alerts.push(['bad', `Cash (${fmt.money(st.cash)}) is below your reserve target (${fmt.money(st.reserveTarget)}). Stop buying and sell stock first.`]);
    const aging = num(s.agingDays) || 14;
    const names = (list) => list.slice(0, 4).map((i) => esc(i.name)).join(', ') + (list.length > 4 ? ` and ${list.length - 4} more` : '');
    const old = items.filter((i) => !isClosed(i) && daysBetween(i.buyDate, today()) > aging);
    if (old.length) alerts.push(['bad', `${old.length} item${old.length === 1 ? ' has' : 's have'} been held for over ${aging} days: ${names(old)}. That cash should be in the next deal. Cut the price or use the Price my item mode in the <a href="prompt.html?mode=price">Prompt Builder</a>. What you paid doesn't matter now (sunk cost).`]);
    const drop14 = items.filter((i) => repriceDue(i) === 14), drop7 = items.filter((i) => repriceDue(i) === 7);
    if (drop14.length) alerts.push(['bad', `Second price drop due (14+ days listed): ${names(drop14)}. Drop another 5–7%, or rewrite the listing if it isn't getting messages.`]);
    if (drop7.length) alerts.push(['warn', `Price drop due (7+ days listed): ${names(drop7)}. Drop 5–7%. Editing the list price in Inventory clears this.`]);
    const listed = items.filter((i) => i.status === 'listed');
    const quiet = listed.filter((i) => !num(i.enquiries) && daysBetween(i.listedDate || i.buyDate, today()) >= 5);
    if (quiet.length) alerts.push(['warn', `No messages after 5+ days listed: ${names(quiet)}. Nobody is even asking, so the price is too high for what buyers see, or the title/photos aren't getting clicks. Check comps and use the <a href="listing.html">Listing Writer</a>.`]);
    const chatty = listed.filter((i) => num(i.enquiries) >= 10);
    if (chatty.length) alerts.push(['warn', `Lots of messages but no sale: ${names(chatty)}. The price is pulling people in, so something later is losing them: slow replies, awkward pickup, lowballers you're right to refuse, or the item looks worse in person. If the messages are mostly lowball offers, your list price is anchoring them low.`]);
    const staleComps = items.filter((i) => !isClosed(i) && compsStale(i.compsDate));
    if (staleComps.length) alerts.push(['warn', `Comps over 30 days old on unsold stock: ${names(staleComps)}. Re-run comps before you set or cut the price.`]);
    const losers = items.filter((i) => isClosed(i) && itemProfit(i) < 0);
    if (losers.length) alerts.push(['warn', `${losers.length} deal${losers.length === 1 ? '' : 's'} lost money, ${fmt.money(losers.reduce((s, i) => s + itemProfit(i), 0))} in total. Look for a pattern: same category, same platform, skipped testing?`]);
    if (st.closedCount >= MIN_DEALS_FOR_MARGIN && Number.isFinite(st.grossMargin) && st.grossMargin < num(s.targetMarginPct)) alerts.push(['warn', `Gross margin of ${fmt.pct(st.grossMargin)} over ${st.closedCount} deals is under your ${s.targetMarginPct}% target. You're either paying too much or selling too cheap.`]);
    const unlisted = items.filter((i) => ['sourcing', 'testing'].includes(i.status) && daysBetween(i.buyDate, today()) > 7);
    if (unlisted.length) alerts.push(['warn', `${unlisted.length} item${unlisted.length === 1 ? ' has' : 's have'} been sitting unlisted for over a week. Stock that isn't listed can't sell.`]);
    if (!alerts.length) alerts.push(['good', items.length ? 'Nothing to flag. Keep logging every deal.' : 'Log some deals and warnings will show up here.']);
    $('alerts').innerHTML = alerts.map(([c, t]) => `<div class="callout ${c}"><p>${t}</p></div>`).join('');

    // Buckets
    const cap = num(s.startingCapital);
    const reserve = cap * num(s.reservePct) / 100;
    $('buckets').innerHTML = `
      <dt>Inventory budget (target)</dt><dd>${fmt.money(cap - reserve - cap * 0.1)}</dd>
      <dt>Cash reserve (target)</dt><dd>${fmt.money(reserve)}</dd>
      <dt>Operating budget (~10%)</dt><dd>${fmt.money(cap * 0.1)}</dd>
      <dt class="total">Actually in stock now</dt><dd class="total">${fmt.money(st.inventoryCost)}</dd>
      <dt>Actually in cash now</dt><dd>${fmt.money(st.cash)}</dd>`;
    const pct = st.reserveTarget > 0 ? Math.max(0, Math.min(100, st.cash / st.reserveTarget * 100)) : 100;
    $('reserveBar').style.width = pct + '%';
    $('reserveNote').textContent = `Cash is at ${fmt.pct(st.cash / (st.reserveTarget || 1) * 100, 0)} of your reserve target.`;
  }

  function initSettings() {
    const s = store.settings();
    SETTING_FIELDS.forEach((k) => { const el = $(k); if (el) el.value = s[k]; });
    $('settingsForm').addEventListener('input', () => {
      const next = store.settings();
      SETTING_FIELDS.forEach((k) => { const el = $(k); next[k] = el.type === 'number' ? num(el.value) : el.value; });
      store.saveSettings(next); render();
    });
  }

  function demo() {
    const d = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
    const mk = (o) => Object.assign({ id: FD.uid(), repairCost: 0, sellCost: 0, defect: false, notes: '', source: 'FB Marketplace' }, o);
    store.saveItems([
      mk({ enquiries: 4, name: 'RTX 3060 12GB (Gigabyte)', category: 'GPU', status: 'sold', buyPrice: 230, buyDate: d(70), salePrice: 330, saleDate: d(62), sellCost: 5, repairCost: 8, notes: 'Repasted' }),
      mk({ enquiries: 7, name: 'Office i5-8500 + GTX 1070 build', category: 'Desktop PC', status: 'sold', buyPrice: 260, buyDate: d(58), salePrice: 520, saleDate: d(41), repairCost: 95, sellCost: 10, notes: 'Added 500GB NVMe + new case fans' }),
      mk({ enquiries: 3, name: 'iPhone 12 128GB', category: 'Phone', status: 'sold', buyPrice: 380, buyDate: d(45), salePrice: 470, saleDate: d(39), sellCost: 0 }),
      mk({ name: 'RX 580 8GB (untested)', category: 'GPU', status: 'written-off', buyPrice: 60, buyDate: d(40), salePrice: 15, saleDate: d(30), defect: true, notes: 'Artifacting, sold for parts' }),
      mk({ enquiries: 5, name: 'Ryzen 5 5600 + B550 combo', category: 'CPU', status: 'sold', buyPrice: 170, buyDate: d(30), salePrice: 255, saleDate: d(19), sellCost: 4 }),
      mk({ enquiries: 6, name: 'ThinkPad T480 i5 16GB', category: 'Laptop', status: 'sold', buyPrice: 190, buyDate: d(25), salePrice: 300, saleDate: d(12), repairCost: 35, notes: 'New battery' }),
      mk({ name: 'Gaming PC R5 3600 / RTX 2070', category: 'Desktop PC', status: 'listed', buyPrice: 520, buyDate: d(16), listedDate: d(12), listPrice: 790, repairCost: 20, enquiries: 11, expectedSale: 760, compsDate: d(17) }),
      mk({ name: 'RTX 3070 FE', category: 'GPU', status: 'testing', buyPrice: 340, buyDate: d(3), expectedSale: 450, compsDate: d(4) }),
      mk({ name: 'iPhone 11 64GB', category: 'Phone', status: 'listed', buyPrice: 230, buyDate: d(38), listedDate: d(33), listPrice: 310, enquiries: 0, defect: true, notes: 'Battery 78%', expectedSale: 300, compsDate: d(40) }),
    ]);
    store.saveExpenses([
      { id: FD.uid(), date: d(60), desc: 'Thermal paste + isopropyl', amount: 28, category: 'Supplies' },
      { id: FD.uid(), date: d(35), desc: 'Fuel for pickups', amount: 60, category: 'Transport' },
      { id: FD.uid(), date: d(10), desc: 'Anti-static mat', amount: 25, category: 'Equipment' },
    ]);
    render(); FD.toast('Demo data loaded. Clear it from Inventory when you\'re done.');
  }

  document.addEventListener('DOMContentLoaded', () => {
    initSettings(); render();
    $('loadDemo').addEventListener('click', demo);
  });
})();
