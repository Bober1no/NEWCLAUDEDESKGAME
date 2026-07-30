/**
 * Structures. Everything a player owns that does not walk.
 *
 *   produces   unit ids this factory can queue
 *   requires   building ids that must exist and be finished first
 *   income     passive resources per second (before upgrades / difficulty)
 *   onNode     may only be placed on a matching resource node
 *   footprint  half-extents in world units, used for placement + grid blocking
 */
import { ARMOR, DMG } from '../core/constants.js';

export const BUILDINGS = {

  hq: {
    id: 'hq', name: 'Calculator HQ', glyph: '🧮', role: 'Command centre',
    blurb: 'The brain of your side of the desk. Trickles resources, trains basics, sees far. Lose it and Domination is over.',
    cost: { paper: 400 }, buildTime: 40, hp: 3400, armor: ARMOR.STRUCTURE,
    footprint: [7.5, 5.0], height: 3.2, sight: 32, detector: true,
    produces: ['engineer', 'scout', 'grunt'],
    income: { paper: 2.2, ink: 0.5 },
    unique: true, hotkey: '',
  },

  infantry: {
    id: 'infantry', name: 'Pencil Case Factory', glyph: '✏️', role: 'Infantry production',
    blurb: 'An unzipped pencil case that never runs out of pencils. Your bread and butter.',
    cost: { paper: 185 }, buildTime: 22, hp: 950, armor: ARMOR.STRUCTURE,
    footprint: [6.2, 3.4], height: 3.0, sight: 17,
    produces: ['grunt', 'medic', 'lancer', 'clipShield', 'scissor'],
    hotkey: 'Q',
  },

  ink: {
    id: 'ink', name: 'Ink Works', glyph: '🖋️', role: 'Ranged production',
    blurb: 'A mug bristling with pens. Everything that shoots from a distance starts here.',
    cost: { paper: 205, ink: 80 }, buildTime: 26, hp: 880, armor: ARMOR.STRUCTURE,
    footprint: [4.2, 4.2], height: 5.0, sight: 17,
    produces: ['scout', 'highlighter', 'glue', 'compass'],
    hotkey: 'W',
  },

  siege: {
    id: 'siege', name: 'Tin Workshop', glyph: '🥫', role: 'Siege production',
    blurb: 'A biscuit tin full of springs and offcuts. Builds the things that break buildings.',
    cost: { paper: 265, ink: 120, battery: 20 }, buildTime: 32, hp: 1150, armor: ARMOR.STRUCTURE,
    footprint: [5.2, 5.2], height: 3.6, sight: 17,
    requires: ['infantry'],
    produces: ['catapult', 'breacher', 'engineer', 'tack'],
    hotkey: 'E',
  },

  tech: {
    id: 'tech', name: 'Surface Pro Lab', glyph: '💻', role: 'Tech & research',
    blurb: 'Propped on its kickstand, humming. Unlocks upgrades, cloak detection and the hangar.',
    cost: { paper: 275, ink: 190, battery: 80 }, buildTime: 38, hp: 980, armor: ARMOR.STRUCTURE,
    footprint: [6.0, 4.0], height: 4.6, sight: 24, detector: true,
    requires: ['infantry'],
    produces: ['spy', 'radar'],
    research: true,
    hotkey: 'R',
  },

  hangar: {
    id: 'hangar', name: 'Paper Hangar', glyph: '🛩️', role: 'Aircraft production',
    blurb: 'A stacking tray of A4 and a very committed folding programme.',
    cost: { paper: 290, ink: 150, battery: 120 }, buildTime: 36, hp: 1050, armor: ARMOR.STRUCTURE,
    footprint: [6.6, 5.0], height: 2.4, sight: 20,
    requires: ['tech'],
    produces: ['glider', 'dart', 'heavyWing'],
    hotkey: 'T',
  },

  tower: {
    id: 'tower', name: 'Bottle Guard Tower', glyph: '🥤', role: 'Defence',
    blurb: 'A water bottle converted into a turret. Sits over your factories and shoots anything that comes close.',
    cost: { paper: 160, ink: 60 }, buildTime: 18, hp: 760, armor: ARMOR.STRUCTURE,
    footprint: [2.6, 2.6], height: 9.5, sight: 24, detector: true,
    attack: {
      damage: 24, type: DMG.PIERCE, range: 21, cooldown: 1.05,
      projectile: 'bolt', projectileSpeed: 78,
      targets: { ground: true, air: true },
    },
    hotkey: 'G',
  },

  flak: {
    id: 'flak', name: 'Pin Flak Battery', glyph: '📌', role: 'Anti-air',
    blurb: 'A pin cushion that fires the pins. Aircraft only — but very persuasive about it.',
    cost: { paper: 140, ink: 90 }, buildTime: 16, hp: 560, armor: ARMOR.STRUCTURE,
    footprint: [2.4, 2.4], height: 4.5, sight: 26,
    requires: ['ink'],
    attack: {
      damage: 31, type: DMG.PIERCE, range: 26, cooldown: 0.85,
      projectile: 'bolt', projectileSpeed: 92,
      splash: { radius: 2.6, falloff: 0.7 },
      targets: { ground: false, air: true },
    },
    hotkey: 'V',
  },

  extractor: {
    id: 'extractor', name: 'Harvester Clamp', glyph: '⛏️', role: 'Resource extraction',
    blurb: 'Clamps onto a desk node and grinds out income. The whole match is decided by how many of these you hold.',
    cost: { paper: 125 }, buildTime: 14, hp: 620, armor: ARMOR.STRUCTURE,
    footprint: [2.8, 2.8], height: 2.6, sight: 15,
    onNode: true,
    hotkey: 'D',
  },

  tray: {
    id: 'tray', name: 'Desk Tray', glyph: '🗂️', role: 'Population',
    blurb: 'Somewhere to stack the reinforcements. Each one raises your population cap.',
    cost: { paper: 95 }, buildTime: 12, hp: 520, armor: ARMOR.STRUCTURE,
    footprint: [4.2, 3.0], height: 1.8, sight: 12,
    popBonus: 12,
    hotkey: 'C',
  },
};

export const BUILDING_IDS = Object.keys(BUILDINGS);

/** Order the build menu is presented in. */
export const BUILD_ORDER_UI = ['infantry', 'ink', 'siege', 'tech', 'hangar', 'extractor', 'tray', 'tower', 'flak'];

export function buildingValue(def) {
  const c = def.cost || {};
  return (c.paper || 0) + (c.ink || 0) * 1.6 + (c.battery || 0) * 4.2 + (c.graphite || 0) * 2.4;
}
