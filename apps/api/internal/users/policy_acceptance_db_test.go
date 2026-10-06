package users

import (
	"reflect"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/policies"
)

func TestSignupRecordsTheAcceptedPolicyVersionsWithTheAccount(t *testing.T) {
	ctx, pool, schoolID, suffix := setupLifecycleDatabaseTest(t)
	repository := NewPostgresRepository(pool)
	policyRepository := policies.NewPostgresRepository(pool)
	acceptedAt := time.Date(2026, time.October, 6, 12, 0, 0, 0, time.UTC)
	current, err := policyRepository.Current(ctx, acceptedAt)
	if err != nil {
		t.Fatalf("Current() error = %v", err)
	}

	profile, err := repository.CreateWithVerificationToken(ctx, CreateParams{
		Email:             "policy-signup-" + suffix + "@example.test",
		PasswordHash:      "hash",
		Name:              "Policy Signup",
		HomeSchoolID:      schoolID,
		AgeConfirmedAt:    acceptedAt,
		Timezone:          "UTC",
		PolicyDocumentIDs: []string{current.Terms.ID, current.Privacy.ID},
	}, "policy-signup-raw-"+suffix, []byte("policy-signup-token-"+suffix), acceptedAt.Add(time.Hour))
	if err != nil {
		t.Fatalf("CreateWithVerificationToken() error = %v", err)
	}

	acceptances, err := policyRepository.ListAcceptances(ctx, profile.ID)
	if err != nil {
		t.Fatalf("ListAcceptances() error = %v", err)
	}
	for index := range acceptances {
		acceptances[index].AcceptedAt = acceptances[index].AcceptedAt.UTC()
	}
	want := []policies.Acceptance{
		{DocumentType: policies.TypeTerms, Version: current.Terms.Version, AcceptedAt: acceptedAt, Source: policies.SourceSignup},
		{DocumentType: policies.TypePrivacy, Version: current.Privacy.Version, AcceptedAt: acceptedAt, Source: policies.SourceSignup},
	}
	if !reflect.DeepEqual(acceptances, want) {
		t.Fatalf("ListAcceptances() = %#v, want %#v", acceptances, want)
	}

	t.Run("an acceptance cannot be edited afterwards", func(t *testing.T) {
		if _, err := pool.Exec(ctx, `
			UPDATE user_policy_acceptances SET accepted_at = NOW() WHERE user_id = $1::uuid
		`, profile.ID); err == nil {
			t.Fatal("editing a recorded acceptance succeeded, want it refused")
		}
	})

	t.Run("an unknown document rolls back the whole signup", func(t *testing.T) {
		email := "policy-rollback-" + suffix + "@example.test"
		_, err := repository.CreateWithVerificationToken(ctx, CreateParams{
			Email:             email,
			PasswordHash:      "hash",
			Name:              "Policy Rollback",
			HomeSchoolID:      schoolID,
			AgeConfirmedAt:    acceptedAt,
			Timezone:          "UTC",
			PolicyDocumentIDs: []string{current.Terms.ID, "00000000-0000-4000-8000-000000000000"},
		}, "policy-rollback-raw-"+suffix, []byte("policy-rollback-token-"+suffix), acceptedAt.Add(time.Hour))
		if err == nil {
			t.Fatal("CreateWithVerificationToken() error = nil, want an unknown-document failure")
		}
		assertLifecycleRowCount(t, pool, `SELECT COUNT(*) FROM users WHERE email = $1`, email, 0)
	})
}
