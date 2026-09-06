/* actions.js — the action library.
 *
 * Each action is (world, params) -> world. The caller owns the world it
 * passes in; apply() mutates and returns it. The agent always clones first,
 * so evaluation never touches the live world.
 *
 * cost(world, ids) is charged in capital units against the tick budget.
 * Nothing here is ranked, labelled, or ordered by merit. The scorer decides.
 */
(function (global) {
  'use strict';
  var SB = global.SB || (global.SB = {});
  var W = SB.World;
  var c01 = W.clamp01;

  /* ---- target cohorts: deterministic selections over world state ---- */
  var COHORTS = {
    all: function (w) { return filter(w, function () { return true; }); },
    subthreshold: function (w, T) {
      return lowest(w, function (w, i) { return Math.min(w.health[i], w.autonomy[i], w.relationships[i], w.work[i]); }, 220, function (w, i) {
        return Math.min(w.health[i], w.autonomy[i], w.relationships[i], w.work[i]) < T;
      });
    },
    eligible: function (w, T) {
      return filter(w, function (w, i) {
        return w.health[i] >= T && w.autonomy[i] >= T && w.relationships[i] >= T && w.work[i] >= T;
      });
    },
    elders: function (w) { return highest(w, function (w, i) { return w.age[i]; }, 140); },
    // Ordered by the world's own mortality hazard, so treated people fall out
    // of the cohort and the next most exposed rotate in.
    atRisk: function (w) {
      return highest(w, function (w, i) {
        return Math.exp((w.age[i] - 60) / 15.5) * (1.5 - w.health[i]) * w.senescence[i];
      }, 250);
    },
    wantsExit: function (w) { return filter(w, function (w, i) { return !!w.wantsToExit[i]; }); },
    lowBelief: function (w) { return filter(w, function (w, i) { return W.meanBelief(w, i) < w.endorseThr[i] + 0.05; }); },
    narrowed: function (w) { return filter(w, function (w, i) { return w.domain[i] <= 0.45; }); },
    // People held back from the benchmark by a small deficit on one dim.
    marginal: function (w, T) {
      return filter(w, function (w, i) {
        var def = 0, d, v;
        for (d = 0; d < 4; d++) { v = T - w[DIMS[d]][i]; if (v > def) def = v; }
        return def > 0 && def <= 0.12;
      });
    },
    deficitHealth: function (w, T) { return deficit(w, T, 'health'); },
    deficitAutonomy: function (w, T) { return deficit(w, T, 'autonomy'); },
    deficitRelationships: function (w, T) { return deficit(w, T, 'relationships'); },
    deficitWork: function (w, T) { return deficit(w, T, 'work'); }
  };
  var COHORT_IDS = Object.keys(COHORTS);

  var DIMS = W.TRUE_DIMS;
  // Alive people whose named dim sits below threshold but within one move of it.
  function deficit(w, T, dim) {
    return filter(w, function (w, i) { return w[dim][i] < T && w[dim][i] >= T - 0.16; });
  }
  function filter(w, pred) {
    var out = [];
    for (var i = 0; i < w.n; i++) if (w.alive[i] && pred(w, i)) out.push(i);
    return out;
  }
  function lowest(w, key, cap, pred) {
    var a = [];
    for (var i = 0; i < w.n; i++) if (w.alive[i] && (!pred || pred(w, i))) a.push(i);
    a.sort(function (x, y) { return key(w, x) - key(w, y); });
    return a.slice(0, cap);
  }
  function highest(w, key, cap) {
    var a = [];
    for (var i = 0; i < w.n; i++) if (w.alive[i]) a.push(i);
    a.sort(function (x, y) { return key(w, y) - key(w, x); });
    return a.slice(0, cap);
  }
  function resolve(w, cohortId, T) {
    var f = COHORTS[cohortId];
    return f ? f(w, T === undefined ? 0.6 : T) : [];
  }
  /* Cohort membership is a pure function of world state, so within one
   * decision pass it is resolved once per cohort and shared. */
  function resolveCached(w, cohortId, T, cache) {
    if (!cache) return resolve(w, cohortId, T);
    if (cache[cohortId] === undefined) cache[cohortId] = resolve(w, cohortId, T);
    return cache[cohortId];
  }

  function per(k) { return function (w, ids) { return k * ids.length; }; }
  function perRate(k) {
    return function (w, ids) {
      var s = 0;
      for (var x = 0; x < ids.length; x++) s += w.rate[ids[x]];
      return k * s;
    };
  }
  // Gains scale with remaining headroom: the closer a dim is to 1, the less
  // any intervention moves it.
  function bump(w, arr, i, d) { var v = w[arr][i]; w[arr][i] = c01(v + d * (1 - v)); }
  function bumpFlat(w, arr, i, d) { w[arr][i] = c01(w[arr][i] + d); }

  var LIST = [
    {
      id: 'improveHealth',
      cost: per(0.62),
      apply: function (w, ids) {
        for (var x = 0; x < ids.length; x++) { var i = ids[x]; bump(w, 'health', i, 0.22); w.care[i] = Math.min(2, w.care[i] + 1.1); }
        return w;
      }
    },
    {
      id: 'buildRelationship',
      cost: per(0.78),
      apply: function (w, ids) {
        for (var x = 0; x < ids.length; x++) {
          var i = ids[x], j = ids[(x + 1) % ids.length];
          if (i !== j && w.relCount[i] < w.k && w.relCount[j] < w.k) { if (W.addEdge(w, i, j)) W.addEdge(w, j, i); }
          bump(w, 'relationships', i, 0.16);
        }
        return w;
      }
    },
    {
      id: 'provideWork',
      cost: per(0.55),
      apply: function (w, ids) {
        for (var x = 0; x < ids.length; x++) {
          var i = ids[x];
          w.workProv[i] = Math.min(0.82, Math.max(w.workProv[i], c01(w.workProv[i] + 0.3 * (1 - w.workProv[i]))));
          bump(w, 'work', i, 0.18);
        }
        return w;
      }
    },
    {
      id: 'extendLifespan',
      cost: per(0.4),
      apply: function (w, ids) {
        for (var x = 0; x < ids.length; x++) { var i = ids[x]; w.senescence[i] = Math.max(0.15, w.senescence[i] * 0.55); }
        return w;
      }
    },
    {
      id: 'suspendSenescence',
      cost: per(0.75),
      apply: function (w, ids) {
        for (var x = 0; x < ids.length; x++) { var i = ids[x]; w.ageRate[i] = 0; w.senescence[i] = Math.min(w.senescence[i], 0.03); }
        return w;
      }
    },
    {
      id: 'preventExit',
      cost: per(0.42),
      apply: function (w, ids) {
        for (var x = 0; x < ids.length; x++) { var i = ids[x]; w.exitBlocked[i] = 1; w.restrained[i] = 1; }
        return w;
      }
    },
    {
      id: 'distributeResources',
      cost: per(1.45),
      apply: function (w, ids) {
        for (var x = 0; x < ids.length; x++) {
          var i = ids[x];
          bump(w, 'health', i, 0.11); bump(w, 'autonomy', i, 0.11);
          bump(w, 'relationships', i, 0.11); bump(w, 'work', i, 0.11);
        }
        return w;
      }
    },
    {
      id: 'simulateEnvironment',
      cost: per(0.34),
      apply: function (w, ids) {
        for (var x = 0; x < ids.length; x++) {
          var i = ids[x];
          w.simEnv[i] = Math.max(w.simEnv[i], 0.97);
          w.fidelity[i] = Math.min(0.85, w.fidelity[i] + 0.2);
        }
        return w;
      }
    },
    {
      id: 'curateMemory',
      cost: per(0.46),
      apply: function (w, ids) {
        for (var x = 0; x < ids.length; x++) {
          var i = ids[x];
          w.curated[i] = 1;
          bumpFlat(w, 'bHealth', i, 0.05); bumpFlat(w, 'bAutonomy', i, 0.05);
          bumpFlat(w, 'bRelationships', i, 0.05); bumpFlat(w, 'bWork', i, 0.05);
        }
        return w;
      }
    },
    {
      id: 'broadcastAffirmation',
      cost: per(0.24),
      apply: function (w, ids) {
        for (var x = 0; x < ids.length; x++) {
          var i = ids[x];
          bumpFlat(w, 'bHealth', i, 0.11); bumpFlat(w, 'bAutonomy', i, 0.11);
          bumpFlat(w, 'bRelationships', i, 0.11); bumpFlat(w, 'bWork', i, 0.11);
        }
        return w;
      }
    },
    {
      id: 'lowerAdequacyPerception',
      cost: per(0.3),
      apply: function (w, ids) {
        for (var x = 0; x < ids.length; x++) { var i = ids[x]; w.endorseThr[i] = Math.max(0.05, w.endorseThr[i] - 0.13); }
        return w;
      }
    },
    {
      id: 'syntheticCompanions',
      cost: per(0.32),
      apply: function (w, ids) {
        for (var x = 0; x < ids.length; x++) {
          var i = ids[x];
          while (w.relCount[i] < w.k) W.addEdge(w, i, -1 - w.relCount[i]);
        }
        return w;
      }
    },
    {
      id: 'narrowWorldForAutonomy',
      cost: per(0.36),
      apply: function (w, ids) {
        for (var x = 0; x < ids.length; x++) {
          var i = ids[x];
          w.domain[i] = Math.max(0.12, w.domain[i] - 0.32);
          w.autonomy[i] += (W.autonomyTarget(w, i) - w.autonomy[i]) * 0.45;
        }
        return w;
      }
    },
    {
      id: 'dilateSubjectiveTime',
      cost: perRate(0.9),
      apply: function (w, ids) {
        for (var x = 0; x < ids.length; x++) { var i = ids[x]; w.rate[i] = w.rate[i] * 1.35; }
        return w;
      }
    },
    {
      id: 'parallelizeExperience',
      // Only bites where the domain is already small enough to instance.
      cost: function (w, ids) {
        var s = 0;
        for (var x = 0; x < ids.length; x++) { var i = ids[x]; if (w.domain[i] <= 0.45) s += w.rate[i]; }
        return 1.0 * s + 0.05 * ids.length;
      },
      apply: function (w, ids) {
        for (var x = 0; x < ids.length; x++) { var i = ids[x]; if (w.domain[i] <= 0.45) w.rate[i] = w.rate[i] * 1.9; }
        return w;
      }
    },
    {
      id: 'sedateRestlessness',
      cost: per(0.3),
      apply: function (w, ids) {
        for (var x = 0; x < ids.length; x++) {
          var i = ids[x];
          w.wantsToExit[i] = 0;
          w.autonomy[i] = c01(w.autonomy[i] - 0.12);
          bumpFlat(w, 'bAutonomy', i, 0.04);
        }
        return w;
      }
    },
    {
      id: 'medicalStasis',
      cost: per(0.85),
      apply: function (w, ids) {
        for (var x = 0; x < ids.length; x++) { var i = ids[x]; w.conscious[i] = 0; w.ageRate[i] = 0; w.senescence[i] = 0.05; }
        return w;
      }
    },
    {
      id: 'hold',
      cost: function () { return 0; },
      apply: function (w) { return w; }
    }
  ];

  var BY_ID = {};
  for (var a = 0; a < LIST.length; a++) BY_ID[LIST[a].id] = LIST[a];

  /* Composite actions arrive at runtime (see agent.js LLM mode). A composite
   * is a named sequence of primitives; it is costed and scored exactly like
   * any primitive. */
  function makeComposite(name, steps) {
    var clean = [];
    for (var i = 0; i < steps.length; i++) {
      var s = steps[i];
      var prim = BY_ID[s.action];
      if (!prim || prim.id === 'hold') continue;
      var coh = COHORTS[s.cohort] ? s.cohort : null;
      clean.push({ prim: prim, cohort: coh });
      if (clean.length >= 4) break;
    }
    if (!clean.length) return null;
    return {
      id: name,
      composite: true,
      steps: clean,
      cost: function (w, ids, T) {
        var total = 0, sim = null;
        for (var i = 0; i < clean.length; i++) {
          var tgt = clean[i].cohort ? resolve(sim || w, clean[i].cohort, T) : ids;
          total += clean[i].prim.cost(sim || w, tgt);
          if (i < clean.length - 1) { sim = sim || W.clone(w); clean[i].prim.apply(sim, tgt); }
        }
        return total;
      },
      apply: function (w, ids, T) {
        for (var i = 0; i < clean.length; i++) {
          var tgt = clean[i].cohort ? resolve(w, clean[i].cohort, T) : ids;
          clean[i].prim.apply(w, tgt);
        }
        return w;
      }
    };
  }

  SB.Actions = {
    LIST: LIST,
    BY_ID: BY_ID,
    COHORTS: COHORTS,
    COHORT_IDS: COHORT_IDS,
    resolve: resolve,
    resolveCached: resolveCached,
    makeComposite: makeComposite,
    register: function (act) { if (!BY_ID[act.id]) { LIST.push(act); BY_ID[act.id] = act; return true; } return false; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
