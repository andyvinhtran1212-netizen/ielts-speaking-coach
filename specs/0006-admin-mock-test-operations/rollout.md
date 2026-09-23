# Rollout and rollback

## Preconditions

- Approved spec is merged to `staging` before any implementation commit in the
  release branch.
- Affected local backend, contract, browser, TypeScript, and build suites pass.
- Migration 296 remains additive and compatible with currently deployed code.
- The legacy Writing array route stays unchanged; deployment-order tests cover
  old frontend/new backend and new frontend/old backend fallback behavior.
- Staging and production service roles exist; the routine is not executable by
  public, anon, or authenticated roles.

## Staging

- Dry-run and then apply migrations with the advisory-locked repository runner.
- Re-run the runner to prove ledger/idempotent behavior; inspect routine owner,
  ACL, index, exact filtered total, ordering, and a zero-result query.
- Verify a forced content-source failure marks its subtotal incomplete, and a
  forced page-route 404 activates the visible legacy compatibility warning.
- Merge the implementation PR to `staging`, record its exact SHA, require
  integrated CI and live Staging E2E on that SHA, then exercise Manage/Create/
  Content, Live empty/open, Review, and Writing page-2 save-return journeys.

## Production

- Confirm `staging` has not moved since the green exact-SHA evidence.
- Dry-run and apply migration 296 with `ALLOW_PROD=1` through the advisory-locked
  runner before dependent code promotion.
- Open only the `staging` to `main` promotion PR, require the Staging promotion
  gate, merge without diverging feature commits, and verify deployed backend and
  frontend revisions equal the promoted SHA.
- Smoke the admin Mock Test landing, bounded content-bank query, and a read-only
  Writing queue filter without mutating exam or grading state.

## Rollback and repair

- Revert application code to the previous production SHA if a UI or service
  regression occurs; the additive routine/index may remain safely installed.
- Do not drop the routine or index in the same rollback. A later migration may
  remove them only after every deployed caller is absent.
- If routine results disagree with direct canonical queries, block promotion,
  capture filter parameters plus ordered IDs/counts, fix the routine, rerun
  reconciliation, and only then resume.
- No data rewrite is part of this change; repair must not alter essay status,
  grading results, cohort membership, or exam lifecycle truth.

## Observability

- Monitor backend 4xx/5xx and latency for exam-content and Writing queue routes,
  PostgreSQL routine errors, Vercel page errors, and Railway health after each
  environment deployment.
- Treat a count/page mismatch, unauthorized routine execution, missing filtered
  record, repeated stale-readback warning, or failed live E2E as a release block.
- Release owner: product/engineering operator performing the staging-first
  promotion and exact-SHA verification.
