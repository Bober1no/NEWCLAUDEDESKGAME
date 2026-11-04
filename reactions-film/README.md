# The Reactions Film

A self-playing, macro-lens chemistry documentary covering the Year 10 *chemical reactions* unit. It runs through
nine reels plus a cold open and an epilogue, with five freeze-frame recall checkpoints and a 12-question final exam.

## Watch it

**Double-click `dist/reactions-film.html`.** That's the whole film in one file: models, HDRI and fonts are embedded.
It needs an internet connection for three.js (jsDelivr) and the Google Fonts. Without a connection it still plays
the captions, freeze frames and exam over a dark gradient.

Controls: Space / K play-pause · ← → ±5 s · N next reel · click the picture to pause · the timeline seeks
(red ticks open freeze frames) · speed 1× / 1.5× / 2× / 0.75× · quality ULTRA / HIGH / LOW · Motion on/off.

## Layout

```
index.html            multi-file entry (serve the folder from any static host)
css/film.css
js/main.js            boot, playback engine, controls (no static three.js import)
js/stage.js           3D stage: renderer, lab, environment, scenes (loaded separately)
js/render/            pipeline (post, tiers, NaN guard, glass pass), materials, props, lab set
js/fx/                flame, bubbles, smoke/sparks/dye/fireball, precipitate + splash, molecules
js/scenes/            script.js (all text, timings, HUD data) + one module per reel, cold open, epilogue
js/ui/                captions, HUDs, reading-time map, question renderer, bank, overlays
js/chem/              formula / equation parser, solubility rules
assets/               HDRIs (.exr), CC-BY models (.glb, meshopt + WebP), title font subset
dist/                 the single-file build
test/                 asset pipeline, single-file build, unit + Playwright tests (not shipped)
```

## Build and test

```bash
cd test
npm ci
node build-assets.mjs     # re-fetch + licence-check + compress the models (pinned commits)
node build-single.mjs     # → dist/reactions-film.html
node unit.mjs             # equations, balance checker, reading time, data, module graph
node run-tests.mjs        # browser suite on the built file (SwiftShader WebGL)
node shots.mjs r5:8 r7:40 # screenshots → test/out/
```

## Assets

| File | What | Author | Licence |
|---|---|---|---|
| `assets/models/bunsen.glb` | Bunsen Burner | Dreamsoft Innovations Private Limited | CC BY 4.0 |
| `assets/models/tripod.glb` | Tripod stand | AmirulIqwan | CC BY 4.0 |
| `assets/models/retort.glb` | Burette stand | VeeRuby Technologies Pvt Ltd | CC BY 4.0 |
| `assets/models/burette.glb` | Burette | 3dLabWare | CC BY 4.0 |
| `assets/hdri/lab.exr`, `studio.exr` | interior HDRIs | Poly Haven (via @pmndrs/assets) | CC0 |
| `assets/fonts/inter_black_subset.json` | Inter Black | Rasmus Andersson | SIL OFL 1.1 |

Sources, pinned commits and modifications are in `assets/models/credits.json` and the `ASSETS` block in
`index.html`. Everything else is procedural: the glassware, balance, goggles, dropper bottles, tongs, gauze,
bench and room.
