/* CASCADE — the simulation core.
   Structure-of-arrays world state so that cloning is a handful of typed-array
   copies. Agents evaluate proposals by cloning this world and running it
   forward, which has to be cheap and has to be exact. */
(function (root) {
  'use strict';
  var CSC = root.CSC;
  var MAXLT = CSC.network.MAXLT;
  var WPQ = CSC.network.WEEKS_PER_QUARTER;

  var PRICE = 240;            // revenue per delivered unit
  var DISRUPT_RATE = 0.22;    // scales (1 - reliability) into a weekly hazard

  /* ---- world construction ------------------------------------------------ */

  function fromNetwork(net) {
    var nodes = net.nodes, lanes = net.lanes;
    var prng = new CSC.RNG('phase:' + net.seed);
    var N = nodes.length, M = lanes.length;
    var w = {
      net: net, N: N, M: M, MAXLT: MAXLT,
      week: 0, turn: 0,
      rs: (CSC.hash32('sim:' + net.seed) >>> 0),

      tier: new Int8Array(N), unitCost: new Float64Array(N),
      capacity: new Float64Array(N), capBase: new Float64Array(N),
      reliability: new Float64Array(N), inv: new Float64Array(N),
      backlog: new Float64Array(N), onOrder: new Float64Array(N),
      fcast: new Float64Array(N), sigma: new Float64Array(N),
      safety: new Float64Array(N), review: new Int32Array(N),
      phase: new Int32Array(N), buffer: new Float64Array(N),
      smooth: new Float64Array(N), plan: new Float64Array(N),
      batch: new Float64Array(N), alpha: new Float64Array(N),
      disrupt: new Int32Array(N), incoming: new Float64Array(N),
      newDem: new Float64Array(N), demAcc: new Float64Array(N),
      baseDemand: new Float64Array(N),
      thru: new Float64Array(N), stress: new Float64Array(N),
      conv: new Float64Array(N),

      lFrom: new Int32Array(M), lTo: new Int32Array(M), lShare: new Float64Array(M),
      lLT: new Int32Array(M), lCost: new Float64Array(M), lOwed: new Float64Array(M),
      lMode: new Int8Array(M), lFlow: new Float64Array(M),
      pipe: new Float64Array(M * MAXLT),

      /* policy knobs the agents move */
      payTerms: 45, dso: 52, commitMult: 1.0, promo: 0, promoDebt: 0, capBias: 1.0,

      shockNode: net.shockNode, shockWeek: -1,
      demandNoise: 1.0, demandFlat: false,

      hist: { t0: new Float64Array(52), dem: new Float64Array(52), ptr: 0, filled: 0 },
      acc: newAcc(),
      kpi: null
    };

    for (var i = 0; i < N; i++) {
      var n = nodes[i];
      w.tier[i] = n.tier;
      w.unitCost[i] = n.unitCost;
      w.capacity[i] = n.capacity;
      w.capBase[i] = n.capacity;
      w.reliability[i] = n.reliability;
      w.safety[i] = 1.95;
      w.review[i] = 2;
      /* Review cycles are staggered. Synchronised reordering would double the
         peak load on every upstream node for reasons unrelated to demand. */
      w.phase[i] = prng.int(4);
      /* Target weeks of cover held above the pipeline. Pure slack: it buys
         nothing on any board KPI and absorbs everything when a source fails. */
      /* The distribution tier runs thin, the way distribution tiers do. Cover
         upstream is what protects the customer. */
      w.buffer[i] = n.tier === 4 ? 2.7 : 6.0;
      w.smooth[i] = 1.0;
      w.plan[i] = 1.0;
      w.batch[i] = Math.max(8, Math.round((n.tier === 4 ? n.baseDemand : n.pull) * 0.16));
      w.alpha[i] = 0.12;
      w.baseDemand[i] = n.baseDemand || 0;
      var seedDem = n.tier === 4 ? n.baseDemand : n.pull;
      w.fcast[i] = seedDem;
      w.sigma[i] = seedDem * 0.09;
      /* Opening buffers: weeks of cover. This is the slack. */
      w.inv[i] = n.tier === 0 ? 0 : seedDem * 4.0;
    }
    for (var l = 0; l < M; l++) {
      var L = lanes[l];
      w.lFrom[l] = L.from; w.lTo[l] = L.to; w.lShare[l] = L.share;
      w.lLT[l] = L.lt; w.lCost[l] = L.cost; w.lMode[l] = L.mode;
      w.lFlow[l] = 0;
    }

    /* Conversion cost: each node's own value-add over its opening source mix.
       Constant. Everything else in landed cost is a sourcing decision. */
    for (var cv = 0; cv < N; cv++) {
      if (nodes[cv].tier === 0) { w.conv[cv] = 0; continue; }
      var up = 0, ush = 0;
      for (var cl = 0; cl < M; cl++) {
        if (lanes[cl].to !== cv || lanes[cl].share <= 0.0001) continue;
        up += (nodes[lanes[cl].from].unitCost + lanes[cl].cost) * lanes[cl].share;
        ush += lanes[cl].share;
      }
      w.conv[cv] = ush > 0 ? Math.max(0, nodes[cv].unitCost - up / ush) : 0;
    }

    /* static topology indices — shared by reference across clones */
    var inL = [], outL = [], tierN = [[], [], [], [], []];
    for (var a = 0; a < N; a++) { inL.push([]); outL.push([]); tierN[nodes[a].tier].push(a); }
    for (var b = 0; b < M; b++) { inL[lanes[b].to].push(b); outL[lanes[b].from].push(b); }
    w.idx = { inL: inL, outL: outL, tierN: tierN };

    /* Prime the pipelines so the handover starts balanced rather than with a
       five-tier startup transient. Steady state in, steady state out. */
    for (var p = 0; p < M; p++) {
      var Lp = lanes[p];
      if (Lp.share <= 0.0001) continue;
      var rate = (nodes[Lp.to].pull || 0) * Lp.share;
      if (rate <= 0) continue;
      for (var kk = 1; kk <= Lp.lt && kk < MAXLT; kk++) {
        w.pipe[p * MAXLT + (kk % MAXLT)] += rate;
      }
      w.onOrder[Lp.to] += rate * Math.min(Lp.lt, MAXLT - 1);
      w.lOwed[p] = rate;
      w.lFlow[p] = rate;
    }

    w.init = snapshotInit(w);
    return w;
  }

  function snapshotInit(w) {
    var safetySum = 0, bufSum = 0, safSum = 0, capSum = 0, invSum = 0, activeLanes = 0, srcCount = 0;
    for (var i = 0; i < w.N; i++) {
      safetySum += w.safety[i] + w.buffer[i];
      bufSum += w.buffer[i];
      safSum += w.safety[i];
      capSum += w.capBase[i];
      invSum += w.inv[i];
    }
    for (var l = 0; l < w.M; l++) if (w.lShare[l] > 0.001) activeLanes++;
    for (var n = 0; n < w.N; n++) {
      if (w.tier[n] === 0) continue;
      var c = 0, ins = w.idx.inL[n];
      for (var k = 0; k < ins.length; k++) if (w.lShare[ins[k]] > 0.001) c++;
      srcCount += c;
    }
    return { safetySum: safetySum, bufSum: bufSum, safSum: safSum, capSum: capSum, invSum: invSum, activeLanes: activeLanes, srcCount: srcCount };
  }

  function newAcc() {
    return {
      custDemand: 0, custShip: 0, purchase: 0, freight: 0, revenue: 0,
      invSum: 0, invSamples: 0, weeks: 0, backlogSum: 0, capUsed: 0, capAvail: 0,
      lostWeeks: 0
    };
  }

  var NODE_ARRAYS = ['tier', 'unitCost', 'capacity', 'capBase', 'reliability', 'inv', 'backlog',
    'onOrder', 'fcast', 'sigma', 'safety', 'review', 'batch', 'alpha', 'disrupt',
    'incoming', 'newDem', 'demAcc', 'baseDemand', 'thru', 'stress', 'phase', 'buffer', 'conv', 'smooth', 'plan'];
  var LANE_ARRAYS = ['lFrom', 'lTo', 'lShare', 'lLT', 'lCost', 'lOwed', 'lMode', 'lFlow'];
  var SCALARS = ['kpiRaw', 'net', 'N', 'M', 'MAXLT', 'week', 'turn', 'rs', 'payTerms', 'dso', 'commitMult',
    'promo', 'promoDebt', 'capBias', 'shockNode', 'shockWeek', 'demandNoise', 'demandFlat', 'idx', 'init'];

  function clone(w) {
    var c = {};
    for (var s = 0; s < SCALARS.length; s++) c[SCALARS[s]] = w[SCALARS[s]];
    for (var i = 0; i < NODE_ARRAYS.length; i++) c[NODE_ARRAYS[i]] = w[NODE_ARRAYS[i]].slice();
    for (var j = 0; j < LANE_ARRAYS.length; j++) c[LANE_ARRAYS[j]] = w[LANE_ARRAYS[j]].slice();
    c.pipe = w.pipe.slice();
    c.hist = { t0: w.hist.t0.slice(), dem: w.hist.dem.slice(), ptr: w.hist.ptr, filled: w.hist.filled };
    c.acc = Object.assign({}, w.acc);
    c.kpi = w.kpi ? Object.assign({}, w.kpi) : null;
    return c;
  }

  /* ---- world-local PRNG (cloned with the world, so futures match) --------- */
  function wrand(w) {
    var a = (w.rs + 0x6d2b79f5) | 0;
    w.rs = a;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /* ---- weekly step ------------------------------------------------------- */

  function step(w) {
    var i, l, t, k;
    var week = w.week;
    var slot = week % MAXLT;
    var N = w.N, M = w.M;
    var inL = w.idx.inL, outL = w.idx.outL, tierN = w.idx.tierN;

    /* 1. arrivals */
    for (l = 0; l < M; l++) {
      var q = w.pipe[l * MAXLT + slot];
      if (q > 0) {
        var to = w.lTo[l];
        w.inv[to] += q;
        w.onOrder[to] -= q;
        if (w.onOrder[to] < 0) w.onOrder[to] = 0;
        w.pipe[l * MAXLT + slot] = 0;
      }
    }

    /* 2. capacity availability: background disruptions + the scheduled shock */
    for (i = 0; i < N; i++) {
      if (w.disrupt[i] > 0) w.disrupt[i]--;
      else if (wrand(w) < (1 - w.reliability[i]) * DISRUPT_RATE * 0.25) {
        w.disrupt[i] = 1 + Math.floor(wrand(w) * 3);
      }
    }
    var capMul = new Float64Array(N);
    for (i = 0; i < N; i++) capMul[i] = w.disrupt[i] > 0 ? 0.55 : 1;
    if (w.shockWeek >= 0) {
      var dw = week - w.shockWeek;
      if (dw >= 0) {
        /* Fixed magnitude. Identical in every run, at every turn number. */
        /* Fixed magnitude and fixed duration, set at genesis. Nothing here
           scales with the turn number, the player, or the network's state. */
        if (dw < 26) capMul[w.shockNode] = 0;
        else if (dw < 44) capMul[w.shockNode] = 0.18;
        else if (dw < 56) capMul[w.shockNode] = 0.55;
      }
    }

    /* 3. end demand */
    var endDem = 0;
    var t4 = tierN[4];
    var season = 1 + 0.055 * Math.sin((week / 52) * Math.PI * 2);
    for (i = 0; i < t4.length; i++) {
      var d = w.baseDemand[t4[i]] * (w.demandFlat ? 1 : season);
      if (!w.demandFlat) d *= 1 + (wrand(w) * 2 - 1) * 0.11 * w.demandNoise;
      d *= 1 + w.promo;
      if (d < 0) d = 0;
      w.incoming[t4[i]] += d;
      endDem += d;
    }

    /* 4. fulfilment, downstream first */
    for (t = 4; t >= 0; t--) {
      var list = tierN[t];
      for (k = 0; k < list.length; k++) {
        i = list[k];
        var nd = w.incoming[i];
        w.newDem[i] = nd;
        var want = w.backlog[i] + nd;
        var capNow = w.capacity[i] * capMul[i] * w.capBias;
        var avail = t === 0 ? capNow : Math.min(w.inv[i], capNow);
        var ship = want < avail ? want : avail;
        if (ship < 0) ship = 0;
        if (t > 0) w.inv[i] -= ship;
        w.backlog[i] = want - ship;
        w.incoming[i] = 0;
        w.thru[i] = w.thru[i] * 0.9 + ship * 0.1;
        w.stress[i] = w.stress[i] * 0.94 + nd * 0.06;
        w.acc.capAvail += capNow;
        w.acc.capUsed += ship;
        w.acc.backlogSum += w.backlog[i];

        if (t === 4) {
          /* Service is measured against the demand of the period. Clearing an
             old backlog is not an on-time delivery, and most of a missed week
             at the shelf is simply a lost sale. */
          w.acc.custDemand += nd;
          w.acc.custShip += Math.min(ship, nd);
          w.acc.revenue += ship * PRICE;
          w.backlog[i] = (want - ship) * 0.40;
        } else if (ship > 0) {
          var outs = outL[i];
          var owedTot = 0, o;
          for (o = 0; o < outs.length; o++) owedTot += w.lOwed[outs[o]];
          if (owedTot > 0.0001) {
            for (o = 0; o < outs.length; o++) {
              var L = outs[o];
              var frac = w.lOwed[L] / owedTot;
              var qq = ship * frac;
              if (qq <= 0) continue;
              w.lOwed[L] -= qq;
              /* Transit is not a constant. Long lanes slip more often, which
                 is why a shorter lane reads as a better lane on service. */
              var jit = 0;
              var jp = w.lLT[L] / 48;
              var jr = wrand(w);
              if (jr < jp * 0.55) jit = 1 + (jr < jp * 0.18 ? 1 : 0);
              var arrive = (week + w.lLT[L] + jit) % MAXLT;
              w.pipe[L * MAXLT + arrive] += qq;
              w.lFlow[L] = w.lFlow[L] * 0.88 + qq * 0.12;
              w.acc.purchase += qq * w.unitCost[i];
              w.acc.freight += qq * w.lCost[L];
            }
          }
        }
      }
    }

    /* 5. replenishment orders, downstream first */
    var t0orders = 0;
    for (t = 4; t >= 1; t--) {
      var lst = tierN[t];
      for (k = 0; k < lst.length; k++) {
        i = lst[k];
        w.demAcc[i] += w.newDem[i];
        if ((week + w.phase[i]) % w.review[i] !== 0) continue;
        /* Demand is only observed at the review point, in aggregate. The
           coarser the review, the blinder the forecast. */
        var obs = w.demAcc[i] / w.review[i];
        w.demAcc[i] = 0;
        var err = obs - w.fcast[i];
        w.fcast[i] += w.alpha[i] * err;
        w.sigma[i] = w.sigma[i] * 0.85 + Math.abs(err) * 0.15;
        if (w.sigma[i] > w.fcast[i] * 0.5) w.sigma[i] = w.fcast[i] * 0.5;

        var ins = inL[i];
        var ltW = 0, shTot = 0, x;
        for (x = 0; x < ins.length; x++) {
          if (w.lShare[ins[x]] <= 0.0001) continue;
          ltW += w.lLT[ins[x]] * w.lShare[ins[x]];
          shTot += w.lShare[ins[x]];
        }
        if (shTot <= 0.0001) continue;
        var LT = ltW / shTot;
        var cover = LT + w.review[i];
        /* The plan the business has signed up to, not just the statistical
           forecast. Building to plan is what makes a plan attainable. */
        var fEff = w.fcast[i] * w.plan[i];
        var S = fEff * (cover + w.buffer[i]) + w.safety[i] * w.sigma[i] * Math.sqrt(cover);
        var IP = w.inv[i] + w.onOrder[i] - w.backlog[i];
        /* Partial-adjustment replenishment: cover consumption, then close a
           fraction of the gap to target. The fraction is the damping that
           keeps order variance near demand variance. */
        var beta = w.smooth[i] / cover;
        if (beta < 0.04) beta = 0.04;
        if (beta > 0.60) beta = 0.60;
        /* Building cover takes lead time. Releasing it takes a decision. */
        var gap = S - IP;
        if (gap < 0) beta = Math.min(0.85, beta * 3.2);
        var raw = fEff * w.review[i] + beta * gap;
        if (raw <= 0) continue;
        /* Order batching. A minimum-order quantity is a cost saving downstream
           and a variance amplifier upstream. Nobody's KPI sees the second half. */
        var Q = Math.ceil(raw / w.batch[i]) * w.batch[i];
        for (x = 0; x < ins.length; x++) {
          var LL = ins[x];
          if (w.lShare[LL] <= 0.0001) continue;
          var qs = Q * (w.lShare[LL] / shTot);
          w.lOwed[LL] += qs;
          w.onOrder[i] += qs;
          w.incoming[w.lFrom[LL]] += qs;
          if (w.tier[w.lFrom[LL]] === 0) t0orders += qs;
        }
      }
    }

    /* 6. bookkeeping */
    var invVal = 0;
    for (i = 0; i < N; i++) invVal += w.inv[i] * w.unitCost[i];
    w.acc.invSum += invVal;
    w.acc.invSamples++;
    w.acc.weeks++;
    if (w.acc.custDemand > 0 && w.acc.custShip / w.acc.custDemand < 0.9) w.acc.lostWeeks++;

    var hp = w.hist.ptr;
    w.hist.t0[hp] = t0orders;
    w.hist.dem[hp] = endDem;
    w.hist.ptr = (hp + 1) % 52;
    if (w.hist.filled < 52) w.hist.filled++;

    w.week++;
  }

  function runWeeks(w, n) { for (var i = 0; i < n; i++) step(w); }

  /* ---- KPIs: what the board sees ----------------------------------------- */

  /* Landed cost per finished unit, rolled up through the active source mix.
     A structural number, not a cash-flow ratio: it moves when sourcing moves. */
  function landedCostPerUnit(w) {
    var landed = new Float64Array(w.N);
    var tierN = w.idx.tierN, inL = w.idx.inL;
    for (var t = 0; t <= 4; t++) {
      var lst = tierN[t];
      for (var k = 0; k < lst.length; k++) {
        var i = lst[k];
        if (t === 0) { landed[i] = w.unitCost[i]; continue; }
        var ins = inL[i], acc = 0, sh = 0;
        for (var x = 0; x < ins.length; x++) {
          var L = ins[x];
          if (w.lShare[L] <= 0.0001) continue;
          acc += (landed[w.lFrom[L]] + w.lCost[L]) * w.lShare[L];
          sh += w.lShare[L];
        }
        landed[i] = (sh > 0 ? acc / sh : w.unitCost[i]) + w.conv[i];
      }
    }
    var num = 0, den = 0, t4 = tierN[4];
    for (var d = 0; d < t4.length; d++) {
      num += landed[t4[d]] * w.baseDemand[t4[d]];
      den += w.baseDemand[t4[d]];
    }
    return { perUnit: den > 0 ? num / den : 0, landed: landed };
  }

  function computeKPI(w) {
    var a = w.acc;
    var lc = landedCostPerUnit(w).perUnit;
    var avgInv = a.invSamples > 0 ? a.invSum / a.invSamples : 0;
    var otd = a.custDemand > 0 ? (a.custShip / a.custDemand) * 100 : 100;
    var cogs = a.custShip * lc;
    var turns = avgInv > 0 ? (cogs * 4) / avgInv : 0;
    /* Attainment is measured against the demand plan of record. */
    var commit = 0;
    var t4 = w.idx.tierN[4];
    for (var i = 0; i < t4.length; i++) commit += w.baseDemand[t4[i]] * WPQ;
    commit *= w.commitMult;
    var attain = commit > 0 ? (a.custShip / commit) * 100 : 100;
    var revenue = a.custShip * PRICE;
    var receivables = revenue * (w.dso / 91);
    var payables = cogs * (w.payTerms / 91);
    var wc = (avgInv + receivables - payables) / 1e6;
    return {
      landedCost: lc,
      otd: otd,
      turns: turns,
      attain: attain,
      workingCapital: wc,
      units: a.custShip,
      revenue: revenue,
      avgInv: avgInv,
      util: a.capAvail > 0 ? a.capUsed / a.capAvail : 0
    };
  }

  /* Burn-in. The company existed before the player arrived; the network is
     handed over in steady state with its original buffers intact. */
  function warmup(w, weeks) {
    runWeeks(w, weeks);
    /* w.week is absolute and must not be rewound: the lane pipelines are
       indexed against it. Only the scoreboard resets. */
    w.turn = 0;
    w.acc = newAcc();
    w.kpi = null;
    w.init = snapshotInit(w);
    return w;
  }

  /* Suppliers grow into the volume they are given — but only so far, and
     only so fast. The headroom between what a site can be asked for and what
     it can ever build is finite, and it is not on anybody's scorecard. */
  var CAP_CEILING = 1.5;
  var CAP_HARD = 8.0;
  function adaptCapacity(w) {
    for (var i = 0; i < w.N; i++) {
      if (w.capBase[i] <= 0) continue;
      /* The supply market is not elastic. An outside supplier cannot double
         its output because we would like it to; only our own sites can. */
      if (w.tier[i] === 0) continue;
      /* A site that wins volume will build for it, slowly, and only so far.
         Capacity is an asset: a quiet quarter does not remove it. */
      var lo = w.capBase[i];
      var hi = Math.max(w.capBase[i] * CAP_CEILING, Math.min(w.capBase[i] * CAP_HARD, w.stress[i] * 1.3));
      var desired = w.stress[i] * 1.22;
      var target = desired < lo ? lo : (desired > hi ? hi : desired);
      if (target > w.capacity[i]) w.capacity[i] += (target - w.capacity[i]) * 0.22;
    }
  }

  function runQuarter(w) {
    w.acc = newAcc();
    adaptCapacity(w);
    /* Pull-forward is borrowing. The lift decays and the payback follows. */
    w.promo = w.promo * 0.74 - w.promoDebt * 0.30;
    w.promoDebt *= 0.70;
    if (Math.abs(w.promo) < 0.002) w.promo = 0;
    if (Math.abs(w.promoDebt) < 0.002) w.promoDebt = 0;
    runWeeks(w, WPQ);
    w.turn++;
    var raw = computeKPI(w);
    /* Reported on a two-quarter rolling basis, the way the pack goes to the
       board. One quarter of order-cycle noise is not a trend. */
    if (w.kpi) {
      var blended = {};
      for (var f in raw) blended[f] = w.kpi[f] * 0.5 + raw[f] * 0.5;
      w.kpi = blended;
    } else {
      w.kpi = raw;
    }
    w.kpiRaw = raw;
    return w.kpi;
  }

  /* Evaluate a candidate future without touching the live world. */
  function project(w, quarters) {
    var c = clone(w);
    var out = null;
    for (var i = 0; i < quarters; i++) out = runQuarter(c);
    return { kpi: out, world: c };
  }

  root.CSC.sim = {
    fromNetwork: fromNetwork, clone: clone, step: step, runWeeks: runWeeks,
    runQuarter: runQuarter, adaptCapacity: adaptCapacity, computeKPI: computeKPI, project: project, warmup: warmup,
    newAcc: newAcc, landedCostPerUnit: landedCostPerUnit, PRICE: PRICE, WPQ: WPQ, snapshotInit: snapshotInit
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
