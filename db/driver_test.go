package db

import "testing"

func TestNewConnection(t *testing.T) {
	_, err := NewConnection()

	if err != nil {
		t.Error("failed to open database")
	}
}
