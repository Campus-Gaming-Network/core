package driver

import (
	"cgn/logger"
	"cgn/migrations"
	"database/sql"
	"fmt"
	_ "github.com/lib/pq"
	"os"
)

// NewConnection establishes a new connection to postgres driver
func NewConnection() (*sql.DB, error) {
	dbName := os.Getenv("DB_NAME")
	host := os.Getenv("DB_HOST")
	port := os.Getenv("DB_PORT")
	user := os.Getenv("DB_USER")
	password := os.Getenv("DB_PASSWORD")

	psqlInfo := fmt.Sprintf("host=%s port=%s user=%s password=%s "+
		"dbname=%s sslmode=disable", host, port, user, password, dbName)

	db, err := sql.Open("postgres", psqlInfo)
	if err != nil {
		logger.Error(err)
		return nil, err
	}

	err = TestConnection(db)
	if err != nil {
		logger.Error(err)
		return nil, err
	}

	//run migrations to update database
	migrations.RunMigrations(db)

	return db, nil
}

// TestConnection tests if connection to postgres driver is active
func TestConnection(db *sql.DB) error {
	err := db.Ping()
	if err != nil {
		logger.Error(err)
		return err
	}
	return nil
}
