// Package dataexport assembles a copy of everything Campus Gaming Network
// holds about one account, for the account holder to download.
package dataexport

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// FormatVersion names the export's shape. Raise it when a section changes
// meaning, so a reader can tell two exports apart.
const FormatVersion = 1

// AuditAction is recorded each time an account holder downloads an export.
const AuditAction = "user.data_exported"

// ErrAccountNotFound reports an account that is missing or deleted.
var ErrAccountNotFound = errors.New("account not found")

// Export is one account's data. Each section is a JSON array (the account a
// JSON object) built by the database, so a section's fields are those its
// query names. Secrets never appear: no password hash, token, or session
// token hash.
type Export struct {
	FormatVersion     int             `json:"format_version"`
	ExportedAt        time.Time       `json:"exported_at"`
	Account           json.RawMessage `json:"account"`
	SocialLinks       json.RawMessage `json:"social_links"`
	FollowedSchools   json.RawMessage `json:"followed_schools"`
	SchoolAdminRoles  json.RawMessage `json:"school_admin_roles"`
	SiteRoles         json.RawMessage `json:"site_roles"`
	GameLists         json.RawMessage `json:"game_lists"`
	Teams             json.RawMessage `json:"teams"`
	Clubs             json.RawMessage `json:"clubs"`
	ClubClaims        json.RawMessage `json:"club_claims"`
	EventsOrganized   json.RawMessage `json:"events_organized"`
	RSVPs             json.RawMessage `json:"rsvps"`
	InterestedEvents  json.RawMessage `json:"interested_events"`
	SupportTickets    json.RawMessage `json:"support_tickets"`
	Reports           json.RawMessage `json:"reports"`
	Notifications     json.RawMessage `json:"notifications"`
	PolicyAcceptances json.RawMessage `json:"policy_acceptances"`
	Sessions          json.RawMessage `json:"sessions"`
}

// PostgresRepository reads exports from Postgres.
type PostgresRepository struct {
	pool *pgxpool.Pool
	now  func() time.Time
}

// NewPostgresRepository returns a repository backed by pool.
func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool, now: time.Now}
}

// section is one part of the export. Its query takes the user ID as $1 and
// returns one JSON value.
type section struct {
	name   string
	target func(*Export) *json.RawMessage
	query  string
}

// list wraps a row query so it returns a JSON array, empty when there are no
// rows.
func list(object string, from string) string {
	return `SELECT COALESCE(jsonb_agg(` + object + `), '[]'::jsonb) FROM (` + from + `) entry`
}

var sections = []section{
	{
		name:   "account",
		target: func(e *Export) *json.RawMessage { return &e.Account },
		query: `
			SELECT jsonb_build_object(
			    'id', u.id, 'email', u.email, 'name', u.name, 'bio', u.bio,
			    'timezone', u.timezone, 'verification_level', u.verification_level,
			    'account_status', u.account_status, 'show_in_lists', u.show_in_lists,
			    'email_verified_at', u.email_verified_at, 'age_confirmed_at', u.age_confirmed_at,
			    'created_at', u.created_at, 'updated_at', u.updated_at,
			    'home_school', jsonb_build_object('name', s.name, 'slug', s.slug))
			FROM users u JOIN schools s ON s.id = u.home_school_id
			WHERE u.id = $1::uuid`,
	},
	{
		name:   "social links",
		target: func(e *Export) *json.RawMessage { return &e.SocialLinks },
		query: list(`to_jsonb(entry)`, `
			SELECT kind, label, url, created_at FROM user_social_links
			WHERE user_id = $1::uuid AND deleted_at IS NULL ORDER BY sort_order, created_at`),
	},
	{
		name:   "followed schools",
		target: func(e *Export) *json.RawMessage { return &e.FollowedSchools },
		query: list(`to_jsonb(entry)`, `
			SELECT s.name, s.slug, f.created_at AS followed_at
			FROM user_school_follows f JOIN schools s ON s.id = f.school_id
			WHERE f.user_id = $1::uuid AND f.deleted_at IS NULL ORDER BY f.created_at, s.slug`),
	},
	{
		name:   "school admin roles",
		target: func(e *Export) *json.RawMessage { return &e.SchoolAdminRoles },
		query: list(`to_jsonb(entry)`, `
			SELECT s.name AS school_name, s.slug AS school_slug, a.created_at AS granted_at, a.deleted_at AS revoked_at
			FROM school_admins a JOIN schools s ON s.id = a.school_id
			WHERE a.user_id = $1::uuid ORDER BY a.created_at, s.slug`),
	},
	{
		name:   "site roles",
		target: func(e *Export) *json.RawMessage { return &e.SiteRoles },
		query: list(`to_jsonb(entry)`, `
			SELECT role, granted_at, revoked_at FROM site_role_grants
			WHERE user_id = $1::uuid ORDER BY granted_at, id`),
	},
	{
		name:   "game lists",
		target: func(e *Export) *json.RawMessage { return &e.GameLists },
		query: list(`to_jsonb(entry)`, `
			SELECT ug.list, ug.position, g.name AS game_name, g.slug AS game_slug, ug.created_at AS added_at
			FROM user_games ug JOIN games g ON g.id = ug.game_id
			WHERE ug.user_id = $1::uuid ORDER BY ug.list, ug.position`),
	},
	{
		name:   "teams",
		target: func(e *Export) *json.RawMessage { return &e.Teams },
		query: list(`to_jsonb(entry)`, `
			SELECT t.name, t.slug, m.role, m.created_at AS joined_at
			FROM team_members m JOIN teams t ON t.id = m.team_id
			WHERE m.user_id = $1::uuid AND m.deleted_at IS NULL AND t.deleted_at IS NULL
			ORDER BY m.created_at, t.slug`),
	},
	{
		name:   "clubs",
		target: func(e *Export) *json.RawMessage { return &e.Clubs },
		query: list(`to_jsonb(entry)`, `
			SELECT c.name, c.slug, m.role, m.created_at AS joined_at
			FROM club_members m JOIN clubs c ON c.id = m.club_id
			WHERE m.user_id = $1::uuid AND c.deleted_at IS NULL
			ORDER BY m.created_at, c.slug`),
	},
	{
		name:   "club claims",
		target: func(e *Export) *json.RawMessage { return &e.ClubClaims },
		query: list(`to_jsonb(entry)`, `
			SELECT COALESCE(c.name, cc.requested_name) AS club_name, s.name AS school_name,
			       CASE WHEN cc.requested_name IS NULL THEN 'claim' ELSE 'request' END AS kind,
			       cc.evidence_text, cc.evidence_url, cc.status, cc.created_at, cc.reviewed_at
			FROM club_claims cc JOIN schools s ON s.id = cc.school_id LEFT JOIN clubs c ON c.id = cc.club_id
			WHERE cc.applicant_user_id = $1::uuid ORDER BY cc.created_at, cc.id`),
	},
	{
		name:   "events organized",
		target: func(e *Export) *json.RawMessage { return &e.EventsOrganized },
		query: list(`to_jsonb(entry)`, `
			SELECT e.title, e.slug, o.role, e.visibility, e.starts_at, e.ends_at,
			       o.created_at AS organizer_since, e.deleted_at AS cancelled_at
			FROM event_organizers o JOIN events e ON e.id = o.event_id
			WHERE o.user_id = $1::uuid AND (o.deleted_at IS NULL OR e.deleted_at IS NOT NULL)
			ORDER BY e.starts_at, e.slug`),
	},
	{
		name:   "rsvps",
		target: func(e *Export) *json.RawMessage { return &e.RSVPs },
		query: list(`to_jsonb(entry)`, `
			SELECT e.title AS event_title, e.slug AS event_slug, r.response,
			       r.created_at AS responded_at, r.updated_at
			FROM event_rsvps r JOIN events e ON e.id = r.event_id
			WHERE r.user_id = $1::uuid AND r.deleted_at IS NULL ORDER BY r.created_at, e.slug`),
	},
	{
		name:   "interested events",
		target: func(e *Export) *json.RawMessage { return &e.InterestedEvents },
		query: list(`to_jsonb(entry)`, `
			SELECT e.title AS event_title, e.slug AS event_slug, i.created_at AS marked_at
			FROM event_interests i JOIN events e ON e.id = i.event_id
			WHERE i.user_id = $1::uuid AND i.deleted_at IS NULL ORDER BY i.created_at, e.slug`),
	},
	{
		name:   "support tickets",
		target: func(e *Export) *json.RawMessage { return &e.SupportTickets },
		query: list(`to_jsonb(entry)`, `
			SELECT subject, message, name, contact_email, status, created_at
			FROM support_tickets
			WHERE submitter_user_id = $1::uuid AND deleted_at IS NULL ORDER BY created_at, id`),
	},
	{
		name:   "reports",
		target: func(e *Export) *json.RawMessage { return &e.Reports },
		query: list(`to_jsonb(entry)`, `
			SELECT target_type, target_id, reason, status, created_at
			FROM reports
			WHERE reporter_user_id = $1::uuid AND deleted_at IS NULL ORDER BY created_at, id`),
	},
	{
		name:   "notifications",
		target: func(e *Export) *json.RawMessage { return &e.Notifications },
		query: list(`to_jsonb(entry)`, `
			SELECT type, title, body, read_at, created_at
			FROM notifications WHERE user_id = $1::uuid ORDER BY created_at, id`),
	},
	{
		name:   "policy acceptances",
		target: func(e *Export) *json.RawMessage { return &e.PolicyAcceptances },
		query: list(`to_jsonb(entry)`, `
			SELECT d.document_type, d.version, a.accepted_at, a.source
			FROM user_policy_acceptances a JOIN policy_documents d ON d.id = a.policy_document_id
			WHERE a.user_id = $1::uuid ORDER BY a.accepted_at, d.document_type`),
	},
	{
		name:   "sessions",
		target: func(e *Export) *json.RawMessage { return &e.Sessions },
		query: list(`to_jsonb(entry)`, `
			SELECT created_at, last_seen_at, expires_at, revoked_at
			FROM auth_sessions
			WHERE user_id = $1::uuid AND deleted_at IS NULL ORDER BY created_at, id`),
	},
}

// Export reads every section in one snapshot and records the download in the
// audit history in the same transaction, so an export is never handed out
// unrecorded.
func (r *PostgresRepository) Export(ctx context.Context, userID string) (Export, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead})
	if err != nil {
		return Export{}, fmt.Errorf("begin data export: %w", err)
	}
	defer tx.Rollback(ctx)
	// Timestamps read the same wherever the server runs.
	if _, err := tx.Exec(ctx, `SET LOCAL TIME ZONE 'UTC'`); err != nil {
		return Export{}, fmt.Errorf("set export time zone: %w", err)
	}
	var active bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM users WHERE id = $1::uuid AND deleted_at IS NULL AND account_status <> 'deleted')
	`, userID).Scan(&active); err != nil {
		return Export{}, fmt.Errorf("check exported account: %w", err)
	}
	if !active {
		return Export{}, ErrAccountNotFound
	}

	export := Export{FormatVersion: FormatVersion, ExportedAt: r.now().UTC().Truncate(time.Second)}
	for _, part := range sections {
		var value []byte
		if err := tx.QueryRow(ctx, part.query, userID).Scan(&value); err != nil {
			return Export{}, fmt.Errorf("export %s: %w", part.name, err)
		}
		*part.target(&export) = value
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id)
		VALUES ($1::uuid, $2, 'user', $1::uuid)
	`, userID, AuditAction); err != nil {
		return Export{}, fmt.Errorf("record data export: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return Export{}, fmt.Errorf("commit data export: %w", err)
	}
	return export, nil
}
