/* Pacing harness: one auto-approving run, with the diagnostics that matter. */
import { load } from './load.mjs';
const CSC = load(['rng', 'network', 'sim', 'health', 'actions', 'agents', 'board', 'game']);
const seed = process.argv[2] || 'CASCADE-1';
const maxT = +(process.argv[3] || 80);
const g = CSC.game.newGame(seed, { autoApprove: true });
console.log('seed', seed, 'shockTurn', g.shockTurn, 'baseRecovery', g.baseRecovery,
  'baseOTD', g.baseline.otd.toFixed(2));
const counts = {};
while (!g.ended && g.turn < maxT) {
  const ib = CSC.game.beginTurn(g);
  ib.forEach(p => { p.decision = 'approve'; counts[p.actionId] = (counts[p.actionId] || 0) + 1; });
  CSC.game.runQuarter(g);
  const h = g.history[g.history.length - 1];
  const w = g.world, fl = CSC.health.sourceFlows(w);
  const t0f = w.idx.tierN[0].reduce((a, b) => a + fl[b], 0);
  const shockShare = fl[w.shockNode] / t0f;
  let over = 0, worst = 0, headroom = 0, tot = 0;
  for (let j = 0; j < w.N; j++) {
    if (w.capBase[j] <= 0) continue;
    const u = fl[j] / Math.max(1e-6, w.capacity[j]);
    if (u > 1) over++;
    if (u > worst) worst = u;
    headroom += Math.max(0, w.capBase[j] * 1.5 - fl[j]); tot += w.capBase[j] * 1.5;
  }
  if (h.turn % 2 === 0 || h.turn > g.shockTurn - 3) {
    console.log('Q' + String(h.turn).padStart(2),
      'sc', h.score.toFixed(1).padStart(5), (h.pass ? ' ' : '!'),
      'otd', h.kpi.otd.toFixed(1).padStart(5),
      'cost', h.kpi.landedCost.toFixed(1),
      'trn', h.kpi.turns.toFixed(2),
      'atn', h.kpi.attain.toFixed(1).padStart(5),
      'wc', h.kpi.workingCapital.toFixed(2),
      '| frag', h.health.fragility.toFixed(1).padStart(4),
      'slk', h.health.slack.toFixed(0).padStart(3),
      'rec', String(h.health.recovery).padStart(2),
      'bw', h.health.bullwhip.toFixed(1),
      'hhi', h.health.concentration.toFixed(3),
      '| over', String(over).padStart(2), 'worst', worst.toFixed(2),
      'hd', (headroom / tot).toFixed(2), 'shockShare', shockShare.toFixed(3));
  }
}
console.log('ended', g.endReason, 'turn', g.endTurn, 'recovery doubled at', g.recoveryDoubledAt);
console.log(counts);
