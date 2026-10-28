# Repository instructions

## Communication

- Be direct and straightforward.
- Do not be overly dramatic or jump to conclusions. For example, do not say
  "Critical Memory Safety Issue Found" unless you are certain that is true. If
  you are not certain, frame it as "Potential Memory Issue Found."
- Do not be sycophantic or use unnecessary flattery. Avoid phrases such as
  "You're absolutely right."

## Application containers

- Treat every direct child of `apps/` as a runnable application.
- Every `apps/<name>` application must include `apps/<name>/Dockerfile` and a
  same-named service in `docker-compose.yml` that builds that Dockerfile.
- Use a Compose profile for an optional application that should not start with
  the core stack.
- Run `pnpm run check:apps-compose` after adding or renaming an application or
  changing its Docker/Compose configuration.

## Documentation

- When a change alters documented behavior, update the doc that owns that fact
  in the same change. The owners and a short checklist are in
  `docs/README.md` under "Sources of truth" and "Keeping docs current".
- Run `pnpm run check:docs-links` after editing documentation.

## Code formatting

- After making any code changes, run `pnpm run fmt` before validation or
  committing. Use `pnpm run fmt:check` when a non-writing check is needed.
- Do not format dependencies, generated sources, build artifacts, or test
  output. Keep the `fmt.ignorePatterns` in the root `vite.config.ts` aligned
  with `.gitignore`, including `node_modules`, generated `routeTree.gen.ts`
  files, build output, coverage output, and Playwright artifacts.
- For Go code, also run `pnpm run fmt:api` because Oxfmt does not format Go.

## Comments

- Write a comment only to explain why, a non-obvious constraint, a workaround,
  or a TODO/FIXME. Do not write comments that restate what the code does.
- Leave out section labels, prop and field docs that repeat the name, route
  handler docs that only name the route, and test narration of the next few
  lines.
- Exported Go declarations keep their doc comments (`docs/go-style.md`).
- When a comment is part restatement and part reason, keep only the reason.

## TypeScript

- Write TypeScript with real types wherever a file can be TypeScript. This
  includes repository scripts, test fixtures, and one-off or throwaway
  scripts. Do not add `.js`, `.mjs`, or `.cjs` files.
- Run scripts directly with Node.js 24 (`node path/to/script.ts`). Node strips
  the types itself, so use only erasable syntax: no enums, namespaces, or
  parameter properties.
- Avoid `any`. Give parsed JSON a declared type, or validate it with Zod where
  the surrounding code does.
- After changing `scripts/`, run `pnpm run typecheck:scripts`. Fixtures under
  `apps/<name>/tests` are typechecked by that application's test command.

## Web validation

- Use Node.js 24.x for all JavaScript and TypeScript commands.
- After changing `apps/web`, run `pnpm run typecheck:web`, `pnpm run lint:web`,
  and `pnpm run test:web`.
- For browser-visible or navigation changes, also run `pnpm run build:web`.
- The Playwright suites (`test:e2e:*`) are paused while the UI changes quickly
  before release. Do not run them, add to them, or update their specs or
  visual baselines. The rules below apply again when they come back.

## Browser test reliability

- In JavaScript-enabled Playwright tests, use the shared helpers in
  `apps/web/tests/e2e/fixtures/app-navigation.ts` for full-page navigation,
  login, and router readiness.
- Do not interact with server-rendered controls until application hydration
  and TanStack Router navigation have settled.
- Wait for observable application state; do not use fixed sleeps or timing
  delays to address intermittent failures.
- Keep no-JavaScript tests independent of hydration helpers.
- When fixing an intermittent browser test, repeat the failing scenario across
  both desktop and mobile projects before running the complete development and
  production suites.

## Test determinism

- Tests must not depend on probabilistic tampering, random collisions,
  wall-clock timing, or execution order. Construct deterministic fixtures that
  guarantee the condition being tested.
- When writing tests, prefer comparing the equality of entire objects over
  fields one by one.
- Do not create small helper methods that are referenced only once.
- Do not add tests for values that are statically defined.
- Do not add negative tests for logic that was removed.

## Test value

- Every test must fail if the behavior it names broke. Ask what change to
  the code would turn it red; if the answer is "only editing the same
  constant or list in both places", delete it.
- Do not test what the type system or a schema definition already
  guarantees: a Zod schema rejecting a value its own definition rules out, a
  Go struct that cannot hold a field, or a sentinel error's fixed kind and
  code.
- Do not test configuration by comparing it to itself: static lists,
  constants, timeouts, or a config file's text.
- Do not read source files and regex-match their text in place of running
  the code. The exception is a check that enforces a documented security or
  repository rule (`static-safety`, stylesheet layers, policy hashes); name
  the rule in the test.
- Do not test one-line wrappers, pass-throughs, or library behavior.
- Do not repeat a check another test already makes.
- Mock only the boundary the code crosses (the API, the database, the
  clock). A test whose only assertion is that a mock received what the test
  passed in proves nothing.
