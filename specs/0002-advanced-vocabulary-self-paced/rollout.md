# Rollout and rollback

## Preconditions

- AVOC-0002 is approved on staging before implementation commits.
- Core-30 content validates with zero errors/warnings and immutable checksums.
- Migration 281 is additive, idempotent through the advisory-locked runner, and
  compatible with application code before bank import.
- Staging and production service credentials are loaded only in their scoped run.

## Staging

- Merge the pure validation/versioning foundation first.
- Validate the exact content/media package with that foundation, record zero
  errors/warnings and checksum evidence, then merge the inert content snapshot.
- Complete review of the high-risk runtime candidate, apply migration 281 from
  that exact candidate to staging, and verify policies, triggers, indexes, and
  constraints before merging any dependent runtime code.
- Run the versioned 60-submission Controlled Rewrite gold-cohort evaluation against
  the exact unmerged runtime candidate in the scoped evaluation environment, require
  every FR-011 quality/grounding/false-positive/latency/cost threshold to pass, force
  the solutions-only provider-failure fallback, and attach the reviewed report.
- Only after that report and the `C5` association evidence pass, merge the runtime PR
  and confirm all integrated workflows pass on the exact resulting staging SHA.
- Import exactly 30 assignment-only banks under the Advanced unpublished default,
  verify 48 rows per bank and the resolved `C5` UUID on all 30 with zero Advanced
  banks attached to `C4`, another course, or `NULL`, then explicitly publish all 30
  through the guarded publish-state transaction and confirm the `C5` cohort picker/
  list immediately and after reload.
- Complete one learner journey, reload progress, and compare admin results before
  and after reload; confirm Writing/Speaking produce no default grading.
- Record the exact staging SHA that owns both integrated CI and live Staging E2E.

## Production

- Require explicit owner authorization after staging evidence is green.
- Apply and verify migration 281 before merging staging to main.
- Immediately before merge, run the repository `Staging promotion gate`; require its
  recorded staging HEAD to equal the SHA owning both integrated CI and live Staging
  E2E evidence. Any intervening staging commit invalidates the evidence and restarts
  the exact-SHA checks.
- Monitor production deploy/health checks, then import and verify the same 30 banks;
  confirm their persisted course association equals the production `C5` UUID and none
  resolve to `C4`, another course, or `NULL`; explicitly publish them through the
  guarded transaction and confirm the `C5` cohort picker/list immediately and after
  reload before any assignment journey.
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
  expected 30 banks by code and 48-question counts. Deploy and verify a known-good
  guarded runtime at an exact SHA before re-enabling assignments; throughout recovery,
  prove both dedicated and legacy learner routes expose no payload. Republish an
  incomplete item only when `publish_at` has arrived and `due_at` remains open, or
  after an admin explicitly extends the deadline. A terminal submitted item may be
  republished with unchanged `due_at`, but must remain persisted-review-only with
  `accepting:false`.

## Observability

- Watch CI/deploy conclusions, backend errors by Advanced Vocabulary route, missing
  asset responses, submission conflicts, Controlled Rewrite provider-failure rate,
  latency/token/cost budget, and admin-result lookup failures.
- Treat any cross-user RLS visibility, answer leakage, checksum mismatch, or
  divergence between immediate and reload state as a release blocker.
- Product owner and platform operator own go/no-go and rollback decisions.
