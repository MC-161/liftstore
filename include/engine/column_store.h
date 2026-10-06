#pragma once
#include <vector>
#include "engine/lift.h"
#include <cmath>
#include <cstdint>
#include <initializer_list>
#include <limits>
#include <string>
#include <string_view>
#include <type_traits>
#include <unordered_map>
#include <vector>


namespace engine{


    // Missing values Nan sentinals value used in float arrays
    // Reduction rom

    inline constexpr float kMissing = std::numeric_limits<float>::quiet_NaN();

    inline bool is_missing(float v) { return std::isnan(v); }


    class Dictionary {
    public:
        Dictionary() { values_.emplace_back(); lookup_.emplace(std::string_view{}, 0); }

        // Returns the index for s, adding it if it is new.
        std::uint32_t intern(std::string_view s) {
            if (s == last_key_) { return last_index_; }

            std::uint32_t index;
            auto it = lookup_.find(s);
            if (it != lookup_.end()) {
                index = it->second;
            } else {
                index = static_cast<std::uint32_t>(values_.size());
                values_.emplace_back(s);
                lookup_.emplace(s, index);
            }

            last_key_ = s;              // one place, both paths
            last_index_ = index;
            return index;
        }


        std::string_view value(std::uint32_t index) const { return values_[index]; }

        // Index of s, or 0 (empty) if s is not in the dictionary.
        // Used by queries to turn a filter value into an integer once.
        std::uint32_t find(std::string_view s) const {
            auto it = lookup_.find(s);
            return it == lookup_.end() ? 0 : it->second;
        }

        std::size_t size() const { return values_.size(); }

        // Drops the build-time lookup table, whose keys point into the file
        // buffer. Call once loading is finished.
        void done_loading() { lookup_.clear(); last_key_ = {}; }


    private:
        std::vector<std::string> values_;
        std::unordered_map<std::string_view, std::uint32_t> lookup_;
        std::string_view last_key_{};      // starts empty
        std::uint32_t last_index_ = 0;
    };







    class ColumnStore {
    public:
        ColumnStore() = default;

        // copy
        ColumnStore(const ColumnStore&) = delete;             // no accidental 3 GB copy
        ColumnStore& operator=(const ColumnStore&) = delete;

        // every member is a movable vector, so the compiler's
        // version just transfers pointers - no except
        // only move elements during reallocation if the move cannot throw.
        ColumnStore(ColumnStore&&) noexcept = default;
        ColumnStore& operator=(ColumnStore&&) noexcept = default;

        std::size_t size() const { return total_kg.size(); }

        void reserve(std::size_t n);
        bool check_invariant() const;   // every column the same length


        // Name: 1,013,154 distinct over 4M rows (~4 rows each).
        // integer comparison instead of a string comparison.
        std::vector<std::uint32_t> name;
        Dictionary name_dict;

        // 2-4 Categories: never empty so no missing marker.
        std::vector<Sex>       sex;
        std::vector<Event>     event;
        std::vector<Equipment> equipment;

        std::vector<float> age;

        //Rulebook age schemes: 19 and 8 values, both closed at the
        // top (90-999, 70-999). Dictionary-encoded here for uniform loader
        // code; enums are the alternative if new value to fail desired
        // the load loudly rather than be absorbed silently.

        std::vector<std::uint16_t> age_class;          //  AgeClass
        Dictionary age_class_dict;
        std::vector<std::uint16_t> birth_year_class;   //  BirthYearClass
        Dictionary birth_year_class_dict;

        std::vector<std::uint16_t> division;           //  Division (5,836 distinct)
        Dictionary division_dict;

        std::vector<float> bodyweight_kg;    // BodyweightKg

        // WeightClassKg: a number, a number with '+', or empty.
        // Split into two columns: the kg value (NaN when empty) and the
        // "and over" flag.
        std::vector<float>        weight_class_kg;

        // DERIVED (not in the CSV): IPF class index from sex + bodyweight.
        // 255 (kNoIpfClass) = unassignable: no bodyweight, or Mx.
        std::vector<std::uint8_t> ipf_class;

        std::vector<std::uint8_t> weight_class_plus;

        // Attempts and bests. Negative = failed attempt at that
        // weight; the sign carries meaning. Mostly empty (4th attempts are
        // 99%+ empty), never scanned by the ranking query: cold columns.
        std::vector<float> squat1_kg;        // 11
        std::vector<float> squat2_kg;        // 12
        std::vector<float> squat3_kg;        // 13
        std::vector<float> squat4_kg;        // 14
        std::vector<float> best3_squat_kg;   // 15

        std::vector<float> bench1_kg;        // 16
        std::vector<float> bench2_kg;        // 17
        std::vector<float> bench3_kg;        // 18
        std::vector<float> bench4_kg;        // 19
        std::vector<float> best3_bench_kg;   // 20

        std::vector<float> deadlift1_kg;     // 21
        std::vector<float> deadlift2_kg;     // 22
        std::vector<float> deadlift3_kg;     // 23
        std::vector<float> deadlift4_kg;     // 24
        std::vector<float> best3_deadlift_kg;// 25

        // TotalKg: the hot column. 8,751 distinct values, so a
        // dictionary would compress it, but this is the array every query
        // streams: indirection would cost more than the bytes it saves.
        std::vector<float> total_kg;

        // --- 27 Place: never empty. Split into code and position.
        // Ranking rule: include a row only if code == Placed (excludes
        // DQ, NS, DD and G, and guarantees a total exists).
        std::vector<PlaceCode>     place_code;
        std::vector<std::uint16_t> place_position;

        std::vector<float> dots;             // 28
        std::vector<float> wilks;            // 29
        std::vector<float> glossbrenner;     // 30
        std::vector<float> goodlift;         // 31

        // uint8 rather than vector<bool>, which is a bit-packed special case
        // whose proxy references complicate scanning code.
        std::vector<std::uint8_t> tested;    // 32 ("Yes" / blank = not tested)

        std::vector<std::uint16_t> country;            // 33 (199 distinct)
        Dictionary country_dict;
        std::vector<std::uint16_t> state;              // 34 (164)
        Dictionary state_dict;
        std::vector<std::uint16_t> federation;         // 35 (475)
        Dictionary federation_dict;
        std::vector<std::uint16_t> parent_federation;  // 36 (28)
        Dictionary parent_federation_dict;

        // --- 37 Date: NOT dictionary-encoded. Stored as YYYYMMDD so it
        // stays ordered and range filters are integer comparisons.
        // 0 = missing (Date is never empty in this dataset).
        std::vector<std::uint32_t> date;

        std::vector<std::uint16_t> meet_country;   // 38 (133)
        Dictionary meet_country_dict;
        std::vector<std::uint16_t> meet_state;     // 39 (253)
        Dictionary meet_state_dict;
        std::vector<std::uint16_t> meet_town;      // 40 (8,882)
        Dictionary meet_town_dict;

        // 34,791 distinct today, which fits uint16, but this grows with
        // every new meet: uint32 for headroom.
        std::vector<std::uint32_t> meet_name;      // 41
        Dictionary meet_name_dict;

        std::vector<std::uint8_t> sanctioned;      // 42 ("Yes" / "No", never blank)

    };


    ColumnStore load_columns(const char* path);
}
