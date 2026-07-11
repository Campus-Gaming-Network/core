package events

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"
	_ "time/tzdata"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrHostSchoolNotFound = errors.New("host school not found")
	ErrGameNotFound       = errors.New("game not found")
	ErrSlugUnavailable    = errors.New("event slug unavailable")
	ErrEventNotFound      = errors.New("event not found")
	ErrOrganizerRequired  = errors.New("event organizer required")
	ErrEventFull          = errors.New("event is full")
	ErrRSVPClosed         = errors.New("event rsvp is closed")
)

const (
	VisibilityPublic   = "public"
	VisibilityUnlisted = "unlisted"
	VisibilityPrivate  = "private"

	FormatOnline   = "online"
	FormatInPerson = "in_person"
	FormatHybrid   = "hybrid"

	LifecycleUpcoming     = "upcoming"
	LifecycleHappeningNow = "happening_now"
	LifecycleEnded        = "ended"
	LifecycleFull         = "full"

	RSVPYes   = "yes"
	RSVPMaybe = "maybe"
	RSVPNo    = "no"
)

type Event struct {
	ID           string        `json:"id"`
	Title        string        `json:"title"`
	Slug         string        `json:"slug"`
	Description  string        `json:"description"`
	Visibility   string        `json:"visibility"`
	Format       string        `json:"format"`
	StartsAt     time.Time     `json:"starts_at"`
	EndsAt       time.Time     `json:"ends_at"`
	Timezone     string        `json:"timezone"`
	LocationName string        `json:"location_name,omitempty"`
	Address      string        `json:"address,omitempty"`
	OnlineURL    string        `json:"online_url,omitempty"`
	Capacity     *int          `json:"capacity,omitempty"`
	RSVPYesCount int           `json:"rsvp_yes_count"`
	Lifecycle    string        `json:"lifecycle"`
	IsPaid       bool          `json:"is_paid"`
	PaymentNote  string        `json:"payment_note,omitempty"`
	PaymentURL   string        `json:"payment_url,omitempty"`
	HostSchool   SchoolSummary `json:"host_school"`
	Games        []GameSummary `json:"games"`
	ViewerRSVP   *string       `json:"viewer_rsvp,omitempty"`
}

type LockedEvent struct {
	Slug       string `json:"slug"`
	Visibility string `json:"visibility"`
	Locked     bool   `json:"locked"`
}

type SchoolSummary struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Slug  string `json:"slug"`
	City  string `json:"city,omitempty"`
	State string `json:"state,omitempty"`
}

type GameSummary struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Slug string `json:"slug"`
}

type ListParams struct {
	GameSlug   string
	SchoolSlug string
	Limit      int
	Offset     int
}

type CreateInput struct {
	Title           string
	Description     string
	CreatorUserID   string
	HostSchoolID    string
	GameIDs         []string
	Visibility      string
	Format          string
	StartsAt        time.Time
	EndsAt          time.Time
	Timezone        string
	LocationName    string
	Address         string
	OnlineURL       string
	PrivatePassword string
	Capacity        *int
	IsPaid          bool
	PaymentNote     string
	PaymentURL      string
}

type CreateParams struct {
	CreateInput
	PrivatePasswordHash string
}

type UpdateInput struct {
	Slug            string
	EditorUserID    string
	Title           string
	Description     string
	HostSchoolID    string
	GameIDs         []string
	Visibility      string
	Format          string
	StartsAt        time.Time
	EndsAt          time.Time
	Timezone        string
	LocationName    string
	Address         string
	OnlineURL       string
	PrivatePassword string
	Capacity        *int
	IsPaid          bool
	PaymentNote     string
	PaymentURL      string
}

type UpdateParams struct {
	UpdateInput
	PrivatePasswordHash string
}

type RSVPInput struct {
	Slug     string
	UserID   string
	Response string
}

type Repository interface {
	Create(ctx context.Context, params CreateParams) (Event, error)
	Update(ctx context.Context, params UpdateParams) (Event, error)
	Delete(ctx context.Context, slug string, userID string) error
	IsOrganizer(ctx context.Context, slug string, userID string) (bool, error)
	PrivatePasswordHash(ctx context.Context, slug string) (string, error)
	CreatePrivateUnlock(ctx context.Context, slug string, tokenHash []byte, expiresAt time.Time) error
	IsPrivateUnlockValid(ctx context.Context, slug string, tokenHash []byte) (bool, error)
	SetRSVP(ctx context.Context, input RSVPInput) (Event, error)
	GetRSVP(ctx context.Context, slug string, userID string) (string, error)
	ListPublic(ctx context.Context, params ListParams) ([]Event, error)
	GetBySlug(ctx context.Context, slug string) (Event, error)
}

type PostgresRepository struct {
	pool *pgxpool.Pool
	now  func() time.Time
}

func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{
		pool: pool,
		now:  time.Now,
	}
}

func NormalizeListParams(params ListParams) ListParams {
	params.GameSlug = strings.TrimSpace(params.GameSlug)
	params.SchoolSlug = strings.TrimSpace(params.SchoolSlug)
	if params.Limit < 1 || params.Limit > 100 {
		params.Limit = 25
	}
	if params.Offset < 0 {
		params.Offset = 0
	}
	return params
}

func ValidateCreateInput(input CreateInput) error {
	return validateEventFields(input, true)
}

func ValidateUpdateInput(input UpdateInput) error {
	if strings.TrimSpace(input.Slug) == "" {
		return errors.New("event slug is required")
	}
	if strings.TrimSpace(input.EditorUserID) == "" {
		return errors.New("editor user is required")
	}
	return validateEventFields(CreateInput{
		Title:           input.Title,
		Description:     input.Description,
		CreatorUserID:   input.EditorUserID,
		HostSchoolID:    input.HostSchoolID,
		GameIDs:         input.GameIDs,
		Visibility:      input.Visibility,
		Format:          input.Format,
		StartsAt:        input.StartsAt,
		EndsAt:          input.EndsAt,
		Timezone:        input.Timezone,
		LocationName:    input.LocationName,
		Address:         input.Address,
		OnlineURL:       input.OnlineURL,
		PrivatePassword: input.PrivatePassword,
		Capacity:        input.Capacity,
		IsPaid:          input.IsPaid,
		PaymentNote:     input.PaymentNote,
		PaymentURL:      input.PaymentURL,
	}, false)
}

func ValidateRSVPInput(input RSVPInput) error {
	if strings.TrimSpace(input.Slug) == "" {
		return errors.New("event slug is required")
	}
	if strings.TrimSpace(input.UserID) == "" {
		return errors.New("user is required")
	}
	if !validRSVPResponse(input.Response) {
		return errors.New("rsvp response must be yes, maybe, or no")
	}
	return nil
}

func validateEventFields(input CreateInput, requirePrivatePassword bool) error {
	if title := strings.TrimSpace(input.Title); title == "" || len(title) > 120 {
		return errors.New("title is required and must be 120 characters or fewer")
	}
	if len(input.Description) > 5000 {
		return errors.New("description must be 5,000 characters or fewer")
	}
	if strings.TrimSpace(input.CreatorUserID) == "" {
		return errors.New("creator user is required")
	}
	if strings.TrimSpace(input.HostSchoolID) == "" {
		return errors.New("host school is required")
	}
	if len(input.GameIDs) == 0 {
		return errors.New("at least one game is required")
	}
	for _, gameID := range input.GameIDs {
		if strings.TrimSpace(gameID) == "" {
			return errors.New("game IDs must be valid")
		}
	}
	if !validVisibility(input.Visibility) {
		return errors.New("visibility must be public, unlisted, or private")
	}
	if !validFormat(input.Format) {
		return errors.New("format must be online, in_person, or hybrid")
	}
	if input.StartsAt.IsZero() || input.EndsAt.IsZero() || !input.EndsAt.After(input.StartsAt) {
		return errors.New("event end time must be after start time")
	}
	timezone := strings.TrimSpace(input.Timezone)
	if timezone == "" {
		return errors.New("timezone is required")
	}
	if _, err := time.LoadLocation(timezone); err != nil {
		return errors.New("timezone must be a valid IANA timezone")
	}
	if len(input.LocationName) > 200 {
		return errors.New("location name must be 200 characters or fewer")
	}
	if len(input.Address) > 1000 {
		return errors.New("address must be 1,000 characters or fewer")
	}
	if len(input.OnlineURL) > 500 {
		return errors.New("online URL must be 500 characters or fewer")
	}
	if strings.TrimSpace(input.OnlineURL) != "" {
		if err := validateHTTPURL(input.OnlineURL); err != nil {
			return errors.New("online URL must be a valid HTTP or HTTPS URL")
		}
	}
	privatePassword := strings.TrimSpace(input.PrivatePassword)
	if input.Visibility == VisibilityPrivate && requirePrivatePassword && len(privatePassword) < 8 {
		return errors.New("private events require a password of at least 8 characters")
	}
	if input.Visibility != VisibilityPrivate && privatePassword != "" {
		return errors.New("only private events may have a private password")
	}
	if input.Visibility == VisibilityPrivate && !requirePrivatePassword && privatePassword != "" && len(privatePassword) < 8 {
		return errors.New("private event password must be at least 8 characters")
	}
	if input.Capacity != nil && *input.Capacity < 1 {
		return errors.New("capacity must be positive when set")
	}
	if len(input.PaymentNote) > 1000 {
		return errors.New("payment note must be 1,000 characters or fewer")
	}
	if strings.TrimSpace(input.PaymentURL) != "" {
		if err := validateHTTPURL(input.PaymentURL); err != nil {
			return errors.New("payment URL must be a valid HTTP or HTTPS URL")
		}
	}
	return nil
}

func GenerateSlug(title string, creatorUserID string, startsAt time.Time) string {
	base := Slugify(title)
	hash := sha256.Sum256([]byte(strings.Join([]string{
		strings.TrimSpace(creatorUserID),
		startsAt.UTC().Format(time.RFC3339Nano),
		strings.TrimSpace(title),
	}, "|")))
	suffix := base64.RawURLEncoding.EncodeToString(hash[:])[:8]

	return base + "-" + suffix
}

func Slugify(value string) string {
	var builder strings.Builder
	previousHyphen := false

	for _, character := range strings.ToLower(strings.TrimSpace(value)) {
		isAlphaNumeric := (character >= 'a' && character <= 'z') || (character >= '0' && character <= '9')
		isSeparator := character == ' ' || character == '-' || character == '_'

		switch {
		case isAlphaNumeric:
			builder.WriteRune(character)
			previousHyphen = false
		case isSeparator && !previousHyphen && builder.Len() > 0:
			builder.WriteRune('-')
			previousHyphen = true
		}
	}

	result := strings.Trim(builder.String(), "-")
	if result == "" {
		return "event"
	}
	return result
}

func Lifecycle(now time.Time, startsAt time.Time, endsAt time.Time, capacity *int, yesCount int) string {
	if !now.Before(endsAt) {
		return LifecycleEnded
	}
	if capacity != nil && yesCount >= *capacity {
		return LifecycleFull
	}
	if !now.Before(startsAt) {
		return LifecycleHappeningNow
	}
	return LifecycleUpcoming
}

func (e Event) IsPrivate() bool {
	return e.Visibility == VisibilityPrivate
}

func (e Event) Locked() LockedEvent {
	return LockedEvent{
		Slug:       e.Slug,
		Visibility: e.Visibility,
		Locked:     true,
	}
}

func (r *PostgresRepository) Create(ctx context.Context, params CreateParams) (Event, error) {
	if err := ValidateCreateInput(params.CreateInput); err != nil {
		return Event{}, err
	}
	if params.Visibility == VisibilityPrivate && strings.TrimSpace(params.PrivatePasswordHash) == "" {
		return Event{}, errors.New("private password hash is required")
	}

	params = normalizeCreateParams(params)
	baseSlug := GenerateSlug(params.Title, params.CreatorUserID, params.StartsAt)
	for attempt := 0; attempt < 5; attempt++ {
		slug := baseSlug
		if attempt > 0 {
			slug = fmt.Sprintf("%s-%d", baseSlug, attempt+1)
		}

		createdSlug, err := r.createWithSlug(ctx, params, slug)
		if errors.Is(err, ErrSlugUnavailable) {
			continue
		}
		if err != nil {
			return Event{}, err
		}
		return r.GetBySlug(ctx, createdSlug)
	}

	return Event{}, ErrSlugUnavailable
}

func (r *PostgresRepository) Update(ctx context.Context, params UpdateParams) (Event, error) {
	if err := ValidateUpdateInput(params.UpdateInput); err != nil {
		return Event{}, err
	}

	params = normalizeUpdateParams(params)
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return Event{}, fmt.Errorf("begin event update: %w", err)
	}
	defer tx.Rollback(ctx)

	eventID, currentPrivatePasswordHash, err := lockEditableEvent(ctx, tx, params.Slug, params.EditorUserID)
	if err != nil {
		return Event{}, err
	}

	privatePasswordHash := ""
	if params.Visibility == VisibilityPrivate {
		privatePasswordHash = params.PrivatePasswordHash
		if privatePasswordHash == "" && currentPrivatePasswordHash.Valid {
			privatePasswordHash = currentPrivatePasswordHash.String
		}
		if privatePasswordHash == "" {
			return Event{}, errors.New("private password hash is required")
		}
	}

	var slug string
	err = tx.QueryRow(ctx, `
		UPDATE events e
		SET host_school_id = s.id,
		    title = $3,
		    description = $4,
		    visibility = $5,
		    format = $6,
		    starts_at = $7,
		    ends_at = $8,
		    timezone = $9,
		    location_name = NULLIF($10, ''),
		    address = NULLIF($11, ''),
		    online_url = NULLIF($12, ''),
		    private_password_hash = NULLIF($13, ''),
		    capacity = $14,
		    is_paid = $15,
		    payment_note = NULLIF($16, ''),
		    payment_url = NULLIF($17, '')
		FROM schools s
		WHERE e.id = $1::uuid
		  AND s.id = $2::uuid
		  AND s.deleted_at IS NULL
		  AND s.is_active = TRUE
		RETURNING e.slug
	`, eventID, params.HostSchoolID, params.Title, params.Description, params.Visibility,
		params.Format, params.StartsAt, params.EndsAt, params.Timezone, params.LocationName,
		params.Address, params.OnlineURL, privatePasswordHash, nullableInt(params.Capacity),
		params.IsPaid, params.PaymentNote, params.PaymentURL).Scan(&slug)
	if errors.Is(err, pgx.ErrNoRows) {
		return Event{}, ErrHostSchoolNotFound
	}
	if err != nil {
		return Event{}, fmt.Errorf("update event: %w", err)
	}

	if _, err := tx.Exec(ctx, `DELETE FROM event_games WHERE event_id = $1::uuid`, eventID); err != nil {
		return Event{}, fmt.Errorf("delete event games: %w", err)
	}
	insertedGameCount, err := insertEventGames(ctx, tx, eventID, params.GameIDs)
	if err != nil {
		return Event{}, err
	}
	if insertedGameCount != len(params.GameIDs) {
		return Event{}, ErrGameNotFound
	}

	if params.PrivatePasswordHash != "" || params.Visibility != VisibilityPrivate {
		if _, err := tx.Exec(ctx, `
			UPDATE event_private_unlocks
			SET deleted_at = NOW()
			WHERE event_id = $1::uuid AND deleted_at IS NULL
		`, eventID); err != nil {
			return Event{}, fmt.Errorf("archive private event unlocks: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return Event{}, fmt.Errorf("commit event update: %w", err)
	}
	return r.GetBySlug(ctx, slug)
}

func (r *PostgresRepository) Delete(ctx context.Context, slug string, userID string) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin event delete: %w", err)
	}
	defer tx.Rollback(ctx)

	eventID, _, err := lockEditableEvent(ctx, tx, strings.TrimSpace(slug), strings.TrimSpace(userID))
	if err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `
		UPDATE events
		SET deleted_at = NOW()
		WHERE id = $1::uuid AND deleted_at IS NULL
	`, eventID); err != nil {
		return fmt.Errorf("delete event: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		UPDATE event_organizers
		SET deleted_at = NOW()
		WHERE event_id = $1::uuid AND deleted_at IS NULL
	`, eventID); err != nil {
		return fmt.Errorf("delete event organizers: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		UPDATE event_rsvps
		SET deleted_at = NOW()
		WHERE event_id = $1::uuid AND deleted_at IS NULL
	`, eventID); err != nil {
		return fmt.Errorf("delete event rsvps: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		UPDATE event_interests
		SET deleted_at = NOW()
		WHERE event_id = $1::uuid AND deleted_at IS NULL
	`, eventID); err != nil {
		return fmt.Errorf("delete event interests: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		UPDATE event_private_unlocks
		SET deleted_at = NOW()
		WHERE event_id = $1::uuid AND deleted_at IS NULL
	`, eventID); err != nil {
		return fmt.Errorf("delete event private unlocks: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit event delete: %w", err)
	}
	return nil
}

func (r *PostgresRepository) IsOrganizer(ctx context.Context, slug string, userID string) (bool, error) {
	var organizer bool
	err := r.pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM events e
			JOIN event_organizers eo ON eo.event_id = e.id
			WHERE e.slug = $1
			  AND e.deleted_at IS NULL
			  AND eo.user_id = $2::uuid
			  AND eo.deleted_at IS NULL
		)
	`, strings.TrimSpace(slug), strings.TrimSpace(userID)).Scan(&organizer)
	return organizer, err
}

func (r *PostgresRepository) PrivatePasswordHash(ctx context.Context, slug string) (string, error) {
	var hash sql.NullString
	err := r.pool.QueryRow(ctx, `
		SELECT private_password_hash
		FROM events
		WHERE slug = $1
		  AND visibility = 'private'
		  AND deleted_at IS NULL
	`, strings.TrimSpace(slug)).Scan(&hash)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrEventNotFound
	}
	if err != nil {
		return "", fmt.Errorf("get private event password hash: %w", err)
	}
	if !hash.Valid || strings.TrimSpace(hash.String) == "" {
		return "", ErrEventNotFound
	}
	return hash.String, nil
}

func (r *PostgresRepository) CreatePrivateUnlock(ctx context.Context, slug string, tokenHash []byte, expiresAt time.Time) error {
	commandTag, err := r.pool.Exec(ctx, `
		INSERT INTO event_private_unlocks (event_id, token_hash, expires_at)
		SELECT id, $2, $3
		FROM events
		WHERE slug = $1
		  AND visibility = 'private'
		  AND deleted_at IS NULL
	`, strings.TrimSpace(slug), tokenHash, expiresAt)
	if err != nil {
		return fmt.Errorf("create private event unlock: %w", err)
	}
	if commandTag.RowsAffected() != 1 {
		return ErrEventNotFound
	}
	return nil
}

func (r *PostgresRepository) IsPrivateUnlockValid(ctx context.Context, slug string, tokenHash []byte) (bool, error) {
	if len(tokenHash) == 0 {
		return false, nil
	}

	var unlocked bool
	err := r.pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM events e
			JOIN event_private_unlocks unlocks ON unlocks.event_id = e.id
			WHERE e.slug = $1
			  AND e.visibility = 'private'
			  AND e.deleted_at IS NULL
			  AND unlocks.token_hash = $2
			  AND unlocks.expires_at > $3
			  AND unlocks.deleted_at IS NULL
		)
	`, strings.TrimSpace(slug), tokenHash, r.now()).Scan(&unlocked)
	return unlocked, err
}

func (r *PostgresRepository) SetRSVP(ctx context.Context, input RSVPInput) (Event, error) {
	input = normalizeRSVPInput(input)
	if err := ValidateRSVPInput(input); err != nil {
		return Event{}, err
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return Event{}, fmt.Errorf("begin event rsvp: %w", err)
	}
	defer tx.Rollback(ctx)

	var eventID string
	var capacity sql.NullInt64
	var endsAt time.Time
	var yesCount int
	var currentResponse sql.NullString
	err = tx.QueryRow(ctx, `
		SELECT e.id::text,
		       e.capacity,
		       e.ends_at,
		       COALESCE(yes_counts.yes_count, 0)::int,
		       (
		           SELECT r.response
		           FROM event_rsvps r
		           WHERE r.event_id = e.id
		             AND r.user_id = $2::uuid
		             AND r.deleted_at IS NULL
		       ) AS current_response
		FROM events e
		LEFT JOIN LATERAL (
		    SELECT COUNT(*) AS yes_count
		    FROM event_rsvps r
		    WHERE r.event_id = e.id
		      AND r.response = 'yes'
		      AND r.deleted_at IS NULL
		) yes_counts ON TRUE
		WHERE e.slug = $1
		  AND e.deleted_at IS NULL
		FOR UPDATE OF e
	`, input.Slug, input.UserID).Scan(&eventID, &capacity, &endsAt, &yesCount, &currentResponse)
	if errors.Is(err, pgx.ErrNoRows) {
		return Event{}, ErrEventNotFound
	}
	if err != nil {
		return Event{}, fmt.Errorf("lock event rsvp: %w", err)
	}
	if !r.now().Before(endsAt) {
		return Event{}, ErrRSVPClosed
	}
	if input.Response == RSVPYes && capacity.Valid && yesCount >= int(capacity.Int64) &&
		(!currentResponse.Valid || currentResponse.String != RSVPYes) {
		return Event{}, ErrEventFull
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO event_rsvps (event_id, user_id, response)
		VALUES ($1::uuid, $2::uuid, $3)
		ON CONFLICT (event_id, user_id)
		DO UPDATE SET response = EXCLUDED.response,
		              deleted_at = NULL
	`, eventID, input.UserID, input.Response); err != nil {
		return Event{}, fmt.Errorf("upsert event rsvp: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return Event{}, fmt.Errorf("commit event rsvp: %w", err)
	}

	event, err := r.GetBySlug(ctx, input.Slug)
	if err != nil {
		return Event{}, err
	}
	event.ViewerRSVP = &input.Response
	return event, nil
}

func (r *PostgresRepository) GetRSVP(ctx context.Context, slug string, userID string) (string, error) {
	var response string
	err := r.pool.QueryRow(ctx, `
		SELECT r.response
		FROM events e
		JOIN event_rsvps r ON r.event_id = e.id
		WHERE e.slug = $1
		  AND e.deleted_at IS NULL
		  AND r.user_id = $2::uuid
		  AND r.deleted_at IS NULL
	`, strings.TrimSpace(slug), strings.TrimSpace(userID)).Scan(&response)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return response, err
}

func (r *PostgresRepository) ListPublic(ctx context.Context, params ListParams) ([]Event, error) {
	params = NormalizeListParams(params)
	rows, err := r.pool.Query(ctx, eventSelectSQL(`
		e.deleted_at IS NULL
		AND e.visibility = 'public'
		AND ($1 = '' OR EXISTS (
			SELECT 1
			FROM event_games filter_eg
			JOIN games filter_g ON filter_g.id = filter_eg.game_id
			WHERE filter_eg.event_id = e.id
			  AND filter_g.slug = $1
			  AND filter_g.deleted_at IS NULL
		))
		AND ($2 = '' OR s.slug = $2)
	`, `
		ORDER BY e.starts_at, e.id
		LIMIT $3 OFFSET $4
	`), params.GameSlug, params.SchoolSlug, params.Limit, params.Offset)
	if err != nil {
		return nil, fmt.Errorf("list events: %w", err)
	}
	defer rows.Close()

	result := make([]Event, 0, params.Limit)
	for rows.Next() {
		event, err := scanEvent(rows, r.now())
		if err != nil {
			return nil, err
		}
		result = append(result, event)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate events: %w", err)
	}
	return result, nil
}

func (r *PostgresRepository) GetBySlug(ctx context.Context, slug string) (Event, error) {
	row := r.pool.QueryRow(ctx, eventSelectSQL(`
		e.deleted_at IS NULL
		AND e.slug = $1
	`, ``), strings.TrimSpace(slug))
	return scanEvent(row, r.now())
}

func (r *PostgresRepository) createWithSlug(ctx context.Context, params CreateParams, slug string) (string, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("begin event create: %w", err)
	}
	defer tx.Rollback(ctx)

	var eventID string
	err = tx.QueryRow(ctx, `
		INSERT INTO events (
			creator_user_id, host_school_id, title, slug, description, visibility,
			format, starts_at, ends_at, timezone, location_name, address, online_url,
			private_password_hash, capacity, is_paid, payment_note, payment_url
		)
		SELECT $1::uuid, s.id, $3, $4, $5, $6, $7, $8, $9, $10,
		       NULLIF($11, ''), NULLIF($12, ''), NULLIF($13, ''),
		       NULLIF($14, ''), $15, $16, NULLIF($17, ''), NULLIF($18, '')
		FROM schools s
		WHERE s.id = $2::uuid
		  AND s.deleted_at IS NULL
		  AND s.is_active = TRUE
		ON CONFLICT (slug) DO NOTHING
		RETURNING id::text
	`, params.CreatorUserID, params.HostSchoolID, params.Title, slug, params.Description,
		params.Visibility, params.Format, params.StartsAt, params.EndsAt, params.Timezone,
		params.LocationName, params.Address, params.OnlineURL, params.PrivatePasswordHash,
		nullableInt(params.Capacity), params.IsPaid, params.PaymentNote, params.PaymentURL).Scan(&eventID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", r.createNoRowsError(ctx, tx, params.HostSchoolID)
	}
	if err != nil {
		return "", fmt.Errorf("insert event: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO event_organizers (event_id, user_id, role)
		VALUES ($1::uuid, $2::uuid, 'creator')
	`, eventID, params.CreatorUserID); err != nil {
		return "", fmt.Errorf("insert event organizer: %w", err)
	}

	insertedGameCount, err := insertEventGames(ctx, tx, eventID, params.GameIDs)
	if err != nil {
		return "", err
	}
	if insertedGameCount != len(params.GameIDs) {
		return "", ErrGameNotFound
	}

	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("commit event create: %w", err)
	}
	return slug, nil
}

type eventScanner interface {
	Scan(dest ...any) error
}

type eventGameInserter interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

func scanEvent(scanner eventScanner, now time.Time) (Event, error) {
	var event Event
	var capacity sql.NullInt64
	var locationName sql.NullString
	var address sql.NullString
	var onlineURL sql.NullString
	var paymentNote sql.NullString
	var paymentURL sql.NullString
	var gameIDs []string
	var gameNames []string
	var gameSlugs []string

	err := scanner.Scan(
		&event.ID,
		&event.Title,
		&event.Slug,
		&event.Description,
		&event.Visibility,
		&event.Format,
		&event.StartsAt,
		&event.EndsAt,
		&event.Timezone,
		&locationName,
		&address,
		&onlineURL,
		&capacity,
		&event.IsPaid,
		&paymentNote,
		&paymentURL,
		&event.HostSchool.ID,
		&event.HostSchool.Name,
		&event.HostSchool.Slug,
		&event.HostSchool.City,
		&event.HostSchool.State,
		&event.RSVPYesCount,
		&gameIDs,
		&gameNames,
		&gameSlugs,
	)
	if err != nil {
		return Event{}, err
	}

	if locationName.Valid {
		event.LocationName = locationName.String
	}
	if address.Valid {
		event.Address = address.String
	}
	if onlineURL.Valid {
		event.OnlineURL = onlineURL.String
	}
	if capacity.Valid {
		value := int(capacity.Int64)
		event.Capacity = &value
	}
	if paymentNote.Valid {
		event.PaymentNote = paymentNote.String
	}
	if paymentURL.Valid {
		event.PaymentURL = paymentURL.String
	}

	event.Games = make([]GameSummary, 0, len(gameIDs))
	for index := range gameIDs {
		event.Games = append(event.Games, GameSummary{
			ID:   gameIDs[index],
			Name: gameNames[index],
			Slug: gameSlugs[index],
		})
	}
	event.Lifecycle = Lifecycle(now, event.StartsAt, event.EndsAt, event.Capacity, event.RSVPYesCount)

	return event, nil
}

func eventSelectSQL(whereClause string, tailClause string) string {
	return `
		SELECT e.id::text, e.title, e.slug, e.description, e.visibility,
		       e.format, e.starts_at, e.ends_at, e.timezone,
		       e.location_name, e.address, e.online_url, e.capacity, e.is_paid,
		       e.payment_note, e.payment_url,
		       s.id::text, s.name, s.slug, COALESCE(s.city, ''), COALESCE(s.state, ''),
		       COALESCE(yes_counts.yes_count, 0)::int,
		       COALESCE(
		           array_agg(g.id::text ORDER BY g.name, g.id::text) FILTER (WHERE g.id IS NOT NULL),
		           ARRAY[]::text[]
		       ),
		       COALESCE(
		           array_agg(g.name ORDER BY g.name, g.id::text) FILTER (WHERE g.id IS NOT NULL),
		           ARRAY[]::text[]
		       ),
		       COALESCE(
		           array_agg(g.slug ORDER BY g.name, g.id::text) FILTER (WHERE g.id IS NOT NULL),
		           ARRAY[]::text[]
		       )
		FROM events e
		JOIN schools s ON s.id = e.host_school_id
		LEFT JOIN event_games eg ON eg.event_id = e.id
		LEFT JOIN games g ON g.id = eg.game_id AND g.deleted_at IS NULL
		LEFT JOIN LATERAL (
			SELECT COUNT(*) AS yes_count
			FROM event_rsvps r
			WHERE r.event_id = e.id
			  AND r.response = 'yes'
			  AND r.deleted_at IS NULL
		) yes_counts ON TRUE
		WHERE ` + whereClause + `
		GROUP BY e.id, e.title, e.slug, e.description, e.visibility,
		         e.format, e.starts_at, e.ends_at, e.timezone,
		         e.location_name, e.address, e.online_url, e.capacity, e.is_paid,
		         e.payment_note, e.payment_url,
		         s.id, s.name, s.slug, s.city, s.state, yes_counts.yes_count
	` + tailClause
}

func validVisibility(value string) bool {
	return value == VisibilityPublic || value == VisibilityUnlisted || value == VisibilityPrivate
}

func validFormat(value string) bool {
	return value == FormatOnline || value == FormatInPerson || value == FormatHybrid
}

func validRSVPResponse(value string) bool {
	value = strings.TrimSpace(value)
	return value == RSVPYes || value == RSVPMaybe || value == RSVPNo
}

type schoolExistenceChecker interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

type editableEventLocker interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func lockEditableEvent(ctx context.Context, locker editableEventLocker, slug string, userID string) (string, sql.NullString, error) {
	var eventID string
	var currentPrivatePasswordHash sql.NullString
	var organizer bool
	err := locker.QueryRow(ctx, `
		SELECT e.id::text,
		       e.private_password_hash,
		       EXISTS (
		           SELECT 1
		           FROM event_organizers eo
		           WHERE eo.event_id = e.id
		             AND eo.user_id = $2::uuid
		             AND eo.deleted_at IS NULL
		       ) AS organizer
		FROM events e
		WHERE e.slug = $1
		  AND e.deleted_at IS NULL
		FOR UPDATE OF e
	`, strings.TrimSpace(slug), strings.TrimSpace(userID)).Scan(&eventID, &currentPrivatePasswordHash, &organizer)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", sql.NullString{}, ErrEventNotFound
	}
	if err != nil {
		return "", sql.NullString{}, fmt.Errorf("lock editable event: %w", err)
	}
	if !organizer {
		return "", sql.NullString{}, ErrOrganizerRequired
	}
	return eventID, currentPrivatePasswordHash, nil
}

func (r *PostgresRepository) createNoRowsError(ctx context.Context, checker schoolExistenceChecker, hostSchoolID string) error {
	var schoolExists bool
	if err := checker.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM schools
			WHERE id = $1::uuid
			  AND deleted_at IS NULL
			  AND is_active = TRUE
		)
	`, hostSchoolID).Scan(&schoolExists); err != nil {
		return fmt.Errorf("check host school: %w", err)
	}
	if !schoolExists {
		return ErrHostSchoolNotFound
	}
	return ErrSlugUnavailable
}

func insertEventGames(ctx context.Context, tx eventGameInserter, eventID string, gameIDs []string) (int, error) {
	rows, err := tx.Query(ctx, `
		INSERT INTO event_games (event_id, game_id)
		SELECT $1::uuid, g.id
		FROM games g
		WHERE g.id::text = ANY($2)
		  AND g.deleted_at IS NULL
		ON CONFLICT (event_id, game_id) DO NOTHING
		RETURNING game_id::text
	`, eventID, gameIDs)
	if err != nil {
		return 0, fmt.Errorf("insert event games: %w", err)
	}
	defer rows.Close()

	count := 0
	for rows.Next() {
		var gameID string
		if err := rows.Scan(&gameID); err != nil {
			return 0, fmt.Errorf("scan inserted event game: %w", err)
		}
		count++
	}
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("iterate inserted event games: %w", err)
	}
	return count, nil
}

func normalizeCreateParams(params CreateParams) CreateParams {
	params.Title = strings.TrimSpace(params.Title)
	params.Description = strings.TrimSpace(params.Description)
	params.CreatorUserID = strings.TrimSpace(params.CreatorUserID)
	params.HostSchoolID = strings.TrimSpace(params.HostSchoolID)
	params.GameIDs = normalizeIDs(params.GameIDs)
	params.Visibility = strings.TrimSpace(params.Visibility)
	params.Format = strings.TrimSpace(params.Format)
	params.Timezone = strings.TrimSpace(params.Timezone)
	params.LocationName = strings.TrimSpace(params.LocationName)
	params.Address = strings.TrimSpace(params.Address)
	params.OnlineURL = strings.TrimSpace(params.OnlineURL)
	params.PrivatePasswordHash = strings.TrimSpace(params.PrivatePasswordHash)
	params.PaymentNote = strings.TrimSpace(params.PaymentNote)
	params.PaymentURL = strings.TrimSpace(params.PaymentURL)
	return params
}

func normalizeUpdateParams(params UpdateParams) UpdateParams {
	params.Slug = strings.TrimSpace(params.Slug)
	params.EditorUserID = strings.TrimSpace(params.EditorUserID)
	params.Title = strings.TrimSpace(params.Title)
	params.Description = strings.TrimSpace(params.Description)
	params.HostSchoolID = strings.TrimSpace(params.HostSchoolID)
	params.GameIDs = normalizeIDs(params.GameIDs)
	params.Visibility = strings.TrimSpace(params.Visibility)
	params.Format = strings.TrimSpace(params.Format)
	params.Timezone = strings.TrimSpace(params.Timezone)
	params.LocationName = strings.TrimSpace(params.LocationName)
	params.Address = strings.TrimSpace(params.Address)
	params.OnlineURL = strings.TrimSpace(params.OnlineURL)
	params.PrivatePasswordHash = strings.TrimSpace(params.PrivatePasswordHash)
	params.PaymentNote = strings.TrimSpace(params.PaymentNote)
	params.PaymentURL = strings.TrimSpace(params.PaymentURL)
	return params
}

func normalizeRSVPInput(input RSVPInput) RSVPInput {
	input.Slug = strings.TrimSpace(input.Slug)
	input.UserID = strings.TrimSpace(input.UserID)
	input.Response = strings.TrimSpace(input.Response)
	return input
}

func normalizeIDs(values []string) []string {
	result := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		if _, ok := seen[trimmed]; ok {
			continue
		}
		seen[trimmed] = struct{}{}
		result = append(result, trimmed)
	}
	return result
}

func validateHTTPURL(value string) error {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || parsed.Host == "" || (parsed.Scheme != "https" && parsed.Scheme != "http") {
		return errors.New("invalid HTTP URL")
	}
	return nil
}

func nullableInt(value *int) any {
	if value == nil {
		return nil
	}
	return *value
}
