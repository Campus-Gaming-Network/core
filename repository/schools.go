package repository

import (
	"cgn/logger"
	"encoding/json"
	"os"
)

// InsertSchoolData inserts school data from schools.json
func InsertSchoolData() error {
	file, err := os.Open("schools.json")
	if err != nil {
		return err
	}
	defer file.Close()

	dec := json.NewDecoder(file)

	// read open bracket
	_, err = dec.Token()
	if err != nil {
		logger.FatalError(err)
	}

	// Prepare a statement for bulk insert, ignoring conflicts on handle to not re-insert schools everytime program runs
	stmt, err := repo.db.Prepare("INSERT INTO schools (name, handle) VALUES ($1, $2) ON CONFLICT (handle) DO NOTHING")
	if err != nil {
		return err
	}
	defer stmt.Close()

	tx, err := repo.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// add schools to transaction
	type SchoolJson struct {
		Handle string `json:"handle"`
		Name   string `json:"name"`
	}

	for dec.More() {
		var school SchoolJson
		if err := dec.Decode(&school); err != nil {
			break
		}

		_, err := tx.Stmt(stmt).Exec(school.Name, school.Handle)
		if err != nil {
			return err
		}
	}

	// read close bracket
	_, _ = dec.Token()

	// Commit the transaction
	if err := tx.Commit(); err != nil {
		return err
	}

	return nil
}
