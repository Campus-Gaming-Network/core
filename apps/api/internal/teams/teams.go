package teams

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrTeamNotFound       = errors.New("team not found")
	ErrSchoolNotFound     = errors.New("school not found")
	ErrGameNotFound       = errors.New("game not found")
	ErrSlugUnavailable    = errors.New("team slug unavailable")
	ErrNotTeamOwner       = errors.New("not team owner")
	ErrTeamMemberNotFound = errors.New("team member not found")
	ErrInvalidTeamRole    = errors.New("invalid team role")
)

const (
	RoleOwner   = "owner"
	RoleCaptain = "captain"
	RoleMember  = "member"
)

type Team struct {
	ID          string          `json:"id"`
	Name        string          `json:"name"`
	Slug        string          `json:"slug"`
	Description string          `json:"description"`
	OwnerUserID string          `json:"owner_user_id"`
	MemberCount int             `json:"member_count"`
	School      *SchoolSummary  `json:"school,omitempty"`
	Games       []GameSummary   `json:"games"`
	ViewerRole  *string         `json:"viewer_role,omitempty"`
	Members     []MemberSummary `json:"members,omitempty"`
}

type MemberSummary struct {
	UserID string `json:"user_id"`
	Name   string `json:"name"`
	Role   string `json:"role"`
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
	Name        string
	Description string
	OwnerUserID string
	SchoolID    string
	GameIDs     []string
	Password    string
}

type CreateParams struct {
	CreateInput
	PasswordHash string
}

type Repository interface {
	Create(ctx context.Context, params CreateParams) (Team, error)
	PasswordHash(ctx context.Context, slug string) (string, error)
	Join(ctx context.Context, slug string, userID string) (Team, error)
	MembershipRole(ctx context.Context, slug string, userID string) (string, error)
	ListMembers(ctx context.Context, slug string) ([]MemberSummary, error)
	SetCaptain(ctx context.Context, slug string, ownerUserID string, memberUserID string, captain bool) (Team, error)
	TransferOwnership(ctx context.Context, slug string, ownerUserID string, newOwnerUserID string) (Team, error)
	ListPublic(ctx context.Context, params ListParams) ([]Team, error)
	GetBySlug(ctx context.Context, slug string) (Team, error)
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
	if name := strings.TrimSpace(input.Name); name == "" || len(name) > 120 {
		return errors.New("team name is required and must be 120 characters or fewer")
	}
	if len(input.Description) > 5000 {
		return errors.New("description must be 5,000 characters or fewer")
	}
	if strings.TrimSpace(input.OwnerUserID) == "" {
		return errors.New("owner user is required")
	}
	if len(input.GameIDs) == 0 {
		return errors.New("at least one game is required")
	}
	for _, gameID := range input.GameIDs {
		if strings.TrimSpace(gameID) == "" {
			return errors.New("game IDs must be valid")
		}
	}
	if len(strings.TrimSpace(input.Password)) < 8 {
		return errors.New("team join password must be at least 8 characters")
	}
	return nil
}

func GenerateSlug(name string, ownerUserID string, createdAt time.Time) string {
	base := Slugify(name)
	hash := sha256.Sum256([]byte(strings.Join([]string{
		strings.TrimSpace(ownerUserID),
		createdAt.UTC().Format(time.RFC3339Nano),
		strings.TrimSpace(name),
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
		return "team"
	}
	return result
}

func (r *PostgresRepository) Create(ctx context.Context, params CreateParams) (Team, error) {
	if err := ValidateCreateInput(params.CreateInput); err != nil {
		return Team{}, err
	}
	if strings.TrimSpace(params.PasswordHash) == "" {
		return Team{}, errors.New("team password hash is required")
	}

	params = normalizeCreateParams(params)
	baseSlug := GenerateSlug(params.Name, params.OwnerUserID, r.now())
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
			return Team{}, err
		}
		return r.GetBySlug(ctx, createdSlug)
	}

	return Team{}, ErrSlugUnavailable
}

func (r *PostgresRepository) ListPublic(ctx context.Context, params ListParams) ([]Team, error) {
	params = NormalizeListParams(params)
	rows, err := r.pool.Query(ctx, teamSelectSQL(`
		t.deleted_at IS NULL
		AND ($1 = '' OR EXISTS (
			SELECT 1
			FROM team_games filter_tg
			JOIN games filter_g ON filter_g.id = filter_tg.game_id
			WHERE filter_tg.team_id = t.id
			  AND filter_g.slug = $1
			  AND filter_g.deleted_at IS NULL
		))
		AND ($2 = '' OR s.slug = $2)
	`, `
		ORDER BY t.created_at DESC, t.id
		LIMIT $3 OFFSET $4
	`), params.GameSlug, params.SchoolSlug, params.Limit, params.Offset)
	if err != nil {
		return nil, fmt.Errorf("list teams: %w", err)
	}
	defer rows.Close()

	result := make([]Team, 0, params.Limit)
	for rows.Next() {
		team, err := scanTeam(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, team)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate teams: %w", err)
	}
	return result, nil
}

func (r *PostgresRepository) GetBySlug(ctx context.Context, slug string) (Team, error) {
	row := r.pool.QueryRow(ctx, teamSelectSQL(`
		t.deleted_at IS NULL
		AND t.slug = $1
	`, ``), strings.TrimSpace(slug))
	return scanTeam(row)
}

func (r *PostgresRepository) PasswordHash(ctx context.Context, slug string) (string, error) {
	var hash string
	err := r.pool.QueryRow(ctx, `
		SELECT password_hash
		FROM teams
		WHERE slug = $1
		  AND deleted_at IS NULL
	`, strings.TrimSpace(slug)).Scan(&hash)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrTeamNotFound
	}
	if err != nil {
		return "", fmt.Errorf("get team password hash: %w", err)
	}
	return hash, nil
}

func (r *PostgresRepository) Join(ctx context.Context, slug string, userID string) (Team, error) {
	slug = strings.TrimSpace(slug)
	userID = strings.TrimSpace(userID)
	if slug == "" || userID == "" {
		return Team{}, errors.New("team slug and user are required")
	}

	teamID, err := r.teamIDBySlug(ctx, slug)
	if err != nil {
		return Team{}, err
	}
	if _, err := r.pool.Exec(ctx, `
		INSERT INTO team_members (team_id, user_id, role)
		VALUES ($1::uuid, $2::uuid, 'member')
		ON CONFLICT (team_id, user_id)
		DO UPDATE SET role = CASE
		                  WHEN team_members.deleted_at IS NULL THEN team_members.role
		                  ELSE 'member'
		              END,
		              deleted_at = NULL
	`, teamID, userID); err != nil {
		return Team{}, fmt.Errorf("join team: %w", err)
	}

	return r.teamForViewer(ctx, slug, userID)
}

func (r *PostgresRepository) MembershipRole(ctx context.Context, slug string, userID string) (string, error) {
	var role string
	err := r.pool.QueryRow(ctx, `
		SELECT m.role
		FROM teams t
		JOIN team_members m ON m.team_id = t.id
		WHERE t.slug = $1
		  AND t.deleted_at IS NULL
		  AND m.user_id = $2::uuid
		  AND m.deleted_at IS NULL
	`, strings.TrimSpace(slug), strings.TrimSpace(userID)).Scan(&role)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return role, err
}

func (r *PostgresRepository) ListMembers(ctx context.Context, slug string) ([]MemberSummary, error) {
	teamID, err := r.teamIDBySlug(ctx, slug)
	if err != nil {
		return nil, err
	}
	rows, err := r.pool.Query(ctx, `
		SELECT m.user_id::text, u.name, m.role
		FROM team_members m
		JOIN users u ON u.id = m.user_id
		WHERE m.team_id = $1::uuid
		  AND m.deleted_at IS NULL
		  AND u.deleted_at IS NULL
		  AND u.account_status = 'active'
		ORDER BY CASE m.role
		           WHEN 'owner' THEN 0
		           WHEN 'captain' THEN 1
		           ELSE 2
		         END,
		         LOWER(u.name), u.id::text
	`, teamID)
	if err != nil {
		return nil, fmt.Errorf("list team members: %w", err)
	}
	defer rows.Close()

	members := []MemberSummary{}
	for rows.Next() {
		var member MemberSummary
		if err := rows.Scan(&member.UserID, &member.Name, &member.Role); err != nil {
			return nil, fmt.Errorf("scan team member: %w", err)
		}
		members = append(members, member)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate team members: %w", err)
	}
	return members, nil
}

func (r *PostgresRepository) SetCaptain(ctx context.Context, slug string, ownerUserID string, memberUserID string, captain bool) (Team, error) {
	slug = strings.TrimSpace(slug)
	ownerUserID = strings.TrimSpace(ownerUserID)
	memberUserID = strings.TrimSpace(memberUserID)
	if slug == "" || ownerUserID == "" || memberUserID == "" {
		return Team{}, errors.New("team slug, owner, and member are required")
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return Team{}, fmt.Errorf("begin set captain: %w", err)
	}
	defer tx.Rollback(ctx)

	teamID, err := r.teamIDForOwner(ctx, tx, slug, ownerUserID)
	if err != nil {
		return Team{}, err
	}
	role, err := activeMemberRole(ctx, tx, teamID, memberUserID)
	if err != nil {
		return Team{}, err
	}
	if role == RoleOwner {
		return Team{}, ErrInvalidTeamRole
	}

	nextRole := RoleMember
	if captain {
		nextRole = RoleCaptain
	}
	if _, err := tx.Exec(ctx, `
		UPDATE team_members
		SET role = $3
		WHERE team_id = $1::uuid
		  AND user_id = $2::uuid
		  AND deleted_at IS NULL
	`, teamID, memberUserID, nextRole); err != nil {
		return Team{}, fmt.Errorf("set team captain: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return Team{}, fmt.Errorf("commit set captain: %w", err)
	}

	return r.teamForViewer(ctx, slug, ownerUserID)
}

func (r *PostgresRepository) TransferOwnership(ctx context.Context, slug string, ownerUserID string, newOwnerUserID string) (Team, error) {
	slug = strings.TrimSpace(slug)
	ownerUserID = strings.TrimSpace(ownerUserID)
	newOwnerUserID = strings.TrimSpace(newOwnerUserID)
	if slug == "" || ownerUserID == "" || newOwnerUserID == "" {
		return Team{}, errors.New("team slug, owner, and new owner are required")
	}
	if ownerUserID == newOwnerUserID {
		return Team{}, ErrInvalidTeamRole
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return Team{}, fmt.Errorf("begin transfer team ownership: %w", err)
	}
	defer tx.Rollback(ctx)

	teamID, err := r.teamIDForOwner(ctx, tx, slug, ownerUserID)
	if err != nil {
		return Team{}, err
	}
	if _, err := activeMemberRole(ctx, tx, teamID, newOwnerUserID); err != nil {
		return Team{}, err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE teams
		SET owner_user_id = $2::uuid
		WHERE id = $1::uuid
		  AND deleted_at IS NULL
	`, teamID, newOwnerUserID); err != nil {
		return Team{}, fmt.Errorf("transfer team ownership: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		UPDATE team_members
		SET role = CASE
			WHEN user_id = $2::uuid THEN 'owner'
			WHEN user_id = $3::uuid THEN 'member'
			WHEN role = 'owner' THEN 'member'
			ELSE role
		END
		WHERE team_id = $1::uuid
		  AND deleted_at IS NULL
	`, teamID, newOwnerUserID, ownerUserID); err != nil {
		return Team{}, fmt.Errorf("update team ownership roles: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return Team{}, fmt.Errorf("commit transfer team ownership: %w", err)
	}

	return r.teamForViewer(ctx, slug, ownerUserID)
}

func (r *PostgresRepository) createWithSlug(ctx context.Context, params CreateParams, slug string) (string, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("begin team create: %w", err)
	}
	defer tx.Rollback(ctx)

	var teamID string
	err = tx.QueryRow(ctx, `
		INSERT INTO teams (owner_user_id, school_id, name, slug, description, password_hash)
		SELECT $1::uuid, s.id, $3, $4, $5, $6
		FROM (SELECT NULLIF($2, '')::uuid AS school_id) input
		LEFT JOIN schools s ON s.id = input.school_id
		                   AND s.deleted_at IS NULL
		                   AND s.is_active = TRUE
		WHERE input.school_id IS NULL OR s.id IS NOT NULL
		ON CONFLICT (slug) DO NOTHING
		RETURNING id::text
	`, params.OwnerUserID, params.SchoolID, params.Name, slug, params.Description, params.PasswordHash).Scan(&teamID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", r.createNoRowsError(ctx, tx, params.SchoolID)
	}
	if err != nil {
		return "", fmt.Errorf("insert team: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO team_members (team_id, user_id, role)
		VALUES ($1::uuid, $2::uuid, 'owner')
	`, teamID, params.OwnerUserID); err != nil {
		return "", fmt.Errorf("insert team owner: %w", err)
	}

	insertedGameCount, err := insertTeamGames(ctx, tx, teamID, params.GameIDs)
	if err != nil {
		return "", err
	}
	if insertedGameCount != len(params.GameIDs) {
		return "", ErrGameNotFound
	}

	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("commit team create: %w", err)
	}
	return slug, nil
}

type teamScanner interface {
	Scan(dest ...any) error
}

type teamGameInserter interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

func scanTeam(scanner teamScanner) (Team, error) {
	var team Team
	var schoolID sql.NullString
	var schoolName sql.NullString
	var schoolSlug sql.NullString
	var schoolCity sql.NullString
	var schoolState sql.NullString
	var gameIDs []string
	var gameNames []string
	var gameSlugs []string

	err := scanner.Scan(
		&team.ID,
		&team.Name,
		&team.Slug,
		&team.Description,
		&team.OwnerUserID,
		&team.MemberCount,
		&schoolID,
		&schoolName,
		&schoolSlug,
		&schoolCity,
		&schoolState,
		&gameIDs,
		&gameNames,
		&gameSlugs,
	)
	if err != nil {
		return Team{}, err
	}

	if schoolID.Valid {
		team.School = &SchoolSummary{
			ID:    schoolID.String,
			Name:  schoolName.String,
			Slug:  schoolSlug.String,
			City:  schoolCity.String,
			State: schoolState.String,
		}
	}

	team.Games = make([]GameSummary, 0, len(gameIDs))
	for index := range gameIDs {
		team.Games = append(team.Games, GameSummary{
			ID:   gameIDs[index],
			Name: gameNames[index],
			Slug: gameSlugs[index],
		})
	}

	return team, nil
}

func teamSelectSQL(whereClause string, tailClause string) string {
	return `
		SELECT t.id::text, t.name, t.slug, t.description, t.owner_user_id::text,
		       COALESCE(member_counts.member_count, 0)::int,
		       s.id::text, s.name, s.slug, COALESCE(s.city, ''), COALESCE(s.state, ''),
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
		FROM teams t
		LEFT JOIN schools s ON s.id = t.school_id
		LEFT JOIN team_games tg ON tg.team_id = t.id
		LEFT JOIN games g ON g.id = tg.game_id AND g.deleted_at IS NULL
		LEFT JOIN LATERAL (
			SELECT COUNT(*) AS member_count
			FROM team_members m
			WHERE m.team_id = t.id
			  AND m.deleted_at IS NULL
		) member_counts ON TRUE
		WHERE ` + whereClause + `
		GROUP BY t.id, t.name, t.slug, t.description, t.owner_user_id,
		         s.id, s.name, s.slug, s.city, s.state, member_counts.member_count
	` + tailClause
}

type schoolExistenceChecker interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

type teamQueryer interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func (r *PostgresRepository) createNoRowsError(ctx context.Context, checker schoolExistenceChecker, schoolID string) error {
	schoolID = strings.TrimSpace(schoolID)
	if schoolID == "" {
		return ErrSlugUnavailable
	}
	var schoolExists bool
	if err := checker.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM schools
			WHERE id = $1::uuid
			  AND deleted_at IS NULL
			  AND is_active = TRUE
		)
	`, schoolID).Scan(&schoolExists); err != nil {
		return fmt.Errorf("check team school: %w", err)
	}
	if !schoolExists {
		return ErrSchoolNotFound
	}
	return ErrSlugUnavailable
}

func (r *PostgresRepository) teamIDBySlug(ctx context.Context, slug string) (string, error) {
	var teamID string
	err := r.pool.QueryRow(ctx, `
		SELECT id::text
		FROM teams
		WHERE slug = $1
		  AND deleted_at IS NULL
	`, strings.TrimSpace(slug)).Scan(&teamID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrTeamNotFound
	}
	if err != nil {
		return "", fmt.Errorf("get team id by slug: %w", err)
	}
	return teamID, nil
}

func (r *PostgresRepository) teamIDForOwner(ctx context.Context, queryer teamQueryer, slug string, ownerUserID string) (string, error) {
	var teamID string
	err := queryer.QueryRow(ctx, `
		SELECT id::text
		FROM teams
		WHERE slug = $1
		  AND owner_user_id = $2::uuid
		  AND deleted_at IS NULL
		FOR UPDATE
	`, strings.TrimSpace(slug), strings.TrimSpace(ownerUserID)).Scan(&teamID)
	if err == nil {
		return teamID, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", fmt.Errorf("get team owner: %w", err)
	}

	exists, err := teamExistsBySlug(ctx, queryer, slug)
	if err != nil {
		return "", err
	}
	if !exists {
		return "", ErrTeamNotFound
	}
	return "", ErrNotTeamOwner
}

func teamExistsBySlug(ctx context.Context, queryer teamQueryer, slug string) (bool, error) {
	var exists bool
	if err := queryer.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM teams
			WHERE slug = $1
			  AND deleted_at IS NULL
		)
	`, strings.TrimSpace(slug)).Scan(&exists); err != nil {
		return false, fmt.Errorf("check team exists: %w", err)
	}
	return exists, nil
}

func activeMemberRole(ctx context.Context, queryer teamQueryer, teamID string, userID string) (string, error) {
	var role string
	err := queryer.QueryRow(ctx, `
		SELECT m.role
		FROM team_members m
		JOIN users u ON u.id = m.user_id
		WHERE m.team_id = $1::uuid
		  AND m.user_id = $2::uuid
		  AND m.deleted_at IS NULL
		  AND u.deleted_at IS NULL
		  AND u.account_status = 'active'
	`, strings.TrimSpace(teamID), strings.TrimSpace(userID)).Scan(&role)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrTeamMemberNotFound
	}
	if err != nil {
		return "", fmt.Errorf("get team member role: %w", err)
	}
	return role, nil
}

func (r *PostgresRepository) teamForViewer(ctx context.Context, slug string, userID string) (Team, error) {
	team, err := r.GetBySlug(ctx, slug)
	if err != nil {
		return Team{}, err
	}
	role, err := r.MembershipRole(ctx, slug, userID)
	if err != nil {
		return Team{}, err
	}
	if role == "" {
		return team, nil
	}
	team.ViewerRole = &role
	if role == RoleOwner {
		members, err := r.ListMembers(ctx, slug)
		if err != nil {
			return Team{}, err
		}
		team.Members = members
	}
	return team, nil
}

func insertTeamGames(ctx context.Context, tx teamGameInserter, teamID string, gameIDs []string) (int, error) {
	rows, err := tx.Query(ctx, `
		INSERT INTO team_games (team_id, game_id)
		SELECT $1::uuid, g.id
		FROM games g
		WHERE g.id::text = ANY($2)
		  AND g.deleted_at IS NULL
		ON CONFLICT (team_id, game_id) DO NOTHING
		RETURNING game_id::text
	`, teamID, gameIDs)
	if err != nil {
		return 0, fmt.Errorf("insert team games: %w", err)
	}
	defer rows.Close()

	count := 0
	for rows.Next() {
		var gameID string
		if err := rows.Scan(&gameID); err != nil {
			return 0, fmt.Errorf("scan inserted team game: %w", err)
		}
		count++
	}
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("iterate inserted team games: %w", err)
	}
	return count, nil
}

func normalizeCreateParams(params CreateParams) CreateParams {
	params.Name = strings.TrimSpace(params.Name)
	params.Description = strings.TrimSpace(params.Description)
	params.OwnerUserID = strings.TrimSpace(params.OwnerUserID)
	params.SchoolID = strings.TrimSpace(params.SchoolID)
	params.GameIDs = normalizeIDs(params.GameIDs)
	params.PasswordHash = strings.TrimSpace(params.PasswordHash)
	return params
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
