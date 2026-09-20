#include "engine/parse.h"

#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <stdexcept>

namespace engine {

namespace {

[[noreturn]] void fail(const char* what, std::string_view s) {
    std::string msg = what;
    msg += ": '";
    msg += s;
    msg += "'";
    throw std::runtime_error(msg);
}
// Text -> float. Strict: the WHOLE field must be a number.
// Plain std::stof("12abc") would silently return 12.
float to_float(std::string_view s, const char* what) {
    std::string str(s);
    std::size_t used = 0;
    float value = 0.0f;
    try {
        value = std::stof(str, &used);
    } catch (...) {          // stof throws on "abc" or huge values
        fail(what, s);
    }
    if (used != str.size()) {
        fail(what, s);
    }
    return value;
}

// Text -> int. Same strictness as to_float.
int to_int(std::string_view s, const char* what) {
    std::string str(s);
    std::size_t used = 0;
    int value = 0;
    try {
        value = std::stoi(str, &used);
    } catch (...) {
        fail(what, s);
    }
    if (used != str.size()) {
        fail(what, s);
    }
    return value;
}

}  // namespace

// ---------------------------------------------------------------
// Categories: known values only, anything else fails loudly.
// ---------------------------------------------------------------

Sex parse_sex(std::string_view s) {
    if (s == "M")  { return Sex::M; }
    if (s == "F")  { return Sex::F; }
    if (s == "Mx") { return Sex::Mx; }
    fail("unknown sex", s);
}

Event parse_event(std::string_view s) {
    if (s == "SBD") { return Event::SBD; }
    if (s == "B")   { return Event::B; }
    if (s == "D")   { return Event::D; }
    if (s == "BD")  { return Event::BD; }
    if (s == "S")   { return Event::S; }
    if (s == "SB")  { return Event::SB; }
    if (s == "SD")  { return Event::SD; }
    fail("unknown event", s);
}

Equipment parse_equipment(std::string_view s) {
    if (s == "Raw")        { return Equipment::Raw; }
    if (s == "Single-ply") { return Equipment::SinglePly; }
    if (s == "Unlimited")  { return Equipment::Unlimited; }
    if (s == "Wraps")      { return Equipment::Wraps; }
    if (s == "Multi-ply")  { return Equipment::MultiPly; }
    if (s == "Straps")     { return Equipment::Straps; }
    fail("unknown equipment", s);
}

// ---------------------------------------------------------------
// Numbers: empty field = no value (never 0).
// ---------------------------------------------------------------

std::optional<float> parse_optional_float(std::string_view s) {
    if (s.empty()) { return std::nullopt; }
    return to_float(s, "bad number");
}

// ---------------------------------------------------------------
// Place: a code (DQ/NS/G/DD) or a finishing position >= 1.
// M0: never empty.
// ---------------------------------------------------------------

Place parse_place(std::string_view s) {
    if (s == "DQ") { return Place{PlaceCode::DQ, 0}; }
    if (s == "NS") { return Place{PlaceCode::NS, 0}; }
    if (s == "G")  { return Place{PlaceCode::G, 0}; }
    if (s == "DD") { return Place{PlaceCode::DD, 0}; }
    if (s.empty()) { fail("empty place", s); }

    int n = to_int(s, "bad place");
    if (n < 1 || n > 65535) {   // must fit in std::uint16_t
        fail("place out of range", s);
    }
    return Place{PlaceCode::Placed, static_cast<std::uint16_t>(n)};
}

// ---------------------------------------------------------------
// WeightClassKg: "", "90", or "120+" ("and over").
// ---------------------------------------------------------------

std::optional<WeightClass> parse_weight_class(std::string_view s) {
    if (s.empty()) { return std::nullopt; }

    std::string_view original = s;
    bool plus = false;
    if (s.back() == '+') {
        plus = true;
        s = s.substr(0, s.size() - 1);
    }
    if (s.empty()) {
        return WeightClass{0.0f, true};
    }
    float kg = to_float(s, "bad weight class");
    return WeightClass{kg, plus};
}

    const char* split_line(const char* p, const char* end,
                           std::array<std::string_view, 42>& fields,
                           std::size_t& count) {
    count = 0;
    const char* line_start = p;
    const char* field_start = p;

    for (; p < end; ++p) {
        if (*p == ',' || *p == '\n') {
            if (count == fields.size()) {
                fail("too many fields on line",
                     std::string_view(line_start, p - line_start));
            }
            fields[count] = std::string_view(field_start, p - field_start);
            ++count;
            field_start = p + 1;
            if (*p == '\n') {
                return p + 1;             // next line starts after '\n'
            }
        }
    }

    // Reached end of buffer without '\n': last line of the file.
    if (line_start < end) {
        if (count == fields.size()) {
            fail("too many fields on line",
                 std::string_view(line_start, end - line_start));
        }
        fields[count] = std::string_view(field_start, end - field_start);
        ++count;
    }
    return end;
}

// ---------------------------------------------------------------
// Booleans.
// ---------------------------------------------------------------

bool parse_tested(std::string_view s) {
    if (s == "Yes") { return true; }
    if (s.empty())  { return false; }   // blank = not tested (M0)
    fail("unknown tested value", s);
}

bool parse_sanctioned(std::string_view s) {
    if (s == "Yes") { return true; }
    if (s == "No")  { return false; }
    fail("unknown sanctioned value", s);
}

Lift make_lift(const std::array<std::string_view, 42>& f) {
    Lift lift;

    lift.name              = std::string(f[0]);                 //  1 Name
    lift.sex               = parse_sex(f[1]);                   //  2 Sex
    lift.event             = parse_event(f[2]);                 //  3 Event
    lift.equipment         = parse_equipment(f[3]);             //  4 Equipment
    lift.age               = parse_optional_float(f[4]);        //  5 Age
    lift.age_class         = std::string(f[5]);                 //  6 AgeClass
    lift.birth_year_class  = std::string(f[6]);                 //  7 BirthYearClass
    lift.division          = std::string(f[7]);                 //  8 Division
    lift.bodyweight_kg     = parse_optional_float(f[8]);        //  9 BodyweightKg
    lift.weight_class      = parse_weight_class(f[9]);          // 10 WeightClassKg

    lift.squat1_kg         = parse_optional_float(f[10]);       // 11 Squat1Kg
    lift.squat2_kg         = parse_optional_float(f[11]);       // 12 Squat2Kg
    lift.squat3_kg         = parse_optional_float(f[12]);       // 13 Squat3Kg
    lift.squat4_kg         = parse_optional_float(f[13]);       // 14 Squat4Kg
    lift.best3_squat_kg    = parse_optional_float(f[14]);       // 15 Best3SquatKg

    lift.bench1_kg         = parse_optional_float(f[15]);       // 16 Bench1Kg
    lift.bench2_kg         = parse_optional_float(f[16]);       // 17 Bench2Kg
    lift.bench3_kg         = parse_optional_float(f[17]);       // 18 Bench3Kg
    lift.bench4_kg         = parse_optional_float(f[18]);       // 19 Bench4Kg
    lift.best3_bench_kg    = parse_optional_float(f[19]);       // 20 Best3BenchKg

    lift.deadlift1_kg      = parse_optional_float(f[20]);       // 21 Deadlift1Kg
    lift.deadlift2_kg      = parse_optional_float(f[21]);       // 22 Deadlift2Kg
    lift.deadlift3_kg      = parse_optional_float(f[22]);       // 23 Deadlift3Kg
    lift.deadlift4_kg      = parse_optional_float(f[23]);       // 24 Deadlift4Kg
    lift.best3_deadlift_kg = parse_optional_float(f[24]);       // 25 Best3DeadliftKg

    lift.total_kg          = parse_optional_float(f[25]);       // 26 TotalKg
    lift.place             = parse_place(f[26]);                // 27 Place

    lift.dots              = parse_optional_float(f[27]);       // 28 Dots
    lift.wilks             = parse_optional_float(f[28]);       // 29 Wilks
    lift.glossbrenner      = parse_optional_float(f[29]);       // 30 Glossbrenner
    lift.goodlift          = parse_optional_float(f[30]);       // 31 Goodlift

    lift.tested            = parse_tested(f[31]);               // 32 Tested
    lift.country           = std::string(f[32]);                // 33 Country
    lift.state             = std::string(f[33]);                // 34 State
    lift.federation        = std::string(f[34]);                // 35 Federation
    lift.parent_federation = std::string(f[35]);                // 36 ParentFederation
    lift.date              = std::string(f[36]);                // 37 Date
    lift.meet_country      = std::string(f[37]);                // 38 MeetCountry
    lift.meet_state        = std::string(f[38]);                // 39 MeetState
    lift.meet_town         = std::string(f[39]);                // 40 MeetTown
    lift.meet_name         = std::string(f[40]);                // 41 MeetName
    lift.sanctioned        = parse_sanctioned(f[41]);           // 42 Sanctioned

    return lift;
}
}

