# 01 — Product

## Vision

**Campus Gaming Network** is the central hub for collegiate gamers in the United States — casual and competitive. Students, alumni, and faculty find and join clubs, events, teams, friends, and everything they need about gaming at their school and across campuses.

> Connect college gamers at their school and between campuses across the United States.

## Goals (first release)

- Discover events at schools you follow (near-you is later)
- Create events and RSVP; create/join teams
- Follow schools and stay current with campus gaming activity
- Keep the product simple, accessible, mobile-friendly, and cheap to run for a single developer

## Non-goals (not scheduled yet)

- Tournaments: specified under [Tournaments](#tournaments) and not built yet
- On-site payment processing (paid events may be listed for now, but organizers handle payment off-site)
- Near-you / geo discovery (later)
- Schools outside the United States
- Live updates via WebSockets
- Custom user avatars (the drawn Boring Avatars identity comes first)
- Custom event banner uploads (default placeholder for now; moderated uploads later)
- Usernames or split first/last/display — not planned; profiles use a single **name** field and a permanent public ID
- Google Analytics
- Internet Explorer support
- Heavy user-generated content on the homepage (keep it simple until content exists)
- Shipping the Admin Console in the first release (it comes later)
- Audit-history views for users and for entities other than events (later)

## Product principles

| Principle            | Meaning                                                                            |
| -------------------- | ---------------------------------------------------------------------------------- |
| Keep it simple       | Ship the smallest useful version; avoid premature complexity                       |
| Server-first         | Prefer server rendering and server-side logic; use the browser only when needed    |
| CSS over JS          | Prefer CSS solutions when they work; avoid extra client JavaScript                 |
| Accessible           | Follow accessible patterns (gov.uk Design System is a good reference)              |
| Mobile-friendly      | First-class mobile experience                                                      |
| Cost-conscious       | Single developer; minimize third-party spend and complexity                        |
| Minimal dependencies | Prefer fewer libraries; adopt ones that are clearly worth it, performant, and safe |
| Log meaningfully     | User actions and entity changes are visible to the right audiences                 |
| Safe by default      | Rate limits, XSS/SQL injection prevention, profanity filtering, soft deletes       |

## Personas

| Persona                    | Description                                                                                         |
| -------------------------- | --------------------------------------------------------------------------------------------------- |
| **Student (basic)**        | Registered with any email; can browse, RSVP, create events/teams                                    |
| **Verified student**       | Registered/verified with a `.edu` email                                                             |
| **Staff / faculty**        | Granted by site admin; may run esports programs or advise clubs                                     |
| **Alumni**                 | Can participate after graduation                                                                    |
| **School admin**           | Edits school details and the clubs at their school; cannot remove other school admins               |
| **Club owner**             | Runs a claimed club: edits it, invites and removes editors, removes members, hands ownership over   |
| **Club editor**            | Helps run a club: edits it and removes members                                                      |
| **Club member**            | Joined a club on CGN; listed on the club's member list                                              |
| **Team owner / captain**   | Owns or captains a team; can invite members and register for team tournaments                       |
| **Event organizer**        | Creates/hosts events; the creator can invite co-organizers, who can edit the event                  |
| **Site admin**             | Later: creates schools via the Admin Console, manages users/ACLs, views reports, impersonates users |
| **Admin Console operator** | Later: uses the Admin Console (not raw DB) to manage schools, users, ACLs                           |

## User verification levels

1. **Email verified** — signed up and clicked the verification link (required for normal use)
2. **Verified student** — used a `.edu` email (trust badge; separate from inbox verification)
3. **Staff / faculty** — granted by site admin

Signup also requires confirming **age 18+**. Alumni can participate. Faculty who run an esports team are first-class users (not “students only”).

## Core user journeys

### Discover

- Search or browse schools (works **logged out**); each school has a logo and slug URL
- Browse/filter events by game (and other filters) — no near-you yet. Event lists
  leave out events that have ended and show the soonest first. The home page
  shows "Events this week" (under way or starting in the next seven days) and
  "More events" (everything after)
- The event directory has scope tabs: All events, My school (events hosted at
  the viewer's home school; shown only when signed in), Online, and
  Tournaments. A tab keeps the game, audience, cost, keyword, and date
  filters, and its URL can be shared
- The event directory searches event titles by keyword and narrows to a date
  range (from and to). A date is the day the event starts in its own time
  zone, the date its page shows. Both stay in the URL with the other filters
  and work without JavaScript
- Select a home school during signup; follow additional schools afterward (logged in)
- See popular games by school
- Dashboard: upcoming events, activity at followed schools, team activity
- School admin and staff/faculty roles show visible indicators on profiles and
  relevant event UI

### Participate

- RSVP to events: **yes / no / maybe**
- Mark an event as **interested** (favorite/bookmark — separate from RSVP)
- Every listed event row shows its **going** (yes RSVP) and **interested** counts
- Signed-in people can see who is going to an event, who belongs to a school,
  and who is on a team; see [People lists](#people-lists)
- RSVP yes → confirmation email with calendar attach (ICS)
- Any visible event page has an **Add to calendar** link (a plain link, no
  JavaScript needed) to `/api/events/:slug/calendar.ics`. The file is built from
  the same event data the page shows, with the same UID, SEQUENCE, and STATUS
  as the RSVP email's attachment, so a calendar keeps one entry and replaces
  it after any change the file shows. While a cancelled event's page is up,
  its file is marked cancelled. A locked private event and a missing event
  answer 404 and expose nothing
- A visible event page lists the event's games, each with its cover when the
  catalog stores one
- A visible event page has a **Share** card with the event's public link as
  selectable text and a **Copy link** button (the button needs JavaScript; the
  link text does not). Sharing a private event's link reveals nothing without
  its password
- Create or join teams via shared team URL + password (no invite links at launch)

### Organize

- Anyone can create an event or a team — **no approval required** to create an event
- Event organizers show school-admin or staff/faculty badges when those roles
  apply to the host school or organizer
- Events can be online, in-person, or hybrid; one-off or recurring; paid events are allowed, but payment happens off-site
- Event cost is **free**, **paid**, or **not specified** (the default). A free event shows "Free" on its page and card and can be found with the Free filter in browse. A paid event shows its payment note. An event whose organizer did not say shows nothing about cost, so "free" is never implied
- Event visibility: **public**, **unlisted**, or **private**
- Event type says what kind of event it is: **game night**, **LAN**, **tournament**, **watch party**, **tryout**, **meeting**, **workshop**, or **other**. Organizers must choose one. It is shown on the event page and event cards and can be filtered in browse. The tournament type on its own is a label; organizers add [tournament settings](#tournaments) to run a tournament on CGN
- Event audience says who may come: **open** (anyone), **collegiate** (students at any school), **campus** (students and staff of the host school), or **members** (members of the hosting group). Organizers must choose one. It is shown on the event page and event cards and can be filtered in browse. It is information for attendees and does not change who can see the page or RSVP
- Private events: page content is **not visible/inspectable** until unlocked; show blurred shell + **password modal** (share URL + password manually)
- Optional **capacity** on events; counts **RSVP yes only**; when full, no more yes RSVPs
- The creator can invite co-organizers by email, who can edit the event; see [Events](#events)
- Transfer team ownership; assign captains

### Trust & safety

- Report events and users; basic blocked-language filtering runs before text is
  stored for names, bios, event/team text, reports, and support messages
- Site admins review all reports
- Soft-delete events; deleted/missing event shows a clear “no longer exists” page
- Account deletion anonymizes PII (“Deleted User”) while retaining non-personal records

## Feature inventory

### Schools

- Search and browse schools (including while logged out); popular schools (high event volume)
- School cards and pages show an approved Admin Console logo (PNG/JPG ≤5 MB), otherwise the school's bundled athletics mark, otherwise an identifier-matched bundled institutional logo, otherwise the school's monogram: the first letters of the first two words that name it (after a leading "University of" and the like) on one of ten pale tones fixed by its slug. The tones are not the school's colors, and none is red or green. Failed images reveal the monogram. A wide bundled wordmark appears on the school page only; cards keep the monogram. Bundled logos include source and license credits; see [School data](./09-school-data.md#institutional-logos). Slug URLs get numeric suffixes for duplicate names.
- School names need not be unique
- School catalog bootstrapped **once** from College Scorecard — import **all** seed rows (main + branch), `is_active=true`; branch campuses use the same UI/UX as other schools; review/deactivate later in the Admin Console
- Afterward only site admins create/edit/delete schools via the Admin Console (users cannot create schools); `unitid` optional
- Multiple school admins; a user can admin multiple schools
- School admins edit school details and assign school teams
- School admins cannot remove other school admins
- School admin (and faculty) role shown with a visible indicator
- Sponsored teams/groups
- Users select one home school at signup and can follow multiple additional schools
- Popular games by school
- Signed-in people see the school's members, the people whose home school it is;
  see [People lists](#people-lists)
- School pages list the school's clubs; see [Clubs](#clubs)

### Clubs

Clubs are not run by CGN, so each club decides how people become members. A
club page says how to join the club itself, and separately lets people join the
club on CGN, which lists them as members here.

- **Types:** a club is a **student club** or a **university program** (a
  school-run esports program). A school can have several of either type. A
  club page does not imply that the university endorses the club
- **One school:** every club belongs to exactly one school, and the school page
  lists its clubs
- **Directory:** `/clubs`, linked from the header, lists published clubs from
  every school by name, with a name search and school, type, and game filters.
  It tells officers to claim a listed club from its page and to request a
  missing one from their school's page
- **Claim and request forms:** an unclaimed club's page links to "Claim this
  club" (`/clubs/:slug/claim`); every school page's Clubs section links to
  "Request a club" (`/schools/:slug/request-club`) and stays on the overview
  even before the school has a club. Both forms need a signed-in, verified
  account, ask how the applicant can be confirmed as an officer, and say that
  a school email alone is not enough. Support (`/support?topic=club`) handles
  rejected claims and disputes over a club someone else manages
- **Profile:** name, URL slug, type, summary, games, **how to join**, and
  optional labeled links (website, Discord, social)
- **How to join:** a short plain-text section, written by the club (or by CGN
  for an unclaimed club), saying how to become a member of the club itself: an
  interest form, a tryout, a meeting to attend. It is separate from the summary
  so it can sit next to the join button and be kept current each term. A club
  that has not written one shows nothing there and claims no process
- **Unclaimed clubs:** site admins create clubs from public sources so that
  pages exist before any officer signs up. An unclaimed club's page says it is
  "Maintained by Campus Gaming Network"
- **Claims and requests:** a club officer **claims** an existing club or
  **requests** one that is not listed. Site admins review both in the Admin
  Console; a school admin is not needed. A school email shows control of an
  address, not authority over a club, so a claim asks for other evidence (an
  official club contact or the university's organization page). An approved
  claim makes the applicant the club's owner, and the page then reads "Managed
  by the club"
- **Roles:** **owner**, **editor**, and **member**. Owners and editors edit the
  club's profile, games, and links on a Manage club page linked from the club
  page, and remove members. Owners also invite and remove editors and
  hand ownership to another member, which takes effect when that person
  accepts. A claimed club always keeps at least one owner: the last owner
  cannot leave or be removed
- **School admins** can edit the clubs at their school. They do not review
  claims
- **Joining on CGN:** any signed-in person with a verified email joins a club on
  CGN with one button, claimed or not, and can leave at any time. There is no
  approval step yet. A removed member may join again. Joining on CGN lists the
  person on the club's member list here; it does **not** make them a member of
  the club itself, and the page says so next to the button and points to How
  to join
- **Member list:** signed-in people see a club's members with their roles; see
  [People lists](#people-lists). Signed-out visitors see the count
- **Last confirmed:** a club page shows when its details were last confirmed and
  by whom: "Confirmed by the club on \<date>" or "Checked by Campus Gaming
  Network on \<date>". An owner or editor confirms from the Manage club page.
  After 90 days the club page and its row on the school page and in the clubs
  directory read "Needs confirmation", which never says or implies the club is
  inactive; the club stays listed. A claimed club's owners are emailed once
  when it lapses, and again only after it is confirmed and lapses again
- **Events:** a club's owners and editors can host an event as the club, as a
  team's owners and captains can host as the team; an event has at most one
  hosting team or club. Any owner or editor of the club can manage an event the
  club hosts, and the club page lists its upcoming public events
- **Nothing implied:** a club that states no fee, eligibility, or skill level is
  never shown as free, open to all, or beginner-friendly
- **Later:** assigning teams to a club (Varsity, JV), join requests that an
  officer approves, and several clubs co-hosting one event

### Teams

- Anyone can create a team; a user can create and belong to multiple teams
- Assignment to a school club (Varsity, JV, etc.) is later
- Team pages are **public**; password only required to **join / interact**
- Share team URL freely; no invite-link tokens at launch (maybe later)
- Owner can transfer ownership; users can assign captains
- Members can leave a team, and the owner can remove members; the owner
  transfers ownership before leaving
- Schools can have sponsored teams
- Teams reference one or more games
- Signed-in people see a team's members with their roles; see
  [People lists](#people-lists)
- A team directory card shows the team's school, not the school's city and
  state
- The team directory filters by game and school. People find a school by
  searching its name and see its name, never its slug, while the filter is
  active; the search-then-select flow works without JavaScript, and a clear
  link removes the school filter

### Events

- Created by users or schools; the creator can invite up to nine co-organizers, who edit the event, while only the creator cancels it, manages co-organizers, and can hand it to one of them; **no approval needed** to create
- Slug = `slugify(title) + "-" +` first **8** Base64URL chars of SHA-256(creatorId + createdDate + title)
- Online, in-person, or hybrid; recurring supported
- Paid events are allowed as informational/off-site-payment events only; no checkout, money handling, refunds, tax, or payout logic on CGN
- Visibility: **public** (in search) · **unlisted** (link only) · **private** (password modal; content gated/blurred until unlocked)
- Cancel events with a soft delete; active **yes/maybe** RSVPs receive a
  best-effort cancellation email after the event is cancelled
- A cancelled public or unlisted event's page stays up for **24 hours** after
  the cancellation, marked cancelled, with RSVPs, interest, the calendar link,
  and the attendee list gone; after that it is not found. A cancelled private
  event is not found at once
- An event that has ended can no longer be edited or cancelled
- Every change to an event is kept in its **activity log**. The people who can
  edit the event see every entry and who made it. Everyone else who can see the
  event sees only the changes that affect attending it (time, place, format,
  title, cost, host team, and cancellation), without the organizer's name. The
  event page shows the latest three entries the viewer may see under
  **Updates** and links to the full log at `/events/:slug/activity`. What is
  recorded: [02 — Domain model](./02-domain-model.md#event-activity-log)
- **Your events** (`/account/events`) lists every event the viewer created,
  past and upcoming, latest first, a page at a time
- Recurring events support weekly, biweekly, and monthly schedules for up to
  one year; each occurrence is independent and can be RSVP'd to or cancelled
  separately
- Optional capacity; counts **RSVP yes only**; when full, no further yes RSVPs (no waitlist yet)
- Physical address + optional mini Google Map
- Description with character limit; **default banner/background placeholder** (custom uploads later with moderation)
- Show the organizer, or the hosting team or club: an organizer who owns or
  captains a team may host the event as that team, and a club's owners and
  editors may host it as the club at the club's school. The page reads "Hosted
  by \<team or club>" or "Organized by \<person>", with the school beside it; a
  school is never shown as the host of a student's event. Team and club pages
  list their upcoming events
- RSVP: **yes / no / maybe**
- Interested: separate favorite/bookmark (not an RSVP answer)
- Signed-in people see who is going (yes) and who might go (maybe); see
  [People lists](#people-lists)
- Registration closes automatically; ended or full events block new yes RSVPs
- Status display: upcoming (date/time), happening now, ended
- Soft deletes only
- Past events: organizers may make minor corrections only (not date/location)
- Organizer role badges are shown on event pages
- Report inappropriate events
- Reference any number of games, including none (an informational meeting or club social); browse/filter by game
- Timezone: user preference (default system) for display

### Tournaments

Tournament settings and status (#263), registration (#265),
single-elimination brackets (#266), results (#267), and the tournament tabs
and bracket view (#268), the seeding page (#333), and match times with the
Schedule tab (#334) are built. This section is the spec; the phases
are listed at the end. An event is something you attend and a tournament is
something you enter, so a tournament adds entry, seeding, matches, and results
to an event instead of repeating the event's own facts.

- **Part of an event:** a tournament is a record attached to exactly one event
  whose type is **tournament**. The event keeps its title, URL, time, place,
  visibility, host, organizers, private password, cancellation, calendar file,
  activity log, and reports; the tournament adds its own settings, entrants,
  and matches. There is no separate tournament URL, and the event page shows
  the tournament. A tournament-type event without tournament settings stays a
  plain event, as today
- **Organizers** are the people who can edit the event: its creator, its
  co-organizers, and on a club-hosted event the club's owners and editors (a
  hosting team's other owners and captains cannot edit it). They manage the
  settings, entrants, seeds, bracket, and results
- **The event around it:** settings attach to one event, not to a repeating
  series; each occurrence of a series is its own event and can have its own
  tournament. An event with tournament settings keeps the tournament type
  until the settings are deleted, which is possible only in draft. Its own
  capacity is not used, because the entrant cap takes its place
- **Discovery** stays in the events directory: its Tournaments tab lists
  tournament-type events. A card for an event with tournament settings also
  says solo or team, and whether registration is open. `/tournaments` redirects
  to that tab
- **Settings:** one game (one of the event's games), **solo** or **team**
  entry, team size and the number of substitutes a roster may add, an
  optional entrant cap, when registration closes (the event's start by
  default), the format, rules and prizes as plain text, and an optional link
  to a bracket hosted elsewhere. Entry type, team size, and format are fixed
  once anyone has registered
- **Status:** **draft**, **registration open**, **in progress**,
  **completed**, or **cancelled**. Registration opens when organizers move
  the tournament to registration open. Organizers move it forward; a tournament
  goes back from registration open to draft only while nobody has registered.
  Starting it needs two or more entrants and ends registration. Cancelling the
  event cancels the tournament. A draft's settings are visible to the
  event's organizers only
- **Registration replaces RSVP** on an event with tournament settings: the
  event page shows a registration panel (not open yet, open, full, closed,
  registered) where the RSVP buttons would be, and Interested still works for
  spectators. Settings can be added to an event only while nobody but its
  organizers has an RSVP, so no one's RSVP is dropped
- **Solo entry:** a signed-in person registers themselves
- **Team entry:** a team's owner or a captain registers the team and picks its
  roster from the team's members: at least the team size, at most the team
  size plus the substitutes. The owner or a captain can change the roster
  until the tournament starts. A person can be in only one entry of a
  tournament, solo or on one roster
- **Approval:** an organizer can set registration to **Organizer
  approval** instead of **Open** (the default), for a paid, invite-only, or
  vetted bracket. Register then reads **Request to join**, and the entry
  starts as a pending request. A pending request holds no spot: it is not in
  the entrant list, has no seed, and does not count toward the cap, but it
  does count as the person's or team's one entry. Organizers see the requests
  on the event page and approve or decline each one until the tournament
  starts, even after registration closes; approving takes a spot, so it stops
  at the cap, and seeds follow approval order. The requester can cancel a
  pending request. A declined requester may ask again, which goes to the end
  of the queue; removing the request instead blocks them for good, as removing
  an entry does. Starting or cancelling the tournament declines every
  request still pending. Registration goes back to Open only once no request is pending
- **Paid tournaments:** CGN still takes no money. When the event's cost is
  paid, the registration form shows its payment note and payment link, so in
  an approval tournament an entrant pays the organizer off-site and the
  organizer approves the request once the payment arrives
- **Cap:** counts entries, so teams in a team tournament. A full tournament
  takes no more entries; there is no waitlist
- **Eligibility:** as with RSVP, the event's audience (open, collegiate,
  campus, members) is information and is not enforced. Organizers can remove
  an entry until the tournament starts, and a removed entrant cannot register
  again
- **Withdrawing:** an entrant (a solo player, or a team's owner or captain)
  withdraws on CGN until the tournament starts. After that an entrant who
  cannot play tells the organizer, who records a walkover
- **Entrants and brackets are public to participants:** entering means your
  name appears in the tournament's entrant list and bracket for signed-in
  viewers, and the registration form says so; Show me in people lists does not
  hide an entrant. Signed-out visitors see team names (team pages are public)
  but see solo entrants as their seed ("Seed 3"), as people lists show them
  counts only
- **Formats,** in the order they ship: **single elimination**, then **round
  robin** and **Swiss** (pairings and a standings table, not a bracket), then
  **double elimination**. There is no third-place match in single elimination
- **Seeding:** organizers order the entrants, and registration order is the
  default. A bracket is sized to the next power of two, the top seeds get the
  byes, and a bye advances its entrant without a match. Organizers generate
  the bracket after starting the tournament and may regenerate it until the
  first result is entered
- **Matches:** each has its two entrants, an optional scheduled time, a status
  (upcoming, live, or complete), each side's score as a whole number, and the
  winner. An elimination match has no draw
- **Results:** organizers enter them, and a result they enter is official;
  entrants do not report their own results in the first version. A winner
  advances to their next match at once. A result can be corrected until the
  match the winner moved on to has a result. Organizers can record a
  **walkover** for a no-show, which advances the opponent without a score.
  The final's result completes the tournament. Every result and correction is
  written to the event's activity log
- **Round robin:** everyone plays everyone once, with a bye each round for an
  odd count. **Swiss:** the organizer sets the number of rounds (by default
  enough rounds for one entrant to be the only one unbeaten), each round pairs
  entrants with the same record without a rematch, and a bye counts as a win.
  Both may allow draws if the organizer turns them on. Standings give 3 points
  for a win and 1 for a draw; ties break by head-to-head result (round robin)
  or by the sum of opponents' points (Swiss), then by score difference, then
  by seed
- **Double elimination:** losers drop to a lower bracket, and the lower
  bracket's winner meets the upper bracket's in a grand final. A grand-final
  reset (the lower-bracket winner must win twice) is on by default, and
  organizers can turn it off before generating the bracket
- **External bracket:** until native brackets ship, or instead of them, a
  tournament can link to a bracket on start.gg, Challonge, Battlefy, or any
  other site (an `http` or `https` link, checked like the payment link). The
  event page names the host ("Bracket on start.gg"), marks the link as
  external, and never embeds it. An organizer using an external bracket
  completes the tournament by hand
- **Tournament on the event page:** tabs for Overview, Players or Teams,
  Bracket (once generated), Schedule (once a match has a time), Rules (when
  written), and Prizes (when written). The tabs are links that work without
  JavaScript. On a phone the bracket is a list of matches round by round, not
  a shrunken bracket
- **Notices:** entrants get an in-app notice when an organizer removes their
  entry, when the tournament starts, and when it is cancelled; cancelling the
  event also emails them (pending requesters included), as it emails RSVPs.
  In an approval tournament, the event's creator and co-organizers get a
  notice for each new request, and the requester gets one when the request
  is approved or declined
- **Not in the first version:** check-in, entry fees on CGN (an event's cost
  and payment note still apply), self-reported results, match chat, streaming
  embeds, and tournament series or leagues across events
- **Phases:** (1) settings and status (#263), registration (#265),
  organizer approval (#324), and the external bracket link (#264); (2)
  single-elimination brackets (#266), results (#267), and the tournament tabs
  and bracket view (#268); (3) round robin and Swiss (#269); (4) double
  elimination (#270)

### Games

- Users bring games in: there is no admin import step. Site admins only correct stored games (name, slug, cover), hide them, delete unused ones, or refresh them from IGDB in the Admin Console
- A user creating an event or team whose game is not listed can search IGDB and add it, or type the game's name. No admin approval is needed
- A game added from IGDB search joins the list for everyone. A typed name stays on that event or team and is not listed
- A site admin blocks a game by hiding or deleting it
- Games IGDB tags as erotic are never shown in search and cannot be imported
- The FAQ page credits IGDB.com for game data
- Used to browse/filter events (tournaments included) and show popularity by school

### Profiles & social

- Boring Avatars Beam avatars at launch, drawn by this site from the user id (no avatar service is contacted), with initials showing when the picture cannot load
- Single **name** field (no usernames; no separate first/last/display)
- Profile URL: `/users/:public_id`, a permanent 10-character ID (for example `/users/7kQ2mXp9Ra`). The database ID never appears in a profile URL, and a URL with one is not found
- A person edits their profile on the **Edit profile** page at `/settings/profile`. Their own public profile shows an "Edit profile" button that links to it
- Bio + social links. A social link is a URL with a label, or a Discord username, which the profile shows as text
- Later: school affiliation(s), majors (multiple), and expected graduation (see [08 — Open questions](./08-open-questions.md))
- Support graduate students, alumni, faculty
- Visible indicators for school admin and faculty roles
- Users can report other users from profiles
- A **Show me in people lists** account setting, on by default, opts a person
  out of every [people list](#people-lists)
- Activity log visible to the user (later)

### People lists

Signed-in people can see who is part of an event, a school, or a team. Signed-out
visitors see counts only; the API answers them with 401.

- **Event:** the people whose RSVP is **yes** (Going), with the **maybe** people
  in a separate list. People who only marked **interested** are never listed;
  they stay a count
- **School:** the people whose **home school** it is. People who only follow the
  school are not listed
- **Team:** the team's members with their roles (owner, captain, member). The
  team page stays public; only the list needs a session
- **Club:** the club's members with their roles (owner, editor, member). The
  club page stays public; only the list needs a session
- A private event's list follows the event page: it is hidden, as a missing
  event would be, until the viewer unlocks the event or organizes it. A missing
  or cancelled event has no list
- A row carries the person's name, avatar (drawn from their id), verification
  level, trust indicators, and, on a team, their role. It never carries an
  email address, bio, school, or RSVP answer
- Each person can opt out with **Show me in people lists** (on by default).
  Opting out removes them from every list above and changes nothing else: their
  RSVPs, memberships, and every count stay as they were. An opted-out person is
  simply absent; there is no placeholder row
- Deleted, suspended, and unverified accounts never appear
- The owner's roster inside a team page, which captain management needs, is not
  a people list and is not filtered by the setting

### Auth & account

- Sign up / login
- On signup: send **verification email**; clicking the link verifies the account
- Signup requires checkbox confirming user is **at least 18 years old**
- Forgot password / reset password
- Change password while signed in (Settings → Email and password): requires
  the current password; every other device is signed out
- Change email while signed in: requires the current password; the new
  address must confirm by link before the change takes effect, and the old
  address is told about the change
- Account deletion → scrub PII, display “Deleted User” on retained records
- `.edu` email may still unlock a separate “verified student” trust tier (see permissions)

### Notifications & email

- An in-app inbox at `/notifications`, with an unread count in the header, holds
  a notice for each active yes/maybe attendee when an event is cancelled, for
  an event's creator when someone accepts a co-organizer invite, for a team's
  owner when someone joins the team, and for a member when a team's ownership
  is transferred to them
- Email after event RSVP yes (details + calendar add) from `events@campusgamingnetwork.com`
- Email active yes/maybe RSVPs after an event is cancelled from
  `events@campusgamingnetwork.com` (best effort; no ICS attachment)
- Email a team's owner when someone joins the team, and a member when a
  team's ownership is transferred to them, from
  `notifications@campusgamingnetwork.com`
- Support / report follow-up email from `support@campusgamingnetwork.com` (later Admin Console workflow)
- Account emails (verify, reset password, confirm a new email, email-changed
  notice) from `account@campusgamingnetwork.com`
- Support tickets: **anyone** can submit (logged out OK); reviewed in the Admin Console support queue
- Site-wide announcement banner deployable to every page (later)

### Admin Console (in progress, release-gated)

- Separate **TanStack Start** app in `apps/admin` at **admin.campusgamingnetwork.com**, released after the first public release; ticket status lives in [20 — Admin Console v1 engineering plan](./20-admin-console-v1-engineering-plan.md)
- Manage schools, clubs, users, ACLs, games (no raw DB required)
- Site admins create/edit schools (after one-time Scorecard seed)
- View **reports** and **support tickets**
- Impersonate (“mimic”) users to see their permissions (later)
- Feature flags — **not scheduled** (later)

### Content pages

- FAQ: questions grouped under About, Accounts, Schools, Events, Teams, Games,
  and Safety and help. Answers describe shipped behavior only and open without
  JavaScript. Each question has a fixed anchor (for example
  `/faq#delete-account`) that support replies can link to; an anchor does not
  change when its question is reworded
- About: why the site exists, what you can do, who it is for, how it is run,
  and how to get in touch
- Donations: optional, through
  [Buy Me a Coffee](https://buymeacoffee.com/cgnbrandon), linked from the About
  page and the FAQ's "Can I support the project?" answer. The site takes no
  payments itself, and donating unlocks nothing
- Simple homepage (low UGC at launch)

## UX / design direction

- No component library: hand-written CSS in each app
- Accessibility reference: [GOV.UK Design System](https://design-system.service.gov.uk/components/)
- Mobile-friendly; no IE
- Prefer CSS over extra JS
- Server rendering important; code-split routes
- Voice: page introductions and empty states sound like the community and invite people in; the rules for an action (passwords, roles, visibility) sit beside that action, not in the introduction. Navigation and button labels stay explicit
- Event lifecycle copy: upcoming date/time → “happening now” → “ended” (no more signups)
- Missing/deleted event → dedicated not-found style page. The same branded not-found page covers missing schools, teams, and profiles, and answers HTTP 404 rather than a soft 404.

## Hosting URLs

| App           | URL                                                                            |
| ------------- | ------------------------------------------------------------------------------ |
| Main website  | [campusgamingnetwork.com](https://campusgamingnetwork.com)                     |
| Admin Console | [admin.campusgamingnetwork.com](https://admin.campusgamingnetwork.com) (later) |

## Success criteria (first release)

An email-verified user (18+) can:

1. Select a home school, follow additional schools, and browse public events
2. Create a public, unlisted, or private event (no approval) with optional capacity (yes-count) and optional off-site payment instructions
3. RSVP yes/no/maybe, mark events as interested, and receive a confirmation email + calendar invite on yes
4. Create or join a team (URL + password)
5. See a simple dashboard of upcoming activity

After the first release, the Admin Console lets site admins manage schools and work the report and support queues.
