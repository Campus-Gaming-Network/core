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

## Code formatting

- After making any code changes, run `pnpm run fmt` before validation or
  committing. Use `pnpm run fmt:check` when a non-writing check is needed.
- Do not format dependencies, generated sources, build artifacts, or test
  output. Keep `.oxfmtrc.json` ignore patterns aligned with `.gitignore`,
  including `node_modules`, generated `routeTree.gen.ts` files, build output,
  coverage output, and Playwright artifacts.
- For Go code, also run `pnpm run fmt:api` because Oxfmt does not format Go.

## Web validation

- Use Node.js 24.x for all JavaScript and TypeScript commands.
- After changing `apps/web`, run `pnpm run typecheck:web`, `pnpm run lint:web`,
  and `pnpm run test:web`.
- For browser-visible or navigation changes, also run
  `pnpm run test:e2e:web:dev`, `pnpm run build:web`, and
  `pnpm run test:e2e:web`.
- The production Playwright suite serves the existing `apps/web/.output`
  bundle, so always rebuild immediately before running it.

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
