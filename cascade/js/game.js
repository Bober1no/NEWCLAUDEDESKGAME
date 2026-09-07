/* CASCADE — the run.
   Turn loop, decision log, shock schedule, termination. Headless: no DOM. */
(function (root) {
  'use strict';
  var CSC = root.CSC;
  var sim = CSC.sim, health = CSC.health, board = CSC.board, agents = CSC.agents;

  function newGame(seed, opts) {
    opts = opts || {};
    var net = CSC.network.build(seed);
    var w = sim.fromNetwork(net);
    if (opts.flatDemand) { w.demandFlat = true; w.demandNoise = 0; }
    sim.warmup(w, 130);
    w.init.hhi0 = health.concentration(w, health.sourceFlows(w));

    /* Handover quarter: establishes the baseline the board sets targets from. */
    /* Four quarters of handover data, so the board's opening targets are set
       against a run rate rather than one lucky quarter. */
    var probe = sim.clone(w);
    var acc = null, qn;
    for (qn = 0; qn < 4; qn++) {
      var kq = sim.runQuarter(probe);
      if (!acc) { acc = {}; for (var kk in kq) acc[kk] = 0; }
      for (var k2 in kq) acc[k2] += kq[k2] / 4;
    }
    var baseKpi = acc;
    /* The handover numbers are on the board pack from day one. */
    w.kpi = Object.assign({}, baseKpi);
    var h0 = health.compute(w);

    var g = {
      seed: seed, net: net, world: w, turn: 0, phase: 'brief',
      opts: opts,
      enabled: opts.enabled || { procurement: true, logistics: true, inventory: true, sales: true, finance: true },
      autoApprove: !!opts.autoApprove,
      aligned: !!opts.aligned,
      inbox: [], decisions: [], history: [], log: [],
      baseline: baseKpi,
      baseHealth: h0,
      targets: board.initialTargets(baseKpi),
      score: 0, confidence: 70, missStreak: 0, warnings: 0, highStreak: 0, promotions: 0,
      shockTurn: opts.shockTurn != null ? opts.shockTurn : net.shockTurn,
      shockFired: false, shockWeek: -1,
      ended: false, endReason: null, endTurn: null,
      recoveryDoubledAt: null
    };
    g.baseRecovery = Math.max(2, h0.recovery);
    g.recoverySm = null;
    g.recStreak = 0;
    say(g, 'Handover complete. ' + net.nodes.length + ' nodes, ' + activeLaneCount(w) + ' active lanes, five tiers.');
    say(g, 'Board targets issued for the coming quarter.');
    return g;
  }

  function activeLaneCount(w) {
    var c = 0;
    for (var l = 0; l < w.M; l++) if (w.lShare[l] > 0.0001) c++;
    return c;
  }

  function say(g, text) {
    g.log.push({ turn: g.turn, text: text });
    if (g.log.length > 400) g.log.shift();
  }

  /* ---- morning brief ----------------------------------------------------- */

  function beginTurn(g) {
    if (g.ended) return [];
    g.turn++;
    g.phase = 'brief';
    g.inbox = agents.brief(g.world, g.turn, g.enabled, g.aligned);
    for (var i = 0; i < g.inbox.length; i++) g.inbox[i].decision = g.autoApprove ? 'approve' : null;
    say(g, 'Q' + g.turn + ' brief: ' + g.inbox.length + ' proposals from ' + countAgents(g.inbox) + ' agents.');
    return g.inbox;
  }

  function countAgents(inbox) {
    var s = {};
    for (var i = 0; i < inbox.length; i++) s[inbox[i].agent] = 1;
    return Object.keys(s).length;
  }

  function decide(g, uid, approve) {
    for (var i = 0; i < g.inbox.length; i++) {
      if (g.inbox[i].uid === uid) { g.inbox[i].decision = approve ? 'approve' : 'deny'; return true; }
    }
    return false;
  }

  function allDecided(g) {
    for (var i = 0; i < g.inbox.length; i++) if (!g.inbox[i].decision) return false;
    return true;
  }

  /* ---- the quarter ------------------------------------------------------- */

  /* The quarter is split so the interface can run it a week at a time and
     the headless driver can run it in one call. */
  function startQuarter(g) {
    if (g.ended) return null;
    var w = g.world, i;
    var denials = 0, approvals = 0;
    var fragBefore = health.compute(w, { skipProbe: true, lastRecovery: g.baseRecovery });

    for (i = 0; i < g.inbox.length; i++) {
      var p = g.inbox[i];
      if (p.decision !== 'approve') { denials++; p.applied = false; continue; }
      var before = health.compute(w, { skipProbe: true, lastRecovery: fragBefore.recovery });
      CSC.actions.BY_ID[p.actionId].apply(w, p.params);
      var after = health.compute(w, { skipProbe: true, lastRecovery: fragBefore.recovery });
      p.applied = true;
      p.fragilityDelta = after.fragility - before.fragility;
      p.concentrationDelta = after.concentration - before.concentration;
      p.slackDelta = after.slack - before.slack;
      approvals++;
      say(g, 'Approved — ' + p.agentName + ': ' + p.title);
    }
    if (denials) say(g, denials + ' proposal' + (denials > 1 ? 's' : '') + ' declined.');

    /* The shock. Scheduled at genesis, fixed magnitude, no relationship to
       anything the player has done. */
    if (!g.shockFired && g.turn >= g.shockTurn) {
      g.shockFired = true;
      w.shockWeek = w.week + 1;
      g.shockWeek = w.shockWeek;
      g.shockNodeName = g.net.nodes[w.shockNode].name;
      say(g, 'Supply interruption reported at ' + g.shockNodeName + '. Cause under review.');
    }

    w.acc = sim.newAcc();
    sim.adaptCapacity(w);
    w.promo = w.promo * 0.74 - w.promoDebt * 0.30;
    w.promoDebt *= 0.70;
    if (Math.abs(w.promo) < 0.002) w.promo = 0;
    if (Math.abs(w.promoDebt) < 0.002) w.promoDebt = 0;
    g.pending = { approvals: approvals, denials: denials, weeks: 0 };
    g.phase = 'running';
    return g.pending;
  }

  function tickWeek(g) {
    sim.step(g.world);
    g.pending.weeks++;
    return g.pending.weeks >= sim.WPQ;
  }

  function endQuarter(g) {
    var w = g.world, i;
    var approvals = g.pending.approvals, denials = g.pending.denials;
    w.turn++;
    var raw = sim.computeKPI(w);
    if (w.kpi) {
      var blended = {};
      for (var f in raw) blended[f] = w.kpi[f] * 0.5 + raw[f] * 0.5;
      w.kpi = blended;
    } else w.kpi = raw;
    w.kpiRaw = raw;
    var kpi = w.kpi;

    var h = health.compute(w);
    g.recoverySm = g.recoverySm == null ? h.recovery : g.recoverySm * 0.62 + h.recovery * 0.38;
    h.recoverySm = g.recoverySm;
    /* Doubled, and stayed doubled. A single noisy probe is not a trend. */
    if (g.recoverySm >= g.baseRecovery * 2) {
      g.recStreak = (g.recStreak || 0) + 1;
      if (g.recStreak >= 3 && g.recoveryDoubledAt === null) g.recoveryDoubledAt = g.turn - 2;
    } else g.recStreak = 0;

    var rv = board.review(kpi, g.targets, denials, g.confidence);
    g.score = rv.score;
    g.confidence = rv.confidence;
    if (rv.pass) { g.missStreak = 0; if (rv.score >= 72) g.targets = board.ratchet(g.targets); }
    else g.missStreak++;
    if (g.missStreak === 2) g.warnings++;

    /* The other direction. Three strong quarters and the committee widens the
       remit — which is to say, more proposals, faster. */
    g.highStreak = rv.score >= 86 ? (g.highStreak || 0) + 1 : 0;
    if (g.highStreak >= 3) {
      g.highStreak = 0;
      g.promotions = (g.promotions || 0) + 1;
      rv.promotion = g.promotions;
      say(g, 'Committee has expanded the operating remit. Delegated authority increased.');
    }
    var fired = g.missStreak >= 3;

    rv.comment = board.commentary(rv, g.missStreak, g.turn, g.seed);
    rv.missStreak = g.missStreak;
    rv.warning = g.missStreak === 2;
    rv.fired = fired;

    var snapRisk = new Float32Array(w.N), snapFlow = new Float32Array(w.N), snapShare = new Float32Array(w.M);
    for (i = 0; i < w.N; i++) { snapRisk[i] = h.risk[i]; snapFlow[i] = h.flow[i]; }
    for (i = 0; i < w.M; i++) snapShare[i] = w.lShare[i];

    g.history.push({
      turn: g.turn, kpi: kpi,
      snap: { risk: snapRisk, flow: snapFlow, share: snapShare },
      health: {
        fragility: h.fragility, bullwhip: h.bullwhip, concentration: h.concentration,
        recovery: h.recovery, recoverySm: h.recoverySm,
        slack: h.slack, exposure: h.exposure, sources: h.sources, util: h.util
      },
      score: rv.score, pass: rv.pass, confidence: g.confidence,
      approvals: approvals, denials: denials,
      shock: g.shockFired && g.turn >= g.shockTurn,
      targets: Object.assign({}, g.targets)
    });

    for (i = 0; i < g.inbox.length; i++) {
      var q = g.inbox[i];
      g.decisions.push({
        turn: g.turn, agent: q.agent, agentName: q.agentName, actionId: q.actionId,
        title: q.title, rationale: q.rationale, kpiLabel: q.kpiLabel,
        baseline: q.baseline, projectedValue: q.projectedValue, score: q.score,
        candidates: q.candidates, considered: q.considered, sees: q.sees, blind: q.blind,
        approved: q.decision === 'approve', applied: !!q.applied,
        fragilityDelta: q.fragilityDelta || 0,
        concentrationDelta: q.concentrationDelta || 0,
        slackDelta: q.slackDelta || 0,
        touches: q.touches, conflict: q.conflict || null
      });
    }

    say(g, 'Q' + g.turn + ' board review: ' + rv.score.toFixed(1) + '/100 — ' + (rv.pass ? 'on plan' : 'below plan'));
    if (rv.warning) say(g, 'FORMAL WARNING recorded.');

    if (fired) {
      g.ended = true; g.endReason = 'FIRED'; g.endTurn = g.turn;
      say(g, 'The board has terminated the Chief Operating Officer with immediate effect.');
    } else if (g.turn >= 90) {
      g.ended = true; g.endReason = 'TENURE'; g.endTurn = g.turn;
    }

    g.phase = 'review';
    g.lastReview = rv;
    g.lastHealth = h;
    return rv;
  }

  function runQuarter(g) {
    if (g.ended) return null;
    startQuarter(g);
    var done = false;
    while (!done) done = tickWeek(g);
    return endQuarter(g);
  }

  /* ---- headless driver, for sandbox and analysis ------------------------- */

  function autoRun(g, maxTurns, hook) {
    var n = 0;
    while (!g.ended && n < maxTurns) {
      beginTurn(g);
      for (var i = 0; i < g.inbox.length; i++) {
        var approve = true;
        if (g.opts.denyRate) {
          var r = CSC.derive(g.seed, 'deny:' + g.turn + ':' + i).next();
          approve = r >= g.opts.denyRate;
        }
        g.inbox[i].decision = approve ? 'approve' : 'deny';
      }
      runQuarter(g);
      if (hook) hook(g);
      n++;
    }
    return g;
  }

  root.CSC.game = {
    newGame: newGame, beginTurn: beginTurn, decide: decide, runQuarter: runQuarter,
    startQuarter: startQuarter, tickWeek: tickWeek, endQuarter: endQuarter,
    allDecided: allDecided, autoRun: autoRun, activeLaneCount: activeLaneCount, say: say
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
