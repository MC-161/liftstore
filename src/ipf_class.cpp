#include "engine/ipf_class.h"

#include <engine/column_store.h>

namespace engine {
    namespace {
        constexpr float kMen[]   = {53, 59, 66, 74, 83, 93, 105, 120};
        constexpr float kWomen[] = {43, 47, 52, 57, 63, 69, 76, 84};
        // index 8 in each = the open class (120+ / 84+)

        constexpr std::string_view kMenNames[]   = {"53", "59", "66", "74",
                                                    "83", "93", "105", "120", "120+"};
        constexpr std::string_view kWomenNames[] = {"43", "47", "52", "57",
                                                    "63", "69", "76", "84", "84+"};
    }


    std::uint8_t ipf_class_index(Sex sex, float bodyweight_kg) {
        if(is_missing(bodyweight_kg)) { return kNoIpfClass;}

        // A bodyweight of zero or less is not a class. (Not known to occur; the
        // strict parsers reject unparseable values, not implausible ones.)
        if (bodyweight_kg <= 0.0f) {
            return kNoIpfClass;
        }

        const float* table = nullptr;
        std::size_t n = 0;

        switch (sex) {
            case Sex::M:
                table = kMen;
            n = std::size(kMen);
            break;
            case Sex::F:
                table = kWomen;
            n = std::size(kWomen);
            break;
            case Sex::Mx:
                // The IPF scheme has no Mx categories (199 rows). Reported as
                    // unrankable rather than folded into the men's or women's groups.
                        return kNoIpfClass;
        }

        for (std::size_t i = 0; i < n; ++i) {
            if (bodyweight_kg <= table[i]) {
                return static_cast<std::uint8_t>(i);
            }
        }

        // Heavier than every bound: the open class, one index past the table.
        return static_cast<std::uint8_t>(n);
    }
    std::string_view ipf_class_name(Sex sex, std::uint8_t index) {
        if (index == kNoIpfClass) {
            return "-";
        }

        const std::string_view* names = nullptr;
        std::size_t n = 0;

        switch (sex) {
            case Sex::M:
                names = kMenNames;
            n = std::size(kMenNames);
            break;
            case Sex::F:
                names = kWomenNames;
            n = std::size(kWomenNames);
            break;
            case Sex::Mx:
                return "-";
        }

        if (index >= n) {
            return "?";   // index not produced by ipf_class_index
        }
        return names[index];
    }


}