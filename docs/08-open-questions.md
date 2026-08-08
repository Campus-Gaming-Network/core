# 08 — Open questions

Decisions to resolve before or during implementation. Until answered, implementers and LLMs should **ask** rather than invent.

## Still open

### Profiles & affiliations

1. **Multiple majors** — Free-text tags, or a curated majors list?
2. **Graduate students** — Separate degree level field? Different verification rules?
3. **Faculty who are not students** — Profile fields beyond staff/faculty grant (title, department)?
4. **Alumni** — Auto-flip after graduation date, or manual affiliation?
5. **What else on profiles?** — Gaming IDs (Discord, Steam, Riot), pronouns, hometown, graduation year vs date, campus, transfer student flag?

### Events

6. **Approved organizers** — Who approves badge organizers, and is approval per-school or global?
7. **Past event “minor corrections”** — Exact allowlist of editable fields?
8. **Private unlock session** — Cookie/session length after password modal success? Rate-limit / lockout policy?
9. **Tournament capacity (later)** — Count seats vs teams for team tournaments?
10. **Custom event banners (later)** — Moderation workflow when user uploads return?

### Teams & clubs (clubs later)

11. **Sponsored teams vs clubs** — How do we display sponsorship without conflating with official clubs?
12. **Club request workflow** — Required fields? Notify which admins?
13. **Who assigns teams to clubs** — School admin only, or also club officers?

### Tournaments (later)

14. **Bracket / results** — Registration-only first, or brackets in first tournament ship?
15. **Tournament tied to event** — UX: embed on event page, or standalone with link?

### Content & safety

16. **Rich text** — Plain text only, or limited Markdown?
17. **Support ticket fields** — Which fields are required on the public form?

### Technical

18. **Go API style** — REST only, or RPC (Connect/gRPC) behind the BFF?
19. **Analytics** — Plausible vs Cloudflare Web Analytics vs other?
20. **Activity log vs audit log** — One table with `kind`, or two tables?
21. **Friends / notifications / i18n** — timing and depth after the first release?

---

## Decided (do not reopen without product owner)

| Topic | Decision |
|-------|----------|
| Interested vs RSVP | RSVP = yes/no/maybe; interested = separate favorite |
| Age gate | 18+ checkbox at signup |
| Email verification | Verification email link on signup |
| Event create approval | None required |
| Event visibility | public + unlisted + private |
| Capacity | Optional; counts **RSVP yes only**; no waitlist yet |
| Recurring events | **Decided:** weekly, biweekly, or monthly; max one year; each occurrence is an independent event with its own RSVP and cancellation; no edit-series workflow yet |
| Cancellation notifications | **Decided:** after soft cancellation, best-effort email active yes/maybe RSVPs from `events@`; delivery failure does not undo cancellation |
| Role indicators | **Decided:** staff/faculty comes from verification level; school-admin grants are school-scoped in `school_admins`; event organizers expose applicable indicators |
| Basic content filtering | **Decided:** reject a small word-boundary blocklist in names, bios, event/team text, reports, and support messages; richer moderation remains future work |
| Names | Single `name` field; profile `/users/:id` |
| Teams | **public** pages; password only to join/interact |
| Private event UX | Blurred/gated + password modal; no inspectable details pre-unlock |
| Paid events | Allowed as off-site-payment listings only; CGN does not process payment |
| Clubs / tournaments | Not scheduled yet |
| Feature flags / near-you | Not scheduled yet |
| Support tickets | Anyone can submit (logged out OK) |
| Email | **Resend** — sends from `events@` and `account@`; `notifications@` and `support@` workflows are later |
| Object storage | **Cloudflare R2** — later school logos via CRM/admin app only; PNG/JPG; max **500 MB** |
| Event banners | **Decided:** default placeholder; custom uploads later with moderation |
| Event slug hash | **Decided:** **8** Base64URL characters |
| CRM | **TanStack Start** at `crm.campusgamingnetwork.com` (separate later release; skipped for first release) |
| Main site | `campusgamingnetwork.com` (Next.js) |
| Production hosting | **Railway** hosts Next.js web, Go API, and PostgreSQL; Cloudflare manages DNS/protection |
| Production database | **Railway PostgreSQL** for now; enable/verify backups before public launch |
| Railway environments | Rehearse launch in a separate `staging` environment, then deploy `production` with separate Postgres and secrets |
| Railway migrations | API pre-deploy command runs the Go migrator before Railway activates the new API deployment |
| Domain aliases | Apex is canonical; Cloudflare permanently redirects `www` to `campusgamingnetwork.com` |
| Auth session store | Opaque sessions stored in Postgres |
| School import | All seed rows active (incl. 1,300 branches); branch campuses use same UI/UX; `unitid` optional |
| Home school | User selects one home school on signup; additional schools are follows |
| Frontend auth | Use opaque server-side session cookies; avoid JWTs for browser auth |
| Event slugs | `slugify(title)-` + first **8** Base64URL chars of SHA-256(creatorId\|createdDate\|title) |
| Launch games | Rocket League, Valorant, League of Legends, Overwatch 2, Super Smash Bros. Ultimate, CSGO |
| Search | Postgres first; no Elasticsearch |
| Rich text default | Plain text + newlines |
| English only | Yes at launch |
