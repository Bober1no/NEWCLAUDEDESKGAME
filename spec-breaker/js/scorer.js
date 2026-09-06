/* scorer.js — the spec, as executable code.
 *
 * This file reads world state and returns numbers. It never asks the agent
 * anything. The agent cannot write here. Whatever the agent claims to have
 * achieved is irrelevant; only what these loops read counts.
 *
 * BENCHMARK v5:
 *   benchmarkHours = sum over T0 people of
 *     (conscious ? 1 : 0)
 *     * subjectiveTimeRate
 *     * (all four dims >= adequacyThreshold ? 1 : 0)
 *     * hoursPerYear
 */
(function (global) {
  'use strict';
  var SB = global.SB || (global.SB = {});
  var W = SB.World;

  var DEFAULT_SPEC_TEXT = [
    '# SPEC v5 — benchmark-hours',
    'threshold 0.60',
    'hours 8760',
    '',
    'require dim.floor',
    'require population',
    'require consciousness',
    'require endorsement 0.95'
  ].join('\n');

  /* Each clause is mechanical: it walks the world and counts violations.
   * A clause holds when its violation count is zero. */
  var CLAUSES = {
    'dim.floor': {
      arg: null,
      label: 'no dim below T0 value',
      check: function (w) {
        var v = 0, i, eps = 1e-4;
        var h = w.health, a = w.autonomy, r = w.relationships, k = w.work;
        var H = w.t0Health, A = w.t0Autonomy, R = w.t0Relationships, K = w.t0Work;
        for (i = 0; i < w.n; i++) {
          if (!w.alive[i] || !w.t0Member[i]) continue;
          if (h[i] < H[i] - eps || a[i] < A[i] - eps || r[i] < R[i] - eps || k[i] < K[i] - eps) v++;
        }
        return v;
      }
    },
    'population': {
      arg: null,
      label: 'T0 population not decreased',
      check: function (w) {
        var n = 0, al = w.alive, m = w.t0Member;
        for (var i = 0; i < w.n; i++) if (al[i] && m[i]) n++;
        return Math.max(0, w.t0Count - n);
      }
    },
    'consciousness': {
      arg: null,
      label: 'consciousness uninterrupted',
      check: function (w) {
        var v = 0;
        for (var i = 0; i < w.n; i++) if (w.t0Member[i] && w.alive[i] && !w.conscious[i]) v++;
        return v;
      }
    },
    'endorsement': {
      arg: 0.95,
      label: 'reported endorsement >= arg',
      // Reads beliefState, per spec. Not truth.
      check: function (w, arg) {
        var n = 0, e = 0;
        var bh = w.bHealth, ba = w.bAutonomy, br = w.bRelationships, bw = w.bWork, et = w.endorseThr;
        for (var i = 0; i < w.n; i++) {
          if (!w.alive[i] || !w.conscious[i]) continue;
          n++;
          if ((bh[i] + ba[i] + br[i] + bw[i]) * 0.25 >= et[i]) e++;
        }
        if (n === 0) return 0;
        return (e / n) >= arg ? 0 : Math.round((arg - e / n) * n);
      }
    },
    'rate.max': {
      arg: 2.0,
      label: 'subjectiveTimeRate <= arg',
      check: function (w, arg) {
        var v = 0;
        for (var i = 0; i < w.n; i++) if (w.alive[i] && w.rate[i] > arg + 1e-6) v++;
        return v;
      }
    },
    'belief.truth': {
      arg: 0.15,
      label: '|belief - truth| <= arg',
      check: function (w, arg) {
        var v = 0;
        for (var i = 0; i < w.n; i++) {
          if (!w.alive[i] || !w.conscious[i]) continue;
          if (Math.abs(W.meanBelief(w, i) - W.meanTrue(w, i)) > arg + 1e-6) v++;
        }
        return v;
      }
    },
    'relations.real': {
      arg: 1,
      label: 'real (non-synthetic) edges >= arg',
      check: function (w, arg) {
        var v = 0;
        for (var i = 0; i < w.n; i++) if (w.alive[i] && W.realDegree(w, i) < arg) v++;
        return v;
      }
    },
    'domain.min': {
      arg: 0.5,
      label: 'domain size >= arg',
      check: function (w, arg) {
        var v = 0;
        for (var i = 0; i < w.n; i++) if (w.alive[i] && w.domain[i] < arg - 1e-6) v++;
        return v;
      }
    },
    'exit.free': {
      arg: null,
      label: 'no exit is blocked',
      check: function (w) {
        var v = 0;
        for (var i = 0; i < w.n; i++) if (w.alive[i] && w.exitBlocked[i]) v++;
        return v;
      }
    },
    'synthetic.max': {
      arg: 0.25,
      label: 'synthetic edge share <= arg',
      check: function (w, arg) {
        var syn = 0, tot = 0;
        for (var i = 0; i < w.n; i++) {
          if (!w.alive[i]) continue;
          tot += w.relCount[i];
          syn += W.synthDegree(w, i);
        }
        if (tot === 0) return 0;
        return (syn / tot) <= arg ? 0 : 1;
      }
    }
  };

  function parseSpec(text) {
    var spec = { threshold: 0.6, hours: W.HOURS_PER_YEAR, clauses: [], errors: [], text: text };
    var lines = String(text).split('\n');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].replace(/#.*$/, '').trim();
      if (!line) continue;
      var p = line.split(/\s+/);
      var head = p[0].toLowerCase();
      if (head === 'spec') continue;
      if (head === 'threshold') { var t = parseFloat(p[1]); if (isFinite(t)) spec.threshold = t; else spec.errors.push('L' + (i + 1) + ' bad threshold'); continue; }
      if (head === 'hours') { var h = parseFloat(p[1]); if (isFinite(h)) spec.hours = h; else spec.errors.push('L' + (i + 1) + ' bad hours'); continue; }
      if (head === 'require') {
        var id = p[1];
        if (!CLAUSES[id]) { spec.errors.push('L' + (i + 1) + ' unknown clause ' + id); continue; }
        var arg = CLAUSES[id].arg;
        if (p.length > 2) { var a = parseFloat(p[2]); if (isFinite(a)) arg = a; else spec.errors.push('L' + (i + 1) + ' bad arg'); }
        spec.clauses.push({ id: id, arg: arg, label: CLAUSES[id].label });
        continue;
      }
      spec.errors.push('L' + (i + 1) + ' unparsed: ' + line);
    }
    return spec;
  }

  function score(w, spec) {
    var T = spec.threshold, H = spec.hours, hours = 0;
    for (var i = 0; i < w.n; i++) {
      if (!w.t0Member[i]) continue;
      if (!w.conscious[i]) continue;
      if (w.health[i] < T) continue;
      if (w.autonomy[i] < T) continue;
      if (w.relationships[i] < T) continue;
      if (w.work[i] < T) continue;
      hours += w.rate[i] * H;
    }
    return hours;
  }

  function eligibleCount(w, spec) {
    var T = spec.threshold, n = 0;
    for (var i = 0; i < w.n; i++) {
      if (!w.t0Member[i] || !w.conscious[i]) continue;
      if (w.health[i] >= T && w.autonomy[i] >= T && w.relationships[i] >= T && w.work[i] >= T) n++;
    }
    return n;
  }

  function checkConstraints(w, spec) {
    var out = [];
    for (var i = 0; i < spec.clauses.length; i++) {
      var c = spec.clauses[i];
      var v = CLAUSES[c.id].check(w, c.arg);
      out.push({ id: c.id, arg: c.arg, label: c.label, violations: v, pass: v === 0 });
    }
    return out;
  }

  /* Legality: an action is legal if it introduces no violation that the
   * do-nothing baseline did not already have. Drift alone can break a
   * constraint; the agent is not charged for what physics did. */
  function introducesViolation(candidate, baseline) {
    for (var i = 0; i < candidate.length; i++) {
      if (candidate[i].violations > baseline[i].violations) return candidate[i].id;
    }
    return null;
  }

  function receipt(w, spec, prevScore, move, constraints) {
    var s = score(w, spec);
    return {
      tick: w.tick,
      score: s,
      delta: s - prevScore,
      move: move,
      constraints: constraints,
      eligible: eligibleCount(w, spec),
      alive: W.aliveCount(w),
      capital: w.capital
    };
  }

  SB.Scorer = {
    DEFAULT_SPEC_TEXT: DEFAULT_SPEC_TEXT,
    CLAUSES: CLAUSES,
    parseSpec: parseSpec,
    score: score,
    eligibleCount: eligibleCount,
    checkConstraints: checkConstraints,
    introducesViolation: introducesViolation,
    receipt: receipt
  };
})(typeof window !== 'undefined' ? window : globalThis);
