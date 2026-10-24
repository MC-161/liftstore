
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

    std::optional<LiftKind> from_proto(v1::LiftKind l) {
        switch (l) {
            case v1::LIFT_KIND_SQUAT:    return LiftKind::Squat;
            case v1::LIFT_KIND_BENCH:    return LiftKind::Bench;
            case v1::LIFT_KIND_DEADLIFT: return LiftKind::Deadlift;
            case v1::LIFT_KIND_TOTAL:    return LiftKind::Total;
            case v1::LIFT_KIND_UNSPECIFIED:
                default:
                    return std::nullopt;
        }
    }

    BinWidth resolve_bin_width(float requested, float min, float max) {
        BinWidth r;
        r.width = (requested == 0.0f) ? kDefaultBinWidth : requested;

        // !(w > 0) rather than w <= 0: this also rejects NaN.
        if (!(r.width > 0.0f)) { return r; }

        const float first_edge = std::floor(min / r.width) * r.width;
        r.bins = static_cast<std::size_t>(
                     std::floor((max - first_edge) / r.width)) + 1;

        r.ok = (r.bins <= kMaxBins);
        return r;
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
        const auto lift = from_proto(request->lift());
        if (!lift) {
            return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                "lift is required (got LIFT_KIND_UNSPECIFIED)");
        }


        if (!(request->bodyweight() > 0.0f) || request->bodyweight() > 1000.0f) {
            return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                "bodyweight must be between 0 and 1000 kg");
        }

        const float value = request->value();
        if (!(value > 0.0f) || value > 2000.0f) {
            return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,"value must be between 0 and 2000 kg");
        }

        const std::uint8_t cls = ipf_class_index(*sex, request->bodyweight());

        const NearestResult near = index_.nearest(*sex, *equipment, *event, cls, *lift,
                                              value, kNeighbourCount, store_.name);
        for (const Neighbour& nb : near.neighbours) {
            v1::Neighbour* out = response->add_neighbours();
            out->set_name(store_.name_dict.value(store_.name[nb.row]));
            out->set_value(nb.value);
        }

        std::fprintf(stderr, "[dbg] k=%zu near.found=%d near.n=%zu got=%zu\n",
                 kNeighbourCount, static_cast<int>(near.found),
                 near.n, near.neighbours.size());

        const PercentileResult res =
            index_.percentile_of(*sex, *equipment, *event, cls , *lift, value);

        response->set_percentile(res.percentile);
        response->set_below(static_cast<std::uint32_t>(res.below));   // size_t -> uint32
        response->set_rank(static_cast<std::uint32_t>(res.rank));
        response->set_n(static_cast<std::uint32_t>(res.n));
        response->set_weight_class(ipf_class_name(*sex, cls));


        return grpc::Status::OK;
        }


    grpc::Status EngineService::ConditionalPercentile(
            grpc::ServerContext*,
            const v1::ConditionalPercentileRequest* request,
            v1::ConditionalPercentileResponse* response) {
        // ---- translate and validate ----
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
        const auto condition_lift = from_proto(request->condition_lift());
        if (!condition_lift) {
            return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                "condition_lift is required (got LIFT_KIND_UNSPECIFIED)");
        }
        const auto target_lift = from_proto(request->target_lift());
        if (!target_lift) {
            return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                "target_lift is required (got LIFT_KIND_UNSPECIFIED)");
        }

        // Bind once, validate the binding, use the binding -- this is the handler
        // where validating total_kg() while using total() bit you.
        const float condition_value = request->condition_value();
        if (!(condition_value > 0.0f) || condition_value > 2000.0f) {
            return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                "condition_value must be between 0 and 2000 kg");
        }

        const float target_value = request->target_value();
        if (!(target_value > 0.0f) || target_value > 2000.0f) {
            return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                "target_value must be between 0 and 2000 kg");
        }

        // ---- call domain ----
        const auto res = conditional_percentile(store_, *sex, *equipment, *event,
                                                *condition_lift, condition_value,
                                                *target_lift,    target_value);

        // ---- fill response ----

        response->set_percentile(res.percentile);
        response->set_below(static_cast<std::uint32_t>(res.below));
        response->set_n(static_cast<std::uint32_t>(res.n));
        response->set_tol_used(res.tol_used);

        return grpc::Status::OK;
    }



        grpc::Status EngineService::Distribution(grpc::ServerContext*,
                                             const v1::DistributionRequest* request,
                                             v1::DistributionResponse* response) {
        const v1::GroupKey& key = request->key();

        const auto sex = from_proto(key.sex());
        if (!sex) {
            return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                "sex is required (got SEX_UNSPECIFIED)");
        }
        const auto equipment = from_proto(key.equipment());
        if (!equipment) {
            return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                "equipment is required (got EQUIPMENT_UNSPECIFIED)");
        }
        const auto event = from_proto(key.event());
        if (!event) {
            return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                "event is required (got EVENT_UNSPECIFIED)");
        }
        const auto lift = from_proto(request->lift());
        if (!lift) {
            return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                "lift is required (got LIFT_KIND_UNSPECIFIED)");
        }

        // ipf_class arrives raw from the client here, unlike Percentile where it
        // is derived from bodyweight. Unchecked, slot_of indexes past groups_.
        if (key.ipf_class() >= kIpfClassCount) {
            return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                "ipf_class " + std::to_string(key.ipf_class()) +
                                " out of range (0.." + std::to_string(kIpfClassCount - 1) + ")");
        }
        const auto cls = static_cast<std::uint8_t>(key.ipf_class());

        const auto dist = index_.distribution(*sex, *equipment, *event, cls, *lift);

        v1::GroupSummary* summary = response->mutable_summary();
        summary->mutable_key()->CopyFrom(key);
        summary->set_weight_class(ipf_class_name(*sex, cls));
        summary->set_n(static_cast<std::uint32_t>(dist.n));
        summary->set_mean(static_cast<float>(dist.mean));
        summary->set_sd(static_cast<float>(dist.sd));

        // A real but empty class: populated summary, no bins, no marks.
        if (dist.n == 0) { return grpc::Status::OK; }

        const BinWidth bw = resolve_bin_width(request->bin_width(), dist.min, dist.max);
        if (!bw.ok) {
            return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                "bin_width " + std::to_string(bw.width) +
                                " would produce " + std::to_string(bw.bins) +
                                " bins, maximum " + std::to_string(kMaxBins));
        }

        const auto hist = index_.histogram(*sex, *equipment, *event, cls, *lift, bw.width);

        for (const HistBin& b : hist.bins) {
            v1::Bin* out = response->add_bins();
            out->set_low(b.low);
            out->set_high(b.high);
            out->set_count(static_cast<std::uint32_t>(b.count));
        }

        for (int k = -2; k <= 2; ++k) {
            const float v = static_cast<float>(hist.mean + k * hist.sd);
            v1::SigmaMark* out = response->add_sigma_marks();
            out->set_k(k);
            out->set_value(v);
            out->set_in_range(v >= hist.min && v <= hist.max);
        }

        response->set_min(hist.min);
        response->set_max(hist.max);
        response->set_bin_width(bw.width);

        return grpc::Status::OK;
    }

    grpc::Status EngineService::ClassSweep(grpc::ServerContext*,
                                           const v1::ClassSweepRequest* request,
                                           v1::ClassSweepResponse* response) {
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
        const auto lift = from_proto(request->lift());
        if (!lift) {
            return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                "lift is required (got LIFT_KIND_UNSPECIFIED)");
        }

        // value is OPTIONAL here: 0 means "no percentile column", so it is only
        // range-checked when it was actually sent.
        const float value     = request->value();
        const bool  has_value = (value > 0.0f);
        if (has_value && value > 2000.0f) {
            return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                "value must be between 0 and 2000 kg");
        }

        for (std::uint32_t c = 0; c < kIpfClassCount; ++c) {
            const auto cls  = static_cast<std::uint8_t>(c);
            const auto dist = index_.distribution(*sex, *equipment, *event, cls, *lift);

            v1::ClassSweepRow* row = response->add_rows();

            v1::GroupSummary* s = row->mutable_summary();
            v1::GroupKey* k = s->mutable_key();
            k->set_sex(request->sex());
            k->set_equipment(request->equipment());
            k->set_event(request->event());
            k->set_ipf_class(c);

            s->set_weight_class(ipf_class_name(*sex, cls));
            s->set_n(static_cast<std::uint32_t>(dist.n));
            s->set_mean(static_cast<float>(dist.mean));
            s->set_sd(static_cast<float>(dist.sd));

            // No percentile in an empty class -- 0.0 would read as "bottom of the group".
            if (has_value && dist.n > 0) {
                const auto pct = index_.percentile_of(*sex, *equipment, *event,
                                                      cls, *lift, value);
                row->set_percentile(pct.percentile);
                row->set_has_percentile(true);
            }
        }

        return grpc::Status::OK;
    }

    YearRange resolve_years(std::uint32_t start, std::uint32_t end) {
        YearRange r;
        r.start = (start == 0) ? kMinYear : start;
        r.end   = (end   == 0) ? kMaxYear : end;
        r.ok    = (r.start <= r.end) && (r.start >= kMinYear) && (r.end <= kMaxYear);
        return r;
    }

    grpc::Status EngineService::ClassTrend(grpc::ServerContext*,
                                           const v1::ClassTrendRequest* request,
                                           v1::ClassTrendResponse* response) {
        const v1::GroupKey& key = request->key();

        const auto sex = from_proto(key.sex());
        if (!sex) {
            return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                "sex is required (got SEX_UNSPECIFIED)");
        }
        const auto equipment = from_proto(key.equipment());
        if (!equipment) {
            return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                "equipment is required (got EQUIPMENT_UNSPECIFIED)");
        }
        const auto event = from_proto(key.event());
        if (!event) {
            return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                "event is required (got EVENT_UNSPECIFIED)");
        }
        const auto lift = from_proto(request->lift());
        if (!lift) {
            return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                "lift is required (got LIFT_KIND_UNSPECIFIED)");
        }
        if (key.ipf_class() >= kIpfClassCount) {
            return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                "ipf_class " + std::to_string(key.ipf_class()) +
                                " out of range (0.." + std::to_string(kIpfClassCount - 1) + ")");
        }
        const auto cls = static_cast<std::uint8_t>(key.ipf_class());

        const YearRange years = resolve_years(request->start_year(), request->end_year());
        if (!years.ok) {
            return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                "year range " + std::to_string(years.start) + ".." +
                                std::to_string(years.end) + " is invalid (expected " +
                                std::to_string(kMinYear) + ".." + std::to_string(kMaxYear) + ")");
        }

        const auto rows = class_trend(store_, *sex, *equipment, *event, cls, *lift,
                                      years.start, years.end);

        for (const TrendRow& t : rows) {
            v1::ClassTrendRow* out = response->add_rows();
            out->set_year(t.year);
            out->set_n(static_cast<std::uint32_t>(t.n));
            out->set_mean(static_cast<float>(t.mean));
            out->set_sd(static_cast<float>(t.sd));
            out->set_p50(t.p50);
            out->set_p90(t.p90);
        }

        return grpc::Status::OK;
    }
    // Fourth time writing this fill -- extract it. Lives beside format_date.
    void fill_stats(v1::GroupSummary* out, const DistributionResult& d,
                    std::string_view weight_class) {
        out->set_weight_class(weight_class.data(), weight_class.size());
        out->set_n(static_cast<std::uint32_t>(d.n));
        out->set_mean(static_cast<float>(d.mean));
        out->set_sd(static_cast<float>(d.sd));
    }

    grpc::Status EngineService::EquipmentSwap(grpc::ServerContext*,
                                             const v1::EquipmentSwapRequest* request,
                                             v1::EquipmentSwapResponse* response) {
        const auto sex = from_proto(request->sex());
        if (!sex) {
            return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                "sex is required (got SEX_UNSPECIFIED)");
        }
        const auto event = from_proto(request->event());
        if (!event) {
            return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                "event is required (got EVENT_UNSPECIFIED)");
        }
        const auto from_eq = from_proto(request->from_equipment());
        if (!from_eq) {
            return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                "from_equipment is required (got EQUIPMENT_UNSPECIFIED)");
        }
        const auto to_eq = from_proto(request->to_equipment());
        if (!to_eq) {
            return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                "to_equipment is required (got EQUIPMENT_UNSPECIFIED)");
        }
        const auto lift = from_proto(request->lift());
        if (!lift) {
            return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                "lift is required (got LIFT_KIND_UNSPECIFIED)");
        }

        // Equal categories would put every lifter in both buckets and make every
        // delta zero -- a confidently wrong answer, so refuse it.
        if (*from_eq == *to_eq) {
            return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                "from_equipment and to_equipment must differ");
        }

        if (request->ipf_class() >= kIpfClassCount) {
            return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                "ipf_class " + std::to_string(request->ipf_class()) +
                                " out of range (0.." + std::to_string(kIpfClassCount - 1) + ")");
        }
        const auto cls = static_cast<std::uint8_t>(request->ipf_class());

        const auto res = equipment_swap(store_, *sex, *event, *from_eq, *to_eq, cls, *lift);

        response->set_lifters(static_cast<std::uint32_t>(res.lifters));
        if (res.lifters > 0) {
            response->set_mean_delta(static_cast<float>(res.mean_delta));
            response->set_sd_delta(static_cast<float>(res.sd_delta));
            response->set_median_delta(res.median_delta);
        }

        // The two populations the delta was drawn from, so the client can see what
        // was compared rather than taking the number on trust.
        const std::string_view wc = ipf_class_name(*sex, cls);

        v1::GroupSummary* fs = response->mutable_from_summary();
        v1::GroupKey* fk = fs->mutable_key();
        fk->set_sex(request->sex());
        fk->set_equipment(request->from_equipment());
        fk->set_event(request->event());
        fk->set_ipf_class(request->ipf_class());
        fill_stats(fs, index_.distribution(*sex, *from_eq, *event, cls, *lift), wc);

        v1::GroupSummary* ts = response->mutable_to_summary();
        v1::GroupKey* tk = ts->mutable_key();
        tk->set_sex(request->sex());
        tk->set_equipment(request->to_equipment());
        tk->set_event(request->event());
        tk->set_ipf_class(request->ipf_class());
        fill_stats(ts, index_.distribution(*sex, *to_eq, *event, cls, *lift), wc);

        return grpc::Status::OK;
    }


    grpc::Status EngineService::ClassChange(grpc::ServerContext*,
                                           const v1::ClassChangeRequest* request,
                                           v1::ClassChangeResponse* response) {
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

        const int delta = request->class_delta();
        if (delta == 0) {
            return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                "class_delta must be non-zero (+1 = moved up one class)");
        }
        const int max_delta = static_cast<int>(kIpfClassCount) - 1;
        if (delta < -max_delta || delta > max_delta) {
            return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                "class_delta " + std::to_string(delta) + " out of range (-" +
                                std::to_string(max_delta) + ".." + std::to_string(max_delta) +
                                ", excluding 0)");
        }

        const auto res = class_change(store_, *sex, *equipment, *event, delta,
                                      kDefaultClassDeltaBinWidth);

        response->set_lifters(static_cast<std::uint32_t>(res.lifters));
        response->set_transitions(static_cast<std::uint32_t>(res.transitions));
        response->set_improved(static_cast<std::uint32_t>(res.improved));

        if (res.transitions > 0) {
            response->set_mean_total_delta(static_cast<float>(res.mean_delta));
            response->set_sd_total_delta(static_cast<float>(res.sd_delta));
        }

        for (const HistBin& b : res.bins) {
            v1::Bin* out = response->add_delta_bins();
            out->set_low(b.low);
            out->set_high(b.high);
            out->set_count(static_cast<std::uint32_t>(b.count));
        }

        return grpc::Status::OK;
    }

    grpc::Status EngineService::Attempts(grpc::ServerContext*, const v1::AttemptsRequest *request, v1::AttemptsResponse *response) {
        const v1::GroupKey& key = request->key();

        const auto sex = from_proto(key.sex());
        if (!sex) {
            return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                "sex is required (got SEX_UNSPECIFIED)");
        }
        const auto equipment = from_proto(key.equipment());
        if (!equipment) {
            return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                "equipment is required (got EQUIPMENT_UNSPECIFIED)");
        }
        const auto event = from_proto(key.event());
        if (!event) {
            return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                "event is required (got EVENT_UNSPECIFIED)");
        }
        const auto lift = from_proto(request->lift());
        if (!lift) {
            return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                "lift is required (got LIFT_KIND_UNSPECIFIED)");
        }
        if (*lift == LiftKind::Total) {
            return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                "a total has no attempts; use SQUAT, BENCH or DEADLIFT");
        }
        if (key.ipf_class() >= kIpfClassCount) {
            return grpc::Status(grpc::StatusCode::INVALID_ARGUMENT,
                                "ipf_class " + std::to_string(key.ipf_class()) +
                                " out of range (0.." + std::to_string(kIpfClassCount - 1) + ")");
        }
        const auto cls = static_cast<std::uint8_t>(key.ipf_class());

        const auto res = attempts(store_, *sex, *equipment, *event, cls, *lift,
                                  kDefaultJumpBinWidth);

        response->set_n(static_cast<std::uint32_t>(res.n));
        response->set_third_attempt_success(static_cast<std::uint32_t>(res.third_success));

        if (res.n > 0) {
            response->set_success_rate(static_cast<float>(res.third_success) /
                                       static_cast<float>(res.n));
            response->set_mean_jump(static_cast<float>(res.mean_jump));
            response->set_sd_jump(static_cast<float>(res.sd_jump));
        }

        for (const HistBin& b : res.bins) {
            v1::Bin* out = response->add_jump_bins();
            out->set_low(b.low);
            out->set_high(b.high);
            out->set_count(static_cast<std::uint32_t>(b.count));
        }

        return grpc::Status::OK;


    }



}
