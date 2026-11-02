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
  `_grade_single_attempt_rows`, CR P3); time-cap forwards no flag; every
  non-time-cap end closes through `quiz_close_sessions_counted` (managed:
  replaced `grammar_quiz_end_service`), no Python count; no per-session
  `score` for single_attempt; seal and dead-session sweep through the same
  function; `quiz_session_closed`/`course_session_closed` mapped to 409 in
  `/progress` and `/check`; single_attempt `/progress` refused after
  `due_at`. Tests: forged `is_correct` ignored in legacy, managed (PG)
  and time-cap (PG) paths; a row without `is_correct` is graded, not dropped;
  totals equal stored counts (self-study and Course) whatever the body
  says; overlapping check/end (CR R10 P2-1, PG, both orders, managed,
  legacy and Course; red with the 309 end RPC: stale 9/9 after a committed
  tenth row); a repeated end returns the same totals; missing qid → 422 not
  500; single_attempt write after `due_at` → 409; single_attempt end writes
  no item `score`. `owns: backend/services/quiz_service.py
  (log_progress, end_session, close_dead_course_sessions),
  backend/tests/test_quiz_server_grading.py` `depends: T002, T011`
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
- [ ] T011 Migration (FR-008 functions, FR-017, FR-018), through
  `/db-migrate`, before T004, T007 and T008.
  First the read-only inventory on staging and production: no client code,
  RPC or view callable by `anon`/`authenticated` reads `quiz_attempts` with
  or `quiz_sessions` with the caller's privileges (else STOP), and every
  `quiz_attempts` writer inserts only into open sessions (else STOP). PG
  tests first (red on the current schema): a learner JWT `SELECT` on
  `quiz_attempts` and on `quiz_sessions` returns rows today and none
  after; an insert into an ended Course session (mastery untimed, timed,
  single_attempt) is stored today and raises `course_session_closed`
  after, and into an ended self-study session raises
  `quiz_session_closed`, nothing stored; a held insert in an open session
  (Course and self-study) blocks a concurrent
  `quiz_close_sessions_counted` until it commits, and the close counts it;
  the overlapping managed progress/end pair of `plan.md` (red with the 309
  end RPC); `quiz_close_sessions_counted` returns ended rows unchanged,
  refuses a foreign id with nothing closed, and has no `EXECUTE` for
  `anon`/`authenticated`; inserts into open self-study, non-Course homework
  and managed Grammar sessions still store; the timed progress and
  finalize RPCs still store their rows; two concurrent inserts in sessions
  of one item and a seal over both do not deadlock. Rollback file
  restores the migration 284 body, the latest end-RPC body, policies and
  grants, and drops the new function. Staging apply through the locked
  runner before T004 merges.
  `owns: backend/migrations/<next>_course_answer_after_seal_guard.sql,
  backend/migrations/rollback/<next>_course_answer_after_seal_guard.sql,
  backend/tests/test_migration_<next>_course_answer_after_seal_guard.py`
  `depends: T001`
- [ ] T007 One-sitting key release (FR-011, FR-012), correctness totals
  withheld while locked (FR-019) and course review copy.
  Tests: A handed in, B not → A sealed before `due_at`, open after; null
  `due_at` opens only when all items handed in; read error → sealed;
  `due_at` moved later re-seals; `/mistakes`, `/course/report`,
  `/course-resume` all follow; teacher path unchanged. Paused one-question
  probe (CR R10 P1-1, red first: with FR-008 and without FR-019 the end
  response shows `total_correct` 0 vs 1): timed and untimed single_attempt
  item, one stored answer, session ended `paused` and `completed`, once
  before hand-in and once after hand-in before release; run twice, answer
  right and answer wrong; every learner body of the `plan.md`
  response-field table (end response incl. the unchanged-replay of an
  ended session, `/api/quiz/progress` with and without `skill_area` incl.
  `avg_accuracy`, `/course-resume`, bank payload `answers_sealed` and
  `word_cards`, `/course/report`, `/mistakes`, "Bài của tôi") is identical
  between the two runs and has `null` totals; no item `score` written by
  the end; after release the totals show; teacher views show them
  throughout.
  `owns: backend/services/quiz_service.py (release helper, review gate,
  mistakes filter, resume, locked-session totals in end_session response
  and student_progress, play payload), course review page,
  backend/tests/test_single_attempt_key_release.py` `depends: T001, T004, T011`
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
  `completed`; a new retake/full-retry session still accepts answers;
  runner drops the batch and reloads on `course_session_consumed`.
  Late insert (CR R9 P2-1, red first: under the R8 post-store re-read the
  row is stored and `/mistakes` returns its `correct_answer`; PG, real
  FR-018 trigger): a `/progress` batch with a wrong answer for qid X passes
  admission to an empty session E and is held before its insert; a failing
  verdict seals E and lists it in `superseded`; the held insert resumes →
  409 `course_session_consumed`, no `feedback`/key field, row count of E
  stays 0; then `/mistakes` has no entry for X from E (no
  `correct_answer`, no `explain`), `/course/report` and `/course-resume`
  show no row from E, and a learner-JWT REST read of `quiz_attempts`
  returns nothing. Same with E a collected session (listed in `sessions`):
  its row count equals the count the verdict read. Reverse order: the
  insert's guard runs first and is held open; the seal waits for its
  commit and the verdict reads the row (scored, or 422 if E was not
  listed).
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
  next verdict. A sealed empty retake session is never returned as
  `/course-resume` `retake`. One parametrised test walks every Course row
  of the `plan.md` case table: for refused and sealed rows it asserts no
  key field in the body and nothing stored; for rows where the table
  allows feedback (9, 15a, 16, 17) it asserts the expected `feedback` for
  the stored rows only; for each row it also checks the `/mistakes`, report
  and resume output the table names.
  `owns: backend/services/quiz_service.py
  (course_verdict, Course write admission, `course_session_closed`
  mapping in log_progress, course-resume retake filter),
  backend/routers/admin_class_assignments.py,
  frontend/public/js/course-runner.js, admin homework view,
  backend/tests/test_course_verdict_session_collection.py,
  frontend/tests/course-runner*.test.mjs` `depends: T001, T011`
- [ ] T009 Verification evidence: fill `verification.md`, staging journeys,
  SA retest request, `/check` latency sample.
- [ ] T010 Independent review (CR, `@codex review`) and convergence audit.
