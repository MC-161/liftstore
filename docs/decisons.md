# Design decisions

What was decided and what was rejected. The code says *what* it does; this says *why*,
and what the alternative was.

---

## 1. Storage and layout

**Columnar: 43 parallel column vectors, not `std::vector<Lift>`.**
A filter scan touches 3–5 columns out of 42. Row-major pulls the whole 200-ish-byte
row into cache to read 20 bytes of it; columnar pulls only the columns named.
Measured: query 104.9 ms → 5.2 ms (19.6×), memory 3.07 GB → 1.49 GB (2.1×).
Rejected: keeping the row struct. It survives in `lift.h` as the parse target only.
Accepted cost: loading is 1.5× slower — more, smaller writes scattered across 43
destinations instead of one sequential append.

**Dictionary encoding for names, federations, meets.**
Two wins, not one: memory (a `uint32` instead of a repeated string) and comparison
(integer equality instead of `strcmp`). `top_lifters_columnar`, `nearest` and the Q10/Q7
lifter grouping all dedupe on the *index*, so the second win is the load-bearing one.

**NaN sentinel for missing values, not a bitmap or `std::optional<float>`.**
`optional<float>` doubles the column's width and destroys the scan's density.
A parallel bitmap keeps density but costs a second random-ish read per row.
NaN is free: the column stays 4 bytes and `is_missing` is one comparison.
Relies on NaN ≠ NaN, so the test is `std::isnan(x)`, never `x == kMissing`.

**The IPF class is computed at load and stored as a `uint8` column**, not re-derived per
scan. `255` (`kNoIpfClass`) marks rows with no bodyweight, and every Mx row.
Consequence worth knowing: every Mx group is empty *by construction*, so an Mx query is
not a valid test of the `n == 0` path — it would pass for any equipment, event or class.
One `q4.sh` case was written that way and had to be replaced.

**`done_loading()` finalises the dictionaries.**
Known defect: `Dictionary::find()` returns 0 for everything afterwards. Never caught a
query because no query path calls `find()` after loading — all lookups go
index → string via `value()`. On the polish list.

---

## 2. Layering

**`engine_core` must not know about gRPC or protobuf.**
The engine is testable, benchmarkable and reusable without a server; the adapters are
replaceable without touching the engine. Concretely: Google Benchmark links
`engine_core` alone, and the Go gateway talks to the same domain through a different
transport without the engine knowing it exists.

**Adapters live in `service/` as their own static library.**
Translation (`from_proto`), validation, and limits are transport concerns, so they sit
with the transport, not in the engine and not in `apps/`.

**Naming rule: wire types always carry `v1::`, domain types never do.**
`v1::Sex` vs `Sex` tells you, at every line of an unfamiliar handler, which side of the
boundary you're on without checking an include.

**`percentile.h` = pure index lookups. `query.h` = anything that needs the store.**
Established when `nearest` needed the name column. Where a function lives is decided by
what it needs *access* to, not by what category it feels like.

**`nearest` takes `const std::vector<std::uint32_t>& names` rather than moving to `query.h`.**
Moving it would have forced `find_index` and `count_below` — both private — into the
public header, to buy tidiness only. Passing the column keeps the index ignorant: it
receives opaque integer identity tokens and never learns they are names.

**Client-facing limits live in the service layer; data facts live in the domain.**
`kDefaultLimit`, `kMaxLimit`, `kNeighbourCount`, `kDefaultBinWidth`, `kMaxBins`,
`kMinYear`/`kMaxYear` are policy about what a client may *ask for*. `kIpfClassCount` is a
fact about the IPF class scheme, so it lives in `ipf_class.h` — and `slot_of` must use the
same constant, or the bounds check and the addressing can drift apart.

**Guards belong in the domain, not repeated in each adapter.**
The `n == 0` guard went into `percentile_of`, not the handler, because every caller hits
it. Same for the `ipf_class` bounds check: the domain should not be enterable into
undefined behaviour by any caller.

**The resolver family.** `resolve_limit`, `resolve_bin_width`, `resolve_years` all sit in
the service layer and do the same job: turn a client's request into something the domain
can safely receive, or refuse it. `resolve_limit` returns `std::optional` because the
handler already has the requested value for its error message; `resolve_bin_width` and
`resolve_years` return small structs because their messages need a *computed* value, and
recomputing it in the handler would be a second copy of the formula. `optional` is right
when failure carries no information; a struct is right when it does.

---

## 3. The percentile index

**1,134 preallocated slots addressed by mixed-radix `slot_of`, not a hash map.**
3 (sex) × 6 (equipment) × 7 (event) × 9 (class) = 1,134. Lookup is arithmetic plus one
array index — no hashing, no collision chain, no allocation. 563 of the slots are empty;
an empty `GroupIndex` costs four empty vectors, which is cheap enough that the
simplicity wins. Measured lookup: 1.5 µs.

**Four separate `LiftIndex` per group (squat, bench, deadlift, total), stored not derived.**
A total cannot be reconstructed from the three lifts: a row may have a total with
missing component lifts, the components may not sum to the recorded total, and for a
single-lift event the "total" *is* that lift. See §6.

**`Entry` is `{float value; std::uint32_t row;}` — 8 bytes.**
`row` is the ticket back to the full record. Deliberately does *not* carry the name index,
which would grow it to 12 bytes (16 with padding) to save one indirection in one query.

**Sort on value, tiebreak on `row`.**
`a.value < b.value` alone is not a strict weak ordering over equal values, so the result
depends on the sort implementation and is not reproducible between runs. The tiebreak
makes percentile and rank deterministic.

**Means accumulate in `double` even though elements are `float`.**
Totals sum to ~1.8e9 across 3.7 M rows; a `float` ULP at that magnitude is ~110 kg, so
each addition could silently lose an entire lifter's contribution. Every mean in the
codebase — index build, `attempts`, `class_trend`, `equipment_swap`, `class_change` —
follows this.

**Standard deviation is two-pass, not `E[X²] − E[X]²`.**
The algebraic form subtracts two large, nearly equal numbers and loses most of the
significant digits. Two passes cost one more sweep of an array already in cache.

**Population divisor `n`, not `n − 1`.**
The group is a complete enumeration of every recorded result, not a sample drawn from a
larger population.

**`min`/`max` read from `sorted.front()` / `sorted.back()`.**
O(1) because the array is already sorted — but the first fields that *derive* from the
container rather than being stored on the struct, so they are the first to need an
emptiness guard. `mean` and `sd` are stored `double`s and default safely to 0. Stored
fields have safe defaults; derived ones have preconditions, and that distinction is what
tells you where a guard is needed.

**One percentile convention for the whole codebase: `rank_index_at()`.**
Nearest-rank, flooring. Returns a weight somebody actually lifted rather than an
interpolated value nobody did — "the 90th percentile total is 420 kg" is a real result,
419.73 is not. `p = 0` gives the minimum, `p = 100` the maximum. Both Q5's
`value_at_percentile` and Q11's p50/p90 go through it, so the API cannot report two
different p50s for the same group. `rank_index_at` is the shared piece rather than
`value_at`, because a `LiftIndex` holds `Entry` and a trend year holds `float` — same
formula, two containers, one source of truth.

---

## 4. API and wire contract

**Fail loud on limits; never silently clamp.**
A client asking for 50,000 and receiving 10,000 with no signal will ask again, and the
user never learns there's a limit. Every rejection names both the requested value and the
bound — and for the computed ones (`bin_width` → bin count) the number that broke it.

**An empty group is returned populated, not as `NOT_FOUND`.**
`n == 0` is an answer: the weight class exists, nobody has lifted in it. The client
renders "no data" from `n`, not from a missing row. Q6 returns all nine classes for the
same reason — a missing row makes the chart's x-axis silently skip a class.

**Derived fields are allowed in responses, but tested by derivation.**
`success_rate`, `sigma_marks` and `percentile` are all computable from other fields in
the same message. They're kept for client convenience, which makes them a second source
of truth — so the tests assert `percentile == 100*below/n` rather than a pinned
constant, and a disagreement between a field and its own inputs is a test failure.

**`rank` means "where you would place if you entered this group", range [1, n+1].**
`rank = n − count_at_or_below(value) + 1`. Ties share the better rank. Someone below
everyone gets `n+1`, which is correct for that reading and looks like an off-by-one if
you assume the range is [1, n]. Commented in the code for that reason.

**Field numbers are the contract; names are free.**
`total` → `value` kept field number 5, so existing binary clients were unaffected.
What broke: the JSON key, every grpcurl payload, and the generated accessor name.
`from`/`to` → `from_equipment`/`to_equipment` the same way — renamed while it was still
free, because `from` is a Python keyword that protoc mangles for any Python client.
New fields are **appended** (`transitions = 6`), never renumbered.

**`GroupKey` in the new requests only; `PercentileRequest` and `TopLiftersRequest`
left alone.** Retrofitting it would have churned two working handlers and two test
scripts mid-sprint for consistency alone. The inconsistency is deliberate.

**`ipf_class` validation is required wherever the client sends it, and not where the
server derives it.** `Percentile` computes the class from bodyweight and cannot be out
of range. `Distribution`, `Attempts`, `ClassTrend`, `EquipmentSwap` take it raw as a
`uint32` — unchecked, `slot_of` indexes past `groups_`, which is undefined behaviour, not
a wrong number. `ClassSweep` needs no check at all because it *generates* the classes.
The validation a value needs is determined by where it comes from.

**`kMaxLimit = 30000` exceeds gRPC's default 4 MB client receive limit.**
Known: the real boundary is lower than the declared one and is still untested.

---

## 5. Query decisions

### Q1/Q3 — top lifters
Dedupe by name index with a doubling retry: fetch k, dedupe, and if short, refetch at
2k. You cannot fetch exactly k and dedupe once, because you don't know in advance how
many rows collapse into one lifter.

### Q2 — conditional percentile
**The ±tol window applies to the *condition* lift only, never the target.**
The condition selects a cohort ("lifters who bench about 100 kg"); the target is the
quantity being measured within it. Windowing both would answer a different question.

**One widening retry at `tol*2` if `n < min_n`, with no re-derivation.**
A wider window is a strict superset of a narrower one, so `n` is monotonic in `tol` —
a single retry cannot reduce the sample. `tol_used` is reported so the client knows
the answer came from a widened window.

### Q4 — distribution histogram
**Fixed bin *width*, not fixed bin count.** Two weight classes must overlay on one
x-axis; a fixed count gives each group different bar boundaries. Cost: the bar count
varies by group, so the frontend's axis has to be data-driven.

**Edges floored to a multiple of the width** (`floor(min/w)*w`), so every group's bars
land on the same values regardless of where its minimum happens to fall.

**`bin_count = floor((max − first_edge)/w) + 1`, never `ceil`.**
Framed as a question about one lifter: *which bin does the strongest lifter fall into?*
That index, plus one because bins count from zero. `ceil` answers "how many whole widths
fit" and silently drops the top lifter when `max` lands exactly on an edge. The `q4.sh`
case at width 2.5 exists because `(582.5 − 70)/2.5` is exactly 205.0 — the one input
where the two formulas disagree.

**Counts are differences of consecutive `count_below` offsets.**
`bin_count + 1` binary searches, not two per bin, because adjacent bins share an edge.
Consequence worth more than the speed: `sum(counts) == n` holds *by construction*, so
the sum test checks the **edges**, not the arithmetic — it fails precisely on the one
bug this design admits.

**σ marks carry `in_range` rather than being clamped.** `mean − 2σ` can fall below the
group minimum or go negative. Report the true value and flag it; let the client decide
how to draw it. Clamping would silently alter a number. Computed in the adapter, not the
domain: the values derive from two fields already in the response and `in_range` exists
only so a chart knows whether to draw the mark, which makes it presentation.

**`bin_width` is unbounded client work**, so it's capped at 500 bins and fails loud.

**`histogram` is a new function, not an extra parameter on `distribution`.**
Adding a parameter would have broken `main.cpp`'s existing caller, which is exactly what
the `nearest` signature change cost earlier.

### Q5 — nearest lifters
**Deduped server-side.** The label says "nearest lifters", and before the fix a
five-row window returned three people (two of them twice, from different meets). The
client can't dedupe: it has no way to know how far outward to walk to refill the list.

**Three-phase outward walk, not a fixed window.** You cannot know in advance how many
rows must be consumed to find k *distinct* lifters, so a slice can't work. Phase 1 walks
down for `k/2`, phase 2 up for the rest, phase 3 tops up from whichever side still has
rows — both halves of phase 3 are required, because either end can run out.

**One `seen` set shared across all three phases.** The same lifter can own rows on both
sides of the query value (a 495 below, a 505 above) and must be counted once.

**Deduping on the name index is exact here, not approximate.** OpenPowerlifting already
disambiguates same-named lifters in the name string itself (`Jennifer Thompson #1`), so
the dictionary index *is* a lifter identity in this dataset. Commented, because the next
reader will assume it's a hack. This is also what retired the planned name-variant audit
before Q7 needed it.

**`neighbours.size() < k` is a legitimate result** in a class with fewer than k distinct
lifters, so group size (`n`) is reported separately from list size.

### Q6 — class sweep
**No domain function; the handler loops.** Nine calls to two existing public index
methods isn't domain knowledge worth a third result struct.

**All nine rows returned, including `n == 0`.**

**`has_percentile` is false when `n == 0`** even if a value was sent — `0.0` would read
as "bottom of the group".

### Q7 — class change
**A class change is a chronologically ADJACENT pair of results differing by
`class_delta`.** First-vs-last would conflate one cut with a decade of drift; all-pairs
would count the same lifter combinatorially.

**Every qualifying transition is an observation**, so `transitions` was appended to the
response alongside `lifters` — a lifter with three moves contributes 3 and 1
respectively, and reporting only one of those numbers would misstate the sample size.

**18-month maximum gap between the two meets.** Two meets six years apart measure six
years of training, not a class change. Measured in **months**, not days: the threshold is
a judgement call, so month granularity is adequate and avoids date arithmetic entirely.

**Total only, no `lift` parameter.** "Did moving up a class make you stronger" is a
question about the total.

**`static_cast<int>` before subtracting classes.** `uint8_t − uint8_t` promotes to `int`
anyway, but written explicitly because this is the arithmetic where `class_delta = −1`
would be the bug.

**Unlike Q10 there is no symmetry property.** `+1` and `−1` select different populations
doing different things — bulking up versus cutting down — so reversing the sign does not
negate the result and there is nothing to assert about it.

### Q8 — third attempts
**`mean_jump` over *all* third attempts, not only successful ones, with `success_rate`
reported alongside.** The all-attempts number answers the behaviour question ("how much
do lifters add"), which is what the screen asks. Successful-only answers a capability
question and biases upward by dropping the big failed jumps. Reporting the rate beside
the mean turns the selection effect into a second finding instead of hiding it.

**`jump = fabs(a3) − fabs(a2)`.** A failed attempt is stored negative, but the weight was
still attempted.

**Deliberately *not* gated on `place_code == Placed`.** `scan_pop` is gated that way and
copying it here would wreck the query: a bomb-out doesn't place, and bomb-outs are
exactly the lifters with failed third attempts. The success rate would be computed over
a population pre-selected for success. The most important line in the function is an
absence. *(Contrast Q11, where the opposite call was correct — see there.)*

**Bins by direct index, not by sorting.** Unlike Q4, this array isn't already sorted and
nothing else needs the order, so O(n) beats O(n log n).

**Default jump bin width 2.5 kg, not 10.** Jumps are 2.5–10 kg.

**`LIFT_KIND_TOTAL` rejected.** A total has no attempts, and `find_index` would hand back
the total array — plausible-looking nonsense rather than an error.

**The `v2 == 0 || v3 == 0` skip is defensive, not load-bearing.** The engine's summed `n`
matched awk's exactly, which proves zeros don't occur in those columns; had they, the
engine's count would have come out lower.

### Q10 — equipment swap
**A lifter is represented by their BEST result in each equipment category.** The screen
asks "what would gear add at my best", not "what is my average". Mean would measure
career progress as much as equipment.

**No chronological constraint — any pair counts.** This is a capability comparison, so a
lifter who alternates raw and single-ply is a valid observation.

**Both results must be in the SAME weight class**, which the request fixes. Otherwise the
delta mixes the equipment effect with 15 kg of bulking and neither is recoverable.

**Grouping by lifter is a sort-by-name then walk-the-runs**, not an
`unordered_map<name, vector>`: one sort instead of ~10⁵ small allocations. The run-walk
advances `i = j`, not `++i` — `++i` would re-process each lifter once per row they own,
weighting the mean by how often people compete. Q7 reuses the same primitive with
weight class as the bucket instead of equipment.

**`have_from`/`have_to` flags rather than 0-initialised bests.** Totals are positive so
0-init would happen to work, but then "no result" and "a result of 0" are the same state.

**Only lifters present in both categories contribute**, so `lifters` is the sample size,
and the two `GroupSummary` fields show which populations it was drawn from — the client
can see what was compared rather than taking the delta on trust.

**Reversing `from` and `to` must give the same lifter count and exactly negated deltas.**
That's a property of the algorithm rather than of the data, so it's the strongest test in
`q10.sh` and it survives a dataset refresh.

### Q11 — class trend
**Mean and sd can stream; p50/p90 cannot.** Values are bucketed per year, then each
year's vector sorted separately — which is why this is two phases and not one loop. A
`std::map` keeps the years ordered for free; only the per-year vectors need sorting.

**Years clamped to the data at both ends, interior gaps kept as `n == 0` rows.** A year
with no meets should be a visible break in the line, not a segment drawn across it — but
a request for 1960–2026 shouldn't return thirty empty rows before the data starts.

**Gated on `place_code == Placed` to MATCH THE INDEX.** Without it the summed `n` came to
66,421 against the index's 65,964 — 457 non-placing results — and the trend's 2019 mean
would have disagreed with the distribution's mean *on the same screen*, with nothing
visible to the user to explain it. This is the opposite call from Q8, and the difference
is the question each asks: Q8 asks about attempts, where a bomb-out is the signal; Q11
asks about class performance, where it's noise, and Q11 has a sibling on screen that
already excludes them.

**Small-n years reported, not suppressed.** p90 of four lifters is noise, but `n` is in
the row so the client can grey it out. Dropping the row server-side would silently alter
the trend's shape. Where the line should *start* being drawn is a frontend decision — the
server shouldn't decide what's statistically interesting.

**Year from `date / 10000`**, with `date == 0` as the missing sentinel.

### Q12 — cut
`Expression` / `SortKey` and the generic query layer are cut. Largest remaining item,
and nothing in the eight screens needs it. It's engine flexibility, not product value.

---

## 6. What the data turned out to be

**"Total" is not one quantity across events.** For a bench-only event, `TotalKg` *is* the
bench. So a Q2 query conditioned on bench and measuring total in event `B` correctly
returns 100% (2662/2662) — the two columns are the same number. Any cross-event
comparison of "total" is comparing different things.

**A result is not a lifter.** Rows are meet results; one lifter has many. Every query
that counts or lists people has to dedupe, and every query that counts *performances*
must not.

**Name strings are lifter identities in this dataset**, because the `#1`/`#2` suffixes are
already in the name.

**Attrition ordering: total 3,721,912 > bench 3,479,598 > deadlift 2,943,477 > squat
2,682,341.** More meets record a bench than a squat, so squat-based groups are the
thinnest and the first to show small-sample behaviour.

**563 of 1,134 groups are non-empty.** Half the addressable combinations never occur —
which is why "no data" is a normal screen state and not an error path.

**457 results in one group placed nowhere.** Disqualifications, no-shows and guest
lifters record a total without placing. The index excludes them; any new scan has to
decide deliberately whether it does too.

**1,269,900 rows carry both squat attempts 2 and 3**, which is what made Q8 viable.

**2020 meet volume drops to ~37% of 2019 (COVID), and 2026 is partial** because the
dataset ends in September. Both were useful signals that year bucketing was correct — a
final year that looked full would have meant the date parse was wrong.

---

## 7. Testing and verification

**Assert the derivation, not the constant, where one exists.**
`percentile == 100*below/n` keeps working when the data changes and catches a
disagreement between two fields; a pinned `99.7665` only proves nothing moved.

**Anchor on externally-verified numbers.** `n = 65,964` came from awk; `61,895` came from
the engine. Only the first is a test — the second is a transcript of the thing under
test. Where a gate can't be reproduced in awk (the class index is derived at load and
isn't in the CSV), **sum across all classes** and anchor that: one external number
validating nine calls, and it also proves the gate partitions rather than dropping or
double-counting rows.

**Prefer a property of the algorithm over a property of the data.** Q10's symmetry test —
swapping `from` and `to` negates the deltas and preserves the count — holds whatever the
dataset says, so it never needs updating and it catches an inverted bucket flag, a
double-counting run-walk and a best-from/best-to mix-up at once.

**Emptiness guards beside every collection predicate.** `[] | unique | length == 0` and
`[] == ([] | sort)` are both true, so "5 distinct lifters" and "ascending" passed against
an empty array. A predicate over a collection is usually vacuously true when the
collection is empty.

**A test's *subject* must actually be capable of failing.** The original `n == 0` case
used Mx, and Mx rows carry `kNoIpfClass` by construction — so the assertion would have
passed for any Mx query at all. Green, and measuring nothing.

**Run a second instance through the same invariants.** `q8.sh` checks bench as well as
squat, because `attempt_columns` is a switch returning six column references and a
copy-paste there gives squat's numbers under bench's name. Only a second case exposes it.

**Abort on a wrong group rather than reporting twenty confusing failures**, and print the
discriminating field in the abort. `weightClass: "69"` turned "n is wrong" into a
one-line diagnosis. A diagnostic that can come out empty isn't a diagnostic — the first
version of `q4.sh`'s abort used `jq ... || cat`, and `jq` exiting 0 on empty input meant
it printed nothing at all.

**Compare counts, not values, for cross-check tripwires.** The per-lift check compares
`n` for total (65,964) against squat (65,949): the differing counts catch a wrong-array
read without anyone having to know what the right percentile is.

**One shared harness, `tests/lib.sh`.** Four copies of `call`/`check`/`reject` is four
chances for a half-updated copy — the failure mode that produced seven bugs in two days.
`check` grades whatever the most recent `call` wrote, so every `check` must sit between
its own `call` and the next one; it looks like a pure function of its arguments and
isn't.

**`fill_stats` for `GroupSummary`.** Four hand-written copies of the same four setters is
where a `set_mean(d.sd)` typo hides forever, because the number still looks like a number.

**`scripts/run.sh` with `set -e`.** Six stale-binary incidents in one day, the worst of
them twenty minutes spent debugging a correct function while the build was silently
failing. The script makes "build failed, therefore don't start" structural instead of
something to get right in shell operator precedence each time —
`cmake --build … && pkill … ; ./server` parses as *(build && pkill)* ; *(start)*, and
starts the old binary after a failed build.

**Anchored patterns in bulk edits.** `sed 's/9999/1500/g'` would also have rewritten
`99999` to `15009` — still over the cap, so the test would keep passing while no longer
testing what its name said.

---

## 8. Measured facts

| | |
| --- | --- |
| Query, row-major → columnar | 104.9 ms → 5.2 ms (19.6×) |
| Resident memory | 3.07 GB → 1.49 GB (2.1×) |
| Load time | 1.5× slower (accepted) |
| Index | 563 groups, 12,827,328 entries, 98.0 MiB, ~850 ms build, 1.5 µs lookup |
| Server | ~1,000 req/s, p99 ~135 ms, 0 errors in 30,000 requests |
| Per-request stderr logging | −14% throughput, +45% p99 (min-off 1004 > max-on 903) |
| Cold start | first 5,000 requests at 43% of steady state |

**Predictions that were wrong, and why they're recorded here.**
"Partitioning is required" — measurement said otherwise. "24% noise floor" — it was a
systematic cold-start effect, not noise. "Removing logging gives >5×" — actual 1.16×.
"Q11's sum will come out lower than the index's" — it came out 457 *higher*. The
mechanisms were right in all four cases and the magnitudes and signs were not. A
mechanism-based prediction is good for choosing *what to measure*, not for skipping the
measurement.

---

## 9. The Go gateway

**A thin HTTP/JSON gateway with no state of its own.** The C++ server holds the data and
does every computation; Go speaks HTTP/JSON to the browser, handles CORS, and maps
errors. One source of truth for every number — which is also what makes a parity test
meaningful, since there's only one implementation to be right.
Deferred, not rejected: a response cache. The data is immutable between loads.

**4xx messages pass through verbatim; 5xx are logged and replaced with something
generic.** The C++ errors are deliberately informative ("bin_width 0.001 would produce
512500 bins, maximum 500") and that's the fail-loud principle — if the gateway replaces
it with "Bad Request" the principle dies at the boundary. An internal error, by contrast,
can leak implementation detail and the caller can't act on it anyway.

**`protojson`, never `encoding/json`, on a protobuf message**, with
`EmitUnpopulated: true` as the equivalent of grpcurl's `-emit-defaults`. `encoding/json`
produces something that looks like JSON but isn't proto3 JSON — enums as integers,
Go struct field names, broken `oneof`s. Without `EmitUnpopulated`, `n: 0` and `count: 0`
vanish and the frontend sees `undefined` where it expects a number: the same bug as
omitting `-emit-defaults`, arriving from a different direction.

---

## 10. Open items

- `Dictionary::find()` returns 0 after `done_loading()`.
- `// tie: alphabetical` is wrong — the sort is byte order.
- `top_lifters_columnar`'s filter is missing an `!is_missing(total)` guard.
- Dead commented block, `query.cpp` lines 69–99.
- `q5.sh` not yet migrated onto `tests/lib.sh`.
- `fill_stats` not yet applied in `Distribution` and `ClassSweep`.
- `TopLifters` uses the `(ptr, len)` protobuf setter with a comment explaining why;
  `Percentile` passes a `string_view` directly. One of them contradicts the comment.
- `kMaxLimit` vs the 4 MB receive limit: real boundary untested.
- `-Wconversion`, `-Wshadow`, `-Wsign-conversion`, `[[nodiscard]]`, `.clang-format`.
- Four Google Benchmarks; the filter-inline-vs-gather one settles §1.3 of the build spec.
- README with the benchmark table, including the DuckDB and Polars comparisons.
- Frontend: where a trend line should start being drawn (first year with n ≥ some
  threshold) is an open product question.