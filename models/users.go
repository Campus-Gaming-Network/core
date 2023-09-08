package models

import (
	"database/sql"
	"time"
)

type User struct {
	Id           int
	FullName     string `json:"full_name"`
	Email        string
	Gravatar     string
	PasswordHash string       `json:"password_hash"`
	CreatedAt    time.Time    `json:"created_at"`
	UpdatedAt    time.Time    `json:"updated_at"`
	DeletedAt    sql.NullTime `json:"deleted_at"`
}
