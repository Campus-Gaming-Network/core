# 02 — Domain model

Canonical entities and business rules. Schema details live in [03 — Database](./03-database.md). Permissions in [07 — Permissions](./07-permissions.md).

## Entity map

```text
User ──< follows >── School
User ──< majors >── Major (later; free-text or curated list is open)
User ── home school + affiliation(s) ── School
User ── roles ── SchoolAdmin | Faculty | ClubOwner/Editor/Member | TeamOwner/Captain | EventOrganizer | SiteAdmin

School ──< has >── Club (required parent)
School ── logo, slug, admins
Club   ── games, links, members (owner, editors, members), claims
Team   ── games, members (URL + password), owner, captains
Event ── games, organizers, RSVPs, interests, location, capacity, visibility, slug
Tournament ── exactly one Event, one game, solo | team, entrants, matches (not built yet)
Game ── added from IGDB when a user picks it (corrected and hidden by site admins, not editable by end users)

Report ── target: Event | User | …
Notification ── User                                      (later)
AuditLog ── polymorphic (school, event, team, club, …)    (later)
FeatureFlag ── targets: user | school | event | team    (later)
SiteAnnouncement ── global banner                        (later)
```

## Entities

### User

| Field / concept     | Notes                                                                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Email / password    | Auth; forgot/reset password; change either while signed in (current password required; a new email takes effect only after its link is followed)           |
| Email verification  | Signup sends verification email; link click sets email verified                                                                                            |
| Age gate            | Must confirm **18+** at signup (checkbox); store acceptance timestamp                                                                                      |
| Name                | Single public name field (no usernames; no first/last/display split)                                                                                       |
| Profile URL         | `/users/:public_id`: a permanent 10-character base58 ID, separate from the internal UUID                                                                   |
| Verification level  | `basic` (email verified) \| `verified` (`.edu`) \| `staff_faculty`                                                                                         |
| Avatar              | Boring Avatars Beam drawn by this site from the user id; initials show when the picture cannot load                                                        |
| Bio, social links   | Profile; a social link is a URL with a label, or a Discord username                                                                                        |
| Profile games       | Three ordered lists: Favorite games (at most 5), Games I like, and Want to play. A game is in at most one of a user's lists; adding it to another moves it |
| Timezone            | Default from system; used to display event times                                                                                                           |
| School affiliations | Selects one home school during signup; can follow additional schools afterward                                                                             |
| Majors              | Later: multiple allowed (open question in [08](./08-open-questions.md))                                                                                    |
| Graduation          | Later: expected graduation date; alumni still participate                                                                                                  |
| Degree level        | Later: undergrad / graduate / etc. (open question)                                                                                                         |
| Role context        | Later: student, alumni, faculty advisor, etc.                                                                                                              |
| Role indicators     | Active site-admin grants, school-admin grants, and staff/faculty status produce visible role indicators                                                    |
| List visibility     | `show_in_lists`, default on; off hides the person from the people lists (see rules below)                                                                  |

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
| Clubs           | Listed on the school page                                                       |
| Popularity      | Derived (e.g. event volume)                                                     |

**Rules**

- National catalog **bootstrapped once** from College Scorecard (`data/schools_seed.csv`) — see [09 — School data](./09-school-data.md)
- Import **all** seed schools (main + branch), `is_active=true`; branch campuses use the same UI/UX as other schools; review/deactivate later in the Admin Console
- After bootstrap, the **later Admin Console** owns create / edit / soft-delete (users cannot create schools)
- Anyone (including logged-out) can **search and browse** schools
- School admins edit school details and the clubs at their school, and assign school teams
- School admins **cannot** remove other school admins
- US only at launch
- Near-you / geo discovery is **later**

### Club

| Field / concept | Notes                                                                                                                |
| --------------- | -------------------------------------------------------------------------------------------------------------------- |
| School          | **Required** — a club belongs to exactly one school                                                                  |
| Type            | `student_club` or `university_program`; neither implies university endorsement                                       |
| Name, slug      | Name need not be unique; slug is the URL identity                                                                    |
| Summary         | Short description of what the club is                                                                                |
| How to join     | Optional plain text: the club's own process for becoming a member (form, tryout, meeting)                            |
| Games           | Any number                                                                                                           |
| Links           | Optional labeled links (website, Discord, social)                                                                    |
| Status          | `published` or `hidden`; a hidden club is absent everywhere and its page is a 404                                    |
| Claimed         | Unclaimed ("Maintained by Campus Gaming Network") until a site admin approves a claim; claimed while it has an owner |
| Claims          | Pending, approved, or rejected; a claim names the club, a request names the club it asks for                         |
| Members         | Role `owner`, `editor`, or `member`                                                                                  |
| Last confirmed  | Date and source: the club (an owner or editor confirmed) or CGN (a site admin checked the public source)             |

**Rules**

- Site admins create unclaimed clubs. A user with a verified email claims an
  existing club or requests a new one, with evidence that they run it; site
  admins approve or reject each in the Admin Console. Approval makes the
  applicant the owner, and for a request creates the club. A user has at most
  one pending claim per club; a club that has an owner takes no new claims,
  and a competing claim on it is rejected. Rejection needs a review note. The
  applicant is emailed either way
- Owners and editors edit the profile and remove members; owners also manage
  editors and transfer ownership (accepted by the recipient). A claimed club
  always has at least one owner
- School admins may edit clubs at their school; they do not review claims
- Any signed-in user with a verified email joins a club on CGN directly and may
  leave; a removed member may join again. Membership on CGN is not membership
  in the club itself, which follows the club's How to join
- Unstated facts stay unstated: no fee, eligibility, or skill level is shown
  unless the club states it
- Owners and editors confirm the club's details are current; site admins
  mark it checked against its public source. After 90 days without
  confirmation the club shows "Needs confirmation" and stays listed. A claimed
  club's owners are emailed once per lapse
- Teams assigned to a club (Varsity, JV) are later

### Team

| Field / concept    | Notes                                                           |
| ------------------ | --------------------------------------------------------------- |
| Owner              | Transferable                                                    |
| Captains           | Assignable                                                      |
| Visibility         | **Public** team page                                            |
| Members            | Password required to **join / interact** (not to view the page) |
| Club               | Later: a team may be assigned to a school club (Varsity, JV, …) |
| Games              | One or more                                                     |
| School sponsorship | Optional sponsored team/group without a club                    |

**Rules**

- Anyone can create a team
- A user may create and belong to multiple teams
- Team pages are public; share URL freely; password is only for joining/interacting
- Signed-in viewers can list a team's members with their roles; the opt-out
  applies. The owner's roster used for captain management is a separate,
  unfiltered list
- Invite-link tokens are **later**
- The owner or a captain registers the team for team tournaments and picks its roster (when tournaments ship)

### Event

| Field / concept    | Notes                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------- |
| Creator            | Shown on event                                                                                    |
| Hosts / organizers | The creator plus up to nine co-organizers, who join by accepting an email invite                  |
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

**Host team**

An event is run by its organizer, or hosted by a team. The organizer chooses
the team when creating or editing the event, from the teams they own or
captain. The team stays on the event if the organizer later leaves it or stops
being a captain; only choosing a different team needs the role. A recurring
series copies the team to each occurrence. The event page reads "Hosted by
\<team>" for a team's event and "Organized by \<person>" otherwise; the host
school is shown beside either as the school the event belongs to, never as its
host. A team's event is listed and filtered like any other public event, so
players from other schools find it the same way, and the team's page lists its
upcoming public events.

A club can host an event the same way: its owners and editors choose it as the
host, the club must belong to the event's host school, and an event has at
most one hosting team or club. Unlike a team, any owner or editor of the
hosting club can edit and cancel the event, so it survives officer turnover.
That access follows the club's roles: someone who leaves the club or is
removed loses it unless they created or co-organize the event. Keeping the
event's club through an edit needs no club role, but the host school must stay
the club's.

**Type**

The event type says what kind of event it is so browse can tell a weekly game
night from a large LAN. It is required when an event is created or edited.
Events created before the field have no type and show none. A recurring series
copies the type to each occurrence. The `tournament` type alone is a label: it
adds no entries, brackets, or standings until organizers attach a
[Tournament](#tournament) to the event.

**Lifecycle display**

| State             | UI                                         |
| ----------------- | ------------------------------------------ |
| Upcoming          | Show date, time, and zone (event timezone) |
| Happening now     | “Happening now”                            |
| Ended             | “Ended”; no further signups                |
| Full              | At capacity; no further RSVP yes           |
| Missing / deleted | Dedicated “event no longer exists” page    |

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
- A cancelled event's page stays readable for 24 hours after the cancellation,
  with no RSVPs; a cancelled private event is not found
- An event that has ended cannot be edited or cancelled
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
  school; future club owner/editor and approved-organizer grants can extend this model

**Reports**

- Users can report events; site admins see all reports

### Event activity log

Each change to an event adds one entry to its activity log in the same
transaction as the change. An entry records when the change happened, the
account that made it, the action, and, for an edit, each changed field. Entries
are never edited. Events created before the log shipped start with an empty
log; nothing is backfilled.

| Action                      | Written when                                                                                                                 | Visible to       |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `event.created`             | The event is created; each occurrence of a recurring series gets its own entry                                               | Editors          |
| `event.updated`             | An edit changes at least one field; one entry per save lists every changed field. A save that changes nothing writes nothing | Per field, below |
| `event.cancelled`           | The event is cancelled, including by its creator's account deletion when no co-organizer remains                             | Everyone         |
| `event.organizer_joined`    | Someone accepts a co-organizer invite                                                                                        | Editors          |
| `event.organizer_removed`   | The creator removes a co-organizer                                                                                           | Editors          |
| `event.organizer_left`      | A co-organizer steps down                                                                                                    | Editors          |
| `event.creator_transferred` | The creator hands the role to a co-organizer, or deleting the creator's account transfers it                                 | Editors          |

"Editors" are the people who can edit the event: its organizers, and the owners
and editors of a hosting club. "Everyone" is anyone who can see the event page.
Sending and withdrawing co-organizer invites is not logged: an invite carries an
email address, and the creator already sees pending invites.

An edit entry is public when at least one of its changed fields is public, and
a viewer who cannot edit the event sees only those fields. Public fields are the
ones that change whether or how someone attends.

| Field                        | Public | Recorded value                                         |
| ---------------------------- | ------ | ------------------------------------------------------ |
| Title                        | Yes    | Before and after                                       |
| Start, end, and time zone    | Yes    | Before and after                                       |
| Format                       | Yes    | Before and after                                       |
| Location name and address    | Yes    | Before and after                                       |
| Online link                  | Yes    | Changed only, so a replaced link is not kept reachable |
| Cost                         | Yes    | Before and after                                       |
| Payment note and payment URL | Yes    | Changed only                                           |
| Host team                    | Yes    | Before and after team                                  |
| Host club                    | Yes    | Before and after club                                  |
| Description                  | No     | Changed only                                           |
| Visibility                   | No     | Before and after                                       |
| Private password             | No     | Changed only; never the password or its hash           |
| Host school                  | No     | Before and after school                                |
| Audience and type            | No     | Before and after                                       |
| Games                        | No     | Games added and removed                                |
| Capacity                     | No     | Before and after                                       |

Editors see who made each change. Public entries never name the account that
made them. An entry made by an account that has since been deleted shows
"Deleted account"; deleting an account attributes the transfer or cancellation
it causes to that account.

The log is readable wherever the event page is: a locked private event's log is
not found, and a cancelled event's log is readable for the same 24 hours as its
page. Entries are kept under the domain audit retention target in
[16 — Legal and data-lifecycle plan](./16-legal-and-data-lifecycle-plan.md).
Site admins see every entry in the Admin Console audit log.

### Tournament

Settings and status (#263) and entries (#265) are built; matches are not built yet.
[01 — Product](./01-product.md#tournaments) is the spec. A tournament belongs to exactly one event whose type is `tournament`, and an
event has at most one tournament. Everything an event already has (title,
slug, time, place, visibility, host, organizers, private access,
cancellation, activity log) stays on the event.

| Field / concept     | Notes                                                                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Event               | Required and unique; the event's type is `tournament`, and an occurrence of a series has its own                                 |
| Game                | Exactly one, one of the event's games                                                                                            |
| Entry type          | `solo` or `team`; fixed once an entry exists                                                                                     |
| Team size           | Players a team fields, 2 to 20 (team entry only); fixed once an entry exists                                                     |
| Substitutes         | Extra roster places beyond the team size, from 0 up to the team size                                                             |
| Entrant cap         | Optional, 2 to 512; counts entries (teams in a team tournament); no waitlist                                                     |
| Registration mode   | `open` (the default) or `approval`, where an entry starts as a request organizers approve (#324, not built yet)                  |
| Registration closes | Optional instant, no later than the event's start; defaults to the event's start                                                 |
| Format              | `single_elimination`, later `round_robin`, `swiss`, and `double_elimination`; fixed once an entry exists                         |
| Format options      | Swiss round count; draws allowed (round robin and Swiss); grand-final reset (double elimination, on by default)                  |
| Rules, prizes       | Optional plain text, up to 10,000 and 2,000 characters                                                                           |
| Bracket URL         | Optional `http` or `https` link to a bracket hosted elsewhere, shown as external                                                 |
| Status              | `draft` → `registration_open` → `in_progress` → `completed`, or `cancelled` with its event; back to `draft` only with no entries |

**Tournament entry**

| Field / concept | Notes                                                                                                                                                                                                       |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entrant         | A user (solo) or a team (team entry), never both                                                                                                                                                            |
| Roster          | Team entry only: team members, from the team size up to the team size plus substitutes                                                                                                                      |
| Registered by   | The solo player, or the team owner or captain who registered the team                                                                                                                                       |
| Status          | `registered`, `withdrawn` (by the entrant, before the start), or `removed` (by an organizer, before it); in approval mode (#324, not built yet) also `pending` (a request) and `declined` (by an organizer) |
| Seed            | Set by organizers; registration (or approval) order until then                                                                                                                                              |

**Match**

| Field / concept | Notes                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------- |
| Place           | Round and position; double elimination also records upper, lower, or grand final                  |
| Entrants        | Two slots, each an entry, a bye, or empty until an earlier match decides it                       |
| Next match      | Where the winner goes (and, in double elimination, where the loser drops)                         |
| Scheduled time  | Optional                                                                                          |
| Status          | `upcoming`, `live`, or `complete`                                                                 |
| Result          | Each side's whole-number score and the winner, or a walkover; a draw only where the format allows |

**Rules**

- An entry is active while `registered` (or `pending`, in approval mode). A user is in at most one active
  entry of a tournament, solo or on one roster, and a team has at most one
- A removed entrant cannot register again for that tournament
- In approval mode (#324, not built yet) an entry starts `pending`. A pending
  entry counts as the entrant's one entry and blocks moving back to draft,
  but holds no spot: it is not listed, has no seed, and does not count toward
  the cap. Organizers approve or decline it until the start; approving stops
  at the cap. A declined entrant may request again. Starting the tournament
  declines every pending entry, and the mode goes back to `open` only while
  none is pending
- Rosters freeze when the tournament starts
- The bracket or pairings are generated from active entries in seed order and
  may be regenerated until the first result exists
- A result can be corrected until the winner's next match has a result
- Organizers are the people who can edit the event. Entering and correcting
  results, removing entries, and changing seeds are written to the
  [event activity log](#event-activity-log)
- Cancelling the event cancels the tournament unless it has completed
- Settings are added only to a tournament-type event that nobody but its
  organizers has RSVP'd to. While they exist, the event keeps the tournament
  type and the tournament's game, and RSVPs other than "no" are refused
  unless the tournament is cancelled
- Settings change until the tournament is completed or cancelled, and are
  deleted only in draft. Once the event has ended, the only status change is
  to `completed`

### Game

| Field / concept       | Notes                                                                                                                                                                                                                                                                                                                       |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source                | Imported from IGDB by a user's pick in a game picker or by the seed command's starter set. Admins never add games                                                                                                                                                                                                           |
| New imports           | Active: a user's pick and the starter set both import active; an admin can hide the game later                                                                                                                                                                                                                              |
| Typed games           | A name a user types is unlisted: usable on events and teams, absent from the picker                                                                                                                                                                                                                                         |
| Blocking              | A hidden or deleted game cannot be added by users                                                                                                                                                                                                                                                                           |
| Refresh               | Updates the sync time and cover; never the name or slug                                                                                                                                                                                                                                                                     |
| One game per title    | An import links a game already stored under the entry's slug with no IGDB link (a demo seed game, an older hand-made game, or a typed game) instead of copying it: the game keeps its name, slug, events, and teams. A typed game becomes listed. A slug held by another IGDB entry or a deleted game gets a numeric suffix |
| Editable by end users | **No**. Site admins manage games in the Admin Console                                                                                                                                                                                                                                                                       |

Used for: browse/filter events (tournaments included) by game; popular games by school; associations on events, teams, clubs, and tournaments.

### Report

- Targets: events, users (extensible)
- Visible to site admins in aggregate moderation views
- Rate-limited on create

### Notification (later)

- Per-user notifications table
- Complements transactional email (e.g. event registration)

### Audit log (shared, later)

- Generic polymorphic log for school, event, team, club, etc.
- Schools/teams/events (and similar) can show what changed; events do so
  through their [activity log](#event-activity-log)
- **Not** the same as system/operational logs

### Feature flag (later)

- Not scheduled yet
- Later: scopes for users, schools, events, teams; targeting specific users/schools

### Site announcement (later)

- Deployable banner shown on every page

## Cross-cutting rules

| Topic             | Rule                                                                                                                                                                                                                                                |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Timestamps        | Every table: `created_at`, `updated_at`, `deleted_at`                                                                                                                                                                                               |
| Soft deletes      | Default for user-facing entities (esp. events)                                                                                                                                                                                                      |
| Slugs             | Schools: name + numeric suffix on collision. Events: `slugify(title)-` + first **8** Base64URL chars of SHA-256(creatorId\|date\|title)                                                                                                             |
| Images            | Event banners default placeholder for now; school logos prefer Admin Console uploads (PNG/JPG, max 5 MB), then bundled institutional assets, then a two-letter monogram on a pale tone. See [School data](./09-school-data.md#institutional-logos). |
| Search            | Postgres (`tsvector` / `pg_trgm`) before any external search service                                                                                                                                                                                |
| Profanity         | Block bad words in user-entered text                                                                                                                                                                                                                |
| XSS / SQLi        | Prevent via parameterized queries + output encoding / sanitization                                                                                                                                                                                  |
| Rate limits       | Signups, event creation, reports (and general API rate limiting)                                                                                                                                                                                    |
| Content filtering | Basic blocked-term list with word boundaries; reject disallowed user-authored text before persistence                                                                                                                                               |
| Timezones         | Store events as UTC instants plus an IANA timezone; display and email in the event timezone, labeled with its abbreviation (for example CDT). Upcoming and ended compare instants, never wall-clock text                                            |
| US scope          | No international school handling at launch                                                                                                                                                                                                          |

## Relationship cardinality (summary)

| Relationship           | Cardinality                            |
| ---------------------- | -------------------------------------- |
| User ↔ School (follow) | many-to-many                           |
| User ↔ School (admin)  | many-to-many                           |
| User ↔ Major           | many-to-many                           |
| User ↔ Team (member)   | many-to-many                           |
| User → Team (owner)    | one owner per team; user may own many  |
| School → Club          | one-to-many (required parent)          |
| User ↔ Club (member)   | many-to-many, with role                |
| Club → Team            | later                                  |
| Event ↔ Organizer      | many-to-many                           |
| Event ↔ Game           | many-to-many                           |
| Team ↔ Game            | many-to-many                           |
| Club ↔ Game            | many-to-many                           |
| Tournament → Game      | many-to-one (one of the event's games) |
| Tournament ↔ Event     | one-to-one                             |
| Tournament → Entry     | one-to-many                            |
| Entry ↔ User (roster)  | many-to-many                           |
