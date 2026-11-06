#include <gtest/gtest.h>

#include <cstdint>
#include <stdexcept>
#include <string>

#include "engine/column_store.h"
#include "engine/query.h"

// Dictionary::find() used to read the build-time hash map, which done_loading()
// clears -- so after loading, every lookup returned 0 ("not present"). Queries
// only ever run after loading, so the bug was invisible until the first one
// that needed find().
TEST(Dictionary, FindWorksAfterDoneLoading) {
    engine::Dictionary d;
    // intern() keys its map on views into the CALLER's bytes (the file buffer,
    // in load_columns), so the source strings must outlive loading -- same
    // contract here. Short strings on purpose: SSO keeps their bytes inside the
    // std::string object, which moves when values_ reallocates, so anything
    // holding a view into values_ across a push_back would dangle.
    std::vector<std::string> source;
    for (int i = 0; i < 100; ++i) { source.push_back("x" + std::to_string(i)); }

    const std::uint32_t usa = d.intern("USA");
    const std::uint32_t gbr = d.intern("GBR");
    const std::uint32_t aus = d.intern("AUS");
    for (const std::string& s : source) { (void)d.intern(s); }

    EXPECT_EQ(d.find("GBR"), gbr);              // before: hash map
    d.done_loading();

    EXPECT_EQ(d.find("USA"), usa);              // after: sorted index
    EXPECT_EQ(d.find("GBR"), gbr);
    EXPECT_EQ(d.find("AUS"), aus);
    EXPECT_EQ(d.find("x42"), d.find("x42"));
    EXPECT_EQ(d.value(d.find("x42")), "x42");
    EXPECT_EQ(d.find("NOPE"), 0u);
    EXPECT_EQ(d.find(""), 0u);                  // index 0 is the empty string
}

TEST(Dictionary, InternAfterDoneLoadingThrows) {
    engine::Dictionary d;
    (void)d.intern("a");
    d.done_loading();
    EXPECT_THROW((void)d.intern("b"), std::logic_error);
}

namespace {

// Only the columns top_lifters_columnar reads. size() is total_kg.size().
void push_row(engine::ColumnStore& s, const char* name, float total, std::uint32_t date) {
    s.name.push_back(s.name_dict.intern(name));
    s.sex.push_back(engine::Sex::F);
    s.equipment.push_back(engine::Equipment::Raw);
    s.event.push_back(engine::Event::SBD);
    s.place_code.push_back(engine::PlaceCode::Placed);
    s.total_kg.push_back(total);
    s.date.push_back(date);
}

}  // namespace

// A Placed row with a NaN total must not reach the sort: NaN breaks the
// comparator's strict weak ordering, which is UB, and in practice NaN rows
// surface in the output or push real rows out of it.
TEST(TopLiftersColumnar, SkipsMissingTotals) {
    engine::ColumnStore s;
    const char* names[] = {"a", "b", "c", "d", "e", "f", "g", "h"};
    const float totals[] = {300.0f, engine::kMissing, 500.0f, 400.0f,
                            engine::kMissing, 200.0f, engine::kMissing, 100.0f};
    for (int i = 0; i < 8; ++i) { push_row(s, names[i], totals[i], 20240101); }
    s.name_dict.done_loading();

    const auto top = engine::top_lifters_columnar(s, engine::Sex::F, engine::Equipment::Raw,
                                                  engine::Event::SBD, 100);
    ASSERT_EQ(top.size(), 5u);
    const float want[] = {500.0f, 400.0f, 300.0f, 200.0f, 100.0f};
    for (std::size_t i = 0; i < top.size(); ++i) {
        EXPECT_FALSE(engine::is_missing(top[i].total)) << "rank " << i;
        EXPECT_FLOAT_EQ(top[i].total, want[i]) << "rank " << i;
    }
}

