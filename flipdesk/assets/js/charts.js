/* Tiny dependency-free SVG charts: single-series line (with crosshair) and horizontal bars (with hover). */
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };

  function niceTicks(min, max, count = 4) {
    if (min === max) { max = min + 1; }
    const span = max - min;
    const step0 = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) || mag * 10;
    const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
    const ticks = []; for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(6));
    return ticks;
  }

  function tipFor(container) {
    let tip = container.querySelector('.tip');
    if (!tip) { tip = document.createElement('div'); tip.className = 'tip'; container.append(tip); }
    return tip;
  }

  /** points: [{x: label, y: number}] in order. */
  function line(container, points, { format = (v) => v } = {}) {
    container.innerHTML = '';
    if (points.length < 1) { container.innerHTML = '<div class="chart-empty">Sell something and this fills in.</div>'; return; }
    if (points.length === 1) points = [{ x: '', y: 0 }, ...points];
    const W = 560, H = 240, m = { t: 12, r: 16, b: 28, l: 56 };
    const ys = points.map((p) => p.y);
    const ticks = niceTicks(Math.min(0, ...ys), Math.max(0, ...ys));
    const y0 = ticks[0], y1 = ticks[ticks.length - 1];
    const sx = (i) => m.l + (i / (points.length - 1)) * (W - m.l - m.r);
    const sy = (v) => m.t + (1 - (v - y0) / (y1 - y0)) * (H - m.t - m.b);
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Cumulative net profit over time' });

    for (const t of ticks) {
      svg.append(el('line', { x1: m.l, x2: W - m.r, y1: sy(t), y2: sy(t), stroke: t === 0 ? 'var(--muted)' : 'var(--grid)', 'stroke-width': 1 }));
      const lab = el('text', { x: m.l - 8, y: sy(t) + 4, 'text-anchor': 'end', 'font-size': 11, fill: 'var(--muted)' }); lab.textContent = format(t); svg.append(lab);
    }
    [0, points.length - 1].forEach((i) => {
      const lab = el('text', { x: sx(i), y: H - 8, 'text-anchor': i === 0 ? 'start' : 'end', 'font-size': 11, fill: 'var(--muted)' });
      lab.textContent = points[i].x; svg.append(lab);
    });
    const d = points.map((p, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(p.y).toFixed(1)}`).join('');
    svg.append(el('path', { d: `${d}L${sx(points.length - 1)},${sy(Math.max(y0, 0))}L${sx(0)},${sy(Math.max(y0, 0))}Z`, fill: 'var(--chart)', opacity: 0.08 }));
    svg.append(el('path', { d, fill: 'none', stroke: 'var(--chart)', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    const last = points[points.length - 1];
    svg.append(el('circle', { cx: sx(points.length - 1), cy: sy(last.y), r: 4, fill: 'var(--chart)', stroke: 'var(--surface)', 'stroke-width': 2 }));

    const cross = el('line', { y1: m.t, y2: H - m.b, stroke: 'var(--muted)', 'stroke-width': 1, 'stroke-dasharray': '3 3', opacity: 0 });
    const dot = el('circle', { r: 5, fill: 'var(--chart)', stroke: 'var(--surface)', 'stroke-width': 2, opacity: 0 });
    svg.append(cross, dot);
    const hit = el('rect', { x: m.l, y: 0, width: W - m.l - m.r, height: H, fill: 'transparent' });
    svg.append(hit);
    container.append(svg);
    const tip = tipFor(container);
    const move = (evt) => {
      const r = svg.getBoundingClientRect();
      const px = ((evt.touches ? evt.touches[0].clientX : evt.clientX) - r.left) * (W / r.width);
      const i = Math.max(0, Math.min(points.length - 1, Math.round(((px - m.l) / (W - m.l - m.r)) * (points.length - 1))));
      const p = points[i];
      cross.setAttribute('x1', sx(i)); cross.setAttribute('x2', sx(i)); cross.setAttribute('opacity', 1);
      dot.setAttribute('cx', sx(i)); dot.setAttribute('cy', sy(p.y)); dot.setAttribute('opacity', 1);
      tip.innerHTML = `<strong>${format(p.y)}</strong><br><span class="muted">${p.x}${p.label ? ' · ' + p.label : ''}</span>`;
      tip.style.left = (sx(i) / W * r.width) + 'px'; tip.style.top = (sy(p.y) / H * r.height) + 'px'; tip.classList.add('on');
    };
    const leave = () => { cross.setAttribute('opacity', 0); dot.setAttribute('opacity', 0); tip.classList.remove('on'); };
    hit.addEventListener('mousemove', move); hit.addEventListener('touchmove', move, { passive: true });
    hit.addEventListener('mouseleave', leave); hit.addEventListener('touchend', leave);
  }

  /** rows: [{label, value, detail}] */
  function hbars(container, rows, { format = (v) => v } = {}) {
    container.innerHTML = '';
    if (!rows.length) { container.innerHTML = '<div class="chart-empty">No closed deals yet.</div>'; return; }
    const W = 560, rowH = 30, m = { t: 6, r: 70, b: 6, l: 110 };
    const H = m.t + m.b + rows.length * rowH;
    const min = Math.min(0, ...rows.map((r) => r.value)), max = Math.max(0, ...rows.map((r) => r.value));
    const sx = (v) => m.l + ((v - min) / ((max - min) || 1)) * (W - m.l - m.r);
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Profit by category' });
    svg.append(el('line', { x1: sx(0), x2: sx(0), y1: m.t, y2: H - m.b, stroke: 'var(--muted)', 'stroke-width': 1 }));
    const tip = tipFor(container);
    rows.forEach((r, i) => {
      const y = m.t + i * rowH;
      const lab = el('text', { x: m.l - 10, y: y + rowH / 2 + 4, 'text-anchor': 'end', 'font-size': 12, fill: 'var(--text-2)' }); lab.textContent = r.label; svg.append(lab);
      const x0 = sx(Math.min(0, r.value)), x1 = sx(Math.max(0, r.value));
      const bar = el('rect', { x: x0, y: y + 7, width: Math.max(2, x1 - x0), height: rowH - 14, rx: 4, fill: r.value < 0 ? 'var(--bad)' : 'var(--chart)' });
      svg.append(bar);
      // Always label to the right: past the bar end for positives, past the zero line for negatives.
      // Putting negatives on the left collided with the category label.
      const val = el('text', { x: x1 + 6, y: y + rowH / 2 + 4, 'text-anchor': 'start', 'font-size': 12, fill: 'var(--text)', 'font-weight': 600 });
      val.textContent = format(r.value); svg.append(val);
      const hit = el('rect', { x: 0, y, width: W, height: rowH, fill: 'transparent' });
      hit.addEventListener('mouseenter', () => {
        const b = svg.getBoundingClientRect();
        bar.setAttribute('opacity', 0.8);
        tip.innerHTML = `<strong>${r.label}</strong><br>${r.detail || format(r.value)}`;
        tip.style.left = (x1 / W * b.width) + 'px'; tip.style.top = (y / H * b.height) + 'px'; tip.classList.add('on');
      });
      hit.addEventListener('mouseleave', () => { bar.setAttribute('opacity', 1); tip.classList.remove('on'); });
      svg.append(hit);
    });
    container.append(svg);
  }

  window.FDCharts = { line, hbars };
})();
