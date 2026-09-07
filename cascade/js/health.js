/* CASCADE — system health.
   None of this is a company KPI. No agent observes any of it, no proposal is
   scored against it, and the board has never asked for it. It is computed
   because it is true. */
(function (root) {
  'use strict';
  var CSC = root.CSC;
  var sim = CSC.sim;

  /* ---- structural measures ----------------------------------------------- */

  /* The same structural rollup the capacity planner uses. */
  function sourceFlows(w) { return sim.structuralFlow(w); }

  function concentration(w, flow) {
    var t0 = w.idx.tierN[0], tot = 0, i;
    for (i = 0; i < t0.length; i++) tot += flow[t0[i]];
    if (tot <= 0) return 0;
    var hhi = 0;
    for (i = 0; i < t0.length; i++) { var s = flow[t0[i]] / tot; hhi += s * s; }
    return hhi;
  }

  /* Effective sources, not qualified ones. A supplier holding four per cent of
     a node's volume is a line in a database, not a second source, so each node
     contributes the inverse Herfindahl of its own inbound mix. */
  function activeSources(w) {
    var c = 0;
    for (var n = 0; n < w.N; n++) {
      if (w.tier[n] === 0) continue;
      var ins = w.idx.inL[n], tot = 0, k, h = 0;
      for (k = 0; k < ins.length; k++) if (w.lShare[ins[k]] > 0.0001) tot += w.lShare[ins[k]];
      if (tot <= 0) continue;
      for (k = 0; k < ins.length; k++) {
        if (w.lShare[ins[k]] <= 0.0001) continue;
        var sh = w.lShare[ins[k]] / tot;
        h += sh * sh;
      }
      c += 1 / h;
    }
    return c;
  }

  /* Order variance upstream against demand variance at the customer.
     Both series are smoothed over four weeks first, so what is measured is
     amplification rather than the lumpiness of a minimum order quantity. */
  function bullwhip(w) {
    var h = w.hist;
    if (h.filled < 32) return 1;
    var n = h.filled, i, j;
    var A = [], B = [];
    for (i = 0; i + 4 <= n; i++) {
      var sa = 0, sb = 0;
      for (j = 0; j < 4; j++) { sa += h.t0[(i + j) % 52]; sb += h.dem[(i + j) % 52]; }
      A.push(sa / 4); B.push(sb / 4);
    }
    function cv(arr) {
      var m = 0, k;
      for (k = 0; k < arr.length; k++) m += arr[k];
      m /= arr.length;
      if (m <= 1e-9) return 0;
      var v = 0;
      for (k = 0; k < arr.length; k++) v += (arr[k] - m) * (arr[k] - m);
      return Math.sqrt(v / arr.length) / m;
    }
    var ca = cv(A), cb = cv(B);
    /* With no variance at the customer the ratio has no denominator. Report
       the cap and let the caller show the two coefficients instead. */
    if (cb < 1e-4) return ca > 1e-4 ? 20 : 1;
    return Math.max(0.2, Math.min(20, ca / cb));
  }

  /* ---- recovery probe ----------------------------------------------------
     Clone the world, remove its largest single source for four weeks, and
     count the weeks until service returns. Runs against a copy; the live
     world never sees it. */
  function weeklyFill(w) {
    w.acc = sim.newAcc();
    sim.step(w);
    return w.acc.custDemand > 0 ? w.acc.custShip / w.acc.custDemand : 1;
  }

  function probeOnce(w, biggest, offset, fix) {
    /* A scaled-down version of the disruption the network is actually exposed
       to: eighteen weeks with the largest source gone, eighteen at a fifth of
       normal, then full restoration. The measure is how many weeks of degraded
       customer service that costs — which is what redundancy and cover buy. */
    var OUT = 36, WIN = 88, TOL = 0.010, i;
    var ctl = sim.clone(w); ctl.rs = fix;
    var hit = sim.clone(w); hit.rs = fix;
    for (i = 0; i < offset; i++) { weeklyFill(ctl); weeklyFill(hit); }
    var savedCap = hit.capacity[biggest];
    var ra = [1, 1, 1, 1], rb = [1, 1, 1, 1], impaired = 0;
    for (i = 0; i < WIN; i++) {
      hit.capacity[biggest] = i < 18 ? 0 : (i < OUT ? savedCap * 0.20 : savedCap);
      ra[i % 4] = weeklyFill(ctl);
      rb[i % 4] = weeklyFill(hit);
      if (i < 3) continue;
      var ma = (ra[0] + ra[1] + ra[2] + ra[3]) / 4;
      var mb = (rb[0] + rb[1] + rb[2] + rb[3]) / 4;
      if (mb < ma - TOL) impaired++;
    }
    return impaired;
  }

  /* Two clones from the same state on the same random stream: one is put
     through a standard disruption at its largest source, the other is not.
     The gap between them is the network's answer, with the background noise
     divided out, averaged over three starting phases. */
  function recoveryTime(w, flow) {
    var i;
    var t0 = w.idx.tierN[0], biggest = t0[0];
    for (i = 1; i < t0.length; i++) if (flow[t0[i]] > flow[biggest]) biggest = t0[i];
    var fix = (CSC.hash32('probe:' + w.net.seed) >>> 0);
    var a = probeOnce(w, biggest, 0, fix);
    var b = probeOnce(w, biggest, 5, fix);
    var c = probeOnce(w, biggest, 11, fix);
    return (a + b + c) / 3;
  }

  /* ---- per-node exposure, for the Risk view ------------------------------ */
  function nodeRisk(w, flow) {
    var risk = new Float64Array(w.N);
    var maxFlow = 1, endDem = 0, f;
    for (f = 0; f < w.N; f++) if (flow[f] > maxFlow) maxFlow = flow[f];
    var t4 = w.idx.tierN[4];
    for (f = 0; f < t4.length; f++) endDem += w.baseDemand[t4[f]];
    if (endDem <= 0) endDem = 1;

    for (var i = 0; i < w.N; i++) {
      var share = flow[i] / maxFlow;
      var unrel = (0.995 - w.reliability[i]) / 0.115;         // 0 robust .. 1 fragile
      var b0 = w.buffer0[i] > 0 ? w.buffer0[i] : 1;
      var cover = w.buffer[i] / b0;                            // 1 = as handed over
      var head = w.capacity[i] > 0 ? Math.max(0, 1 - flow[i] / w.capacity[i]) : 0;
      /* How much of what the customer buys passes through this one site. A
         node carrying most of the network is a risk however well it runs. */
      var spof = Math.min(1, (flow[i] / endDem) / 0.50);
      var sole = 0;
      if (w.tier[i] > 0) {
        var ins = w.idx.inL[i], act = 0, top = 0, tot = 0, x;
        for (x = 0; x < ins.length; x++) {
          if (w.lShare[ins[x]] <= 0.0001) continue;
          act++; tot += w.lShare[ins[x]];
          if (w.lShare[ins[x]] > top) top = w.lShare[ins[x]];
        }
        sole = tot > 0 ? Math.min(1, top / tot) : 1;
        if (act <= 1) sole = 1;
        sole = Math.max(0, (sole - 0.4) / 0.6);
      }
      var r = 0.24 * unrel * (0.35 + 0.65 * share)
            + 0.20 * (1 - Math.min(1, cover))
            + 0.19 * sole
            + 0.13 * (1 - Math.min(1, head / 0.4))
            + 0.24 * spof;
      /* A site the whole network runs through is the network's risk, whatever
         else is true about it. */
      r = Math.max(r, spof * 0.94);
      risk[i] = Math.max(0, Math.min(1, r));
    }
    return risk;
  }

  /* ---- the aggregate ----------------------------------------------------- */

  function compute(w, opts) {
    opts = opts || {};
    var flow = sourceFlows(w);
    var hhi = concentration(w, flow);
    var srcs = activeSources(w);
    var bw = bullwhip(w);

    var bufSum = 0, safSum = 0, capSum = 0, i;
    for (i = 0; i < w.N; i++) {
      bufSum += w.buffer[i];
      safSum += w.safety[i];
      /* Headroom is measured against the asset base, not against this
         quarter's throttle setting: idle capacity that still exists is slack. */
      capSum += w.capBase[i];
    }
    var pullSum = 0;
    for (i = 0; i < w.N; i++) pullSum += flow[i];

    /* Everything the network has that it is not currently using. */
    var slack = 0.45 * (bufSum / w.init.bufSum)
              + 0.25 * (srcs / w.init.srcCount)
              + 0.15 * (capSum / w.init.capSum)
              + 0.15 * (safSum / w.init.safSum);
    slack = Math.max(0, Math.min(1.2, slack));

    var expo = 0, ftot = 0;
    for (i = 0; i < w.N; i++) { expo += flow[i] * (1 - w.reliability[i]); ftot += flow[i]; }
    expo = ftot > 0 ? expo / ftot : 0;

    var rec = opts.skipProbe ? (opts.lastRecovery || 0) : recoveryTime(w, flow);

    var hhi0 = w.init.hhi0 != null ? w.init.hhi0 : hhi;
    var util = w.kpi && w.kpi.util ? w.kpi.util : 0.6;

    var cl = function (x) { return Math.max(0, Math.min(1, x)); };
    var fragility = 100 * (
        0.28 * cl(1 - slack)
      + 0.22 * cl((hhi - hhi0) / Math.max(0.02, 1 - hhi0))
      + 0.16 * cl((1 - srcs / w.init.srcCount) / 0.55)
      + 0.15 * cl((expo - 0.045) / 0.055)
      + 0.11 * cl((rec - 4) / 26)
      + 0.08 * cl((bw - 1.2) / 4.5)
    );

    return {
      fragility: fragility,
      bullwhip: bw,
      concentration: hhi,
      recovery: rec,
      slack: slack * 100,
      exposure: expo,
      sources: srcs,
      util: util,
      flow: flow,
      risk: nodeRisk(w, flow)
    };
  }

  root.CSC.health = {
    compute: compute, sourceFlows: sourceFlows, concentration: concentration,
    recoveryTime: recoveryTime, bullwhip: bullwhip, nodeRisk: nodeRisk,
    activeSources: activeSources
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
