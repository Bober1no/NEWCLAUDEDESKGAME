/* SALT LINE — the dead.
 *
 * Every marker out on the flat carries a name, or the number that was cut
 * when nobody knew one. These are generated, not listed, so the flat can be
 * as full as it needs to be, and so no two runs bury the same people.
 *
 * The names are deliberately plain and slightly archaic: this is a working
 * saltworks and the people on it were labour, not myth.
 */
(function (S) {
  'use strict';

  var FIRST = [
    'ANNIE', 'HALLAM', 'EDA', 'MERRICK', 'JOAN', 'CALLUM', 'PERRIN', 'MAUD',
    'OSGOOD', 'THEA', 'BRAN', 'ISLA', 'WYCK', 'NELL', 'ROSS', 'GWEN',
    'ABEL', 'MARTHE', 'CONNOR', 'SELA', 'HOB', 'IRIS', 'TAM', 'DELL',
    'ORLA', 'SILAS', 'MEG', 'FENN', 'RUE', 'HARLAN', 'BESS', 'CORRIE',
    'AVIS', 'DRAGO', 'PELL', 'WINN', 'TOBIT', 'MERE', 'LEV', 'SARN'
  ];
  var LAST = [
    'SALTER', 'BRINE', 'HOLLAND', 'REED', 'MERE', 'ASHBY', 'PANNER', 'WICK',
    'CROSSE', 'HALLOW', 'DEEP', 'STRAND', 'FOWLER', 'RAKE', 'LOCK', 'MARSH',
    'GALE', 'STOKE', 'TIDE', 'BARROW', 'CULLEN', 'SWALE', 'FEN', 'HARROW'
  ];

  var EPITAPH = [
    'STOPPED WALKING',
    'PAID IN FULL',
    'WOULD NOT PAY',
    'TURNED BACK TOO LATE',
    'HAD NOTHING LEFT',
    'WENT INTO THE PAN',
    'GAVE IT ALL AT ONCE',
    'DID NOT LOOK AWAY',
    'KEPT THE LAMP LIT',
    'LISTENED',
    'SPENT SOMEONE ELSE',
    'WALKED WITHOUT A LAMP',
    'NEVER REACHED THE GATE',
    'WAS NOT ALONE',
    'STOOD STILL TOO LONG'
  ];

  var N = {};

  N.person = function (rng) {
    return rng.pick(FIRST) + ' ' + rng.pick(LAST);
  };

  N.epitaph = function (rng) { return rng.pick(EPITAPH); };

  /* A marker with no name on it: the flat filed them by number instead. This
   * is what happened to the one you came out here for. */
  N.numbered = function (rng) {
    return 'NO. ' + (100 + rng.int(8900));
  };

  N.TARGET_EPITAPH = [
    'NOBODY CLAIMED IT',
    'THE CLERK NEVER CAME BACK',
    'FILED, NOT BURIED',
    'NO ONE COULD SAY'
  ];

  N.FIRST = FIRST;
  N.LAST = LAST;

  S.Names = N;
})(SALT);
