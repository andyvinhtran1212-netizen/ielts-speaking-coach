# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=frontend/tests/admin-mock-exams-next-model.test.mjs | PENDING |
| FR-002 | kind=test; ref=frontend/tests/admin-exam-content-openapi-contract.test.mjs | PENDING |
| FR-003 | kind=test; ref=frontend/tests/admin-mock-exams-next-model.test.mjs | PENDING |
| FR-004 | kind=test; ref=frontend/tests/admin-mock-tests-next-behavior.test.mjs | PENDING |
| FR-005 | kind=test; ref=backend/tests/test_essay_service.py | PENDING |
| FR-006 | kind=test; ref=frontend/tests/admin-writing-queue-next-behavior.test.mjs | PENDING |
| FR-007 | kind=journey; ref=frontend/tooling/verify-admin-mock-tests-flow.mjs | PENDING |

## Contract evidence

- OpenAPI/type drift: pending regenerated `frontend/types/api.d.ts`, response
  model tests, strict TypeScript, and full frontend contract suite.
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
  routes must test default 25, accepted 100, and rejected 101 limits.
  Writing page evidence must cover tied `created_at` values, `id DESC` order,
  deliberately shuffled enrichment results, and adjacent-page stability.
  Create, mutation, grading, and release payloads remain unchanged.

## Data evidence

- Migration/schema query: pending staging application, second idempotent runner
  pass, routine owner/ACL inspection, `pg_proc.proconfig` fixed-search-path
  assertion, schema-qualified SQL audit, and representative exact-total query.
- Immediate state versus full reload: pending content level save/cancel,
  queue/status/grade navigation, canonical grading readback, and Review default
  selection evidence covering newest-first completed sequential and actionable
  open-retake eligibility, released-only/void exclusions, no eligible exam,
  old-backend unknown eligibility, and a valid explicit deep link. Page
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

- Staging SHA and checks: pending spec merge, rebased implementation, staging
  migration, integrated CI, live Staging E2E, and exact-SHA browser smoke.
- Production verification: pending advisory-locked migration, staging-to-main
  promotion, production SHA match, health checks, and admin journey smoke.
