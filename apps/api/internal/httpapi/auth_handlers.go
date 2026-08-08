package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/mail"
	"strconv"
	"strings"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/auth"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/users"
	"github.com/jackc/pgx/v5"
)

type signupRequest struct {
	Email        string `json:"email"`
	Password     string `json:"password"`
	Name         string `json:"name"`
	HomeSchoolID string `json:"home_school_id"`
	AgeConfirmed bool   `json:"age_confirmed"`
	Timezone     string `json:"timezone"`
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type emailRequest struct {
	Email string `json:"email"`
}

type tokenRequest struct {
	Token string `json:"token"`
}

type resetPasswordRequest struct {
	Token    string `json:"token"`
	Password string `json:"password"`
}

type profileUpdateRequest struct {
	Name        *string             `json:"name"`
	Bio         *string             `json:"bio"`
	Timezone    *string             `json:"timezone"`
	SocialLinks *[]users.SocialLink `json:"social_links"`
}

func (r *Router) handleSignup(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	if r.account == nil {
		writeError(w, http.StatusServiceUnavailable, "database_unavailable")
		return
	}
	if !r.allow("signup", req) {
		rateLimitExceeded(w, r)
		return
	}

	var input signupRequest
	if !decodeJSON(w, req, &input) {
		return
	}
	normalizedEmail := users.NormalizeEmail(input.Email)
	if validEmail(normalizedEmail) && !r.allow("signup-email:"+normalizedEmail, req) {
		rateLimitExceeded(w, r)
		return
	}
	profile, err := r.account.Signup(req.Context(), users.SignupInput{
		Email:        input.Email,
		Password:     input.Password,
		Name:         input.Name,
		HomeSchoolID: input.HomeSchoolID,
		AgeConfirmed: input.AgeConfirmed,
		Timezone:     input.Timezone,
	})
	if err != nil {
		switch {
		case users.IsDuplicateEmail(err):
			writeError(w, http.StatusConflict, "email_already_registered")
		case errors.Is(err, auth.ErrHomeSchoolNotFound):
			writeError(w, http.StatusUnprocessableEntity, "home_school_not_found")
		case isValidationError(err):
			writeError(w, http.StatusBadRequest, "invalid_request")
		default:
			writeError(w, http.StatusInternalServerError, "signup_failed")
		}
		return
	}
	writeJSON(w, http.StatusCreated, profile)
}

func (r *Router) handleLogin(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	if r.account == nil {
		writeError(w, http.StatusServiceUnavailable, "database_unavailable")
		return
	}
	if !r.allow("login", req) {
		rateLimitExceeded(w, r)
		return
	}

	var input loginRequest
	if !decodeJSON(w, req, &input) {
		return
	}
	result, err := r.account.Login(req.Context(), input.Email, input.Password)
	if err != nil {
		switch {
		case errors.Is(err, auth.ErrEmailUnverified):
			writeError(w, http.StatusForbidden, "email_not_verified")
		case errors.Is(err, auth.ErrInvalidCredentials):
			writeError(w, http.StatusUnauthorized, "invalid_credentials")
		default:
			writeError(w, http.StatusInternalServerError, "login_failed")
		}
		return
	}
	r.setSessionCookie(w, result.Token, result.ExpiresAt)
	writeJSON(w, http.StatusOK, result.Profile)
}

func (r *Router) handleLogout(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	if r.account == nil {
		writeError(w, http.StatusServiceUnavailable, "database_unavailable")
		return
	}
	cookie, _ := req.Cookie(r.cfg.SessionCookie)
	var rawToken string
	if cookie != nil {
		rawToken = cookie.Value
	}
	err := r.account.Logout(req.Context(), rawToken)
	r.clearSessionCookie(w)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "logout_failed")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (r *Router) handleVerifyEmail(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodGet && req.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodGet+", "+http.MethodPost)
		return
	}
	if r.account == nil {
		writeError(w, http.StatusServiceUnavailable, "database_unavailable")
		return
	}
	token := strings.TrimSpace(req.URL.Query().Get("token"))
	if req.Method == http.MethodPost {
		var input tokenRequest
		if !decodeJSON(w, req, &input) {
			return
		}
		token = strings.TrimSpace(input.Token)
	}
	if err := r.account.VerifyEmail(req.Context(), token); err != nil {
		if errors.Is(err, auth.ErrInvalidToken) {
			writeError(w, http.StatusBadRequest, "invalid_or_expired_token")
			return
		}
		writeError(w, http.StatusInternalServerError, "verification_failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "verified"})
}

func (r *Router) handleResendVerification(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	if r.account == nil {
		writeError(w, http.StatusServiceUnavailable, "database_unavailable")
		return
	}
	var input emailRequest
	if !decodeJSON(w, req, &input) {
		return
	}
	if !validEmail(input.Email) {
		writeError(w, http.StatusBadRequest, "invalid_request")
		return
	}
	if !r.allow("resend-verification:"+users.NormalizeEmail(input.Email), req) {
		rateLimitExceeded(w, r)
		return
	}
	if err := r.account.ResendVerification(req.Context(), input.Email); err != nil {
		writeError(w, http.StatusInternalServerError, "resend_failed")
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "if_account_exists_email_sent"})
}

func (r *Router) handleForgotPassword(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	if r.account == nil {
		writeError(w, http.StatusServiceUnavailable, "database_unavailable")
		return
	}
	var input emailRequest
	if !decodeJSON(w, req, &input) {
		return
	}
	if !validEmail(input.Email) {
		writeError(w, http.StatusBadRequest, "invalid_request")
		return
	}
	if !r.allow("forgot-password:"+users.NormalizeEmail(input.Email), req) {
		rateLimitExceeded(w, r)
		return
	}
	if err := r.account.RequestPasswordReset(req.Context(), input.Email); err != nil {
		writeError(w, http.StatusInternalServerError, "password_reset_request_failed")
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "if_account_exists_email_sent"})
}

func (r *Router) handleResetPassword(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	if r.account == nil {
		writeError(w, http.StatusServiceUnavailable, "database_unavailable")
		return
	}
	if !r.allow("reset-password", req) {
		rateLimitExceeded(w, r)
		return
	}
	var input resetPasswordRequest
	if !decodeJSON(w, req, &input) {
		return
	}
	if err := r.account.ResetPassword(req.Context(), strings.TrimSpace(input.Token), input.Password); err != nil {
		if errors.Is(err, auth.ErrInvalidToken) {
			writeError(w, http.StatusBadRequest, "invalid_or_expired_token")
			return
		}
		if isValidationError(err) {
			writeError(w, http.StatusBadRequest, "invalid_request")
			return
		}
		writeError(w, http.StatusInternalServerError, "password_reset_failed")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (r *Router) handleMe(w http.ResponseWriter, req *http.Request) {
	if req.URL.Path != "/me" {
		http.NotFound(w, req)
		return
	}
	if req.Method != http.MethodGet && req.Method != http.MethodPatch && req.Method != http.MethodDelete {
		methodNotAllowed(w, http.MethodGet+", "+http.MethodPatch+", "+http.MethodDelete)
		return
	}
	if r.account == nil {
		writeError(w, http.StatusServiceUnavailable, "database_unavailable")
		return
	}
	userID, err := auth.RequireUser(req.Context())
	if err != nil {
		writeError(w, http.StatusUnauthorized, "authentication_required")
		return
	}
	if req.Method == http.MethodDelete {
		if err := r.account.DeleteAccount(req.Context(), userID); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				writeError(w, http.StatusNotFound, "account_not_found")
				return
			}
			writeError(w, http.StatusInternalServerError, "account_delete_failed")
			return
		}
		// Deletion revokes every session, so drop this one's cookie too.
		auth.ClearSessionCookie(w, auth.SessionCookieConfig{
			Name:   r.cfg.SessionCookie,
			Secure: r.cfg.CookieSecure,
			TTL:    r.cfg.SessionTTL,
		})
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if req.Method == http.MethodGet {
		profile, err := r.account.GetProfile(req.Context(), userID)
		if err != nil {
			writeProfileError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, profile)
		return
	}

	var input profileUpdateRequest
	if !decodeJSON(w, req, &input) {
		return
	}
	current, err := r.account.GetProfile(req.Context(), userID)
	if err != nil {
		writeProfileError(w, err)
		return
	}
	update := users.ProfileUpdate{Name: current.Name, Bio: current.Bio, Timezone: current.Timezone}
	if input.Name != nil {
		update.Name = *input.Name
	}
	if input.Bio != nil {
		update.Bio = *input.Bio
	}
	if input.Timezone != nil {
		update.Timezone = *input.Timezone
	}
	links := current.SocialLinks
	if input.SocialLinks != nil {
		links = *input.SocialLinks
	}
	profile, err := r.account.UpdateProfile(req.Context(), userID, update, links)
	if err != nil {
		if isValidationError(err) {
			writeError(w, http.StatusBadRequest, "invalid_request")
			return
		}
		writeError(w, http.StatusInternalServerError, "profile_update_failed")
		return
	}
	writeJSON(w, http.StatusOK, profile)
}

func (r *Router) handleUserPath(w http.ResponseWriter, req *http.Request) {
	path := strings.Trim(strings.TrimPrefix(req.URL.Path, "/users/"), "/")
	parts := strings.Split(path, "/")
	if len(parts) == 2 && parts[1] == "report" {
		if req.Method != http.MethodPost {
			methodNotAllowed(w, http.MethodPost)
			return
		}
		if !looksLikeUUID(parts[0]) {
			writeError(w, http.StatusBadRequest, "invalid_id")
			return
		}
		r.handleReportUser(w, req, parts[0])
		return
	}
	if r.account == nil {
		writeError(w, http.StatusServiceUnavailable, "database_unavailable")
		return
	}
	if len(parts) != 1 || parts[0] == "" {
		http.NotFound(w, req)
		return
	}
	if req.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	id := parts[0]
	if !looksLikeUUID(id) {
		writeError(w, http.StatusBadRequest, "invalid_id")
		return
	}
	profile, err := r.account.GetPublicProfile(req.Context(), id)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "user_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "profile_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, profile)
}

func (r *Router) allow(action string, req *http.Request) bool {
	if r.limiter == nil {
		return true
	}
	return r.limiter.Allow(action + ":" + clientKey(req))
}

func (r *Router) setSessionCookie(w http.ResponseWriter, token string, expiresAt time.Time) {
	auth.SetSessionCookie(w, auth.SessionCookieConfig{
		Name:   r.cfg.SessionCookie,
		Secure: r.cfg.CookieSecure,
		TTL:    r.cfg.SessionTTL,
	}, token, expiresAt)
}

func (r *Router) clearSessionCookie(w http.ResponseWriter) {
	auth.ClearSessionCookie(w, auth.SessionCookieConfig{
		Name:   r.cfg.SessionCookie,
		Secure: r.cfg.CookieSecure,
		TTL:    r.cfg.SessionTTL,
	})
}

func decodeJSON(w http.ResponseWriter, req *http.Request, destination any) bool {
	decoder := json.NewDecoder(http.MaxBytesReader(w, req.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return false
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		writeError(w, http.StatusBadRequest, "invalid_json")
		return false
	}
	return true
}

func validEmail(email string) bool {
	_, err := mail.ParseAddress(users.NormalizeEmail(email))
	return err == nil
}

func clientKey(req *http.Request) string {
	host, _, err := net.SplitHostPort(req.RemoteAddr)
	if err == nil && host != "" {
		return host
	}
	if req.RemoteAddr == "" {
		return "unknown"
	}
	return req.RemoteAddr
}

func rateLimitExceeded(w http.ResponseWriter, r *Router) {
	seconds := int(r.cfg.AuthRateWindow.Seconds())
	if seconds < 1 {
		seconds = 1
	}
	w.Header().Set("Retry-After", strconv.Itoa(seconds))
	writeError(w, http.StatusTooManyRequests, "rate_limited")
}

func writeProfileError(w http.ResponseWriter, err error) {
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "user_not_found")
		return
	}
	writeError(w, http.StatusInternalServerError, "profile_unavailable")
}

func isValidationError(err error) bool {
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "required") ||
		strings.Contains(message, "must be") ||
		strings.Contains(message, "valid") ||
		strings.Contains(message, "allowed")
}
