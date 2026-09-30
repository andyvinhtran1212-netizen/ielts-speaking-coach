# Verification

## Requirement coverage

Local code and deterministic gold gates are recorded below. Required exact-SHA
staging/production and operational evidence remain open; status stays approved.
Tests use an owned synthetic PostgreSQL database, never production records.

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=pytest backend/tests/test_dictation_lexical_policy.py; detail=53 independently reviewed labels, raw codepoint spans/shell/dash/elision/sign cases; Unicode15 classification parity in backend/tests/test_dictation_unicode_policy.py | PASS |
| FR-002 | kind=test; ref=pytest backend/tests/test_dictation_lexical_policy.py; detail=Full lexical operations/filler/alignment and invalid/ambiguous admission checks; current equality/extra policy preserved | PASS |
| FR-003 | kind=test; ref=pytest backend/tests/test_dictation_grading_routes.py; detail=Frozen start/answer/retry/complete/read identity, source-edit preservation, lost ACK; real PG parent/report identity in backend/tests/test_dictation_grading_postgres.py | PASS |
| FR-004 | kind=test; ref=node --test frontend/tests/listening-dictation-versioned.test.mjs; detail=N-1 missing-both bounded recovery, explicit v1 nullable saved answer inheritance, stale identity rejection; actual route legacy fingerprint/HTTP completion tests | PASS |
| FR-005 | kind=test; ref=pytest backend/tests/test_dictation_admin_policy.py; detail=Full-filter version counts, unchanged mean of session scores, null/bool/nonfinite failure and header validation before projection; existing trend classification controls retained | PASS |
| FR-006 | kind=test; ref=node frontend/tooling/verify-dictation-versioned-flow.mjs; detail=Local production-Next intercepted learner/admin v1/v2/raw text/owned reload/no-write/error journeys; actual React controls in frontend/tests/react/listening-dictation-versioned.test.tsx. Physical accessibility and deployed matrix remain pending | PENDING |
| FR-007 | kind=test; ref=pytest backend/tests/test_dictation_lexical_policy.py; detail=docs/quality/dictation-lexical-v2-gold.md and .json record all53 old/new operations/counts/spans, selected-group means,0 label deviations/0 unintended legacy-control changes/0 history writes; independent root/engineering label approval | PASS |
| FR-008 | kind=test; ref=pytest backend/tests/test_dictation_grading_postgres.py; detail=Default historical repair disabled; immutable originals/header/report guarded. Reviewed decision retains missing frozen evidence as unknown and authorizes no repair. Any future opt-in repair requires separate full dry-run/authorization/restore proof | PENDING |
| FR-009 | kind=test; ref=pytest backend/tests/test_dictation_grading_routes.py; detail=Concrete OpenAPI/generated types/ownership plus actual PostgreSQL additive compatibility. Exact-SHA staged migration/live old-new consumer/historical preservation evidence pending | PENDING |
| FR-010 | kind=test; ref=node frontend/tooling/verify-dictation-versioned-flow.mjs; detail=Local flag-off existing v2 completion/retry and classification labels verified; flag defaults false. Real staged enablement/monitoring/promotion/rollback/deployed SHA pending | PENDING |

## Contract evidence

- Actual affected backend:370 passed,9 warnings,0 skipped with the explicitly
  configured owned PG prerequisite. This includes source/header identity, foreign
  key deletion boundaries, immutable answers/reports and real SQL lexical parity.
- Whole backend on the integrated base:9402 passed,355 unrelated optional/live/smoke
  skips,13 warnings. Required Dictation and Reading PG tests actually ran.
- Final root whole Node contracts:9341 passed,2 existing skips. Affected Dictation
  Node:102/102; React:18/18 after independent report-mean/count verification.
- Offline current FastAPI OpenAPI regenerated with pinned openapi-typescript7.13.0
  is byte-identical to frontend/types/api.d.ts. Both main/legacy TypeScript and production Next build passed sequentially.
  Final intercepted browser47/47 with0JS errors; learner12/12, admin20/20 and
  standalone16/16 compatibility gates passed on that build.
- Independent frontend review preserves null historical sentence/summary values,
  raw source text, P04 extra-full-credit policy and four-decimal score rounding.
  Contradictory v2 sentence or session scores and coerced v2 counts fail before
  clearing a durable completion receipt; legacy policy remains unchanged.

## Gold and review evidence

- Full committed report: docs/quality/dictation-lexical-v2-gold.md/.json.
  53 labels,49 valid grades,4 invalid references;28 score changes,14 denominator
  changes,31 operation changes. Nine legacy controls have0 unintended deviations.
- Four deidentified production patterns are selected sentences, not entire original
  sessions or a303-session repair cohort. Two selected-group means0.9059→1.0 do
  not imply repaired historical session scores. No audio audit or human IELTS rater
  evaluation is claimed; this deterministic policy uses no paid provider.
- Final independent source-bound review approved the four-file report-mean/receipt
  delta, durable gold and migration bookkeeping. It reproduced200 adversarial
  assertions against actual backend grades/reports and all53 durable outputs.
- Root/engineering independently approved all labels. Final independent127 tests
  compare actual Python3.11/UCD14 and3.12/UCD15,53 full grades plus10 adversaries,
  pinned747 lexical/192 combining ranges, all SQL boundaries and identity races.
  These overlap other suites and their counts are not added.
- Pinned classifier eliminates POSIX/runtime category and combining-class drift
  without changing existing equality normalization or legacy grading.

## Data and repair decision

Migration305 is additive; no migration/deploy/startup enables v2 or regrades any
record. Existing NULL version/hash stays legacy; compatible new starts explicitly
negotiate policy. Owned v2 work remains readable/gradeable/finishable with starts
flag off. Caller legacy idempotency fingerprints remain byte-compatible.

Historical repair is disabled. This is an explicit reviewed default decision,
not approval of any repair scope or implementation. Missing original evidence
cannot be replaced with current text. A requested repair needs a separately
reviewed complete bounded dry-run and staging restore evidence before writes.

## Release evidence

- Approved behavior landed separately at9e548f3d. Implementation base is
  2b7fa5b6a2da43012586cc158395bf4d5715b70a; implementation commit
  91a3cd68e575a10583773de53f97aa73b87aaf2f; PR1561 targets staging.
- PR1561 first head a7e0d504d817dbdd6c87fff569f44bab030ef51c passed the
  backend/frontend/type/OpenAPI/build/spec gates but failed one N-1 browser
  assertion. Independent diagnostics observed the saved-to-loading-to-owned-read
  lifecycle; five targeted runs passed the old predicate, so exact CI failure
  reproduction is not claimed. The historical red run is retained.
- Round2 verification commit c8c8b5315bdc19f4fd1c761f0e2058097ee4a406 changes only
  the runner and its failure artifact. It awaits the final owned GET and rendered
  report before the unchanged score-count/reference-count/zero-POST predicate.
  Independent source-bound review passed20 workflow checks; root production-Next
  browser47/47 with0JS errors and whole Node9341 passed/2 existing skips passed.
  The preceding sandbox run's two socket EPERM failures are retained; permitted
  localhost sockets resolved those failures without changing assertions.
- Migration305 was applied with the canonical advisory-locked runner to staging
  only after a one-migration dry-run. Ledger294 records checksum
  5e2921c62b973638c718a7bc1e2c35bf02fe471a8db8ea5e6e6e86556be7f8af.
  Hosted verification matched all six SQL function bodies, eight nullable columns,
  validated constraints/triggers/private role grants and six Unicode controls.
  Old-field fingerprints of four existing attempts and zero answer/report rows
  were unchanged. This small staging population does not prove production history
  preservation. No flag enablement or historical data write occurred.
- Round2 GitHub CI, staging frontend/backend deployed SHAs: PENDING.
- Staged classification/new-write/rollback/unchanged history evidence: PENDING.
- Exact verified staging promotion and production front/backend SHAs: PENDING.
- Enabled scope, observation counters and version-specific rollback: PENDING.

Historical failed local build/test concurrency logs are retained in external
remediation evidence. Build generated the shared runtime while contracts checked
its committed default; the clean sequential final Node run passed. They are not
counted as passing tests. Local synthetic results never certify live release.
