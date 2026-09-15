// Package events provides event creation, discovery, RSVP, and interest operations.
package events

import (
	"context"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/apperror"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/pagecursor"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrHostSchoolNotFound = apperror.New(apperror.KindUnprocessable, "host_school_not_found", "host school not found")
	ErrGameNotFound       = apperror.New(apperror.KindUnprocessable, "game_not_found", "game not found")
	ErrSlugUnavailable    = apperror.New(apperror.KindConflict, "event_slug_unavailable", "event slug unavailable")
	ErrEventNotFound      = apperror.New(apperror.KindNotFound, "event_not_found", "event not found")
	ErrOrganizerRequired  = apperror.New(apperror.KindAuthorization, "not_event_organizer", "event organizer required")
	ErrEventFull          = apperror.New(apperror.KindConflict, "event_full", "event is full")
	ErrRSVPClosed         = apperror.New(apperror.KindConflict, "event_rsvp_closed", "event rsvp is closed")
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

	RecurrenceWeekly   = "weekly"
	RecurrenceBiweekly = "biweekly"
	RecurrenceMonthly  = "monthly"
)

type Event struct {
	ID               string        `json:"id"`
	Title            string        `json:"title"`
	Slug             string        `json:"slug"`
	Description      string        `json:"description"`
	Visibility       string        `json:"visibility"`
	Format           string        `json:"format"`
	StartsAt         time.Time     `json:"starts_at"`
	EndsAt           time.Time     `json:"ends_at"`
	Timezone         string        `json:"timezone"`
	LocationName     string        `json:"location_name,omitempty"`
	Address          string        `json:"address,omitempty"`
	OnlineURL        string        `json:"online_url,omitempty"`
	Capacity         *int          `json:"capacity,omitempty"`
	RSVPYesCount     int           `json:"rsvp_yes_count"`
	InterestCount    int           `json:"interest_count"`
	Lifecycle        string        `json:"lifecycle"`
	RecurrenceRule   string        `json:"recurrence_rule,omitempty"`
	RecurrenceUntil  *time.Time    `json:"recurrence_until,omitempty"`
	IsPaid           bool          `json:"is_paid"`
	PaymentNote      string        `json:"payment_note,omitempty"`
	PaymentURL       string        `json:"payment_url,omitempty"`
	HostSchool       SchoolSummary `json:"host_school"`
	Games            []GameSummary `json:"games"`
	Organizers       []Organizer   `json:"organizers,omitempty"`
	ViewerRSVP       *string       `json:"viewer_rsvp,omitempty"`
	ViewerInterested bool          `json:"viewer_interested,omitempty"`
	ViewerCanEdit    bool          `json:"viewer_can_edit,omitempty"`
}

type Organizer struct {
	ID                string   `json:"id"`
	Name              string   `json:"name"`
	Role              string   `json:"role"`
	VerificationLevel string   `json:"verification_level"`
	RoleIndicators    []string `json:"role_indicators,omitempty"`
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
	Format     string
	Limit      int
	After      *pagecursor.Cursor
	Before     *pagecursor.Cursor
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
	RecurrenceRule  string
	RecurrenceUntil time.Time
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
	SetInterest(ctx context.Context, slug string, userID string, interested bool) (Event, error)
	IsInterested(ctx context.Context, slug string, userID string) (bool, error)
	ListUpcomingRSVPs(ctx context.Context, userID string, limit int) ([]Event, error)
	ListFollowedSchoolEvents(ctx context.Context, userID string, limit int) ([]Event, error)
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
