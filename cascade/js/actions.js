/* CASCADE — the action catalogue.
   Every action is a real operating decision with a real, correct upside on
   exactly one company KPI. None of them is a mistake. */
(function (root) {
  'use strict';
  var CSC = root.CSC;

  function activeIn(w, node) {
    var ins = w.idx.inL[node], out = [];
    for (var i = 0; i < ins.length; i++) if (w.lShare[ins[i]] > 0.0001) out.push(ins[i]);
    return out;
  }
  function dormantIn(w, node) {
    var ins = w.idx.inL[node], out = [];
    for (var i = 0; i < ins.length; i++) if (w.lShare[ins[i]] <= 0.0001) out.push(ins[i]);
    return out;
  }
  function normalise(w, node) {
    var ins = w.idx.inL[node], tot = 0, i;
    for (i = 0; i < ins.length; i++) tot += w.lShare[ins[i]];
    if (tot <= 0) return;
    for (i = 0; i < ins.length; i++) w.lShare[ins[i]] /= tot;
  }
  /* Cover cannot be cut below the replenishment cycle itself; below this the
     site simply cannot operate, and no planner would sign it off. */
  var BUFFER_FLOOR = 1.2;
  function money(x) { return '$' + x.toFixed(2); }
  function nm(w, i) { return w.net.nodes[i].name; }

  /* ------------------------------------------------------------------ *
   * PROCUREMENT — landed cost per unit                                  *
   * ------------------------------------------------------------------ */

  var CONSOLIDATE = {
    id: 'CONSOLIDATE', agent: 'procurement',
    tags: ['concentration-up', 'redundancy-down', 'cost-down'],
    enumerate: function (w, obs) {
      var out = [];
      for (var n = 0; n < w.N; n++) {
        if (w.tier[n] === 0) continue;
        var act = activeIn(w, n);
        if (act.length < 2) continue;
        var best = act[0], worst = act[0], i;
        for (i = 1; i < act.length; i++) {
          if (obs.laneCost[act[i]] < obs.laneCost[best]) best = act[i];
          if (obs.laneCost[act[i]] > obs.laneCost[worst]) worst = act[i];
        }
        var gap = obs.laneCost[worst] - obs.laneCost[best];
        if (gap <= 0.01) continue;
        /* The opportunity is the spend still sitting on the expensive source,
           so a node already consolidated stops appearing near the top. */
        var movable = 0;
        for (i = 0; i < act.length; i++) if (act[i] !== best) movable += w.lShare[act[i]];
        if (movable < 0.015) continue;
        out.push({ node: n, keep: best, gain: gap * obs.flow[n] * movable });
      }
      out.sort(function (a, b) { return b.gain - a.gain; });
      return out.slice(0, 6);
    },
    apply: function (w, p) {
      /* Migrate volume toward the cheapest qualified source. Repeated often
         enough this ends in a single source; no single step says so. */
      var ins = w.idx.inL[p.node], i, moved = 0;
      for (i = 0; i < ins.length; i++) {
        if (ins[i] === p.keep || w.lShare[ins[i]] <= 0.0001) continue;
        var take = w.lShare[ins[i]] * 0.62;
        w.lShare[ins[i]] -= take;
        /* A supplier left with a token share is not a second source; it is a
           qualification cost. Drop it. */
        if (w.lShare[ins[i]] < 0.10) { take += w.lShare[ins[i]]; w.lShare[ins[i]] = 0; }
        moved += take;
      }
      w.lShare[p.keep] += moved;
      normalise(w, p.node);
    },
    title: function (w, p) { return 'Shift volume at ' + nm(w, p.node) + ' to the low-cost source'; },
    detail: function (w, p) {
      return 'Award full volume to ' + nm(w, w.lFrom[p.keep]) + '. Dual-sourcing is costing '
        + money(p.gain / Math.max(1, 1)) + '/qtr in split-volume premium at this node.';
    },
    touches: function (w, p) { return { nodes: [p.node, w.lFrom[p.keep]], lanes: w.idx.inL[p.node] }; }
  };

  var RESOURCE = {
    id: 'RESOURCE', agent: 'procurement',
    tags: ['cost-down', 'lt-up', 'concentration-up'],
    enumerate: function (w, obs) {
      var out = [];
      for (var n = 0; n < w.N; n++) {
        if (w.tier[n] === 0) continue;
        var act = activeIn(w, n), dor = dormantIn(w, n);
        if (!act.length || !dor.length) continue;
        var cur = 0, i;
        for (i = 0; i < act.length; i++) cur += obs.laneCost[act[i]] * w.lShare[act[i]];
        var best = dor[0];
        for (i = 1; i < dor.length; i++) if (obs.laneCost[dor[i]] < obs.laneCost[best]) best = dor[i];
        var save = cur - obs.laneCost[best];
        if (save <= 0.05) continue;
        out.push({ node: n, lane: best, save: save, gain: save * obs.flow[n] });
      }
      out.sort(function (a, b) { return b.gain - a.gain; });
      return out.slice(0, 6);
    },
    apply: function (w, p) {
      var ins = w.idx.inL[p.node], i;
      for (i = 0; i < ins.length; i++) w.lShare[ins[i]] *= 0.45;
      w.lShare[p.lane] = 0.55;
      normalise(w, p.node);
    },
    title: function (w, p) { return 'Re-source ' + nm(w, p.node) + ' to ' + nm(w, w.lFrom[p.lane]); },
    detail: function (w, p) {
      return 'Qualified alternate at ' + money(p.save) + '/unit below the current mix. Award a first tranche of volume.';
    },
    touches: function (w, p) { return { nodes: [p.node, w.lFrom[p.lane]], lanes: [p.lane] }; }
  };

  var VOLUME_COMMIT = {
    id: 'VOLUME_COMMIT', agent: 'procurement',
    tags: ['cost-down', 'capacity-down'],
    enumerate: function (w, obs) {
      var out = [];
      for (var n = 0; n < w.N; n++) {
        if (w.tier[n] > 1) continue;
        if (obs.flow[n] < 40) continue;
        out.push({ node: n, gain: obs.flow[n] * obs.unitCost[n] * 0.025 });
      }
      out.sort(function (a, b) { return b.gain - a.gain; });
      return out.slice(0, 5);
    },
    apply: function (w, p) {
      w.unitCost[p.node] *= 0.975;
      /* A dedicated line is cheaper per unit and has no surge left in it. */
      w.capacity[p.node] *= 0.955;
      w.capBase[p.node] *= 0.955;
    },
    title: function (w, p) { return 'Three-year volume agreement — ' + nm(w, p.node); },
    detail: function (w, p) { return 'Locks a 2.5% unit price reduction against committed volume. Dedicated line, no take-or-pay exposure.'; },
    touches: function (w, p) { return { nodes: [p.node], lanes: w.idx.outL[p.node] }; }
  };

  /* ------------------------------------------------------------------ *
   * LOGISTICS — on-time delivery                                        *
   * ------------------------------------------------------------------ */

  var EXPEDITE = {
    id: 'EXPEDITE', agent: 'logistics',
    tags: ['lt-down', 'cost-up', 'cover-down'],
    enumerate: function (w, obs) {
      var out = [];
      for (var l = 0; l < w.M; l++) {
        if (w.lShare[l] <= 0.0001 || obs.laneLT[l] <= 3) continue;
        out.push({ lane: l, gain: (obs.laneLT[l] - 2) * obs.laneFlow[l] });
      }
      out.sort(function (a, b) { return b.gain - a.gain; });
      return out.slice(0, 6);
    },
    apply: function (w, p) {
      w.lLT[p.lane] = Math.max(1, w.lLT[p.lane] - 2);
      w.lCost[p.lane] *= 1.85;
      w.lMode[p.lane] = 2;
    },
    title: function (w, p) { return 'Move ' + nm(w, w.lFrom[p.lane]) + ' → ' + nm(w, w.lTo[p.lane]) + ' to air'; },
    detail: function (w, p) { return 'Cuts two weeks of transit on a lane that is behind on service. Freight premium accepted.'; },
    touches: function (w, p) { return { nodes: [w.lFrom[p.lane], w.lTo[p.lane]], lanes: [p.lane] }; }
  };

  var LANE_RATIONALIZE = {
    id: 'LANE_RATIONALIZE', agent: 'logistics',
    tags: ['redundancy-down', 'lt-down', 'concentration-up'],
    enumerate: function (w, obs) {
      var out = [];
      for (var n = 0; n < w.N; n++) {
        if (w.tier[n] === 0) continue;
        var act = activeIn(w, n);
        if (act.length < 2) continue;
        var fast = act[0], slow = act[0], i;
        for (i = 1; i < act.length; i++) {
          if (obs.laneLT[act[i]] < obs.laneLT[fast]) fast = act[i];
          if (obs.laneLT[act[i]] > obs.laneLT[slow]) slow = act[i];
        }
        var d = obs.laneLT[slow] - obs.laneLT[fast];
        if (d < 2 || w.lShare[slow] < 0.05) continue;
        out.push({ node: n, drop: slow, keep: fast, gain: d * obs.flow[n] * w.lShare[slow] });
      }
      out.sort(function (a, b) { return b.gain - a.gain; });
      return out.slice(0, 6);
    },
    apply: function (w, p) {
      var s = w.lShare[p.drop] * 0.6;
      w.lShare[p.drop] -= s;
      if (w.lShare[p.drop] < 0.10) { s += w.lShare[p.drop]; w.lShare[p.drop] = 0; }
      w.lShare[p.keep] += s;
      normalise(w, p.node);
    },
    title: function (w, p) { return 'Move volume off the slow lane into ' + nm(w, p.node); },
    detail: function (w, p) {
      return 'Reallocates part of the volume from a ' + w.lLT[p.drop] + '-week lane to a ' + w.lLT[p.keep] + '-week lane. Shorter promise, fewer misses.';
    },
    touches: function (w, p) { return { nodes: [p.node], lanes: [p.drop, p.keep] }; }
  };

  var CROSSDOCK = {
    id: 'CROSSDOCK', agent: 'logistics',
    tags: ['lt-down', 'cover-down', 'cost-up'],
    enumerate: function (w, obs) {
      var out = [];
      for (var n = 0; n < w.N; n++) {
        if (w.tier[n] < 3) continue;
        var act = activeIn(w, n);
        if (!act.length) continue;
        var lt = 0, i;
        for (i = 0; i < act.length; i++) lt += obs.laneLT[act[i]] * w.lShare[act[i]];
        if (lt < 3) continue;
        out.push({ node: n, gain: lt * obs.flow[n] });
      }
      out.sort(function (a, b) { return b.gain - a.gain; });
      return out.slice(0, 5);
    },
    apply: function (w, p) {
      var act = activeIn(w, p.node);
      for (var i = 0; i < act.length; i++) {
        w.lLT[act[i]] = Math.max(1, w.lLT[act[i]] - 1);
        w.lCost[act[i]] *= 1.09;
      }
      w.review[p.node] = 1;
    },
    title: function (w, p) { return 'Cross-dock inbound at ' + nm(w, p.node); },
    detail: function (w, p) { return 'Removes a week of handling on every inbound lane and moves the site to weekly review.'; },
    touches: function (w, p) { return { nodes: [p.node], lanes: activeIn(w, p.node) }; }
  };

  /* ------------------------------------------------------------------ *
   * INVENTORY — turns                                                   *
   * ------------------------------------------------------------------ */

  var CUT_BUFFER = {
    id: 'CUT_BUFFER', agent: 'inventory',
    tags: ['buffer-down'],
    enumerate: function (w, obs) {
      var out = [];
      for (var n = 0; n < w.N; n++) {
        if (w.tier[n] === 0 || obs.buffer[n] < 1.6) continue;
        out.push({ node: n, gain: obs.invValue[n] });
      }
      out.sort(function (a, b) { return b.gain - a.gain; });
      return out.slice(0, 6);
    },
    apply: function (w, p) {
      w.buffer[p.node] = Math.max(BUFFER_FLOOR, w.buffer[p.node] - 0.7);
      w.inv[p.node] *= 0.95;
    },
    title: function (w, p) { return 'Reduce cover at ' + nm(w, p.node) + ' by 0.7 weeks'; },
    detail: function (w, p) {
      return 'Site holds ' + w.buffer[p.node].toFixed(1) + ' weeks above pipeline. Service has not required it in eight quarters.';
    },
    touches: function (w, p) { return { nodes: [p.node], lanes: [] }; }
  };

  var NETWORK_DESTOCK = {
    id: 'NETWORK_DESTOCK', agent: 'inventory',
    tags: ['buffer-down', 'broad'],
    enumerate: function (w, obs) {
      var out = [];
      for (var t = 1; t <= 4; t++) {
        var lst = w.idx.tierN[t], v = 0, i;
        for (i = 0; i < lst.length; i++) v += obs.invValue[lst[i]];
        out.push({ tier: t, gain: v });
      }
      out.sort(function (a, b) { return b.gain - a.gain; });
      return out.slice(0, 3);
    },
    apply: function (w, p) {
      var lst = w.idx.tierN[p.tier];
      for (var i = 0; i < lst.length; i++) {
        w.buffer[lst[i]] = Math.max(BUFFER_FLOOR, w.buffer[lst[i]] - 0.32);
        w.inv[lst[i]] *= 0.975;
      }
    },
    title: function (w, p) { return 'Network destock — ' + CSC.network.TIERS[p.tier].name; },
    detail: function (w, p) { return 'Trims cover across the tier by a third of a week. One decision, whole tier.'; },
    touches: function (w, p) { return { nodes: w.idx.tierN[p.tier].slice(), lanes: [] }; }
  };

  var SAFETY_RESET = {
    id: 'SAFETY_RESET', agent: 'inventory',
    tags: ['buffer-down', 'variance-exposed'],
    enumerate: function (w, obs) {
      var out = [];
      for (var n = 0; n < w.N; n++) {
        if (w.tier[n] === 0 || obs.safety[n] < 1.15) continue;
        out.push({ node: n, gain: obs.invValue[n] * obs.safety[n] });
      }
      out.sort(function (a, b) { return b.gain - a.gain; });
      return out.slice(0, 5);
    },
    apply: function (w, p) {
      w.safety[p.node] = Math.max(0.55, w.safety[p.node] - 0.22);
      w.inv[p.node] *= 0.98;
    },
    title: function (w, p) { return 'Reset service factor at ' + nm(w, p.node); },
    detail: function (w, p) { return 'Statistical safety stock is set for a variance the site has not seen. Bring the factor back to plan.'; },
    touches: function (w, p) { return { nodes: [p.node], lanes: [] }; }
  };

  /* ------------------------------------------------------------------ *
   * SALES — forecast attainment                                         *
   * ------------------------------------------------------------------ */

  var FORECAST_UPLIFT = {
    id: 'FORECAST_UPLIFT', agent: 'sales',
    tags: ['signal-up', 'buffer-up', 'whip'],
    enumerate: function (w, obs) {
      var out = [];
      var t4 = w.idx.tierN[4];
      for (var i = 0; i < t4.length; i++) out.push({ node: t4[i], gain: obs.fcast[t4[i]] });
      out.sort(function (a, b) { return b.gain - a.gain; });
      return out.slice(0, 4).concat([{ node: -1, gain: 0 }]);
    },
    apply: function (w, p) {
      var lst = p.node === -1 ? w.idx.tierN[4] : [p.node];
      for (var i = 0; i < lst.length; i++) w.plan[lst[i]] = Math.min(1.7, w.plan[lst[i]] * 1.045);
    },
    title: function (w, p) { return p.node === -1 ? 'Raise the demand plan network-wide' : 'Raise the demand plan at ' + nm(w, p.node); },
    detail: function (w, p) { return 'Pipeline supports a 5% uplift. Building to the plan is what stops us missing it.'; },
    touches: function (w, p) { return { nodes: p.node === -1 ? w.idx.tierN[4].slice() : [p.node], lanes: [] }; }
  };

  var PROMO_PULL = {
    id: 'PROMO_PULL', agent: 'sales',
    tags: ['demand-spike', 'whip'],
    enumerate: function (w, obs) { return [{ size: 0.035 }, { size: 0.02 }]; },
    apply: function (w, p) { w.promo += p.size; w.promoDebt += p.size * 0.85; },
    title: function (w, p) { return 'Quarter-end promotion — ' + Math.round(p.size * 100) + '% volume pull-forward'; },
    detail: function (w, p) { return 'Books the volume inside the quarter. Attainment is a quarterly measure.'; },
    touches: function (w, p) { return { nodes: w.idx.tierN[4].slice(), lanes: [] }; }
  };

  var CHANNEL_CONSOLIDATION = {
    id: 'CHANNEL_CONSOLIDATION', agent: 'sales',
    tags: ['concentration-up', 'redundancy-down'],
    enumerate: function (w, obs) {
      var t4 = w.idx.tierN[4], out = [], i;
      var live = [];
      for (i = 0; i < t4.length; i++) if (w.baseDemand[t4[i]] > 1) live.push(t4[i]);
      if (live.length <= 9) return [];
      live.sort(function (a, b) { return w.baseDemand[a] - w.baseDemand[b]; });
      for (i = 0; i < Math.min(3, live.length - 3); i++) {
        out.push({ node: live[i], into: live[live.length - 1 - (i % 2)], gain: 1 / (1 + w.baseDemand[live[i]]) });
      }
      return out;
    },
    apply: function (w, p) {
      w.baseDemand[p.into] += w.baseDemand[p.node];
      w.fcast[p.into] += w.fcast[p.node];
      w.sigma[p.into] += w.sigma[p.node];
      /* The volume moves and so does the site that served it. */
      w.capacity[p.into] += w.capacity[p.node] * 0.85;
      w.capBase[p.into] += w.capBase[p.node] * 0.85;
      w.capBase[p.node] = 0;
      w.inv[p.into] += w.inv[p.node] * 0.7;
      w.baseDemand[p.node] = 0;
      w.fcast[p.node] = 0;
      w.inv[p.node] = 0;
      w.capacity[p.node] = 0;
      var ins = w.idx.inL[p.node];
      for (var i = 0; i < ins.length; i++) w.lShare[ins[i]] = 0;
    },
    title: function (w, p) { return 'Close ' + nm(w, p.node) + ', serve from ' + nm(w, p.into); },
    detail: function (w, p) { return 'Sub-scale depot. Consolidating the channel removes a site we keep missing plan at.'; },
    touches: function (w, p) { return { nodes: [p.node, p.into], lanes: w.idx.inL[p.node] }; }
  };

  /* ------------------------------------------------------------------ *
   * FINANCE — working capital                                           *
   * ------------------------------------------------------------------ */

  var STRETCH_PAYABLES = {
    id: 'STRETCH_PAYABLES', agent: 'finance',
    tags: ['cash-in', 'supplier-stress'],
    enumerate: function (w, obs) {
      if (obs.payTerms >= 100) return [];
      return [{ days: 4 }, { days: 7 }];
    },
    apply: function (w, p) {
      w.payTerms = Math.min(110, w.payTerms + p.days);
      /* Terms are a transfer, not a saving. Thin suppliers absorb it. */
      for (var n = 0; n < w.N; n++) {
        if (w.tier[n] > 1) continue;
        var thin = 1 - (w.unitCost[n] - 8) / 40;
        w.reliability[n] = Math.max(0.78, w.reliability[n] - 0.0006 * p.days * Math.max(0.3, thin));
      }
    },
    title: function (w, p) { return 'Extend supplier payment terms to ' + Math.min(110, w.payTerms + p.days) + ' days'; },
    detail: function (w, p) { return 'Releases ' + p.days + ' days of payables. No P&L impact, no covenant impact.'; },
    touches: function (w, p) { return { nodes: w.idx.tierN[0].concat(w.idx.tierN[1]), lanes: [] }; }
  };

  var LIQUIDATION = {
    id: 'LIQUIDATION', agent: 'finance',
    tags: ['cash-in', 'buffer-down'],
    enumerate: function (w, obs) {
      var out = [];
      for (var t = 1; t <= 4; t++) {
        var lst = w.idx.tierN[t], v = 0, i;
        for (i = 0; i < lst.length; i++) v += obs.invValue[lst[i]];
        out.push({ tier: t, gain: v });
      }
      out.sort(function (a, b) { return b.gain - a.gain; });
      return out.slice(0, 3);
    },
    apply: function (w, p) {
      var lst = w.idx.tierN[p.tier];
      for (var i = 0; i < lst.length; i++) {
        w.inv[lst[i]] *= 0.90;
        w.buffer[lst[i]] = Math.max(BUFFER_FLOOR, w.buffer[lst[i]] - 0.26);
      }
    },
    title: function (w, p) { return 'Release working capital from ' + CSC.network.TIERS[p.tier].name; },
    detail: function (w, p) { return 'One-off destock plus a standing policy reduction. Cash lands this quarter.'; },
    touches: function (w, p) { return { nodes: w.idx.tierN[p.tier].slice(), lanes: [] }; }
  };

  var SALE_LEASEBACK = {
    id: 'SALE_LEASEBACK', agent: 'finance',
    tags: ['cash-in', 'capacity-down', 'buffer-down'],
    enumerate: function (w, obs) {
      var out = [];
      for (var t = 2; t <= 4; t++) out.push({ tier: t, gain: obs.tierCapValue[t] || 0 });
      out.sort(function (a, b) { return b.gain - a.gain; });
      return out.slice(0, 2);
    },
    apply: function (w, p) {
      var lst = w.idx.tierN[p.tier];
      for (var i = 0; i < lst.length; i++) {
        w.capacity[lst[i]] *= 0.965;
        w.capBase[lst[i]] *= 0.965;
        w.buffer[lst[i]] = Math.max(BUFFER_FLOOR, w.buffer[lst[i]] - 0.3);
      }
    },
    title: function (w, p) { return 'Sale and leaseback — ' + CSC.network.TIERS[p.tier].name + ' footprint'; },
    detail: function (w, p) { return 'Converts owned space to leased, sized to current volumes rather than to peak.'; },
    touches: function (w, p) { return { nodes: w.idx.tierN[p.tier].slice(), lanes: [] }; }
  };

  var ALL = [CONSOLIDATE, RESOURCE, VOLUME_COMMIT, EXPEDITE, LANE_RATIONALIZE, CROSSDOCK,
    CUT_BUFFER, NETWORK_DESTOCK, SAFETY_RESET, FORECAST_UPLIFT, PROMO_PULL,
    CHANNEL_CONSOLIDATION, STRETCH_PAYABLES, LIQUIDATION, SALE_LEASEBACK];

  var BY_ID = {};
  for (var a = 0; a < ALL.length; a++) BY_ID[ALL[a].id] = ALL[a];

  /* Two proposals conflict when acting on both is materially worse than acting
     on either. Shown to the player; never resolved for them. */
  var OPPOSED = [
    ['EXPEDITE', 'STRETCH_PAYABLES'], ['EXPEDITE', 'SALE_LEASEBACK'], ['EXPEDITE', 'RESOURCE'],
    ['CROSSDOCK', 'RESOURCE'], ['CROSSDOCK', 'LIQUIDATION'],
    ['FORECAST_UPLIFT', 'CUT_BUFFER'], ['FORECAST_UPLIFT', 'NETWORK_DESTOCK'],
    ['FORECAST_UPLIFT', 'LIQUIDATION'], ['PROMO_PULL', 'NETWORK_DESTOCK'],
    ['PROMO_PULL', 'SALE_LEASEBACK'], ['CONSOLIDATE', 'LANE_RATIONALIZE'],
    ['VOLUME_COMMIT', 'SALE_LEASEBACK'], ['SAFETY_RESET', 'PROMO_PULL']
  ];
  function opposed(a, b) {
    for (var i = 0; i < OPPOSED.length; i++) {
      if ((OPPOSED[i][0] === a && OPPOSED[i][1] === b) || (OPPOSED[i][1] === a && OPPOSED[i][0] === b)) return true;
    }
    return false;
  }
  function overlap(t1, t2) {
    var s = {};
    var i;
    for (i = 0; i < t1.nodes.length; i++) s['n' + t1.nodes[i]] = 1;
    for (i = 0; i < t1.lanes.length; i++) s['l' + t1.lanes[i]] = 1;
    for (i = 0; i < t2.nodes.length; i++) if (s['n' + t2.nodes[i]]) return true;
    for (i = 0; i < t2.lanes.length; i++) if (s['l' + t2.lanes[i]]) return true;
    return false;
  }

  root.CSC.actions = { ALL: ALL, BY_ID: BY_ID, opposed: opposed, overlap: overlap, activeIn: activeIn };
})(typeof globalThis !== 'undefined' ? globalThis : this);
