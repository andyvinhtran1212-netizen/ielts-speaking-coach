# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_admin_ai_dashboard.py; models endpoint order, slot models and source labels for env, code default and DB override | PENDING |
| FR-002 | kind=test; ref=backend/tests/test_admin_ai_dashboard.py; Saigon window boundaries and per-feature/provider aggregation including unpriced, legacy and unattributed rows; rollup function on real PostgreSQL | PENDING |
| FR-003 | kind=test; ref=backend/tests/test_migration_321_ai_model_overrides_postgres.py; tables, CHECKs, RLS, grants, audit trigger, append-only audit, double application | PENDING |
| FR-004 | kind=test; ref=backend/tests/test_admin_ai_dashboard.py; 401/403 for non-admins, 422 allowlist rejections with no write, audit actor, refetched response | PENDING |
| FR-005 | kind=test; ref=backend/tests/test_ai_model_overrides.py; precedence, reorder-only semantics, Speaking slot placement, missing-key rule | PENDING |
| FR-006 | kind=test; ref=backend/tests/test_ai_model_overrides.py; snapshot TTL with a fake clock, background refresh, DB failure/timeout/missing table/invalid value fall back to env/code defaults | PENDING |
| FR-007 | kind=test; ref=backend/tests/test_ai_failure_log.py; router, with_fallback, Claude-after-Gemini and orchestrator records; enumerated fields only; write failure isolation | PENDING |
| FR-008 | kind=test; ref=backend/tests/test_admin_ai_dashboard.py; failure counts per provider/feature/outcome/error type and recent 50 ordering | PENDING |
| FR-009 | kind=test; ref=frontend/tests/react/admin-ai-panel.test.tsx; loading, empty, error/retry, save pending/settled, store states; both typecheck boundaries | PENDING |
| FR-010 | kind=journey; ref=specs/0024-admin-ai-model-control/rollout.md; staging migration before merge, staging journey, production migration before promotion | PENDING |

## Contract evidence

- OpenAPI/type drift: `frontend/types/api.d.ts` regenerated from the backend
  app in the implementation PR; drift check result recorded here.
- Backward compatibility: four new endpoints only; no existing response shape,
  default or chain changes. Existing router/orchestrator tests unchanged.

## Data evidence

- Migration/schema query: staging RLS/grant queries from `rollout.md` with the
  observed output, recorded after application.
- Immediate state versus full reload: the post-save models panel equals a
  reload of `/admin` (staging journey).

## UI evidence

- Viewports/themes/input methods: desktop and 390 px, light and dark, keyboard
  only for the window tabs, selects and Save.

## Release evidence

- Staging SHA and checks: recorded at T008.
- Production verification: recorded at T009.
