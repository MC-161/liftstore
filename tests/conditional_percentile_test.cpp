#include <gtest/gtest.h>

#include <cstddef>
#include <filesystem>
#include <string>

#include "engine/column_store.h"
#include "engine/lift.h"
#include "engine/percentile.h"
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


// The scale shown under the verdict sentence. awk over the same window:
//   ... $15>=207.5 && $15<=212.5 && $20!="" {print $20+0} | sort -n
//   -> element int(0.5 * 38298) = 135 kg (nearest rank, like rank_index_at).
// And the case from the screen that read "0th percentile": 17 of 41,243.
TEST(ConditionalPercentile, TargetMedianMatchesAwk) {
    if (!std::filesystem::exists(kDataset)) {
        GTEST_SKIP() << "full dataset not present: " << kDataset;
    }
    const auto hero = engine::conditional_percentile(
        dataset(), engine::Sex::M, engine::Equipment::Raw, engine::Event::SBD,
        engine::LiftKind::Squat, 210.0f, engine::LiftKind::Bench, 140.0f);
    EXPECT_FLOAT_EQ(hero.target_median, 135.0f);

    const auto low = engine::conditional_percentile(
        dataset(), engine::Sex::M, engine::Equipment::Raw, engine::Event::SBD,
        engine::LiftKind::Deadlift, 200.0f, engine::LiftKind::Bench, 60.0f);
    EXPECT_EQ(low.below, 17u);
    EXPECT_EQ(low.n, 41243u);
    EXPECT_FLOAT_EQ(low.target_median, 115.0f);
    EXPECT_TRUE(low.all_classes);
}

// Within the class ("lifters your size"). awk, adding 59 < BodyweightKg <= 66
// (men's 66 kg, index 2): n = 3272, none below 60, median 105.
TEST(ConditionalPercentile, WithinClassMatchesAwk) {
    if (!std::filesystem::exists(kDataset)) {
        GTEST_SKIP() << "full dataset not present: " << kDataset;
    }
    const auto r = engine::conditional_percentile(
        dataset(), engine::Sex::M, engine::Equipment::Raw, engine::Event::SBD,
        engine::LiftKind::Deadlift, 200.0f, engine::LiftKind::Bench, 60.0f, 2.5f, 500, 2);
    EXPECT_FALSE(r.all_classes);
    EXPECT_EQ(r.n, 3272u);
    EXPECT_EQ(r.below, 0u);
    EXPECT_FLOAT_EQ(r.target_median, 105.0f);

    std::size_t binned = 0;
    for (const auto& b : r.target_bins) { binned += b.count; }
    EXPECT_EQ(binned, r.n);                 // the strip chart shows everyone

    // A combination too rare for the class falls back to all classes.
    const auto rare = engine::conditional_percentile(
        dataset(), engine::Sex::F, engine::Equipment::Raw, engine::Event::SBD,
        engine::LiftKind::Squat, 300.0f, engine::LiftKind::Bench, 150.0f, 2.5f, 500, 4);
    EXPECT_TRUE(rare.all_classes);
}


// Spec 2.2: value_at_percentile clamps both ways. The service rejects p = 0
// (proto3 can't tell it from unset), so the minimum end is only reachable here.
// 70.0 and 582.5 are the group's min and max, already pinned by q4.sh and q5.sh.
TEST(ValueAtPercentile, ClampsToGroupMinAndMax) {
    if (!std::filesystem::exists(kDataset)) {
        GTEST_SKIP() << "full dataset not present: " << kDataset;
    }
    const engine::PercentileIndex ix(dataset());
    const auto at = [&](double p) {
        return ix.value_at_percentile(engine::Sex::F, engine::Equipment::Raw,
                                      engine::Event::SBD, 4, engine::LiftKind::Total, p);
    };
    EXPECT_FLOAT_EQ(at(0.0).value, 70.0f);
    EXPECT_FLOAT_EQ(at(100.0).value, 582.5f);
    EXPECT_DOUBLE_EQ(at(0.0).actual_percentile, 0.0);   // nothing strictly below the min
    EXPECT_EQ(at(50.0).n, 65964u);
}

