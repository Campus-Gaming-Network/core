package repository

import (
	"cgn/models"
	"github.com/upper/db/v4"
	"log"
)

type Repository struct {
	db.Session
}

// repo is the Repository only accessible within the repository package
var repo *Repository

// NewRepository initializes repository using active database connection
func NewRepository(sess db.Session) {
	repo = &Repository{sess}
}

func GetAllTeams() []models.Team {
	teamsCol := repo.Collection("teams")

	var teams []models.Team
	err := teamsCol.Find().All(&teams)
	if err != nil {
		log.Println("Could not retrieve teams from db")
		return nil
	}
	return teams
}
