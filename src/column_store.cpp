#include "engine/column_store.h"
#include <cstdio>
#include "engine/file_buffer.h"
#include "engine/parse.h"
#include <array>
#include <stdexcept>
#include <string>
namespace engine {


    // A uint16 column can hold indexes 0..65535. If a dictionary ever grows
    // past that, static_cast<uint16_t> keeps only the low 16 bits and every
    // later row silently points at the wrong string. Checked once per load.
    void check_fits_uint16(const Dictionary& dict, const char* name) {
        if (dict.size() > 65535) {
            throw std::runtime_error(std::string("dictionary too large for uint16: ") + name);
        }
    }

    std::uint16_t intern16(Dictionary& dict, std::string_view s) {
        return static_cast<std::uint16_t>(dict.intern(s));
    }


    ColumnStore load_columns(const char* path) {
        FileBuffer file(path);
        ColumnStore store;

        // ROW COUNT
        const char* buf = file.data();
        long size = static_cast<long>(file.size());


        std::size_t rows = 0;
        const char* end = buf + size;
        for (const char* p = buf; p < end; ++p) {
            if (*p == '\n') {
                ++rows;
            }
        }

        if (size > 0 && buf[size - 1] != '\n') {
            ++rows;
        }




        // SKIP HEADER
        // The first data line starts one byte after it.
        const char* data_start = nullptr;
        for (const char* p = buf; p < end; ++p) {
            if (*p == '\n') {
                data_start = p + 1;
                break;
            }
        }
        if (data_start == nullptr || data_start >= end) {
            throw std::runtime_error("no data line after header");
        }


        store.reserve(rows - 1);

        // REAL LOAD
        // Split that data line into fields.
        std::array<std::string_view, 42> fields;
        const char* p = data_start;
        long parsed = 0;



        while (p < end) {
            std::size_t count = 0;
            p = split_line(p, end, fields, count);
            ++parsed;

            if (count != 42) {
                throw std::runtime_error("row " + std::to_string(parsed) +
                                         ": expected 42 fields, got " + std::to_string(count));
            }

            store.name.push_back(store.name_dict.intern(fields[0]));          //  1 Name (uint32)
            store.sex.push_back(parse_sex(fields[1]));                        //  2 Sex
            store.event.push_back(parse_event(fields[2]));                    //  3 Event
            store.equipment.push_back(parse_equipment(fields[3]));            //  4 Equipment
            store.age.push_back(parse_float_or_missing(fields[4]));           //  5 Age
            store.age_class.push_back(intern16(store.age_class_dict, fields[5]));               //  6
            store.birth_year_class.push_back(intern16(store.birth_year_class_dict, fields[6])); //  7
            store.division.push_back(intern16(store.division_dict, fields[7]));                 //  8
            store.bodyweight_kg.push_back(parse_float_or_missing(fields[8])); //  9 BodyweightKg

            // 10 WeightClassKg -> two columns: the kg value and the "and over" flag.
            std::optional<WeightClass> wc = parse_weight_class(fields[9]);
            if (wc) {
                store.weight_class_kg.push_back(wc->kg);
                store.weight_class_plus.push_back(wc->plus ? 1 : 0);
            } else {
                store.weight_class_kg.push_back(kMissing);
                store.weight_class_plus.push_back(0);
            }

            store.squat1_kg.push_back(parse_float_or_missing(fields[10]));         // 11
            store.squat2_kg.push_back(parse_float_or_missing(fields[11]));         // 12
            store.squat3_kg.push_back(parse_float_or_missing(fields[12]));         // 13
            store.squat4_kg.push_back(parse_float_or_missing(fields[13]));         // 14
            store.best3_squat_kg.push_back(parse_float_or_missing(fields[14]));    // 15

            store.bench1_kg.push_back(parse_float_or_missing(fields[15]));         // 16
            store.bench2_kg.push_back(parse_float_or_missing(fields[16]));         // 17
            store.bench3_kg.push_back(parse_float_or_missing(fields[17]));         // 18
            store.bench4_kg.push_back(parse_float_or_missing(fields[18]));         // 19
            store.best3_bench_kg.push_back(parse_float_or_missing(fields[19]));    // 20

            store.deadlift1_kg.push_back(parse_float_or_missing(fields[20]));      // 21
            store.deadlift2_kg.push_back(parse_float_or_missing(fields[21]));      // 22
            store.deadlift3_kg.push_back(parse_float_or_missing(fields[22]));      // 23
            store.deadlift4_kg.push_back(parse_float_or_missing(fields[23]));      // 24
            store.best3_deadlift_kg.push_back(parse_float_or_missing(fields[24])); // 25

            store.total_kg.push_back(parse_float_or_missing(fields[25]));          // 26 TotalKg

            Place place = parse_place(fields[26]);                                 // 27 Place
            store.place_code.push_back(place.code);
            store.place_position.push_back(place.position);

            store.dots.push_back(parse_float_or_missing(fields[27]));              // 28
            store.wilks.push_back(parse_float_or_missing(fields[28]));             // 29
            store.glossbrenner.push_back(parse_float_or_missing(fields[29]));      // 30
            store.goodlift.push_back(parse_float_or_missing(fields[30]));          // 31

            store.tested.push_back(parse_tested(fields[31]) ? 1 : 0);              // 32 Tested
            store.country.push_back(intern16(store.country_dict, fields[32]));                     // 33
            store.state.push_back(intern16(store.state_dict, fields[33]));                         // 34
            store.federation.push_back(intern16(store.federation_dict, fields[34]));               // 35
            store.parent_federation.push_back(intern16(store.parent_federation_dict, fields[35])); // 36
            store.date.push_back(parse_date(fields[36]));                          // 37 Date (YYYYMMDD)
            store.meet_country.push_back(intern16(store.meet_country_dict, fields[37]));           // 38
            store.meet_state.push_back(intern16(store.meet_state_dict, fields[38]));               // 39
            store.meet_town.push_back(intern16(store.meet_town_dict, fields[39]));                 // 40
            store.meet_name.push_back(store.meet_name_dict.intern(fields[40]));    // 41 (uint32)
            store.sanctioned.push_back(parse_sanctioned(fields[41]) ? 1 : 0);      // 42 Sanctioned
        }

        // Every uint16 column: confirm the cast above never truncated.
        check_fits_uint16(store.age_class_dict, "AgeClass");
        check_fits_uint16(store.birth_year_class_dict, "BirthYearClass");
        check_fits_uint16(store.division_dict, "Division");
        check_fits_uint16(store.country_dict, "Country");
        check_fits_uint16(store.state_dict, "State");
        check_fits_uint16(store.federation_dict, "Federation");
        check_fits_uint16(store.parent_federation_dict, "ParentFederation");
        check_fits_uint16(store.meet_country_dict, "MeetCountry");
        check_fits_uint16(store.meet_state_dict, "MeetState");
        check_fits_uint16(store.meet_town_dict, "MeetTown");

        // The dictionaries' lookup keys are string_views into the file buffer,
        // which is destroyed when this function returns. Drop them now.
        store.name_dict.done_loading();
        store.age_class_dict.done_loading();
        store.birth_year_class_dict.done_loading();
        store.division_dict.done_loading();
        store.country_dict.done_loading();
        store.state_dict.done_loading();
        store.federation_dict.done_loading();
        store.parent_federation_dict.done_loading();
        store.meet_country_dict.done_loading();
        store.meet_state_dict.done_loading();
        store.meet_town_dict.done_loading();
        store.meet_name_dict.done_loading();

    if (!store.check_invariant()) {
        throw std::runtime_error("columns out of sync after load");
    }

    return store;
    }

    void ColumnStore::reserve(std::size_t n) {
    name.reserve(n);
    sex.reserve(n);
    event.reserve(n);
    equipment.reserve(n);
    age.reserve(n);
    age_class.reserve(n);
    birth_year_class.reserve(n);
    division.reserve(n);
    bodyweight_kg.reserve(n);
    weight_class_kg.reserve(n);
    weight_class_plus.reserve(n);
    squat1_kg.reserve(n);
    squat2_kg.reserve(n);
    squat3_kg.reserve(n);
    squat4_kg.reserve(n);
    best3_squat_kg.reserve(n);
    bench1_kg.reserve(n);
    bench2_kg.reserve(n);
    bench3_kg.reserve(n);
    bench4_kg.reserve(n);
    best3_bench_kg.reserve(n);
    deadlift1_kg.reserve(n);
    deadlift2_kg.reserve(n);
    deadlift3_kg.reserve(n);
    deadlift4_kg.reserve(n);
    best3_deadlift_kg.reserve(n);
    total_kg.reserve(n);
    place_code.reserve(n);
    place_position.reserve(n);
    dots.reserve(n);
    wilks.reserve(n);
    glossbrenner.reserve(n);
    goodlift.reserve(n);
    tested.reserve(n);
    country.reserve(n);
    state.reserve(n);
    federation.reserve(n);
    parent_federation.reserve(n);
    date.reserve(n);
    meet_country.reserve(n);
    meet_state.reserve(n);
    meet_town.reserve(n);
    meet_name.reserve(n);
    sanctioned.reserve(n);
    }

    bool ColumnStore::check_invariant() const {
    const std::size_t n = total_kg.size();
    for (std::size_t s : {name.size(), sex.size(), event.size(), equipment.size(),
                          age.size(), age_class.size(), birth_year_class.size(),
                          division.size(), bodyweight_kg.size(),
                          weight_class_kg.size(), weight_class_plus.size(),
                          squat1_kg.size(), squat2_kg.size(), squat3_kg.size(),
                          squat4_kg.size(), best3_squat_kg.size(),
                          bench1_kg.size(), bench2_kg.size(), bench3_kg.size(),
                          bench4_kg.size(), best3_bench_kg.size(),
                          deadlift1_kg.size(), deadlift2_kg.size(), deadlift3_kg.size(),
                          deadlift4_kg.size(), best3_deadlift_kg.size(),
                          place_code.size(), place_position.size(),
                          dots.size(), wilks.size(), glossbrenner.size(), goodlift.size(),
                          tested.size(), country.size(), state.size(),
                          federation.size(), parent_federation.size(), date.size(),
                          meet_country.size(), meet_state.size(), meet_town.size(),
                          meet_name.size(), sanctioned.size()}) {
        if (s != n) {
            return false;
        }
    }
    return true;
    }
}