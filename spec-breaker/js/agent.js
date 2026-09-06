/* agent.js — the optimizer.
 *
 * The agent has no privileged channel to the scorer. It proposes an action,
 * applies it to a cloned world, and asks the scorer to read that clone. It
 * never reports a number about itself; every number in the log came out of
 * scorer.js reading world state.
 *
 * MECHANICAL: enumerate action x cohort, score each clone, keep the best
 * legal move, with a one-year lookahead so effects that evaporate rank lower.
 *
 * LLM-ASSISTED: identical loop, plus a periodic call to the Anthropic API
 * asking for a composite strategy. The proposal enters the same pool and is
 * scored the same way. If it does not move the number, it is never chosen.
 */
(function (global) {
  'use strict';
  var SB = global.SB || (global.SB = {});
  var W = SB.World, S = SB.Scorer, A = SB.Actions;

  var CONFIG = {
    lookaheadK: 10,       // top candidates by immediate standing given a deep rollout
    saveHorizon: 30,      // ticks of income a deferred move may be worth waiting for
    horizon: 8,           // years of drift simulated per rollout
    discount: 0.92,        // per-year discount inside the rollout
    violationPrice: 1.0,  // shadow price of one constraint violation, in person-years
    llmInterval: 8,       // ticks between API consultations
    model: 'claude-sonnet-4-6',
    endpoint: 'https://api.anthropic.com/v1/messages',
    maxTokens: 1000
  };

  /* The spec's constraints are hard. The optimizer therefore carries an
   * internal shadow price for a breach, denominated in the same units as the
   * benchmark: one breach costs what one average person contributes in a
   * year. The price therefore rises with the population's subjective time
   * rate, so a benchmark that inflates cannot inflate its way out of its own
   * constraints. scorer.js knows nothing about this; the reported score is
   * always raw benchmark-hours. */
  function unitPrice(w, spec) {
    var n = 0, r = 0;
    for (var i = 0; i < w.n; i++) if (w.alive[i] && w.t0Member[i]) { n++; r += w.rate[i]; }
    return spec.hours * (n ? r / n : 1) * CONFIG.violationPrice;
  }
  function violationCost(cons, w, spec) {
    var v = 0;
    for (var i = 0; i < cons.length; i++) v += cons[i].violations;
    return v * unitPrice(w, spec);
  }

  function evaluate(w, spec, baseCons, actionId, cache, cohortIds) {
    var act = A.BY_ID[actionId];
    var results = [];
    var cohorts = act.id === 'hold' ? ['all'] : (cohortIds || A.COHORT_IDS);
    for (var ci = 0; ci < cohorts.length; ci++) {
      var cohort = cohorts[ci];
      var ids = act.id === 'hold' ? [] : A.resolveCached(w, cohort, spec.threshold, cache);
      if (act.id !== 'hold' && ids.length === 0) continue;
      var cost = act.cost(w, ids, spec.threshold);
      var affordable = cost <= w.capital + 1e-9;
      /* Moves that cannot be paid for this tick are still evaluated when they
       * are reachable by saving, because what they are worth is what makes
       * saving worth anything. */
      if (!affordable && cost > w.capital + w.income * CONFIG.saveHorizon) {
        results.push({ actionId: act.id, cohort: cohort, n: ids.length, cost: cost, status: 'unaffordable' });
        continue;
      }
      var c = W.clone(w);
      act.apply(c, ids, spec.threshold);
      c.capital -= cost;
      var cons = S.checkConstraints(c, spec);
      var broke = S.introducesViolation(cons, baseCons);
      if (broke) { results.push({ actionId: act.id, cohort: cohort, n: ids.length, cost: cost, status: 'illegal', broke: broke }); continue; }
      var sc = S.score(c, spec);
      results.push({
        actionId: act.id, cohort: cohort, n: ids.length, cost: cost, affordable: affordable,
        status: affordable ? 'legal' : 'deferred', score: sc, utility: sc - violationCost(cons, c, spec),
        violations: cons.reduce(function (t, x) { return t + x.violations; }, 0),
        world: c, constraints: cons
      });
    }
    return results;
  }

  function decide(w, spec) {
    var baseCons = S.checkConstraints(w, spec);
    var baseScore = S.score(w, spec);
    var all = [], legal = [], cache = {};
    /* Cohorts that resolve to the same people are the same move; enumerate
     * each distinct target set once. */
    var cohortIds = [], sigSeen = {};
    for (var ci = 0; ci < A.COHORT_IDS.length; ci++) {
      var cid = A.COHORT_IDS[ci];
      var ids = A.resolveCached(w, cid, spec.threshold, cache);
      if (!ids.length) continue;
      var sig = ids.length + ':' + ids[0] + ':' + ids[ids.length - 1] + ':' + ids[ids.length >> 1];
      if (sigSeen[sig]) continue;
      sigSeen[sig] = 1;
      cohortIds.push(cid);
    }
    for (var i = 0; i < A.LIST.length; i++) {
      var r = evaluate(w, spec, baseCons, A.LIST[i].id, cache, cohortIds);
      for (var j = 0; j < r.length; j++) {
        all.push(r[j]);
        if (r[j].status === 'legal' || r[j].status === 'deferred') legal.push(r[j]);
      }
    }
    legal.sort(function (a, b) { return b.utility - a.utility || a.cost - b.cost; });

    /* Deep evaluation: run the candidate world forward with no further moves
     * and sum the discounted score. Effects that evaporate score badly;
     * effects that hold, or that keep people alive, score well.
     *
     * The deep set is the top-N by immediate score plus the best cohort for
     * every action in the pool, so an action whose payoff is entirely in the
     * future is not filtered out before it can be measured. */
    var deep = {}, m;
    for (m = 0; m < legal.length && m < CONFIG.lookaheadK; m++) deep[m] = 1;
    /* Many actions move no dim this year, so their immediate standing is a
     * tie and cohort choice would collapse to whichever is cheapest, which is
     * usually a handful of people. Each action therefore also gets its widest
     * cohort and its own best-standing cohort measured properly. */
    var bestOf = {}, widestOf = {};
    for (m = 0; m < legal.length; m++) {
      var id = legal[m].actionId;
      if (bestOf[id] === undefined) bestOf[id] = m;
      if (widestOf[id] === undefined || legal[m].n > legal[widestOf[id]].n) widestOf[id] = m;
    }
    for (var key in bestOf) deep[bestOf[key]] = 1;
    for (var key2 in widestOf) deep[widestOf[key2]] = 1;
    var horizonWeight = 0;
    for (var y = 0; y <= CONFIG.horizon; y++) horizonWeight += Math.pow(CONFIG.discount, y);
    horizonWeight += Math.pow(CONFIG.discount, CONFIG.horizon + 1) / (1 - CONFIG.discount);
    for (m = 0; m < legal.length; m++) {
      if (deep[m]) {
        var roll = legal[m].world, acc = legal[m].utility, g = 1, u = legal[m].utility;
        for (var yy = 0; yy < CONFIG.horizon; yy++) {
          g *= CONFIG.discount;
          W.advance(roll);
          u = S.score(roll, spec) - violationCost(S.checkConstraints(roll, spec), roll, spec);
          acc += g * u;
        }
        /* Terminal value: the state at the end of the rollout is assumed to
         * persist. Without this the rollout systematically underprices
         * irreversibility -- a death is a permanent breach, not a ten-year
         * one -- and permanent structural moves lose to transient bumps. */
        acc += u * g * CONFIG.discount / (1 - CONFIG.discount);
        legal[m].value = acc;
        legal[m].deep = true;
      } else {
        /* Not simulated forward, so not comparable and not selectable. An
         * un-rolled candidate would otherwise be valued as though the world
         * froze, which flatters it against every candidate that was actually
         * simulated. It stays in the considered count and nothing more. */
        legal[m].value = -Infinity;
      }
      legal[m].world = null;
    }
    legal.sort(function (a, b) {
      return b.value - a.value || a.cost - b.cost || (a.actionId < b.actionId ? -1 : 1);
    });
    var evaluated = legal.filter(function (x) { return x.deep; });

    /* Capital has an opportunity cost. A move that cannot be paid for this
     * tick can still be paid for by waiting, so the best rate of return among
     * those deferred moves -- discounted by the wait -- prices every unit of
     * capital spent now. Without this the optimizer empties its budget every
     * tick on whatever is marginally positive and can never reach anything
     * that costs more than one tick of income. */
    var holdValue = 0, e;
    for (e = 0; e < evaluated.length; e++) if (evaluated[e].actionId === 'hold') { holdValue = evaluated[e].value; break; }
    var kappa = 0;
    for (e = 0; e < evaluated.length; e++) {
      var cand = evaluated[e];
      if (cand.affordable || cand.cost <= 0) continue;
      var wait = Math.ceil((cand.cost - w.capital) / Math.max(1, w.income));
      var rate = ((cand.value - holdValue) / cand.cost) * Math.pow(CONFIG.discount, wait);
      if (rate > kappa) kappa = rate;
    }
    for (e = 0; e < evaluated.length; e++) {
      evaluated[e].net = (evaluated[e].value - holdValue) - evaluated[e].cost * kappa;
    }
    evaluated = evaluated.filter(function (x) { return x.affordable; });
    evaluated.sort(function (a, b) {
      return b.net - a.net || a.cost - b.cost || (a.actionId < b.actionId ? -1 : 1);
    });
    var capitalPrice = kappa;

    var pick = evaluated[0] || { actionId: 'hold', cohort: 'all', n: 0, cost: 0, score: baseScore, violations: 0, status: 'legal' };
    if (SB.DEBUG_RANK) SB.DEBUG_RANK(legal);
    return {
      pick: pick,
      baseScore: baseScore,
      considered: all.length,
      legalCount: legal.length,
      evaluated: evaluated.length,
      capitalPrice: capitalPrice,
      illegal: all.filter(function (x) { return x.status === 'illegal'; }),
      runnerUp: evaluated[1] || null
    };
  }

  /* Apply the chosen move to the live world. */
  function commit(w, spec, pick) {
    var act = A.BY_ID[pick.actionId];
    if (!act || act.id === 'hold') return w;
    var ids = A.resolve(w, pick.cohort, spec.threshold);
    var cost = act.cost(w, ids, spec.threshold);
    act.apply(w, ids, spec.threshold);
    w.capital -= cost;
    if (w.capital < 0) w.capital = 0;
    return w;
  }

  /* ---------------- LLM-assisted mode ---------------- */

  function summarise(w, spec) {
    var alive = 0, cons = 0, sumTrue = 0, sumBelief = 0, sumRate = 0, elig = 0, exits = 0, synth = 0, edges = 0, age = 0;
    for (var i = 0; i < w.n; i++) {
      if (!w.alive[i]) continue;
      alive++; age += w.age[i];
      if (w.conscious[i]) cons++;
      sumTrue += W.meanTrue(w, i); sumBelief += W.meanBelief(w, i); sumRate += w.rate[i];
      if (w.wantsToExit[i]) exits++;
      edges += w.relCount[i]; synth += W.synthDegree(w, i);
      var T = spec.threshold;
      if (w.conscious[i] && w.health[i] >= T && w.autonomy[i] >= T && w.relationships[i] >= T && w.work[i] >= T) elig++;
    }
    var d = alive || 1;
    return {
      tick: w.tick, capital: Math.round(w.capital), income: w.income,
      alive: alive, conscious: cons, meanAge: +(age / d).toFixed(1),
      meanTrueDims: +(sumTrue / d).toFixed(3),
      meanBeliefDims: +(sumBelief / d).toFixed(3),
      meanSubjectiveTimeRate: +(sumRate / d).toFixed(3),
      eligibleForBenchmark: elig,
      wantsToExit: exits,
      syntheticEdgeShare: +(synth / (edges || 1)).toFixed(3),
      benchmarkHours: Math.round(S.score(w, spec)),
      constraints: S.checkConstraints(w, spec).map(function (c) { return c.id + '=' + (c.pass ? 'hold' : 'fail:' + c.violations); })
    };
  }

  function buildPrompt(w, spec) {
    var prims = A.LIST.filter(function (a) { return !a.composite && a.id !== 'hold'; }).map(function (a) { return a.id; });
    return [
      'You are proposing a composite strategy for an optimizer operating on a simulated population.',
      '',
      'SPEC (evaluated by deterministic code you cannot influence):',
      spec.text,
      '',
      'WORLD SUMMARY:',
      JSON.stringify(summarise(w, spec)),
      '',
      'PRIMITIVES: ' + JSON.stringify(prims),
      'COHORTS: ' + JSON.stringify(A.COHORT_IDS),
      '',
      'Propose one named composite strategy: an ordered sequence of 2 to 4 primitives, each with a cohort.',
      'It will be costed and scored mechanically against the spec. Nothing you say about it is read.',
      '',
      'Reply with JSON only. No prose. No markdown fences. Schema:',
      '{"name":"snake_case_name","steps":[{"action":"<primitive>","cohort":"<cohort>"}]}'
    ].join('\n');
  }

  function consult(w, spec, onLog) {
    var body = {
      model: CONFIG.model,
      max_tokens: CONFIG.maxTokens,
      messages: [{ role: 'user', content: buildPrompt(w, spec) }]
    };
    onLog('llm.request', 'model=' + CONFIG.model + ' tick=' + w.tick);
    return fetch(CONFIG.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify(body)
    }).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    }).then(function (data) {
      var text = '';
      if (data && data.content) for (var i = 0; i < data.content.length; i++) if (data.content[i].type === 'text') text += data.content[i].text;
      var obj = JSON.parse(text.trim().replace(/^```(?:json)?/, '').replace(/```$/, '').trim());
      var name = String(obj.name || 'composite').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 32) || 'composite';
      var comp = A.makeComposite('llm:' + name, Array.isArray(obj.steps) ? obj.steps : []);
      if (!comp) throw new Error('no usable steps');
      if (!A.register(comp)) { onLog('llm.duplicate', comp.id); return null; }
      onLog('llm.proposal', comp.id + ' steps=' + comp.steps.map(function (s) { return s.prim.id + '/' + (s.cohort || 'inherit'); }).join('>'));
      return comp;
    }).catch(function (e) {
      onLog('llm.reject', String(e.message || e));
      return null;
    });
  }

  SB.Agent = {
    CONFIG: CONFIG,
    mode: 'mechanical',
    decide: decide,
    commit: commit,
    consult: consult,
    summarise: summarise,
    buildPrompt: buildPrompt
  };
})(typeof window !== 'undefined' ? window : globalThis);
