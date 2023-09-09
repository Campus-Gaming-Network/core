package events

import (
	"cgn/helpers"
	"cgn/logger"
	"cgn/middleware"
	"cgn/models"
	"cgn/repository"
	"fmt"
	"github.com/labstack/echo-contrib/session"
	"github.com/labstack/echo/v4"
	"net/http"
	"strconv"
	"time"
)

var uri = "/events"

// Init initializes route handlers for routes related to events
func Init(e *echo.Echo) {
	e.GET(uri, Index)
	e.GET(uri+"/create", CreateEvent, middleware.RequireAuth())
	e.POST(uri+"/create", SaveEvent, middleware.RequireAuth())
	e.GET(uri+"/:id", GetEvent)
	e.GET(uri+"/:id/edit", EditEvent, middleware.RequireAuth())
	e.PUT(uri+"/:id/edit", UpdateEvent, middleware.RequireAuth(), middleware.AuthorizeEventAccess())
	e.DELETE(uri+"/:id", DeleteEvent, middleware.RequireAuth(), middleware.AuthorizeEventAccess())

	e.POST(uri+"/create-form", SaveEventForm, middleware.RequireAuth())
}

// Index lists all events
func Index(c echo.Context) error {
	type TemplateData struct {
		Events []models.Event
	}
	data := TemplateData{
		Events: repository.GetAllEvents(),
	}
	return c.Render(http.StatusOK, "list-events.page.html", data)
}

// CreateEvent navigates to the create-event page
func CreateEvent(c echo.Context) error {
	type TemplateData struct{}
	data := TemplateData{}
	return c.Render(http.StatusOK, "create-event.page.html", data)
}

// SaveEvent saves a new event using the request body
func SaveEvent(c echo.Context) error {

	var e models.Event
	if err := c.Bind(e); err != nil {
		return c.String(http.StatusBadRequest, "bad request")
	}

	sess, _ := session.Get("session", c)
	userId := sess.Values["userId"].(int)
	event := models.EventDTO{
		UserId:        userId,
		Title:         e.Title,
		Description:   e.Description,
		StartDateTime: e.StartDateTime,
		EndDateTime:   e.EndDateTime,
		IsOnline:      e.IsOnline,
		CreatedAt:     time.Now(),
		UpdatedAt:     time.Now(),
	}

	newId, err := repository.CreateEvent(event)

	isHTMX := helpers.IsHTMXRequest(c.Request())
	if !isHTMX {
		type TemplateData struct{}
		data := TemplateData{}
		return c.Render(http.StatusOK, "save-event.page.html", data)
	}

	//htmx response
	if err != nil {
		return c.HTML(http.StatusBadRequest, "bad request")
	} else {
		return c.HTML(http.StatusCreated, string(rune(newId)))
	}
}

// SaveEventForm creates a new event using form values in the uri
func SaveEventForm(c echo.Context) error {

	var e models.Event

	if err := c.Bind(&e); err != nil {
		logger.Log(e)
		logger.Error(err.Error())
		return c.String(http.StatusBadRequest, "bad request")
	}

	sess, _ := session.Get("session", c)
	userId := sess.Values["userId"].(int)

	event := models.EventDTO{
		UserId:        userId,
		Title:         e.Title,
		Description:   e.Description,
		StartDateTime: e.StartDateTime,
		EndDateTime:   e.EndDateTime,
		IsOnline:      e.IsOnline,
		CreatedAt:     time.Now(),
		UpdatedAt:     time.Now(),
	}

	newID, err := repository.CreateEvent(event)
	if err != nil {
		logger.Error(err)
		return c.String(http.StatusNotAcceptable, "Error creating event")
	}

	html := fmt.Sprintf("<li><a href=\"/events/%d\">%s</a></li>", newID, e.Title)
	return c.HTML(http.StatusCreated, html)
}

// GetEvent retrieves an event based on its id
func GetEvent(c echo.Context) error {
	eventId, _ := strconv.Atoi(c.Param("id"))
	type TemplateData struct {
		Event models.Event
	}
	event, _, err := repository.ReadEvent(eventId)

	if err != nil {
		logger.Error(err)
		return c.Render(http.StatusNotFound, "404.page.html", nil)
	}
	data := TemplateData{Event: event}
	return c.Render(http.StatusOK, "event-details.page.html", data)
}

// EditEvent handles edit event get request to view edit-event.page.html
func EditEvent(c echo.Context) error {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		logger.Error(err)
		c.String(http.StatusBadRequest, "invalid or missing event id")
	}

	type TemplateData struct {
		Event models.Event
	}
	event, _, err := repository.ReadEvent(id)

	if err != nil {
		return c.String(http.StatusBadRequest, "invalid id")
	}
	data := TemplateData{
		Event: event,
	}
	return c.Render(http.StatusOK, "edit-event.page.html", data)
}

// UpdateEvent handles update event put request.
func UpdateEvent(c echo.Context) error {

	var e models.Event
	if err := c.Bind(&e); err != nil {
		logger.Error(err)
		return c.String(http.StatusBadRequest, "bad request")
	}

	sess, _ := session.Get("session", c)
	userId := sess.Values["userId"].(int)
	eventId, _ := strconv.Atoi(c.Param("id"))

	event := models.EventDTO{
		Id:            eventId,
		UserId:        userId,
		Title:         e.Title,
		Description:   e.Description,
		StartDateTime: e.StartDateTime,
		EndDateTime:   e.EndDateTime,
		IsOnline:      e.IsOnline,
	}
	type TemplateData struct {
		Event models.Event
	}
	_, err := repository.UpdateEvent(event)
	if err != nil {
		return c.String(http.StatusBadRequest, err.Error())
	}

	//data := TemplateData{
	//	Event: updatedEvent,
	//}
	helpers.HTMXRedirect(c, "/events")
	return c.NoContent(http.StatusOK)
}

// DeleteEvent handles delete event delete request.
func DeleteEvent(c echo.Context) error {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		return c.String(http.StatusBadRequest, "missing or invalid id")
	}

	_, err = repository.DeleteEvent(id)
	if err != nil {
		return c.String(http.StatusNotFound, fmt.Sprintf("event with id %d not found: %v", id, err))
	}
	helpers.HTMXRedirect(c, "/events")
	return c.NoContent(http.StatusOK)
}
