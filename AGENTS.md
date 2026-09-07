# Repository instructions

## Application containers

- Treat every direct child of `apps/` as a runnable application.
- Every `apps/<name>` application must include `apps/<name>/Dockerfile` and a
  same-named service in `docker-compose.yml` that builds that Dockerfile.
- Use a Compose profile for an optional application that should not start with
  the core stack.
- Run `npm run check:apps-compose` after adding or renaming an application or
  changing its Docker/Compose configuration.
