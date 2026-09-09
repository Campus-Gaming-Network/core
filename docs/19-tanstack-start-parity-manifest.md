# 19 — TanStack Start Phase 0 parity manifest

> **Status: Phase 0 baseline frozen; Phase 1 verification active.** This
> manifest records the observable contract of the current Next.js application
> and the evidence for the reversible TanStack Start slice. It complements the
> execution plan in
> [18 — TanStack Start main-frontend migration guide](./18-tanstack-start-main-frontend-migration-guide.md).
> A migration task is not complete until its entries below pass against the
> production TanStack Start server, not only the Vite development server.

## How to use this manifest

- Keep public URLs, query names, redirects, cookie behavior, status codes, and
  privacy rules stable. Generated framework endpoint URLs are not public API.
- Treat every Start loader result as browser-visible serialized data. Return a
  display DTO, never request context, cookies, secrets, unlock tokens, or an
  upstream `Response`.
- A route guard is navigation UX, not authorization. The Go API remains the
  authority for every authenticated or role-restricted operation.
- Preserve the existing Zod response contracts, form schemas, native HTML
  constraints, and accessible `FormState` field errors.
- For redirects, `next/navigation` currently produces temporary redirects from
  page rendering and see-other redirects from Server Actions. Phase 0 HTTP
  capture must record the actual status and `Location` before the old runtime is
  removed.
- `T0` through `T9` below are required migration gates. A table entry may add a
  narrower assertion but never removes a global gate.

## Source inventory

Counts were rechecked from the current source on 2026-09-08:

| Surface | Count | Verification command |
|---|---:|---|
| Page routes | 23 | `find apps/web/app -name page.tsx -type f \| wc -l` |
| API route handlers | 3 | `find apps/web/app -name route.ts -type f \| wc -l` |
| Exported Server Actions | 24 | `rg -c '^export async function [A-Za-z0-9_]+Action' apps/web/app/actions.ts` |
| Loading boundaries | 4 | `find apps/web/app -name loading.tsx -type f \| wc -l` |
| Dynamic metadata routes | 4 | `rg -l '^export async function generateMetadata' apps/web/app --glob 'page.tsx' \| wc -l` |
| Files with a `next` module reference | 29 | `node scripts/tanstack_migration_inventory.mjs` (includes the JSDoc type import in `next.config.mjs`) |
| Unit-test files | 11 | `find apps/web/tests -maxdepth 1 -name '*.test.ts' -type f \| wc -l` |
| Unit-test declaration sites | 73 | `node scripts/tanstack_migration_inventory.mjs` (loop-generated cases are recorded once per declaration site) |
| Playwright specification files | 4 | `find apps/web/tests/e2e -name '*.spec.ts' -type f \| wc -l` |
| Playwright tests | 17 | `rg -n '^test\\(' apps/web/tests/e2e --glob '*.spec.ts' \| wc -l` |
| Static unit and browser declaration sites | 90 | `node scripts/tanstack_migration_inventory.mjs` |

The earlier snapshot in doc 18 listed 70 unit tests. The inventory deliberately
counts static declaration sites rather than expanded runtime cases, and counts
the JSDoc `import("next")` in `next.config.mjs` as a migration dependency. This
keeps the baseline deterministic without pretending regex extraction is a test
runner.

## Global rendering contract

### Document head

`app/layout.tsx` establishes:

- `<html lang="en">`, the global stylesheet, site header/navigation, footer,
  and the `Campus Gaming Network` brand.
- Default title `Campus Gaming Network` and child title template
  `%s | Campus Gaming Network`.
- Default description, application name, Open Graph site/type/title/
  description/URL, and Twitter summary card/title/description.
- `metadataBase` from `NEXT_PUBLIC_SITE_URL`, falling back to
  `http://localhost:3000`.

`pageMetadata()` adds the route title, description, Open Graph and Twitter
values, and an Open Graph URL when `path` is supplied. It does **not** currently
emit a canonical-link element. When `noIndex` is true it emits both
`index: false` and `follow: false`. Start's root `head` and route `head` helpers
must reproduce this output before adding new SEO behavior.

### Error, not-found, and pending UI

- Root route errors render `app/error.tsx`; root-layout failures render
  `app/global-error.tsx`. Both use generic copy and expose only Next's safe
  `error.digest`, never `error.message` or upstream payloads. Start error UI
  must retain the same disclosure rule and use router invalidation when retrying
  a failed loader.
- `app/not-found.tsx` is the global not-found UI and is `noindex`. Missing
  schools, events, teams, and profiles deliberately resolve 404 during dynamic
  metadata as well as body rendering to avoid a streamed soft 404.
- Loading UI exists only for `/account`, `/schools`, `/events`, and `/teams`.
  Browse loading files live in `(browse)` route groups so their Suspense
  boundary cannot cover a sibling detail route and commit a 200 before a 404.
  In Start, attach pending UI to the exact leaf route.
- Browse/home catalog failures deliberately degrade to empty-state content with
  a 200. Authenticated-page profile failures deliberately reach the safe error
  boundary rather than pretending the visitor is logged out.

### Shared request and privacy behavior

- Static public pages do not call `/me` while server rendering. Client
  `AuthNavigation` calls `/api/navigation-session` and degrades to logged-out
  navigation on failure.
- School and game catalog reads are the only BFF reads with a five-minute
  shared revalidation policy. All session-, viewer-, event-, team-, and
  activity-dependent reads default to `no-store`.
- Session cookies and event-unlock cookies remain HTTP-only. Private event
  details must be absent from HTML, metadata, serialized loader data, client
  chunks, and logs until the event is unlocked.
- Every BFF call strips browser-supplied internal identity headers, derives the
  visitor address at the trusted hosting boundary, and attaches it with the API
  proxy secret only when the assertion can be authenticated.

## Page-route manifest

Proposed Start filenames are planning labels. The generated route IDs and
observable URLs are the contract.

| ID | Current route → proposed Start route | Params and search | Auth and data | Status, head, privacy, and boundary | Migration test gate |
|---|---|---|---|---|---|
| R01 | `/` — `app/page.tsx` → `routes/index.tsx` | Search is ignored. | Public. Fetch schools (`limit=6`) and games in parallel; either failure becomes an empty result. | 200 with full SSR. Home alone uses the bare site title and its custom description/OG/Twitter values. No route pending UI. | Direct HTTP and browser render; API-down response stays 200 with the current empty-state copy; assert head and no sensitive hydration data. |
| R02 | `/about` — `app/about/page.tsx` → `routes/about.tsx` | None. | Public and static. | 200, indexable `About` metadata. Root safe error/not-found behavior only. | Assert SSR heading and metadata; retain the existing no-anonymous-`/me` browser assertion. |
| R03 | `/faq` — `app/faq/page.tsx` → `routes/faq.tsx` | None. | Public and static. | 200, indexable `FAQ` metadata. | Assert SSR heading/metadata and no anonymous `/me` request. |
| R04 | `/terms` — `app/terms/page.tsx` → `routes/terms.tsx` | None. | Public and static. | 200, indexable `Terms` metadata. | Assert SSR heading/metadata and no anonymous `/me` request. |
| R05 | `/privacy` — `app/privacy/page.tsx` → `routes/privacy.tsx` | None. | Public and static. | 200, indexable `Privacy` metadata. | Assert SSR heading/metadata and no anonymous `/me` request. |
| R06 | `/support` — `app/support/page.tsx` → `routes/support.tsx` | None. | Public static shell; support submission is A09 and accepts anonymous users. | 200, indexable `Support` metadata. | Assert SSR/head plus anonymous and authenticated support-form behavior without exposing submitted PII. |
| R07 | `/login` — `app/login/page.tsx` → `routes/login.tsx` | `next`, `reset`, `signup`; first value wins today. | Public; no loader. Search selects reset/signup notices and passes `next` to A02. | 200, currently indexable `Log in` metadata. | Assert each notice; A02 must reject `//host` and non-root-relative return targets and preserve a valid local path. |
| R08 | `/signup` — `app/signup/page.tsx` → `routes/signup.tsx` | `q`, `school_id`; first value wins. | Public. Search schools only when trimmed `q` has at least two characters, limit 50; failure renders a recoverable search state. | 200, currently indexable `Sign up` metadata. No route pending file; picker owns client loading state. | Preserve browser picker loading/empty/error states and the no-JS `<select>` fallback; assert selected school survives search. |
| R09 | `/forgot-password` — `app/forgot-password/page.tsx` → `routes/forgot-password.tsx` | None. | Public and static; form uses A04. | 200; `Forgot password`, `noindex,nofollow`. | Assert head, native email constraint, enumeration-safe success copy, and error state. |
| R10 | `/reset-password` — `app/reset-password/page.tsx` → `routes/reset-password.tsx` | `token`; first value wins. | Public; token is rendered only into A05's hidden form input. Missing token shows an alert. | 200 in both present/missing-token states; `Reset password`, `noindex,nofollow`. | Assert token is not visible in body text/logs, missing-token state remains 200, and successful A05 redirects correctly. |
| R11 | `/auth/verify-email` — `app/auth/verify-email/page.tsx` → `routes/auth.verify-email.tsx` | `token`; first value wins. | Public. GET never consumes a token; explicit A07 submission verifies it. Missing token shows resend form A06. | 200; `Verify email`, `noindex,nofollow`. | Preserve explicit-confirmation, used/expired/missing-token flows; token must not appear in visible text or logs. |
| R12 | `/auth/reset-password` — `app/auth/reset-password/page.tsx` → `routes/auth.reset-password.tsx` | Optional `token`; first value wins. | Public legacy compatibility route. No data. | Temporary render redirect to `/reset-password?token=<encoded>` or `/reset-password`; route metadata is `noindex` but the response should redirect before a body is used. | Direct HTTP assertion for status and exact encoded `Location`, with and without a token. |
| R13 | `/account` — `app/account/page.tsx` → `routes/account.tsx` | None. | Session required. Load current profile first; if present, load dashboard events (5), followed schools, and teams (10) in parallel. Secondary failures become empty sections; non-401 profile failures surface. | 200 authenticated; temporary redirect to `/login?next=/account` when anonymous; `Account`, `noindex,nofollow`; dedicated pending UI. | Assert redirect, authenticated SSR, secondary-data empty fallbacks, pending UI, API-outage safe error, and absence of private shared caching. |
| R14 | `/schools` — `app/schools/(browse)/page.tsx` → `routes/schools.index.tsx` | `q`, `state`, `page`; invalid page safely becomes 1. Limit 25 and offset `(page-1)*25`. | Public. Failed catalog request becomes an empty result. Previous/next links preserve filters. | 200, indexable `Schools` metadata; exact browse pending UI. | Preserve filter GET form, empty fallback, pagination URLs/history, and client five-minute catalog freshness without applying it to follow state. |
| R15 | `/schools/:slug` — `app/schools/[slug]/page.tsx` → `routes/schools.$slug.tsx` | Path `slug`; search notice `follow`. | Public school data plus optional current profile and, when authenticated, followed schools. | 200 for a school; true 404 for upstream 404; dynamic indexable school/location head. No ancestor browse pending boundary. | Direct 404/status/head test, authenticated/anonymous follow-state privacy test, and A12/A13 redirect/invalidation tests. |
| R16 | `/events` — `app/events/(browse)/page.tsx` → `routes/events.index.tsx` | `game`, `school`, `format`, `after`, `before`; `event` is a display-only notice and must not be a loader dependency. | Public events (`limit=25`) plus optional profile and games in parallel. Event/game failures become empty results; an authenticated `/me` outage reaches the safe error boundary. | 200, indexable `Events` metadata; exact browse pending UI. | Preserve GET filters, opaque cursor links, notices, API-down empty state, authenticated-profile outage behavior, and authenticated create CTA without serializing a full profile. |
| R17 | `/events/new` — `app/events/new/page.tsx` → `routes/events.new.tsx` | Search `school_q`. | Session required. After profile, load games and optional school search (`school_q` length >=2, limit 50); school failure is inline, game failure is a route error. | 200 authenticated; temporary redirect to `/login?next=/events/new` anonymous; `Create event`, `noindex,nofollow`. | Assert auth redirect, default school/timezone, shared school search/no-JS fallback, safe route error, and A14 validation/success. |
| R18 | `/events/:slug` — `app/events/[slug]/page.tsx` → `routes/events.$slug.tsx` | Path `slug`; search notice `event`. | Public/unlisted detail; private detail uses session and per-event unlock cookie. Current profile is optional. | True 404 upstream. Public head is dynamic/indexable; unlisted is dynamic `noindex,nofollow`; locked private head is only “Private event” plus generic description and `noindex,nofollow`. No browse pending ancestor. | Assert HTTP 404 before streaming; scan head, HTML, hydration payload, logs, and JS for locked title/description/token; preserve A16/A21/A22/A23 notices and state. |
| R19 | `/events/:slug/edit` — `app/events/[slug]/edit/page.tsx` → `routes/events.$slug.edit.tsx` | Path `slug`; search `school_q`. | Session required. Viewer-aware event load; missing event 404. Locked or non-editor event returns generic denial UI; Go remains authorization authority. Then games + optional school search. | 200 editor or denial; anonymous temporary redirect to `/login?next=/events/<slug>/edit`; true 404 missing; generic `Edit event`, `noindex,nofollow`, never the event title in head. | Test anonymous, editor, non-editor, locked, missing, recurring-occurrence, school-search, and A15 validation/success cases. |
| R20 | `/teams` — `app/teams/(browse)/page.tsx` → `routes/teams.index.tsx` | `game`, `school`, `after`, `before`. | Public teams (`limit=25`) plus optional profile and games in parallel. Team/game failures become empty results; an authenticated `/me` outage reaches the safe error boundary. | 200, indexable `Teams` metadata; exact browse pending UI. | Preserve GET filters/cursors, API-down empty state, authenticated-profile outage behavior, and auth-aware create CTA using only a minimal loader DTO. |
| R21 | `/teams/new` — `app/teams/new/page.tsx` → `routes/teams.new.tsx` | Search `school_q`. | Session required. Profile, games, and optional school search mirror R17. | 200 authenticated; temporary redirect to `/login?next=/teams/new`; `Start a team`, `noindex,nofollow`. | Assert auth/defaults/search/error behavior and add missing A17 create-team browser coverage. |
| R22 | `/teams/:slug` — `app/teams/[slug]/page.tsx` → `routes/teams.$slug.tsx` | Path `slug`; search notice `team`. | Public team data; session adds viewer role/member-management state. | 200; true 404 upstream; dynamic indexable team head. Metadata currently uses a public fetch while body can use a viewer-aware fetch; a Start composite loader may dedupe only if it returns an explicitly reviewed safe DTO. | Direct 404/head test plus anonymous/member/owner views and A18/A19/A20 redirects/invalidation. |
| R23 | `/users/:id` — `app/users/[id]/page.tsx` → `routes/users.$id.tsx` | Path `id`. | Public profile plus minimal current-viewer identity for report/self UI. | 200; true 404 upstream; dynamic indexable profile head. | Direct 404/head test, trust-indicator test, anonymous/self/other safety UI, and A11 report behavior. |

All route searches should move to `validateSearch`. Preserve today's tolerant
defaults instead of turning malformed or repeated query values into route
errors. `loaderDeps` must contain only fields that change loaded data; notice
parameters belong to the component state so mutation redirects do not cause
unnecessary loader keys.

## API-route manifest

These are public-origin BFF routes, not direct Go API exposure. Unsupported
methods must not execute a handler; capture and preserve the current 405
behavior.

| ID | Route and allowed method | Input/auth | Current response contract | Migration test gate |
|---|---|---|---|---|
| S01 | `GET /api/health` | No auth or query. Calls Go `/health` with no-store fetch. | JSON `{service:"campus-gaming-network-web", status:"ok", api}` with 200 when Go is healthy; `{status:"degraded", api}` with 503 for a non-OK Go response; `{status:"degraded", reason:"api_unreachable"}` with 503 on fetch failure. Never redirects. | Direct tests for all three branches, content type, unsupported method, and Nitro/Railway health-probe behavior. |
| S02 | `GET /api/navigation-session` | Optional session cookie; no other input. | Always 200 JSON `{authenticated:boolean}`. `/me` failure degrades to false. Header is `Cache-Control: private, no-store`; route is always dynamic. | Assert anonymous, authenticated, invalid-session, and API-outage cases; never return profile fields or cache publicly. |
| S03 | `GET /api/schools` | Public. Trimmed `q` must be 2–120 characters. `limit` defaults to 25 and clamps to 1–50. | 200 with the validated schools response and `Cache-Control: private, max-age=60`; invalid query 400 `{error:"invalid_school_query"}`; upstream client error preserves its status, otherwise 503 `{error:"schools_unavailable"}`. | Direct boundary tests for lengths/limit/status/cache header, malformed Go success contract, unsupported method, and picker integration. |

## Redirect and compatibility registry

| Trigger | Required destination | Notes |
|---|---|---|
| `GET /auth/reset-password?token=T` | `/reset-password?token=<encoded T>` | Legacy temporary redirect; without `token`, omit the query entirely. |
| Anonymous `GET /account` | `/login?next=/account` | Profile 401/missing session redirects; upstream outage must show safe error instead. |
| Anonymous `GET /events/new` | `/login?next=/events/new` | Preserve exact local return target. |
| Anonymous `GET /teams/new` | `/login?next=/teams/new` | Preserve exact local return target. |
| Anonymous `GET /events/:slug/edit` | `/login?next=/events/<slug>/edit` | Encode dynamic path data when building the Start redirect. |
| Successful login | Valid local `next`, otherwise `/account` | Only a string beginning `/` but not `//` is accepted. |
| Follow/unfollow API 401 | `/login?next=<encoded /schools/slug>` | Other failures return to the school with `follow=failed`. |
| Successful password reset | `/login?reset=complete` | Login renders the completion notice. |
| Successful event create/update | `/events/<returned-slug>?event=created|updated` | Use the Go-returned slug. |
| Event cancellation | `/events?event=cancelled` | Invalid input goes to `/events?event=cancel-failed`; API failure returns to the detail route with the same notice. |
| Event unlock/RSVP/interest | `/events/<returned-slug>?event=unlocked|rsvp-updated|interest-added|interest-removed` | Failures that return `FormState` stay in place; redirect-only interest failure uses `interest-failed`. |
| Successful team create/join | `/teams/<returned-slug>?team=created|joined` | Use the Go-returned slug. |
| Captain/ownership management | `/teams/<returned-slug>?team=captain-updated|ownership-transferred` | Validation/API failure uses `team=manage-failed`. |
| Successful account deletion | `/?account=deleted` | Delete local session cookie before redirect. |
| Auth-navigation logout | `/` | Current enhanced client replaces history and refreshes after A03; the no-JS Start path must reach the same destination. |

## Server Action parity manifest

The browser-facing Start replacement for each action must be a POST server
function or a thin POST server route backed by the same handler. “Auth” below
describes the effective product requirement; the current UI may hide a form,
but the Go API must enforce the requirement independently.

| ID | Current action / surface | Auth and validated input | Upstream operation | Result, invalidation, privacy, and migration gate |
|---|---|---|---|---|
| A01 | `signupAction` — signup form | Public; `signupFormSchema`: email, password, name, home school, age confirmation, timezone. | `POST /auth/signup`; `profileSchema`. | Returns accessible success/error `FormState`; no redirect. Preserve generic API errors, native constraints, age check, trimmed inputs, and never log/serialize password or email unnecessarily. |
| A02 | `loginAction` — login form | Public; `loginFormSchema`: email, password, optional `next`. | `POST /auth/login`; `profileSchema`; mirror upstream session `Set-Cookie`. | Validation/API failure returns `FormState`; success redirects to safe local `next` or `/account`. Gate exact cookie attributes, hostile return targets, authenticated SSR, and cache invalidation. |
| A03 | `logoutAction` — auth navigation | Effective session required; no form fields. | `POST /auth/logout` with incoming cookie; `emptyResponseSchema`. | Mirror upstream deletion. On any failure, log only contract metadata and delete the local session cookie anyway. Invalidate all session-derived route data; enhanced and no-JS flows end at `/`. |
| A04 | `forgotPasswordAction` — forgot-password form | Public; `emailFormSchema`. | `POST /auth/forgot-password`; `statusResponseSchema`. | Returns the same enumeration-safe success message whether an account exists; errors remain safe `FormState`. Add explicit browser and no-JS coverage. |
| A05 | `resetPasswordAction` — reset form | Public token flow; `resetPasswordFormSchema`: token and new password. | `POST /auth/reset-password`; `emptyResponseSchema`. | Validation/API failure returns state; success redirects `/login?reset=complete`. Never place token/password in redirect, logs, or loader output. Add expired/used/success/no-JS tests. |
| A06 | `resendVerificationAction` — verification resend form | Public; `emailFormSchema`. | `POST /auth/resend-verification`; `statusResponseSchema`. | Enumeration-safe success `FormState`; rate-limited visitor identity preserved. Existing browser test must pass; add no-JS and malformed-response cases. |
| A07 | `verifyEmailAction` — explicit verification form | Public token flow; `verificationTokenFormSchema`. | `POST /auth/verify-email`; `statusResponseSchema`. | Success stays on page with “Your email is verified.” Invalid/expired/used token returns generic link-invalid message and resend UI. Preserve explicit POST and token privacy. |
| A08 | `updateProfileAction` — account profile form | Session required; `profileFormSchema`: name, bio, timezone, up to three social links. | `PATCH /me`; `profileSchema`. | Returns `FormState`; success invalidates `/account`. Preserve nested accessible field mapping, auth enforcement, blocked-language errors, safe logs, and add missing browser/no-JS coverage. |
| A09 | `submitSupportTicketAction` — support form | Anonymous allowed; optional session cookie; `supportTicketFormSchema`: contact email, name, subject, message. | `POST /support-tickets`; `idResponseSchema`. | Success/error `FormState`, no redirect. Preserve rate-limit identity and never log PII/message bodies. Add anonymous/authenticated/no-JS tests. |
| A10 | `reportEventAction` — event report form | Basic user required by product/Go; `slugFormSchema` target plus `reportFormSchema` reason. | `POST /events/<encoded slug>/report`; `idResponseSchema`. | Success/error `FormState`, no redirect. Preserve rate-limit identity, target encoding, report privacy, and add missing unauthorized/success/no-JS tests. |
| A11 | `reportUserAction` — public-profile report form | Basic user required; `slugFormSchema` user ID plus `reportFormSchema` reason. | `POST /users/<encoded id>/report`; `idResponseSchema`. | Same state/privacy rules as A10. Test self/anonymous UI plus server-side unauthorized and valid reports. |
| A12 | `followSchoolAction` — school detail form | Session required; `schoolFollowFormSchema`: school ID and slug. | `POST /schools/<encoded id>/follow`; `emptyResponseSchema`. | Redirect-only action. Success invalidates school detail and adds `follow=added`; invalid input uses `/schools?follow=failed`; 401 goes to login return target; other failure uses detail `follow=failed`. Add browser/no-JS coverage. |
| A13 | `unfollowSchoolAction` — school detail form | Session required; same schema as A12. | `DELETE /schools/<encoded id>/follow`; `emptyResponseSchema`. | Redirect-only. Success invalidates detail and adds `follow=removed`; validation/auth/error destinations mirror A12. Verify no stale follow state after client navigation. |
| A14 | `createEventAction` — event form create mode | Authenticated verified user; `createEventFormSchema` over normalized event payload. | `POST /events` with session; `eventSchema`. | Validation/API failure returns accessible state; success invalidates `/events` and redirects to returned slug with `event=created`. Existing create/validation tests plus valid no-JS submission must pass. |
| A15 | `updateEventAction` — event form edit mode | Event organizer; `slugFormSchema` plus `updateEventFormSchema`. | `PATCH /events/<encoded slug>` with session; `eventSchema`. | Failure returns state; success invalidates list and returned detail, then redirects with `event=updated`. Preserve recurrence immutability, DST errors, permission enforcement, and no-JS behavior. |
| A16 | `deleteEventAction` — event detail cancel form | Event organizer; `slugFormSchema`. | `DELETE /events/<encoded slug>` with session; `emptyResponseSchema`. | Redirect-only. Success invalidates list and redirects `event=cancelled`; invalid input/list and API/detail failures use `cancel-failed`. Do not expose backend errors; preserve no-JS operation. |
| A17 | `createTeamAction` — team form | Authenticated verified user; `createTeamFormSchema` over normalized team payload. | `POST /teams` with session; `teamSchema`. | Failure returns state; success invalidates `/teams` and redirects to returned slug with `team=created`. Add currently missing browser and no-JS coverage. |
| A18 | `joinTeamAction` — team detail join form | Authenticated user plus team password; `slugFormSchema` and `passwordFormSchema`. | `POST /teams/<encoded slug>/join`; `teamSchema`. | Failure returns state; success invalidates list/detail and redirects `team=joined`. Preserve password minimization and existing member-view test; add no-JS coverage. |
| A19 | `setTeamCaptainAction` — owner management form | Team owner; `teamCaptainFormSchema`: slug, user ID, captain boolean. | `POST /teams/<encoded slug>/captains`; `teamSchema`. | Redirect-only. Success invalidates detail and redirects `captain-updated`; invalid/API failure redirects `manage-failed`. Preserve owner authorization, tamper rejection, safe logs, and no-JS behavior. |
| A20 | `transferTeamOwnershipAction` — owner management form | Team owner; `teamOwnershipFormSchema`: slug and new owner user ID. | `POST /teams/<encoded slug>/transfer-ownership`; `teamSchema`. | Redirect-only. Success invalidates list/detail and redirects `ownership-transferred`; invalid/API failure redirects `manage-failed`. Preserve Go authorization and add adversarial/no-JS coverage. |
| A21 | `unlockEventAction` — locked-event form | Anonymous allowed; `slugFormSchema` and `passwordFormSchema`. | `POST /events/<encoded slug>/unlock`; `eventUnlockResponseSchema`. | Failure returns state. Success stores an event-specific unlock token in an HTTP-only, root-path, `SameSite=Lax`, production-`Secure` cookie with upstream expiry; invalidates detail and redirects `event=unlocked`. Token must never enter loader data, HTML, logs, or query state. |
| A22 | `rsvpEventAction` — event RSVP form | Authenticated user; `rsvpFormSchema`: slug and yes/no/maybe. Private events also require the server-derived unlock header. | `POST /events/<encoded slug>/rsvp`; `eventSchema`. | Failure returns state; success invalidates list/detail and redirects `rsvp-updated`. Preserve capacity=yes-only behavior, RSVP/interest independence, cookie secrecy, confirmation-email contract, and no-JS submission. |
| A23 | `eventInterestAction` — event detail toggle | Authenticated user; `eventInterestFormSchema`: slug and strict interested boolean. Private events use server-derived unlock header. | `POST` when adding or `DELETE` when removing `/events/<encoded slug>/interest`; `eventSchema`. | Redirect-only. Success invalidates list/detail and redirects added/removed notice; invalid/API failure uses `interest-failed`. Preserve tamper rejection, independence from RSVP, and no-JS toggle. |
| A24 | `deleteAccountAction` — typed destructive form | Session required; `deleteAccountFormSchema` typed confirmation. | `DELETE /me`; `emptyResponseSchema`. | Failure returns state. Success deletes local session cookie, invalidates all session-derived data, and redirects `/?account=deleted`. Gate typed confirmation, session revocation, ownership fallback effects at Go boundary, safe logs, and valid no-JS submission. |

## Migration test gates

| Gate | Required evidence before parity sign-off |
|---|---|
| T0 — inventory | A scripted check derives exactly 23 page URLs, 3 API routes, and 24 mutation entries and compares them with R01–R23, S01–S03, and A01–A24. Generated route tree and server-function registry contain no missing or extra public routes. |
| T1 — HTTP and redirects | Direct requests cover all page/API URLs, unknown paths, all five render-time redirects, every action success/failure redirect, and unsupported API methods. Record actual status and `Location`; missing school/event/team/profile and unknown routes must be true 404s. |
| T2 — head and indexing | Every page asserts title, description, Open Graph, Twitter, and robots policy. Dynamic head uses the same safe loader DTO as the body. Locked private and unlisted events remain `noindex,nofollow`; no new canonical behavior is slipped into parity work. |
| T3 — privacy and caching | Scan HTML, serialized loader payloads, client chunks, and captured logs for session values, unlock tokens, private API URL/secrets, locked-event fields, and submitted secrets/PII. Reset/verify tokens may appear only in the matching form submission state required by R10/R11; assert they are absent from logs, redirects, unrelated loader data, and error output. Assert no shared caching of viewer data and only the documented catalog/API-school cache behavior. |
| T4 — authentication and cookies | Cover signup, login, authenticated SSR/navigation, expired/invalid session, logout fallback deletion, account deletion, and unlock-before/after-login. Assert exact cookie name, value handling, path, expiry/deletion, `HttpOnly`, `Secure`, and `SameSite`. |
| T5 — loaders and boundaries | Exercise success, delayed, empty, upstream 4xx, malformed-success contract, and upstream outage paths. Pending UI must be leaf-scoped; safe error UI must not show raw messages; authenticated profile outages must not silently become anonymous; retry must reload the failed loader. |
| T6 — forms and no JavaScript | Preserve all native validation and accessible field errors/pending states. Every valid mutation has a JavaScript-enhanced and a JavaScript-disabled completion path. GET filters/search/pagination preserve URL state and browser history. No secret or PII is placed in redirect/flash state. |
| T7 — authorization and CSRF | Cross-origin server-function requests fail while legitimate same-origin Cloudflare/Railway requests pass. Call mutation endpoints directly to prove route/form visibility is not the only gate. Re-run visitor-IP spoof/secret tests for rate-limited anonymous and authenticated actions. |
| T8 — invalidation and navigation | After every mutation, active and retained loader data shows the new session/profile/follow/event/team state without a hard-refresh dependency. Display-only notice parameters do not create redundant loader cache keys. Back/forward navigation preserves browse state. |
| T9 — runtime and quality | Existing unit and Playwright suites pass, plus the missing cases below. Run the same suite against the relevant Nitro production paths. Typecheck, lint, production build, bundle/privacy inspection, Docker/Compose, health, accessibility, responsive, and performance gates from doc 18 all pass. |

### Known Phase 0 test gaps

The existing suite is useful but is not full parity evidence. Before cutover add:

- A generated route/action inventory assertion and direct HTTP status coverage
  for every entry in this document.
- Full head/robots assertions, true-404 status checks, unsupported-method
  checks, and locked-event hydration-payload/client-bundle scans.
- Browser and no-JS mutation coverage for forgot/reset password, profile
  update, support ticket, event/user reports, school follow/unfollow, team
  creation, and account deletion.
- No-JS success coverage for all other actions; the current no-JS specification
  covers only the signup school-search select fallback.
- Direct CSRF, safe-return-target, cookie-deletion, cache-isolation, and
  mutation-invalidation tests against the production Start server.
- Explicit browser coverage for home, support, all browse/detail 404 cases,
  private/unlisted robots metadata, editor denial, and API degradation branches.

### Phase 0 baseline evidence — 2026-09-08

All commands below used Node 24.18.0. These are baseline facts, not waived
cutover gates.

| Check | Result |
|---|---|
| Next typecheck and lint | Passed. |
| Next unit suite | Passed: 85 runtime tests. The inventory's 73 count is static declaration sites, so loop-generated cases explain the difference. |
| Next Playwright suite | 33 of 34 cases passed initially. The desktop private-event unlock/login/RSVP Axe assertion briefly observed an empty title; its isolated retry passed. Track this as a nondeterministic timing signal. |
| Next production build | The default Turbopack build could not bind a temporary host port (`EPERM`) in this environment before application compilation. The Webpack production build passed, including typechecking and all 22 static-generation jobs, and reported 27 routes. |
| Compose application coverage | Passed for `api`, `docs`, `web`, and optional `web-start`. |
| Production dependency audit | Failed with four advisories in the baseline tree: critical Next 16.3.0 advisories (fixed by 16.3.4), high sharp and Vite 5 advisories, and a moderate esbuild advisory. The new Start application uses Vite 8.2.2 and esbuild 0.28.2; dependency remediation remains separate work so it is not disguised as a migration benefit. |

## Phase 0 handoff record

The owner completing the baseline should append results to the migration task,
not silently edit expected behavior in this manifest:

```text
Files changed:
  docs/19-tanstack-start-parity-manifest.md

Counts:
  pages=23 api_routes=3 server_actions=24 loading_boundaries=4
  dynamic_metadata_routes=4 next_module_reference_files=29
  unit_test_declaration_sites=73/11_files
  playwright_test_declaration_sites=17/4_files total_declaration_sites=90

Assumptions:
  - Current source and docs 04, 06, 07, and 18 define the baseline.
  - Generated Server Action endpoint URLs are implementation details; form
    behavior, method safety, redirects, status, validation, and privacy are the
    public contract.
  - Exact redirect status/header captures remain a Phase 0 runtime measurement.

Risks:
  - Start loader serialization can reveal data that Next Server Components
    currently consume without returning as a page-level JSON object.
  - Router memory caching does not replace Next cross-request revalidation and
    can retain viewer state unless auth/mutation invalidation is explicit.
  - Ordinary Start SSR hydrates more route/component code than the current RSC
    application; route JavaScript and hydration remain adoption gates.
  - Current browser tests leave several actions, metadata rules, and raw HTTP
    status/privacy paths uncovered.
```

## Phase 1 implementation evidence — 2026-09-09

The reversible slice now lives in `apps/web-start`; `apps/web` remains the
production frontend. The slice contains the shared document/error/not-found
shell, `/`, `/login`, `/events/:slug`, `/api/health`, and
`/api/navigation-session`. Its server functions cover login, logout, private-
event unlock, strict viewer authentication, and RSVP. The Go API remains the
authorization boundary.

All commands below used Node 24.18.0 unless the row says otherwise.

| Check | Result |
|---|---|
| Start typecheck and lint | Passed. |
| Start unit/security suite | Passed: 54 tests. Coverage includes Zod DTO stripping, trusted visitor identity, CSRF configuration, startup environment validation, API errors, cookie mirroring/deletion, locked-event reads, login, logout, unlock, and RSVP. |
| Existing Next application | Typecheck, lint, and all 85 unit tests still pass. |
| Migration inventory and Compose coverage | Passed: 23 Next page routes, 3 API routes, 24 Server Actions, and Docker/Compose coverage for all four applications. |
| Nitro production build | Passed. The browser entry is 275.63 kB raw / 88.94 kB gzip; the shared server-function chunk is 52.08 kB / 16.93 kB gzip; event route chunks total 12.35 kB / 4.26 kB gzip; the login route is 2.61 kB / 1.19 kB gzip; CSS is 2.45 kB / 0.99 kB gzip. These are measurements, not evidence of a speedup. |
| Production HTTP harness | Passed against `.output/server/index.mjs`: healthy API boundary, 405 methods, true 404s, absolute Open Graph URLs, cache policy, navigation session, locked-event redaction, same-origin and rejected cross-origin form posts, native 303 login/unlock/RSVP, cookie and unlock-header forwarding, and safe authenticated `/me` failure. Degraded and unreachable health responses are covered by the unit suite. |
| Production browser harness | Passed in desktop and mobile Chromium: JavaScript-enhanced unlock, login, authenticated SSR reload, RSVP invalidation, and logout with local cookie deletion. |
| Client privacy scan | Passed: no proxy secret, Cloudflare secret, session value, or unlock token marker in `.output/public`. |
| Production launcher | Passed directly: invalid strict configuration exits before Nitro listens, and a valid local configuration honors `PORT`. A read-only-mounted Node 24.20 Alpine container also started the built `.output`, bound port 3310, and returned the expected direct 503 degraded-health response while the API was unavailable. |
| Production Docker image | Blocked by local Docker credential/registry access before the Dockerfile executed (`node:24-alpine` metadata timed out, and the explicit pull stalled in the credential helper). Compose structure is validated, but the image gate is not yet claimed. |

### Phase 1 adoption status

- Passed: missing-event HTTP 404 before a 200 response commits.
- Passed: locked-event title, description, location, address, session value,
  unlock password, and unlock token stay out of HTML, metadata, loader payloads,
  and public client assets.
- Passed: login, authenticated rendering, logout fallback deletion, exact cookie
  forwarding, and root-path/HTTP-only/SameSite/Secure flags.
- Passed: RSVP through both JavaScript-enhanced navigation and a valid native
  no-JavaScript submission.
- Passed: fail-closed same-origin CSRF behavior and trusted Cloudflare/Railway
  visitor identity rebuilding.
- Passed: direct health 200/503 behavior, Nitro production startup, safe route
  errors, loader retry invalidation, and private/no-store viewer responses.
- Measured, decision pending: the route JavaScript/hydration cost above needs
  product acceptance and a representative performance comparison with Next.
- Pending external retry: build and start the production Docker runner after
  Docker registry credentials are available.

No cutover decision has been made. Phase 2 must not begin until the two pending
items are resolved and the Phase 1 adoption decision is recorded explicitly.
