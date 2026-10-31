# Implementation and acceptance status

Reconciled on **2026-09-26** (0000–0008) and **2026-10-31** (0009–0040, staging
`11bbfd227fbe39815758f4ffa470cffaa7059cb3`). This is a navigation ledger, not a replacement for
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
| [MASTER30-0003](0003-master30-grammar-diagnostic/verification.md) | T001–T006 complete; promotion #1449 merged; recorded dark-launch schema/content evidence | T007 activation/readback remains open. Re-query current flags/counts and obtain the feature's activation decision; deployment alone does not establish the assigned diagnostic flag is enabled. |
| [AI-0004](0004-ai-model-usage-observability/verification.md) | Implementation #1452 and migration 286 are in the integrated tree; T001–T006 code evidence reconciled | T007 hosted ledger/privacy/persistence and admin reload evidence, billing reconciliation, controlled provider checks and observation window remain unverified. |
| [LISTENING-0005](0005-listening-content-programmes/verification.md) | T001–T010 complete; publication readback is maintained in LISTENING-0007 | Reconcile T011 import evidence with the current package manifests; finish T012 learner/admin journeys, rollback and observation evidence. |
| [LISTENING-0006](0006-listening-guided-feedback/verification.md) | T001–T008 complete; implementation #1490 is merged | T009 still needs feature-specific hosted migration/route/protected-content and authenticated journey evidence; the code is already integrated. |
| [MOCKOPS-0006](0006-admin-mock-test-operations/verification.md) | T001–T006 complete; migrations 297–302 and release evidence recorded | T007: finish the direct authenticated production operator journey after the Writing frame/embed fixes; immediate state and reload must agree. |
| [WRITINGNAV-0007](0007-writing-navigation-contract/verification.md) | T001–T004 implementation/release from #1495/#1497 reconciled; frame/embed fixes #1500/#1503 are integrated | T005 direct authenticated Writing drill-down, return context and reload acceptance remains open. |
| [LISTENING-0007](0007-listening-editorial-revision/verification.md) | v1.1 publication and migration 303 read back on both environments; v1.0 archived | Reconcile historical T003–T009 items individually. Deliberately failed-publish rollback rehearsal and authenticated mobile/screen-reader acceptance remain missing. Preserve two local editorial worktrees and their review ledger until comparison is complete. |
| [MOCKATTACH-0008](0008-mock-attempt-integrity/verification.md) | T001–T005 and subsequent retake-expiry fix integrated; production promotion completed | T006 focused learner/operator persisted-link, collect/advance and reload journey remains unverified. |

## Grammar remediation approval checkpoint — 2026-10-01

The separate spec-only change approves the synchronized twelve-code
GRAMMARCUTOVER-0014 amendment and GRAMMARTEXT-0015 contract. Exact technical
review, authored-source approval and immutable bounds are recorded in
[approval.md](0015-grammar-exact-form-policy/approval.md). Approved intent must
land on the base before new feature code; no implementation/migration is included.

| Spec / evidence | Approved or recorded | Remaining acceptance / next action |
| --- | --- | --- |
| [GRAMMARCUTOVER-0014](0014-grammar-bank-revision-cutover/verification.md) | Independent twelve-code technical amendment/source bindings; historical six-code/erasure approvals retained | All10FR PENDING: additive schema/grants/actual PostgreSQL races, immutable history/cohort/reset/admission proof, missing staging predecessors, fresh canonical extras/why_wrong/backup, exact deployed SHAs and explicit single-final-bundle cutover/rollback. |
| [GRAMMARTEXT-0015](0015-grammar-exact-form-policy/verification.md) | Exact final18 authored-source hashes independently approved;75question/133field/fivearticle deltas;49exact/9legacy text policies | All12FR PENDING: raw META/canonical wire ownership, typed matching ACK, pure preflight/engine activation, lost ACK/reset-stale/terminal/history behavior, actual map persistence, canonical publication and staging/production release. Source approval does not close feature gates. |

## Spec status reconciliation — 2026-10-31

Checked against staging `11bbfd227fbe39815758f4ffa470cffaa7059cb3` with
`git log origin/staging --grep=<SPEC-ID>`, the migration files in
`backend/migrations/` and the merged pull requests (including reverts). A spec
moves from `approved` to `implementing` only when implementation is merged on
staging and still present after any revert. `implementing` does not close any
acceptance gate. "Tasks" counts ticked `T` boxes in `tasks.md` after this
change. Specs marked *deferred* have an open pull request that edits their
`spec.md`/`tasks.md`, so their status was left for that pull request.

| Spec | Status | Tasks | Implementation on staging / note |
| --- | --- | --- | --- |
| [LISTENING80-0009](0009-listening-80-days/verification.md) | implementing (was approved) | 7/10 | #1558 (migration 304). T008–T010 open. |
| [LEARNERDRAFT-0010](0010-learner-draft-preservation/verification.md) | implementing | 5/8 | Unchanged. |
| [DICTATIONTOKEN-0011](0011-versioned-dictation-token-grading/verification.md) | implementing (was approved) | 7/9 | #1561 (migration 305). T008–T009 open. |
| [READINGGRAMMAR-0012](0012-reading-grammar-focus-edit/verification.md) | implementing | 5/8 | Unchanged. |
| [WRITINGMODAL-0013](0013-writing-content-modal-history/verification.md) | implementing | 5/6 | Unchanged. |
| [GRAMMARCUTOVER-0014](0014-grammar-bank-revision-cutover/verification.md) | approved (*deferred*, #2071) | see tasks | Migration 309 landed with #1563. Status change left to #2071. |
| [GRAMMARTEXT-0015](0015-grammar-exact-form-policy/verification.md) | implementing (was approved) | 17/21 | #1563 (exact-form engine, typed ACK, reset marker). #1979 is the docs-only Revision 1. Staging cutover and promotion tasks open. |
| [MOCKREPAIR-0016](0016-mock-content-remediation/verification.md) | implementing (was approved) | 6/13 | Own migrations 306–308, 310, 311, 315, 316; #1574, #1597, then #1886, #1891, #1893, #1951, #1956. T007 partial. |
| [GRAMMARLESSON-0017](0017-grammar-lesson-assignments/verification.md) | approved (*deferred*, #2074) | 6/8 | #1569 (migration 312). Status change left to #2074. |
| [MASTER30FULL-0018](0018-master30-full-bank-assignments/verification.md) | shipped | 8/8 | Unchanged. |
| [GRAMMARAUDIT-0019](0019-grammar-audit-remediation/verification.md) | implementing (was approved) | 7/17 | #1623/#1625 (migration 314); Revision 1 #1861, #1850; Revision 2 #1940 (migration 339). Revision 2/3 owner approval is still recorded as awaiting in `approval-decision.md`. |
| [VOCABSETS-0020](0020-vocabulary-class-sets/verification.md) | implementing (was approved) | 7/9 | #1662 (migration 317). T008–T009 open. |
| [READINGPRACTICE-0021](0021-reading-practice-support/verification.md) | implementing | 8/9 | Unchanged. |
| [REVEXPLAIN-0022](0022-revision-explanation-binding/verification.md) | implementing | 7/8 | Unchanged. |
| [SECWRITE-0022](0022-client-write-privilege-lockdown/verification.md) | implementing (was approved) | 5/10 | #1719 and #1721 (migration 320). T004 ticked from #1717. Amendment 1 migrations 349/351 are not merged. |
| [REVEXPLAIN-0023](0023-revision-explanation-key-equivalence/verification.md) | implementing | 4/4 | Unchanged. |
| [AIOPS-0024](0024-admin-ai-model-control/verification.md) | implementing (was approved) | 8/9 | #1837 (migration 322). T008 staging journey partial. |
| [WRITINGRATE-0025](0025-writing-grade-ratings-feedback-version/verification.md) | implementing (was approved) | 3/5 | #1834 (migration 321), test #1922. T003 rating round trip pending. |
| [ROLECHECK-0026](0026-users-role-single-check/verification.md) | implementing (was approved) | 7/8 | #1743 (migration 323). T008 real instructor promotion pending. |
| [ASSIGNDRAFT-0027](0027-writing-draft-assignment-delete-guard/verification.md) | implementing (was approved) | 9/9 | #1744 (migration 324), Revision 1 #1872. All tasks ticked; requirement evidence not re-checked here. |
| [CODEUNIQ-0028](0028-access-code-unique-canonical/verification.md) | implementing (was approved) | 8/8 | #1748 (migration 325). All tasks ticked; requirement evidence not re-checked here. |
| [STUDENTARCHIVE-0029](0029-student-archive/verification.md) | implementing (was approved) | 9/12 | #1746 (migration 326). T008 staging AC run partial. |
| [CLASSARCHIVE-0030](0030-class-archive/verification.md) | approved (*deferred*, #2059) | 4/14 | #1900 (migration 337), migration 346. Status change left until #2059 lands. |
| [GIVEARCHIVE-0031](0031-archived-learner-give-guard/verification.md) | implementing (was approved) | 6/8 | #1756 (migration 331). T007 staging journey partial. |
| [ADMINAAL2-0032](0032-admin-aal2-staff-guard/verification.md) | approved (*deferred*, #2023) | 12/17 | Present: migrations 332, 336, 345; #1855, #1880, #1884, #1885, #1896, #1928. Reverted by #2030: #1898 (re-landed by #2035), #1936 and #1996 (not re-landed; the applied 352 file is kept by `b47ba2015`). |
| [AIBUDGET-0033](0033-ai-budget-hard-cap/verification.md) | approved (*deferred*, #1945) | 4/14 | Present: T001 #1883, T002 #1889 (migration 333), T003 #1905 (dormant after the revert), T005 #1925, migration 340 #1931. T004 #1927 (and test fix #1958) reverted by #2025, not re-landed. |
| [ACTIVATELIMIT-0034](0034-activate-attempt-rate-limit/verification.md) | implementing (was approved) | 6/7 | #1847 (migration 334). T006 11-attempt probe pending. |
| [INACTIVEWRITE-0035](0035-inactive-learner-rest-write-guard/verification.md) | implementing (was approved) | 4/5 | #1829 (migration 335), tests #1917. T004 REST probes pending. |
| [ASYNCAUTH-0036](0036-async-db-auth-layer/verification.md) | approved (*deferred*, #2097) | 5/7 | #1857, #1890, #1910, Revision 2 #1929. Status change left to #2097. |
| [PAPERUPDATEDAT-0037](0037-mock-paper-updated-at-and-hide-warning/verification.md) | implementing (was approved) | 6/7 | #1877 (migration 338). T005 visibility-toggle probe pending; Amendment 1 (FR-006, #2014): migration 353 not merged. |
| [STORAGELIMITS-0038](0038-storage-bucket-limits/verification.md) | approved (*deferred*, #2107) | 1/5 | No implementation merged; migration 343 is in open #2107. |
| [RLSCLEANUP-0039](0039-rls-admin-policy-cleanup/verification.md) | approved (*deferred*, #2117) | 1/5 | No implementation merged; migration 344 is in open #2117. |
| [VOCABGUARD-0040](0040-vocab-curated-published-child-guard/verification.md) | approved | 0/3 | No implementation merged; migration 355 is in open #2114. |

## Closing a row

The domain maintainer taking the next feature task owns the evidence update.
Record the tested SHA, environment, command or journey, result and limitations
in its `verification.md`; check only the corresponding completed tasks. Move to
`verified`/`shipped` only when the constitution's task and requirement gates are
met. Historical successful CI, a published package, and a clean Git worktree
cannot substitute for missing acceptance evidence.
