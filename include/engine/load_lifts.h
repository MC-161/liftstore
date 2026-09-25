#pragma once

#include <vector>

#include "engine/lift.h"

namespace engine {

    // Reads the whole CSV and parses every row into a Lift (the M1/M2
    // array-of-structs baseline). Throws on any unexpected value.
    std::vector<Lift> load_lifts(const char* path);

}  // namespace engine