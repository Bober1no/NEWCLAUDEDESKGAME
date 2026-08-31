/* SALT LINE — the synthesis layer.
 *
 * No files. Every sound in the game is oscillators, filtered noise, and one
 * convolution reverb whose impulse response is generated at boot: exponential
 * decay noise with an early-reflection comb, which gives the flat the long,
 * flat, unhelpful space it should have. Nothing here echoes off a wall,
 * because there are no walls.
 *
 * The context is not created until the player clicks, because browsers.
 */
(function (S) {
  'use strict';

  var A = {
    ctx: null,
    ready: false,
    master: null,
    dry: null,
    wet: null,
    verb: null,
    noiseBuf: null,
    muted: false,
    volume: 0.85
  };

  A.init = function () {
    if (A.ctx) return true;
    var Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return false;
    try { A.ctx = new Ctor(); } catch (e) { return false; }

    var ctx = A.ctx;

    A.master = ctx.createGain();
    A.master.gain.value = A.volume;

    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 24;
    comp.ratio.value = 5;
    comp.attack.value = 0.006;
    comp.release.value = 0.28;

    A.master.connect(comp);
    comp.connect(ctx.destination);

    A.dry = ctx.createGain(); A.dry.gain.value = 1;
    A.dry.connect(A.master);

    A.verb = ctx.createConvolver();
    A.verb.buffer = buildImpulse(ctx, 3.4, 2.6);
    A.wet = ctx.createGain(); A.wet.gain.value = 0.30;
    A.verb.connect(A.wet);
    A.wet.connect(A.master);

    A.noiseBuf = buildNoise(ctx, 4.0);
    A.ready = true;
    return true;
  };

  A.resume = function () {
    if (A.ctx && A.ctx.state === 'suspended') A.ctx.resume();
  };

  A.now = function () { return A.ctx ? A.ctx.currentTime : 0; };

  A.setVolume = function (v) {
    A.volume = v;
    if (A.master) A.master.gain.value = A.muted ? 0 : v;
  };

  A.setMuted = function (m) {
    A.muted = m;
    if (A.master) A.master.gain.value = m ? 0 : A.volume;
  };

  /* --- impulse response: a flat, wide, unreflective space ---------------- */
  function buildImpulse(ctx, seconds, decay) {
    var rate = ctx.sampleRate;
    var len = Math.floor(rate * seconds);
    var buf = ctx.createBuffer(2, len, rate);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch);
      var seed = ch === 0 ? 0x1234 : 0x9876;
      var r = S.M.rng(seed);
      for (var i = 0; i < len; i++) {
        var t = i / len;
        var env = Math.pow(1 - t, decay);
        /* a low-passed noise tail: the flat swallows the top end */
        d[i] = (r.f() * 2 - 1) * env;
      }
      /* one-pole lowpass over the tail so it is air, not hiss */
      var prev = 0;
      for (var j = 0; j < len; j++) {
        prev += (d[j] - prev) * 0.11;
        d[j] = prev;
      }
      /* a couple of very late, very quiet reflections off the far levees */
      var r1 = (rate * 0.21) | 0, r2 = (rate * 0.47) | 0;
      for (var k = len - 1; k >= r2; k--) {
        d[k] += d[k - r1] * 0.16 + d[k - r2] * 0.09;
      }
    }
    return buf;
  }

  function buildNoise(ctx, seconds) {
    var rate = ctx.sampleRate;
    var len = Math.floor(rate * seconds);
    var buf = ctx.createBuffer(2, len, rate);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch);
      var r = S.M.rng(ch === 0 ? 0x5150 : 0x2112);
      /* pink-ish: three octaves of smoothed white summed */
      var a = 0, b = 0, c = 0;
      for (var i = 0; i < len; i++) {
        var w = r.f() * 2 - 1;
        a += (w - a) * 0.30;
        b += (w - b) * 0.06;
        c += (w - c) * 0.012;
        d[i] = (a * 0.4 + b * 0.4 + c * 0.5) * 0.7;
      }
    }
    return buf;
  }

  /* --- node factories ---------------------------------------------------- */
  A.gain = function (v) {
    var g = A.ctx.createGain();
    g.gain.value = v === undefined ? 1 : v;
    return g;
  };

  A.filter = function (type, freq, q) {
    var f = A.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    if (q !== undefined) f.Q.value = q;
    return f;
  };

  A.osc = function (type, freq) {
    var o = A.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    return o;
  };

  A.noise = function (loop) {
    var n = A.ctx.createBufferSource();
    n.buffer = A.noiseBuf;
    n.loop = loop !== false;
    return n;
  };

  A.pan = function (v) {
    if (A.ctx.createStereoPanner) {
      var p = A.ctx.createStereoPanner();
      p.pan.value = v || 0;
      return p;
    }
    return A.gain(1);
  };

  /* route a node to dry + a share of the reverb */
  A.out = function (node, wetAmount) {
    node.connect(A.dry);
    if (wetAmount > 0) {
      var g = A.gain(wetAmount);
      node.connect(g);
      g.connect(A.verb);
    }
  };

  /* one-shot envelope helper: attack/decay on a gain, then tear down */
  A.env = function (g, t0, peak, attack, decay, sources) {
    var p = g.gain;
    p.cancelScheduledValues(t0);
    p.setValueAtTime(0.0001, t0);
    p.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
    p.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    var stopAt = t0 + attack + decay + 0.06;
    for (var i = 0; i < sources.length; i++) {
      try { sources[i].start(t0); } catch (e) {}
      try { sources[i].stop(stopAt); } catch (e) {}
    }
  };

  S.Synth = A;
})(SALT);
