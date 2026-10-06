# Verification

## Requirement coverage

| Requirement | Evidence required before readiness | Result |
| --- | --- | --- |
| FR-001 | reviewer=primary operator with independent senior approval; environment=staging; date=2026-10-06; observed=frozen all30/3100 source IDs/hashes and live30-row catalog at50691a5360d66658c4273c9b426458be9f862977, approval/package bindings below. | MANUAL |
| FR-002 | reviewer=primary operator; environment=staging; date=2026-10-06; observed=actual subset/repeat B02/idempotent frozen starts, preserved12 history and hosted reload in bound live/browser receipts below. | MANUAL |
| FR-003 | reviewer=primary operator; environment=staging; date=2026-10-06; observed=real API MCQ/E persistence and concurrent practice/diagnostic race checks, with auth/type/deadline/retry covered by actual PostgreSQL tests below. | MANUAL |
| FR-004 | reviewer=primary operator; environment=staging; date=2026-10-06; observed=all3100 actual submissions and deployed before/after feedback, raw E/model/variants/rubric and no correctness/band claims in bound receipts. | MANUAL |
| FR-005 | reviewer=primary operator; environment=staging; date=2026-10-06; observed=all30 completed100–120 banks,90 objective denominator, actual teacher tally/E counts/reload, with lookup failures covered locally. | MANUAL |
| FR-006 | reviewer=primary operator; environment=staging; date=2026-10-06; observed=actual served exposure, diagnostic/practice pending and finalization races, frozen source closure, exclusion and honest exhaustion in bound live receipt. | MANUAL |
| FR-007 | reviewer=primary operator; environment=staging; date=2026-10-06; observed=generated OpenAPI/types/React local gates plus deployed all30 learner/teacher reload/mobile/theme journeys at exact50691a5360d66658c4273c9b426458be9f862977. | MANUAL |
| FR-008 | reviewer=primary operator; environment=production; date=2026-10-07; observed=exact frontend/backend deployments and required main CI at45bfd33e83f12fd4c9c772e7573c5cfb54290b4c, actual all30/3100 API3862/browser23378, post-browser observation, owned cleanup and enabled flag/controller release in bound receipts below. Historical staging acceptance remains bound to50691a5360d66658c4273c9b426458be9f862977. | MANUAL |

## Historical baseline

Before promotion, production serves12-question v2 with the full-bank flag off.
Original inventory3100=2700MCQ+400E:
each has90+10 core,14 banks retain100 extra writing backports. Old approval and
source mirror/shape validation cannot approve these full banks.

## Ownership and handoff

Independent senior reviewed product intent and approved the narrow existing-player
direction. Clarification before implementation: required output instructions are
visible before E submission; only answer-bearing model/variants/rubric are hidden.
Full-content review is now independently complete for all30/3100; it does not
inherit mini-practice approval. Exact frozen approval and package hashes follow.

Checkout `/Users/trantrongvinh/.codex/worktrees/grammar-full-original-banks/ielts-speaking-coach`,
branch `codex/master30-full-bank-runtime`, base staging/spec approval merge
`6b5091c746e3dd34e0cd4e543f7c7a8d89ba743c`. Source/primary checkout remain untouched.
Authors work on isolated release copies. No real learner acceptance mutations.

## Completed local implementation evidence (2026-10-06)

- Disposable local PostgreSQL18 on task-owned port55448:21 full-bank tests pass
  across focused runs,
  including100/120 completion,90 denominator, raw/ungraded E, same/conflicting
  retry, MCQ/E race, source/family/parallel exclusion, both practice/serve and
  practice/final-answer race orders, completed report preservation, flag pause,
  history erasure guard, canonical links over stale event metadata, browser-role
  denial and atomic migration replay/rollback. Original312 baseline9 pass.
- Content trust boundary14 pass: all-thirty fixture normalization/secrecy,
  exact senior/source/ID hash gate, incomplete approvals and transitive closure.
  Fixture text is not real-content approval.
- Selector/tally/legacy assignment focused run33 pass; full frontend contracts
  10596 pass,1 unrelated skip; React431 pass; strict/legacy TypeScript and
  production build pass.
- Actual built legacyv2 learner/teacher/subset/repeat/retry/reload/keyboard/mobile
  journey553 checks pass. This verifies preserved12-question history only.
  The updated dual-version verification runner also passed its553 legacy checks;
  full v3 browser evidence still requires the final approved package.
- The first full backend run passed10252 tests but had131 setup errors because
  the explicit local Grammar revision database URL was missing, and one failure
  because the migration README still named312 as the maximum. The README is
  corrected. The next run exposed a SQL_ASCII local database setup problem
  (127 Unicode-dependent failures); it was interrupted at7863 passes. A new
  UTF-8 database now hosts all CI fixtures:10508 passed,30 skipped (optional
  hosted/provider prerequisites),0 failures. Final post-integration full gate
  is superseded by the final post-integration gate below.
- Final rebuilt legacy browser verification passed584 checks, including the
  explicit light/dark theme assertions.
- Independent semantic approval is now complete for30/30 and3100/3100, including
  actual revised field rereads. Both authors froze exact release files; original
  source hashes/IDs/order remain preserved. The senior product audit found one
  review-evidence schema mismatch, closed by a strict two-schema adapter that
  rejects partial/conflicting parallel evidence without altering approval bytes.
- Actual approved package dry-run and integration pass: manifest SHA
  `4dce359f4d764f48960a2dda846290f8c8f02d4fa2da8ffb44a0bd48240ae70d`;
  q-matrix SHA `626b6f06ecbb10d292b52a86a38c6a23f58202748d0c23316315cc811f5e7983`.
  Post-integration focused43 tests pass, including real all3100 release
  inventory/public secrecy/feedback and UTF-8 raw E persistence.
- Built v3 all30 learner/teacher/native journey5145 checks pass, plus the
  separate mobile B02 retry/keyboard/theme path. Initial verifier newline
  normalization mismatch was corrected; an isolated B11 rerun passed411 checks
  after one local scrolling stall, and the complete final run passed all30.
- Final complete post-integration backend gate:10510 passed,30 skipped,
  0 failures. The explicit skips are paid Gemini smoke (1), opt-in disposable
  Docker/PostgREST (12), external live RLS/quiz prerequisites (16), and the
  source diagnostic package variable (1), separately verified when supplied.
  All changed full-bank actual PostgreSQL tests ran against UTF-8 fixtures.
- Final complete frontend contract gate:10658 passed,0 skipped,0 failures.
  Final React431 pass, strict/legacy types, production build, native legacy584
  and full-v3/all30 native5145 remain the affected-layer evidence. Spec21 and
  whitespace checks pass.
## Hosted integration and release status (2026-10-07)

- Intent PR1600 merged to staging at
  `6b5091c746e3dd34e0cd4e543f7c7a8d89ba743c`.
  Implementation [PR1602](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/1602)
  has head `ae463f0f2aba3e971e977a6921e157f5a2ab8cf5` and staging merge
  `8a7bca20b2ce30b2c2b77f96dc1719c72d39a3fa`.
- Final all-bank hosted staging acceptance used exact frontend/backend SHA
  `50691a5360d66658c4273c9b426458be9f862977`, after subsequent integrated
  Listening/Writing/Speaking changes. Later documentation-only commits must
  retain this historical binding; they do not inherit a new hosted SHA.
- Frozen independent approval SHA:
  `04d195eb11e336b45dc85800af5ea85513e884eed47eef3077dcd5c87728acf0`.
  Canonical approved package SHA:
  `e1ff52e60230a49f7e11e53720cd498e985e418abe9a1555b2ae301338c83d50`.
  Each bank preserves90 MCQ+10 core E;14 banks retain100 supplementary E,
  giving2700 MCQ+400 E. E remains raw/ungraded with reference feedback.
- Staging live API receipt:4355 checks passed, including all30 banks and all3100
  actual submissions, frozen/legacy histories, races, observation and
  post-browser verification. Deployed learner/teacher receipt:23378 checks
  passed across all30 banks/all3100 items, actual reload and mobile/themes.
  Application errors and app HTTP failures were zero.70 known Vercel preview
  toolbar CSP warnings were separately retained and classified only for this
  staging SHA; production has no such exception. The original failed browser
  run and diagnostic evidence remain preserved.
- All required exact-SHA staging push checks, including live Staging release
  smoke, passed. Synthetic staging identities/cohort/assignments/diagnostic
  history were removed with readiness=true; the full-bank flag remains on and
  its deleted QA controller was released. No real learner was assigned or
  modified.
- Migration313 is applied to staging and production with hash
  `2a382176a1b0c4af94cda2319d5c63129fbbc0527a035ee41050f5d950cca005`.
  Production used the advisory-locked migration runner. Service-role-only RPC
  permissions and the migration ledger were verified. The full-bank flag is
  now enabled after the exact production acceptance below.
- The user approved the combined Grammar/Listening/Writing/Speaking release.
  All31 reviewed Listening PNG assets were uploaded immutably to private
  production storage and their hashes/dimensions verified;149 private audio
  objects were independently checked for availability. Audio availability is
  not an all-audio semantic or byte-hash approval.
- Initial [promotion PR1608](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/1608)
  merged to main at `5f698eaa1aa0d1737affa422dae5bb75d0391159`.
  Its incomplete production QA exposed a missing canonical favicon and an
  operator figure selector issue; the owned fixtures were cleaned and the
  full-bank flag kept off. Original failures were preserved.
- Focused repairs [PR1610](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/1610)
  and [PR1612](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/1612)
  corrected browser verifier readiness waits. [PR1611](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/1611)
  declared the existing canonical favicon SVG. All required exact staging
  checks, live smoke and backend deployment passed at
  `5e639b39cc590948342023e3588aa14b93612e39` before promotion.
- Final [promotion PR1613](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/1613)
  merged that staging head to main at
  `45bfd33e83f12fd4c9c772e7573c5cfb54290b4c`; both trees are
  `41bd9034332f9a6890f0943c024bc5d14ac71c56`.
  Actual production frontend and backend deployments succeeded at this exact
  main SHA. All seven required main push workflows and their required jobs
  passed; the final production gate has no pending or failed checks.
- Fresh production acceptance at that exact SHA passed3862 live API checks,
  including all30 banks/all3100 actual submissions, history preservation,
  exposure races and post-browser observation. Deployed learner/teacher pages
  passed23378 checks over all30/all3100, reload, mobile and both themes.
  Production console/page errors, application HTTP failures and preview
  warnings were zero. The separate approved Listening/Writing/Speaking journey
  passed22 checks, including actual audio playback, private PNG/zoom, truthful
  Day29/61/77 states, Writing entry, Speaking modes and the canonical favicon.
- Observation after the deployed browser run passed; the activation window
  covered1785 seconds. All owned synthetic Auth/public users, cohort,
  assignments, Grammar/diagnostic history and all3 owned Listening attempts
  were erased. Readiness=true; the full-bank flag remains enabled and its
  erased QA controller was released. No real learner was assigned or modified.
  Earlier incomplete runs at this SHA had operator panel/admission timing
  failures; each was independently cleaned, archived and excluded from the
  successful fresh namespace. Failed evidence was never relabeled as success.

Private logs and review copies live under `/tmp/master30-fullbank-2026-10-06/`.
Hosted receipts are `staging-live-report.json`, `staging-browser-report.json`,
`staging-cleanup-report.json` and `staging-exact-gate.json`; production schema
and media prerequisites are `production-migration-proof.json`,
`production-listening-figures-proof.json` and
`production-listening-audio-availability-proof.json`. Production readiness is
bound by `production-deployment-proof.json`, `production-live-report.json`,
`production-browser-report.json`, `production-integrated-browser-report.json`,
`production-cleanup-report.json`, `production-owned-listening-cleanup-proof.json`
and `production-exact-gate.json`; the namespace-specific controller release
receipt proves the flag remains enabled. These operator files contain binding
and verification evidence; private synthetic identity grants are never committed.
T006–T008 are complete. Production readiness is verified at
`45bfd33e83f12fd4c9c772e7573c5cfb54290b4c`. This documentation update retains
the actual accepted SHA and does not claim a new all-bank deployment binding.
