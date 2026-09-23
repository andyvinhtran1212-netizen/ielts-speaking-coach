# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=frontend/tests/admin-mock-exams-next-model.test.mjs | PASS |
| FR-002 | kind=command; ref=node tooling/run-contract-tests.mjs tests/admin-exam-content-openapi-contract.test.mjs | PASS |
| FR-003 | kind=test; ref=frontend/tests/admin-mock-exams-next-model.test.mjs | PASS |
| FR-004 | kind=test; ref=frontend/tests/admin-mock-tests-next-behavior.test.mjs | PASS |
| FR-005 | kind=test; ref=backend/tests/test_essay_service.py | PASS |
| FR-006 | kind=test; ref=frontend/tests/admin-writing-queue-next-behavior.test.mjs | PASS |
| FR-007 | kind=journey; ref=frontend/tooling/verify-admin-mock-tests-flow.mjs | PASS |

## Contract evidence

- OpenAPI/type drift: regenerated `frontend/types/api.d.ts` matches live app
  OpenAPI; response-model tests, strict and legacy TypeScript, and full frontend
  contract suite pass locally.
- Backward compatibility: pending tests that old exam-content and Writing array
  consumers work against the new backend, and both new page consumers turn an
  old-backend 404 into visibly incomplete locally filtered compatibility
  results. Content compatibility must preserve `kind`, `course_level`,
  `cohort_id`, `exam_only`, and `is_public`, then apply `q` and attention before
  local paging, including a match beyond page 1. The Writing case must activate
  both `q` and overdue and prove every rendered fallback row matches both using
  literal query characters and the earliest non-null assignment deadline.
  Content search must match ID, code, title, and course level with identical
  trimmed 100-character case-insensitive literal semantics in both paths.
  Content order must include ID after kind and display key, with tied display
  keys stable across shuffled reads, adjacent pages, and reloads. Both page
  routes must test default 25, accepted 100, and rejected 101 limits. A level
  present only beyond page 1 must remain selectable; a failed level scan must
  mark `levels_complete=false` and name its source without changing an exact
  content total.
  Writing page evidence must cover tied `created_at` values, `id DESC` order,
  deliberately shuffled enrichment results, and adjacent-page stability.
  Create, mutation, grading, and release payloads remain unchanged.

## Data evidence

- Migration/schema query: staging applied 297–299 and a second locked-runner dry
  run found zero pending files; production application remains pending. Pending
  second idempotent runner pass, all routine owners/ACL inspection,
  `pg_proc.proconfig` fixed-search-path assertions, schema-qualified SQL audit,
  representative Writing exact-total query, and retake actionable/released-only
  eligibility query.
- Immediate state versus full reload: pending content level save/cancel,
  queue/status/grade navigation, canonical grading readback, and Review default
  selection evidence covering completed sequential with actionable rows,
  newer completed sequential with only released or no review rows,
  open-retake and archived/draft row-backed eligibility across both exam modes,
  released-only/void exclusions, no eligible exam, old-backend unknown
  eligibility, tied-timestamp Live/Review ordering, typed
  `review_eligible` OpenAPI, older exam-field preservation, and a valid explicit
  deep link. Page
  correction requires a complete total; a forced 404 with an offset beyond
  the bounded legacy snapshot must
  keep that offset and its query context.

## UI evidence

- Viewports/themes/input methods: pending fixture-backed 390/768/1440 checks,
  light/dark source contract, keyboard search/menu navigation, focus-visible,
  44px targets, and reduced-motion evidence.
- States: pending loading, empty, no-result, no-open-room, partial/stale,
  contract error/retry, unknown-enum, and permission evidence. A failed content
  source and a Writing compatibility fallback must not display an exact-total
  claim.

## Release evidence

- Staging SHA and checks: amended spec merged at `0aad1f0f`, implementation
  based there, and staging migrations 297–299 applied; implementation PR,
  integrated CI, live Staging E2E, and exact-SHA browser smoke remain pending.
- Production verification: pending advisory-locked migrations 297–299, staging-to-main
  promotion, production SHA match, health checks, and admin journey smoke.
