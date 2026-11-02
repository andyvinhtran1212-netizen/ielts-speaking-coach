# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_quiz_check_endpoint.py (row stored before response, response = one qid, why_wrong of picked option only, metadata from question row; red before the route exists) | PENDING |
| FR-002 | kind=test; ref=backend/tests/test_quiz_check_endpoint.py (Course session 409 no key, session with class item 409, Advanced Vocabulary 409; replay bypass: store a single_attempt Course answer through `/progress`, then `/check` the same session with the same `client_id` and answer → 409 `check_not_for_course`, no key field, row count unchanged, red if the read-back runs before the scope check) | PENDING |
| FR-003 | kind=test; ref=backend/tests/test_quiz_check_endpoint.py (foreign session 404, ended 409, foreign qid 422, malformed 422, nothing stored, no key field in any error body) plus PG managed reset refusal | PENDING |
| FR-004 | kind=test; ref=backend/tests/test_quiz_check_endpoint.py (replay returns stored verdict, stored answer wins, one row; client_id of another session 409 no key; same qid new client_id = new row; replay of a stored client_id in a Course or Advanced Vocabulary session 409 no key, ended or not) | PENDING |
| FR-005 | kind=test; ref=backend/tests/test_quiz_answer_grader_parity.py plus frontend/tests/quiz-grader-parity.test.mjs (same fixture, every branch; integer branch equals grade_attempt) | PENDING |
| FR-006 | kind=test; ref=backend/tests/test_quiz_server_grading.py (legacy and managed PG: forged is_correct ignored; row without is_correct graded not dropped; metadata from question row; missing qid 422 not 500 in self-study and Course; /check rows not duplicated; single_attempt write after due_at 409) | PENDING |
| FR-007 | kind=test; ref=backend/tests/test_quiz_server_grading.py (timed time-cap PG: forged flag → stored rows, RPC totals, /mistakes and report all wrong) | PENDING |
| FR-008 | kind=test; ref=backend/tests/test_quiz_server_grading.py (self-study and Course non-time-cap end, seal and sweep: totals = stored counts whatever the body says; repeated end returns the same totals; single_attempt end writes no item `score`) plus backend/tests/test_migration_<next>_course_answer_after_seal_guard.py (PG overlapping check/end, CR R10 P2-1: managed progress insert held open while `grammar_quiz_end_service` waits → totals include the row; end first → insert refused `grammar_session_closed`, totals exclude it; stored totals equal a recount in both orders; red with the migration 309 end RPC and Python-counted totals; same pair for `quiz_close_sessions_counted` with legacy self-study and untimed Course inserts; seal over two sessions with held inserts, no deadlock) | PENDING |
| FR-009 | kind=test; ref=backend/tests/test_quiz_bank_student_payload.py (step A, T001: derived `answer_word_count`/`text_match_eligible` present next to the keys, eligibility equals the `accept`-based rule; step B, T006: missing/unknown contract marker → 409 quiz_client_refresh_required, no questions or key fields; server-check-v1 → 200 key-free; auth/access and Course admission unchanged; no mode, Grammar current/legacy, Vocab, Course every mode, has answer/accept/explain/why_wrong; derived fields correct; red before guard) plus pre-upgrade-tab journey below | PENDING |
| FR-010 | kind=test; ref=frontend/tests/quiz-engine.test.mjs (credit only after verdict, no local grading, retry same client_id, identical loop given same verdicts; policy validator on a keyed step-A payload with derived fields and an explicit `text_match_by_qid` policy accepts the bank; payload without `text_match_eligible` → load error) plus rollout C.6a intermediate-deployment journey plus frontend/tests/react quiz-player states, API marker on initial/reset/reopen bank GET, full page reload on refresh-required, plus browser verifier | PENDING |
| FR-011 | kind=test; ref=backend/tests/test_single_attempt_key_release.py (A handed in, B not: sealed before due_at on report, mistakes, resume; open after; null due_at → all_submitted; read error sealed; due_at moved later re-seals; teacher path unchanged) | PENDING |
| FR-012 | kind=test; ref=backend/tests/test_single_attempt_key_release.py (sealed body fields) plus course review page test for both notices | PENDING |
| FR-013 | kind=test; ref=backend/tests/test_course_verdict_session_collection.py (abandoned wrong session then 100 % session: verdict reflects abandoned answers, red on staging before the fix; dropped session 422 with ids; recorded-verdict replay; >40 sessions; on-time not turned into timeout; reaper mastery vs single_attempt; full-retry boundary; retake union; seal: after a recorded failing verdict, `/progress` to a collected open session with a new and a replayed `client_id` → 409 `course_session_consumed`, no `feedback`/`answer`/`accept`/`explain`/`why_wrong` in the body, row count unchanged, red against collection without the seal (200 with feedback); 422 incomplete seals nothing; seal failure/still-open re-read → 500, nothing recorded; late insert racing the seal (held `/progress` insert into an empty or collected session, verdict seals it, insert resumes → 409 `course_session_consumed`, no key, nothing stored; then `/mistakes` has no entry for the qid from that session, no `correct_answer`/`explain`, report and resume show no row; red under the R8 post-store re-read, where the row is stored and `/mistakes` returns its `correct_answer`); reverse order (insert first) → seal waits, verdict reads the row; sealed empty retake never offered by `/course-resume`; new retake session still writable; empty session opened before a failing `retry_full`/`retake` verdict → 409, no key, nothing stored, sealed and `superseded`, red against the collected-only seal (Codex r4441040944); same against a pre-change ledger entry by `at`; wrong-`kind` session → 409; post-seal re-collection 422; session opened after the seal collected next time; parametrised walk of the `plan.md` case table: no key field and nothing stored in refused/sealed rows, expected feedback only in rows 9/15a/16/17, read-path output per row) plus frontend/tests/course-runner*.test.mjs (re-post at most twice; `course_session_consumed` drops the batch and reloads) | PENDING |
| FR-014 | kind=test; ref=backend/tests/test_course_verdict_session_collection.py (policy is the only scorer; first attempt by server time, tie by id) | PENDING |
| FR-015 | kind=test; ref=backend/tests/test_course_verdict_session_collection.py (ledger counts) plus admin homework view test ("—" for old entries) | PENDING |
| FR-016 | kind=test; ref=backend/tests/test_quiz_check_endpoint.py (review: answered qid → verdict + key, nothing stored; unanswered → 409 no key; managed review session forced to review) plus quiz-player review-state test | PENDING |
| FR-017 | kind=test; ref=backend/tests/test_migration_<next>_course_answer_after_seal_guard.py (PG: `authenticated` JWT `SELECT` on `quiz_attempts` and on `quiz_sessions` returns rows on the current schema, none after the migration; backend service-role reads unchanged) plus read-only staging/production inventory that no client-callable code reads `quiz_attempts` or `quiz_sessions` with caller privileges plus post-apply privilege query (`has_table_privilege` false for `anon` and `authenticated` on both tables, no `quiz_attempts_select`/`quiz_sessions_select` policy) | PENDING |
| FR-018 | kind=test; ref=backend/tests/test_migration_<next>_course_answer_after_seal_guard.py (PG, real trigger: insert into an ended Course session raises `course_session_closed` and into an ended self-study session `quiz_session_closed`, nothing stored, red on the current schema; held insert blocks the closing call until commit and the close counts it; inserts into open self-study/non-Course/managed Grammar sessions still store; timed progress and finalize RPCs still store; no deadlock between two inserts of one item and a seal) plus backend/tests/test_course_verdict_session_collection.py (late insert → 409 and `/mistakes` shows nothing) plus backend/tests/test_quiz_check_endpoint.py (`/check` racing an end → 409 `session_ended`, no key, nothing stored) | PENDING |
| FR-019 | kind=test; ref=backend/tests/test_single_attempt_key_release.py (CR R10 P1-1 paused one-question probe, red with FR-008 alone: timed and untimed single_attempt, one stored answer, `paused` and `completed` ends, before hand-in and after hand-in before release, right vs wrong answer → identical learner bodies for every row of the `plan.md` response-field table, `total_correct`/`total_wrong`/`accuracy` `null`, `avg_accuracy` unchanged, `last_stage` `null`, `word_cards` `{}`, no item `score` from the end; released → totals shown; teacher views unchanged) plus FR-017 REST check on `quiz_sessions` | PENDING |

Note on the ticket's "FE node test for course-runner.js through /check":
Course banks do not use `/check` (FR-002); the course runner gets its
server verdict from `/progress` since #2091 and is covered by
`frontend/tests/course-runner-server-feedback.test.mjs`. This change adds
only the verdict re-post test for `course-runner.js`.

## Contract evidence

- OpenAPI/type drift: `frontend/types/api.d.ts` regenerated with the new
  route and models; `test_openapi_contract` green.
- Backward compatibility: `/progress` and `PATCH /sessions` wire unchanged
  (`is_correct` optional and ignored); before FR-009, unmarked bank GETs
  still work. After FR-009, the server enforces `quiz_contract=server-check-v1`
  before returning self-study questions (rollout step B); missing/unknown
  values return 409 `quiz_client_refresh_required`, not a key-free 200 to
  an old grader. Course admission stays unchanged.

### Pre-upgrade tab across both promotions (FR-009/FR-010)

PENDING T005/T006/T009; this is build/release acceptance, not evidence of
runtime behavior in this draft-only PR.

1. Before FR-010, open a managed Grammar bank in a QA learner tab and keep
   its pre-FR-010 JavaScript running. Record the frontend deployment SHA.
2. Deploy FR-010 with keys retained, then FR-009 with the server guard;
   keep the tab open across both promotions. Record both exact backend
   and frontend deployment SHAs. New FR-010 clients send the marker on
   initial, reset and reopen fetches.
3. In the original tab invoke `resetProgress()` and reopen/refetch the bank
   without reloading the page. Verify every unmarked bank GET returns
   409 `quiz_client_refresh_required`, no questions or key fields, and the
   tab shows its existing load error without grading a fresh bank or
   passing it to the old policy validator. A client without the supported
   marker stays blocked however long it has been open.
4. Perform a full page reload: the new bundle sends
   `quiz_contract=server-check-v1`, receives 200 without key fields and
   answers via `/check`; displayed verdict and stored attempt agree.
5. Probe missing and unknown markers for managed/legacy Grammar and Vocab:
   same 409/no questions. Supported marker: 200 key-free. Existing auth,
   ownership/access refusals and Course admission stay unchanged. Verify
   the FR-010 refresh-required UI performs a full page reload, not a bank
   refetch (375/1280, light/dark, keyboard and screen reader).
6. Attach the red-before-guard/passing-after route tests and browser/network
   evidence with deployment SHAs. Block FR-009 promotion if any check fails.

## Data evidence

- Migration: `<next>_course_answer_after_seal_guard.sql` (FR-008
  functions, FR-017, FR-018).
  Before apply (read-only, done 02/11 on staging for this draft):
  `authenticated` has `SELECT` on `quiz_attempts` (all columns,
  `is_correct` included) through policy `quiz_attempts_select`
  (`auth.uid() = user_id`), no `INSERT`/`UPDATE`; `quiz_questions` has
  RLS on and no policy. Read-only 02/11 18:35 (job 001q5): `anon` and
  `authenticated` have `SELECT` on `quiz_sessions` (`total_correct`
  included) through `quiz_sessions_select`, no `INSERT`/`UPDATE`; no
  privilege on `class_assignment_items`. Production not checked
  (staging-only job); the build repeats these reads on production. After apply on each
  environment: ledger row, `has_table_privilege` false on both tables, no
  select policy, `pg_get_functiondef` of the guard contains
  `course_session_closed` and `quiz_session_closed`, the end RPC counts
  from `quiz_attempts`, and `quiz_close_sessions_counted` exists with
  `EXECUTE` for `service_role` only.
- Read-only staging query
  before build: count of self-study `quiz_attempts` whose stored
  `is_correct` disagrees with the server grader for MCQ rows (historical
  client flags, repair baseline).
- Immediate state versus full reload: after a verdict, reload restores the
  same progress from stored rows; counts equal.

## UI evidence

- Viewports/themes/input methods: player pending/error/retry at 375 and
  1280, light and dark, keyboard (Enter, Tab), screen reader live region;
  course sealed notice both variants; teacher counts.

## SA retest (ticket)

- GET Grammar/Vocab has no key field.
- Missing/unknown client contract marker on a self-study bank refetch is
  blocked (409, no questions); the pre-FR-010 tab reset/reopen journey passes.
- `/check` reveals no key before a stored attempt; none for a sealed Course item.
- A single_attempt Course answer saved through `/progress` and replayed through
  `/check` with the same session and `client_id` returns 409 with no key.
- Forged `is_correct` has no effect (`/progress`, time-cap).
- Time-cap rows regraded.
- A handed-in learner sees no key before `due_at`.
- Mastery peek via an abandoned session no longer helps.
- An open session collected by a failing mastery verdict refuses `/progress`
  (409 `course_session_consumed`, no key in the body, no row stored).
- An empty session opened before a failing mastery verdict refuses
  `/progress` the same way (sealed, listed in `superseded`).
- An answer racing the seal (held after admission, released after the
  verdict) is not stored; `/mistakes`, the report and resume show
  nothing from it.
- A learner JWT cannot read `quiz_attempts` or `quiz_sessions` through
  Supabase REST.
- single_attempt: store one answer, pause (and separately complete) the
  session, before and after hand-in: no learner body (end response,
  `/api/quiz/progress`, `/course-resume`, bank payload, "Bài của tôi")
  shows a correct/wrong count or accuracy for that session.
- A `/check` racing a managed Grammar session end leaves stored totals
  equal to a recount of the session's rows.
- On the intermediate deployment (rollout step A, keys still present), a
  bank with an explicit `text_match_by_qid` policy loads and grades in the
  FR-010 player.

## Release evidence

- Staging SHA and checks: pending T009.
- Production verification: pending (promotion PR).
