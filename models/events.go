package models

import (
	"database/sql"
	"fmt"
	"strings"
	"time"
)

// MyTime wraps time.Time
type MyTime time.Time

// UnmarshalJSON parses html form type 'datetime-local' from json into RFC3339
func (m *MyTime) UnmarshalJSON(p []byte) error {
	layout := "2006-01-02T15:04"
	t, err := time.Parse(layout, strings.Replace(
		string(p),
		"\"",
		"",
		-1,
	))
	fmt.Println("formatted time", t)
	if err != nil {
		return err
	}

	*m = MyTime(t)

	return nil
}

// UnmarshalParam parses html form type 'datetime-local' into RFC3339
func (m *MyTime) UnmarshalParam(param string) error {
	layout := "2006-01-02T15:04"
	t, err := time.Parse(layout, param)
	if err != nil {
		return err
	}
	*m = MyTime(t)
	return nil
}

// String formats the string version of MyTime to look just like time.Time
func (m MyTime) String() string {
	return time.Time(m).String()
}

// Event is used to bind event fields from requests. StartDateTime and EndDateTime must use
// the models.MyTime time type in order for Echo's binding to function with the Unmarshal function
// written for models.MyTime that accepts the HTML Form 'datetime-local' time format. When translating to/from
// EventDTO type conversions must be used on these fields.
type Event struct {
	Id            int    `json:"id" form:"id"`
	Title         string `json:"title" form:"title"`
	Description   string `json:"description" form:"description"`
	StartDateTime MyTime `json:"start_date_time" form:"start_date_time"`
	EndDateTime   MyTime `json:"end_date_time" form:"end_date_time"`
	IsOnline      int    `json:"is_online" form:"is_online"`
}

// EventDTO is used to transfer event data into the database. StartDateTime and EndDateTime must use
// default time.Time type in order to insert/read from Postgres. When translating to/from Event
// type conversions must be used.
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
