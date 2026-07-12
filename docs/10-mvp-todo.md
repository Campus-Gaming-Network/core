# MVP todo

Status tracker for the main-site MVP. Locked product decisions live in the other docs (`01`, `05`, `08`) — not repeated here.

**Current P0 remaining:** implement the Railway production deploy, DNS, backups, migrations, and smoke test for `campusgamingnetwork.com`.

**MVP slice:** auth → home school on signup → schools search/follow → events + curated games → teams → dashboard.

**Out of MVP:** Sentry/error monitoring, CRM/admin app, clubs, tournaments, on-site payments, usernames, waitlists, invite links, feature flags, near-you, cancel-event RSVP emails, custom event banner uploads (use default placeholder; moderation later).

**School seed:** 6,243 operating schools (4,943 main · **1,300 branch**). Import all, `is_active=true`; branch campuses use the same UI/UX; review later in CRM/admin tooling.

**Launch games:** Rocket League · Valorant · League of Legends · Overwatch 2 · Super Smash Bros. Ultimate · CSGO.

---

## P0 — Decide before coding

No blocking decisions left for media/slugs/email. Optional later: exact default banner asset design.

**Decided:**

| Topic | Decision |
|-------|----------|
| Event slug hash | **8** Base64URL chars |
| Images | **PNG or JPG only**; max **500 MB** |
| Event banners (MVP) | Default placeholder image/background — **no user uploads yet** |
| School logos | Placeholder in MVP; CRM/admin upload via R2 later |
| Email From | `events@` / `notifications@` / `support@` / `account@campusgamingnetwork.com` |
| Paid events | Allowed in MVP as off-site-payment listings only; no CGN checkout/payments |
| MVP deploy path | Railway hosts Next.js, Go API, and PostgreSQL; Cloudflare manages DNS/protection |

---

## P0 — Must ship (main site MVP)

### Foundation
- [x] Docker Compose: Next.js, Go API, Postgres (M1-friendly)
- [x] Project skeletons + BFF wiring
- [x] Health checks
- [x] Resend wired for transactional email
- [x] Deploy path selected: Railway for web, API, and Postgres
- [ ] Implement Railway production deploy + DNS + backups + migration/smoke-test flow for `campusgamingnetwork.com`

### Auth & profiles
- [x] Signup / login / logout
- [x] Signup requires selecting a home school
- [x] Verification email + resend (rate limited)
- [x] 18+ checkbox (store timestamp)
- [x] Forgot / reset password
- [x] Profile: single **name** field, bio, socials, timezone
- [x] Gravatar with initials fallback
- [x] Public profile at `/users/:id` (database id)

### Schools
- [x] One-time import of **all** seed schools as `is_active=true` (main + branch; same UI/UX)
- [x] Public search/browse (Postgres), including logged out
- [x] School detail by slug
- [x] Follow / unfollow school
- [x] Empty states for school list + school page

### Games (MVP seed)
- [x] Seed/curate launch games:
  - Rocket League
  - Valorant
  - League of Legends
  - Overwatch 2
  - Super Smash Bros. Ultimate
  - CSGO
- [x] Browse/filter events by these games
- [x] End users cannot edit games (CRM later / admin seed)

### Events
- [x] Create / edit / soft-delete (no approval; no cancel-notify emails yet)
- [x] Slug = `slugify(name) + "-" + base64url(sha256(...))` (**8** chars)
- [x] Visibility: public / unlisted / private
- [x] Private: content fully gated (not inspectable); password form to unlock
- [x] Optional capacity (count **RSVP yes** only)
- [x] Paid event toggle + off-site payment note/link only (no CGN payment processing)
- [x] RSVP yes/no/maybe
- [x] RSVP confirmation email + ICS on yes (Resend)
- [x] Interested (favorite) separate from RSVP
- [x] Browse/filter public events by game (no near-you yet)
- [x] Lifecycle UI: upcoming / happening now / ended / full
- [x] Missing/deleted event page
- [x] Rate limit event create + private unlock attempts
- [x] Default event banner/background placeholder (no custom uploads in MVP)
- [x] Empty states for events browse

### Teams
- [x] Create team
- [x] **Public** team page
- [x] Password only required to **join / interact**
- [x] Captains + ownership transfer
- [x] Dashboard shows team activity

### Dashboard & content
- [x] Simple dashboard: upcoming RSVPs + followed-school events + team activity
- [x] Homepage (works with little/no UGC)
- [x] Cold-start plan (demo seed and/or “create first event” CTA)
- [x] FAQ, About, Terms, Privacy
- [x] Support ticket form — **anyone** can submit (logged out OK)

### Safety (minimum)
- [x] Rate limits: signup, resend verification, event create, reports, private unlock, support tickets
- [x] Report event + report user (queued for post-MVP CRM/admin review)
- [x] New-account abuse limits (basic)

---

## P1 — Important soon after main MVP (CRM/admin separate release)

### CRM/admin app (`crm.campusgamingnetwork.com` — TanStack Start)
- [ ] Bootstrap first site admin (CLI / env seed)
- [ ] TanStack Start CRM app (separate deploy, shared Go API)
- [ ] Schools: create / edit / soft-delete, logos (**CRM/admin-only** R2 PNG/JPG ≤500 MB), activation (`unitid` optional)
- [ ] Review/deactivate bad seed schools later
- [ ] Grant school admins
- [ ] Games catalog management (start from the six launch games; IGDB later)
- [ ] Reports queue
- [ ] Support tickets queue
- [ ] Placeholder school logos until CRM upload

### Product polish
- [ ] Soft-pedal friends/clubs/tournaments in marketing copy
- [ ] Sentry/error monitoring
- [ ] Analytics (non-GA: Plausible or Cloudflare Web Analytics)
- [ ] Profanity filter scope (or explicitly defer)

---

## P2 — Nice to have (can slip)

- [ ] Google Maps embed (address text is enough first)
- [ ] Recurring events
- [ ] Richer profile fields (majors, graduation automation, faculty extras)
- [ ] `.edu` verified-student badge UX
- [ ] School admin / faculty role indicators (if few admins at launch)
- [ ] Event organizer badges
- [ ] Full activity / audit history UIs (keep write-side logs)
- [ ] Site-wide announcements
- [ ] Impersonation
- [ ] Broader IGDB game import

---

## Later (explicitly not MVP)

- Clubs
- Tournaments
- On-site payments
- Waitlists
- Team invite-link tokens
- Usernames / first+last+display split
- Feature flags
- **Near you** / geo discovery
- Cancel-event notify RSVPs
- **Custom event banner uploads** (with strict moderation)
- Friends graph
- WebSockets / live updates
- Custom avatars
- Elasticsearch
- International schools

---

## Suggested order

1. Foundation + auth + schools + **six launch games**
2. Events (default banners) + teams + dashboard + legal/support
3. CRM/admin app (TanStack Start) separate post-MVP release — school logos
4. Post-MVP backlog
