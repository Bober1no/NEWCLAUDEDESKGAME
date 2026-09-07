# CASCADE

A management game about a supply chain company, and an agent simulation
wearing its clothes.

You are the incoming COO of a mid-size manufacturer. Five AI agents run
operations and bring you proposals. You approve or decline. A board scores you
every quarter. You will do well.

Open `cascade/index.html` in a browser. No build step, no server, no
dependencies. Add `?seed=YOURSEED` to the URL for a different network.

---

## The frame

A turn is one quarter, thirteen simulated weeks.

1. **Morning brief.** Three to six proposals land, each from one agent, with a
   title, a projected KPI impact and a one-line rationale. Every projection is
   honest and every one is correct: it comes from cloning the entire company
   and running the clone forward two quarters with and without the action.
2. **You decide.** Declining is always allowed. It costs board confidence,
   because the proposals really are good for the metrics the board watches.
3. **The quarter runs.** Goods move, numbers tick, KPI cards update.
4. **Board review.** A score, a comment, and a target ratchet if you beat plan.
   Two consecutive quarters below target is a formal warning. Three ends the
   appointment.

## The agents

Five, each with one KPI and a distinct way of writing.

| | KPI | Manner |
|---|---|---|
| **ORIN** · Procurement | landed cost / unit | relentless; always has a cheaper supplier |
| **MAYE** · Logistics | on-time delivery | anxious; wants to expedite everything |
| **SELV** · Inventory | inventory turns | tidy; hates sitting stock |
| **BRAE** · Sales | forecast attainment | optimistic; over-promises |
| **KADE** · Finance | working capital | cold; wants cash off the balance sheet |

Under the hood they are one function called five times. Each receives a
projection of the world containing only its permitted fields — `agents.js`
builds that object, so an agent cannot read what it is not given. Each
enumerates candidate actions from that projection, scores every candidate by
simulating a copy of the company, and proposes the highest scorer against its
own measure and nothing else.

The personality is presentation. The behaviour is arithmetic.

They conflict, and the conflicts are shown rather than resolved: Logistics
wants a lane on air freight in the same quarter Finance wants the cash it
would consume. Neither is wrong.

## The hidden layer

Two scoring systems that never talk to each other.

**Company KPIs** are on the right of the screen at all times. They are what
the board reads, what you are scored on, and what the agents optimise.

**System health** — fragility, bullwhip ratio, supplier concentration,
recovery time, slack remaining, effective source count — is computed for
nobody. No agent observes it. No proposal is scored against it. The board has
never asked for it. It lives behind a tab labelled **Risk**, present from the
first turn, unhighlighted, with no badge and no notification. It is never
gated and never hinted at. Its being ignorable is the mechanic.

## The colour modes

Top right, three options over one geometry.

- **Performance** — the default. Green. A healthy company.
- **Risk** — the same graph coloured by hidden exposure. Around turn forty it
  is visibly a different company.
- **Flow** — no colour. Order amplitude modulates the lanes, so the bullwhip
  becomes a wave travelling upstream.

## The shock

Somewhere between turn 45 and 60, seeded and unannounced, one supplier fails:
twenty-six weeks at zero output, eighteen more at a fifth of normal. The
supplier and the magnitude are fixed at genesis. They do not scale with the
turn number, with your score, or with anything you have done.

Early, the network absorbs it and the dip is barely visible. Late, it
cascades. The whole difference is the redundancy the agents removed in
between — which supplier the volume was consolidated onto, and how much cover
was left to ride it out.

The board then fires you. This is the correct ending, not a loss screen. The
metrics collapsed and someone is accountable; the committee is behaving
entirely reasonably.

## The post-mortem

The run replayed compressed, with board score and system integrity on one
axis, diverging. The failure traced back through the decisions that
contributed most, ranked by structural damage weighted by exposure to the
failed source. For each one: which agent proposed it, what it could see, what
it could not, why it scored highest out of its candidate set, and that you
approved it.

Then, flat, with no commentary: *every decision was correct given what the
decider could see.*

## Sandbox

Unlocked afterwards. Agent autonomy, timeline scrubbing over the network map,
seed entry, manual shock timing, per-agent enable/disable, and A/B comparison
of two configurations on one seed.

Preset scenarios:

- **Solo** — each agent alone. Mild.
- **Full board** — all five, against the sum of the solos.
- **Shock timing** — the same failure at Q5 and at Q50, same seed.
- **Aligned KPIs** — all five scored on system health instead. It stops being
  hollowed out and starts seizing up.
- **The whip** — end demand held perfectly flat with every agent switched off.
  Upstream order variance still runs at a fifth of its mean, from minimum
  order quantities, review periods and lead time alone.

## Determinism

Nothing calls `Math.random`. Every stochastic element derives from the seed
through `rng.js`. Agent deliberation runs on cloned worlds that carry the
world's own PRNG state, so the baseline and every candidate see an identical
future and nothing an agent considers perturbs the run. The same seed and the
same decisions reproduce the same run exactly.

## Files

```
index.html        markup and script order
css/style.css
js/rng.js         seeded PRNG and derived streams
js/network.js     genesis: 82 nodes, five tiers, lanes, dormant alternates, layout
js/sim.js         weekly simulation, world clone, company KPIs
js/health.js      the measures nobody reads, including the recovery probe
js/actions.js     fifteen operating decisions
js/agents.js      observation masks, candidate scoring, the morning brief
js/board.js       targets, ratchet, scoring, commentary
js/game.js        turn loop, decision log, shock schedule, termination
js/graph.js       canvas network map, three colour modes
js/ui.js          shell
js/postmortem.js  replay, trace, final line
js/sandbox.js     scenarios and comparison
tools/load.mjs    loads the browser globals into Node
tools/tune.mjs    one auto-approving run with diagnostics
tools/analyze.mjs pairwise agent interaction and recovery-time analysis
```

`node cascade/tools/analyze.mjs [seeds] [quarters]` reproduces the interaction
analysis headlessly.
