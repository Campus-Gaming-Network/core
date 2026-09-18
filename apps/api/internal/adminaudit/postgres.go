package adminaudit

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

// NewPostgresStoreForTransaction binds the audit insert to the caller's
// transaction so the domain mutation and its audit either both commit or both
// roll back.
func NewPostgresStoreForTransaction(tx pgx.Tx) *PostgresStore {
	return &PostgresStore{executor: tx}
}

type postgresExecutor interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

func (store *PostgresStore) Insert(ctx context.Context, input WriteInput) (Entry, error) {
	if store == nil || store.executor == nil || input.validate() != nil {
		return Entry{}, ErrInvalidAudit
	}
	before, err := json.Marshal(input.Before)
	if err != nil {
		return Entry{}, ErrInvalidAudit
	}
	after, err := json.Marshal(input.After)
	if err != nil {
		return Entry{}, ErrInvalidAudit
	}
	metadata, err := json.Marshal(input.Metadata)
	if err != nil {
		return Entry{}, ErrInvalidAudit
	}
	if err := ValidateSafeDocuments(before, after, metadata); err != nil {
		return Entry{}, err
	}

	var entry Entry
	var storedBefore, storedAfter, storedMetadata []byte
	err = store.executor.QueryRow(ctx, `
		INSERT INTO audit_logs (
			actor_user_id, admin_session_id, request_id, action, entity_type,
			entity_id, before_json, after_json, metadata
		)
		VALUES (
			NULLIF($1, '')::uuid, NULLIF($2, '')::uuid, NULLIF($3, ''), $4, $5,
			$6::uuid, $7::jsonb, $8::jsonb, $9::jsonb
		)
		RETURNING id::text, actor_user_id::text, admin_session_id::text,
		          request_id, action, entity_type, entity_id::text,
		          before_json, after_json, metadata, created_at
	`, strings.TrimSpace(input.Correlation.ActorUserID), strings.TrimSpace(input.Correlation.AdminSessionID),
		strings.TrimSpace(input.Correlation.RequestID), input.Action, input.EntityType, input.EntityID,
		before, after, metadata).Scan(
		&entry.ID, &entry.ActorUserID, &entry.AdminSessionID, &entry.RequestID,
		&entry.Action, &entry.EntityType, &entry.EntityID,
		&storedBefore, &storedAfter, &storedMetadata, &entry.CreatedAt,
	)
	if err != nil {
		return Entry{}, fmt.Errorf("insert admin audit: %w", err)
	}
	entry.Before = json.RawMessage(storedBefore)
	entry.After = json.RawMessage(storedAfter)
	entry.Metadata = json.RawMessage(storedMetadata)
	return entry, nil
}

func (store *PostgresStore) List(ctx context.Context, params ListParams) ([]Entry, error) {
	if store == nil || store.executor == nil || params.validate() != nil {
		return nil, ErrInvalidAudit
	}
	limit := params.Limit
	if limit == 0 {
		limit = 50
	}
	rows, err := store.executor.Query(ctx, `
		SELECT id::text, actor_user_id::text, admin_session_id::text,
		       request_id, action, entity_type, entity_id::text,
		       before_json, after_json, metadata, created_at
		FROM audit_logs
		WHERE entity_type = $1 AND entity_id = $2::uuid
		ORDER BY created_at DESC, id DESC
		LIMIT $3
	`, params.EntityType, params.EntityID, limit)
	if err != nil {
		return nil, fmt.Errorf("list admin audit history: %w", err)
	}
	defer rows.Close()

	entries := make([]Entry, 0, limit)
	for rows.Next() {
		entry, scanErr := scanEntry(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		entries = append(entries, entry)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate admin audit history: %w", err)
	}
	return entries, nil
}

func scanEntry(row pgx.Row) (Entry, error) {
	var entry Entry
	var before, after, metadata []byte
	if err := row.Scan(
		&entry.ID, &entry.ActorUserID, &entry.AdminSessionID, &entry.RequestID,
		&entry.Action, &entry.EntityType, &entry.EntityID,
		&before, &after, &metadata, &entry.CreatedAt,
	); err != nil {
		return Entry{}, fmt.Errorf("scan admin audit entry: %w", err)
	}
	entry.Before = json.RawMessage(before)
	entry.After = json.RawMessage(after)
	entry.Metadata = json.RawMessage(metadata)
	return entry, nil
}
