package models

import (
	"database/sql"
	"time"
)

// Event is used to bind event fields from requests.
type Event struct {
	Id            int       `json:"id" form:"id"`
	Title         string    `json:"title" form:"title"`
	Description   string    `json:"description" form:"description"`
	StartDateTime time.Time `json:"start_date_time" form:"start_date_time"`
	EndDateTime   time.Time `json:"end_date_time" form:"end_date_time"`
	IsOnline      int       `json:"is_online" form:"is_online"`
}

// EventDTO is used to transfer event data into the database.
type EventDTO struct {
	Id            int
	UserId        int `db:"user_id"`
	Title         string
	Description   string
	StartDateTime time.Time    `db:"start_date_time"`
	EndDateTime   time.Time    `db:"end_date_time"`
	IsOnline      int          `db:"is_online"`
	CreatedAt     time.Time    `db:"created_at"`
	UpdatedAt     time.Time    `db:"updated_at"`
	DeletedAt     sql.NullTime `db:"deleted_at"`
}
