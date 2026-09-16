package adminsession

import (
	"context"
	"errors"
	"net/http"
)

type contextKey string

const principalContextKey contextKey = "cgn.admin_principal"

type Authenticator interface {
	Authenticate(ctx context.Context, rawToken string) (Principal, error)
}

// WithSession resolves an isolated Admin Console session when present. Route
// handlers still have to call Require; merely reaching this middleware never
// grants access.
func WithSession(authenticator Authenticator, cookieConfig CookieConfig) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			cookie, err := req.Cookie(sessionCookieName(cookieConfig))
			if err == nil && cookie.Value != "" {
				principal, authErr := authenticator.Authenticate(req.Context(), cookie.Value)
				if authErr == nil {
					req = req.WithContext(context.WithValue(req.Context(), principalContextKey, principal))
				} else if errors.Is(authErr, ErrUnauthenticated) {
					ClearCookie(w, cookieConfig)
				}
			}
			next.ServeHTTP(w, req)
		})
	}
}

func FromContext(ctx context.Context) (Principal, bool) {
	principal, ok := ctx.Value(principalContextKey).(Principal)
	return principal, ok && principal.SessionID != "" && principal.UserID != "" && principal.GrantID != ""
}

func Require(ctx context.Context) (Principal, error) {
	principal, ok := FromContext(ctx)
	if !ok {
		return Principal{}, ErrUnauthenticated
	}
	return principal, nil
}
