package main

import (
	"encoding/json"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"time"
)

func jsonResponse(w http.ResponseWriter, status int, payload map[string]any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func proxy(prefix, target string) http.Handler {
	u, err := url.Parse(target)
	if err != nil {
		panic(err)
	}
	p := httputil.NewSingleHostReverseProxy(u)
	original := p.Director
	p.Director = func(r *http.Request) {
		original(r)
		r.URL.Path = strings.TrimPrefix(r.URL.Path, prefix)
		if r.URL.Path == "" {
			r.URL.Path = "/"
		}
	}
	return p
}

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		jsonResponse(w, http.StatusOK, map[string]any{"status": "ok", "gateway": "go"})
	})
	mux.HandleFunc("/go", func(w http.ResponseWriter, r *http.Request) {
		jsonResponse(w, http.StatusOK, map[string]any{
			"service": "go", "runtime": "Go", "message": "APOLO Polyglot Cloud is running",
			"path": r.URL.Path, "time": time.Now().UTC().Format(time.RFC3339),
		})
	})
	mux.Handle("/go/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		jsonResponse(w, http.StatusOK, map[string]any{"service": "go", "runtime": "Go", "path": r.URL.Path})
	}))
	mux.Handle("/rust/", proxy("/rust", "http://127.0.0.1:8101"))
	mux.Handle("/rust", proxy("/rust", "http://127.0.0.1:8101"))
	mux.Handle("/python/", proxy("/python", "http://127.0.0.1:8102"))
	mux.Handle("/python", proxy("/python", "http://127.0.0.1:8102"))
	mux.Handle("/ruby/", proxy("/ruby", "http://127.0.0.1:8103"))
	mux.Handle("/ruby", proxy("/ruby", "http://127.0.0.1:8103"))
	mux.HandleFunc("/", func(w http.ResponseWriter, _ *http.Request) {
		jsonResponse(w, http.StatusOK, map[string]any{
			"project": "APOLO Polyglot Cloud", "languages": []string{"Rust", "Python", "Go", "Ruby"},
			"routes": map[string]string{"rust": "/rust", "python": "/python", "go": "/go", "ruby": "/ruby"},
		})
	})
	log.Println("APOLO Polyglot gateway listening on :8080")
	log.Fatal(http.ListenAndServe(":8080", mux))
}
