package httpapi

import (
	"net/http"

	enginev1 "github.com/MC-161/liftstore/gen/engine/v1"
)

type API struct {
	engine enginev1.EngineClient
}

func NewRouter(client enginev1.EngineClient, corsOrigin string) http.Handler {
	api := &API{engine: client}

    	mux := http.NewServeMux()

    	mux.HandleFunc("GET /api/top-lifters", api.topLifters)
    	mux.HandleFunc("GET /api/percentile", api.percentile)
    	mux.HandleFunc("GET /api/conditional-percentile", api.conditionalPercentile)
    	mux.HandleFunc("GET /api/distribution", api.distribution)
    	mux.HandleFunc("GET /api/class-sweep", api.classSweep)
    	mux.HandleFunc("GET /api/class-trend", api.classTrend)
    	mux.HandleFunc("GET /api/equipment-swap", api.equipmentSwap)
    	mux.HandleFunc("GET /api/class-change", api.classChange)
    	mux.HandleFunc("GET /api/attempts", api.attempts)

    	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
    		w.WriteHeader(http.StatusOK)
    	})

    	return withCORS(corsOrigin, mux)
}