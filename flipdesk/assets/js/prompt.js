/* Prompt Builder: turns the form into a structured research prompt for Claude. */
(function () {
  const { store, fmt, esc, num, today, itemCost, isClosed, daysBetween, copyText, toast, download, businessSnapshot } = FD;

  const MODES = [
    { id: 'hunt', name: 'Deal hunt', desc: 'Find underpriced listings near me' },
    { id: 'evaluate', name: 'Evaluate a listing', desc: 'Should I buy this, and for how much?' },
    { id: 'price', name: 'Price my item', desc: 'List price, floor price, listing copy' },
    { id: 'partout', name: 'Part out or sell whole', desc: 'Which way makes more?' },
    { id: 'build', name: 'Build to flip', desc: 'Plan a PC built from used parts' },
    { id: 'research', name: 'Market research', desc: 'What should I be flipping right now?' },
    { id: 'negotiate', name: 'Negotiation help', desc: 'Reply to a buyer or seller' },
    { id: 'review', name: 'Business review', desc: 'Go through my numbers and tell me what to fix' },
  ];

  const CATS = ['Desktop PCs', 'GPUs', 'CPUs', 'Motherboards', 'RAM', 'SSDs/HDDs', 'PSUs', 'Laptops', 'Phones', 'Tablets', 'Consoles', 'Monitors', 'Peripherals'];

  const PLATFORMS = [
    { id: 'fb', name: 'Facebook Marketplace', role: 'buying + selling (local)' },
    { id: 'gumtree', name: 'Gumtree', role: 'buying + selling (local)' },
    { id: 'ebay', name: 'eBay AU (sold listings)', role: 'pricing benchmark + selling' },
    { id: 'cex', name: 'CeX AU', role: 'price floor (their buy/sell prices)' },
    { id: 'cashconv', name: 'Cash Converters', role: 'buying + price floor' },
    { id: 'staticice', name: 'StaticICE', role: 'new retail prices (AU)' },
    { id: 'pcpp', name: 'PCPartPicker AU', role: 'new prices + compatibility' },
    { id: 'ozb', name: 'OzBargain', role: 'new-price deals that undercut used prices' },
    { id: 'grays', name: 'GraysOnline / auctions', role: 'bulk + ex-business stock' },
    { id: 'reddit', name: 'Reddit (r/bapcsalesaustralia, r/hardwareswapaustralia)', role: 'deals + used prices' },
  ];
  const DEFAULT_PLATFORMS = ['fb', 'gumtree', 'ebay', 'cex'];

  const SKILLS = [
    'Full GPU/PC test bench', 'Repaste & clean', 'Replace thermal pads', 'Install OS & drivers',
    'Phone screen/battery swaps', 'Soldering / board repair', 'Multimeter / PSU tester', 'Spare parts on hand', 'Can ship (AusPost)',
  ];
  const DEFAULT_SKILLS = ['Repaste & clean', 'Install OS & drivers'];

  const DEFAULT_TERMS = {
    'Desktop PCs': 'gaming pc', 'GPUs': 'graphics card', 'CPUs': 'ryzen', 'Motherboards': 'motherboard', 'RAM': 'ddr4 ram',
    'SSDs/HDDs': 'nvme ssd', 'PSUs': 'power supply', 'Laptops': 'gaming laptop', 'Phones': 'iphone', 'Tablets': 'ipad',
    'Consoles': 'ps5', 'Monitors': '144hz monitor', 'Peripherals': 'mechanical keyboard',
  };

  const FORM_KEY = 'fd.prompt.form';
  const SAVED_KEY = 'fd.prompt.saved';
  let mode = 'hunt';

  /* ---------- build UI ---------- */
  const $ = (id) => document.getElementById(id);

  function chips(container, name, list, checked) {
    container.innerHTML = list.map((item) => {
      const id = typeof item === 'string' ? item : item.id;
      const label = typeof item === 'string' ? item : item.name;
      return `<label class="chip"><input type="checkbox" name="${name}" value="${esc(id)}" ${checked.includes(id) ? 'checked' : ''}><span>${esc(label)}</span></label>`;
    }).join('');
  }

  function renderModes() {
    $('modes').innerHTML = MODES.map((m) => `<button type="button" class="mode ${m.id === mode ? 'active' : ''}" data-mode="${m.id}"><strong>${m.name}</strong><span>${m.desc}</span></button>`).join('');
    document.querySelectorAll('[data-show]').forEach((el) => {
      el.classList.toggle('hide', !el.dataset.show.split(',').includes(mode));
    });
  }

  function checkedValues(name) {
    return [...document.querySelectorAll(`input[name="${name}"]:checked`)].map((i) => i.value);
  }

  function readForm() {
    const f = {};
    document.querySelectorAll('#pform input, #pform select, #pform textarea').forEach((el) => {
      if (!el.id) return;
      f[el.id] = el.type === 'checkbox' ? el.checked : el.value;
    });
    f.cats = checkedValues('cats');
    f.platforms = checkedValues('platforms');
    f.skills = checkedValues('skills');
    f.mode = mode;
    return f;
  }

  function writeForm(f) {
    Object.entries(f).forEach(([k, v]) => {
      const el = document.getElementById(k);
      if (!el || !el.closest('#pform')) return;
      if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
    });
  }

  /* ---------- links ---------- */
  function searchTerms(f) {
    if (['evaluate', 'price', 'partout', 'negotiate'].includes(f.mode) && f.listing && f.listing.trim()) {
      // Use the first line of the pasted listing, minus prices and filler, as the comp search.
      const first = f.listing.trim().split('\n')[0]
        .replace(/\$\s?\d[\d,.]*/g, ' ').replace(/\b(works?|great|good|condition|selling|for sale|fs|ono|negotiable|pickup|cheap|urgent)\b/gi, ' ')
        .replace(/[^\w\s.+-]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 6).join(' ');
      if (first) return [first];
    }
    const models = (f.models || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (models.length) return models.slice(0, 4);
    if (f.cats.length) return f.cats.slice(0, 4).map((c) => DEFAULT_TERMS[c] || c);
    return ['gaming pc'];
  }

  function buildLinks(f) {
    const s = store.settings();
    const city = (s.fbCity || 'melbourne').trim().toLowerCase().replace(/\s+/g, '');
    const out = [];
    const budget = num(f.budget);
    for (const q of searchTerms(f)) {
      const e = encodeURIComponent(q);
      if (f.platforms.includes('fb')) {
        let u = `https://www.facebook.com/marketplace/${city}/search?query=${e}&daysSinceListed=${f.freshness || 7}&sortBy=creation_time_descend`;
        if (budget) u += `&maxPrice=${Math.round(budget)}`;
        out.push({ name: `FB Marketplace: ${q}`, url: u });
      }
      if (f.platforms.includes('gumtree')) out.push({ name: `Gumtree: ${q}`, url: `https://www.gumtree.com.au/s-${encodeURIComponent(q.replace(/\s+/g, '+')).replace(/%2B/g, '+')}/k0` });
      if (f.platforms.includes('ebay')) out.push({ name: `eBay AU sold: ${q}`, url: `https://www.ebay.com.au/sch/i.html?_nkw=${e}&LH_Sold=1&LH_Complete=1&LH_PrefLoc=1` });
      if (f.platforms.includes('cex')) out.push({ name: `CeX AU: ${q}`, url: `https://au.webuy.com/search?stext=${e}` });
      if (f.platforms.includes('staticice')) out.push({ name: `StaticICE (new): ${q}`, url: `https://www.staticice.com.au/cgi-bin/search.cgi?q=${e}` });
      if (f.platforms.includes('pcpp')) out.push({ name: `PCPartPicker AU: ${q}`, url: `https://au.pcpartpicker.com/search/?q=${e}` });
      if (f.platforms.includes('ozb')) out.push({ name: `OzBargain: ${q}`, url: `https://www.ozbargain.com.au/search/node/${e}` });
    }
    return out;
  }

  function renderLinks(links) {
    $('links').innerHTML = links.length
      ? links.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer"><strong>${esc(l.name)}</strong><span>open ↗</span></a>`).join('')
      : '<span class="muted">Select a platform to generate links.</span>';
  }

  /* ---------- prompt text ---------- */
  function seasonNote() {
    const m = new Date().getMonth(); // 0-11
    const notes = {
      10: 'It is late November: Black Friday / Cyber Monday sales push down new prices (and so used values). Christmas demand for gaming PCs, consoles and phones peaks in early-mid December.',
      11: 'It is December: Christmas demand is high until roughly the 20th, then drops sharply. Boxing Day sales lower new prices. Selling before the 20th is usually worth more than holding.',
      0: "It is January: post-Christmas, lots of people sell gifts and old gear they've replaced, so supply is high and buying is good. Back-to-school laptop demand builds late Jan.",
      1: 'It is February: back-to-school / uni laptop demand is strong early in the month.',
      5: 'It is June: end of financial year (EOFY) sales lower new prices, and business buyers make tax-deductible purchases before 30 June.',
      6: 'It is July: start of financial year; ex-lease business laptops and desktops often hit auctions.',
    };
    return notes[m] || 'Account for any current seasonal effects (new product launches, sales events, school terms) on used prices.';
  }

  function inventoryBlock() {
    const open = store.items().filter((i) => !isClosed(i));
    if (!open.length) return 'No unsold inventory right now.';
    return open.slice(0, 20).map((i) => {
      const held = daysBetween(i.buyDate, today());
      return `- ${i.name} [${i.category}] — cost ${fmt.money(itemCost(i))}, status: ${i.status}${i.listPrice ? `, listed at ${fmt.money(num(i.listPrice))}` : ''}${held !== null ? `, held ${held} days` : ''}${i.defect ? ', HAS DEFECT' : ''}${i.notes ? ` (${i.notes})` : ''}`;
    }).join('\n') + (open.length > 20 ? `\n…and ${open.length - 20} more.` : '');
  }

  const riskText = {
    low: 'LOW. Only tested, fully working items where the seller can show proof (benchmarks, video, in-person testing). Pass on anything "untested" or "as is".',
    medium: 'MEDIUM. Minor faults are fine (dirty, needs repaste, cosmetic damage, missing accessories) if I can check them before paying.',
    high: 'HIGH. Untested and faulty items are fine if the price includes the risk. Use expected value: probability of each outcome × profit or loss.',
  };
  const speedText = {
    fast: 'Fast turnover matters more than squeezing out the top price. Prefer items that usually sell within 14 days.',
    balanced: 'Balance margin and how fast it sells.',
    max: 'Profit per item comes first. I can hold stock for a few weeks.',
  };

  function modeTask(f) {
    const n = f.count || 10;
    const models = f.models ? `Focus on: ${f.models}.` : 'Choose the models yourself, based on which are most often underpriced and most liquid right now.';
    const ask = num(f.askPrice) ? fmt.money(num(f.askPrice)) : 'not stated';
    const paid = num(f.paidPrice) ? fmt.money(num(f.paidPrice)) : null;
    switch (f.mode) {
      case 'hunt': return {
        task: `Find the ${n} best flip opportunities listed right now within ${f.radius || 30} km of ${f.suburb || 'my area'}, ${f.state}. Categories: ${f.cats.join(', ') || 'any PC / phone / electronics'}. ${models}${f.exclude ? ` Exclude: ${f.exclude}.` : ''} Only consider listings from the last ${f.freshness} day(s).

Look especially for listings that are mispriced because of how they are written:
- vague titles ("gaming computer", "old pc", "computer tower", "graphics card") where the photos or specs show valuable parts
- misspellings (e.g. "nvidea", "geforece", "rtx3070", "i phone") that keep the listing out of normal searches
- whole PCs whose GPU alone, or GPU + CPU, is worth more than the asking price
- "moving / must go / quick sale" listings, and ex-office or ex-lease bulk lots
- items listed for a long time where the seller is likely to accept an offer

If you can't see live listings (Facebook Marketplace needs a login), say so clearly. Don't invent any listings. Instead:
(a) give me a value cheat-sheet for each target model: sold-price range, median, my max buy price, and a "snap it up immediately" price
(b) give me 10–15 search strings (including misspellings and vague terms) and filter settings to run myself
(c) tell me to paste what I find so you can rank it.`,
        format: `A ranked table, highest risk-adjusted expected profit first, with columns:
# | Item & key specs | Link | Asking | Est. resale (sold comps) | Max buy (my formula) | Offer to open with | Est. profit | Margin | Risk (L/M/H) | Days to sell (est.)
Under the table, for each pick: why it's underpriced, what could go wrong, and the opening message to send the seller.
Finish with "Skip these": listings that look like deals but aren't, and why.`,
      };
      case 'evaluate': return {
        task: `Evaluate this listing as a possible purchase for resale. Asking price: ${ask}. Condition: ${f.condition || 'unknown'}.

LISTING:
"""
${f.listing || '(I have not pasted the listing yet — ask me for it.)'}
"""

Steps:
1. Work out exactly what it is. List any specs that are ambiguous or missing and could change the value a lot (exact GPU model and VRAM, CPU generation, storage size, iPhone storage and battery health, etc.).
2. Market value: the realistic transaction price from SOLD comps, not asking prices. Give the range and median, plus a quick-sale (liquidation) price.
3. Part-out value as a floor: what the individual components would fetch.
4. Max buy price using my formula, then a verdict: BUY at asking / NEGOTIATE (exact offer and walk-away) / PASS.
5. Expected value: 2–4 outcomes (works perfectly, minor fault, major fault, scam/misrepresented), each with a probability and a profit or loss, plus the EV.`,
        format: `Start with one line: VERDICT — BUY / NEGOTIATE to $X / PASS, then the expected profit.
Then: Specs (confirmed vs assumed) | Comps table (item, sold price, date, source) | Max-buy calculation, shown step by step | EV table | Red flags in this listing | Questions to send the seller before I travel | What to check in person before handing over money.`,
      };
      case 'price': return {
        task: `Help me sell this item for the most money within a reasonable time. ${paid ? `I paid ${paid}.` : ''} ${num(f.askPrice) ? `I'm thinking about ${ask}.` : ''} Condition: ${f.condition || 'see details'}.

ITEM DETAILS:
"""
${f.listing || '(describe the item here)'}
"""

Give me:
1. Sold comps (not asking prices) with the range and median.
2. Three price points: QUICK (sells in about 3 days), MARKET (about 2 weeks), STRETCH (max price, slower). For each, give the estimated days to sell and my profit.
3. A recommended list price that leaves room to negotiate, and a firm floor price.
4. A price-drop schedule if it doesn't sell (when and by how much).
5. The best platform(s) after fees, with a net-proceeds comparison.
6. A ready-to-paste listing: title (max ~80 chars, with keywords buyers actually search for) and description (specs, testing done, condition, honest disclosure, pickup/delivery, "no lowballers" phrasing that doesn't put buyers off).
7. Photos to take, in order.`,
        format: 'Sections with headings: Comps, Price points, Recommendation, Drop schedule, Platform comparison, Listing copy (in a code block), Photo checklist.',
      };
      case 'partout': return {
        task: `Decide whether to sell this whole or part it out. ${paid ? `I paid ${paid}.` : ''} ${num(f.askPrice) ? `Asking/current value: ${ask}.` : ''}

ITEM:
"""
${f.listing || '(paste the system specs)'}
"""

For each component: realistic sold price, platform fees and shipping, how fast it sells, and how much hassle it is. Compare:
A) sell whole as is, B) sell whole after cheap upgrades or fixes, C) part out everything, D) hybrid: pull the valuable parts (usually the GPU) and sell the rest as a "base" system.
Count my time at roughly $25/hour and include leftovers that won't sell (case, old HDD, etc.). Ignore what I paid when deciding (it's a sunk cost), but show my total profit for each option.`,
        format: 'Table per option: gross proceeds, fees, extra costs, net, time required, weeks to fully sell, risk. Then a clear recommendation and the order to list the parts in.',
      };
      case 'build': return {
        task: `Plan a PC built from used and new parts to resell for profit. Target: ${f.buildTarget || 'whatever is the most profitable build in my area right now'}. Budget: ${num(f.budget) ? fmt.money(num(f.budget)) : 'see my rules'}. ${models}

Include:
1. What sells best locally right now (which price bracket and performance tier moves fastest) and the sold-price evidence.
2. A parts list with a target used buy price, a max price and a new price for each part. Say which parts are safe used (case, PSU from good brands, CPU) and which should be new or under warranty (PSU from unknown brands, storage).
3. Total cost, expected sale price, profit, margin, and ROI per week of capital tied up.
4. Compatibility checks (socket, BIOS version, PSU wattage and connectors, case clearance).
5. The order to buy parts in (lock in the hardest-to-find part first), and a testing plan before listing.`,
        format: 'Parts table, a cost/profit summary block, a risk list, then a step-by-step build-and-list plan.',
      };
      case 'research': return {
        task: `Do market research for my flipping business. Which products in my area (${f.suburb || 'my area'}, ${f.state}) give the best risk-adjusted returns right now for my budget and skills? Categories to consider: ${f.cats.join(', ') || 'all PC, phone and electronics categories'}. ${models}

For each opportunity, estimate: typical buy price, typical sold price, gross margin, how fast it sells, defect/scam risk, capital required, and how my skills give me an advantage. Note anything current that's moving prices (new launches, sales, seasonality, crypto, game releases).`,
        format: 'Ranked table of the top 10 opportunities with columns: Product | Buy at | Sells for | Margin | Days to sell | Risk | Capital | Why now. Then: what to AVOID right now and why, and a suggested split of my capital across the top picks.',
      };
      case 'negotiate': return {
        task: `Help me negotiate. I am the ${f.negSide || 'buyer'}. ${num(f.askPrice) ? `Price on the table: ${ask}.` : ''} ${num(f.walkAway) ? `My walk-away price: ${fmt.money(num(f.walkAway))} (don't reveal it).` : ''}

ITEM:
"""
${f.listing || '(item details)'}
"""

MESSAGE THREAD SO FAR:
"""
${f.messages || '(paste the conversation)'}
"""

Read what leverage each side has (how long it's been listed, how keen they seem, competing listings, faults). Write the best next message, then a ladder of up to 3 counter-offers, and say when to walk away. Keep messages short, friendly, casual Australian, and honest. No fake "my mate's offering more" lines.`,
        format: 'Quick read of the situation (3 bullets), the message to send in a code block, then the counter-offer ladder and walk-away trigger.',
      };
      case 'review': return {
        task: `Review my flipping business using the numbers above. Tell me straight:
1. What's actually making money and what isn't (by category, price bracket, and holding time).
2. Whether I'm under- or over-pricing, judging by margin and days to sell.
3. Whether my cash reserve and inventory levels are healthy (liquidity), and what to do about stale stock.
4. Whether my defect rate and risk allowance are realistic.
5. How to split my capital across categories for the next 30 days.
6. The 3 highest-impact changes to make this month, and the KPIs to track.`,
        format: 'Headline verdict (2 sentences), then sections matching the numbered points, and an action list with measurable targets.',
      };
    }
    return { task: '', format: '' };
  }

  function buildPrompt(f) {
    const s = store.settings();
    const tm = num(f.targetMargin), mp = num(f.minProfit), rp = num(f.riskPct);
    const platforms = PLATFORMS.filter((p) => f.platforms.includes(p.id));
    const { task, format } = modeTask(f);
    const modeName = MODES.find((m) => m.id === f.mode).name;
    const links = f.incLinks ? buildLinks(f) : [];
    const parts = [];

    parts.push(`# ROLE
You are my sourcing analyst and business adviser for a small second-hand electronics flipping business (PCs, PC parts, phones, laptops, consoles) based in ${f.suburb ? f.suburb + ', ' : ''}${f.state}, Australia. Be blunt and specific, and show your numbers. Treat this as a real money decision, not a general overview.

# CONTEXT
- Today: ${today()}. All prices in AUD.
- Task type: ${modeName}
- ${seasonNote()}`);

    if (f.incSnapshot || f.mode === 'review') {
      parts.push(`# MY BUSINESS RIGHT NOW
${businessSnapshot()}`);
    }
    if (f.incInventory) {
      parts.push(`# MY CURRENT UNSOLD INVENTORY
${inventoryBlock()}`);
    }

    parts.push(`# MY BUYING RULES
- Max buy price = expected sale price − repairs/parts − selling costs (fees, fuel, packaging) − target profit − risk allowance.
- Target gross margin: ${tm || s.targetMarginPct}% | Minimum profit per item: ${fmt.money(mp || num(s.minProfit))} | Risk allowance: ${rp || s.riskPct}% of the expected sale price.
- Budget for this: ${num(f.budget) ? fmt.money(num(f.budget)) : 'not fixed'}. I keep ${s.reservePct}% of capital as a cash reserve, so don't suggest putting everything into one item.
- Risk tolerance: ${riskText[f.riskTol] || riskText.medium}
- Priority: ${speedText[f.speed] || speedText.balanced}
- Location: within ${f.radius || s.radiusKm} km of ${f.suburb || 'my suburb'}, ${f.state}. Transport: ${({ car: 'car', public: 'public transport (bulky items like full towers and monitors are harder for me)', bike: 'bike/walking (small items only)', shipping: 'shipping only' })[f.transport] || f.transport}.
- My capabilities: ${f.skills.length ? f.skills.join(', ') : 'basic testing only'}.`);

    if (f.extra) parts.push(`# EXTRA NOTES FROM ME
${f.extra}`);

    parts.push(`# TASK
${task}`);

    const research = [
      '- If you have web search or browsing, use it. If you don\'t, say so at the top of your answer and work from your own knowledge, labelled as estimates.',
      '- Value items on SOLD/COMPLETED sales (e.g. eBay AU sold listings), not asking prices. Asking prices are the most a seller hopes for, not what things are worth. Use at least 3 comparable sales where you can, and give the range and median.',
      '- Facebook Marketplace usually needs a login and may not be readable by you. If you can\'t open a source, say so plainly and give me exact searches to run instead.',
      '- NEVER invent listings, sellers, URLs, prices or sale dates. If you don\'t know, say "unknown" or give a range marked as an estimate.',
    ];
    if (f.strict) research.push('- Label every price: [SOURCE: site, date] or [ESTIMATE]. If most numbers are estimates, say so in the first line.');
    if (platforms.length) research.push(`- Platforms to use: ${platforms.map((p) => `${p.name} (${p.role})`).join('; ')}.`);
    research.push('- Account for real selling costs in Australia: platform fees, payment fees, AusPost shipping and packaging, and fuel for pickups.');
    parts.push(`# HOW TO RESEARCH\n${research.join('\n')}`);

    if (links.length) {
      parts.push(`# SEARCH LINKS (open these if you can; otherwise I'll run them and paste results)\n${links.map((l) => `- ${l.name}: ${l.url}`).join('\n')}`);
    }

    if (f.incQuestions) {
      parts.push(`# RISK CHECKS TO APPLY
Flag anything that looks like:
- Scams: price far too low, seller wants a deposit or bank transfer before inspection, "I'm interstate, will courier", new account with no history, stock photos only.
- Stolen goods: no box or receipt on newer items, iCloud/Google account locks, IMEI blacklisted, bulk identical phones, "found it" stories.
- Hardware risk: mining cards (check fan wear and thermal pads), GPUs that were repaired or reflowed, bent CPU/socket pins, swollen batteries, aftermarket phone screens (Face ID/True Tone/"unknown part" warnings), laptops with BIOS passwords or Computrace/MDM locks.
- Value traps: old platforms (DDR3 era, pre-8th gen Intel), proprietary OEM parts (Dell/HP/Alienware boards and PSUs), cards with low VRAM.
And include the questions I should ask the seller BEFORE I travel.`);
    }
    if (f.incScripts) {
      parts.push('# MESSAGES\nWhere it helps, write ready-to-send messages (short, friendly, casual Australian, no pressure tactics or lies) in code blocks so I can copy them.');
    }

    parts.push(`# OUTPUT FORMAT\n${format}\nKeep the explanation tight. Put numbers in tables. End with a 3-line "Do this next" summary.`);

    if (f.askFirst) parts.push('# BEFORE YOU START\nIf anything important is missing or unclear, ask me up to 5 short clarifying questions first and wait for my answers. Otherwise go straight ahead.');

    return parts.join('\n\n');
  }

  /* ---------- render & persistence ---------- */
  function update() {
    const f = readForm();
    try { localStorage.setItem(FORM_KEY, JSON.stringify(f)); } catch (e) { /* ignore */ }
    const text = buildPrompt(f);
    $('out').textContent = text;
    const words = text.split(/\s+/).length;
    $('pmeta').textContent = `${words.toLocaleString()} words · ~${Math.round(text.length / 4).toLocaleString()} tokens · mode: ${MODES.find((m) => m.id === mode).name}`;
    renderLinks(buildLinks(f));
    return text;
  }

  function savedList() { return FD.store.get(SAVED_KEY, []); }
  function renderSaved() {
    const list = savedList();
    $('saved').innerHTML = list.length ? list.map((p, i) => `<a href="#" data-idx="${i}"><strong>${esc(p.title)}</strong><span>${esc(p.date)}</span></a>`).join('') : '<span class="muted" style="font-size:.85rem">Nothing saved yet.</span>';
  }

  function init() {
    const s = store.settings();
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(FORM_KEY) || 'null'); } catch (e) { /* ignore */ }

    chips($('cats'), 'cats', CATS, saved?.cats || ['Desktop PCs', 'GPUs']);
    chips($('platforms'), 'platforms', PLATFORMS, saved?.platforms || DEFAULT_PLATFORMS);
    chips($('skills'), 'skills', SKILLS, saved?.skills || DEFAULT_SKILLS);

    // Defaults from settings, then restore saved form.
    $('targetMargin').value = s.targetMarginPct; $('minProfit').value = s.minProfit; $('riskPct').value = s.riskPct;
    $('suburb').value = s.suburb; $('state').value = s.state; $('radius').value = s.radiusKm; $('transport').value = s.transport;
    $('budget').value = Math.max(0, Math.round(num(s.startingCapital) * (1 - num(s.reservePct) / 100)));
    if (saved) { writeForm(saved); mode = saved.mode || mode; }

    // Allow ?mode=evaluate deep links
    const qm = new URLSearchParams(location.search).get('mode');
    if (qm && MODES.some((m) => m.id === qm)) mode = qm;

    renderModes();
    $('modes').addEventListener('click', (e) => {
      const b = e.target.closest('[data-mode]'); if (!b) return;
      mode = b.dataset.mode; renderModes(); update();
    });
    $('pform').addEventListener('input', update);
    $('pform').addEventListener('change', update);
    document.querySelectorAll('#incSnapshot,#incInventory,#incQuestions,#incScripts,#incLinks,#strict,#askFirst').forEach((el) => el.addEventListener('change', update));

    $('copyBtn').addEventListener('click', () => copyText(update()));
    $('dlBtn').addEventListener('click', () => download(`flipdesk-prompt-${mode}-${today()}.txt`, update(), 'text/plain'));
    $('saveBtn').addEventListener('click', () => {
      const f = readForm();
      const title = `${MODES.find((m) => m.id === mode).name}${f.models ? ': ' + f.models.slice(0, 40) : ''}`;
      const list = savedList(); list.unshift({ title, date: today(), form: f }); FD.store.set(SAVED_KEY, list.slice(0, 25));
      renderSaved(); toast('Saved');
    });
    $('saved').addEventListener('click', (e) => {
      const a = e.target.closest('[data-idx]'); if (!a) return; e.preventDefault();
      const p = savedList()[+a.dataset.idx]; if (!p) return;
      writeForm(p.form);
      ['cats', 'platforms', 'skills'].forEach((n) => document.querySelectorAll(`input[name="${n}"]`).forEach((i) => { i.checked = (p.form[n] || []).includes(i.value); }));
      mode = p.form.mode; renderModes(); update(); toast('Loaded');
    });
    $('clearSaved').addEventListener('click', () => { if (confirm('Delete all saved prompts?')) { FD.store.set(SAVED_KEY, []); renderSaved(); } });

    renderSaved();
    update();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
