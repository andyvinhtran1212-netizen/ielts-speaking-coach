# Rollout and rollback

## Preconditions

- AVOC-0002 is approved on staging before implementation commits.
- Core-30 content validates with zero errors/warnings and immutable checksums.
- Migration 263 is additive, idempotent through the advisory-locked runner, and
  compatible with application code before bank import.
- Staging and production service credentials are loaded only in their scoped run.

## Staging

- Merge the pure validation/versioning foundation first.
- Validate the exact content/media package with that foundation, record zero
  errors/warnings and checksum evidence, then merge the inert content snapshot.
- Complete review of the high-risk runtime candidate, apply migration 263 from
  that exact candidate to staging, and verify policies, triggers, indexes, and
  constraints before merging any dependent runtime code.
- Merge the runtime PR and confirm all integrated workflows pass on the exact
  resulting staging SHA.
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

- First archive every active Advanced Vocabulary assignment as the backward-
  compatible kill switch; verify an assigned learner receives no payload from either
  the dedicated Advanced Vocabulary route or the legacy quiz route before and during
  rollback.
- Only after that verification, roll back application deployment while retaining
  additive tables and RLS. Do not delete submissions, attempts, immutable content
  versions, or redemption/history truth.
- Re-run the idempotent import to repair missing bank/question rows and compare
  expected 30 banks by code and 48-question counts before re-enabling assignments.

## Observability

- Watch CI/deploy conclusions, backend errors by Advanced Vocabulary route, missing
  asset responses, submission conflicts, and admin-result lookup failures.
- Treat any cross-user RLS visibility, answer leakage, checksum mismatch, or
  divergence between immediate and reload state as a release blocker.
- Product owner and platform operator own go/no-go and rollback decisions.
