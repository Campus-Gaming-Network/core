package events

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/pagecursor"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Activity log actions, written to audit_logs with entity_type 'event' (see
// docs/02-domain-model.md, Event activity log).
const (
	ActionCreated            = "event.created"
	ActionUpdated            = "event.updated"
	ActionCancelled          = "event.cancelled"
	ActionOrganizerJoined    = "event.organizer_joined"
	ActionOrganizerRemoved   = "event.organizer_removed"
	ActionOrganizerLeft      = "event.organizer_left"
	ActionCreatorTransferred = "event.creator_transferred"
	// ActionMatchResult and ActionMatchResultCorrected record a tournament
	// match's result and a change to it; their single change is "result".
	ActionMatchResult          = "event.match_result"
	ActionMatchResultCorrected = "event.match_result_corrected"
)

// Activity log paging bounds.
const (
	DefaultActivityLimit = 20
	MaximumActivityLimit = 50
)

// Entry visibilities.
const (
	ActivityPublic  = "public"
	ActivityEditors = "editors"
)

type activityField struct {
	name string
	// public fields change whether or how someone attends, and show to
	// anyone who can see the event.
	public bool
	// changedOnly fields record that they changed, never their values.
	changedOnly bool
}

// activityFields lists the fields in the order an edit entry lists them.
var activityFields = []activityField{
	{name: "title", public: true},
	{name: "starts_at", public: true},
	{name: "ends_at", public: true},
	{name: "timezone", public: true},
	{name: "format", public: true},
	{name: "location_name", public: true},
	{name: "address", public: true},
	{name: "online_url", public: true, changedOnly: true},
	{name: "cost", public: true},
	{name: "payment_note", public: true, changedOnly: true},
	{name: "payment_url", public: true, changedOnly: true},
	{name: "host_team", public: true},
	{name: "host_club", public: true},
	{name: "description", changedOnly: true},
	{name: "visibility"},
	{name: "private_password", changedOnly: true},
	{name: "host_school"},
	{name: "audience"},
	{name: "event_type"},
	{name: "games"},
	{name: "capacity"},
}

// publicActivityFields names the public fields, for filtering entries in SQL.
var publicActivityFields = func() []string {
	names := []string{}
	for _, field := range activityFields {
		if field.public {
			names = append(names, field.name)
		}
	}
	return names
}()

type activityExecer interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
}

// writeActivity adds one entry to the event's activity log. States hold user
// IDs and the recorded field values only.
func writeActivity(ctx context.Context, execer activityExecer, eventID, actorUserID, action string, before, after map[string]any, editedFields []string) error {
	type metadata struct {
		EditedFields []string `json:"edited_fields,omitempty"`
	}
	if before == nil {
		before = map[string]any{}
	}
	if after == nil {
		after = map[string]any{}
	}
	documents := make([][]byte, 0, 3)
	for _, value := range []any{before, after, metadata{EditedFields: editedFields}} {
		encoded, err := json.Marshal(value)
		if err != nil {
			return err
		}
		documents = append(documents, encoded)
	}
	if _, err := execer.Exec(ctx, `
		INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, before_json, after_json, metadata, created_at)
		VALUES (NULLIF($1, '')::uuid, $2, 'event', $3::uuid, $4::jsonb, $5::jsonb, $6::jsonb, clock_timestamp())
	`, actorUserID, action, eventID, documents[0], documents[1], documents[2]); err != nil {
		return fmt.Errorf("record %s: %w", action, err)
	}
	return nil
}

// activityStateSQL reads an event's loggable fields as one JSON object. Times
// are RFC 3339 in UTC, and games are sorted by slug. private_password is the
// stored hash, compared and never recorded.
const activityStateSQL = `
	SELECT jsonb_build_object(
	    'title', e.title,
	    'starts_at', to_char(e.starts_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
	    'ends_at', to_char(e.ends_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
	    'timezone', e.timezone,
	    'format', e.format,
	    'location_name', e.location_name,
	    'address', e.address,
	    'online_url', e.online_url,
	    'cost', e.cost,
	    'payment_note', e.payment_note,
	    'payment_url', e.payment_url,
	    'host_team', (SELECT jsonb_build_object('name', t.name, 'slug', t.slug) FROM teams t WHERE t.id = e.host_team_id),
	    'host_club', (SELECT jsonb_build_object('name', c.name, 'slug', c.slug) FROM clubs c WHERE c.id = e.host_club_id),
	    'description', e.description,
	    'visibility', e.visibility,
	    'private_password', e.private_password_hash,
	    'host_school', (SELECT jsonb_build_object('name', s.name, 'slug', s.slug) FROM schools s WHERE s.id = e.host_school_id),
	    'audience', e.audience,
	    'event_type', e.event_type,
	    'games', COALESCE((
	        SELECT jsonb_agg(jsonb_build_object('name', g.name, 'slug', g.slug) ORDER BY g.slug)
	        FROM event_games eg JOIN games g ON g.id = eg.game_id
	        WHERE eg.event_id = e.id), '[]'::jsonb),
	    'capacity', e.capacity
	)
	FROM events e
	WHERE e.id = $1::uuid`

type activityQueryer interface {
	QueryRow(ctx context.Context, sql string, arguments ...any) pgx.Row
}

func loadActivityState(ctx context.Context, queryer activityQueryer, eventID string) (map[string]json.RawMessage, error) {
	var encoded []byte
	if err := queryer.QueryRow(ctx, activityStateSQL, eventID).Scan(&encoded); err != nil {
		return nil, fmt.Errorf("load event activity state: %w", err)
	}
	var state map[string]json.RawMessage
	if err := json.Unmarshal(encoded, &state); err != nil {
		return nil, fmt.Errorf("decode event activity state: %w", err)
	}
	return state, nil
}

// diffActivity compares two states and returns the recorded values and the
// changed fields, in activityFields order. Games record the games removed
// before and the games added after.
func diffActivity(before, after map[string]json.RawMessage) (map[string]any, map[string]any, []string, error) {
	recordedBefore, recordedAfter := map[string]any{}, map[string]any{}
	edited := []string{}
	for _, field := range activityFields {
		was, is := before[field.name], after[field.name]
		if bytes.Equal(normalizedJSON(was), normalizedJSON(is)) {
			continue
		}
		edited = append(edited, field.name)
		switch {
		case field.changedOnly:
		case field.name == "games":
			removed, added, err := gameChanges(was, is)
			if err != nil {
				return nil, nil, nil, err
			}
			recordedBefore[field.name], recordedAfter[field.name] = removed, added
		default:
			recordedBefore[field.name], recordedAfter[field.name] = json.RawMessage(normalizedJSON(was)), json.RawMessage(normalizedJSON(is))
		}
	}
	return recordedBefore, recordedAfter, edited, nil
}

// normalizedJSON treats a missing value as null.
func normalizedJSON(value json.RawMessage) []byte {
	if len(value) == 0 {
		return []byte("null")
	}
	return value
}

type activityGame struct {
	Name string `json:"name"`
	Slug string `json:"slug"`
}

func gameChanges(before, after json.RawMessage) ([]activityGame, []activityGame, error) {
	var was, is []activityGame
	if err := json.Unmarshal(normalizedJSON(before), &was); err != nil {
		return nil, nil, fmt.Errorf("decode event games: %w", err)
	}
	if err := json.Unmarshal(normalizedJSON(after), &is); err != nil {
		return nil, nil, fmt.Errorf("decode event games: %w", err)
	}
	contains := func(games []activityGame, slug string) bool {
		return slices.ContainsFunc(games, func(game activityGame) bool { return game.Slug == slug })
	}
	removed, added := []activityGame{}, []activityGame{}
	for _, game := range was {
		if !contains(is, game.Slug) {
			removed = append(removed, game)
		}
	}
	for _, game := range is {
		if !contains(was, game.Slug) {
			added = append(added, game)
		}
	}
	return removed, added, nil
}

// ActivityActor is the account that made a change, shown to editors.
type ActivityActor struct {
	Name     string `json:"name"`
	PublicID string `json:"public_id"`
}

// ActivityChange is one changed field of an edit entry. Before and After are
// nil for a field recorded as changed only.
type ActivityChange struct {
	Field  string          `json:"field"`
	Before json.RawMessage `json:"before,omitempty"`
	After  json.RawMessage `json:"after,omitempty"`
}

// ActivityEntry is one entry of an event's activity log, as a viewer sees it.
type ActivityEntry struct {
	ID         string           `json:"id"`
	Action     string           `json:"action"`
	OccurredAt time.Time        `json:"occurred_at"`
	Visibility string           `json:"visibility"`
	Changes    []ActivityChange `json:"changes"`
	// Actor is nil for an account deleted since. Only an editor's view
	// carries it.
	Actor      *ActivityActor `json:"-"`
	editorView bool
}

// MarshalJSON includes actor, possibly null, only in an editor's view.
func (e ActivityEntry) MarshalJSON() ([]byte, error) {
	type entry ActivityEntry
	if !e.editorView {
		return json.Marshal(entry(e))
	}
	return json.Marshal(struct {
		entry
		Actor *ActivityActor `json:"actor"`
	}{entry(e), e.Actor})
}

// ActivityPage is one page of an event's activity log, newest first.
type ActivityPage struct {
	Entries    []ActivityEntry `json:"entries"`
	NextCursor string          `json:"next_cursor,omitempty"`
}

// Activity returns a page of the activity log of the event with eventID,
// newest first. An editor sees every entry and who made it. Anyone else sees
// only public entries, without the actor, and only the public fields of an
// edit; the cursor pages over that filtered list.
func (r *PostgresRepository) Activity(ctx context.Context, eventID string, editor bool, after *pagecursor.Cursor, limit int) (ActivityPage, error) {
	if limit < 1 || limit > MaximumActivityLimit {
		limit = DefaultActivityLimit
	}
	var cursorTime, cursorID any
	if after != nil {
		cursorTime, cursorID = after.Timestamp, after.ID
	}
	rows, err := r.pool.Query(ctx, `
		SELECT a.id::text, a.action, a.created_at, a.before_json, a.after_json,
		       COALESCE(a.metadata->'edited_fields', '[]'::jsonb),
		       u.name, u.public_id
		FROM audit_logs a
		LEFT JOIN users u ON u.id = a.actor_user_id AND u.deleted_at IS NULL AND u.account_status <> 'deleted'
		WHERE a.entity_type = 'event' AND a.entity_id = $1::uuid
		  AND ($2 OR a.action = $3 OR (a.action = $4 AND a.metadata->'edited_fields' ?| $5::text[]))
		  AND ($6::timestamptz IS NULL OR (a.created_at, a.id) < ($6::timestamptz, $7::uuid))
		ORDER BY a.created_at DESC, a.id DESC
		LIMIT $8
	`, eventID, editor, ActionCancelled, ActionUpdated, publicActivityFields, cursorTime, cursorID, limit+1)
	if err != nil {
		return ActivityPage{}, fmt.Errorf("list event activity: %w", err)
	}
	defer rows.Close()

	page := ActivityPage{Entries: []ActivityEntry{}}
	for rows.Next() {
		var entry ActivityEntry
		var beforeJSON, afterJSON, editedJSON []byte
		var actorName, actorPublicID *string
		if err := rows.Scan(&entry.ID, &entry.Action, &entry.OccurredAt, &beforeJSON, &afterJSON, &editedJSON,
			&actorName, &actorPublicID); err != nil {
			return ActivityPage{}, fmt.Errorf("scan event activity: %w", err)
		}
		if err := entry.fill(beforeJSON, afterJSON, editedJSON, editor); err != nil {
			return ActivityPage{}, err
		}
		entry.OccurredAt = entry.OccurredAt.UTC()
		entry.editorView = editor
		if editor && actorName != nil && actorPublicID != nil {
			entry.Actor = &ActivityActor{Name: *actorName, PublicID: *actorPublicID}
		}
		page.Entries = append(page.Entries, entry)
	}
	if err := rows.Err(); err != nil {
		return ActivityPage{}, fmt.Errorf("iterate event activity: %w", err)
	}
	if len(page.Entries) > limit {
		page.Entries = page.Entries[:limit]
		last := page.Entries[limit-1]
		page.NextCursor = pagecursor.Encode(last.OccurredAt, last.ID)
	}
	return page, nil
}

func (e *ActivityEntry) fill(beforeJSON, afterJSON, editedJSON []byte, editor bool) error {
	var before, after map[string]json.RawMessage
	var edited []string
	for _, document := range []struct {
		raw  []byte
		into any
	}{{beforeJSON, &before}, {afterJSON, &after}, {editedJSON, &edited}} {
		if err := json.Unmarshal(document.raw, document.into); err != nil {
			return fmt.Errorf("decode event activity: %w", err)
		}
	}
	e.Visibility = ActivityEditors
	if e.Action == ActionCancelled {
		e.Visibility = ActivityPublic
	}
	e.Changes = []ActivityChange{}
	if e.Action == ActionMatchResult || e.Action == ActionMatchResultCorrected {
		change := ActivityChange{Field: "result", After: normalizedJSON(afterJSON)}
		if len(before) > 0 {
			change.Before = normalizedJSON(beforeJSON)
		}
		e.Changes = append(e.Changes, change)
		return nil
	}
	for _, field := range activityFields {
		if !slices.Contains(edited, field.name) {
			continue
		}
		if field.public {
			e.Visibility = ActivityPublic
		}
		if !field.public && !editor {
			continue
		}
		change := ActivityChange{Field: field.name}
		if !field.changedOnly {
			change.Before, change.After = normalizedJSON(before[field.name]), normalizedJSON(after[field.name])
		}
		e.Changes = append(e.Changes, change)
	}
	return nil
}
