package middleware

import (
	"cgn/helpers"
	"github.com/labstack/echo-contrib/session"
	"github.com/labstack/echo/v4"
	"net/http"
)

// RequireAuth authorizes authenticated users or redirects unauthenticated users back
// to the home page
func RequireAuth() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			sess, _ := session.Get("session", c)
			if auth, ok := sess.Values["authenticated"].(bool); ok && auth {
				return next(c)
			}

			htmx := helpers.IsHTMXRequest(c.Request())

			if htmx {
				//helpers.HTMXRedirect(c, "/")
				c.Response().Header().Add("HX-Redirect", "/")
				return c.NoContent(http.StatusSeeOther)
			} else {
				http.Redirect(c.Response(), c.Request(), "/", http.StatusFound)
				return c.NoContent(http.StatusOK)
			}
		}
	}
}
