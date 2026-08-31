/* SALT LINE — who is waiting in the next section.
 *
 * The line is authored, not shuffled. Doors 1 to 22 introduce one thing at a
 * time with a clean section either side of it, so that every tell is learned
 * against a quiet background before it is ever stacked with another. After
 * that it goes weighted-random with two hard rules: never the same thing
 * twice running, and never two bodies in one section before door 30.
 *
 * The Understudy is the exception. Its odds are not on the door number, they
 * are on how much of your name you have left. It arrives when you are cheap.
 */
(function (S) {
  'use strict';

  var M = S.M;

  var SCRIPT = {
    6:  ['tally'],
    8:  ['assessor'],
    11: ['dragger'],
    14: ['comber'],
    18: ['choir'],
    22: ['understudy'],
    26: ['assessor', 'dragger'],
    30: ['tally', 'choir'],
    62: ['understudy'],
    64: ['assessor', 'dragger'],
    65: ['choir', 'understudy']
  };

  var QUIET = { 1: 1, 2: 1, 3: 1, 5: 1, 7: 1, 9: 1, 13: 1, 15: 1, 20: 1, 61: 1 };

  var D = { last: null };

  D.reset = function () { D.last = null; };

  D.plan = function (doorNum, game, rng) {
    var out = { spawns: [], tideRush: false };

    if (SCRIPT[doorNum]) {
      var s = SCRIPT[doorNum];
      for (var i = 0; i < s.length; i++) {
        if (s[i] === 'comber') { out.tideRush = true; continue; }
        out.spawns.push({ type: s[i], delay: i * 6 + rng.range(1.5, 4) });
      }
      D.last = s[s.length - 1];
      return out;
    }

    if (QUIET[doorNum] || doorNum < 6) return out;

    /* how thin you are wearing. this is the real difficulty dial. */
    var thin = 1 - M.sat(game.ownRemaining() / Math.max(1, game.ownLength()));
    var deep = M.sat((doorNum - 6) / 50);

    var pool = [];
    function add(type, weight) { if (weight > 0 && type !== D.last) pool.push({ t: type, w: weight }); }

    add('tally', 0.55 - deep * 0.30);
    add('assessor', 0.55 + deep * 0.35 + M.sat(game.robbed / 14) * 0.5);
    add('dragger', 0.45 + deep * 0.55);
    add('choir', 0.30 + deep * 0.40);
    add('understudy', 0.06 + thin * 1.25 + deep * 0.30);

    var density = 0.42 + deep * 0.46;
    if (rng.f() > density) { D.last = null; return out; }

    var total = 0;
    for (var p = 0; p < pool.length; p++) total += pool[p].w;
    var pick = rng.f() * total, acc = 0, chosen = pool[0];
    for (var q = 0; q < pool.length; q++) {
      acc += pool[q].w;
      if (pick <= acc) { chosen = pool[q]; break; }
    }
    out.spawns.push({ type: chosen.t, delay: rng.range(1.0, 5.0) });
    D.last = chosen.t;

    /* past thirty the flat stops giving you one thing at a time */
    if (doorNum > 30 && rng.f() < 0.16 + deep * 0.24) {
      var second = ['dragger', 'choir', 'assessor'][rng.int(3)];
      if (second !== chosen.t) out.spawns.push({ type: second, delay: rng.range(6, 14) });
    }

    return out;
  };

  /* what the Tally scratches for you: the shape of the next section */
  D.markFor = function (spawns) {
    if (!spawns || !spawns.length) return 'CLEAR';
    var t = spawns[0].type;
    if (t === 'assessor') return 'HELD';
    if (t === 'dragger') return 'IN THE WATER';
    if (t === 'choir') return 'SINGING';
    if (t === 'understudy') return 'TWO OF YOU';
    if (t === 'tally') return 'ONLY ME';
    return 'SOMETHING';
  };

  S.Director = D;
})(SALT);
