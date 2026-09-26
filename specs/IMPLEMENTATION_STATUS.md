# Implementation and acceptance status

Reconciled on **2026-09-26**. This is a navigation ledger, not a replacement for
each feature's tasks or requirement evidence. `implementing` includes an existing
candidate or deployed implementation with unfinished acceptance. It does not
authorize activation, paid evaluation, content publication or schema changes.

## Integration snapshot

The repository audit verified staging
`b43fb676cb099d99f7f1e45e161b8e50e23caccd` and production
`27b80a4625fe2d99def6730a7c19dc6d4e35000d` from
[promotion #1527](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/1527).
Their trees match. All seven push workflows passed on each SHA; staging smoke
passed 36 tests and production frontend/backend markers matched the main SHA.
These are dated integration observations, not per-feature acceptance evidence.

## Feature ledger

| Spec / evidence | Implemented or recorded | Remaining acceptance / next action |
| --- | --- | --- |
| [SDD-0000](0000-sdd-foundation/verification.md) | Foundation shipped; governance and templates in use | Maintain the existing lifecycle and evidence rules. |
| [GRAMMAR-0001](0001-timed-grammar-midterm-assessments/verification.md) | Timed assessments, completion modes and bank preview code exist; the old all-open checklist is not an implementation inventory | Reconcile T001–T010 individually with their approved revisions; record hosted migration/bank invariants, terminal/retry/preview behavior and viewport/theme/keyboard evidence. Do not bulk-check from code presence. |
| [AVOC-0002](0002-advanced-vocabulary-self-paced/verification.md) | T001–T002 package/content evidence recorded | Runtime/RLS/concurrency proof, Course-5 association, controlled-rewrite gold evaluation and owner go/no-go remain separate gates. Preserve candidate branches and immutable media while reconciling them. |
| [MASTER30-0003](0003-master30-grammar-diagnostic/verification.md) | T001–T005 complete; promotion #1449 merged; recorded dark-launch schema/content evidence | T006 activation/readback remains open. Re-query current flags/counts and obtain the feature's activation decision; deployment alone does not establish the assigned diagnostic flag is enabled. |
| [AI-0004](0004-ai-model-usage-observability/verification.md) | Implementation #1452 and migration 286 are in the integrated tree; T001–T006 code evidence reconciled | T007 hosted ledger/privacy/persistence and admin reload evidence, billing reconciliation, controlled provider checks and observation window remain unverified. |
| [LISTENING-0005](0005-listening-content-programmes/verification.md) | T001–T010 complete; publication readback is maintained in LISTENING-0007 | Reconcile T011 import evidence with the current package manifests; finish T012 learner/admin journeys, rollback and observation evidence. |
| [LISTENING-0006](0006-listening-guided-feedback/verification.md) | T001–T008 complete; implementation #1490 is merged | T009 still needs feature-specific hosted migration/route/protected-content and authenticated journey evidence; the code is already integrated. |
| [MOCKOPS-0006](0006-admin-mock-test-operations/verification.md) | T001–T005 complete; migrations 297–302 and release evidence recorded | Finish the direct authenticated production operator journey after the Writing frame fix; immediate state and reload must agree. |
| [WRITINGNAV-0007](0007-writing-navigation-contract/verification.md) | T001–T003 implementation from #1495 reconciled; frame fix #1500 is integrated | T004 direct authenticated Writing drill-down, return context and reload acceptance remains open. |
| [LISTENING-0007](0007-listening-editorial-revision/verification.md) | v1.1 publication and migration 303 read back on both environments; v1.0 archived | Reconcile historical T003–T009 items individually. Deliberately failed-publish rollback rehearsal and authenticated mobile/screen-reader acceptance remain missing. Preserve two local editorial worktrees and their review ledger until comparison is complete. |
| [MOCKATTACH-0008](0008-mock-attempt-integrity/verification.md) | T001–T005 and subsequent retake-expiry fix integrated; production promotion completed | T006 focused learner/operator persisted-link, collect/advance and reload journey remains unverified. |

## Closing a row

The domain maintainer taking the next feature task owns the evidence update.
Record the tested SHA, environment, command or journey, result and limitations
in its `verification.md`; check only the corresponding completed tasks. Move to
`verified`/`shipped` only when the constitution's task and requirement gates are
met. Historical successful CI, a published package, and a clean Git worktree
cannot substitute for missing acceptance evidence.
