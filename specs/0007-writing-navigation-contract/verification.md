# Verification

## Requirement coverage

Implementation PR #1495 and its staging merge record the commands, browser
evidence, and staging SHA. Production evidence is recorded only after deploy.

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=frontend/tests/admin-writing-navigation.test.mjs; Queue browser 27/27 includes URL/control/fetch and Back/Forward | PASS |
| FR-002 | kind=test; ref=frontend/tests/admin-writing-navigation.test.mjs; Status browser 17/17 and save-return/save-next write flows 2/2 | PASS |
| FR-003 | kind=test; ref=frontend/tests/admin-writing-navigation.test.mjs; Instructor Queue browser 18/18 and direct-link fallback | PASS |
| FR-004 | kind=journey; ref=frontend/tooling/verify-admin-writing-queue-flow.mjs; embedded Mock and exact/incomplete page correction | PASS |
| FR-005 | kind=journey; ref=frontend/tooling/verify-admin-writing-status-flow.mjs; Queue 390/768/1440, Writing hub dark/reduced-motion, focus and operational states | PASS |

## Contract evidence

- OpenAPI/type drift: no backend API or wire type change; strict TypeScript,
  Next production build, and 9,232 frontend contract tests passed locally and
  in exact-SHA staging CI.
- Backward compatibility: legacy `id` and source-less Grade links still load the
  essay; old page URLs default to 25 rows without assuming Queue provenance.

## Data evidence

- Migration/schema query: none for this frontend-only navigation contract.
- Immediate state versus full reload: Queue browser 27/27 compared filters,
  page, and 50-row page size through Queue → Status → Grade → Queue, reload,
  and Back/Forward; save-return without session sequence passed its write flow.

## UI evidence

- Viewports/themes/input methods: fixture browser checks at 390/768/1440,
  Writing hub light/dark and reduced-motion, and keyboard focus.
- States: fixture browser checks covered loading, empty, exact/incomplete
  total, stale/error/retry, permission, and direct-entry fallback.

## Release evidence

- Staging SHA and checks: approved spec PR #1494 merged before implementation
  PR #1495. Implementation merged at `0bfd1fa322c00ff04762981ca5d62ffbb842c252`;
  all exact-SHA staging workflows passed, including integrated CI, Next-native
  browser regression, and live Staging release smoke with matching frontend
  and backend deployment markers.
- Production verification: parent-release migrations 297–302 applied via the
  advisory-locked runner (ledger 6/6, five routines, zero pending). Promotion
  PR #1497 passed its Staging promotion gate. Main merge SHA, production
  deployment markers, health checks, and read-only Writing smoke remain
  pending until merge and deploy; no production SHA is inferred.
