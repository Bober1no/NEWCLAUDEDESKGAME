// THE SCRIPT. Pure data + closed-form functions of time. No three.js import, so the
// 2D fallback player, the HUDs, the 3D scenes and the tests all read the same truth.
//
// Times (a, b, at, stage windows) are in BASE seconds inside a reel (screens x 7.5 s).
// The engine stretches real time so every caption is readable (2.8 s + words / 2.3 s).
// $...$ = chemistry (checked by the atom-balance tests). ~...~ = a deliberately unbalanced
// skeleton shown mid-balancing (tests assert these are NOT balanced and are labelled).

export const SCREEN = 7.5;
const clamp01 = x => !(x > 0) ? 0 : x > 1 ? 1 : x;
const sm = (a, b, x) => { const u = clamp01((x - a) / (b - a)); return u * u * (3 - 2 * u); };
const lerp = (a, b, u) => a + (b - a) * u;

// ---------------------------------------------------------------- shared closed-form "physics"
export const PHYS = {
  // Reel 1: balance readings (g). Sealed flask with balloon: constant. Open beaker: CO2 escapes.
  sealedMass: s => 152.36,
  openMass: s => 148.62 - 0.44 * (1 - Math.exp(-Math.max(0, s - 44) / 2.2)),
  // Reel 3: tube temperature (°C) and limewater milkiness 0..1, ZnO hot-yellow 0..1
  tubeTemp: s => s < 3 ? 21 : s < 16 ? lerp(21, 340, sm(3, 16, s)) : lerp(340, 120, sm(19, 24, s)),
  limeMilk: s => sm(9, 17, s),
  znoHot: s => sm(9, 14, s) * (1 - sm(19, 23.5, s)),
  cuCarbBlack: s => sm(35, 39.5, s),
  // Reel 4: Mg in HCl
  mgFizz: s => s < 3 ? 0 : s < 14 ? lerp(1, 0.25, sm(3, 14, s)) : Math.max(0, lerp(0.25, 0, sm(14, 16, s))),
  mgLeft: s => 1 - sm(3, 15, s),
  r4Temp: s => lerp(21, 29, sm(3, 15, s)),
  znCopper: s => sm(26, 35, s),          // copper deposit 0..1 and blue fade
  timelapseHours: s => Math.round(lerp(0, 48, sm(25, 35, s))),
  // Reel 5: titration pH walks 1 -> 7 (sharp near the end-point), CuO dissolving
  titrationPH: s => { const u = sm(3, 14, s); return 1 + 6 * Math.pow(u, 3.2); },
  cuoDissolve: s => sm(20, 27, s),
  // Reel 7: nails, rust coverage 0..1 after `days`
  rustDays: s => lerp(0, 7, sm(27, 41, s)),
  rustCoverage: (kind, days) => ({ dry: 0, oil: 0, tap: 0.42, salt: 0.78 })[kind] * sm(0.4, 7, days),
  // Reel 8 collision box (counts are closed-form, matching the deterministic sim)
  attempts: s => Math.floor(Math.max(0, s - 1) * 9.4),
  successes: s => Math.floor(Math.max(0, s - 1) * 1.6),
  // Gas volume (cm3) curves for rate graphs. Same limiting reactant -> same plateau.
  gasVol: (k, x) => 60 * (1 - Math.exp(-x / k)),
  // Reel 9 investigation data, seeded
  invMass: (tau, x) => 0.44 * (1 - Math.exp(-x / tau)),
};
export const TAU = { powder: 25, chips: 86 };

function seeded(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
// Reel 9 data table: 3 trials x 10 times x 2 conditions, noise +-0.01 g, one outlier (chips trial 2 at 60 s)
export const INV = (() => {
  const rnd = seeded(20251104), times = [30, 60, 90, 120, 150, 180, 210, 240, 270, 300];
  const mk = (tau, outlier) => times.map((x, ti) => {
    const trials = [0, 1, 2].map(k => {
      let v = PHYS.invMass(tau, x) + (rnd() - 0.5) * 0.02;
      if (outlier && k === 1 && x === 60) v -= 0.09;
      return Math.round(v * 100) / 100;
    });
    const kept = outlier && x === 60 ? [trials[0], trials[2]] : trials;
    const mean = kept.reduce((a, b) => a + b, 0) / kept.length;
    return { x, trials, mean: Math.round(mean * 100) / 100, lo: Math.min(...kept), hi: Math.max(...kept), outlier: outlier && x === 60 };
  });
  return { times, powder: mk(TAU.powder, false), chips: mk(TAU.chips, true) };
})();

// ---------------------------------------------------------------- reels
// beat kinds: title, lower, eq, mid, myth, key, tag, hud, say
export const REELS = [];

REELS.push({
  id: 'r1', n: 1, screens: 7, name: 'The language of chemistry', short: 'Language',
  stages: { models: [0, 20.5], scale: [20.5, 38], mass: [38, 52.5] },
  beats: [
    { k: 'title', a: 0, b: 5, kicker: 'Reel 01 · The language of chemistry', title: 'The Language', log: 'Every reaction is written in one alphabet. Learn to read it.' },
    { k: 'lower', a: 4.2, b: 10.5, term: 'Chemical formula', text: 'Chemical formulae show the number and type of atoms in one molecular unit. $H2O$: two hydrogen, one oxygen.' },
    { k: 'lower', a: 10.5, b: 20.5, term: 'Reading subscripts', text: 'The small number counts the atom just before it. $CO2$: one C, two O. $CH4$: one C, four H. $NaCl$ is a lattice, so its formula is a ratio, 1 : 1.' },
    { k: 'hud', a: 1.5, b: 20.5, type: 'formula' },
    { k: 'lower', a: 20.5, b: 27, term: 'Chemical equation', text: 'Chemical equations use formulae to show how atoms in a reaction rearrange to form new products.' },
    { k: 'eq', a: 21, b: 31.5, word: 'hydrogen + oxygen → water', lines: [{ at: 22.5, skel: 'H2 + O2 -> H2O' }, { at: 25.5, skel: 'H2 + O2 -> 2H2O' }, { at: 28.5, sym: '2H2(g) + O2(g) -> 2H2O(l)' }] },
    { k: 'lower', a: 27, b: 33.5, term: 'Balanced', text: 'Chemical equations should always be balanced with the same number of atoms in the reactants and the products. Add whole molecules. Never touch a subscript.' },
    { k: 'myth', a: 31.5, b: 38, myth: 'Just change $H2O$ to $H2O2$ so the oxygens match.', fact: 'A new subscript makes a new substance. $H2O2$ is hydrogen peroxide, not water.' },
    { k: 'eq', a: 32.5, b: 38, word: 'methane + oxygen → carbon dioxide + water', lines: [{ at: 33, skel: 'CH4 + O2 -> CO2 + H2O' }, { at: 35, sym: 'CH4(g) + 2O2(g) -> CO2(g) + 2H2O(g)' }] },
    { k: 'hud', a: 21, b: 38, type: 'tally' },
    { k: 'lower', a: 38, b: 44, term: 'State symbols', text: '(s) solid, (l) liquid, (g) gas, (aq) aqueous: dissolved in water. One goes after every formula.' },
    { k: 'lower', a: 44, b: 49, term: 'Conservation of mass', text: 'Sealed flask: the reading never moves, because no atoms get in or out. Open beaker: the reading drops as gas escapes.' },
    { k: 'eq', a: 41, b: 52.5, word: 'calcium carbonate + hydrochloric acid → calcium chloride + water + carbon dioxide', lines: [{ at: 41.5, sym: 'CaCO3(s) + 2HCl(aq) -> CaCl2(aq) + H2O(l) + CO2(g)' }] },
    { k: 'myth', a: 48.5, b: 52.5, myth: 'Mass is lost in a reaction.', fact: 'The atoms did not vanish. The gas left.' },
    { k: 'hud', a: 38.5, b: 52.5, type: 'balance' }
  ]
});

REELS.push({
  id: 'r2', n: 2, screens: 6, name: 'Synthesis', short: 'Synthesis',
  stages: { balloon: [0, 21], particles: [21, 30.5], mg: [30.5, 45] },
  events: [{ at: 15.2, fx: 'flash' }, { at: 34.5, fx: 'flash' }],
  beats: [
    { k: 'title', a: 0, b: 5, kicker: 'Reel 02 · Synthesis', title: 'Synthesis', log: 'Two things go in. One more complex thing comes out. Sometimes loudly.' },
    { k: 'lower', a: 4.2, b: 10.5, term: 'Synthesis reaction', text: 'A synthesis reaction is when two elements or compounds combine to form a more complex product.' },
    { k: 'tag', a: 5, b: 21, text: 'Teacher demonstration only · goggles on' },
    { k: 'eq', a: 7, b: 21, word: 'hydrogen + oxygen → water', lines: [{ at: 8, sym: '2H2(g) + O2(g) -> 2H2O(l)' }] },
    { k: 'lower', a: 10.5, b: 16, term: 'Notes example', text: 'The synthesis of water from hydrogen and oxygen. The balloon holds hydrogen mixed with air. The lit splint starts it.' },
    { k: 'mid', a: 16, b: 21, html: 'The bang is energy released. The mist is <em>water</em>.' },
    { k: 'lower', a: 21, b: 28, term: 'Atoms rearrange', text: 'H–H and O=O bonds break. The atoms regroup into bent $H2O$ molecules. Four H and two O before; four H and two O after.' },
    { k: 'hud', a: 21.5, b: 30.5, type: 'tally' },
    { k: 'key', a: 27, b: 31, html: 'A + B → AB', sub: 'synthesis' },
    { k: 'lower', a: 31, b: 37, term: 'Application: magnesium in air', text: 'Magnesium burns with a blinding white light and leaves white, crumbly magnesium oxide.' },
    { k: 'eq', a: 31.5, b: 45, word: 'magnesium + oxygen → magnesium oxide', lines: [{ at: 32, sym: '2Mg(s) + O2(g) -> 2MgO(s)' }] },
    { k: 'tag', a: 32, b: 40, text: 'Never look straight at burning magnesium' },
    { k: 'lower', a: 37, b: 45, term: 'Hold that thought', text: 'This is also a combustion and a redox reaction. Magnesium loses electrons to oxygen. Reel 07 comes back for it.' }
  ]
});

REELS.push({
  id: 'r3', n: 3, screens: 6, name: 'Decomposition', short: 'Decomposition',
  stages: { heat: [0, 24.5], particles: [24.5, 33], apps: [33, 45] },
  beats: [
    { k: 'title', a: 0, b: 5, kicker: 'Reel 03 · Decomposition', title: 'Decomposition', log: 'Heat it and the compound falls apart. Then catch what escapes.' },
    { k: 'lower', a: 4.2, b: 10.5, term: 'Decomposition reaction', text: 'A decomposition reaction is when a compound breaks down into two simpler substances.' },
    { k: 'eq', a: 6, b: 15.5, word: 'zinc carbonate → zinc oxide + carbon dioxide', lines: [{ at: 7, sym: 'ZnCO3(s) -> ZnO(s) + CO2(g)' }] },
    { k: 'lower', a: 10.5, b: 16, term: 'The set-up', text: 'Zinc carbonate is heated in a boiling tube. The gas runs down the delivery tube and bubbles through limewater.' },
    { k: 'hud', a: 3, b: 24.5, type: 'temp' },
    { k: 'eq', a: 15.5, b: 24.5, side: true, word: 'How we know it’s carbon dioxide: limewater turns milky', lines: [{ at: 16, sym: 'Ca(OH)2(aq) + CO2(g) -> CaCO3(s) + H2O(l)' }] },
    { k: 'lower', a: 16, b: 21, term: 'Hot vs cold', text: 'Zinc oxide is yellow while hot and white again once it cools. A real property of ZnO.' },
    { k: 'myth', a: 20.5, b: 24.5, myth: 'You can see the carbon dioxide.', fact: '$CO2$ is colourless. You see bubbles and milky limewater, never the gas.' },
    { k: 'lower', a: 24.5, b: 31, term: 'Inside the lattice', text: 'Each carbonate ion, $CO3^2-$, splits. A $CO2$ molecule leaves. The oxide ion, $O^2-$, stays with $Zn^2+$.' },
    { k: 'key', a: 29, b: 33, html: 'AB → A + B', sub: 'decomposition' },
    { k: 'lower', a: 33, b: 39, term: 'Application: copper(II) carbonate', text: 'Green copper(II) carbonate turns black on heating. Black copper(II) oxide is left behind.' },
    { k: 'eq', a: 33.5, b: 39, word: 'copper(II) carbonate → copper(II) oxide + carbon dioxide', lines: [{ at: 34, sym: 'CuCO3(s) -> CuO(s) + CO2(g)' }] },
    { k: 'lower', a: 39, b: 45, term: 'Application: hydrogen peroxide', text: 'Hydrogen peroxide slowly breaks down into water and oxygen on its own. Remember how slow. Reel 08 speeds it up.' },
    { k: 'eq', a: 39.5, b: 45, word: 'hydrogen peroxide → water + oxygen', lines: [{ at: 40, sym: '2H2O2(aq) -> 2H2O(l) + O2(g)' }] }
  ]
});

REELS.push({
  id: 'r4', n: 4, screens: 7, name: 'Single displacement', short: 'Single disp.',
  stages: { fizz: [0, 16.5], pop: [16.5, 24], copper: [24, 36], series: [36, 46], particles: [46, 52.5] },
  events: [{ at: 20.3, fx: 'pop' }],
  beats: [
    { k: 'title', a: 0, b: 5, kicker: 'Reel 04 · Single displacement', title: 'Single Displacement', log: 'One element walks into a compound and takes someone’s place.' },
    { k: 'lower', a: 4.2, b: 10.5, term: 'Single displacement reaction', text: 'A single displacement reaction is when one element replaces another in a compound.' },
    { k: 'eq', a: 6, b: 16.5, word: 'magnesium + hydrochloric acid → magnesium chloride + hydrogen', lines: [{ at: 7, sym: 'Mg(s) + 2HCl(aq) -> MgCl2(aq) + H2(g)' }] },
    { k: 'lower', a: 10.5, b: 16.5, term: 'Notes example', text: 'The displacement of hydrogen from an acid by a metal. The ribbon fizzes, thins and disappears. The tube gets warm.' },
    { k: 'hud', a: 3, b: 16.5, type: 'temp' },
    { k: 'lower', a: 16.5, b: 24, term: 'Test for hydrogen', text: 'Thumb off, lit splint to the mouth of the tube: a squeaky pop means hydrogen.' },
    { k: 'hud', a: 17, b: 24, type: 'wave' },
    { k: 'eq', a: 24, b: 36, word: 'zinc + copper(II) sulfate → zinc sulfate + copper', lines: [{ at: 25, sym: 'Zn(s) + CuSO4(aq) -> ZnSO4(aq) + Cu(s)' }] },
    { k: 'lower', a: 26, b: 36, term: 'Application', text: 'Zinc is more reactive than copper, so it displaces copper from solution. Spongy red-brown copper grows on the zinc as the blue fades.' },
    { k: 'hud', a: 25, b: 36, type: 'clock' },
    { k: 'lower', a: 36, b: 41.5, beyond: true, term: 'Reactivity series', text: 'A more reactive metal displaces a less reactive metal from its compounds.' },
    { k: 'lower', a: 41.5, b: 46, term: 'No reaction', text: 'Copper in zinc sulfate: nothing happens. Copper sits below zinc, so it cannot displace it.' },
    { k: 'lower', a: 46, b: 52.5, term: 'The swap', text: 'A magnesium atom takes hydrogen’s place beside the chloride ions. Freed hydrogen atoms pair up and leave as $H2$.' },
    { k: 'key', a: 48.5, b: 52.5, html: 'A + BC → AC + B', sub: 'single displacement' }
  ]
});

REELS.push({
  id: 'r5', n: 5, screens: 8, name: 'Double displacement 1: neutralisation', short: 'Neutralisation',
  stages: { titration: [0, 18], cuo: [18, 28], marble: [28, 36], bicarb: [36, 44], ui: [44, 50], particles: [50, 60] },
  beats: [
    { k: 'title', a: 0, b: 5, kicker: 'Reel 05 · Double displacement 1', title: 'Neutralisation', log: 'Acid meets base. They trade partners and cancel each other out.' },
    { k: 'lower', a: 4.2, b: 9.5, term: 'Double displacement', text: 'A double displacement reaction is when two reactants exchange a component.' },
    { k: 'lower', a: 9.5, b: 14.5, term: 'Neutralisation', text: 'Neutralisation involves the reaction of an acid and base to form a salt and water.' },
    { k: 'eq', a: 6, b: 18, word: 'metal hydroxide + acid → salt + water', lines: [{ at: 7, word: 'sodium hydroxide + hydrochloric acid → sodium chloride + water' }, { at: 8, sym: 'NaOH(aq) + HCl(aq) -> NaCl(aq) + H2O(l)' }] },
    { k: 'hud', a: 2.5, b: 18, type: 'ph' },
    { k: 'lower', a: 14.5, b: 18, term: 'End point', text: 'Green means pH 7. Evaporate a drop: cubic salt crystals.' },
    { k: 'eq', a: 18, b: 28, word: 'metal oxide + acid → salt + water', lines: [{ at: 18.5, word: 'copper(II) oxide + sulfuric acid → copper(II) sulfate + water' }, { at: 19, sym: 'CuO(s) + H2SO4(aq) -> CuSO4(aq) + H2O(l)' }] },
    { k: 'lower', a: 20, b: 28, term: 'Black to blue', text: 'Black copper(II) oxide stirred into warm dilute sulfuric acid dissolves into a clear blue solution.' },
    { k: 'eq', a: 28, b: 36, word: 'metal carbonate + acid → salt + carbon dioxide + water', lines: [{ at: 28.5, sym: 'CaCO3(s) + 2HCl(aq) -> CaCl2(aq) + H2O(l) + CO2(g)' }] },
    { k: 'lower', a: 29, b: 36, term: 'Fizz', text: 'Carbonates fizz in acid. The bubbles are carbon dioxide, which you could prove with limewater.' },
    { k: 'eq', a: 36, b: 44, word: 'metal hydrogen carbonate + acid → salt + carbon dioxide + water', lines: [{ at: 36.5, sym: 'NaHCO3(s) + HCl(aq) -> NaCl(aq) + H2O(l) + CO2(g)' }] },
    { k: 'lower', a: 37, b: 44, term: 'Naming the salt', text: 'Metal first, then the acid part: hydrochloric gives chloride, sulfuric gives sulfate, nitric gives nitrate.' },
    { k: 'lower', a: 44, b: 50, beyond: true, term: 'Universal indicator', text: 'pH 1–3 red, 4–6 orange to yellow, 7 green, 8–10 blue, 11–14 indigo to violet.' },
    { k: 'myth', a: 46, b: 50, myth: 'Neutral means safe.', fact: 'pH 7 only means neither acidic nor basic. A neutral solution can still be toxic.' },
    { k: 'lower', a: 50, b: 57, term: 'Partner swap', text: '$H^+$ and $OH^-$ join to make $H2O$. $Na^+$ and $Cl^-$ are spectator ions: they drift on as the salt.' },
    { k: 'key', a: 55, b: 60, html: 'acid + base → salt + water', sub: 'neutralisation' }
  ]
});

REELS.push({
  id: 'r6', n: 6, screens: 7, name: 'Double displacement 2: precipitation', short: 'Precipitation',
  stages: { pbi2: [0, 16], trio: [16, 28], table: [28, 46], particles: [46, 52.5] },
  beats: [
    { k: 'title', a: 0, b: 5, kicker: 'Reel 06 · Double displacement 2', title: 'Precipitation', log: 'Two clear liquids. One solid out of nowhere.' },
    { k: 'lower', a: 4.2, b: 10.5, term: 'Precipitate', text: 'In a precipitation reaction, an insoluble compound, known as a precipitate, forms.' },
    { k: 'eq', a: 6, b: 16, word: 'lead(II) nitrate + potassium iodide → lead(II) iodide + potassium nitrate', lines: [{ at: 7, sym: 'Pb(NO3)2(aq) + 2KI(aq) -> PbI2(s) + 2KNO3(aq)' }] },
    { k: 'tag', a: 6, b: 16, text: 'Teacher demonstration · lead compounds are toxic' },
    { k: 'lower', a: 10.5, b: 16, term: 'Golden rain', text: 'Bright yellow lead(II) iodide appears the instant the clear solutions meet, then settles. The liquid above clears.' },
    { k: 'eq', a: 16, b: 28, word: 'Three more pairs, three more solids', lines: [{ at: 16.5, sym: 'AgNO3(aq) + NaCl(aq) -> AgCl(s) + NaNO3(aq)' }, { at: 18, sym: 'CuSO4(aq) + 2NaOH(aq) -> Cu(OH)2(s) + Na2SO4(aq)' }, { at: 19.5, sym: 'BaCl2(aq) + Na2SO4(aq) -> BaSO4(s) + 2NaCl(aq)' }] },
    { k: 'lower', a: 17, b: 22.5, term: 'Colours', text: 'Silver chloride: white. Copper(II) hydroxide: pale blue. Barium sulfate: white.' },
    { k: 'lower', a: 22.5, b: 28, term: 'Exchange', text: 'The ions swap partners. If one new pairing is insoluble, it drops out as a solid.' },
    { k: 'lower', a: 28, b: 33.5, term: 'Solubility rules', text: 'The rules of solubility will determine whether substances are soluble or insoluble.' },
    { k: 'hud', a: 28.5, b: 41, type: 'solubility' },
    { k: 'lower', a: 33.5, b: 41, beyond: true, term: 'Reading the table', text: 'Nitrates and Group 1 compounds always dissolve. Silver and lead chlorides do not. Barium and lead sulfates do not. Most hydroxides and carbonates do not.' },
    { k: 'eq', a: 41, b: 46, word: 'Predict: barium chloride + potassium carbonate. Swap partners, check the table.', lines: [{ at: 42, sym: 'BaCl2(aq) + K2CO3(aq) -> BaCO3(s) + 2KCl(aq)' }] },
    { k: 'mid', a: 41.5, b: 46, html: 'Barium carbonate is <em>insoluble</em>. White precipitate.' },
    { k: 'lower', a: 46, b: 52.5, term: 'The lattice', text: '$Pb^2+$ and $I^-$ ions lock together into a lattice that grows too heavy to stay suspended. $K^+$ and $NO3^-$ stay dissolved.' }
  ]
});

REELS.push({
  id: 'r7', n: 7, screens: 8, name: 'Redox', short: 'Redox',
  stages: { electrons: [0, 20], zncu: [20, 26.5], rust: [26.5, 44], combust: [44, 60] },
  beats: [
    { k: 'title', a: 0, b: 5, kicker: 'Reel 07 · Redox', title: 'Redox', log: 'Somebody always loses electrons. Somebody always takes them.' },
    { k: 'lower', a: 4.2, b: 11, term: 'Redox', text: 'Redox reactions involve the transfer of electrons between reactants through the processes of reduction and oxidation.' },
    { k: 'lower', a: 11, b: 16, term: 'Reduction · oxidation', text: 'Reduction is gain of electrons. Oxidation is loss of electrons.' },
    { k: 'key', a: 13, b: 20, beyond: true, html: 'OIL RIG', sub: 'Oxidation Is Loss · Reduction Is Gain (of electrons)' },
    { k: 'eq', a: 7, b: 20, word: 'Each Mg atom gives away two electrons. Each O₂ molecule takes four.', lines: [{ at: 8, sym: 'Mg(s) -> Mg^2+(s) + 2e^-', note: 'oxidation' }, { at: 10, sym: 'O2(g) + 4e^- -> 2O^2-(s)', note: 'reduction' }, { at: 12, sym: '2Mg(s) + O2(g) -> 2MgO(s)', note: 'overall' }] },
    { k: 'hud', a: 6, b: 26.5, type: 'electrons' },
    { k: 'lower', a: 16, b: 20, term: 'Count them', text: 'Electrons lost always equal electrons gained.' },
    { k: 'eq', a: 20, b: 26.5, word: 'Zinc + copper(II) sulfate was redox all along', lines: [{ at: 20.5, sym: 'Zn(s) -> Zn^2+(aq) + 2e^-', note: 'oxidation' }, { at: 21.5, sym: 'Cu^2+(aq) + 2e^- -> Cu(s)', note: 'reduction' }] },
    { k: 'myth', a: 20.5, b: 26.5, myth: 'Oxidation means reacting with oxygen.', fact: 'Oxidation is loss of electrons. Zinc is oxidised here with no oxygen gas involved.' },
    { k: 'lower', a: 26.5, b: 32, term: 'Corrosion', text: 'Corrosion is a type of oxidation reaction in which a metal rusts and is eaten away.' },
    { k: 'lower', a: 32, b: 39.5, term: 'The nail test', text: 'Dry air: no rust. Boiled water under oil: no rust. Tap water: rust. Salt water: the most rust. Iron needs oxygen and water; salt speeds it up.' },
    { k: 'eq', a: 28, b: 44, word: 'iron + oxygen + water → hydrated iron(III) oxide (rust)', lines: [{ at: 29, sym: '4Fe(s) + 3O2(g) + 2H2O(l) -> 2Fe2O3.H2O(s)', note: 'beyond the notes' }] },
    { k: 'hud', a: 27, b: 44, type: 'clock' },
    { k: 'myth', a: 39.5, b: 44, myth: 'Rust is just dirt on the surface.', fact: 'Rust is a new compound made from the iron itself. The nail loses metal.' },
    { k: 'lower', a: 44, b: 50, term: 'Combustion', text: 'Combustion is a redox reaction. The fuel is oxidised; oxygen is reduced.' },
    { k: 'eq', a: 45, b: 60, word: 'methane + oxygen → carbon dioxide + water', lines: [{ at: 45.5, sym: 'CH4(g) + 2O2(g) -> CO2(g) + 2H2O(g)' }] },
    { k: 'lower', a: 50, b: 56, term: 'Air hole', text: 'Closed: yellow, sooty safety flame. Open: more oxygen, a roaring blue flame.' },
    { k: 'mid', a: 56, b: 60, html: 'No oxygen needed to be <em>oxidised</em>. Just lose electrons.' }
  ]
});

REELS.push({
  id: 'r8', n: 8, screens: 9, name: 'Rates of reaction', short: 'Rates',
  stages: { box: [0, 15], conc: [15, 24], temp: [24, 33], surface: [33, 43], catalyst: [43, 58], graph: [58, 67.5] },
  events: [{ at: 53, fx: 'glow' }],
  beats: [
    { k: 'title', a: 0, b: 5, kicker: 'Reel 08 · Rates of reaction', title: 'Rates', log: 'Same reaction. Different speed. You hold the dial.' },
    { k: 'lower', a: 4.2, b: 10.5, term: 'Rate', text: 'The rate or speed of a reaction can be changed by changing the amount of substance, the temperature or the surface area.' },
    { k: 'lower', a: 10.5, b: 15, beyond: true, term: 'Collision theory', text: 'Particles react only if they collide with enough energy and the right orientation. Flash: success. Bounce: no.' },
    { k: 'hud', a: 2, b: 15, type: 'collide' },
    { k: 'lower', a: 15, b: 24, term: 'Amount', text: 'Marble chips in concentrated acid fizz harder than in dilute. More acid particles in the same volume means more frequent collisions.' },
    { k: 'hud', a: 15.5, b: 43, type: 'rate' },
    { k: 'lower', a: 24, b: 33, term: 'Temperature', text: 'At 50 °C particles move faster. They collide more often, and more collisions have enough energy.' },
    { k: 'lower', a: 33, b: 43, term: 'Surface area', text: 'Same mass of marble as a lump, chips, powder. Smaller pieces expose more particles to the acid, so collisions are more frequent.' },
    { k: 'lower', a: 43, b: 49, term: 'Catalysts', text: 'Catalysts (or enzymes in the body) are chemicals that speed up the rate of the reaction but are not used up.' },
    { k: 'eq', a: 43.5, b: 58, word: 'hydrogen peroxide → water + oxygen (catalyst: manganese dioxide)', lines: [{ at: 44, sym: '2H2O2(aq) -> 2H2O(l) + O2(g)' }] },
    { k: 'lower', a: 49, b: 54, term: 'Proof', text: 'A glowing splint relights: oxygen. Catalase in liver does the same job in your body.' },
    { k: 'hud', a: 50, b: 58, type: 'energy' },
    { k: 'myth', a: 54, b: 58, myth: 'The catalyst gets used up.', fact: 'Same mass before and after: 0.50 g in, 0.50 g out. It offers a lower activation-energy path.' },
    { k: 'lower', a: 58, b: 67.5, term: 'Reading a rate graph', text: 'Gas volume against time. A steeper initial slope means a faster rate. Same amount of limiting reactant gives the same final volume, just sooner.' },
    { k: 'hud', a: 58.5, b: 67.5, type: 'rate', variant: 'lesson' }
  ]
});

REELS.push({
  id: 'r9', n: 9, screens: 10, name: 'Key Science Skills: The Investigation', short: 'Skills',
  stages: { setup: [0, 12], errors: [12, 30], improve: [30, 38], analyse: [38, 52], argue: [52, 60], conclude: [60, 67.5], say: [67.5, 75] },
  beats: [
    { k: 'title', a: 0, b: 5, kicker: 'Reel 09 · Key Science Skills', title: 'The Investigation', log: 'Real data is messy. Your job is to say exactly how messy, and why.' },
    { k: 'lower', a: 4.2, b: 12, term: 'Variables', text: 'Independent: chips or powder. Dependent: mass lost over time. Controlled: acid concentration and volume, mass of marble, temperature.' },
    { k: 'hud', a: 4, b: 38, type: 'balance' },
    { k: 'lower', a: 12, b: 18, term: 'Random error', text: 'The last digit flickers; starting the timer by hand varies. Random errors scatter results both ways. Repeat and average.' },
    { k: 'lower', a: 18, b: 24.5, term: 'Systematic error', text: 'An unzeroed balance reads 0.12 g high every time. Parallax on a cylinder skews every reading. Repeats cannot fix a bias.' },
    { k: 'lower', a: 24.5, b: 30, term: 'Mistakes are not errors', text: 'Spilling acid or misreading the scale is a personal mistake, not an error. Redo that run.' },
    { k: 'lower', a: 30, b: 38, term: 'Limitation → improvement', text: 'Acid spray escapes with the gas, so the mass loss reads too high. Improvement: a cotton-wool plug lets $CO2$ out but traps the spray.' },
    { k: 'lower', a: 38, b: 45, term: 'Analyse', text: 'Three trials each, averaged, error bars show the range. Chips trial 2 at 60 s is an outlier: the timer started late. Exclude it and say why.' },
    { k: 'hud', a: 38.5, b: 67.5, type: 'data' },
    { k: 'lower', a: 45, b: 52, term: 'Quality words', text: 'Precise: repeats agree closely. Accurate: close to the true value. Repeatable: same person, same result. Reproducible: different person or method, same result. Valid: it tests the aim.' },
    { k: 'lower', a: 52, b: 60, term: 'Evidence-based argument', text: 'In the first 60 s powder lost 0.40 g, chips 0.22 g. The steeper initial slope means a faster rate: powder exposes more particles, so collisions are more frequent.' },
    { k: 'lower', a: 60, b: 67.5, term: 'Logical conclusion', text: 'Greater surface area increased the rate, supporting the hypothesis. Both ended with the same total mass loss. Limitation: one temperature only.' },
    { k: 'say', a: 67.5, b: 75, vague: '“The powder one went faster cos it’s smaller.”', precise: '“Powdered marble has a greater surface area, so acid particles collide with it more frequently and the rate of $CO2$ production is higher.”' }
  ]
});

for (const r of REELS) { r.base = r.screens * SCREEN; r.kind = 'ch'; }

// ---------------------------------------------------------------- HUD data, pure functions of reel seconds
const MODELS = [
  { f: 'H2O', at: 1.5, counts: { H: 2, O: 1 } }, { f: 'CO2', at: 5, counts: { C: 1, O: 2 } }, { f: 'CH4', at: 8.5, counts: { C: 1, H: 4 } },
  { f: 'O2', at: 12, counts: { O: 2 } }, { f: 'H2', at: 14, counts: { H: 2 } }, { f: 'NaCl', at: 16, counts: { Na: 1, Cl: 1 }, note: 'ratio in a lattice' }
];
export { MODELS };

export const R1_STEPS = [ // equation-scale states for the tally HUD
  { at: 20.5, L: ['H2', 'O2'], R: ['H2O'], c: [1, 1, 1] },
  { at: 25.5, L: ['H2', 'O2'], R: ['H2O'], c: [1, 1, 2] },
  { at: 27.2, L: ['H2', 'O2'], R: ['H2O'], c: [2, 1, 2] },
  { at: 30.5, L: ['H2', 'O2'], R: ['H2O2'], c: [1, 1, 1], fail: true },
  { at: 33, L: ['CH4', 'O2'], R: ['CO2', 'H2O'], c: [1, 1, 1, 1] },
  { at: 34.2, L: ['CH4', 'O2'], R: ['CO2', 'H2O'], c: [1, 1, 1, 2] },
  { at: 35.2, L: ['CH4', 'O2'], R: ['CO2', 'H2O'], c: [1, 2, 1, 2] }
];
export function r1Step(s) { let cur = R1_STEPS[0]; for (const st of R1_STEPS) if (s >= st.at) cur = st; return cur; }

export const EPI_INDEX = [
  { at: 0.5, reel: '03 Decomposition', type: 'AB → A + B' },
  { at: 7, reel: '04 Single displacement', type: 'A + BC → AC + B' },
  { at: 9.5, reel: '02 Synthesis', type: 'A + B → AB' },
  { at: 11, reel: '05 Neutralisation', type: 'acid + base → salt + water' },
  { at: 15, reel: '06 Precipitation', type: 'AB + CD → AD + CB' },
  { at: 19, reel: '07 Redox', type: 'OIL RIG' },
  { at: 23, reel: '08 Rates', type: 'collisions × energy' },
  { at: 27, reel: '01 Language', type: 'atoms are conserved' }
];

export function hudData(reelId, type, s, variant) {
  switch (type) {
    case 'formula': { let m = null; for (const x of MODELS) if (s >= x.at) m = x; return m; }
    case 'tally': {
      if (reelId === 'r2') return { L: ['H2', 'O2'], R: ['H2O'], c: [2, 1, 2] };
      return r1Step(s);
    }
    case 'balance': {
      if (reelId === 'r9') return { label: 'Balance', g: s < 18 ? 151.27 + (Math.sin(s * 7.3) > 0.6 ? 0.01 : 0) : s < 24.5 ? 151.39 : 151.27, warn: s >= 18 && s < 24.5 ? 'not zeroed: +0.12 g' : '' };
      return { label: s < 44 ? 'Sealed flask' : 'Open beaker', g: s < 44 ? PHYS.sealedMass(s) : PHYS.openMass(s) };
    }
    case 'temp': return { c: reelId === 'r3' ? PHYS.tubeTemp(s) : PHYS.r4Temp(s) };
    case 'ph': return { ph: PHYS.titrationPH(s) };
    case 'clock': return reelId === 'r7' ? { label: 'Time-lapse', v: PHYS.rustDays(s), unit: 'days' } : { label: 'Time-lapse', v: PHYS.timelapseHours(s), unit: 'h' };
    case 'electrons': { let n = 0; for (let k = 0; k < 8; k++) if (s >= 7 + Math.floor(k / 2) * 2.6 + (k % 2) * 1.3 + 1.4) n++; let z = 0; if (s >= 20) for (let i = 0; i < 3; i++) for (let k = 0; k < 2; k++) if (s >= 22.2 + i * 1.3 + k * 0.2) z++; return s >= 20 ? { lost: z, gained: z, who: 'Zn → Cu²⁺' } : { lost: n, gained: n, who: 'Mg → O₂' }; }
    case 'collide': return { tries: PHYS.attempts(s), hits: PHYS.successes(s) };
    case 'wave': return { pop: s >= 20.3 ? Math.min(1, (s - 20.3) / 0.15) : 0, s };
    case 'rate': return rateHud(s, variant);
    case 'energy': return { prog: Math.min(1, Math.max(0, (s - 50) / 3)) };
    case 'data': return { prog: Math.min(1, Math.max(0, (s - 38.5) / 6)), outlier: s >= 40, argue: s >= 52 };
    case 'solubility': return { row: Math.min(5, Math.floor(Math.max(0, s - 29) / 2)) };
    default: return null;
  }
}

function rateHud(s, variant) {
  if (variant === 'lesson') return { title: 'Gas volume vs time', curves: [{ k: 10, label: 'fast', col: '#33D17A' }, { k: 28, label: 'slow', col: '#4D9FFF' }], prog: Math.min(1, (s - 58.5) / 5), tmax: 120, plateau: true };
  if (s < 24) return { title: 'Amount: concentration', curves: [{ k: 14, label: '2.0 M', col: '#FF4859' }, { k: 40, label: '0.5 M', col: '#4D9FFF' }], prog: Math.min(1, (s - 15.5) / 7), tmax: 120 };
  if (s < 33) return { title: 'Temperature', curves: [{ k: 13, label: '50 °C', col: '#FFB23F' }, { k: 38, label: '20 °C', col: '#4D9FFF' }], prog: Math.min(1, (s - 24.5) / 7), tmax: 120 };
  return { title: 'Surface area', curves: [{ k: 8, label: 'powder', col: '#33D17A' }, { k: 24, label: 'chips', col: '#FFE14D' }, { k: 60, label: 'lump', col: '#A98BFF' }], prog: Math.min(1, (s - 33.5) / 8), tmax: 120 };
}

// ---------------------------------------------------------------- special timed sections
export const COLD_OPEN = {
  id: 'cold', kind: 'ch', special: true, name: 'Cold open', short: 'Open', base: 18, screens: 2.4,
  events: [{ at: 4.1, fx: 'splash' }, { at: 6.3, fx: 'flash' }, { at: 11.6, fx: 'slam' }],
  beats: [
    { k: 'brand', a: 11, b: 17.6, html: 'A Year 10 Chemistry production' },
    { k: 'bigtitle', a: 11.4, b: 17.6, html: 'REACTIONS' },
    { k: 'hand', a: 13.2, b: 17.6, html: 'atoms don’t disappear. they just change partners' },
    { k: 'now', a: 15, b: 17.8, html: 'Now playing · Reel 01' }
  ]
};
export const EPILOGUE = {
  id: 'epi', kind: 'ch', special: true, name: 'Epilogue: The Chain Reaction', short: 'Epilogue', base: 32, screens: 4.27,
  events: [{ at: 0.6, fx: 'spark' }, { at: 9.8, fx: 'flash' }, { at: 25.6, fx: 'supernova' }, { at: 27.4, fx: 'flash' }],
  stages: { spark: [0, 3], heat: [3, 7], fizz: [7, 11], wave: [11, 15], ppt: [15, 19], redox: [19, 23], converge: [23, 27], reveal: [27, 32] },
  beats: [
    { k: 'hud', a: 0.3, b: 32, type: 'index' },
    { k: 'endtitle', a: 28.6, b: 32, kicker: 'Unit complete', title: 'REACTIONS', log: 'Every atom accounted for. Now prove you understand it.' }
  ]
};
EPILOGUE.hudIndex = EPI_INDEX;

export const FILM_TITLE = 'The Reactions Film';
