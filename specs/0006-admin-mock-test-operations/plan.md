# Implementation plan

## Architecture impact

- Keep the existing Next admin route groups and FastAPI admin routers as owners;
  restructure only the affected Mock Test workspaces and supporting view models.
- Keep current exam, live, review, assignment, grading, and release mutation
  contracts unchanged.
- Add backend-only PostgreSQL routines for canonical filtered Writing queue
  IDs/total and row-backed actionable Review exam IDs, while services retain response
  enrichment and schemas.
- Keep embedded workspace composition for this release and make its compact
  contract explicit rather than introducing new route ownership.

## Data and contracts

- Preserve `/admin/exam-content` as the existing unpaged response for deployed
  consumers. Add `/admin/exam-content/page` as a separate contract with bounded
  `q`, attention, limit, and offset inputs plus `total` and `total_complete`.
  It must retain `kind`, `course_level`, `cohort_id`, `exam_only`, and
  `is_public`; every existing and new predicate runs before count and offset.
  Default `limit` to 25, accept 1–100, and reject larger requests. Order by
  kind, case-insensitive code falling back to title, and ID as a final
  tie-breaker in both the page endpoint and compatibility fallback before
  slicing.
  Normalize `q` by trimming and bounding to 100 characters, then match a
  case-insensitive literal substring of ID, code, title, or course level;
  `%`, `_`, and punctuation are literal. The compatibility path must use the
  same fields and normalization before local count and offset.
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
- Keep the existing `levels` field on the paginated content response. Populate
  it from a level-column-only scan across all three sources, not the selected
  page or an extra legacy full-catalog request. Report scan failures separately
  as `levels_complete=false` plus `failed_level_kinds`; the level selector stays
  usable for known values, warns when options may be missing, and does not
  mislabel the independent content `total_complete` flag. A compatibility
  fallback labels level completeness unknown.
- Preserve `/admin/writing/essays` as the existing array contract. Add
  `/admin/writing/essay-queue` as a separate, non-colliding paginated envelope
  with bounded `q`, exact `total`, and existing status, cohort, overdue, Mock,
  limit, and offset semantics. Default `limit` to 25, accept 1–100, and reject
  larger requests. The old frontend continues using the array endpoint. The
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
  `created_at DESC, id DESC` pagination and returns ordered IDs plus exact
  count. The service reconstructs rows in that ID order after its `IN` fetch
  and enrichment, irrespective of the fetch order. Revoke public, anon, and
  authenticated execution; grant only `service_role`. Pin
  `search_path = pg_catalog, public` and schema-qualify every relation plus
  callable built-in so the function-owner context cannot resolve a shadow
  object.
- Treat `writing_essays`, assignments, canonical student/cohort membership, and
  persisted grading status as truth. Do not infer missing exam identity.
- Declare a concrete additive response model for `/admin/mock-exams` with a
  required backend-derived `review_eligible` boolean on each row. Preserve all
  existing exam fields for older consumers; regenerate `api.d.ts` and use the
  typed GET contract in the new cockpit. Order the canonical admin exam list by
  `created_at DESC, id DESC` before both Live and Review selection.
  Published sequential eligibility uses closed/`active_section=done` AND
  actionable persisted review work. Row-backed eligibility for every mode uses
  a set-based, backend-only query joining persisted review
  statuses `queued`, `claimed`, `edited`, or `reviewed` to sittings in
  `all_submitted`, `under_review`, or `reviewed` state. Published retakes need
  not be closed; archived/draft exams with actionable rows qualify regardless
  of mode or exam-level clock. A completed clock with no review row or only
  released results never qualifies. Query failures fail the exam-list read instead of silently
  returning false; the frontend
  preserves a stale snapshot with an error. New frontend against an old backend
  must mark row-backed eligibility as unknown for every mode, including
  published sequential exams, and must not claim that Review has no actionable
  work from a clock-only fallback.
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
  published/open exam in stable `created_at DESC, id DESC` order. Review uses the
  backend-derived `review_eligible` flag in stable `created_at DESC, id DESC`
  order; its rail includes open retakes, and its empty state distinguishes no
  actionable review from unknown eligibility during deployment skew. A valid
  explicit deep link is never replaced merely because it is not the default.
- Serialize Writing filters, including `q`, through queue/status/grade links and
  save-return. Correct an invalid page only when `total_complete=true`, while
  preserving outcome notices. If a 404 fallback reports an incomplete bounded
  snapshot, retain the requested offset even when the local page is empty.
- Cover loading, empty, partial/stale, error/retry, permission, narrow layout,
  light/dark, focus, target size, and reduced motion states.

## Work decomposition

- T001 defines API/response and frontend model contracts.
- T002 adds canonical database filtering and bounded service enrichment.
- T003 separates management workspaces and task-aware cockpit scope.
- T004 implements bounded content and Writing queue interactions.
- T005 adds contract, unit, browser, accessibility, and build evidence.
- T006 stages both migrations, verifies exact SHA, reviews, and promotes.

## Rollout and rollback

- Apply both additive migrations to staging before merging dependent code,
  verify both routines' ownership/ACL plus representative Writing totals and
  row-backed Review eligibility, then merge to
  staging and run exact-SHA integrated plus live browser checks.
- Apply both advisory-locked migrations to production before promoting the
  exact staging SHA to main.
- Code rollback is safe because both routines and indexes are additive. Retain the
  routines during rollback; remove them only in a later migration after no deployed
  code references it.
- If totals disagree, block promotion, compare routine IDs to direct canonical
  queries, and repair query semantics rather than patching the UI total.

## Verification strategy

- Backend tests cover request validation, exact totals, ordering, every
  dataset-wide attention predicate, every preserved `kind`, `course_level`,
  `cohort_id`, `exam_only`, and `is_public` filter, and a matching record beyond
  page 1 under combined existing/new filters. They also cover canonical
  student/cohort resolution, literal query symbols and mixed case in both
  content paths, duplicate assignments with the earliest deadline, tied essay
  timestamps, deliberately shuffled enrichment rows across adjacent pages,
  tied content display keys across shuffled source rows and adjacent pages,
  levels represented only beyond page 1 and partial level-scan failures,
  default/maximum/oversized page limit validation in both routes, bounded
  enrichment, migration ACL,
  fixed `search_path`, and schema qualification.
- Review tests cover queued/claimed/edited/reviewed versus released or
  void sittings, open versus closed retakes, archived/draft sequential and
  retake exams with actionable rows, sequential `done` plus actionable rows,
  sequential no-review and released-only exclusions,
  equal-timestamp ordering for both Live and Review, typed exam-list response
  and older field preservation, backend lookup failure, and the routine's ACL and
  fixed search path. Frontend tests cover unknown old-backend
  eligibility, explicit deep links, and visible open-retake rail selection.
- Frontend contracts cover workspace separation, query serialization, task
  defaults, enum fallback, accessible controls, no-result/error states,
  partial-source totals, locally filtered `q`/overdue fallback, literal query
  symbols, earliest-deadline fallback behavior, Review candidate ordering,
  Review empty/deep-link behavior, incomplete-total offset preservation versus
  complete-total correction, and both independent deployment orders.
- Fixture-backed browser journeys cover Manage/Create/Content, Live, Review,
  Writing page 2 grading, polling, save-return, reload, and 390px layout.
- Run the affected backend suite, full frontend contract suite, strict
  TypeScript, Next production build, independent review, staging schema query,
  and exact-SHA staging/production smoke journeys.
