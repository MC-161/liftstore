#pragma once
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace engine {

enum class Sex : std::uint8_t { M, F, Mx };

enum class Event : std::uint8_t { SBD, B, D, BD, S, SB, SD };

enum class LiftKind : std::uint8_t { Squat, Bench, Deadlift, Total };

struct HistBin { float low; float high; std::size_t count; };   // [low, high)

// The convention: nearest-rank, flooring. ONE definition of "percentile p" for
// the whole codebase -- Q5, Q11 and anything later all go through this.
inline std::size_t rank_index_at(std::size_t n, double pct) {
    if (n == 0) { return 0; }
    if (pct <= 0.0)   { return 0; }
    if (pct >= 100.0) { return n - 1; }
    const auto idx = static_cast<std::size_t>(pct / 100.0 * static_cast<double>(n));
    return idx < n ? idx : n - 1;
}

// Convenience for a plain ascending vector of values.
inline float value_at(const std::vector<float>& sorted, double pct) {
    if (sorted.empty()) { return 0.0f; }
    return sorted[rank_index_at(sorted.size(), pct)];
}

enum class Equipment : std::uint8_t {
    Raw,
    Wraps,
    SinglePly,   // CSV: "Single-ply"
    MultiPly,    // CSV: "Multi-ply"
    Unlimited,
    Straps
};


enum class PlaceCode : std::uint8_t { Placed, DQ, NS, G, DD };

struct Place {
    PlaceCode code = PlaceCode::Placed;
    std::uint16_t position = 0;   // meaningful only when code == Placed
};



// not always numeric (e.g. "120+", "124.7+"). 1.5% empty.

struct WeightClass {
    float kg = 0.0f;
    bool plus = false;   // true for "120+" style classes
};


struct Lift {
    std::string name;                          //  1 Name
    Sex sex = Sex::M;                          //  2 Sex
    Event event = Event::SBD;                  //  3 Event
    Equipment equipment = Equipment::Raw;      //  4 Equipment
    std::optional<float> age;                  //  5 Age (fractional, e.g. 28.5)
    std::string age_class;                     //  6 AgeClass
    std::string birth_year_class;              //  7 BirthYearClass
    std::string division;                      //  8 Division
    std::optional<float> bodyweight_kg;        //  9 BodyweightKg
    std::optional<WeightClass> weight_class;   // 10 WeightClassKg

    // Attempts: negative value = failed attempt at that weight.
    std::optional<float> squat1_kg;            // 11 Squat1Kg
    std::optional<float> squat2_kg;            // 12 Squat2Kg
    std::optional<float> squat3_kg;            // 13 Squat3Kg
    std::optional<float> squat4_kg;            // 14 Squat4Kg
    std::optional<float> best3_squat_kg;       // 15 Best3SquatKg

    std::optional<float> bench1_kg;            // 16 Bench1Kg
    std::optional<float> bench2_kg;            // 17 Bench2Kg
    std::optional<float> bench3_kg;            // 18 Bench3Kg
    std::optional<float> bench4_kg;            // 19 Bench4Kg
    std::optional<float> best3_bench_kg;       // 20 Best3BenchKg

    std::optional<float> deadlift1_kg;         // 21 Deadlift1Kg
    std::optional<float> deadlift2_kg;         // 22 Deadlift2Kg
    std::optional<float> deadlift3_kg;         // 23 Deadlift3Kg
    std::optional<float> deadlift4_kg;         // 24 Deadlift4Kg
    std::optional<float> best3_deadlift_kg;    // 25 Best3DeadliftKg

    std::optional<float> total_kg;             // 26 TotalKg
    Place place;                               // 27 Place

    // Scores: empty when no total OR no bodyweight (M0).
    std::optional<float> dots;                 // 28 Dots
    std::optional<float> wilks;                // 29 Wilks
    std::optional<float> glossbrenner;         // 30 Glossbrenner
    std::optional<float> goodlift;             // 31 Goodlift

    bool tested = false;                       // 32 Tested ("Yes" / blank = not tested)
    std::string country;                       // 33 Country
    std::string state;                         // 34 State
    std::string federation;                    // 35 Federation
    std::string parent_federation;             // 36 ParentFederation
    std::string date;                          // 37 Date (YYYY-MM-DD)
    std::string meet_country;                  // 38 MeetCountry
    std::string meet_state;                    // 39 MeetState
    std::string meet_town;                     // 40 MeetTown
    std::string meet_name;                     // 41 MeetName
    bool sanctioned = false;                   // 42 Sanctioned ("Yes" / "No")

};

}