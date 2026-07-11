package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/auth"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/config"
	eventstore "github.com/Campus-Gaming-Network/core/apps/api/internal/events"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/games"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/ratelimit"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/schools"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/users"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Router struct {
	cfg          config.Config
	mux          *http.ServeMux
	db           *pgxpool.Pool
	schools      schools.Repository
	follows      schools.FollowRepository
	games        games.Repository
	events       eventstore.Repository
	account      *auth.AccountService
	limiter      *ratelimit.Limiter
	sessionStore *auth.SessionRepository
}

func NewRouter(cfg config.Config, pools ...*pgxpool.Pool) http.Handler {
	router := &Router{
		cfg: cfg,
		mux: http.NewServeMux(),
	}
	if len(pools) > 0 {
		router.db = pools[0]
		schoolRepository := schools.NewPostgresRepository(router.db)
		userRepository := users.NewPostgresRepository(router.db)
		sessionRepository := auth.NewSessionRepository(router.db)
		router.schools = schoolRepository
		router.follows = schoolRepository
		router.games = games.NewPostgresRepository(router.db)
		router.events = eventstore.NewPostgresRepository(router.db)
		router.account = auth.NewAccountService(
			userRepository,
			schoolRepository,
			sessionRepository,
			auth.NewTokenRepository(router.db),
			&auth.ResendMailer{
				APIKey:  cfg.ResendAPIKey,
				From:    cfg.AccountEmailFrom,
				SiteURL: cfg.SiteURL,
				Logger:  slog.Default(),
			},
			cfg.SessionTTL,
			cfg.VerificationTTL,
			cfg.ResetTTL,
		)
		router.limiter = ratelimit.New(cfg.AuthRateLimit, cfg.AuthRateWindow)
		router.sessionStore = sessionRepository
	}

	router.mux.HandleFunc("/", requireMethod(http.MethodGet, router.handleRoot))
	router.mux.HandleFunc("/health", requireMethod(http.MethodGet, router.handleHealth))
	router.mux.HandleFunc("/ready", requireMethod(http.MethodGet, router.handleReady))
	router.mux.HandleFunc("/schools", router.handleSchools)
	router.mux.HandleFunc("/schools/", router.handleSchoolPath)
	router.mux.HandleFunc("/games", requireMethod(http.MethodGet, router.handleGames))
	router.mux.HandleFunc("/events", router.handleEvents)
	router.mux.HandleFunc("/events/", router.handleEventPath)
	router.mux.HandleFunc("/auth/signup", router.handleSignup)
	router.mux.HandleFunc("/auth/login", router.handleLogin)
	router.mux.HandleFunc("/auth/logout", router.handleLogout)
	router.mux.HandleFunc("/auth/verify-email", router.handleVerifyEmail)
	router.mux.HandleFunc("/auth/resend-verification", router.handleResendVerification)
	router.mux.HandleFunc("/auth/forgot-password", router.handleForgotPassword)
	router.mux.HandleFunc("/auth/reset-password", router.handleResetPassword)
	router.mux.HandleFunc("/me/schools", router.handleMySchools)
	router.mux.HandleFunc("/me", router.handleMe)
	router.mux.HandleFunc("/users/", router.handleUserPath)

	var handler http.Handler = router.mux
	if router.sessionStore != nil {
		handler = auth.WithSession(
			router.sessionStore,
			auth.SessionCookieConfig{
				Name:   cfg.SessionCookie,
				Secure: cfg.CookieSecure,
				TTL:    cfg.SessionTTL,
			},
		)(handler)
	}

	return withRequestLogging(handler)
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
	if r.db != nil {
		ctx, cancel := context.WithTimeout(req.Context(), r.cfg.DBConnectTimeout)
		defer cancel()
		if err := r.db.Ping(ctx); err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{
				"service": "campus-gaming-network-api",
				"status":  "not_ready",
				"reason":  "postgres_unreachable",
			})
			return
		}

		writeJSON(w, http.StatusOK, map[string]string{
			"service": "campus-gaming-network-api",
			"status":  "ready",
		})
		return
	}

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

func (r *Router) handleSchools(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	if r.schools == nil {
		writeError(w, http.StatusServiceUnavailable, "database_unavailable")
		return
	}

	params := schools.ListParams{
		Query:  req.URL.Query().Get("q"),
		State:  req.URL.Query().Get("state"),
		Limit:  25,
		Offset: 0,
	}
	var err error
	if value := req.URL.Query().Get("limit"); value != "" {
		params.Limit, err = strconv.Atoi(value)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid_limit")
			return
		}
	}
	if value := req.URL.Query().Get("offset"); value != "" {
		params.Offset, err = strconv.Atoi(value)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid_offset")
			return
		}
	}
	params = schools.NormalizeListParams(params)
	result, err := r.schools.List(req.Context(), params)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "schools_unavailable")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"schools": result,
		"limit":   params.Limit,
		"offset":  params.Offset,
	})
}

func (r *Router) handleSchoolPath(w http.ResponseWriter, req *http.Request) {
	path := strings.TrimPrefix(req.URL.Path, "/schools/")
	path = strings.TrimSuffix(path, "/")
	parts := strings.Split(path, "/")
	if len(parts) == 1 && parts[0] != "" {
		if req.Method != http.MethodGet {
			methodNotAllowed(w, http.MethodGet)
			return
		}
		if r.schools == nil {
			writeError(w, http.StatusServiceUnavailable, "database_unavailable")
			return
		}
		slug, err := url.PathUnescape(parts[0])
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid_school_slug")
			return
		}
		school, err := r.schools.GetBySlug(req.Context(), slug)
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "school_not_found")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "school_unavailable")
			return
		}
		writeJSON(w, http.StatusOK, school)
		return
	}

	if len(parts) == 2 && parts[1] == "follow" {
		if req.Method != http.MethodPost && req.Method != http.MethodDelete {
			methodNotAllowed(w, http.MethodPost+", "+http.MethodDelete)
			return
		}
		if r.follows == nil {
			writeError(w, http.StatusServiceUnavailable, "database_unavailable")
			return
		}
		userID, err := auth.RequireUser(req.Context())
		if err != nil {
			writeError(w, http.StatusUnauthorized, "authentication_required")
			return
		}
		if !looksLikeUUID(parts[0]) || !looksLikeUUID(userID) {
			writeError(w, http.StatusBadRequest, "invalid_id")
			return
		}

		if req.Method == http.MethodPost {
			err = r.follows.Follow(req.Context(), userID, parts[0])
			if errors.Is(err, schools.ErrSchoolNotFound) {
				writeError(w, http.StatusNotFound, "school_not_found")
				return
			}
			if err != nil {
				writeError(w, http.StatusInternalServerError, "follow_failed")
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}

		if err := r.follows.Unfollow(req.Context(), userID, parts[0]); err != nil {
			writeError(w, http.StatusInternalServerError, "unfollow_failed")
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}

	http.NotFound(w, req)
}

func (r *Router) handleMySchools(w http.ResponseWriter, req *http.Request) {
	if req.URL.Path != "/me/schools" {
		http.NotFound(w, req)
		return
	}
	if req.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	if r.follows == nil {
		writeError(w, http.StatusServiceUnavailable, "database_unavailable")
		return
	}
	userID, err := auth.RequireUser(req.Context())
	if err != nil {
		writeError(w, http.StatusUnauthorized, "authentication_required")
		return
	}
	if !looksLikeUUID(userID) {
		writeError(w, http.StatusBadRequest, "invalid_id")
		return
	}

	result, err := r.follows.ListFollowed(req.Context(), userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "followed_schools_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"schools": result})
}

func (r *Router) handleGames(w http.ResponseWriter, req *http.Request) {
	if r.games == nil {
		writeError(w, http.StatusServiceUnavailable, "database_unavailable")
		return
	}
	result, err := r.games.List(req.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "games_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"games": result})
}

func (r *Router) handleEvents(w http.ResponseWriter, req *http.Request) {
	if req.URL.Path != "/events" {
		http.NotFound(w, req)
		return
	}
	if req.Method == http.MethodPost {
		r.handleCreateEvent(w, req)
		return
	}
	if req.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet+", "+http.MethodPost)
		return
	}
	if r.events == nil {
		writeError(w, http.StatusServiceUnavailable, "database_unavailable")
		return
	}

	params := eventstore.ListParams{
		GameSlug:   req.URL.Query().Get("game"),
		SchoolSlug: req.URL.Query().Get("school"),
		Limit:      25,
		Offset:     0,
	}
	var err error
	if value := req.URL.Query().Get("limit"); value != "" {
		params.Limit, err = strconv.Atoi(value)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid_limit")
			return
		}
	}
	if value := req.URL.Query().Get("offset"); value != "" {
		params.Offset, err = strconv.Atoi(value)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid_offset")
			return
		}
	}
	params = eventstore.NormalizeListParams(params)
	result, err := r.events.ListPublic(req.Context(), params)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "events_unavailable")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"events": result,
		"limit":  params.Limit,
		"offset": params.Offset,
	})
}

func (r *Router) handleEventPath(w http.ResponseWriter, req *http.Request) {
	if r.events == nil {
		writeError(w, http.StatusServiceUnavailable, "database_unavailable")
		return
	}
	path := strings.TrimPrefix(req.URL.Path, "/events/")
	path = strings.TrimSuffix(path, "/")
	parts := strings.Split(path, "/")
	if len(parts) == 2 && parts[1] == "unlock" {
		if req.Method != http.MethodPost {
			methodNotAllowed(w, http.MethodPost)
			return
		}
		slug, err := url.PathUnescape(parts[0])
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid_event_slug")
			return
		}
		r.handleUnlockEvent(w, req, slug)
		return
	}
	if len(parts) != 1 || parts[0] == "" {
		http.NotFound(w, req)
		return
	}
	slug, err := url.PathUnescape(parts[0])
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_event_slug")
		return
	}
	if req.Method == http.MethodPatch {
		r.handleUpdateEvent(w, req, slug)
		return
	}
	if req.Method == http.MethodDelete {
		r.handleDeleteEvent(w, req, slug)
		return
	}
	if req.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet+", "+http.MethodPatch+", "+http.MethodDelete)
		return
	}
	event, err := r.events.GetBySlug(req.Context(), slug)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "event_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "event_unavailable")
		return
	}
	if event.IsPrivate() {
		if userID, ok := auth.UserID(req.Context()); ok && looksLikeUUID(userID) {
			organizer, err := r.events.IsOrganizer(req.Context(), slug, userID)
			if err != nil {
				writeError(w, http.StatusInternalServerError, "event_unavailable")
				return
			}
			if organizer {
				writeJSON(w, http.StatusOK, event)
				return
			}
		}
		if token := strings.TrimSpace(req.Header.Get("X-CGN-Event-Unlock")); token != "" {
			unlocked, err := r.events.IsPrivateUnlockValid(req.Context(), slug, auth.HashToken(token))
			if err != nil {
				writeError(w, http.StatusInternalServerError, "event_unavailable")
				return
			}
			if unlocked {
				writeJSON(w, http.StatusOK, event)
				return
			}
		}
		writeJSON(w, http.StatusOK, event.Locked())
		return
	}
	writeJSON(w, http.StatusOK, event)
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

func methodNotAllowed(w http.ResponseWriter, methods string) {
	w.Header().Set("Allow", methods)
	writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
}

func writeError(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, map[string]string{"error": code})
}

func looksLikeUUID(value string) bool {
	if len(value) != 36 {
		return false
	}
	for index, character := range value {
		if index == 8 || index == 13 || index == 18 || index == 23 {
			if character != '-' {
				return false
			}
			continue
		}
		if !((character >= '0' && character <= '9') || (character >= 'a' && character <= 'f') || (character >= 'A' && character <= 'F')) {
			return false
		}
	}
	return true
}
