# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | Official package validator plus importer rejection tests for release binding, inventory, hashes, counts, path traversal, expanded size, signatures, and protected fields | PENDING |
| FR-002 | Same-manifest rerun, conflict-manifest, interrupted upload, and reconciliation tests plus staging row/object query | PENDING |
| FR-003 | Migration tests, schema query, source-to-row reconciliation, and legacy-default regression | PENDING |
| FR-004 | Answer-leak tests, transcript pre/post-submit journeys, private-bucket checks, and signed-access tests | PENDING |
| FR-005 | Imported form/result assertions for policies and prohibited-claim sentinel tests | PENDING |
| FR-006 | Response-type mapping tests and mixed/fully-unscored result journeys | PENDING |
| FR-007 | Deterministic assembly golden tests for one/three/four/ten/fifteen stimuli, offset bounds, duration, hash, and retry | PENDING |
| FR-008 | Hub contract/source tests plus populated/resume/empty/partial/error screenshots and journeys | PENDING |
| FR-009 | General 56-lesson grouping, 143-form reconciliation, filters, detail, progress, and wording sentinels | PENDING |
| FR-010 | IELTS hub mode separation and existing deep-link regression journeys | PENDING |
| FR-011 | Generated OpenAPI type drift, runtime guards, old-field compatibility, pagination, and count-consistency tests | PENDING |
| FR-012 | Analytics fixtures mixing diagnostic/report-only attempts and null-band database query | PENDING |
| FR-013 | UI review, token/hex/undefined-token tests, light/dark screenshots, 375/768/1440px overflow, keyboard, focus, target, and reduced-motion evidence | PENDING |
| FR-014 | Staging package publish/archive transaction, reload truth, attempt-retention query, and exact-SHA promotion evidence | PENDING |

## Contract evidence

- Targeted baseline on 2026-09-21: backend 60/60 passed; frontend 116/117
  passed. The sole failure is the stale legacy analytics fixture path tracked by
  T002, not a product-flow assertion. Full-green rerun evidence is pending.
- OpenAPI/type drift: pending generated-type CI for overview, programme, lesson,
  form, result, publish, and archive contracts.
- Backward compatibility: pending old landing/list consumer tests with retained
  overview/test fields and legacy IELTS diagnostic defaults.
- Count consistency: pending assertions that overview, programme lists, lesson
  detail, and database public counts agree after publish/archive.

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
- Migration/schema query: pending package, lesson, source-form uniqueness,
  programme/scoring defaults, RLS/grants, and immutable-state checks.
- Reconciliation: pending exact 2/66/159/1,045/390/390/2 source-to-database/object
  counts and zero undeclared/orphan entities.
- Immediate state versus full reload: pending start, save, submit, package publish,
  and package archive comparisons.

## UI evidence

- Viewports/themes/input methods: pending 375, 768, and 1440px light/dark
  screenshots plus keyboard-only and screen-reader-name checks.
- States: pending loading, empty, populated, partial-data, error/retry, permission,
  resume/expired resume, mixed result, fully unscored result, and rolled-back
  package journeys.
- Design system: pending canonical shell, `--av-*` only, no new legacy tokens or
  hardcoded colors, Plus Jakarta/mono roles, focus, 44px targets, and reduced-
  motion verification.

## Release evidence

- Staging SHA and checks: pending approved spec, implementation merge, migration,
  targeted and full relevant suites, exact package manifest hashes, import
  reconciliation, publish/rollback drill, and observation.
- Production verification: pending owner-authorized staging-to-main promotion,
  production migration, non-public import, sequential package publication, exact
  SHA, public counts, protected-field sentinel, null-band query, and smoke journeys.
