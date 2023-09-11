package auth

import (
	"cgn/logger"
	"cgn/models"
	"cgn/repository"
	"crypto/md5"
	"encoding/hex"
	"fmt"
	"net/http"
	"strings"

	"github.com/go-playground/validator/v10"
	"github.com/gorilla/sessions"
	"github.com/labstack/echo-contrib/session"
	"github.com/labstack/echo/v4"
	"golang.org/x/crypto/bcrypt"
)

var validate *validator.Validate

type (
	ErrorField struct {
		Id      string
		Field   string
		Message string
	}
	ErrorResponse struct {
		Errors     []ErrorField
		ErrorCount int
	}
	LoginForm struct {
		Email    string `validate:"required,email"`
		Password string `validate:"required"`
	}
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
	session, _ := session.Get("session", c)
	auth, ok := session.Values["authenticated"].(bool)

	if auth || !ok {
		http.Redirect(c.Response(), c.Request(), "/", http.StatusFound)
		return nil
	}

	return c.Render(http.StatusOK, "login.page.html", nil)
}

func LoginPOST(c echo.Context) error {
	email := c.FormValue("email")
	password := c.FormValue("password")

	form := &LoginForm{
		Email:    email,
		Password: password,
	}

	validate := validator.New(validator.WithRequiredStructEnabled())

	err := validate.Struct(form)

	if err != nil {
		errors := []ErrorField{}
		for _, err := range err.(validator.ValidationErrors) {
			if err.Field() == "Email" {
				switch err.Tag() {
				case "required":
					errors = append(errors, ErrorField{
						Id:      "email_error",
						Field:   "email",
						Message: "The email address field is empty, it is a required field and must be filled in.",
					})
					continue
				case "email":
					errors = append(errors, ErrorField{
						Id:      "email_error",
						Field:   "email",
						Message: "The email address field is in the wrong format",
					})
					continue
				}
			} else if err.Field() == "Password" {
				errors = append(errors, ErrorField{
					Id:      "password_error",
					Field:   "password",
					Message: "The password field is empty, it is a required field and must be filled in.",
				})
				continue
			}
		}

		return c.Render(http.StatusOK, "login.page.html", ErrorResponse{
			Errors:     errors,
			ErrorCount: len(err.(validator.ValidationErrors)),
		})
	}

	user, err := repository.ReadUser(email)

	if err != nil {
		return c.Render(http.StatusOK, "login.page.html", ErrorResponse{
			Errors: []ErrorField{
				{
					Id:      "email_error",
					Field:   "email",
					Message: "Invalid email address or password.",
				},
			},
			ErrorCount: 1,
		})
	}

	hashedPassword := user.PasswordHash
	err = bcrypt.CompareHashAndPassword([]byte(hashedPassword), []byte(password))

	if err != nil {
		return c.Render(http.StatusOK, "login.page.html", ErrorResponse{
			Errors: []ErrorField{
				{
					Id:      "email_error",
					Field:   "email",
					Message: "Invalid email address or password.",
				},
			},
			ErrorCount: 1,
		})
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
	return nil
}

// SignUpGET
func SignUpGET(c echo.Context) error {
	type TemplateData struct{}
	data := TemplateData{}
	return c.Render(http.StatusOK, "signup.page.html", data)
}

// generateGravatarURL uses md5 hash to generate a Gravatar URL from an email string
func generateGravatarURL(email string) string {
	//generate md5 hash
	hasher := md5.New()
	hasher.Write([]byte(email))
	hash := hasher.Sum(nil)
	hashString := hex.EncodeToString(hash)

	//construct URL
	email = strings.TrimSpace(strings.ToLower(email))
	baseURL := "https://www.gravatar.com/avatar/"
	gravatarURL := fmt.Sprintf("%s%s", baseURL, hashString)

	return gravatarURL
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
		Gravatar:     generateGravatarURL(email),
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
