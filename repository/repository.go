package repository

import (
	"cgn/models"
	"database/sql"
	"github.com/blockloop/scan/v2"
	"log"
)

type Repository struct {
	db *sql.DB
}

// repo is the Repository only accessible within the repository package
var repo *Repository

// NewRepository initializes repository using active database connection
func NewRepository(d *sql.DB) {
	repo = &Repository{d}
}

func GetAllTeams() []models.Team {

	var teams []models.Team

	stmt := `SELECT * FROM teams`

	rows, err := repo.db.Query(stmt)
	if err != nil {
		log.Println("Could not retrieve teams from driver")
		return nil
	}

	err = scan.Rows(&teams, rows)
	return teams
}
