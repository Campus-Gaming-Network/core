package users

import (
	"net/http"

	"github.com/labstack/echo/v4"
)

var uri = "/users"

func Init(e *echo.Echo) {
	e.GET(uri+"/:id", GetUser)
	e.GET(uri+"/:id/edit", EditUser)
	e.PUT(uri+"/:id/edit", UpdateUser)
	e.DELETE(uri+"/:id", DeleteUser)
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
