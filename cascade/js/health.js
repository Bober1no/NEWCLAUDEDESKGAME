/* CASCADE — system health.
   None of this is a company KPI. No agent observes any of it, no proposal is
   scored against it, and the board has never asked for it. It is computed
   because it is true. */
(function (root) {
  'use strict';
  var CSC = root.CSC;
  var sim = CSC.sim;

  /* ---- structural measures ----------------------------------------------- */

  function sourceFlows(w) {
    /* Effective demand-weighted flow through every node, from the active
       source mix. Independent of week-to-week noise. */
    var flow = new Float64Array(w.N);
    var t4 = w.idx.tierN[4];
    for (var d = 0; d < t4.length; d++) flow[t4[d]] = w.baseDemand[t4[d]];
    for (var t = 4; t >= 1; t--) {
      var lst = w.idx.tierN[t];
      for (var k = 0; k < lst.length; k++) {
        var i = lst[k], ins = w.idx.inL[i], sh = 0, x;
        for (x = 0; x < ins.length; x++) if (w.lShare[ins[x]] > 0.0001) sh += w.lShare[ins[x]];
        if (sh <= 0) continue;
        for (x = 0; x < ins.length; x++) {
          var L = ins[x];
          if (w.lShare[L] <= 0.0001) continue;
          flow[w.lFrom[L]] += flow[i] * (w.lShare[L] / sh);
        }
      }
    }
    return flow;
  }

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
    if (cb < 1e-4) return ca > 1e-4 ? Math.min(20, ca * 40) : 1;
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

  function recoveryTime(w, flow) {
    var i;
    var t0 = w.idx.tierN[0], biggest = t0[0];
    for (i = 1; i < t0.length; i++) if (flow[t0[i]] > flow[biggest]) biggest = t0[i];

    /* Two clones from the same state on the same random stream: one loses its
       largest source for ten weeks, the other does not. Recovery time is
       how long after that source returns before service is normal again. */
    var OUT = 10, WIN = 78, HOLD = 8, TOL = 0.012;
    var fix = (CSC.hash32('probe:' + w.net.seed) >>> 0);
    var ctl = sim.clone(w); ctl.rs = fix;
    var hit = sim.clone(w); hit.rs = fix;
    var savedCap = hit.capacity[biggest];
    var ra = [1, 1, 1, 1], rb = [1, 1, 1, 1];
    var clean = 0, recovered = -1;
    for (i = 0; i < WIN; i++) {
      hit.capacity[biggest] = i < OUT ? 0 : savedCap;
      ra[i % 4] = weeklyFill(ctl);
      rb[i % 4] = weeklyFill(hit);
      if (i < OUT + 2) continue;
      var ma = (ra[0] + ra[1] + ra[2] + ra[3]) / 4;
      var mb = (rb[0] + rb[1] + rb[2] + rb[3]) / 4;
      /* Recovered means recovered and stayed recovered. */
      if (mb >= ma - TOL) {
        clean++;
        if (clean >= HOLD && recovered < 0) { recovered = i - HOLD + 1; break; }
      } else clean = 0;
    }
    if (recovered < 0) return WIN - OUT;
    return Math.max(0, recovered - OUT);
  }

  /* ---- per-node exposure, for the Risk view ------------------------------ */
  function nodeRisk(w, flow) {
    var risk = new Float64Array(w.N);
    var maxFlow = 1;
    for (var f = 0; f < w.N; f++) if (flow[f] > maxFlow) maxFlow = flow[f];
    for (var i = 0; i < w.N; i++) {
      var share = flow[i] / maxFlow;
      var unrel = (0.995 - w.reliability[i]) / 0.115;      // 0 robust .. 1 fragile
      var cover = w.buffer[i] / 6.0;                        // 1 = opening buffer
      var head = w.capacity[i] > 0 ? Math.max(0, 1 - flow[i] / w.capacity[i]) : 0;
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
      }
      var r = 0.30 * unrel * (0.4 + 0.6 * share)
            + 0.26 * (1 - Math.min(1, cover))
            + 0.24 * sole
            + 0.20 * (1 - Math.min(1, head / 0.4));
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
