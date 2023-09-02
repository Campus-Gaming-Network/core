package events

import (
	"net/http"

	"github.com/labstack/echo/v4"
)

var uri = "/events"

func Init(e *echo.Echo) {
	e.GET(uri, Index)
	e.GET(uri+"/create", CreateEvent)
	e.POST(uri+"/create", SaveEvent)
	e.GET(uri+"/:id", GetEvent)
	e.GET(uri+"/:id/edit", EditEvent)
	e.PUT(uri+"/:id/edit", UpdateEvent)
	e.DELETE(uri+"/:id", DeleteEvent)
}

// List Events
func Index(c echo.Context) error {
	type TemplateData struct{}
	data := TemplateData{}
	return c.Render(http.StatusOK, "list-events.page.html", data)
}

// Create Event Form
func CreateEvent(c echo.Context) error {
	type TemplateData struct{}
	data := TemplateData{}
	return c.Render(http.StatusOK, "create-event.page.html", data)
}

// Handles Create Event
func SaveEvent(c echo.Context) error {
	return c.String(http.StatusOK, "SaveEvent")
}

// View Event Details
func GetEvent(c echo.Context) error {
	type TemplateData struct{}
	data := TemplateData{}
	return c.Render(http.StatusOK, "event-details.page.html", data)
}

// Edit Event Form
func EditEvent(c echo.Context) error {
	type TemplateData struct{}
	data := TemplateData{}
	return c.Render(http.StatusOK, "edit-event.page.html", data)
}

// Handles Update Event
func UpdateEvent(c echo.Context) error {
	return c.String(http.StatusOK, "UpdateEvent")
}

// Handle Delete Event
func DeleteEvent(c echo.Context) error {
	return c.String(http.StatusOK, "DeleteEvent")
}
