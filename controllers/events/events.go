package events

import (
	"net/http"

	"github.com/labstack/echo-contrib/session"
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
	// this authentication block should be in a middleware
	sess, _ := session.Get("session", c)
	if auth, ok := sess.Values["authenticated"].(bool); !ok || !auth {
		http.Redirect(c.Response(), c.Request(), "/", http.StatusUnauthorized)
		return nil
	}

	type TemplateData struct{}
	data := TemplateData{}
	return c.Render(http.StatusOK, "create-event.page.html", data)
}

// Handles Create Event
func SaveEvent(c echo.Context) error {
	// this authentication block should be in a middleware
	sess, _ := session.Get("session", c)
	if auth, ok := sess.Values["authenticated"].(bool); !ok || !auth {
		http.Redirect(c.Response(), c.Request(), "/", http.StatusUnauthorized)
		return nil
	}

	name := c.FormValue("name")
	description := c.FormValue("description")
	json_response := map[string]string{"name": name, "description": description}
	return c.JSON(http.StatusOK, json_response)
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
