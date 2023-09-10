package models

import (
	"database/sql"
	"time"
)

// School is used to bind event fields from requests.
type School struct {
	Id     int    `json:"id" form:"id"`
	Name   string `json:"name" form:"name"`
	Handle string `json:"handle" form:"handle"`
}

// SchoolDTO is used to transfer event data into the database.
type SchoolDTO struct {
	Id        int          `json:"id" form:"id"`
	Name      string       `json:"name" form:"name"`
	Handle    string       `json:"handle" form:"handle"`
	CreatedAt time.Time    `db:"created_at"`
	UpdatedAt time.Time    `db:"updated_at"`
	DeletedAt sql.NullTime `db:"deleted_at"`
}
