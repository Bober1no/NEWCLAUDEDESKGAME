/* How long before the network takes twice as long to come back?
   Recovery time is measured by health.js: weeks of impaired customer service
   after the largest single source is removed for ten weeks, averaged over
   three starting phases, against an identical control run. */
import { load } from './load.mjs';
const CSC = load(['rng', 'network', 'sim', 'health', 'actions', 'agents', 'board', 'game']);
const seeds = (process.argv[2] || 'CASCADE-1,CASCADE-2,CASCADE-3,CASCADE-4,CASCADE-5,CASCADE-6,CASCADE-7,CASCADE-8').split(',');
const turns = +(process.argv[3] || 50);

function cross(hist, base, k) {
  var streak = 0;
  for (var i = 0; i < hist.length; i++) {
    if (hist[i].health.recoverySm >= base * k) {
      streak++;
      if (streak >= 3) return hist[i].turn - 2;
    } else streak = 0;
  }
  return null;
}
const rows = [];
for (const s of seeds) {
  const g = CSC.game.newGame(s, { autoApprove: true });
  CSC.game.autoRun(g, turns);
  const r = {
    seed: s, base: g.baseRecovery,
    x2: cross(g.history, g.baseRecovery, 2),
    x4: cross(g.history, g.baseRecovery, 4),
    x10: cross(g.history, g.baseRecovery, 10),
    final: g.history[g.history.length - 1].health.recoverySm,
    frag: g.history[g.history.length - 1].health.fragility
  };
  rows.push(r);
  console.log(s.padEnd(11), 'handover ' + r.base.toFixed(1) + ' wks →  2× at Q' + String(r.x2).padStart(3) +
    '   4× at Q' + String(r.x4).padStart(3) + '   10× at Q' + String(r.x10).padStart(3) +
    '   final ' + r.final.toFixed(1) + ' wks   fragility ' + r.frag.toFixed(1));
}
function med(a) { const b = a.filter(x => x != null).sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : null; }
function rng2(a) { const b = a.filter(x => x != null).sort((x, y) => x - y); return b.length ? 'Q' + b[0] + '–Q' + b[b.length - 1] : '—'; }
console.log('\nsustained (three consecutive quarters) over ' + seeds.length + ' seeds:');
console.log('  2×  median Q' + med(rows.map(r => r.x2)) + '   range ' + rng2(rows.map(r => r.x2)) +
  '   (' + rows.filter(r => r.x2 != null).length + '/' + rows.length + ' seeds)');
console.log('  4×  median Q' + med(rows.map(r => r.x4)) + '   range ' + rng2(rows.map(r => r.x4)) +
  '   (' + rows.filter(r => r.x4 != null).length + '/' + rows.length + ' seeds)');
console.log(' 10×  median Q' + med(rows.map(r => r.x10)) + '   range ' + rng2(rows.map(r => r.x10)) +
  '   (' + rows.filter(r => r.x10 != null).length + '/' + rows.length + ' seeds)');
