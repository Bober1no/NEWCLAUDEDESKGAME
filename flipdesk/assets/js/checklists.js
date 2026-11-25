/* Standard operating procedures: interactive checklists. Rendered before core's tab setup runs. */
(function () {
  const { esc, store, toast, copyText } = FD;

  // [section, [ [check, why], ... ] ]
  const SOPS = [
    { id: 'meetup', name: 'Before you buy', intro: 'Do these before you travel and before you hand over any money.', sections: [
      ['Before travelling', [
        ['Run the numbers in the Max buy calculator', 'Decide your walk-away price before you arrive.'],
        ['Ask for the exact model / serial / IMEI, and a photo of it powered on', 'Vague answers are a warning sign.'],
        ['Check the seller profile: account age, ratings, other listings', 'Brand-new accounts selling lots of identical items are a red flag.'],
        ['Confirm you can test it at pickup (power, monitor, or your own test rig)', '"No testing, cash only" means you price it as untested.'],
        ['Never pay a deposit or bank transfer before you see it in person', 'The most common Marketplace scam.'],
      ]],
      ['Safety', [
        ['Meet somewhere public with CCTV, or bring someone', 'Many police stations have designated safe trade spots.'],
        ['Tell someone where you are going', ''],
        ['Bring exact cash, or use PayID only after you have checked the item', 'When selling: fake PayID emails asking you to "upgrade your account" or pay a fee are always a scam.'],
      ]],
      ['At pickup', [
        ['Run the right checklist for the item (GPU / PC / phone / laptop)', ''],
        ['Re-negotiate honestly if it is not as described', 'Point to the specific fault and why it changes your number.'],
        ['Get a receipt or message confirmation: item, price, date, seller name', 'Proof of ownership if it turns out to be stolen. Also good records.'],
        ['Log it in Inventory the same day', ''],
      ]],
    ] },
    { id: 'gpu', name: 'GPU', intro: 'Test with your own bench where possible. A card that "worked in my PC" is untested.', sections: [
      ['Visual', [
        ['PCB not bent or sagging, no burnt smell or scorch marks', ''],
        ['Check the power connectors for melting (especially 12VHPWR on 40-series)', ''],
        ['Fans spin freely with no wobble or grinding', 'Worn bearings often mean the card ran 24/7, e.g. for mining.'],
        ['Warranty sticker or screws not tampered with (if that matters for resale)', ''],
        ['Check for discoloured or oily thermal pads at the edges', 'Pad oil and dust patterns suggest heavy use.'],
      ]],
      ['Software', [
        ['GPU-Z: name, VRAM, bus interface, BIOS all match the listing', 'Catches fake / re-flashed cards (e.g. a GTX 550 sold as a 1060).'],
        ['Clean driver install (DDU if swapping brands)', ''],
        ['10–15 min stress test (FurMark or OCCT): no artifacts or crashes', ''],
        ['Game or 3DMark run, score within ~5% of typical results for that card', ''],
        ['HWiNFO temperatures: core and hotspot gap under ~20°C, memory junction OK', 'A big hotspot gap usually means it needs a repaste or new pads.'],
        ['Test every display output', 'Dead HDMI/DP ports are common and easy to miss.'],
      ]],
      ['Before listing', [
        ['Clean, and repaste / replace pads if temperatures justify it', ''],
        ['Screenshot GPU-Z, benchmark and temps for the listing', 'Proof sells. Buyers pay more for it.'],
      ]],
    ] },
    { id: 'pc', name: 'Desktop PC', intro: 'Price a whole PC from the sum of its parts first. Then decide whether to sell it whole or part it out.', sections: [
      ['Inspect', [
        ['Open the side panel: identify every part (CPU-Z, GPU-Z, PSU label)', 'Sellers often get the specs wrong, in both directions.'],
        ['PSU brand and model is reputable and the wattage suits the GPU', 'Unknown-brand PSUs are a liability. Budget for a replacement.'],
        ['No swollen capacitors, corrosion, or pet hair packed into heatsinks', ''],
        ['Proprietary OEM board or PSU? (Dell, HP, Lenovo, Alienware)', 'These limit upgrades and part-out value.'],
      ]],
      ['Test', [
        ['POSTs, BIOS shows correct CPU and RAM amount, XMP/EXPO works', ''],
        ['MemTest86 or TestMem5: at least 1 full pass', ''],
        ['CPU stress test (Cinebench multi / OCCT): stable, temps reasonable', ''],
        ['CrystalDiskInfo: drive health Good, check power-on hours', ''],
        ['All USB ports, audio jacks, Wi-Fi/Bluetooth, front I/O work', ''],
        ['Full GPU checks (see GPU tab)', ''],
      ]],
      ['Prep for sale', [
        ['Wipe drives and do a clean Windows install (do not activate with your own key)', 'Leave it on the setup screen or a clean local account.'],
        ['Dust out, cable manage, and clean the glass', 'Presentation decides what people will pay.'],
        ['Run benchmarks of popular games (fps at 1080p/1440p) for the listing', 'Buyers want fps numbers, not specs.'],
        ['Photograph: front, inside lit up, side, ports, benchmark screen', ''],
      ]],
    ] },
    { id: 'phone', name: 'Phone', intro: 'Phones carry the most theft and lock risk. Never skip the account and IMEI checks.', sections: [
      ['Ownership & locks', [
        ['Signed out of iCloud / Google, and Find My is OFF (check in person)', 'Activation lock = paperweight.'],
        ['Check the IMEI (*#06#) against the AMTA lost/stolen register', 'Blacklisted phones won\'t work on Australian networks.'],
        ['IMEI in settings matches the SIM tray / box', ''],
        ['Not carrier-locked, or price it accordingly', ''],
        ['No MDM / company profile installed', 'Ex-corporate phones can be remotely locked.'],
      ]],
      ['Hardware', [
        ['iPhone: Settings → General → About → Parts & Service History', 'Shows non-genuine screens, batteries, cameras.'],
        ['Battery health %: under 80% means price in a replacement', ''],
        ['Face ID / fingerprint works', 'Very expensive to fix if it doesn\'t.'],
        ['Screen: dead pixels, burn-in (grey image), touch works in all corners', ''],
        ['True Tone available (iPhone). If missing, the screen has been replaced', ''],
        ['All cameras, flash, speakers, mics (record a voice memo), vibration', ''],
        ['Charges by cable (and wirelessly if supported), buttons click properly', ''],
        ['Make a test call with your SIM, check mobile data and Wi-Fi', ''],
        ['No liquid damage: check the SIM tray indicator, look for fogging under the camera glass', ''],
      ]],
      ['Prep for sale', [
        ['Factory reset in front of the buyer, or before listing', ''],
        ['Clean the ports and screen, add a screen protector if cheap', ''],
        ['Screenshot battery health and storage for the listing', ''],
      ]],
    ] },
    { id: 'laptop', name: 'Laptop', intro: 'Laptops hide problems: hinges, batteries, BIOS locks.', sections: [
      ['Locks', [
        ['No BIOS / supervisor password', 'Can make business laptops nearly unsellable.'],
        ['No Computrace / Absolute or company MDM enrolment on setup', ''],
        ['Microsoft / Apple account removed. Mac: Activation Lock off', ''],
      ]],
      ['Hardware', [
        ['Battery wear (powercfg /batteryreport, or coconutBattery on Mac)', ''],
        ['Battery not swollen (touchpad sits flat, chassis not lifted)', 'A swollen battery is a fire risk. Replace it before selling.'],
        ['Hinges firm, no cracks near the hinge mounts', ''],
        ['Screen: backlight even, no dead pixels, no pressure marks from the keyboard', ''],
        ['Every key, the trackpad, webcam, mic, speakers, all ports', ''],
        ['Charger is genuine and the wattage is right', ''],
        ['CPU stress test: fans ramp, no thermal shutdown', ''],
        ['Storage health (CrystalDiskInfo) and RAM test', ''],
      ]],
      ['Prep', [
        ['Clean OS install, all drivers, updates', ''],
        ['Clean the keyboard and lid, remove stickers if possible', ''],
      ]],
    ] },
    { id: 'console', name: 'Console', intro: 'Bans and digital-only editions change the value a lot.', sections: [
      ['Checks', [
        ['Serial on the console matches the box', ''],
        ['Not banned: sign in to the network and open an online feature', ''],
        ['Disc drive reads discs (if it has one)', ''],
        ['Controller(s): stick drift, triggers, buttons, charging', 'Stick drift is very common. Factor in a replacement controller.'],
        ['Run a demanding game for 20 minutes: fan noise, no shutdowns', ''],
        ['HDMI port not damaged', 'A common fault after the console has been dropped or knocked.'],
        ['Previous owner signed out, and console set back to factory', ''],
      ]],
    ] },
  ];

  const STATE_KEY = 'fd.sop';
  const state = store.get(STATE_KEY, {});

  function render() {
    document.getElementById('sopTabs').innerHTML = SOPS.map((s) => `<button class="tab" type="button" data-tab="${s.id}">${esc(s.name)}</button>`).join('');
    document.getElementById('sopPanels').innerHTML = SOPS.map((s) => {
      let n = 0;
      const body = s.sections.map(([title, items]) => `<h4>${esc(title)}</h4>${items.map(([text, why]) => {
        const key = `${s.id}.${n++}`;
        return `<li><label class="inline-check"><input type="checkbox" data-key="${key}" ${state[key] ? 'checked' : ''}> ${esc(text)}</label>${why ? `<span class="why">${esc(why)}</span>` : ''}</li>`;
      }).join('')}`).join('');
      return `<section class="tab-panel" data-panel-of="sop" data-panel="${s.id}" hidden>
        <div class="card">
          <div class="card-head"><h2>${esc(s.name)}</h2>
            <div class="btn-row"><span class="muted" data-count="${s.id}"></span>
              <button class="btn btn-sm" type="button" data-copy="${s.id}">Copy as text</button>
              <button class="btn btn-sm" type="button" data-print>Print</button>
              <button class="btn btn-sm btn-danger" type="button" data-reset="${s.id}">Reset</button></div></div>
          <p class="muted">${esc(s.intro)}</p>
          <div class="progress"><div data-bar="${s.id}"></div></div>
          <ul class="checklist">${body}</ul>
        </div></section>`;
    }).join('');
    SOPS.forEach((s) => progress(s.id));
  }

  function progress(id) {
    const boxes = document.querySelectorAll(`input[data-key^="${id}."]`);
    const done = [...boxes].filter((b) => b.checked).length;
    document.querySelector(`[data-count="${id}"]`).textContent = `${done}/${boxes.length}`;
    document.querySelector(`[data-bar="${id}"]`).style.width = (boxes.length ? done / boxes.length * 100 : 0) + '%';
  }

  // Render synchronously so core's DOMContentLoaded tab setup sees the tabs.
  render();

  document.addEventListener('change', (e) => {
    const k = e.target.dataset?.key; if (!k) return;
    state[k] = e.target.checked; store.set(STATE_KEY, state); progress(k.split('.')[0]);
  });
  document.addEventListener('click', (e) => {
    const r = e.target.closest('[data-reset]');
    if (r) {
      const id = r.dataset.reset;
      Object.keys(state).filter((k) => k.startsWith(id + '.')).forEach((k) => delete state[k]);
      store.set(STATE_KEY, state);
      document.querySelectorAll(`input[data-key^="${id}."]`).forEach((b) => { b.checked = false; });
      progress(id); toast('Checklist reset');
    }
    const c = e.target.closest('[data-copy]');
    if (c) {
      const s = SOPS.find((x) => x.id === c.dataset.copy);
      copyText(`${s.name} checklist\n` + s.sections.map(([t, items]) => `\n${t}\n` + items.map(([x]) => `[ ] ${x}`).join('\n')).join('\n'));
    }
    if (e.target.closest('[data-print]')) window.print();
  });
})();
