/* FlipDesk core: storage, settings, formatting, nav, theme, business maths. */
(function () {
  const KEYS = {
    items: 'fd.items',
    expenses: 'fd.expenses',
    settings: 'fd.settings',
    theme: 'fd.theme',
  };

  const DEFAULT_SETTINGS = {
    businessName: 'FlipDesk',
    startingCapital: 2000,
    reservePct: 20,
    targetMarginPct: 25,
    minProfit: 60,
    riskPct: 8,
    suburb: '',
    state: 'VIC',
    fbCity: 'melbourne',
    radiusKm: 30,
    transport: 'car',
    agingDays: 14,
  };

  const CATEGORIES = ['Desktop PC', 'GPU', 'CPU', 'Motherboard', 'RAM', 'Storage', 'PSU', 'Laptop', 'Phone', 'Tablet', 'Console', 'Monitor', 'Peripherals', 'Other'];
  const STATUSES = ['sourcing', 'testing', 'listed', 'sold', 'parted', 'written-off'];

  function safeGet(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function safeSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { toast('Could not save — browser storage is blocked'); return false; }
  }

  const store = {
    items: () => safeGet(KEYS.items, []),
    saveItems: (v) => safeSet(KEYS.items, v),
    expenses: () => safeGet(KEYS.expenses, []),
    saveExpenses: (v) => safeSet(KEYS.expenses, v),
    settings: () => Object.assign({}, DEFAULT_SETTINGS, safeGet(KEYS.settings, {})),
    saveSettings: (v) => safeSet(KEYS.settings, v),
    get: safeGet,
    set: safeSet,
  };

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
  // Local calendar date (toISOString would give UTC, i.e. yesterday in Australia before ~11am).
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const daysBetween = (a, b) => {
    if (!a || !b) return null;
    return Math.max(0, Math.round((new Date(b) - new Date(a)) / 86400000));
  };

  const fmt = {
    money(n, dp = 0) {
      if (!Number.isFinite(n)) return '—';
      const s = Math.abs(n).toLocaleString('en-AU', { minimumFractionDigits: dp, maximumFractionDigits: dp });
      return (n < 0 ? '-$' : '$') + s;
    },
    pct(n, dp = 1) { return Number.isFinite(n) ? n.toFixed(dp) + '%' : '—'; },
    num(n, dp = 1) { return Number.isFinite(n) ? n.toFixed(dp) : '—'; },
    date(d) { return d ? new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: '2-digit' }) : '—'; },
  };

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- Business maths ---------- */
  function itemCost(it) { return num(it.buyPrice) + num(it.repairCost); }
  function itemProfit(it) {
    if (it.status === 'sold' || it.status === 'parted') return num(it.salePrice) - itemCost(it) - num(it.sellCost);
    if (it.status === 'written-off') return num(it.salePrice) - itemCost(it) - num(it.sellCost);
    return null;
  }
  const isClosed = (it) => ['sold', 'parted', 'written-off'].includes(it.status);

  /** Days the item's capital was (or has been) tied up. Minimum 1 so same-day flips don't divide by zero. */
  function daysHeld(it) {
    const d = daysBetween(it.buyDate, isClosed(it) ? (it.saleDate || today()) : today());
    return d === null ? null : Math.max(1, d);
  }

  /** Capital velocity: profit ÷ cost ÷ days, as a % per day. Closed items only. */
  function itemRoiPerDay(it) {
    const p = itemProfit(it), c = itemCost(it), d = daysHeld(it);
    if (p === null || !c || d === null) return null;
    return p / c / d * 100;
  }

  /**
   * Repricing rule: drop 5–7% at 7 days listed, again at 14.
   * Returns 14, 7 or null depending on which drop is due and hasn't been done yet.
   * A drop counts as done if the list price was changed on/after that day.
   */
  function repriceDue(it) {
    if (it.status !== 'listed') return null;
    const listed = it.listedDate || it.buyDate;
    const days = daysBetween(listed, today());
    if (days === null) return null;
    const repricedAt = it.lastRepriced ? daysBetween(listed, it.lastRepriced) : -1;
    if (days >= 14 && repricedAt < 14) return 14;
    if (days >= 7 && repricedAt < 7) return 7;
    return null;
  }

  const COMPS_STALE_DAYS = 30;
  const compsStale = (date) => !!date && daysBetween(date, today()) > COMPS_STALE_DAYS;

  function computeStats(items, expenses, settings) {
    const closed = items.filter(isClosed);
    const open = items.filter((i) => !isClosed(i));
    const revenue = closed.reduce((s, i) => s + num(i.salePrice), 0);
    const cogs = closed.reduce((s, i) => s + itemCost(i), 0);
    const sellCosts = closed.reduce((s, i) => s + num(i.sellCost), 0);
    const opex = expenses.reduce((s, e) => s + num(e.amount), 0);
    const grossProfit = revenue - cogs - sellCosts;
    const netProfit = grossProfit - opex;
    const inventoryCost = open.reduce((s, i) => s + itemCost(i), 0);
    const allSpend = items.reduce((s, i) => s + itemCost(i), 0);
    const cash = num(settings.startingCapital) + revenue - sellCosts - allSpend - opex;
    const equity = cash + inventoryCost;
    const holds = closed.map((i) => daysBetween(i.buyDate, i.saleDate)).filter((d) => d !== null);
    const avgHold = holds.length ? holds.reduce((a, b) => a + b, 0) / holds.length : NaN;
    const defects = items.filter((i) => i.defect).length;
    const profits = closed.map(itemProfit);
    const wins = profits.filter((p) => p > 0).length;
    const avgProfit = profits.length ? profits.reduce((a, b) => a + b, 0) / profits.length : NaN;
    const avgRoi = closed.length ? closed.reduce((s, i) => s + (itemCost(i) ? itemProfit(i) / itemCost(i) : 0), 0) / closed.length * 100 : NaN;

    // Turnover: COGS over the last 365 days / current inventory at cost (rough proxy for average inventory).
    const yearAgo = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
    const cogs365 = closed.filter((i) => (i.saleDate || '') >= yearAgo).reduce((s, i) => s + itemCost(i), 0);
    const turnover = inventoryCost > 0 ? cogs365 / inventoryCost : NaN;

    const reserveTarget = num(settings.startingCapital) * num(settings.reservePct) / 100;

    // Capital-weighted ROI per day: total profit ÷ total (cost × days held). Big slow items weigh more than small quick ones.
    const velocity = (list) => {
      let p = 0, cd = 0;
      for (const i of list) { const c = itemCost(i), d = daysHeld(i); if (!c || d === null) continue; p += itemProfit(i); cd += c * d; }
      return cd ? p / cd * 100 : NaN;
    };
    const roiPerDay = velocity(closed);

    // Conversion: sales ÷ enquiries, over items where enquiries were actually tracked.
    const tracked = items.filter((i) => num(i.enquiries) > 0);
    const enquiries = tracked.reduce((s, i) => s + num(i.enquiries), 0);
    const trackedSales = tracked.filter((i) => i.status === 'sold' || i.status === 'parted').length;
    const conversion = enquiries ? trackedSales / enquiries * 100 : NaN;

    const byCat = {};
    for (const i of items) {
      const c = i.category || 'Other';
      byCat[c] = byCat[c] || { category: c, count: 0, closed: 0, revenue: 0, profit: 0, cost: 0, days: [], defects: 0 };
      const b = byCat[c];
      b.count++;
      if (i.defect) b.defects++;
      if (isClosed(i)) {
        b.closed++; b.revenue += num(i.salePrice); b.profit += itemProfit(i); b.cost += itemCost(i);
        const d = daysBetween(i.buyDate, i.saleDate); if (d !== null) b.days.push(d);
      }
    }
    const categories = Object.values(byCat).map((b) => ({
      ...b,
      margin: b.revenue ? b.profit / b.revenue * 100 : NaN,
      roi: b.cost ? b.profit / b.cost * 100 : NaN,
      avgDays: b.days.length ? b.days.reduce((x, y) => x + y, 0) / b.days.length : NaN,
      defectRate: b.count ? b.defects / b.count * 100 : NaN,
      roiPerDay: velocity(closed.filter((i) => (i.category || 'Other') === b.category)),
    })).sort((a, b) => b.profit - a.profit);

    return {
      count: items.length, closedCount: closed.length, openCount: open.length,
      revenue, cogs, sellCosts, opex, grossProfit, netProfit,
      grossMargin: revenue ? grossProfit / revenue * 100 : NaN,
      netMargin: revenue ? netProfit / revenue * 100 : NaN,
      inventoryCost, cash, equity, avgHold, avgProfit, avgRoi,
      defectRate: items.length ? defects / items.length * 100 : NaN,
      winRate: closed.length ? wins / closed.length * 100 : NaN,
      turnover, reserveTarget, categories, roiPerDay, conversion, enquiries, trackedSales,
      returnOnCapital: num(settings.startingCapital) ? netProfit / num(settings.startingCapital) * 100 : NaN,
    };
  }

  /** Short plain-text snapshot of the business, for prompts. */
  function businessSnapshot() {
    const s = store.settings();
    const st = computeStats(store.items(), store.expenses(), s);
    if (!st.count) return `No sales history yet. Starting capital: ${fmt.money(num(s.startingCapital))}.`;
    const lines = [
      `Starting capital: ${fmt.money(num(s.startingCapital))} | Cash now: ${fmt.money(st.cash)} | Inventory at cost: ${fmt.money(st.inventoryCost)} (${st.openCount} items)`,
      `Closed deals: ${st.closedCount} | Revenue: ${fmt.money(st.revenue)} | Net profit: ${fmt.money(st.netProfit)} | Gross margin: ${fmt.pct(st.grossMargin)}`,
      `Avg profit/item: ${fmt.money(st.avgProfit)} | Avg ROI/item: ${fmt.pct(st.avgRoi)} | ROI per day (capital-weighted): ${fmt.pct(st.roiPerDay, 2)} | Avg days to sell: ${fmt.num(st.avgHold, 0)} | Defect rate: ${fmt.pct(st.defectRate)} | Win rate: ${fmt.pct(st.winRate)}`,
      `Enquiry conversion: ${Number.isFinite(st.conversion) ? `${fmt.pct(st.conversion)} (${st.trackedSales} sales from ${st.enquiries} enquiries)` : 'not tracked yet'}`,
    ];
    const cats = st.categories.filter((c) => c.closed > 0).slice(0, 6);
    if (cats.length) {
      lines.push('By category: ' + cats.map((c) => `${c.category} — ${c.closed} sold, ${fmt.money(c.profit)} profit, ${fmt.pct(c.margin, 0)} margin, ${fmt.pct(c.roiPerDay, 2)}/day, ~${fmt.num(c.avgDays, 0)} days`).join('; '));
    }
    return lines.join('\n');
  }

  /* ---------- UI: nav, theme, toast ---------- */
  const PAGES = [
    ['index.html', 'Dashboard'],
    ['prompt.html', 'Prompt Builder'],
    ['inventory.html', 'Inventory'],
    ['calculators.html', 'Calculators'],
    ['checklists.html', 'Checklists'],
    ['listing.html', 'Listing Writer'],
    ['learn.html', 'Learn'],
  ];

  function applyTheme(t) {
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
  }
  applyTheme(safeGet(KEYS.theme, 'auto'));

  function mountNav() {
    const here = location.pathname.split('/').pop() || 'index.html';
    const s = store.settings();
    const header = document.createElement('header');
    header.className = 'topbar';
    header.innerHTML = `<div class="topbar-inner">
      <a class="brand" href="index.html"><span class="brand-mark">FD</span><span>${esc(s.businessName || 'FlipDesk')}</span></a>
      <nav class="nav">${PAGES.map(([href, label]) => `<a href="${href}" class="${href === here ? 'active' : ''}">${label}</a>`).join('')}</nav>
      <button class="theme-btn" type="button" id="themeBtn"></button>
    </div>`;
    document.body.prepend(header);
    const btn = header.querySelector('#themeBtn');
    const label = () => { btn.textContent = 'Theme: ' + safeGet(KEYS.theme, 'auto'); };
    label();
    btn.addEventListener('click', () => {
      const order = ['auto', 'light', 'dark'];
      const next = order[(order.indexOf(safeGet(KEYS.theme, 'auto')) + 1) % 3];
      safeSet(KEYS.theme, next); applyTheme(next); label();
    });
    const foot = document.createElement('footer');
    foot.className = 'footer';
    foot.innerHTML = 'Data is stored only in this browser. Export a backup from Inventory regularly.';
    document.body.append(foot);
  }

  let toastTimer;
  function toast(msg) {
    let el = document.querySelector('.toast');
    if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.append(el); }
    el.textContent = msg; el.classList.add('on');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('on'), 1800);
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); toast('Copied to clipboard'); }
    catch (e) {
      const ta = document.createElement('textarea'); ta.value = text; document.body.append(ta); ta.select();
      try { document.execCommand('copy'); toast('Copied to clipboard'); } catch (_) { toast('Copy failed — select and copy manually'); }
      ta.remove();
    }
  }

  function download(filename, text, type = 'application/json') {
    const blob = new Blob([text], { type });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 100);
  }

  function setupTabs(root = document) {
    root.querySelectorAll('[data-tabs]').forEach((group) => {
      const key = 'fd.tab.' + group.dataset.tabs;
      const tabs = group.querySelectorAll('.tab');
      const show = (id) => {
        tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === id));
        document.querySelectorAll(`[data-panel-of="${group.dataset.tabs}"]`).forEach((p) => { p.hidden = p.dataset.panel !== id; });
        safeSet(key, id);
      };
      tabs.forEach((t) => t.addEventListener('click', () => show(t.dataset.tab)));
      const saved = safeGet(key, null);
      show(saved && [...tabs].some((t) => t.dataset.tab === saved) ? saved : tabs[0].dataset.tab);
    });
  }

  document.addEventListener('DOMContentLoaded', () => { mountNav(); setupTabs(); });

  window.FD = { store, uid, num, today, daysBetween, fmt, esc, CATEGORIES, STATUSES, itemCost, itemProfit, isClosed, computeStats, daysHeld, itemRoiPerDay, repriceDue, compsStale, COMPS_STALE_DAYS, businessSnapshot, toast, copyText, download, DEFAULT_SETTINGS };
})();
