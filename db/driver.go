package db

import (
	"github.com/upper/db/v4"
	"github.com/upper/db/v4/adapter/postgresql"
)

var settings = postgresql.ConnectionURL{
	Database: `cgn`,
	Host:     `localhost:5432`,
	User:     `brettkohler`,
	Password: `password`,
}

// NewConnection establishes a new connection to postgres db
func NewConnection() (db.Session, error) {
	sess, err := postgresql.Open(settings)
	if err != nil {
		return nil, err
	}

	err = TestConnection(sess)
	if err != nil {
		return nil, err
	}

	return sess, nil
}

// TestConnection tests if connection to postgres db is active
func TestConnection(d db.Session) error {
	err := d.Ping()
	if err != nil {
		return err
	}
	return nil
}
