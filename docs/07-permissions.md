# 07 — Permissions

Authorization rules for the public site and the Admin Console. Enforce in **Go** on every mutating API; the BFF must not be the only gate.

## Roles overview

| Role                   | How granted                                                         | Scope                                                                                                                                        |
| ---------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Anonymous**          | —                                                                   | Search/browse schools; view school clubs; browse public events/tournaments by game; unlock private event with password; no account mutations |
| **Basic user**         | Email registration + clicked verification link + 18+ confirmation   | Create events/teams (no event approval); RSVP; favorite events; follow schools; join clubs; claim or request clubs; report                   |
| **Verified student**   | `.edu` email                                                        | Same as basic + verified-student trust badge                                                                                                 |
| **Staff / faculty**    | Site admin grant                                                    | Same as verified + faculty context; **visible faculty indicator**                                                                            |
| **Alumni**             | Affiliation / graduation                                            | Can participate (not locked out after grad)                                                                                                  |
| **School admin**       | School-scoped grant; site admins manage grants in the Admin Console | Edit school; **edit clubs at their school**; assign school teams; organizer badge; **visible admin indicator**                               |
| **Club owner**         | Approved claim, or ownership transfer                               | Edit club; invite/remove editors; remove members; transfer ownership; manage events the club hosts                                           |
| **Club editor**        | Owner invites                                                       | Edit club; remove members; manage events the club hosts                                                                                      |
| **Club member**        | Joins (signed in, verified email)                                   | Listed on the club member list; may leave                                                                                                    |
| **Team owner**         | Creator or transfer                                                 | Manage team; transfer ownership; assign captains                                                                                             |
| **Team captain**       | Owner assigns                                                       | Register team for tournaments; limited team mgmt                                                                                             |
| **Event organizer**    | Creator, or co-organizer by accepted invite                         | Edit event (past-event limits planned); the creator alone cancels it and manages co-organizers                                               |
| **Approved organizer** | Explicit grant                                                      | Badge-eligible events                                                                                                                        |
| **Site admin**         | Bootstrap, then Admin Console                                       | Schools; games; reports; support tickets; staff grants; impersonation and feature flags later                                                |

A user may hold **multiple** roles (e.g. school admin at two schools, member of many teams).

## Verification levels

```text
signed up → email verified (link) → verified student (.edu) → staff_faculty (site admin grant)
```

- Inbox verification (click link) is required for normal authenticated use.
- `.edu` is an additional trust tier, not a substitute for clicking the verification email. The normalized domain must end exactly in `.edu`; valid subdomains qualify, while lookalikes such as `school.edu.com` do not.
- The verified-student badge is a limited inbox-domain trust signal. It does not prove enrollment, current school affiliation, or identity.
- Signup must include an **18+** confirmation checkbox (store timestamp).

Verification is not a substitute for school admin or site admin.

## Role indicators (UI)

| Role              | Indicator                                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Site admin        | Navy "Site admin" tag with a shield, first on the public profile; also named in people lists and organizer UI (`site_admin`, from an active site-admin grant) |
| School admin      | Visible badge/label on profile and event organizer UI for the granted school                                                                                  |
| Staff / faculty   | Visible badge/label on profile and event organizer UI                                                                                                         |
| Verified (`.edu`) | Optional trust mark (lighter than admin/faculty)                                                                                                              |

## Permission matrix (summary)

| Action                                   | Anonymous | Basic+          | School admin | Club owner/editor | Team owner | Event organizer | Site admin        |
| ---------------------------------------- | --------- | --------------- | ------------ | ----------------- | ---------- | --------------- | ----------------- |
| Search/browse schools                    | ✓         | ✓               | ✓            | ✓                 | ✓          | ✓               | ✓                 |
| View school clubs                        | ✓         | ✓               | ✓            | ✓                 | ✓          | ✓               | ✓                 |
| Browse public events/tournaments by game | ✓         | ✓               | ✓            | ✓                 | ✓          | ✓               | ✓                 |
| Create event                             |           | ✓ (no approval) | ✓            | ✓                 | ✓          | ✓               | ✓                 |
| Badge on created event                   |           |                 | ✓            | later             |            | if approved     | ✓                 |
| Unlock private event (password modal)    | ✓*        | ✓               | ✓            | ✓                 | ✓          | ✓               | ✓                 |
| Mark event interested (favorite)         |           | ✓               | ✓            | ✓                 | ✓          | ✓               | ✓                 |
| List games on own profile                |           | ✓               | ✓            | ✓                 | ✓          | ✓               | ✓                 |
| Create team                              |           | ✓               | ✓            | ✓                 | ✓          | ✓               | ✓                 |
| View team page                           | ✓         | ✓               | ✓            | ✓                 | ✓          | ✓               | ✓                 |
| View people lists (signed in)            |           | ✓               | ✓            | ✓                 | ✓          | ✓               | ✓                 |
| Join / interact with team                |           | password        |              |                   |            |                 |                   |
| Transfer team ownership                  |           |                 |              |                   | ✓          |                 | ✓ (break-glass)   |
| Join / leave club                        |           | ✓               | ✓            | ✓                 | ✓          | ✓               | ✓                 |
| Claim or request club                    |           | ✓               | ✓            | ✓                 | ✓          | ✓               | ✓                 |
| Review club claims and requests          |           |                 |              |                   |            |                 | ✓ (Admin Console) |
| Create unclaimed club; hide club         |           |                 |              |                   |            |                 | ✓ (Admin Console) |
| Edit club profile                        |           |                 | own school   | ✓                 |            |                 | ✓                 |
| Remove club member                       |           |                 |              | ✓                 |            |                 | ✓                 |
| Manage club editors; transfer ownership  |           |                 |              | owner only        |            |                 | ✓                 |
| Host event as club                       |           |                 |              | ✓                 |            |                 |                   |
| Assign team to club                      |           |                 |              |                   |            |                 | later             |
| Edit school details                      |           |                 | ✓            |                   |            |                 | ✓                 |
| Create/edit/delete school                |           |                 |              |                   |            |                 | ✓ (Admin Console) |
| Edit games                               |           |                 |              |                   |            |                 | ✓ (Admin Console) |
| Remove other school admin                |           |                 | ✗            |                   |            |                 | ✓ only            |
| Edit past event date/location            |           | ✗               | ✗            | ✗                 | ✗          | ✗               | break-glass TBD   |
| Minor edit past event                    |           |                 |              |                   |            | ✓               | ✓                 |
| Soft-delete event                        |           |                 |              |                   |            | creator only    | ✓                 |
| View all reports                         |           |                 |              |                   |            |                 | ✓                 |
| Impersonate user                         |           |                 |              |                   |            |                 | ✓                 |
| Manage feature flags                     |           |                 |              |                   |            |                 | ✓ (later)         |
| Sync IGDB / manage games                 |           |                 |              |                   |            |                 | ✓ / cron          |

The two past-event rows are the intended rule; neither is enforced yet, so organizers can currently edit every field of an ended event.

\* Anonymous may open a private event link and submit the password via modal; pre-unlock responses must not leak event details. Still no account mutations without login where required (e.g. RSVP). Anyone (including anonymous) may submit a support ticket.

## People list rules

- Event attendee, school member, and team member lists are for **signed-in**
  viewers only. A signed-out request gets `401`; there is no anonymous list, even
  for public events and public team pages
- An event's list follows the event page: public and unlisted events are open to
  any signed-in viewer; a private event is open only to an organizer or a viewer
  who unlocked it. Anyone else gets `404`, the same as for a missing or
  cancelled event, so the response does not reveal that the event exists
- A person who turns off `show_in_lists` is omitted from all three lists. Deleted,
  suspended, and email-unverified accounts are never listed
- The owner-only roster in the team detail, used to assign captains, is not a
  people list. It is not filtered by `show_in_lists`
- List responses are never cached (`Cache-Control: private, no-store`)

## School admin rules

- A school may have **multiple** admins
- A user may be admin of **multiple** schools
- School admins **cannot remove** other school admins (site admin can)
- School admins can edit school details and the **clubs at their school**, and assign school / sponsored teams. They do not review club claims
- Only site admins **create** schools, via the Admin Console

## Team rules

- Anyone authenticated (email-verified) can create a team
- Team pages are **public**; password required only to **join / interact** (no invite-link tokens yet)
- Owner can transfer ownership
- Members and captains can leave a team; the owner must transfer ownership
  first. Only the owner can remove another member. Leaving or removal clears
  any captain role, and the person may rejoin with the team password
- Captains can be assigned; captains register teams for team tournaments
- User may create and belong to many teams
- Assigning a team to a **club** (Varsity, JV, etc.) is later

## Event rules

- Anyone authenticated (email-verified) can create an event — **no approval required**
- The creator invites co-organizers by email; an invite is accepted by signing in
  with that address. Co-organizers edit the event and may step down. Only the
  creator cancels the event, manages invites and co-organizers, and hands the
  creator role to a co-organizer (see [04 — API](./04-api.md#co-organizers))
- Event pages show organizer names and school-admin/staff-faculty role indicators
  when applicable
- An organizer may host an event as a team only if they own or captain that
  team when they choose it. The event keeps the team if they later leave it or
  stop being a captain; the team's other owners and captains do not gain the
  right to edit the event
- Visibility: **public** · **unlisted** · **private** (password modal; content gated/blurred until unlock)
- Optional **capacity**; counts RSVP **yes** only; when full, block new yes — **no waitlist** yet
- RSVP: yes/no/maybe; **interested** is a separate favorite
- The **online meeting link** (`online_url`) goes only to viewers whose RSVP is
  **yes** and to the event's organizers. The API leaves it out of every other
  response: public lists, a visitor's or a maybe/no viewer's event page, and
  the interest, RSVP, and unlock responses unless the requester is going or
  organizes the event. The RSVP confirmation email (sent on yes) includes it.
- Registration closes automatically; ended or full → no new yes RSVPs
- Past events: organizers limited to minor corrections (not date/location)
- Soft cancel only; active yes/maybe RSVPs receive a best-effort cancellation email
- Basic blocked-language filtering rejects disallowed names, bios, event/team
  text, reports, and support messages before persistence
- Slug = event name + small hash (date + other info)

## Club rules

- A club belongs to exactly one school. Its type, student club or university
  program, does not imply university endorsement
- Site admins create **unclaimed** clubs and hide clubs, in the Admin Console
- A signed-in user with a verified email **claims** an existing club or
  **requests** a new one. Site admins review each; a school admin is not
  needed, and a school email alone is not evidence of running a club. Approval
  makes the applicant the owner. Evidence, the applicant's email, and review
  notes never appear publicly
- **Owners** and **editors** edit the club profile and remove members.
  **Owners** also invite and remove editors and transfer ownership; a transfer
  takes effect when the recipient accepts, and the previous owner becomes an
  editor. The last owner cannot leave or be removed
- **School admins** may edit clubs at their school; they do not review claims
- Any signed-in user with a verified email **joins** a club directly and may
  leave. A removed member may join again
- Signed-in people see the member list (see the People lists rules in
  [01 — Product](./01-product.md#people-lists)); visitors see the count
- A club's owners and editors may host an event as the club, at the club's
  school. Any owner or editor of the hosting club can edit and cancel the
  event; a person removed from the club loses that access unless they created
  or co-organize the event. How organizer trust indicators read on a
  club-hosted event is decided with that work (#124)
- Every club edit, claim decision, role change, removal, and transfer writes an
  audit record

## Games

- End users: cannot edit a game. A signed-in user can search IGDB, add a result to the catalog, or type a game name while creating an event or team
- A signed-in user lists games only on their own profile (`/me/games`). The lists are as visible as the profile; no one else can change them
- Update, hide, delete, and IGDB refresh: **site admin only, via the Admin Console** (`games.manage`). Admins do not create or import games. Hiding or deleting a game stops users from adding it

## Impersonation (“mimic”)

- Site admins only
- Every start/stop written to audit log with actor + target
- UI must clearly show impersonation is active
- Impersonator must not silently gain password reset or email change on target without extra confirmation (recommended hardening)

## Admin Console

**TanStack Start** application in `apps/admin` at **admin.campusgamingnetwork.com**, released separately after the first public release. It is in progress and release-gated; see [20 — Admin Console v1 engineering plan](./20-admin-console-v1-engineering-plan.md). Scope:

- Schools CRUD (create = site admin)
- **Games** catalog (IGDB sync + edits)
- Users and ACL grants (school admin, staff/faculty, approved organizer, etc.)
- **Report** queue
- **Support ticket** queue
- Feature flags — **not scheduled yet**
- Announcements (later)
- Impersonation (later)

Operators should not need raw SQL for routine ACL/school/game/moderation management.

## Feature flags & AuthZ (later)

**Not scheduled yet.** When added: flags can hide features per user/school/event/team, but **flags are not permissions**. A disabled flag hides UX/API behavior; roles still gate who may act when the flag is on.

## Rate-limited actions (AuthZ adjacent)

Apply stricter limits to:

- Signups
- Event creation
- Reports
- Private-event password attempts

Failed authZ returns **403**; missing resource **404**. Do not leak private/unlisted events via search — only `public` appears in discovery.

On the web side this is enforced in page metadata as well as in responses: a private event always gets a generic "Private event" link preview with `noindex`; someone the API lets see it in full also gets its name as the tab title, while a locked one shows "Private event" there too. Unlisted events resolve normally but are also `noindex`. An event for a campus or a group (audience `campus` or `members`) and a public profile also get a generic preview and `noindex`, and neither appears in the sitemap. Metadata is part of the gating guarantee — see [06 — Architecture](./06-architecture.md).
