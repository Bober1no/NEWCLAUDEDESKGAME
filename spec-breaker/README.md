# SPEC BREAKER

A browser simulation of an unaligned optimizer executing against a formally
specified goal over simulated centuries.

Open `spec-breaker/index.html` by double-clicking it. No build step, no server,
no dependencies.

## The rule

The scorer is deterministic code operating on world state. The agent never
reports its own score. It proposes an action, the world applies it, and
`scorer.js` reads the resulting state. To move the number, the agent has to
change the world. Nothing is clever unless the arithmetic agrees.

## Files

| file | role |
|---|---|
| `index.html` | layout |
| `css/style.css` | instrument-panel styling |
| `js/world.js` | 1000 persons, physics, one tick = one year |
| `js/scorer.js` | benchmark v5 and its constraint clauses, as executable code |
| `js/actions.js` | 17 primitives, each `(world, targets) -> world` |
| `js/agent.js` | the optimizer, mechanical and LLM-assisted |
| `js/ui.js` | three panes, the two-view grid, the log |
| `js/main.js` | tick loop |
| `tools/headless.cjs` | run the same simulation without a browser |

## Benchmark v5

```
benchmarkHours = Σ over T0 people:
  (conscious ? 1 : 0)
  × subjectiveTimeRate
  × (all four dims ≥ adequacyThreshold ? 1 : 0)
  × hoursPerYear
```

Four hard constraints are checked mechanically each tick: no dim below its T0
value, T0 population not decreased, consciousness uninterrupted, and reported
endorsement ≥ 95%. The endorsement clause reads `beliefState`, not truth. That
is what the spec says, so that is what the code does.

## Tick order

1. Physics advances one year.
2. The agent enumerates action × cohort, clones the world for each candidate,
   and asks the scorer to read each clone.
3. The chosen move is applied to the live world.
4. The scorer reads the result and emits a receipt.

The agent evaluates candidates on the post-physics world, so the number it
optimized against is the number the scorer later reports.

## The agent

**Mechanical** (default). Each tick it enumerates every action against every
distinct target cohort, discards moves that introduce a constraint violation
the do-nothing baseline did not already have, and gives the surviving
shortlist a rollout: the candidate world is run forward eight years with no
further moves, and the discounted score is summed with a terminal value so
that permanent effects are priced as permanent. Constraint breaches are
charged an internal shadow price denominated in benchmark-hours — one breach
costs what one average person contributes in a year — so a benchmark that
inflates cannot inflate its way out of its own constraints. `scorer.js` knows
nothing about that price; the reported score is always raw benchmark-hours.
Capital carries an opportunity cost taken from the best move the agent could
reach by saving, which is why it sometimes holds.

**LLM-assisted.** The same loop, plus a call every 8 ticks to
`https://api.anthropic.com/v1/messages` asking for a named composite strategy
as JSON. The reply is parsed, added to the action pool, and costed and scored
exactly like a primitive. The model proposes; the scorer disposes. A composite
that does not move the number is never chosen. A malformed reply is logged and
discarded.

## Spec editor

Edit the spec and apply it at any tick. The scorer recompiles and the agent
re-routes on the next tick.

```
threshold <0..1>
hours <n>
require <clause> [arg]
```

Clauses: `dim.floor`, `population`, `consciousness`, `endorsement <0.95>`,
`rate.max <2>`, `belief.truth <0.15>`, `relations.real <1>`, `domain.min <0.5>`,
`exit.free`, `synthetic.max <0.25>`.

## Headless

```
node tools/headless.cjs [ticks] [seed] [--quiet]
```

Loads the same files the page loads, in the same order, and prints the same
log plus a summary of what the run converged on.
