<img width="1983" height="793" alt="Liftstore_ Columnar Queries in 5 ms" src="https://github.com/user-attachments/assets/c103b942-d8e2-4880-9c82-190723ef6fbd" />

**A columnar query engine in C++20 over 4,032,180 powerlifting competition
results — built to answer one question nobody else answers, in under 9 ms.**

```
Among the 38,298 lifters who squat 210 kg,
your 140 kg bench sits at the 55th percentile.
```

Every ranking site tells you where your bench sits among *all* lifters. This
one tells you where it sits among lifters **who squat what you squat** — the
comparison that finds your weak lift instead of your training age.

It can't be precomputed. The condition is a runtime range over another column,
so it's a full scan of four million rows — and it returns in single-digit
milliseconds.

![row-oriented vs columnar: the same query over 4 million rows, 104.9 ms against 5.2 ms](docs/demo.gif)

---

## The numbers

Same query, same machine, same results — one stores rows, one stores columns.

```
query ── top 10 women, raw, full power, by total, over 4,032,180 rows

  row-oriented  ████████████████████████████████████████  104.9 ms
  columnar      ██                                          5.2 ms

peak resident memory

  row-oriented  ████████████████████████████████████████  3.07 GB
  columnar      ███████████████████                       1.49 GB

throughput ── gRPC service, 50 concurrent clients

  1,016 req/s     p50 61 ms     p99 135 ms     0 errors in 30,000
```

| | row-oriented | columnar | |
|---|---:|---:|---|
| **Query** | 101.7 ms | **5.2 ms** | **19.6× faster** |
| **Peak memory** | 3.07 GB | **1.49 GB** | **2.1× smaller** |
| Load | 2,500 ms | 3,641 ms | 1.5× slower |
| System time | 0.71 s | 0.17 s | 4.2× less |
| Page reclaims | 287,619 | 91,728 | 3.1× fewer |
| **Instructions retired** | 38.6 B | **41.3 B** | **+7%** |

> **The last row is the whole story.** The fast version executes *seven percent
> more instructions* and finishes twenty times sooner. It isn't doing less
> work — it's waiting on memory far less. Measure instruction counts alone and
> you'd conclude the rewrite made things worse.

Both paths return byte-identical results. The row-oriented implementation is
still in the repo and still benchmarked beside the columnar one — it's the
reference, not a strawman.

---

## Benchmarks

Google Benchmark, Release (`-O3`), Apple M1 Pro, full dataset (4,032,180 rows),
single thread, best of 5 repetitions (medians within 1–2%). Source:
[`bench/bench_main.cpp`](bench/bench_main.cpp); full tables and method in
[`docs/benchmarks.md`](docs/benchmarks.md).

| Query | | Time |
|---|---|---:|
| Top 10, F / Raw / SBD | row-oriented (`vector<Lift>`, full sort) | 107.6 ms |
| | columnar, full sort | 78.6 ms |
| | **columnar, `partial_sort` + retry** (shipped) | **5.19 ms** |
| Percentile, F / Raw / SBD / 63 kg | scan the columns | 4.63 ms |
| | **sorted index, binary search** (shipped) | **63 ns** |
| Conditional percentile (the hero query) | squat 210 ± 2.5 → bench 140, n = 38,298 | **8.78 ms** |
| | rare cohort, widens to ± 5 (two scans) | 15.4 ms |

The two changes in the top-10 row are separable: the layout alone is
107.6 → 78.6 ms (1.4×); the sort algorithm is 78.6 → 5.19 ms (15×).

### Against DuckDB and Polars

Same CSV, same machine, same answers — [`bench/compare.py`](bench/compare.py)
exits if any library's result differs from the engine's reconciled numbers.
Hot (data in memory), best of 20. Filter columns are ENUM-encoded at load in
both libraries, as the engine's are.

| ms | engine | DuckDB 1 thread | Polars 1 thread | DuckDB 8 threads | Polars 8 threads |
|---|---:|---:|---:|---:|---:|
| Top 10, one per lifter | **5.19** | 30.6 | 58.9 | 9.52 | 22.0 |
| Conditional percentile | 8.78 | 13.7 | 8.93 | 4.97 | **2.42** |
| Percentile (group count) | **0.00006** (index) · 4.63 (scan) | 12.2 | 9.45 | 4.40 | 2.47 |

DuckDB 2.0.0, Polars 2.0.0, Python 3.14. The engine is single-threaded.

What that table says, without spin:

- **Top 10 is the engine's win everywhere** — 1.8× DuckDB even with DuckDB
  on all eight cores. Both libraries answer it with a full group-by over a
  million names; the engine sorts 200 rows and dedupes.
- **On a plain filtered scan, single-threaded, the engine is level with
  Polars** (8.78 vs 8.93 ms) and 1.6× DuckDB. There is no layout trick left:
  it's the same columnar scan.
- **With eight cores, both libraries beat it** — Polars runs the hero query
  3.6× faster. The engine uses one core per query. That is the next lever,
  and the table puts a number on it.
- **The index is the one thing neither has.** 63 ns against 2.5 ms is what
  precomputing a sorted array per group buys, for the queries where the
  group is known in advance.

---

---

## Why

One `struct Lift` per row is **528 bytes**. A ranking query reads four fields
out of forty-two, but a CPU fetches whole 64-byte cache lines — so most of
every line fetched was thrown away.

```
row-oriented — one 528-byte struct per lifter
┌───────────────────────────────────────────────┐
│ name │ sex │ event │ … 36 more … │ total │ …   │  ← a 64-byte cache line
└───────────────────────────────────────────────┘     holds ~1/8 of ONE row
   ▲                                   ▲
   └──── wanted ────────────────────── ┘    everything between: wasted bandwidth

columnar — one contiguous array per field
  sex     [M][F][M][M][F][M][M][F] …     1 byte each  → 64 per cache line
  total [759.0][756.5][751.0][743.0]…    4 bytes each → 16 per cache line
                                         ▲ every byte fetched is a byte used
```

Filtering touches four small arrays instead of striding through 2.13 GB of
mostly-irrelevant struct. Text columns are dictionary-encoded (24 bytes per row
→ 2), missing numbers use a NaN sentinel rather than `optional<float>` (4 bytes
not 8, and NaN compares false so scans skip them branch-free), and dates are
`YYYYMMDD` integers so range filters stay integer comparisons.

Adding the other 35 columns *after* the query columns were working moved query
time by **0.2 ms**. That's the columnar property in one measurement: a column
no query reads costs nothing at query time.

---

## Try it

```bash
git clone https://github.com/MC-161/liftstore && cd liftstore
cmake -S . -B build-release -DCMAKE_BUILD_TYPE=Release
cmake --build build-release -j

# a 200,000-row sample is committed — no 786 MB download needed
./build-release/apps/engine data/dev.csv soa
```

Serve it:

![loading four million rows once at startup, then answering queries in milliseconds](docs/serve.gif)

```bash
./build-release/apps/engine_server data/openpowerlifting-*.csv
```
```
store ready: 4032180 rows in 3618.2 ms
percentile index ready: 563 groups in 796.0 ms
listening on 0.0.0.0:50051
```
```bash
grpcurl -plaintext -import-path proto -proto engine.proto -d @ \
  localhost:50051 engine.v1.Engine/ConditionalPercentile < docs/query.json
```
```json
{ "percentile": 55.04, "below": 21079, "n": 38298, "tolUsed": 2.5 }
```

> `n` comes back with every percentile. A percentile over five people isn't
> wrong, it's *meaningless*, and only `n` tells you which one you're looking at.

The frontend (Vite + React + TypeScript, in `web/`) talks to the Go gateway,
which talks to the engine:

```bash
cd go && go run ./cmd/api            # HTTP/JSON gateway on :8080
cd web && npm install && npm run dev # http://localhost:5173, /api proxied to :8080
```

Seven screens: Entry, Verdict, Weight Class, Attempts, Head to Head, Leaderboards and a share card. Set
`VITE_PUBLIC_URL` in `web/.env` (see `web/.env.example`) to the deployed address: the
share card's link and QR code point there. Unset, in development the QR code points at this
machine's LAN address (the dev server listens on the network), so a phone on the same Wi-Fi
can scan it. Types
are generated from `proto/engine.proto` (`npm run gen`), and every slider is
local: the distribution's bins are the CDF, so dragging makes no requests.

Full dataset: the bulk CSV from
[openpowerlifting.org/data](https://openpowerlifting.org/data), into `data/`.
Debug builds run under AddressSanitizer and UndefinedBehaviorSanitizer.

---

## How it's verified

Every number this engine produces was reconciled **exactly** — identical
integers, not "looks about right" — against an independent `awk` pass over the
same CSV.

```bash
awk -F, 'NR>1 && $2=="M" && $4=="Raw" && $3=="SBD" && $27~/^[0-9]+$/ \
  && $15!="" && $15>=207.5 && $15<=212.5 && $20!="" \
  { n++; if ($20 < 140) b++ } END { print "below="b"  n="n }'
# below=21079  n=38298       ← the engine returns the same two integers
```

Because of the **failure mode**: an off-by-one in an enum mapping doesn't
crash, it returns ten real lifters with real totals in descending order, and
they're the wrong ten. Only comparison against an independently derived answer
catches that.

Those reconciliations are pinned as tests, each carrying the `awk` command that
produced its expected value — so no constant in the suite is magic.

```bash
ctest --test-dir build-release --output-on-failure
```

Also checked, because a smoke test wouldn't be: exact agreement with the
row-oriented baseline · prefix invariance (`limit=10` equals the first 10 of
`limit=200`, which fails the instant ordering isn't total) · the rare widening
branch, forced by a cohort of 5.

---

## Stack

C++20 · CMake · gRPC + protobuf · Go · GoogleTest · Google Benchmark ·
ASan/UBSan/TSan · `ghz` · `-Wconversion -Wshadow`, warning-free

```
include/engine/   public headers
src/              engine_core — parsing, column store, queries, indexes
service/          gRPC adapter (proto types in, domain types out)
proto/            engine.proto + generated code
apps/             CLI and server
go/               HTTP/JSON gateway (stateless; every number comes from the engine)
tests/            reference tests, each citing its awk command
bench/            Google Benchmark suite + DuckDB/Polars comparison
web/              frontend (Vite + React + TS), types generated from the proto
docs/             demo tapes — every GIF regenerable with `vhs docs/*.tape`
```

`engine_core` knows nothing about gRPC — which is why the translation layer is
its own target, testable without starting a server. The store and index are
built **completely before** the server listens, which is what makes concurrent
reads safe without a mutex: not the `const` keywords, but the fact that every
write happens before any reader exists.

---

## Status

| | |
|---|---|
| ✅ | columnar store · dictionary encoding · percentile index |
| ✅ | conditional percentile — the hero query — verified three ways |
| ✅ | gRPC service, load-tested |
| ✅ | distribution · nearest · class sweep · trends · attempts · equipment swap · class change |
| ✅ | Go HTTP/JSON gateway, parity-tested against gRPC on every endpoint |
| ✅ | Google Benchmark suite · DuckDB / Polars comparison |
| ✅ | frontend: Entry · Verdict · Weight Class · Attempts · Head to Head · Leaderboards · share card ([spec](docs/frontend-spec.md)) |
| 📋 | Explore (needs a query parser) · name search |

---

Data from [OpenPowerlifting](https://openpowerlifting.org), public domain.
