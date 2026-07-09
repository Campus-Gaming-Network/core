# 12 — Phase 1 plan

Reviewable implementation plan for **Phase 1 — Auth, profiles, schools (read) — MVP**.

Phase 1 turns the Phase 0 scaffold into the first usable product slice: a logged-out visitor can browse schools, and a new user can sign up, verify email, select a home school, and follow additional schools.

## Scope boundary

Build only the MVP surface needed for auth, profiles, schools, and launch games.

**In scope**

- Server-managed auth sessions using secure HTTP-only cookies; no frontend JWT auth.
- Signup, login, logout, forgot/reset password, and email verification.
- 18+ confirmation captured at signup.
- Home school selected during signup.
- Follow/unfollow additional schools after signup.
- Public school browse/search/detail.
- One-time seed import for all school rows as active, including branch campuses with the same UI/UX.
- MVP launch games seed.
- Public profile shell at `/users/:id`.
- Simple homepage and static support/legal/info pages.
- Rate limits for sensitive auth/email actions.

**Out of scope**

- CRM/admin app.
- Clubs and tournaments.
- On-site payment processing.
- Usernames.
- Waitlists and invite-link tokens.
- Feature flags.
- Near-you/geo discovery.
- Custom event banners or school logo uploads.
- Routine school editing UI; post-MVP CRM/admin owns that.

## Phase 1A — Schema + Go API foundation

**Goal:** Add the durable backend foundation for auth, profiles, schools, follows, and games.

**Deliverables**

- Add a real migration runner workflow before product schema work.
- Create MVP-only migrations for:
  - `users`
  - auth sessions
  - email verification tokens
  - password reset tokens
  - user social links
  - user school follows
  - schools
  - games
  - minimal operational timestamps/soft-delete conventions
- Add Go repository/service boundaries for auth, users, schools, and games.
- Add request/response DTOs and validation helpers.
- Add API-level session middleware using secure cookie sessions.
- Keep password hashes server-only.

**Review focus**

- Schema stays MVP-only and does not pull in CRM/admin, clubs, tournaments, on-site payments, IGDB sync, or feature flags.
- Session model is cookie-based and server-owned.
- Tables can support the Phase 1 exit criteria without over-modeling later phases.

**Exit**

- Migrations run locally against Postgres.
- API can connect to Postgres through the migration-backed schema.
- Basic repository tests pass.

## Phase 1B — Schools + games seed/read model

**Goal:** Make schools and launch games available to logged-out and logged-in users.

**Deliverables**

- Normalize/import all school seed rows as `is_active=true`.
- Preserve Scorecard identifiers where available; allow `unitid` to be optional for future CRM-created schools.
- Treat main and branch campuses identically in browse/detail UX.
- Add public school list/search endpoint.
- Add public school detail endpoint by slug.
- Add home-school lookup support for signup.
- Add follow/unfollow endpoints for authenticated users.
- Seed the six MVP games:
  - Rocket League
  - Valorant
  - League of Legends
  - Overwatch 2
  - Super Smash Bros. Ultimate
  - CSGO

**Review focus**

- School import is one-time bootstrap behavior, not a recurring production sync.
- Search starts with Postgres capabilities; no Elasticsearch.
- End users cannot create or edit schools/games.

**Exit**

- Logged-out users can search schools and view school details.
- Authenticated users can follow and unfollow schools.
- MVP games are queryable.

## Phase 1C — Signup/login/profile flow

**Goal:** Users can create and access accounts safely.

**Deliverables**

- Signup form/API with:
  - email
  - password
  - single `name` field
  - required home school
  - required 18+ confirmation checkbox
- Verification email through Resend.
- Verification link handling.
- Login/logout.
- Forgot/reset password.
- Resend verification with rate limiting.
- Profile read/update basics:
  - name
  - bio
  - timezone
  - social links
  - Gravatar-derived avatar fallback
- Public profile page data at `/users/:id`.

**Review focus**

- Signup cannot complete without a home school and 18+ confirmation.
- Email verification state is explicit.
- Sensitive flows are rate limited.
- No usernames are introduced.

**Exit**

- A new user can sign up, verify email, log out, log back in, and maintain a basic profile.

## Phase 1D — Main-site pages + content stubs

**Goal:** Ship the first coherent public-facing main-site experience.

**Deliverables**

- Simple homepage.
- School browse page.
- School detail page.
- Signup/login/logout UI.
- Forgot/reset password UI.
- Public profile shell.
- Followed-schools UI states.
- FAQ stub.
- About stub.
- Terms stub.
- Privacy stub.
- Support contact path or support email stub.
- Empty states for school browse/detail/following.

**Review focus**

- Pages are server-first and accessible.
- Branch campuses do not get special UI treatment.
- Content stubs are honest placeholders, not fake policy/legal depth.

**Exit**

- A logged-out visitor can browse/search schools.
- A new 18+ user can sign up, verify email, select a home school, and follow at least one additional school.

## Suggested implementation order inside each slice

1. Schema + Go domain API.
2. Next.js BFF route or server action.
3. SSR/page UI.
4. Email or other side effects.
5. Audit/activity writes where relevant.
6. Rate limits on sensitive actions.
7. Verification and deploy check.

## Phase 1 final exit criteria

Phase 1 is done when:

- Logged-out users can search schools.
- Logged-out users can view school detail pages.
- New users must confirm they are 18+ during signup.
- New users must choose a home school during signup.
- New users can verify their email.
- Users can log in, log out, and reset passwords.
- Users can follow/unfollow schools after signup.
- Users have a basic public profile at `/users/:id`.
- MVP games are seeded and available for later event filtering.
- Auth uses secure server-managed sessions, not frontend JWTs.
