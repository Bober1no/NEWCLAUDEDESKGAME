/**
 * "Sharpen your pencils" — the research tree.
 *
 * A player owns a `mods` bag of multipliers. Every upgrade is a pure function
 * that mutates that bag when it completes, so combat/economy code only ever
 * reads plain numbers and never walks a list of researched techs.
 */

export function freshMods() {
  return {
    dmg: {},        // family → multiplier
    rof: {},        // family → attack-speed multiplier (higher = faster)
    range: {},
    hp: {},
    speed: {},
    meleeDmg: 1,
    buildingHp: 1,
    repairRate: 1,
    healRate: 1,
    heightBonus: 1,
    splash: 1,
    statusPower: 1,
    detectorRange: 1,
    buildSpeed: 1,
    trainSpeed: 1,
    income: { paper: 1, ink: 1, battery: 1, graphite: 1 },
    unlocked: new Set(),
  };
}

const fam = (bag, family, mul) => { bag[family] = (bag[family] || 1) * mul; };

export const TECHS = {

  /* ── Pencil line ──────────────────────────────────────────────────── */
  mechanicalPencil: {
    id: 'mechanicalPencil', name: 'Mechanical Pencil', glyph: '✒️', branch: 'Pencil line',
    desc: 'Click-advance leads. Pencil-family units gain +14% damage and +9% range.',
    cost: { paper: 150, graphite: 90 }, time: 30, requires: [], building: 'infantry',
    apply: (m) => { fam(m.dmg, 'pencil', 1.14); fam(m.range, 'pencil', 1.09); },
  },
  coloredPencils: {
    id: 'coloredPencils', name: 'Coloured Pencil Corps', glyph: '🌈', branch: 'Pencil line',
    desc: 'A whole tin of them. Pencil-family units gain +20% health and +7% speed.',
    cost: { paper: 230, graphite: 140, battery: 20 }, time: 40,
    requires: ['mechanicalPencil'], building: 'infantry',
    apply: (m) => { fam(m.hp, 'pencil', 1.20); fam(m.speed, 'pencil', 1.07); },
  },

  /* ── Pen line ─────────────────────────────────────────────────────── */
  gelPen: {
    id: 'gelPen', name: 'Gel Pen Refill', glyph: '🖊️', branch: 'Pen line',
    desc: 'Smoother flow. Pen-family units attack 24% faster.',
    cost: { ink: 165, graphite: 100 }, time: 32, requires: [], building: 'ink',
    apply: (m) => { fam(m.rof, 'pen', 1.24); },
  },
  fountainPen: {
    id: 'fountainPen', name: 'Fountain Pen Nibs', glyph: '🪶', branch: 'Pen line',
    desc: 'Heavier strokes: +34% damage, −12% attack speed for pen-family units.',
    cost: { ink: 285, graphite: 180, battery: 40 }, time: 45,
    requires: ['gelPen'], building: 'tech',
    apply: (m) => { fam(m.dmg, 'pen', 1.34); fam(m.rof, 'pen', 0.88); },
  },

  /* ── Structural ───────────────────────────────────────────────────── */
  reinforcedTape: {
    id: 'reinforcedTape', name: 'Reinforced Tape', glyph: '🧵', branch: 'Structural',
    desc: 'Cross-hatch every seam. Structures gain +30% health, engineers repair 25% faster.',
    cost: { paper: 265, graphite: 120 }, time: 34, requires: [], building: 'hq',
    apply: (m) => { m.buildingHp *= 1.30; m.repairRate *= 1.25; },
  },
  tallerStacks: {
    id: 'tallerStacks', name: 'Taller Book Stacks', glyph: '📚', branch: 'Structural',
    desc: 'Add another volume. The high-ground bonus is 65% stronger for your units.',
    cost: { paper: 210, graphite: 160, battery: 30 }, time: 36,
    requires: [], building: 'tech',
    apply: (m) => { m.heightBonus *= 1.65; },
  },
  sharpenedEdges: {
    id: 'sharpenedEdges', name: 'Sharpened Edges', glyph: '🔪', branch: 'Structural',
    desc: 'Every blade honed. Melee units deal +18% damage.',
    cost: { ink: 95, graphite: 110 }, time: 30, requires: [], building: 'infantry',
    apply: (m) => { m.meleeDmg *= 1.18; },
  },
  prefabFolding: {
    id: 'prefabFolding', name: 'Prefab Folding', glyph: '📐', branch: 'Structural',
    desc: 'Flat-pack everything. Structures build 30% faster and units train 15% faster.',
    cost: { paper: 240, graphite: 90 }, time: 28, requires: [], building: 'hq',
    apply: (m) => { m.buildSpeed *= 1.30; m.trainSpeed *= 1.15; },
  },

  /* ── Aeronautics ──────────────────────────────────────────────────── */
  aerodynamics: {
    id: 'aerodynamics', name: 'Aerodynamic Folds', glyph: '🪁', branch: 'Aeronautics',
    desc: 'Tighter creases. Aircraft gain +22% speed and +12% health.',
    cost: { battery: 60, graphite: 150 }, time: 34, requires: [], building: 'hangar',
    apply: (m) => { fam(m.speed, 'paper', 1.22); fam(m.hp, 'paper', 1.12); },
  },
  heavyFolds: {
    id: 'heavyFolds', name: 'Cartridge Paper', glyph: '💣', branch: 'Aeronautics',
    desc: 'Heavier stock carries heavier payloads: +18% bomb damage, +30% blast radius.',
    cost: { ink: 150, battery: 110, graphite: 200 }, time: 46,
    requires: ['aerodynamics'], building: 'hangar',
    apply: (m) => { fam(m.dmg, 'paper', 1.18); m.splash *= 1.30; },
  },

  /* ── Logistics ────────────────────────────────────────────────────── */
  bulkReams: {
    id: 'bulkReams', name: 'Bulk Reams', glyph: '📦', branch: 'Logistics',
    desc: 'Buy in five-hundreds. Paper income +30%.',
    cost: { paper: 200, graphite: 60 }, time: 26, requires: [], building: 'hq',
    apply: (m) => { m.income.paper *= 1.30; },
  },
  inkSiphon: {
    id: 'inkSiphon', name: 'Ink Siphon', glyph: '💧', branch: 'Logistics',
    desc: 'Draw straight from the cartridge. Ink income +30%.',
    cost: { ink: 185, graphite: 80 }, time: 28, requires: [], building: 'ink',
    apply: (m) => { m.income.ink *= 1.30; },
  },
  graphiteGrind: {
    id: 'graphiteGrind', name: 'Fine Grind', glyph: '⚙️', branch: 'Logistics',
    desc: 'Twist the sharpener the other way. Graphite income +32%.',
    cost: { paper: 185, graphite: 100 }, time: 28, requires: [], building: 'hq',
    apply: (m) => { m.income.graphite *= 1.32; },
  },
  powerCells: {
    id: 'powerCells', name: 'Power Cells', glyph: '🔋', branch: 'Logistics',
    desc: 'Series-wire the cells. Battery income +38%.',
    cost: { battery: 60, graphite: 140 }, time: 32, requires: [], building: 'tech',
    apply: (m) => { m.income.battery *= 1.38; },
  },

  /* ── Support ──────────────────────────────────────────────────────── */
  fieldKits: {
    id: 'fieldKits', name: 'Field Kits', glyph: '🩹', branch: 'Support',
    desc: 'Erasers issued with a spare. Healing +60%, repairs +25%.',
    cost: { ink: 145, graphite: 90 }, time: 30, requires: [], building: 'tech',
    apply: (m) => { m.healRate *= 1.60; m.repairRate *= 1.25; },
  },
  radarArray: {
    id: 'radarArray', name: 'Radar Array', glyph: '📡', branch: 'Support',
    desc: 'Wider sweep. Detection radius +60% on every detector you own.',
    cost: { battery: 50, graphite: 130 }, time: 30, requires: [], building: 'tech',
    apply: (m) => { m.detectorRange *= 1.60; },
  },
  adhesivePolymer: {
    id: 'adhesivePolymer', name: 'Adhesive Polymer', glyph: '🧪', branch: 'Support',
    desc: 'Nastier chemistry. Slows, burns and marks are 45% stronger and last longer.',
    cost: { ink: 205, graphite: 120 }, time: 34, requires: [], building: 'tech',
    apply: (m) => { m.statusPower *= 1.45; },
  },
};

export const TECH_IDS = Object.keys(TECHS);

export const TECH_BRANCHES = (() => {
  const map = new Map();
  for (const t of Object.values(TECHS)) {
    if (!map.has(t.branch)) map.set(t.branch, []);
    map.get(t.branch).push(t);
  }
  return map;
})();

export function techValue(def) {
  const c = def.cost || {};
  return (c.paper || 0) + (c.ink || 0) * 1.6 + (c.battery || 0) * 4.2 + (c.graphite || 0) * 2.4;
}

/* ── Runtime helpers ─────────────────────────────────────────────────── */

/** Prerequisites researched AND the required building finished? */
export function techAvailable(player, id) {
  const def = TECHS[id];
  if (!def) return false;
  if (player.tech.has(id)) return false;
  for (const r of def.requires) if (!player.tech.has(r)) return false;
  if (def.building && !player.hasFinishedBuilding(def.building)) return false;
  return true;
}

export function techLockReason(player, id) {
  const def = TECHS[id];
  if (!def) return 'Unknown';
  if (player.tech.has(id)) return 'Already researched';
  const missing = def.requires.filter((r) => !player.tech.has(r));
  if (missing.length) return `Needs ${missing.map((r) => TECHS[r].name).join(', ')}`;
  if (def.building && !player.hasFinishedBuilding(def.building)) {
    return `Needs a completed ${def.buildingName || def.building}`;
  }
  return '';
}

/**
 * A research job in progress. Players hold at most one at a time per lab, and
 * the lab drives it forward each tick.
 */
export class ResearchJob {
  constructor(def, speed = 1) {
    this.def = def;
    this.remaining = def.time / speed;
    this.total = def.time / speed;
  }
  get progress() { return 1 - this.remaining / this.total; }
  tick(dt) { this.remaining -= dt; return this.remaining <= 0; }
}
