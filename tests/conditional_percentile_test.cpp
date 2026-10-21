#include <gtest/gtest.h>

#include <cstddef>
#include <filesystem>
#include <string>

#include "engine/column_store.h"
#include "engine/lift.h"
#include "engine/query.h"

namespace {

// 786 MB, not committed. Tests that need it SKIP rather than fail, so ctest
// passes on a clean clone -- a test requiring a large download is a test
// nobody else runs.
const std::string kDataset =
    std::string(ENGINE_SOURCE_DIR) + "/data/openpowerlifting-2026-09-12-64bfe49f.csv";

// Loading 4M rows takes ~4 s. Function-local static: built once on first use,
// thread-safely (C++11), shared by every test in this file.
const engine::ColumnStore& dataset() {
    static const engine::ColumnStore store = engine::load_columns(kDataset.c_str());
    return store;
}

}  // namespace


// Q2 -- conditional percentile. Every row below was reconciled exactly against
// an independent awk pass over the same CSV on 2026-10-20; the commands live in
// docs/data-notes.md under "Q2 verification".
//
// This is a REFERENCE test, not a smoke test. A filter or mapping bug in this
// query returns a plausible, well-formed, wrong number -- nothing but
// comparison against an independently derived answer will catch it.
TEST(ConditionalPercentile, MatchesAwkReference) {
    if (!std::filesystem::exists(kDataset)) {
        GTEST_SKIP() << "full dataset not present: " << kDataset;
    }

    struct Case {
        const char*       name;
        engine::Sex       sex;
        engine::Equipment equip;
        engine::Event     event;
        engine::LiftKind  cond;
        float             cond_value;
        engine::LiftKind  targ;
        float             targ_value;
        std::size_t       want_below;
        std::size_t       want_n;
        float             want_tol;
    };

    const Case cases[] = {
        // The headline query: where does a 140 kg bench rank among lifters
        // who squat what you squat?
        { "squat 210 -> bench 140",
          engine::Sex::M, engine::Equipment::Raw, engine::Event::SBD,
          engine::LiftKind::Squat, 210.0f,
          engine::LiftKind::Bench, 140.0f,
          21079, 38298, 2.5f },

        // Event B is bench-only, so TotalKg IS the bench: everyone benching
        // ~100 necessarily totals under 300. below == n is correct here, and
        // a standing reminder that "total" is not one quantity across events.
        { "bench 100 -> total 300 (bench-only event)",
          engine::Sex::F, engine::Equipment::SinglePly, engine::Event::B,
          engine::LiftKind::Bench, 100.0f,
          engine::LiftKind::Total, 300.0f,
          2662, 2662, 2.5f },

        // Guards the widening branch: a 300 kg female squat is rare enough
        // that +/-2.5 yields fewer than min_n, so the scan reruns at +/-5.
        // n = 5 is also why the API always reports n beside the percentile
        // (percentile-design.md, decision 3).
        { "squat 300 -> bench 150 (widens to +/-5)",
          engine::Sex::F, engine::Equipment::Raw, engine::Event::SBD,
          engine::LiftKind::Squat, 300.0f,
          engine::LiftKind::Bench, 150.0f,
          1, 5, 5.0f },
    };

    for (const Case& c : cases) {
        SCOPED_TRACE(c.name);   // without this, every failure reports one line

        const auto r = engine::conditional_percentile(
            dataset(), c.sex, c.equip, c.event,
            c.cond, c.cond_value, c.targ, c.targ_value);

        EXPECT_EQ(r.below, c.want_below);
        EXPECT_EQ(r.n,     c.want_n);
        EXPECT_FLOAT_EQ(r.tol_used, c.want_tol);
        EXPECT_TRUE(r.found);

        // percentile is DERIVED from below/n, so assert the derivation rather
        // than a fourth constant that could silently drift from the other two.
        EXPECT_DOUBLE_EQ(r.percentile,
                         100.0 * static_cast<double>(c.want_below)
                               / static_cast<double>(c.want_n));
    }
}