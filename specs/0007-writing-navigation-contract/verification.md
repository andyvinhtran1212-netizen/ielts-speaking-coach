# Verification

## Requirement coverage

Implementation PR #1495 and its staging merge record the commands, browser
evidence, and staging SHA. Production evidence below distinguishes the shipped
Queue from a frame-policy regression discovered during direct admin smoke.

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
- Production verification (2026-09-24): parent-release migrations 297–302
  applied via the advisory-locked runner (ledger 6/6, five routines, zero
  pending). Promotion PR #1497 passed its Staging promotion gate and merged at
  main SHA `c28b7b637c738a90b924e5eaa69e78fa5e88470b`; Vercel and Railway
  release markers matched and all seven main push workflows succeeded. Read-only
  `/admin/mock-tests?tab=writing` smoke
  loaded the embedded Mock Writing Queue and its canonical rows. Opening a
  Grade row then showed a browser “refused to connect” frame error. The Queue
  navigates within the cockpit iframe to `/admin/writing/grade`, but
  `next.config.ts` allowed same-origin framing only for the Queue; the Grade
  and Status destinations inherited `X-Frame-Options: DENY` and
  `frame-ancestors 'none'`. This is a production regression, not a passing
  end-to-end Writing smoke. A narrowly scoped same-origin-only allowlist fix
  for Grade and Status is verified locally but must pass staging, be promoted
  by the release owner, and be rechecked on the resulting production SHA.
