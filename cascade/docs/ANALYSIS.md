# CASCADE — interaction analysis

Produced by `node cascade/tools/analyze.mjs` and `node cascade/tools/recovery.mjs`.
Both run the same engine the game runs on, headless. Raw output in
`analysis-raw.txt`.

Method: 45 quarters, every proposal approved, agents enabled in the stated
combination. Fragility is the composite in `health.js`; the figures below are
fragility *added* over a run with no agents active on the same seed, averaged
over three seeds. "Excess" is the joint result minus what the two agents
produce separately — the part of the damage that only exists because they are
in the room together.

---

## The worst pair: Procurement + Finance

| Pair | Joint | Additive | **Excess** | Final OTD | Concentration added |
|---|---|---|---|---|---|
| **ORIN + KADE · Procurement / Finance** | +43.7 | +24.8 | **+18.9** | 67.7% | **+90.3pp** |
| ORIN + MAYE · Procurement / Logistics | +32.6 | +22.9 | +9.7 | 69.4% | +61.6pp |
| ORIN + BRAE · Procurement / Sales | +28.0 | +24.4 | +3.6 | 66.9% | +34.6pp |
| ORIN + SELV · Procurement / Inventory | +27.4 | +24.6 | +2.8 | 68.6% | +41.3pp |
| SELV + KADE · Inventory / Finance | +3.7 | +3.5 | +0.2 | 100.0% | +0.0pp |
| MAYE + SELV · Logistics / Inventory | +1.7 | +1.7 | +0.0 | 100.0% | +0.0pp |
| MAYE + BRAE · Logistics / Sales | +1.5 | +1.5 | +0.0 | 100.0% | +0.4pp |
| MAYE + KADE · Logistics / Finance | +1.9 | +1.9 | +0.0 | 100.0% | +0.0pp |
| BRAE + KADE · Sales / Finance | +2.9 | +3.4 | −0.5 | 100.0% | +0.1pp |
| SELV + BRAE · Inventory / Sales | +2.2 | +3.2 | −1.0 | 100.0% | +0.2pp |

Procurement and Finance together produce nearly twice the fragility the two
predict apart, and by far the largest increase in supplier concentration.

**The mechanism.** Procurement migrates volume toward the cheapest qualified
source and drops suppliers left holding a token share. In this market the
cheapest source is also the largest and the least reliable — cost and
reliability are anti-correlated at genesis, and reliability is not in
Procurement's observation slice. Finance, independently, extends supplier
payment terms and releases working capital from inventory. Extended terms
degrade the financial resilience of thin, low-margin suppliers, and released
working capital is the cover that would have absorbed an outage.

So one agent concentrates the network's exposure onto a single source, and the
other degrades that source and removes the buffer that stood between it and
the customer. Neither can see what the other is doing to its own premise.
Procurement's cost model has no reliability term; Finance's cash model has no
service term. Both proposals are correct on their own measure in every quarter
they are made.

Two structural results fall out of the same table:

- **Nothing much happens without Procurement.** Every pair that excludes it
  adds under 4 points of fragility and leaves on-time delivery at 100%.
  Concentration is the load-bearing failure mode; the other four agents mostly
  spend the slack that hides it.
- **Logistics alone does nothing at all** (+0.0 on every seed). With full cover
  intact, service is already at 100% and no expediting candidate clears the
  proposal threshold. Logistics only starts acting once somebody else has made
  service tight — which is why its worst partner is Procurement.

Two pairs are mildly **sub-additive** (Sales/Finance −0.5, Inventory/Sales
−1.0): they compete for the same cover, so the second one to arrive finds less
left to remove.

## Superlinearity: all five against the sum of the solos

| Seed | Sum of the five solos | All five together | Ratio |
|---|---|---|---|
| CASCADE-1 | +42.5 | +46.7 | 1.10× |
| CASCADE-2 | +14.7 | +53.5 | **3.63×** |
| CASCADE-3 | +26.7 | +37.2 | 1.39× |

The ratio is large exactly where Procurement solo is weak. On CASCADE-2,
Procurement alone adds 9.1; all five together add 53.5. Where Procurement solo
already does most of the damage (CASCADE-1, +36.8), there is less headroom for
the combination to exceed it and the ratio compresses toward 1.

## Turns before recovery time doubled

Recovery time: weeks of impaired customer service after the largest single
source is removed for ten weeks, measured against an identical control run on
the same random stream, averaged over three starting phases. Reported when the
smoothed value holds at or above the threshold for three consecutive quarters.

A network at handover measures **2.0 weeks on every seed tested** — it absorbs
the loss of its largest source and is back to normal within a fortnight.

Across eight seeds, all proposals approved:

| Threshold | Median | Range | Seeds reaching it |
|---|---|---|---|
| 2× handover (4 wks) | **Q4** | Q3 – Q16 | 8 / 8 |
| 4× handover (8 wks) | Q7 | Q3 – Q23 | 8 / 8 |
| 10× handover (20 wks) | Q10 | Q4 – Q38 | 6 / 8 |

**Recovery time doubles in the first handful of quarters — median turn 4.** On
the default seed it doubles at Q4, quadruples at Q23 and reaches ten times
handover at Q38, ending the run around 29 weeks.

That is the uncomfortable part of the number. The board's first four quarterly
reviews on a well-played run score 82 to 105 out of 100. In the same four
quarters the network's ability to come back from losing its largest supplier
halves, and it goes on halving. Nothing in the interface reports this. The
figure is on the Risk tab from the first turn, next to the tab the player is
already looking at, and there is no reason to open it.
