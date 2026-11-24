/* Listing writer: produces a Marketplace-ready title + description. */
(function () {
  const { store, fmt, num, copyText } = FD;
  const $ = (id) => document.getElementById(id);
  const KEY = 'fd.listing';
  const FIELDS = ['lType', 'lPrice', 'lFloor', 'lTitle', 'lSpecs', 'lPerf', 'lTests', 'lFlaws', 'lArea', 'lDelivery', 'lTone', 'lDemo', 'lWarranty'];
  const lines = (id) => $(id).value.split('\n').map((s) => s.trim()).filter(Boolean);

  const PHOTOS = {
    pc: ['Front 3/4 angle, RGB on, clean background', 'Side panel with the inside lit up', 'Close-up of GPU and CPU cooler', 'Rear I/O and PSU', 'Benchmark or game fps on screen', 'Any flaws, up close'],
    gpu: ['Front with fans, good light', 'Backplate', 'Power connectors and display outputs', 'GPU-Z screenshot', 'Benchmark + temperatures screenshot', 'Any flaws'],
    phone: ['Front, screen on (white background shows dead pixels and burn-in honestly)', 'Back', 'Edges and corners', 'Settings: battery health', 'Settings: About (model and storage)', 'Any flaws'],
    laptop: ['Open at 3/4 angle, screen on', 'Keyboard', 'Lid', 'Ports on both sides', 'Battery report / system info', 'Any flaws'],
    part: ['Front', 'Back', 'Labels / model number', 'Working in a system (screenshot)', 'Any flaws'],
    console: ['Front with controller', 'Ports', 'Running a game', 'Serial matched to the box', 'Any flaws'],
  };

  function build() {
    const t = $('lType').value;
    const price = num($('lPrice').value), floor = num($('lFloor').value);
    const tone = $('lTone').value;
    const area = $('lArea').value || store.settings().suburb;
    const specs = lines('lSpecs'), perf = lines('lPerf'), tests = lines('lTests'), flaws = $('lFlaws').value.trim();

    let title = $('lTitle').value.trim();
    if (tests.length && title.length < 60) title += ' | Tested';
    if (t === 'pc' && specs.some((s) => /ssd|nvme/i.test(s)) && title.length < 70) title += ' | SSD';
    if (title.length > 99) title = title.slice(0, 99);

    const out = [];
    out.push($('lTitle').value.trim() + (tests.length ? ': tested and working' : ''));
    out.push('');
    if (specs.length) { out.push('SPECS'); specs.forEach((s) => out.push('• ' + s)); out.push(''); }
    if (perf.length) { out.push('PERFORMANCE'); perf.forEach((s) => out.push('• ' + s)); out.push(''); }
    if (tests.length) { out.push('TESTED'); tests.forEach((s) => out.push('✓ ' + s)); out.push(''); }
    out.push('CONDITION');
    out.push(flaws || 'Excellent condition, no known issues.');
    out.push('');
    const extras = [];
    if ($('lDemo').checked) extras.push('Happy to show it running before you pay.');
    if ($('lWarranty').checked) extras.push('7-day dead-on-arrival guarantee: if it fails from a fault in that time, I\'ll refund you.');
    if (extras.length) { extras.forEach((x) => out.push(x)); out.push(''); }
    const del = { pickup: `Pickup from ${area || '[suburb]'}.`, local: `Pickup from ${area || '[suburb]'}, or I can deliver locally for a small fee.`, ship: `Pickup from ${area || '[suburb]'}, or shipped Australia-wide at cost (tracked and insured).` }[$('lDelivery').value];
    out.push(del);
    out.push({ neg: `$${price}. Reasonable offers considered.`, firm: `$${price} firm. The price reflects the testing done.`, quick: `$${price}. Priced for a quick sale.` }[tone]);
    out.push('Cash or PayID on pickup. Please message with a time you can come rather than "is this available?" and I\'ll reply quickly.');

    $('tOut').textContent = title;
    $('tLen').textContent = `${title.length} characters`;
    $('dOut').textContent = out.join('\n');

    const s = store.settings();
    const gap = price - floor;
    $('pNote').innerHTML = `<dl class="kv">
      <dt>List price</dt><dd>${fmt.money(price)}</dd>
      <dt>Floor</dt><dd>${fmt.money(floor)}</dd>
      <dt>Negotiation buffer</dt><dd>${fmt.money(gap)} (${price ? fmt.pct(gap / price * 100, 0) : '—'})</dd></dl>
      <p class="muted mt" style="font-size:.85rem">${tone === 'neg' ? (gap / (price || 1) < 0.05 ? 'Your buffer is thin. Buyers expect to knock 5–10% off, so either raise the list price or set it as firm.' : gap / (price || 1) > 0.15 ? 'A buffer that big tells serious buyers you\'re overpriced. Bring the list price down.' : 'A buffer of 5–15% is about right for Marketplace.') : 'Firm pricing only works if your listing clearly beats the others: proof of testing, better photos, faster replies.'} If it doesn't sell in ${s.targetMarginPct > 30 ? '10' : '14'} days, drop it 5–7% rather than leaving it sitting.</p>`;
    $('photos').innerHTML = PHOTOS[t].map((p) => `<li>${p}</li>`).join('');

    const st = {}; FIELDS.forEach((f) => { st[f] = $(f).type === 'checkbox' ? $(f).checked : $(f).value; }); store.set(KEY, st);
  }

  document.addEventListener('DOMContentLoaded', () => {
    const saved = store.get(KEY, null);
    if (saved) FIELDS.forEach((f) => { if (saved[f] === undefined) return; if ($(f).type === 'checkbox') $(f).checked = saved[f]; else $(f).value = saved[f]; });
    if (!$('lArea').value) $('lArea').value = store.settings().suburb || '';
    $('lform').addEventListener('input', build); $('lform').addEventListener('change', build);
    document.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', () => copyText($(b.dataset.copy).textContent)));
    build();
  });
})();
