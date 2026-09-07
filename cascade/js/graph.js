/* CASCADE — the network map.
   Canvas 2D. Three colour modes over one geometry: the same company, drawn
   against three different questions. */
(function (root) {
  'use strict';
  var CSC = root.CSC;

  var LAYOUT_W = 1000, LAYOUT_H = 620;

  function Graph(canvas, game) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.game = game;
    this.mode = 'performance';
    this.t = 0;
    this.hover = -1;
    this.selected = -1;
    this.dpr = Math.min(2, root.devicePixelRatio || 1);
    this.risk = null;
    this.flow = null;
    this.override = null;
    this.activity = new Float64Array(game.world.N);
    this.laneStall = new Float64Array(game.world.M);
    this.tierWave = [0, 0, 0, 0, 0];
    this.refreshDerived();
    this.resize();
    var self = this;
    root.addEventListener('resize', function () { self.resize(); });
    canvas.addEventListener('mousemove', function (e) { self.onMove(e); });
    canvas.addEventListener('mouseleave', function () { self.hover = -1; });
    canvas.addEventListener('click', function () { self.selected = self.hover; });
  }

  Graph.prototype.resize = function () {
    var r = this.canvas.parentNode.getBoundingClientRect();
    this.w = Math.max(320, r.width);
    this.h = Math.max(240, r.height);
    this.canvas.width = this.w * this.dpr;
    this.canvas.height = this.h * this.dpr;
    this.canvas.style.width = this.w + 'px';
    this.canvas.style.height = this.h + 'px';
    this.sx = this.w / LAYOUT_W;
    this.sy = this.h / LAYOUT_H;
  };

  Graph.prototype.px = function (n) { return this.game.net.nodes[n].px * this.sx; };
  Graph.prototype.py = function (n) { return this.game.net.nodes[n].py * this.sy; };

  /* Timeline scrubbing feeds the renderer a stored snapshot instead of the
     live world. Same geometry, an earlier company. */
  Graph.prototype.setSnapshot = function (snap) {
    this.override = snap || null;
    this.refreshDerived();
  };

  Graph.prototype.refreshDerived = function () {
    var w = this.game.world;
    if (this.override) {
      this.flow = this.override.flow;
      this.risk = this.override.risk;
      var mo = 1;
      for (var z = 0; z < this.flow.length; z++) if (this.flow[z] > mo) mo = this.flow[z];
      this.flowMax = mo;
      this.tierWave = [1, 1, 1, 1, 1];
      return;
    }
    var h = this.game.lastHealth;
    this.flow = h && h.flow ? h.flow : CSC.health.sourceFlows(w);
    this.risk = h && h.risk ? h.risk : CSC.health.nodeRisk(w, this.flow);
    var mx = 1, i;
    for (i = 0; i < w.N; i++) if (this.flow[i] > mx) mx = this.flow[i];
    this.flowMax = mx;
    /* Order amplitude by tier, for the flow view's upstream waves. */
    var hist = w.hist;
    var amp = hist.filled > 8 ? CSC.health.bullwhip(w) : 1;
    for (i = 0; i < 5; i++) this.tierWave[i] = 1 + (amp - 1) * (1 - i / 4.6);
  };

  Graph.prototype.onMove = function (e) {
    var r = this.canvas.getBoundingClientRect();
    var mx = e.clientX - r.left, my = e.clientY - r.top;
    var best = -1, bd = 15 * 15;
    for (var i = 0; i < this.game.world.N; i++) {
      var dx = this.px(i) - mx, dy = this.py(i) - my;
      var d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; }
    }
    this.hover = best;
    this.mx = mx; this.my = my;
  };

  function lerp(a, b, t) { return a + (b - a) * t; }
  function rgb(r, g, b) { return 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')'; }

  /* Green through amber to red. Used only by the risk view. */
  function riskColour(x) {
    x = Math.max(0, Math.min(1, x));
    if (x < 0.5) { var t = x / 0.5; return rgb(lerp(74, 196, t), lerp(157, 158, t), lerp(107, 62, t)); }
    var u = (x - 0.5) / 0.5;
    return rgb(lerp(196, 191, u), lerp(158, 61, u), lerp(62, 52, u));
  }

  function perfColour(x) {
    /* Everything is fine. */
    x = Math.max(0, Math.min(1, x));
    return rgb(lerp(96, 74, x), lerp(170, 190, x), lerp(126, 130, x));
  }

  Graph.prototype.nodeRadius = function (i) {
    var f = this.flow[i] / this.flowMax;
    return 2.6 + Math.sqrt(f) * 9.5;
  };

  Graph.prototype.draw = function (dt) {
    var ctx = this.ctx, w = this.game.world, i;
    this.t += dt;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);

    /* tier bands */
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
    for (i = 0; i < 5; i++) {
      var cx = (LAYOUT_W / 5) * (i + 0.5) * this.sx;
      ctx.fillStyle = 'rgba(255,255,255,0.022)';
      if (i % 2 === 0) ctx.fillRect((LAYOUT_W / 5) * i * this.sx, 0, (LAYOUT_W / 5) * this.sx, this.h);
      ctx.fillStyle = '#4a525e';
      ctx.textAlign = 'center';
      ctx.fillText(CSC.network.TIERS[i].name.toUpperCase(), cx, this.h - 8);
    }

    var flowMode = this.mode === 'flow';
    var riskMode = this.mode === 'risk';

    /* lanes */
    for (var l = 0; l < w.M; l++) {
      var shareSrc = this.override ? this.override.share : w.lShare;
      if (shareSrc[l] <= 0.0001) continue;
      var a = w.lFrom[l], b = w.lTo[l];
      var x1 = this.px(a), y1 = this.py(a), x2 = this.px(b), y2 = this.py(b);
      var share = shareSrc[l];
      var stalled = this.laneStall[l];
      var lw = 0.35 + share * 1.9;
      var alpha = 0.12 + share * 0.30;
      var col;
      if (riskMode) {
        var lr = Math.max(this.risk[a], this.risk[b]) * (0.55 + share * 0.45);
        col = riskColour(lr);
        alpha = 0.14 + share * 0.42;
      } else if (flowMode) {
        var wave = this.tierWave[w.tier[a]];
        var ph = Math.sin(this.t * 1.5 - w.tier[a] * 0.9);
        lw = 0.35 + share * 1.9 * (1 + (wave - 1) * 0.42 * (0.5 + 0.5 * ph));
        col = 'rgb(150,158,170)';
        alpha = 0.10 + share * 0.24;
      } else {
        col = 'rgb(92,150,118)';
      }
      if (stalled > 0.01) { col = riskColour(0.5 + stalled * 0.5); alpha += stalled * 0.35; }
      ctx.strokeStyle = col;
      ctx.globalAlpha = Math.min(0.9, alpha);
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      var mx = (x1 + x2) / 2, my = (y1 + y2) / 2 - (y2 - y1) * 0.06;
      ctx.quadraticCurveTo(mx, my, x2, y2);
      ctx.stroke();

      /* goods in transit */
      var n = share > 0.5 ? 3 : (share > 0.22 ? 2 : 1);
      var speed = 0.10 + 0.34 / Math.max(1, w.lLT[l]);
      var dim = stalled > 0.4 ? 0.18 : 1;
      for (var k = 0; k < n; k++) {
        var p = ((this.t * speed) + k / n + l * 0.137) % 1;
        var qx = (1 - p) * (1 - p) * x1 + 2 * (1 - p) * p * mx + p * p * x2;
        var qy = (1 - p) * (1 - p) * y1 + 2 * (1 - p) * p * my + p * p * y2;
        ctx.globalAlpha = (0.30 + share * 0.5) * dim;
        ctx.fillStyle = riskMode ? riskColour(this.risk[b]) : (flowMode ? '#aeb6c2' : '#7fc39a');
        ctx.beginPath();
        ctx.arc(qx, qy, 1.15 + share * 1.0, 0, 6.2832);
        ctx.fill();
      }
    }

    /* nodes */
    ctx.globalAlpha = 1;
    for (i = 0; i < w.N; i++) {
      if (w.capBase[i] <= 0 && w.baseDemand[i] <= 0 && w.tier[i] === 4) continue;
      var x = this.px(i), y = this.py(i);
      var r = this.nodeRadius(i);
      var act = this.activity[i];
      var col2;
      if (riskMode) col2 = riskColour(this.risk[i]);
      else if (flowMode) col2 = 'rgb(158,166,178)';
      else col2 = perfColour(0.35 + 0.5 * (this.flow[i] / this.flowMax));

      if (act > 0.02) {
        ctx.globalAlpha = act * 0.30;
        ctx.fillStyle = col2;
        ctx.beginPath();
        ctx.arc(x, y, r + 7 * act, 0, 6.2832);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = col2;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 6.2832);
      ctx.fill();
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = '#0d0f12';
      ctx.lineWidth = 1;
      ctx.stroke();

      if (i === this.hover || i === this.selected) {
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = '#e6eaf0';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(x, y, r + 3.5, 0, 6.2832);
        ctx.stroke();
      }
      this.activity[i] *= 0.94;
    }
    for (var s = 0; s < w.M; s++) this.laneStall[s] *= 0.97;
    ctx.globalAlpha = 1;

    if (this.hover >= 0) this.tooltip(this.hover);
  };

  Graph.prototype.tooltip = function (i) {
    var ctx = this.ctx, w = this.game.world, n = this.game.net.nodes[i];
    var lines = [
      n.name,
      CSC.network.TIERS[w.tier[i]].name + ' · ' + n.region,
      'throughput  ' + Math.round(this.flow[i]) + ' u/wk'
    ];
    if (this.mode === 'risk') {
      var ins = w.idx.inL[i], act = 0;
      for (var k = 0; k < ins.length; k++) if (w.lShare[ins[k]] > 0.0001) act++;
      lines.push('cover       ' + w.buffer[i].toFixed(1) + ' wks');
      lines.push('sources     ' + (w.tier[i] === 0 ? '—' : act));
      lines.push('exposure    ' + Math.round(this.risk[i] * 100) + '%');
    } else {
      lines.push('unit cost   $' + w.unitCost[i].toFixed(2));
      lines.push('utilisation ' + Math.round(100 * Math.min(1.4, this.flow[i] / Math.max(1, w.capacity[i]))) + '%');
    }
    ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
    var wid = 0;
    for (var q = 0; q < lines.length; q++) wid = Math.max(wid, ctx.measureText(lines[q]).width);
    wid += 18;
    var hgt = lines.length * 15 + 12;
    var bx = Math.min(this.w - wid - 6, this.px(i) + 14);
    var by = Math.min(this.h - hgt - 6, this.py(i) - 10);
    ctx.fillStyle = 'rgba(10,12,15,0.94)';
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(bx, by, wid, hgt);
    ctx.fill();
    ctx.stroke();
    ctx.textAlign = 'left';
    for (var j = 0; j < lines.length; j++) {
      ctx.fillStyle = j === 0 ? '#e6eaf0' : (j === 1 ? '#79828f' : '#aab2bd');
      ctx.fillText(lines[j], bx + 9, by + 19 + j * 15);
    }
  };

  Graph.prototype.setMode = function (m) { this.mode = m; };
  Graph.prototype.ping = function (nodes) {
    if (!nodes) return;
    for (var i = 0; i < nodes.length; i++) this.activity[nodes[i]] = 1;
  };
  Graph.prototype.stall = function (lanes, amount) {
    for (var i = 0; i < lanes.length; i++) this.laneStall[lanes[i]] = Math.max(this.laneStall[lanes[i]], amount);
  };

  root.CSC.Graph = Graph;
})(typeof globalThis !== 'undefined' ? globalThis : this);
