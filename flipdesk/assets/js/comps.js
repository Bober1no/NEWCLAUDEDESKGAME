/* Comps round trip: pull Claude's fdComps JSON out of a pasted reply, validate it, and do the maths locally. */
(function () {
  const { store, num, today, daysBetween, uid, compsStale } = FD;
  const KEY = 'fd.comps';
  const WINDOW_DAYS = 60;
  const RISK_BUMP = 5; // percentage points added when the data is thin
  const CONFIDENCE = ['high', 'medium', 'low', 'none'];
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  // Real calendar date check without timezone shifts (rejects 2026-02-30 etc).
  const validDate = (s) => {
    if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
    const [y, m, d] = s.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  };
  const isInt = (v) => Number.isInteger(v) && v >= 0;
  const show = (v) => (v === undefined ? 'missing' : JSON.stringify(v));

  /* ---------- extraction ---------- */

  /** Index of the brace that closes the one at `start`, ignoring braces inside strings. -1 if unbalanced. */
  function matchBrace(text, start) {
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) return i;
    }
    return -1;
  }

  function tryParse(s) {
    const attempts = [
      s,
      // Common chat-reply damage: smart quotes and trailing commas.
      s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/,\s*([}\]])/g, '$1'),
    ];
    for (const a of attempts) { try { return JSON.parse(a); } catch (e) { /* next */ } }
    return undefined;
  }

  /** Find the fdComps object in a pasted reply: fenced or not, with any text around it. */
  function extract(text) {
    if (!text || !text.trim()) throw new Error('Nothing pasted. Paste Claude\'s whole reply into the box.');
    const candidates = [];
    const fence = /```[a-zA-Z]*\s*([\s\S]*?)```/g;
    let m;
    while ((m = fence.exec(text))) candidates.push(m[1].trim());
    for (let i = text.indexOf('{'); i !== -1; i = text.indexOf('{', i + 1)) {
      const end = matchBrace(text, i);
      if (end > i) { candidates.push(text.slice(i, end + 1)); i = end; }
    }
    let parsedSomething = false;
    for (const c of candidates) {
      const obj = tryParse(c);
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        parsedSomething = true;
        if ('fdComps' in obj) return obj;
      }
    }
    if (parsedSomething) throw new Error('Found JSON, but it has no "fdComps" field. Make sure you pasted the reply to the Comps prompt.');
    if (candidates.length) throw new Error('Found something that looks like JSON, but it isn\'t valid JSON. Ask Claude to resend only the JSON block.');
    throw new Error('No JSON block found in what you pasted. Ask Claude to reply with only the JSON block.');
  }

  /* ---------- validation ---------- */

  function validate(o) {
    const errors = [], warnings = [];
    if (o.fdComps !== 1) errors.push(`"fdComps" must be 1 (got ${show(o.fdComps)}).`);
    if (typeof o.item !== 'string' || !o.item.trim()) errors.push(`"item" must be a non-empty string (got ${show(o.item)}).`);
    if (o.condition !== undefined && typeof o.condition !== 'string') errors.push(`"condition" must be a string (got ${show(o.condition)}).`);
    if (!validDate(o.date)) errors.push(`"date" must be a real date in YYYY-MM-DD format (got ${show(o.date)}).`);
    else if (daysBetween(today(), o.date) > 1) errors.push(`"date" ${o.date} is in the future.`);

    if (!CONFIDENCE.includes(o.confidence)) errors.push(`"confidence" must be one of ${CONFIDENCE.join(', ')} (got ${show(o.confidence)}).`);

    for (const k of ['activeCount', 'soldCount30d']) {
      if (o[k] === undefined) errors.push(`"${k}" is missing. Use null if it's unknown.`);
      else if (o[k] !== null && !isInt(o[k])) errors.push(`"${k}" must be a whole number of 0 or more, or null (got ${show(o[k])}).`);
    }
    if (typeof o.repairEstimate !== 'number' || !Number.isFinite(o.repairEstimate) || o.repairEstimate < 0) {
      errors.push(`"repairEstimate" must be a number of 0 or more (got ${show(o.repairEstimate)}). Use 0 if nothing needs fixing.`);
    }

    const used = [];
    if (!Array.isArray(o.sold)) {
      errors.push(`"sold" must be an array (got ${show(o.sold)}).`);
    } else {
      o.sold.forEach((s, i) => {
        const at = `sold[${i}]`;
        if (!s || typeof s !== 'object') { errors.push(`${at} must be an object.`); return; }
        const before = errors.length;
        if (typeof s.price !== 'number' || !Number.isFinite(s.price) || s.price <= 0) errors.push(`${at}.price must be a positive number (got ${show(s.price)}).`);
        if (!validDate(s.date)) errors.push(`${at}.date must be YYYY-MM-DD (got ${show(s.date)}).`);
        else if (daysBetween(today(), s.date) > 1) errors.push(`${at}.date ${s.date} is in the future.`);
        if (typeof s.source !== 'string' || !s.source.trim()) errors.push(`${at}.source must be a non-empty string (got ${show(s.source)}).`);
        if (errors.length > before) return;
        if (validDate(o.date) && daysBetween(s.date, o.date) > WINDOW_DAYS) {
          warnings.push(`${at} (${s.date}, $${s.price}) is older than ${WINDOW_DAYS} days, so it's left out.`);
          return;
        }
        used.push(s);
      });
      if (o.confidence === 'none' && o.sold.length) errors.push('"confidence" is "none" but "sold" has entries. One of them is wrong.');
      if (o.sold.length === 0 && CONFIDENCE.includes(o.confidence) && o.confidence !== 'none') errors.push(`"sold" is empty but "confidence" is "${o.confidence}". With no sales it should be "none".`);
      if (validDate(o.date) && isInt(o.soldCount30d)) {
        const in30 = used.filter((s) => daysBetween(s.date, o.date) <= 30).length;
        if (o.soldCount30d < in30) warnings.push(`"soldCount30d" is ${o.soldCount30d}, but ${in30} of the listed sales are from the last 30 days. The sell-through figure may be off.`);
      }
    }
    return { errors, warnings, used };
  }

  /* ---------- maths (done here, not by Claude) ---------- */

  function median(sorted) {
    const n = sorted.length, mid = Math.floor(n / 2);
    return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function compute(o, used, baseRiskPct) {
    const prices = used.map((s) => s.price).sort((a, b) => a - b);
    const n = prices.length;
    const cut = n >= 5 ? Math.max(1, Math.floor(n * 0.1)) : 0;
    const kept = prices.slice(cut, n - cut);
    const expectedSale = n ? median(kept) : null;

    let sellThrough = null, speed = 'unknown';
    if (isInt(o.soldCount30d) && isInt(o.activeCount) && o.soldCount30d + o.activeCount > 0) {
      sellThrough = o.soldCount30d / (o.soldCount30d + o.activeCount) * 100;
      speed = sellThrough > 50 ? 'fast' : sellThrough >= 20 ? 'slow' : 'dead';
    }

    const notes = [];
    let riskPct = num(baseRiskPct);
    const thin = n > 0 && (n < 3 || o.confidence === 'low');
    if (thin) {
      riskPct += RISK_BUMP;
      notes.push(`${n < 3 ? `Only ${n} usable sale${n === 1 ? '' : 's'}` : 'Claude rated its confidence low'}, so the risk allowance goes up ${RISK_BUMP} points to ${riskPct}%.`);
    }
    if (speed === 'dead') notes.push('Sell-through is under 20%. Far more are listed than are selling, so expect a long hold or a big discount.');
    if (sellThrough === null) notes.push('Sell-through unknown: no usable sold or active counts.');

    return { expectedSale, n, kept: kept.length, dropped: cut * 2, min: prices[0] ?? null, max: prices[n - 1] ?? null, sellThrough, speed, riskPct, riskBumped: thin, notes };
  }

  /** Full pipeline. Returns { ok, errors, warnings, data, stats }. Never throws. */
  function process(text, baseRiskPct) {
    let data;
    try { data = extract(text); } catch (e) { return { ok: false, errors: [e.message], warnings: [] }; }
    const { errors, warnings, used } = validate(data);
    if (errors.length) return { ok: false, errors, warnings, data };
    if (!used.length) {
      return { ok: false, data, warnings, errors: [data.confidence === 'none'
        ? 'Claude says it couldn\'t find real sales data (confidence "none"). There\'s no expected sale to use. Don\'t buy on a guess. Run the comps prompt again with browser access, or check eBay sold listings yourself.'
        : 'None of the sales are usable (all too old). There\'s no expected sale to calculate from.'] };
    }
    return { ok: true, errors: [], warnings, data, stats: compute(data, used, baseRiskPct) };
  }

  /* ---------- storage ---------- */
  const list = () => store.get(KEY, []);
  const get = (id) => list().find((c) => c.id === id) || null;
  function save(result, itemId) {
    const entry = { id: uid(), savedAt: today(), itemId: itemId || null, data: result.data, stats: result.stats };
    const all = list(); all.unshift(entry); store.set(KEY, all.slice(0, 100));
    if (itemId) attachToItem(itemId, entry);
    return entry;
  }
  function attachToItem(itemId, entry) {
    const items = store.items();
    const it = items.find((i) => i.id === itemId);
    if (!it) return false;
    it.expectedSale = Math.round(entry.stats.expectedSale);
    it.compsDate = entry.data.date;
    it.compsId = entry.id;
    store.saveItems(items);
    link(entry.id, itemId);
    return true;
  }
  function link(compsId, itemId) {
    const all = list(); const e = all.find((c) => c.id === compsId);
    if (e) { e.itemId = itemId; store.set(KEY, all); }
  }
  function remove(id) { store.set(KEY, list().filter((c) => c.id !== id)); }

  window.FDComps = { extract, validate, compute, process, list, get, save, attachToItem, link, remove, isStale: compsStale, RISK_BUMP, WINDOW_DAYS };
})();
