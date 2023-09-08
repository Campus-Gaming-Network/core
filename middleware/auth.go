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
			a := sess.Values["authenticated"].(bool)
			htmx := helpers.IsHTMXRequest(c.Request())

			if a {
				return next(c)
			} else if htmx {
				c.Response().Header().Add("HX-Redirect", "/")
				return c.NoContent(http.StatusSeeOther)
			} else {
				http.Redirect(c.Response(), c.Request(), "/", http.StatusFound)
				return c.NoContent(http.StatusOK)
			}
		}
	}
}
