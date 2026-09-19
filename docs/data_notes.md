# OpenPowerlifting data notes (M0)

Findings from inspecting the raw CSV before writing any C++.
These notes are the spec for the loader and struct design.

## Dataset version

| Item | Value | How measured |
|---|---|---|
| File | `openpowerlifting-2026-09-12-64bfe49f.csv` | `ls` |
| Data date | 2026-09-12 | file name |
| Build hash | `64bfe49f` | file name |
| Size | 786 MB | `ls -lh` |
| Lines | 4,032,181 | `wc -l` |
| Data rows | **4,032,180** (lines minus header) | |
| Columns | **42** | `head -1` |
| Dev slice | `dev.csv` = first 200,000 lines → 199,999 data rows + header | `head -200000` |

All benchmark numbers must be quoted against this version. When the dataset
is updated, re-run M0 and record the new version here.

## CSV format

- Delimiter: comma. First line is a header.
- **Every line has exactly 42 fields** (`awk -F, '{print NF}' | sort | uniq -c` → only `42`).
- **No quote characters in the file** (`grep -c '"'` → `0`).
- Therefore: no quoted commas and no line breaks inside fields.
  **The parser can split on `,` directly, with no quote handling.**
- Empty value = zero-length field (`,,`). No `NULL` / `NA` text.

## Columns

Percentages are of 4,032,180 data rows.

Ranking column legend:
**Core** = needed for a basic ranking query ·
**Filter** = useful for filtered rankings ·
**No** = dead weight for ranking.

| # | Name | Type | Ranking | Empty | % empty |
|---|---|---|---|---|---|
| 1 | Name | string | Core (one entry per lifter) | 0 | 0% |
| 2 | Sex | category (3 values) | Core | 0 | 0% |
| 3 | Event | category (7 values) | Core | 0 | 0% |
| 4 | Equipment | category (6 values) | Core | 0 | 0% |
| 5 | Age | float (e.g. `28.5`) | Filter | 1,463,450 | 36.3% |
| 6 | AgeClass | category / string | Filter | 1,090,591 | 27.0% |
| 7 | BirthYearClass | category / string | No | 1,378,482 | 34.2% |
| 8 | Division | string | No | 3,778 | 0.1% |
| 9 | BodyweightKg | float | Filter | 44,440 | 1.1% |
| 10 | WeightClassKg | TODO: numeric? | Filter | 59,601 | 1.5% |
| 11 | Squat1Kg | float, signed | No | 2,714,783 | 67.3% |
| 12 | Squat2Kg | float, signed | No | 2,728,582 | 67.7% |
| 13 | Squat3Kg | float, signed | No | 2,759,991 | 68.4% |
| 14 | Squat4Kg | float, signed | No | 4,022,219 | 99.8% |
| 15 | Best3SquatKg | float | No | 1,223,035 | 30.3% |
| 16 | Bench1Kg | float, signed | No | 2,120,062 | 52.6% |
| 17 | Bench2Kg | float, signed | No | 2,142,465 | 53.1% |
| 18 | Bench3Kg | float, signed | No | 2,197,385 | 54.5% |
| 19 | Bench4Kg | float, signed | No | 4,007,540 | 99.4% |
| 20 | Best3BenchKg | float | No | 454,162 | 11.3% |
| 21 | Deadlift1Kg | float, signed | No | 2,557,752 | 63.4% |
| 22 | Deadlift2Kg | float, signed | No | 2,582,764 | 64.1% |
| 23 | Deadlift3Kg | float, signed | No | 2,634,256 | 65.3% |
| 24 | Deadlift4Kg | float, signed | No | 4,004,034 | 99.3% |
| 25 | Best3DeadliftKg | float | No | 1,015,440 | 25.2% |
| 26 | TotalKg | float | Core | 270,318 | 6.7% |
| 27 | Place | number **or** code | Core (exclude codes) | 0 | 0% |
| 28 | Dots | float | Core (alt. sort key) | 296,542 | 7.4% |
| 29 | Wilks | float | No | 296,542 | 7.4% |
| 30 | Glossbrenner | float | No | 296,542 | 7.4% |
| 31 | Goodlift | float | No | 605,941 | 15.0% |
| 32 | Tested | boolean (`Yes` / blank) | Filter | 958,606 | 23.8% (blank = a value) |
| 33 | Country | string | No | 100,120 | 2.5% |
| 34 | State | string | No | 3,172,371 | 78.7% |
| 35 | Federation | category / string | Filter | 0 | 0% |
| 36 | ParentFederation | category / string | No | 1,588,468 | 39.4% |
| 37 | Date | date (`YYYY-MM-DD`) | Filter | 0 | 0% |
| 38 | MeetCountry | string | No | 0 | 0% |
| 39 | MeetState | string | No | 1,174,788 | 29.1% |
| 40 | MeetTown | string | No | 565,403 | 14.0% |
| 41 | MeetName | string | No | 0 | 0% |
| 42 | Sanctioned | boolean (`Yes` / `No`) | No | 0 | 0% |

Every column used to filter a basic ranking (Sex, Event, Equipment, Place)
is 100% filled. Attempt columns are mostly empty because many federations
record only the best lift; 4th attempts are record attempts and are almost
never present.

## Category values

Counts for each column sum to exactly 4,032,180, so these lists are complete.

**Sex** (3 values)

| Value | Rows |
|---|---|
| M | 2,904,900 |
| F | 1,127,081 |
| Mx | 199 |

`Mx` is rare but real. The code must not assume only M/F.

**Event** (7 values)

| Value | Rows | Meaning |
|---|---|---|
| SBD | 2,912,356 | Full power: squat, bench, deadlift |
| B | 798,870 | Bench only |
| D | 218,686 | Deadlift only |
| BD | 75,733 | Bench + deadlift |
| S | 19,939 | Squat only |
| SB | 4,185 | Squat + bench |
| SD | 2,411 | Squat + deadlift |

The 7 values are every non-empty combination of S, B, D, so Event could
be stored as 3 bits (S=1, B=2, D=4).

**Equipment** (6 values)

| Value | Rows |
|---|---|
| Raw | 1,920,327 |
| Single-ply | 1,415,163 |
| Unlimited | 324,292 |
| Wraps | 241,106 |
| Multi-ply | 131,173 |
| Straps | 119 |

**Tested** (2 values): `Yes` = 3,073,574 · blank = 958,606.
Blank is a real value ("not tested"), not missing data.

**Sanctioned** (2 values): `Yes` = 4,020,955 · `No` = 11,225. Never blank.

**Place**: a finishing position (1, 2, 3, ...) or one of these codes:

| Code | Rows | Meaning | Has a total? |
|---|---|---|---|
| DQ | 246,210 | Disqualified | No |
| NS | 22,249 | No-show | No |
| G | 13,758 | Guest lifter (competed, not ranked) | **Yes** |
| DD | 1,859 | Doping disqualification | No |

Top numeric places: 1 = 1,665,599 · 2 = 626,433 · 3 = 379,805.

**WeightClassKg**: most common values are numbers (`90`, `75`, `100`,
`82.5`, ...), but only the top 10 were checked. See open questions.

## Verified relationships

- **Empty TotalKg ⇒ Place is DQ, NS or DD.**
  DQ 246,210 + NS 22,249 + DD 1,859 = 270,318 = empty TotalKg count.
  Every row with a numeric place has a total.
- **Guests (`G`) have totals but must not be ranked.**
  Skipping rows with no total is not enough; `G` must be excluded explicitly.
- **No bodyweight ⇒ no Dots/Wilks/Glossbrenner.**
  26,224 rows have a total but no Dots; all 26,224 have no bodyweight.
  270,318 (no total) + 26,224 (total, no bodyweight) = 296,542 = empty Dots count.
- **A Dots ranking includes 26,224 fewer lifters than a TotalKg ranking.**

## Observations

- **Empty often means "not applicable", not "missing".** `Event = B` leaves
  every squat and deadlift column empty.
- **Negative attempt = failed attempt** at that weight (`-40` = failed 40 kg).
  The sign carries meaning and must be kept.
- **`Place` mixes numbers and codes**, so it is not a plain integer column.
- **`Age` is fractional**, so it needs a float type.
- Score columns (`Dots`, etc.) are written with 2 decimal places.


## Design decisions for M1

- How to represent a missing value in numeric columns (0 is not safe).
- Which C++ type each column gets (float vs double, int sizes).
- Categories (Sex, Event, Equipment) as 1-byte codes instead of strings.
- Tested and Sanctioned as booleans.
- How to store `Place`: finishing position plus a separate code for DQ/NS/G/DD?
- Whether to load all 42 columns or only core + filter columns.
- Ranking rule candidate: include a row only if Place is a number
  (this excludes DQ, NS, DD **and** G in one check).