#!/usr/bin/env python3
"""The engine's queries in DuckDB and Polars, same CSV, same machine.

    python3 bench/compare.py [csv] [--threads N]

Every query's ANSWER is checked against the engine's reconciled numbers before
its time is reported -- a fast wrong answer is not a data point. Times are hot
(data already in memory, best of RUNS), which is the engine's situation too:
it loads once and serves queries.

Only the 10 columns the queries touch are loaded (the engine loads all 42),
so the load times here are NOT comparable to the engine's and are printed
for context only.

The engine is single-threaded, so run this at --threads 1 for the like-for-like
row and at the default (all cores) for what the tools do out of the box.
Thread count must be fixed before polars is imported, hence the env var dance.
"""
import argparse
import os
import sys
import time

DEFAULT_CSV = os.path.join(os.path.dirname(__file__), "..", "data",
                           "openpowerlifting-2026-09-12-64bfe49f.csv")
RUNS = 20

# The engine's answers, from tests/conditional_percentile_test.cpp, tests/q4.sh
# and the CLI's top 10. Each was reconciled against awk.
TOP10_FIRST = ("Tamara Walcott", 759.0)
TOP10_LAST_TOTAL = 692.5
COND = (21079, 38298)           # below, n: M/Raw/SBD squat 210 +/-2.5 -> bench 140
PCT_N = 65964                   # F/Raw/SBD 63 kg class, totals


def best_ms(fn):
    fn()                                     # warm-up, discarded
    best = float("inf")
    for _ in range(RUNS):
        t = time.perf_counter()
        out = fn()
        best = min(best, (time.perf_counter() - t) * 1000.0)
    return best, out


def check(label, ok, got):
    if not ok:
        sys.exit(f"WRONG ANSWER from {label}: {got}")


def run_duckdb(csv, threads):
    import duckdb
    con = duckdb.connect()
    if threads:
        con.execute(f"SET threads = {threads}")

    t = time.perf_counter()
    # Encoded at load, as the engine's parser does: placed is a boolean, and
    # the three filter columns are ENUMs (1-byte codes, like the engine's enum
    # columns) -- so the query filters integers, not strings, on both sides.
    con.execute(f"""
        CREATE TABLE t AS
        SELECT Name,
               Sex::ENUM('M', 'F', 'Mx') AS Sex,
               Equipment::ENUM('Raw', 'Wraps', 'Single-ply', 'Multi-ply',
                               'Unlimited', 'Straps') AS Equipment,
               Event::ENUM('SBD', 'B', 'D', 'BD', 'S', 'SB', 'SD') AS Event,
               BodyweightKg, Best3SquatKg,
               Best3BenchKg, TotalKg, Date,
               Place NOT IN ('DQ', 'NS', 'G', 'DD') AS placed
        FROM read_csv('{csv}', header = true, all_varchar = false)
    """)
    load_ms = (time.perf_counter() - t) * 1000.0

    top = lambda: con.execute("""
        SELECT Name, max(TotalKg) AS best FROM t
        WHERE Sex = 'F' AND Equipment = 'Raw' AND Event = 'SBD'
          AND placed AND TotalKg IS NOT NULL
        GROUP BY Name ORDER BY best DESC, Name LIMIT 10
    """).fetchall()

    cond = lambda: con.execute("""
        SELECT count(*) FILTER (WHERE Best3BenchKg < 140), count(*) FROM t
        WHERE Sex = 'M' AND Equipment = 'Raw' AND Event = 'SBD' AND placed
          AND Best3SquatKg BETWEEN 207.5 AND 212.5 AND Best3BenchKg IS NOT NULL
    """).fetchone()

    pct = lambda: con.execute("""
        SELECT count(*) FILTER (WHERE TotalKg < 500), count(*) FROM t
        WHERE Sex = 'F' AND Equipment = 'Raw' AND Event = 'SBD' AND placed
          AND BodyweightKg > 57 AND BodyweightKg <= 63 AND TotalKg IS NOT NULL
    """).fetchone()

    return load_ms, top, cond, pct


def run_polars(csv, threads):
    import polars as pl
    t = time.perf_counter()
    df = (pl.read_csv(csv, columns=["Name", "Sex", "Equipment", "Event",
                                    "BodyweightKg", "Best3SquatKg", "Best3BenchKg",
                                    "TotalKg", "Place", "Date"],
                      infer_schema_length=100_000)
          .with_columns(placed=~pl.col("Place").is_in(["DQ", "NS", "G", "DD"]),
                        Sex=pl.col("Sex").cast(pl.Enum(["M", "F", "Mx"])),
                        Equipment=pl.col("Equipment").cast(pl.Enum(
                            ["Raw", "Wraps", "Single-ply", "Multi-ply", "Unlimited", "Straps"])),
                        Event=pl.col("Event").cast(pl.Enum(["SBD", "B", "D", "BD", "S", "SB", "SD"])))
          .drop("Place")
          .rechunk())
    load_ms = (time.perf_counter() - t) * 1000.0
    c = pl.col

    top = lambda: (df.filter((c("Sex") == "F") & (c("Equipment") == "Raw") &
                             (c("Event") == "SBD") & c("placed") & c("TotalKg").is_not_null())
                     .group_by("Name").agg(c("TotalKg").max().alias("best"))
                     .sort(["best", "Name"], descending=[True, False])
                     .head(10).rows())

    cond = lambda: (df.filter((c("Sex") == "M") & (c("Equipment") == "Raw") &
                              (c("Event") == "SBD") & c("placed") &
                              c("Best3SquatKg").is_between(207.5, 212.5) &
                              c("Best3BenchKg").is_not_null())
                      .select((c("Best3BenchKg") < 140).sum(), pl.len())
                      .row(0))

    pct = lambda: (df.filter((c("Sex") == "F") & (c("Equipment") == "Raw") &
                             (c("Event") == "SBD") & c("placed") &
                             (c("BodyweightKg") > 57) & (c("BodyweightKg") <= 63) &
                             c("TotalKg").is_not_null())
                     .select((c("TotalKg") < 500).sum(), pl.len())
                     .row(0))

    return load_ms, top, cond, pct


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("csv", nargs="?", default=DEFAULT_CSV)
    ap.add_argument("--threads", type=int, default=0, help="0 = library default")
    args = ap.parse_args()
    if args.threads:
        os.environ["POLARS_MAX_THREADS"] = str(args.threads)

    import duckdb
    import polars
    print(f"duckdb {duckdb.__version__}  polars {polars.__version__}  "
          f"threads={args.threads or 'default'}  best of {RUNS}")

    for name, runner in (("duckdb", run_duckdb), ("polars", run_polars)):
        load_ms, top, cond, pct = runner(args.csv, args.threads)

        top_ms, rows = best_ms(top)
        check(f"{name} top10", len(rows) == 10 and rows[0][0] == TOP10_FIRST[0]
              and abs(rows[0][1] - TOP10_FIRST[1]) < 1e-3
              and abs(rows[9][1] - TOP10_LAST_TOTAL) < 1e-3, rows)

        cond_ms, got = best_ms(cond)
        check(f"{name} conditional", tuple(got) == COND, got)

        pct_ms, got = best_ms(pct)
        check(f"{name} percentile scan", got[1] == PCT_N, got)

        print(f"{name:7s} load {load_ms:8.0f} ms   top10 {top_ms:7.2f} ms   "
              f"conditional {cond_ms:7.2f} ms   percentile-scan {pct_ms:7.2f} ms")


if __name__ == "__main__":
    main()
