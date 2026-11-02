# Tasks

Tasks are dependency ordered and test-first: each task lands its failing
tests before the code. No `[P]` task: all backend tasks touch
`services/quiz_service.py`.

Build is HOLD until this spec is approved on `staging` and #2091 (J411R2) is
on `staging` (merged `c7ed31b32`).

- [ ] T001 Contracts: `QuizCheckBody`, `QuizCheckResponse`, sealed
  `/course/report` fields, `verdict_sessions_incomplete` 422 body, ledger
  `session_count`/`attempt_count`, optional bank GET `quiz_contract` query
  and its 409 refresh-required response, `course_session_consumed` 409 body;
  derived `answer_word_count` and `text_match_eligible` on
  `StudentQuizQuestion`, computed in `get_bank_for_play` for every bank
  while the keys are still present (rollout step A, required before T005
  deploys). Tests: derived fields next to the keys for Grammar
  current/legacy and Vocab; eligibility equals today's `accept`-based rule
  for every question of a bank with an explicit `text_match_by_qid` policy.
  Regenerate `frontend/types/api.d.ts`.
  `owns: backend/models/grammar_quiz_revisions.py, backend/routers/quiz.py,
  backend/services/quiz_service.py (get_bank_for_play derived fields),
  backend/tests/test_quiz_bank_student_payload.py (derived fields),
  frontend/types/api.d.ts`
- [ ] T002 Server grader and parity fixture (FR-005): shared fixture, node
  and pytest parity tests (red first), `quiz_answer_grader.py`.
  `owns: backend/services/quiz_answer_grader.py,
  backend/tests/fixtures/quiz_grader_parity.json,
  backend/tests/test_quiz_answer_grader_parity.py,
  frontend/tests/quiz-grader-parity.test.mjs` `depends: T001`
- [ ] T003 `/check` (FR-001..FR-004): route + service, legacy and managed
  write paths, Course/Advanced Vocabulary refusal before the replay
  read-back, replay read-back before the ended check, refusals, review
  checks (FR-016). Tests: key only after the stored row; no key for foreign
  qid, foreign session, ended session, Course session, client_id conflict;
  single_attempt Course answer stored through `/progress` then replayed
  through `/check` with the same `client_id` → 409, no key;
  replay returns stored verdict also after the session ended; managed reset
  refusal; review: key for an answered qid, 409 and no key for an unanswered
  one, nothing stored. `owns: backend/routers/quiz.py, backend/services/quiz_service.py
  (check_answer), backend/tests/test_quiz_check_endpoint.py` `depends: T002`
- [ ] T004 Server grading everywhere (FR-006..FR-008): `log_progress` grades
  every self-study row, ignores client flag (no filter), metadata from the
  question row, 422 on missing/foreign qid (also
  `_grade_single_attempt_rows`, CR P3); time-cap forwards no flag; totals
  counted for every non-time-cap end; single_attempt `/progress` refused
  after `due_at`. Tests: forged `is_correct` ignored in legacy, managed (PG)
  and time-cap (PG) paths; a row without `is_correct` is graded, not dropped;
  totals equal stored counts (self-study and Course); missing qid → 422 not
  500; single_attempt write after `due_at` → 409. `owns: backend/services/quiz_service.py
  (log_progress, end_session), backend/tests/test_quiz_server_grading.py`
  `depends: T002`
- [ ] T005 Player on server verdicts (FR-010): engine record/apply split,
  player states, retry with the same `client_id`, review from verdicts,
  policy eligibility from `text_match_eligible` (from T001, already in the
  keyed step-A payload; a payload without it is a load error). Send
  `quiz_contract=server-check-v1` through `quiz-player-api.ts` on every
  self-study bank GET (initial load, managed reset, reopen); add a full page
  reload action for `quiz_client_refresh_required`, without local grading.
  Node tests for
  `quiz-engine.js` (credit only after verdict; no local grading; retry
  idempotent; adaptive loop unchanged given the same verdicts), a policy
  validator test on a keyed step-A payload with derived fields and an
  explicit `text_match_by_qid` policy (bank accepted, typo mode applied),
  and React/API tests for player states, marker on every bank fetch and
  refresh action.
  `owns: frontend/lib/quiz-player-api.ts, frontend/public/js/quiz-engine.js,
  frontend/public/js/quiz-text-match-policy.js,
  frontend/app/(authed-quiz-player)/quiz/quiz-player.tsx,
  frontend/tests/quiz-engine*.test.mjs, frontend/tests/react/quiz-player*`
  `depends: T001, T003`
- [ ] T006 Key-free self-study payload (FR-009): projection without keys
  (derived fields already shipped by T001),
  `test_quiz_bank_student_payload.py` tightened to "no mode has a key
  field". First add red route tests: missing or unknown `quiz_contract`
  returns 409 `quiz_client_refresh_required` with no questions or key fields;
  `server-check-v1` returns 200 key-free; existing auth/access refusals and
  Course admission remain unchanged. Enforce the server gate before
  building/returning the self-study play payload. Keep a pre-FR-010 tab open
  across both promotions and verify reset/reopen is blocked, then a full
  page reload recovers (verification.md). A separate PR, merged after the
  T005 frontend is live on the same environment and promoted in a later
  promotion; block key removal until this guard and journey pass (rollout
  step B). `owns: backend/routers/quiz.py, backend/services/quiz_service.py
  (get_bank_for_play), backend/tests/test_quiz_bank_student_payload.py`
  `depends: T005`
- [ ] T007 One-sitting key release (FR-011, FR-012) and course review copy.
  Tests: A handed in, B not → A sealed before `due_at`, open after; null
  `due_at` opens only when all items handed in; read error → sealed;
  `due_at` moved later re-seals; `/mistakes`, `/course/report`,
  `/course-resume` all follow; teacher path unchanged.
  `owns: backend/services/quiz_service.py (release helper, review gate,
  mistakes filter, resume), course review page,
  backend/tests/test_single_attempt_key_release.py` `depends: T001`
- [ ] T008 Verdict collection and policy (FR-013..FR-015): server collection,
  422 with missing ids, `mastery_score_policy()`, ledger counts, teacher
  views, runner re-post (at most twice), reaper on the collected set
  (mastery only).
  Tests: abandoned wrong session + 100 % session → verdict reflects the
  abandoned answers (red on staging before the fix); dropped session → 422;
  replay of a recorded verdict after a full retry → recorded verdict, not
  422; > 40 collected sessions accepted; abandoned session does not turn an
  on-time completion into a timeout; reaper in mastery mode; single_attempt
  reaper orphan rule unchanged; retake union; full-retry boundary; NULL
  kind = run; teacher rows show counts. Seal (FR-013): after a recorded
  failing verdict that collected an open session, `/progress` to that
  session with a new and with a replayed `client_id` → 409
  `course_session_consumed`, body has no `feedback`/`answer`/`accept`/
  `explain`/`why_wrong`, no row stored (red first: with collection but
  without the seal it returns 200 with feedback); a 422 incomplete verdict seals
  nothing; seal update failure or a still-open re-read → 500, nothing
  recorded, retry collects the same sessions; concurrent normal end keeps
  `completed`; race seam (session sealed between admission and store) →
  409 without feedback; a new retake/full-retry session still accepts
  answers; runner drops the batch and reloads on `course_session_consumed`.
  Pre-verdict empty session (Codex r4441040944, red first: with the
  collected-only seal it returns 200 with feedback): untimed mastery item,
  empty run session E opened, failing `retry_full` verdict recorded from
  other sessions, then `/progress` to E with a new and a replayed
  `client_id` → 409 `course_session_consumed`, no key field in the body,
  row count of E stays 0, E `ended_by='abandoned'` and listed in
  `superseded`; same for a `retake` verdict; same against a ledger entry
  recorded before this change (no `superseded`, E older than `at`); a run
  session opened after the verdict still gets feedback. Kind rule: a `run`
  session while a retake is due and a `retake` session after `retry_full`
  → 409. Post-seal re-collection: a session that gets its first attempt
  between the first collection and the seal → 422 with its id, sealed,
  nothing recorded, re-post scores it. A session opened after the seal
  stays open, is not superseded, and its attempts are collected by the
  next verdict. One parametrised test walks every Course row of the
  `plan.md` case table and asserts no key field in any response body.
  `owns: backend/services/quiz_service.py
  (course_verdict, Course write admission, log_progress feedback re-read),
  backend/routers/admin_class_assignments.py,
  frontend/public/js/course-runner.js, admin homework view,
  backend/tests/test_course_verdict_session_collection.py,
  frontend/tests/course-runner*.test.mjs` `depends: T001`
- [ ] T009 Verification evidence: fill `verification.md`, staging journeys,
  SA retest request, `/check` latency sample.
- [ ] T010 Independent review (CR, `@codex review`) and convergence audit.
