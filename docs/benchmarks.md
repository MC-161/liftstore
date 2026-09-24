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