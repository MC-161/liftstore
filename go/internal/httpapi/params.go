package httpapi

import (
	"fmt"
	"net/url"
	"strconv"

	enginev1 "github.com/MC-161/liftstore/gen/engine/v1"
)

// params parses a query string and remembers the FIRST error, so a handler can
// read everything it needs and check once at the end. Syntax only -- an empty
// parameter is left as the zero value so the engine gives its own "required"
// message, in one place.
type params struct {
	q   url.Values
	err error
}

func newParams(q url.Values) *params { return &params{q: q} }

func (p *params) fail(format string, a ...any) {
	if p.err == nil {
		p.err = fmt.Errorf(format, a...)
	}
}

func (p *params) enum(m map[string]int32, field string) int32 {
	raw := p.q.Get(field)
	if raw == "" {
		return 0
	}
	v, ok := m[raw]
	if !ok {
		p.fail("unknown %s %q", field, raw)
		return 0
	}
	return v
}

func (p *params) u32(field string) uint32 {
	raw := p.q.Get(field)
	if raw == "" {
		return 0
	}
	v, err := strconv.ParseUint(raw, 10, 32)
	if err != nil {
		p.fail("%s %q is not a non-negative integer", field, raw)
		return 0
	}
	return uint32(v)
}

func (p *params) i32(field string) int32 {
	raw := p.q.Get(field)
	if raw == "" {
		return 0
	}
	v, err := strconv.ParseInt(raw, 10, 32)
	if err != nil {
		p.fail("%s %q is not an integer", field, raw)
		return 0
	}
	return int32(v)
}

func (p *params) f32(field string) float32 {
	raw := p.q.Get(field)
	if raw == "" {
		return 0
	}
	v, err := strconv.ParseFloat(raw, 32)
	if err != nil {
		p.fail("%s %q is not a number", field, raw)
		return 0
	}
	return float32(v)
}

func (p *params) sex() enginev1.Sex {
	return enginev1.Sex(p.enum(enginev1.Sex_value, "sex"))
}
func (p *params) equipment(field string) enginev1.Equipment {
	return enginev1.Equipment(p.enum(enginev1.Equipment_value, field))
}
func (p *params) event() enginev1.Event {
	return enginev1.Event(p.enum(enginev1.Event_value, "event"))
}

func (p *params) lift(field string) enginev1.LiftKind {
	return enginev1.LiftKind(p.enum(enginev1.LiftKind_value, field))
}


func (p *params) groupKey() *enginev1.GroupKey {
	return &enginev1.GroupKey{
		Sex:       p.sex(),
		Equipment: p.equipment("equipment"),
		Event:     p.event(),
		IpfClass:  p.u32("ipf_class"),
	}
}