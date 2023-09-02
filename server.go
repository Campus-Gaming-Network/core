package main

import (
	"cgn/controllers"
	"cgn/db"
	"cgn/render"
	"cgn/repository"
	"fmt"
	"github.com/joho/godotenv"
	"log"
	"net/http"

	"github.com/labstack/echo/v4"
)

const port = 1323

// wassup, lets build CGN! :D
// o hell ya
// no, just going to do it all from scratch
type Person struct {
	Name   string
	Age    string
	Emails []string
}

type TemplateData struct {
	Person Person
	Title  string
}

// NotFound returns 404 not found page for invalid endpoints
func NotFound(c echo.Context) error {
	return c.Render(http.StatusOK, "404.page.html", map[string]interface{}{
		"Title": "Not Found",
	})
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
	err := godotenv.Load()
	if err != nil {
		log.Fatal("Error loading .env file")
	}
	t := render.CreateTemplates()
	e := echo.New()
	e.Renderer = t

	e.RouteNotFound("/*", NotFound)
	e.HTTPErrorHandler = customHTTPErrorHandler

	dbConn, err := db.NewConnection()
	if err != nil {
		log.Fatal(err)
	}
	defer dbConn.Close()

	repository.NewRepository(dbConn)

	controllers.InitControllers(e)

	data := TemplateData{
		Person: Person{
			Name:   "Jack",
			Age:    "20",
			Emails: []string{"abc@gmail.com", "123@mail.com"},
		},
		Title: "Home",
	}

	e.GET("/", func(c echo.Context) error {
		return c.Render(http.StatusOK, "home.page.html", data)
	})

	e.Logger.Fatal(e.Start(fmt.Sprintf(":%d", port)))
}
