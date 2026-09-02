/* SALT LINE — named cues.
 *
 * Every entity's tell is audio first. If the sound design does its job you
 * should be turning around because you heard something, not because
 * something appeared. The visual tell is a confirmation, not the warning.
 */
(function (S) {
  'use strict';

  var A = S.Synth;
  var M = S.M;

  var SB = {
    _wind: null, _windGain: null, _windFilt: null,
    _hiss: null, _hissGain: null, _hissFilt: null,
    _throb: null, _throbGain: null, _throbLfo: null,
    _choir: [], _choirGain: null,
    _lastStep: 0,
    _chalkCool: 0,
    _draggerCool: 0
  };

  function ok() { return A.ready && A.ctx; }

  /* ---- continuous beds ---------------------------------------------------- */
  SB.startBeds = function () {
    if (!ok() || SB._wind) return;
    var ctx = A.ctx;

    /* the wind over the pans. always there, never loud, and the first thing
     * you notice when it stops. */
    SB._wind = A.noise(true);
    SB._windFilt = A.filter('bandpass', 320, 0.55);
    SB._windGain = A.gain(0.0001);
    SB._wind.connect(SB._windFilt);
    SB._windFilt.connect(SB._windGain);
    A.out(SB._windGain, 0.35);
    SB._wind.start();
    SB._windGain.gain.setTargetAtTime(0.085, A.now(), 3.0);

    /* a slow lfo on the wind's filter: gusts */
    var lfo = A.osc('sine', 0.055);
    var lfoG = A.gain(140);
    lfo.connect(lfoG);
    lfoG.connect(SB._windFilt.frequency);
    lfo.start();

    /* the tide hiss, silent until the water starts going out */
    SB._hiss = A.noise(true);
    SB._hissFilt = A.filter('lowpass', 900, 1.1);
    SB._hissGain = A.gain(0.0001);
    SB._hiss.connect(SB._hissFilt);
    SB._hissFilt.connect(SB._hissGain);
    A.out(SB._hissGain, 0.5);
    SB._hiss.start();

    /* the Dragger's throb. a 37Hz sine you feel before you hear. */
    SB._throb = A.osc('sine', 37);
    var shaper = A.filter('lowpass', 90, 2.0);
    SB._throbGain = A.gain(0.0001);
    SB._throb.connect(shaper);
    shaper.connect(SB._throbGain);
    A.out(SB._throbGain, 0.15);
    SB._throbLfo = A.osc('sine', 1.35);
    var tg = A.gain(9);
    SB._throbLfo.connect(tg);
    tg.connect(SB._throb.frequency);
    SB._throb.start();
    SB._throbLfo.start();
  };

  SB.stopBeds = function () {
    if (!SB._wind) return;
    try { SB._windGain.gain.setTargetAtTime(0.0001, A.now(), 0.4); } catch (e) {}
    try { SB._hissGain.gain.setTargetAtTime(0.0001, A.now(), 0.4); } catch (e) {}
    try { SB._throbGain.gain.setTargetAtTime(0.0001, A.now(), 0.4); } catch (e) {}
  };

  /* the draw-back before a Comber, 0..1 */
  SB.tideDraw = function (v) {
    if (!ok() || !SB._hissGain) return;
    var t = A.now();
    SB._hissGain.gain.setTargetAtTime(0.0001 + v * v * 0.22, t, 0.25);
    SB._hissFilt.frequency.setTargetAtTime(400 + v * 2600, t, 0.3);
  };

  SB.draggerNear = function (v) {
    if (!ok() || !SB._throbGain) return;
    SB._throbGain.gain.setTargetAtTime(v * v * 0.42, A.now(), 0.18);
  };

  SB.draggerQuiet = function () {
    if (!ok() || !SB._throbGain) return;
    SB._throbGain.gain.setTargetAtTime(0.0001, A.now(), 0.7);
  };

  /* ---- footfalls ---------------------------------------------------------- */
  SB.step = function (wet, hard) {
    if (!ok()) return;
    var t = A.now();
    if (t - SB._lastStep < 0.16) return;
    SB._lastStep = t;

    var n = A.noise(false);
    n.playbackRate.value = 0.7 + Math.random() * 0.7;
    var f = A.filter(wet ? 'bandpass' : 'highpass', wet ? 700 : 1500, wet ? 1.1 : 0.7);
    var g = A.gain(0.0001);
    n.connect(f); f.connect(g);
    A.out(g, wet ? 0.30 : 0.16);

    var peak = (wet ? 0.13 : 0.085) * (hard ? 1.4 : 1);
    A.env(g, t, peak, 0.004, wet ? 0.20 : 0.075, [n]);

    if (wet) {
      /* the second half of a splash: the water closing back over */
      var n2 = A.noise(false);
      n2.playbackRate.value = 0.35;
      var f2 = A.filter('lowpass', 520, 0.8);
      var g2 = A.gain(0.0001);
      n2.connect(f2); f2.connect(g2);
      A.out(g2, 0.4);
      A.env(g2, t + 0.05, 0.05, 0.02, 0.24, [n2]);
    } else {
      /* crust cracks under the boot */
      var o = A.osc('triangle', 90 + Math.random() * 50);
      var og = A.gain(0.0001);
      o.connect(og);
      A.out(og, 0.1);
      A.env(og, t, 0.035, 0.002, 0.05, [o]);
    }
  };

  /* ---- doors --------------------------------------------------------------- */
  SB.doorGroan = function () {
    if (!ok()) return;
    var t = A.now();

    /* the hinge: a resonant filter dragged across a saw */
    var o = A.osc('sawtooth', 44);
    o.frequency.setValueAtTime(38, t);
    o.frequency.exponentialRampToValueAtTime(74, t + 1.5);
    var f = A.filter('bandpass', 180, 7.5);
    f.frequency.setValueAtTime(150, t);
    f.frequency.exponentialRampToValueAtTime(900, t + 1.7);
    var g = A.gain(0.0001);
    o.connect(f); f.connect(g);
    A.out(g, 0.65);
    A.env(g, t, 0.15, 0.20, 1.6, [o]);

    /* grit in the hinge */
    var n = A.noise(false);
    n.playbackRate.value = 0.4;
    var nf = A.filter('bandpass', 2400, 3);
    var ng = A.gain(0.0001);
    n.connect(nf); nf.connect(ng);
    A.out(ng, 0.4);
    A.env(ng, t + 0.1, 0.05, 0.3, 1.2, [n]);

    /* it lands */
    var thump = A.osc('sine', 58);
    var tg = A.gain(0.0001);
    thump.frequency.exponentialRampToValueAtTime(30, t + 1.9);
    thump.connect(tg);
    A.out(tg, 0.5);
    A.env(tg, t + 1.55, 0.30, 0.01, 0.7, [thump]);
  };

  SB.doorLocked = function () {
    if (!ok()) return;
    var t = A.now();
    var o = A.osc('square', 70);
    var f = A.filter('lowpass', 300, 3);
    var g = A.gain(0.0001);
    o.connect(f); f.connect(g);
    A.out(g, 0.3);
    A.env(g, t, 0.11, 0.003, 0.13, [o]);
  };

  /* ---- the name ------------------------------------------------------------ */
  /* A letter being cut out of you. Dry, close, and short: it should sound
   * like something being taken rather than something happening. */
  SB.spendLetter = function (own) {
    if (!ok()) return;
    var t = A.now();

    var n = A.noise(false);
    n.playbackRate.value = 1.6;
    var f = A.filter('highpass', own ? 1800 : 2600, 0.8);
    var g = A.gain(0.0001);
    n.connect(f); f.connect(g);
    A.out(g, 0.28);
    A.env(g, t, own ? 0.16 : 0.10, 0.002, own ? 0.16 : 0.09, [n]);

    var o = A.osc(own ? 'triangle' : 'sine', own ? 210 : 330);
    o.frequency.exponentialRampToValueAtTime(own ? 62 : 190, t + 0.5);
    var og = A.gain(0.0001);
    o.connect(og);
    A.out(og, own ? 0.7 : 0.35);
    A.env(og, t, own ? 0.13 : 0.055, 0.004, own ? 0.55 : 0.22, [o]);

    if (own) {
      /* when it is your own name going, a second voice comes in under it */
      var sub = A.osc('sine', 47);
      var sg = A.gain(0.0001);
      sub.connect(sg);
      A.out(sg, 0.5);
      A.env(sg, t, 0.16, 0.02, 0.9, [sub]);
    }
  };

  SB.takeLetter = function () {
    if (!ok()) return;
    var t = A.now();
    /* stone. you are prising it off a stone. */
    var n = A.noise(false);
    n.playbackRate.value = 1.1;
    var f = A.filter('bandpass', 3200, 4);
    var g = A.gain(0.0001);
    n.connect(f); f.connect(g);
    A.out(g, 0.35);
    A.env(g, t, 0.13, 0.002, 0.22, [n]);
    var o = A.osc('sine', 620);
    o.frequency.exponentialRampToValueAtTime(880, t + 0.18);
    var og = A.gain(0.0001);
    o.connect(og);
    A.out(og, 0.6);
    A.env(og, t, 0.05, 0.005, 0.25, [o]);
  };

  /* ---- the Assessor --------------------------------------------------------- */
  SB.chalk = function (near) {
    if (!ok()) return;
    var t = A.now();
    if (t - SB._chalkCool < 0.3) return;
    SB._chalkCool = t;
    var n = A.noise(false);
    n.playbackRate.value = 1.9 + Math.random() * 0.5;
    var f = A.filter('bandpass', 4200 + Math.random() * 1800, 9);
    var g = A.gain(0.0001);
    n.connect(f); f.connect(g);
    A.out(g, 0.45);
    A.env(g, t, 0.026 * (0.3 + near), 0.01, 0.16 + Math.random() * 0.2, [n]);
  };

  SB.slate = function () {
    if (!ok()) return;
    var t = A.now();
    var o = A.osc('square', 900);
    var f = A.filter('bandpass', 1400, 6);
    var g = A.gain(0.0001);
    o.connect(f); f.connect(g);
    A.out(g, 0.5);
    A.env(g, t, 0.07, 0.002, 0.10, [o]);
  };

  /* ---- the Tally ------------------------------------------------------------ */
  SB.tallyFlee = function () {
    if (!ok()) return;
    var t = A.now();
    var n = A.noise(false);
    n.playbackRate.value = 1.3;
    var f = A.filter('bandpass', 900, 2);
    var g = A.gain(0.0001);
    n.connect(f); f.connect(g);
    A.out(g, 0.5);
    A.env(g, t, 0.09, 0.01, 0.55, [n]);
  };

  SB.tallyMark = function () {
    if (!ok()) return;
    var t = A.now();
    for (var i = 0; i < 4; i++) {
      var n = A.noise(false);
      n.playbackRate.value = 2.2;
      var f = A.filter('bandpass', 3000 + i * 700, 8);
      var g = A.gain(0.0001);
      n.connect(f); f.connect(g);
      A.out(g, 0.4);
      A.env(g, t + i * 0.11, 0.05, 0.005, 0.09, [n]);
    }
  };

  /* ---- the Comber ------------------------------------------------------------ */
  SB.comberBreak = function () {
    if (!ok()) return;
    var t = A.now();
    var n = A.noise(true);
    var f = A.filter('lowpass', 600, 0.9);
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(4200, t + 2.4);
    var g = A.gain(0.0001);
    n.connect(f); f.connect(g);
    A.out(g, 0.7);
    var p = g.gain;
    p.setValueAtTime(0.0001, t);
    p.exponentialRampToValueAtTime(0.34, t + 2.6);
    p.exponentialRampToValueAtTime(0.0001, t + 5.4);
    n.start(t); n.stop(t + 5.6);

    var sub = A.osc('sine', 33);
    var sg = A.gain(0.0001);
    sub.connect(sg);
    A.out(sg, 0.3);
    A.env(sg, t, 0.24, 1.9, 2.6, [sub]);
  };

  SB.comberPass = function (safe) {
    if (!ok()) return;
    var t = A.now();
    var n = A.noise(false);
    n.playbackRate.value = 0.9;
    var f = A.filter(safe ? 'bandpass' : 'lowpass', safe ? 1800 : 700, safe ? 1.2 : 0.7);
    var g = A.gain(0.0001);
    n.connect(f); f.connect(g);
    A.out(g, 0.8);
    A.env(g, t, safe ? 0.24 : 0.42, 0.02, safe ? 0.9 : 1.7, [n]);
    if (!safe) {
      var o = A.osc('sine', 62);
      o.frequency.exponentialRampToValueAtTime(24, t + 1.2);
      var og = A.gain(0.0001);
      o.connect(og);
      A.out(og, 0.5);
      A.env(og, t, 0.34, 0.01, 1.3, [o]);
    }
  };

  /* ---- the Dragger ----------------------------------------------------------- */
  SB.draggerWake = function () {
    if (!ok()) return;
    var t = A.now();
    var n = A.noise(false);
    n.playbackRate.value = 0.5;
    var f = A.filter('lowpass', 420, 1.4);
    var g = A.gain(0.0001);
    n.connect(f); f.connect(g);
    A.out(g, 0.5);
    A.env(g, t, 0.16, 0.35, 1.1, [n]);
  };

  SB.draggerStrike = function () {
    if (!ok()) return;
    var t = A.now();
    var n = A.noise(false);
    var f = A.filter('lowpass', 1100, 1.0);
    var g = A.gain(0.0001);
    n.connect(f); f.connect(g);
    A.out(g, 0.6);
    A.env(g, t, 0.44, 0.004, 0.65, [n]);
    var o = A.osc('sawtooth', 90);
    o.frequency.exponentialRampToValueAtTime(28, t + 0.5);
    var og = A.gain(0.0001);
    var of2 = A.filter('lowpass', 260, 3);
    o.connect(of2); of2.connect(og);
    A.out(og, 0.4);
    A.env(og, t, 0.30, 0.005, 0.7, [o]);
  };

  /* ---- the Choir -------------------------------------------------------------- */
  /* Four voices a semitone and a tritone apart, detuned enough to beat
   * against each other. It is not a chord, it is an interference pattern. */
  SB.choirStart = function () {
    if (!ok() || SB._choir.length) return;
    var t = A.now();
    SB._choirGain = A.gain(0.0001);
    A.out(SB._choirGain, 0.85);
    var freqs = [110, 116.5, 155.6, 233.1];
    for (var i = 0; i < freqs.length; i++) {
      var o = A.osc(i === 3 ? 'triangle' : 'sine', freqs[i]);
      var g = A.gain(0.25 - i * 0.04);
      var lfo = A.osc('sine', 0.07 + i * 0.031);
      var lg = A.gain(0.6 + i * 0.4);
      lfo.connect(lg); lg.connect(o.frequency);
      o.connect(g); g.connect(SB._choirGain);
      o.start(t); lfo.start(t);
      SB._choir.push(o, lfo);
    }
    SB._choirGain.gain.setTargetAtTime(0.115, t, 2.4);
  };

  SB.choirStop = function () {
    if (!ok() || !SB._choir.length) return;
    var t = A.now();
    SB._choirGain.gain.setTargetAtTime(0.0001, t, 1.1);
    var list = SB._choir;
    SB._choir = [];
    setTimeout(function () {
      for (var i = 0; i < list.length; i++) { try { list[i].stop(); } catch (e) {} }
    }, 4200);
  };

  /* ---- the Understudy ---------------------------------------------------------- */
  SB.understudyAppear = function () {
    if (!ok()) return;
    var t = A.now();
    var o = A.osc('sine', 1240);
    o.frequency.exponentialRampToValueAtTime(880, t + 1.6);
    var g = A.gain(0.0001);
    o.connect(g);
    A.out(g, 0.9);
    A.env(g, t, 0.035, 0.6, 1.4, [o]);
  };

  SB.understudyNear = function (v) {
    if (!ok()) return;
    var t = A.now();
    if (t - SB._draggerCool < 0.9) return;
    SB._draggerCool = t;
    /* your own footstep, coming back at you slightly wrong */
    var n = A.noise(false);
    n.playbackRate.value = 0.55;
    var f = A.filter('bandpass', 620, 1.4);
    var g = A.gain(0.0001);
    n.connect(f); f.connect(g);
    A.out(g, 0.8);
    A.env(g, t, 0.05 * v, 0.01, 0.28, [n]);
  };

  SB.understudyTake = function () {
    if (!ok()) return;
    var t = A.now();
    var o = A.osc('sawtooth', 220);
    o.frequency.exponentialRampToValueAtTime(27, t + 1.4);
    var f = A.filter('lowpass', 1400, 6);
    f.frequency.exponentialRampToValueAtTime(120, t + 1.4);
    var g = A.gain(0.0001);
    o.connect(f); f.connect(g);
    A.out(g, 0.9);
    A.env(g, t, 0.42, 0.02, 1.6, [o]);
    var n = A.noise(false);
    var nf = A.filter('highpass', 3000, 0.7);
    var ng = A.gain(0.0001);
    n.connect(nf); nf.connect(ng);
    A.out(ng, 0.8);
    A.env(ng, t, 0.20, 0.01, 1.4, [n]);
  };

  SB.understudyGone = function () {
    if (!ok()) return;
    var t = A.now();
    var n = A.noise(false);
    n.playbackRate.value = 1.4;
    var f = A.filter('highpass', 2200, 0.8);
    var g = A.gain(0.0001);
    n.connect(f); f.connect(g);
    A.out(g, 0.7);
    A.env(g, t, 0.10, 0.02, 1.0, [n]);
  };

  /* ---- ui --------------------------------------------------------------------- */
  SB.uiMove = function () {
    if (!ok()) return;
    var t = A.now();
    var n = A.noise(false);
    n.playbackRate.value = 2.4;
    var f = A.filter('bandpass', 3400, 7);
    var g = A.gain(0.0001);
    n.connect(f); f.connect(g);
    A.out(g, 0.2);
    A.env(g, t, 0.05, 0.002, 0.05, [n]);
  };

  SB.uiPick = function () {
    if (!ok()) return;
    var t = A.now();
    var o = A.osc('triangle', 180);
    o.frequency.exponentialRampToValueAtTime(90, t + 0.25);
    var g = A.gain(0.0001);
    o.connect(g);
    A.out(g, 0.5);
    A.env(g, t, 0.10, 0.004, 0.3, [o]);
  };

  SB.toll = function () {
    if (!ok()) return;
    var t = A.now();
    var o = A.osc('sine', 82);
    var g = A.gain(0.0001);
    o.connect(g);
    A.out(g, 0.85);
    A.env(g, t, 0.20, 0.01, 2.2, [o]);
  };

  S.Sound = SB;
})(SALT);
