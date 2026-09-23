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

- Preserve `/admin/exam-content` as the existing unpaged response for deployed
  consumers. Add `/admin/exam-content/page` as a separate contract with bounded
  `q`, attention, limit, and offset inputs plus `total` and `total_complete`.
  It must retain `kind`, `course_level`, `cohort_id`, `exam_only`, and
  `is_public`; every existing and new predicate runs before count and offset.
  Relationship enrichment runs only for page rows. `total` is exact only when
  `total_complete=true`; if any source is named in `failed_kinds`,
  `total_complete=false`, `total` is the surviving-source subtotal, and the UI
  must label it as incomplete. When the page route is absent, the new frontend
  may fetch the legacy full response with the old server-supported filters,
  apply `q`, attention, and paging locally after preserving every active filter,
  and label that compatibility result incomplete.
- Accepted `attention` values and dataset-wide predicates are fixed: `all` adds
  no predicate; `no-level` means blank `course_level`; `draft` means canonical
  status `draft`; `unassigned` means the content ID is absent from every Mock
  exam reference; and `action` excludes archived rows then matches any
  non-Writing unpublished/not-publication-ready row, blank course level, or
  content ID with no cohort association. Base-column predicates plus lightweight
  cohort/Mock-reference membership sets are computed before count and offset.
  Page-only cohort display, explanation readiness, and Mock-reference detail
  enrichment run afterward and never determine an attention total.
- Preserve `/admin/writing/essays` as the existing array contract. Add
  `/admin/writing/essay-queue` as a separate, non-colliding paginated envelope
  with bounded `q`, exact `total`, and existing status, cohort, overdue, Mock,
  limit, and offset semantics. The old frontend continues using the array endpoint. The
  new frontend uses the page endpoint and, only when that route returns 404
  during deployment skew, falls back to the array endpoint with an explicit
  `total_complete=false` compatibility warning and no exact-count claim. The
  fallback asks the legacy route for its bounded maximum snapshot, retains its
  server-side status/cohort/Mock scope, applies unsupported active `q` and
  overdue predicates locally before local offset/limit, and never shows a row
  that contradicts those active filters.
- Define Writing query and deadline semantics identically across PostgreSQL,
  service enrichment, displayed rows, and the compatibility fallback. Trim `q`
  to at most 100 characters; match a case-insensitive literal substring of
  `student.full_name` or `student_code`, or an exact case-insensitive UUID.
  Treat `%`, `_`, and punctuation literally. `overdue=true` requires status
  other than `delivered` and the earliest non-null assignment deadline to be
  strictly earlier than PostgreSQL `now()`. Duplicate assignment rows must not
  duplicate essays, and the displayed deadline is that same earliest value.
- Add an idempotent migration defining a `SECURITY DEFINER`, backend-only
  Writing queue page routine. It applies all filters before deterministic
  pagination and returns ordered IDs plus exact count. Revoke public, anon, and
  authenticated execution; grant only `service_role`. Pin
  `search_path = pg_catalog, public` and schema-qualify every relation plus
  callable built-in so the function-owner context cannot resolve a shadow
  object.
- Treat `writing_essays`, assignments, canonical student/cohort membership, and
  persisted grading status as truth. Do not infer missing exam identity.
- Keep the currently deployed backend compatible with the additive routine and
  index before dependent code is deployed. Verify both deployment orders for
  both domains: old frontends use the unchanged exam-content and Writing array
  routes against the new backend; new frontends use visible incomplete legacy
  fallbacks until `/admin/exam-content/page` and
  `/admin/writing/essay-queue` become available.

## UI and interaction

- Management defaults to list mode with separate creation and content-bank
  workspaces. Lazy-mount the large bank.
- Use debounced search, bounded pages, quick attention filters, contextual row
  actions, and explicit save/cancel for content metadata.
- Select Live and Review context by task while honoring valid explicit deep
  links; hide the irrelevant exam rail for Writing. Live chooses the first
  published/open exam in canonical newest-first order. Review chooses the first
  published/closed exam with `active_section=done` in that order, renders a
  purposeful empty state when none exists, and never replaces a valid explicit
  exam deep link merely because it is not the default candidate.
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

- Backend tests cover request validation, exact totals, ordering, every
  dataset-wide attention predicate, every preserved `kind`, `course_level`,
  `cohort_id`, `exam_only`, and `is_public` filter, and a matching record beyond
  page 1 under combined existing/new filters. They also cover canonical
  student/cohort resolution, literal query symbols, mixed case, duplicate
  assignments with the earliest deadline, bounded enrichment, migration ACL,
  fixed `search_path`, and schema qualification.
- Frontend contracts cover workspace separation, query serialization, task
  defaults, enum fallback, accessible controls, no-result/error states,
  partial-source totals, locally filtered `q`/overdue fallback, literal query
  symbols, earliest-deadline fallback behavior, Review candidate ordering,
  Review empty/deep-link behavior, and both independent deployment orders.
- Fixture-backed browser journeys cover Manage/Create/Content, Live, Review,
  Writing page 2 grading, polling, save-return, reload, and 390px layout.
- Run the affected backend suite, full frontend contract suite, strict
  TypeScript, Next production build, independent review, staging schema query,
  and exact-SHA staging/production smoke journeys.
