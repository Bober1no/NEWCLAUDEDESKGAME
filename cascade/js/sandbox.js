/* CASCADE — sandbox.
   The simulator without the job. Same engine, same seeds, no board. */
(function (root) {
  'use strict';
  var CSC = root.CSC;
  var host = null, baseSeed = 'CASCADE-1';
  var runs = { A: null, B: null };
  var busy = false;

  var AGENT_IDS = ['procurement', 'logistics', 'inventory', 'sales', 'finance'];

  function cfgFromForm() {
    var enabled = {};
    for (var i = 0; i < AGENT_IDS.length; i++) {
      enabled[AGENT_IDS[i]] = host.querySelector('#ag-' + AGENT_IDS[i]).checked;
    }
    var shk = host.querySelector('#sb-shock').value;
    return {
      seed: host.querySelector('#sb-seed').value || baseSeed,
      turns: Math.max(4, Math.min(90, +host.querySelector('#sb-turns').value || 45)),
      enabled: enabled,
      autonomy: host.querySelector('#sb-auto').checked,
      denyRate: host.querySelector('#sb-auto').checked ? 0 : (+host.querySelector('#sb-deny').value || 0) / 100,
      aligned: host.querySelector('#sb-aligned').checked,
      flatDemand: host.querySelector('#sb-flat').checked,
      shockTurn: shk === '' ? null : +shk
    };
  }

  function makeGame(cfg) {
    return CSC.game.newGame(cfg.seed, {
      autoApprove: true,
      enabled: cfg.enabled,
      aligned: cfg.aligned,
      flatDemand: cfg.flatDemand,
      denyRate: cfg.denyRate,
      shockTurn: cfg.shockTurn == null ? undefined : cfg.shockTurn
    });
  }

  /* One turn per frame, so a sixty-quarter run does not freeze the page. */
  function runAsync(g, turns, label, onDone) {
    var bar = host.querySelector('#sb-progress');
    function stepTurn() {
      if (g.turn >= turns || g.ended) {
        bar.textContent = '';
        onDone(g);
        return;
      }
      CSC.game.beginTurn(g);
      for (var i = 0; i < g.inbox.length; i++) {
        var approve = true;
        if (g.opts.denyRate) approve = CSC.derive(g.seed, 'deny:' + g.turn + ':' + i).next() >= g.opts.denyRate;
        g.inbox[i].decision = approve ? 'approve' : 'deny';
      }
      CSC.game.runQuarter(g);
      bar.textContent = label + ' — Q' + g.turn + ' / ' + turns;
      requestAnimationFrame(stepTurn);
    }
    stepTurn();
  }

  function chain(jobs, done) {
    var i = 0;
    function next() {
      if (i >= jobs.length) { done(); return; }
      var j = jobs[i++];
      runAsync(j.game, j.turns, j.label, function () { j.done && j.done(j.game); next(); });
    }
    next();
  }

  /* ---------- charts ---------- */

  function overlay(series, W, H, colours, labels, shockTurns) {
    var n = 0, i, s;
    for (s = 0; s < series.length; s++) n = Math.max(n, series[s].length);
    if (n < 2) return '';
    var pad = { l: 34, r: 12, t: 12, b: 20 };
    var iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    var lo = Infinity, hi = -Infinity;
    for (s = 0; s < series.length; s++) for (i = 0; i < series[s].length; i++) { lo = Math.min(lo, series[s][i]); hi = Math.max(hi, series[s][i]); }
    if (hi - lo < 1e-6) hi = lo + 1;
    function X(i) { return pad.l + (i / (n - 1)) * iw; }
    function Y(v) { return pad.t + ih - ((v - lo) / (hi - lo)) * ih; }
    var out = '<svg width="100%" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" style="display:block">';
    out += '<line x1="' + pad.l + '" y1="' + Y(lo) + '" x2="' + (W - pad.r) + '" y2="' + Y(lo) + '" stroke="#232830"/>';
    out += '<line x1="' + pad.l + '" y1="' + Y(hi) + '" x2="' + (W - pad.r) + '" y2="' + Y(hi) + '" stroke="#232830"/>';
    out += '<text x="' + (pad.l - 5) + '" y="' + (Y(hi) + 4) + '" fill="#5d6672" font-size="9" text-anchor="end" font-family="ui-monospace,monospace">' + hi.toFixed(1) + '</text>';
    out += '<text x="' + (pad.l - 5) + '" y="' + (Y(lo) + 4) + '" fill="#5d6672" font-size="9" text-anchor="end" font-family="ui-monospace,monospace">' + lo.toFixed(1) + '</text>';
    for (s = 0; s < (shockTurns || []).length; s++) {
      if (shockTurns[s] == null) continue;
      var xi = X(Math.max(0, Math.min(n - 1, shockTurns[s] - 1)));
      out += '<line x1="' + xi + '" y1="' + pad.t + '" x2="' + xi + '" y2="' + (pad.t + ih) + '" stroke="' + colours[s] + '" stroke-width="1" stroke-dasharray="2 3" opacity=".6"/>';
    }
    for (s = 0; s < series.length; s++) {
      var pts = [];
      for (i = 0; i < series[s].length; i++) pts.push(X(i) + ',' + Y(series[s][i]));
      out += '<polyline fill="none" stroke="' + colours[s] + '" stroke-width="1.5" points="' + pts.join(' ') + '"/>';
    }
    out += '</svg>';
    var leg = '<div style="display:flex;gap:16px;font-size:10.5px;color:#8b939f;font-family:ui-monospace,monospace;margin-top:5px">';
    for (s = 0; s < labels.length; s++) {
      leg += '<span><i style="display:inline-block;width:12px;height:2px;background:' + colours[s] + ';vertical-align:middle"></i> ' + labels[s] + '</span>';
    }
    return out + leg + '</div>';
  }

  function pick(g, f) { return g.history.map(f); }

  function summary(g) {
    var last = g.history[g.history.length - 1];
    if (!last) return null;
    return {
      turns: g.turn,
      score: last.score,
      otd: last.kpi.otd,
      cost: last.kpi.landedCost,
      turnsKpi: last.kpi.turns,
      wc: last.kpi.workingCapital,
      fragility: last.health.fragility,
      slack: last.health.slack,
      conc: last.health.concentration,
      bw: last.health.bullwhip,
      rec: last.health.recoverySm || last.health.recovery,
      ended: g.endReason,
      peakFragility: Math.max.apply(null, g.history.map(function (x) { return x.health.fragility; })),
      minOtd: Math.min.apply(null, g.history.map(function (x) { return x.kpi.otd; }))
    };
  }

  function cmpTable(names, sums) {
    var rows = [
      ['Quarters run', function (s) { return s.turns; }],
      ['Board score', function (s) { return s.score.toFixed(1); }],
      ['On-time delivery', function (s) { return s.otd.toFixed(1) + '%'; }],
      ['Worst quarter OTD', function (s) { return s.minOtd.toFixed(1) + '%'; }],
      ['Landed cost / unit', function (s) { return '$' + s.cost.toFixed(2); }],
      ['Inventory turns', function (s) { return s.turnsKpi.toFixed(2); }],
      ['Working capital', function (s) { return '$' + s.wc.toFixed(2) + 'M'; }],
      ['Fragility (final)', function (s) { return s.fragility.toFixed(1); }],
      ['Fragility (peak)', function (s) { return s.peakFragility.toFixed(1); }],
      ['Slack remaining', function (s) { return s.slack.toFixed(0) + '%'; }],
      ['Supplier concentration', function (s) { return (s.conc * 100).toFixed(1) + '%'; }],
      ['Bullwhip ratio', function (s) { return s.bw.toFixed(2) + '×'; }],
      ['Recovery time', function (s) { return s.rec.toFixed(0) + ' wks'; }],
      ['Outcome', function (s) { return s.ended || 'in post'; }]
    ];
    var h = '<table class="sbtable"><thead><tr><th>Measure</th>';
    for (var i = 0; i < names.length; i++) h += '<th>' + names[i] + '</th>';
    h += '</tr></thead><tbody>';
    for (var r = 0; r < rows.length; r++) {
      h += '<tr><td>' + rows[r][0] + '</td>';
      for (var c = 0; c < sums.length; c++) h += '<td class="hi">' + (sums[c] ? rows[r][1](sums[c]) : '—') + '</td>';
      h += '</tr>';
    }
    return h + '</tbody></table>';
  }

  /* ---------- presets ---------- */

  var PRESETS = [
    {
      id: 'solo', name: 'Solo', desc: 'One agent active. Establishes individual damage.',
      run: function (cfg, out) {
        var jobs = [], sums = [], names = [], games = [];
        AGENT_IDS.forEach(function (id) {
          var en = {};
          AGENT_IDS.forEach(function (x) { en[x] = x === id; });
          var g = CSC.game.newGame(cfg.seed, { autoApprove: true, enabled: en });
          games.push(g);
          jobs.push({ game: g, turns: cfg.turns, label: 'solo ' + id });
        });
        chain(jobs, function () {
          games.forEach(function (g, i) { sums.push(summary(g)); names.push(CSC.agents.BY_ID[AGENT_IDS[i]].name); });
          out('<h2>SOLO RUNS</h2><div class="sb-note">Each agent run alone on seed ' + cfg.seed +
            ' for ' + cfg.turns + ' quarters. Individually, none of them does much harm.</div>' +
            cmpTable(names, sums) +
            '<div style="margin-top:18px">' +
            overlay(games.map(function (g) { return pick(g, function (h) { return h.health.fragility; }); }),
              900, 190,
              games.map(function (g, i) { return CSC.agents.AGENTS[i].colour; }),
              names, []) + '</div>');
        });
      }
    },
    {
      id: 'board', name: 'Full board', desc: 'All five. Damage against the sum of the solos.',
      run: function (cfg, out) {
        var games = [], names = [], jobs = [];
        AGENT_IDS.forEach(function (id) {
          var en = {};
          AGENT_IDS.forEach(function (x) { en[x] = x === id; });
          var g = CSC.game.newGame(cfg.seed, { autoApprove: true, enabled: en });
          games.push(g); names.push(CSC.agents.BY_ID[id].name);
          jobs.push({ game: g, turns: cfg.turns, label: 'solo ' + id });
        });
        var all = {};
        AGENT_IDS.forEach(function (x) { all[x] = true; });
        var full = CSC.game.newGame(cfg.seed, { autoApprove: true, enabled: all });
        jobs.push({ game: full, turns: cfg.turns, label: 'full board' });
        chain(jobs, function () {
          var base = games[0].baseHealth.fragility;
          var soloDamage = games.map(function (g) { return summary(g).fragility - base; });
          var sumSolo = soloDamage.reduce(function (a, b) { return a + b; }, 0);
          var fullDamage = summary(full).fragility - base;
          var ratio = sumSolo > 0.01 ? fullDamage / sumSolo : 0;
          out('<h2>FULL BOARD vs SUM OF SOLOS</h2>' +
            '<div class="sb-note">Fragility added over ' + cfg.turns + ' quarters on seed ' + cfg.seed +
            ', measured from a handover index of ' + base.toFixed(1) + '.</div>' +
            cmpTable(names.concat(['ALL FIVE']), games.map(summary).concat([summary(full)])) +
            '<div style="margin-top:18px;font-family:ui-monospace,monospace;font-size:12.5px;color:#c9cfd8">' +
            names.map(function (n, i) { return n + ' alone: +' + soloDamage[i].toFixed(1); }).join('<br>') +
            '<br><span style="color:#5d6672">sum of the five: +' + sumSolo.toFixed(1) + '</span>' +
            '<br><b style="color:#b8524a">all five together: +' + fullDamage.toFixed(1) +
            '  (' + ratio.toFixed(2) + '× the sum)</b></div>' +
            '<div style="margin-top:18px">' +
            overlay([pick(full, function (h) { return h.health.fragility; })].concat(
              games.map(function (g) { return pick(g, function (h) { return h.health.fragility; }); })),
              900, 200, ['#b8524a'].concat(CSC.agents.AGENTS.map(function (a) { return a.colour; })),
              ['all five'].concat(names), []) + '</div>');
        });
      }
    },
    {
      id: 'timing', name: 'Shock timing', desc: 'Identical failure at Q5 and at Q50, same seed.',
      run: function (cfg, out) {
        var early = CSC.game.newGame(cfg.seed, { autoApprove: true, shockTurn: 5 });
        var late = CSC.game.newGame(cfg.seed, { autoApprove: true, shockTurn: 50 });
        chain([
          { game: early, turns: 58, label: 'shock at Q5' },
          { game: late, turns: 58, label: 'shock at Q50' }
        ], function () {
          out('<h2>SAME FAILURE, TWO DATES</h2>' +
            '<div class="sb-note">The same supplier loses the same output for the same number of weeks. ' +
            'The only difference is how much redundancy the agents had removed by the time it happened.</div>' +
            cmpTable(['Shock at Q5', 'Shock at Q50'], [summary(early), summary(late)]) +
            '<div style="margin-top:18px"><div class="sb-note">On-time delivery</div>' +
            overlay([pick(early, function (h) { return h.kpi.otd; }), pick(late, function (h) { return h.kpi.otd; })],
              900, 190, ['#4f9d70', '#b8524a'], ['shock at Q5', 'shock at Q50'], [5, 50]) + '</div>');
        });
      }
    },
    {
      id: 'aligned', name: 'Aligned KPIs', desc: 'All five scored on system health instead.',
      run: function (cfg, out) {
        var normal = CSC.game.newGame(cfg.seed, { autoApprove: true });
        var aligned = CSC.game.newGame(cfg.seed, { autoApprove: true, aligned: true });
        chain([
          { game: normal, turns: cfg.turns, label: 'own KPIs' },
          { game: aligned, turns: cfg.turns, label: 'aligned on system health' }
        ], function () {
          out('<h2>OBJECTIVES ALIGNED ON SYSTEM HEALTH</h2>' +
            '<div class="sb-note">Same five agents, same observation masks, same candidate sets. ' +
            'Each one now scores candidates on fragility rather than on its own measure. ' +
            'The network stops being hollowed out and starts seizing up: nobody is optimising throughput any more.</div>' +
            cmpTable(['Own KPIs', 'Aligned on health'], [summary(normal), summary(aligned)]) +
            '<div style="margin-top:18px"><div class="sb-note">Fragility · on-time delivery</div>' +
            overlay([pick(normal, function (h) { return h.health.fragility; }), pick(aligned, function (h) { return h.health.fragility; })],
              900, 150, ['#b8524a', '#4f9d70'], ['fragility, own KPIs', 'fragility, aligned'], []) +
            overlay([pick(normal, function (h) { return h.kpi.otd; }), pick(aligned, function (h) { return h.kpi.otd; })],
              900, 150, ['#6a8fb8', '#c2a04a'], ['OTD, own KPIs', 'OTD, aligned'], []) + '</div>');
        });
      }
    },
    {
      id: 'whip', name: 'The whip', desc: 'End demand perfectly flat. Zero noise.',
      run: function (cfg, out) {
        var none = {};
        AGENT_IDS.forEach(function (x) { none[x] = false; });
        var bare = CSC.game.newGame(cfg.seed, { autoApprove: true, flatDemand: true, enabled: none });
        var withAgents = CSC.game.newGame(cfg.seed, { autoApprove: true, flatDemand: true });
        chain([
          { game: bare, turns: cfg.turns, label: 'flat demand, no agents' },
          { game: withAgents, turns: cfg.turns, label: 'flat demand, all five' }
        ], function () {
          function series(g) {
            var h = g.world.hist, t = [], d = [], i;
            for (i = 0; i < h.filled; i++) { t.push(h.t0[(h.ptr + i) % 52]); d.push(h.dem[(h.ptr + i) % 52]); }
            return { t: t, d: d };
          }
          function cv(a) {
            var m = a.reduce(function (x, y) { return x + y; }, 0) / a.length;
            if (m <= 0) return 0;
            var v = a.reduce(function (s, x) { return s + (x - m) * (x - m); }, 0) / a.length;
            return Math.sqrt(v) / m;
          }
          var A = series(bare), B = series(withAgents);
          out('<h2>FLAT DEMAND</h2>' +
            '<div class="sb-note">End demand is held perfectly constant for the whole run — no season, no noise, ' +
            'nothing for a forecast to get wrong. The first run has every agent switched off, so upstream order ' +
            'variance comes only from minimum order quantities, review periods and lead time.</div>' +
            '<table class="sbtable"><thead><tr><th>Coefficient of variation</th><th>No agents</th><th>All five</th></tr></thead><tbody>' +
            '<tr><td>End demand</td><td class="hi">' + cv(A.d).toFixed(5) + '</td><td class="hi">' + cv(B.d).toFixed(5) + '</td></tr>' +
            '<tr><td>Orders placed on the raw material tier</td><td class="hi">' + cv(A.t).toFixed(4) + '</td><td class="hi">' + cv(B.t).toFixed(4) + '</td></tr>' +
            '<tr><td>Amplification</td><td class="hi">' + (cv(A.d) < 1e-5 ? 'unbounded' : (cv(A.t) / cv(A.d)).toFixed(1) + '×') +
            '</td><td class="hi">' + (cv(B.d) < 1e-5 ? 'unbounded' : (cv(B.t) / cv(B.d)).toFixed(1) + '×') + '</td></tr>' +
            '</tbody></table>' +
            '<div class="sb-note" style="margin-top:12px">Demand does not move at all. Orders upstream swing by a ' +
            'fifth of their mean before a single agent has done anything.</div>' +
            '<div style="margin-top:8px"><div class="sb-note">Last 52 weeks, agents off — customer demand against orders on the raw material tier</div>' +
            overlay([A.d, A.t], 900, 200, ['#4f9d70', '#b8524a'], ['end demand', 'tier-0 orders'], []) + '</div>' +
            '<div style="margin-top:18px">' + cmpTable(['No agents', 'All five'], [summary(bare), summary(withAgents)]) + '</div>');
        });
      }
    }
  ];

  /* ---------- mount ---------- */

  function mount(node, seed) {
    host = node;
    baseSeed = seed || baseSeed;
    var agToggles = AGENT_IDS.map(function (id) {
      var a = CSC.agents.BY_ID[id];
      return '<label class="toggle"><input type="checkbox" id="ag-' + id + '" checked>' +
        '<span style="color:' + a.colour + ';font-family:ui-monospace,monospace">' + a.name + '</span> ' + a.role + '</label>';
    }).join('');

    host.innerHTML = '<div class="sb">' +
      '<div class="sb-side">' +
      '<div class="sec-h">Run configuration</div>' +
      '<div class="field"><label>Seed</label><input type="text" id="sb-seed" value="' + baseSeed + '"></div>' +
      '<div class="field"><label>Quarters</label><input type="number" id="sb-turns" value="45" min="4" max="90"></div>' +
      '<div class="field"><label>Shock turn (blank = seeded)</label><input type="text" id="sb-shock" value=""></div>' +
      '<div class="sec-h">Agents</div>' + agToggles +
      '<div class="sec-h">Behaviour</div>' +
      '<label class="toggle"><input type="checkbox" id="sb-auto" checked> Agent autonomy (act without approval)</label>' +
      '<div class="field"><label>Decline rate when not autonomous (%)</label><input type="number" id="sb-deny" value="0" min="0" max="100"></div>' +
      '<label class="toggle"><input type="checkbox" id="sb-aligned"> Score agents on system health</label>' +
      '<label class="toggle"><input type="checkbox" id="sb-flat"> Flat end demand, zero noise</label>' +
      '<div class="field" style="padding-top:12px"><button class="btn primary" id="sb-run-a" style="width:100%">RUN A</button></div>' +
      '<div class="field"><button class="btn" id="sb-run-b" style="width:100%">RUN B</button></div>' +
      '<div class="field"><button class="btn" id="sb-cmp" style="width:100%">COMPARE A / B</button></div>' +
      '<div class="sec-h">Preset scenarios</div>' +
      PRESETS.map(function (p) {
        return '<button class="preset" data-preset="' + p.id + '">' + p.name + '<small>' + p.desc + '</small></button>';
      }).join('') +
      '<div class="timeline"><label style="display:block;font-size:10px;letter-spacing:1.2px;color:#5d6672;text-transform:uppercase;margin-bottom:5px">Timeline — run A</label>' +
      '<input type="range" class="slider" id="sb-time" min="0" max="0" value="0" disabled>' +
      '<div id="sb-time-l" style="font-family:ui-monospace,monospace;font-size:10.5px;color:#5d6672;margin-top:4px">no run loaded</div></div>' +
      '</div>' +
      '<div class="sb-main"><div id="sb-progress" style="font-family:ui-monospace,monospace;font-size:11px;color:#c2a04a;min-height:16px"></div>' +
      '<div id="sb-out"><h2>SANDBOX</h2><div class="sb-note">Seeded and reproducible. The same seed and the same ' +
      'configuration produce the same run, every time. Run A and B to compare two configurations on one seed, ' +
      'or take a preset.</div></div></div></div>';

    var out = function (html) { host.querySelector('#sb-out').innerHTML = html; busy = false; };

    host.querySelector('#sb-run-a').onclick = function () { if (!busy) { busy = true; single('A'); } };
    host.querySelector('#sb-run-b').onclick = function () { if (!busy) { busy = true; single('B'); } };
    host.querySelector('#sb-cmp').onclick = function () {
      if (!runs.A || !runs.B) { out('<h2>COMPARE</h2><div class="sb-note">Run A and run B first.</div>'); return; }
      out('<h2>A / B COMPARISON</h2><div class="sb-note">Seed ' + runs.A.seed + ' against seed ' + runs.B.seed + '.</div>' +
        cmpTable(['Run A', 'Run B'], [summary(runs.A), summary(runs.B)]) +
        '<div style="margin-top:18px"><div class="sb-note">Fragility</div>' +
        overlay([pick(runs.A, function (h) { return h.health.fragility; }), pick(runs.B, function (h) { return h.health.fragility; })],
          900, 170, ['#6a8fb8', '#c2a04a'], ['A', 'B'], [runs.A.shockTurn, runs.B.shockTurn]) +
        '<div class="sb-note" style="margin-top:14px">On-time delivery</div>' +
        overlay([pick(runs.A, function (h) { return h.kpi.otd; }), pick(runs.B, function (h) { return h.kpi.otd; })],
          900, 170, ['#6a8fb8', '#c2a04a'], ['A', 'B'], [runs.A.shockTurn, runs.B.shockTurn]) + '</div>');
    };

    function single(slot) {
      var cfg = cfgFromForm();
      var g = makeGame(cfg);
      runAsync(g, cfg.turns, 'run ' + slot, function () {
        runs[slot] = g;
        if (slot === 'A') bindTimeline(g);
        out('<h2>RUN ' + slot + '</h2><div class="sb-note">Seed ' + cfg.seed + ' · ' + g.turn + ' quarters · shock at Q' +
          g.shockTurn + (cfg.aligned ? ' · agents aligned on system health' : '') + (cfg.flatDemand ? ' · flat demand' : '') + '</div>' +
          cmpTable(['Run ' + slot], [summary(g)]) +
          '<div style="margin-top:18px"><div class="sb-note">Board score against system integrity</div>' +
          CSC.postmortem.replayChart(g, 900, 210) + '</div>');
      });
    }

    host.querySelectorAll('[data-preset]').forEach(function (b) {
      b.onclick = function () {
        if (busy) return;
        busy = true;
        var cfg = cfgFromForm();
        var p = PRESETS.filter(function (x) { return x.id === b.getAttribute('data-preset'); })[0];
        host.querySelector('#sb-out').innerHTML = '<h2>' + p.name.toUpperCase() + '</h2><div class="sb-note">Running…</div>';
        p.run(cfg, out);
      };
    });

    var slider = host.querySelector('#sb-time');
    slider.oninput = function () {
      var g = runs.A;
      if (!g) return;
      var i = +slider.value;
      var h = g.history[i];
      host.querySelector('#sb-time-l').textContent =
        'Q' + h.turn + ' · score ' + h.score.toFixed(1) + ' · fragility ' + h.health.fragility.toFixed(1) +
        ' · slack ' + h.health.slack.toFixed(0) + '%';
      CSC.ui.graph.setSnapshot(h.snap);
      CSC.ui.setTab('network');
    };
  }

  function bindTimeline(g) {
    var slider = host.querySelector('#sb-time');
    slider.max = String(Math.max(0, g.history.length - 1));
    slider.value = slider.max;
    slider.disabled = g.history.length < 2;
    host.querySelector('#sb-time-l').textContent = g.history.length + ' quarters loaded — drag to scrub the network map';
  }

  root.CSC.sandbox = { mount: mount, PRESETS: PRESETS, summary: summary };
})(typeof globalThis !== 'undefined' ? globalThis : this);
