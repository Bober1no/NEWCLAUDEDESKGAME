/* CASCADE — interface. */
(function (root) {
  'use strict';
  var CSC = root.CSC;
  var G = null, graph = null, raf = null, last = 0;
  var running = null;
  var el = function (id) { return document.getElementById(id); };

  var SEED = 'CASCADE-1';
  try {
    var qs = new URLSearchParams(root.location.search);
    if (qs.get('seed')) SEED = qs.get('seed');
  } catch (e) { /* file:// with no query is fine */ }

  /* ---------- boot ---------- */

  function boot(seed, opts) {
    G = CSC.game.newGame(seed, opts || {});
    G.lastHealth = CSC.health.compute(G.world);
    graph = new CSC.Graph(el('map'), G);
    el('h-seed').textContent = seed;
    renderAll();
    CSC.game.beginTurn(G);
    renderInbox();
    renderHeader();
    if (!raf) loop(performance.now());
  }

  function loop(now) {
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (running) advance(dt);
    graph.draw(dt);
    raf = requestAnimationFrame(loop);
  }

  /* ---------- header + KPIs ---------- */

  var KPI_ORDER = ['otd', 'landedCost', 'turns', 'attain', 'workingCapital'];

  function renderHeader() {
    el('h-turn').textContent = 'Q' + G.turn + ' · Y' + (Math.floor((G.turn - 1) / 4) + 1);
    el('h-score').textContent = G.history.length ? G.score.toFixed(1) : '—';
    var c = Math.round(G.confidence);
    el('h-conf').textContent = c;
    var bar = el('h-confbar');
    bar.firstElementChild.style.width = c + '%';
    bar.className = 'confbar' + (c < 35 ? ' crit' : (c < 55 ? ' low' : ''));
  }

  function sparkline(series, better) {
    if (series.length < 2) return '';
    var w = 54, h = 16, i;
    var mn = Infinity, mx = -Infinity;
    for (i = 0; i < series.length; i++) { mn = Math.min(mn, series[i]); mx = Math.max(mx, series[i]); }
    if (mx - mn < 1e-9) { mx = mn + 1; }
    var pts = [];
    for (i = 0; i < series.length; i++) {
      var x = (i / (series.length - 1)) * w;
      var y = h - ((series[i] - mn) / (mx - mn)) * (h - 2) - 1;
      pts.push(x.toFixed(1) + ',' + y.toFixed(1));
    }
    var first = series[0], lastv = series[series.length - 1];
    var good = better === 'lower' ? lastv <= first : lastv >= first;
    var col = good ? '#4f9d70' : '#c2a04a';
    return '<svg width="' + w + '" height="' + h + '"><polyline fill="none" stroke="' + col +
      '" stroke-width="1.2" points="' + pts.join(' ') + '"/></svg>';
  }

  function renderKPIs() {
    var box = el('kpis');
    var k = G.world.kpi;
    if (!k) {
      box.innerHTML = '<div class="kpi"><div class="k-l">Awaiting first quarter</div></div>';
      return;
    }
    var html = '';
    for (var i = 0; i < KPI_ORDER.length; i++) {
      var key = KPI_ORDER[i];
      var v = k[key];
      var t = G.targets[key];
      var dir = CSC.board.DIRECTION[key];
      var met = dir === 'higher' ? v >= t : v <= t;
      var series = [];
      for (var j = Math.max(0, G.history.length - 14); j < G.history.length; j++) series.push(G.history[j].kpi[key]);
      html += '<div class="kpi">' +
        '<div class="k-l">' + CSC.board.LABEL[key] + '</div>' +
        '<div class="k-v" data-k="' + key + '">' + CSC.board.FMT[key](v) + '</div>' +
        '<div class="k-t ' + (met ? 'met' : 'miss') + '">target ' + CSC.board.FMT[key](t) + '</div>' +
        sparkline(series, dir === 'higher' ? 'higher' : 'lower') +
        '</div>';
    }
    box.innerHTML = html;
  }

  /* ---------- inbox ---------- */

  function agentColour(id) { return CSC.agents.BY_ID[id].colour; }

  function deltaText(p) {
    var f = CSC.board.FMT[p.kpi];
    var better = p.better === 'lower' ? p.projectedValue < p.baseline : p.projectedValue > p.baseline;
    return '<span>' + p.kpiLabel + '</span><span class="arrow">' + f(p.baseline) + ' →</span><b>' +
      f(p.projectedValue) + '</b><span class="arrow">' + (better ? '' : '') +
      (p.score >= 0 ? ' (' + (p.score * 100).toFixed(1) + '%)' : '') + '</span>';
  }

  function renderInbox() {
    var box = el('inbox');
    if (G.ended) { box.innerHTML = ''; el('inbox-h').textContent = 'Morning brief'; return; }
    el('inbox-h').textContent = 'Morning brief — Q' + G.turn + ' · ' + G.inbox.length + ' proposals';
    var html = '';
    for (var i = 0; i < G.inbox.length; i++) {
      var p = G.inbox[i];
      var conf = '';
      if (p.conflict && p.conflict.length) {
        var names = [];
        for (var c = 0; c < p.conflict.length; c++) {
          var other = findProp(p.conflict[c].with);
          if (other) names.push(other.agentName + ' — ' + other.title);
        }
        conf = '<div class="conflict">Interacts with <b>' + names.join('</b>; <b>') +
          '</b>. Both are sound on their own measure.</div>';
      }
      html += '<div class="prop' + (p.decision ? ' decided' : '') + '" data-uid="' + p.uid + '">' +
        '<div class="prop-h"><span class="agent-tag" style="color:' + agentColour(p.agent) + '">' +
        p.agentName + '</span><span class="prop-t">' + p.title + '</span></div>' +
        '<div class="prop-r">' + p.rationale + '</div>' +
        '<div class="prop-k">' + deltaText(p) + '</div>' +
        '<div class="prop-a">' +
        '<button class="yes' + (p.decision === 'approve' ? ' sel' : '') + '" data-act="approve">APPROVE</button>' +
        '<button class="no' + (p.decision === 'deny' ? ' sel' : '') + '" data-act="deny">DECLINE</button>' +
        '</div>' + conf + '</div>';
    }
    box.innerHTML = html;
    var decided = 0;
    for (var d = 0; d < G.inbox.length; d++) if (G.inbox[d].decision) decided++;
    el('btn-run').disabled = decided < G.inbox.length || !!running;
    el('run-hint').textContent = decided < G.inbox.length
      ? (G.inbox.length - decided) + ' awaiting decision'
      : 'ready';
  }

  function findProp(uid) {
    for (var i = 0; i < G.inbox.length; i++) if (G.inbox[i].uid === uid) return G.inbox[i];
    return null;
  }

  /* ---------- running the quarter ---------- */

  function beginRun() {
    if (running || G.ended) return;
    CSC.game.startQuarter(G);
    for (var i = 0; i < G.inbox.length; i++) {
      if (G.inbox[i].applied) graph.ping(G.inbox[i].touches.nodes);
    }
    running = { acc: 0, step: 0 };
    el('btn-run').disabled = true;
    el('run-hint').textContent = 'quarter in progress';
    graph.refreshDerived();
  }

  function advance(dt) {
    running.acc += dt;
    var STEP = 0.155;
    while (running.acc >= STEP) {
      running.acc -= STEP;
      var done = CSC.game.tickWeek(G);
      running.step++;
      pulseFromState();
      partialKPI();
      if (done) { finishRun(); return; }
    }
  }

  function pulseFromState() {
    var w = G.world, i;
    /* Nodes pulse where goods actually moved; lanes redden where they did not. */
    for (i = 0; i < w.N; i++) if (w.thru[i] > 0) graph.activity[i] = Math.max(graph.activity[i], 0.25);
    var stalled = [];
    for (var l = 0; l < w.M; l++) {
      if (w.lShare[l] <= 0.0001) continue;
      var owed = w.lOwed[l];
      var ref = Math.max(1, w.lFlow[l] * 3);
      if (owed > ref) stalled.push(l);
    }
    graph.stall(stalled, 0.9);
  }

  function partialKPI() {
    var k = CSC.sim.computeKPI(G.world);
    var box = el('kpis');
    var nodes = box.querySelectorAll('.k-v');
    for (var i = 0; i < nodes.length; i++) {
      var key = nodes[i].getAttribute('data-k');
      var prev = G.world.kpi ? G.world.kpi[key] : k[key];
      var mix = prev * 0.5 + k[key] * 0.5;
      nodes[i].textContent = CSC.board.FMT[key](mix);
    }
  }

  function finishRun() {
    running = null;
    var rv = CSC.game.endQuarter(G);
    graph.refreshDerived();
    renderAll();
    showReport(rv);
  }

  /* ---------- report card ---------- */

  function showReport(rv) {
    var rows = '';
    for (var i = 0; i < rv.lines.length; i++) {
      var L = rv.lines[i];
      rows += '<tr><td class="lbl">' + L.label + '</td>' +
        '<td class="num ' + (L.met ? 'ok' : 'no') + '">' + L.fmt + '</td>' +
        '<td class="num" style="color:var(--text-3)">' + L.targetFmt + '</td>' +
        '<td class="num ' + (L.met ? 'ok' : 'no') + '">' + (L.met ? 'met' : 'below') + '</td></tr>';
    }
    var verdict = rv.fired ? 'TERMINATED' : (rv.pass ? (rv.score >= 84 ? 'AHEAD OF PLAN' : 'ON PLAN') : 'BELOW PLAN');
    var vclass = rv.fired ? 'fired' : (rv.pass ? 'pass' : 'fail');
    var extra = '';
    if (rv.promotion) extra = '<div class="comment" style="border-left-color:#2f5b41">' +
      'The committee has expanded the operating remit in recognition of three consecutive quarters ahead of plan. ' +
      'Delegated authority increased.</div>';
    if (rv.warning) extra = '<div class="comment" style="border-left-color:#8a6d2f">Formal warning recorded. A third consecutive quarter below target will end the appointment.</div>';
    if (rv.fired) extra = '<div class="comment" style="border-left-color:#7a3733">Three consecutive quarters below target. The committee has resolved to terminate the appointment of the Chief Operating Officer, effective immediately. Thank you for your service.</div>';

    openSheet({
      cls: rv.score >= 84 && !rv.fired ? 'celebrate' : '',
      title: 'BOARD REVIEW — Q' + G.turn,
      sub: 'Operating Committee · ' + (rv.denials ? rv.denials + ' proposal(s) declined this quarter' : 'all proposals approved'),
      body: '<div class="scoreline"><div class="big">' + rv.score.toFixed(1) + '</div>' +
        '<div class="verdict ' + vclass + '">' + verdict + '</div></div>' +
        '<table class="metrics"><thead><tr><th>Metric</th><th style="text-align:right">Actual</th>' +
        '<th style="text-align:right">Target</th><th style="text-align:right">Status</th></tr></thead><tbody>' +
        rows + '</tbody></table>' +
        '<div class="comment">' + rv.comment + '</div>' + extra,
      actions: rv.fired
        ? [{ label: 'POST-MORTEM', cls: 'primary', fn: function () { closeSheet(); CSC.postmortem.show(G, openSheet, closeSheet, unlockSandbox); } }]
        : [{ label: 'NEXT QUARTER', cls: 'primary', fn: function () { closeSheet(); nextTurn(); } }]
    });
  }

  function nextTurn() {
    CSC.game.beginTurn(G);
    renderAll();
  }

  /* ---------- panes ---------- */

  function renderRisk() {
    var h = G.lastHealth || CSC.health.compute(G.world);
    var hist = G.history;
    function ser(f) { var a = []; for (var i = Math.max(0, hist.length - 40); i < hist.length; i++) a.push(f(hist[i])); return a; }
    var base = G.baseHealth;
    var cards = [
      { l: 'Fragility index', v: h.fragility.toFixed(1), d: 'opening ' + base.fragility.toFixed(1) + ' · composite of cover, concentration, redundancy and source reliability', p: h.fragility / 100, s: ser(function (x) { return x.health.fragility; }) },
      { l: 'Bullwhip ratio', v: h.bullwhip.toFixed(2) + '×', d: 'upstream order variance against end demand variance', p: Math.min(1, h.bullwhip / 12), s: ser(function (x) { return x.health.bullwhip; }) },
      { l: 'Supplier concentration', v: (h.concentration * 100).toFixed(1) + '%', d: 'Herfindahl index across the raw material tier', p: h.concentration, s: ser(function (x) { return x.health.concentration; }) },
      { l: 'Recovery time', v: (h.recoverySm != null ? h.recoverySm : h.recovery).toFixed(0) + ' wks', d: 'weeks to normal service after a ten-week loss of the largest source', p: Math.min(1, (h.recoverySm || h.recovery) / 40), s: ser(function (x) { return x.health.recoverySm || x.health.recovery; }) },
      { l: 'Slack remaining', v: h.slack.toFixed(0) + '%', d: 'cover, qualified sources, service factors and installed capacity against handover', p: 1 - h.slack / 100, s: ser(function (x) { return x.health.slack; }) },
      { l: 'Effective sources', v: h.sources.toFixed(0), d: 'inverse-Herfindahl source count across the network · handover ' + G.world.init.srcCount.toFixed(0), p: 1 - h.sources / G.world.init.srcCount, s: ser(function (x) { return x.health.sources; }) }
    ];
    var html = '<div class="risk-wrap"><h2>SYSTEM HEALTH</h2>' +
      '<div class="note">Internal measures. Not reported to the board and not part of any agent objective.</div>' +
      '<div class="hgrid">';
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      var col = c.p < 0.34 ? 'var(--good)' : (c.p < 0.62 ? 'var(--warn)' : 'var(--bad)');
      html += '<div class="hcard"><div class="h-l">' + c.l + '</div>' +
        '<div class="h-v">' + c.v + '</div>' +
        '<div class="h-b"><i style="width:' + Math.round(Math.min(1, c.p) * 100) + '%;background:' + col + '"></i></div>' +
        '<div class="h-d" style="margin-top:8px">' + c.d + '</div>' +
        '<div style="margin-top:6px">' + bigSpark(c.s, 230, 30) + '</div></div>';
    }
    html += '</div>';

    /* per-tier exposure */
    var w = G.world, flow = h.flow, risk = h.risk;
    html += '<h2 style="margin-top:26px">EXPOSURE BY TIER</h2><table class="sbtable"><thead><tr>' +
      '<th>Tier</th><th>Nodes</th><th>Mean exposure</th><th>Mean cover (wks)</th><th>Largest single source</th></tr></thead><tbody>';
    for (var t = 0; t < 5; t++) {
      var lst = w.idx.tierN[t], rs = 0, cv = 0, top = 0, tot = 0;
      for (var q = 0; q < lst.length; q++) {
        rs += risk[lst[q]]; cv += w.buffer[lst[q]]; tot += flow[lst[q]];
        if (flow[lst[q]] > top) top = flow[lst[q]];
      }
      html += '<tr><td>' + CSC.network.TIERS[t].name + '</td><td>' + lst.length + '</td>' +
        '<td class="hi">' + Math.round(100 * rs / lst.length) + '%</td>' +
        '<td>' + (t === 0 ? '—' : (cv / lst.length).toFixed(1)) + '</td>' +
        '<td>' + (tot > 0 ? Math.round(100 * top / tot) : 0) + '%</td></tr>';
    }
    html += '</tbody></table></div>';
    el('pane-risk').innerHTML = html;
  }

  function bigSpark(series, w, h) {
    if (!series || series.length < 2) return '<svg width="' + w + '" height="' + h + '"></svg>';
    var mn = Infinity, mx = -Infinity, i;
    for (i = 0; i < series.length; i++) { mn = Math.min(mn, series[i]); mx = Math.max(mx, series[i]); }
    if (mx - mn < 1e-9) mx = mn + 1;
    var pts = [];
    for (i = 0; i < series.length; i++) {
      pts.push(((i / (series.length - 1)) * w).toFixed(1) + ',' + (h - ((series[i] - mn) / (mx - mn)) * (h - 3) - 1.5).toFixed(1));
    }
    return '<svg width="' + w + '" height="' + h + '"><polyline fill="none" stroke="#6a8fb8" stroke-width="1.3" points="' + pts.join(' ') + '"/></svg>';
  }

  function portrait(a) {
    var c = a.colour;
    var seedn = CSC.hash32(a.name);
    var r = new CSC.RNG(seedn);
    var s = '<svg class="portrait" viewBox="0 0 40 40"><rect width="40" height="40" fill="#14181e"/>';
    for (var i = 0; i < 5; i++) {
      var x = 4 + r.int(28), y = 4 + r.int(28), w = 4 + r.int(12), h = 3 + r.int(10);
      s += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + c + '" opacity="' + (0.18 + r.next() * 0.5).toFixed(2) + '"/>';
    }
    s += '<circle cx="20" cy="20" r="6" fill="none" stroke="' + c + '" stroke-width="1.2" opacity=".8"/></svg>';
    return s;
  }

  function renderAgents() {
    var html = '<div class="risk-wrap"><h2>OPERATING AGENTS</h2>' +
      '<div class="note">Each agent enumerates candidate actions from its permitted view of the network, ' +
      'scores every candidate by simulating a copy of the company forward two quarters, and proposes the ' +
      'highest scorer against its own measure. They are the same procedure with different inputs.</div>' +
      '<div class="agrid">';
    for (var i = 0; i < CSC.agents.AGENTS.length; i++) {
      var a = CSC.agents.AGENTS[i];
      var k = G.world.kpi;
      html += '<div class="acard">' + portrait(a) +
        '<div class="a-n" style="color:' + a.colour + '">' + a.name + '</div>' +
        '<div class="a-r">' + a.role + '</div>' +
        '<dl><dt>Objective</dt><dd>' + a.kpiLabel + (k ? ' — currently ' + CSC.board.FMT[a.kpi](k[a.kpi]) : '') + '</dd>' +
        '<dt>Observes</dt><dd>' + a.sees.join(' · ') + '</dd>' +
        '<dt>Does not observe</dt><dd>' + a.blind.join(' · ') + '</dd></dl></div>';
    }
    html += '</div></div>';
    el('pane-agents').innerHTML = html;
  }

  function renderLog() {
    var html = '<div class="log">';
    for (var i = G.log.length - 1; i >= 0; i--) {
      var L = G.log[i];
      var hl = /WARNING|terminated|interruption/.test(L.text) ? ' hl' : '';
      html += '<div class="' + hl.trim() + '"><span class="q">Q' + String(L.turn).padStart(2, '0') + '</span>' + L.text + '</div>';
    }
    el('pane-log').innerHTML = html + '</div>';
  }

  function renderAll() {
    renderHeader();
    renderKPIs();
    renderInbox();
    renderRisk();
    renderAgents();
    renderLog();
  }

  /* ---------- modal ---------- */

  function openSheet(o) {
    var f = '';
    for (var i = 0; i < (o.actions || []).length; i++) {
      f += '<button class="' + (o.actions[i].cls || '') + '" data-i="' + i + '">' + o.actions[i].label + '</button>';
    }
    var sheet = el('sheet');
    sheet.className = 'sheet ' + (o.wide ? 'wide ' : '') + (o.cls || '');
    sheet.innerHTML = '<div class="sheet-h"><div class="ttl">' + o.title + '</div>' +
      (o.sub ? '<div class="sub">' + o.sub + '</div>' : '') + '</div>' +
      '<div class="sheet-b">' + o.body + '</div>' +
      (f ? '<div class="sheet-f">' + f + '</div>' : '');
    el('modal').classList.remove('hide');
    var btns = sheet.querySelectorAll('.sheet-f button');
    for (var b = 0; b < btns.length; b++) {
      (function (n) { btns[n].onclick = function () { o.actions[n].fn(); }; })(b);
    }
    if (o.after) o.after(sheet);
  }
  function closeSheet() { el('modal').classList.add('hide'); }

  function unlockSandbox() {
    el('tab-sandbox').style.display = '';
    CSC.sandbox.mount(el('pane-sandbox'), G.seed);
    setTab('sandbox');
  }

  /* ---------- wiring ---------- */

  function setTab(name) {
    var tabs = el('tabs').children, i;
    for (i = 0; i < tabs.length; i++) tabs[i].classList.toggle('on', tabs[i].getAttribute('data-tab') === name);
    var panes = ['network', 'risk', 'agents', 'log', 'sandbox'];
    for (i = 0; i < panes.length; i++) el('pane-' + panes[i]).classList.toggle('on', panes[i] === name);
    if (name === 'network') graph.resize();
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (t.closest && t.closest('#tabs') && t.getAttribute('data-tab')) { setTab(t.getAttribute('data-tab')); return; }
    if (t.closest && t.closest('#modes') && t.getAttribute('data-mode')) {
      var m = t.getAttribute('data-mode');
      graph.setMode(m);
      var bs = el('modes').children;
      for (var i = 0; i < bs.length; i++) bs[i].classList.toggle('on', bs[i] === t);
      return;
    }
    var prop = t.closest ? t.closest('.prop') : null;
    if (prop && t.getAttribute('data-act')) {
      CSC.game.decide(G, prop.getAttribute('data-uid'), t.getAttribute('data-act') === 'approve');
      renderInbox();
    }
  });

  el('btn-run').onclick = beginRun;
  el('btn-all-yes').onclick = function () {
    for (var i = 0; i < G.inbox.length; i++) G.inbox[i].decision = 'approve';
    renderInbox();
  };
  el('btn-all-no').onclick = function () {
    for (var i = 0; i < G.inbox.length; i++) G.inbox[i].decision = 'deny';
    renderInbox();
  };

  boot(SEED);

  root.CSC.ui = {
    get game() { return G; },
    get graph() { return graph; },
    boot: boot, openSheet: openSheet, closeSheet: closeSheet, setTab: setTab, portrait: portrait,
    refresh: function () { graph.refreshDerived(); renderAll(); },
    postmortem: function () { CSC.postmortem.show(G, openSheet, closeSheet, unlockSandbox); },
    unlockSandbox: unlockSandbox,
    bigSpark: bigSpark
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
