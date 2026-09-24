# Verification

## Requirement coverage

The implementation PR records exact commands, browser evidence, and final SHAs.

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=frontend/tests/admin-writing-navigation.test.mjs; Queue browser URL/control/fetch and Back/Forward journey | PENDING |
| FR-002 | kind=test; ref=frontend/tests/admin-writing-navigation.test.mjs; Queue → Status → Grade → Queue/save-next browser journey | PENDING |
| FR-003 | kind=test; ref=frontend/tests/admin-writing-navigation.test.mjs; Instructor return and direct-link journey with stale Queue storage | PENDING |
| FR-004 | kind=journey; ref=frontend/tooling/verify-admin-writing-queue-flow.mjs; embedded Mock and exact/incomplete page correction | PENDING |
| FR-005 | kind=journey; ref=frontend/tooling/verify-admin-writing-status-flow.mjs; 390/768/1440, themes, focus, and operational states | PENDING |

## Contract evidence

- OpenAPI/type drift: no backend API or wire type change; verify strict TypeScript.
- Backward compatibility: legacy `id` and source-less Grade links still load the
  essay; old page URLs default to 25 rows without assuming Queue provenance.

## Data evidence

- Migration/schema query: none for this frontend-only navigation contract.
- Immediate state versus full reload: compare filters, page, and page size before
  and after Queue → Status → Grade → Queue, save, reload, and Back/Forward.

## UI evidence

- Viewports/themes/input methods: fixture browser checks at 390/768/1440,
  light/dark, keyboard focus, and reduced motion.
- States: loading, empty, exact/incomplete total, stale/error/retry,
  permission, and direct-entry fallback.

## Release evidence

- Staging SHA and checks: pending separate spec merge, implementation PR,
  integrated CI, live Staging E2E, and exact-SHA smoke.
- Production verification: pending advisory-locked parent-release migrations,
  staging-to-main promotion, production SHA match, and read-only Writing smoke.
