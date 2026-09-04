# 07 — Permissions

Authorization rules for the public site and later CRM/admin app. Enforce in **Go** on every mutating API; the BFF must not be the only gate.

## Roles overview

| Role | How granted | Scope |
|------|-------------|-------|
| **Anonymous** | — | Search/browse schools; view school clubs; browse public events/tournaments by game; unlock private event with password; no account mutations |
| **Basic user** | Email registration + clicked verification link + 18+ confirmation | Create events/teams (no event approval); RSVP; favorite events; follow schools; request clubs; report |
| **Verified student** | `.edu` email | Same as basic + verified-student trust badge |
| **Staff / faculty** | Site admin grant | Same as verified + faculty context; **visible faculty indicator** |
| **Alumni** | Affiliation / graduation | Can participate (not locked out after grad) |
| **School admin** | School-scoped grant; future CRM manages grants | Edit school; **manage clubs**; assign school teams; organizer badge; **visible admin indicator** |
| **Club officer** | Later club workflow | Manage club; future badge-eligible events |
| **Team owner** | Creator or transfer | Manage team; transfer ownership; assign captains |
| **Team captain** | Owner assigns | Register team for tournaments; limited team mgmt |
| **Event organizer** | Creator or assigned | Edit event (with past-event limits); manage RSVPs as needed |
| **Approved organizer** | Explicit grant | Badge-eligible events |
| **Site admin** | Bootstrap, then CRM | Schools CRM/admin app; games CRM/admin app; reports; support tickets; staff grants; impersonation and feature flags later |

A user may hold **multiple** roles (e.g. school admin at two schools, member of many teams).

## Verification levels

```text
signed up → email verified (link) → verified student (.edu) → staff_faculty (site admin grant)
```

- Inbox verification (click link) is required for normal authenticated use.
- `.edu` is an additional trust tier, not a substitute for clicking the verification email.
- Signup must include an **18+** confirmation checkbox (store timestamp).

Verification is not a substitute for school admin or site admin.

## Role indicators (UI)

| Role | Indicator |
|------|-----------|
| School admin | Visible badge/label on profile and event organizer UI for the granted school |
| Staff / faculty | Visible badge/label on profile and event organizer UI |
| Verified (`.edu`) | Optional trust mark (lighter than admin/faculty) |

## Permission matrix (summary)

| Action | Anonymous | Basic+ | School admin | Club officer | Team owner | Event organizer | Site admin |
|--------|-----------|--------|--------------|--------------|------------|-----------------|------------|
| Search/browse schools | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| View school clubs | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Browse public events/tournaments by game | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Create event | | ✓ (no approval) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Badge on created event | | | ✓ | later | | if approved | ✓ |
| Unlock private event (password modal) | ✓* | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Mark event interested (favorite) | | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Create team | | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| View team page | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Join / interact with team | | password | | | | | |
| Transfer team ownership | | | | | ✓ | | ✓ (break-glass) |
| Request club | | ✓ | | | | | |
| Create/approve/manage club | | | ✓ | | | | ✓ |
| Assign team to club | | | ✓ | ✓? | | | ✓ |
| Edit school details | | | ✓ | | | | ✓ |
| Create/edit/delete school | | | | | | | ✓ (later CRM/admin tooling) |
| Edit games | | | | | | | ✓ (later CRM/admin tooling) |
| Remove other school admin | | | ✗ | | | | ✓ only |
| Edit past event date/location | | ✗ | ✗ | ✗ | ✗ | ✗ | break-glass TBD |
| Minor edit past event | | | | | | ✓ | ✓ |
| Soft-delete event | | | | | | ✓ | ✓ |
| View all reports | | | | | | | ✓ |
| Impersonate user | | | | | | | ✓ |
| Manage feature flags | | | | | | | ✓ (later) |
| Sync IGDB / manage games | | | | | | | ✓ / cron |

\* Anonymous may open a private event link and submit the password via modal; pre-unlock responses must not leak event details. Still no account mutations without login where required (e.g. RSVP). Anyone (including anonymous) may submit a support ticket.

## School admin rules

- A school may have **multiple** admins
- A user may be admin of **multiple** schools
- School admins **cannot remove** other school admins (site admin can)
- School admins can edit school details, **manage clubs**, and assign school / sponsored teams
- Only site admins **create** schools, via later CRM/admin tooling

## Team rules

- Anyone authenticated (email-verified) can create a team
- Team pages are **public**; password required only to **join / interact** (no invite-link tokens yet)
- Owner can transfer ownership
- Captains can be assigned; captains register teams for team tournaments
- User may create and belong to many teams
- Teams may optionally be assigned to a **club** (Varsity, JV, etc.)

## Event rules

- Anyone authenticated (email-verified) can create an event — **no approval required**
- Multiple organizers allowed
- Event pages show organizer names and school-admin/staff-faculty role indicators
  when applicable
- Visibility: **public** · **unlisted** · **private** (password modal; content gated/blurred until unlock)
- Optional **capacity**; counts RSVP **yes** only; when full, block new yes — **no waitlist** yet
- RSVP: yes/no/maybe; **interested** is a separate favorite
- Registration closes automatically; ended or full → no new yes RSVPs
- Past events: organizers limited to minor corrections (not date/location)
- Soft cancel only; active yes/maybe RSVPs receive a best-effort cancellation email
- Basic blocked-language filtering rejects disallowed names, bios, event/team
  text, reports, and support messages before persistence
- Slug = event name + small hash (date + other info)

## Club rules

- Clubs belong **only** to a school
- Clubs are the **official** org type
- Users request; **school admins** create, approve, and manage
- Clubs may have teams assigned

## Games

- End users: read-only
- Create/update/delete and IGDB sync: **later CRM/admin tooling / site admin only**

## Impersonation (“mimic”)

- Site admins only
- Every start/stop written to audit log with actor + target
- UI must clearly show impersonation is active
- Impersonator must not silently gain password reset or email change on target without extra confirmation (recommended hardening)

## CRM (later)

**TanStack Start** application at **crm.campusgamingnetwork.com**, released after the first public release:

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

On the web side this is enforced in page metadata as well as in responses: a locked private event renders only a generic "Private event" title with `noindex`, and unlisted events resolve normally but are also `noindex`. Metadata is part of the gating guarantee — see [06 — Architecture](./06-architecture.md).
