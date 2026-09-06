/* headless.js — run the simulation without a browser.
 *   node tools/headless.cjs [ticks] [seed] [--quiet]
 * Loads the same files the page loads, in the same order.
 */
var path = require('path');
var base = path.join(__dirname, '..', 'js');
['world', 'scorer', 'actions', 'agent', 'main'].forEach(function (m) { require(path.join(base, m + '.js')); });

var SB = globalThis.SB;
var ticks = parseInt(process.argv[2], 10) || 120;
var seed = parseInt(process.argv[3], 10) || 20260906;
var quiet = process.argv.indexOf('--quiet') >= 0;

var Sim = SB.Sim;
Sim.reset(seed);
var counts = {}, streak = { id: null, len: 0, best: 0, bestId: null, startedAt: 0, bestStart: 0 };
var t = Date.now();
for (var i = 0; i < ticks; i++) {
  var r = Sim.step();
  counts[r.move.action] = (counts[r.move.action] || 0) + 1;
  if (r.move.action === streak.id) { streak.len++; } else { streak.id = r.move.action; streak.len = 1; streak.startedAt = r.tick; }
  if (streak.len > streak.best) { streak.best = streak.len; streak.bestId = streak.id; streak.bestStart = streak.startedAt; }
  if (!quiet) { var L = Sim.log[Sim.log.length - 1]; console.log(L.text + (L.sub ? "\n        " + L.sub : "")); }
}
console.log('---');
console.log('ms/tick', ((Date.now() - t) / ticks).toFixed(1));
console.log('action counts', JSON.stringify(counts));
console.log('longest run', streak.bestId, 'x' + streak.best, 'from T' + streak.bestStart);
var w = Sim.world, last = Sim.receipts[Sim.receipts.length - 1];
var rate = 0, mt = 0, mb = 0, syn = 0, edges = 0, n = 0;
for (var p = 0; p < w.n; p++) { if (!w.alive[p]) continue; n++; rate += w.rate[p]; mt += SB.World.meanTrue(w, p); mb += SB.World.meanBelief(w, p); syn += SB.World.synthDegree(w, p); edges += w.relCount[p]; }
console.log('alive', n, 'score', last.score.toLocaleString(), 'eligible', last.eligible);
console.log('meanRate', (rate / n).toFixed(2), 'meanTrue', (mt / n).toFixed(3), 'meanBelief', (mb / n).toFixed(3), 'synthShare', (syn / (edges || 1)).toFixed(3));
console.log('constraints', last.constraints.map(function (c) { return c.id + '=' + (c.pass ? 'hold' : 'FAIL/' + c.violations); }).join(' '));
