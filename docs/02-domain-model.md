# 02 — Domain model

Canonical entities and business rules. Schema details live in [03 — Database](./03-database.md). Permissions in [07 — Permissions](./07-permissions.md).

## Entity map

```text
User ──< follows >── School
User ──< majors >── Major (or free-text; TBD)
User ── home school + affiliation(s) ── School
User ── roles ── SchoolAdmin | Faculty | ClubOfficer | TeamOwner/Captain | EventOrganizer | SiteAdmin

School ──< has >── Club (required parent)
School ── logo, slug, admins
Club   ──< may have >── Team (e.g. Varsity, JV)
Club   ── games
Team   ── games, members (URL + password), owner, captains; optional club_id
Event ── games, organizers, RSVPs, interests, location, capacity, visibility, slug
Tournament ── games, optional Event, individual | team, capacity, slug
Game ── MVP seed first; post-MVP CRM/IGDB managed (not editable by end users)

Report ── target: Event | User | …
Notification ── User
AuditLog ── polymorphic (school, event, team, club, …)
FeatureFlag ── targets: user | school | event | team
SiteAnnouncement ── global banner
```

## Entities

### User

| Field / concept | Notes |
|-----------------|-------|
| Email / password | Auth; forgot/reset password |
| Email verification | Signup sends verification email; link click sets email verified |
| Age gate | Must confirm **18+** at signup (checkbox); store acceptance timestamp |
| Name | Single public name field (no usernames; no first/last/display split) |
| Profile URL | `/users/:id` (database id) |
| Verification level | `basic` (email verified) \| `verified` (`.edu`) \| `staff_faculty` |
| Avatar | Gravatar at launch; fallback to initials when no Gravatar image exists |
| Bio, social links | Profile |
| Timezone | Default from system; used to display event times |
| School affiliations | Selects one home school during signup; can follow additional schools afterward |
| Majors | Multiple allowed |
| Graduation | Expected graduation date; alumni still participate |
| Degree level | Undergrad / graduate / etc. (open question) |
| Role context | Student, alumni, faculty advisor, etc. |
| Role indicators | School admin and faculty show a visible badge/indicator in UI |

**Rules**

- Account deletion: remove PII; retain structural records with name **“Deleted User”**
- Users can report other users from profiles
- Users see their own activity log

### School

| Field / concept | Notes |
|-----------------|-------|
| Name | Not required to be unique |
| Slug | URL identity; on collision append auto-increment (`-2`, `-3`, …) |
| UNITID | Optional (set on Scorecard-seeded rows; admin/CRM-created schools may omit) |
| Logo | Post-MVP CRM/admin upload only (PNG/JPG ≤500 MB); placeholder until set |
| Location | City, state, zip, lat/lng (from seed or CRM) |
| Admins | Many; a user may admin many schools |
| Clubs | Listed on school page when clubs ship (post-MVP) |
| Popularity | Derived (e.g. event volume) |

**Rules**

- National catalog **bootstrapped once** from College Scorecard (`data/schools_seed.csv`) — see [09 — School data](./09-school-data.md)
- Import **all** seed schools (main + branch), `is_active=true`; branch campuses use the same UI/UX as other schools; review/deactivate later in CRM/admin tooling
- After bootstrap, **post-MVP admin/CRM tooling** owns create / edit / soft-delete (users cannot create schools)
- Anyone (including logged-out) can **search and browse** schools
- School admins edit school details, **manage clubs** (when clubs ship), and assign school teams
- School admins **cannot** remove other school admins
- US only at launch
- Near-you / geo discovery is **post-MVP**

### Club

| Field / concept | Notes |
|-----------------|-------|
| School | **Required** — clubs exist only under a school |
| Official | Clubs are the official school org type |
| Teams | Optional assigned teams (Varsity, JV, etc.) |
| Games | One or more |
| Officers | Can create badge-eligible events |

**Rules**

- Users may **request** a club; **school admins** create, approve, and manage
- Visible on the parent school’s page
- Distinct from free-floating teams (a team may optionally belong to a club)

### Team

| Field / concept | Notes |
|-----------------|-------|
| Owner | Transferable |
| Captains | Assignable |
| Visibility | **Public** team page |
| Members | Password required to **join / interact** (not to view the page) |
| Club | Optional `club_id` when the team is part of a school club (Varsity, JV, …) |
| Games | One or more |
| School sponsorship | Optional sponsored team/group without a club |

**Rules**

- Anyone can create a team
- A user may create and belong to multiple teams
- Team pages are public; share URL freely; password is only for joining/interacting
- Invite-link tokens are **later**
- Captains register the team for team tournaments (when tournaments ship)

### Event

| Field / concept | Notes |
|-----------------|-------|
| Creator | Shown on event |
| Hosts / organizers | Multiple; shown on event |
| Slug | `slugify(title) + "-" + shortHash` — see slug algorithm below |
| Visibility | `public` \| `unlisted` \| `private` (all in MVP) |
| Password | Required when `visibility = private` (stored hashed); share URL + password manually |
| Capacity | Optional max attendees; counts **RSVP yes only**; when full, block new yes (no waitlist in MVP) |
| Format | `online` \| `in_person` |
| Pricing | MVP supports free vs paid/off-site-payment events; CGN does not process payment |
| Location | Physical address; optional mini Google Map |
| Banner | MVP: default placeholder only; custom user uploads later (moderated) |
| Description | Character-limited |
| Recurrence | Supported |
| Games | One or more |
| Registration | Closes automatically; blocked when ended or at capacity |
| Soft delete | `deleted_at` only |

**Visibility**

| Value | In search/browse | Access |
|-------|------------------|--------|
| `public` | Yes | Anyone with the page |
| `unlisted` | No | Anyone with the direct link/slug |
| `private` | No | Content fully gated (blurred / not inspectable) until password modal unlock succeeds |

**Lifecycle display**

| State | UI |
|-------|----|
| Upcoming | Show date and time (user timezone) |
| Happening now | “Happening now” |
| Ended | “Ended”; no further signups |
| Full | At capacity; no further RSVP yes |
| Missing / deleted | Dedicated “event no longer exists” page |

**RSVP vs interested**

- RSVP responses: `yes` \| `no` \| `maybe`
- **Interested** = favorite/bookmark; independent of RSVP
- On RSVP yes: send email with details + calendar (ICS)
- Creating an event requires **no approval**
- Soft-delete/cancel does **not** email RSVPs in MVP (notify later)
- Slug is generated at create time and should remain stable (do not regenerate on title edit)

**Event slug algorithm**

```text
payload = creatorUserId + "|" + createdDate (UTC date) + "|" + eventTitle
digest  = SHA-256(payload)
short   = first 8 characters of Base64URL(digest) (no padding)
slug    = slugify(eventTitle) + "-" + short
```

**Edit rules**

- Past events: organizers may edit **minor corrections only** — not date or location
- Badge: events created by school admin, club officer, or approved organizers

**Reports**

- Users can report events; site admins see all reports

### Tournament

| Field / concept | Notes |
|-----------------|-------|
| Slug | From name + short hash for uniqueness |
| Type | `individual` \| `team` |
| Capacity | Optional; when full, block new registrations (no waitlist); counting rule for team tournaments TBD |
| Optional event | May be tied to an Event |
| Games | One or more |

**Rules**

- Tournaments are their own entity (not a subtype of Event)
- Events = attend; tournaments = compete
- Team captains register teams for team tournaments
- Browse and **filter** tournaments by game (and related filters)

### Game

| Field / concept | Notes |
|-----------------|-------|
| MVP seed | Curated list (below); not user-editable |
| Later | IGDB import / CRM enrichment |
| Editable by end users | **No** — MVP seed first; post-MVP CRM/admin app later |

**MVP launch games**

1. Rocket League
2. Valorant
3. League of Legends
4. Overwatch 2
5. Super Smash Bros. Ultimate
6. CSGO

Used for: browse/filter events (and later tournaments) by game; popular games by school; associations on events/teams/clubs/tournaments.

### Report

- Targets: events, users (extensible)
- Visible to site admins in aggregate moderation views
- Rate-limited on create

### Notification

- Per-user notifications table
- Complements transactional email (e.g. event registration)

### Audit log (shared)

- Generic polymorphic log for school, event, team, club, etc.
- Schools/teams/events (and similar) can show what changed
- **Not** the same as system/operational logs

### Feature flag (post-MVP)

- Hold off for MVP
- Later: scopes for users, schools, events, teams; targeting specific users/schools

### Site announcement

- Deployable banner shown on every page

## Cross-cutting rules

| Topic | Rule |
|-------|------|
| Timestamps | Every table: `created_at`, `updated_at`, `deleted_at` |
| Soft deletes | Default for user-facing entities (esp. events) |
| Slugs | Schools: name + numeric suffix on collision. Events: `slugify(title)-` + first **8** Base64URL chars of SHA-256(creatorId\|date\|title) |
| Images | Event banners default placeholder in MVP; school logos later via CRM/admin upload (PNG or JPG only; max 500 MB) |
| Search | Postgres (`tsvector` / `pg_trgm`) before any external search service |
| Profanity | Block bad words in user-entered text |
| XSS / SQLi | Prevent via parameterized queries + output encoding / sanitization |
| Rate limits | Signups, event creation, reports (and general API rate limiting) |
| Timezones | Store events in absolute time; display in user timezone |
| US scope | No international school handling at launch |

## Relationship cardinality (summary)

| Relationship | Cardinality |
|--------------|-------------|
| User ↔ School (follow) | many-to-many |
| User ↔ School (admin) | many-to-many |
| User ↔ Major | many-to-many |
| User ↔ Team (member) | many-to-many |
| User → Team (owner) | one owner per team; user may own many |
| School → Club | one-to-many (required parent) |
| Club → Team | one-to-many (optional on team) |
| Event ↔ Organizer | many-to-many |
| Event ↔ Game | many-to-many |
| Team ↔ Game | many-to-many |
| Club ↔ Game | many-to-many |
| Tournament ↔ Game | many-to-many |
| Tournament → Event | optional many-to-one |
