# Implementation plan

## Architecture impact

- Keep the existing Next admin route groups and FastAPI admin routers as owners;
  restructure only the affected Mock Test workspaces and supporting view models.
- Keep current exam, live, review, assignment, grading, and release mutation
  contracts unchanged.
- Add one backend-only PostgreSQL routine for canonical filtered Writing queue
  IDs and total, while the service retains response enrichment and schemas.
- Keep embedded workspace composition for this release and make its compact
  contract explicit rather than introducing new route ownership.

## Data and contracts

- Extend the exam-content list contract with bounded `q`, attention, limit, and
  offset inputs plus `total` and `total_complete`. Relationship enrichment runs
  only for page rows. `total` is exact only when `total_complete=true`; if any
  source is named in `failed_kinds`, `total_complete=false`, `total` is the
  surviving-source subtotal, and the UI must label it as incomplete.
- Preserve `/admin/writing/essays` as the existing array contract. Add
  `/admin/writing/essays/queue` as a separate paginated envelope with bounded
  `q`, exact `total`, and existing status, cohort, overdue, Mock, limit, and
  offset semantics. The old frontend continues using the array endpoint. The
  new frontend uses the page endpoint and, only when that route returns 404
  during deployment skew, falls back to the array endpoint with an explicit
  `total_complete=false` compatibility warning and no exact-count claim.
- Add an idempotent migration defining a `SECURITY DEFINER`, backend-only
  Writing queue page routine. It applies all filters before deterministic
  pagination and returns ordered IDs plus exact count. Revoke public, anon, and
  authenticated execution; grant only `service_role`.
- Treat `writing_essays`, assignments, canonical student/cohort membership, and
  persisted grading status as truth. Do not infer missing exam identity.
- Keep the currently deployed backend compatible with the additive routine and
  index before dependent code is deployed. Verify both deployment orders: old
  frontend/new backend uses the unchanged array route; new frontend/old backend
  uses the visible incomplete fallback until the page route becomes available.

## UI and interaction

- Management defaults to list mode with separate creation and content-bank
  workspaces. Lazy-mount the large bank.
- Use debounced search, bounded pages, quick attention filters, contextual row
  actions, and explicit save/cancel for content metadata.
- Select Live and Review context by task while honoring valid explicit deep
  links; hide the irrelevant exam rail for Writing.
- Serialize Writing filters, including `q`, through queue/status/grade links and
  save-return. Preserve outcome notices through automatic page correction.
- Cover loading, empty, partial/stale, error/retry, permission, narrow layout,
  light/dark, focus, target size, and reduced motion states.

## Work decomposition

- T001 defines API/response and frontend model contracts.
- T002 adds canonical database filtering and bounded service enrichment.
- T003 separates management workspaces and task-aware cockpit scope.
- T004 implements bounded content and Writing queue interactions.
- T005 adds contract, unit, browser, accessibility, and build evidence.
- T006 stages the migration, verifies exact SHA, reviews, and promotes.

## Rollout and rollback

- Apply the additive migration to staging before merging dependent code, verify
  routine ownership/ACL and representative filtered totals, then merge to
  staging and run exact-SHA integrated plus live browser checks.
- Apply the same advisory-locked migration to production before promoting the
  exact staging SHA to main.
- Code rollback is safe because the routine and index are additive. Retain the
  routine during rollback; remove it only in a later migration after no deployed
  code references it.
- If totals disagree, block promotion, compare routine IDs to direct canonical
  queries, and repair query semantics rather than patching the UI total.

## Verification strategy

- Backend tests cover request validation, exact totals, ordering, filtering,
  canonical student/cohort resolution, bounded enrichment, and migration ACL.
- Frontend contracts cover workspace separation, query serialization, task
  defaults, enum fallback, accessible controls, no-result/error states,
  partial-source totals, and both independent deployment orders.
- Fixture-backed browser journeys cover Manage/Create/Content, Live, Review,
  Writing page 2 grading, polling, save-return, reload, and 390px layout.
- Run the affected backend suite, full frontend contract suite, strict
  TypeScript, Next production build, independent review, staging schema query,
  and exact-SHA staging/production smoke journeys.
