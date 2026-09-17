package adminsession

import (
	"context"
	"fmt"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminsecurity"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// SecurityTransactionRunner supplies session and security-event services bound
// to one database transaction. Callers must emit their success event inside
// the callback; returning any error rolls the session mutation back.
type SecurityTransactionRunner interface {
	Run(context.Context, func(Manager, adminsecurity.Writer) error) error
}

type PostgresSecurityTransactionRunner struct {
	pool        *pgxpool.Pool
	idleTTL     time.Duration
	absoluteTTL time.Duration
}

func NewPostgresSecurityTransactionRunner(
	pool *pgxpool.Pool,
	idleTTL time.Duration,
	absoluteTTL time.Duration,
) (*PostgresSecurityTransactionRunner, error) {
	if pool == nil || idleTTL <= 0 || absoluteTTL <= 0 || idleTTL > absoluteTTL {
		return nil, ErrInvalidSessionInput
	}
	return &PostgresSecurityTransactionRunner{
		pool: pool, idleTTL: idleTTL, absoluteTTL: absoluteTTL,
	}, nil
}

func (runner *PostgresSecurityTransactionRunner) Run(
	ctx context.Context,
	operation func(Manager, adminsecurity.Writer) error,
) error {
	if runner == nil || runner.pool == nil || operation == nil {
		return ErrInvalidSessionInput
	}
	tx, err := runner.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("begin admin session security transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	sessions, err := NewService(
		newPostgresRepositoryForTransaction(tx),
		runner.idleTTL,
		runner.absoluteTTL,
	)
	if err != nil {
		return err
	}
	security := adminsecurity.NewPostgresStoreForTransaction(tx)
	if err := operation(sessions, security); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit admin session security transaction: %w", err)
	}
	return nil
}
