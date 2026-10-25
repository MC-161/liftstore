package httpapi

import (
	"context"
	"net/http"
	"time"

	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"

	enginev1 "github.com/MC-161/liftstore/gen/engine/v1"
)

// EmitUnpopulated is grpcurl's -emit-defaults. Without it n:0 and count:0 vanish
// from the JSON and the frontend sees undefined where it expects a number.
var marshaler = protojson.MarshalOptions{EmitUnpopulated: true}

const rpcTimeout = 10 * time.Second

func writeProto(w http.ResponseWriter, r *http.Request, msg proto.Message) {
	b, err := marshaler.Marshal(msg)
	if err != nil {
		engineError(w, r, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(b)
}


// call runs the RPC under a timeout and writes either the proto or the mapped error.
func (a *API) call(w http.ResponseWriter, r *http.Request,
	fn func(context.Context) (proto.Message, error)) {

	ctx, cancel := context.WithTimeout(r.Context(), rpcTimeout)
	defer cancel()

	resp, err := fn(ctx)
	if err != nil {
		engineError(w, r, err)
		return
	}
	writeProto(w, r, resp)
}

func (a *API) topLifters(w http.ResponseWriter, r *http.Request) {
	p := newParams(r.URL.Query())
	req := &enginev1.TopLiftersRequest{
		Sex: p.sex(), Equipment: p.equipment("equipment"), Event: p.event(),
		Limit: p.u32("limit"),
	}
	if p.err != nil { badRequest(w, p.err.Error()); return }
	a.call(w, r, func(ctx context.Context) (proto.Message, error) {
		return a.engine.TopLifters(ctx, req)
	})
}

func (a *API) percentile(w http.ResponseWriter, r *http.Request) {
	p := newParams(r.URL.Query())
	req := &enginev1.PercentileRequest{
		Sex: p.sex(), Equipment: p.equipment("equipment"), Event: p.event(),
		Bodyweight: p.f32("bodyweight"), Value: p.f32("value"), Lift: p.lift("lift"),
	}
	if p.err != nil { badRequest(w, p.err.Error()); return }
	a.call(w, r, func(ctx context.Context) (proto.Message, error) {
		return a.engine.Percentile(ctx, req)
	})
}

func (a *API) conditionalPercentile(w http.ResponseWriter, r *http.Request) {
	p := newParams(r.URL.Query())
	req := &enginev1.ConditionalPercentileRequest{
		Sex: p.sex(), Equipment: p.equipment("equipment"), Event: p.event(),
		ConditionLift:  p.lift("condition_lift"),
		ConditionValue: p.f32("condition_value"),
		TargetLift:     p.lift("target_lift"),
		TargetValue:    p.f32("target_value"),
	}
	if p.err != nil { badRequest(w, p.err.Error()); return }
	a.call(w, r, func(ctx context.Context) (proto.Message, error) {
		return a.engine.ConditionalPercentile(ctx, req)
	})
}

func (a *API) distribution(w http.ResponseWriter, r *http.Request) {
	p := newParams(r.URL.Query())
	req := &enginev1.DistributionRequest{
		Key: p.groupKey(), Lift: p.lift("lift"), BinWidth: p.f32("bin_width"),
	}
	if p.err != nil { badRequest(w, p.err.Error()); return }
	a.call(w, r, func(ctx context.Context) (proto.Message, error) {
		return a.engine.Distribution(ctx, req)
	})
}

func (a *API) classSweep(w http.ResponseWriter, r *http.Request) {
	p := newParams(r.URL.Query())
	req := &enginev1.ClassSweepRequest{
		Sex: p.sex(), Equipment: p.equipment("equipment"), Event: p.event(),
		Lift: p.lift("lift"), Value: p.f32("value"),
	}
	if p.err != nil { badRequest(w, p.err.Error()); return }
	a.call(w, r, func(ctx context.Context) (proto.Message, error) {
		return a.engine.ClassSweep(ctx, req)
	})
}

func (a *API) classTrend(w http.ResponseWriter, r *http.Request) {
	p := newParams(r.URL.Query())
	req := &enginev1.ClassTrendRequest{
		Key: p.groupKey(), Lift: p.lift("lift"),
		StartYear: p.u32("start_year"), EndYear: p.u32("end_year"),
	}
	if p.err != nil { badRequest(w, p.err.Error()); return }
	a.call(w, r, func(ctx context.Context) (proto.Message, error) {
		return a.engine.ClassTrend(ctx, req)
	})
}

func (a *API) equipmentSwap(w http.ResponseWriter, r *http.Request) {
	p := newParams(r.URL.Query())
	req := &enginev1.EquipmentSwapRequest{
		Sex: p.sex(), Event: p.event(),
		FromEquipment: p.equipment("from_equipment"),
		ToEquipment:   p.equipment("to_equipment"),
		Lift:          p.lift("lift"),
		IpfClass:      p.u32("ipf_class"),
	}
	if p.err != nil { badRequest(w, p.err.Error()); return }
	a.call(w, r, func(ctx context.Context) (proto.Message, error) {
		return a.engine.EquipmentSwap(ctx, req)
	})
}

func (a *API) classChange(w http.ResponseWriter, r *http.Request) {
	p := newParams(r.URL.Query())
	req := &enginev1.ClassChangeRequest{
		Sex: p.sex(), Equipment: p.equipment("equipment"), Event: p.event(),
		ClassDelta: p.i32("class_delta"),
	}
	if p.err != nil { badRequest(w, p.err.Error()); return }
	a.call(w, r, func(ctx context.Context) (proto.Message, error) {
		return a.engine.ClassChange(ctx, req)
	})
}

func (a *API) attempts(w http.ResponseWriter, r *http.Request) {
	p := newParams(r.URL.Query())
	req := &enginev1.AttemptsRequest{Key: p.groupKey(), Lift: p.lift("lift")}
	if p.err != nil { badRequest(w, p.err.Error()); return }
	a.call(w, r, func(ctx context.Context) (proto.Message, error) {
		return a.engine.Attempts(ctx, req)
	})
}

