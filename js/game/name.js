/* SALT LINE — the resource.
 *
 * You do not have health. You have letters.
 *
 * The letters you start with are your own name. The letters you pick up off
 * markers belong to people who did not get out, and they sit in front of your
 * own in the ledger, which means they are always spent first. That ordering
 * is the whole game: as long as you are robbing the dead fast enough, your
 * own name is untouched, and the moment you fall behind the flat starts
 * taking it off you a letter at a time, from the back.
 *
 * At zero you are not dead. You are just something the line can file.
 */
(function (S) {
  'use strict';

  var N = {
    raw: 'WALKER',       /* what you typed, spaces and all */
    own: [],             /* {ch, i} -- position in raw, so gaps stay put */
    stolen: [],          /* {ch, from} */
    crumbs: [],          /* falling letter particles for the hud */
    lastSpend: 0,
    totalSpent: 0,
    ownSpent: 0
  };

  N.set = function (raw) {
    raw = (raw || '').toUpperCase().replace(/[^A-Z' -]/g, '').trim();
    if (!raw.length) raw = 'WALKER';
    N.raw = raw;
    N.own = [];
    for (var i = 0; i < raw.length; i++) {
      var c = raw.charAt(i);
      if (c >= 'A' && c <= 'Z') N.own.push({ ch: c, i: i });
    }
    N.stolen = [];
    N.crumbs = [];
    N.totalSpent = 0;
    N.ownSpent = 0;
  };

  N.ownLength = function () {
    var n = 0;
    for (var i = 0; i < N.raw.length; i++) {
      var c = N.raw.charAt(i);
      if (c >= 'A' && c <= 'Z') n++;
    }
    return n;
  };

  N.ownRemaining = function () { return N.own.length; };
  N.total = function () { return N.own.length + N.stolen.length; };

  /* the name as it currently reads, with gouges where letters have gone */
  N.display = function () {
    var out = N.raw.split('');
    var keep = {};
    for (var i = 0; i < N.own.length; i++) keep[N.own[i].i] = true;
    for (var j = 0; j < out.length; j++) {
      var c = out[j];
      if (c >= 'A' && c <= 'Z' && !keep[j]) out[j] = '.';
    }
    return out.join('');
  };

  N.take = function (ch, from) {
    N.stolen.push({ ch: ch, from: from, t: 0 });
  };

  /* Spend n letters. Stolen first, then your own from the back.
   * Returns how many of your own it cost -- the caller uses that to decide
   * how hard the world should react. */
  N.spend = function (n) {
    var ownCost = 0;
    for (var i = 0; i < n; i++) {
      if (N.stolen.length) {
        var s = N.stolen.pop();
        N.crumbs.push({ ch: s.ch, own: false, x: 0, y: 0, vy: 0, t: 0, idx: N.stolen.length });
      } else if (N.own.length) {
        var o = N.own.pop();
        N.crumbs.push({ ch: o.ch, own: true, x: 0, y: 0, vy: 0, t: 0, idx: N.own.length });
        ownCost++;
        N.ownSpent++;
      }
      N.totalSpent++;
    }
    return ownCost;
  };

  N.canAfford = function (n) { return N.total() >= n; };

  N.updateCrumbs = function (dt) {
    for (var i = N.crumbs.length - 1; i >= 0; i--) {
      var c = N.crumbs[i];
      c.t += dt;
      c.vy += dt * 62;
      c.y += c.vy * dt;
      c.x += Math.sin(c.t * 7 + i) * dt * 5;
      if (c.t > 1.5) N.crumbs.splice(i, 1);
    }
  };

  /* how far gone you are, 0 fresh .. 1 nothing left of you */
  N.erosion = function () {
    var L = N.ownLength();
    if (!L) return 1;
    return 1 - (N.own.length / L);
  };

  S.Name = N;
})(SALT);
