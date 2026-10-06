package policies

import (
	"errors"
	"reflect"
	"testing"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/apperror"
)

func TestResolveAcceptsOnlyAnAffirmedClaimForTheCurrentVersions(t *testing.T) {
	current := Current{
		Terms:   Document{ID: "terms-id", Type: TypeTerms, Version: "terms-v2"},
		Privacy: Document{ID: "privacy-id", Type: TypePrivacy, Version: "privacy-v3"},
	}
	accepted := Claim{
		TermsAgreed: true, TermsVersion: "terms-v2",
		PrivacyAcknowledged: true, PrivacyVersion: "privacy-v3",
	}

	documentIDs, err := current.Resolve(accepted)
	if err != nil || !reflect.DeepEqual(documentIDs, []string{"terms-id", "privacy-id"}) {
		t.Fatalf("Resolve(accepted) = %v, %v; want both current document IDs", documentIDs, err)
	}

	for name, test := range map[string]struct {
		mutate func(*Claim)
		kind   apperror.Kind
	}{
		"terms not agreed":         {func(claim *Claim) { claim.TermsAgreed = false }, apperror.KindValidation},
		"terms version missing":    {func(claim *Claim) { claim.TermsVersion = " " }, apperror.KindValidation},
		"privacy not acknowledged": {func(claim *Claim) { claim.PrivacyAcknowledged = false }, apperror.KindValidation},
		"privacy version missing":  {func(claim *Claim) { claim.PrivacyVersion = "" }, apperror.KindValidation},
		"stale terms version":      {func(claim *Claim) { claim.TermsVersion = "terms-v1" }, apperror.KindConflict},
		"unpublished privacy":      {func(claim *Claim) { claim.PrivacyVersion = "privacy-v9" }, apperror.KindConflict},
		"versions swapped":         {func(claim *Claim) { claim.TermsVersion, claim.PrivacyVersion = "privacy-v3", "terms-v2" }, apperror.KindConflict},
	} {
		t.Run(name, func(t *testing.T) {
			claim := accepted
			test.mutate(&claim)

			documentIDs, err := current.Resolve(claim)
			kind, _, ok := apperror.Details(err)
			if documentIDs != nil || !ok || kind != test.kind {
				t.Fatalf("Resolve() = %v, %v; want no documents and error kind %v", documentIDs, err, test.kind)
			}
			if test.kind == apperror.KindConflict && !errors.Is(err, ErrVersionMismatch) {
				t.Fatalf("Resolve() error = %v, want ErrVersionMismatch", err)
			}
		})
	}
}
