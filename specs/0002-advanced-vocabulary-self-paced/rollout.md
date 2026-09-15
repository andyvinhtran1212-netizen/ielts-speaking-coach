# Rollout and rollback

## Preconditions

- AVOC-0001 is approved on staging before implementation commits.
- Core-30 content validates with zero errors/warnings and immutable checksums.
- Migration 263 is additive, idempotent through the advisory-locked runner, and
  compatible with application code before bank import.
- Staging and production service credentials are loaded only in their scoped run.

## Staging

- Merge the content-only snapshot, then the high-risk runtime PR to staging.
- Confirm all integrated workflows pass on the exact staging SHA.
- Apply/verify migration 263 policies, triggers, indexes, and constraints.
- Import exactly 30 assignment-only banks and verify 48 rows per bank.
- Complete one learner journey, reload progress, and compare admin results before
  and after reload; confirm Writing/Speaking produce no default grading.

## Production

- Require explicit owner authorization after staging evidence is green.
- Apply and verify migration 263 before merging staging to main.
- Monitor production deploy/health checks, then import and verify the same 30 banks.
- Smoke login, assignment open/resume, versioned audio/figure delivery, learner
  completion, and admin result visibility on the stable production domain.

## Rollback and repair

- Roll back application deployment while retaining additive tables and RLS.
- Disable or remove active lesson assignments to stop learner access; do not delete
  submissions, attempts, immutable content versions, or redemption/history truth.
- Re-run the idempotent import to repair missing bank/question rows and compare
  expected 30 banks by code and 48-question counts before re-enabling assignments.

## Observability

- Watch CI/deploy conclusions, backend errors by Advanced Vocabulary route, missing
  asset responses, submission conflicts, and admin-result lookup failures.
- Treat any cross-user RLS visibility, answer leakage, checksum mismatch, or
  divergence between immediate and reload state as a release blocker.
- Product owner and platform operator own go/no-go and rollback decisions.
