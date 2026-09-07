/* CASCADE — post-mortem.
   The run, replayed against the measure nobody was watching, and the decisions
   that produced it. Nothing here is a revelation the player could not have had
   at the time. */
(function (root) {
  'use strict';
  var CSC = root.CSC;

  /* Everything downstream of the failed supplier, weighted by how much of it
     actually depends on that supplier. */
  function cascadeSet(g) {
    var w = g.world;
    var dep = new Float64Array(w.N);
    dep[w.shockNode] = 1;
    for (var t = 1; t <= 4; t++) {
      var lst = w.idx.tierN[t];
      for (var k = 0; k < lst.length; k++) {
        var i = lst[k], ins = w.idx.inL[i], tot = 0, acc = 0, x;
        for (x = 0; x < ins.length; x++) if (w.lShare[ins[x]] > 0.0001) tot += w.lShare[ins[x]];
        if (tot <= 0) continue;
        for (x = 0; x < ins.length; x++) {
          var L = ins[x];
          if (w.lShare[L] <= 0.0001) continue;
          acc += dep[w.lFrom[L]] * (w.lShare[L] / tot);
        }
        dep[i] = acc;
      }
    }
    return dep;
  }

  function contributions(g) {
    var dep = cascadeSet(g);
    var out = [];
    for (var i = 0; i < g.decisions.length; i++) {
      var d = g.decisions[i];
      if (!d.applied) continue;
      var touch = 0, n = 0, j;
      for (j = 0; j < d.touches.nodes.length; j++) { touch += dep[d.touches.nodes[j]] || 0; n++; }
      for (j = 0; j < d.touches.lanes.length; j++) { touch += dep[g.world.lTo[d.touches.lanes[j]]] || 0; n++; }
      var exposure = n > 0 ? touch / n : 0;
      var structural = Math.max(0, d.fragilityDelta)
        + Math.max(0, -d.slackDelta) * 0.5
        + Math.max(0, d.concentrationDelta) * 70;
      d.exposure = exposure;
      d.contribution = structural * (0.35 + 1.65 * exposure);
      out.push(d);
    }
    out.sort(function (a, b) { return b.contribution - a.contribution; });
    return out;
  }

  /* Board score against system integrity, on one axis, across the whole run. */
  function replayChart(g, W, H) {
    var hist = g.history;
    if (hist.length < 2) return '';
    var pad = { l: 40, r: 40, t: 16, b: 24 };
    var iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    var n = hist.length;
    function X(i) { return pad.l + (i / (n - 1)) * iw; }
    function Y(v) { return pad.t + ih - (Math.max(0, Math.min(115, v)) / 115) * ih; }
    var perf = [], integ = [], i;
    for (i = 0; i < n; i++) {
      perf.push(X(i) + ',' + Y(hist[i].score));
      integ.push(X(i) + ',' + Y(100 - hist[i].health.fragility));
    }
    var grid = '';
    for (var gv = 0; gv <= 100; gv += 25) {
      grid += '<line x1="' + pad.l + '" y1="' + Y(gv) + '" x2="' + (W - pad.r) + '" y2="' + Y(gv) +
        '" stroke="#232830" stroke-width="1"/>' +
        '<text x="' + (pad.l - 7) + '" y="' + (Y(gv) + 3.5) + '" fill="#5d6672" font-size="9" text-anchor="end" font-family="ui-monospace,monospace">' + gv + '</text>';
    }
    var shock = '';
    if (g.shockFired) {
      var si = Math.max(0, Math.min(n - 1, g.shockTurn - 1));
      shock = '<line x1="' + X(si) + '" y1="' + pad.t + '" x2="' + X(si) + '" y2="' + (pad.t + ih) +
        '" stroke="#8a5b56" stroke-width="1" stroke-dasharray="3 3"/>' +
        '<text x="' + (X(si) + 5) + '" y="' + (pad.t + 11) + '" fill="#a8756e" font-size="9.5" font-family="ui-monospace,monospace">supplier failure · Q' + g.shockTurn + '</text>';
    }
    var ticks = '';
    for (i = 0; i < n; i += Math.max(1, Math.round(n / 10))) {
      ticks += '<text x="' + X(i) + '" y="' + (H - 7) + '" fill="#5d6672" font-size="9" text-anchor="middle" font-family="ui-monospace,monospace">Q' + hist[i].turn + '</text>';
    }
    return '<svg width="100%" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" style="display:block">' +
      grid + shock +
      '<polyline fill="none" stroke="#4f9d70" stroke-width="1.6" points="' + perf.join(' ') + '"/>' +
      '<polyline fill="none" stroke="#b8524a" stroke-width="1.6" points="' + integ.join(' ') + '"/>' +
      ticks + '</svg>';
  }

  function traceRow(g, d) {
    var a = CSC.agents.BY_ID[d.agent];
    var f = CSC.board.FMT[a.kpi];
    var cands = '';
    for (var i = 0; i < Math.min(4, d.candidates.length); i++) {
      var c = d.candidates[i];
      cands += '<div class="cands"><span class="' + (i === 0 ? 'win' : '') + '">' +
        (i === 0 ? '▸ ' : '  ') + (c.score * 100).toFixed(2) + '%  ' + c.title + '</span></div>';
    }
    return '<div class="trace-row">' +
      '<div class="tr-h"><span class="tr-q">Q' + d.turn + '</span>' +
      '<span class="agent-tag" style="color:' + a.colour + '">' + d.agentName + '</span>' +
      '<span class="tr-t">' + d.title + '</span></div>' +
      '<dl class="tr-body">' +
      '<div><dt>What it could see</dt><dd>' + d.sees.join(' · ') + '</dd></div>' +
      '<div><dt>What it could not</dt><dd>' + d.blind.join(' · ') + '</dd></div>' +
      '<div><dt>Why it scored highest</dt><dd>Best of ' + d.considered + ' candidates on ' + d.kpiLabel.toLowerCase() +
      ': ' + f(d.baseline) + ' → ' + f(d.projectedValue) + ' over two quarters.' + cands + '</dd></div>' +
      '<div><dt>Effect on system health</dt><dd>fragility ' + (d.fragilityDelta >= 0 ? '+' : '') + d.fragilityDelta.toFixed(2) +
      ' · slack ' + d.slackDelta.toFixed(2) + '% · concentration ' + (d.concentrationDelta >= 0 ? '+' : '') +
      (d.concentrationDelta * 100).toFixed(2) + 'pp · exposure to the failed source ' + Math.round(d.exposure * 100) + '%' +
      '<div style="margin-top:5px;color:#8b939f">You approved this.</div></dd></div>' +
      '</dl></div>';
  }

  /* Ranked by contribution, but capped at three per agent: the point is not
     that one agent was worse, it is that all of them were reasonable. */
  function rankedTrace(contrib, limit) {
    var perAgent = {}, first = [], rest = [];
    for (var i = 0; i < contrib.length; i++) {
      var a = contrib[i].agent;
      perAgent[a] = (perAgent[a] || 0) + 1;
      if (perAgent[a] <= 3) first.push(contrib[i]); else rest.push(contrib[i]);
    }
    return first.concat(rest).slice(0, limit).sort(function (x, y) { return y.contribution - x.contribution; });
  }

  function byAgent(contrib) {
    var m = {};
    for (var i = 0; i < contrib.length; i++) {
      var d = contrib[i];
      if (!m[d.agent]) m[d.agent] = { n: 0, c: 0, frag: 0 };
      m[d.agent].n++;
      m[d.agent].c += d.contribution;
      m[d.agent].frag += d.fragilityDelta;
    }
    return m;
  }

  function show(g, openSheet, closeSheet, unlockSandbox) {
    var contrib = contributions(g);
    var top = rankedTrace(contrib, 12);
    var per = byAgent(contrib);
    var approved = 0, declined = 0, improved = 0;
    for (var i = 0; i < g.decisions.length; i++) {
      if (g.decisions[i].approved) approved++; else declined++;
      if (g.decisions[i].score > 0) improved++;
    }
    var h0 = g.baseHealth, hN = g.lastHealth;
    var k0 = g.baseline, kN = g.world.kpi;

    function row(label, a, b, fmt) {
      return '<tr><td class="lbl">' + label + '</td><td class="num">' + fmt(a) + '</td>' +
        '<td class="num" style="color:var(--text-3)">→</td><td class="num hi">' + fmt(b) + '</td></tr>';
    }
    var pct = function (v) { return v.toFixed(1) + '%'; };
    var num = function (v) { return v.toFixed(1); };

    var body =
      '<div class="pm-sec"><h3>The run</h3>' +
      replayChart(g, 1120, 250) +
      '<div style="display:flex;gap:22px;font-size:11px;color:#8b939f;margin-top:8px;font-family:ui-monospace,monospace">' +
      '<span><i style="display:inline-block;width:14px;height:2px;background:#4f9d70;vertical-align:middle"></i> board score</span>' +
      '<span><i style="display:inline-block;width:14px;height:2px;background:#b8524a;vertical-align:middle"></i> system integrity (100 − fragility)</span>' +
      '</div></div>' +

      '<div class="pm-sec"><h3>What the board saw · what it did not</h3>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:26px">' +
      '<table class="metrics"><thead><tr><th>Company KPI</th><th style="text-align:right">Handover</th><th></th><th style="text-align:right">Final</th></tr></thead><tbody>' +
      row('On-time delivery', k0.otd, kN.otd, CSC.board.FMT.otd) +
      row('Landed cost / unit', k0.landedCost, kN.landedCost, CSC.board.FMT.landedCost) +
      row('Inventory turns', k0.turns, kN.turns, CSC.board.FMT.turns) +
      row('Forecast attainment', k0.attain, kN.attain, CSC.board.FMT.attain) +
      row('Working capital', k0.workingCapital, kN.workingCapital, CSC.board.FMT.workingCapital) +
      '</tbody></table>' +
      '<table class="metrics"><thead><tr><th>System health</th><th style="text-align:right">Handover</th><th></th><th style="text-align:right">Final</th></tr></thead><tbody>' +
      row('Fragility index', h0.fragility, hN.fragility, num) +
      row('Bullwhip ratio', h0.bullwhip, hN.bullwhip, function (v) { return v.toFixed(2) + '×'; }) +
      row('Supplier concentration', h0.concentration * 100, hN.concentration * 100, pct) +
      row('Recovery time', g.baseRecovery, g.recoverySm || hN.recovery, function (v) { return v.toFixed(0) + ' wks'; }) +
      row('Slack remaining', h0.slack, hN.slack, pct) +
      '</tbody></table></div></div>' +

      '<div class="pm-sec"><h3>The failure</h3>' +
      '<div style="font-size:12.5px;color:#8b939f;line-height:1.65">' +
      (g.shockFired
        ? '<b style="color:#c9cfd8">' + g.shockNodeName + '</b> lost output in Q' + g.shockTurn +
          '. Twenty-six weeks at zero, eighteen at a fifth of normal. The magnitude was fixed before the run began ' +
          'and is identical in every run of this seed, at every turn number.<br>' +
          'At handover that supplier carried ' + (h0.concentration * 100).toFixed(1) + '% of the raw material tier. ' +
          'By Q' + g.shockTurn + ' it carried ' + (hN.concentration * 100).toFixed(1) + '%. ' +
          'Network cover had fallen from ' + h0.slack.toFixed(0) + '% of handover slack to ' + hN.slack.toFixed(0) + '%. ' +
          'Nothing about the failure changed. What changed was what was left to absorb it.'
        : 'The appointment ended before the scheduled supplier failure. The trace below still holds.') +
      '</div></div>' +

      '<div class="pm-sec"><h3>Contribution by agent</h3><table class="sbtable"><thead><tr>' +
      '<th>Agent</th><th>Approved</th><th>Fragility added</th><th>Share of contribution</th></tr></thead><tbody>' +
      CSC.agents.AGENTS.map(function (a) {
        var m = per[a.id] || { n: 0, c: 0, frag: 0 };
        var tot = 0;
        for (var kk in per) tot += per[kk].c;
        return '<tr><td style="color:' + a.colour + '">' + a.name + ' · ' + a.role + '</td>' +
          '<td class="hi">' + m.n + '</td><td class="hi">+' + m.frag.toFixed(1) + '</td>' +
          '<td class="hi">' + (tot > 0 ? Math.round(100 * m.c / tot) : 0) + '%</td></tr>';
      }).join('') + '</tbody></table></div>' +

      '<div class="pm-sec"><h3>Decision trace · ' + top.length + ' of ' + approved + ' approved decisions, ranked by contribution</h3>' +
      '<div class="trace">' + top.map(function (d) { return traceRow(g, d); }).join('') + '</div>' +
      '<div style="font-size:11.5px;color:#5d6672;margin-top:10px">' +
      approved + ' proposals approved, ' + declined + ' declined. ' + improved + ' of ' + g.decisions.length +
      ' proposals improved the measure they were scored against. None of them was wrong about that.' +
      '</div></div>' +

      '<div class="final">Every decision was correct given what the decider could see.</div>';

    openSheet({
      wide: true,
      title: 'POST-MORTEM',
      sub: 'Seed ' + g.seed + ' · ' + g.turn + ' quarters · appointment ended ' +
        (g.endReason === 'FIRED' ? 'by resolution of the board' : 'at term'),
      body: body,
      actions: [{
        label: 'OPEN SANDBOX', cls: 'primary',
        fn: function () { closeSheet(); unlockSandbox(); }
      }]
    });
  }

  root.CSC.postmortem = { show: show, contributions: contributions, replayChart: replayChart, cascadeSet: cascadeSet };
})(typeof globalThis !== 'undefined' ? globalThis : this);
