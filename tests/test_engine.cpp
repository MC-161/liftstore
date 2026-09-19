#include <gtest/gtest.h>
#include "engine/engine.h"

TEST(Engine, Add) {
    EXPECT_EQ(engine::add(2, 3), 5);
}