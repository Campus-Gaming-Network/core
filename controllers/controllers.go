package controllers

import (
	"cgn/controllers/auth"
	"cgn/controllers/events"
	"cgn/controllers/schools"
	"cgn/controllers/teams"
	"cgn/controllers/users"
	"github.com/labstack/echo/v4"
)

func InitControllers(e *echo.Echo) {
	auth.Init(e)
	events.Init(e)
	schools.Init(e)
	users.Init(e)
	teams.Init(e)
}
