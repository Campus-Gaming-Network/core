package main

import (
	"bytes"
	"context"
	"strings"
	"testing"
)

func TestRunRejectsUnknownAndExtraArgumentsBeforeDatabaseAccess(t *testing.T) {
	for _, args := range [][]string{{}, {"unknown"}, {"validate-access-config", "extra"}} {
		var stdout, stderr bytes.Buffer
		err := run(context.Background(), args, &stdout, &stderr)
		if err == nil || !strings.Contains(err.Error(), "usage:") {
			t.Fatalf("run(%q) error = %v, want usage error", args, err)
		}
	}
}

func TestDatabaseCommandsRequireExplicitDatabaseEnvironment(t *testing.T) {
	t.Setenv("API_DATABASE_URL", "")
	var stdout, stderr bytes.Buffer
	err := run(context.Background(), []string{"list-site-admins"}, &stdout, &stderr)
	if err == nil || !strings.Contains(err.Error(), "explicitly set") {
		t.Fatalf("run() error = %v, want explicit database requirement", err)
	}
}
