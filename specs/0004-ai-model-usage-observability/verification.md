# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | Implementation tests for event dimensions, provider extraction, retries, fallbacks, and idempotency | PENDING |
| FR-002 | Failure-injection tests proving ledger writes do not replay or block provider calls | PENDING |
| FR-003 | Effective-date and unpriced-resource pricing tests plus invoice reconciliation | PENDING |
| FR-004 | Admin aggregation tests for legacy/truncation metadata and cross-window Writing deduplication | PENDING |
| FR-005 | Model-default, Gemini request-shape, provider-order, and environment rollback tests | PENDING |
| FR-006 | Exact-SHA staging migration, provider smoke, monitoring, and promotion evidence | PENDING |
| FR-007 | Ledger payload assertions and admin authorization regression tests | PENDING |

## Contract evidence

- OpenAPI/type drift: pending implementation CI for the admin response additions.
- Backward compatibility: pending legacy-schema, model fallback, and unchanged
  learner-result contract tests.

## Data evidence

- Migration/schema query: pending staging inspection of columns and the full unique
  `usage_event_id` index.
- Immediate state versus full reload: pending admin dashboard comparison using the
  same date/provider/model filters.
- Idempotency: pending repeated event write and retry/fallback correlation queries.

## UI evidence

- Viewports/themes/input methods: pending admin desktop/mobile checks for loading,
  error, populated, legacy-warning, truncation-warning, and unknown-service states.
- Learner surfaces: no visible contract change; pending regression journeys confirm
  Speaking and Writing results remain readable after the provider changes.

## Release evidence

- Staging SHA and checks: pending implementation merge, full CI, migration 284,
  provider smoke calls, and 24–48 hour monitoring.
- Production verification: pending owner-authorized promotion after staging evidence
  and invoice reconciliation.
