# Verification

Evidence in this file distinguishes completed gates from post-merge production
checks. A production application SHA cannot exist before the promotion PR is
merged, so the assigned flag must remain off until that SHA is deployed and
verified.

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | `backend/tests/test_master30_grammar_diagnostic.py`; class-assignment and membership regression suites | PASS |
| FR-002 | fixed Quick/Full limits, history-aware selection, and cap tests in `backend/tests/test_master30_grammar_diagnostic.py` | PASS |
| FR-003 | answer secrecy, retry/conflict, and atomic final-answer tests in `backend/tests/test_master30_grammar_diagnostic.py` | PASS |
| FR-004 | concurrent finalization, immutable report, reload, and class-ledger regression tests | PASS |
| FR-005 | importer/migration boundary tests; production query proves 19 productive tasks and zero with automatic scoring enabled | PASS |
| FR-006 | package dry-run and staging/production queries prove the approved checksum and exact canonical counts | PASS |
| FR-007 | migration applied twice on staging; release/content mutation probes and transactional RPC probes passed | PASS |
| FR-008 | `frontend/tests/grammar-openapi-contract.test.mjs`, `frontend/tests/my-class-next-behavior.test.mjs`, TypeScript, and browser regression | PASS |

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

- Current local release suite: 24 passed; class assignment, My Class, and runtime
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

## Remaining production activation gate

- Merge promotion PR only after its current-head CI and exact-SHA promotion gate
  pass.
- Record the resulting main merge SHA, then wait for both production frontend and
  backend release markers to match it and pass live smoke.
- Only then enable `master30_grammar_diagnostic`; keep
  `master30_grammar_self_serve=false`, re-query the release/count/flag invariants,
  and retain the database flag as the immediate rollback switch.
