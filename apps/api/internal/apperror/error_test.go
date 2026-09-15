package apperror

import (
	"errors"
	"fmt"
	"testing"
)

func TestDetailsFindsWrappedApplicationError(t *testing.T) {
	cause := errors.New("database detail")
	err := fmt.Errorf("save profile: %w", Wrap(KindConflict, "profile_conflict", cause))

	kind, code, ok := Details(err)
	if !ok {
		t.Fatal("Details() did not find application error")
	}
	if kind != KindConflict || code != "profile_conflict" {
		t.Fatalf("Details() = (%v, %q), want (%v, %q)", kind, code, KindConflict, "profile_conflict")
	}
	if !errors.Is(err, cause) {
		t.Fatal("wrapped cause is not reachable with errors.Is")
	}
}

func TestDetailsRejectsUnclassifiedError(t *testing.T) {
	if _, _, ok := Details(errors.New("plain failure")); ok {
		t.Fatal("Details() classified a plain error")
	}
}

func TestIsMatchesStableKindAndCode(t *testing.T) {
	sentinel := New(KindConflict, "duplicate", "duplicate record")
	err := Wrap(KindConflict, "duplicate", errors.New("unique constraint detail"))

	if !errors.Is(err, sentinel) {
		t.Fatal("errors.Is() did not match the same application kind and code")
	}
	if errors.Is(err, New(KindValidation, "duplicate", "different class")) {
		t.Fatal("errors.Is() matched a different application-error kind")
	}
}
