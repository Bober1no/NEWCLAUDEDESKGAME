/**
 * Paper aircraft.
 *
 * Air units share the unit schema but set `air: true`, which means:
 *   · they ignore the pathfinding grid entirely and fly straight lines
 *   · they cruise at WORLD.AIR_ALTITUDE and bob gently
 *   · only weapons with `targets.air` can touch them
 *   · they never gain the high-ground bonus, and never block ground movement
 */
import { ARMOR, DMG } from '../core/constants.js';

export const AIRCRAFT = {

  glider: {
    id: 'glider', name: 'Recon Glider', glyph: '🛩️', role: 'Unarmed scout', family: 'paper',
    blurb: 'A dart with no payload and enormous eyes. Map control in a single fold.',
    cost: { paper: 75, battery: 15 }, buildTime: 8, pop: 1, factory: 'hangar', hotkey: 'Q',
    hp: 95, armor: ARMOR.AIR, speed: 23, turn: 2.6, sight: 48, radius: 1.3, height: 1.0,
    air: true, attack: null,
  },

  dart: {
    id: 'dart', name: 'Dart Bomber', glyph: '✈️', role: 'Fast strike', family: 'paper',
    blurb: 'Quick passes on soft targets. Runs out of altitude the moment flak appears.',
    cost: { paper: 120, ink: 70, battery: 35 }, buildTime: 13, pop: 2, factory: 'hangar', hotkey: 'W',
    hp: 135, armor: ARMOR.AIR, speed: 19.5, turn: 2.2, sight: 27, radius: 1.4, height: 1.0,
    air: true,
    attack: {
      damage: 36, type: DMG.EXPLOSIVE, range: 8, cooldown: 2.4,
      projectile: 'bomb', projectileSpeed: 30,
      splash: { radius: 4.6, falloff: 0.55 },
      targets: { ground: true, air: false },
    },
  },

  heavyWing: {
    id: 'heavyWing', name: 'Heavy Folded Wing', glyph: '🛫', role: 'Heavy bomber', family: 'paper',
    blurb: 'Twelve folds of reinforced cartridge paper carrying an unreasonable payload.',
    cost: { paper: 200, ink: 120, battery: 70 }, buildTime: 21, pop: 4, factory: 'hangar', hotkey: 'E',
    hp: 320, armor: ARMOR.AIR, speed: 12.8, turn: 1.3, sight: 25, radius: 2.0, height: 1.0,
    air: true,
    attack: {
      damage: 95, type: DMG.EXPLOSIVE, range: 9, cooldown: 4.3,
      projectile: 'bomb', projectileSpeed: 26,
      splash: { radius: 8.5, falloff: 0.6 },
      bonusVs: { structure: 1.55 },
      targets: { ground: true, air: false },
    },
  },
};

export const AIR_IDS = Object.keys(AIRCRAFT);
