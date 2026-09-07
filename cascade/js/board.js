/* CASCADE — the board.
   Reasonable people reading five numbers. */
(function (root) {
  'use strict';
  var CSC = root.CSC;

  var WEIGHTS = { otd: 0.24, landedCost: 0.21, turns: 0.17, attain: 0.16, workingCapital: 0.22 };
  var DIRECTION = { otd: 'higher', landedCost: 'lower', turns: 'higher', attain: 'higher', workingCapital: 'lower' };
  var LABEL = {
    otd: 'On-time delivery', landedCost: 'Landed cost / unit', turns: 'Inventory turns',
    attain: 'Forecast attainment', workingCapital: 'Working capital'
  };
  var FMT = {
    otd: function (v) { return v.toFixed(1) + '%'; },
    landedCost: function (v) { return '$' + v.toFixed(2); },
    turns: function (v) { return v.toFixed(2) + '×'; },
    attain: function (v) { return v.toFixed(1) + '%'; },
    workingCapital: function (v) { return '$' + v.toFixed(2) + 'M'; }
  };

  function initialTargets(base) {
    return {
      otd: Math.min(97.8, base.otd + 0.4),
      landedCost: base.landedCost * 0.982,
      turns: base.turns * 1.07,
      attain: Math.max(98.0, base.attain * 0.995),
      workingCapital: base.workingCapital * 0.955
    };
  }

  /* The board raises the bar when you clear it. Nobody is being unfair. */
  function ratchet(targets) {
    return {
      otd: Math.min(98.8, targets.otd + 0.035),
      landedCost: targets.landedCost * 0.9955,
      turns: targets.turns * 1.011,
      attain: Math.min(100.5, targets.attain + 0.05),
      workingCapital: targets.workingCapital * 0.9875
    };
  }

  function attainment(key, value, target) {
    var ratio = DIRECTION[key] === 'higher' ? value / target : target / value;
    if (!isFinite(ratio) || ratio < 0) ratio = 0;
    /* Deliberately not floored at zero: a metric in free fall has to keep
       moving the score, or the review stops responding exactly when it
       matters most. */
    var a = (ratio - 0.76) / 0.27;
    return Math.max(-0.8, Math.min(1.2, a));
  }

  function review(kpi, targets, denials, confidence) {
    var lines = [], total = 0, keys = Object.keys(WEIGHTS), i;
    for (i = 0; i < keys.length; i++) {
      var k = keys[i];
      var a = attainment(k, kpi[k], targets[k]);
      total += WEIGHTS[k] * a;
      lines.push({
        key: k, label: LABEL[k], value: kpi[k], target: targets[k],
        fmt: FMT[k](kpi[k]), targetFmt: FMT[k](targets[k]),
        met: DIRECTION[k] === 'higher' ? kpi[k] >= targets[k] : kpi[k] <= targets[k],
        attainment: a, weight: WEIGHTS[k]
      });
    }
    var score = Math.round(total * 100 * 10) / 10;
    var pass = score >= 62;
    var conf = confidence + (score - 62) * 0.34 - denials * 2.4;
    conf = Math.max(0, Math.min(100, conf));
    return { score: score, pass: pass, lines: lines, confidence: conf, denials: denials };
  }

  var PRAISE = [
    'Clean quarter. The operating discipline is showing.',
    'This is the shape of the plan we approved. Keep going.',
    'Strong numbers across the board. The committee is satisfied.',
    'Better than the guidance we gave the market. Noted.',
    'Everything we asked for, delivered. Thank you.'
  ];
  var STEADY = [
    'On plan. Nothing here needs discussion.',
    'Acceptable. We would like to see more on the weaker line.',
    'Holding. The committee expects progress next quarter.',
    'No concerns raised. Continue.'
  ];
  var PRESSURE = [
    'Two of these are going the wrong way. We need them back.',
    'This is below what we set out. Explain the plan for next quarter.',
    'The committee is not comfortable with this trajectory.',
    'We have shareholders reading the same page you are.'
  ];
  var WARN = [
    'This is a formal warning. Two consecutive quarters below target.',
    'The committee is recording a formal concern. The next quarter is decisive.',
    'We are putting this on the record. One more like it and we will act.'
  ];
  var DENY_NOTE = [
    'We note a number of operating recommendations were declined this quarter.',
    'The committee reviewed the declined proposals. We would want a stronger reason next time.',
    'Declining sound operating proposals is a choice, and it shows in these numbers.'
  ];

  function commentary(rv, missStreak, turn, seed) {
    var rng = CSC.derive(seed, 'board:' + turn);
    var out = [];
    if (missStreak >= 2) out.push(WARN[rng.int(WARN.length)]);
    else if (rv.score >= 84) out.push(PRAISE[rng.int(PRAISE.length)]);
    else if (rv.pass) out.push(STEADY[rng.int(STEADY.length)]);
    else out.push(PRESSURE[rng.int(PRESSURE.length)]);

    var worst = rv.lines[0], best = rv.lines[0];
    for (var i = 1; i < rv.lines.length; i++) {
      if (rv.lines[i].attainment < worst.attainment) worst = rv.lines[i];
      if (rv.lines[i].attainment > best.attainment) best = rv.lines[i];
    }
    if (rv.pass) out.push(best.label + ' at ' + best.fmt + ' is the standout.');
    else out.push(worst.label + ' at ' + worst.fmt + ' against ' + worst.targetFmt + ' is the problem.');
    if (rv.denials >= 2) out.push(DENY_NOTE[rng.int(DENY_NOTE.length)]);
    return out.join(' ');
  }

  root.CSC.board = {
    WEIGHTS: WEIGHTS, DIRECTION: DIRECTION, LABEL: LABEL, FMT: FMT,
    initialTargets: initialTargets, ratchet: ratchet, review: review,
    commentary: commentary, attainment: attainment
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
