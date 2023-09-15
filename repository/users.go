package repository

import (
	"cgn/models"
	"errors"
	"fmt"
	"time"
)

// ReadUser retrieves a user by email (string) or id (int)
func ReadUser(identifier any) (models.User, error) {
	var stmt string

	switch v := identifier.(type) {
	case int:
		stmt = `SELECT * FROM users WHERE id = $1`
	case string:
		stmt = `SELECT * FROM users WHERE email = $1`
	default:
		return models.User{}, errors.New(fmt.Sprintf("Type %v cannot be used to retrieve a user", v))
	}

	row := repo.db.QueryRow(stmt, identifier)

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
	var newID int
	stmt := `INSERT INTO users (email,full_name, gravatar,  password_hash, created_at,
                    updated_at) VALUES ($1,$2,$3,$4,$5, $6) returning id`

	err := repo.db.QueryRow(
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
