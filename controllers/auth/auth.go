package auth

import (
	"cgn/logger"
	"cgn/models"
	"cgn/repository"
	"github.com/gorilla/sessions"
	"github.com/labstack/echo-contrib/session"
	"github.com/labstack/echo/v4"
	"golang.org/x/crypto/bcrypt"
	"net/http"
)

// Init initializes routes with handlers for auth routes
func Init(e *echo.Echo) {
	e.GET("/login", LoginGET)
	e.POST("/login", LoginPOST)

	e.GET("/signup", SignUpGET)
	e.POST("/signup", SignUpPOST)

	e.GET("/logout", LogoutGET)
	e.POST("/logout", LogoutPOST)
}

// LoginGET authenticates the current session
func LoginGET(c echo.Context) error {
	sess, _ := session.Get("session", c)
	sess.Options = &sessions.Options{
		Path:     "/",
		MaxAge:   86400 * 7,
		HttpOnly: true,
	}
	sess.Values["authenticated"] = true
	sess.Values["userId"] = 1 // requires valid row in user with column id = 1
	sess.Save(c.Request(), c.Response())
	http.Redirect(c.Response(), c.Request(), "/", http.StatusFound)
	return c.NoContent(http.StatusOK)
	// type TemplateData struct{}
	// data := TemplateData{}
	// return c.Render(http.StatusOK, "login.page.html", data)
}

// LoginPOST authenticates the session using a user's email and password
func LoginPOST(c echo.Context) error {
	email := c.FormValue("email")
	password := c.FormValue("password")

	user, err := repository.ReadUser(email)
	if err != nil {
		http.Redirect(c.Response(), c.Request(), "/", http.StatusFound)
		return c.NoContent(http.StatusBadRequest)
	}

	hashedPassword := user.PasswordHash
	err = bcrypt.CompareHashAndPassword([]byte(hashedPassword), []byte(password))
	if err != nil {
		http.Redirect(c.Response(), c.Request(), "/", http.StatusFound)
		return c.NoContent(http.StatusBadRequest)
	}

	sess, _ := session.Get("session", c)
	sess.Options = &sessions.Options{
		Path:     "/",
		MaxAge:   86400 * 7,
		HttpOnly: true,
	}
	sess.Values["authenticated"] = true
	sess.Values["userId"] = user.Id
	sess.Save(c.Request(), c.Response())
	http.Redirect(c.Response(), c.Request(), "/", http.StatusFound)
	return c.NoContent(http.StatusOK)
}

// SignUpGET
func SignUpGET(c echo.Context) error {
	type TemplateData struct{}
	data := TemplateData{}
	return c.Render(http.StatusOK, "signup.page.html", data)
}

// SignUpPOST creates a new user
func SignUpPOST(c echo.Context) error {
	fullName := c.FormValue("fullName")
	email := c.FormValue("email")
	password := c.FormValue("password")

	passwordHash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		logger.Error(err)
	}

	user := models.User{
		FullName:     fullName,
		Email:        email,
		Gravatar:     "",
		PasswordHash: string(passwordHash),
	}

	_, err = repository.CreateUser(user)

	if err != nil {
		logger.Error(err)
		return c.String(http.StatusOK, "Error creating user")
	}
	return c.String(http.StatusCreated, "Now Sign In")
}

// LogoutGET de-authenticates the session
func LogoutGET(c echo.Context) error {
	sess, _ := session.Get("session", c)
	sess.Values["authenticated"] = false
	sess.Values["userId"] = nil
	sess.Save(c.Request(), c.Response())
	http.Redirect(c.Response(), c.Request(), "/", http.StatusFound)
	return c.NoContent(http.StatusOK)
}

// LogoutPOST de-authenticates the session
func LogoutPOST(c echo.Context) error {
	sess, _ := session.Get("session", c)
	sess.Values["authenticated"] = false
	sess.Values["userId"] = nil
	sess.Save(c.Request(), c.Response())
	return c.NoContent(http.StatusOK)
}
