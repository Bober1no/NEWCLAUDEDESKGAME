/** One lookup table for every trainable thing, ground or air. */
import { UNITS, unitValue } from './units.js';
import { AIRCRAFT } from './aircraft.js';
import { BUILDINGS, buildingValue } from './buildings.js';

export const ALL_UNITS = { ...UNITS, ...AIRCRAFT };
export const ALL_UNIT_IDS = Object.keys(ALL_UNITS);

export function getUnitDef(id) { return ALL_UNITS[id] || null; }
export function getBuildingDef(id) { return BUILDINGS[id] || null; }
export function getDef(id) { return ALL_UNITS[id] || BUILDINGS[id] || null; }

export function valueOf(id) {
  if (ALL_UNITS[id]) return unitValue(ALL_UNITS[id]);
  if (BUILDINGS[id]) return buildingValue(BUILDINGS[id]);
  return 0;
}

/** Which factory trains a given unit. */
export const FACTORY_FOR = Object.fromEntries(
  ALL_UNIT_IDS.map((id) => [id, ALL_UNITS[id].factory])
);

/** Reverse index: factory id → unit ids it can train. */
export const UNITS_BY_FACTORY = (() => {
  const map = {};
  for (const id of ALL_UNIT_IDS) {
    const f = ALL_UNITS[id].factory;
    (map[f] ||= []).push(id);
  }
  return map;
})();

/** Rough counter matrix — the Hard AI uses this to answer what it scouts. */
export const COUNTERS = {
  grunt: ['highlighter', 'glue', 'lancer'],
  scout: ['grunt', 'tower', 'highlighter'],
  lancer: ['compass', 'glue', 'clipShield'],
  clipShield: ['breacher', 'compass', 'highlighter'],
  scissor: ['clipShield', 'glue', 'grunt'],
  medic: ['compass', 'catapult', 'scissor'],
  highlighter: ['compass', 'catapult', 'scout'],
  glue: ['scissor', 'scout', 'dart'],
  compass: ['scissor', 'dart', 'scout'],
  catapult: ['scissor', 'scout', 'dart'],
  breacher: ['highlighter', 'compass', 'lancer'],
  engineer: ['scout', 'scissor'],
  tack: ['radar', 'scout'],
  spy: ['radar', 'tower'],
  radar: ['scout', 'compass'],
  glider: ['flak', 'compass'],
  dart: ['flak', 'scissor', 'compass'],
  heavyWing: ['flak', 'compass', 'scissor'],
};
