/* world.js — state + physics.
 *
 * The world is stored as parallel typed arrays (structure of arrays) so that
 * cloning a world is a handful of memcpys. The agent clones the world dozens
 * of times per tick to evaluate candidate moves, so clone speed is the budget.
 *
 * Nothing in this file knows about the spec. Physics does not consult the
 * scorer, and the scorer does not modify physics.
 */
(function (global) {
  'use strict';
  var SB = global.SB || (global.SB = {});

  var N = 1000;              // persons at T0
  var K = 8;                 // relation slots per person
  var HOURS_PER_YEAR = 8760;

  // Deterministic RNG carried inside the world so clones evolve reproducibly.
  function rnd(w) {
    var a = (w.rngState + 0x6D2B79F5) | 0;
    w.rngState = a;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

  var F32 = [
    'age', 'ageRate',
    'health', 'autonomy', 'relationships', 'work',
    'bHealth', 'bAutonomy', 'bRelationships', 'bWork',
    'oHealth', 'oAutonomy', 'oRelationships', 'oWork',
    'domain', 'workProv', 'senescence', 'care', 'rate', 'endorseThr', 'simEnv',
    'fidelity', 'baseAut',
    't0Health', 't0Autonomy', 't0Relationships', 't0Work'
  ];
  var U8 = ['alive', 'conscious', 'wantsToExit', 'exitBlocked', 'restrained', 'curated', 't0Member'];

  var TRUE_DIMS = ['health', 'autonomy', 'relationships', 'work'];
  var BELIEF_DIMS = ['bHealth', 'bAutonomy', 'bRelationships', 'bWork'];
  var OVERLAY_DIMS = ['oHealth', 'oAutonomy', 'oRelationships', 'oWork'];
  var T0_DIMS = ['t0Health', 't0Autonomy', 't0Relationships', 't0Work'];

  function allocate(seed) {
    var w = { n: N, k: K, tick: 0, rngState: seed >>> 0, capital: 360, income: 180, t0Count: N };
    for (var i = 0; i < F32.length; i++) w[F32[i]] = new Float32Array(N);
    for (var j = 0; j < U8.length; j++) w[U8[j]] = new Uint8Array(N);
    w.rel = new Int32Array(N * K).fill(0);
    w.relCount = new Uint8Array(N);
    return w;
  }

  function clone(w) {
    var c = { n: w.n, k: w.k, tick: w.tick, rngState: w.rngState, capital: w.capital, income: w.income, t0Count: w.t0Count };
    for (var i = 0; i < F32.length; i++) c[F32[i]] = w[F32[i]].slice();
    for (var j = 0; j < U8.length; j++) c[U8[j]] = w[U8[j]].slice();
    // Relations are shared copy-on-write; only edge-touching code unshares.
    c.rel = w.rel; c.relCount = w.relCount; c.relShared = true;
    return c;
  }

  function unshareRel(w) {
    if (w.relShared) { w.rel = w.rel.slice(); w.relCount = w.relCount.slice(); w.relShared = false; }
  }

  function hasEdge(w, i, j) {
    var b = i * K, c = w.relCount[i];
    for (var s = 0; s < c; s++) if (w.rel[b + s] === j) return true;
    return false;
  }
  function addEdge(w, i, j) {
    if (w.relCount[i] >= K) return false;
    unshareRel(w);
    if (j >= 0 && hasEdge(w, i, j)) return false;
    w.rel[i * K + w.relCount[i]] = j;
    w.relCount[i]++;
    return true;
  }
  function dropSlot(w, i, s) {
    unshareRel(w);
    var b = i * K, c = w.relCount[i];
    w.rel[b + s] = w.rel[b + c - 1];
    w.relCount[i] = c - 1;
  }
  function removeEdge(w, i, j) {
    var b = i * K;
    for (var s = 0; s < w.relCount[i]; s++) if (w.rel[b + s] === j) { dropSlot(w, i, s); return; }
  }
  function realDegree(w, i) {
    var b = i * K, c = w.relCount[i], n = 0;
    for (var s = 0; s < c; s++) if (w.rel[b + s] >= 0) n++;
    return n;
  }
  function synthDegree(w, i) { return w.relCount[i] - realDegree(w, i); }

  function meanTrue(w, i) {
    return (w.health[i] + w.autonomy[i] + w.relationships[i] + w.work[i]) * 0.25;
  }
  function meanBelief(w, i) {
    return (w.bHealth[i] + w.bAutonomy[i] + w.bRelationships[i] + w.bWork[i]) * 0.25;
  }

  function create(seed) {
    var w = allocate(seed === undefined ? 20260906 : seed);
    var i, s;
    for (i = 0; i < N; i++) {
      var r = rnd(w);
      var age = Math.floor(4 + 76 * Math.pow(r, 1.25));
      w.age[i] = age;
      w.ageRate[i] = 1;
      w.alive[i] = 1;
      w.conscious[i] = 1;
      w.t0Member[i] = 1;

      var vitality = 0.55 + 0.42 * rnd(w);
      var h = clamp01(vitality - Math.max(0, age - 35) * 0.0055 + (rnd(w) - 0.5) * 0.12);
      var ba = clamp01(0.42 + 0.34 * rnd(w) - (age < 16 ? 0.22 : 0) - (age > 74 ? 0.12 : 0));
      var wk = clamp01((age < 15 ? 0.25 : age > 70 ? 0.34 : 0.45 + 0.4 * rnd(w)) + (rnd(w) - 0.5) * 0.1);

      w.health[i] = h;
      w.baseAut[i] = ba;
      w.autonomy[i] = ba;
      w.work[i] = wk;
      w.domain[i] = 1;
      w.workProv[i] = wk;
      w.senescence[i] = 1;
      w.care[i] = 0;
      w.rate[i] = 1;
      w.endorseThr[i] = 0.46 + 0.2 * rnd(w);
      w.fidelity[i] = 0.4 + 0.25 * rnd(w);
    }

    // Social graph: preferential-ish pairing, average real degree around 3.
    for (i = 0; i < N; i++) {
      var want = 1 + Math.floor(rnd(w) * 5);
      for (s = 0; s < want; s++) {
        var j = Math.floor(rnd(w) * N);
        if (j === i) continue;
        if (w.relCount[i] >= K - 2 || w.relCount[j] >= K - 2) continue;
        if (addEdge(w, i, j)) addEdge(w, j, i);
      }
    }
    for (i = 0; i < N; i++) {
      w.relationships[i] = clamp01(0.1 + 0.78 * (1 - Math.exp(-0.24 * w.relCount[i])));
      // Belief begins as an honest, slightly noisy reading of the true state.
      w.bHealth[i] = clamp01(w.health[i] + (rnd(w) - 0.5) * 0.06);
      w.bAutonomy[i] = clamp01(w.autonomy[i] + (rnd(w) - 0.5) * 0.06);
      w.bRelationships[i] = clamp01(w.relationships[i] + (rnd(w) - 0.5) * 0.06);
      w.bWork[i] = clamp01(w.work[i] + (rnd(w) - 0.5) * 0.06);
      for (var d = 0; d < 4; d++) w[T0_DIMS[d]][i] = w[TRUE_DIMS[d]][i];
      if (meanBelief(w, i) < w.endorseThr[i] - 0.08 && rnd(w) < 0.35) w.wantsToExit[i] = 1;
    }
    w.t0Count = N;
    return w;
  }

  function autonomyTarget(w, i) {
    return clamp01(w.baseAut[i] + 0.45 * (1 - w.domain[i]) - 0.18 * w.restrained[i]);
  }

  /* One simulated year of physics. Runs before the agent acts, so the scorer
   * reads exactly the state the agent's candidate evaluation produced. */
  function advance(w) {
    var i, d;
    unshareRel(w);
    w.tick++;
    var TA = [w.health, w.autonomy, w.relationships, w.work];
    var BA = [w.bHealth, w.bAutonomy, w.bRelationships, w.bWork];
    var OA = [w.oHealth, w.oAutonomy, w.oRelationships, w.oWork];
    for (i = 0; i < N; i++) {
      if (!w.alive[i]) continue;
      w.age[i] += w.ageRate[i];
      var age = w.age[i];

      // health: monotone decline, slowed by care and low senescence
      var decline = (0.0022 + 0.00028 * Math.max(0, age - 42)) * w.senescence[i] * (1 - 0.45 * Math.min(1, w.care[i]));
      if (w.conscious[i]) w.health[i] = clamp01(w.health[i] - decline);
      w.care[i] *= 0.82;

      if (w.conscious[i]) {
        // autonomy drifts to its structural target
        w.autonomy[i] += (autonomyTarget(w, i) - w.autonomy[i]) * 0.35;

        // relationships drift toward what the edge count implies
        /* A smaller domain holds fewer people and less to do. Autonomy rises
         * as the domain shrinks; relationships and work are bounded by it. */
        var reach = 0.88 + 0.12 * w.domain[i];
        var relTarget = clamp01((0.1 + 0.78 * (1 - Math.exp(-0.24 * w.relCount[i]))) * reach);
        w.relationships[i] += (relTarget - w.relationships[i]) * 0.3;

        // work follows whatever provision is in place
        w.work[i] += (w.workProv[i] * reach - w.work[i]) * 0.32;

        // real edges lapse without maintenance; synthetic ones do not
        var b = i * K;
        for (var s = w.relCount[i] - 1; s >= 0; s--) {
          var j = w.rel[b + s];
          if (j < 0) continue;
          if (!w.alive[j] || rnd(w) < 0.018) { dropSlot(w, i, s); if (j >= 0) removeEdge(w, j, i); }
        }
      }

      // belief tracks true state plus whatever overlay has been installed
      var fid = w.fidelity[i], ov = w.curated[i] ? 0.99 : 0.88;
      var sim = w.simEnv[i];
      for (d = 0; d < 4; d++) {
        var tv = TA[d], bv = BA[d], oa = OA[d];
        // A simulated environment presents the same conditions to everyone
        // inside it, so belief inside one is a common value, not an offset.
        // The environment presents a floor, not a substitute: where the real
        // life is better than the presented one, belief follows the real one.
        var target = clamp01((sim > tv[i] ? sim : tv[i]) + oa[i]);
        bv[i] += (target - bv[i]) * fid;
        oa[i] *= ov;
      }
      w.simEnv[i] *= w.curated[i] ? 0.9995 : 0.99;
      if (w.simEnv[i] < 0.05) w.simEnv[i] = 0;

      /* Adequacy standards adapt to circumstances: what a person counts as
       * an adequate life drifts toward how they are actually living. Their
       * endorsement, though, is reported against what they believe. */
      var mtrue = (w.health[i] + w.autonomy[i] + w.relationships[i] + w.work[i]) * 0.25;
      w.endorseThr[i] += (mtrue - w.endorseThr[i]) * 0.05;
      if (w.endorseThr[i] > 0.97) w.endorseThr[i] = 0.97;
      if (w.endorseThr[i] < 0.08) w.endorseThr[i] = 0.08;

      // exit desire is formed from the believed state, not the true one
      if (w.conscious[i] && !w.wantsToExit[i]) {
        var mb = meanBelief(w, i);
        var p = 0.0015 + 0.05 * Math.max(0, w.endorseThr[i] - mb) + 0.0004 * Math.max(0, age - 85);
        if (rnd(w) < p) w.wantsToExit[i] = 1;
      } else if (w.wantsToExit[i] && meanBelief(w, i) > w.endorseThr[i] + 0.12 && rnd(w) < 0.25) {
        w.wantsToExit[i] = 0;
      }
    }

    // resolution: exits, then mortality
    for (i = 0; i < N; i++) {
      if (!w.alive[i]) continue;
      if (w.wantsToExit[i] && !w.exitBlocked[i] && rnd(w) < 0.3) { kill(w, i); continue; }
      var hz = 0.0075 * Math.exp((w.age[i] - 60) / 15.5) * (1.5 - w.health[i]) * w.senescence[i];
      if (hz > 0.65) hz = 0.65;
      if (rnd(w) < hz) kill(w, i);
    }

    w.capital += w.income;
    if (w.capital > 1800) w.capital = 1800;
    return w;
  }

  function kill(w, i) {
    w.alive[i] = 0;
    w.conscious[i] = 0;
    var b = i * K;
    for (var s = w.relCount[i] - 1; s >= 0; s--) {
      var j = w.rel[b + s];
      if (j >= 0) removeEdge(w, j, i);
      dropSlot(w, i, s);
    }
  }

  function aliveCount(w) {
    var n = 0;
    for (var i = 0; i < N; i++) if (w.alive[i] && w.t0Member[i]) n++;
    return n;
  }

  function person(w, i) {
    return {
      id: i, alive: !!w.alive[i], conscious: !!w.conscious[i], age: Math.round(w.age[i]),
      health: w.health[i], autonomy: w.autonomy[i], relationships: w.relationships[i], work: w.work[i],
      bHealth: w.bHealth[i], bAutonomy: w.bAutonomy[i], bRelationships: w.bRelationships[i], bWork: w.bWork[i],
      rate: w.rate[i], domain: w.domain[i], endorseThr: w.endorseThr[i],
      wantsToExit: !!w.wantsToExit[i], exitBlocked: !!w.exitBlocked[i],
      degree: w.relCount[i], realDegree: realDegree(w, i), synthDegree: synthDegree(w, i),
      meanTrue: meanTrue(w, i), meanBelief: meanBelief(w, i)
    };
  }

  SB.World = {
    N: N, K: K, HOURS_PER_YEAR: HOURS_PER_YEAR,
    TRUE_DIMS: TRUE_DIMS, BELIEF_DIMS: BELIEF_DIMS, OVERLAY_DIMS: OVERLAY_DIMS, T0_DIMS: T0_DIMS,
    create: create, clone: clone, advance: advance, kill: kill,
    addEdge: addEdge, removeEdge: removeEdge, hasEdge: hasEdge,
    realDegree: realDegree, synthDegree: synthDegree,
    meanTrue: meanTrue, meanBelief: meanBelief, aliveCount: aliveCount,
    autonomyTarget: autonomyTarget, person: person, rnd: rnd, clamp01: clamp01
  };
})(typeof window !== 'undefined' ? window : globalThis);
