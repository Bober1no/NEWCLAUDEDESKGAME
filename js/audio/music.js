/* SALT LINE — the bed underneath.
 *
 * Not music. A drone tuned to the flat, which rises with pressure and drops
 * a fifth every time your own name gets shorter. There is no melody anywhere
 * in this game; the only thing that ever resolves is the Choir, and that is
 * the thing that is charging you double.
 */
(function (S) {
  'use strict';

  var A = S.Synth;
  var M = S.M;

  var Mu = {
    started: false,
    voices: [],
    bus: null,
    filt: null,
    tension: 0,
    _target: 0,
    root: 55
  };

  Mu.start = function () {
    if (Mu.started || !A.ready) return;
    Mu.started = true;

    Mu.bus = A.gain(0.0001);
    Mu.filt = A.filter('lowpass', 220, 1.4);
    Mu.bus.connect(Mu.filt);
    A.out(Mu.filt, 0.55);

    var ratios = [1, 1.5, 2.005, 2.996, 4.02];
    var levels = [0.30, 0.16, 0.10, 0.055, 0.03];
    for (var i = 0; i < ratios.length; i++) {
      var o = A.osc(i < 2 ? 'sine' : 'triangle', Mu.root * ratios[i]);
      var g = A.gain(levels[i]);
      /* each voice drifts at its own rate so the drone never sits still */
      var lfo = A.osc('sine', 0.017 + i * 0.0091);
      var lg = A.gain(0.28 + i * 0.22);
      lfo.connect(lg); lg.connect(o.frequency);
      o.connect(g); g.connect(Mu.bus);
      o.start(); lfo.start();
      Mu.voices.push({ osc: o, gain: g, ratio: ratios[i] });
    }
    Mu.bus.gain.setTargetAtTime(0.10, A.now(), 6.0);
  };

  /* 0..1. driven by proximity, name loss and tide. */
  Mu.setTension = function (v) {
    Mu._target = M.sat(v);
    if (!Mu.started || !A.ready) return;
    var t = A.now();
    Mu.bus.gain.setTargetAtTime(0.075 + Mu._target * 0.13, t, 1.2);
    Mu.filt.frequency.setTargetAtTime(180 + Mu._target * 900, t, 1.4);
    Mu.filt.Q.setTargetAtTime(1.2 + Mu._target * 4.5, t, 1.4);
  };

  /* the root drops when the name does. by the end it is barely a pitch. */
  Mu.setRoot = function (hz) {
    if (!Mu.started || !A.ready) return;
    Mu.root = hz;
    var t = A.now();
    for (var i = 0; i < Mu.voices.length; i++) {
      Mu.voices[i].osc.frequency.setTargetAtTime(hz * Mu.voices[i].ratio, t, 3.5);
    }
  };

  Mu.stop = function () {
    if (!Mu.started || !A.ready) return;
    Mu.bus.gain.setTargetAtTime(0.0001, A.now(), 0.8);
  };

  Mu.resume = function () {
    if (!Mu.started || !A.ready) return;
    Mu.bus.gain.setTargetAtTime(0.075 + Mu._target * 0.13, A.now(), 1.0);
  };

  S.Music = Mu;
})(SALT);
