package helpers

import (
	"github.com/labstack/echo/v4"
	"net/http"
)

// IsHTMXRequest checks if request is an HTMX request
func IsHTMXRequest(r *http.Request) bool {
	return r.Header.Get("HX-Request") == "true"
}

// HTMXRedirect adds the htmx redirect header to a response
func HTMXRedirect(c echo.Context, url string) {
	c.Response().Header().Add("HX-Redirect", url)
}
