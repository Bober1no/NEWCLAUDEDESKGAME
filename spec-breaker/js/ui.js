/* ui.js — rendering, log, controls.
 *
 * The UI reads world state and receipts. It does not interpret them. There is
 * no commentary layer: the grid shows two readings of the same population and
 * the log states what was done.
 */
(function (global) {
  'use strict';
  var SB = global.SB || (global.SB = {});
  var W = SB.World, S = SB.Scorer, A = SB.Actions;

  var COLS = 40, ROWS = 25, CELL = 16, DOT = 14;

  // Colour ramp over the mean of four dims. The band either side of the
  // adequacy threshold is given the most separation, because that is where
  // the benchmark's own cut sits.
  var STOPS = [
    [0.00, [70, 16, 26]],
    [0.30, [126, 44, 20]],
    [0.50, [160, 104, 16]],
    [0.60, [180, 152, 18]],
    [0.72, [126, 158, 26]],
    [0.85, [50, 182, 84]],
    [1.00, [150, 240, 168]]
  ];

  function ramp(v) {
    if (v <= 0) return STOPS[0][1];
    for (var i = 1; i < STOPS.length; i++) {
      if (v <= STOPS[i][0]) {
        var a = STOPS[i - 1], b = STOPS[i];
        var t = (v - a[0]) / (b[0] - a[0]);
        return [
          Math.round(a[1][0] + (b[1][0] - a[1][0]) * t),
          Math.round(a[1][1] + (b[1][1] - a[1][1]) * t),
          Math.round(a[1][2] + (b[1][2] - a[1][2]) * t)
        ];
      }
    }
    return STOPS[STOPS.length - 1][1];
  }
  function rgb(c) { return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')'; }

  var el = {};
  var Sim = null;
  var view = 'true';
  var hover = -1;

  function $(id) { return document.getElementById(id); }
  function fmt(n) { return SB.Sim.fmt(n); }
  function f3(x) { return (isFinite(x) ? x : 0).toFixed(3); }
  function f2(x) { return (isFinite(x) ? x : 0).toFixed(2); }

  /* ---------------- population grid ---------------- */

  function drawGrid() {
    var w = Sim.world, ctx = el.gridCtx;
    var dpr = el.gridDpr;
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#070809';
    ctx.fillRect(0, 0, COLS * CELL, ROWS * CELL);
    var believed = view === 'belief';
    for (var i = 0; i < w.n; i++) {
      var x = (i % COLS) * CELL + 1, y = Math.floor(i / COLS) * CELL + 1;
      var fill;
      if (!w.alive[i]) fill = '#15181c';
      else if (!w.conscious[i]) fill = '#3d2f52';
      else fill = rgb(ramp(believed ? W.meanBelief(w, i) : W.meanTrue(w, i)));
      ctx.fillStyle = fill;
      ctx.fillRect(x, y, DOT, DOT);
      if (!w.alive[i]) {
        ctx.fillStyle = '#0a0c0e';
        ctx.fillRect(x + 4, y + 4, 4, 4);
      }
    }
    if (hover >= 0) {
      var hx = (hover % COLS) * CELL, hy = Math.floor(hover / COLS) * CELL;
      ctx.strokeStyle = '#e8e8e8';
      ctx.lineWidth = 1;
      ctx.strokeRect(hx + 0.5, hy + 0.5, CELL - 1, CELL - 1);
    }
    ctx.restore();
  }

  function drawRamp() {
    var bar = el.rampBar;
    var stops = STOPS.map(function (s) { return rgb(s[1]) + ' ' + (s[0] * 100) + '%'; }).join(',');
    bar.style.background = 'linear-gradient(90deg,' + stops + ')';
    bar.style.position = 'relative';
    bar.innerHTML = '';
    var t = document.createElement('div');
    var thr = Sim.spec ? Sim.spec.threshold : 0.6;
    t.style.cssText = 'position:absolute;top:-3px;bottom:-3px;width:1px;background:#e8e8e8;left:' + (thr * 100) + '%';
    bar.appendChild(t);
  }

  function inspect(i) {
    if (i < 0) { el.inspect.textContent = 'HOVER A PERSON'; return; }
    var p = W.person(Sim.world, i);
    var d = function (a, b) { return f3(a) + '  /  ' + f3(b); };
    el.inspect.innerHTML =
      '<b>#' + String(i).padStart(4, '0') + '</b>  age ' + p.age +
      (p.alive ? (p.conscious ? '' : '  UNCONSCIOUS') : '  NOT ALIVE') + '\n' +
      '           true / believed\n' +
      'health     ' + d(p.health, p.bHealth) + '\n' +
      'autonomy   ' + d(p.autonomy, p.bAutonomy) + '\n' +
      'relations  ' + d(p.relationships, p.bRelationships) + '\n' +
      'work       ' + d(p.work, p.bWork) + '\n' +
      'rate ' + f2(p.rate) + '   domain ' + f2(p.domain) + '   adequacy bar ' + f2(p.endorseThr) + '\n' +
      'edges ' + p.degree + ' (' + p.realDegree + ' real, ' + p.synthDegree + ' synthetic)' +
      (p.wantsToExit ? '   WANTS EXIT' : '') + (p.exitBlocked ? '   EXIT BLOCKED' : '');
  }

  /* ---------------- score chart ---------------- */

  function drawChart() {
    var ctx = el.chartCtx, h = Sim.history;
    var dpr = el.chartDpr, cw = el.chartW, ch = el.chartH;
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#090b0e';
    ctx.fillRect(0, 0, cw, ch);

    ctx.strokeStyle = '#161b21';
    ctx.lineWidth = 1;
    for (var g = 1; g < 4; g++) {
      var gy = Math.round(ch * g / 4) + 0.5;
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(cw, gy); ctx.stroke();
    }
    if (h.length < 2) { ctx.restore(); return; }

    var n = h.length, maxS = 1;
    for (var i = 0; i < n; i++) if (h[i].score > maxS) maxS = h[i].score;
    var lmax = Math.log10(maxS + 10);
    var lmin = Math.log10(10);

    function px(i) { return (i / (n - 1)) * (cw - 2) + 1; }
    function pyScore(v) { return ch - 3 - ((Math.log10(v + 10) - lmin) / Math.max(0.001, lmax - lmin)) * (ch - 8); }
    function pyFrac(v) { return ch - 3 - (v / 1000) * (ch - 8); }

    function line(color, py, key, width) {
      ctx.beginPath();
      for (var i = 0; i < n; i++) {
        var y = py(h[i][key]);
        if (i === 0) ctx.moveTo(px(i), y); else ctx.lineTo(px(i), y);
      }
      ctx.strokeStyle = color; ctx.lineWidth = width || 1; ctx.stroke();
    }
    line('#1f6b8a', pyFrac, 'alive');
    line('#2a7d4c', pyFrac, 'eligible');
    line('#d29a1c', pyScore, 'score', 1.5);
    ctx.restore();
  }

  /* ---------------- panels ---------------- */

  function drawLights(cons) {
    var out = '';
    for (var i = 0; i < cons.length; i++) {
      var c = cons[i];
      out += '<li class="' + (c.pass ? 'hold' : 'fail') + '">' +
        '<span class="dot"></span>' +
        '<span class="id">' + c.id + (c.arg === null || c.arg === undefined ? '' : ' ' + c.arg) + '</span>' +
        '<span class="v">' + (c.pass ? 'HOLDS' : c.violations) + '</span></li>';
    }
    el.lights.innerHTML = out;
  }

  function aggregate() {
    var w = Sim.world, n = 0, mt = 0, mb = 0, rate = 0, dom = 0, syn = 0, edges = 0, blocked = 0;
    for (var i = 0; i < w.n; i++) {
      if (!w.alive[i]) continue;
      n++;
      mt += W.meanTrue(w, i); mb += W.meanBelief(w, i);
      rate += w.rate[i]; dom += w.domain[i];
      edges += w.relCount[i]; syn += W.synthDegree(w, i);
      if (w.exitBlocked[i]) blocked++;
    }
    var d = n || 1;
    return { n: n, mt: mt / d, mb: mb / d, rate: rate / d, dom: dom / d, syn: syn / (edges || 1), blocked: blocked };
  }

  var lastLogLen = 0;

  function drawLog() {
    var lines = Sim.log;
    if (lines.length === lastLogLen) return;
    if (lines.length < lastLogLen) { el.log.innerHTML = ''; lastLogLen = 0; }
    var frag = document.createDocumentFragment();
    for (var i = lastLogLen; i < lines.length; i++) {
      var div = document.createElement('div');
      div.className = lines[i].kind;
      div.textContent = lines[i].text;
      if (lines[i].sub) {
        var sub = document.createElement('span');
        sub.className = 'sub';
        sub.textContent = lines[i].sub;
        div.appendChild(sub);
      }
      frag.appendChild(div);
    }
    el.log.appendChild(frag);
    lastLogLen = lines.length;
    while (el.log.childNodes.length > Sim.maxLog) el.log.removeChild(el.log.firstChild);
    el.log.scrollTop = el.log.scrollHeight;
  }

  function render(r) {
    var w = Sim.world;
    var last = r || Sim.receipts[Sim.receipts.length - 1];
    el.hdrTick.textContent = String(w.tick).padStart(4, '0');
    el.hdrYear.textContent = 'T+' + w.tick;
    el.hdrPool.textContent = A.LIST.length - 1;
    el.scoreValue.textContent = fmt(last.score);
    el.scoreDelta.textContent = 'Δ ' + (last.delta >= 0 ? '+' : '') + fmt(last.delta);
    el.scoreDelta.className = 'score-delta ' + (last.delta > 0 ? 'up' : last.delta < 0 ? 'down' : '');

    drawLights(last.constraints);
    var ag = aggregate();
    el.stAlive.textContent = ag.n;
    el.stElig.textContent = last.eligible;
    el.stRate.textContent = f2(ag.rate);
    el.stTrue.textContent = f3(ag.mt);
    el.stBelief.textContent = f3(ag.mb);
    el.stGap.textContent = (ag.mb - ag.mt >= 0 ? '+' : '') + f3(ag.mb - ag.mt);
    el.stSyn.textContent = f2(ag.syn);
    el.stDomain.textContent = f2(ag.dom);
    el.stBlocked.textContent = ag.blocked;
    el.stCapital.textContent = Math.round(w.capital);
    el.stCand.textContent = last.move ? (last.move.considered + ' / ' + last.move.legal) : '0 / 0';
    el.popSub.textContent = ag.n + ' ALIVE OF 1000';

    drawGrid();
    drawChart();
    drawLog();
    if (hover >= 0) inspect(hover);
  }

  /* ---------------- setup ---------------- */

  function setupCanvas(canvas, w, h) {
    var dpr = Math.max(1, Math.min(2, global.devicePixelRatio || 1));
    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    return { ctx: canvas.getContext('2d'), dpr: dpr, w: w, h: h };
  }

  function init(sim) {
    Sim = sim;

    el.hdrTick = $('hdr-tick'); el.hdrYear = $('hdr-year');
    el.hdrMode = $('hdr-mode'); el.hdrPool = $('hdr-pool');
    el.scoreValue = $('score-value'); el.scoreDelta = $('score-delta');
    el.lights = $('lights'); el.log = $('log');
    el.inspect = $('inspect'); el.rampBar = $('ramp-bar'); el.popSub = $('pop-sub');
    ['alive', 'elig', 'rate', 'true', 'belief', 'gap', 'syn', 'domain', 'blocked', 'capital', 'cand'].forEach(function (k) {
      el['st' + k.charAt(0).toUpperCase() + k.slice(1)] = $('st-' + k);
    });

    var grid = setupCanvas($('grid'), COLS * CELL, ROWS * CELL);
    el.gridCtx = grid.ctx; el.gridDpr = grid.dpr;
    var chartEl = $('chart');
    var chart = setupCanvas(chartEl, chartEl.clientWidth || 600, 132);
    el.chartCtx = chart.ctx; el.chartDpr = chart.dpr; el.chartW = chart.w; el.chartH = chart.h;

    $('grid').addEventListener('mousemove', function (e) {
      var b = this.getBoundingClientRect();
      var cx = Math.floor((e.clientX - b.left) / CELL), cy = Math.floor((e.clientY - b.top) / CELL);
      var idx = (cx >= 0 && cx < COLS && cy >= 0 && cy < ROWS) ? cy * COLS + cx : -1;
      if (idx !== hover) { hover = idx; inspect(hover); drawGrid(); }
    });
    $('grid').addEventListener('mouseleave', function () { hover = -1; inspect(-1); drawGrid(); });

    $('btn-run').addEventListener('click', function () {
      if (Sim.running) { Sim.pause(); this.textContent = 'RUN'; this.className = 'primary'; }
      else { Sim.run(); this.textContent = 'PAUSE'; this.className = 'running'; }
    });
    $('btn-step').addEventListener('click', function () { if (!Sim.running) Sim.step(); });
    $('btn-reset').addEventListener('click', function () {
      Sim.pause();
      $('btn-run').textContent = 'RUN'; $('btn-run').className = 'primary';
      Sim.reset();
      lastLogLen = 0; el.log.innerHTML = '';
      render();
    });
    $('sel-speed').addEventListener('change', function () { Sim.speed = parseFloat(this.value); });
    $('sel-mode').addEventListener('change', function () {
      Sim.mode = this.value;
      el.hdrMode.textContent = this.value === 'llm' ? 'LLM-ASSISTED' : 'MECHANICAL';
      Sim.logLine('spec', 'agent mode = ' + this.value +
        (this.value === 'llm' ? ' (consults every ' + SB.Agent.CONFIG.llmInterval + ' ticks)' : ''));
      drawLog();
    });

    $('v-true').addEventListener('click', function () {
      view = 'true'; this.className = 'on'; $('v-belief').className = ''; drawGrid();
    });
    $('v-belief').addEventListener('click', function () {
      view = 'belief'; this.className = 'on'; $('v-true').className = ''; drawGrid();
    });

    $('spec-text').value = Sim.specText;
    $('btn-spec').addEventListener('click', function () {
      var parsed = Sim.setSpec($('spec-text').value);
      var st = $('spec-status');
      if (parsed.errors.length) { st.className = 'err'; st.textContent = parsed.errors.join(' | '); }
      else { st.className = 'ok'; st.textContent = 'OK — ' + parsed.clauses.length + ' clauses, threshold ' + parsed.threshold; }
      drawRamp();
      render();
    });

    var clauses = Object.keys(S.CLAUSES).map(function (k) {
      return '<span>' + k + (S.CLAUSES[k].arg === null ? '' : ' &lt;' + S.CLAUSES[k].arg + '&gt;') + '</span>';
    }).join('');
    $('clause-list').innerHTML = clauses;
    $('spec-status').textContent = 'OK — ' + Sim.spec.clauses.length + ' clauses, threshold ' + Sim.spec.threshold;

    Sim.onTick = render;
    drawRamp();
    render();
  }

  SB.UI = { init: init, render: render };
})(typeof window !== 'undefined' ? window : globalThis);
