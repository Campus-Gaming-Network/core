package adminhttp

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminaccess"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminaudit"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminmutation"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminsession"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/games"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/schools"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/users"
)

// Every admin mutation route commits exactly one audit row with the verified
// actor, session, and request id, and rolls its whole change back when that
// audit row cannot be written. The table is checked against the route
// registry, so a new mutation route cannot ship without joining it.

type mutationRequest struct {
	method string
	path   string
	body   any
}

type mutationCase struct {
	action  adminaudit.Action
	prepare func(t *testing.T, f catalogFixture) mutationRequest
}

// Logo routes carry multipart uploads and a second failure domain, the object
// store, so their success audits and rollbacks live with the upload tests.
var mutationsCoveredByLogoTests = map[routeOperation]string{
	"school_logos.upload": "TestSchoolLogoHTTPReplacesRemovesAndCleansUp, TestSchoolLogoFailuresNeverLeaveAReferencedOrOrphanedObject",
	"school_logos.remove": "TestSchoolLogoHTTPReplacesRemovesAndCleansUp, TestSchoolLogoFailuresNeverLeaveAReferencedOrOrphanedObject",
}

func (f catalogFixture) newSchool(t *testing.T, slug string) schools.AdminSchool {
	t.Helper()
	school, err := f.school.CreateAdmin(t.Context(), schools.AdminEdit{
		Command:     f.command,
		AdminFields: schools.AdminFields{Name: "Matrix " + slug, Slug: slug, State: "OR", IsMainCampus: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	return school
}

func (f catalogFixture) versioned(updatedAt time.Time) adminmutation.Command {
	command := f.command
	command.ExpectedUpdatedAt = updatedAt
	return command
}

func (f catalogFixture) insertQueueRow(t *testing.T, table string) (string, time.Time) {
	t.Helper()
	var id string
	var updatedAt time.Time
	query := map[string]string{
		"reports": `INSERT INTO reports (reporter_user_id, target_type, target_id, reason)
			VALUES ($1::uuid, 'user', $2::uuid, 'Matrix report') RETURNING id::text, updated_at`,
		"support_tickets": `INSERT INTO support_tickets (submitter_user_id, contact_email, subject, message)
			VALUES ($1::uuid, 'target@example.edu', 'Matrix ticket', 'Matrix message') RETURNING id::text, updated_at`,
	}[table]
	args := []any{catalogTargetID, catalogActorID}
	if table == "support_tickets" {
		args = args[:1]
	}
	if err := f.pool.QueryRow(t.Context(), query, args...).Scan(&id, &updatedAt); err != nil {
		t.Fatal(err)
	}
	return id, updatedAt
}

var mutationCases = map[routeOperation]mutationCase{
	"schools.create": {adminaudit.ActionSchoolCreated, func(t *testing.T, f catalogFixture) mutationRequest {
		return mutationRequest{"POST", "/admin/v1/schools", schools.AdminEdit{
			Command:     f.command,
			AdminFields: schools.AdminFields{Name: "Created School", Slug: "created-school", State: "OR", IsMainCampus: true},
		}}
	}},
	"schools.update": {adminaudit.ActionSchoolUpdated, func(t *testing.T, f catalogFixture) mutationRequest {
		school := f.newSchool(t, "update-me")
		edit := schools.AdminEdit{Command: f.versioned(school.UpdatedAt), AdminFields: school.AdminFields}
		edit.Name = "Updated School"
		return mutationRequest{"PATCH", "/admin/v1/schools/" + school.ID, edit}
	}},
	"schools.deactivate": {adminaudit.ActionSchoolDeactivated, func(t *testing.T, f catalogFixture) mutationRequest {
		school := f.newSchool(t, "deactivate-me")
		return mutationRequest{"POST", "/admin/v1/schools/" + school.ID + "/deactivate", f.versioned(school.UpdatedAt)}
	}},
	"schools.reactivate": {adminaudit.ActionSchoolReactivated, func(t *testing.T, f catalogFixture) mutationRequest {
		school := f.newSchool(t, "reactivate-me")
		inactive, err := f.school.DeactivateAdmin(t.Context(), school.ID, f.versioned(school.UpdatedAt))
		if err != nil {
			t.Fatal(err)
		}
		return mutationRequest{"POST", "/admin/v1/schools/" + school.ID + "/reactivate", f.versioned(inactive.UpdatedAt)}
	}},
	"schools.delete": {adminaudit.ActionSchoolDeleted, func(t *testing.T, f catalogFixture) mutationRequest {
		school := f.newSchool(t, "delete-me")
		return mutationRequest{"DELETE", "/admin/v1/schools/" + school.ID, f.versioned(school.UpdatedAt)}
	}},
	"school_grants.grant": {adminaudit.ActionSchoolGrantGranted, func(t *testing.T, f catalogFixture) mutationRequest {
		return mutationRequest{"POST", "/admin/v1/schools/" + catalogSchoolID + "/admin-grants", schools.GrantAdminInput{Command: f.command, UserID: catalogTargetID}}
	}},
	"school_grants.revoke": {adminaudit.ActionSchoolGrantRevoked, func(t *testing.T, f catalogFixture) mutationRequest {
		grant, err := f.school.GrantAdmin(t.Context(), catalogSchoolID, schools.GrantAdminInput{Command: f.command, UserID: catalogTargetID})
		if err != nil {
			t.Fatal(err)
		}
		return mutationRequest{"POST", "/admin/v1/schools/" + catalogSchoolID + "/admin-grants/" + grant.ID + "/revoke", f.versioned(grant.UpdatedAt)}
	}},
	"games.create": {adminaudit.ActionGameCreated, func(t *testing.T, f catalogFixture) mutationRequest {
		return mutationRequest{"POST", "/admin/v1/games", games.AdminEdit{Command: f.command, Name: "Created Game", Slug: "created-game", IsActive: true}}
	}},
	"games.update": {adminaudit.ActionGameUpdated, func(t *testing.T, f catalogFixture) mutationRequest {
		game, err := f.game.CreateAdmin(t.Context(), games.AdminEdit{Command: f.command, Name: "Update Game", Slug: "update-game", IsActive: true})
		if err != nil {
			t.Fatal(err)
		}
		return mutationRequest{"PATCH", "/admin/v1/games/" + game.ID, games.AdminEdit{Command: f.versioned(game.UpdatedAt), Name: "Updated Game", Slug: game.Slug, IsActive: true}}
	}},
	"games.delete": {adminaudit.ActionGameDeleted, func(t *testing.T, f catalogFixture) mutationRequest {
		game, err := f.game.CreateAdmin(t.Context(), games.AdminEdit{Command: f.command, Name: "Delete Game", Slug: "delete-game", IsActive: true})
		if err != nil {
			t.Fatal(err)
		}
		return mutationRequest{"DELETE", "/admin/v1/games/" + game.ID, f.versioned(game.UpdatedAt)}
	}},
	"users.suspend": {adminaudit.ActionUserSuspended, func(t *testing.T, f catalogFixture) mutationRequest {
		user, err := f.user.GetAdmin(t.Context(), catalogTargetID)
		if err != nil {
			t.Fatal(err)
		}
		return mutationRequest{"POST", "/admin/v1/users/" + catalogTargetID + "/suspend", f.versioned(user.UpdatedAt)}
	}},
	"users.reactivate": {adminaudit.ActionUserReactivated, func(t *testing.T, f catalogFixture) mutationRequest {
		user, err := f.user.GetAdmin(t.Context(), catalogTargetID)
		if err != nil {
			t.Fatal(err)
		}
		suspended, err := f.user.SuspendAdmin(t.Context(), catalogTargetID, f.versioned(user.UpdatedAt))
		if err != nil {
			t.Fatal(err)
		}
		return mutationRequest{"POST", "/admin/v1/users/" + catalogTargetID + "/reactivate", f.versioned(suspended.UpdatedAt)}
	}},
	"users.trust": {adminaudit.ActionTrustChanged, func(t *testing.T, f catalogFixture) mutationRequest {
		user, err := f.user.GetAdmin(t.Context(), catalogTargetID)
		if err != nil {
			t.Fatal(err)
		}
		staff := true
		return mutationRequest{"PATCH", "/admin/v1/users/" + catalogTargetID + "/trust-grants", users.TrustChange{Command: f.versioned(user.UpdatedAt), StaffFaculty: &staff}}
	}},
	"site_grants.grant": {adminaudit.ActionSiteRoleGrantGranted, func(t *testing.T, f catalogFixture) mutationRequest {
		user, err := f.user.GetAdmin(t.Context(), catalogTargetID)
		if err != nil {
			t.Fatal(err)
		}
		return mutationRequest{"POST", "/admin/v1/site-admin-grants", struct {
			adminmutation.Command
			UserID string `json:"user_id"`
		}{f.versioned(user.UpdatedAt), catalogTargetID}}
	}},
	"site_grants.revoke": {adminaudit.ActionSiteRoleGrantRevoked, func(t *testing.T, f catalogFixture) mutationRequest {
		user, err := f.user.GetAdmin(t.Context(), catalogTargetID)
		if err != nil {
			t.Fatal(err)
		}
		granted := decodeCatalog[struct {
			ID        string    `json:"id"`
			GrantedAt time.Time `json:"granted_at"`
		}](t, f.request(t, "POST", "/admin/v1/site-admin-grants", struct {
			adminmutation.Command
			UserID string `json:"user_id"`
		}{f.versioned(user.UpdatedAt), catalogTargetID}, 201))
		return mutationRequest{"POST", "/admin/v1/site-admin-grants/" + granted.ID + "/revoke", f.versioned(granted.GrantedAt)}
	}},
	operationPatchReport: {adminaudit.ActionReportUpdated, func(t *testing.T, f catalogFixture) mutationRequest {
		id, updatedAt := f.insertQueueRow(t, "reports")
		return mutationRequest{"PATCH", "/admin/v1/reports/" + id, map[string]any{"expected_updated_at": updatedAt, "status": "in_review"}}
	}},
	operationPatchSupport: {adminaudit.ActionSupportTicketUpdated, func(t *testing.T, f catalogFixture) mutationRequest {
		id, updatedAt := f.insertQueueRow(t, "support_tickets")
		return mutationRequest{"PATCH", "/admin/v1/support-tickets/" + id, map[string]any{"expected_updated_at": updatedAt, "status": "in_review"}}
	}},
}

func (f catalogFixture) send(t *testing.T, request mutationRequest) (*httptest.ResponseRecorder, RequestInfo) {
	t.Helper()
	body, err := json.Marshal(request.body)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(request.method, request.path, bytes.NewReader(body))
	req.Header.Set(ProxySecretHeader, "proxy-secret")
	req.Header.Set(AccessEmailHeader, "actor@example.edu")
	req.Header.Set("Origin", "https://admin.example.test")
	req.Header.Set(CSRFHeader, f.credential.CSRFToken)
	req.AddCookie(&http.Cookie{Name: "admin_session", Value: f.credential.Token})
	req.AddCookie(&http.Cookie{Name: "admin_csrf", Value: f.credential.CSRFToken})
	info := &RequestInfo{}
	req = req.WithContext(ContextWithRequestInfo(req.Context(), info))
	response := httptest.NewRecorder()
	f.handler.ServeHTTP(response, req)
	return response, *info
}

func (f catalogFixture) domainDigest(t *testing.T) map[string]string {
	t.Helper()
	digests := map[string]string{}
	for _, table := range []string{"schools", "games", "users", "reports", "support_tickets", "audit_logs", "site_role_grants", "school_admins"} {
		var digest string
		if err := f.pool.QueryRow(t.Context(), `SELECT MD5(COALESCE(STRING_AGG(row_data, '' ORDER BY row_data), '')) FROM (SELECT t::text AS row_data FROM `+table+` t) rows`).Scan(&digest); err != nil {
			t.Fatal(err)
		}
		digests[table] = digest
	}
	return digests
}

func TestEveryMutationRouteAuditsOnceAndRollsBackWithoutAnAuditRow(t *testing.T) {
	// The table must name every mutation route, so none escapes the check.
	for _, route := range routes {
		if !route.Mutation || route.Control != controlCapability {
			continue
		}
		_, tested := mutationCases[route.Operation]
		_, elsewhere := mutationsCoveredByLogoTests[route.Operation]
		if tested == elsewhere {
			t.Errorf("mutation route %s %s (%s) must be in exactly one of the mutation table and the logo-test list", route.Method, route.Path, route.Operation)
		}
	}
	for operation := range mutationCases {
		found := false
		for _, route := range routes {
			found = found || route.Operation == operation
		}
		if !found {
			t.Errorf("mutation table names %s, which is not a registered route", operation)
		}
	}

	for operation, test := range mutationCases {
		t.Run(string(operation), func(t *testing.T) {
			f := newCatalogFixture(t)
			ctx := t.Context()
			// A switch that makes every audit insert fail while it holds a row.
			if _, err := f.pool.Exec(ctx, `
				CREATE TABLE audit_failure_switch (engaged BOOLEAN);
				CREATE FUNCTION reject_switched_audit() RETURNS TRIGGER LANGUAGE plpgsql AS $$
				BEGIN
					IF EXISTS (SELECT 1 FROM audit_failure_switch) THEN RAISE EXCEPTION 'forced audit failure'; END IF;
					RETURN NEW;
				END; $$;
				CREATE TRIGGER reject_switched_audit BEFORE INSERT ON audit_logs
					FOR EACH ROW EXECUTE FUNCTION reject_switched_audit();
			`); err != nil {
				t.Fatal(err)
			}
			request := test.prepare(t, f)

			// Without an audit row, the whole mutation rolls back.
			before := f.domainDigest(t)
			if _, err := f.pool.Exec(ctx, `INSERT INTO audit_failure_switch VALUES (TRUE)`); err != nil {
				t.Fatal(err)
			}
			failed, info := f.send(t, request)
			if failed.Code < 500 || info.ErrorClass != ErrorClassAuditWrite {
				t.Fatalf("audit failure: status %d class %q: %s", failed.Code, info.ErrorClass, failed.Body.String())
			}
			if after := f.domainDigest(t); !reflect.DeepEqual(before, after) {
				t.Fatalf("a failed audit left a change behind:\nbefore %v\nafter  %v", before, after)
			}

			// With it, the same request commits and leaves exactly one row.
			if _, err := f.pool.Exec(ctx, `DELETE FROM audit_failure_switch`); err != nil {
				t.Fatal(err)
			}
			var auditBefore int
			if err := f.pool.QueryRow(ctx, `SELECT COUNT(*) FROM audit_logs`).Scan(&auditBefore); err != nil {
				t.Fatal(err)
			}
			succeeded, _ := f.send(t, request)
			if succeeded.Code < 200 || succeeded.Code >= 300 {
				t.Fatalf("mutation: status %d: %s", succeeded.Code, succeeded.Body.String())
			}
			rows, err := f.pool.Query(ctx, `
				SELECT actor_user_id::text, admin_session_id::text, request_id, action,
				       before_json::text, after_json::text, metadata::text
				FROM audit_logs ORDER BY created_at, id OFFSET $1`, auditBefore)
			if err != nil {
				t.Fatal(err)
			}
			defer rows.Close()
			var count int
			for rows.Next() {
				count++
				var actor, session, requestID, action, beforeJSON, afterJSON, metadata string
				if err := rows.Scan(&actor, &session, &requestID, &action, &beforeJSON, &afterJSON, &metadata); err != nil {
					t.Fatal(err)
				}
				principal, err := f.sessions.Authenticate(ctx, f.credential.Token)
				if err != nil {
					t.Fatal(err)
				}
				if actor != catalogActorID || session != principal.SessionID ||
					requestID != succeeded.Header().Get(RequestIDHeader) || action != string(test.action) {
					t.Fatalf("audit row = actor %s session %s request %s action %s; want %s, %s, %s, %s",
						actor, session, requestID, action, catalogActorID, principal.SessionID, succeeded.Header().Get(RequestIDHeader), test.action)
				}
				if err := adminaudit.ValidateSafeDocuments([]byte(beforeJSON), []byte(afterJSON), []byte(metadata)); err != nil {
					t.Fatalf("audit row holds unsafe data: %v", err)
				}
				// Bodies, tokens, and contact details never enter the audit row.
				for _, forbidden := range []string{"credential-must-not-leak", f.credential.Token, f.credential.CSRFToken, "target@example.edu"} {
					if strings.Contains(beforeJSON+afterJSON+metadata, forbidden) {
						t.Fatalf("audit row contains %q", forbidden)
					}
				}
			}
			if count != 1 {
				t.Fatalf("audit rows written = %d, want exactly 1", count)
			}

			// A replay is stale or a duplicate: it fails on the domain side, and a
			// failed mutation never claims success in the audit log.
			replay, _ := f.send(t, request)
			if replay.Code < 400 || replay.Code >= 500 {
				t.Fatalf("replay: status %d, want a 4xx: %s", replay.Code, replay.Body.String())
			}
			var auditAfter int
			if err := f.pool.QueryRow(ctx, `SELECT COUNT(*) FROM audit_logs`).Scan(&auditAfter); err != nil {
				t.Fatal(err)
			}
			if auditAfter != auditBefore+1 {
				t.Fatalf("a failed replay wrote an audit row: %d rows, want %d", auditAfter, auditBefore+1)
			}
		})
	}
}

func TestNoAuditRouteCanChangeAnAuditRecord(t *testing.T) {
	audits := 0
	for _, route := range routes {
		if strings.HasSuffix(route.Path, "/audit") {
			audits++
			if route.Method != http.MethodGet || route.Mutation || route.Capability != adminaccess.CapabilityAuditRead {
				t.Errorf("%s %s must be a read guarded by audit.read", route.Method, route.Path)
			}
		}
		if route.Mutation && strings.Contains(route.Path, "audit") {
			t.Errorf("mutation route %s names the audit log", route.Path)
		}
	}
	if audits < 5 {
		t.Fatalf("only %d audit routes found", audits)
	}
}

// Ending sessions is itself audited: who, which account, why, and how many
// sessions, never a token.
func TestRevokingAGrantAuditsTheSessionsItEndedWithoutTokenMaterial(t *testing.T) {
	f := newCatalogFixture(t)
	ctx := t.Context()
	user, err := f.user.GetAdmin(ctx, catalogTargetID)
	if err != nil {
		t.Fatal(err)
	}
	granted := decodeCatalog[struct {
		ID        string    `json:"id"`
		GrantedAt time.Time `json:"granted_at"`
	}](t, f.request(t, "POST", "/admin/v1/site-admin-grants", struct {
		adminmutation.Command
		UserID string `json:"user_id"`
	}{f.versioned(user.UpdatedAt), catalogTargetID}, 201))
	input := adminsession.StartInput{UserID: catalogTargetID, GrantID: granted.ID, AccessIssuer: "https://access.example.test", AccessSubject: "target", AccessEmail: "target@example.edu"}
	var tokens []string
	for range 2 {
		credential, err := f.sessions.Start(ctx, input)
		if err != nil {
			t.Fatal(err)
		}
		tokens = append(tokens, credential.Token, credential.CSRFToken)
	}

	f.request(t, "POST", "/admin/v1/site-admin-grants/"+granted.ID+"/revoke", f.versioned(granted.GrantedAt), 200)

	var actor, target, reason string
	var ended int
	var raw string
	if err := f.pool.QueryRow(ctx, `
		SELECT actor_user_id::text, metadata ->> 'target_user_id', metadata ->> 'reason_code',
		       (metadata ->> 'revoked_session_count')::int, metadata::text
		FROM admin_security_events WHERE event_type = 'admin.session.revoked'
		ORDER BY occurred_at DESC LIMIT 1
	`).Scan(&actor, &target, &reason, &ended, &raw); err != nil {
		t.Fatal(err)
	}
	if actor != catalogActorID || target != catalogTargetID || reason == "" || ended != 2 {
		t.Fatalf("security event = actor %s target %s reason %q ended %d", actor, target, reason, ended)
	}
	for _, token := range tokens {
		if strings.Contains(raw, token) {
			t.Fatalf("security event holds token material: %s", raw)
		}
	}
}
