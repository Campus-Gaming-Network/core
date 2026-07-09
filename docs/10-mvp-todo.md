# MVP todo

Remaining work only. Locked product decisions live in the other docs (`01`, `05`, `08`) — not repeated here.

**MVP slice:** auth → home school on signup → schools search/follow → events + curated games → teams → dashboard.

**Out of MVP:** CRM/admin app, clubs, tournaments, on-site payments, usernames, waitlists, invite links, feature flags, near-you, cancel-event RSVP emails, custom event banner uploads (use default placeholder; moderation later).

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

---

## P0 — Must ship (main site MVP)

### Foundation
- [ ] Docker Compose: Next.js, Go API, Postgres (M1-friendly)
- [ ] Project skeletons + BFF wiring
- [ ] Health checks + Sentry
- [ ] Resend wired for transactional email
- [ ] Deploy path for `campusgamingnetwork.com`

### Auth & profiles
- [ ] Signup / login / logout
- [ ] Signup requires selecting a home school
- [ ] Verification email + resend (rate limited) via Resend
- [ ] 18+ checkbox (store timestamp)
- [ ] Forgot / reset password
- [ ] Profile: single **name** field, bio, socials, timezone, Gravatar
- [ ] Public profile at `/users/:id` (database id)

### Schools
- [ ] One-time import of **all** seed schools as `is_active=true` (main + branch; same UI/UX)
- [ ] Public search/browse (Postgres), including logged out
- [ ] School detail by slug
- [ ] Follow / unfollow school
- [ ] Empty states for school list + school page

### Games (MVP seed)
- [ ] Seed/curate launch games:
  - Rocket League
  - Valorant
  - League of Legends
  - Overwatch 2
  - Super Smash Bros. Ultimate
  - CSGO
- [ ] Browse/filter events by these games
- [ ] End users cannot edit games (CRM later / admin seed)

### Events
- [ ] Create / edit / soft-delete (no approval; no cancel-notify emails yet)
- [ ] Slug = `slugify(name) + "-" + base64url(sha256(...))` (**8** chars)
- [ ] Visibility: public / unlisted / private
- [ ] Private: content fully gated (blurred / not inspectable); password modal to unlock
- [ ] Optional capacity (count **RSVP yes** only)
- [ ] Paid event toggle + off-site payment note/link only (no CGN payment processing)
- [ ] RSVP yes/no/maybe + confirmation email + ICS on yes (Resend)
- [ ] Interested (favorite) separate from RSVP
- [ ] Browse/filter public events by game (no near-you yet)
- [ ] Lifecycle UI: upcoming / happening now / ended / full
- [ ] Missing/deleted event page
- [ ] Rate limit event create + private unlock attempts
- [ ] Default event banner/background placeholder (no custom uploads in MVP)
- [ ] Empty states for events browse

### Teams
- [ ] Create team
- [ ] **Public** team page; password only required to **join / interact**
- [ ] Captains + ownership transfer
- [ ] Dashboard shows team activity

### Dashboard & content
- [ ] Simple dashboard: upcoming RSVPs + followed-school events + team activity
- [ ] Homepage (works with little/no UGC)
- [ ] Cold-start plan (demo seed and/or “create first event” CTA)
- [ ] FAQ, About, Terms, Privacy
- [ ] Support ticket form — **anyone** can submit (logged out OK)

### Safety (minimum)
- [ ] Rate limits: signup, resend verification, event create, reports, private unlock, support tickets
- [ ] Report event + report user (queued for post-MVP CRM/admin review)
- [ ] New-account abuse limits (basic)

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
