package auth

import (
	"net/http"

	"github.com/gorilla/sessions"
	"github.com/labstack/echo-contrib/session"
	"github.com/labstack/echo/v4"
)

func Init(e *echo.Echo) {
	e.GET("/login", LoginGET)
	e.POST("/login", LoginPOST)

	e.GET("/signup", SignUpGET)
	e.POST("/signup", SignUpPOST)

	e.GET("/logout", LogoutGET)
	e.POST("/logout", LogoutPost)
}

func LoginGET(c echo.Context) error {
	sess, _ := session.Get("session", c)
	sess.Options = &sessions.Options{
		Path:     "/",
		MaxAge:   86400 * 7,
		HttpOnly: true,
	}
	sess.Values["authenticated"] = true
	sess.Save(c.Request(), c.Response())
	http.Redirect(c.Response(), c.Request(), "/", http.StatusFound)
	return c.NoContent(http.StatusOK)
	// type TemplateData struct{}
	// data := TemplateData{}
	// return c.Render(http.StatusOK, "login.page.html", data)
}

func LoginPOST(c echo.Context) error {
	email := c.FormValue("email")
	password := c.FormValue("password")
	response := email + ":" + password
	return c.String(http.StatusOK, response)
}

func SignUpGET(c echo.Context) error {
	type TemplateData struct{}
	data := TemplateData{}
	return c.Render(http.StatusOK, "signup.page.html", data)
}

func SignUpPOST(c echo.Context) error {
	// fullName := c.FormValue("fullName")
	// email := c.FormValue("email")
	// password := c.FormValue("password")

	// sess, _ := session.Get("session", c)
	// sess.Options = &sessions.Options{
	// 	Path:     "/",
	// 	MaxAge:   86400 * 7,
	// 	HttpOnly: true,
	// }
	// sess.Values["authenticated"] = true
	// sess.Save(c.Request(), c.Response())

	// autoIncId++

	// http.Redirect(c.Response(), c.Request(), "/", http.StatusFound)

	return c.String(http.StatusOK, "SignUpPOST")
}

func LogoutGET(c echo.Context) error {
	sess, _ := session.Get("session", c)
	sess.Values["authenticated"] = false
	sess.Save(c.Request(), c.Response())
	http.Redirect(c.Response(), c.Request(), "/", http.StatusFound)
	return c.NoContent(http.StatusOK)
}

func LogoutPost(c echo.Context) error {
	sess, _ := session.Get("session", c)
	sess.Values["authenticated"] = false
	sess.Save(c.Request(), c.Response())
	return c.NoContent(http.StatusOK)
}
