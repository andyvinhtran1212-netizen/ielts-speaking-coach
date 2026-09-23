# Tasks

- [x] Resolve assisted-completion product decision in the 2026-09-23 task.
- [x] Land the approved spec on `staging` before implementation.
- [x] Audit existing player, report-only grader, answer RPC, and protected-field
  boundaries against FR-001–FR-009.
- [x] Add backward-compatible reveal ledger migration and disposable-PostgreSQL
  tests for ownership, idempotency, and first-answer immutability.
- [x] Add typed reveal/state endpoints with no-unrevealed-key tests; regenerate
  frontend OpenAPI types.
- [x] Connect the continuous and guided player UI to canonical save/reveal/
  resume state, including mixed objective/self-review feedback.
- [x] Verify audio/replay/transcript restrictions and assisted result/history/
  analytics separation.
- [x] Run affected full local suites and UI/accessibility/theme checks; review
  one consolidated implementation diff before pushing.
- [ ] Stage migration and release behind the endpoint gate; record exact-SHA
  staging evidence and promotion/rollback readiness.
