# DESK WARS

A 3D real-time strategy game fought with stationery on top of a school desk.
Pencils are infantry, scissors are anti-air, a calculator is your headquarters,
and the stack of textbooks in the middle is the high ground everybody wants.

Runs entirely in the browser. No build step, no backend, no CDN — clone it,
serve the folder, play.

```bash
npm start            # → http://localhost:5173
# or any static server:  python3 -m http.server 5173
```

---

## Modes

**1 Player — vs AI.** You take Graphite Blue against the computer on
Easy / Medium / Hard, or dial in a Custom opponent with sliders for reaction
speed, resource efficiency, aggression and tech focus.

**2 Players — Hot Seat.** Two commanders share one desk and one screen. Press
**F2** (or the ⇄ button) to hand over: the fog of war, HUD, minimap, command
card and control groups all switch to the incoming player, and the camera
swings around behind their HQ. Choose *free swap* to hand over whenever you
like, or *timed turns* to get a fixed clock per commander and a handover card
between turns so the mouse can physically change hands.

**Win conditions** (picked at match setup):

| Mode | How you win |
| --- | --- |
| Domination | Destroy the enemy HQ **and** every production building |
| Desk Control | Bank 4 minutes of holding the majority of the desk's 5 zones |
| Annihilation | Raze every last enemy structure |

A 45-minute hard limit always applies; if it expires, the higher desk score wins.

---

## The desk

The map is rotationally symmetric — every feature on your half is mirrored onto
the enemy's — so neither commander gets a better desk. A seed string shuffles
the clutter without breaking that symmetry.

| Feature | What it does |
| --- | --- |
| **Stacked books** | Plateaus. Units on top get +22% range, +18% damage and +35% sight, and shoot over lower ground. Slow to climb. |
| **Water bottles** | Neutral tower sites. A Guard Tower built on one costs 40% less and gets +25% HP and range. |
| **Notebooks / paper stacks** | Paper nodes |
| **Ink pots** | Ink nodes |
| **Battery cells** | Battery nodes — scarce, and the richest one sits dead centre |
| **Pencil sharpeners** | Graphite nodes |
| **Spilled pens, rulers, erasers, note pads** | Impassable. A Tape Engineer can bridge them. |
| **Paper clips, shavings, crumbs** | Passable clutter that slows movement |
| **Desk rim** | Map edge. The apron beyond it is scenery. |

Resource nodes produce nothing on their own — you must build a **Harvester
Clamp** on one, and you can only build inside the radius of a structure you
already own, so expanding across the desk means creeping outward node by node.

---

## Roster

### Structures

| | Structure | Role |
| --- | --- | --- |
| 🧮 | **Calculator HQ** | Command centre. Trickles resources, trains basics, sees far, detects cloak. Researches logistics and structural upgrades. |
| ✏️ | **Pencil Case Factory** | Infantry. Researches the pencil line. |
| 🖋️ | **Ink Works** | Ranged and chemical units. Researches the pen line. |
| 🥫 | **Tin Workshop** | Siege, engineers and mines. Needs a Pencil Case Factory. |
| 💻 | **Surface Pro Lab** | Tech units, cloak detection, and the advanced research branches. |
| 🛩️ | **Paper Hangar** | Aircraft. Needs the Lab. Researches the folding branch. |
| 🥤 | **Bottle Guard Tower** | Defensive turret, hits ground and air, detects cloak. |
| 📌 | **Pin Flak Battery** | Anti-air only, with splash. Needs an Ink Works. |
| ⛏️ | **Harvester Clamp** | Sits on a node and generates income. |
| 🗂️ | **Desk Tray** | +12 population each, up to 96. |

### Ground units

| | Unit | Role |
| --- | --- | --- |
| ✏️ | **Pencil Grunt** | Cheap line infantry. Wins by arriving in numbers. |
| 🖊️ | **Pen Scout** | Fastest thing on the desk, widest vision, fragile. |
| 📏 | **Ruler Lancer** | Melee with reach and a charge bonus — keep it moving. |
| 📎 | **Clip Shield** | Heavy armour. Parks in a chokepoint and refuses to leave. |
| ✂️ | **Scissor Striker** | Burst melee that can also swipe aircraft out of the air. |
| 🩹 | **Eraser Medic** | Heals the three most wounded units nearby. |
| 🖍️ | **Highlighter Trooper** | Short-range splash that leaves a burning stripe. |
| 🧴 | **Glue Gunner** | Arcing artillery; splashes and glues targets to the desk. |
| 📐 | **Compass Marksman** | Sniper. Huge range, hits air, loves standing on books. |
| 🪃 | **Rubber Band Catapult** | Arcing siege, bonus vs structures, helpless up close. |
| 📌 | **Stapler Breacher** | Slow bunker-buster with 2.3× damage to buildings. |
| 🩶 | **Tape Engineer** | Repairs structures and tapes bridges over blocked clutter. |
| 📍 | **Tack Trap** | Cloaked one-shot mine. Costs no population. |
| 🗒️ | **Sticky Spy** | Cloaked saboteur — jams an enemy factory for 11 seconds. |
| 🧭 | **Protractor Radar** | Mobile detector; reveals fog and marks targets for extra damage. |

### Aircraft

| | Unit | Role |
| --- | --- | --- |
| 🛩️ | **Recon Glider** | Unarmed scout with enormous vision. |
| ✈️ | **Dart Bomber** | Fast strike aircraft, small splash payload. |
| 🛫 | **Heavy Folded Wing** | Slow, tough, and carries an unreasonable bomb. |

Aircraft ignore terrain entirely and can only be hit by Scissor Strikers,
Compass Marksmen, Guard Towers and Pin Flak Batteries.

### Damage types

Every weapon has a damage type and every target an armour class, so
composition matters:

| | light | medium | heavy | structure | air |
| --- | --- | --- | --- | --- | --- |
| **pierce** | 1.30 | 1.00 | 0.70 | 0.55 | 1.05 |
| **blunt** | 1.00 | 1.15 | 0.95 | 0.80 | 0.65 |
| **slash** | 1.40 | 1.00 | 0.60 | 0.45 | 1.25 |
| **explosive** | 0.85 | 1.10 | 1.25 | 1.65 | 0.55 |
| **chemical** | 1.35 | 1.10 | 0.75 | 0.30 | 0.85 |

Units also earn veterancy from kills (+9% damage and health per rank).

---

## Tech tree — "sharpen your pencils"

Seventeen upgrades across six branches, each researched at the structure that
owns it and paid for mostly in **graphite**:

- **Pencil line** — Mechanical Pencil → Coloured Pencil Corps
- **Pen line** — Gel Pen Refill → Fountain Pen Nibs
- **Structural** — Reinforced Tape, Taller Book Stacks, Sharpened Edges, Prefab Folding
- **Aeronautics** — Aerodynamic Folds → Cartridge Paper
- **Logistics** — Bulk Reams, Ink Siphon, Fine Grind, Power Cells
- **Support** — Field Kits, Radar Array, Adhesive Polymer

Open the full tree with **Ctrl+T**, or research from the command card.

---

## Controls

**Camera** — right-drag orbits, middle-drag pans, the wheel zooms toward the
cursor, WASD/arrows and the screen edge pan, Q/E rotate, F focuses the
selection, Home jumps to your HQ.

**Selection** — left-click, left-drag a box, shift to add, double-click for all
of that type on screen, Ctrl+A for the whole army, Ctrl+1…9 to make control
groups and 1…9 to recall them (twice to centre), Tab to cycle idle units.

**Commands** — right-click to move or attack, shift-right-click to queue
waypoints, A attack-move, S stop, H hold, P patrol, B tape bridge, Delete
salvages a structure for 55% of its cost.

Right-drag only orbits the camera if you actually drag; a right *click* is
always an order, so both idioms live on the same button.

Press **F1** in game for the full list.

---

## Architecture

Plain ES modules, no bundler. Three.js is vendored in `vendor/three/` so the
game runs offline and from `file://`-adjacent static hosting.

```
index.html            importmap + HUD markup
style.css             all interface styling
vendor/three/         pinned three.js r185 module build
tools/serve.js        zero-dependency static server
src/
  main.js             entry point; owns the renderer across matches
  core/
    game.js           the match: world, players, systems, frame loop
    constants.js      tuning tables — armour matrix, presets, balance knobs
    utils.js          maths, seeded RNG, formation helpers
    events.js         synchronous event bus
    audio.js          procedural WebAudio sound bank (no audio assets)
  scene/
    setupScene.js     renderer, lighting, and the RTS free-camera
    deskMap.js        desk, terrain, resource nodes, control zones
    materials.js      geometry/material cache + static-geometry merger
    fx.js             pooled particles, decals, shockwaves, corpses
  entities/
    units.js          ground unit definitions (data only)
    aircraft.js       paper aircraft definitions
    buildings.js      structure definitions
    registry.js       merged lookup + the counter matrix
    meshFactory.js    every low-poly stationery model
    entity.js         shared HP/status/selection behaviour
    unit.js           orders, steering, combat, abilities
    building.js       construction, production queues, research, turrets
  systems/
    pathfinding.js    terrain grid, A*, path request queue
    spatial.js        uniform-grid spatial index
    combat.js         damage pipeline, projectiles, splash, statuses
    resources.js      player state and the economy tick
    techTree.js       upgrade definitions and modifier bag
    fog.js            per-side vision grids, cloak detection, fog texture
    victory.js        zone control and the three win conditions
    selection.js      selection, orders, building placement
  ai/
    aiController.js   the opposing commander
  ui/
    index.js  hud.js  buildMenu.js  minimap.js  setupScreen.js
```

### Notes on a few decisions

**Everything is a primitive.** Boxes, cylinders, cones, spheres, tori and one
hand-built paper-dart mesh. Units are read by silhouette and by the
team-coloured disc under their feet, not by detail.

**Static geometry is merged.** The desk scenery is several hundred little
props; they get baked into one mesh per material at load, which takes the
frame from ~820 draw calls to ~280. Building models are merged the same way,
with animated parts (turrets, screens, drums) excluded.

**The simulation substeps.** At 3× game speed a single frame's delta would let
a fast unit hop over a 2-unit wall cell, so `tick()` runs in slices of at most
50 ms regardless of frame rate.

**Pathfinding is budgeted.** Units request paths into a queue serviced a few
per frame; while waiting they steer straight at the goal, so a forty-unit move
order still responds instantly without a frame spike.

### How the AI scales

Difficulty is not one brain with a reaction-time slider. Each preset changes
its think interval, income handicap, aggression, tech appetite, micro level
(none / retreat wounded / focus fire) and how strongly scouting feeds back into
its build.

The two things that make it play like a person rather than a script are its
**reserves**: when the next structure it wants is unaffordable, it stops
spending the bank on cheap infantry and saves for it; and when the unit it most
wants is unaffordable, it holds back rather than defaulting to the cheapest
option. Without those it buys nothing but Pencil Grunts forever and never
reaches its second factory. It also values resource nodes by what it is
*short* of, so it will cross the desk for ink when its ink is empty.

On Easy it takes a couple of nodes, masses pencils and walks at you. On Hard it
takes six or more nodes, opens an Ink Works and a Tin Workshop, scouts your
base, builds the counters to what it sees, sends fast raiders at your
extractors while its main army pushes, focus-fires your medics, and pulls
wounded units out of the line to heal.

---

## Licence

MIT for the game code. Three.js is included under its own MIT licence
(`vendor/three/LICENSE`).
