# Benchmarks

Machine: MacBook Pro (Apple Silicon), macOS 26.6.2
Dataset: `openpowerlifting-2026-09-12-64bfe49f.csv` (786 MB, 4,032,180 rows)
Builds: Release = `-O3`; Debug = `-O0` + ASan + UBSan.
Method: Release only for timing; several runs; report the best; note outliers
with their cause rather than averaging them in.

---

## Ch 12: read file + count rows (no parsing)

Full file, Release, `time`:

| Run | user | sys | cpu | total |
|---|---|---|---|---|
| cold | 0.14 s | 0.38 s | 49% | **1.052 s** |
| warm | 0.14 s | 0.31 s | 76% | **0.588 s** |

- User time is the counting loop: 786 MB in 0.14 s ≈ 5.6 GB/s.
- Cold vs warm is the OS file cache; warm ≈ 1.3 GB/s end to end.
- The bottleneck is I/O, not the loop. This is the floor any loader must pay.

## Ch 14–15: RAII leak check

`leaks --atExit` on `dev.csv`, Release, "nodes malloced" at exit:

| Destructor | Blocks | Memory still allocated |
|---|---|---|
| empty | 189 | **42,847 KB** |
| `delete[] data_;` | 188 | **31 KB** |

Exactly one block fewer: the file buffer, freed by the destructor with no
`delete[]` anywhere in `main`.
Note: `leaks` reported **0 leaks in both cases**. Its scan is conservative
and can miss a real leak, so "memory still allocated at exit" is the better
evidence.

## Debug vs Release (same work, `dev.csv`, no reserve)

| Build | Load |
|---|---|
| Debug (`-O0` + sanitizers) | 3276.4 ms |
| Release (`-O3`) | 210.3 ms |

**~15x**. This is why timing is only ever done in Release.

---

## M1 baseline: array of structs, `std::vector<Lift>`

Query: top 10 women, Raw, full power (SBD), by TotalKg, one entry per lifter
(their best total), only rows where Place is a number.

`sizeof(Lift)` = **528 bytes** → the struct array alone is **2.13 GB**.

### Without `reserve()`

| Measurement | Value |
|---|---|
| Load (read + parse + build) | 5026 / 5461 ms |
| Query | 757.5 / 109.0 / 105.9 / **104.9** / 106.5 ms |
| Peak resident memory | 2.95 GB |
| Peak memory footprint | 4.30 GB |
| sys time | 1.67 s |
| Page reclaims | 593,668 |
| Instructions retired | 49.8 B (~12,300 per row) |

Peak footprint is explained by vector doubling: new block 2.21 GB + old block
1.11 GB (still being moved from) + file buffer 0.82 GB ≈ 4.14 GB, plus heap
strings. Growth also left ~86 MB of unused capacity (4,194,304 slots
allocated, 4,032,180 used).

### With `reserve(rows - 1)`

| Measurement | Value | vs. no reserve |
|---|---|---|
| Load | 3424 / **3069** / 3314 ms | **-39%** |
| Query | run 1 ~720–811 ms, then 103.4–110.7 ms (best **103.4**) | unchanged |
| Peak resident memory | 2.36–2.95 GB | |
| Peak memory footprint | **3.07 GB** | **-1.23 GB** |
| sys time | 0.77–0.96 s | about -50% |
| Page reclaims | 310k–338k | about -45% |
| Instructions retired | 47.3–47.8 B | only **-4%** |

Outlier, excluded: load 3909 ms, query run 1 = 1112 ms, sys 1.42 s, with
18,959 involuntary context switches (vs 2.4k–6k) — other load on the machine.

### What the numbers mean

- The **-1.23 GB** matches the prediction exactly: old block during the final
  doubling (1.11 GB) + unused capacity (0.09 GB). The new 3.07 GB peak is just
  struct array (2.13 GB) + file buffer (0.82 GB) + heap strings.
- **Time fell 39% while instructions fell only 4%.** The CPU did nearly the
  same computing; what disappeared was memory work — page allocation, the OS
  zeroing pages, and moving 2+ GB of structs during reallocation.
  **Allocation and memory traffic dominate, not computation.**
- **`reserve` did not change the query**, which is correct: it changes how the
  vector is built, not the finished layout the query scans.
- **Why the query costs ~105 ms:** it needs ~6 fields (~20 bytes) per row, but
  they sit inside 528-byte structs, so it sweeps 2.13 GB to use ~80 MB. Most
  of every 64-byte cache line is names and meet towns it never reads.


### Correctness

- Top 10 reproduced exactly by an independent awk pipeline (same names, same
  totals). Only the 692.5 tie ordered differently, because `sort` has no
  tie-break; the C++ query breaks ties by name, then date, so its output is
  deterministic.
- #1 (Tamara Walcott, 759.0) checked row by row in the raw CSV: it is her
  highest total with a numeric place.
- Debug build (ASan + UBSan) on `dev.csv`: clean, no reports.

---

## Targets for M2 (columnar)

| Metric | M1 baseline |
|---|---|
| Load | 3069 ms |
| Query | 103.4 ms |
| Peak memory footprint | 3.07 GB |
| Instructions | 47.3 B |

Same data, same query, same machine, same field types — only the memory
layout changes.


Prediction: struct building > conversion.
Reasoning: 13 std::strings per row, some longer than 22 chars (meet names,
lifter names) so they allocate; plus moving a 528-byte Lift into the vector.
Most numeric fields are empty, so parse_optional_float returns immediately.



## M2: parser optimisation

Load phase breakdown (Release, warm, full file):
before: io 105 / split 589 / numbers+enums 1628 / strings 304 / store 195 = 2821 ms
after:  io 103 / split 604 / numbers+enums 1042 / strings 295 / store 175 = 2219 ms

Change: to_float/to_int rewritten with std::from_chars instead of
constructing a std::string and calling std::stof.
conversion phase: 1628 -> 1042 ms (-35%)
full load:        2821 -> 2219 ms (-21%)
instructions:     134.3 B -> 108.4 B (-19%)
Same 4,032,180 rows parsed, same top 10.

Prediction vs reality: predicted strings would dominate the ~2.4 s of
"conversion + struct building". Wrong. Strings were only ~304 ms (11%);
number conversion was ~1628 ms (58%). Reason: std::string stores <= 22
chars inline, so most text fields never allocate, while ~30 stof calls
per row are locale-aware and expensive.

mmap vs read-into-buffer: keeping read. I/O is only ~5% of load time, so
mmap optimises the phase that isn't the bottleneck. The file (786 MB) fits
comfortably in RAM, which is mmap's main advantage.


## M2 final (clean build, no phase instrumentation)
Load: 2388 / 2216 / 2234 ms (best 2216; M1 was 3069, -28%)
Instructions: 38.6 B (M1: 47.3 B, -18%)
Query: 102.2 ms best (unchanged, as expected)
Peak footprint: 3.07 GB (unchanged: same Lift struct)


Percentile index: 52 ms build, 563 groups, 3,721,912 values, 14.2 MB
Query: 0.2 us (binary search, ~16 comparisons over 65,964 values)
reserve: memory 20.6 -> 14.2 MB, build time 46.6 -> 51.8 ms
(opposite sign to M1: here the counting pass costs more than the
~14 MB of copying it avoids)


gRPC server, 50 concurrent clients, ghz -c 50 -n 5000,
F/Raw/SBD limit=50, full dataset (4,032,180 rows),
Release build, warm-up run discarded, 4 runs each, same session:

per-query stderr trace OFF:  1016 req/s   p99 ~160 ms
per-query stderr trace ON:    875 req/s   p99 ~230 ms

Logging in the request path costs ~14% throughput and ~45% p99.
Sets do not overlap (min off = 1004 > max on = 903).

Not measurable: matches.reserve() showed no effect above
run-to-run variation; kept on principle.
Cold start: first 5,000 requests after startup run at ~43% of
steady-state throughput.

---

## Google Benchmark suite (`bench/bench_main.cpp`)

Release `-O3`, Apple M1 Pro, full dataset, single thread. 5 repetitions;
**best** reported, medians within 1–2% unless noted. Re-run three times across
the session with the same results to within ~2%.

```bash
cmake --build build-release --target engine_bench
./build-release/bench/engine_bench --benchmark_repetitions=5
```

Groups, by selectivity (Placed, total present):

| Group | Matches | Share of rows |
|---|---:|---:|
| M / Raw / SBD | 750,556 | 18.6% |
| F / Raw / SBD | 375,568 | 9.3% |
| F / Multi-ply / SBD | 7,476 | 0.19% |

### 1. Filter: inline vs gather — settles build spec §1.3

Filter stage alone, all three producing the same `vector<Ranked>`:

| ms | M/Raw/SBD | F/Raw/SBD | F/Multi-ply/SBD |
|---|---:|---:|---:|
| Inline, branchy (shipped) | 6.95 | 5.56 | 4.45 |
| Inline, branch-free write | 5.63 | 4.20 | 3.51 |
| Gather (branch-free selection vector, then gather) | 5.49 | 4.04 | 3.18 |

The isolated loops overstate it — the shipped *function*, sort included, runs
faster (5.19 ms for F) than the isolated inline filter loop (5.56 ms). So the
deciding measurement is end to end: `top_lifters_columnar` with only its
filter swapped.

| ms, end to end | M/Raw/SBD | F/Raw/SBD | F/Multi-ply/SBD |
|---|---:|---:|---:|
| Inline (shipped) | 7.61 | 5.19 | 3.67 |
| Gather, one selection vector over the table | **6.44** (−15%) | **4.57** (−12%) | **3.34** (−9%) |
| Gather, chunked, 1024-row stack buffer | 6.96 (−9%) | 5.49 (+6%) | 4.29 (+17%) |
| Gather, chunked, 2048 | 7.07 (−7%) | 5.54 (+7%) | 4.28 (+17%) |
| Gather, chunked, 8192 | 6.99 (−8%) | 5.49 (+6%) | 4.22 (+15%) |

**Verdict: keep inline.**

- Whole-table gather is 9–15% faster, but its selection vector is
  `4 B × 4,032,180 = 16 MB` per request. The shipped code's `reserve(n_rows/10)`
  was sized precisely to keep per-request transient memory near 3 MB under 50
  concurrent clients; 16 MB × 50 is 800 MB. The win doesn't pay for that.
- Chunked gather — the allocation-free form, and the shape vectorised engines
  use — keeps the win only on the least selective group and is 6–17% *slower*
  on the other two. Why chunking costs this much is **not investigated**
  (candidates: the inner loop's trip count no longer being the table size, so
  less unrolling; the push_back capacity check returning per chunk).
- Most of whole-table gather's advantage is the **branch-free write**, not the
  two-pass structure: InlineBranchless gets within 2–10% of Gather in the
  isolated loops. If the filter is ever revisited, that is the change to try
  first — single pass, no extra memory.

### 2. Top lifters: row-oriented vs columnar

| ms | M/Raw/SBD | F/Raw/SBD | F/Multi-ply/SBD |
|---|---:|---:|---:|
| AoS `vector<Lift>`, full sort (M1 baseline) | 203.0 | 107.6 | 22.5 |
| SoA filter + full `std::sort` | 162.9 | 78.6 | 4.01 |
| SoA filter + `partial_sort` + retry (shipped) | **7.61** | **5.19** | **3.67** |

F/Raw/SBD: 107.6 → 5.19 ms, **20.7×** (the M2 Timer measurement was 19.6×).
Attribution: layout 107.6 → 78.6 (1.4×), algorithm 78.6 → 5.19 (15×). The
algorithm matters more the more rows match; at 0.19% selectivity there is
almost nothing to sort and the two SoA rows nearly meet.

### 3. Percentile: index vs scan

F / Raw / SBD / 63 kg, total 500, n = 65,964.

| | Time |
|---|---:|
| Scan the columns (filter group, count below) | 4.63 ms |
| `PercentileIndex::percentile_of` (binary search) | **63.3 ns** |

~73,000×. (§8 of decisons.md records 1.5 µs from an earlier one-shot Timer
measurement; this harness repeats the call ~10M times. Not reconciled.)

### 4. Conditional percentile (hero query)

| | n | Time |
|---|---:|---:|
| M / Raw / SBD, squat 210 ± 2.5 → bench 140 | 38,298 | **8.78 ms** |
| F / Raw / SBD, squat 300 → bench 150 (widens to ± 5: two scans) | 5 | 15.4 ms |

The widening case costs 1.75× the normal one, for two full scans. Cause of
the gap below 2× not investigated.

---

## DuckDB and Polars (`bench/compare.py`)

DuckDB 2.0.0, Polars 2.0.0, Python 3.14, same machine, same CSV. Hot (data in
memory), best of 20 after one discarded warm-up. The script exits if any
answer differs from the engine's reconciled numbers (top 10 head and tail,
`below=21079 n=38298`, `n=65964`), so every time below is for a correct answer.

```bash
python3 -m venv .venv && .venv/bin/pip install duckdb polars
.venv/bin/python -I bench/compare.py --threads 1
.venv/bin/python -I bench/compare.py
```

| ms | engine | DuckDB 1T | Polars 1T | DuckDB 8T | Polars 8T |
|---|---:|---:|---:|---:|---:|
| Top 10, one per lifter | **5.19** | 30.6 | 58.9 | 9.52 | 22.0 |
| Conditional percentile | 8.78 | 13.7 | 8.93 | 4.97 | **2.42** |
| Percentile (count in group) | **0.00006** / 4.63 scan | 12.2 | 9.45 | 4.40 | 2.47 |

Fairness, both directions:

- Filter columns are ENUM-encoded at load in both libraries, and `Place` is
  reduced to a boolean at load, as the engine's parser does. **The first run
  compared strings and made the engine look 2–7× better than it is** (e.g.
  Polars 1T conditional 18.2 ms with strings, 8.93 ms with enums). That run is
  not reported in the table.
- The libraries' percentile query filters bodyweight `(57, 63]`; the engine
  reads a precomputed `ipf_class`. Same rows, same n, slightly different work.
- The libraries load only the 10 columns the queries touch; the engine loads
  all 42. Load times (DuckDB ~0.75 s / Polars ~1.3 s at 8 threads) are **not
  comparable** to the engine's 3.6 s and are not in the table.

Reading:

- Top 10 is the engine's everywhere: the libraries answer it with a full
  group-by over ~1M names; the engine sorts 200 rows.
- Single-threaded on a plain scan, the engine and Polars are level. The layout
  advantage is shared — they're columnar too.
- Multi-threaded, both libraries win scans: Polars 3.6× on the hero query.
  The engine is one core per query; parallelising the scan is the next lever.

### Prediction vs reality

No magnitude was predicted in writing before these runs, so none is scored.
