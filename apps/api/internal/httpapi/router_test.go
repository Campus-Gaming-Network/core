package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/auth"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/config"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/schools"
)

const testUserID = "11111111-1111-1111-1111-111111111111"

type fakeSessionStore struct {
	session auth.Session
	err     error
}

func (s fakeSessionStore) FindSession(_ context.Context, _ []byte) (auth.Session, error) {
	return s.session, s.err
}

type fakeFollowRepository struct {
	listFollowedCalled bool
	followed           []schools.School
	err                error
}

func (r *fakeFollowRepository) Follow(_ context.Context, _ string, _ string) error {
	return nil
}

func (r *fakeFollowRepository) Unfollow(_ context.Context, _ string, _ string) error {
	return nil
}

func (r *fakeFollowRepository) IsFollowing(_ context.Context, _ string, _ string) (bool, error) {
	return false, nil
}

func (r *fakeFollowRepository) ListFollowed(_ context.Context, userID string) ([]schools.School, error) {
	r.listFollowedCalled = true
	if userID != testUserID {
		return nil, schools.ErrSchoolNotFound
	}
	return r.followed, r.err
}

func TestHandleMySchoolsRequiresAuthentication(t *testing.T) {
	repository := &fakeFollowRepository{}
	handler := authenticatedMySchoolsHandler(repository)
	request := httptest.NewRequest(http.MethodGet, "/me/schools", nil)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
	if repository.listFollowedCalled {
		t.Fatal("ListFollowed was called for an unauthenticated request")
	}
}

func TestHandleMySchoolsReturnsFollowedSchools(t *testing.T) {
	repository := &fakeFollowRepository{followed: []schools.School{
		{
			ID:           "22222222-2222-2222-2222-222222222222",
			Name:         "Example University",
			Slug:         "example-university",
			City:         "Irvine",
			State:        "CA",
			IsMainCampus: true,
		},
	}}
	handler := authenticatedMySchoolsHandler(repository)
	rawToken, _, err := auth.NewToken()
	if err != nil {
		t.Fatalf("NewToken() error = %v", err)
	}
	request := httptest.NewRequest(http.MethodGet, "/me/schools", nil)
	request.AddCookie(&http.Cookie{Name: "session", Value: rawToken})
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusOK, response.Body.String())
	}
	var payload struct {
		Schools []schools.School `json:"schools"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(payload.Schools) != 1 || payload.Schools[0].Slug != "example-university" {
		t.Fatalf("schools = %#v, want followed school payload", payload.Schools)
	}
}

func authenticatedMySchoolsHandler(repository *fakeFollowRepository) http.Handler {
	router := &Router{
		cfg: config.Config{
			SessionCookie: "session",
			SessionTTL:    time.Hour,
		},
		follows: repository,
	}
	store := fakeSessionStore{session: auth.Session{
		ID:        "session-id",
		UserID:    testUserID,
		ExpiresAt: time.Now().Add(time.Hour),
	}}

	return auth.WithSession(store, auth.SessionCookieConfig{
		Name: "session",
		TTL:  time.Hour,
	})(http.HandlerFunc(router.handleMySchools))
}
