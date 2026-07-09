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

6. **Recurring events** — Which recurrence model (RRULE)? Edit one vs edit series?
7. **Approved organizers** — Who approves badge organizers, and is approval per-school or global?
8. **Past event “minor corrections”** — Exact allowlist of editable fields?
9. **Private unlock session** — Cookie/session length after password modal success? Rate-limit / lockout policy?
10. **Cancel notify RSVPs (post-MVP)** — Email copy and timing when reintroduced?
11. **Tournament capacity (post-MVP)** — Count seats vs teams for team tournaments?
12. **Custom event banners (post-MVP)** — Moderation workflow when user uploads return?

### Teams & clubs (clubs post-MVP)

13. **Sponsored teams vs clubs** — How do we display sponsorship without conflating with official clubs?
14. **Club request workflow** — Required fields? Notify which admins?
15. **Who assigns teams to clubs** — School admin only, or also club officers?

### Tournaments (post-MVP)

16. **Bracket / results** — Registration-only first, or brackets in first tournament ship?
17. **Tournament tied to event** — UX: embed on event page, or standalone with link?

### Content & safety

18. **Profanity list** — Which library/list, and for which fields?
19. **Rich text** — Plain text only, or limited Markdown?
20. **Support ticket fields** — Which fields are required on the public form?

### Technical

21. **Go API style** — REST only, or RPC (Connect/gRPC) behind the BFF?
22. **Auth session store backing** — Store opaque server-side sessions in Postgres or Redis?
23. **Analytics** — Plausible vs Cloudflare Web Analytics vs other?
24. **Activity log vs audit log** — One table with `kind`, or two tables?
25. **Friends / notifications / i18n** — timing and depth after MVP?

---

## Decided (do not reopen without product owner)

| Topic | Decision |
|-------|----------|
| Interested vs RSVP | RSVP = yes/no/maybe; interested = separate favorite |
| Age gate | 18+ checkbox at signup |
| Email verification | Verification email link on signup |
| Event create approval | None required |
| Event visibility MVP | public + unlisted + private |
| Capacity | Optional; counts **RSVP yes only**; no waitlist in MVP |
| Names | Single `name` field; profile `/users/:id` |
| Teams | In MVP; **public** pages; password only to join/interact |
| Private event UX | Blurred/gated + password modal; no inspectable details pre-unlock |
| Paid events | Allowed in MVP as off-site-payment listings only; CGN does not process payment |
| Clubs / tournaments | Out of MVP |
| Feature flags / near-you / cancel-notify | Hold off for MVP |
| Support tickets | Anyone can submit (logged out OK) |
| Email | **Resend** — `events@` / `notifications@` / `support@` / `account@campusgamingnetwork.com` |
| Object storage | **Cloudflare R2** — post-MVP school logos via CRM/admin app only; PNG/JPG; max **500 MB** |
| Event banners MVP | **Decided:** default placeholder; custom uploads later with moderation |
| Event slug hash | **Decided:** **8** Base64URL characters |
| CRM | **TanStack Start** at `crm.campusgamingnetwork.com` (post-MVP separate release; skipped for main-site MVP) |
| Main site | `campusgamingnetwork.com` (Next.js) |
| School import | All seed rows active (incl. 1,300 branches); branch campuses use same UI/UX; `unitid` optional |
| Home school | User selects one home school on signup; additional schools are follows |
| Frontend auth | Use opaque server-side session cookies; avoid JWTs for browser auth |
| Event slugs | `slugify(title)-` + first **8** Base64URL chars of SHA-256(creatorId\|createdDate\|title) |
| MVP games | Rocket League, Valorant, League of Legends, Overwatch 2, Super Smash Bros. Ultimate, CSGO |
| Search | Postgres first; no Elasticsearch |
| Rich text default | Plain text + newlines |
| English only | Yes at launch |
