package api

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/renatapetan61-ops/Apolo-infra/internal/store"
)

type Server struct { Store *store.Store; StartedAt time.Time }

type healthResponse struct { Status string `json:"status"`; Service string `json:"service"`; StartedAt time.Time `json:"started_at"`; Database string `json:"database"` }

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, http.StatusOK, map[string]string{"status":"ok", "service":"apolo-infra-daemon"}) })
	mux.HandleFunc("GET /readyz", func(w http.ResponseWriter, r *http.Request) {
		if err := s.Store.DB.PingContext(r.Context()); err != nil { writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status":"not_ready", "database":"unavailable"}); return }
		writeJSON(w, http.StatusOK, healthResponse{Status:"ready", Service:"apolo-infra-daemon", StartedAt:s.StartedAt, Database:"ok"})
	})
	return securityHeaders(mux)
}

func securityHeaders(next http.Handler) http.Handler { return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Header().Set("X-Content-Type-Options","nosniff"); w.Header().Set("Cache-Control","no-store"); next.ServeHTTP(w,r) }) }
func writeJSON(w http.ResponseWriter, status int, v any) { w.Header().Set("Content-Type","application/json; charset=utf-8"); w.WriteHeader(status); _ = json.NewEncoder(w).Encode(v) }
