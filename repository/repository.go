package repository

import (
	"cgn/logger"
	"cgn/models"
	"context"
	"database/sql"
	"github.com/blockloop/scan/v2"
	"log"
	"time"
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

// GetAllTeams gets all teams
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

// CreateEvent creates a new event, allowing three seconds for query to execute
func CreateEvent(e models.Event) (int, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	var newID int
	stmt := `INSERT INTO events (user_id, title, description,start_date_time, end_date_time, is_online, created_at,
                    updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) returning id`

	err := repo.db.QueryRowContext(
		ctx,
		stmt,
		e.UserId,
		e.Title,
		e.Description,
		e.StartDateTime,
		e.EndDateTime,
		e.IsOnline,
		time.Now(),
		time.Now(),
	).Scan(&newID)

	if err != nil {
		return 0, err
	}

	return newID, nil
}

// ReadEvent gets an event by id
func ReadEvent(id int) (models.Event, error) {
	var event models.Event

	stmt := `SELECT * FROM events WHERE id=$1`

	res, err := repo.db.Query(stmt, id)
	if err != nil {
		return models.Event{}, err
	}

	err = scan.Row(&event, res)

	return event, nil
}

// GetAllEvents gets all events
func GetAllEvents() []models.Event {

	var events []models.Event

	stmt := `SELECT * FROM events`

	rows, err := repo.db.Query(stmt)
	if err != nil {
		log.Println("Could not retrieve teams from driver")
		return nil
	}

	err = scan.Rows(&events, rows)
	return events
}

// UpdateEvent updates an event
func UpdateEvent(e models.Event) (models.Event, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	var updatedEvent models.Event
	stmt := `UPDATE events 
			SET user_id = $1,
				title = $2,
				description = $3,
				start_date_time = $4,
				end_date_time = $5,
				is_online = $6,
				updated_at = $7
		  	WHERE id = $8
		  	RETURNING *`

	row, err := repo.db.QueryContext(
		ctx,
		stmt,
		e.UserId,
		e.Title,
		e.Description,
		e.StartDateTime,
		e.EndDateTime,
		e.IsOnline,
		time.Now(),
		e.Id,
	)

	if err != nil {
		logger.Error(err)
		return models.Event{}, nil
	}

	err = scan.Row(&updatedEvent, row)

	if err != nil {
		return models.Event{}, err
	}

	return updatedEvent, nil
}

func DeleteEvent(id int) (int, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	var numDeleted int

	stmt := `DELETE FROM events WHERE id =$1 RETURNING id`

	row, err := repo.db.QueryContext(
		ctx,
		stmt,
		id,
	)
	if err != nil {
		return 0, err
	}

	err = scan.Row(&numDeleted, row)
	if err != nil {
		return 0, err
	}

	return numDeleted, nil
}

func ReadUser(email string) (models.User, error) {
	stmt := `SELECT * FROM users WHERE email = $1`

	row := repo.db.QueryRow(stmt, email)

	var user models.User
	err := row.Scan(
		&user.Id,
		&user.FullName,
		&user.Email,
		&user.Gravatar,
		&user.PasswordHash,
		&user.CreatedAt,
		&user.UpdatedAt,
		&user.DeletedAt,
	)
	if err != nil {
		return models.User{}, err
	}

	return user, nil
}

// CreateUser creates a new user and returns the user id
func CreateUser(u models.User) (int, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	var newID int
	stmt := `INSERT INTO users (email,full_name, gravatar,  password_hash, created_at,
                    updated_at) VALUES ($1,$2,$3,$4,$5, $6) returning id`

	err := repo.db.QueryRowContext(
		ctx,
		stmt,
		u.Email,
		u.FullName,
		u.Gravatar,
		u.PasswordHash,
		time.Now(),
		time.Now(),
	).Scan(&newID)

	if err != nil {
		return 0, err
	}

	return newID, nil
}
