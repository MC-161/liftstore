0.14s user 0.38s system 49% cpu 1.052 total


0.14s user 0.31s system 76% cpu 0.588 total



size of lift struct before parsing -> sizeof(Lift) = 528 bytes


Load time in debug -> load: 3276.4 ms

Load time in release -> load: 210.3 ms

# Benchmarks

Machine: MacBook Pro (Apple Silicon), macOS 26.6.2
Dataset: openpowerlifting-2026-09-12-64bfe49f.csv (786 MB, 4,032,180 rows)
Build: Release (-O3)

## M1 baseline: array of structs, std::vector<Lift>, no reserve

sizeof(Lift): 528 bytes (struct array alone: 2.13 GB)
Load (read + parse + build): 5026 
Peak resident memory: 2.95 GB
Peak memory footprint: 4.30 GB
(explained by vector doubling: old 1.11 GB + new 2.21 GB + file 0.82 GB)
Instructions retired: 49.8 billion (~12,300 per row)


Top 10 women, Raw, full power (SBD), ranked by TotalKg, one entry per lifter (their best total), only rows where Place is a number.


Query (top 10 Raw SBD women by total, 1 per lifter):
runs: 757.5 / 109.0 / 105.9 / 104.9 / 106.5 ms
best: 104.9 ms; first run 757.5 ms (likely memory compression under 4.3 GB peak)
Load: 5026 / 5461 / ____ ms


Load: 3424 / 3069 / 3314 ms (best 3069; was 5026 without reserve, -39%)
outlier: 3909 ms (18,959 involuntary context switches, other load on machine)
Peak memory footprint: 3.07 GB (was 4.30 GB; -1.23 GB = old block during
last doubling 1.11 GB + unused capacity 0.09 GB, as predicted)
sys time: 0.77-0.96 s (was 1.67 s)
Instructions: 47.3-47.8 B (was 49.8 B, only -4%)
→ time saved came from memory work (page allocation, zeroing, moving
2+ GB of structs), not computation
Query best: 103.4 ms (unchanged: reserve affects building, not final layout)
Query run 1: 720-810 ms. Cause UNKNOWN (not memory compression: penalty
unchanged when peak memory dropped by 1.23 GB). Open question.

