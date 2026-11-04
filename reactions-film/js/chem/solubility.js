// Standard Year 10 solubility rules (the "beyond the notes" table used in Reel 6 and the
// "Will it precipitate?" questions). Kept deliberately to the level of the course.

export const CATIONS = {
  'Na^+': { name: 'sodium', g1: true }, 'K^+': { name: 'potassium', g1: true }, 'Li^+': { name: 'lithium', g1: true },
  'NH4^+': { name: 'ammonium', g1: true },
  'Ag^+': { name: 'silver' }, 'Pb^2+': { name: 'lead(II)' }, 'Ba^2+': { name: 'barium' }, 'Ca^2+': { name: 'calcium' },
  'Cu^2+': { name: 'copper(II)' }, 'Fe^3+': { name: 'iron(III)' }, 'Fe^2+': { name: 'iron(II)' }, 'Mg^2+': { name: 'magnesium' },
  'Zn^2+': { name: 'zinc' }
};
export const ANIONS = {
  'NO3^-': { name: 'nitrate' }, 'Cl^-': { name: 'chloride' }, 'I^-': { name: 'iodide' }, 'SO4^2-': { name: 'sulfate' },
  'OH^-': { name: 'hydroxide' }, 'CO3^2-': { name: 'carbonate' }
};

// Rows as shown on the holographic table in Reel 6. `extra` marks exceptions beyond the class notes.
export const RULES = [
  { ion: 'NO3^-', label: 'Nitrates', rule: 'All soluble', except: [] },
  { ion: 'Na^+', label: 'Group 1 and ammonium', rule: 'All soluble', except: [] },
  { ion: 'Cl^-', label: 'Chlorides (and iodides)', rule: 'Mostly soluble', except: ['Ag^+', 'Pb^2+'] },
  { ion: 'SO4^2-', label: 'Sulfates', rule: 'Mostly soluble', except: ['Ba^2+', 'Pb^2+', 'Ca^2+'], note: 'Ca slightly' },
  { ion: 'OH^-', label: 'Hydroxides', rule: 'Mostly insoluble', except: ['Group 1', 'NH4^+'], note: 'Ca, Ba slightly (beyond the notes)' },
  { ion: 'CO3^2-', label: 'Carbonates', rule: 'Mostly insoluble', except: ['Group 1', 'NH4^+'] }
];

/** 'soluble' | 'insoluble' | 'slight' for a cation/anion pair. */
export function solubility(cat, an) {
  const c = CATIONS[cat]; if (!c || !ANIONS[an]) throw new Error('Unknown ion ' + cat + ' ' + an);
  if (an === 'NO3^-') return 'soluble';
  if (c.g1) return 'soluble';
  if (an === 'Cl^-' || an === 'I^-') return (cat === 'Ag^+' || cat === 'Pb^2+') ? 'insoluble' : 'soluble';
  if (an === 'SO4^2-') return (cat === 'Ba^2+' || cat === 'Pb^2+') ? 'insoluble' : cat === 'Ca^2+' ? 'slight' : 'soluble';
  if (an === 'OH^-') return (cat === 'Ca^2+' || cat === 'Ba^2+') ? 'slight' : 'insoluble';
  if (an === 'CO3^2-') return 'insoluble';
  return 'soluble';
}

/** Precipitate colour (real observations) for the insoluble products used in the film. */
export const PPT_COLOUR = {
  'AgCl': { hex: '#f4f4f0', name: 'white' }, 'PbI2': { hex: '#ffd21a', name: 'bright yellow' },
  'Cu(OH)2': { hex: '#7fb8e6', name: 'pale blue' }, 'BaSO4': { hex: '#f2f2ee', name: 'white' },
  'Fe(OH)3': { hex: '#8a3d14', name: 'rusty brown' }, 'PbSO4': { hex: '#efefe9', name: 'white' },
  'CaCO3': { hex: '#f0f0ea', name: 'white' }, 'AgI': { hex: '#f3e6a0', name: 'pale yellow' }
};
