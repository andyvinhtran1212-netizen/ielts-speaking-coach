# BLACKEYE-0052 PR2 QA checkpoint

This is a **partial implementation checkpoint**, not T005–T008 acceptance.
Live staging QA (T008), migration execution on staging/production, real course 2
assignment, release, and independent Security Auditor acceptance are **pending**.
No notifications or paid AI calls are part of this checklist.

## Current implementation boundary

Available locally: public Unit 1 list, positive player DTO, standalone runner,
KEEP/CHANGE saves, submission and owner review, creator-only catalog/receipt and
progress reads, dormant 377 grant/audit schema. Dictation stays locked.

Assignment creation intentionally still returns 503, including for an authorized
creator. Assigned start/save/submit admission stays closed. Generic Black Eye
backfill/update/due/delete/return stay closed. No partial fanout or placeholder
receipt is emitted. The admin form reports the failed request truthfully.

Root cause (Medium): `class_assignment_items` has
`UNIQUE (assignment_id, student_id)` in migration 177. A single assignment cannot
hold the requested recipient × activity child rows. The existing generic RPCs
also use that pair for conflict handling. Changing that key requires auditing
those callers; silently creating multiple assignments would violate Scenario 9.

Decision options for Leader:

1. Authorize a compatibility design in still-unexecuted 376: an activity key plus
   a uniqueness strategy that retains generic RPC behavior, with affected RPCs
   audited and PG regression tests. No migration number is allocated here.
2. Authorize a separate child ledger/snapshot design, after Release Manager
   allocates its migration. 377 must remain grant-list-only.
3. Explicitly reduce assignment scope to one activity per assignment. This is a
   product/spec change and has not been implemented.

CV-1 fallback remains creator-only: no grant/revoke HTTP writer or UI; no seeded
grants; global admin is insufficient. Catalog requires an existing Black Eye
assignment creator capability in the cohort, so there is no global-admin
bootstrap for the first assignment. Receipt/progress require exact ownership of
the requested assignment. A grant route's absence currently produces HTTP 404;
the requested HTTP 403 self-grant acceptance is therefore still pending. Direct
`authenticated` SQL writes fail with zero rows, verified on disposable PG17.

## Local evidence and reproduction

- `backend/tests/test_blackeye_pr2.py`: strict request/replay validation,
  catalog/receipt/progress C/G/O/S matrix, visible recipient lookup failure,
  progress reload/expiry/history, positive frozen player and IDOR/signing checks.
- `backend/tests/test_listening_blackeye*.py`: PR1 privacy/IDOR and logging,
  error_logs and Sentry sentinel coverage, with Q-11's explicit player change.
- `backend/tests/test_blackeye_grants{,_postgres}.py`: pending_feature, client
  ACL/policy rejection, self-grant rejection, audit readback, append-only history,
  and rollback refusal when history exists.
- `backend/tests/test_blackeye_admission_postgres.py`: real 376 acquire/guard
  replay test retaining submitted and expired attempts; synthetic adapters model
  the existing 306 revision/capture IO. This does not claim assigned admission.
- `frontend/tests/react/listening-blackeye.test.tsx`: six behavior/SSR checks.
- `frontend/tooling/verify-listening-blackeye-flow.mjs`: 60 local Next checks in light/dark themes at
  1440×900 and 390×844. Run against a loopback Next server only. Every nonlocal
  request is intercepted with synthetic responses; no live account is used.
  Browser E2E exercises the UI contract, while backend HTTP/PG suites exercise
  the implementation. It does not prove assignment creation.
- Types: regenerate `frontend/types/api.d.ts` from in-process `main.app.openapi()`.

The standalone browser fixture has no book content or real identifiers. The
synthetic class/learner identifiers used by backend tests are `synthetic-course2`,
`synthetic-assignment`, `synthetic-item`, and `synthetic-student`; they are not
live IDs. The browser uses explicitly synthetic UUIDs ending 0052–0055.

## Staging checklist — do not run without approval

Record independent owners for functional, UI and assignment-data retests. Record
exact reviewed head, exact staging deployment, migration hashes and fake cohort/
account IDs. A new head or deployment invalidates applicable evidence.

- [ ] Resolve the ledger design and finish atomic create/request replay,
  fingerprint/stale-revision conflicts, recipient × activity snapshots, assigned
  start/save/submit/review, and Black Eye-only audited mutations.
- [ ] Complete the whole FR-027 matrix, including generic staff surfaces for C,
  removed/archived learners and cohorts, and explicit absent self-grant 403.
- [ ] Security Auditor reviews all changed 376 functions, 377 tables/triggers,
  RLS/ACL catalog evidence, C3 (a)–(e), privacy and learner data at the final head.
- [ ] Anh Vinh approves exact staging migration and staging writes separately.
  Release Manager applies approved 376/377 under the advisory lock. Neither file
  is applied on merge; both remain pending_feature.
- [ ] Reserve a fake course 2 cohort and three team-owned fake accounts. Do not
  query, copy or use the real course 2 roster; send no notifications.
- [ ] Assign two ready synthetic activities; resend identical request: one
  assignment, same receipt. Changed fingerprint/revision: 409 with no fanout.
- [ ] A8/A14/A19 visible, disabled with screen-reader reasons, excluded from the
  denominator; dictation in a separate locked column.
- [ ] Start/save/reload/submit/review each fake learner; exact text preservation,
  row/column context, save failure and retry, blank confirmation, lost ACK.
- [ ] Progress reload matches stored statuses, timestamps and blank counts; no
  score, accuracy or answer_set_revision. Lookup errors display an error.
- [ ] Only the exact authorized creator sees course 2 Black Eye work; global
  admin, other cohort creator, other learner and client JWT cannot access it.
- [ ] Check network JSON, HTML, SSR/RSC, cache, preload and accessible labels
  before submit: no answer identity, reference, explanation or transcript.
- [ ] After submit, student/teacher reviews show only that activity; missing
  reference/explanation says “chưa có”; unresolved limitations remain visible.
- [ ] Verify 1440×900 and 390×844, light/dark, keyboard/dialog focus, touch targets
  and no horizontal page overflow. Table scrolling retains learner context.
- [ ] Review Python logs, error_logs message/stack and Sentry before_send with
  synthetic sentinels. Structured error_logs.user_id is the sole exception.
- [ ] Verify rollback/refusal and close/unpublish procedure without destroying
  submitted work. Record read-after state and rollback package.

No staging checklist box is completed by this local job. T014 remains a separate
production approval and execution step.
