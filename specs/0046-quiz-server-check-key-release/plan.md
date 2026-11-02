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
  - `get_bank_for_play`: self-study projection without key fields (FR-009,
    after the rollout prerequisites and client-contract gate, see
    `rollout.md`), plus `answer_word_count` and
    `text_match_eligible`;
  - new `single_attempt_key_released(item, assignment, siblings)` used by
    `_course_review_gate`, `_sealed_course_session_ids` and the
    `/course-resume` builder; `single_attempt_answers_sealed` keeps its
    current meaning (handed in or not) for write admission;
  - `course_verdict`: server-side session collection, `mastery_score_policy()`,
    `session_count`/`attempt_count` in the ledger entry.
- `backend/models/grammar_quiz_revisions.py`: `QuizCheckBody`,
  `QuizCheckResponse` (`extra='forbid'`); `StudentQuizQuestion` keeps the key
  fields optional until FR-009 lands, then drops them and adds the two
  derived fields.
- `backend/routers/admin_class_assignments.py`: summary and per-learner rows
  expose `session_count`, `attempt_count` from the latest ledger entry.
- Frontend: `public/js/quiz-engine.js`, `app/(authed-quiz-player)/quiz/quiz-player.tsx`,
  `lib/quiz-player-api.ts` (send the contract marker on every bank fetch),
  `public/js/quiz-text-match-policy.js` (eligibility from
  `text_match_eligible` instead of `accept`), `public/js/course-runner.js`
  (one re-post on `verdict_sessions_incomplete`), course result/review page
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

`StudentQuizQuestion` for self-study: key fields removed from the projection
`_STUDENT_QUESTION_COLUMNS` path for self-study (Course is already without
them); `answer_word_count: int | None`, `text_match_eligible: bool` added
for every bank (computed in `get_bank_for_play` from the row the server
read). The model becomes key-free for every mode; the admin model
(`AdminQuizQuestion`) is unchanged.

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
  session list) → collection → completeness → scoring.
- Collection: `quiz_sessions` where `user_id`, `bank_id`,
  `class_assignment_item_id = item.id`, `coalesce(kind,'run') = phase`,
  `created_at > full_retry_boundary`, `id not in consumed` (all `sessions` in
  `item.mastery.attempts`), and at least one `quiz_attempts` row (paged).
- `client_ids ⊉ collected` → 422 `{code: 'verdict_sessions_incomplete',
  missing_session_ids: [...]}`. Listed sessions outside the collected set
  keep today's checks (owner/bank/item, ended). Request cap 200, never below
  `len(collected)`.
- A collected session with `ended_by` NULL/`paused` contributes attempts
  (before the timed cutoff) and is excluded from the "every session
  completed" and `sessions_finished_on_time` checks; coverage decides.
- Timed reaper (`_reap…` ~5740-5800): in mastery mode it passes the
  collected set; its orphan-subset rule stays for single_attempt only.
- `mastery_score_policy(attempts) -> dict[qid, attempt]`: first by server
  `created_at`, tie by `id`. The timed cutoff filter is applied before it.
- Retake: the "exactly one session" rule becomes "every unconsumed retake
  session with attempts"; sample size counts distinct qids.
- Ledger entry gains `session_count`, `attempt_count` (jsonb inside
  `class_assignment_items.mastery`, no schema change).

### Persistence and migration

No migration. All writes go to existing columns (`quiz_attempts`,
`quiz_sessions` totals, `class_assignment_items.mastery` jsonb). The unique
`client_id` index (migration 119) already exists. If the build finds that
any FR needs a new column, table, index or RPC change, it STOPs and reports
to PC/Leader (ticket rule).

### Compatibility

- New backend + old frontend: GET still carries keys until the separate
  FR-009 PR lands (step B in `rollout.md`); `/progress` ignores the client flag, so
  stored truth is correct; the old player still grades locally for display.
- New frontend + old backend: `/check` 404/405 → the player shows the error
  state and does not grade locally. Avoided by deploying backend first.
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
retest. Red-before-green evidence for FR-001/003/006/007/009/011/013,
including the FR-009 missing/unknown marker refusal and the pre-upgrade
tab reset/reopen journey across both promotions.

## Future direction (not built)

Per-learner option permutation for assessments (SA Q2-C third option): the
server would store a per-item permutation and grade `answer_given` through
it. Needs a stored permutation (schema), so it is a separate spec.
