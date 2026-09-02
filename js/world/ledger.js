/* SALT LINE — the ledger.
 *
 * The number cut into every door is not the door's index. It is how many
 * people have gone through it. It is the only counter in the game that goes
 * down, and it is doing the work that a health bar would do somewhere else:
 * you learn to read the number on the next frame from forty metres away and
 * know exactly how much company you have left.
 *
 * Door 1 reads 4411. Door 58 reads 1. Door 61 reads 0, and it is not the
 * last one.
 */
(function (S) {
  'use strict';

  /* the last stretch is authored by hand -- the curve matters more than the
   * formula once the numbers get small enough to feel */
  var TAIL = [12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 1, 1, 0, 0, 0, 0, 0, 0];
  var TAIL_START = 48;

  var L = {};

  L.at = function (door) {
    if (door >= TAIL_START) {
      var i = door - TAIL_START;
      return TAIL[i < TAIL.length ? i : TAIL.length - 1];
    }
    var v = Math.round(4411 * Math.pow(0.885, door - 1));
    return v < 13 ? 13 : v;
  };

  /* what the door costs to open, before any surcharge */
  L.tollAt = function (door) {
    if (door >= S.K.MAX_DOORS) return S.K.LAST_DOOR_COST;
    return 1;
  };

  /* the line you get when you look at a door up close */
  L.legendAt = function (door) {
    var n = L.at(door);
    if (n === 0) return 'NONE HAVE';
    if (n === 1) return 'ONE HAS';
    return n + ' HAVE';
  };

  S.Ledger = L;
})(SALT);
