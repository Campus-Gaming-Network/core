// Package people lists the people attached to an event, a school, or a team.
//
// The lists are for signed-in visitors. Only accounts that are active,
// verified, and not opted out of lists (users.show_in_lists) appear; an
// opted-out person's RSVPs, memberships, and counts are unaffected.
package people

import (
	"context"
	"fmt"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/pagecursor"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/users"
	"github.com/jackc/pgx/v5/pgxpool"
)

// maximumLimit is the most rows a page query may fetch: the public maximum
// page size plus one lookahead row.
const maximumLimit = 101

// Person is one row of a people list. It carries a name and verification
// state only, never an email address or any private account field.
type Person struct {
	ID                string   `json:"id"`
	Name              string   `json:"name"`
	VerificationLevel string   `json:"verification_level"`
	RoleIndicators    []string `json:"role_indicators,omitempty"`
	// Role is the person's role on a team. It is empty in other lists.
	Role string `json:"role,omitempty"`
	// SortKey is the value the list is ordered by, as the database computed it.
	// A cursor carries it so the next page resumes at the same position.
	SortKey string `json:"-"`
}

// ListParams selects one page of a list. Limit includes any lookahead row the
// caller wants. At most one of After and Before is set.
type ListParams struct {
	Limit  int
	After  *pagecursor.KeyCursor
	Before *pagecursor.KeyCursor
}

// Repository lists the people of an event, a school, or a team by ID. Callers
// resolve the slug and decide whether the viewer may see the page first.
type Repository interface {
	// ListEventAttendees lists the people whose RSVP to the event is response,
	// either "yes" or "maybe", ordered by name.
	ListEventAttendees(ctx context.Context, eventID string, response string, params ListParams) ([]Person, error)
	// ListSchoolMembers lists the people whose home school is the school,
	// ordered by name. People who only follow the school are not listed.
	ListSchoolMembers(ctx context.Context, schoolID string, params ListParams) ([]Person, error)
	// ListTeamMembers lists a team's members: the owner, then captains, then
	// members, each group ordered by name, with the role of each person.
	ListTeamMembers(ctx context.Context, teamID string, params ListParams) ([]Person, error)
}

type PostgresRepository struct {
	pool *pgxpool.Pool
}

func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

// listableSQL is the filter every list applies to the users row aliased u.
const listableSQL = `
	u.deleted_at IS NULL
	AND u.account_status = 'active'
	AND u.email_verified_at IS NOT NULL
	AND u.show_in_lists
`

// listSpec describes one kind of list for the shared paged query.
type listSpec struct {
	// from names the table that holds the list's rows, joined to users as u.
	from string
	// where narrows the list to one event, school, or team using args, which
	// are numbered from $1.
	where string
	args  []any
	// sortKey is a SQL text expression; people are ordered by it, then by u.id.
	sortKey string
	// role is a SQL text expression for the person's role, or ''::text.
	role string
}

func (r *PostgresRepository) ListEventAttendees(ctx context.Context, eventID string, response string, params ListParams) ([]Person, error) {
	return r.list(ctx, listSpec{
		from: `event_rsvps r JOIN users u ON u.id = r.user_id`,
		where: `r.event_id = $1::uuid
			AND r.response = $2
			AND r.deleted_at IS NULL`,
		args:    []any{eventID, response},
		sortKey: `lower(u.name)`,
		role:    `''::text`,
	}, params)
}

func (r *PostgresRepository) ListSchoolMembers(ctx context.Context, schoolID string, params ListParams) ([]Person, error) {
	return r.list(ctx, listSpec{
		from:    `users u`,
		where:   `u.home_school_id = $1::uuid`,
		args:    []any{schoolID},
		sortKey: `lower(u.name)`,
		role:    `''::text`,
	}, params)
}

func (r *PostgresRepository) ListTeamMembers(ctx context.Context, teamID string, params ListParams) ([]Person, error) {
	return r.list(ctx, listSpec{
		from: `team_members m JOIN users u ON u.id = m.user_id`,
		where: `m.team_id = $1::uuid
			AND m.deleted_at IS NULL`,
		args: []any{teamID},
		// The leading digit orders owner, captains, then members, so the role
		// groups and the names inside them page as one keyset.
		sortKey: `(CASE m.role WHEN 'owner' THEN '0' WHEN 'captain' THEN '1' ELSE '2' END || lower(u.name))`,
		role:    `m.role`,
	}, params)
}

// list runs one keyset page. A page read backward queries in reverse order and
// is reversed again, like the event and team lists.
func (r *PostgresRepository) list(ctx context.Context, spec listSpec, params ListParams) ([]Person, error) {
	if params.After != nil && params.Before != nil {
		return nil, pagecursor.ErrInvalid
	}
	if params.Limit < 1 || params.Limit > maximumLimit {
		params.Limit = maximumLimit
	}

	whereClause := spec.where + " AND " + listableSQL
	arguments := append([]any(nil), spec.args...)
	order := "ORDER BY " + spec.sortKey + ", u.id"
	if params.After != nil {
		whereClause += fmt.Sprintf(" AND (%s, u.id) > ($%d, $%d::uuid)", spec.sortKey, len(arguments)+1, len(arguments)+2)
		arguments = append(arguments, params.After.Key, params.After.ID)
	}
	if params.Before != nil {
		whereClause += fmt.Sprintf(" AND (%s, u.id) < ($%d, $%d::uuid)", spec.sortKey, len(arguments)+1, len(arguments)+2)
		arguments = append(arguments, params.Before.Key, params.Before.ID)
		order = "ORDER BY " + spec.sortKey + " DESC, u.id DESC"
	}
	arguments = append(arguments, params.Limit)

	query := `
		SELECT u.id::text, u.name, u.verification_level,
		       ` + users.RoleIndicatorsSQL("u") + `,
		       ` + spec.role + `,
		       ` + spec.sortKey + `
		FROM ` + spec.from + `
		WHERE ` + whereClause + `
		` + order + fmt.Sprintf(" LIMIT $%d", len(arguments))
	rows, err := r.pool.Query(ctx, query, arguments...)
	if err != nil {
		return nil, fmt.Errorf("list people: %w", err)
	}
	defer rows.Close()

	result := make([]Person, 0, params.Limit)
	for rows.Next() {
		var person Person
		if err := rows.Scan(&person.ID, &person.Name, &person.VerificationLevel, &person.RoleIndicators, &person.Role, &person.SortKey); err != nil {
			return nil, fmt.Errorf("scan person: %w", err)
		}
		result = append(result, person)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate people: %w", err)
	}
	if params.Before != nil {
		for left, right := 0, len(result)-1; left < right; left, right = left+1, right-1 {
			result[left], result[right] = result[right], result[left]
		}
	}
	return result, nil
}
