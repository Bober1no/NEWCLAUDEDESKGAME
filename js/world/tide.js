/* SALT LINE — the clock nobody shows you.
 *
 * Every section has a tide on it. It is not displayed as a bar; you read it
 * off the flat -- the brine starts running the wrong way, the hiss comes up
 * out of the dark ahead, and then you have about four seconds.
 *
 * This is what stops the game being a stealth puzzle you can solve by never
 * moving. Standing still is a valid answer to exactly one entity and a slow
 * way to lose to another.
 */
(function (S) {
  'use strict';

  var M = S.M;

  var T = {
    t: 0,
    limit: 100,
    draw: 0,          /* 0..1 -- how far the brine has pulled back    */
    surging: false,
    fired: 0,
    enabled: false
  };

  T.reset = function (doorNum) {
    T.t = 0;
    /* the sea gets closer the further out you walk */
    T.limit = Math.max(52, 104 - doorNum * 0.85);
    T.draw = 0;
    T.surging = false;
    T.enabled = doorNum >= 12;      /* the tide does not reach the inner pans */
  };

  T.update = function (dt) {
    if (!T.enabled) { T.draw = 0; return false; }
    T.t += dt;
    var togo = T.limit - T.t;
    /* the draw-back: five seconds of the water going out. this is the tell. */
    T.draw = 1 - M.sat(togo / 5.0);
    if (togo <= 0 && !T.surging) {
      T.surging = true;
      T.fired++;
      return true;                  /* caller launches the Comber */
    }
    return false;
  };

  T.remaining = function () { return Math.max(0, T.limit - T.t); };

  /* pushing the tide: paying an Assessor's wait, or reading a marker, both
   * cost you time you did not have */
  T.spend = function (sec) { T.t += sec; };

  S.Tide = T;
})(SALT);
