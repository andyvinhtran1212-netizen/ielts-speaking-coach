# Core admission — source writer inventory and bounded contracts

2026-09-10 · Local source/design self-review, not deployed coverage certification.
Worktree: `ielts-speaking-coach-gate-f-manifest`, branch
`codex/core-attempt-outcome-evidence`, base `5c548eeda79b1b5444cdeb7215fac8405200755b`
plus its existing uncommitted changes. No external reviewer is awaited in this
session. No product write path, migration, remote data or flag was changed here.

Companion: [durable admission design](../CORE_ADMISSION_LEDGER_DESIGN.md).

## Method and limits

Inspected route/service source, Python AST table mutations, repository scripts
and SQL definitions. Literal searches are discovery aids: dynamic accessors,
RPC bodies, triggers, parent deletion cascades and historical definitions need
separate tracing. Repository code is not evidence of installed DB function bodies,
enabled triggers, live grants, all deployed backend versions or external writers.
This inventory identifies concrete integration boundaries; it does **not** close
writer enrollment or establish the Gate F denominator.

## Source inventory

Line references are this local checkpoint; function names remain the stable anchors.

| Writer / reference | Classification | Admission or reconciliation contract |
| --- | --- | --- |
| `backend/routers/sessions.py:479`, `create_session` | Learner creation, including class/mock-linked sessions | Preserve quota, replay identity and owned full-test grouping. Include group/class/mock attachment effects before marking execution fully bound. |
| `backend/routers/reading_student.py:958,1068`, shared/account starts | Learner creation/restart | Authenticate account or anonymous capability. New explicit restart may abandon old work; abandon/create/binding must commit together on the new protocol. Same command replay must not repeat abandonment. |
| `backend/routers/listening.py:6204`, `start_listening_test_attempt` | Learner creation/restart | Preserve full/mini/practice source subtype and current answer semantics. Use the same atomic restart contract; answer checks/reveals are not starts. |
| `backend/routers/listening.py:5256`, `start_dictation_attempt` | Learner resume or new parent | Resolve owned active parent and generation under one scope lock; concurrent resumes cannot add episodes. Expired replacement must retain old answers and explicit prior disposition. |
| `backend/routers/writing_student.py:1862`, `start_assignment` | Explicit learner timer start/resume | One episode per assignment under the proposed assignment identity. Preserve original timer/renderer lease and do not restart the clock on replay. |
| `backend/routers/writing_student.py:1344`, `upsert_my_draft` | Learner content save plus possible status transition | Draft upsert precedes a best-effort pending→in_progress update at line 1416; it deliberately does not start the timer. Status alone cannot establish observed admission. Preserve saves for baseline/unenrolled active work. |
| `backend/routers/writing_student.py`, `submit_my_assignment`, `_persist_flagged_submission`; `backend/services/essay_service.py:367`, `create_essay_row_only` | Submission, essay creation and assignment linkage | Essay row creation is downstream of assignment work, not automatically a new learner episode. Track partial/orphan/linkage failures as reconciliation gaps. |
| `backend/services/mock_exam_service.py:697,848`, `create_sitting`, `attach_attempt` | Sitting orchestration and child attachment | Registration and child domain starts are different events. Do not count sitting and child attempt as equivalent episodes; validate sitting/owner/skill bindings. |
| `backend/services/mock_exam_service.py:1515,3230`, `start_section`, `advance_section` | Retake learner clock versus sequential admin section opening | Retake per-sitting start and shared exam section opening need different provenance. An admin opening a section does not prove that every learner rendered or started it. |
| `backend/services/mock_exam_service.py`, `submit_writing`, `_promote_writing_essays` | Native mock Writing capture and later essay promotion | `writing_submission` on the sitting exists before Task 1/2 essay rows. Propose one sitting+Writing-section episode with task child bindings; freeze eligibility separately before implementation. Missing promotion is not absence of learner work. |
| `backend/routers/admin_writing.py:236`, `create_essay` | Admin-submitted essay on behalf of student | Preserve actor/provenance separately. It is not proof of organic browser admission; final eligibility classification must be explicit, not silently excluded. |
| `backend/routers/admin_writing_assignments.py:297`, `create_assignments`; `backend/routers/instructor.py:241`, `create_assignment`; `backend/services/cohort_assignment_service.py:54`, `fan_out_assignment` | Assignment allocation, not learner start | Both idempotent RPC and legacy direct insert paths require typed allocation provenance if guarded. Do not reuse the admin give-action request ledger as learner admission. |
| `backend/services/instructor_access.py:39,80,83,92`, owner-bound accessor | Dynamic table writes | Allowed table map includes `writing_assignments`; insert stamps `assigned_by`, update/delete add owner predicates. This is a traced assignment writer, not an unexplained arbitrary-table bypass. |
| `backend/services/mock_exam_service.py:2439,2486,2854`, finalize/collection helpers | Background current-outcome writers | Read canonical Reading/Listening results and Writing capture/promotion even when no learner submit route ran. These operations update outcomes; they do not manufacture new admissions. |
| Session finalizers/admin rebuilds; essay grading/regrade/delivery; mock release/void/retirement | Outcome/provenance lifecycle | Current report must reflect persisted revisions and distinguish successful completion from passing score or publication. Do not count regrade/release as a start. Full lifecycle/erasure dependency closure remains required. |

### SQL and non-browser paths

- Speaking's router selects capped creation v1/v2/v3, with optional local v4
  behind flags. Relevant repository definitions are migrations 126, 201/204,
  216 and local 241. Migration 200/204 supplies Part 1 grouping; later-part
  attachment is also written by the router. One creation RPC is not the whole
  route transaction. Installed function/trigger versions remain unverified.
- Migration 228 defines an assignment-allocation RPC also present in earlier
  migrations. Historical definitions must not be counted as distinct live
  writers. The current caller retains its legacy direct-insert path.
- Migration 224 defines renderer claims, TTL and content/terminal guards. New
  admission guards must be checked against those contracts, including old active
  attempts; do not assume optional receipt instrumentation makes them compatible.
- `backend/scripts/seed_staging_writing_coexistence.py:185` inserts assignments:
  fixture allocation, not proof of learner start or organic traffic. Do not run
  it as part of this audit.
- **False positive removed:** `backend/scripts/import_speaking_results.py:main`
  reads sittings and updates existing `mock_exam_reviews` notes/draft bands. It
  does not create Speaking sessions. It matters to result provenance, not the
  session-creation inventory.
- `backend/scripts/oneoff_cleanup_archived_listening_junk.py` reads attempt
  counts and deletes test/content/exercise records, not direct attempt inserts.
  Any indirect cascade impact still needs schema/target validation before use;
  no cleanup was executed.
- Service-role/owner scripts, external jobs and N−1 instances require explicit
  deployment inventory and DB guard verification before coverage certification.

## Validated design findings

These are gaps in a proposed coverage design, **not confirmed production outages**.

1. **Medium — observing only Writing `/start` misses another state-changing path.**
   Root: `upsert_my_draft` saves content and can change status without stamping
   `started_at`; this is intentional timer behavior, not itself a timer bug.
   Minimal design fix: classify explicit admission versus baseline/unenrolled
   saves separately. Do not stamp a start retrospectively or block existing work.
   Verify: pending with valid lease, missing/expired lease, already-started draft,
   retry and status-update failure; compare saved draft, status and original timer.
2. **Medium — essay-only mapping misses native mock Writing before promotion.**
   Root: `submit_writing` stores both tasks on `mock_exam_sittings`; promotion
   creates and links essays afterward and can fail independently.
   Minimal design fix: sitting+Writing-section source identity with task children,
   distinct sequential/retake provenance and explicit incomplete promotion.
   Verify: autosave, final submit/collection race, no essay yet, one task promoted,
   two tasks promoted, promotion retry and admin section opening without activity.
3. **Medium — capped Speaking creation is narrower than complete admission.**
   Root: `create_session` attaches later full-test parts at line 686 and class
   items afterward; failure paths attempt deletion. Mock attachment follows too.
   Minimal design fix: enumerate and atomically cover required relational effects
   in execution B, or keep a truthful unresolved state until all are satisfied.
   Verify: attachment failure, lost ACK, quota replay, competing parts and cleanup
   failure; no orphan may appear as a fully bound successful admission.
4. **Medium — endpoint-only scans miss source/provenance mutations.**
   Root: assignment accessors/RPCs, background collection, imports and administrative
   changes bypass learner start/submit routes by design.
   Minimal design fix: typed writer enrollment plus independent source/lifecycle
   reconciliation; do not label every allocation or result edit a learner start.
   Verify: N−1 calls, fixture/admin writes, background terminal updates, unauthorized
   writer, source deletion and guard-disabled interval all have truthful outcomes.

## Next implementation boundary

Before writing admission SQL: finish caller/trigger/cascade enrollment, choose
the bounded first domain, specify exact lock order and eligibility, and settle
retention/availability policy. This document neither changes those policies nor
authorizes enforced starts. Each domain needs actual RPC/HTTP/browser fault tests;
the five existing PostgreSQL design prototypes only establish their tested lock
and transaction properties.

Verification: manually inspected the cited source boundaries and removed the
import-script false positive. The follow-up first-epoch design check passed all
5 PostgreSQL prototypes (zero skips); see the companion design's executed-checks
record and bounded Writing contract. Application tests were not rerun. Previous
1,474 backend / 9,175 frontend results are not a combined new regression run.
