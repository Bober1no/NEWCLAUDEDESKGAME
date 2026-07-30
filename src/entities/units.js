/**
 * Ground unit definitions.
 *
 * Every field is data only — the runtime `Unit` class reads these and never
 * mutates them. `family` ties a unit to a tech-tree branch.
 *
 *   cost      resource map, missing keys are zero
 *   pop       population/supply consumed
 *   armor     see ARMOR — decides which column of the damage table is used
 *   speed     world units per second on flat desk
 *   sight     vision radius (fog of war + auto-acquire)
 *   radius    collision radius used by movement separation
 *   attack.range      world units, measured centre-to-centre minus radii
 *   attack.cooldown   seconds between swings
 *   attack.projectile null (instant hitscan swipe) | 'bolt' | 'arc' | 'spray'
 */
import { ARMOR, DMG } from '../core/constants.js';

export const UNITS = {

  /* ── Line infantry ────────────────────────────────────────────────── */
  grunt: {
    id: 'grunt', name: 'Pencil Grunt', glyph: '✏️', role: 'Line infantry', family: 'pencil',
    blurb: 'Cheap, balanced, endlessly replaceable. Wins by arriving in numbers.',
    cost: { paper: 55 }, buildTime: 6.5, pop: 1, factory: 'infantry', hotkey: 'Q',
    hp: 115, armor: ARMOR.LIGHT, speed: 10.2, turn: 7, sight: 22, radius: 1.05, height: 3.2,
    attack: {
      damage: 12, type: DMG.PIERCE, range: 7.5, cooldown: 0.85,
      projectile: 'bolt', projectileSpeed: 62, targets: { ground: true, air: false },
    },
  },

  scout: {
    id: 'scout', name: 'Pen Scout', glyph: '🖊️', role: 'Recon / raider', family: 'pen',
    blurb: 'Fastest thing on the desk with the widest eyes. Fragile in a straight fight.',
    cost: { paper: 40, ink: 30 }, buildTime: 5.5, pop: 1, factory: 'ink', hotkey: 'W',
    hp: 72, armor: ARMOR.LIGHT, speed: 17.6, turn: 11, sight: 42, radius: 0.9, height: 3.4,
    attack: {
      damage: 8, type: DMG.PIERCE, range: 8, cooldown: 0.5,
      projectile: 'bolt', projectileSpeed: 74, targets: { ground: true, air: false },
    },
  },

  lancer: {
    id: 'lancer', name: 'Ruler Lancer', glyph: '📏', role: 'Melee shock', family: 'plastic',
    blurb: 'Reach weapon with a charge bonus — keep it moving and it hits like a truck.',
    cost: { paper: 90, ink: 10 }, buildTime: 9.5, pop: 2, factory: 'infantry', hotkey: 'E',
    hp: 200, armor: ARMOR.MEDIUM, speed: 11.2, turn: 8, sight: 20, radius: 1.15, height: 3.6,
    melee: true,
    charge: { minTime: 1.5, bonus: 1.85, decay: 0.9 },
    attack: {
      damage: 27, type: DMG.SLASH, range: 5.0, cooldown: 1.25,
      projectile: null, targets: { ground: true, air: false },
    },
  },

  clipShield: {
    id: 'clipShield', name: 'Clip Shield', glyph: '📎', role: 'Armoured blocker', family: 'metal',
    blurb: 'Bends but does not break. Parks in a chokepoint and refuses to leave.',
    cost: { paper: 125, ink: 20 }, buildTime: 12, pop: 2, factory: 'infantry', hotkey: 'R',
    hp: 440, armor: ARMOR.HEAVY, speed: 7.6, turn: 5.5, sight: 18, radius: 1.5, height: 3.1,
    melee: true, blocker: 1.7,
    attack: {
      damage: 15, type: DMG.BLUNT, range: 4.4, cooldown: 1.4,
      projectile: null, targets: { ground: true, air: false },
    },
  },

  scissor: {
    id: 'scissor', name: 'Scissor Striker', glyph: '✂️', role: 'Burst melee / anti-air', family: 'metal',
    blurb: 'Leaps at aircraft and shreds light infantry. Falls over if you look at it.',
    cost: { paper: 115, ink: 60 }, buildTime: 11, pop: 2, factory: 'infantry', hotkey: 'T',
    hp: 155, armor: ARMOR.LIGHT, speed: 13.6, turn: 10, sight: 23, radius: 1.05, height: 3.5,
    melee: true, leap: 9,
    attack: {
      damage: 40, type: DMG.SLASH, range: 4.6, cooldown: 1.15,
      projectile: null, targets: { ground: true, air: true },
      bonusVs: { air: 1.45 },
    },
  },

  medic: {
    id: 'medic', name: 'Eraser Medic', glyph: '🩹', role: 'Support / healer', family: 'rubber',
    blurb: 'Rubs out the damage. One per squad turns a losing trade into a winning one.',
    cost: { paper: 75, ink: 35 }, buildTime: 9, pop: 1, factory: 'infantry', hotkey: 'Y',
    hp: 135, armor: ARMOR.LIGHT, speed: 10.6, turn: 8, sight: 25, radius: 1.0, height: 2.6,
    attack: null,
    heal: { rate: 17, range: 13, targets: 3 },
  },

  /* ── Ranged & chemical ────────────────────────────────────────────── */
  highlighter: {
    id: 'highlighter', name: 'Highlighter Trooper', glyph: '🖍️', role: 'Area denial', family: 'pen',
    blurb: 'Paints a stripe of burning pigment. Cheap way to make ground unwalkable.',
    cost: { paper: 85, ink: 70 }, buildTime: 10, pop: 2, factory: 'ink', hotkey: 'E',
    hp: 165, armor: ARMOR.MEDIUM, speed: 9.6, turn: 7, sight: 21, radius: 1.1, height: 3.4,
    attack: {
      damage: 10, type: DMG.CHEMICAL, range: 9.5, cooldown: 0.7,
      projectile: 'spray', projectileSpeed: 34,
      splash: { radius: 3.4, falloff: 0.45 },
      status: { type: 'burn', duration: 4.5, power: 8 },
      targets: { ground: true, air: false },
    },
  },

  glue: {
    id: 'glue', name: 'Glue Gunner', glyph: '🧴', role: 'Artillery / control', family: 'adhesive',
    blurb: 'Lobs a blob that splashes and glues everything it touches to the desk.',
    cost: { paper: 100, ink: 110 }, buildTime: 14, pop: 3, factory: 'ink', hotkey: 'R',
    hp: 145, armor: ARMOR.MEDIUM, speed: 7.4, turn: 5, sight: 27, radius: 1.15, height: 3.3,
    attack: {
      damage: 32, type: DMG.CHEMICAL, range: 23, minRange: 5, cooldown: 2.7,
      projectile: 'arc', projectileSpeed: 30,
      splash: { radius: 5.2, falloff: 0.5 },
      status: { type: 'slow', duration: 3.6, power: 0.45 },
      targets: { ground: true, air: false },
    },
  },

  compass: {
    id: 'compass', name: 'Compass Marksman', glyph: '📐', role: 'Precision sniper', family: 'pencil',
    blurb: 'Enormous range, brutal single-target damage, and it loves standing on books.',
    cost: { paper: 75, ink: 150, graphite: 20 }, buildTime: 15, pop: 2, factory: 'ink', hotkey: 'T',
    hp: 108, armor: ARMOR.LIGHT, speed: 8.6, turn: 6, sight: 35, radius: 1.0, height: 3.8,
    heightAffinity: 1.9,   // gains extra from the high-ground bonus
    attack: {
      damage: 66, type: DMG.PIERCE, range: 31, minRange: 6, cooldown: 3.0,
      projectile: 'bolt', projectileSpeed: 110,
      targets: { ground: true, air: true },
      bonusVs: { light: 1.25 },
    },
  },

  /* ── Siege ────────────────────────────────────────────────────────── */
  catapult: {
    id: 'catapult', name: 'Rubber Band Catapult', glyph: '🪃', role: 'Arcing siege', family: 'rubber',
    blurb: 'Arcs over your own line and folds buildings. Helpless if something reaches it.',
    cost: { paper: 155, ink: 90 }, buildTime: 17, pop: 3, factory: 'siege', hotkey: 'Q',
    hp: 235, armor: ARMOR.MEDIUM, speed: 6.6, turn: 4, sight: 25, radius: 1.4, height: 2.8,
    attack: {
      damage: 48, type: DMG.BLUNT, range: 27, minRange: 7, cooldown: 3.4,
      projectile: 'arc', projectileSpeed: 38,
      splash: { radius: 6, falloff: 0.55 },
      bonusVs: { structure: 1.7 },
      targets: { ground: true, air: false },
    },
  },

  breacher: {
    id: 'breacher', name: 'Stapler Breacher', glyph: '📌', role: 'Bunker buster', family: 'metal',
    blurb: 'Walks up to a factory and staples it shut. Slow, tough, and utterly single-minded.',
    cost: { paper: 185, ink: 60, battery: 15 }, buildTime: 20, pop: 4, factory: 'siege', hotkey: 'W',
    hp: 500, armor: ARMOR.HEAVY, speed: 6.0, turn: 4, sight: 18, radius: 1.6, height: 2.9,
    attack: {
      damage: 98, type: DMG.EXPLOSIVE, range: 8, cooldown: 3.0,
      projectile: 'bolt', projectileSpeed: 46,
      splash: { radius: 3, falloff: 0.7 },
      bonusVs: { structure: 2.3 },
      targets: { ground: true, air: false },
    },
  },

  engineer: {
    id: 'engineer', name: 'Tape Engineer', glyph: '🩶', role: 'Repair / bridging', family: 'adhesive',
    blurb: 'Patches structures mid-siege and tapes a walkway over clutter your army cannot cross.',
    cost: { paper: 95, ink: 20 }, buildTime: 10, pop: 1, factory: 'siege', hotkey: 'E',
    hp: 155, armor: ARMOR.MEDIUM, speed: 10.4, turn: 8, sight: 21, radius: 1.05, height: 2.7,
    attack: null,
    repair: { rate: 26, range: 9 },
    bridge: { cost: { paper: 45 }, length: 10, cooldown: 18 },
  },

  tack: {
    id: 'tack', name: 'Tack Trap', glyph: '📍', role: 'Cloaked mine', family: 'metal',
    blurb: 'Sits still, invisible, and ruins exactly one unit\'s day.',
    cost: { paper: 40, ink: 5 }, buildTime: 4, pop: 0, factory: 'siege', hotkey: 'R',
    hp: 45, armor: ARMOR.LIGHT, speed: 0, turn: 0, sight: 14, radius: 0.7, height: 1.2,
    immobile: true, cloak: true, oneShot: true, trigger: 3.6,
    attack: {
      damage: 165, type: DMG.EXPLOSIVE, range: 3.6, cooldown: 99,
      projectile: null,
      splash: { radius: 5.5, falloff: 0.6 },
      targets: { ground: true, air: false },
    },
  },

  /* ── Tech ─────────────────────────────────────────────────────────── */
  spy: {
    id: 'spy', name: 'Sticky Spy', glyph: '🗒️', role: 'Stealth saboteur', family: 'paper',
    blurb: 'Cloaked scout that sticks itself to a factory and jams the production line.',
    cost: { paper: 65, ink: 60, battery: 20 }, buildTime: 12, pop: 1, factory: 'tech', hotkey: 'Q',
    hp: 90, armor: ARMOR.LIGHT, speed: 12.2, turn: 9, sight: 30, radius: 0.9, height: 2.2,
    cloak: true,
    attack: null,
    sabotage: { range: 5, duration: 11, cooldown: 26 },
  },

  radar: {
    id: 'radar', name: 'Protractor Radar', glyph: '🧭', role: 'Detector / spotter', family: 'plastic',
    blurb: 'Sweeps the fog, exposes cloaked units and paints targets for everyone else.',
    cost: { paper: 95, ink: 80, battery: 30 }, buildTime: 14, pop: 2, factory: 'tech', hotkey: 'W',
    hp: 180, armor: ARMOR.MEDIUM, speed: 8.2, turn: 6, sight: 32, radius: 1.15, height: 3.0,
    detector: true, reveal: 42,
    mark: { radius: 22, bonus: 0.14 },
    attack: null,
  },
};

/** Rough resource value of a unit, used by the AI to weigh armies. */
export function unitValue(def) {
  const c = def.cost || {};
  return (c.paper || 0) + (c.ink || 0) * 1.6 + (c.battery || 0) * 4.2 + (c.graphite || 0) * 2.4;
}

export const UNIT_IDS = Object.keys(UNITS);
