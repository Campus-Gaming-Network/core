package teams

import (
	"cgn/models"
	"cgn/repository"
	"net/http"

	"github.com/labstack/echo/v4"
)

var uri = "/teams"

type Team struct {
	Id   int
	Name string
}

var teams = []Team{
	{Id: 1, Name: "Team 1"},
	{Id: 2, Name: "Team 2"},
	{Id: 3, Name: "Team 3"},
	{Id: 4, Name: "Team 4"},
	{Id: 5, Name: "Team 5"},
}

func Init(e *echo.Echo) {
	e.GET(uri, Index)
	e.GET(uri+"/create", CreateTeam)
	e.POST(uri+"/create", SaveEvent)
	e.GET(uri+"/:id", GetTeam)
	e.GET(uri+"/:id/edit", EditTeam)
	e.PUT(uri+"/:id/edit", UpdateTeam)
	e.DELETE(uri+"/:id", DeleteTeam)

}

func Index(c echo.Context) error {
	type TemplateData struct {
		Teams []models.Team
	}

	data := TemplateData{Teams: repository.GetAllTeams()}

	return c.Render(http.StatusOK, "list-teams.page.html", data)
}

// Create Team Form
func CreateTeam(c echo.Context) error {
	type TemplateData struct{}
	data := TemplateData{}
	return c.Render(http.StatusOK, "create-team.page.html", data)
}

// Handles Create Team
func SaveEvent(c echo.Context) error {
	return c.String(http.StatusOK, "SaveEvent")
}

// View Team Details
func GetTeam(c echo.Context) error {
	type TemplateData struct{}
	data := TemplateData{}
	return c.Render(http.StatusOK, "team-details.page.html", data)
}

// Edit Team Form
func EditTeam(c echo.Context) error {
	type TemplateData struct{}
	data := TemplateData{}
	return c.Render(http.StatusOK, "edit-team.page.html", data)
}

// Handles Update Team
func UpdateTeam(c echo.Context) error {
	return c.String(http.StatusOK, "UpdateTeam")
}

// Handle Delete Team
func DeleteTeam(c echo.Context) error {
	return c.String(http.StatusOK, "DeleteTeam")
}
