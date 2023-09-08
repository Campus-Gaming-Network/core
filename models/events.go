package models

import "time"

type Event struct {
	Id            int
	UserId        int `json:"user_id"`
	Title         string
	Description   string
	StartDateTime time.Time `json:"start_date_time"`
	EndDateTime   time.Time `json:"end_date_time"`
	IsOnline      int       `json:"is_online"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
	DeletedAt     time.Time `json:"deleted_at"`
}

//CREATE TABLE events (
//id SERIAL PRIMARY KEY,
//user_id integer NOT NULL REFERENCES users(id),
//title character varying(255) NOT NULL,
//description text NOT NULL,
//start_date_time timestamp with time zone NOT NULL,
//end_date_time timestamp with time zone NOT NULL,
//is_online integer NOT NULL DEFAULT 0,
//created_at timestamp with time zone DEFAULT now(),
//updated_at timestamp with time zone DEFAULT now(),
//deleted_at timestamp with time zone
//);
