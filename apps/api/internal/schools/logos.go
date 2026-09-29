package schools

import (
	"cmp"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"log/slog"
	"strings"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminaudit"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminmutation"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/logoimage"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ObjectStore holds public, immutable logo objects.
type ObjectStore interface {
	Put(ctx context.Context, key, contentType string, body []byte) error
	Delete(ctx context.Context, key string) error
}

// pendingLogoGrace outlasts any in-flight upload, so reconciliation never
// deletes an object whose transaction may still commit.
const pendingLogoGrace = 15 * time.Minute

// LogoRepository publishes school logos. Each object gets a fresh random key
// and a tracking row before it is written, so a failed upload, database write,
// or audit insert can always be traced back to an object to delete.
type LogoRepository struct {
	pool    *pgxpool.Pool
	objects ObjectStore
	origin  string
	logger  *slog.Logger
}

func NewLogoRepository(pool *pgxpool.Pool, objects ObjectStore, publicOrigin string, logger *slog.Logger) *LogoRepository {
	return &LogoRepository{pool: pool, objects: objects, origin: strings.TrimRight(publicOrigin, "/"), logger: logger}
}

// ReplaceLogo stores a processed logo and points the school at it.
func (r *LogoRepository) ReplaceLogo(ctx context.Context, id string, command adminmutation.Command, logo logoimage.Image) (AdminSchool, error) {
	if !adminmutation.UUID(id) {
		return AdminSchool{}, adminmutation.ErrNotFound
	}
	if err := command.Validate(true); err != nil {
		return AdminSchool{}, err
	}
	// Reject a stale or deleted school before spending an upload on it.
	current, err := scanAdminSchool(r.pool.QueryRow(ctx, `SELECT `+adminSchoolColumns+` FROM schools WHERE id=$1::uuid`, id))
	if err != nil {
		return AdminSchool{}, err
	}
	if !current.UpdatedAt.Equal(command.ExpectedUpdatedAt) {
		return AdminSchool{}, adminmutation.ErrConflict
	}
	if current.DeletedAt != nil {
		return AdminSchool{}, adminmutation.ErrTransition
	}

	suffix := make([]byte, 16)
	if _, err := rand.Read(suffix); err != nil {
		return AdminSchool{}, err
	}
	key := "school-logos/" + id + "/" + hex.EncodeToString(suffix) + logo.Extension
	if _, err := r.pool.Exec(ctx, `INSERT INTO school_logo_objects (school_id,object_key,state) VALUES ($1::uuid,$2,'pending')`, id, key); err != nil {
		return AdminSchool{}, adminmutation.Error(err)
	}
	if err := r.objects.Put(ctx, key, logo.ContentType, logo.Body); err != nil {
		r.discard(context.WithoutCancel(ctx), key)
		return AdminSchool{}, err
	}
	next, err := r.changeLogo(ctx, id, command, adminaudit.ActionSchoolLogoUpdated, key)
	if err != nil {
		r.discard(context.WithoutCancel(ctx), key)
		return AdminSchool{}, err
	}
	r.cleanup(context.WithoutCancel(ctx), id)
	return next, nil
}

// RemoveLogo returns the school to its placeholder.
func (r *LogoRepository) RemoveLogo(ctx context.Context, id string, command adminmutation.Command) (AdminSchool, error) {
	if !adminmutation.UUID(id) {
		return AdminSchool{}, adminmutation.ErrNotFound
	}
	if err := command.Validate(true); err != nil {
		return AdminSchool{}, err
	}
	next, err := r.changeLogo(ctx, id, command, adminaudit.ActionSchoolLogoRemoved, "")
	if err != nil {
		return AdminSchool{}, err
	}
	r.cleanup(context.WithoutCancel(ctx), id)
	return next, nil
}

func (r *LogoRepository) changeLogo(ctx context.Context, id string, command adminmutation.Command, action adminaudit.Action, key string) (AdminSchool, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return AdminSchool{}, err
	}
	defer tx.Rollback(ctx)
	current, err := scanAdminSchool(tx.QueryRow(ctx, `SELECT `+adminSchoolColumns+` FROM schools WHERE id=$1::uuid FOR UPDATE`, id))
	if err != nil {
		return AdminSchool{}, err
	}
	if !current.UpdatedAt.Equal(command.ExpectedUpdatedAt) {
		return AdminSchool{}, adminmutation.ErrConflict
	}
	if current.DeletedAt != nil || (key == "" && current.LogoURL == "") {
		return AdminSchool{}, adminmutation.ErrTransition
	}
	if _, err := tx.Exec(ctx, `UPDATE school_logo_objects SET state='retired',updated_at=now() WHERE school_id=$1::uuid AND state='current'`, id); err != nil {
		return AdminSchool{}, err
	}
	var logoURL *string
	if key != "" {
		tag, err := tx.Exec(ctx, `UPDATE school_logo_objects SET state='current',updated_at=now() WHERE object_key=$1 AND school_id=$2::uuid AND state='pending'`, key, id)
		if err != nil {
			return AdminSchool{}, err
		}
		if tag.RowsAffected() != 1 {
			return AdminSchool{}, errors.New("pending logo object is missing")
		}
		value := r.origin + "/" + key
		logoURL = &value
	}
	next, err := scanAdminSchool(tx.QueryRow(ctx, `UPDATE schools SET logo_url=$2 WHERE id=$1::uuid RETURNING `+adminSchoolColumns, id, logoURL))
	if err != nil {
		return AdminSchool{}, err
	}
	if err := command.Audit(ctx, tx, action, adminaudit.EntitySchool, id, current.auditState(), next.auditState()); err != nil {
		return AdminSchool{}, err
	}
	return next, tx.Commit(ctx)
}

// discard deletes an object that never became current. If the delete fails,
// the pending row stays for reconciliation.
func (r *LogoRepository) discard(ctx context.Context, key string) {
	if err := r.objects.Delete(ctx, key); err != nil {
		r.logger.Warn("school logo object left for reconciliation", "error", err)
		return
	}
	if _, err := r.pool.Exec(ctx, `DELETE FROM school_logo_objects WHERE object_key=$1 AND state='pending'`, key); err != nil {
		r.logger.Warn("school logo row left for reconciliation", "error", err)
	}
}

// cleanup deletes one school's retired objects after a committed change.
func (r *LogoRepository) cleanup(ctx context.Context, schoolID string) {
	if _, err := r.sweep(ctx, `school_id=$1::uuid AND state='retired'`, schoolID); err != nil {
		r.logger.Warn("school logo cleanup deferred to reconciliation", "error", err)
	}
}

// Reconcile deletes retired objects and abandoned pending uploads, returning
// how many were removed.
func (r *LogoRepository) Reconcile(ctx context.Context) (int, error) {
	return r.sweep(ctx, `state='retired' OR (state='pending' AND updated_at < now() - make_interval(secs => $1))`, pendingLogoGrace.Seconds())
}

// Start reconciles on an interval until ctx ends.
func (r *LogoRepository) Start(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		if _, err := r.Reconcile(ctx); err != nil && ctx.Err() == nil {
			r.logger.Warn("school logo reconciliation failed", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (r *LogoRepository) sweep(ctx context.Context, condition string, argument any) (int, error) {
	rows, err := r.pool.Query(ctx, `SELECT object_key FROM school_logo_objects WHERE `+condition+` ORDER BY updated_at LIMIT 100`, argument)
	if err != nil {
		return 0, err
	}
	var keys []string
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			rows.Close()
			return 0, err
		}
		keys = append(keys, key)
	}
	if err := rows.Err(); err != nil {
		return 0, err
	}
	removed := 0
	var firstErr error
	for _, key := range keys {
		err := r.objects.Delete(ctx, key)
		if err == nil {
			_, err = r.pool.Exec(ctx, `DELETE FROM school_logo_objects WHERE object_key=$1 AND state<>'current'`, key)
		}
		if err != nil {
			firstErr = cmp.Or(firstErr, err)
			continue
		}
		removed++
	}
	return removed, firstErr
}
