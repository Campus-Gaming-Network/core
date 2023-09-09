package main

import (
	"cgn/controllers"
	"cgn/driver"
	"cgn/logger"
	"cgn/render"
	"cgn/repository"
	"fmt"
	"github.com/labstack/echo/v4/middleware"
	"log"
	"net/http"

	"github.com/gorilla/sessions"
	"github.com/joho/godotenv"

	"github.com/labstack/echo-contrib/session"
	"github.com/labstack/echo/v4"
)

const port = 1323

// NotFound returns 404 not found page for invalid endpoints
func NotFound(c echo.Context) error {
	return c.Render(http.StatusOK, "404.page.html", nil)
}

func customHTTPErrorHandler(err error, c echo.Context) {
	code := http.StatusInternalServerError
	if he, ok := err.(*echo.HTTPError); ok {
		code = he.Code
	}
	c.Logger().Error(err)
	errorPage := fmt.Sprintf("%d.html", code)
	if err := c.File(errorPage); err != nil {
		c.Logger().Error(err)
	}
	c.Render(http.StatusInternalServerError, "500.page.html", map[string]interface{}{
		"Title": "Internal Server Error",
	})
}

func main() {
	logger.InitLogger()

	err := godotenv.Load()
	if err != nil {
		log.Fatal("Error loading .env file")
	}

	t := render.CreateTemplates()
	e := echo.New()

	// Session
	e.Use(session.Middleware(sessions.NewCookieStore([]byte("SECRET_SESSION_KEY"))))
	e.Use(middleware.CORS())

	e.Renderer = t

	e.RouteNotFound("/*", NotFound)
	e.HTTPErrorHandler = customHTTPErrorHandler

	dbConn, err := driver.NewConnection()
	if err != nil {
		log.Fatal(err)
	}
	defer dbConn.Close()

	repository.NewRepository(dbConn)
	controllers.InitControllers(e)

	e.GET("/", func(c echo.Context) error {
		type Auth struct {
			Authenticated bool
		}

		type User struct {
			Name   string
			Age    string
			Emails []string
		}

		type TemplateData struct {
			User User
			Auth Auth
		}

		session, _ := session.Get("session", c)
		auth, ok := session.Values["authenticated"].(bool)

		if !auth || !ok {
			auth = false
		}

		data := TemplateData{
			User: User{
				Name:   "Jack",
				Age:    "20",
				Emails: []string{"abc@gmail.com", "123@mail.com"},
			},
			Auth: Auth{
				Authenticated: auth,
			},
		}

		return c.Render(http.StatusOK, "home.page.html", data)
	})

	e.Logger.Fatal(e.Start(fmt.Sprintf(":%d", port)))
}
