<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Validation and API contracts

- Runtime response schemas and their inferred TypeScript types live in
  `lib/api-contracts.ts`. Add or update the schema whenever a Go response
  changes; do not add a parallel handwritten response interface.
- Every successful `apiRequest` call must provide a `responseSchema`. Use
  `emptyResponseSchema` for 204 responses. Do not replace parsing with a type
  assertion such as `payload as SomeResponse`.
- Keep Zod runtime imports in server-side BFF, action, contract, and test
  modules. Client components may import inferred contract types with
  `import type`, but must not import a schema at runtime.
- Form schemas live in `lib/form-validation.ts`. Validate inside the Server
  Action before calling the Go API, return `formValidationFailure` for expected
  input errors, and connect every visible error through `FieldError` and
  `fieldErrorProps` for `aria-invalid`/`aria-describedby` behavior.
- Preserve native HTML validation attributes for immediate and no-JavaScript
  feedback. Zod supplements them at the server boundary.
- Go remains authoritative for authorization, persistence, resource state,
  blocked-language policy, and other domain rules. Do not duplicate those rules
  in Zod. Frontend schemas cover transport shape and stable input constraints.
- Response schemas intentionally allow additive unknown fields while validating
  and returning the fields the web app knows about. A contract failure must not
  log the response payload; it can contain tokens or personal data.
- Add regression coverage in `tests/api-contracts.test.ts` or
  `tests/form-validation.test.ts`, plus Playwright coverage when validation
  changes visible behavior.

## Icons

- Icons come from `lucide-react` through `components/icon.tsx`. Import `Icon`
  and `appIcon` from that module; never import a glyph from `lucide-react`
  directly in a page or component. The registry maps a concept (`event`,
  `school`, `place`) to a glyph so a swap is one edit rather than a search.
- Add a registry entry before using a new glyph, and verify the export name
  against the installed version. Lucide v1 renamed a number of icons
  (`CircleHelp` is now `CircleQuestionMark`, `Home` is now `House`).
- An icon paired with visible text is decoration: leave `label` unset so `Icon`
  marks it `aria-hidden` and keeps it out of accessible names. Pass `label`
  only when the icon is the sole carrier of meaning, and remember that a
  labelled icon inside a button becomes part of that button's accessible name.
  `tests/e2e/pass-v0.spec.ts` asserts this convention holds.
- Never use an icon as the only signal for state. Pair it with text, as the
  RSVP, verification, and form-error surfaces do.
- Size icons with the `size` prop, which selects a CSS class in `globals.css`.
  `sm`/`md` are em-based so inline glyphs track the surrounding text; `lg`/`xl`
  are fixed for standalone marks. Do not pass Lucide's own `size` prop.
- Wrap an icon and its text in `.icon-text` for alignment. Elements carrying
  HeroUI's `button` class already flex with a gap, so do not add `.icon-text`
  there.
- HeroUI `Alert` renders its own status indicator. Do not add a Lucide icon
  inside one.
- `app/global-error.tsx` stays free of the icon module on purpose: it is the
  last-resort boundary and should not depend on more than it must.
- Lucide components carry `"use client"`, so each icon is a leaf client
  component even on a server-rendered page. Next.js tree-shakes the package by
  default (it ships in the `optimizePackageImports` list), so no config is
  needed, but keep an eye on the count: the current set costs roughly 19 KB
  gzipped across the app's client chunks.
