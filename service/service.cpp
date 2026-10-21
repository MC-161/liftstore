
#include "engine/service.h"

#include "engine/ipf_class.h"
#include "engine/query.h"


namespace  engine {

    std::optional<std::uint32_t> resolve_limit(std::uint32_t requested) {
        if (requested == 0) {
            return kDefaultLimit;
        }
        if (requested > kMaxLimit) { return std::nullopt; }

        return  requested;
    }

    // 20240315 -> "2024-03-15"
    std::string format_date(std::uint32_t yyyymmdd) {

        if (yyyymmdd == 0) {
            return {};
        }

        const unsigned year  =  yyyymmdd / 10000;        // 20240315 / 10000     = 2024
        const unsigned month = (yyyymmdd / 100) % 100;   // 202403   % 100       = 3
        const unsigned day   =  yyyymmdd % 100;          // 20240315 % 100       = 15

        // "YYYY-MM-DD" is 10 characters plus the NUL snprintf writes.
        char buf[11];
        std::snprintf(buf, sizeof(buf), "%04u-%02u-%02u", year, month, day);
        return std::string(buf, 10);
    }

    std::optional<Sex> from_proto(v1::Sex s) {
        switch (s) {
            case v1::SEX_M:  return Sex::M;
            case v1::SEX_F:  return Sex::F;
            case v1::SEX_MX: return Sex::Mx;
            case v1::SEX_UNSPECIFIED:
                default:
                    return std::nullopt;
        }
    }


    std::optional<Equipment> from_proto(v1::Equipment e) {
        switch (e) {
            case v1::EQUIPMENT_RAW: return Equipment::Raw;
            case v1::EQUIPMENT_WRAPS: return Equipment::Wraps;
            case v1::EQUIPMENT_SINGLE_PLY: return Equipment::SinglePly;
            case v1::EQUIPMENT_MULTI_PLY: return Equipment::MultiPly;
            case v1::EQUIPMENT_UNLIMITED: return Equipment::Unlimited;
            case v1::EQUIPMENT_STRAPS: return Equipment::Straps;
            case v1::EQUIPMENT_UNSPECIFIED:
                default:
                    return std::nullopt;
        }
    }

    std::optional<Event> from_proto(v1::Event e) {
        switch (e) {
            case v1::EVENT_SBD: return Event::SBD;
            case v1::EVENT_B: return Event::B;
            case v1::EVENT_D: return Event::D;
            case v1::EVENT_BD: return Event::BD;
            case v1::EVENT_S: return Event::S;
            case v1::EVENT_SB: return Event::SB;
            case v1::EVENT_SD: return Event::SD;
            case v1::EVENT_UNSPECIFIED:
                default:
                    return std::nullopt;
        }
    }



    grpc::Status EngineService::TopLifters(grpc::ServerContext*, const v1::TopLiftersRequest *request, v1::TopLiftersResponse *response) {
        // Translate and validate boundary
        const auto sex = from_proto(request->sex());
        if (!sex) {
            return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                "sex is required (got SEX_UNSPECIFIED)");
        }
        const auto equipment = from_proto(request->equipment());
        if (!equipment) {
            return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                "equipment is required (got EQUIPMENT_UNSPECIFIED)");
        }
        const auto event = from_proto(request->event());
        if (!event) {
            return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                "event is required (got EVENT_UNSPECIFIED)");
        }

        const auto limit = resolve_limit(request->limit());
        if (!limit) {
            return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                "limit " + std::to_string(request->limit()) +
                                " exceeds maximum " + std::to_string(kMaxLimit));
        }

        // call domain
        const auto ranked = top_lifters_columnar(store_, *sex, *equipment,
                                             *event, *limit);


        // Fill the response
        for (const Ranked& r : ranked) {
            v1::LifterResult* out = response->add_results();

            // store_.name[r.row]  is the dictionary index for that row
            // name_dict.value(ix) is the string_view for that index
            const std::string_view name = store_.name_dict.value(store_.name[r.row]);
            const std::string_view fed  = store_.federation_dict.value(store_.federation[r.row]);
            const std::string_view meet = store_.meet_name_dict.value(store_.meet_name[r.row]);

            // (ptr, len) overload: no temporary std::string, and unambiguous
            // across protobuf versions. A copy happens regardless -- the response
            // owns its strings -- so this just avoids a second one.
            out->set_name(name.data(), name.size());
            out->set_federation(fed.data(), fed.size());
            out->set_meet(meet.data(), meet.size());

            out->set_total(r.total);
            out->set_date(format_date(store_.date[r.row]));
        }

        return grpc::Status::OK;

    }


    grpc::Status EngineService::Percentile(grpc::ServerContext*, const v1::PercentileRequest *request, v1::PercentileResponse *response) {
        // Translate and validate boundary
        const auto sex = from_proto(request->sex());
        if (!sex) {
            return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                "sex is required (got SEX_UNSPECIFIED)");
        }
        const auto equipment = from_proto(request->equipment());
        if (!equipment) {
            return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                "equipment is required (got EQUIPMENT_UNSPECIFIED)");
        }
        const auto event = from_proto(request->event());
        if (!event) {
            return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                "event is required (got EVENT_UNSPECIFIED)");
        }


        if (!(request->bodyweight() > 0.0f) || request->bodyweight() > 1000.0f) {
            return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                "bodyweight must be between 0 and 1000 kg");
        }

        if (!(request->total() > 0.0f) || request->total() > 2000.0f) {
            return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                "total must be between 0 and 2000 kg");
        }

        const std::uint8_t cls = ipf_class_index(*sex, request->bodyweight());

        const PercentileResult res =
            index_.percentile_of(*sex, *equipment, *event, cls, request->total());

        response->set_percentile(res.percentile);
        response->set_below(static_cast<std::uint32_t>(res.below));   // size_t -> uint32
        response->set_n(static_cast<std::uint32_t>(res.n));
        response->set_weight_class(ipf_class_name(*sex, cls));

        return grpc::Status::OK;
        }


}
