# 01 — Product

## Vision

**Campus Gaming Network** is the central hub for collegiate gamers in the United States — casual and competitive. Students, alumni, and faculty find and join clubs, events, teams, friends, and everything they need about gaming at their school and across campuses.

> Connect college gamers at their school and between campuses across the United States.

## Goals (MVP / launch)

- Discover events at schools you follow (near-you is later)
- Create events and RSVP; create/join teams
- Follow schools and stay current with campus gaming activity
- Keep the product simple, accessible, mobile-friendly, and cheap to run for a single developer

## Non-goals (MVP)

- Clubs (post-MVP)
- Tournaments (post-MVP)
- On-site payment processing (paid events may be listed in MVP, but organizers handle payment off-site)
- Near-you / geo discovery (post-MVP)
- Cancel-event email notifications to RSVPs (post-MVP)
- Schools outside the United States
- Live updates via WebSockets
- Custom user avatars (use Gravatar first)
- Custom event banner uploads (default placeholder in MVP; moderated uploads later)
- Usernames or split first/last/display — single **name** field only
- Google Analytics
- Internet Explorer support
- Heavy user-generated content on the homepage (keep it simple until content exists)
- Shipping the CRM/admin app in the MVP release (CRM is post-MVP)
- In-app notifications and user/entity audit-history views (post-MVP)

## Product principles

| Principle | Meaning |
|-----------|---------|
| Keep it simple | Ship the smallest useful version; avoid premature complexity |
| Server-first | Prefer server rendering and server-side logic; use the browser only when needed |
| CSS over JS | Prefer CSS solutions when they work; avoid extra client JavaScript |
| Accessible | Follow accessible patterns (gov.uk Design System is a good reference) |
| Mobile-friendly | First-class mobile experience |
| Cost-conscious | Single developer; minimize third-party spend and complexity |
| Minimal dependencies | Prefer fewer libraries; adopt ones that are clearly worth it, performant, and safe |
| Log meaningfully | User actions and entity changes are visible to the right audiences |
| Safe by default | Rate limits, XSS/SQL injection prevention, profanity filtering, soft deletes |

## Personas

| Persona | Description |
|---------|-------------|
| **Student (basic)** | Registered with any email; can browse, RSVP, create events/teams |
| **Verified student** | Registered/verified with a `.edu` email |
| **Staff / faculty** | Granted by site admin; may run esports programs or advise clubs |
| **Alumni** | Can participate after graduation |
| **School admin** | Edits school details, manages school teams/clubs, cannot remove other school admins |
| **Club officer** | Manages a club; can create badge-eligible events |
| **Team owner / captain** | Owns or captains a team; can invite members and register for team tournaments |
| **Event organizer** | Creates/hosts events; may be one of several organizers |
| **Site admin** | Post-MVP: creates schools via CRM/admin app, manages users/ACLs, views reports, impersonates users |
| **CRM operator** | Post-MVP: uses the admin CRM app (not raw DB) to manage schools, users, ACLs |

## User verification levels

1. **Email verified** — signed up and clicked the verification link (required for normal use)
2. **Verified student** — used a `.edu` email (trust badge; separate from inbox verification)
3. **Staff / faculty** — granted by site admin

Signup also requires confirming **age 18+**. Alumni can participate. Faculty who run an esports team are first-class users (not “students only”).

## Core user journeys

### Discover

- Search or browse schools (works **logged out**); each school has a logo and slug URL
- Browse/filter events by game (and other filters) — no near-you in MVP
- Select a home school during signup; follow additional schools afterward (logged in)
- See popular games by school
- Dashboard: upcoming events, activity at followed schools, team activity
- School admin and faculty roles show a visible indicator on profiles / relevant UI

### Participate

- RSVP to events: **yes / no / maybe**
- Mark an event as **interested** (favorite/bookmark — separate from RSVP)
- RSVP yes → confirmation email with calendar attach (ICS)
- Create or join teams via shared team URL + password (no invite links at launch)

### Organize

- Anyone can create an event or a team — **no approval required** to create an event
- School admins (and later club officers / approved organizers) get a **badge** on events they create
- Events can be online or in-person, one-off or recurring; paid events are allowed, but payment happens off-site
- Event visibility: **public**, **unlisted**, or **private**
- Private events: page content is **not visible/inspectable** until unlocked; show blurred shell + **password modal** (share URL + password manually)
- Optional **capacity** on events; counts **RSVP yes only**; when full, no more yes RSVPs
- Multiple organizers per event
- Transfer team ownership; assign captains

### Trust & safety

- Report events and users
- Site admins review all reports
- Soft-delete events; deleted/missing event shows a clear “no longer exists” page
- Account deletion anonymizes PII (“Deleted User”) while retaining non-personal records

## Feature inventory

### Schools

- Search and browse schools (including while logged out); popular schools (high event volume)
- School logo comes later via CRM/admin app only (PNG/JPG ≤500 MB); placeholder until set; slug URL (duplicate names get auto-increment suffix)
- School names need not be unique
- School catalog bootstrapped **once** from College Scorecard — import **all** seed rows (main + branch), `is_active=true`; branch campuses use the same UI/UX as other schools; review/deactivate later in CRM/admin tooling
- Afterward only site admins create/edit/delete schools via admin tooling / CRM (users cannot create schools); `unitid` optional
- Multiple school admins; a user can admin multiple schools
- School admins edit school details and assign school teams
- School admins cannot remove other school admins
- School admin (and faculty) role shown with a visible indicator
- Sponsored teams/groups
- Users select one home school at signup and can follow multiple additional schools
- Popular games by school
- Clubs listed on school pages **after** clubs ship (post-MVP)

### Clubs (post-MVP)

- Belong **only** to a school (no orphan clubs)
- Distinguished as **official** school orgs
- Users can request a school club; school admins create, approve, and manage clubs
- Clubs can have **teams assigned** (e.g. Varsity, JV)
- Clubs reference one or more games

### Teams

- Anyone can create a team; a user can create and belong to multiple teams
- Optional assignment to a school club later (Varsity, JV, etc.) — post-MVP when clubs exist
- Team pages are **public**; password only required to **join / interact**
- Share team URL freely; no invite-link tokens at launch (maybe later)
- Owner can transfer ownership; users can assign captains
- Schools can have sponsored teams
- Teams reference one or more games

### Events

- Created by users or schools; multiple organizers; **no approval needed** to create
- Slug = `slugify(title) + "-" +` first **8** Base64URL chars of SHA-256(creatorId + createdDate + title)
- Online or in-person; recurring supported
- Paid events are allowed in MVP as informational/off-site-payment events only; no checkout, money handling, refunds, tax, or payout logic on CGN
- Visibility (MVP): **public** (in search) · **unlisted** (link only) · **private** (password modal; content gated/blurred until unlocked)
- Soft-delete/cancel without RSVP notification emails in MVP (notify later)
- Optional capacity; counts **RSVP yes only**; when full, no further yes RSVPs (no waitlist at MVP)
- Physical address + optional mini Google Map
- Description with character limit; **default banner/background placeholder** (custom uploads later with moderation)
- Show creator and host(s)
- RSVP: **yes / no / maybe**
- Interested: separate favorite/bookmark (not an RSVP answer)
- Registration closes automatically; ended or full events block new yes RSVPs
- Status display: upcoming (date/time), happening now, ended
- Soft deletes only
- Past events: organizers may make minor corrections only (not date/location)
- Badge for events by school admin (and later club officer / approved organizers)
- Report inappropriate events
- Reference one or more games; browse/filter by game
- Timezone: user preference (default system) for display

### Tournaments (post-MVP)

- Separate from events; can optionally be tied to an event
- Slug from name + short hash for uniqueness
- Events = attend; tournaments = compete
- Individual and team tournaments
- Optional capacity; when full, no more registrations (no waitlist at MVP)
- Browse and filter by game; reference one or more games
- Team captains register their teams

### Games

- Not editable by end users — MVP seed first; CRM / IGDB enrichment later
- MVP launch set: Rocket League, Valorant, League of Legends, Overwatch 2, Super Smash Bros. Ultimate, CSGO
- Used to browse/filter events (and later tournaments) and show popularity by school

### Profiles & social

- Gravatar avatars at launch, with initials fallback when no Gravatar image exists
- Single **name** field (no usernames; no separate first/last/display)
- Profile URL: `/users/:id` (database id)
- Bio + social links
- School affiliation(s), majors (multiple), expected graduation
- Support graduate students, alumni, faculty
- Visible indicators for school admin and faculty roles
- Users can report other users from profiles
- Activity log visible to the user (post-MVP)

### Auth & account

- Sign up / login
- On signup: send **verification email**; clicking the link verifies the account
- Signup requires checkbox confirming user is **at least 18 years old**
- Forgot password / reset password
- Account deletion → scrub PII, display “Deleted User” on retained records
- `.edu` email may still unlock a separate “verified student” trust tier (see permissions)

### Notifications & email

- In-app notifications table (post-MVP)
- Email after event RSVP yes (details + calendar add) from `events@campusgamingnetwork.com`
- Basic notifications from `notifications@campusgamingnetwork.com` (post-MVP)
- Support / report follow-up email from `support@campusgamingnetwork.com` (post-MVP CRM workflow)
- Account emails (verify, reset password) from `account@campusgamingnetwork.com`
- Support tickets: **anyone** can submit (logged out OK); queued for post-MVP CRM/admin review
- Site-wide announcement banner deployable to every page (post-MVP ok)

### Admin / CRM (post-MVP)

- Separate **TanStack Start** app at **crm.campusgamingnetwork.com**, released after the main-site MVP
- Manage schools, users, ACLs, games (no raw DB required)
- Site admins create/edit schools (after one-time Scorecard seed)
- View **reports** and **support tickets**
- Impersonate (“mimic”) users to see their permissions (may be post-MVP)
- Feature flags — **hold off for MVP** (post-MVP)

### Content pages

- FAQ
- About
- Simple homepage (low UGC at launch)

## UX / design direction

- Component library: **HeroUI**
- Accessibility reference: [GOV.UK Design System](https://design-system.service.gov.uk/components/)
- Mobile-friendly; no IE
- Prefer CSS over extra JS
- Server rendering important; code-split routes
- Event lifecycle copy: upcoming date/time → “happening now” → “ended” (no more signups)
- Missing/deleted event → dedicated not-found style page. The same branded not-found page covers missing schools, teams, and profiles, and answers HTTP 404 rather than a soft 404.

## Hosting URLs

| App | URL |
|-----|-----|
| Main website | [campusgamingnetwork.com](https://campusgamingnetwork.com) |
| CRM / admin app | [crm.campusgamingnetwork.com](https://crm.campusgamingnetwork.com) (post-MVP) |

## Success criteria (MVP)

An email-verified user (18+) can:

1. Select a home school, follow additional schools, and browse public events
2. Create a public, unlisted, or private event (no approval) with optional capacity (yes-count) and optional off-site payment instructions
3. RSVP yes/no/maybe, mark events as interested, and receive a confirmation email + calendar invite on yes
4. Create or join a team (URL + password)
5. See a simple dashboard of upcoming activity

Post-MVP CRM/admin app: site admins manage schools, view reports and support tickets.
