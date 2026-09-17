package adminsecurity

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PostgresStore struct {
	executor postgresExecutor
}

func NewPostgresStore(pool *pgxpool.Pool) *PostgresStore {
	return &PostgresStore{executor: pool}
}

// NewPostgresStoreForTransaction binds security-event inserts to the caller's
// transaction so an event and the session/domain mutation it describes either
// commit together or both roll back.
func NewPostgresStoreForTransaction(tx pgx.Tx) *PostgresStore {
	return &PostgresStore{executor: tx}
}

type postgresExecutor interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

func (store *PostgresStore) Insert(ctx context.Context, input WriteInput) (Event, error) {
	if store == nil || store.executor == nil || input.validate() != nil {
		return Event{}, ErrInvalidEvent
	}
	metadata, err := json.Marshal(input.Metadata)
	if err != nil {
		return Event{}, ErrInvalidEvent
	}
	var event Event
	var storedMetadata []byte
	err = store.executor.QueryRow(ctx, `
		INSERT INTO admin_security_events (
			event_type, outcome, actor_user_id, admin_session_id, request_id,
			network_identifier_hash, metadata
		)
		VALUES (
			$1, $2, NULLIF($3, '')::uuid, NULLIF($4, '')::uuid,
			NULLIF($5, ''), $6, $7::jsonb
		)
		RETURNING id::text, event_type, outcome,
		          COALESCE(actor_user_id::text, ''), COALESCE(admin_session_id::text, ''),
		          COALESCE(request_id, ''), network_identifier_hash, metadata, occurred_at
	`, input.Type, input.Outcome, strings.TrimSpace(input.ActorUserID), strings.TrimSpace(input.AdminSessionID),
		strings.TrimSpace(input.RequestID), nullableBytes(input.NetworkIdentifierHash), metadata).Scan(
		&event.ID, &event.Type, &event.Outcome, &event.ActorUserID, &event.AdminSessionID,
		&event.RequestID, &event.NetworkIdentifierHash, &storedMetadata, &event.OccurredAt,
	)
	if err != nil {
		return Event{}, fmt.Errorf("insert admin security event: %w", err)
	}
	if err := json.Unmarshal(storedMetadata, &event.Metadata); err != nil {
		return Event{}, fmt.Errorf("decode inserted admin security event: %w", err)
	}
	return event, nil
}

func (store *PostgresStore) List(ctx context.Context, params ListParams) ([]Event, error) {
	if store == nil || store.executor == nil || params.validate() != nil {
		return nil, ErrInvalidEvent
	}
	limit := params.Limit
	if limit == 0 {
		limit = 50
	}
	rows, err := store.executor.Query(ctx, `
		SELECT id::text, event_type, outcome,
		       COALESCE(actor_user_id::text, ''), COALESCE(admin_session_id::text, ''),
		       COALESCE(request_id, ''), network_identifier_hash, metadata, occurred_at
		FROM admin_security_events
		WHERE (NULLIF($1, '') IS NULL OR event_type = $1)
		  AND (NULLIF($2, '') IS NULL OR actor_user_id = NULLIF($2, '')::uuid)
		  AND (
		      $3::timestamptz IS NULL
		      OR (occurred_at, id) < ($3::timestamptz, NULLIF($4, '')::uuid)
		  )
		ORDER BY occurred_at DESC, id DESC
		LIMIT $5
	`, params.Type, strings.TrimSpace(params.ActorUserID), params.BeforeTime,
		strings.TrimSpace(params.BeforeID), limit)
	if err != nil {
		return nil, fmt.Errorf("list admin security events: %w", err)
	}
	defer rows.Close()

	events := make([]Event, 0, limit)
	for rows.Next() {
		event, scanErr := scanEvent(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate admin security events: %w", err)
	}
	return events, nil
}

func scanEvent(row pgx.Row) (Event, error) {
	var event Event
	var metadata []byte
	if err := row.Scan(
		&event.ID, &event.Type, &event.Outcome, &event.ActorUserID, &event.AdminSessionID,
		&event.RequestID, &event.NetworkIdentifierHash, &metadata, &event.OccurredAt,
	); err != nil {
		return Event{}, fmt.Errorf("scan admin security event: %w", err)
	}
	if err := json.Unmarshal(metadata, &event.Metadata); err != nil {
		return Event{}, fmt.Errorf("decode admin security event metadata: %w", err)
	}
	return event, nil
}

func nullableBytes(value []byte) any {
	if len(value) == 0 {
		return nil
	}
	return value
}
