package adminhttp

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminaccess"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminaudit"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminmutation"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminsecurity"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminsession"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/auth"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/games"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/migrate"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/pagecursor"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/schools"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/users"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const catalogActorID = "10000000-0000-4000-8000-000000000001"
const catalogTargetID = "10000000-0000-4000-8000-000000000002"
const catalogSchoolID = "10000000-0000-4000-8000-000000000003"

var catalogSchemaSequence atomic.Uint64

type catalogFixture struct {
	pool       *pgxpool.Pool
	handler    *Handler
	school     *schools.PostgresRepository
	game       *games.PostgresRepository
	user       *users.PostgresRepository
	grants     *adminaccess.PostgresRepository
	sessions   *adminsession.Service
	credential adminsession.Credential
	command    adminmutation.Command
	actorGrant adminaccess.Grant
	cache      *schools.CachedRepository
}

func newCatalogFixture(t *testing.T) catalogFixture {
	t.Helper()
	dsn := os.Getenv("API_DATABASE_URL")
	if dsn == "" {
		t.Skip("API_DATABASE_URL not set")
	}
	ctx := context.Background()
	owner, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(owner.Close)
	// Each test has its own schema: no shared catalog rows, grant counts or
	// bootstrap fixture ordering, including when packages execute concurrently.
	schema := fmt.Sprintf("ac009_%d_%d", os.Getpid(), catalogSchemaSequence.Add(1))
	if _, err := owner.Exec(ctx, `CREATE SCHEMA `+pgx.Identifier{schema}.Sanitize()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := owner.Exec(context.Background(), `DROP SCHEMA `+pgx.Identifier{schema}.Sanitize()+` CASCADE`); err != nil {
			t.Error(err)
		}
	})
	config, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	config.ConnConfig.RuntimeParams["search_path"] = schema + ",public"
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if err := migrate.Run(ctx, pool, "../../../../db/migrations"); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO schools(id,name,slug) VALUES($1,'Fixture School','fixture-school')`, catalogSchoolID); err != nil {
		t.Fatal(err)
	}
	for _, user := range []struct{ id, email string }{{catalogActorID, "actor@example.edu"}, {catalogTargetID, "target@example.edu"}} {
		if _, err := pool.Exec(ctx, `INSERT INTO users(id,email,password_hash,name,home_school_id,age_confirmed_at,email_verified_at)
		 VALUES($1,$2,'credential-must-not-leak','Fixture User',$3,NOW(),NOW())`, user.id, user.email, catalogSchoolID); err != nil {
			t.Fatal(err)
		}
	}
	f := catalogFixture{pool: pool, school: schools.NewPostgresRepository(pool), game: games.NewPostgresRepository(pool), user: users.NewPostgresRepository(pool), grants: adminaccess.NewPostgresRepository(pool)}
	f.actorGrant, err = f.grants.BootstrapSiteAdmin(ctx, adminaccess.BootstrapInput{UserID: catalogActorID, OperatorIdentity: "operator@example.test", Reason: "Test bootstrap"})
	if err != nil {
		t.Fatal(err)
	}
	f.sessions, err = adminsession.NewService(adminsession.NewPostgresRepository(pool), 30*time.Minute, 8*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	identity := adminsession.StartInput{UserID: catalogActorID, GrantID: f.actorGrant.ID, AccessIssuer: "https://access.example.test", AccessSubject: "actor", AccessEmail: "actor@example.edu"}
	f.credential, err = f.sessions.Start(ctx, identity)
	if err != nil {
		t.Fatal(err)
	}
	f.credential, err = f.sessions.Rotate(ctx, f.credential.Token, identity, true)
	if err != nil {
		t.Fatal(err)
	}
	principal, err := f.sessions.Authenticate(ctx, f.credential.Token)
	if err != nil {
		t.Fatal(err)
	}
	f.command = adminmutation.Command{Correlation: adminaudit.Correlation{ActorUserID: catalogActorID, AdminSessionID: principal.SessionID, RequestID: "catalog-test"}, Reason: "Reviewed operator change"}
	f.cache = schools.NewCachedRepository(f.school, nil)
	if err := f.cache.Refresh(ctx); err != nil {
		t.Fatal(err)
	}
	f.handler = NewHandler(Config{Enabled: true, SiteOrigin: "https://admin.example.test", ProxySecret: "proxy-secret", Cookies: adminsession.CookieConfig{Name: "admin_session", CSRFName: "admin_csrf", Secure: true}}, Dependencies{
		Grants: f.grants, Sessions: f.sessions, Security: adminsecurity.NewPostgresStore(pool),
		Catalog: &CatalogDependencies{Schools: f.school, Games: f.game, Users: f.user, SiteGrants: f.grants, Cache: f.cache, Audit: adminaudit.NewPostgresStore(pool)},
	})
	return f
}

func (f catalogFixture) request(t *testing.T, method, path string, input any, status int) *httptest.ResponseRecorder {
	t.Helper()
	body, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(method, path, bytes.NewReader(body))
	req.Header.Set(ProxySecretHeader, "proxy-secret")
	req.Header.Set("Origin", "https://admin.example.test")
	req.Header.Set(CSRFHeader, f.credential.CSRFToken)
	req.AddCookie(&http.Cookie{Name: "admin_session", Value: f.credential.Token})
	req.AddCookie(&http.Cookie{Name: "admin_csrf", Value: f.credential.CSRFToken})
	response := httptest.NewRecorder()
	f.handler.ServeHTTP(response, req)
	if response.Code != status {
		t.Fatalf("%s %s: got %d, want %d: %s", method, path, response.Code, status, response.Body.String())
	}
	assertPrivateHeaders(t, response.Header())
	return response
}

func decodeCatalog[T any](t *testing.T, response *httptest.ResponseRecorder) T {
	t.Helper()
	var result T
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	return result
}

func TestCatalogHTTPCommandsRefreshCacheAndProtectVersions(t *testing.T) {
	f := newCatalogFixture(t)
	ctx := t.Context()
	fields := schools.AdminFields{Name: "New <script>School</script>", Slug: "new-school", City: "Portland", State: "OR", WebsiteURL: "https://example.test", IsMainCampus: true}
	input := schools.AdminEdit{Command: f.command, AdminFields: fields}
	school := decodeCatalog[schools.AdminSchool](t, f.request(t, "POST", "/admin/v1/schools", input, 201))
	if !reflect.DeepEqual(school.AdminFields, fields) {
		t.Fatalf("fields: %#v", school.AdminFields)
	}
	public, err := f.cache.GetByID(ctx, school.ID)
	if err != nil || public.Name != fields.Name {
		t.Fatalf("committed school missing from cache: %#v %v", public, err)
	}
	f.request(t, "POST", "/admin/v1/schools", input, 409)
	input.ExpectedUpdatedAt = school.UpdatedAt
	input.Name = "Edited School"
	updated := decodeCatalog[schools.AdminSchool](t, f.request(t, "PATCH", "/admin/v1/schools/"+school.ID, input, 200))
	conflict := decodeCatalog[struct {
		Error   string              `json:"error"`
		Current schools.AdminSchool `json:"current"`
	}](t, f.request(t, "PATCH", "/admin/v1/schools/"+school.ID, input, 409))
	if conflict.Error != "admin_record_conflict" || !reflect.DeepEqual(conflict.Current, updated) {
		t.Fatalf("stale response: %#v", conflict)
	}
	command := f.command
	command.ExpectedUpdatedAt = updated.UpdatedAt
	inactive := decodeCatalog[schools.AdminSchool](t, f.request(t, "POST", "/admin/v1/schools/"+school.ID+"/deactivate", command, 200))
	if _, err := f.cache.GetByID(ctx, school.ID); !errors.Is(err, schools.ErrSchoolNotFound) {
		t.Fatalf("inactive school in cache: %v", err)
	}
	command.ExpectedUpdatedAt = inactive.UpdatedAt
	active := decodeCatalog[schools.AdminSchool](t, f.request(t, "POST", "/admin/v1/schools/"+school.ID+"/reactivate", command, 200))
	command.ExpectedUpdatedAt = active.UpdatedAt
	deleted := decodeCatalog[schools.AdminSchool](t, f.request(t, "DELETE", "/admin/v1/schools/"+school.ID, command, 200))
	if deleted.DeletedAt == nil || deleted.IsActive {
		t.Fatalf("delete: %#v", deleted)
	}
	f.request(t, "GET", "/admin/v1/schools?state=deleted&q=edited", nil, 200)
	if _, err := f.pool.Exec(ctx, `INSERT INTO user_school_follows(user_id,school_id) VALUES($1,$2)`, catalogActorID, school.ID); err == nil {
		t.Fatal("new reference to deleted school accepted")
	}
	fixtureSchool, err := f.school.GetAdmin(ctx, catalogSchoolID)
	if err != nil {
		t.Fatal(err)
	}
	command.ExpectedUpdatedAt = fixtureSchool.UpdatedAt
	f.request(t, "DELETE", "/admin/v1/schools/"+catalogSchoolID, command, 409)
	gameInput := games.AdminEdit{Command: f.command, Name: "New Game", Slug: "new-game", IsActive: true}
	game := decodeCatalog[games.AdminGame](t, f.request(t, "POST", "/admin/v1/games", gameInput, 201))
	gameInput.ExpectedUpdatedAt = game.UpdatedAt
	gameInput.IsActive = false
	game = decodeCatalog[games.AdminGame](t, f.request(t, "PATCH", "/admin/v1/games/"+game.ID, gameInput, 200))
	if _, err := f.game.GetBySlug(ctx, game.Slug); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("inactive game visible: %v", err)
	}
	gameInput.ExpectedUpdatedAt = game.UpdatedAt
	gameInput.IsActive = true
	game = decodeCatalog[games.AdminGame](t, f.request(t, "PATCH", "/admin/v1/games/"+game.ID, gameInput, 200))
	command.ExpectedUpdatedAt = game.UpdatedAt
	f.request(t, "DELETE", "/admin/v1/games/"+game.ID, command, 200)
	audit := decodeCatalog[struct {
		Entries []adminaudit.Entry `json:"audit_entries"`
	}](t, f.request(t, "GET", "/admin/v1/schools/"+school.ID+"/audit", nil, 200))
	if len(audit.Entries) != 5 {
		t.Fatalf("audit count %d", len(audit.Entries))
	}
	for _, entry := range audit.Entries {
		if entry.ActorUserID == nil || *entry.ActorUserID != catalogActorID || entry.AdminSessionID == nil || entry.RequestID == nil {
			t.Fatalf("audit correlation: %#v", entry)
		}
		if err := adminaudit.ValidateSafeDocuments(entry.Before, entry.After, entry.Metadata); err != nil {
			t.Fatal(err)
		}
	}
}

func TestSchoolGrantHTTPPreservesHistoryAndScopesGrantIDs(t *testing.T) {
	f := newCatalogFixture(t)
	ctx := t.Context()
	input := schools.GrantAdminInput{Command: f.command, UserID: catalogTargetID}
	grant := decodeCatalog[schools.AdminGrant](t, f.request(t, "POST", "/admin/v1/schools/"+catalogSchoolID+"/admin-grants", input, 201))
	publicSessions := auth.NewSessionRepository(f.pool)
	if err := publicSessions.CreateSession(ctx, catalogTargetID, []byte("school-grant-token"), time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	command := f.command
	command.ExpectedUpdatedAt = grant.UpdatedAt
	f.request(t, "POST", "/admin/v1/schools/10000000-0000-4000-8000-000000000099/admin-grants/"+grant.ID+"/revoke", command, 404)
	revoked := decodeCatalog[schools.AdminGrant](t, f.request(t, "POST", "/admin/v1/schools/"+catalogSchoolID+"/admin-grants/"+grant.ID+"/revoke", command, 200))
	if _, err := publicSessions.FindSession(ctx, []byte("school-grant-token")); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("public session survived revocation: %v", err)
	}
	input.ExpectedUpdatedAt = revoked.UpdatedAt
	restored := decodeCatalog[schools.AdminGrant](t, f.request(t, "POST", "/admin/v1/schools/"+catalogSchoolID+"/admin-grants", input, 201))
	if restored.ID != grant.ID || restored.RevokedAt != nil || !restored.CreatedAt.Equal(grant.CreatedAt) {
		t.Fatalf("grant row not restored: %#v", restored)
	}
	audit := decodeCatalog[struct {
		Entries []adminaudit.Entry `json:"audit_entries"`
	}](t, f.request(t, "GET", "/admin/v1/schools/"+catalogSchoolID+"/admin-grants/"+grant.ID+"/audit", nil, 200))
	if len(audit.Entries) != 3 {
		t.Fatalf("grant history: %#v", audit)
	}
	f.request(t, "GET", "/admin/v1/schools/10000000-0000-4000-8000-000000000099/admin-grants/"+grant.ID+"/audit", nil, 404)
}

func TestUserStatusTrustAndSiteGrantHTTP(t *testing.T) {
	f := newCatalogFixture(t)
	ctx := t.Context()
	u, err := f.user.GetAdmin(ctx, catalogTargetID)
	if err != nil {
		t.Fatal(err)
	}
	command := f.command
	command.ExpectedUpdatedAt = u.UpdatedAt
	grant := decodeCatalog[adminaccess.Grant](t, f.request(t, "POST", "/admin/v1/site-admin-grants", struct {
		adminmutation.Command
		UserID string `json:"user_id"`
	}{command, catalogTargetID}, 201))
	credential, err := f.sessions.Start(ctx, adminsession.StartInput{UserID: catalogTargetID, GrantID: grant.ID, AccessIssuer: "https://access.example.test", AccessSubject: "target", AccessEmail: "target@example.edu"})
	if err != nil {
		t.Fatal(err)
	}
	u, err = f.user.GetAdmin(ctx, catalogTargetID)
	if err != nil {
		t.Fatal(err)
	}
	command.ExpectedUpdatedAt = u.UpdatedAt
	public := auth.NewSessionRepository(f.pool)
	if err := public.CreateSession(ctx, catalogTargetID, []byte("target-token"), time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	suspended := decodeCatalog[users.AdminUser](t, f.request(t, "POST", "/admin/v1/users/"+catalogTargetID+"/suspend", command, 200))
	if suspended.AccountStatus != "suspended" {
		t.Fatalf("status: %#v", suspended)
	}
	lastCommand := f.command
	lastCommand.ExpectedUpdatedAt = f.actorGrant.GrantedAt
	f.request(t, "POST", "/admin/v1/site-admin-grants/"+f.actorGrant.ID+"/revoke", lastCommand, 409)
	command.ExpectedUpdatedAt = suspended.UpdatedAt
	reactivated := decodeCatalog[users.AdminUser](t, f.request(t, "POST", "/admin/v1/users/"+catalogTargetID+"/reactivate", command, 200))
	if _, err := f.sessions.Authenticate(ctx, credential.Token); !errors.Is(err, adminsession.ErrUnauthenticated) {
		t.Fatalf("admin session revived: %v", err)
	}
	if _, err := public.FindSession(ctx, []byte("target-token")); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("public session revived: %v", err)
	}
	command.ExpectedUpdatedAt = reactivated.UpdatedAt
	staff := true
	trusted := decodeCatalog[users.AdminUser](t, f.request(t, "PATCH", "/admin/v1/users/"+catalogTargetID+"/trust-grants", users.TrustChange{Command: command, StaffFaculty: &staff}, 200))
	if trusted.VerificationLevel != "staff_faculty" {
		t.Fatalf("trust: %#v", trusted)
	}
	command.ExpectedUpdatedAt = trusted.UpdatedAt
	staff = false
	untrusted := decodeCatalog[users.AdminUser](t, f.request(t, "PATCH", "/admin/v1/users/"+catalogTargetID+"/trust-grants", users.TrustChange{Command: command, StaffFaculty: &staff}, 200))
	if untrusted.VerificationLevel != "verified" {
		t.Fatalf("trust revocation lost edu verification: %#v", untrusted)
	}
	credential, err = f.sessions.Start(ctx, adminsession.StartInput{UserID: catalogTargetID, GrantID: grant.ID, AccessIssuer: "https://access.example.test", AccessSubject: "target", AccessEmail: "target@example.edu"})
	if err != nil {
		t.Fatal(err)
	}
	command.ExpectedUpdatedAt = grant.GrantedAt
	f.request(t, "POST", "/admin/v1/site-admin-grants/"+grant.ID+"/revoke", command, 200)
	if _, err := f.sessions.Authenticate(ctx, credential.Token); !errors.Is(err, adminsession.ErrUnauthenticated) {
		t.Fatalf("site revocation left a session active: %v", err)
	}
	// A stale grant form cannot restore access after another operator revoked it.
	command.ExpectedUpdatedAt = u.UpdatedAt
	f.request(t, "POST", "/admin/v1/site-admin-grants", struct {
		adminmutation.Command
		UserID string `json:"user_id"`
	}{command, catalogTargetID}, 409)
	command.ExpectedUpdatedAt = f.actorGrant.GrantedAt
	f.request(t, "POST", "/admin/v1/site-admin-grants/"+f.actorGrant.ID+"/revoke", command, 409)
	actor, err := f.user.GetAdmin(ctx, catalogActorID)
	if err != nil {
		t.Fatal(err)
	}
	command.ExpectedUpdatedAt = actor.UpdatedAt
	f.request(t, "POST", "/admin/v1/users/"+catalogActorID+"/suspend", command, 409)
	if err := f.user.DeleteAccount(ctx, catalogActorID); !errors.Is(err, adminaccess.ErrLastActiveSiteAdmin) {
		t.Fatalf("last admin deletion: %v", err)
	}
	response := f.request(t, "GET", "/admin/v1/users/"+catalogTargetID, nil, 200)
	for _, forbidden := range []string{"password_hash", "credential-must-not-leak", "token_hash", "access_subject"} {
		if strings.Contains(response.Body.String(), forbidden) {
			t.Fatalf("user response leaked %s", forbidden)
		}
	}
}

func TestCatalogRejectsUnknownFieldsAndUnsupportedTransitions(t *testing.T) {
	f := newCatalogFixture(t)
	user, err := f.user.GetAdmin(t.Context(), catalogTargetID)
	if err != nil {
		t.Fatal(err)
	}
	for _, body := range []map[string]any{
		{"expected_updated_at": user.UpdatedAt, "reason": "Reviewed", "staff_faculty": true, "site_admin": true},
		{"expected_updated_at": user.UpdatedAt, "reason": "Reviewed", "verification_level": "staff_faculty"},
		{"expected_updated_at": user.UpdatedAt, "reason": "", "staff_faculty": true},
		{"reason": "Reviewed", "staff_faculty": true},
		{"expected_updated_at": user.UpdatedAt, "reason": "Reviewed", "staff_faculty": nil},
	} {
		f.request(t, "PATCH", "/admin/v1/users/"+catalogTargetID+"/trust-grants", body, 400)
	}
	actual, err := f.user.GetAdmin(t.Context(), catalogTargetID)
	if err != nil || !reflect.DeepEqual(actual, user) {
		t.Fatalf("invalid trust input mutated user: %#v %v", actual, err)
	}
	for _, fields := range []schools.AdminFields{
		{Name: "Invalid URL", Slug: "bad-url", WebsiteURL: "javascript:alert(1)"},
		{Name: "Invalid slug", Slug: "../admin"},
		{Name: "Invalid branches", Slug: "bad-branches", NumBranches: -1},
	} {
		f.request(t, "POST", "/admin/v1/schools", schools.AdminEdit{Command: f.command, AdminFields: fields}, 400)
	}
	command := f.command
	command.ExpectedUpdatedAt = user.UpdatedAt
	f.request(t, "POST", "/admin/v1/users/"+catalogTargetID+"/reactivate", command, 409)
}

func TestCatalogPaginationAndLiteralSearch(t *testing.T) {
	f := newCatalogFixture(t)
	ctx := t.Context()
	for index := 0; index < 4; index++ {
		_, err := f.game.CreateAdmin(ctx, games.AdminEdit{Command: f.command, Name: fmt.Sprintf("Page_%d", index), Slug: fmt.Sprintf("page-%d", index), IsActive: true})
		if err != nil {
			t.Fatal(err)
		}
	}
	filter := adminmutation.Filter{Query: "Page_", Limit: 3}
	items, err := f.game.ListAdmin(ctx, filter)
	if err != nil {
		t.Fatal(err)
	}
	first := makeCursorPage(items, 2, nil, nil, func(g games.AdminGame) (time.Time, string) { return g.CreatedAt, g.ID })
	cursor, err := pagecursor.Decode(first.NextCursor)
	if err != nil {
		t.Fatal(err)
	}
	filter.After = &cursor
	items, err = f.game.ListAdmin(ctx, filter)
	if err != nil {
		t.Fatal(err)
	}
	second := makeCursorPage(items, 2, filter.After, nil, func(g games.AdminGame) (time.Time, string) { return g.CreatedAt, g.ID })
	back, err := pagecursor.Decode(second.PreviousCursor)
	if err != nil {
		t.Fatal(err)
	}
	filter.After = nil
	filter.Before = &back
	items, err = f.game.ListAdmin(ctx, filter)
	if err != nil {
		t.Fatal(err)
	}
	previous := makeCursorPage(items, 2, nil, filter.Before, func(g games.AdminGame) (time.Time, string) { return g.CreatedAt, g.ID })
	if len(first.Items) != 2 || len(second.Items) != 2 || !reflect.DeepEqual(previous, first) {
		t.Fatalf("pages: %#v %#v %#v", first, second, previous)
	}
	users, err := f.user.ListAdmin(ctx, adminmutation.Filter{Query: "%", Limit: 10})
	if err != nil || len(users) != 0 {
		t.Fatalf("wildcard broadened search: %#v %v", users, err)
	}
	f.request(t, "GET", "/admin/v1/users?limit=101", nil, 400)
	f.request(t, "GET", "/admin/v1/users?q=a&q=b", nil, 400)
}

func TestCatalogAuditFailuresRollBackDomainAndSessionChanges(t *testing.T) {
	f := newCatalogFixture(t)
	ctx := t.Context()
	game, err := f.game.CreateAdmin(ctx, games.AdminEdit{Command: f.command, Name: "Rollback", Slug: "rollback", IsActive: true})
	if err != nil {
		t.Fatal(err)
	}
	school, err := f.school.GetAdmin(ctx, catalogSchoolID)
	if err != nil {
		t.Fatal(err)
	}
	user, err := f.user.GetAdmin(ctx, catalogTargetID)
	if err != nil {
		t.Fatal(err)
	}
	grant, err := f.school.GrantAdmin(ctx, catalogSchoolID, schools.GrantAdminInput{Command: f.command, UserID: catalogTargetID})
	if err != nil {
		t.Fatal(err)
	}
	public := auth.NewSessionRepository(f.pool)
	if err := public.CreateSession(ctx, catalogTargetID, []byte("rollback-session"), time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(ctx, `CREATE FUNCTION reject_test_audit() RETURNS TRIGGER LANGUAGE plpgsql AS $$
	BEGIN IF NEW.request_id='forced-audit-failure' THEN RAISE EXCEPTION 'forced audit failure'; END IF; RETURN NEW; END; $$;
	CREATE TRIGGER reject_test_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_test_audit()`); err != nil {
		t.Fatal(err)
	}
	bad := f.command
	bad.Correlation.RequestID = "forced-audit-failure"
	bad.ExpectedUpdatedAt = game.UpdatedAt
	if _, err := f.game.UpdateAdmin(ctx, game.ID, games.AdminEdit{Command: bad, Name: "Must roll back", Slug: game.Slug, IsActive: true}); err == nil {
		t.Fatal("game audit failure was ignored")
	}
	actualGame, err := f.game.GetAdmin(ctx, game.ID)
	if err != nil || !reflect.DeepEqual(actualGame, game) {
		t.Fatalf("game rollback: %#v %v", actualGame, err)
	}
	bad.ExpectedUpdatedAt = school.UpdatedAt
	if _, err := f.school.DeactivateAdmin(ctx, school.ID, bad); err == nil {
		t.Fatal("school audit failure was ignored")
	}
	actualSchool, err := f.school.GetAdmin(ctx, school.ID)
	if err != nil || !reflect.DeepEqual(actualSchool, school) {
		t.Fatalf("school rollback: %#v %v", actualSchool, err)
	}
	bad.ExpectedUpdatedAt = user.UpdatedAt
	if _, err := f.user.SuspendAdmin(ctx, user.ID, bad); err == nil {
		t.Fatal("user security/audit failure was ignored")
	}
	actualUser, err := f.user.GetAdmin(ctx, user.ID)
	// The school grant was created after the original account read.
	user.SchoolAdminCount = 1
	if err != nil || !reflect.DeepEqual(actualUser, user) {
		t.Fatalf("user rollback: %#v want %#v: %v", actualUser, user, err)
	}
	bad.ExpectedUpdatedAt = grant.UpdatedAt
	if _, err := f.school.RevokeAdmin(ctx, school.ID, grant.ID, bad); err == nil {
		t.Fatal("grant audit failure was ignored")
	}
	actualGrant, err := f.school.GetAdminGrant(ctx, school.ID, grant.ID)
	if err != nil || !reflect.DeepEqual(actualGrant, grant) {
		t.Fatalf("grant rollback: %#v %v", actualGrant, err)
	}
	if _, err := public.FindSession(ctx, []byte("rollback-session")); err != nil {
		t.Fatalf("rolled back revocation ended public session: %v", err)
	}
}

func TestConcurrentCatalogUpdatesAndLastAdministratorChanges(t *testing.T) {
	f := newCatalogFixture(t)
	ctx := t.Context()
	game, err := f.game.CreateAdmin(ctx, games.AdminEdit{Command: f.command, Name: "Concurrent", Slug: "concurrent", IsActive: true})
	if err != nil {
		t.Fatal(err)
	}
	command := f.command
	command.ExpectedUpdatedAt = game.UpdatedAt
	start := make(chan struct{})
	results := make(chan error, 2)
	for _, name := range []string{"First", "Second"} {
		go func() {
			<-start
			_, err := f.game.UpdateAdmin(ctx, game.ID, games.AdminEdit{Command: command, Name: name, Slug: game.Slug, IsActive: true})
			results <- err
		}()
	}
	close(start)
	errorsSeen := []error{<-results, <-results}
	if !((errorsSeen[0] == nil && errors.Is(errorsSeen[1], adminmutation.ErrConflict)) || (errorsSeen[1] == nil && errors.Is(errorsSeen[0], adminmutation.ErrConflict))) {
		t.Fatalf("concurrent edits: %v", errorsSeen)
	}
	target, err := f.grants.GrantRole(ctx, adminaccess.GrantInput{UserID: catalogTargetID, Role: adminaccess.RoleSiteAdmin, ActorUserID: catalogActorID, Reason: "Second administrator"})
	if err != nil {
		t.Fatal(err)
	}
	user, err := f.user.GetAdmin(ctx, catalogTargetID)
	if err != nil {
		t.Fatal(err)
	}
	command.ExpectedUpdatedAt = user.UpdatedAt
	start = make(chan struct{})
	go func() { <-start; _, err := f.user.SuspendAdmin(ctx, catalogTargetID, command); results <- err }()
	go func() {
		<-start
		_, err := f.grants.RevokeRole(ctx, adminaccess.RevokeInput{UserID: catalogActorID, Role: adminaccess.RoleSiteAdmin, ActorUserID: catalogTargetID, Reason: "Concurrent removal"})
		results <- err
	}()
	close(start)
	errorsSeen = []error{<-results, <-results}
	if (errorsSeen[0] == nil) == (errorsSeen[1] == nil) {
		t.Fatalf("expected exactly one removal: %v", errorsSeen)
	}
	for _, err := range errorsSeen {
		if err != nil && !errors.Is(err, adminaccess.ErrLastActiveSiteAdmin) && !errors.Is(err, adminaccess.ErrSiteAdminRequired) {
			t.Fatalf("unexpected concurrent removal failure: %v", err)
		}
	}
	var remaining int
	if err := f.pool.QueryRow(ctx, `SELECT count(*) FROM site_role_grants g JOIN users u ON u.id=g.user_id
	 WHERE g.revoked_at IS NULL AND u.account_status='active' AND u.deleted_at IS NULL AND u.email_verified_at IS NOT NULL`).Scan(&remaining); err != nil || remaining != 1 {
		t.Fatalf("remaining admins %d: %v (target %s)", remaining, err, target.ID)
	}
}

func TestGameDependenciesAndDeletedCatalogReferences(t *testing.T) {
	f := newCatalogFixture(t)
	ctx := t.Context()
	game, err := f.game.CreateAdmin(ctx, games.AdminEdit{Command: f.command, Name: "Team Game", Slug: "team-game", IsActive: true})
	if err != nil {
		t.Fatal(err)
	}
	var teamID string
	if err := f.pool.QueryRow(ctx, `INSERT INTO teams(owner_user_id,name,slug,password_hash) VALUES($1,'Team','team','hash') RETURNING id::text`, catalogTargetID).Scan(&teamID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(ctx, `INSERT INTO team_games(team_id,game_id) VALUES($1,$2)`, teamID, game.ID); err != nil {
		t.Fatal(err)
	}
	command := f.command
	command.ExpectedUpdatedAt = game.UpdatedAt
	if _, err := f.game.DeleteAdmin(ctx, game.ID, command); !errors.Is(err, adminmutation.ErrDependencies) {
		t.Fatalf("referenced game delete: %v", err)
	}
	if _, err := f.pool.Exec(ctx, `DELETE FROM team_games WHERE team_id=$1`, teamID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.game.DeleteAdmin(ctx, game.ID, command); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(ctx, `INSERT INTO team_games(team_id,game_id) VALUES($1,$2)`, teamID, game.ID); err == nil {
		t.Fatal("new reference to deleted game accepted")
	}
}

func TestCatalogDeleteWaitsForConcurrentReferenceThenRejectsIt(t *testing.T) {
	f := newCatalogFixture(t)
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	game, err := f.game.CreateAdmin(ctx, games.AdminEdit{Command: f.command, Name: "Referenced", Slug: "referenced", IsActive: true})
	if err != nil {
		t.Fatal(err)
	}
	var teamID string
	if err := f.pool.QueryRow(ctx, `INSERT INTO teams(owner_user_id,name,slug,password_hash) VALUES($1,'Concurrent Team','concurrent-team','hash') RETURNING id::text`, catalogTargetID).Scan(&teamID); err != nil {
		t.Fatal(err)
	}
	tx, err := f.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	if _, err := tx.Exec(ctx, `INSERT INTO team_games(team_id,game_id) VALUES($1,$2)`, teamID, game.ID); err != nil {
		t.Fatal(err)
	}
	var pid int
	if err := tx.QueryRow(ctx, `SELECT pg_backend_pid()`).Scan(&pid); err != nil {
		t.Fatal(err)
	}
	command := f.command
	command.ExpectedUpdatedAt = game.UpdatedAt
	result := make(chan error, 1)
	go func() { _, err := f.game.DeleteAdmin(ctx, game.ID, command); result <- err }()
	// Wait for the observable PostgreSQL lock, not an assumed scheduling delay.
	for {
		var blocked bool
		if err := f.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)))`, pid).Scan(&blocked); err != nil {
			t.Fatal(err)
		}
		if blocked {
			break
		}
		select {
		case err := <-result:
			t.Fatalf("delete did not wait for uncommitted reference: %v", err)
		default:
		}
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if err := <-result; !errors.Is(err, adminmutation.ErrDependencies) {
		t.Fatalf("concurrent reference missed: %v", err)
	}
}
