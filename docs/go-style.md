# Go style

Go code in `apps/api` follows [Effective Go](https://go.dev/doc/effective_go)
and the [Google Go Style Guide](https://google.github.io/styleguide/go/guide).

These guidelines are the default for new code and code being materially changed.
They are applied with judgment: avoid broad style-only churn, but do not extend
an existing inconsistency in new code.

## Baseline

- Run `gofmt` on every Go source file. Formatting is checked in CI.
- Prefer clear, simple, concise code and standard-library mechanisms.
- Use `MixedCaps`/`mixedCaps`; do not use underscores in Go identifiers.
- Keep package names short, lowercase, and descriptive.
- Preserve initialisms: use `ID`, `URL`, `HTTP`, and `DB`, not `Id`, `Url`, `Http`,
  or `Db`.
- Name getters after the underlying concept (`Owner`, not `GetOwner`).
- Keep comments useful and explain why when the code's rationale is not obvious.
  Exported declarations should have doc comments.
- Handle errors explicitly, return early for error paths, and wrap errors with
  useful context when crossing a boundary.
- Prefer small interfaces defined by the consumer and avoid abstractions that
  do not make the code easier to use or maintain.
- Add or update focused regression tests for behavior changes.

## Required local checks

From the repository root:

```bash
npm run fmt:check:api
npm run vet:api
npm run test:api
```

`go test ./...` remains the source of truth for the API test suite. The style
guide is a review baseline as well as a tooling baseline; automated checks do
not replace judgment about clarity, simplicity, and maintainability.

