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
- Backward compatibility: passing tests prove old exam-content and Writing array
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
  Create, mutation, grading, and release payloads remain unchanged. Backend
  8,788 passed and 329 skipped; frontend contracts 9,232 passed locally, and
  the exact-SHA staging `Tests` workflow passed.

## Data evidence

- Migration/schema query: staging applied 297–302. The atomic content-catalog
  page snapshot in 301 returned 39 Reading, 199 Listening, and 1 Writing row;
  Reading draft returned 36 total with a filtered 25-row page, and every
  sampled row matched the draft/unassigned predicate.
  The new Mock list receipt returned an empty `exams` array on staging (which
  currently has no Mock exams); populated mixed-mode eligibility is covered by
  local fixtures. A second locked-runner dry run confirmed zero pending. Owner,
  service-role-only ACL, and fixed search path are verified. Production ledger
  now records 297–302 (6/6); five admin routines exist and the locked-runner
  dry run reports zero pending. Staging currently has no Writing essays or Mock
  exams, so populated exact-total and actionable/released-only cases are
  covered by local backend fixtures rather than asserted from empty live data.
- Immediate state versus full reload: passing fixture browser checks cover content level save/cancel,
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

- Viewports/themes/input methods: passing fixture-backed 390/768/1440 checks,
  light/dark source contract, keyboard search/menu navigation, focus-visible,
  44px targets, and reduced-motion evidence.
- States: fixture checks cover loading, empty, no-result, no-open-room, partial/stale,
  contract error/retry, unknown-enum, and permission evidence. A failed content
  source and a Writing compatibility fallback must not display an exact-total
  claim.

## Release evidence

- Staging SHA and checks: implementation PR #1495 merged at
  `0bfd1fa322c00ff04762981ca5d62ffbb842c252`. All seven push workflows
  succeeded on that SHA, including integrated tests, Next-native browser
  regression, and live Staging release smoke. The smoke verified matching
  frontend and backend deployment markers. Staging migrations 297–302 were
  applied and a second dry run found zero pending.
- Production verification (2026-09-24): advisory-locked migrations 297–302
  applied; ledger 6/6, five admin routines present, and dry run zero pending.
  Promotion PR #1497 merged at main SHA
  `c28b7b637c738a90b924e5eaa69e78fa5e88470b` after a passing Staging
  promotion gate. Vercel and Railway release markers were checked against that
  SHA; all seven main push workflows succeeded on the same SHA. Read-only
  admin smoke at `/admin/mock-tests` confirmed separate
  `Đề Mock Test` and `Kho đề nội dung` workspaces, populated exam and content
  lists, the no-open-room Live state, and Review's retake indicators. No exam,
  grade, or learner result was changed. The embedded Writing Queue loaded,
  but opening a Grade row was blocked by the deployed frame policy; see
  WRITINGNAV-0007 production evidence. The new same-origin-only policy fix
  requires a separate staging-first release and production recheck.
