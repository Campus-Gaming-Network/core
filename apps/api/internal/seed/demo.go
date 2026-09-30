package seed

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/auth"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/events"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/teams"
	"github.com/brianvoe/gofakeit/v7"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// DemoEmailDomain marks every demo account. Reset and idempotency both key off it.
const DemoEmailDomain = "demo.campusgamingnetwork.test"

const (
	demoSchoolPool = 800
	demoBatchSize  = 5000
)

// Named accounts that cover the roles and states the UI distinguishes. They
// occupy the first user indexes; every other account is generated.
const (
	personaPlayer = iota
	personaOrganizer
	personaSchoolAdmin
	personaFaculty
	personaSuspended
	personaNewcomer
	personaUnverified
	personaModerator
	personaCount
)

var demoPersonaEmails = [personaCount]string{
	"player", "organizer", "schooladmin", "faculty", "suspended", "newcomer", "unverified", "moderator",
}

// DemoOptions sizes the demo dataset. Equal options and an equal catalog yield equal rows.
type DemoOptions struct {
	Password string
	Seed     uint64
	Users    int
	Events   int
	Teams    int
	Now      time.Time
}

// DemoResult reports how many rows of each kind the run attempted to insert.
type DemoResult struct {
	Users, Events, RSVPs, Teams, Reports, SupportTickets, Notifications int
}

type demoSchool struct {
	ID, Name, City, State string
}

type demoUser struct {
	ID, Email, Name string
	SchoolIndex     int
	Suspended       bool
	Active          bool // may appear in RSVPs, teams, and moderation records
}

type demoEvent struct {
	ID, Slug, ParentID, Rule string
	CreatorIndex             int
	Organizers               []int
	GameIDs                  []string
	Capacity                 int
	StartsAt                 time.Time
	Cancelled                bool
	Private                  bool
}

type demoWriter struct {
	ctx   context.Context
	tx    pgx.Tx
	batch *pgx.Batch
	err   error
}

func (w *demoWriter) queue(sql string, args ...any) {
	if w.err != nil {
		return
	}
	w.batch.Queue(sql, args...)
	if w.batch.Len() >= demoBatchSize {
		w.flush()
	}
}

func (w *demoWriter) flush() {
	if w.err != nil || w.batch.Len() == 0 {
		return
	}
	results := w.tx.SendBatch(w.ctx, w.batch)
	w.err = results.Close()
	w.batch = &pgx.Batch{}
}

// demoID derives a stable version-4 UUID so reruns address the same rows.
func demoID(kind string, index int) string {
	sum := sha256.Sum256([]byte(fmt.Sprintf("cgn-demo|%s|%d", kind, index)))
	sum[6] = sum[6]&0x0f | 0x40
	sum[8] = sum[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", sum[0:4], sum[4:6], sum[6:8], sum[8:10], sum[10:16])
}

// ResetDemoData deletes every row owned by a demo account.
func ResetDemoData(ctx context.Context, pool *pgxpool.Pool) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin demo reset: %w", err)
	}
	defer tx.Rollback(ctx)

	const demoUsers = `(SELECT id FROM users WHERE email LIKE '%@' || $1)`
	statements := []string{
		`DELETE FROM reports WHERE reporter_user_id IN ` + demoUsers,
		`DELETE FROM support_tickets WHERE contact_email LIKE '%@' || $1`,
		`DELETE FROM events WHERE recurrence_parent_id IS NOT NULL AND creator_user_id IN ` + demoUsers,
		`DELETE FROM events WHERE creator_user_id IN ` + demoUsers,
		`DELETE FROM teams WHERE owner_user_id IN ` + demoUsers,
		`DELETE FROM users WHERE email LIKE '%@' || $1`,
	}
	for _, statement := range statements {
		if _, err := tx.Exec(ctx, statement, DemoEmailDomain); err != nil {
			return fmt.Errorf("reset demo data: %w", err)
		}
	}
	return tx.Commit(ctx)
}

// EnsureDemoData fills a local database with varied users, schools activity,
// events, teams, and moderation records. Every insert ignores conflicts, so a
// rerun with the same options is a no-op.
func EnsureDemoData(ctx context.Context, pool *pgxpool.Pool, options DemoOptions) (DemoResult, error) {
	if options.Users < personaCount || options.Events < 1 || options.Teams < 1 {
		return DemoResult{}, errors.New("demo seed needs at least 8 users, 1 event, and 1 team")
	}
	if len(options.Password) < 8 {
		return DemoResult{}, errors.New("demo seed password must be at least 8 characters")
	}
	passwordHash, err := auth.HashPassword(options.Password)
	if err != nil {
		return DemoResult{}, fmt.Errorf("hash demo password: %w", err)
	}

	schools, err := loadDemoSchools(ctx, pool)
	if err != nil {
		return DemoResult{}, err
	}
	gameIDs, err := loadDemoGames(ctx, pool)
	if err != nil {
		return DemoResult{}, err
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return DemoResult{}, fmt.Errorf("begin demo seed: %w", err)
	}
	defer tx.Rollback(ctx)

	generator := gofakeit.New(options.Seed)
	now := options.Now.UTC().Truncate(time.Minute)
	w := &demoWriter{ctx: ctx, tx: tx, batch: &pgx.Batch{}}
	var result DemoResult

	users := seedDemoUsers(w, generator, options, now, schools, passwordHash)
	result.Users = len(users)
	seedDemoSchoolRoles(w, generator, users, schools)

	activeUsers := make([]int, 0, len(users))
	for index, user := range users {
		if user.Active {
			activeUsers = append(activeUsers, index)
		}
	}

	demoEvents := seedDemoEvents(w, generator, options, now, schools, users, activeUsers, gameIDs, passwordHash)
	result.Events = len(demoEvents)
	result.RSVPs = seedDemoEventActivity(w, generator, demoEvents, users, activeUsers)
	result.Teams = seedDemoTeams(w, generator, options, now, schools, users, activeUsers, gameIDs, passwordHash)
	result.Reports, result.SupportTickets = seedDemoModeration(w, generator, now, users, activeUsers, demoEvents)
	result.Notifications = seedDemoNotifications(w, generator, now, users, activeUsers, demoEvents)

	w.flush()
	if w.err != nil {
		return DemoResult{}, fmt.Errorf("write demo data: %w", w.err)
	}
	if err := tx.Commit(ctx); err != nil {
		return DemoResult{}, fmt.Errorf("commit demo seed: %w", err)
	}
	return result, nil
}

func loadDemoSchools(ctx context.Context, pool *pgxpool.Pool) ([]demoSchool, error) {
	rows, err := pool.Query(ctx, `
		SELECT id::text, name, COALESCE(city, ''), COALESCE(state, '')
		FROM schools
		WHERE deleted_at IS NULL AND is_active = TRUE
		ORDER BY md5(id::text)
		LIMIT $1
	`, demoSchoolPool)
	if err != nil {
		return nil, fmt.Errorf("load demo schools: %w", err)
	}
	defer rows.Close()

	var schools []demoSchool
	for rows.Next() {
		var school demoSchool
		if err := rows.Scan(&school.ID, &school.Name, &school.City, &school.State); err != nil {
			return nil, fmt.Errorf("scan demo school: %w", err)
		}
		schools = append(schools, school)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read demo schools: %w", err)
	}
	if len(schools) == 0 {
		return nil, errors.New("demo seed needs the school catalog; import schools first")
	}
	return schools, nil
}

func loadDemoGames(ctx context.Context, pool *pgxpool.Pool) ([]string, error) {
	rows, err := pool.Query(ctx, `
		SELECT id::text FROM games WHERE deleted_at IS NULL AND slug = ANY($1) ORDER BY slug
	`, demoGameSlugs)
	if err != nil {
		return nil, fmt.Errorf("load demo games: %w", err)
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan demo game: %w", err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read demo games: %w", err)
	}
	if len(ids) == 0 {
		return nil, errors.New("demo seed needs the launch games; run migrations first")
	}
	return ids, nil
}

func demoPick[T any](generator *gofakeit.Faker, values []T) T {
	return values[generator.IntN(len(values))]
}

// demoSchoolIndex skews toward the front of the pool so some schools are busy
// and most are quiet, as the real catalog would be.
func demoSchoolIndex(generator *gofakeit.Faker, count int) int {
	ratio := generator.Float64()
	return int(ratio * ratio * float64(count))
}

func demoDistinct(generator *gofakeit.Faker, pool []int, count int, exclude ...int) []int {
	if count > len(pool) {
		count = len(pool)
	}
	taken := make(map[int]bool, count+len(exclude))
	for _, value := range exclude {
		taken[value] = true
	}
	picked := make([]int, 0, count)
	for attempts := 0; len(picked) < count && attempts < count*8; attempts++ {
		value := pool[generator.IntN(len(pool))]
		if taken[value] {
			continue
		}
		taken[value] = true
		picked = append(picked, value)
	}
	return picked
}

func seedDemoUsers(w *demoWriter, generator *gofakeit.Faker, options DemoOptions, now time.Time, schools []demoSchool, passwordHash string) []demoUser {
	users := make([]demoUser, options.Users)
	for index := range users {
		user := demoUser{
			ID:          demoID("user", index),
			SchoolIndex: demoSchoolIndex(generator, len(schools)),
			Active:      index >= personaCount,
		}
		level := "basic"
		verified := generator.IntN(100) >= 5
		switch roll := generator.IntN(100); {
		case roll >= 95:
			level = "staff_faculty"
		case roll >= 70:
			level = "verified"
		}
		status := "active"
		if generator.IntN(100) < 2 {
			status = "suspended"
		}

		user.Name = generator.Name()
		switch {
		case index < personaCount:
			user.Email = demoPersonaEmails[index] + "@" + DemoEmailDomain
			user.Name = strings.ToUpper(demoPersonaEmails[index][:1]) + demoPersonaEmails[index][1:] + " Demo"
			level, verified, status = "basic", true, "active"
			switch index {
			case personaFaculty:
				level = "staff_faculty"
			case personaSuspended:
				status = "suspended"
			case personaUnverified:
				verified = false
			case personaPlayer, personaOrganizer, personaSchoolAdmin, personaModerator:
				level = "verified"
			}
		case generator.IntN(100) < 6:
			user.Name = demoPick(generator, demoUnicodeNames)
			fallthrough
		default:
			user.Email = fmt.Sprintf("user%d@%s", index, DemoEmailDomain)
		}
		user.Suspended = status == "suspended"
		user.Active = user.Active && !user.Suspended

		var bio any
		if generator.IntN(100) < 60 {
			bio = strings.TrimSpace(generator.LoremIpsumSentence(8 + generator.IntN(30)))
		}
		var verifiedAt any
		if verified {
			verifiedAt = now.AddDate(0, 0, -generator.IntN(400))
		}
		school := schools[user.SchoolIndex]
		w.queue(`
			INSERT INTO users (
				id, email, password_hash, email_verified_at, verification_level, name, bio,
				timezone, home_school_id, age_confirmed_at, account_status, created_at
			)
			VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9::uuid, $10, $11, $10)
			ON CONFLICT DO NOTHING
		`, user.ID, user.Email, passwordHash, verifiedAt, level, user.Name, bio,
			demoPick(generator, demoTimezones), school.ID, now.AddDate(0, 0, -generator.IntN(400)-1), status)

		if index == personaNewcomer {
			users[index] = user
			continue
		}
		for order := 0; order < generator.IntN(4); order++ {
			link := demoPick(generator, demoSocialLabels)
			handle := strings.ToLower(strings.ReplaceAll(generator.Username(), " ", ""))
			w.queue(`
				INSERT INTO user_social_links (id, user_id, label, url, sort_order)
				VALUES ($1::uuid, $2::uuid, $3, $4, $5)
				ON CONFLICT DO NOTHING
			`, demoID("social", index*10+order), user.ID, link.Label, link.URL+handle, order)
		}
		for follow := 0; follow < generator.IntN(6); follow++ {
			followed := demoSchoolIndex(generator, len(schools))
			if followed == user.SchoolIndex {
				continue
			}
			w.queue(`
				INSERT INTO user_school_follows (user_id, school_id)
				VALUES ($1::uuid, $2::uuid)
				ON CONFLICT DO NOTHING
			`, user.ID, schools[followed].ID)
		}
		users[index] = user
	}
	return users
}

func seedDemoSchoolRoles(w *demoWriter, generator *gofakeit.Faker, users []demoUser, schools []demoSchool) {
	w.queue(`
		INSERT INTO school_admins (school_id, user_id) VALUES ($1::uuid, $2::uuid)
		ON CONFLICT DO NOTHING
	`, schools[users[personaSchoolAdmin].SchoolIndex].ID, users[personaSchoolAdmin].ID)

	for grant := 0; grant < 40; grant++ {
		user := users[personaCount+generator.IntN(len(users)-personaCount)]
		if user.Suspended {
			continue
		}
		var revokedAt any
		if generator.IntN(5) == 0 {
			revokedAt = time.Now().UTC().AddDate(0, 0, -generator.IntN(60))
		}
		w.queue(`
			INSERT INTO school_admins (school_id, user_id, deleted_at)
			VALUES ($1::uuid, $2::uuid, $3)
			ON CONFLICT DO NOTHING
		`, schools[user.SchoolIndex].ID, user.ID, revokedAt)
	}
}

func seedDemoEvents(
	w *demoWriter, generator *gofakeit.Faker, options DemoOptions, now time.Time,
	schools []demoSchool, users []demoUser, activeUsers []int, gameIDs []string, passwordHash string,
) []demoEvent {
	var created []demoEvent
	slugs := make(map[string]bool)
	insert := func(event demoEvent, title string, endsAt time.Time, row map[string]any, until any) {
		w.queue(`
			INSERT INTO events (
				id, creator_user_id, host_school_id, title, slug, description, visibility, format,
				starts_at, ends_at, timezone, location_name, address, online_url,
				private_password_hash, capacity, is_paid, payment_note, payment_url,
				recurrence_rule, recurrence_until, recurrence_parent_id, created_at, deleted_at
			)
			VALUES (
				$1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
				$15, $16, $17, $18, $19, $20, $21, NULLIF($22, '')::uuid, $23, $24
			)
			ON CONFLICT DO NOTHING
		`, event.ID, users[event.CreatorIndex].ID, row["school"], title, event.Slug, row["description"],
			row["visibility"], row["format"], event.StartsAt, endsAt, row["timezone"], row["venue"],
			row["address"], row["online"], row["password"], nilIfZero(event.Capacity), row["paid"],
			row["payNote"], row["payURL"], nilIfEmpty(event.Rule), until, event.ParentID,
			row["created"], row["deleted"])
	}

	for index := 0; index < options.Events; index++ {
		creator := activeUsers[generator.IntN(len(activeUsers))]
		if generator.IntN(100) < 2 {
			creator = personaOrganizer
		}
		school := schools[users[creator].SchoolIndex]
		gameIDsForEvent := []string{gameIDs[generator.IntN(len(gameIDs))]}
		if generator.IntN(100) < 20 {
			gameIDsForEvent = append(gameIDsForEvent, gameIDs[generator.IntN(len(gameIDs))])
			if gameIDsForEvent[0] == gameIDsForEvent[1] {
				gameIDsForEvent = gameIDsForEvent[:1]
			}
		}

		title := fmt.Sprintf("%s %s", demoPick(generator, demoEventKinds), demoPick(generator, demoEventModifiers))
		if generator.IntN(2) == 0 {
			title = fmt.Sprintf("%s %s", shortSchoolName(school.Name), title)
		}
		title = strings.TrimSpace(title)
		if generator.IntN(40) == 0 {
			title += " — " + strings.Repeat("Extended Edition ", 4)
			title = strings.TrimSpace(title)
		}

		var startsAt time.Time
		switch roll := generator.IntN(100); {
		case roll < 35:
			startsAt = now.Add(-time.Duration(1+generator.IntN(180*24)) * time.Hour)
		case roll < 45:
			startsAt = now.Add(time.Duration(generator.IntN(7*24)) * time.Hour)
		default:
			startsAt = now.Add(time.Duration(7*24+generator.IntN(143*24)) * time.Hour)
		}
		startsAt = startsAt.Truncate(15 * time.Minute)
		duration := time.Duration(1+generator.IntN(5)) * time.Hour
		if generator.IntN(15) == 0 {
			duration = time.Duration(8+generator.IntN(4)) * time.Hour
		}

		format := demoPick(generator, []string{"online", "in_person", "in_person", "hybrid"})
		var venue, address, online any
		if format != "online" {
			venue = demoPick(generator, demoEventVenues)
			address = fmt.Sprintf("%s, %s, %s", generator.Street(), school.City, school.State)
		}
		if format != "in_person" {
			online = "https://discord.gg/" + strings.ToLower(generator.Password(true, true, false, false, false, 8))
		}

		visibility := "public"
		var password any
		switch roll := generator.IntN(100); {
		case roll >= 90:
			visibility, password = "private", passwordHash
		case roll >= 75:
			visibility = "unlisted"
		}

		capacity := 0
		if generator.IntN(100) < 40 {
			capacity = 4 + generator.IntN(120)
			if generator.IntN(10) == 0 {
				capacity = 200 + generator.IntN(300)
			}
		}
		paid := generator.IntN(100) < 15
		var payNote, payURL any
		if paid {
			payNote = demoPick(generator, demoPaymentNotes)
			if generator.IntN(2) == 0 {
				payURL = "https://example.test/pay/" + fmt.Sprint(index)
			}
		}

		description := demoPick(generator, demoEventPitches) + " " + demoPick(generator, demoEventPitches)
		switch generator.IntN(10) {
		case 0:
			description = ""
		case 1:
			description = strings.TrimSpace(generator.LoremIpsumParagraph(3, 5, 14, "\n\n"))
		}

		createdAt := startsAt.AddDate(0, 0, -(3 + generator.IntN(40)))
		if createdAt.After(now) {
			createdAt = now.Add(-time.Duration(1+generator.IntN(72)) * time.Hour)
		}
		organizers := demoDistinct(generator, activeUsers, generator.IntN(4), creator)

		rule, occurrences, step := "", 1, time.Duration(0)
		if generator.IntN(100) < 3 {
			rule = demoPick(generator, []string{"weekly", "biweekly", "monthly"})
			occurrences = 3 + generator.IntN(10)
			step = map[string]time.Duration{"weekly": 7 * 24 * time.Hour, "biweekly": 14 * 24 * time.Hour}[rule]
		}
		var until any
		lastStart := startsAt
		if rule != "" {
			lastStart = demoOccurrenceStart(startsAt, rule, step, occurrences-1)
			until = lastStart
		}

		rootID := demoID("event", index)
		row := map[string]any{
			"school": school.ID, "description": description, "visibility": visibility, "format": format,
			"timezone": demoPick(generator, demoTimezones), "venue": venue, "address": address, "online": online,
			"password": password, "paid": paid, "payNote": payNote, "payURL": payURL, "created": createdAt,
		}
		for occurrence := 0; occurrence < occurrences; occurrence++ {
			start := demoOccurrenceStart(startsAt, rule, step, occurrence)
			event := demoEvent{
				ID:           rootID,
				CreatorIndex: creator,
				Organizers:   organizers,
				GameIDs:      gameIDsForEvent,
				Capacity:     capacity,
				StartsAt:     start,
				Rule:         rule,
				Private:      visibility == "private",
				Cancelled:    generator.IntN(100) < 5,
			}
			slug := events.GenerateSlug(title, users[creator].ID, createdAt)
			if occurrence > 0 {
				event.ID = demoID("event-occurrence", index*100+occurrence)
				event.ParentID = rootID
				slug = fmt.Sprintf("%s-%d", events.GenerateSlug(title, users[creator].ID, start), occurrence+1)
			}
			for suffix := 2; slugs[slug]; suffix++ {
				slug = fmt.Sprintf("%s-x%d", slug, suffix)
			}
			slugs[slug] = true
			event.Slug = slug

			row["deleted"] = nil
			if event.Cancelled {
				row["deleted"] = minTime(now, start).Add(-time.Hour)
			}
			insert(event, title, start.Add(duration), row, until)
			created = append(created, event)

			w.queue(`
				INSERT INTO event_organizers (event_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'creator')
				ON CONFLICT DO NOTHING
			`, event.ID, users[creator].ID)
			for _, organizer := range organizers {
				w.queue(`
					INSERT INTO event_organizers (event_id, user_id) VALUES ($1::uuid, $2::uuid)
					ON CONFLICT DO NOTHING
				`, event.ID, users[organizer].ID)
			}
			for _, gameID := range gameIDsForEvent {
				w.queue(`
					INSERT INTO event_games (event_id, game_id) VALUES ($1::uuid, $2::uuid)
					ON CONFLICT DO NOTHING
				`, event.ID, gameID)
			}
		}
	}
	return created
}

func demoOccurrenceStart(first time.Time, rule string, step time.Duration, occurrence int) time.Time {
	if rule == "monthly" {
		return first.AddDate(0, occurrence, 0)
	}
	return first.Add(step * time.Duration(occurrence))
}

func seedDemoEventActivity(w *demoWriter, generator *gofakeit.Faker, demoEvents []demoEvent, users []demoUser, activeUsers []int) int {
	rsvps := 0
	for _, event := range demoEvents {
		if event.Cancelled {
			continue
		}
		ratio := generator.Float64()
		attendees := int(ratio * ratio * ratio * 90)
		if event.Capacity > 0 && generator.IntN(100) < 15 {
			attendees = event.Capacity + generator.IntN(10)
		}
		yes := 0
		for _, index := range demoDistinct(generator, activeUsers, attendees) {
			response := demoPick(generator, []string{"yes", "yes", "yes", "maybe", "no"})
			if response == "yes" && event.Capacity > 0 && yes >= event.Capacity {
				response = "maybe"
			}
			if response == "yes" {
				yes++
			}
			w.queue(`
				INSERT INTO event_rsvps (event_id, user_id, response) VALUES ($1::uuid, $2::uuid, $3)
				ON CONFLICT DO NOTHING
			`, event.ID, users[index].ID, response)
			rsvps++
		}
		for _, index := range demoDistinct(generator, activeUsers, attendees/3) {
			w.queue(`
				INSERT INTO event_interests (event_id, user_id) VALUES ($1::uuid, $2::uuid)
				ON CONFLICT DO NOTHING
			`, event.ID, users[index].ID)
		}
	}
	return rsvps
}

func seedDemoTeams(
	w *demoWriter, generator *gofakeit.Faker, options DemoOptions, now time.Time,
	schools []demoSchool, users []demoUser, activeUsers []int, gameIDs []string, passwordHash string,
) int {
	slugs := make(map[string]bool)
	for index := 0; index < options.Teams; index++ {
		owner := activeUsers[generator.IntN(len(activeUsers))]
		school := schools[users[owner].SchoolIndex]
		name := demoPick(generator, demoTeamMascots) + " " + demoPick(generator, demoTeamSuffixes)
		if generator.IntN(2) == 0 {
			name = shortSchoolName(school.Name) + " " + name
		}
		createdAt := now.Add(-time.Duration(generator.IntN(300*24*60)) * time.Minute)
		slug := teams.GenerateSlug(name, users[owner].ID, createdAt)
		if slugs[slug] {
			continue
		}
		slugs[slug] = true

		teamID := demoID("team", index)
		var schoolID any
		if generator.IntN(100) < 70 {
			schoolID = school.ID
		}
		var deletedAt any
		if generator.IntN(100) < 4 {
			deletedAt = createdAt.AddDate(0, 0, 1+generator.IntN(60))
		}
		w.queue(`
			INSERT INTO teams (id, owner_user_id, school_id, name, slug, description, password_hash, created_at, deleted_at)
			VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9)
			ON CONFLICT DO NOTHING
		`, teamID, users[owner].ID, schoolID, name, slug,
			strings.TrimSpace(generator.LoremIpsumSentence(6+generator.IntN(24))), passwordHash, createdAt, deletedAt)
		w.queue(`
			INSERT INTO team_members (team_id, user_id, role) VALUES ($1::uuid, $2::uuid, 'owner')
			ON CONFLICT DO NOTHING
		`, teamID, users[owner].ID)

		ratio := generator.Float64()
		members := demoDistinct(generator, activeUsers, int(ratio*ratio*14), owner)
		for order, member := range members {
			role := "member"
			if order < generator.IntN(3) {
				role = "captain"
			}
			w.queue(`
				INSERT INTO team_members (team_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3)
				ON CONFLICT DO NOTHING
			`, teamID, users[member].ID, role)
		}
		seen := map[string]bool{}
		for game := 0; game <= generator.IntN(3); game++ {
			gameID := gameIDs[generator.IntN(len(gameIDs))]
			if seen[gameID] {
				continue
			}
			seen[gameID] = true
			w.queue(`
				INSERT INTO team_games (team_id, game_id) VALUES ($1::uuid, $2::uuid)
				ON CONFLICT DO NOTHING
			`, teamID, gameID)
		}
	}
	return len(slugs)
}

func seedDemoModeration(
	w *demoWriter, generator *gofakeit.Faker, now time.Time,
	users []demoUser, activeUsers []int, demoEvents []demoEvent,
) (int, int) {
	statuses := []string{"open", "open", "open", "in_review", "in_review", "resolved", "resolved", "closed"}
	moderator := users[personaModerator].ID
	const reports, tickets = 250, 180

	for index := 0; index < reports; index++ {
		status := demoPick(generator, statuses)
		reporter := users[activeUsers[generator.IntN(len(activeUsers))]]
		targetType, targetID := "event", demoEvents[generator.IntN(len(demoEvents))].ID
		if generator.IntN(100) < 40 {
			targetType, targetID = "user", users[activeUsers[generator.IntN(len(activeUsers))]].ID
		}
		createdAt := now.Add(-time.Duration(1+generator.IntN(60*24*60)) * time.Minute)
		w.queue(`
			INSERT INTO reports (
				id, reporter_user_id, target_type, target_id, reason, status,
				assigned_to_user_id, resolution_note, retention_started_at, created_at
			)
			VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5, $6, $7, $8, $9, $10)
			ON CONFLICT DO NOTHING
		`, demoID("report", index), reporter.ID, targetType, targetID, demoPick(generator, demoReportReasons),
			status, moderatorFor(status, moderator), resolutionFor(generator, status),
			retentionFor(status, createdAt), createdAt)
	}

	for index := 0; index < tickets; index++ {
		status := demoPick(generator, statuses)
		var submitter any
		email := fmt.Sprintf("visitor%d@%s", index, DemoEmailDomain)
		name := generator.Name()
		if generator.IntN(100) < 70 {
			user := users[activeUsers[generator.IntN(len(activeUsers))]]
			submitter, email, name = user.ID, user.Email, user.Name
		}
		createdAt := now.Add(-time.Duration(1+generator.IntN(60*24*60)) * time.Minute)
		w.queue(`
			INSERT INTO support_tickets (
				id, submitter_user_id, contact_email, name, subject, message, status,
				assigned_to_user_id, resolution_note, retention_started_at, created_at
			)
			VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11)
			ON CONFLICT DO NOTHING
		`, demoID("ticket", index), submitter, email, name, demoPick(generator, demoTicketSubjects),
			demoPick(generator, demoTicketMessages), status, moderatorFor(status, moderator),
			resolutionFor(generator, status), retentionFor(status, createdAt), createdAt)
	}
	return reports, tickets
}

func seedDemoNotifications(
	w *demoWriter, generator *gofakeit.Faker, now time.Time,
	users []demoUser, activeUsers []int, demoEvents []demoEvent,
) int {
	count := 0
	for _, index := range append([]int{personaPlayer, personaOrganizer}, activeUsers[:min(len(activeUsers), 600)]...) {
		for order := 0; order < 2+generator.IntN(9); order++ {
			kind := demoPick(generator, demoNotificationKinds)
			var entityType, entityID any
			if kind.Entity == "event" {
				entityType, entityID = "event", demoEvents[generator.IntN(len(demoEvents))].ID
			}
			var readAt any
			createdAt := now.Add(-time.Duration(1+generator.IntN(20*24*60)) * time.Minute)
			if generator.IntN(2) == 0 {
				readAt = createdAt.Add(time.Duration(1+generator.IntN(600)) * time.Minute)
			}
			w.queue(`
				INSERT INTO notifications (id, user_id, type, title, body, entity_type, entity_id, read_at, created_at)
				VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::uuid, $8, $9)
				ON CONFLICT DO NOTHING
			`, demoID("notification", index*100+order), users[index].ID, kind.Type, kind.Title,
				kind.Body, entityType, entityID, readAt, createdAt)
			count++
		}
	}
	return count
}

func moderatorFor(status, moderator string) any {
	if status == "open" {
		return nil
	}
	return moderator
}

func resolutionFor(generator *gofakeit.Faker, status string) string {
	if status == "resolved" || status == "closed" {
		return demoPick(generator, demoResolutionNotes)
	}
	return ""
}

func retentionFor(status string, createdAt time.Time) any {
	if status == "resolved" || status == "closed" {
		return createdAt.Add(48 * time.Hour)
	}
	return nil
}

func shortSchoolName(name string) string {
	words := strings.Fields(name)
	if len(words) > 3 {
		words = words[:3]
	}
	return strings.Join(words, " ")
}

func nilIfZero(value int) any {
	if value == 0 {
		return nil
	}
	return value
}

func nilIfEmpty(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func minTime(a, b time.Time) time.Time {
	if a.Before(b) {
		return a
	}
	return b
}
