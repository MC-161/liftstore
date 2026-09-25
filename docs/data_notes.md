# OpenPowerlifting data notes

Findings from inspecting the data before and during implementation.
These notes are the spec for the loader and struct design.

Confidence levels used below:
**Proven** = measured on the full file ·
**Interpretation** = consistent with the data, but the meaning comes from elsewhere ·
**Unchecked** = not yet looked at.

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
is updated, re-run these checks and record the new version here.

## CSV format (all proven)

- Delimiter: comma. First line is a header.
- **Every line has exactly 42 fields** (`awk -F, '{print NF}' | sort | uniq -c` → only `42`).
- **No quote characters in the file** (`grep -c '"'` → `0`).
- Therefore: no quoted commas and no line breaks inside fields.
  **The parser splits on `,` directly, with no quote handling.**
- **Line endings are `\n` only** (`grep -c $'\r'` → `0`), so the last field
  carries no stray `\r`.
- Empty value = zero-length field (`,,`). No `NULL` / `NA` text.
- **Every one of the 4,032,180 rows parses** with the strict parsers in
  `src/parse.cpp` (which reject any unknown value), so the types below
  cover every value in the file.

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
| 10 | WeightClassKg | **not numeric**: number, or number + `+` | Filter | 59,601 | 1.5% |
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

Bench columns are fuller than squat and deadlift because more event types
include a bench: events with a bench (SBD+B+BD+SB) = 3,791,144 rows, with a
squat (SBD+S+SB+SD) = 2,938,891. So 1,093,289 rows never attempted a squat
but only 241,036 never attempted a bench.

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

The 7 values are every non-empty combination of S, B, D (2^3 - 1), so Event
could be stored as 3 bits (S=1, B=2, D=4).

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
Blank is a real value ("not tested"), not missing data. *(Interpretation:
confirm in the dataset README.)*

**Sanctioned** (2 values): `Yes` = 4,020,955 · `No` = 11,225. Never blank.

**Place**: a finishing position (1, 2, 3, ...) or one of these codes.
*(Code meanings are interpretations: confirm in the README.)*

| Code | Rows | Meaning | Has a total? |
|---|---|---|---|
| DQ | 246,210 | Disqualified | No |
| NS | 22,249 | No-show | No |
| G | 13,758 | Guest lifter (competed, not ranked) | **Yes** |
| DD | 1,859 | Doping disqualification | No |

Top numeric places: 1 = 1,665,599 · 2 = 626,433 · 3 = 379,805.

**WeightClassKg**: three forms — a number (`90`, `82.5`), a number with `+`
meaning "and over" (`120+`, `124.7+`), or empty. Values like `124.7+` and
`139.7+` are pound classes converted to kg (275 lb, 308 lb).
**371 rows are a bare `+`** with no number: interpreted as an open class
(0 kg and over), stored as `WeightClass{0, plus = true}` and kept distinct
from blank. The M0 shell check missed this, because `[0-9.]*` also matches
zero digits; the parser's fail-loudly rule caught it.

## Verified relationships (proven)

- **Empty TotalKg <=> Place is DQ, NS or DD**, proven in both directions.
  DQ 246,210 + NS 22,249 + DD 1,859 = 270,318 = empty TotalKg count, and no
  DQ/NS/DD row has a total (`awk ... $27 ~ /^(DQ|NS|DD)$/ && $26!=""` → 0).
  Every row with a numeric place has a total.
- **Guests (`G`) have totals but must not be ranked.**
  Skipping rows with no total is not enough; `G` must be excluded too.
- **No bodyweight => no Dots/Wilks/Glossbrenner.**
  26,224 rows have a total but no Dots; all 26,224 have no bodyweight.
  270,318 (no total) + 26,224 (total, no bodyweight) = 296,542 = empty Dots count.
  The three score columns share one empty count because they share inputs.
- **A Dots ranking includes 26,224 fewer lifters than a TotalKg ranking.**

## Observations

- **Empty often means "not applicable", not "missing".** `Event = B` leaves
  every squat and deadlift column empty.
- **Negative attempt = failed attempt** at that weight (`-40` = failed 40 kg).
  The sign carries meaning and must be kept.
- **`Place` mixes numbers and codes**, so it is not a plain integer column.
- **`Age` is fractional**, so it needs a float type.
- Score columns (`Dots`, etc.) are written with 2 decimal places.
- **Name disambiguation:** 158,618 rows (3.9%) have a `#N` suffix on names
  shared by different people (e.g. `Alexis Jones #1`). So deduplicating by
  name = deduplicating by person.
- **One performance can be several rows.** A lifter entering more than one
  division at a meet appears once per division (e.g. Tamara Walcott,
  2025-05-03, 759 kg, twice). Rankings are unaffected because they dedupe by
  name, but counts and averages must account for it.
- **Some values were converted from pounds**, e.g. a total of 730.28 kg
  (= 1,610 lb), which explains odd decimals. *(Interpretation.)*
- **The dev slice is not representative.** The top-10 query on `dev.csv`
  gives a different answer from the full file. Test on the slice; answer on
  the full file.

## Design decisions taken (M1)

- Numbers use `std::optional<float>`: empty is never 0.
- Categories (Sex, Event, Equipment) are `enum class : uint8_t` (1 byte).
- Tested and Sanctioned are `bool`.
- `Place` = `{PlaceCode code, uint16_t position}`.
- `WeightClassKg` = `std::optional<WeightClass{float kg, bool plus}>`.
- All 42 columns are loaded (the naive baseline stores whole rows).
- **Ranking rule: include a row only if Place is a number.** This excludes
  DQ, NS, DD **and** G in one check, and guarantees a total exists.
- Parsers reject anything unrecognised, with the bad value in the message.
  No silent defaults.



Decision 1: struct of named std::vectors.
Fixed compile-time schema + performance goal. Direct typed access, no
virtual dispatch or variant unwrapping per access, vectorizable scans.
Rejected type-erasure/variant: runtime schema flexibility isn't needed here
and costs indirection on every access.


Decision 2: categoricals
- Sex/Event/Equipment: already enum class : uint8_t (3/7/6 values).
- Twelve text columns have <= 34,791 distinct values: dictionary-encode with
  uint16 (MeetName needs uint32). 24 bytes/row -> 2 bytes/row, and filters
  become integer compares.
- Name (1,013,154 distinct, ~4 rows each): uint32 dictionary. Justified by
  dedupe becoming an integer compare, not by size alone.
- Date: NOT a dictionary. Store as an integer (days since epoch / YYYYMMDD)
  so ordering and range filters work directly.
- Numeric columns: keep as packed float. Low cardinality (TotalKg: 8,751)
  but they are the hot scan path; indirection would cost more than it saves.so age 


Decision: store all 42 columns.
Columnar storage means unread columns cost nothing at query time, so keeping
them preserves future use (profile pages, richer filters) without slowing
the ranking query. It also keeps the M1 comparison like-for-like: same
information stored, only the layout changes.
Effort is tiered: hot columns get careful types and packed layout; cold
columns are stored correctly with no further optimisation.
Cost of keeping them: load time and memory, both measured.


Decision 3: missing values
Hot float columns: NaN sentinel in a packed float array.
- 16 MB vs 32 MB for optional<float>; 16 floats per cache line vs 8.
- Comparisons with NaN are always false, so scans skip missing rows with
  no extra branch.
- Limitation: floats only. Not a problem in this schema — enums and Place
  are never empty (M0), and dictionary indexes can reserve 0 for empty.
  Known upgrade path: a validity bitmap (Arrow/Parquet standard) if generic
  per-column validity is ever needed. 1 bit/row = 504 KB per column.


Decision 4: alignment and ownership
Alignment: index i is the same row in every column. Enforced by a single
add_row() that appends to all columns, plus a size-equality check after load.
This is the cost of SoA: a struct can't desynchronise, parallel arrays can.
Ownership: ColumnStore owns its vectors. Non-copyable (= delete) so an
accidental copy of ~3 GB is a compile error; explicitly movable so the
loader can return it. Copy elision means the return usually constructs
in place with no move at all.


Prediction (before implementing):
Query: 102 ms -> 40 ms, because the filter walks ~40 MB instead of
2.13 GB (~50x less), while the sort/dedupe over ~200k matches is
unchanged and sets a floor.
Load: expect it to get SLOWER (dictionary building adds a hash lookup
per row per text column; same parsing work otherwise).
Memory: 3.07 GB -> 1 GB, because 13 text columns go from 24 bytes/row
to 2-4 bytes/row, and optional<float>


: returning ColumnStore by value triggers NO constructor
(C++17 copy elision, constructed directly in the caller). Explicit
std::move triggers the move constructor (pointer transfers only).
Moved-from object is still destroyed, holding 0 rows.
Copy is a compile error by design.becomes packed float.