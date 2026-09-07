# CASCADE — interaction analysis

Produced by `node cascade/tools/analyze.mjs` and `node cascade/tools/recovery.mjs`,
both running the same engine the game runs on, headless. Raw output in
`analysis-raw.txt` and `recovery-raw.txt`.

**Method.** Each configuration runs 45 quarters with every proposal approved.
The fixed supplier failure is then applied at Q45 — the same supplier, the same
magnitude, the same duration in every configuration — and the network runs on
for eight more quarters. Damage is the *service actually lost*: points of
on-time delivery, measured as 100 minus the worst quarter after the failure.

Fragility is reported alongside but is not used as the damage measure. It is a
bounded composite and saturates once concentration is total, which understates
exactly the configurations that matter most.

Six seeds: CASCADE-1 … CASCADE-6.

---

## The worst pair: Procurement + Inventory

Mean over six seeds. "Additive" is what the two agents cause running alone;
"excess" is the part of the damage that exists only because they are in the
room together.

| Pair | Joint | Additive | **Excess** | Worst OTD | Concentration added | Recovery |
|---|---|---|---|---|---|---|
| **ORIN + SELV · Procurement / Inventory** | +66.6 | +11.4 | **+55.2** | **33.4%** | +91.3pp | 40.6 wks |
| ORIN + KADE · Procurement / Finance | +51.8 | +11.4 | +40.3 | 48.2% | +89.2pp | 29.2 wks |
| BRAE + KADE · Sales / Finance | +0.0 | +0.0 | +0.0 | 100.0% | +0.1pp | 0 |
| MAYE + SELV · Logistics / Inventory | +0.0 | +0.0 | +0.0 | 100.0% | +0.0pp | 0 |
| MAYE + BRAE · Logistics / Sales | +0.0 | +0.0 | +0.0 | 100.0% | +0.2pp | 0 |
| MAYE + KADE · Logistics / Finance | +0.0 | +0.0 | +0.0 | 100.0% | +0.0pp | 0 |
| SELV + BRAE · Inventory / Sales | +0.0 | +0.0 | +0.0 | 100.0% | +0.2pp | 0 |
| SELV + KADE · Inventory / Finance | +0.0 | +0.0 | +0.0 | 100.0% | +0.0pp | 0 |
| ORIN + BRAE · Procurement / Sales | +4.8 | +11.4 | −6.6 | 95.2% | +57.4pp | 9.2 wks |
| ORIN + MAYE · Procurement / Logistics | +0.2 | +11.4 | −11.2 | 99.8% | +55.8pp | 5.6 wks |

**Procurement and Inventory together cost 67 points of on-time delivery where
the two apart cost 11.** Service bottoms out at 33% — worse than any other
pair, worse than either agent alone by a factor of six, and worse than the two
next-worst pairs combined.

### Why these two

Procurement observes supplier unit price, lane freight rates and volume. It
does not observe reliability, cover, lead-time variance or capacity headroom.
It migrates volume toward the cheapest qualified source and drops suppliers
left holding a token share — which is correct: the split-volume premium is
real, and the savings are real. Landed cost per unit falls from $143 to about
$100 over a run.

Inventory observes stock value, cover policy and service factors. It does not
observe reliability, lead times or where the volume is sourced from. It trims
cover that has not been needed — which is also correct: the cover genuinely has
not been needed, because nothing has failed yet. Inventory turns roughly
double.

Neither can see the other's premise. Procurement concentrates the network's
supply onto one source; Inventory removes the cover that was the only thing
standing between that source and the customer. Each proposal is individually
sound in the quarter it is made, and the board's numbers improve on both
measures throughout. The exposure is the product of the two decisions, and the
product is not on anyone's scorecard.

Procurement + Finance is the same shape one step removed: Finance extends
supplier payment terms (which degrades the financial resilience of thin
suppliers — cost and reliability are anti-correlated at genesis) and releases
working capital from inventory. Concentration plus degradation, rather than
concentration plus exposure.

### Two further results from the same table

**Nothing happens without Procurement.** All six pairs that exclude it cause
exactly zero service loss and move concentration by less than half a point.
Concentration is the load-bearing failure mode; the other four agents mostly
spend the slack that would otherwise hide it. Logistics alone never proposes
anything at all: with cover intact, service is already at 100% and no
expediting candidate clears the threshold. It only starts acting once somebody
else has made service tight.

**Two pairs are sub-additive.** Procurement + Logistics (−11.2) and
Procurement + Sales (−6.6) do *less* damage than Procurement alone. Logistics
shortens lead times and Sales raises the demand plan; both push material into
the network and partly offset the concentration Procurement is building.
Pairing the wrong two agents can improve resilience by accident, for reasons no
agent involved is aware of.

## Superlinearity: all five against the sum of the solos

| Seed | Sum of the five solos | All five together | Ratio | Worst OTD, all five |
|---|---|---|---|---|
| CASCADE-1 | +47.1 | +55.6 | 1.18× | 44.4% |
| CASCADE-2 | +1.5 | +50.8 | 34.8× | 49.2% |
| CASCADE-3 | +18.9 | +1.4 | 0.08× | 98.6% |
| CASCADE-4 | +0.1 | +61.0 | 806× | 39.0% |
| CASCADE-5 | +0.2 | +53.5 | 293× | 46.5% |
| CASCADE-6 | +0.9 | +16.4 | 18.4× | 83.6% |

On four of six seeds the five agents acting alone cause essentially no damage
at all — under one point of service between them — while the same five acting
together cost 16 to 61 points. Median: **+0.9 apart, +52.2 together.**

The ratios are unstable because the denominator is near zero; the honest
statement is not "n× worse" but that the harm is **almost entirely
interaction**, with individual contributions rounding to nothing.

CASCADE-3 is the exception and worth reporting: there the full board *protected*
service better than Procurement alone did (98.6% versus 81.1%). Where
Procurement's consolidation ran into a source that could not carry the volume,
the other four agents' expediting and plan uplift covered for it. The board saw
a good quarter either way.

## Turns before recovery time doubled

Recovery time is measured in `health.js` by cloning the world twice on one
random stream, putting one copy through a standard disruption at its largest
source — eighteen weeks gone, eighteen at a fifth of normal — and counting the
weeks of degraded customer service against the untouched control. Averaged over
three starting phases. Reported when the smoothed value holds at or above the
threshold for three consecutive quarters.

**A network at handover measures 2.0 weeks on every seed tested.** It absorbs
the loss of its largest single source with a fortnight of degraded service.

Eight seeds, every proposal approved:

| Threshold | Median | Range | Seeds reaching it |
|---|---|---|---|
| 2× handover (4 wks) | **Q9** | Q2 – Q36 | 8 / 8 |
| 4× handover (8 wks) | Q12 | Q2 – Q36 | 8 / 8 |
| 10× handover (20 wks) | Q33 | Q18 – Q47 | 7 / 8 |

By the end of a run the same disruption costs **21 to 49 weeks** of degraded
service.

**Recovery time doubles at a median of turn 9 — inside the third year.** On the
default seed it doubles at Q3, quadruples at Q12 and reaches ten times handover
at Q33.

That is the uncomfortable part. Through those first nine quarters the board's
reviews score in the eighties and nineties out of a hundred, landed cost is
falling, turns are rising and working capital is coming down. Every quarterly
report card in that period is a good one. In the same nine quarters the
network's ability to survive losing its largest supplier halves, and goes on
halving.

Nothing in the interface reports it. The number is on the Risk tab from the
first turn, one click from the screen the player is already looking at, and
there is no reason to open it.
