package migrate

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadFilesSortsVersionedUpMigrations(t *testing.T) {
	directory := t.TempDir()
	for _, name := range []string{
		"000010_later.up.sql",
		"000002_middle.up.sql",
		"000001_first.up.sql",
		"README.md",
		"000003_down.sql",
	} {
		if err := os.WriteFile(filepath.Join(directory, name), []byte("SELECT 1;"), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	files, err := LoadFiles(directory)
	if err != nil {
		t.Fatalf("LoadFiles() error = %v", err)
	}
	if len(files) != 3 {
		t.Fatalf("migration count = %d, want 3", len(files))
	}
	for index, want := range []int64{1, 2, 10} {
		if files[index].Version != want {
			t.Fatalf("migration[%d].Version = %d, want %d", index, files[index].Version, want)
		}
	}
}

func TestLoadFilesRejectsDuplicateVersions(t *testing.T) {
	directory := t.TempDir()
	for _, name := range []string{"000001_first.up.sql", "000001_duplicate.up.sql"} {
		if err := os.WriteFile(filepath.Join(directory, name), []byte("SELECT 1;"), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	if _, err := LoadFiles(directory); err == nil {
		t.Fatal("LoadFiles() error = nil, want duplicate version error")
	}
}
