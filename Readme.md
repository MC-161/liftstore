# liftstore

A columnar query engine over the OpenPowerlifting dataset: 4,032,180 rows,
42 columns, 786 MB of CSV. Written in C++20 to measure what memory layout is
actually worth on an analytical workload, against an honest row-oriented
baseline rather than a strawman.

## Results

Query: *top 10 women, raw, full power (SBD), by total, one entry per lifter.*
Release build (`-O3`), warm page cache, best of 5 runs, MacBook Pro (Apple
Silicon), macOS 26.6.2.

| | Row-oriented (AoS) | Columnar (SoA) | |
|---|---|---|---|
| **Query** | 101.7 ms | **5.2 ms** | **19.6× faster** |
| **Peak memory** | 3.07 GB | **1.49 GB** | **2.1× smaller** |
| Load | 2,500 ms | 3,641 ms | 1.5× slower |
| System time | 0.71 s | 0.17 s | 4.2× less |
| Page reclaims | 287,619 | 91,728 | 3.1× fewer |
| Instructions retired | 38.6 B | 41.3 B | +7% |

Both paths produce byte-identical results on every run.

Columnar query breakdown:

| Phase | Time | Work |
|---|---|---|
| Filter | 5.0 ms | 4,032,180 rows across 4 columns (~24 MB) |
| Sort | 0.3 ms | `partial_sort` over 375,568 matches |
| Dedupe | 0.0 ms | hash set of `uint32` name indexes |

The filter reads ~24 MB of packed columns instead of walking 2.13 GB of
528-byte structs. Adding the other 35 columns after the query columns were
working changed query time by 0.2 ms, which is the columnar property in a
single measurement: a column no query reads costs nothing at query time.

### Progression

| Stage | Load | Query | Change |
|---|---|---|---|
| Baseline: `std::vector<Lift>` | 5,026 ms | 104.9 ms | — |
| `reserve()` with known row count | 3,069 ms | 103.4 ms | load −39% |
| `std::from_chars` parsing | 2,216 ms | 102.2 ms | load −28% |
| Columnar store + `partial_sort` | 3,641 ms | **5.2 ms** | query −95% |

`reserve()` cut load time 39% while cutting instructions only 4%: the saving
was allocation and memory traffic, not computation. `from_chars` cut
instructions 18%: that saving was computation.

## Design decisions

**Table representation — struct of named vectors.** The schema is fixed and
known at compile time, so direct typed access beats type-erased columns
(`unique_ptr<Column>`) or `std::variant`, both of which charge indirection on
every access for runtime flexibility this workload does not need.

**Missing values — NaN sentinel in packed float arrays.** `optional<float>`
is 8 bytes, halving cache-line density on the scan path that the rebuild
exists to optimise. NaN keeps columns at 4 bytes per row, and because every
comparison against NaN is false, scans skip missing rows with no extra
branch. Limitation: floats only. Not a constraint here — categories and
`Place` are never empty, and dictionary indexes reserve 0 for empty. A
validity bitmap (the Arrow/Parquet approach, 1 bit per row) is the documented
upgrade path if generic per-column validity is ever needed.
Consequence: this project must not be built with `-ffast-math`.

**Categoricals — dictionary encoding.** Twelve text columns hold between 8
and 34,791 distinct values across 4 million rows. Each stores its distinct
values once and one integer index per row: 24 bytes per row becomes 2 (or 4
for `Name`, at 1,013,154 distinct values, and `MeetName`, for growth
headroom). Filters and dedupe become integer comparisons. `TotalKg` is
deliberately *not* dictionary-encoded despite having only 8,751 distinct
values — it is the hot scan path, where indirection would cost more than the
bytes it saves.

**Dates — `YYYYMMDD` integers, not dictionary indexes.** Preserves ordering,
so range filters are integer comparisons. Trade-off: no date arithmetic
without conversion.

**Row alignment.** Index *i* is the same row in every column; nothing
structurally enforces this. All columns are appended in one place and
`check_invariant()` verifies equal lengths after load.

**Ownership.** `ColumnStore` is non-copyable (`= delete`) so an accidental
multi-gigabyte copy is a compile error, and explicitly movable so the loader
can return it by value. `static_assert`s enforce both properties. Returning
the store triggers no constructor at all under C++17 copy elision.

## Correctness

- The top 10 was reproduced independently by an `awk` pipeline over the raw
  CSV: identical names and totals. The only divergence was ordering within a
  692.5 kg tie, which `sort` leaves unspecified and the engine breaks
  deterministically by name, then date.
- The leading result was verified row by row against the raw file.
- Parsers reject any unrecognised value rather than defaulting, and every one
  of the 4,032,180 rows parses. This caught a value the exploratory shell
  checks had missed (see below).
- The `partial_sort` optimisation uses a doubling-`k` retry, so its result is
  provably identical to a full sort rather than correct only in practice.
  Verified by forcing `k = 5`.
- Debug builds run under AddressSanitizer and UndefinedBehaviorSanitizer with
  no reports, which matters because parsing reads raw buffer bytes through
  `std::string_view` and `std::from_chars`.

### Ranking rule

Only rows whose `Place` is numeric are ranked. This excludes DQ, NS and DD
(246,210 / 22,249 / 1,859 rows) and also guest lifters (13,758 rows), who
have totals but are not officially placed — filtering on "has a total" alone
would silently include them. Empty `TotalKg` and a DQ/NS/DD code were
verified to describe exactly the same 270,318 rows, in both directions.

## Dataset notes

Findings that shaped the schema, from `docs/data-notes.md`:

- No quote characters anywhere in the file and exactly 42 fields on every
  line, so the parser splits on commas with no quote handling.
- Negative attempt values encode failed attempts; the sign carries meaning.
- 371 rows have a bare `+` as their weight class, with no number. Missed by
  the exploratory regex check (`[0-9.]*` matches zero digits) and caught by
  the parser's fail-loudly rule. Interpreted as an open class.
- 158,618 rows carry `#N` suffixes disambiguating shared names, so
  deduplicating by name deduplicates by person.
- A lifter entering multiple divisions at one meet appears once per division,
  so counts and averages must account for repeated performances.

## Build

```bash
cmake -S . -B build-release -DCMAKE_BUILD_TYPE=Release
cmake --build build-release -j
./build-release/apps/engine data/openpowerlifting-*.csv [aos|soa]
```

Debug builds enable AddressSanitizer and UndefinedBehaviorSanitizer:

```bash
cmake -S . -B build-debug -DCMAKE_BUILD_TYPE=Debug
cmake --build build-debug -j
./build-debug/apps/engine data/dev.csv
```

Google Test and Google Benchmark are fetched at configure time and pinned by
tag. The dataset is not committed; download the bulk CSV from
openpowerlifting.org into `data/`.

## Layout

```
include/engine/   public headers
src/              engine_core: parsing, file buffer, column store, queries
apps/             CLI entry point
tests/            GoogleTest
bench/            Google Benchmark
docs/             data notes, benchmark log, decision records
```

## What I got wrong

**Predicted the wrong bottleneck in the parser.** Expected `std::string`
construction to dominate load time; measured, it was 11%, while number
conversion was 58%. Short string optimisation means most text fields never
allocate. Phase decomposition found this; intuition would not have.

**Predicted 40 ms for the columnar query; got 5.2 ms.** Two errors in
opposite directions. The layout win was larger than estimated, and the sort
was treated as an unavoidable floor when it was simply the wrong algorithm:
ordering 375,568 elements to return 10. Replacing `std::sort` with
`std::partial_sort` took the sort from 68.8 ms to 0.3 ms — a bigger win than
the layout change itself, and one that was available in the baseline too.

**A measurement that reported zero.** An early instrumented run showed string
construction costing nothing, which is impossible. Cross-checking against
instruction counts revealed the "strings-off" code path was still assigning
strings. A component measured at zero cost is a broken experiment, not a
finding.

**Strict parsing is not validation.** The field parsers reject anything they
cannot parse, which caught a weight class recorded as a bare `+` (371 rows)
that an exploratory regex had missed. But they accepted `-74` without
complaint and stored a negative weight class, because `-74` is a perfectly
valid number — it is just not a plausible one. 25 rows carried that European
"up to 74 kg" notation. Parse validity and value plausibility are separate
checks, and only the first was being done; range checks now sit alongside the
parsers.

