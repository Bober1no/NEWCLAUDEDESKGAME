/**
 * Global tuning constants, enums and lookup tables for DESK WARS.
 * Pure data — this module imports nothing so everything else can import it.
 */

/* ── Teams ──────────────────────────────────────────────────────────── */
export const TEAM = { PLAYER: 0, AI: 1, NEUTRAL: 2 };

export const TEAM_COLORS = {
  0: { primary: 0x4a8fe7, accent: 0xa8d0ff, dark: 0x21456f, css: '#4a8fe7', name: 'Graphite Blue' },
  1: { primary: 0xe2564a, accent: 0xffb0a3, dark: 0x7a2b23, css: '#e2564a', name: 'Crimson Ink' },
  2: { primary: 0xb9a98f, accent: 0xe4d9c4, dark: 0x6b6053, css: '#b9a98f', name: 'Unclaimed' },
};

/* ── Resources ──────────────────────────────────────────────────────── */
export const RES = ['paper', 'ink', 'battery', 'graphite'];

export const RES_META = {
  paper:    { label: 'Paper',    css: '#efe3c8', hex: 0xefe3c8, glyph: '📄', blurb: 'Basic currency. Funds infantry and cheap structures.' },
  ink:      { label: 'Ink',      css: '#5b7cff', hex: 0x5b7cff, glyph: '🖋️', blurb: 'Funds ranged and precision units.' },
  battery:  { label: 'Batteries',css: '#56d6a0', hex: 0x56d6a0, glyph: '🔋', blurb: 'Scarce and contested. Gates tech buildings and aircraft.' },
  graphite: { label: 'Graphite', css: '#9aa4b2', hex: 0x9aa4b2, glyph: '⚙️',  blurb: 'Ground from sharpeners. Buys upgrades.' },
};

export const START_RESOURCES = {
  lean:     { paper: 400, ink: 150, battery: 30,  graphite: 60  },
  standard: { paper: 750, ink: 300, battery: 80,  graphite: 140 },
  rich:     { paper: 1600, ink: 750, battery: 220, graphite: 400 },
};

/* ── Combat tables ──────────────────────────────────────────────────── */
export const ARMOR = {
  LIGHT: 'light',        // flesh-of-the-desk: pencils, pens, sticky notes
  MEDIUM: 'medium',      // rulers, staplers, glue
  HEAVY: 'heavy',        // clip shields, tins
  STRUCTURE: 'structure',// buildings
  AIR: 'air',            // paper aircraft
};

export const DMG = {
  PIERCE: 'pierce',
  BLUNT: 'blunt',
  SLASH: 'slash',
  EXPLOSIVE: 'explosive',
  CHEMICAL: 'chemical',
};

/** damageType → armorType → multiplier */
export const DAMAGE_TABLE = {
  pierce:    { light: 1.30, medium: 1.00, heavy: 0.70, structure: 0.55, air: 1.05 },
  blunt:     { light: 1.00, medium: 1.15, heavy: 0.95, structure: 0.80, air: 0.65 },
  slash:     { light: 1.40, medium: 1.00, heavy: 0.60, structure: 0.45, air: 1.25 },
  explosive: { light: 0.85, medium: 1.10, heavy: 1.25, structure: 1.65, air: 0.55 },
  chemical:  { light: 1.35, medium: 1.10, heavy: 0.75, structure: 0.30, air: 0.85 },
};

export function damageMultiplier(damageType, armorType) {
  const row = DAMAGE_TABLE[damageType];
  if (!row) return 1;
  return row[armorType] ?? 1;
}

/* ── World / map ────────────────────────────────────────────────────── */
export const WORLD = {
  W: 176,            // desk length along X
  D: 112,            // desk depth along Z
  CELL: 2,           // pathfinding cell size
  VISION_CELL: 4,    // fog-of-war cell size
  AIR_ALTITUDE: 13,  // cruising height of paper aircraft
  DESK_THICKNESS: 5,
};

export const GRID_W = Math.round(WORLD.W / WORLD.CELL);
export const GRID_D = Math.round(WORLD.D / WORLD.CELL);
export const FOG_W = Math.round(WORLD.W / WORLD.VISION_CELL);
export const FOG_D = Math.round(WORLD.D / WORLD.VISION_CELL);

/* Terrain flags packed per cell */
export const CELLFLAG = {
  OPEN: 0,
  BLOCKED: 1,      // props, buildings — impassable to ground
  CLUTTER: 2,      // paper clips / shavings — slows movement
  ELEVATED: 4,     // book plateau
  RAMP: 8,         // climbable transition
  BRIDGE: 16,      // tape bridge laid by an engineer
};

/* ── Height advantage ───────────────────────────────────────────────── */
export const HEIGHT_BONUS = {
  MIN_DELTA: 1.4,      // metres of height needed before the bonus applies
  DAMAGE: 0.18,        // +18% damage shooting downhill
  RANGE: 0.22,         // +22% range
  VISION: 0.35,        // +35% sight radius while standing high
};

/* ── Status effects ─────────────────────────────────────────────────── */
export const STATUS = {
  SLOW: 'slow',        // glue
  BURN: 'burn',        // highlighter DoT
  DISABLED: 'disabled',// sticky-note sabotage
  MARKED: 'marked',    // protractor radar paints a target: +damage taken
  HEAL: 'heal',        // eraser medic
};

/* ── Population ─────────────────────────────────────────────────────── */
export const POP = { START_CAP: 24, PER_TRAY: 12, MAX: 96 };

/* ── Layers used for raycasting groups ──────────────────────────────── */
export const PICK = { GROUND: 1, ENTITY: 2 };

/* ── Command orders ─────────────────────────────────────────────────── */
export const ORDER = {
  IDLE: 'idle',
  MOVE: 'move',
  ATTACK_MOVE: 'attackMove',
  ATTACK: 'attack',
  HOLD: 'hold',
  PATROL: 'patrol',
  REPAIR: 'repair',
  BUILD_BRIDGE: 'bridge',
  SABOTAGE: 'sabotage',
  DEPLOY: 'deploy',
};

/* ── Victory ────────────────────────────────────────────────────────── */
export const VICTORY = {
  DOMINATION: 'domination',
  CONTROL: 'control',
  ANNIHILATION: 'annihilation',
};

export const CONTROL_TARGET_SECONDS = 240;  // banked majority time needed
export const MATCH_TIME_LIMIT = 60 * 45;    // hard stop, then highest score wins

/* ── AI presets ─────────────────────────────────────────────────────── */
export const AI_PRESETS = {
  easy: {
    label: 'Easy',
    think: 1.25,          // seconds between decision passes
    economy: 0.82,        // income multiplier (handicap)
    aggression: 0.32,     // 0..1 — how eagerly it attacks
    tech: 0.28,           // 0..1 — how hard it pushes up the tech tree
    micro: 0,             // 0 none · 1 basic retreat · 2 focus fire + kiting
    scout: 0.2,
    counterBuild: 0,
    maxSimulBuilds: 1,
    armyPushValue: 900,   // resource value of army before it commits
    reinforceRatio: 0.35,
  },
  medium: {
    label: 'Medium',
    think: 0.7, economy: 1.0, aggression: 0.55, tech: 0.55, micro: 1,
    scout: 0.55, counterBuild: 0.4, maxSimulBuilds: 2,
    armyPushValue: 1400, reinforceRatio: 0.55,
  },
  hard: {
    label: 'Hard',
    think: 0.34, economy: 1.22, aggression: 0.82, tech: 0.85, micro: 2,
    scout: 0.9, counterBuild: 1, maxSimulBuilds: 3,
    armyPushValue: 1750, reinforceRatio: 0.8,
  },
};

/** Build a preset from the custom sliders (each 0..100). */
export function customPreset({ reaction = 55, economy = 55, aggression = 55, tech = 55 }) {
  const n = (v) => v / 100;
  return {
    label: 'Custom',
    think: 1.5 - n(reaction) * 1.2,
    economy: 0.75 + n(economy) * 0.6,
    aggression: 0.15 + n(aggression) * 0.8,
    tech: n(tech),
    micro: reaction > 75 ? 2 : reaction > 40 ? 1 : 0,
    scout: 0.15 + n(reaction) * 0.8,
    counterBuild: n(tech) * 0.6 + n(reaction) * 0.4,
    maxSimulBuilds: 1 + Math.round(n(economy) * 2),
    armyPushValue: 2200 - n(aggression) * 1500,
    reinforceRatio: 0.25 + n(aggression) * 0.6,
  };
}

/* ── Misc balance knobs ─────────────────────────────────────────────── */
export const BALANCE = {
  BUILD_RADIUS: 34,          // how far from your structures you may build
  EXTRACTOR_RANGE: 7,        // snap distance to a resource node
  REPAIR_RATE: 26,           // hp/s from a tape engineer
  REPAIR_COST_PER_HP: 0.35,  // paper
  VETERANCY_KILLS: [0, 2, 5, 10],
  VETERANCY_BONUS: 0.09,     // per rank: +9% damage and hp
  CLOAK_DETECT_RANGE: 16,
  SALVAGE_REFUND: 0.55,      // resources returned when you scrap a building
  PROJECTILE_LIFETIME: 6,
  CORPSE_FADE: 4.5,
};
