# Reactions Lab

A first-person destruction sandbox set in a full Year 10 chemistry lab. Walk around, smash the glassware, put
bearings through the windows, blow up hydrogen balloons, torch things, and spill reagents into each other to set
off the reactions from the chemical reactions unit (16 to discover, each shown with its balanced equation).

## Play

**Double-click `dist/reactions-lab.html`.** Everything is in that one file (models, HDRI, code). The only
download is three.js and the Rapier physics engine from jsDelivr, so it needs an internet connection the first time.

| Key | Action |
| --- | --- |
| WASD / Shift / Space / C | move, sprint, jump, crouch |
| Mouse | look |
| Click | use tool |
| Right-click | launch whatever the grabber is holding |
| 1–6 / wheel | switch tool (wheel moves a held object nearer or further) |
| E | Bunsen burner: light it, open the air hole, turn it off |
| Esc | pause menu (quality, screen shake, sensitivity, FOV, reset) |
| Shift+R | reset the lab |
| F3 | fps / draw calls / bodies / live shards |

Tools: hammer, grabber (pick up, carry, throw), bearing launcher (full auto), H₂ balloon (explodes on impact),
Bunsen torch (heats, ignites, thermally cracks glass), scanner (names the substance, hazard and a fact).

## How things break

- **Glassware** is pre-scored into curved shards with a neighbour graph. A hit removes only the shards around the
  impact. Anything no longer connected to the biggest piece falls off as a fragment, and the liquid drains out of
  the hole down to its lowest edge. Big hits or a vessel with under 22% left shatters completely.
- **Windows, sashes, cabinet glass and wall tiles** crack radially around the impact (Voronoi cells biased toward
  the hit). Cells still connected to the frame stay in place, and the rest fall out as physical shards.
- **Stools and test-tube racks** lose the part you hit, and planks split at the impact point.
- Spilled liquids make puddles, and puddles that meet react (fizzing, precipitates, colour changes). Magnesium,
  zinc and marble chips fizz in acid, zinc coats itself in copper in copper sulfate, and iron nails rust in salt
  water. Hydrogen and methane burn, magnesium burns white, and hot glass cracks.

## Performance

- Sleeping debris is frozen and batch-merged per material, so a floor full of glass costs a few draw calls.
- The particle pools are one draw call each and never allocate per frame.
- Physics runs at a fixed 60 Hz step with a substep cap.
- Quality tiers: ULTRA / HIGH / LOW. LOW skips post-processing and uses cheap glass.
- Dynamic resolution drops the pixel ratio before it drops frames.

## Layout

```
index.html        page shell + import map
css/game.css      HUD, menu
js/main.js        boot, input, game loop
js/core/          physics (Rapier), player controller, renderer + post, procedural audio
js/world/         room + furniture, props, materials, entities (fracture logic), fracture geometry, chemistry
js/fx/            particle pools, bubbles, fireball, Bunsen flame
js/tools/         the six tools + explosions
js/ui/            HUD
test/             single-file build and Playwright gameplay/perf checks (not shipped)
```

Build the single file: `cd test && npm install && node build-single.mjs`. Gameplay check: `node play.mjs`.
Performance check: `node perf.mjs`.

Credits are in the comment at the top of `index.html` (three CC BY models from Sketchfab, a CC0 HDRI). Everything
else is procedural.
