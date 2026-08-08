# Current State

Quick re-entry point for Campus Gaming Network. Read this first after time away;
the detailed product and engineering context remains in the other documents in
this folder.

**Last updated:** 2026-08-07

## Where we are

The first-release product is implemented locally: authentication, profiles,
schools, launch games, events, teams, dashboard, support, and baseline safety
intake are in place.

Repository deployment configuration is also implemented. The remaining launch
work is external environment setup and rehearsal.

## Current milestone

Complete the staging rehearsal and production rollout for
`campusgamingnetwork.com`.

## Next three tasks

1. Provision Railway staging and production environments.
2. Configure Cloudflare DNS, production secrets, email, and database backups.
3. Run the documented staging rehearsal, then the production smoke test.

## Blockers and decisions

- Launch work requires access to Railway, Cloudflare, Resend, and the production
  domain.
- No major product decisions currently block the launch rehearsal.
- Product and technical questions that are intentionally unresolved are tracked
  in [08 — Open questions](./08-open-questions.md).

## Recently completed

- Changed the school catalog refresh from every 15 minutes to daily.
- Served the school catalog from memory with HTTP caching.
- Removed unused school search indexes.
- Completed several launch-hardening changes, including account deletion,
  password hashing, rate-limit bounds, and HTTP timeouts.

## Resume checklist

1. Read this file.
2. Check the latest commits with `git log -5`.
3. Review [10 — Delivery status](./10-delivery-status.md) for detailed checklists.
4. Start with the first unchecked task under **Next three tasks**.
5. Before stopping, update this file’s milestone, next tasks, blockers, and
   recently completed items.

## Detailed references

- [05 — Roadmap](./05-roadmap.md) — phased product direction
- [10 — Delivery status](./10-delivery-status.md) — detailed Now / Next / Later tracker
- [13 — Deployment plan](./13-deployment-plan.md) — launch setup and smoke test
- [08 — Open questions](./08-open-questions.md) — unresolved decisions
