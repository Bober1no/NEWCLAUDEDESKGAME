/* CASCADE — headless analysis.
   Which agent pair interacts worst, and how long the network takes to lose
   half its ability to recover. Same engine the game runs on. */
import { load } from './load.mjs';
const CSC = load(['rng', 'network', 'sim', 'health', 'actions', 'agents', 'board', 'game']);

const IDS = ['procurement', 'logistics', 'inventory', 'sales', 'finance'];
const NAME = {};
CSC.agents.AGENTS.forEach(a => { NAME[a.id] = a.name + '/' + a.role; });

const SEEDS = process.argv[2] ? process.argv[2].split(',') : ['CASCADE-1', 'CASCADE-2', 'CASCADE-3'];
const TURNS = +(process.argv[3] || 45);

function run(seed, on) {
  const enabled = {};
  IDS.forEach(id => { enabled[id] = on.indexOf(id) >= 0; });
  const g = CSC.game.newGame(seed, { autoApprove: true, enabled });
  CSC.game.autoRun(g, TURNS);
  const last = g.history[g.history.length - 1];
  return {
    frag: last.health.fragility,
    slack: last.health.slack,
    conc: last.health.concentration,
    rec: last.health.recoverySm,
    otd: last.kpi.otd,
    score: last.score,
    doubled: g.recoveryDoubledAt,
    baseRec: g.baseRecovery,
    turns: g.turn,
    ended: g.endReason
  };
}

const pairAgg = {};
const soloAgg = {};
const doubledFull = [];

for (const seed of SEEDS) {
  process.stderr.write('seed ' + seed + ' … ');
  const none = run(seed, []);
  const solo = {};
  for (const id of IDS) solo[id] = run(seed, [id]);
  const full = run(seed, IDS.slice());
  doubledFull.push({ seed, doubled: full.doubled, baseRec: full.baseRec, rec: full.rec, frag: full.frag });

  for (let i = 0; i < IDS.length; i++) {
    soloAgg[IDS[i]] = soloAgg[IDS[i]] || [];
    soloAgg[IDS[i]].push(solo[IDS[i]].frag - none.frag);
    for (let j = i + 1; j < IDS.length; j++) {
      const a = IDS[i], b = IDS[j];
      const p = run(seed, [a, b]);
      const additive = (solo[a].frag - none.frag) + (solo[b].frag - none.frag);
      const joint = p.frag - none.frag;
      const key = a + '+' + b;
      pairAgg[key] = pairAgg[key] || { excess: [], joint: [], additive: [], otd: [], rec: [], conc: [] };
      pairAgg[key].excess.push(joint - additive);
      pairAgg[key].joint.push(joint);
      pairAgg[key].additive.push(additive);
      pairAgg[key].otd.push(p.otd);
      pairAgg[key].rec.push(p.rec);
      pairAgg[key].conc.push(p.conc - none.conc);
    }
  }
  const sumSolo = IDS.reduce((s, id) => s + (solo[id].frag - none.frag), 0);
  console.log('\n== seed ' + seed + ' (' + TURNS + ' quarters, every proposal approved)');
  console.log('   no agents      fragility ' + none.frag.toFixed(1) + '  otd ' + none.otd.toFixed(1) + '%');
  IDS.forEach(id => console.log('   ' + NAME[id].padEnd(20) + ' +' + (solo[id].frag - none.frag).toFixed(1) +
    '  otd ' + solo[id].otd.toFixed(1) + '%  conc ' + (solo[id].conc * 100).toFixed(1) + '%'));
  console.log('   sum of solos   +' + sumSolo.toFixed(1));
  console.log('   all five       +' + (full.frag - none.frag).toFixed(1) +
    '   (' + ((full.frag - none.frag) / Math.max(0.01, sumSolo)).toFixed(2) + '× the sum)');
  console.log('   recovery time doubled at Q' + full.doubled + ' (baseline ' + full.baseRec + ' wks → ' + full.rec.toFixed(1) + ' wks)');
}

const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const rows = Object.keys(pairAgg).map(k => ({
  pair: k,
  excess: mean(pairAgg[k].excess),
  joint: mean(pairAgg[k].joint),
  additive: mean(pairAgg[k].additive),
  otd: mean(pairAgg[k].otd),
  rec: mean(pairAgg[k].rec),
  conc: mean(pairAgg[k].conc)
})).sort((a, b) => b.excess - a.excess);

console.log('\n== pairwise interaction, mean over ' + SEEDS.length + ' seeds');
console.log('   pair                                    joint   additive   excess    otd     conc   recov');
for (const r of rows) {
  const [a, b] = r.pair.split('+');
  console.log('   ' + (CSC.agents.BY_ID[a].name + ' + ' + CSC.agents.BY_ID[b].name).padEnd(20) +
    (CSC.agents.BY_ID[a].role + '/' + CSC.agents.BY_ID[b].role).padEnd(22) +
    ('+' + r.joint.toFixed(1)).padStart(6) +
    ('+' + r.additive.toFixed(1)).padStart(10) +
    (r.excess >= 0 ? '+' : '') + r.excess.toFixed(1).padStart(8) +
    r.otd.toFixed(1).padStart(8) + '%' +
    (r.conc * 100).toFixed(1).padStart(8) + 'pp' +
    r.rec.toFixed(1).padStart(7));
}
console.log('\n== recovery-time doubling, full board');
doubledFull.forEach(d => console.log('   ' + d.seed + '  Q' + d.doubled + '  (baseline ' + d.baseRec + ' wks)'));
console.log('   mean Q' + mean(doubledFull.map(d => d.doubled)).toFixed(1));
