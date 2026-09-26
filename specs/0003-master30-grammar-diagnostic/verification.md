# Verification

Evidence in this file distinguishes completed gates from post-merge production
checks. A production application SHA cannot exist before the promotion PR is
merged, so the assigned flag must remain off until that SHA is deployed and
verified.

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_master30_grammar_diagnostic.py::test_completed_report_full_reload_succeeds_after_deadline | PASS |
| FR-002 | kind=test; ref=backend/tests/test_master30_grammar_diagnostic.py::test_quick_and_full_have_fixed_objective_caps_and_two_phases | PASS |
| FR-003 | kind=test; ref=backend/tests/test_master30_grammar_diagnostic.py::test_identical_response_retry_returns_canonical_progress | PASS |
| FR-004 | kind=test; ref=backend/tests/test_master30_grammar_diagnostic.py::test_last_response_uses_atomic_finalize_rpc | PASS |
| FR-005 | kind=test; ref=backend/tests/test_master30_grammar_diagnostic.py::test_migration_keeps_productive_scoring_outside_objective_session | PASS |
| FR-006 | kind=test; ref=backend/tests/test_master30_grammar_diagnostic.py::test_approved_package_passes_manifest_and_pool_validation | PASS |
| FR-007 | kind=test; ref=backend/tests/test_master30_grammar_diagnostic.py::test_migration_guards_evidence_and_finalization_under_assignment_lock | PASS |
| FR-008 | kind=test; ref=frontend/tests/grammar-openapi-contract.test.mjs | PASS |

## Exact revision and CI evidence

- Reviewed implementation SHA: `71387a6b90052e6e53150f52c9ae2fc0ae807c87`.
- Integrated staging SHA: `408979f6aeca7abc76f509a2ea75d7134f3aa501`.
- Staging exact-revision release smoke run `35305334311`: 36 passed; frontend
  and backend release markers both matched `408979f6aeca7abc76f509a2ea75d7134f3aa501`.
- Staging runs on that SHA: tests `35305334284`, browser regression
  `35305334285`, type/OpenAPI `35305334405`, route ownership `35305334314`,
  spec governance `35305334303`, and legacy guard `35305334335`: PASS.
- Production promotion PR `#1449` was opened from exact staging SHA
  `408979f6aeca7abc76f509a2ea75d7134f3aa501`; promotion gate run
  `35305989603` matched that SHA and passed. Any remediation commit must repeat
  this exact-SHA gate before merge.

## Contract and data evidence

- Current local release suite: 25 passed; class assignment, My Class, and runtime
  flag regressions: 163 passed; frontend/My Class contracts: 39 passed;
  TypeScript strict and OpenAPI drift: PASS.
- Approved release key: `master30-86a55dc1c3a8e522`.
- Manifest SHA-256:
  `86a55dc1c3a8e5221eef9daa4772404f358ebb8f87c1284224e5197f58dbe531`.
- Both staging and production directly returned: 30 lessons, 733 runtime items,
  3,338 Q-matrix rows, 19 productive tasks, 16 routes, and 14 misconceptions.
- Both environments returned `live_calibrated_ready=false` and zero productive
  tasks with automatic scoring enabled.
- Staging flags after integrated smoke: assigned diagnostic `true`, self-serve
  `false`.
- Production dark launch: migration and content import/promote completed; five
  transactional RPCs and 13 grammar guard triggers were present; assigned
  diagnostic `false`, self-serve `false`.
- Rollback-only staging probes proved content/release immutability, one atomic
  28th response plus report, identical retry convergence, one assigned session,
  assignment-delete protection, and zero sessions after deadline.

## UI and behavior evidence

- The UI states the structural-alpha boundary, makes no IELTS-band claim, and
  keeps productive work outside automatic submission/scoring.
- Completed assigned reports remain readable after the deadline while ownership,
  active membership, and publication checks still apply. In-progress reads and
  all writes continue to enforce the deadline.
- During assigned-only beta, report actions return to My Class and do not route
  learners to the disabled self-serve entry.

## Remaining production activation gate — T007

- Promotion #1449 merged as `23bce5451aee23cf39566ecee5728b4073906e27`.
  The [2026-09-26 integration snapshot](../IMPLEMENTATION_STATUS.md) records a
  later verified deployment containing it. Code promotion is complete, closing T006.
- The dark-launch flag readback above is historical; re-query current flags and
  obtain the feature activation decision before changing them.
- After the remaining feature-specific smoke and activation authorization, enable
  `master30_grammar_diagnostic`; keep `master30_grammar_self_serve=false`,
  re-query release/count/flag invariants, and retain the database flag as the
  immediate rollback switch.
