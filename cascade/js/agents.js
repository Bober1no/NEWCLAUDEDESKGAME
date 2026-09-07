/* CASCADE — the agents.
   Five of them. Mechanically they are one function called five times with a
   different observation mask and a different objective. The names, portraits
   and prose are presentation. The behaviour is arithmetic. */
(function (root) {
  'use strict';
  var CSC = root.CSC;
  var sim = CSC.sim;

  var HORIZON = 2;            // quarters of cloned-world lookahead
  var MAX_CANDIDATES = 9;

  var AGENTS = [
    {
      id: 'procurement', name: 'ORIN', role: 'Procurement', kpi: 'landedCost',
      kpiLabel: 'Landed cost / unit', unit: '$', better: 'lower', colour: '#c9a227',
      voice: 'relentless',
      sees: ['supplier unit price', 'lane freight rate', 'volume by node', 'network topology'],
      blind: ['supplier reliability', 'buffer cover', 'lead-time variance', 'capacity headroom'],
      actions: ['CONSOLIDATE', 'RESOURCE', 'VOLUME_COMMIT']
    },
    {
      id: 'logistics', name: 'MAYE', role: 'Logistics', kpi: 'otd',
      kpiLabel: 'On-time delivery', unit: '%', better: 'higher', colour: '#4c8fbd',
      voice: 'anxious',
      sees: ['lane transit time', 'lane volume', 'open backlog', 'network topology'],
      blind: ['unit price', 'supplier reliability', 'working capital', 'inventory policy'],
      actions: ['EXPEDITE', 'LANE_RATIONALIZE', 'CROSSDOCK']
    },
    {
      id: 'inventory', name: 'SELV', role: 'Inventory', kpi: 'turns',
      kpiLabel: 'Inventory turns', unit: '×', better: 'higher', colour: '#5f9e6e',
      voice: 'tidy',
      sees: ['stock value by node', 'cover policy', 'service factor', 'network topology'],
      blind: ['supplier reliability', 'lane transit time', 'demand plan basis', 'capacity headroom'],
      actions: ['CUT_BUFFER', 'NETWORK_DESTOCK', 'SAFETY_RESET']
    },
    {
      id: 'sales', name: 'BRAE', role: 'Sales', kpi: 'attain',
      kpiLabel: 'Forecast attainment', unit: '%', better: 'higher', colour: '#b4693f',
      voice: 'optimistic',
      sees: ['demand plan', 'depot volume', 'quarterly shipments'],
      blind: ['anything upstream of the distribution tier'],
      actions: ['FORECAST_UPLIFT', 'PROMO_PULL', 'CHANNEL_CONSOLIDATION']
    },
    {
      id: 'finance', name: 'KADE', role: 'Finance', kpi: 'workingCapital',
      kpiLabel: 'Working capital', unit: '$M', better: 'lower', colour: '#8f7ab8',
      voice: 'cold',
      sees: ['inventory value', 'payment terms', 'receivable days', 'asset base by tier'],
      blind: ['service levels', 'supplier reliability', 'lead times', 'demand plan'],
      actions: ['STRETCH_PAYABLES', 'LIQUIDATION', 'SALE_LEASEBACK']
    }
  ];

  var BY_ID = {};
  for (var q = 0; q < AGENTS.length; q++) BY_ID[AGENTS[q].id] = AGENTS[q];

  /* ---- observation ------------------------------------------------------- *
     Each agent receives only its permitted projection of the world. This is
     built here rather than enforced by convention: an agent literally cannot
     read a field that is not in the object it is handed. */

  function observe(w, agentId) {
    var obs = { agent: agentId };
    var i, l;
    var flow = CSC.health.sourceFlows(w);

    if (agentId === 'procurement') {
      obs.unitCost = w.unitCost;
      obs.flow = flow;
      obs.laneCost = new Float64Array(w.M);
      for (l = 0; l < w.M; l++) obs.laneCost[l] = w.unitCost[w.lFrom[l]] + w.lCost[l];
    } else if (agentId === 'logistics') {
      obs.laneLT = w.lLT;
      obs.laneFlow = w.lFlow;
      obs.flow = flow;
      obs.backlog = w.backlog;
    } else if (agentId === 'inventory') {
      obs.buffer = w.buffer;
      obs.safety = w.safety;
      obs.invValue = new Float64Array(w.N);
      for (i = 0; i < w.N; i++) obs.invValue[i] = w.inv[i] * w.unitCost[i];
      obs.fcast = w.fcast;
    } else if (agentId === 'sales') {
      obs.fcast = w.fcast;
      obs.baseDemand = w.baseDemand;
    } else if (agentId === 'finance') {
      obs.invValue = new Float64Array(w.N);
      for (i = 0; i < w.N; i++) obs.invValue[i] = w.inv[i] * w.unitCost[i];
      obs.payTerms = w.payTerms;
      obs.dso = w.dso;
      obs.tierCapValue = [0, 0, 0, 0, 0];
      for (i = 0; i < w.N; i++) obs.tierCapValue[w.tier[i]] += w.capacity[i] * w.unitCost[i];
    }
    return obs;
  }

  /* ---- scoring ----------------------------------------------------------- */

  function kpiValue(kpi, key) { return kpi[key]; }

  function improvement(agent, baseVal, candVal) {
    if (Math.abs(baseVal) < 1e-9) return 0;
    var raw = agent.better === 'lower' ? (baseVal - candVal) : (candVal - baseVal);
    return raw / Math.abs(baseVal);
  }

  /* Run a cloned world forward. The clone carries the world's own PRNG state,
     so the baseline and every candidate see an identical future. */
  function evaluate(w, action, params) {
    var c = sim.clone(w);
    if (action) action.apply(c, params);
    var k = null;
    for (var i = 0; i < HORIZON; i++) k = sim.runQuarter(c);
    return k;
  }

  var VOICE = {
    relentless: function (t) { return t; },
    anxious: function (t) { return t; },
    tidy: function (t) { return t; },
    optimistic: function (t) { return t; },
    cold: function (t) { return t; }
  };

  var OPENERS = {
    relentless: ['Third quote this quarter and it is still the cheapest.', 'Ran the spend cube again.',
      'This one has been sitting in the pipeline for two quarters.', 'Benchmarked against the category index.'],
    anxious: ['This lane is the one that keeps slipping.', 'We are one bad week from a miss here.',
      'I would rather not find out what happens if this stays as it is.', 'Service on this route is drifting.'],
    tidy: ['Cover at this site has been above policy for eight quarters.', 'This is stock doing nothing.',
      'Clean-up. The policy and the actual have drifted apart.', 'Tidying the cover table.'],
    optimistic: ['The plan supports this and then some.', 'Demand is there — we just have to be ready for it.',
      'Good quarter to lean in.', 'The channel is asking for more than we have planned.'],
    cold: ['Cash is the constraint this quarter.', 'This is balance sheet, not P&L.',
      'The number the board reads is the one below.', 'Straightforward release of capital.']
  };

  function bestFor(w, agent, turn, seedTag, exclude) {
    var obs = observe(w, agent.id);
    var base = evaluate(w, null, null);
    var baseVal = kpiValue(base, agent.kpi);

    /* Candidate enumeration: bounded, deterministic, drawn only from what the
       agent can see. */
    var cands = [];
    for (var a = 0; a < agent.actions.length; a++) {
      var act = CSC.actions.BY_ID[agent.actions[a]];
      var params = act.enumerate(w, obs) || [];
      var take = Math.min(params.length, Math.ceil(MAX_CANDIDATES / agent.actions.length));
      for (var p = 0; p < take; p++) cands.push({ action: act, params: params[p] });
    }
    if (!cands.length) return null;

    var scored = [];
    for (var c = 0; c < cands.length; c++) {
      var k = evaluate(w, cands[c].action, cands[c].params);
      var val = kpiValue(k, agent.kpi);
      scored.push({
        action: cands[c].action,
        params: cands[c].params,
        kpiAfter: val,
        score: improvement(agent, baseVal, val),
        projected: k
      });
    }
    scored.sort(function (x, y) {
      if (Math.abs(y.score - x.score) > 1e-9) return y.score - x.score;
      return x.action.id < y.action.id ? -1 : 1;
    });

    var pick = 0;
    if (exclude) {
      while (pick < scored.length && scored[pick].action.id === exclude) pick++;
      if (pick >= scored.length) return null;
    }
    var win = scored[pick];
    if (!win || win.score < 0.0004) return null;

    var rng = CSC.derive(w.net.seed, seedTag + ':' + agent.id + ':' + turn);
    var opener = OPENERS[agent.voice][rng.int(OPENERS[agent.voice].length)];

    return {
      agent: agent.id,
      agentName: agent.name,
      actionId: win.action.id,
      params: win.params,
      title: win.action.title(w, win.params),
      rationale: opener + ' ' + win.action.detail(w, win.params),
      kpi: agent.kpi,
      kpiLabel: agent.kpiLabel,
      unit: agent.unit,
      better: agent.better,
      baseline: baseVal,
      projectedValue: win.kpiAfter,
      score: win.score,
      projected: win.projected,
      touches: win.action.touches(w, win.params),
      candidates: scored.slice(0, 6).map(function (s) {
        return { id: s.action.id, title: s.action.title(w, s.params), score: s.score, kpiAfter: s.kpiAfter };
      }),
      considered: scored.length,
      sees: agent.sees.slice(),
      blind: agent.blind.slice(),
      turn: turn
    };
  }

  /* The morning brief. Three to six items. */
  function brief(w, turn, enabled) {
    var out = [];
    for (var i = 0; i < AGENTS.length; i++) {
      var ag = AGENTS[i];
      if (enabled && enabled[ag.id] === false) continue;
      var pr = bestFor(w, ag, turn, 'brief');
      if (pr) out.push(pr);
    }
    out.sort(function (a, b) { return b.score - a.score; });

    var rng = CSC.derive(w.net.seed, 'briefsize:' + turn);
    var want = 3 + rng.int(4);            // 3..6
    if (out.length > want) out = out.slice(0, want);
    if (out.length && out.length < want && out.length < 6) {
      /* The strongest performer brings a second item rather than the brief
         coming in short. */
      var top = BY_ID[out[0].agent];
      var second = bestFor(w, top, turn, 'brief2', out[0].actionId);
      if (second) out.push(second);
    }
    for (var k = 0; k < out.length; k++) out[k].uid = turn + ':' + out[k].agent + ':' + out[k].actionId + ':' + k;

    /* Conflicts are surfaced, never resolved. */
    for (var x = 0; x < out.length; x++) {
      for (var y = x + 1; y < out.length; y++) {
        var direct = CSC.actions.opposed(out[x].actionId, out[y].actionId);
        var shared = CSC.actions.overlap(out[x].touches, out[y].touches);
        if (direct || shared) {
          out[x].conflict = out[x].conflict || [];
          out[y].conflict = out[y].conflict || [];
          out[x].conflict.push({ with: out[y].uid, direct: direct });
          out[y].conflict.push({ with: out[x].uid, direct: direct });
        }
      }
    }
    return out;
  }

  root.CSC.agents = {
    AGENTS: AGENTS, BY_ID: BY_ID, brief: brief, bestFor: bestFor,
    observe: observe, evaluate: evaluate, HORIZON: HORIZON
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
