# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_listening_content_programmes.py::test_publish_ready_package_passes_all_fr001_gates_and_dry_run_is_pure; companion=backend/tests/test_listening_content_programmes.py::test_publish_ready_package_fails_closed_for_every_fr001_gate | PASS |
| FR-002 | kind=test; ref=backend/tests/test_migration_295_listening_content_programmes_postgres.py::test_atomic_import_retry_is_idempotent_and_identity_conflicts_fail_closed | PASS |
| FR-003 | kind=test; ref=backend/tests/test_migration_295_listening_content_programmes_postgres.py::test_import_persists_complete_canonical_projection_and_legacy_defaults | PASS |
| FR-004 | kind=test; ref=backend/tests/test_listening_content_programmes.py::test_student_payload_strips_all_programme_review_material | PASS |
| FR-005 | kind=test; ref=frontend/tests/listening-programmes-next-behavior.test.mjs | PASS |
| FR-006 | kind=test; ref=backend/tests/test_listening_content_programmes.py::test_report_only_grading_separates_checked_unscored_and_blank | PASS |
| FR-007 | kind=test; ref=backend/tests/test_listening_content_programmes.py::test_deterministic_assembly_preserves_order_and_gap | PASS |
| FR-008 | kind=test; ref=frontend/tests/listening-landing-next-behavior.test.mjs | PASS |
| FR-009 | kind=test; ref=frontend/tests/listening-programmes-next-behavior.test.mjs | PASS |
| FR-010 | kind=test; ref=frontend/tests/listening-landing-next-behavior.test.mjs | PASS |
| FR-011 | kind=assertion; ref=frontend/types/api.d.ts | PASS |
| FR-012 | kind=test; ref=backend/tests/test_listening_mcq_sessions.py::test_analytics_separates_report_only_completion_from_diagnostic_scores | PASS |
| FR-013 | kind=test; ref=frontend/tests/listening-landing-next-behavior.test.mjs | PASS |
| FR-014 | staging package publish/archive transaction, reload truth, attempt-retention query, and exact-SHA promotion evidence | PENDING |

## Contract evidence

- Final reset baseline on 2026-09-21: the full backend suite passed 8,964 tests
  (30 optional fixtures skipped), including 13 migration-295 tests forced onto
  disposable PostgreSQL 16 with `REQUIRE_PG=1`. The full frontend contract
  suite passed 9,193 tests; React interaction passed 3/3; strict and legacy
  TypeScript passed. Next 16 production build compiled and generated all 152
  routes. The generic prerender fallback logged an expected local
  `ECONNREFUSED`, but build exit status was zero.
- OpenAPI/type drift: `frontend/types/api.d.ts` regenerated from the in-process
  FastAPI app after all response-model changes; TypeScript passed.
- Backward compatibility: retained legacy overview/test fields and diagnostic
  defaults are covered by the full relevant regression suites.
- Count consistency: local route/fake-database assertions pass; final public
  database counts after publish/archive remain staging evidence.

## Data evidence

- Content source: on 2026-09-21 the publish-package validator passed 2 packages,
  1,314 artifact hashes, 458 public JSON files, 390 audio files, 390 timing files,
  1,474 timing segments, and 2 visuals with zero failures. This is pre-
  implementation evidence, not final staging import evidence.
- Working hub: on 2026-09-21 all 34 unavailable historical symlinks were
  registered as `archived_unavailable`; the revised fail-closed validator
  reported zero unregistered broken links and zero registry failures. Candidate
  manifests remain outside active scope, and import reads only immutable
  publish-ready packages.
- Import projection dry run on 2026-09-21 passed both packages with zero
  mutations: 66 lessons/groups, 159 forms, 1,045 items, 390 stimuli/audio/timing
  files, 1,474 timing segments, and 2 visuals. All 159 forms have positive
  duration and `checked_item_count + self_review_item_count == item_count`.
- Publication now re-downloads and verifies the persisted SHA-256 attestation
  for every derived form WAV and visual before invoking the transactional
  status RPC; missing, wrong-size, or corrupt objects fail closed.
- Migration/schema contract: disposable PostgreSQL 16 ran migration 295 twice,
  imported and reconciled a fixture package, rejected generic package/child
  INSERT, UPDATE, and DELETE mutations, then passed manifest-bound publish and
  archive transitions. Staging application and live-schema query remain pending.
- Reconciliation: pending exact 2/66/159/1,045/390/390/2 source-to-database/object
  counts and zero undeclared/orphan entities.
- Immediate state versus full reload: pending start, save, submit, package publish,
  and package archive comparisons.

## UI evidence

- Production-current `/listening` was inspected in an authenticated browser on
  2026-09-21 to anchor the redesign against the existing chrome, typography,
  card density, and dark-theme spacing. The implementation now uses canonical
  `.shell` spacing, Listening-owned header/section classes, and moves legacy
  IELTS mode shelves under `/listening/ielts`.
- Candidate viewports/themes/input methods: pending staging 375, 768, and 1440px light/dark
  screenshots plus keyboard-only and screen-reader-name checks.
- States: pending loading, empty, populated, partial-data, error/retry, permission,
  resume/expired resume, mixed result, fully unscored result, and rolled-back
  package journeys.
- Design system source/token audit passed: canonical shell, Listening-owned
  classes, and no undefined or hardcoded color tokens in the new programme
  surfaces. Live light/dark, focus, 44px-target, reduced-motion, and assistive-
  name verification remains staging evidence.

## Release evidence

- Implementation is integrated. The current package publication and migration
  readback is maintained in the [Listening v1.1 verification record](../0007-listening-editorial-revision/verification.md).
  Both programmes are published; earlier pre-import expectations in this file
  are acceptance requirements, not a claim that deployment has not happened.
- Reconcile T011 against the published manifests and source/database/object counts.
  T012 protected-field sentinel, null-band query, publish/rollback drill,
  authenticated journeys and observation evidence remain open.
- The [2026-09-26 status ledger](../IMPLEMENTATION_STATUS.md) records the later
  integrated code deployment separately from those feature acceptance gates.
