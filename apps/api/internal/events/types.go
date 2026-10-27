// Package events provides event creation, discovery, RSVP, and interest operations.
package events

import (
	"context"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/apperror"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/pagecursor"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Errors returned by event operations. Each carries the API error kind and
// code the client sees.
var (
	ErrHostSchoolNotFound = apperror.New(apperror.KindUnprocessable, "host_school_not_found", "host school not found")
	// ErrHostTeamNotAllowed reports a host team that does not exist or that
	// the organizer does not own or captain.
	ErrHostTeamNotAllowed = apperror.New(apperror.KindUnprocessable, "host_team_not_allowed", "host team must be one you own or captain")
	// ErrHostClubNotAllowed reports a host club that is not published or that
	// the user is not an owner or editor of.
	ErrHostClubNotAllowed = apperror.New(apperror.KindUnprocessable, "host_club_not_allowed", "host club must be one you own or edit")
	// ErrHostClubSchool reports a host club at a school other than the
	// event's host school.
	ErrHostClubSchool    = apperror.New(apperror.KindUnprocessable, "host_club_school_mismatch", "the host school must be the host club's school")
	ErrGameNotFound      = apperror.New(apperror.KindUnprocessable, "game_not_found", "game not found")
	ErrSlugUnavailable   = apperror.New(apperror.KindConflict, "event_slug_unavailable", "event slug unavailable")
	ErrEventNotFound     = apperror.New(apperror.KindNotFound, "event_not_found", "event not found")
	ErrOrganizerRequired = apperror.New(apperror.KindAuthorization, "not_event_organizer", "event organizer required")
	ErrEventFull         = apperror.New(apperror.KindConflict, "event_full", "event is full")
	ErrRSVPClosed        = apperror.New(apperror.KindConflict, "event_rsvp_closed", "event rsvp is closed")
	// ErrEventEnded reports an edit or cancellation of an event that has
	// already ended.
	ErrEventEnded = apperror.New(apperror.KindConflict, "event_ended", "event has ended")
	// ErrIdempotencyKeyReused reports a key whose original event belongs to
	// another creator or has since been cancelled.
	ErrIdempotencyKeyReused = apperror.New(apperror.KindConflict, "idempotency_key_reused", "idempotency key was used by another request")
)

// Values of the event fields that take a fixed set of strings.
const (
	// Event visibility values.
	VisibilityPublic   = "public"
	VisibilityUnlisted = "unlisted"
	VisibilityPrivate  = "private"

	// Event format values.
	FormatOnline   = "online"
	FormatInPerson = "in_person"
	FormatHybrid   = "hybrid"

	// Event audience values.
	AudienceOpen       = "open"
	AudienceCollegiate = "collegiate"
	AudienceCampus     = "campus"
	AudienceMembers    = "members"

	// EventTypeTournament is a label only. It does not create a tournament.
	EventTypeGameNight  = "game_night"
	EventTypeLAN        = "lan"
	EventTypeTournament = "tournament"
	EventTypeWatchParty = "watch_party"
	EventTypeTryout     = "tryout"
	EventTypeMeeting    = "meeting"
	EventTypeWorkshop   = "workshop"
	EventTypeOther      = "other"

	// Event lifecycle values, derived from the event's times and capacity.
	LifecycleUpcoming     = "upcoming"
	LifecycleHappeningNow = "happening_now"
	LifecycleEnded        = "ended"
	LifecycleFull         = "full"

	// CostUnspecified means the organizer did not say whether the event costs
	// anything. It is not the same as free.
	CostFree        = "free"
	CostPaid        = "paid"
	CostUnspecified = "unspecified"

	// RSVP response values.
	RSVPYes   = "yes"
	RSVPMaybe = "maybe"
	RSVPNo    = "no"

	// Recurrence rule values.
	RecurrenceWeekly   = "weekly"
	RecurrenceBiweekly = "biweekly"
	RecurrenceMonthly  = "monthly"
)

// Event is an event as the API returns it.
type Event struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Slug        string `json:"slug"`
	Description string `json:"description"`
	Visibility  string `json:"visibility"`
	Format      string `json:"format"`
	// Audience says who the event is for. It is empty for events created
	// before the field existed.
	Audience string `json:"audience,omitempty"`
	// EventType says what kind of event this is. It is empty for events
	// created before the field existed.
	EventType       string        `json:"event_type,omitempty"`
	StartsAt        time.Time     `json:"starts_at"`
	EndsAt          time.Time     `json:"ends_at"`
	Timezone        string        `json:"timezone"`
	LocationName    string        `json:"location_name,omitempty"`
	Address         string        `json:"address,omitempty"`
	OnlineURL       string        `json:"online_url,omitempty"`
	Capacity        *int          `json:"capacity,omitempty"`
	RSVPYesCount    int           `json:"rsvp_yes_count"`
	InterestCount   int           `json:"interest_count"`
	Lifecycle       string        `json:"lifecycle"`
	RecurrenceRule  string        `json:"recurrence_rule,omitempty"`
	RecurrenceUntil *time.Time    `json:"recurrence_until,omitempty"`
	Cost            string        `json:"cost"`
	PaymentNote     string        `json:"payment_note,omitempty"`
	PaymentURL      string        `json:"payment_url,omitempty"`
	HostSchool      SchoolSummary `json:"host_school"`
	// HostTeam is the team that hosts the event. It is nil for an event its
	// organizer runs alone.
	HostTeam *TeamSummary `json:"host_team,omitempty"`
	// HostClub is the club that hosts the event. An event has a host team or
	// a host club, not both.
	HostClub         *ClubSummary  `json:"host_club,omitempty"`
	Games            []GameSummary `json:"games"`
	Organizers       []Organizer   `json:"organizers,omitempty"`
	ViewerRSVP       *string       `json:"viewer_rsvp,omitempty"`
	ViewerInterested bool          `json:"viewer_interested,omitempty"`
	ViewerCanEdit    bool          `json:"viewer_can_edit,omitempty"`
	// ViewerIsCreator is set for the event's creator, who alone manages its
	// co-organizers.
	ViewerIsCreator bool `json:"viewer_is_creator,omitempty"`
	// ViewerCanCancel is set for the creator and for an owner or editor of
	// the host club.
	ViewerCanCancel bool `json:"viewer_can_cancel,omitempty"`
	// CancelledAt is when the event was cancelled. Only GetPageBySlug sets
	// it; every other read leaves cancelled events out.
	CancelledAt *time.Time `json:"cancelled_at,omitempty"`
	// TournamentEntries says how full the event's tournament is, for list
	// rows. It is nil when the event has no tournament or only a draft one.
	TournamentEntries *TournamentEntries `json:"tournament_entries,omitempty"`
	// Tournament is the tournament on a tournament-type event. Only
	// GetPageBySlug sets it, and only organizers see a draft.
	Tournament *Tournament `json:"tournament,omitempty"`
	// Revision rises whenever something its calendar file shows changes,
	// cancelling included; calendar files carry it as SEQUENCE.
	Revision  int       `json:"revision"`
	UpdatedAt time.Time `json:"updated_at"`
}

// TournamentEntries counts the registered entries in an event's tournament
// against its cap.
type TournamentEntries struct {
	EntryType  string `json:"entry_type"`
	EntryCount int    `json:"entry_count"`
	// EntrantCap is nil when the tournament has no limit.
	EntrantCap *int `json:"entrant_cap,omitempty"`
}

// CancelledEventVisibility is how long a cancelled event's page stays up,
// marked cancelled, before it is not found.
const CancelledEventVisibility = 24 * time.Hour

// Page sizes for the list of events a user created.
const (
	DefaultCreatedLimit = 20
	MaximumCreatedLimit = 50
)

// CreatedPage is a run of the events a user created, latest start first.
// NextCursor reads the earlier ones and is empty on the last page.
type CreatedPage struct {
	Events     []Event `json:"events"`
	NextCursor string  `json:"next_cursor"`
}

// Organizer is a user who manages an event.
type Organizer struct {
	ID                string   `json:"id"`
	PublicID          string   `json:"public_id"`
	Name              string   `json:"name"`
	Role              string   `json:"role"`
	VerificationLevel string   `json:"verification_level"`
	RoleIndicators    []string `json:"role_indicators,omitempty"`
}

// LockedEvent stands in for a private event the viewer has not unlocked.
type LockedEvent struct {
	Slug       string `json:"slug"`
	Visibility string `json:"visibility"`
	Locked     bool   `json:"locked"`
}

// SchoolSummary identifies a school in event responses.
type SchoolSummary struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Slug  string `json:"slug"`
	City  string `json:"city,omitempty"`
	State string `json:"state,omitempty"`
}

// TeamSummary identifies the team that hosts an event.
type TeamSummary struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Slug string `json:"slug"`
}

// ClubSummary identifies the club that hosts an event.
type ClubSummary struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Slug string `json:"slug"`
}

// GameSummary identifies a game in event responses.
type GameSummary struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Slug string `json:"slug"`
	// HasCover reports a cover the site serves at /api/games/{slug}/cover.
	// It is false for a game hidden since the event chose it, whose cover
	// the site no longer serves.
	HasCover bool `json:"has_cover"`
}

// ListParams filters and pages the public event list.
type ListParams struct {
	GameSlug   string
	SchoolSlug string
	TeamSlug   string
	ClubSlug   string
	// Query keeps events whose title contains it, ignoring case.
	Query     string
	Format    string
	Audience  string
	EventType string
	Cost      string
	// StartsAfter keeps events starting at or after it; StartsBefore keeps
	// events starting before it. Either may be nil.
	StartsAfter  *time.Time
	StartsBefore *time.Time
	// FromDate and ToDate (YYYY-MM-DD, inclusive) keep events whose start
	// falls on those calendar days in the event's own time zone, the date its
	// page shows. Either may be empty.
	FromDate string
	ToDate   string
	Limit    int
	After    *pagecursor.Cursor
	Before   *pagecursor.Cursor
}

// CreateInput is the validated request to create an event.
type CreateInput struct {
	Title         string
	Description   string
	CreatorUserID string
	HostSchoolID  string
	// HostTeamID is optional. The creator must own or captain the team.
	HostTeamID string
	// HostClubID is optional. The creator must own or edit the club, and the
	// host school must be the club's.
	HostClubID      string
	GameIDs         []string
	Visibility      string
	Format          string
	Audience        string
	EventType       string
	StartsAt        time.Time
	EndsAt          time.Time
	Timezone        string
	LocationName    string
	Address         string
	OnlineURL       string
	PrivatePassword string
	Capacity        *int
	// Cost is free, paid, or unspecified. Empty is stored as unspecified.
	Cost            string
	PaymentNote     string
	PaymentURL      string
	RecurrenceRule  string
	RecurrenceUntil time.Time
	// IdempotencyKey is required by the HTTP API. A repeated key returns the
	// event the first request created instead of inserting another.
	IdempotencyKey string
}

// CreateParams is CreateInput plus the hash of its private password.
type CreateParams struct {
	CreateInput
	PrivatePasswordHash string
}

// UpdateInput is the request to edit an event.
type UpdateInput struct {
	Slug         string
	EditorUserID string
	Title        string
	Description  string
	HostSchoolID string
	// HostTeamID is optional. Keeping the event's current team needs no role;
	// choosing a different team needs the editor to own or captain it.
	HostTeamID string
	// HostClubID is optional, with the same rule as HostTeamID for a club's
	// owners and editors. The host school must stay the club's.
	HostClubID      string
	GameIDs         []string
	Visibility      string
	Format          string
	Audience        string
	EventType       string
	StartsAt        time.Time
	EndsAt          time.Time
	Timezone        string
	LocationName    string
	Address         string
	OnlineURL       string
	PrivatePassword string
	Capacity        *int
	// Cost is free, paid, or unspecified. Empty is stored as unspecified.
	Cost        string
	PaymentNote string
	PaymentURL  string
}

// UpdateParams is UpdateInput plus the hash of its private password.
type UpdateParams struct {
	UpdateInput
	PrivatePasswordHash string
}

// Access is what a signed-in user may do to an event.
type Access struct {
	// Edit is true for an organizer, or an owner or editor of the host club.
	Edit bool
	// Cancel is true for the creator, or an owner or editor of the host club.
	Cancel bool
}

// RSVPInput sets a user's RSVP response for an event.
type RSVPInput struct {
	Slug     string
	UserID   string
	Response string
}

// Repository is the event storage the HTTP layer depends on.
type Repository interface {
	Create(ctx context.Context, params CreateParams) (Event, error)
	Update(ctx context.Context, params UpdateParams) (Event, error)
	Delete(ctx context.Context, slug string, userID string) error
	Access(ctx context.Context, slug string, userID string) (Access, error)
	PrivatePasswordHash(ctx context.Context, slug string) (string, error)
	CreatePrivateUnlock(ctx context.Context, slug string, tokenHash []byte, expiresAt time.Time) error
	IsPrivateUnlockValid(ctx context.Context, slug string, tokenHash []byte) (bool, error)
	SetRSVP(ctx context.Context, input RSVPInput) (Event, error)
	GetRSVP(ctx context.Context, slug string, userID string) (string, error)
	SetInterest(ctx context.Context, slug string, userID string, interested bool) (Event, error)
	IsInterested(ctx context.Context, slug string, userID string) (bool, error)
	ListUpcomingRSVPs(ctx context.Context, userID string, limit int) ([]Event, error)
	ListInterestedEvents(ctx context.Context, userID string, limit int) ([]Event, error)
	ListFollowedSchoolEvents(ctx context.Context, userID string, limit int) ([]Event, error)
	ListPublic(ctx context.Context, params ListParams) ([]Event, error)
	GetBySlug(ctx context.Context, slug string) (Event, error)
	GetPageBySlug(ctx context.Context, slug string) (Event, error)
	ListCreated(ctx context.Context, userID string, after *pagecursor.Cursor, limit int) (CreatedPage, error)
	Activity(ctx context.Context, eventID string, editor bool, after *pagecursor.Cursor, limit int) (ActivityPage, error)
}

// PostgresRepository stores events in Postgres.
type PostgresRepository struct {
	pool *pgxpool.Pool
	now  func() time.Time
}

// NewPostgresRepository returns a repository backed by pool.
func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{
		pool: pool,
		now:  time.Now,
	}
}
