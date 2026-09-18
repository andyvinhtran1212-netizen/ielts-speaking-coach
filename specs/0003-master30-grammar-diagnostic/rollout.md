# Rollout and rollback

## Preconditions

- MASTER30-0003 is approved on staging before implementation is merged.
- Package validation returns the locked manifest hash and exact canonical counts.
- Migration 283 is additive and idempotent; both runtime flags remain off.
- Required CI/review gates pass on the implementation commit.

## Staging

- Apply migration 283 twice to prove idempotency, import and promote the validated
  release, and query counts, policies, guards, active release, and default-off flags.
- Merge implementation to staging and wait for exact-SHA integrated CI and deploy.
- Enable only `master30_grammar_diagnostic`, keep
  `master30_grammar_self_serve` false, and run an assigned learner/admin journey.
- Treat content leakage, cross-user access, duplicate session/report, or reload drift
  as a release blocker.

## Production

- Require explicit product-owner authorization after staging evidence is green.
- Apply migration/import with both flags off, then promote staging to main through the
  repository promotion gate and verify the exact production SHA.
- Enable only the assigned diagnostic flag after frontend and backend are healthy.
- Verify login, My Class entry, session creation, completion, learner report, educator
  report, canonical counts, active release hash, and self-serve still off.

## Rollback and repair

- Disable `master30_grammar_diagnostic` first; do not delete releases, exposures,
  responses, reports, or class linkage.
- Roll application code back to the last known-good SHA while retaining additive schema.
- A validated retired release may be re-promoted, followed by count/hash comparison and
  an assigned smoke before re-enabling the flag.

## Observability

- Monitor deploy/health status, 5xx rate on diagnostic routes, authorization denials,
  session conflicts, finalization failures, and admin report lookup failures.
- Product owner owns go/no-go; platform operator owns flag rollback and data checks.
