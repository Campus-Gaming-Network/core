# 19 — TanStack Start Phase 0 parity manifest

> **Status: Phase 0 baseline frozen; Phase 1 and Gates 2–4 accepted; Phase 5
> local hardening passed; Railway staging is deferred until the service is
> provisioned.** This manifest records the observable contract of the current
> Next.js application and the evidence for the reversible TanStack Start slice.
> It complements the
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
| R19 | `/events/:slug/edit` — `app/events/[slug]/edit/page.tsx` → `routes/events.$slug_.edit.tsx` | Path `slug`; search `school_q`. | Session required. Viewer-aware event load; missing event 404. Locked or non-editor event returns generic denial UI; Go remains authorization authority. Then games + optional school search. | 200 editor or denial; anonymous temporary redirect to `/login?next=/events/<slug>/edit`; true 404 missing; generic `Edit event`, `noindex,nofollow`, never the event title in head. | Test anonymous, editor, non-editor, locked, missing, recurring-occurrence, school-search, and A15 validation/success cases. |
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
| Start unit/security suite | Passed: 57 tests. Coverage includes Zod DTO stripping, trusted visitor identity, CSRF configuration, startup environment validation, API errors, cookie mirroring/deletion, locked-event reads, bounded accessible field errors, native/enhanced form contracts, login, logout, unlock, and RSVP. |
| Existing Next application | Typecheck, lint, and all 85 unit tests still pass. |
| Migration inventory and Compose coverage | Passed: 23 Next page routes, 3 API routes, 24 Server Actions, and Docker/Compose coverage for all four applications. |
| Nitro production build | Passed. The browser entry is 258.05 kB raw / 82.85 kB gzip; the shared server-function chunk is 69.61 kB / 23.32 kB gzip; the shared enhanced-mutation and JSX-runtime chunks total 1.76 kB / 1.03 kB gzip; event route chunks total 12.23 kB / 4.35 kB gzip; the login route is 2.75 kB / 1.20 kB gzip; CSS is 2.45 kB / 0.99 kB gzip. These are measurements, not evidence of a speedup. |
| Production HTTP harness | Passed against `.output/server/index.mjs`: healthy API boundary, 405 methods, true 404s, absolute Open Graph URLs, cache policy, navigation session, locked-event redaction, same-origin and rejected cross-origin form posts, native 303 login/unlock/RSVP/logout, cookie deletion and forwarding, unlock-header forwarding, and safe authenticated `/me` failure. Degraded and unreachable health responses are covered by the unit suite. |
| Production browser harness | Passed in desktop and mobile Chromium: JavaScript-enhanced unlock, login, authenticated SSR reload, RSVP invalidation, and logout with local cookie deletion. |
| Client privacy scan | Passed: no proxy secret, Cloudflare secret, session value, or unlock token marker in `.output/public`. |
| Production launcher | Passed directly: invalid strict configuration exits before Nitro listens, and a valid local configuration honors `PORT`. A read-only-mounted Node 24.20 Alpine container also started the built `.output`, bound port 3310, and returned the expected direct 503 degraded-health response while the API was unavailable. |
| Production Docker image | Passed on retry. The `runner` target built from `node:24-alpine`, started from the copied `.output` as the non-root `node` user (UID/GID 1000), honored the configured container port, reached Docker `healthy`, and returned the exact direct 200 web/API health envelope against an isolated fake API. A separate unavailable-API probe returned the expected 503 degraded-health response. The temporary containers and network were removed after validation. |
| Representative production performance harness | Measured with `scripts/tanstack_start_performance.mjs`; results and comparability limits follow. This evidence does not establish a speedup. |

### Representative event-route performance evidence

The deterministic harness starts both production servers on loopback against
one fake API with a fixed 8 ms response delay. It measures anonymous public and
locked-private event documents after five warmups, alternates framework order
for 20 samples, and opens each state in a fresh Chromium context to inventory
the JavaScript actually requested through `networkidle`. Every timed request
made exactly one upstream event read and no `/me` read.

| Route state and production artifact | TTFB ms median / p95 | Full response ms median / p95 | HTML bytes raw / offline gzip | Inline script bytes raw / offline gzip | Browser-loaded JS resources; raw / offline gzip |
|---|---:|---:|---:|---:|---:|
| Public — Next 16.3.0, webpack | 21.73 / 27.59 | 22.19 / 27.88 | 16,906 / 3,387 | 11,550 / 2,375 | 16; 733,541 / 223,958 |
| Public — Start 1.168.50 | 18.20 / 31.69 | 18.62 / 31.83 | 6,147 / 2,304 | 2,627 / 1,333 | 6; 341,675 / 110,467 |
| Locked — Next 16.3.0, webpack | 19.25 / 24.71 | 19.63 / 24.83 | 13,688 / 3,188 | 9,025 / 2,032 | 17; 739,701 / 226,240 |
| Locked — Start 1.168.50 | 15.69 / 17.18 | 15.88 / 17.68 | 4,864 / 1,984 | 1,898 / 995 | 6; 341,675 / 110,467 |

Reproduction used Node 24.18.0:

```sh
(cd apps/web && node ../../node_modules/next/dist/bin/next build --webpack)
npm run build:web-start
NEXT_BUILD_BUNDLER=webpack npm run performance:web-start
```

These numbers are acceptance evidence for the current artifacts, not an
apples-to-apples framework verdict. The Start slice does not yet implement the
full Next event UI, and the browser total includes implementation choices such
as Next `Link` prefetching versus Start's current plain anchors. The Next bytes
are webpack-specific: the repository's default Turbopack rebuild could not run
in this sandbox because its CSS worker was denied permission to bind a local
port. Offline gzip is calculated per document or JavaScript resource and is not
an observed CDN transfer size. Loopback timings are noisy—the public Start p95
was higher even though its median was lower—so they do not support a latency
claim.

Pure hydration CPU remains not comparable. Next hydrates a client boundary
around an RSC payload, while the Start slice hydrates its route and serialized
loader data, and neither application exposes the same hydration-complete mark.
DOMContentLoaded, load, or first-paint timings would mix network, rendering,
prefetching, and different UI work and are therefore not labeled “hydration.”

### Phase 1 adoption status

- Passed: missing-event HTTP 404 before a 200 response commits.
- Passed: locked-event title, description, location, address, session value,
  unlock password, and unlock token stay out of HTML, metadata, loader payloads,
  and public client assets.
- Passed: login and authenticated rendering; the shared enhanced-mutation path
  for login, unlock, and RSVP; bounded field-level errors wired to controls with
  `aria-invalid` and `aria-describedby`; enhanced logout plus native logout 303;
  fallback deletion; exact cookie forwarding; and root-path/HTTP-only/SameSite/
  Secure flags.
- Passed: RSVP through both JavaScript-enhanced navigation and a valid native
  no-JavaScript submission.
- Passed: fail-closed same-origin CSRF behavior and trusted Cloudflare/Railway
  visitor identity rebuilding.
- Passed: direct health 200/503 behavior, Nitro production startup, safe route
  errors, loader retry invalidation, and private/no-store viewer responses.
- Passed for Phase 1 adoption: the representative comparison above establishes
  a 110,467-byte offline-gzip Start JavaScript baseline without an obvious
  payload regression. It does not establish a framework speedup. Full event-UI
  parity must be remeasured before cutover, and pure hydration CPU remains
  explicitly unclaimed.
- Passed: the production Docker runner builds, starts as a non-root user from
  `.output`, honors its configured port, and serves direct health responses.

**Adoption decision — 2026-09-09:** accept TanStack Start as the Phase 2 parity
target. The security boundary, progressive enhancement, production runtime,
Docker image, focused browser flows, and provisional payload budget are strong
enough to continue the migration. This is not a production-cutover decision;
the current Next application remains runnable and authoritative while parity is
built. Repeat the representative measurement after full event-route UI parity
and set the final JavaScript and hydration budgets before cutover.

## Phase 2 integration-foundation evidence — 2026-09-09

This foundation step adds no domain route. `DefaultPending`, `DefaultError`, and
`DefaultNotFound` are installed as router-wide defaults and explicitly on the
root route so the existing document shell remains authoritative. The event
route reuses the shared pending and retryable error views while retaining its
event-specific copy. Error UI never renders the caught error or upstream
message, retry still invalidates loader data before resetting the boundary, and
the not-found view retains its `noindex,nofollow` head.

Registered Start destinations use typed router links: both event login paths
now target `/login` with validated search state, and the known root navigation
uses a typed destination. API URLs and not-yet-migrated application URLs remain
ordinary document links; this avoids pretending that Phase 2 has registered
routes which do not yet exist. The generated route tree remains unchanged at
five URLs: `/`, `/login`, `/api/health`, `/api/navigation-session`, and
`/events/$slug`.

The server boundary is now layered explicitly. `api.server.ts` owns only
framework-neutral HTTP, JSON, typed error, and Zod response mechanics;
`bff.server.ts` adapts that client to the Go trust boundary and rebuilds trusted
visitor identity after stripping browser-provided internal headers;
`viewer.server.ts` owns the validated profile DTO and strict optional/required
viewer semantics; and `request-boundary.server.ts` is the sole adapter for
TanStack request headers, configured cookies, unlock headers, cookie mutations,
native-form detection, and response cache policy. Focused architecture tests
enforce that separation. Viewer, session, and event responses remain private or
viewer-aware, and no cross-request Start cache has been introduced. The
five-minute catalog `staleTime` policy remains explicit work for the first
catalog route rather than an unused cache abstraction.

Correlation IDs and new structured logging remain deferred until the Go API
defines a cross-service correlation-header contract. A web-only identifier
would not correlate across the authorization boundary. Existing diagnostics
remain limited to generic messages and response-contract metadata and do not
include cookies, credentials, submitted values, session tokens, or unlock
tokens.

CI now owns the production-container gate through
`scripts/tanstack_start_docker_gate.mjs`. It builds the `runner` target without
publishing it, starts it with networking disabled, verifies the exact direct
503 degraded-health envelope, confirms the configured `node` user and runtime
UID/GID 1000, applies bounded timeouts, and removes its exact temporary
container and image on success, failure, or termination.

All commands used Node 24.18.0:

```sh
npm --prefix apps/web-start run typecheck
npm --prefix apps/web-start run lint
npm --prefix apps/web-start run test
npm run build:web-start
npm run smoke:web-start
npm --prefix apps/web-start run test:e2e
node scripts/tanstack_start_docker_gate.mjs
```

Typecheck, lint, the Nitro production build, and all 64 unit/security tests
passed. The two new convention tests cover shared defaults, accessible pending
state, privacy-safe retry behavior, not-found metadata, typed registered-route
links, and the unchanged generated route inventory. The production smoke also
passed, including unknown-route and missing-event HTTP 404 responses, the safe
authenticated viewer-error path, the existing root cache/head shell, and the
Phase 1 form/security contracts. Both Chromium projects and the local
production-container gate passed as well.

**Gate 2 status: passed.** The shared shell and boundaries, server layering,
error policy, unchanged generated route tree, focused platform tests,
production build, browser flows, HTTP smoke, and Docker startup gate are green.
Domain read-route work may begin while the current Next application remains the
production and rollback path.

## Phase 3 read-route wave 1 evidence — 2026-09-10

The first read-route wave ports the full home presentation and independent
school/game fallbacks; school browse and detail; the school search API; public
user profiles; and the about, FAQ, privacy, terms, and support pages. Together
with the Phase 1 routes, the generated router now exposes 11 of 23 page URL
patterns and all 3 server-route URL patterns. The current Next application
remains authoritative for every route and mutation that has not reached parity.

Public catalog operations validate a strict DTO allowlist and make uncached
private-network reads. The home and school-browse routes apply a five-minute
client router `staleTime`; this does not claim or introduce a cross-request
Start-server cache. School and game reads on the home route fail independently.
School search normalization is tolerant, pagination state stays in the URL,
and the `/api/schools` route preserves the 2–120 character query contract,
1–50 limit clamping, `private, max-age=60` success cache header, safe 4xx/503
mapping, bodyless HEAD response, and `Allow: GET, HEAD` method boundary.

School detail and public-profile metadata come from the same validated loader
DTO as the body and preserve true upstream 404s. School viewer state serializes
only the authenticated/home/follow booleans and is always `private, no-store`;
anonymous school requests skip `/me`. Public profiles serialize only public
fields plus an `anonymous`, `self`, or `other` relationship. They never
serialize the viewer profile, email, session data, unlock data, or trusted
headers; only an upstream `/me` 401 becomes anonymous, while outages and
contract failures remain safe errors. Avatar, social, and school website links
allow only HTTP(S) URLs.

The static routes remain indexable and do not initiate anonymous `/me` calls.
FAQ disclosures use native accessible `details`/`summary` elements. Three
mutation gaps are deliberately visible rather than represented by broken
controls: support-ticket submission, public-profile reporting, and school
follow/unfollow remain on the Next frontend until their Phase 4 server
functions and both enhanced and no-JavaScript paths are migrated.

All commands below used Node 24.18.0. The complete integrated results are:

| Check | Result |
|---|---|
| Typecheck and lint | Passed after the single generated route-tree build. |
| Unit/security/HTTP suite | Passed: 92 tests. This includes the real-loopback school API contract test. |
| Nitro production build | Passed. The main browser entry is 349.13 kB raw / 108.27 kB gzip; CSS is 3.72 kB / 1.28 kB gzip. Route chunks are independently emitted for the static, school, and public-profile pages. |
| Production HTTP harness | Passed. It now covers the home catalog shell, school browse/detail, public-profile dynamic metadata and privacy, true school/profile 404s, and the school API contract in addition to the Phase 1 auth/event/security cases. |
| Production browser harness | Passed: 12 Chromium cases across desktop and mobile. The five static pages assert SSR metadata, public cache behavior, accessible content, and no anonymous `/me` traffic; the existing enhanced auth/unlock/RSVP/logout flow remains green. |
| Client privacy scan | Passed: no configured proxy/API environment names or smoke session, unlock, proxy, or Cloudflare secret values appeared in `.output/public`. |
| Compose and Docker | Compose coverage passed for all four applications. A fresh production runner built, started with networking disabled as UID/GID 1000, and returned the exact degraded-health 503; its temporary container and image were removed. |
| Representative performance rerun | Measured after route-graph expansion. The Start event page now loads 11 JavaScript resources totaling 432,717 raw / 136,642 offline-gzip bytes, up 26.6% raw and 23.7% gzip from the Phase 1 Start baseline. It remains below the current webpack Next artifact in this limited comparison, but is not full UI parity and does not establish a speedup. |

The performance rerun retained the fixed 8 ms upstream delay, five warmups, 20
alternating samples, one event read per sample, and zero anonymous `/me` reads.
Public Start TTFB was 18.28 ms median / 31.48 ms p95; locked Start TTFB was
15.49 / 18.46 ms. The corresponding current webpack Next measurements were
20.60 / 27.82 ms and 19.05 / 21.71 ms. These loopback numbers remain noisy and
are diagnostic only.

**Phase 3 wave 1 status: accepted for continued migration. Gate 3 is not
passed.** Twelve page URL patterns and the remaining read, auth, private-screen,
and mutation contracts still need parity evidence before cutover.

## Phase 3 read-route wave 2 evidence — 2026-09-10

The second read-route wave adds the public `/events` browse route and the
`/teams` browse and `/teams/:slug` detail routes. The generated Start router now
exposes 14 of 23 page URL patterns and all 3 server-route URL patterns. Nine
page patterns remain: signup, forgot/reset/verify-email compatibility flows,
account, event create/edit, and team create. Gate 3 remains open until those
routes and their applicable auth, mutation, privacy, and browser contracts pass.

Event browse validates bounded game, school, format, and opaque cursor search
state while keeping display notices out of loader dependencies. Event and game
reads use public allowlisted DTOs and fail independently to empty results. The
anonymous SSR response is `public, max-age=0, must-revalidate` with
`Vary: Cookie`; a production-smoke assertion caught and removed an inherited
private cache override that was inconsistent with that public-only payload.
Event detail now includes its banner, recurrence, organizer, location, payment,
and lifecycle presentation while retaining locked-event redaction, true 404s,
safe outbound HTTP(S) links, unlock, and RSVP behavior.

Team browse validates bounded game/school filters and opaque cursors, performs
independent team/game reads, and serializes only the public team allowlist.
Team detail uses one safe DTO for dynamic metadata and the body, preserves true
upstream 404s, strips owner IDs and member/account additions, and adds only the
minimal optional viewer role. Anonymous detail rendering does not call `/me`;
responses vary on the configured session cookie and become private only when
viewer state is present. All newly registered event and team destinations use
typed router links.

Unavailable mutations remain explicit instead of linking to nonexistent Start
routes. Event creation (A14), edit (A15), cancellation (A16), reporting (A10),
and interest (A23) remain Phase 4 work. Team creation, join, captain management,
and ownership transfer (A17–A20) also remain Phase 4 work, including the owner
roster UI needed for management.

All commands below used Node 24.18.0. The complete integrated results are:

| Check | Result |
|---|---|
| Typecheck, lint, and generated route tree | Passed. The Nitro build regenerated the tree; it was not hand-edited. |
| Unit/security/HTTP suite | Passed: 108 tests, including real-loopback school API coverage and the new event/team operation, DTO, search, metadata, viewer, 404, cache, and route-convention cases. |
| Nitro production build | Passed. The main browser entry is 279.56 kB raw / 88.69 kB gzip; route chunks are independently emitted for event and team browse/detail. |
| Production HTTP harness | Passed. It now checks filtered event and team browse SSR, normalized upstream queries, public cache headers, no anonymous `/me`, safe public DTO stripping, dynamic team metadata, and true team 404s in addition to all earlier home/school/profile/API/auth/private-event cases. |
| Production browser harness | Passed: the existing 12 Chromium cases across desktop and mobile remain green. The production HTTP harness, not this browser count, currently owns the new event/team browse/detail assertions. |
| Client privacy scan | Passed: no configured proxy/API environment names or smoke session, unlock, proxy, or Cloudflare secret values appeared in `.output/public`. |
| Compose and Docker | Compose coverage passed for all four applications. A fresh production runner built, started as UID/GID 1000, passed its isolated health probe, and returned the exact degraded-health 503 without API networking. Temporary Docker resources were removed. |
| Representative performance rerun | Measured after the Wave 2 route graph. The Start event page loads 14 JavaScript resources totaling 445,092 raw / 140,021 offline-gzip bytes: +2.9% raw / +2.5% gzip from Wave 1 and +30.3% / +26.8% from the Phase 1 baseline. It remains below the current webpack Next artifact in this limited comparison, but full parity is not complete and no framework speedup is claimed. |

The performance rerun retained the fixed 8 ms upstream delay, five warmups, 20
alternating samples, one event read per sample, and zero anonymous `/me` reads.
Public Start TTFB was 18.85 ms median / 34.92 ms p95; locked Start TTFB was
15.99 / 17.71 ms. The corresponding current webpack Next measurements were
20.82 / 29.37 ms and 19.37 / 25.96 ms. Loopback timing remains noisy, and the
Start route still does not have full mutation/private-screen parity, so these
numbers are diagnostic adoption evidence rather than a latency conclusion.

**Phase 3 wave 2 status: accepted for continued migration. Gate 3 is not
passed.** Nine page URL patterns and the remaining auth, private-screen,
mutation, full-browser, and deployment-rehearsal contracts still need parity
evidence before cutover.

## Phase 4 auth, private-screen, and mutation evidence — 2026-09-11

The Start router now registers all 23 page URL patterns and all 3 server-route
patterns in the frozen inventory. All 24 mutations A01–A24 have Start server
functions, validated enhanced submissions, and native POST completion paths.
The Next application remains the production authority and rollback path; this
closes the route and mutation port, not the migration or cutover.

The final route wave adds signup, forgot-password, both reset-password URLs,
email verification, account, event creation/editing, and team creation. Auth
tokens stay confined to their private no-store form pages and are never placed
in a redirect result. Private account and editor routes redirect anonymous
visitors with bounded local return targets, use generic denial/error heads, and
serialize only the DTOs required by their screens. The event edit route uses
`events.$slug_.edit.tsx`; the trailing underscore prevents it from being
nested beneath the detail component while preserving `/events/:slug/edit`.

Mutations are split by domain and re-validate browser input before calling Go.
Request cookies, trusted visitor identity, proxy credentials, unlock headers,
and response-cookie changes are derived only inside the server boundary. API
success payloads pass strict Zod DTO allowlists; expected failures return or
redirect with fixed user-safe messages. The shared native-form check excludes
TanStack's enhanced `x-tsr-serverfn` multipart requests. This distinction was
verified directly because treating every multipart request as native caused
enhanced form calls to receive redirects instead of typed results.

All valid mutation paths were exercised with browser JavaScript disabled:
signup; login/logout; forgot/reset/resend/verify; profile update and account
deletion; support and event/user reporting; school follow/unfollow; event
create/update/cancel/unlock/RSVP/interest; and team create/join/captain/owner
transfer. Native event reporting now returns to the bounded event URL with
`report-submitted` or `report-failed`, so it never strands a no-JavaScript
visitor on a serialized server-function response. Native validation attributes
remain present, while enhanced forms retain pending state and accessible field
errors.

All commands used Node 24.18.0. The integrated results are:

| Check | Result |
|---|---|
| Inventory, typecheck, and lint | Passed. The frozen Next inventory remains 23 pages, 3 server routes, and 24 mutations; the generated Start tree and focused route-convention tests cover every migrated pattern. |
| Unit/security/HTTP suite | Passed: 167 tests, including real-loopback school API coverage, strict input/output contracts, auth/cookie boundaries, CSRF, safe redirects, cache policy, DTO privacy, and all domain operations. |
| Nitro production build | Passed. The main browser entry is 301.31 kB raw / 94.79 kB offline-gzip; the main CSS asset is 3.72 kB / 1.28 kB. Route chunks remain independently emitted. |
| Production HTTP harness | Passed. It covers all route waves plus auth/write-page metadata, private token-page cache policy, legacy reset compatibility, anonymous private-route redirects, true 404s, CSRF, and native login/unlock/RSVP/logout. |
| Development browser harness | Passed: 24 Chromium cases across desktop, mobile, and a JavaScript-disabled project. Development correctly uses a non-secure local unlock cookie; the mirrored API session retains its upstream Secure attribute. |
| Production browser harness | Passed: 24 Chromium cases across desktop, mobile, and a JavaScript-disabled project. Enhanced journeys cover all mutation domains, and four grouped no-JavaScript journeys cover A01–A24. |
| Client privacy scan | Passed: no configured internal environment names or smoke session, unlock, proxy, or Cloudflare secret markers appeared in `.output/public`. |
| Compose and Docker | Compose coverage passed for `api`, `docs`, `web`, and `web-start`. The production runner built, became healthy as UID/GID 1000, and returned the expected API-unavailable 503 in the isolated runtime gate. |
| Representative performance rerun | Controlled loopback measurement passed. Public Start TTFB was 18.25 ms median / 21.72 ms p95 with 14 loaded JavaScript resources totaling 469,823 raw / 146,659 offline-gzip bytes; locked Start was 15.24 / 16.87 ms with the same JavaScript total. The corresponding webpack Next measurements were 20.23 / 27.72 ms and 18.60 / 28.15 ms, with 16–17 resources totaling 733,541–739,701 raw / 223,958–226,240 gzip bytes. These diagnostic numbers do not establish a production speedup. |

**Gate 3 status: passed. Gate 4 status: passed.** Every frozen page pattern,
server route, and mutation now has a Start implementation and integrated
development/production evidence. Phase 5 must still close the remaining
cutover matrix: adversarial security and authorization review, exhaustive
status/head/cache coverage, accessibility and responsive sweeps, staging and
Railway rehearsal, observability, final performance-budget acceptance, and a
documented rollback drill. Next.js removal belongs only after those gates and
the production soak; no cutover decision is made here.

## Phase 5 local hardening evidence — 2026-09-12

The local cutover candidate now has a Railway service configuration at
`railway/web-start.toml`. It builds `apps/web-start/Dockerfile`, starts the same
`src/production-preflight.ts` entry used by the container, probes
`/api/health`, and uses the production restart policy. This preserves parity
with the repository's existing Railway Config-as-Code services, but Railway
now deprecates that format and does not allow new services to opt into it. The
staging rehearsal must either reuse an existing legacy-configured staging
service or import the project into `.railway/railway.ts` Infrastructure as Code
before the 2026-12-01 cutoff. This is configuration parity, not evidence of an
actual Railway deployment; staging still has to prove private Go networking,
injected secrets and `PORT`, the direct Railway fallback identity path, and the
Cloudflare origin-secret path.

The browser gate now runs the same suite against both the Vite development
server and the built Nitro production process. It includes desktop, mobile,
and JavaScript-disabled projects. Keyboard coverage verifies a visible-on-focus
skip link and moves focus to the main content after client-side route changes.
Representative public and authenticated pages pass automated WCAG 2 A/AA
checks and assert one main landmark, one primary heading, no horizontal
viewport overflow, and no uncaught browser errors. The accessibility sweep
caught and replaced an invalid custom school-search listbox with a native
search-and-select pattern. All valid mutations A01–A24 remain covered with
JavaScript disabled.

Metadata coverage now checks title, description, Open Graph, Twitter, robots,
absolute public URL, and cache policy across every public/static, auth-token,
catalog, and dynamic-detail class. Authenticated account, event-create,
event-edit, and team-create pages are included in the private/no-store matrix.
The production HTTP harness verifies authenticated write-page SSR and expands
all three public API routes to cover `GET`, bodyless `HEAD`, and every
unsupported method with the documented `Allow` boundary. It also scans process
logs for submitted credentials, PII, session/unlock values, and deployment
secrets. The runtime applies a shared security-header policy to HTML, redirect,
error, API, and rejected-CSRF responses. Token routes and the legacy reset
redirect use `Referrer-Policy: no-referrer`; HSTS is emitted only for a
production HTTPS origin. Root SSR remains viewer-neutral even when a session
cookie is present, while navigation decoration is loaded separately through
the private no-store session endpoint.

CI now scans the complete `.output/public` tree for server environment names,
test secrets, session/unlock values, and private markers after every production
build. The same check rejects Next imports, `.next`, `"use server"`, and
`NEXT_PUBLIC_SITE_URL` within the Start application boundary. CI also runs a
production-only, high-severity dependency audit after the clean install. The
privacy scan covered 52 emitted public files in this build.

All local commands used Node 24.18.0. The integrated results are:

| Check | Result |
|---|---|
| Inventory, typecheck, lint, and whitespace | Passed. The Start route tree still covers 23 page patterns and 3 API routes; the mutation inventory remains A01–A24. |
| Unit and security suite | Passed: 173 tests. |
| Nitro production build | Passed. The main browser entry is 302.66 kB raw / 95.36 kB offline-gzip; the main CSS asset is 3.97 kB / 1.38 kB. |
| Development browser harness | Passed: 121 Chromium cases across desktop, mobile, and JavaScript-disabled projects. |
| Production browser harness | Passed: the same 121 Chromium cases against the built Nitro server. |
| Production HTTP and privacy harnesses | Passed. The HTTP harness covers the complete route waves, authenticated writer pages, API `HEAD`/405 boundaries, CSRF/native forms, cookie and identity handling, private-event redaction, and log secrecy. The static scan found no server marker in 52 public files and no Next boundary in Start source. |
| Compose and Docker | Passed. Compose covers all four applications. A fresh runner image built from the current source, started as UID/GID 1000, honored the runtime contract, and returned the exact API-unavailable 503 from its isolated health probe. |
| Representative performance rerun | Passed as a diagnostic comparison. Public Start TTFB was 17.87 ms median / 28.32 ms p95; locked Start was 17.12 / 23.88 ms. Both states loaded 14 JavaScript resources totaling 472,006 raw / 147,417 offline-gzip bytes. The corresponding webpack Next results were 20.54 / 28.35 ms and 20.57 / 58.21 ms with 733,541–739,701 raw / 223,958–226,240 gzip bytes. Loopback results do not establish a production speedup. |

The container install still reports one high and one moderate advisory in the
build tree. The older Vite 5/esbuild lineage is marked development-optional in
the lockfile; the Start application itself builds with Vite 8.2.2 and esbuild
0.28.2, and the minimal runtime image copies only `.output`. A cached offline
production-only audit reports zero advisories, but that does not substitute for
checking the current registry advisory database. A fresh online
production-only audit and any required dependency remediation remain required
before cutover.

Two local behavior decisions remain recorded for the cutover review. Valid
no-JavaScript submissions pass for A01–A24, but invalid or upstream-failed
native submissions use bounded redirect notices instead of retaining every
field value and exact enhanced `FormState`. Field schemas are bounded, while a
global request-body limit still belongs at the hosting/edge boundary. Neither
is being counted as completed parity evidence.

**Phase 5 local status: passed; Gate 5 remains open.** Local build, startup,
health, container, route, metadata, cache, privacy, accessibility, responsive,
no-JavaScript, and performance evidence are green. The remaining work requires
external deployment authority or an operational environment. Railway staging
is intentionally deferred until that service is provisioned; then deploy the
exact candidate, exercise it against the real Go/Postgres stack through both
direct Railway and Cloudflare paths, validate observability and secret-safe
logs during a soak/restart, rehearse rollback, and close the production
dependency audit. The current Next deployment remains authoritative until
those checks are complete and accepted.
