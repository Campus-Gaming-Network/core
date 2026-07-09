package httpapi

import (
	"encoding/json"
	"log/slog"
	"net"
	"net/http"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/config"
)

type Router struct {
	cfg config.Config
	mux *http.ServeMux
}

func NewRouter(cfg config.Config) http.Handler {
	router := &Router{
		cfg: cfg,
		mux: http.NewServeMux(),
	}

	router.mux.HandleFunc("/", requireMethod(http.MethodGet, router.handleRoot))
	router.mux.HandleFunc("/health", requireMethod(http.MethodGet, router.handleHealth))
	router.mux.HandleFunc("/ready", requireMethod(http.MethodGet, router.handleReady))

	return withRequestLogging(router.mux)
}

func (r *Router) handleRoot(w http.ResponseWriter, req *http.Request) {
	if req.URL.Path != "/" {
		http.NotFound(w, req)
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"service": "campus-gaming-network-api",
		"status":  "ok",
	})
}

func (r *Router) handleHealth(w http.ResponseWriter, req *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{
		"service": "campus-gaming-network-api",
		"status":  "ok",
	})
}

func (r *Router) handleReady(w http.ResponseWriter, req *http.Request) {
	address := net.JoinHostPort(r.cfg.DBHost, r.cfg.DBPort)
	dialer := net.Dialer{Timeout: r.cfg.DBConnectTimeout}

	conn, err := dialer.DialContext(req.Context(), "tcp", address)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{
			"service": "campus-gaming-network-api",
			"status":  "not_ready",
			"reason":  "postgres_unreachable",
		})
		return
	}
	defer conn.Close()

	writeJSON(w, http.StatusOK, map[string]string{
		"service": "campus-gaming-network-api",
		"status":  "ready",
	})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)

	if err := json.NewEncoder(w).Encode(payload); err != nil {
		slog.Error("write json response", "error", err)
	}
}

func withRequestLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, req)
		slog.Info("request",
			"method", req.Method,
			"path", req.URL.Path,
			"duration_ms", time.Since(start).Milliseconds(),
		)
	})
}

func requireMethod(method string, handler http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		if req.Method != method {
			w.Header().Set("Allow", method)
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{
				"error": "method_not_allowed",
			})
			return
		}

		handler(w, req)
	}
}
