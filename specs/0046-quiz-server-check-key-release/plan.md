# Implementation plan

Line numbers are on `origin/staging` @ `bf22c10ee` (after #2091). They move;
the function names are the anchors.

## Architecture impact

- `backend/routers/quiz.py`: new `POST /sessions/{session_id}/check`
  (`asyncio.to_thread`, never `aexecute`, as every route in this router).
  Bank GET accepts the optional `quiz_contract` query parameter; FR-009
  enforces `server-check-v1` for self-study before returning any questions.
  `CourseVerdictBody` unchanged on the wire.
- `backend/services/quiz_service.py`:
  - new `check_answer(user_id, session_id, body)`;
  - new module `backend/services/quiz_answer_grader.py` with
    `grade_quiz_answer()` (FR-005), imported by `quiz_service`; `grade_attempt`
    stays and is the integer branch;
  - `log_progress`: grade every self-study row (legacy and managed branch),
    422 on a missing/foreign `qid` in every branch (`_grade_single_attempt_rows`
    included);
  - `end_session`: time-cap rows graded before the RPC; self-study totals
    counted from stored rows;
  - `get_bank_for_play`: `answer_word_count` and `text_match_eligible`
    on every bank from rollout step A (FR-010 build, keys still present);
    self-study projection without key fields only in step B (FR-009, after
    the rollout prerequisites and client-contract gate, see `rollout.md`);
  - new `single_attempt_key_released(item, assignment, siblings)` used by
    `_course_review_gate`, `_sealed_course_session_ids` and the
    `/course-resume` builder; `single_attempt_answers_sealed` keeps its
    current meaning (handed in or not) for write admission;
  - `course_verdict`: server-side session collection, seal of every open
    session of the item before scoring, re-collection after the seal
    (FR-013), `mastery_score_policy()`, `session_count`/`attempt_count`/
    `superseded` in the ledger entry;
  - `_assert_quiz_progress_writable` / `log_progress` (Course branch):
    409 `course_session_consumed` for a session that is ended, consumed,
    superseded, older than a pre-change entry or of a `kind` the latest
    entry does not allow, before any read-back; the FR-018 guard error
    (`course_session_closed`) from the upsert mapped to the same 409
    (mastery), the existing closed message (single_attempt) or the timed
    phase conflict;
  - `get_course_resume`: the pending-retake candidates also exclude ids
    listed in any ledger entry's `superseded`.
- `backend/migrations/<next>_course_answer_after_seal_guard.sql` (number
  allocated at build time through `/db-migrate`) plus its rollback file:
  FR-018 replacement of `guard_single_attempt_course_answer()` and FR-017
  revoke of the learner's direct `quiz_attempts` read. The only migration;
  see Persistence and migration.
- `backend/models/grammar_quiz_revisions.py`: `QuizCheckBody`,
  `QuizCheckResponse` (`extra='forbid'`); `StudentQuizQuestion` gains the two
  derived fields in step A (T001, with the keys still optional) and drops
  the key fields only when FR-009 lands (step B).
- `backend/routers/admin_class_assignments.py`: summary and per-learner rows
  expose `session_count`, `attempt_count` from the latest ledger entry.
- Frontend: `public/js/quiz-engine.js`, `app/(authed-quiz-player)/quiz/quiz-player.tsx`,
  `lib/quiz-player-api.ts` (send the contract marker on every bank fetch),
  `public/js/quiz-text-match-policy.js` (eligibility from
  `text_match_eligible` instead of `accept`), `public/js/course-runner.js`
  (at most two re-posts on `verdict_sessions_incomplete`; `course_session_consumed`
  handled as a superseded session), course result/review page
  (sealed-after-hand-in copy), admin class homework views (two counts).
  `frontend/types/api.d.ts` regenerated.

## Data and contracts

### `POST /api/quiz/sessions/{session_id}/check`

Request (`QuizCheckBody`, `extra='forbid'`):

| field | type | rule |
| --- | --- | --- |
| `client_id` | UUID string | required; idempotency key |
| `qid` | string, 1–200 | required; must be in the session's bank/revision |
| `answer_given` | string, ≤ 2000 | required; serialized exactly as `serializeAnswer` does today |
| `response_time_ms` | int ≥ 0 | optional, coerced as in `/progress` |
| `attempt_no` | int ≥ 1 | optional |
| `review` | bool | default false; forced true for a managed review session (FR-016) |

Success 200 (`QuizCheckResponse`, `extra='forbid'`):

| field | type | note |
| --- | --- | --- |
| `client_id`, `qid` | string | echo of the **stored** row |
| `is_correct` | bool | server verdict of the stored `answer_given` |
| `corrected` | string \| null | canonical accepted form when a typo-tolerant match passed |
| `answer` | int \| bool \| null | key of this question |
| `accept` | list[string] \| null | accepted forms (text) |
| `explain` | string \| null | explanation |
| `why_wrong` | string \| null | entry for the picked option only |
| `replayed` | bool | true when the row already existed |

Errors (no key field in any error body): 404 not owned / missing; 409
`session_ended`, `check_not_for_course`, `client_id_conflict`, managed
Grammar refusals as in `/progress`; 422 unknown qid, malformed body,
ungradable question; 500 storage error (row not stored, no key).

Order inside `check_answer`: ownership (404) → Course/Advanced Vocabulary
refusal (FR-002; before any read of `quiz_attempts`, so a Course
single_attempt row stored through `/progress` can never be replayed through
`/check` to obtain its key) → replay read-back by `client_id` (FR-004;
returns the stored verdict even if the session has since ended — the
ended-session exception applies to eligible self-study sessions only) →
ended-session refusal → qid lookup → grade → store → respond. Review (FR-016): after the qid lookup, one
read `quiz_attempts` (user, bank, qid, limit 1); none → 409
`review_needs_attempt`; else grade and respond with `replayed=false`, no
write, no KP evidence.

Write path per session kind:

- legacy self-study: `quiz_attempts.upsert(on_conflict='client_id',
  ignore_duplicates=True)`; inserted row from `RETURNING`; on an empty
  return, read back by `client_id` + `user_id` + `session_id` (as #2091's
  `_course_attempt_feedback`); not found under this session → 409.
- managed Grammar: `grammar_quiz_session.progress(..., attempts=[row],
  stats=[])` (same serialized boundary, reset and revision checks); key
  returned only when the row is in `newly_inserted_attempts` or read back.
- KP evidence: `_record_quiz_kp_evidence` for newly inserted rows only, as
  in `/progress`.

### Server grader parity

`backend/tests/fixtures/quiz_grader_parity.json`: list of
`{question, answer_given, text_match_mode, expected: {correct, exact,
canonical}}` covering each branch of `gradeQuestion`/`gradeText`/
`textFuzzyAllowed`/`withinEditDistance1`/`normalizeText` (case-sensitive,
punctuation-only accept, Unicode whitespace, `exact` vs `typo_tolerant`,
orthography types, long-phrase exception, boolean strings `"true"/"false"`,
choice `" 01 "`). `frontend/tests/quiz-grader-parity.test.mjs` and
`backend/tests/test_quiz_answer_grader_parity.py` both load it.

### `/progress` and time-cap

- `ProgressBody` unchanged on the wire; `is_correct` becomes optional,
  ignored and no longer a filter (rows without it are graded, not dropped).
  Old bundles keep working. Time-cap: `p_attempts` rows carry the stored
  identity fields; `is_correct` is not forwarded (migration 276 reads only
  `client_id` and counts from stored rows).
- single_attempt Course `/progress` after `due_at` and before hand-in: 409
  (`is_accepting_submissions` false), reusing the existing message
  "Đã quá hạn nộp".
- Session totals: `end_session` counts the session's stored attempts
  (`count(*)`, `count(*) filter (is_correct)`) for every non-time-cap end.
- `QuizSessionProgressResponse` unchanged.
- `EndSessionBody` unchanged; totals in the body ignored (FR-008).

### Payload (FR-009)

Derived fields, step A (T001, before T005 deploys): `answer_word_count:
int | None` and `text_match_eligible: bool` are added for every bank,
computed in `get_bank_for_play` from the row the server read, while the
self-study keys are still in the payload. `text_match_eligible` is computed
with the same rule `quiz-text-match-policy.js` applies to `accept` today
(`input` is `text`, `type` in `TEXT_TYPES`, a valid `accept` list), so
on the intermediate deployment the FR-010 validator accepts exactly the
policy entries the old one did. The FR-010 validator then reads only the
derived field.

Key removal, step B (T006): key fields removed from the projection
`_STUDENT_QUESTION_COLUMNS` path for self-study (Course is already without
them). The model becomes key-free for every mode; the derived fields stay;
the admin model (`AdminQuizQuestion`) is unchanged.

The FR-010 player sends `quiz_contract=server-check-v1` on every self-study
bank GET through `quiz-player-api.ts`, including the fetch in managed
Grammar `resetProgress()` and reopening a bank in the same tab. The query
parameter is optional on the wire so old requests reach the explicit
compatibility refusal rather than FastAPI's generic missing-field 422.
Before FR-009, requests without the marker still receive today's keyed
self-study payload. With FR-009, after existing auth/access checks and
before building the play payload, the server rejects a missing or unknown
marker with 409 and `{detail: {code: 'quiz_client_refresh_required',
message: 'Bài luyện tập đã cập nhật. Hãy tải lại trang để tiếp tục.'}}`.
The error contains no questions or key fields. The exact supported marker
receives the key-free payload. No request can opt into legacy keys after
FR-009. Course requests and their admission behavior are unchanged; no
migration or flag is needed.

### Key release (FR-011/FR-012)

`single_attempt_key_released(item, assignment, now, all_items_submitted)`:
`handed_in(item) and (due_at_passed(assignment, now) or all_items_submitted)`.
`all_items_submitted` is one read of `class_assignment_items`
(`assignment_id`, `student_id`, `submitted_at`, `mastery`) per assignment,
paged, restricted to learners still active in the cohort (the membership
rule `/my-class` uses), and only when `due_at` is null or in the future. `/course/report` sealed body adds
`handed_in`, `answers_release_at`, `release_rule`.

### Verdict (FR-013..FR-015)

- Mastery mode only. Order: existing recorded-verdict replay match (exact
  session list; also the multi-section update of that entry) → collection
  → completeness → seal → re-collection → attempts read → score → ledger
  write. The whole sequence runs inside the existing `updated_at` CAS loop;
  a CAS conflict restarts from the collection (sealed sessions stay closed
  and unconsumed).
- Current generation of (user, bank, item), one helper
  `_course_session_generation(session, item)` used by collection and write
  admission: the session id is in no ledger entry's `sessions` or
  `superseded`; for every entry without a `superseded` key (recorded before
  this change) `created_at > entry.at` (the full-retry boundary is the
  newest such `at`; same app-vs-DB clock comparison as today's
  `_full_retry_boundary`); and, for admission only, `kind` (NULL = `run`)
  is the kind the latest entry allows: no entry → `run`; `retry_full` →
  `run`; latest entry without a recorded action (multi-section attempt
  waiting for another section) → `run`; `retake` → `retake`;
  `passed`/`timed_out`/`completed` → none. These are the kinds the timed
  start RPC (migration 270) and `_assert_retake_allowed` already enforce at
  creation. Collection is `kind`-agnostic so an answer stored in a session
  opened while a verdict was in flight is still collected by the next one.
- Collection: current-generation sessions of (`user_id`, `bank_id`,
  `class_assignment_item_id = item.id`) with at least one `quiz_attempts`
  row (paged). The phase (`run`/`retake`) decides the scored qid set and
  rules only.
- `client_ids ⊉ collected` → 422 `{code: 'verdict_sessions_incomplete',
  missing_session_ids: [...]}`. Listed sessions outside the collected set
  keep today's checks (owner/bank/item, ended). Request cap 200, never below
  `len(collected)`.
- A collected session with `ended_by` NULL/`paused`/`abandoned` contributes
  attempts (before the timed cutoff) and is excluded from the "every session
  completed" and `sessions_finished_on_time` checks; coverage decides.
- Timed reaper (`_reap…` ~5740-5800): in mastery mode it passes the
  collected set; its orphan-subset rule stays for single_attempt only.
- `mastery_score_policy(attempts) -> dict[qid, attempt]`: first by server
  `created_at`, tie by `id`. The timed cutoff filter is applied before it.
- Retake: the "exactly one session" rule becomes "every collected session
  with attempts"; sample size counts distinct qids.
- Ledger entry gains `session_count`, `attempt_count` and `superseded`
  (list of session ids; jsonb inside `class_assignment_items.mastery`, no
  schema change; not part of the learner-safe `_course_attempt_history`
  shape).
- Seal (FR-013): one PostgREST update on `quiz_sessions`
  `.eq("user_id").eq("bank_id").eq("class_assignment_item_id", item.id)
  .is_("ended_at","null").is_("ended_by","null")` setting `ended_at=now`,
  `ended_by='abandoned'` (the value the dead-session sweep already writes;
  every stage count and verdict filter keys on `'completed'`). It closes
  every open session of the item, not only the collected ones: empty
  sessions, the other phase, and sessions opened before an earlier verdict.
  The update takes each session row lock, so it waits for every insert
  holding the FR-018 `FOR SHARE` lock on that row and lands after that
  insert commits; any insert whose guard runs after the update is refused.
  The rows of a sealed session are final once the update returns.
  Then one re-read of the item's sessions (with attempt existence):
  a first-collection session still open → 500, nothing recorded; the
  re-collected set (closed current-generation sessions with attempts) not
  covered by `client_ids` → 422 `verdict_sessions_incomplete` (sealed,
  nothing recorded, the re-post collects them); closed current-generation
  sessions without attempts → `superseded`; sessions still open were
  created after the seal → next generation, untouched. Totals of a sealed
  session are then written from the attempts just read (the FR-008 counting
  rule; a failure there is logged and does not fail the verdict, the
  attempts table stays canonical). No new column, value check or RPC (the
  only schema change is the FR-018 trigger function and the FR-017 revoke):
  `ended_by` is free text (migration 119) and the managed Grammar session
  trigger (migration 309) never sees Course sessions. Timed Course
  `/progress` goes through the session-locking RPC (migrations 276/279),
  which already refuses an ended session under the row lock.
- Write admission (`_assert_quiz_progress_writable`, Course branch, mastery
  mode, the item row it already reads plus the session's `kind` and
  `created_at` from `_owned_session`): ended (sealed included) or not in the
  current generation (above, `kind` rule included) → 409 `{code:
  'course_session_consumed', message: 'Lượt làm này đã được xét kết quả.
  Đang tải lại tiến độ mới nhất.'}`. It runs before the replay read-back
  of `_course_attempt_feedback`, so a replayed `client_id` gets no key
  either, and before the timed RPC call. Admission and insert are not one
  transaction, so admission alone leaves a window. The FR-018 guard closes
  it in the database, so `log_progress` needs no post-store re-read:
  - insert's guard runs before the seal's update: the seal waits for the
    commit; the verdict's re-collection and attempts read (both after the
    seal) see the row, so it is scored (or the verdict answers 422 and the
    re-post scores it). Feedback from that committed row is safe;
  - guard runs after the seal: `course_session_closed`, the whole upsert
    fails, nothing is stored, `log_progress` returns 409
    `course_session_consumed` before `_course_attempt_feedback` runs.
    There is no late row, so `/mistakes`, `/course/report`,
    `/course-resume` and the replay read-backs have nothing to show,
    and a `superseded` session stays empty forever.
- The Codex r4441040944 case (empty session E opened before a failing
  `retry_full` verdict): E is open at the seal → sealed and listed in
  `superseded` → `/progress` 409 before any read-back. For a verdict
  recorded before this change (no seal ran): E's `created_at` ≤ that
  entry's `at` → 409. Either way E never yields feedback, so the
  `created_at > full_retry_boundary` exclusion can no longer drop answers
  that revealed a key.

### Answer-protection case table (FR-002, FR-011, FR-013)

Every session state against every learner endpoint that can return a key or
per-question correctness. "Key" = `answer`, `accept`, `explain`,
`why_wrong` or `feedback`. Read paths = `/mistakes` rows
(`correct_answer`, `explain`; a row's presence also says "wrong"),
`/course/report` level 1 (`is_correct` per question, in bank order) and
level 2 (key), `/course-resume` (`answered[].is_correct`,
`retake.answered[].is_correct`, `last_stage`). Walked once and not
repeated per row, because they return no key or correctness in any state:
Course `GET /banks/{id}` (#2091); self-study GET after FR-009;
`/api/quiz/progress` (session totals); `/banks/{id}/resume`
(client-owned `quiz_word_stats`); direct REST `quiz_attempts` (no row
after FR-017); direct REST `quiz_questions` (RLS on, no policy: no row;
staging 02/11); direct REST `quiz_sessions` (totals only). Late rows: after
FR-018 no row can be stored in an ended Course session, so the read paths
of every sealed or superseded state show only rows a verdict reads.

| # | Session state | `/check` | `/progress` (new `client_id`) | Replayed `client_id` | Read paths | Test (task) |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Self-study open (legacy Grammar, managed Grammar, Vocab, self-study bank as non-Course homework) | Store, then key of that qid only | Stored, server-graded; response has counts, no key | `/check`: stored verdict of the stored row; `/progress`: deduplicated, no key | Not Course, no seal | T003, T004 |
| 2 | Self-study, empty (no attempt yet) | As 1; review check → 409 `review_needs_attempt` | As 1 | n/a | n/a | T003 |
| 3 | Self-study ended (completed/paused/time_cap, other tab) | Replay → stored verdict (key already revealed for that stored answer); new → 409, no key | 409 ended | As `/check` | n/a | T003 |
| 4 | Self-study review session | Key only for a qid with a stored attempt in the bank; else 409; nothing stored | Managed RPC refuses (`grammar_review_read_only`) | n/a | n/a | T003 |
| 5 | `client_id` already stored under another session or user | 409 `client_id_conflict`, no key | Dedup ignores it; feedback read-back filters on this session → nothing | same | n/a | T003, T008 |
| 6 | Session of another user / missing | 404, no key | 403/404 (`_owned_session`), nothing stored | same | Teacher paths only | T003 |
| 7 | Advanced Vocabulary | 409 before read-back | No key in self-study `/progress` response | 409 | n/a | T003 |
| 8 | Course, any mode, any state | 409 `check_not_for_course` before read-back | see 9–22 | `/check` 409 before read-back | see 9–22 | T003 |
| 9 | Mastery, current generation, open (no entry; or created after the latest entry with the allowed `kind`) | 409 (8) | Stored, graded, `feedback` for the stored rows | Feedback of the row stored in this session | Mastery unchanged (answered rows) | T008 |
| 10 | Mastery, collected by a verdict, was open → sealed (`abandoned`) | 409 | 409 `course_session_consumed`, nothing stored | 409 before read-back | Answered rows only | T008 (red: collection without seal) |
| 11 | Mastery, collected, already ended | 409 | 409 (ended or consumed) | 409 | Answered rows only | T008 |
| 12 | **Mastery, empty, opened before a failing verdict (`retry_full` or `retake`), new ledger entry** | 409 | 409: sealed + `superseded` | 409 | No rows, ever (FR-018); `/course-resume` never offers it as the pending retake | T008 (red: Codex r4441040944) |
| 13 | **Same as 12, verdict recorded before this change** (no seal, no `superseded`) | 409 | 409: `created_at` ≤ entry `at` | 409 | No rows | T008 |
| 14 | Mastery, `kind` not allowed now (`run` while a retake is due; `retake` after `retry_full`; anything after `passed`) | 409 | 409 `course_session_consumed` | 409 | n/a | T008 |
| 15 | **Mastery, batch admitted before the seal, its insert reaches the guard after the seal** (session empty → `superseded`, or collected → `sessions`) | 409 | FR-018 refuses the whole upsert: nothing stored, 409 `course_session_consumed`, no feedback | 409 at admission | No row from this batch: `/mistakes` has no entry for it (no `correct_answer`/`explain`), report and resume show no row, REST read none | T008 late insert (red: under the R8 post-store re-read the row is stored and `/mistakes` returns its `correct_answer`) |
| 15a | Mastery, insert's guard ran before the seal, commit after it | 409 | Seal waits for the commit; feedback from the committed row; the verdict reads it (scores it, or 422 if the session was not listed) | After the seal: 409 at admission | Answered rows (all read by the verdict) | T008 lock order (PG: held insert blocks the seal) |
| 16 | Mastery, batch stored before the seal in a session the client did not list | 409 | Feedback (session was open) | — | — | T008: post-seal re-collection → 422, re-post scores it |
| 17 | Mastery, session opened after the seal while the verdict is in flight | 409 | Feedback if admitted; rows collected by the next verdict whatever `kind`; refused after the ledger write if `kind` not allowed | As `/progress` | Answered rows | T008 |
| 18 | Mastery, first completeness 422 (no seal) | 409 | Unchanged (still current generation) | — | — | T008 |
| 19 | Mastery, verdict failed after the seal (500/CAS exhausted) | 409 | 409 (sealed); next verdict collects them (not consumed, not superseded) | 409 | — | T008 |
| 20 | Mastery, `paused`, `completed`, `time_cap` | 409 | 409 ended | 409 | Answered rows | existing + T008 |
| 21 | Mastery, item passed / timed expired | 409 | 409 (`review` / timer) | 409 | Answered rows | existing |
| 22 | Timed Course `end_session` `time_cap` with final batch | 409 | Verification-only RPC, no key in response | — | — | T004 |
| 23 | single_attempt, open, not handed in, before `due_at` | 409 | Stored, graded, **no** `feedback` | No feedback | Sealed | #2091 + T004 |
| 24 | single_attempt, after `due_at`, not handed in | 409 | 409 (FR-006) | 409 | Sealed | T004 |
| 25 | single_attempt, handed in, before release | 409 | 409 (`review`) | 409 | Sealed (FR-011), `handed_in`, `answers_release_at` | T007 |
| 26 | single_attempt, handed in, released (`due_at` passed or all active learners handed in) | 409 | 409 | 409 | Open for the learner's own rows | T007 |
| 27 | single_attempt, release read error, or `due_at` moved later | 409 | 409 | 409 | Sealed | T007 |

### Persistence and migration

One migration (Q-8), no new column, table or index. Data writes go to
existing columns (`quiz_attempts`, `quiz_sessions` totals and, for the
FR-013 seal, `ended_at`/`ended_by`, `class_assignment_items.mastery`
jsonb, including the new `superseded` list). The unique `client_id` index
(migration 119) already exists.

Migration `<next>_course_answer_after_seal_guard.sql` (forward only,
`BEGIN; … COMMIT;`, applied through the locked runner):

- FR-018: `CREATE OR REPLACE FUNCTION public.guard_single_attempt_course_answer()`,
  same name, trigger and `SECURITY DEFINER`/`search_path` as migration 284.
  Body: (1) find the session's Course item without locks
  (`quiz_sessions` → `class_assignment_items` → `class_assignments`,
  `skill='course'`); not Course → `RETURN NEW` (self-study unchanged);
  (2) `SELECT ended_at, ended_by FROM quiz_sessions WHERE id =
  NEW.session_id FOR SHARE`; (3) today's `cai`/`ca` `FOR UPDATE` read and
  single_attempt rules; (4) `ended_at` or `ended_by` set → `RAISE
  EXCEPTION 'course_session_closed' USING ERRCODE = '55000'`. Lock order
  `qs` → `cai` → `ca`, as `quiz_insert_timed_course_attempts` (migration
  279, `FOR UPDATE OF qs, cai, ca, scm`). Existing writers stay valid: the
  timed progress RPC (279) and `quiz_finalize_timed_course_session` (275)
  insert while the session is still open and end it later in the same
  transaction; untimed `/progress` already refuses ended sessions at
  admission. Re-issue the migration 285 `REVOKE ALL … FROM PUBLIC, anon,
  authenticated` on the function.
- FR-017: `DROP POLICY IF EXISTS quiz_attempts_select ON
  public.quiz_attempts; REVOKE SELECT ON public.quiz_attempts FROM anon,
  authenticated;`. Precedent: `347_listening_tests_client_revoke.sql`.
- Rollback file: restores the migration 284 function body, the policy and
  the grant. Rolling back FR-018 reopens the late-row race; rollback is for
  a broken insert path only.
- PG tests (local cluster, real trigger): a held insert blocks the seal
  update until commit, then the verdict reads the row; an insert after the
  seal raises `course_session_closed` and stores nothing; self-study and
  managed Grammar inserts never take the session lock; the timed progress
  and finalize RPCs still store their rows; `authenticated` has no
  `SELECT` on `quiz_attempts`.

If the build finds that any FR needs another column, table, index or RPC
change, it STOPs and reports to PC/Leader (ticket rule).

### Compatibility

- Migration first: it is applied to an environment before the code that
  maps `course_session_closed` and before the FR-013 seal ships there.
  Old code with the migration: a refused insert surfaces as today's
  upsert failure (500, nothing stored, no key) only in the race window
  after a session already ended, which old admission already refuses; no
  old code path reads `quiz_attempts` with a learner JWT.
- New backend + old frontend: GET still carries keys until the separate
  FR-009 PR lands (step B in `rollout.md`); `/progress` ignores the client flag, so
  stored truth is correct; the old player still grades locally for display.
- New frontend + old backend: `/check` 404/405, and the bank GET has no
  `text_match_eligible` → the player shows the error state and does not
  grade locally. Avoided by deploying backend first (step A).
- After FR-009: a pre-FR-010 tab sends no contract marker, so the server
  returns 409 `quiz_client_refresh_required` without questions on every
  self-study bank refetch. Existing bank-load error handling blocks the
  reset/reopen path before the old grader/policy validator sees a key-free
  bank. Old JavaScript cannot acquire new error-specific UI by deployment;
  it shows its existing error and requires a full page reload. FR-010
  clients handle this code with the refresh state in `ui-states.md`; the
  action reloads the page, not just the bank. A reload loads the current
  bundle and marker; then `/check` supplies verdicts. Separate promotions
  remain required, but the server gate protects tabs spanning them.
- Keys downloaded before FR-009 remain in an old tab's memory and cannot
  be recalled. That tab may keep using its cached keyed bank without a
  refetch; FR-006/FR-008 still own stored correctness and totals. This gate
  prevents incompatible fresh payloads, not access to already-downloaded keys.

## UI and interaction

See `ui-states.md`. Ownership: `quiz-player.tsx` owns pending/error/retry
for self-study; the course review page owns the sealed-after-hand-in state;
admin class homework owns the two counts.

## Work decomposition

See `tasks.md`. Backend contract and grader first (test-first), then
`/check` and server grading, then frontend, then FR-009 key removal, then
key release and verdict collection. Course and self-study work touch
different functions of `quiz_service.py` but the same file; do not split
across parallel jobs.

## Rollout and rollback

See `rollout.md`.

## Verification strategy

Pytest through TestClient + response models for every FR; PG tests where an
RPC is involved (managed Grammar `progress`, timed finalize); node tests for
engine and parity; a browser verifier for the player states; staging SA
retest. Red-before-green evidence for FR-001/003/006/007/009/011/013/017/018,
including the FR-009 missing/unknown marker refusal, the pre-upgrade
tab reset/reopen journey across both promotions, and the late insert
racing the seal followed by `/mistakes` (row stored and key shown before
FR-018; refused and nothing shown after).

## Future direction (not built)

Per-learner option permutation for assessments (SA Q2-C third option): the
server would store a per-item permutation and grade `answer_given` through
it. Needs a stored permutation (schema), so it is a separate spec.
