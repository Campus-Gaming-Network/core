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
