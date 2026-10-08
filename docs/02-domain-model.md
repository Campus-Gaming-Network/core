# 02 — Domain model

Canonical entities and business rules. Schema details live in [03 — Database](./03-database.md). Permissions in [07 — Permissions](./07-permissions.md).

## Entity map

```text
User ──< follows >── School
User ──< majors >── Major (later; free-text or curated list is open)
User ── home school + affiliation(s) ── School
User ── roles ── SchoolAdmin | Faculty | ClubOfficer | TeamOwner/Captain | EventOrganizer | SiteAdmin

School ──< has >── Club (required parent)
School ── logo, slug, admins
Club   ──< may have >── Team (e.g. Varsity, JV)
Club   ── games
Team   ── games, members (URL + password), owner, captains; optional club_id
Event ── games, organizers, RSVPs, interests, location, capacity, visibility, slug
Tournament ── games, optional Event, individual | team, capacity, slug
Game ── imported from IGDB through the Admin Console (not editable by end users)

Report ── target: Event | User | …
Notification ── User                                      (later)
AuditLog ── polymorphic (school, event, team, club, …)    (later)
FeatureFlag ── targets: user | school | event | team    (later)
SiteAnnouncement ── global banner                        (later)
```

## Entities

### User

| Field / concept     | Notes                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| Email / password    | Auth; forgot/reset password                                                                         |
| Email verification  | Signup sends verification email; link click sets email verified                                     |
| Age gate            | Must confirm **18+** at signup (checkbox); store acceptance timestamp                               |
| Name                | Single public name field (no usernames; no first/last/display split)                                |
| Profile URL         | `/users/:id` (database id)                                                                          |
| Verification level  | `basic` (email verified) \| `verified` (`.edu`) \| `staff_faculty`                                  |
| Avatar              | Boring Avatars Beam drawn by this site from the user id; initials show when the picture cannot load |
| Bio, social links   | Profile                                                                                             |
| Timezone            | Default from system; used to display event times                                                    |
| School affiliations | Selects one home school during signup; can follow additional schools afterward                      |
| Majors              | Later: multiple allowed (open question in [08](./08-open-questions.md))                             |
| Graduation          | Later: expected graduation date; alumni still participate                                           |
| Degree level        | Later: undergrad / graduate / etc. (open question)                                                  |
| Role context        | Later: student, alumni, faculty advisor, etc.                                                       |
| Role indicators     | School-admin grants and staff/faculty status produce visible role indicators                        |
| List visibility     | `show_in_lists`, default on; off hides the person from the people lists (see rules below)           |

**Rules**

- Account deletion: remove PII; retain structural records with name **“Deleted User”**
- Users can report other users from profiles
- **People lists** show a user to signed-in viewers on the pages they belong to:
  event attendees (RSVP `yes`, and separately `maybe`; `interested` is a count
  only), school members (home school; followers are not members), and team
  members (any role). An account appears only while it is active, email-verified,
  and has `show_in_lists` on. The setting hides the person from lists only; their
  RSVPs, memberships, public profile, and every count are unchanged. `show_in_lists`
  is private: it is returned to the account's own `GET /me` and never on the
  public profile
- Users see their own activity log after the later activity-history slice ships

### School

| Field / concept | Notes                                                                           |
| --------------- | ------------------------------------------------------------------------------- |
| Name            | Not required to be unique                                                       |
| Slug            | URL identity; on collision append auto-increment (`-2`, `-3`, …)                |
| UNITID          | Optional (set on Scorecard-seeded rows; Admin Console-created schools may omit) |
| Logo            | Later Admin Console upload only (PNG/JPG ≤5 MB); placeholder until set          |
| Location        | City, state, zip, lat/lng (from seed or Admin Console)                          |
| Admins          | Many; a user may admin many schools                                             |
| Clubs           | Listed on school page when clubs ship (later)                                   |
| Popularity      | Derived (e.g. event volume)                                                     |

**Rules**

- National catalog **bootstrapped once** from College Scorecard (`data/schools_seed.csv`) — see [09 — School data](./09-school-data.md)
- Import **all** seed schools (main + branch), `is_active=true`; branch campuses use the same UI/UX as other schools; review/deactivate later in the Admin Console
- After bootstrap, the **later Admin Console** owns create / edit / soft-delete (users cannot create schools)
- Anyone (including logged-out) can **search and browse** schools
- School admins edit school details, **manage clubs** (when clubs ship), and assign school teams
- School admins **cannot** remove other school admins
- US only at launch
- Near-you / geo discovery is **later**

### Club

| Field / concept | Notes                                                                                              |
| --------------- | -------------------------------------------------------------------------------------------------- |
| School          | **Required** — clubs exist only under a school                                                     |
| Official        | Clubs are the official school org type                                                             |
| Teams           | Optional assigned teams (Varsity, JV, etc.)                                                        |
| Games           | One or more                                                                                        |
| Officers        | Club officer workflow is later; current event badges use school-admin and staff/faculty indicators |

**Rules**

- Users may **request** a club; **school admins** create, approve, and manage
- Visible on the parent school’s page
- Distinct from free-floating teams (a team may optionally belong to a club)

### Team

| Field / concept    | Notes                                                                      |
| ------------------ | -------------------------------------------------------------------------- |
| Owner              | Transferable                                                               |
| Captains           | Assignable                                                                 |
| Visibility         | **Public** team page                                                       |
| Members            | Password required to **join / interact** (not to view the page)            |
| Club               | Optional `club_id` when the team is part of a school club (Varsity, JV, …) |
| Games              | One or more                                                                |
| School sponsorship | Optional sponsored team/group without a club                               |

**Rules**

- Anyone can create a team
- A user may create and belong to multiple teams
- Team pages are public; share URL freely; password is only for joining/interacting
- Signed-in viewers can list a team's members with their roles; the opt-out
  applies. The owner's roster used for captain management is a separate,
  unfiltered list
- Invite-link tokens are **later**
- Captains register the team for team tournaments (when tournaments ship)

### Event

| Field / concept    | Notes                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------- |
| Creator            | Shown on event                                                                                    |
| Hosts / organizers | The creator only; the schema allows several, but adding co-organizers comes later                 |
| Slug               | `slugify(title) + "-" + shortHash` — see slug algorithm below                                     |
| Visibility         | `public` \| `unlisted` \| `private` (all supported)                                               |
| Password           | Required when `visibility = private` (stored hashed); share URL + password manually               |
| Capacity           | Optional max attendees; counts **RSVP yes only**; when full, block new yes (no waitlist yet)      |
| Format             | `online` \| `in_person` \| `hybrid`                                                               |
| Type               | `game_night`, `lan`, `tournament`, `watch_party`, `tryout`, `meeting`, `workshop`, or `other`     |
| Audience           | `open` \| `collegiate` \| `campus` \| `members`; required, informational (see below)              |
| Cost               | `free` \| `paid` \| `unspecified` (default, shows nothing); CGN does not process payment          |
| Location           | Physical address; optional mini Google Map                                                        |
| Banner             | Default placeholder only; custom user uploads later (moderated)                                   |
| Description        | Character-limited                                                                                 |
| Recurrence         | `weekly`, `biweekly`, or `monthly`; up to one year; each occurrence is a normal independent event |
| Games              | One or more                                                                                       |
| Registration       | Closes automatically; blocked when ended or at capacity                                           |
| Soft delete        | `deleted_at` only                                                                                 |

**Visibility**

| Value      | In search/browse | Access                                                                               |
| ---------- | ---------------- | ------------------------------------------------------------------------------------ |
| `public`   | Yes              | Anyone with the page                                                                 |
| `unlisted` | No               | Anyone with the direct link/slug                                                     |
| `private`  | No               | Content fully gated (blurred / not inspectable) until password modal unlock succeeds |

**Audience**

| Value        | Who the event is for                  |
| ------------ | ------------------------------------- |
| `open`       | Anyone                                |
| `collegiate` | Students at any school                |
| `campus`     | Students and staff of the host school |
| `members`    | Members of the hosting group          |

Audience is separate from visibility: visibility controls who can see the page,
audience tells a visitor whether the event is meant for them. It is required
when an event is created or edited and is information only; it never restricts
who can RSVP. Events created before the field have no audience and show none;
they are not backfilled. A recurring series copies the audience to each
occurrence.

**Type**

The event type says what kind of event it is so browse can tell a weekly game
night from a large LAN. It is required when an event is created or edited.
Events created before the field have no type and show none. A recurring series
copies the type to each occurrence. The `tournament` type is a label only: it
adds no brackets, entries, or standings, and the separate Tournaments entity is
unchanged.

**Lifecycle display**

| State             | UI                                      |
| ----------------- | --------------------------------------- |
| Upcoming          | Show date and time (user timezone)      |
| Happening now     | “Happening now”                         |
| Ended             | “Ended”; no further signups             |
| Full              | At capacity; no further RSVP yes        |
| Missing / deleted | Dedicated “event no longer exists” page |

**RSVP vs interested**

- RSVP responses: `yes` \| `no` \| `maybe`
- **Interested** = favorite/bookmark; independent of RSVP
- Signed-in viewers who may see the event page can list the `yes` and `maybe`
  RSVPs (opted-out people hidden). A viewer who may not see a private event gets
  the same not-found answer as for a missing event
- On RSVP yes: send email with details + calendar (ICS)
- Creating an event requires **no approval**
- Cancelling soft-deletes the event and sends a best-effort email to active
  `yes`/`maybe` RSVPs; cancellation does not fail if email delivery fails
- Recurring event creation expands into normal event rows. The series root
  stores the recurrence rule and end date; generated occurrences point to the
  root and have independent RSVPs, URLs, and cancellation behavior
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
- Event organizer summaries show the account verification level plus
  school-admin and staff/faculty role indicators when applicable to the host
  school; future club-officer/approved-organizer grants can extend this model

**Reports**

- Users can report events; site admins see all reports

### Tournament

| Field / concept | Notes                                                                                              |
| --------------- | -------------------------------------------------------------------------------------------------- |
| Slug            | From name + short hash for uniqueness                                                              |
| Type            | `individual` \| `team`                                                                             |
| Capacity        | Optional; when full, block new registrations (no waitlist); counting rule for team tournaments TBD |
| Optional event  | May be tied to an Event                                                                            |
| Games           | One or more                                                                                        |

**Rules**

- Tournaments are their own entity (not a subtype of Event)
- Events = attend; tournaments = compete
- Team captains register teams for team tournaments
- Browse and **filter** tournaments by game (and related filters)

### Game

| Field / concept       | Notes                                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------------- |
| Source                | Imported from IGDB by a site admin, by a user's pick in a game picker, or by the seed command's starter set |
| New imports           | An admin import starts inactive; a user's pick and the starter set are active                               |
| Typed games           | A name a user types is unlisted: usable on events and teams, absent from the picker                         |
| Blocking              | A hidden or deleted game cannot be added by users                                                           |
| Refresh               | Updates the sync time and cover; never the name or slug                                                     |
| Editable by end users | **No**. Site admins manage games in the Admin Console                                                       |

Used for: browse/filter events (and later tournaments) by game; popular games by school; associations on events/teams/clubs/tournaments.

### Report

- Targets: events, users (extensible)
- Visible to site admins in aggregate moderation views
- Rate-limited on create

### Notification (later)

- Per-user notifications table
- Complements transactional email (e.g. event registration)

### Audit log (shared, later)

- Generic polymorphic log for school, event, team, club, etc.
- Schools/teams/events (and similar) can show what changed
- **Not** the same as system/operational logs

### Feature flag (later)

- Not scheduled yet
- Later: scopes for users, schools, events, teams; targeting specific users/schools

### Site announcement (later)

- Deployable banner shown on every page

## Cross-cutting rules

| Topic             | Rule                                                                                                                                    |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Timestamps        | Every table: `created_at`, `updated_at`, `deleted_at`                                                                                   |
| Soft deletes      | Default for user-facing entities (esp. events)                                                                                          |
| Slugs             | Schools: name + numeric suffix on collision. Events: `slugify(title)-` + first **8** Base64URL chars of SHA-256(creatorId\|date\|title) |
| Images            | Event banners default placeholder for now; school logos later via Admin Console upload (PNG or JPG only; max 5 MB)                      |
| Search            | Postgres (`tsvector` / `pg_trgm`) before any external search service                                                                    |
| Profanity         | Block bad words in user-entered text                                                                                                    |
| XSS / SQLi        | Prevent via parameterized queries + output encoding / sanitization                                                                      |
| Rate limits       | Signups, event creation, reports (and general API rate limiting)                                                                        |
| Content filtering | Basic blocked-term list with word boundaries; reject disallowed user-authored text before persistence                                   |
| Timezones         | Store events in absolute time; display in user timezone                                                                                 |
| US scope          | No international school handling at launch                                                                                              |

## Relationship cardinality (summary)

| Relationship           | Cardinality                           |
| ---------------------- | ------------------------------------- |
| User ↔ School (follow) | many-to-many                          |
| User ↔ School (admin)  | many-to-many                          |
| User ↔ Major           | many-to-many                          |
| User ↔ Team (member)   | many-to-many                          |
| User → Team (owner)    | one owner per team; user may own many |
| School → Club          | one-to-many (required parent)         |
| Club → Team            | one-to-many (optional on team)        |
| Event ↔ Organizer      | many-to-many                          |
| Event ↔ Game           | many-to-many                          |
| Team ↔ Game            | many-to-many                          |
| Club ↔ Game            | many-to-many                          |
| Tournament ↔ Game      | many-to-many                          |
| Tournament → Event     | optional many-to-one                  |
