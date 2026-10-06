// Package httpapi assembles the API's HTTP routes and handlers.
package httpapi

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"runtime/debug"
	"strconv"
	"strings"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminaccess"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminaudit"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminhttp"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminidentity"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminsecurity"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminsession"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/auth"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/config"
	eventstore "github.com/Campus-Gaming-Network/core/apps/api/internal/events"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/games"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/igdb"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/objectstore"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/operations"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/people"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/ratelimit"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/safety"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/schools"
	teamstore "github.com/Campus-Gaming-Network/core/apps/api/internal/teams"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/users"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// targetRateLimitMultiplier keeps a target's quota above any one visitor's, so
// a single visitor cannot lock an account or event out, while guessing spread
// across many visitors is still capped.
const targetRateLimitMultiplier = 4

// logoReconcileInterval bounds how long an abandoned or replaced logo object
// can remain stored after its row became eligible for deletion.
const logoReconcileInterval = 15 * time.Minute

type Router struct {
	cfg     config.Config
	mux     *http.ServeMux
	db      *pgxpool.Pool
	schools schools.Repository
	follows schools.FollowRepository
	games   games.Repository
	covers  gameCovers
	// picker is nil when the IGDB credentials are not configured.
	picker            gamePicker
	customGames       customGames
	gameSearchLimiter *ratelimit.Limiter
	events            eventstore.Repository
	teams             teamstore.Repository
	safety            safety.Repository
	users             users.Repository
	people            people.Repository
	account           *auth.AccountService
	limiter           *ratelimit.Limiter
	// targetLimiter counts attempts against one email address, token, or
	// private event across every visitor.
	targetLimiter *ratelimit.Limiter
	sessionStore  *auth.SessionRepository
	catalog       *schools.CachedRepository
}

// gameSearchRateLimit is how many IGDB searches one user may make a minute.
// Results are cached, so most of them never reach IGDB.
const gameSearchRateLimit = 30

// gameCovers reads stored game covers.
type gameCovers interface {
	Cover(ctx context.Context, slug, knownETag string) (games.Cover, error)
}

func NewRouter(cfg config.Config, pools ...*pgxpool.Pool) http.Handler {
	router := &Router{
		cfg: cfg,
		mux: http.NewServeMux(),
	}
	// gameImports is nil when the IGDB credentials are not configured.
	var gameImports *games.IGDBService
	if len(pools) > 0 {
		router.db = pools[0]
		schoolRepository := schools.NewPostgresRepository(router.db)
		userRepository := users.NewPostgresRepository(router.db)
		sessionRepository := auth.NewSessionRepository(router.db)
		// Reads come from the cached catalog; follows are per-user and stay on
		// Postgres. The refresh loop lives as long as the process, matching the
		// server it serves.
		catalog := schools.NewCachedRepository(schoolRepository, slog.Default())
		go catalog.Start(context.Background(), cfg.CatalogRefresh)
		router.catalog = catalog
		router.schools = catalog
		router.follows = schoolRepository
		gameRepository := games.NewPostgresRepository(router.db)
		router.games = gameRepository
		router.covers = gameRepository
		router.customGames = gameRepository
		router.gameSearchLimiter = ratelimit.New(gameSearchRateLimit, time.Minute)
		if cfg.IGDBConfigured() {
			gameImports = games.NewIGDBService(gameRepository, igdb.NewClient(igdb.Config{
				ClientID: cfg.IGDBClientID, ClientSecret: cfg.IGDBClientSecret,
				APIURL: cfg.IGDBAPIURL, TokenURL: cfg.IGDBTokenURL, ImageURL: cfg.IGDBImageURL,
			}))
			router.picker = gameImports
		}
		router.events = eventstore.NewPostgresRepository(router.db)
		router.teams = teamstore.NewPostgresRepository(router.db)
		router.people = people.NewPostgresRepository(router.db)
		router.safety = safety.NewPostgresRepository(router.db)
		router.users = userRepository
		router.account = auth.NewAccountService(
			userRepository,
			schoolRepository,
			sessionRepository,
			auth.NewTokenRepository(router.db),
			cfg.SessionTTL,
			cfg.VerificationTTL,
			cfg.ResetTTL,
		)
		router.limiter = ratelimit.New(cfg.AuthRateLimit, cfg.AuthRateWindow)
		router.targetLimiter = ratelimit.New(cfg.AuthRateLimit*targetRateLimitMultiplier, cfg.AuthRateWindow)
		router.sessionStore = sessionRepository
	}

	adminDependencies := adminhttp.Dependencies{}
	if router.db != nil && cfg.AdminEnabled {
		adminSessionRepository := adminsession.NewPostgresRepository(router.db)
		adminSessionService, sessionErr := adminsession.NewService(
			adminSessionRepository,
			cfg.AdminSessionIdleTTL,
			cfg.AdminSessionAbsoluteTTL,
		)
		adminTransactions, transactionErr := adminsession.NewPostgresSecurityTransactionRunner(
			router.db,
			cfg.AdminSessionIdleTTL,
			cfg.AdminSessionAbsoluteTTL,
		)
		identityValidator, identityErr := adminidentity.NewValidator(adminidentity.Config{
			Issuer: cfg.CloudflareAccessTeamDomain, Audience: cfg.CloudflareAccessAudience,
			JWKSURL: cfg.CloudflareAccessJWKSURL,
		}, nil)
		if sessionErr == nil && transactionErr == nil && identityErr == nil {
			var logos adminhttp.AdminLogos
			if cfg.LogoStorageConfigured() {
				logoRepository := schools.NewLogoRepository(router.db, objectstore.NewS3Store(objectstore.Config{
					Endpoint: cfg.R2Endpoint, AccountID: cfg.R2AccountID, Bucket: cfg.R2SchoolLogosBucket,
					AccessKeyID: cfg.R2AccessKeyID, SecretAccessKey: cfg.R2SecretAccessKey,
				}), cfg.R2PublicAssetOrigin, slog.Default())
				// Like the catalog refresh, reconciliation runs for the life of the process.
				go logoRepository.Start(context.Background(), logoReconcileInterval)
				logos = logoRepository
			}
			// A nil service must reach the interface as nil, not as a typed nil.
			var adminImports adminhttp.AdminIGDB
			if gameImports != nil {
				adminImports = gameImports
			}
			adminDependencies = adminhttp.Dependencies{
				Identities:   identityValidator,
				Users:        users.NewPostgresRepository(router.db),
				Grants:       adminaccess.NewPostgresRepository(router.db),
				Sessions:     adminSessionService,
				Security:     adminsecurity.NewPostgresStore(router.db),
				Transactions: adminTransactions,
				Operations:   operations.NewPostgresRepository(router.db),
				Catalog: &adminhttp.CatalogDependencies{
					Schools: schools.NewPostgresRepository(router.db), Games: games.NewPostgresRepository(router.db),
					Users: users.NewPostgresRepository(router.db), SiteGrants: adminaccess.NewPostgresRepository(router.db),
					Cache: router.catalog, Audit: adminaudit.NewPostgresStore(router.db), Logos: logos, IGDB: adminImports,
				},
			}
		}
	}

	router.mux.HandleFunc("/", requireMethod(http.MethodGet, router.handleRoot))
	router.mux.HandleFunc("/health", requireMethod(http.MethodGet, router.handleHealth))
	router.mux.HandleFunc("/ready", requireMethod(http.MethodGet, router.handleReady))
	router.mux.HandleFunc("/schools", router.handleSchools)
	router.mux.HandleFunc("/schools/", router.handleSchoolPath)
	router.mux.HandleFunc("/games", requireMethod(http.MethodGet, router.handleGames))
	router.mux.HandleFunc("/games/{slug}/cover", requireMethod(http.MethodGet, router.handleGameCover))
	router.mux.HandleFunc("/games/igdb-search", requireMethod(http.MethodGet, router.handleGameSearch))
	router.mux.HandleFunc("/internal/schools/refresh", requireMethod(http.MethodPost, router.handleRefreshCatalog))
	router.mux.HandleFunc("/events", router.handleEvents)
	router.mux.HandleFunc("/events/", router.handleEventPath)
	router.mux.HandleFunc("/teams", router.handleTeams)
	router.mux.HandleFunc("/teams/", router.handleTeamPath)
	router.mux.HandleFunc("/support-tickets", router.handleSupportTickets)
	router.mux.HandleFunc("/auth/signup", router.handleSignup)
	router.mux.HandleFunc("/auth/login", router.handleLogin)
	router.mux.HandleFunc("/auth/logout", router.handleLogout)
	router.mux.HandleFunc("/auth/verify-email", router.handleVerifyEmail)
	router.mux.HandleFunc("/auth/resend-verification", router.handleResendVerification)
	router.mux.HandleFunc("/auth/forgot-password", router.handleForgotPassword)
	router.mux.HandleFunc("/auth/reset-password", router.handleResetPassword)
	router.mux.HandleFunc("/me/events", router.handleMyEvents)
	router.mux.HandleFunc("/me/schools", router.handleMySchools)
	router.mux.HandleFunc("/me/teams", router.handleMyTeams)
	router.mux.HandleFunc("/me", router.handleMe)
	router.mux.HandleFunc("/users/", router.handleUserPath)
	router.mux.Handle("/admin/", adminhttp.NewHandler(adminhttp.Config{
		Enabled: cfg.AdminEnabled, SiteOrigin: cfg.AdminSiteURL,
		ProxySecret: cfg.AdminProxySharedSecret,
		Cookies: adminsession.CookieConfig{
			Name: cfg.AdminSessionCookie, CSRFName: cfg.AdminCSRFCookie,
			Secure: cfg.AdminCookieSecure,
		},
	}, adminDependencies))

	var handler http.Handler = router.mux
	if router.sessionStore != nil {
		publicSessionHandler := auth.WithSession(
			router.sessionStore,
			auth.SessionCookieConfig{
				Name:   cfg.SessionCookie,
				Secure: cfg.CookieSecure,
				TTL:    cfg.SessionTTL,
			},
		)(router.mux)
		handler = http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			if strings.HasPrefix(req.URL.Path, "/admin/") {
				router.mux.ServeHTTP(w, req)
				return
			}
			publicSessionHandler.ServeHTTP(w, req)
		})
	}

	return withRequestLogging(withPanicRecovery(handler))
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

	if req.URL.Query().Has("sort") {
		r.handlePopularSchools(w, req)
		return
	}

	params := schools.ListParams{
		Query:  req.URL.Query().Get("q"),
		State:  req.URL.Query().Get("state"),
		Offset: 0,
	}
	limit, err := parseListLimit(req.URL.Query())
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_limit")
		return
	}
	if value := req.URL.Query().Get("offset"); value != "" {
		params.Offset, err = strconv.Atoi(value)
		if err != nil || params.Offset < 0 {
			writeError(w, http.StatusBadRequest, "invalid_offset")
			return
		}
	}
	params.Limit = limit + 1
	params = schools.NormalizeListParams(params)
	result, err := r.schools.List(req.Context(), params)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "schools_unavailable")
		return
	}
	hasMore := len(result) > limit
	if hasMore {
		result = result[:limit]
	}

	setPublicCatalogCache(w)
	writeJSON(w, http.StatusOK, map[string]any{
		"schools":  result,
		"limit":    limit,
		"offset":   params.Offset,
		"has_more": hasMore,
	})
}

// handlePopularSchools answers GET /schools?sort=popular: the most active
// schools, which takes only a limit.
func (r *Router) handlePopularSchools(w http.ResponseWriter, req *http.Request) {
	values := req.URL.Query()
	if values.Get("sort") != "popular" || values.Has("q") || values.Has("state") || values.Has("offset") {
		writeError(w, http.StatusBadRequest, "invalid_sort")
		return
	}
	limit := 6
	if values.Has("limit") {
		parsed, err := strconv.Atoi(values.Get("limit"))
		if err != nil || parsed < 1 || parsed > schools.MaximumPopularLimit {
			writeError(w, http.StatusBadRequest, "invalid_limit")
			return
		}
		limit = parsed
	}
	popular, ok := r.schools.(schools.PopularRepository)
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "database_unavailable")
		return
	}
	ranked, err := popular.ListPopular(req.Context(), limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "schools_unavailable")
		return
	}

	// The ranking moves with activity, so it is cached for minutes, not days.
	w.Header().Set("Cache-Control", "public, max-age=300")
	writeJSON(w, http.StatusOK, map[string]any{
		"schools":  ranked,
		"limit":    limit,
		"offset":   0,
		"has_more": false,
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
		// The cached catalog reports a miss as ErrSchoolNotFound while the
		// Postgres repository surfaces pgx.ErrNoRows; both mean 404 here.
		if errors.Is(err, pgx.ErrNoRows) || errors.Is(err, schools.ErrSchoolNotFound) {
			writeError(w, http.StatusNotFound, "school_not_found")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "school_unavailable")
			return
		}
		setPublicCatalogCache(w)
		writeJSON(w, http.StatusOK, school)
		return
	}

	if len(parts) == 2 && parts[1] == "members" {
		slug, err := url.PathUnescape(parts[0])
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid_school_slug")
			return
		}
		r.handleSchoolMembers(w, req, slug)
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
	// A stored cover is served by the site, through the web app's cover route.
	for index, game := range result {
		if game.HasCover {
			result[index].CoverURL = strings.TrimSuffix(r.cfg.SiteURL, "/") + "/api/games/" + url.PathEscape(game.Slug) + "/cover"
		}
	}
	setPublicCatalogCache(w)
	writeJSON(w, http.StatusOK, map[string]any{"games": result})
}

// gameCoverCacheControl lets browsers and shared caches hold a cover for a
// day. A refreshed cover is picked up when the ETag is revalidated.
const gameCoverCacheControl = "public, max-age=86400"

// handleGameCover serves the stored cover of an active game. A hidden or
// deleted game answers 404, like a game with no cover.
func (r *Router) handleGameCover(w http.ResponseWriter, req *http.Request) {
	if r.covers == nil {
		writeError(w, http.StatusServiceUnavailable, "database_unavailable")
		return
	}
	cover, err := r.covers.Cover(req.Context(), req.PathValue("slug"), strings.Trim(req.Header.Get("If-None-Match"), `"`))
	if errors.Is(err, games.ErrCoverNotFound) {
		writeError(w, http.StatusNotFound, "game_cover_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "game_cover_unavailable")
		return
	}
	w.Header().Set("Cache-Control", gameCoverCacheControl)
	w.Header().Set("ETag", `"`+cover.ETag+`"`)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if cover.Bytes == nil {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("Content-Type", cover.ContentType)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(cover.Bytes)
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

	limit, err := parseListLimit(req.URL.Query())
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_limit")
		return
	}
	after, before, err := parseListCursors(req.URL.Query())
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_cursor")
		return
	}
	params := eventstore.ListParams{
		GameSlug:   req.URL.Query().Get("game"),
		SchoolSlug: req.URL.Query().Get("school"),
		Format:     req.URL.Query().Get("format"),
		Limit:      limit + 1,
		After:      after,
		Before:     before,
	}
	params = eventstore.NormalizeListParams(params)
	result, err := r.events.ListPublic(req.Context(), params)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "events_unavailable")
		return
	}
	page := makeCursorPage(result, limit, after, before, func(event eventstore.Event) (time.Time, string) {
		return event.StartsAt, event.ID
	})

	payload := map[string]any{
		"events":       page.Items,
		"limit":        limit,
		"has_more":     page.HasMore,
		"has_previous": page.HasPrevious,
	}
	if page.NextCursor != "" {
		payload["next_cursor"] = page.NextCursor
	}
	if page.PreviousCursor != "" {
		payload["previous_cursor"] = page.PreviousCursor
	}
	writeJSON(w, http.StatusOK, payload)
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
	if len(parts) == 2 && parts[1] == "rsvp" {
		if req.Method != http.MethodPost {
			methodNotAllowed(w, http.MethodPost)
			return
		}
		slug, err := url.PathUnescape(parts[0])
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid_event_slug")
			return
		}
		r.handleRSVPEvent(w, req, slug)
		return
	}
	if len(parts) == 2 && parts[1] == "interest" {
		if req.Method != http.MethodPost && req.Method != http.MethodDelete {
			methodNotAllowed(w, http.MethodPost+", "+http.MethodDelete)
			return
		}
		slug, err := url.PathUnescape(parts[0])
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid_event_slug")
			return
		}
		r.handleEventInterest(w, req, slug)
		return
	}
	if len(parts) == 2 && parts[1] == "report" {
		if req.Method != http.MethodPost {
			methodNotAllowed(w, http.MethodPost)
			return
		}
		slug, err := url.PathUnescape(parts[0])
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid_event_slug")
			return
		}
		r.handleReportEvent(w, req, slug)
		return
	}
	if len(parts) == 2 && parts[1] == "attendees" {
		slug, err := url.PathUnescape(parts[0])
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid_event_slug")
			return
		}
		r.handleEventAttendees(w, req, slug)
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
		allowed, err := r.canAccessPrivateEvent(req, slug)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "event_unavailable")
			return
		}
		if allowed {
			if err := r.decorateEventForViewer(req, slug, &event); err != nil {
				writeError(w, http.StatusInternalServerError, "event_unavailable")
				return
			}
			writeJSON(w, http.StatusOK, event)
			return
		}
		writeJSON(w, http.StatusOK, event.Locked())
		return
	}
	if err := r.decorateEventForViewer(req, slug, &event); err != nil {
		writeError(w, http.StatusInternalServerError, "event_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, event)
}

func (r *Router) canAccessPrivateEvent(req *http.Request, slug string) (bool, error) {
	if userID, ok := auth.UserID(req.Context()); ok && looksLikeUUID(userID) {
		organizer, err := r.events.IsOrganizer(req.Context(), slug, userID)
		if err != nil {
			return false, err
		}
		if organizer {
			return true, nil
		}
	}
	if token := strings.TrimSpace(req.Header.Get("X-CGN-Event-Unlock")); token != "" {
		return r.events.IsPrivateUnlockValid(req.Context(), slug, auth.HashToken(token))
	}
	return false, nil
}

func (r *Router) decorateEventForViewer(req *http.Request, slug string, event *eventstore.Event) error {
	userID, ok := auth.UserID(req.Context())
	if !ok || !looksLikeUUID(userID) {
		return nil
	}
	response, err := r.events.GetRSVP(req.Context(), slug, userID)
	if err != nil {
		return err
	}
	if response != "" {
		event.ViewerRSVP = &response
	}
	interested, err := r.events.IsInterested(req.Context(), slug, userID)
	if err != nil {
		return err
	}
	event.ViewerInterested = interested
	organizer, err := r.events.IsOrganizer(req.Context(), slug, userID)
	if err != nil {
		return err
	}
	event.ViewerCanEdit = organizer
	return nil
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)

	if err := json.NewEncoder(w).Encode(payload); err != nil {
		slog.Error("write json response", "error", err)
	}
}

// maximumLoggedPathRunes bounds an unmatched request path in the access log so
// a hostile client cannot write arbitrarily long values into it.
const maximumLoggedPathRunes = 200

// statusRecorder remembers the status a handler wrote for the access log.
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (recorder *statusRecorder) WriteHeader(status int) {
	if recorder.status == 0 {
		recorder.status = status
	}
	recorder.ResponseWriter.WriteHeader(status)
}

func (recorder *statusRecorder) Write(body []byte) (int, error) {
	if recorder.status == 0 {
		recorder.status = http.StatusOK
	}
	return recorder.ResponseWriter.Write(body)
}

// Unwrap lets http.ResponseController reach the underlying writer.
func (recorder *statusRecorder) Unwrap() http.ResponseWriter { return recorder.ResponseWriter }

// withRequestLogging writes one structured line per request: method, the
// Admin API route template (or a bounded raw path elsewhere), status, request
// id, verified actor, and duration. It never logs headers, cookies, query
// strings, or bodies. An Admin API request that fails with a 5xx is logged at
// error level with a stable error class for alerting.
func withRequestLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		start := time.Now()
		info := &adminhttp.RequestInfo{}
		req = req.WithContext(adminhttp.ContextWithRequestInfo(req.Context(), info))
		recorder := &statusRecorder{ResponseWriter: w}
		next.ServeHTTP(recorder, req)

		status := recorder.status
		if status == 0 {
			status = http.StatusOK
		}
		path := info.Route
		if path == "" {
			path = req.URL.Path
			if runes := []rune(path); len(runes) > maximumLoggedPathRunes {
				path = string(runes[:maximumLoggedPathRunes])
			}
		}
		attributes := []any{
			"method", req.Method,
			"path", path,
			"status", status,
			"request_id", w.Header().Get(adminhttp.RequestIDHeader),
			"duration_ms", time.Since(start).Milliseconds(),
		}
		if info.ActorID != "" {
			attributes = append(attributes, "actor_id", info.ActorID)
		}
		if info.Route != "" && status >= http.StatusInternalServerError {
			errorClass := info.ErrorClass
			if errorClass == "" {
				errorClass = adminhttp.ErrorClassInternal
			}
			slog.Error("admin request failed", append(attributes, "error_class", errorClass)...)
			return
		}
		slog.Info("request", attributes...)
	})
}

// withPanicRecovery turns a panicking handler into a JSON 500.
//
// net/http already recovers handler panics so the process survives, but it
// abruptly closes the connection without a response and reports the panic to
// the server's default logger rather than slog. That leaves the BFF seeing a
// transport failure instead of an API error, and the panic outside the
// structured logs.
func withPanicRecovery(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		defer func() {
			recovered := recover()
			if recovered == nil {
				return
			}
			// http.ErrAbortHandler is the documented way to abort a response on
			// purpose; passing it along preserves that behavior.
			if err, ok := recovered.(error); ok && errors.Is(err, http.ErrAbortHandler) {
				panic(recovered)
			}

			slog.Error("panic recovered",
				"panic", fmt.Sprint(recovered),
				"method", req.Method,
				"path", req.URL.Path,
				"stack", string(debug.Stack()),
			)
			writeError(w, http.StatusInternalServerError, "internal_error")
		}()

		next.ServeHTTP(w, req)
	})
}

// catalogCacheControl marks the school and game catalogs as publicly cacheable.
//
// Both change on the order of once or twice a year and carry no viewer-specific
// fields, so every layer in front of the API — the BFF data cache, Cloudflare,
// and the browser — can hold them. stale-while-revalidate means a refresh never
// makes a user wait on a revalidation.
const catalogCacheControl = "public, max-age=300, stale-while-revalidate=86400"

// setPublicCatalogCache must only be used on responses that do not vary by
// viewer. Anything reading the session, such as followed schools, must stay
// uncached.
func setPublicCatalogCache(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", catalogCacheControl)
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

// idempotencyKey reads the required Idempotency-Key header of a create request.
// A repeated key returns the record the first request created instead of
// inserting another. It writes a 400 response when the key is missing or is
// not a UUID.
func idempotencyKey(w http.ResponseWriter, req *http.Request) (string, bool) {
	key := strings.TrimSpace(req.Header.Get("Idempotency-Key"))
	if !looksLikeUUID(key) {
		writeError(w, http.StatusBadRequest, "invalid_idempotency_key")
		return "", false
	}
	return key, true
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

// handleRefreshCatalog reloads the cached school catalog immediately, so a
// direct database change does not have to wait out the refresh interval.
// Admin Console school commands refresh the catalog themselves; this endpoint
// is for operators.
//
// Guarded by a shared secret rather than an admin session so it works without
// the Admin Console. The endpoint stays disabled unless API_MAINTENANCE_TOKEN
// is set.
func (r *Router) handleRefreshCatalog(w http.ResponseWriter, req *http.Request) {
	if r.catalog == nil || r.cfg.MaintenanceToken == "" {
		http.NotFound(w, req)
		return
	}

	provided := strings.TrimPrefix(req.Header.Get("Authorization"), "Bearer ")
	if subtle.ConstantTimeCompare([]byte(provided), []byte(r.cfg.MaintenanceToken)) != 1 {
		writeError(w, http.StatusUnauthorized, "authentication_required")
		return
	}

	if err := r.catalog.Refresh(req.Context()); err != nil {
		slog.Error("catalog refresh failed", "error", err)
		writeError(w, http.StatusInternalServerError, "catalog_refresh_failed")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "refreshed"})
}
