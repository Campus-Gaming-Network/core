package schools

import (
	"net/http"
	"strconv"

	"github.com/labstack/echo/v4"
)

var uri = "/schools"

func Init(e *echo.Echo) {
	e.GET(uri, Index)
	e.GET(uri+"/:id", GetSchool)
	e.GET(uri+"/:id/edit", EditSchool)
	e.PUT(uri+"/:id/edit", UpdateSchool)
}

type School struct {
	Id   int
	Name string
}

var schools = map[int]School{
	1: {Id: 1, Name: "School 1"},
	2: {Id: 2, Name: "School 2"},
	3: {Id: 3, Name: "School 3"},
	4: {Id: 4, Name: "School 4"},
	5: {Id: 5, Name: "School 5"},
}

// List Schools
func Index(c echo.Context) error {
	type TemplateData struct {
		Schools []School
	}

	data := TemplateData{Schools: make([]School, 0, len(schools))}

	return c.Render(http.StatusOK, "list-schools.page.html", data)
}

// View School Details
func GetSchool(c echo.Context) error {
	schoolIdInt, err := strconv.Atoi(c.Param("id"))

	if err != nil {
		return c.String(http.StatusBadRequest, "Invalid school id")
	}

	type TemplateData struct {
		School School
	}

	if _, ok := schools[schoolIdInt]; ok {
		return c.String(http.StatusNotFound, "School not found")
	}

	data := TemplateData{
		School: schools[schoolIdInt],
	}

	return c.Render(http.StatusOK, "school-details.page.html", data)
}

// Edit School Form
func EditSchool(c echo.Context) error {
	type TemplateData struct{}
	data := TemplateData{}
	return c.Render(http.StatusOK, "edit-school.page.html", data)
}

// Handles Update School
func UpdateSchool(c echo.Context) error {
	return c.String(http.StatusOK, "UpdateSchool")
}
