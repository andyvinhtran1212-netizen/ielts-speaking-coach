# Implementation plan

## Architecture impact

- Add dedicated learner/admin FastAPI routers and a server-owned diagnostic service.
- Add native Next.js learner diagnostic/report/review and educator report surfaces.
- Reuse class assignments and My Class routing; do not expose a public catalog entry.

## Data and contracts

- Store immutable releases, content, sessions, exposures, responses, and reports in
  additive tables protected by RLS and database guards.
- Use database functions for release promotion and atomic finalization.
- Keep selection, answer keys, scoring, and adaptive routing server-side.
- Link educator results to the canonical class assignment item while keeping score null.
- Gate assigned beta and future self-serve independently; both default off.

## Rollout and rollback

- Apply schema and import the validated package with flags off on staging first.
- Deploy the exact reviewed SHA, exercise an assigned journey, then enable only the
  assigned diagnostic flag.
- Prepare production schema/content with flags off before staging-to-main promotion.
- Roll back by disabling the assigned flag; retain additive schema and immutable data.

## Verification strategy

- Validate package checksums and exact row counts in dry-run and applied imports.
- Test selection bounds, answer-key secrecy, membership rechecks, concurrency,
  idempotency, report immutability, and retired-release promotion.
- Run backend, frontend contract, type, build, browser, OpenAPI, and live smoke gates.
