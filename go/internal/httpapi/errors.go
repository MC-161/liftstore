package httpapi

import (
	"encoding/json"
	"log"
	"net/http"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type errorBody struct {
	Error errorDetail `json:"error"`
}

type errorDetail struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func mapCode(c codes.Code) (status int, name string, passMessage bool) {
	switch c {
	case codes.OK:
		return http.StatusOK, "ok", true
	case codes.InvalidArgument:
		return http.StatusBadRequest, "invalid_argument", true
	case codes.NotFound:
		return http.StatusNotFound, "not_found", true
	case codes.Unimplemented:
		return http.StatusNotImplemented, "unimplemented", true
	case codes.ResourceExhausted:
		return http.StatusTooManyRequests, "resource_exhausted", true
	case codes.Unavailable:
		return http.StatusServiceUnavailable, "unavailable", true
	case codes.DeadlineExceeded:
		return http.StatusGatewayTimeout, "deadline_exceeded", true
	default:
		// Internal, Unknown, DataLoss and anything new: these can carry
		// implementation detail and the caller can do nothing with it.
		return http.StatusInternalServerError, "internal", false
	}
}


func writeError(w http.ResponseWriter, code int, codeStr, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(errorBody{Error: errorDetail{Code: codeStr, Message: msg}})
}

func badRequest(w http.ResponseWriter, msg string) {
	writeError(w, http.StatusBadRequest, "invalid_argument", msg)
}

func engineError(w http.ResponseWriter, r *http.Request, err error) {
	st, _ := status.FromError(err)
	code, codeStr, passMessage := mapCode(st.Code())

	if code >= 500 {
		log.Printf("%s %s: %v", r.Method, r.URL.Path, err) // log every 5xx
	}

	msg := st.Message()
	if !passMessage {
		msg = "internal error"
	}
	writeError(w, code, codeStr, msg)
}
