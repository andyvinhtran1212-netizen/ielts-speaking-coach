# Verification

## Current implementation evidence — 2026-09-26

Approval PR #1453 preceded implementation PR #1452. The implementation is
present in the current staging/main tree; this file no longer describes the
implementation merge as future work. The additive ledger migration shipped
as **286_ai_usage_ledger.sql**, after the initial proposed number 284 was
occupied. The effective-dated catalog, per-attempt logger, provider integration,
model configuration and admin UI are implemented.

On the unchanged application code at staging base
`b43fb676cb099d99f7f1e45e161b8e50e23caccd`, the hygiene reconciliation reran:

- Backend: 61 passed across test_ai_usage_logger.py, test_ai_pricing.py,
  test_admin_usage.py, test_gemini_compat.py and test_grading_model_config.py.
- Frontend: 9 passed across admin-ai-usage-next-behavior.test.mjs and
  admin-writing-navigation.test.mjs (the latter belongs to WRITINGNAV-0007).
- Existing main SHA `27b80a4625fe2d99def6730a7c19dc6d4e35000d` has all
  seven integrated workflows successful, including TypeScript/OpenAPI.
  This verifies application integration, not provider billing or live ledger data.

## Requirement coverage

Automated implementation evidence is recorded below. Requirement acceptance
remains PENDING until its operational evidence is reconciled; mocked tests
do not establish hosted migration, provider behavior or invoice accuracy.

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_ai_usage_logger.py; local provider/event/idempotency tests pass; gap=live provider-attempt ledger query | PENDING |
| FR-002 | kind=test; ref=backend/tests/test_ai_usage_logger.py; local failure/legacy compatibility checks pass; gap=operational provider-failure readback | PENDING |
| FR-003 | kind=test; ref=backend/tests/test_ai_pricing.py; effective-date and unpriced-resource checks pass; gap=invoice reconciliation | PENDING |
| FR-004 | kind=test; ref=backend/tests/test_admin_usage.py,frontend/tests/admin-ai-usage-next-behavior.test.mjs; metadata, truncation and Writing deduplication checks pass; gap=live dashboard/full-reload comparison | PENDING |
| FR-005 | kind=test; ref=backend/tests/test_grading_model_config.py,backend/tests/test_gemini_compat.py; defaults/request shape checks pass; gap=bounded provider smoke and operational rollback evidence | PENDING |
| FR-006 | kind=check; ref=docs/audits/AI_MODEL_AND_USAGE_LEDGER_2026-09-18.md; implementation/rollout runbook exists; gap=target migration ledger, provider smoke and monitoring evidence | PENDING |
| FR-007 | kind=test; ref=backend/tests/test_admin_usage.py,backend/tests/test_ai_usage_logger.py; authorization/logger tests pass; gap=live ledger privacy readback | PENDING |

## Contract evidence

OpenAPI/type drift and the current full application CI pass. Local tests cover
legacy schema fallback, configured model defaults, and Writing deduplication
across reporting boundaries. The implementation does not imply hosted schema
or environment values match every code default.

## Data and UI acceptance still required

- Query the target migration ledger and usage_event_id unique index for migration
  286; record target and timestamp rather than infer application from the file.
- Compare dashboard immediate/reload totals against the same canonical ledger
  window, including legacy, truncated and unpriced states.
- Verify one row per attempted provider call, repeated event-write idempotency,
  failure status and absence of learner content/credentials in stored metadata.
- Reconcile regional Azure billing and other estimated costs with invoices.
- Record the remaining desktop/mobile/theme operational state checks.

## Release and operational acceptance

The application code is included in the current promoted main tree. No new
paid calls, database mutations, model switches or feature activation were
performed by the repository-hygiene task. T007 remains open for bounded
provider smoke, 24–48 hour observation, target schema evidence and cost
reconciliation from the rollout plan. Status is implementing, not shipped.
