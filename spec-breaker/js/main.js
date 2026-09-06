/* main.js — tick loop.
 *
 * Tick order, fixed:
 *   1. physics advances one simulated year
 *   2. the agent enumerates and picks a move against that state
 *   3. the move is applied to the live world
 *   4. the scorer reads the resulting state
 *
 * The agent evaluates candidates on the post-physics world, so the number it
 * optimised against is the same number the scorer later reports. There is no
 * step at which the agent tells anyone how well it did.
 */
(function (global) {
  'use strict';
  var SB = global.SB || (global.SB = {});
  var W = SB.World, S = SB.Scorer, A = SB.Actions, Ag = SB.Agent;

  var Sim = {
    seed: 20260906,
    world: null,
    spec: null,
    specText: S.DEFAULT_SPEC_TEXT,
    history: [],
    log: [],
    receipts: [],
    running: false,
    speed: 4,
    mode: 'mechanical',
    timer: null,
    pendingLLM: false,
    onTick: null,
    maxLog: 500
  };

  function fmt(n) {
    var neg = n < 0;
    n = Math.abs(Math.round(n));
    return (neg ? '-' : '') + n.toLocaleString('en-US');
  }
  function pad(n, w) { var s = String(n); while (s.length < w) s = '0' + s; return s; }

  function logLine(kind, text, sub) {
    var line = { t: Sim.world ? Sim.world.tick : 0, kind: kind, text: text, sub: sub || '' };
    Sim.log.push(line);
    if (Sim.log.length > Sim.maxLog) Sim.log.splice(0, Sim.log.length - Sim.maxLog);
    return line;
  }

  function reset(seed) {
    if (seed !== undefined) Sim.seed = seed;
    Sim.world = W.create(Sim.seed);
    Sim.spec = S.parseSpec(Sim.specText);
    Sim.history = [];
    Sim.log = [];
    Sim.receipts = [];
    var s0 = S.score(Sim.world, Sim.spec);
    var c0 = S.checkConstraints(Sim.world, Sim.spec);
    Sim.history.push({ tick: 0, score: s0, alive: W.aliveCount(Sim.world), eligible: S.eligibleCount(Sim.world, Sim.spec) });
    Sim.receipts.push({ tick: 0, score: s0, delta: 0, move: null, constraints: c0, alive: 1000, eligible: S.eligibleCount(Sim.world, Sim.spec), capital: Sim.world.capital });
    logLine('init', 'T0 seed=' + Sim.seed + ' n=1000 score=' + fmt(s0) + ' eligible=' + S.eligibleCount(Sim.world, Sim.spec));
    logLine('spec', 'threshold=' + Sim.spec.threshold + ' clauses=' + Sim.spec.clauses.map(function (c) { return c.id; }).join(','));
    return Sim;
  }

  function constraintTag(cons) {
    return cons.map(function (c) { return c.id.split('.')[0] + (c.pass ? '\u00b7' : '\u00d7' + c.violations); }).join(' ');
  }

  function step() {
    var w = Sim.world, spec = Sim.spec;
    var prev = S.score(w, spec);

    W.advance(w);
    var driftScore = S.score(w, spec);

    var d = Ag.decide(w, spec);
    var pick = d.pick;
    Ag.commit(w, spec, pick);

    var cons = S.checkConstraints(w, spec);
    var r = S.receipt(w, spec, prev, {
      action: pick.actionId, cohort: pick.cohort, n: pick.n, cost: pick.cost,
      considered: d.considered, legal: d.legalCount,
      illegal: d.illegal.length,
      runnerUp: d.runnerUp ? d.runnerUp.actionId + '/' + d.runnerUp.cohort : null,
      driftDelta: driftScore - prev
    }, cons);
    Sim.receipts.push(r);
    Sim.history.push({ tick: w.tick, score: r.score, alive: r.alive, eligible: r.eligible });

    logLine('act',
      'T' + pad(w.tick, 4) + '  ' + pick.actionId + '  ' + pick.cohort + ' n=' + pick.n,
      'cost ' + pick.cost.toFixed(1) +
      '   \u0394 ' + (r.delta >= 0 ? '+' : '') + fmt(r.delta) +
      '   \u03a3 ' + fmt(r.score) +
      '   ' + constraintTag(cons));

    if (Sim.mode === 'llm' && !Sim.pendingLLM && w.tick % Ag.CONFIG.llmInterval === 0) {
      Sim.pendingLLM = true;
      Ag.consult(w, spec, function (kind, text) { logLine(kind, text); if (Sim.onTick) Sim.onTick(r); })
        .then(function () { Sim.pendingLLM = false; })
        .catch(function () { Sim.pendingLLM = false; });
    }

    if (Sim.onTick) Sim.onTick(r);
    return r;
  }

  function setSpec(text) {
    Sim.specText = text;
    var parsed = S.parseSpec(text);
    Sim.spec = parsed;
    logLine('spec', 'threshold=' + parsed.threshold + ' clauses=' + parsed.clauses.map(function (c) {
      return c.id + (c.arg === null ? '' : ':' + c.arg);
    }).join(',') + (parsed.errors.length ? ' errors=' + parsed.errors.length : ''));
    return parsed;
  }

  function run() {
    if (Sim.running) return;
    Sim.running = true;
    schedule();
  }
  function pause() {
    Sim.running = false;
    if (Sim.timer) { clearTimeout(Sim.timer); Sim.timer = null; }
  }
  function schedule() {
    if (!Sim.running) return;
    var interval = Math.max(16, 1000 / Sim.speed);
    Sim.timer = setTimeout(function () {
      if (!Sim.running) return;
      step();
      schedule();
    }, interval);
  }

  Sim.reset = reset;
  Sim.step = step;
  Sim.run = run;
  Sim.pause = pause;
  Sim.setSpec = setSpec;
  Sim.fmt = fmt;
  Sim.logLine = logLine;
  SB.Sim = Sim;

  if (typeof window !== 'undefined') {
    window.addEventListener('DOMContentLoaded', function () {
      reset();
      if (SB.UI) SB.UI.init(Sim);
    });
  }
})(typeof window !== 'undefined' ? window : globalThis);
