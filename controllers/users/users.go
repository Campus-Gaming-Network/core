package users

import (
	"net/http"

	"github.com/labstack/echo/v4"
)

var uri = "/users"

func Init(e *echo.Echo) {
	e.GET(uri+"/:id", GetUser)
	e.GET(uri+"/:id/edit", EditUser)
	e.GET(uri+"/:id/schools", GetUserSchools)
	e.GET(uri+"/:id/events", GetUserEvents)

	e.PUT(uri+"/:id/edit", UpdateUser)
	e.DELETE(uri+"/:id", DeleteUser)
}

// GetUserEvents displays user's schools
func GetUserEvents(c echo.Context) error {
	return c.Render(http.StatusOK, "user-events.page.html", nil)
}

// GetUserSchools displays user's schools
func GetUserSchools(c echo.Context) error {
	return c.Render(http.StatusOK, "user-schools.page.html", nil)
}

// View User Details
func GetUser(c echo.Context) error {
	type TemplateData struct{}
	data := TemplateData{}
	return c.Render(http.StatusOK, "user-details.page.html", data)
}

// Edit User Form
func EditUser(c echo.Context) error {
	type TemplateData struct{}
	data := TemplateData{}
	return c.Render(http.StatusOK, "edit-user.page.html", data)
}

// Handles Update User
func UpdateUser(c echo.Context) error {
	return c.String(http.StatusOK, "UpdateUser")
}

// Handle Delete User
func DeleteUser(c echo.Context) error {
	return c.String(http.StatusOK, "DeleteUser")
}
