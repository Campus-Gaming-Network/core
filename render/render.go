package render

import (
	"cgn/logger"
	"html/template"
	"io"
	"log"
	"path/filepath"

	"github.com/labstack/echo/v4"
)

type TemplateRegistry struct {
	templates map[string]*template.Template
}

func CreateTemplates() *TemplateRegistry {
	tmpls := map[string]*template.Template{}

	pages, err := filepath.Glob("views/*.page.html")
	if err != nil {
		return nil
	}

	for _, page := range pages {
		name := filepath.Base(page)
		ts, err := template.New(name).ParseFiles(page)
		if err != nil {
			logger.FatalError(err.Error())
		}

		ts, err = ts.ParseGlob("views/*.comp.html")
		if err != nil {
			logger.FatalError(err.Error())
		}

		ts, err = ts.ParseGlob("views/*.layout.html")
		if err != nil {
			logger.FatalError(err.Error())
		}

		tmpls[name] = ts
	}

	return &TemplateRegistry{
		templates: tmpls,
	}
}

func (tr *TemplateRegistry) Render(w io.Writer, name string, data interface{}, c echo.Context) error {
	t, ok := tr.templates[name]
	if !ok {
		log.Fatalf("Could not find template %s\n", name)
	}

	return t.ExecuteTemplate(w, "base", data)
}
