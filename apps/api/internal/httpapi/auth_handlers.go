package httpapi

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/mail"
	"strconv"
	"strings"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/apperror"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/auth"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/games"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/policies"
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
	// The person agrees to the Terms and acknowledges the Privacy Policy, each
	// at the exact version they were shown.
	TermsAgreed         bool   `json:"terms_agreed"`
	TermsVersion        string `json:"terms_version"`
	PrivacyAcknowledged bool   `json:"privacy_acknowledged"`
	PrivacyVersion      string `json:"privacy_version"`
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

type changePasswordRequest struct {
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
}

type changeEmailRequest struct {
	CurrentPassword string `json:"current_password"`
	NewEmail        string `json:"new_email"`
}

type profileUpdateRequest struct {
	Name        *string             `json:"name"`
	Bio         *string             `json:"bio"`
	Timezone    *string             `json:"timezone"`
	SocialLinks *[]users.SocialLink `json:"social_links"`
	ShowInLists *bool               `json:"show_in_lists"`
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
	if !r.allowVisitor("signup", req) {
		rateLimitExceeded(w, r)
		return
	}

	var input signupRequest
	if !decodeJSON(w, req, &input) {
		return
	}
	normalizedEmail := users.NormalizeEmail(input.Email)
	if validEmail(normalizedEmail) && !r.allowTarget("signup-email:"+normalizedEmail) {
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
		Policies: policies.Claim{
			TermsAgreed:         input.TermsAgreed,
			TermsVersion:        input.TermsVersion,
			PrivacyAcknowledged: input.PrivacyAcknowledged,
			PrivacyVersion:      input.PrivacyVersion,
		},
	})
	if err != nil {
		if users.IsDuplicateEmail(err) {
			err = apperror.Wrap(apperror.KindConflict, "email_already_registered", err)
		}
		writeApplicationError(w, err, "signup_failed")
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
	if !r.allowVisitor("login", req) {
		rateLimitExceeded(w, r)
		return
	}

	var input loginRequest
	if !decodeJSON(w, req, &input) {
		return
	}
	if normalizedEmail := users.NormalizeEmail(input.Email); validEmail(normalizedEmail) &&
		!r.allowTarget("login-email:"+normalizedEmail) {
		rateLimitExceeded(w, r)
		return
	}
	result, err := r.account.Login(req.Context(), input.Email, input.Password)
	if err != nil {
		writeApplicationError(w, err, "login_failed")
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
	if req.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	if r.account == nil {
		writeError(w, http.StatusServiceUnavailable, "database_unavailable")
		return
	}
	var input tokenRequest
	if !decodeJSON(w, req, &input) {
		return
	}
	if err := r.account.VerifyEmail(req.Context(), strings.TrimSpace(input.Token)); err != nil {
		writeApplicationError(w, err, "verification_failed")
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
	if !r.allowVisitor("resend-verification", req) {
		rateLimitExceeded(w, r)
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
	if !r.allowTarget("resend-verification-email:" + users.NormalizeEmail(input.Email)) {
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
	if !r.allowVisitor("forgot-password", req) {
		rateLimitExceeded(w, r)
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
	if !r.allowTarget("forgot-password-email:" + users.NormalizeEmail(input.Email)) {
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
	if !r.allowVisitor("reset-password", req) {
		rateLimitExceeded(w, r)
		return
	}
	var input resetPasswordRequest
	if !decodeJSON(w, req, &input) {
		return
	}
	if !r.allowTarget("reset-password-token:" + opaqueRateLimitTarget(input.Token)) {
		rateLimitExceeded(w, r)
		return
	}
	if err := r.account.ResetPassword(req.Context(), strings.TrimSpace(input.Token), input.Password); err != nil {
		writeApplicationError(w, err, "password_reset_failed")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleChangePassword replaces a signed-in person's password. The session
// that makes the change stays signed in; every other session ends.
func (r *Router) handleChangePassword(w http.ResponseWriter, req *http.Request) {
	if r.account == nil {
		writeError(w, http.StatusServiceUnavailable, "database_unavailable")
		return
	}
	userID, err := auth.RequireUser(req.Context())
	if err != nil {
		writeError(w, http.StatusUnauthorized, "authentication_required")
		return
	}
	if !r.allowAccount("change-password", userID) {
		rateLimitExceeded(w, r)
		return
	}
	var input changePasswordRequest
	if !decodeJSON(w, req, &input) {
		return
	}
	cookie, err := req.Cookie(r.cfg.SessionCookie)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "authentication_required")
		return
	}
	if err := r.account.ChangePassword(req.Context(), userID, cookie.Value, input.CurrentPassword, input.NewPassword); err != nil {
		writeApplicationError(w, err, "password_change_failed")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleChangeEmail sends a confirmation link to the new address. It answers
// the same whether or not another account uses that address.
func (r *Router) handleChangeEmail(w http.ResponseWriter, req *http.Request) {
	if r.account == nil {
		writeError(w, http.StatusServiceUnavailable, "database_unavailable")
		return
	}
	userID, err := auth.RequireUser(req.Context())
	if err != nil {
		writeError(w, http.StatusUnauthorized, "authentication_required")
		return
	}
	if !r.allowAccount("change-email", userID) {
		rateLimitExceeded(w, r)
		return
	}
	var input changeEmailRequest
	if !decodeJSON(w, req, &input) {
		return
	}
	if !validEmail(input.NewEmail) {
		writeError(w, http.StatusBadRequest, "invalid_request")
		return
	}
	if err := r.account.RequestEmailChange(req.Context(), userID, input.CurrentPassword, input.NewEmail); err != nil {
		writeApplicationError(w, err, "email_change_failed")
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "confirmation_sent_if_available"})
}

// handleConfirmEmailChange applies an email change from the link sent to the
// new address. It needs no session: the link may open in another browser.
func (r *Router) handleConfirmEmailChange(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	if r.account == nil {
		writeError(w, http.StatusServiceUnavailable, "database_unavailable")
		return
	}
	if !r.allowVisitor("confirm-email-change", req) {
		rateLimitExceeded(w, r)
		return
	}
	var input tokenRequest
	if !decodeJSON(w, req, &input) {
		return
	}
	if !r.allowTarget("confirm-email-change-token:" + opaqueRateLimitTarget(input.Token)) {
		rateLimitExceeded(w, r)
		return
	}
	if err := r.account.ConfirmEmailChange(req.Context(), strings.TrimSpace(input.Token)); err != nil {
		writeApplicationError(w, err, "email_change_failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "email_changed"})
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
				err = apperror.Wrap(apperror.KindNotFound, "account_not_found", err)
			}
			writeApplicationError(w, err, "account_delete_failed")
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
	update := users.ProfileUpdate{
		Name:        current.Name,
		Bio:         current.Bio,
		Timezone:    current.Timezone,
		ShowInLists: current.ShowInLists,
	}
	if input.Name != nil {
		update.Name = *input.Name
	}
	if input.Bio != nil {
		update.Bio = *input.Bio
	}
	if input.Timezone != nil {
		update.Timezone = *input.Timezone
	}
	if input.ShowInLists != nil {
		update.ShowInLists = *input.ShowInLists
	}
	links := current.SocialLinks
	if input.SocialLinks != nil {
		links = *input.SocialLinks
	}
	profile, err := r.account.UpdateProfile(req.Context(), userID, update, links)
	if err != nil {
		writeApplicationError(w, err, "profile_update_failed")
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
		if !users.IsPublicID(parts[0]) {
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
	publicID := parts[0]
	if !users.IsPublicID(publicID) {
		writeError(w, http.StatusBadRequest, "invalid_id")
		return
	}
	profile, err := r.account.GetPublicProfile(req.Context(), publicID)
	if errors.Is(err, pgx.ErrNoRows) {
		err = apperror.Wrap(apperror.KindNotFound, "user_not_found", err)
	}
	if err != nil {
		writeApplicationError(w, err, "profile_unavailable")
		return
	}
	// The lists follow the profile's own visibility: whoever can see the
	// profile sees them.
	response := publicProfileResponse{PublicProfile: profile}
	if r.userGames != nil {
		if response.Games, err = r.userLists(req.Context(), profile.ID); err != nil {
			writeError(w, http.StatusInternalServerError, "profile_unavailable")
			return
		}
	}
	writeJSON(w, http.StatusOK, response)
}

// publicProfileResponse is a public profile with the games its owner lists.
type publicProfileResponse struct {
	users.PublicProfile
	Games games.UserLists `json:"games"`
}

func (r *Router) allowVisitor(action string, req *http.Request) bool {
	if r.limiter == nil {
		return true
	}
	return r.limiter.Allow(action + ":visitor:" + clientKey(req, r.cfg.ProxySharedSecret))
}

// allowTarget caps attempts against one email address, token, or private event
// across every visitor. Callers check the visitor's own quota first.
func (r *Router) allowTarget(action string) bool {
	if r.targetLimiter == nil {
		return true
	}
	return r.targetLimiter.Allow(action)
}

func (r *Router) allowAccount(action, userID string) bool {
	if r.limiter == nil {
		return true
	}
	return r.limiter.Allow(action + ":account:" + userID)
}

func opaqueRateLimitTarget(value string) string {
	digest := sha256.Sum256([]byte(strings.TrimSpace(value)))
	return hex.EncodeToString(digest[:16])
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

// writeDecodeError answers 413 when the body exceeded the size limit and 400
// for any other malformed JSON.
func writeDecodeError(w http.ResponseWriter, err error) {
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		writeError(w, http.StatusRequestEntityTooLarge, "request_too_large")
		return
	}
	writeError(w, http.StatusBadRequest, "invalid_json")
}

func decodeJSON(w http.ResponseWriter, req *http.Request, destination any) bool {
	decoder := json.NewDecoder(http.MaxBytesReader(w, req.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		writeDecodeError(w, err)
		return false
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		writeDecodeError(w, err)
		return false
	}
	return true
}

func validEmail(email string) bool {
	_, err := mail.ParseAddress(users.NormalizeEmail(email))
	return err == nil
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
		err = apperror.Wrap(apperror.KindNotFound, "user_not_found", err)
	}
	writeApplicationError(w, err, "profile_unavailable")
}

// handleCurrentPolicies returns the Terms and Privacy versions in effect, so a
// signup form can show and name the exact versions a person accepts.
func (r *Router) handleCurrentPolicies(w http.ResponseWriter, req *http.Request) {
	if r.policies == nil {
		writeError(w, http.StatusServiceUnavailable, "database_unavailable")
		return
	}
	current, err := r.policies.Current(req.Context(), time.Now())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "policies_unavailable")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, current)
}

// handleMyPolicyAcceptances lists the versions the signed-in user accepted.
func (r *Router) handleMyPolicyAcceptances(w http.ResponseWriter, req *http.Request) {
	if r.policies == nil {
		writeError(w, http.StatusServiceUnavailable, "database_unavailable")
		return
	}
	userID, err := auth.RequireUser(req.Context())
	if err != nil {
		writeError(w, http.StatusUnauthorized, "authentication_required")
		return
	}
	acceptances, err := r.policies.ListAcceptances(req.Context(), userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "policy_acceptances_unavailable")
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	writeJSON(w, http.StatusOK, map[string]any{"acceptances": acceptances})
}
