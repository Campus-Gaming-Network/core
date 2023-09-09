package middleware

import (
	"cgn/helpers"
	"cgn/repository"
	"github.com/labstack/echo-contrib/session"
	"github.com/labstack/echo/v4"
	"net/http"
	"strconv"
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

// AuthorizeEventAccess checks that the event being updated/deleted has a user_id that matches the
// user id from the session
func AuthorizeEventAccess() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {

			//retrieve user id from session
			sess, _ := session.Get("session", c)
			userId := sess.Values["userId"].(int)

			//retrieve user id associated with event
			id, err := strconv.Atoi(c.Param("id"))
			eventUserId, err := repository.ReadEventUserId(id)

			if err != nil {
				return c.String(http.StatusBadRequest, "Unable to locate event with that id")
			}

			if eventUserId != userId {
				return c.String(http.StatusUnauthorized, "session user id does not match event user id")
			}

			return next(c)
		}
	}
}
