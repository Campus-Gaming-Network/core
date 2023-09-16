package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"time"

	_ "github.com/joho/godotenv/autoload"

	_ "github.com/lib/pq"
)

func timeTrack(start time.Time, name string) {
	elapsed := time.Since(start)
	fmt.Printf("%s took %s", name, elapsed)
}

func insertSchools() int {
	defer timeTrack(time.Now(), "insertSchools")
	dbName := os.Getenv("DB_NAME")
	host := os.Getenv("DB_HOST")
	port := os.Getenv("DB_PORT")
	user := os.Getenv("DB_USER")
	password := os.Getenv("DB_PASSWORD")

	psqlInfo := fmt.Sprintf("host=%s port=%s user=%s password=%s "+
		"dbname=%s sslmode=disable", host, port, user, password, dbName)

	// Connect to database
	db, err := sql.Open("postgres", psqlInfo)
	if err != nil {
		fmt.Printf("Unable to connect to database: %v\n", err)
		return 1
	}

	// Check if schools are inserted already
	var count int
	stmt := `SELECT COUNT(*) FROM schools`

	row := db.QueryRow(stmt)

	err = row.Scan(&count)
	if err != nil {
		fmt.Println("Error reading count from schools:\t", err)
		return 1
	}

	if count > 0 {
		fmt.Println("Schools already inserted")
		return 0
	}

	// Insert schools
	file, err := os.Open("data/schools.json")
	if err != nil {
		fmt.Println(err)
		return 0
	}
	defer file.Close()

	dec := json.NewDecoder(file)

	// read open bracket
	_, err = dec.Token()

	sqlStmt, _ := db.Prepare("INSERT INTO schools (name, handle) VALUES ($1, $2)")

	defer sqlStmt.Close()

	tx, err := db.Begin()
	if err != nil {
		fmt.Println(err)
		os.Exit(1)
	}
	defer tx.Rollback()

	type SchoolJson struct {
		Handle string `json:"handle"`
		Name   string `json:"name"`
	}

	for dec.More() {
		var school SchoolJson
		if err := dec.Decode(&school); err != nil {
			break
		}

		_, err := tx.Stmt(sqlStmt).Exec(school.Name, school.Handle)
		if err != nil {
			fmt.Println(err)
			return 1
		}
	}

	// read close bracket
	_, _ = dec.Token()

	// Commit the transaction
	if err := tx.Commit(); err != nil {
		fmt.Println("Error inserting school data:", err)
		os.Exit(1)
	}

	fmt.Println("Inserted school data")
	return 0
}

func main() {
	fmt.Printf("starting script...\n")
	os.Exit(insertSchools())
}
