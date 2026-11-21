# Implementation and acceptance status

Reconciled on **2026-09-26** (0000–0008), **2026-10-31** (0009–0036, staging
`11bbfd227fbe39815758f4ffa470cffaa7059cb3`) and **2026-11-02** (0037–0044,
staging `b636255a6206314aa31e9691a912eee99a535d34`) and **2026-11-18/19** (0045–0101,
staging `3666fa705`); the 30 `implementing` specs in 0001–0037 plus STORAGELIMITS-0038 were reviewed on
**2026-11-20** (staging `119ad352`). This is a navigation ledger, not a replacement for
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
`spec.md`/`tasks.md`, so their status was left for that pull request. A spec
moves to `verified` only when every task is ticked and every FR has PASS,
MANUAL or reasoned N/A evidence in `verification.md` (`validate_specs.py`
final-status rule).

Rows 0037–0044 were refreshed on 2026-11-02 from their current `tasks.md`,
`spec.md` and merged PRs present at staging
`b636255a6206314aa31e9691a912eee99a535d34`, after PC-J541's #2202 merged.
Their Status column uses `implementing (was approved)` for merged
implementations whose canonical `spec.md` metadata remains `approved`;
the metadata itself is unchanged. Task counts include T000 where present.
Staging application evidence is cited separately from unchecked acceptance
tasks; this refresh makes no new production claim.

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
| [GRAMMARAUDIT-0019](0019-grammar-audit-remediation/verification.md) | implementing (was approved) | 7/17 | #1623/#1625 (migration 314); Revision 1 #1861, #1850; Revision 2 #1940 (migration 339). The owner approved FR-007 (Revision 2 and 3) as "FR007 ok" (t641u, 2026-10-30 07:07 UTC+7, #1977 head `4f92b06`); `approval-decision.md` is not updated yet (follow-up). The CM sign-off parts of T014 are still to be checked. |
| [VOCABSETS-0020](0020-vocabulary-class-sets/verification.md) | implementing (was approved) | 7/9 | #1662 (migration 317). T008 fix #1664 and promotion #1663 merged 2026-10-14; migration 317 applied on production 2026-10-14. Staging/production acceptance evidence for T008/T009 is not recorded yet (`verification.md:44` still says #1663 is open). |
| [READINGPRACTICE-0021](0021-reading-practice-support/verification.md) | implementing | 8/9 | Unchanged. |
| [REVEXPLAIN-0022](0022-revision-explanation-binding/verification.md) | implementing | 7/8 | Unchanged. |
| [SECWRITE-0022](0022-client-write-privilege-lockdown/verification.md) | implementing (was approved) | 5/10 | #1719 and #1721 (migration 320). T004 ticked from #1717. Amendment 1 migrations 349/351 are not merged. |
| [REVEXPLAIN-0023](0023-revision-explanation-key-equivalence/verification.md) | verified (was implementing) | 4/4 | #1745. All tasks ticked (T004 production commit and read-back); FR-001…FR-008 PASS in `verification.md`. |
| [AIOPS-0024](0024-admin-ai-model-control/verification.md) | implementing (was approved) | 8/9 | #1837 (migration 322). T008 staging journey partial. |
| [WRITINGRATE-0025](0025-writing-grade-ratings-feedback-version/verification.md) | implementing (was approved) | 3/5 | #1834 (migration 321), test #1922. T003 rating round trip pending. |
| [ROLECHECK-0026](0026-users-role-single-check/verification.md) | implementing (was approved) | 7/8 | #1743 (migration 323). T008 real instructor promotion pending. |
| [ASSIGNDRAFT-0027](0027-writing-draft-assignment-delete-guard/verification.md) | verified (was approved) | 9/9 | #1744 (migration 324), Revision 1 #1872; promoted by #1763. All tasks ticked (T008 production apply); FR-001…FR-004 PASS in `verification.md`. |
| [CODEUNIQ-0028](0028-access-code-unique-canonical/verification.md) | verified (was approved) | 8/8 | #1748 (migration 325); promoted by #1763. All tasks ticked (T008 production apply); FR-001…FR-004 PASS and FR-005 MANUAL in `verification.md`. |
| [STUDENTARCHIVE-0029](0029-student-archive/verification.md) | implementing (was approved) | 9/12 | #1746 (migration 326). T008 staging AC run partial. |
| [CLASSARCHIVE-0030](0030-class-archive/verification.md) | approved (*deferred*, #2059) | 4/14 | #1900 (migration 337), migration 346. Status change left until #2059 lands. |
| [GIVEARCHIVE-0031](0031-archived-learner-give-guard/verification.md) | implementing (was approved) | 6/8 | #1756 (migration 331). T007 staging journey partial. |
| [ADMINAAL2-0032](0032-admin-aal2-staff-guard/verification.md) | approved (*deferred*, #2023) | 12/17 | Present: migrations 332, 336, 345; #1855, #1880, #1884, #1885, #1896, #1928. Reverted by #2030: #1898 (re-landed by #2035), #1936 and #1996 (not re-landed; the applied 352 file is kept by `b47ba2015`). |
| [AIBUDGET-0033](0033-ai-budget-hard-cap/verification.md) | approved (*deferred*, #1945) | 4/14 | Present: T001 #1883, T002 #1889 (migration 333), T003 #1905 (dormant after the revert), T005 #1925, migration 340 #1931. T004 #1927 (and test fix #1958) reverted by #2025, not re-landed. |
| [ACTIVATELIMIT-0034](0034-activate-attempt-rate-limit/verification.md) | implementing (was approved) | 6/7 | #1847 (migration 334). T006 11-attempt probe pending. |
| [INACTIVEWRITE-0035](0035-inactive-learner-rest-write-guard/verification.md) | implementing (was approved) | 4/5 | #1829 (migration 335), tests #1917. T004 REST probes pending. |
| [ASYNCAUTH-0036](0036-async-db-auth-layer/verification.md) | approved (*deferred*, #2097) | 5/7 | #1857, #1890, #1910, Revision 2 #1929. Status change left to #2097. |
| [PAPERUPDATEDAT-0037](0037-mock-paper-updated-at-and-hide-warning/verification.md) | implementing | 7/11 | #1877 (migration 338), #2204 (migration 353, merged 2026-11-03) and #2284 (migration 379, merged 2026-11-12) are on staging; amendments FR-006 (#2014), FR-007 (#2193) and FR-008 merged as specs. T005, T008, T009 and T011 remain open; see the 2026-11-20 review. |
| [STORAGELIMITS-0038](0038-storage-bucket-limits/verification.md) | approved (`spec.md` metadata; implementation merged, see 2026-11-20 review) | 2/7 | #2107 (migration 343, upload limits), #2188 (migration 362, Listening 50 MiB cap) and #2244 (per-route 415 contract) merged. The earlier "implementing (was approved)" label and 2/5 count were stale: `spec.md` still says `approved` and `tasks.md` has seven tasks. Migration register records 343 staging apply on 2026-11-02 08:51 UTC+7; T003 staging acceptance, T004 production, T005 wording review, T006 tick and T007 staging apply of 362 remain unchecked. |
| [RLSCLEANUP-0039](0039-rls-admin-policy-cleanup/verification.md) | implementing (was approved) | 3/5 | #2117 (migration 344) merged. T003 staging apply and read-only catalog/ACL comparison recorded in [tasks](0039-rls-admin-policy-cleanup/tasks.md): ledger 2026-11-02 01:49:14Z, 21 tables retain RLS, no helper/BL-11 policies or client privileges; later 356 explains the reduced class-action-log ACL. T004 learner/instructor JWT probes and T005 production remain unchecked. |
| [VOCABGUARD-0040](0040-vocab-curated-published-child-guard/verification.md) | implementing (was approved) | 1/3 | #2114 (migration 355) merged; #2202 reconciled T001. Migration register records staging apply on 2026-11-01 17:37 UTC+7; T002 staging function-body postcheck and T003 production remain unchecked. |
| [CALAPPEND-0041](0041-class-action-log-append-only/verification.md) | implementing (was approved) | 0/3 | #2173 (migration 356) merged; #2189 amended rollout/SA acceptance. Read-only staging ledger records 356 at 2026-11-02 11:47:54Z, after 344. T001 implementation checklist remains unreconciled; T002 complete staging/SA acceptance and T003 production remain unchecked. |
| [SVCPRIV-0042](0042-service-role-table-maintenance-revoke/verification.md) | approved | 1/6 | Approval #2170 and ordering clarification #2200 merged; only T000 is checked. T001 table-maintenance revoke remains open; schema CREATE migration 357 (#2196, T005) and routine search-path migration 358 (#2201, T004) remain open PRs. T002/T003 staging/production acceptance is unchecked. |
| [LESSONREPORT-0043](0043-course-assessment-lesson-report/verification.md) | approved | 1/9 | Spec-only #2075 merged; only T000 approval is checked. T001–T006 implementation and T007–T008 staging/security acceptance remain open; no lesson-report implementation is recorded in the staging tree. |
| [INSTRUCTORGIVE-0044](0044-instructor-give-idempotency/verification.md) | implementing (was approved) | 6/8 | Approval #2121 and implementation #2125 (migration 360, backend/frontend idempotency) merged; #2202 reconciled T001–T006. T007 complete staging S1–S4/AT retest and T008 production P1–P2 acceptance remain unchecked. Migration application alone does not close these gates. |

Rows 0045–0101 were added on 2026-11-18/19 from each feature's `spec.md`
frontmatter, `tasks.md` checkboxes, `verification.md` and approval record at
staging `cf37b46b6` (0045–0054), `d1f568eb2` (0057–0058) and `3666fa705`
(0055, 0056, 0074, 0081–0084, 0101). They record only what those files state;
they make no claim from the presence of code, migrations or deployments. Spec
numbers 0049 and 0051 are held by open spec PRs (#2254, #2274), and 0053 is
unused.

| Spec | Status | Tasks | Recorded in the spec / note |
| --- | --- | --- | --- |
| [FNEXEC-0045](0045-function-default-execute-lockdown/verification.md) | draft | 0/4 | Draft only. T000 owner approval of Q-J364-1…Q-J364-6 and the migration number is unchecked; T001 migration, T002 staging and T003 production remain open. |
| [SERVERCHECK-0046](0046-quiz-server-check-key-release/verification.md) | draft | 0/11 | Draft only; no task is checked. `verification.md` cites the existing course-runner `/progress` verdict (#2091) as context, not as acceptance for this spec. T001–T011 remain open. |
| [FREETRIAL-0047](0047-free-trial-grading/verification.md) | approved | 0/13 | Owner approval recorded 2026-11-10 on spec PR #2252 (`approval-decision.md`). No implementation task is checked; T001 migration through T013 entry flow remain open. |
| [FLASHCARD-0048](0048-flashcards-mvp/verification.md) | draft | 0/8 | Draft only; no task is checked. T001–T008 (menu, migration, flag/parser, paste panel, card player, retry set, staging scenarios, optional hiding) remain open. |
| [WRITINGBAND-0050](0050-writing-band-save-consistency/verification.md) | approved | 4/6 | Spec baseline #2268 merged to staging before implementation; T001–T004 (approval record, backend normalisation, canonical UI refetch, local suites and review) are checked on branch `codex/writing-band-save-fix`. T005 exact-SHA staging/production release and T006 six-submission parent acceptance remain open. |
| [BLACKEYE-0052](0052-blackeye-u1/verification.md) | approved | 0/14 | Owner approval recorded 2026-11-10 (`approval-decision.md`). Every FR row in `verification.md` is PENDING; T001–T014 (PR1 rebuild, PR2 backend/frontend/tests, staging QA, content, audio and a separate production release gate) remain open. |
| [SKILLDRILLS-0054](0054-listening-skill-drill-homework/verification.md) | approved | 0/4 | Owner approval recorded 2026-11-11 on spec PR #2291 (`spec.md` "Approval record"), including 180-day evidence retention. T001 migration slot and evidence, T002 admin catalog, T003 learner players and T004 staging journey remain open. |
| [COURSEACCESS-0055](0055-course-access-credits-enrollment/verification.md) | draft | 0/16 | Draft spec only, merged to staging for review; no task is checked. |
| [UIBASE-0056](0056-ui-foundation/verification.md) | draft | 0/11 | Draft spec only, merged to staging for review; no task is checked. |
| [TESTPOLICY-0057](0057-test-policy-visual-baseline/verification.md) | draft | 0/3 | Draft spec only (G10-T01), merged to staging for review; no task is checked. |
| [MIGNUM-0058](0058-migration-number-blocks/verification.md) | draft | 0/1 | Draft spec only (G10-T22), merged to staging for review; no task is checked. |
| [ADMINIA-0074](0074-admin-ia/verification.md) | draft | 0/30 | Draft spec only, merged to staging for review; no task is checked. |
| [BACKENDSPLIT-0076](0076-backend-module-split/verification.md) | approved | 0/10 | Approved by anh Andy 2026-11-20 (`approval-decision.md`); spec only (G10-T08), for review; no task is checked. |
| [PHONEGATE-0081](0081-full-test-phone-gate/verification.md) | draft | 0/2 | Draft spec only, merged to staging for review; no task is checked. |
| [ADMINGROUP-0077](0077-admin-route-group-consolidation/verification.md) | approved | 0/7 | Approved by anh Andy 2026-11-20 (`approval-decision.md`); spec only (G10-T13), for review; no task is checked. |
| [COURSETESTRELEASE-0082](0082-course-test-result-release/verification.md) | draft | 0/7 | Draft spec only, merged to staging for review; no task is checked. |
| [MEDIAOUT-0078](0078-advanced-vocab-media-delivery/verification.md) | approved | 0/9 | Approved by anh Andy 2026-11-21 (`approval-decision.md`; Q-e1/Q-e1b/Q-e2 open); spec only (G10-T16/T17); inventory numbers recorded in plan.md, no task is checked. |
| [BRANDMARK-0083](0083-brand-mark-an-ky/verification.md) | draft | 0/2 | Draft spec only, merged to staging for review; no task is checked. |
| [GRAMMARFIG-0084](0084-grammar-wiki-figures/verification.md) | draft | 0/2 | Draft spec only, merged to staging for review; no task is checked. |
| [SENTLAB-0101](0101-course5-sentence-lab/verification.md) | approved | 0/6 | Frontmatter says `approved`; `spec.md` has no approval record section. No task is checked. |

## Implementing-spec review — 2026-11-20 (G10-T20, G10-T21)

Checked against staging `119ad352` from each spec's `spec.md` frontmatter,
`tasks.md` checkboxes, the Result column of `verification.md`, and merged pull
requests found by spec ID. No task box, FR result or `spec.md` status was
changed; code presence alone was not counted as evidence. Hosted state was not
queried: rows that need it say "MANUAL evidence needed" with the read-only
query to run against the environment's `_schema_migrations` ledger
(`backend/scripts/apply_migrations.sh`). The owner (Andy, written "Vinh" in
older task text) holds every production, migration-apply and paid-evaluation
gate.

Classes (GOI-10 FR-10f-001): **shipped-pending-evidence** = implementation is
deployed, acceptance evidence missing; **in-progress** = implementation tasks
still open; **blocked** = the named condition stops the next step;
**superseded-proposed** = proposed replacement, waiting for the owner.
"Pending FR" lists FR numbers whose Result is `PENDING`.

### Wave 1 (0001–0013)

| Spec | Class | Tasks | Pending FR | Merged PRs | Remaining acceptance / next action (who) |
| --- | --- | --- | --- | --- | --- |
| [GRAMMAR-0001](0001-timed-grammar-midterm-assessments/tasks.md) | shipped-pending-evidence | 0/10 | 001–011 | #1425, #1454, #1456; related #1622 | Executor: reconcile T001–T010 one at a time against #1425/#1454/#1456 and their tests, ticking only tasks with recorded evidence; then a viewport/theme/keyboard run for T010. |
| [AVOC-0002](0002-advanced-vocabulary-self-paced/tasks.md) | in-progress | 2/11 | 001, 002, 004–011 | #1424, #1467, #1533, #1535 | Executor: T003 staging review of migration 281 and `quiz_banks` policy proof. MANUAL evidence needed: `SELECT filename, applied_at FROM _schema_migrations WHERE filename = '281_advanced_vocab_stage_progress.sql'` on staging. T004B gold cohort needs dual human labels (teacher); T008 needs the owner's go/no-go. |
| [MASTER30-0003](0003-master30-grammar-diagnostic/tasks.md) | shipped-pending-evidence | 6/7 | — | #1447, #1450 | Owner: decide whether to enable the assigned diagnostic (T007). Before that, MANUAL evidence needed: current flag and release/count readback on production. |
| [AI-0004](0004-ai-model-usage-observability/tasks.md) | shipped-pending-evidence | 6/9 | 001–007 | #1452, #1711, #1718 (FR-005), #1653 | Executor: T007/T008 test and staging evidence for migration 286 and the Claude-primary order (#1718 shipped by #1731). Owner: authorize or decline the paid gold-set run (T009). MANUAL evidence needed: `SELECT filename, applied_at FROM _schema_migrations WHERE filename = '286_ai_usage_ledger.sql'` on staging and production. |
| [LISTENING-0005](0005-listening-content-programmes/tasks.md) | shipped-pending-evidence | 10/12 | 014 | #2298, #2299 (since last reconcile) | Executor: T011 reconcile import counts against current package manifests on staging (read-only); T012 learner/admin journeys and rollback drill. |
| [MOCKOPS-0006](0006-admin-mock-test-operations/tasks.md) | shipped-pending-evidence | 6/7 | — | migrations 297–302 (see verification) | Executor with owner sign-in: T007 authenticated production operator journey (Mock Writing drill-down, return context, reload agrees). |
| [LISTENING-0006](0006-listening-guided-feedback/tasks.md) | shipped-pending-evidence | 8/9 | — | #1490 | Executor: T009 hosted migration/route/protected-content and authenticated journey evidence at an exact SHA. |
| [LISTENING-0007](0007-listening-editorial-revision/tasks.md) | shipped-pending-evidence | 2/9 | 005, 007–009 | #1524 (status record) | Executor: reconcile T002 and T004–T009 one at a time against the v1.1 release record; failed-publish rollback rehearsal and mobile/screen-reader acceptance still missing. |
| [WRITINGNAV-0007](0007-writing-navigation-contract/tasks.md) | shipped-pending-evidence | 4/5 | — | #1495, #1497, #1500, #1503 | Executor with owner sign-in: T005 authenticated Writing Queue → Status/Grade → Queue journey and reload. |
| [MOCKATTACH-0008](0008-mock-attempt-integrity/tasks.md) | shipped-pending-evidence | 5/6 | 001–003 | promoted (see verification) | Executor: T006 production marker plus the learner/operator persisted-link and reload journey; record FR-001–003 results. |
| [LISTENING80-0009](0009-listening-80-days/tasks.md) | shipped-pending-evidence | 7/10 | 001–020 | #1558, #1591, #1605, #1634, #1640 | Executor: T008 independent review and staged journeys, then T010 FR audit. MANUAL evidence needed: `SELECT filename, applied_at FROM _schema_migrations WHERE filename = '304_listening_80_days_source_collection.sql'` on staging and production. |
| [LEARNERDRAFT-0010](0010-learner-draft-preservation/tasks.md) | in-progress | 5/8 | 001–007 | #1576, #1578, #1580, #1582 | Executor: T005 browser/interaction/account/tab evidence, then T006 whole-contract review. |
| [DICTATIONTOKEN-0011](0011-versioned-dictation-token-grading/tasks.md) | shipped-pending-evidence | 7/9 | 006, 008–010 | #1561 | Executor: T008 contract review and exact-SHA staging acceptance. MANUAL evidence needed: `SELECT filename, applied_at FROM _schema_migrations WHERE filename = '305_dictation_frozen_grading_policy.sql'` on staging and production. |
| [READINGGRAMMAR-0012](0012-reading-grammar-focus-edit/tasks.md) | in-progress | 5/8 | 008, 009 | #1556 | Executor: T006 staging synthetic journey; T007 correction needs the owner's authorization and a teacher's academic acceptance (T008). |
| [WRITINGMODAL-0013](0013-writing-content-modal-history/tasks.md) | shipped-pending-evidence | 5/6 | 007 | #1557 | Executor: T006 record the deployed SHA and run the FR-007 journey on staging. |

### Wave 2 (0015–0038)

| Spec | Class | Tasks | Pending FR | Merged PRs | Remaining acceptance / next action (who) |
| --- | --- | --- | --- | --- | --- |
| [GRAMMARTEXT-0015](0015-grammar-exact-form-policy/tasks.md) | blocked | 21/25 | 001–012 | #1563, #1979 | Blocked on the owner-authorized per-code cutover (T015) and the single final12 bundle (T021, shared with GRAMMARCUTOVER-0014). Executor: T014 staging SHA record first. |
| [MOCKREPAIR-0016](0016-mock-content-remediation/tasks.md) | in-progress | 6/13 | 001–019 | #1574, #1597, #1886, #1891, #1893, #1951, #1956, #2263 (docs) | Executor: finish T007 (typed receipts) and T008 finding validation, then T009 PostgreSQL matrix. MANUAL evidence needed: `SELECT filename, applied_at FROM _schema_migrations WHERE filename ~ '^(306|307|308|310|311|315|316)_'` on staging and production. |
| [GRAMMARAUDIT-0019](0019-grammar-audit-remediation/tasks.md) | blocked | 7/17 | 001–005, 007–009 | #1623, #1625, #1861, #1850, #1940, #2262, #2368 | Revision 3 (T015) is blocked: its migration number was to come from the former Leader; take the next free number from `backend/migrations/register.tsv`. Owner: record the 2026-10-30 "FR007 ok" in `approval-decision.md` (T010/T014). |
| [VOCABSETS-0020](0020-vocabulary-class-sets/tasks.md) | shipped-pending-evidence | 7/9 | — | #1662, #1664, #1663, #1669 | Executor: record T008/T009 staging and production journey evidence; `verification.md:44` still calls #1663 open although it merged 2026-10-14. |
| [READINGPRACTICE-0021](0021-reading-practice-support/tasks.md) | shipped-pending-evidence | 8/9 | — | #1666, #1667, #1677, #1680 | Executor: T009 says #1667 is open but it merged 2026-10-14; record live acceptance and QA cleanup, then the spec can be checked for `verified`. |
| [SECWRITE-0022](0022-client-write-privilege-lockdown/tasks.md) | in-progress | 5/10 | 001–012 | #1719, #1721, #2112 (migration 351, T009) | Executor: T009 evidence from #2112; T010 (migration 349, FR-012) is still only reserved in `register.tsv`. MANUAL evidence needed: `SELECT filename, applied_at FROM _schema_migrations WHERE filename ~ '^(320|351)_'` on staging and production for T005–T007. |
| [REVEXPLAIN-0022](0022-revision-explanation-binding/tasks.md) | shipped-pending-evidence | 7/8 | — | #1692, #1708, #1709, #1723 | Every FR passes; only on-request T008 (further REV papers) is open. Owner: decide whether T008 stays open-ended or the spec closes. |
| [AIOPS-0024](0024-admin-ai-model-control/tasks.md) | shipped-pending-evidence | 8/9 | 010 | #1837, #1916, #2050, #2180 | Executor: T008 staging journey from `rollout.md` and FR-010 record. MANUAL evidence needed: `SELECT filename, applied_at FROM _schema_migrations WHERE filename = '322_ai_model_overrides_and_failures.sql'` on staging. |
| [WRITINGRATE-0025](0025-writing-grade-ratings-feedback-version/tasks.md) | shipped-pending-evidence | 3/5 | 009 | #1834, #1922, #2001, #2031 | Executor: T003 rate-and-reload round trip on staging (task text still says "merge #1727"; #1834 replaced it), then T005 record. |
| [ROLECHECK-0026](0026-users-role-single-check/tasks.md) | shipped-pending-evidence | 7/8 | — | #1743, #1770, #1895 | Owner: one real instructor promotion with the P1/P3 checks (T008). |
| [STUDENTARCHIVE-0029](0029-student-archive/tasks.md) | in-progress | 9/12 | 001–005 | #1746, #1751, #1920, #2241 | Executor: T008 staging AC-1…AC-14. T010 (GDPR erase) and T011 (delivered by CLASSARCHIVE-0030) are proposed to leave this spec, see below. |
| [GIVEARCHIVE-0031](0031-archived-learner-give-guard/tasks.md) | shipped-pending-evidence | 6/8 | 001, 005 | #1756, #1932, #2000 | Executor: T007 R1–R4 read-only checks and the W1–W5 journey on staging; T008 production read-back at the next promotion (owner). |
| [ACTIVATELIMIT-0034](0034-activate-attempt-rate-limit/tasks.md) | shipped-pending-evidence | 6/7 | — | #1847, #1921 | Executor: T006 11-attempt QA probe on staging. |
| [INACTIVEWRITE-0035](0035-inactive-learner-rest-write-guard/tasks.md) | shipped-pending-evidence | 4/5 | 001 | #1829, #1917, #1923 | Executor: T004 inactive 403 / active 201 REST probes on staging with QA accounts. |
| [PAPERUPDATEDAT-0037](0037-mock-paper-updated-at-and-hide-warning/tasks.md) | blocked | 7/11 | 001, 006–008 | #1877, #2204, #2284 | T011 needs migration 379 applied on staging (`forward-policy.tsv`: `pending_feature`, staging apply after CR). The team process rule ("migrations 376–379 are never applied", team PIPELINE/TEAM-WORKFLOW, 2026-11-17) blocks that; COURSEACCESS-0055 `approval-decision.md` repeats it only for its own scope. Owner: confirm whether the rule was meant for the Black Eye 376–378 chain only, so 379 can follow its normal staging gate. Executor: T005 visibility-toggle probe and T008 evidence from #2204. |
| [STORAGELIMITS-0038](0038-storage-bucket-limits/tasks.md) | shipped-pending-evidence | 2/7 | 001, 002, 004–007 | #2107, #2188, #2244 | Metadata mismatch corrected above (`spec.md` is `approved`, seven tasks). Executor: T006 evidence from #2188; MANUAL evidence needed: `SELECT filename, applied_at FROM _schema_migrations WHERE filename ~ '^(343|362)_'` on staging, then `SELECT id, file_size_limit FROM storage.buckets WHERE id = 'listening-audio'` (T007). |

### Owner decisions proposed by this review

- **superseded-proposed**: STUDENTARCHIVE-0029 T011 is delivered by
  CLASSARCHIVE-0030 T002/AC-10, and T010 is "a separate spec". Proposal: mark
  both as moved out of 0029 so its remaining gate is only T008.
- REVEXPLAIN-0022 T008 is open-ended ("on request only"). Proposal: close it
  out of the spec so 0022 can be checked for `verified`.
- PAPERUPDATEDAT-0037 T011 waits on a staging apply of migration 379, which the
  team rule "376–379 are never applied" currently blocks; the owner confirms
  whether that rule covers 379.
- AI-0004 T009 needs a paid gold-set run.
- MASTER30-0003 T007 needs the activation decision.

## Closing a row

The domain maintainer taking the next feature task owns the evidence update.
Record the tested SHA, environment, command or journey, result and limitations
in its `verification.md`; check only the corresponding completed tasks. Move to
`verified`/`shipped` only when the constitution's task and requirement gates are
met. Historical successful CI, a published package, and a clean Git worktree
cannot substitute for missing acceptance evidence.
