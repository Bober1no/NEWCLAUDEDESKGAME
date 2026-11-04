// Question bank: freeze frames (cp1..cp5) and the final exam.
// Keyword concepts: each concept is a list of acceptable synonyms / regex sources. All concepts must be present.

export const CHECKPOINTS = [
  {
    id: 'cp1', after: 'r2', title: 'Freeze frame 1 · Language and synthesis', qs: [
      { t: 'num', q: 'How many atoms in total are in one formula unit of $Ca(OH)2$?', ans: 5, tol: 0,
        hint: 'The 2 outside the bracket doubles everything inside it.',
        worked: '1 **Ca** + 2 × (1 **O** + 1 **H**) = 1 + 2 + 2 = **5 atoms**.' },
      { t: 'balance', q: 'Balance the equation. You can only change coefficients.', L: ['Al', 'O2'], R: ['Al2O3'], st: ['s', 'g', 's'], ans: [4, 3, 2],
        hint: 'Oxygen comes in 2s on the left and 3s on the right. Aim for 6 oxygens.',
        worked: '$4Al(s) + 3O2(g) -> 2Al2O3(s)$. **4 Al and 6 O** on each side, lowest whole-number ratio.' },
      { t: 'mcq', q: 'You are balancing an equation. Which change is allowed?', opts: ['Change $H2O$ to $H2O2$', 'Put a 2 in front of $H2O$', 'Delete an $O2$ you don’t need', 'Add an extra O atom to the products'], ans: 1,
        hint: 'Which option keeps every substance the same substance?',
        worked: 'Only **coefficients** can change. Changing a subscript changes the **substance**.' },
      { t: 'match', q: 'Match each state symbol to its meaning.', pairs: [['(s)', 'solid'], ['(l)', 'liquid'], ['(g)', 'gas'], ['(aq)', 'dissolved in water']],
        hint: '"aq" is short for aqueous.', worked: '(s) **solid**, (l) **liquid**, (g) **gas**, (aq) **aqueous**: dissolved in water.' },
      { t: 'short', q: 'A reaction makes a gas inside a flask sealed with a balloon. Explain why the balance reading does not change.',
        concepts: [{ name: 'atoms/mass are conserved', any: ['conserv', 'no atoms? (are )?(lost|destroyed|created)', 'atoms? (are|is) (not|never) (lost|destroyed)', 'same (number of )?atoms', 'mass (is )?(conserved|the same|stays)'] },
          { name: 'nothing escapes the sealed system', any: ['seal', 'closed', 'can ?not escape', "can'?t escape", 'trapped', 'no gas (escapes|leaves)', 'stays? (inside|in the)', 'balloon'] }],
        hint: 'Two ideas: what happens to atoms, and where the gas goes.',
        worked: 'Atoms are **conserved**: they are rearranged, not destroyed. The system is **sealed**, so the gas **cannot escape** and its mass is still on the balance.' },
      { t: 'predict', q: 'Calcium burns in oxygen. Pick the product, then balance.', L: ['Ca', 'O2'], tiles: ['CaO', 'CaO2', 'Ca2O', 'CO2'], R: ['CaO'], st: ['s', 'g', 's'], ans: [2, 1, 2],
        hint: 'Calcium forms Ca²⁺ ions; oxide is O²⁻.', worked: 'Ca²⁺ + O²⁻ → **CaO**. $2Ca(s) + O2(g) -> 2CaO(s)$ is a **synthesis** reaction.' }
    ]
  },
  {
    id: 'cp2', after: 'r4', title: 'Freeze frame 2 · Decomposition and single displacement', qs: [
      { t: 'mcq', q: 'Gas from a heated carbonate turns limewater milky. The gas is…', opts: ['oxygen', 'hydrogen', 'carbon dioxide', 'water vapour'], ans: 2,
        hint: 'Which gas is the limewater test for?', worked: '**Carbon dioxide** turns limewater milky: $Ca(OH)2(aq) + CO2(g) -> CaCO3(s) + H2O(l)$.' },
      { t: 'predict', q: 'Zinc is added to hydrochloric acid. Pick the products, then balance.', L: ['Zn', 'HCl'], tiles: ['ZnCl2', 'H2', 'ZnCl', 'H2O', 'Cl2'], R: ['ZnCl2', 'H2'], st: ['s', 'aq', 'aq', 'g'], ans: [1, 2, 1, 1],
        hint: 'Metal + acid: the metal displaces hydrogen.', worked: '$Zn(s) + 2HCl(aq) -> ZnCl2(aq) + H2(g)$. Zinc **displaces hydrogen** from the acid: single displacement.' },
      { t: 'order', q: 'Order these metals from MOST to LEAST reactive.', items: ['K', 'Mg', 'Zn', 'Fe', 'Cu', 'Ag'],
        hint: 'Potassium reacts violently with water. Silver is used in jewellery.', worked: '**K > Mg > Zn > Fe > Cu > Ag** (reactivity series).' },
      { t: 'classify', q: 'Sort each reaction into its type.', cats: ['synthesis', 'decomposition', 'single displacement'], items: [
        { eq: '2Na(s) + Cl2(g) -> 2NaCl(s)', ok: [['synthesis']] },
        { eq: 'CuCO3(s) -> CuO(s) + CO2(g)', ok: [['decomposition']] },
        { eq: 'Fe(s) + CuSO4(aq) -> FeSO4(aq) + Cu(s)', ok: [['single displacement']] },
        { eq: '2H2O2(aq) -> 2H2O(l) + O2(g)', ok: [['decomposition']] }],
        hint: 'Count reactants and products: one in, two out is…', worked: '**Synthesis** A + B → AB; **decomposition** AB → A + B; **single displacement** A + BC → AC + B.' },
      { t: 'short', q: 'Describe the test for hydrogen gas and its positive result.',
        concepts: [{ name: 'a lit/burning splint', any: ['lit', 'burning', 'lighted', 'flame', 'match'] }, { name: 'squeaky pop', any: ['pop'] }],
        hint: 'What do you hold near the tube, and what do you hear?', worked: 'Hold a **lit splint** at the mouth of the tube. Hydrogen burns with a **squeaky pop**.' },
      { t: 'num', q: 'In $ZnCO3(s) -> ZnO(s) + CO2(g)$, how many oxygen atoms are on the product side?', ans: 3, tol: 0,
        hint: 'Add the O in ZnO to the O in CO₂.', worked: 'ZnO has **1** O, CO₂ has **2** O: **3**, the same as in ZnCO₃.' }
    ]
  },
  {
    id: 'cp3', after: 'r6', title: 'Freeze frame 3 · Neutralisation and precipitation', qs: [
      { t: 'match', q: 'Match each acid to the salt it makes.', pairs: [['hydrochloric acid', 'chloride'], ['sulfuric acid', 'sulfate'], ['nitric acid', 'nitrate'], ['copper(II) oxide + sulfuric acid', 'copper(II) sulfate + water']],
        hint: 'The acid gives the second half of the salt’s name.', worked: 'hydrochloric → **chloride**, sulfuric → **sulfate**, nitric → **nitrate**; metal oxide + acid → **salt + water**.' },
      { t: 'ppt', q: 'Will a precipitate form? Use the solubility table.', pairs: [
        { a: 'AgNO3', b: 'KCl', ans: true, ppt: 'AgCl', why: 'silver chloride is insoluble' },
        { a: 'NaNO3', b: 'KCl', ans: false, why: 'all nitrates and Group 1 compounds are soluble' },
        { a: 'CuSO4', b: 'NaOH', ans: true, ppt: 'Cu(OH)2', why: 'copper(II) hydroxide is insoluble' }],
        hint: 'Swap the partners, then look each new pair up.', worked: 'AgNO₃ + KCl → **AgCl(s)** white. NaNO₃ + KCl → **no precipitate**. CuSO₄ + NaOH → **Cu(OH)₂(s)** pale blue.' },
      { t: 'predict', q: 'Magnesium oxide reacts with hydrochloric acid. Pick the products, then balance.', L: ['MgO', 'HCl'], tiles: ['MgCl2', 'H2O', 'H2', 'MgCl', 'CO2'], R: ['MgCl2', 'H2O'], st: ['s', 'aq', 'aq', 'l'], ans: [1, 2, 1, 1],
        hint: 'Metal oxide + acid → salt + water.', worked: '$MgO(s) + 2HCl(aq) -> MgCl2(aq) + H2O(l)$: **salt + water**, no gas.' },
      { t: 'mcq', q: 'What colour is universal indicator at the neutral point?', opts: ['red', 'yellow', 'green', 'purple'], ans: 2,
        hint: 'pH 7.', worked: '**Green** at pH 7.' },
      { t: 'label', q: 'Tap the vial that shows a strong acid.', svg: 'ph', target: 'p1',
        hint: 'Strong acid: lowest pH.', worked: '**pH 1, red**: strongest acid on the scale.' },
      { t: 'short', q: 'Silver nitrate and sodium chloride solutions are both clear. Explain why a white solid appears when they are mixed.',
        concepts: [{ name: 'the ions swap / exchange partners', any: ['swap', 'exchange', 'switch', 'double displacement', 'trade'] }, { name: 'a product is insoluble (precipitate)', any: ['insoluble', 'not soluble', "doesn'?t dissolve", 'does not dissolve', 'precipitate'] }],
        hint: 'What happens to the ions, and what is special about silver chloride?', worked: 'The ions **exchange partners** (double displacement). Silver chloride is **insoluble**, so it forms a white **precipitate**.' }
    ]
  },
  {
    id: 'cp4', after: 'r7', title: 'Freeze frame 4 · Redox', qs: [
      { t: 'electron', q: 'Drag the electrons from the species that is oxidised to the species that is reduced. Then label each.', eq: 'Zn(s) + Cu^2+(aq) -> Zn^2+(aq) + Cu(s)', from: 'Zn', to: 'Cu^2+', n: 2,
        hint: 'Which one ends up with a charge it didn’t have before?', worked: 'Zn loses 2e⁻: **oxidation**. Cu²⁺ gains 2e⁻: **reduction**.' },
      { t: 'mcq', q: 'Four iron nails sit for a week. Which rusts most?', opts: ['dry air with a drying agent', 'boiled water under oil', 'tap water', 'salt water'], ans: 3,
        hint: 'Rust needs oxygen and water. What speeds it up?', worked: '**Salt water**: oxygen and water are present and salt speeds corrosion.' },
      { t: 'short', q: 'Explain why combustion is a redox reaction.',
        concepts: [{ name: 'electron transfer', any: ['electron'] }, { name: 'the fuel is oxidised', any: ['oxidi[sz]', 'oxidation', 'lose', 'loss'] }, { name: 'oxygen is reduced', any: ['reduc', 'gain'] }],
        hint: 'Who loses electrons, who gains them?', worked: 'Electrons are **transferred**: the fuel is **oxidised** (loses electrons) and oxygen is **reduced** (gains electrons).' },
      { t: 'classify', q: 'Sort each reaction. Some belong in more than one box.', multi: true, cats: ['synthesis', 'single displacement', 'redox', 'neutralisation'], items: [
        { eq: '2Mg(s) + O2(g) -> 2MgO(s)', ok: [['synthesis', 'redox']] },
        { eq: 'Zn(s) + CuSO4(aq) -> ZnSO4(aq) + Cu(s)', ok: [['single displacement', 'redox']] },
        { eq: 'NaOH(aq) + HCl(aq) -> NaCl(aq) + H2O(l)', ok: [['neutralisation']] }],
        hint: 'Did any atom change its charge? Then it’s redox too.', worked: 'Mg + O₂: **synthesis and redox**. Zn + CuSO₄: **single displacement and redox**. NaOH + HCl: **neutralisation** only (no charges change).' },
      { t: 'match', q: 'Match each term to its meaning.', pairs: [['oxidation', 'loss of electrons'], ['reduction', 'gain of electrons'], ['corrosion', 'a metal is oxidised and eaten away'], ['combustion', 'a fuel is oxidised, releasing energy']],
        hint: 'OIL RIG.', worked: '**Oxidation is loss**, **reduction is gain**; corrosion and combustion are both **oxidation** (redox) reactions.' }
    ]
  },
  {
    id: 'cp5', after: 'r9', title: 'Freeze frame 5 · Rates and Key Science Skills', qs: [
      { t: 'label', q: 'Tap the curve for the reaction with the faster initial rate.', svg: 'rate', target: 'fast',
        hint: 'Look at the slope at the very start.', worked: 'The **steeper initial slope** is the faster rate. Both reach the same final volume.' },
      { t: 'label', q: 'Tap the arrow that shows the activation energy WITH a catalyst.', svg: 'energy', target: 'eaCat',
        hint: 'A catalyst gives a lower-energy path.', worked: 'The catalyst lowers the **activation energy**: the shorter arrow under the lower hump.' },
      { t: 'mcq', q: 'Every reading from a balance that was not zeroed is 0.12 g too high. This is…', opts: ['a random error', 'a systematic error', 'a personal mistake', 'a limitation of collision theory'], ans: 1,
        hint: 'Same size, same direction, every time.', worked: 'A **systematic error**: a consistent offset in one direction. Repeating does not remove it; **zero the balance**.' },
      { t: 'short', q: 'Use collision theory to explain why powdered marble reacts faster with acid than marble chips of the same mass.',
        concepts: [{ name: 'surface area', any: ['surface area', 'surface'] }, { name: 'collisions', any: ['collision', 'collide'] }, { name: 'more frequent', any: ['frequen', 'more often', 'more collisions', 'higher rate of collision', 'collide more'] }],
        hint: 'Three ideas: what powder has more of, what particles do, how often.', worked: 'Powder has a greater **surface area**, so more particles are exposed and acid particles **collide** with it **more frequently**, giving a faster rate.' },
      { t: 'critique', q: 'Critique this method.', method: [
        'Put 1.00 g marble chips in a flask on a balance.',
        'Add 50 mL of 1.0 M HCl, measured by eye from above the cylinder.',
        'Start the stopwatch when you remember to.',
        'Record the mass every 30 s for 5 minutes. Do one trial.'],
        flaws: [{ step: 1, type: 'systematic' }, { step: 2, type: 'random' }, { step: 3, type: 'limitation' }],
        improve: [{ name: 'a specific change', any: ['repeat', 'trials', 'eye level', 'pipette', 'burette', 'start (the )?(timer|stopwatch) (at|when|as)', 'data ?logger', 'cotton'] }, { name: 'why it improves the data', any: ['average', 'mean', 'parallax', 'random', 'outlier', 'precis', 'accura', 'reliab', 'repeatab', 'consisten'] }],
        hint: 'Parallax is systematic. Hand timing is random. One trial means no way to spot outliers.', worked: 'Step 2: **parallax**, a **systematic** error: read at eye level. Step 3: **random** timing error: start the timer as the acid is added. Step 4: one trial is a **limitation**: do at least **three trials and average** to reduce random error and spot outliers.' }
    ]
  }
];

export const EXAM = [
  { t: 'balance', q: 'Balance the combustion of methane.', L: ['CH4', 'O2'], R: ['CO2', 'H2O'], st: ['g', 'g', 'g', 'g'], ans: [1, 2, 1, 2],
    hint: 'Balance C, then H, then O last.', worked: '$CH4(g) + 2O2(g) -> CO2(g) + 2H2O(g)$: 1 C, 4 H, 4 O each side.' },
  { t: 'classify', q: 'Sort every reaction. Some belong in more than one box.', multi: true, cats: ['synthesis', 'decomposition', 'single displacement', 'neutralisation', 'precipitation', 'redox'], items: [
    { eq: '2H2(g) + O2(g) -> 2H2O(l)', ok: [['synthesis', 'redox']] },
    { eq: 'ZnCO3(s) -> ZnO(s) + CO2(g)', ok: [['decomposition']] },
    { eq: 'Mg(s) + 2HCl(aq) -> MgCl2(aq) + H2(g)', ok: [['single displacement', 'redox']] },
    { eq: 'KOH(aq) + HNO3(aq) -> KNO3(aq) + H2O(l)', ok: [['neutralisation']] },
    { eq: 'Pb(NO3)2(aq) + 2KI(aq) -> PbI2(s) + 2KNO3(aq)', ok: [['precipitation']] }],
    hint: 'Charges change → redox. Insoluble product → precipitation.', worked: 'H₂ + O₂: **synthesis + redox**. ZnCO₃: **decomposition**. Mg + HCl: **single displacement + redox**. KOH + HNO₃: **neutralisation**. Pb(NO₃)₂ + KI: **precipitation**.' },
  { t: 'predict', q: 'Sodium carbonate reacts with hydrochloric acid. Pick the products, then balance.', L: ['Na2CO3', 'HCl'], tiles: ['NaCl', 'H2O', 'CO2', 'H2', 'Na2Cl', 'O2'], R: ['NaCl', 'H2O', 'CO2'], st: ['s', 'aq', 'aq', 'l', 'g'], ans: [1, 2, 2, 1, 1],
    hint: 'Metal carbonate + acid → salt + carbon dioxide + water.', worked: '$Na2CO3(s) + 2HCl(aq) -> 2NaCl(aq) + H2O(l) + CO2(g)$.' },
  { t: 'ppt', q: 'Will a precipitate form?', pairs: [
    { a: 'Pb(NO3)2', b: 'NaI', ans: true, ppt: 'PbI2', why: 'lead(II) iodide is insoluble (yellow)' },
    { a: 'BaCl2', b: 'Na2SO4', ans: true, ppt: 'BaSO4', why: 'barium sulfate is insoluble (white)' },
    { a: 'KCl', b: 'NaNO3', ans: false, why: 'every possible product is soluble' }],
    hint: 'Swap partners. Nitrates and Group 1 always dissolve.', worked: '**PbI₂** forms (yellow). **BaSO₄** forms (white). KCl + NaNO₃: **no precipitate**.' },
  { t: 'electron', q: 'Magnesium is added to copper(II) sulfate. Drag the electrons, then label oxidation and reduction.', eq: 'Mg(s) + Cu^2+(aq) -> Mg^2+(aq) + Cu(s)', from: 'Mg', to: 'Cu^2+', n: 2,
    hint: 'The more reactive metal gives electrons away.', worked: 'Mg → Mg²⁺ + 2e⁻ (**oxidation**). Cu²⁺ + 2e⁻ → Cu (**reduction**).' },
  { t: 'num', q: 'How many atoms in total are in one formula unit of $Al2(SO4)3$?', ans: 17, tol: 0,
    hint: 'Inside the bracket: 1 S + 4 O, then × 3.', worked: '2 Al + 3 × (1 S + 4 O) = 2 + 3 + 12 = **17**.' },
  { t: 'match', q: 'Key Science Skills: match each word to its VCE meaning.', pairs: [['precise', 'repeat readings agree closely'], ['accurate', 'close to the true value'], ['reproducible', 'same result with a different person or method'], ['valid', 'actually tests the aim']],
    hint: 'Accuracy is about the true value; precision is about the spread.', worked: '**Precise**: close together. **Accurate**: close to true. **Reproducible**: holds up for someone else. **Valid**: answers the question asked.' },
  { t: 'critique', q: 'Key Science Skills: critique this temperature investigation.', method: [
    'Heat 50 mL of acid to 50 °C, then add marble chips.',
    'Leave the beaker on the bench while it reacts; room is 18 °C.',
    'Measure gas volume with a gas syringe every 20 s.',
    'Accidentally use 0.5 M acid in one run and keep the result.'],
    flaws: [{ step: 1, type: 'limitation' }, { step: 3, type: 'mistake' }],
    improve: [{ name: 'a specific change', any: ['water bath', 'thermostat', 'insulat', 'repeat', 'redo', 'discard', 'same concentration'] }, { name: 'why it improves the data', any: ['constant', 'control', 'cool', 'temperature (stays|remains)', 'fair', 'valid', 'controlled variable'] }],
    hint: 'What happens to 50 °C acid on an 18 °C bench? And can you keep a mistaken run?', worked: 'Step 2: the acid **cools**, a **limitation** for temperature control: use a **water bath** to keep it **constant**. Step 4 is a **personal mistake**, not an error: **redo** the run so concentration stays a **controlled variable**.' },
  { t: 'short', q: 'Key Science Skills: why does repeating trials NOT reduce a systematic error?',
    concepts: [{ name: 'it is the same every time', any: ['same', 'every', 'each', 'consistent', 'constant'] }, { name: 'same direction / bias / offset', any: ['direction', 'bias', 'offset', 'too high', 'too low', 'shift', 'always'] }],
    hint: 'Averaging cancels scatter. Does a systematic error scatter?', worked: 'A systematic error shifts **every** reading by the **same amount in the same direction**, so averaging repeats keeps the **bias**. It must be removed at the source (e.g. zero the balance).' },
  { t: 'mcq', q: 'After the reaction, the manganese dioxide is filtered and dried. Its mass is…', opts: ['less: it was used up', 'more: it absorbed oxygen', 'the same: catalysts are not used up', 'zero: it dissolved'], ans: 2,
    hint: 'What did the notes say about catalysts?', worked: 'Catalysts **speed up** the reaction but are **not used up**: same mass.' },
  { t: 'label', q: 'Tap the energy curve for the catalysed reaction.', svg: 'energy', target: 'curveCat',
    hint: 'Lower hump.', worked: 'The catalysed path has the **lower activation energy**: the lower hump. Start and end energies are the same.' },
  { t: 'order', q: 'Order from FASTEST to SLOWEST initial rate (same mass of marble, excess acid).', items: ['powder, 2.0 M acid, 50 °C', 'chips, 2.0 M acid, 50 °C', 'chips, 2.0 M acid, 20 °C', 'chips, 0.5 M acid, 20 °C'],
    hint: 'Change one factor at a time down the list.', worked: 'Each step removes one advantage: **surface area**, then **temperature**, then **concentration**.' }
];

export const FEEDBACK = {
  right: ['Correct. Don’t get cocky.', 'Balanced. Unlike your sleep schedule.', 'Clean.', 'Correct. The examiner would nod, grudgingly.', 'Yes. Atoms accounted for.'],
  wrong: ['No. Count the atoms again.', 'Not quite. Which word is the examiner looking for?', 'No. Read the question like it owes you money.', 'Wrong. Try again, slower.'],
  partial: 'Getting there. Missing: '
};
