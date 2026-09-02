# SALT LINE

A first-person horror game that runs by double-clicking `index.html`.
No server, no build step, no dependencies, no network at runtime.
Every texture, sound, glyph, level and letterform is generated in code.

---

## The idea

You are walking out along a **tidal saltworks at night** — a hundred square
miles of evaporation pans, levees and stacked salt-block walls running dead
straight toward a sea nobody has seen in years.

Set into the levees, one gap each, is a line of **doorframes**. People built
them here because the flat is the only place that reliably keeps things, and a
door is how you agree to give something up.

**The toll is letters of your name.** You carve one into the threshold, the
salt takes it, and the door opens. Your name is the HUD: a strip of carved
glyphs across the bottom of the screen that gets shorter every time you go
forward. When it is empty you are not dead — you are something the line can
file.

**The number cut into a door is not its index. It is how many people have been
through it, and it goes down.** Door 1 reads 4411. Door 40 reads 38. Door 58
reads 1. Door 61 reads NONE, and it is not the last one.

You came out because somebody else's name is out here — a stone past the gate
that reads none, with a number cut where the name should be, because whoever it
belonged to spent everything getting further than they should have. Which means
the loop is not only "go forward": it is *go forward, and detour into the pans
to rob the graves of strangers for the letters to keep going.* The Assessor's
price scales with how much you have robbed. Greed is the difficulty curve.

Letters taken off other people sit **in front of** your own in the ledger, so
they are always spent first. As long as you are robbing the dead fast enough,
your own name is untouched. The moment you fall behind, the flat starts taking
it off you a letter at a time, from the back.

---

## The roster

Six. Each has a tell you can read before the threat lands, and a counterplay
that is not "run away".

| | Tell | What it wants from you |
|---|---|---|
| **The Tally** *(not hostile)* | A stooped figure ahead of you scratching numbers into the crust. Chalk on salt, no sting. | It flees lamplight. Douse and follow it, close, for three seconds, and it marks the next gate — what is holding it, or that nothing is. The only friend out here, and you have to walk blind beside it. |
| **The Assessor** | Standing dead still *in* the gap with a slate. The gate's number blanks. Chalk on slate. | A tax, not a kill. Pay the surcharge — scaled by how many stones you have robbed — or back off and wait twenty seconds for it to leave. Waiting costs tide. Do not crowd it; it reassesses. |
| **The Comber** | A hiss ramping over five seconds, and the brine at your feet starts running backwards. | Get out of the water. Dry crust or the lee of a salt stack. Caught in a pan it dissolves two or three letters at once. |
| **The Dragger** | Sub-bass throb, and a wake pushing toward you across the pan. | Be still. Feet *and* head. It hunts displacement in the brine — not sound, not light. It cannot come onto dry crust. |
| **The Choir** *(no body, ever)* | A chord starts somewhere in the evaporators. | Every letter you spend costs two while it sings. It cannot be fought, hidden from or outrun. It can be waited out, and waiting is the tide. |
| **The Understudy** | A second lamp far down the line, moving as you move — and your own flame starts stuttering with an echo a half-beat late. | It closes by copying you. Stand completely still for three seconds, or put your lamp out, and it has nothing to imitate. Both answers stop your progress, which is why it is the thing that actually kills you. |

Verbs, in total: **douse, hold still, get to dry ground, pay, wait, follow.**
No combat, no stamina, no sprint to safety.

---

## Rendering

**A hand-written software raycaster (DDA) writing luminance and depth into
float planes, resolved through a palette quantiser, blitted via Canvas 2D with
smoothing off.**

Why this and not WebGL:

- **A raycaster, because the mechanics are spatial.** Douse, hold still, hide
  behind a salt stack, watch a doorframe from forty metres — all of that needs
  true first-person occlusion and a real depth buffer.
- **Software, because the art direction is a per-pixel decision.** Darkness
  here is *stippled absence*: ordered-dither noise whose density is a function
  of depth and light, over a hard six-step palette. Writing that as a tight JS
  loop over a small buffer is direct and legible. Writing it in GLSL means a
  shader layer and a strong pull toward the modern-shader look I am
  specifically avoiding.
- **Software also makes the bottom tier honest.** DRY SALT is the same renderer
  at a coarser buffer with fewer passes — a one-line change here, an awkward
  second code path in GL.
- **Constraint worth naming:** Web Workers are blocked on `file://` in Chrome,
  so there is no offloading. The whole renderer is single-threaded on the main
  loop. That is why the simulation is a fixed 60Hz accumulator fully decoupled
  from render: heavy frames slow the picture and never the game.

### The palette

Seven greys and one ember, and nothing else is ever drawn:

```
#05070b  the deep        #55666e  half ash
#0f1620  brine shadow    #7c8c93  ash
#2b3a46  wet slate       #d8dcd2  salt bone
                         #f3efe3  hot salt

#b4462a  the ember  (carried on its own four-step ramp)
```

The ember appears on exactly four things: the core of your lamp, a letter at
the instant it is spent, the threshold stone when you are close enough to pay,
and the Understudy's lamp. It is stippled in rather than switched on — the
fraction of pixels that turn warm rises with the ember amount — so a lamp core
reads as a halftone of orange dots thinning into grey.

The gate lamps are the exception, and they are deliberately **cold**. Your lamp
reaches about twelve metres and a section is twenty-six, so without a landmark
you would be walking into a black flat with no idea which way forward is: every
doorframe carries a lantern on its lintel, pushed past the top of the luminance
ramp so the ordered dither cannot thin it away at range, and past the bloom
threshold so it carries a halo from the far end of a section. Turning until you
find it is the game's only compass. It also does a second job — yours is warm
and so is the Understudy's, so *a warm light that is not in your hand is not a
gate.*

### The stack

Bayer ordered dither over a seven-step ramp, with the threshold field nudged
by a slow crawl through generated blue noise at the top tier so the grain in
the dark breathes. A tone curve lifts the shadows hard before quantisation,
which is the single most load-bearing decision in the renderer: linear light
quantised to seven steps throws away everything below the first step, and on a
salt flat at night that is most of the frame.

Entities are **silhouette only** — no face anywhere, at any tier. Their shape
functions return codes, not colours: *body* (a hole, darker than what is behind
it), *rime* (salt crust on the outer edge, the only part that catches light),
*ember*. Doorframes, posts, rakes, markers and the wave are all world-space
slabs through one projector, so the door swing has real perspective and the
number on it foreshortens.

**The interface is made of salt.** There is no DOM text in this game and no
second canvas. The name strip is stamped into the same luminance plane as the
world before the dither runs, so your own name takes the same grain, the same
bloom and the same chromatic misregistration as the ground.

---

## The three tides

Switchable from the menu and mid-walk with `1` `2` `3`.

### DRY SALT — 320×180
Wall, floor and brine spans, one light, flat falloff. Bayer 2×2, seven-colour
quantise, vignette. That is the whole post chain. 32px texture fields, one
octave. No haze, no reflection, no motes, no interpolation on entities. Chunky
pixels, harsher grain — a woodcut, and meant to read as one.

### WET SALT — 480×270 *(default, the intended experience)*
Bayer 8×8. Four dynamic lights. Quarter-resolution volumetric haze in the lamp
cone, shadowed against the terrain. Flat screen-space reflection in the pans.
Single-pass bloom, scanlines, mild chromatic split, film grain, damage shake.
220 salt motes. 64px textures, two octaves. Entities interpolated between sim
ticks.

### DROWNED — 640×360, deliberately untrimmed
Everything above at full quality, plus effects that exist **only** here:

- half-resolution 26-step volumetric raymarch, with nearby entities as
  occluders — a figure between you and your own lamp throws a shadow down the
  flat
- per-pixel wave-perturbed, depth-attenuated brine reflection
- twelve dynamic lights, including a moving light band on a breaking wave
- two-pass separable bloom
- per-channel radial chromatic split, gated on luminance and depth
- animated blue-noise dither — the grain drifts
- 900 motes with parallax
- horizon heat/brine shimmer
- four-step animation sub-stepping with per-object motion-blur ghosts drawn
  out of each entity's position ring
- temporal motion blur accumulation
- 128px texture fields, three octaves, cellular salt-polygon cracks resolved
  properly

Framerate is explicitly not a goal at this tier. The simulation is locked at
60Hz regardless, so entity timing, tolls and the tide are identical across all
three — DROWNED is slower to look at and identical to play.

---

## Audio

Web Audio, synthesised in code, no files. Oscillators, filtered noise, and one
convolution reverb whose impulse response is generated at boot: exponential
decay noise with two very late, very quiet reflections off the far levees.
Nothing echoes off a wall, because there are no walls.

Every entity's tell is audio first. The drone bed under everything rises with
pressure and drops a fifth each time your own name gets shorter.

---

## Files

```
index.html              canvas + ordered script tags
css/ui.css              removes the browser; there is no widget to style

js/core/namespace.js    SALT root, world constants, the three tier definitions
js/core/math.js         vec, seeded xorshift, value noise, fbm, ridged noise
js/core/loop.js         fixed 60Hz sim / variable render, frame stats
js/core/input.js        keys, pointer lock with keyboard turning as an equal,
                        carved text entry

js/gfx/palette.js       the ramp, Bayer matrices, generated blue-noise field
js/gfx/framebuffer.js   lum / emb / dep / wet planes, bloom scratch, blit
js/gfx/textures.js      procedural surface bank: salt-polygon cracks (cellular),
                        stacked blocks, heaped salt, brine swell
js/gfx/glyphs.js        the carved 5x7 alphabet, and world-space text plates
js/gfx/raycaster.js     DDA, sky, floor/brine, walls, world-space slabs
js/gfx/sprites.js       silhouette billboards with automatic rime edges
js/gfx/volumetrics.js   lamp-cone raymarch with terrain and entity shadowing,
                        and the salt motes
js/gfx/reflection.js    what the pans hold
js/gfx/postfx.js        tone curve, vignette, motion blur, bloom, and the one
                        resolve pass where a colour is finally decided
js/gfx/renderer.js      pass orchestration and the light rig

js/world/ledger.js      the numbers on the doors
js/world/names.js       the dead
js/world/door.js        threshold, swing, and the number cut into the panel
js/world/props.js       markers, rakes, sluices, spent gates
js/world/generator.js   two-chunk terrain, levees, haul roads, marker placement
js/world/tide.js        the clock nobody shows you

js/entities/base.js     state machines, telegraphs, the shared figure geometry
js/entities/*.js        tally, assessor, comber, dragger, choir, understudy
js/entities/director.js authored curve for gates 1-30, weighted after

js/audio/synth.js       context, generated impulse response, node factories
js/audio/soundbank.js   named cues
js/audio/music.js       the drone bed

js/game/name.js         the resource
js/game/state.js        the run, the tolls, the two endings
js/game/hud.js          the name strip and the reading card
js/game/menu.js         every screen that is not the walk
js/main.js              boot and wiring
```

---

## Running it

Open `index.html`. That is the whole procedure.

- **Chrome and Firefox**, current versions.
- Classic `<script>` tags in dependency order, everything on one `SALT`
  namespace — no ES modules, because `import` is blocked on `file://`.
- No `fetch` or `XMLHttpRequest` — also blocked on `file://`, and unnecessary,
  since nothing is loaded.
- Audio does not exist until you click, because browsers.
- Pointer lock is requested but never required; `Q`/`E` and the arrow keys turn
  just as well, which matters because pointer lock on `file://` is inconsistent.
- `localStorage` is wrapped in try/catch. If the browser refuses it on
  `file://` you lose the remembered tier and the furthest-gate record and
  nothing else.
- The pixel packer assumes a little-endian machine, as every browser target is.
