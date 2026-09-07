/* CASCADE — network genesis.
   Builds the five-tier supply network and the initial policy state. Everything
   here is a pure function of the seed. */
(function (root) {
  'use strict';
  var CSC = root.CSC;

  var MAXLT = 24;          // pipeline ring-buffer depth, weeks
  var WEEKS_PER_QUARTER = 13;

  var TIERS = [
    { key: 0, name: 'Raw Materials', count: 24 },
    { key: 1, name: 'Components',    count: 20 },
    { key: 2, name: 'Sub-Assembly',  count: 16 },
    { key: 3, name: 'Manufacturing', count: 10 },
    { key: 4, name: 'Distribution',  count: 12 }
  ];

  var NAME_A = ['Meridian', 'Kestrel', 'Halcyon', 'Arden', 'Voss', 'Brightmoor', 'Calder', 'Novak',
    'Pallas', 'Rhodes', 'Sable', 'Torvald', 'Umber', 'Vantage', 'Wexler', 'Ynor', 'Zeller',
    'Ashgrove', 'Berring', 'Corvid', 'Delve', 'Eastwick', 'Fenmark', 'Grayline', 'Holt',
    'Ivorton', 'Jarrow', 'Kline', 'Lorne', 'Marlow', 'Nither', 'Orsk', 'Pell', 'Quill',
    'Redgate', 'Stroud', 'Thane', 'Ulric', 'Verity', 'Whitlock'];
  var NAME_B = {
    0: ['Extraction', 'Minerals', 'Feedstock', 'Resources', 'Raw', 'Basins', 'Ore', 'Refining'],
    1: ['Components', 'Precision', 'Fabrication', 'Elements', 'Tooling', 'Castings'],
    2: ['Assemblies', 'Modules', 'Systems', 'Subworks', 'Integration'],
    3: ['Works', 'Plant', 'Manufacturing', 'Fabworks'],
    4: ['Distribution', 'Depot', 'Regional', 'Fulfilment', 'Channel']
  };
  var REGIONS = ['APAC-N', 'APAC-S', 'EMEA-W', 'EMEA-E', 'LATAM', 'NA-E', 'NA-W', 'NA-C'];

  function build(seed) {
    var rng = new CSC.RNG(seed);
    var nodes = [];
    var tierIndex = [[], [], [], [], []];
    var usedNames = {};

    for (var t = 0; t < TIERS.length; t++) {
      for (var k = 0; k < TIERS[t].count; k++) {
        var nm;
        var guard = 0;
        do {
          nm = rng.pick(NAME_A) + ' ' + rng.pick(NAME_B[t]);
          guard++;
        } while (usedNames[nm] && guard < 40);
        usedNames[nm] = 1;

        /* Cost and reliability are anti-correlated, and this is the whole
           point: the cheapest sources are the least robust, and no agent's
           permitted observation slice contains reliability. */
        var costRoll = rng.next();
        var base = [10, 26, 52, 96, 132][t];
        var spread = [9, 16, 22, 26, 20][t];
        var unitCost = base + costRoll * spread;
        var reliability = 0.905 + costRoll * 0.088 + rng.range(-0.012, 0.012);
        if (reliability > 0.995) reliability = 0.995;
        if (reliability < 0.88) reliability = 0.88;

        /* Cheap sources are also distant. */
        var ltBase = Math.round(2 + (1 - costRoll) * 7 + rng.range(0, 2));

        nodes.push({
          id: nodes.length,
          tier: t,
          name: nm,
          region: rng.pick(REGIONS),
          unitCost: unitCost,
          reliability: reliability,
          leadTimeBase: ltBase,
          capacity: 0,
          costRoll: costRoll
        });
        tierIndex[t].push(nodes.length - 1);
      }
    }

    /* Lanes: each node draws from 2-3 upstream sources. Redundancy is the
       network's initial slack and the agents will spend it. */
    var lanes = [];
    for (var tt = 1; tt < TIERS.length; tt++) {
      var up = tierIndex[tt - 1];
      for (var ii = 0; ii < tierIndex[tt].length; ii++) {
        var node = tierIndex[tt][ii];
        var want = rng.next() < 0.42 ? 3 : 2;
        var pool = up.slice();
        rng.shuffle(pool);
        var chosen = pool.slice(0, want);
        var shares = [];
        var sum = 0;
        for (var c = 0; c < chosen.length; c++) { var s = rng.range(0.7, 1.3); shares.push(s); sum += s; }
        for (var c2 = 0; c2 < chosen.length; c2++) {
          var sup = nodes[chosen[c2]];
          var mode = sup.leadTimeBase >= 7 ? 1 : 0; // 1 = ocean/long-haul, 0 = road/rail
          lanes.push({
            id: lanes.length,
            from: chosen[c2],
            to: node,
            share: shares[c2] / sum,
            lt: Math.max(1, sup.leadTimeBase + (mode === 1 ? 2 : 0)),
            cost: mode === 1 ? rng.range(1.1, 2.4) : rng.range(2.6, 4.4),
            mode: mode
          });
        }
      }
    }

    /* Dormant alternates. Every node keeps qualified-but-unused sources on
       file at share 0. Agents activate them; topology never grows at runtime,
       which keeps every cloned-world evaluation the same shape as the real one. */
    for (var td = 1; td < TIERS.length; td++) {
      var upd = tierIndex[td - 1];
      for (var jd = 0; jd < tierIndex[td].length; jd++) {
        var nd = tierIndex[td][jd];
        var have = {};
        for (var lz = 0; lz < lanes.length; lz++) if (lanes[lz].to === nd) have[lanes[lz].from] = 1;
        var alts = [];
        for (var az = 0; az < upd.length; az++) if (!have[upd[az]]) alts.push(upd[az]);
        /* Cheapest-first: this is what a procurement system would shortlist. */
        alts.sort(function (x, y) { return nodes[x].unitCost - nodes[y].unitCost; });
        /* A shortlist, not the single global cheapest: three drawn from the
           cheapest eight that qualify for this node. */
        var cheapest = alts[0];
        var pool8 = alts.slice(1, Math.min(9, alts.length));
        rng.shuffle(pool8);
        var take = [cheapest].concat(pool8.slice(0, 2));
        for (var kz = 0; kz < take.length; kz++) {
          var sp = nodes[take[kz]];
          var md = sp.leadTimeBase >= 7 ? 1 : 0;
          lanes.push({
            id: lanes.length,
            from: take[kz], to: nd, share: 0,
            lt: Math.max(1, sp.leadTimeBase + (md === 1 ? 2 : 0)),
            cost: md === 1 ? rng.range(1.1, 2.4) : rng.range(2.6, 4.4),
            mode: md
          });
        }
      }
    }

    /* Demand at tier 4. */
    var totalDemand = 0;
    for (var d = 0; d < tierIndex[4].length; d++) {
      var dn = nodes[tierIndex[4][d]];
      dn.baseDemand = rng.range(140, 320);
      totalDemand += dn.baseDemand;
    }

    /* Capacity sized from downstream pull, with generous initial headroom.
       That headroom is slack: it is not visible on any board KPI. */
    var pull = new Float64Array(nodes.length);
    for (var q = 0; q < tierIndex[4].length; q++) pull[tierIndex[4][q]] = nodes[tierIndex[4][q]].baseDemand;
    for (var tb = 4; tb >= 1; tb--) {
      for (var li = 0; li < lanes.length; li++) {
        var L = lanes[li];
        if (nodes[L.to].tier !== tb) continue;
        pull[L.from] += pull[L.to] * L.share;
      }
    }
    /* Nobody builds a plant sized to exactly one customer. Sites are sized to
       a tier-typical volume, which is why volume can move at all. */
    var tierPull = [0, 0, 0, 0, 0], tierN2 = [0, 0, 0, 0, 0];
    for (var tp = 0; tp < nodes.length; tp++) { tierPull[nodes[tp].tier] += pull[tp]; tierN2[nodes[tp].tier]++; }
    for (var tq = 0; tq < 5; tq++) tierPull[tq] /= Math.max(1, tierN2[tq]);

    var totalDem = 0;
    for (var dz = 0; dz < tierIndex[4].length; dz++) totalDem += nodes[tierIndex[4][dz]].baseDemand;

    /* The anchor source: the cheapest producer in the market, and the largest.
       It can serve almost the whole network on its own, which is exactly why
       the whole network ends up served by it. */
    var anchor = tierIndex[0][0];
    for (var az2 = 1; az2 < tierIndex[0].length; az2++) {
      if (nodes[tierIndex[0][az2]].unitCost < nodes[anchor].unitCost) anchor = tierIndex[0][az2];
    }

    /* Tier 0 is the outside world. Capacity follows the cost curve steeply and
       monotonically: in this market the cheap producers are the large ones, so
       whichever cheap source a buyer consolidates onto has room for the volume.
       What it does not have is a substitute, once the alternates are dropped. */
    for (var pz = 0; pz < tierIndex[0].length; pz++) {
      var nz = tierIndex[0][pz];
      var scale = 0.12 + 1.70 * Math.pow(1 - nodes[nz].costRoll, 2);
      nodes[nz].capacity = Math.max(pull[nz] * 2.0, totalDem * scale);
      nodes[nz].pull = pull[nz];
    }

    for (var ni = 0; ni < nodes.length; ni++) {
      if (nodes[ni].tier === 0) continue;
      var sized = Math.max(pull[ni], tierPull[nodes[ni].tier] * 0.55);
      /* Inside the company, capacity is a decision, not a constraint: plants
         and depots are built for the volume they are given. What binds is the
         supply market, the lead time and the cover policy. */
      nodes[ni].capacity = Math.max(30, sized * rng.range(1.95, 2.45) * 1.9);
      nodes[ni].pull = pull[ni];
    }

    /* The supplier that fails is fixed at genesis: the cheapest tier-0 source.
       Its magnitude never scales with turn number. Whether it cascades depends
       only on how much redundancy is left when it goes. */
    var shockNode = tierIndex[0][0];
    for (var z = 0; z < tierIndex[0].length; z++) {
      if (nodes[tierIndex[0][z]].unitCost < nodes[shockNode].unitCost) shockNode = tierIndex[0][z];
    }

    var shockRng = CSC.derive(seed, 'shock-timing');
    var shockTurn = 45 + shockRng.int(16); // 45..60 inclusive

    layout(nodes, lanes, CSC.derive(seed, 'layout'));

    return {
      nodes: nodes, lanes: lanes, tierIndex: tierIndex,
      shockNode: shockNode, shockTurn: shockTurn,
      tiers: TIERS, seed: seed
    };
  }

  /* Tier-anchored force layout. Deterministic; runs once at genesis. */
  function layout(nodes, lanes, rng) {
    var W = 1000, H = 620;
    var colW = W / TIERS.length;
    var i, j;
    for (i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      n.px = colW * (n.tier + 0.5) + rng.range(-26, 26);
      n.py = 40 + rng.next() * (H - 80);
      n.vx = 0; n.vy = 0;
    }
    var adj = [];
    for (i = 0; i < nodes.length; i++) adj.push([]);
    for (i = 0; i < lanes.length; i++) { adj[lanes[i].from].push(lanes[i].to); adj[lanes[i].to].push(lanes[i].from); }

    for (var iter = 0; iter < 320; iter++) {
      for (i = 0; i < nodes.length; i++) { nodes[i].vx *= 0.86; nodes[i].vy *= 0.86; }
      // repulsion within neighbouring columns
      for (i = 0; i < nodes.length; i++) {
        for (j = i + 1; j < nodes.length; j++) {
          var a = nodes[i], b = nodes[j];
          if (Math.abs(a.tier - b.tier) > 1) continue;
          var dx = a.px - b.px, dy = a.py - b.py;
          var d2 = dx * dx + dy * dy + 0.01;
          if (d2 > 34000) continue;
          var f = 900 / d2;
          var d = Math.sqrt(d2);
          a.vx += (dx / d) * f; a.vy += (dy / d) * f;
          b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
        }
      }
      // attraction along lanes (vertical only; x stays tier-anchored)
      for (i = 0; i < lanes.length; i++) {
        var s = nodes[lanes[i].from], t2 = nodes[lanes[i].to];
        var dyy = t2.py - s.py;
        s.vy += dyy * 0.0055; t2.vy -= dyy * 0.0055;
      }
      for (i = 0; i < nodes.length; i++) {
        var nn = nodes[i];
        nn.py += Math.max(-6, Math.min(6, nn.vy));
        nn.px += Math.max(-2, Math.min(2, nn.vx));
        var anchor = colW * (nn.tier + 0.5);
        nn.px += (anchor - nn.px) * 0.14;
        if (nn.py < 34) { nn.py = 34; nn.vy = 0; }
        if (nn.py > H - 34) { nn.py = H - 34; nn.vy = 0; }
      }
    }
    for (i = 0; i < nodes.length; i++) { delete nodes[i].vx; delete nodes[i].vy; }
  }

  root.CSC.network = { build: build, TIERS: TIERS, MAXLT: MAXLT, WEEKS_PER_QUARTER: WEEKS_PER_QUARTER };
})(typeof globalThis !== 'undefined' ? globalThis : this);
