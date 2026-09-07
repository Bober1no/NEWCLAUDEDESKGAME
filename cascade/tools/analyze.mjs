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

/* Damage is measured as harm, not as an index: run the configuration to the
   shock, apply the same fixed supplier failure, and see how far customer
   service falls over the following two years. Fragility is reported alongside
   but is a bounded composite and saturates once concentration is total. */
const SHOCK_AT = TURNS;
function run(seed, on) {
  const enabled = {};
  IDS.forEach(id => { enabled[id] = on.indexOf(id) >= 0; });
  const g = CSC.game.newGame(seed, { autoApprove: true, shockTurn: SHOCK_AT, enabled });
  CSC.game.autoRun(g, SHOCK_AT - 1);
  const pre = g.history[g.history.length - 1];
  CSC.game.autoRun(g, SHOCK_AT + 8);
  const after = g.history.filter(h => h.turn >= SHOCK_AT);
  const worst = after.length ? Math.min(...after.map(h => h.kpi.otd)) : pre.kpi.otd;
  const last = g.history[g.history.length - 1];
  return {
    frag: pre.health.fragility,
    conc: pre.health.concentration,
    rec: pre.health.recoverySm,
    preOtd: pre.kpi.otd,
    worstOtd: worst,
    damage: Math.max(0, 100 - worst),
    score: pre.score,
    doubled: g.recoveryDoubledAt,
    baseRec: g.baseRecovery,
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
    soloAgg[IDS[i]].push(solo[IDS[i]].damage - none.damage);
    for (let j = i + 1; j < IDS.length; j++) {
      const a = IDS[i], b = IDS[j];
      const p = run(seed, [a, b]);
      const additive = (solo[a].damage - none.damage) + (solo[b].damage - none.damage);
      const joint = p.damage - none.damage;
      const key = a + '+' + b;
      pairAgg[key] = pairAgg[key] || { excess: [], joint: [], additive: [], otd: [], rec: [], conc: [] };
      pairAgg[key].excess.push(joint - additive);
      pairAgg[key].joint.push(joint);
      pairAgg[key].additive.push(additive);
      pairAgg[key].otd.push(p.worstOtd);
      pairAgg[key].rec.push(p.rec);
      pairAgg[key].conc.push(p.conc - none.conc);
    }
  }
  const sumSolo = IDS.reduce((s, id) => s + (solo[id].damage - none.damage), 0);
  console.log('\n== seed ' + seed + ' — shock applied at Q' + SHOCK_AT + ', every proposal approved');
  console.log('   configuration        pre-shock OTD   worst OTD after   service lost   fragility   concentration');
  console.log('   no agents' + ''.padEnd(12) + none.preOtd.toFixed(1).padStart(12) + '%' +
    none.worstOtd.toFixed(1).padStart(16) + '%' + ('+' + (0).toFixed(1)).padStart(14) +
    none.frag.toFixed(1).padStart(12) + (none.conc * 100).toFixed(1).padStart(15) + '%');
  IDS.forEach(id => console.log('   ' + NAME[id].padEnd(21) + solo[id].preOtd.toFixed(1).padStart(11) + '%' +
    solo[id].worstOtd.toFixed(1).padStart(16) + '%' +
    ('+' + (solo[id].damage - none.damage).toFixed(1)).padStart(14) +
    solo[id].frag.toFixed(1).padStart(12) + (solo[id].conc * 100).toFixed(1).padStart(15) + '%'));
  console.log('   sum of the five solos' + ('+' + sumSolo.toFixed(1)).padStart(41));
  console.log('   ' + 'all five'.padEnd(21) + full.preOtd.toFixed(1).padStart(11) + '%' +
    full.worstOtd.toFixed(1).padStart(16) + '%' + ('+' + (full.damage - none.damage).toFixed(1)).padStart(14) +
    full.frag.toFixed(1).padStart(12) + (full.conc * 100).toFixed(1).padStart(15) + '%' +
    '   (' + ((full.damage - none.damage) / Math.max(0.01, sumSolo)).toFixed(2) + '× the sum)');
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
console.log('   service lost to the same fixed supplier failure, points of on-time delivery');
console.log('   pair                                    joint   additive   excess  worstOTD    conc   recov');
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
