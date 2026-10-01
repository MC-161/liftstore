# Decision record: percentile queries

**Query.** Given a lifter's total, what percentile is it within a comparable
population? For example: a woman totalling 500 kg raw in full power, weighing
61 kg — where does that sit?

All figures below are measured on `openpowerlifting-2026-09-12-64bfe49f.csv`
(4,032,180 rows). "Ranked rows" means rows with a numeric `Place` and a
total: 3,748,104 of them.

---

## 1. Exact or approximate

**Options**

| | Approach | Cost |
|---|---|---|
| A | Sort the matching subset per query | O(n log n) per query |
| B | Sorted array per group, built at load; binary search per query | 15 MB total, ~17 comparisons per query |
| C | t-digest or similar sketch per group | ~3 MB total, bounded error, ~400 lines |
| D | Fixed-width histogram per group | small, poor tail accuracy, ~50 lines |

**Trade-off.** Approximate sketches exist to handle data that is unbounded,
streaming, or too large to hold. None of those conditions applies here. All
3,748,104 ranked totals stored as sorted `float` arrays come to **15 MB** —
about 1% of the current column store — and a percentile is then a binary
search over at most 159,567 values: 17 comparisons, sub-microsecond, exact.

t-digest would save roughly 12 MB and cost exactness, plus a considerably
harder implementation whose failure mode is silent: a subtly wrong digest
returns plausible percentiles that are quietly incorrect, detectable only by
comparing against an exact implementation. Its accuracy advantage over a
plain histogram is concentrated in the tails, which is precisely where
percentile queries matter in this sport — but that only argues for t-digest
over histograms, not for either over exactness.

**Choice: B — exact, via one sorted array per group, built at load.**

**Reasoning.** The dataset is small enough that exactness is free. Choosing
an approximation here would be paying complexity and error for 12 MB on a
machine with gigabytes to spare. Approximation becomes the right answer if
the data outgrows memory, or if groups must be updated continuously rather
than rebuilt at load — neither is true of a load-once, query-many engine over
a static snapshot.

---

## 2. Grouping: what counts as a comparable population

**Options**

| | Approach | Groups | Tiny groups (<30) |
|---|---|---|---|
| A | The recorded `WeightClassKg`, as-is | 3,036 | 1,934 (64%) |
| B | Raw bodyweight buckets of fixed width | (not measured) | — |
| C | IPF classes, assigned by actual bodyweight | **563** | **184 (33%)** |

**The problem with A.** `WeightClassKg` holds 405 distinct values because
federations use different schemes and eras: a lifter at 82.8 kg appears as
`82.1`, `82.5`, `83`, or a pound-derived value depending on where and when
they competed. The column also carries three notations — plain numbers,
`120+` for open classes, and `-74` for "up to 74 kg" — plus 371 rows that are
a bare `+`. Grouping by the recorded label splits identical athletes across
near-identical groups: the men's raw SBD 83 kg group holds 84,287 rows under
scheme A and 159,567 under scheme C, because the other half of those lifters
were recorded under a different label for the same bodyweight.

Inspecting the class values rules out a tolerance-based normalisation: they
are effectively continuous (100, 100.2, 101.5, 101.6, 101.8, 102, 102.5,
102.9, 103, 103.2, 103.4, 103.8 …), so any snapping boundary would be
arbitrary and would split lifters of near-identical bodyweight.

**Trade-off for C.** Weight class is the organising principle of the sport,
so discarding it entirely (option B) answers a different question: "how do I
compare to lifters my size" rather than "how do I compare within my class".
Option C keeps classes as the concept but assigns them by measured
bodyweight, which costs faithfulness to the recorded label: a lifter who cut
to make an old 82.5 class while weighing 81 kg is grouped into the 83 class
here. Coverage also differs — assignment needs a bodyweight, and the IPF
scheme has no category for `Mx`.

**Choice: C — IPF classes, assigned by the bodyweight actually recorded.**

Men: 53, 59, 66, 74, 83, 93, 105, 120, 120+
Women: 43, 47, 52, 57, 63, 69, 76, 84, 84+

A class is an upper bound: 82.9 kg is in the 83 class, 83.1 kg is in the 93
class. Full grouping key: sex × equipment × event × IPF class.

**Reasoning.** It preserves weight class as the unit of comparison, which is
how the sport works, while removing fragmentation that is an artefact of
federation and era rather than of athletes. It also sidesteps the three
notations and the 405 distinct labels entirely, since the assignment reads
`BodyweightKg` — a measured number present in 98.9% of rows — rather than a
label.

**Coverage.** 3,721,912 of 3,748,104 ranked rows are assignable. The 26,192
excluded rows are exactly those with no bodyweight, plus the 199 `Mx` rows
that the IPF scheme has no category for; verified by direct count, so nothing
else is silently dropped. `Mx` lifters and rows without a bodyweight are
reported as unrankable rather than folded into another group.

**Deviations, stated.** The 53 and 43 kg classes are junior categories under
IPF rules; they are applied to all ages here so the lightest lifters form
their own group rather than inflating 59/47. The IPF class list has changed
over time (notably in 2011); the current scheme is applied to all historical
results.

---

## 3. Small groups

**Options**

| | Approach | Effect |
|---|---|---|
| A | Refuse below a threshold | 184 groups answer nothing |
| B | Widen to a broader group | always answers, silently changes the question |
| C | Answer, and return the group size | user judges significance |

**Trade-off.** A percentile over four results is not wrong, it is
meaningless: with n=4 the only achievable values are 0, 25, 50, 75 and 100,
so reporting "87th percentile" implies precision that does not exist.
Refusing is honest but unhelpful; widening is helpful but answers a question
the user did not ask, without telling them.

**Choice: C — always answer, always return `n` alongside the percentile.**

**Reasoning.** The response carries the information needed to judge it, and
the engine does not silently redefine the query. Under the IPF grouping this
path is close to irrelevant anyway: only **2,106 rows of 3,721,912 (0.06%)**
fall in groups smaller than 30, down from roughly 56,000 under the recorded-
class grouping — a 26× reduction, and a second argument for that grouping
decision.

**Percentile definition.** Percentile = (count of totals in the group
strictly below the query value) ÷ (group size), reported as a percentage with
`n`. No interpolation between order statistics. Chosen because it is the
simplest definition to state and the least misleading on small samples; the
several standard interpolation methods disagree precisely where n is small,
which is where honesty matters most.

---

## Implementation consequences

- A derived `uint8` column, `ipf_class`, computed at load from `bodyweight_kg`
  and `sex` (255 = unassignable). ~4 MB. This makes group membership an
  integer comparison, matching how the existing filters work.
- Derived columns are marked as such in the header, and never overwrite the
  raw column they are computed from: `weight_class_kg` keeps the recorded
  value, so the derivation stays auditable and the raw data reproducible.
  (The dataset itself already ships derived columns — Dots, Wilks,
  Glossbrenner and Goodlift are computed from total and bodyweight, which is
  why they are empty exactly when bodyweight is.)
- Per-group sorted total arrays are built once at load: ~15 MB, 563 groups.
  Load cost to be measured; percentile queries are then binary searches.
- `parse_weight_class` currently accepts `-74` as −74.0 kg. The strict
  parsers reject values that cannot be parsed, not values that are
  implausible; a range check belongs alongside them. Not load-bearing for
  this design, since grouping no longer reads that column, but it should be
  fixed.