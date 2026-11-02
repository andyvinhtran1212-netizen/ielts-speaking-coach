---
id: SERVERCHECK-0046
title: Self-study quiz answers are graded on the server one question at a time, no learner can forge a correct answer, and a one-sitting assessment key stays closed until the class deadline
status: draft
risk: high
owner: product
---

# Self-study quiz answers are graded on the server one question at a time, no learner can forge a correct answer, and a one-sitting assessment key stays closed until the class deadline

Status: **draft, not approved**. Job 1j2 (PC-J412 + addendum PC-J412R2 +
Leader addenda 30/10 21:27, 22:12, 22:14) writes the spec only. Build (step 2)
starts only after Vinh approves this spec on `staging` and is queued by the
Leader as a separate job.
Spec number: **0046**, allocated by FD on 02/11 09:35 (spec number register,
`/workspace/cc-jobs/spec-number-register.md`).
Origin: SA-BANK-ANSWERS (`/workspace/qa/sa-bank-answers/report.md` §5 items
3–6 and follow-up Q2-B, Q2-C, Q3), CR `reviews/PR-2091.md` (21:21, 22:12).
Builds on PR #2091 (PC-J411R2, merged `c7ed31b32`): Course banks are already
sealed in every mode and graded on the server in `/progress`.

## Tóm tắt (tiếng Việt)

Người dùng sẽ thấy gì sau thay đổi này:

- **Quiz tự học (Grammar, Vocab Quick-Check):** học viên vẫn trả lời từng câu
  và vẫn thấy ngay đúng/sai, đáp án đúng và lời giải **sau khi** trả lời câu
  đó. Khác biệt duy nhất nhìn thấy được: sau khi bấm, nút hiện "Đang chấm…"
  trong khoảng một lượt gọi máy chủ (thường dưới 1 giây). Nếu mạng lỗi, câu
  hiện "Chưa chấm được — Thử lại", không tự chấm trên máy và không chuyển câu.
  Đáp án không còn nằm sẵn trong dữ liệu đề tải về (mở tab Network không còn
  đọc được đáp án trước khi trả lời).
- **Điểm không giả được:** máy chủ tự chấm mọi câu trả lời được lưu, ở mọi chế
  độ. Cờ "đúng/sai" do trình duyệt gửi lên bị bỏ qua. Tổng điểm của phiên tự
  học cũng do máy chủ đếm.
- **Bài một lượt / bài kiểm tra cuối khoá (single_attempt):** em nộp xong
  **chưa** xem được đáp án từng câu cho tới khi qua hạn nộp của bài giao (hoặc
  khi cả lớp đã nộp). Màn xem lại hiện "Đã nộp. Đáp án sẽ mở sau <giờ, ngày>"
  (hoặc "khi cả lớp đã nộp bài" nếu bài không có hạn). Như vậy em nộp trước
  không chuyển được đáp án cho em chưa làm. Cũng cho tới lúc đó, **không
  màn nào hiện số câu đúng/sai hay tỉ lệ đúng của từng phiên (từng chặng)**
  của bài này (kết thúc chặng, tạm dừng, "Tiến độ luyện tập", khôi phục
  chặng). Lý do: máy chủ giờ tự đếm điểm phiên, nên nếu vẫn hiện thì em có
  thể lưu một câu, tạm dừng và đọc "0/1" để biết câu ấy sai. Điểm **cả
  bài** sau khi nộp vẫn hiện như hôm nay.
- **Bài mastery của khoá học:** phiên bỏ dở vẫn được tính. Lần trả lời **đầu
  tiên** của mỗi câu là điểm chính thức (anh Vinh chốt 30/10, "mastery a").
  Mở một phiên phụ để xem đáp án rồi bỏ đi không còn giúp được điểm. Khi đã
  xét kết quả, **mọi phiên đang mở** của bài đó bị khoá, kể cả phiên chưa trả
  lời câu nào (ví dụ một tab mở sẵn từ trước để chờ làm lại toàn bài): tab
  còn mở trên phiên ấy không gửi thêm câu trả lời được và không nhận đáp án
  nữa (hiện "Lượt làm này đã được xét kết quả. Đang tải lại tiến độ mới
  nhất."); làm lại thì vào phiên mới. Câu trả lời gửi tới máy chủ đúng lúc
  phiên vừa bị khoá cũng **không được lưu** (không còn dòng "đến muộn" nào
  để màn "Câu sai của tôi", màn xem lại hay tiến độ làm lộ đáp án). Giáo
  viên thấy thêm số phiên và số lần trả lời của từng em.
- Học viên không còn đọc thẳng bảng lượt trả lời (`quiz_attempts`) bằng
  khoá đăng nhập của mình qua REST; mọi màn của học viên đọc qua máy chủ
  như hiện nay, nên không thấy khác gì.
- Học viên cũng không còn đọc thẳng bảng phiên (`quiz_sessions`, nơi có
  điểm từng phiên) qua REST; các màn đọc qua máy chủ như hiện nay.
- **Một migration nhỏ** (khoá ghi muộn vào mọi phiên đã đóng, đếm điểm
  phiên ngay trong lúc đóng phiên để một câu trả lời đến cùng lúc không làm
  điểm phiên sai mãi, và thu quyền đọc thẳng hai bảng trên), không đổi biến
  môi trường. Bản nháp trước ghi "không có migration"; đổi điều này cần anh
  Vinh duyệt (Q-8).

## Problem

1. **Self-study banks ship their key.** `GET /api/quiz/banks/{id}` returns
   `answer`, `accept`, `explain` and `why_wrong` for every Grammar and Vocab
   self-study question before the learner answers (SA probe: answer 16/20,
   accept 4/20, explain 20/20 on a Grammar bank). This was a deliberate
   trade-off (QĐ-5) because the browser grades instantly.
2. **The server trusts the browser's verdict for self-study.**
   `log_progress` stores the client's `is_correct` for legacy self-study
   rows and passes it into the managed Grammar RPC
   (`services/quiz_service.py` `log_progress`, managed branch). A hand-edited
   request records any answer as correct. Session totals
   (`total_correct`, `accuracy`) are also client-declared in `end_session`.
3. **Malformed rows return 500.** `_grade_single_attempt_rows` indexes
   `by_qid[qid]` for a row whose `qid` is missing, which raises `KeyError`
   (CR P3, 30/10 22:12).
4. **The timed Course time-cap path still filters on the client flag.**
   `end_session` copies the client's `is_correct` into `p_attempts` and drops
   rows where it is missing. Migration 276 made
   `quiz_finalize_timed_course_session` verification-only (it checks that each
   `client_id` is stored and counts totals from stored rows), so stored rows
   are already server truth today; the Python path still treats the client
   flag as data, and legacy `/progress` silently drops rows without it.
   Session totals of non-time-cap ends (self-study and Course) are
   client-declared and feed the provisional hand-in score, `/course-resume`
   `last_stage.right` and the teacher attempt report.
5. **A one-sitting key opens per learner (SA Q2-C).** `single_attempt_answers_sealed`
   unseals a learner's per-question detail (`/course/report`, `/mistakes`,
   `/course-resume` `is_correct`) as soon as **that learner** hands in. The
   first learner to hand in can pass the key to classmates who have not
   started: same bank, same option order.
6. **Mastery peek through an abandoned session (SA/CR, Leader 21:27).**
   `/course/verdict` scores only the sessions the client lists. A learner can
   open an extra run session, answer, read the per-answer feedback, abandon it,
   and leave it out of `session_ids`. The teacher never sees it.
7. **Self-study review mode needs the key.** "Ôn tập lại" sessions
   (`admission_kind='review'` for managed Grammar; client-only review for
   legacy banks) grade in the browser and never store attempts; the managed
   progress RPC refuses review writes (`grammar_review_read_only`). Without
   keys in the payload they cannot grade, and a check that reveals without
   storing would be a free key source.
8. **Late rows and direct table reads (CR R9 P2-1).** Untimed Course
   `/progress` stores with a plain PostgREST upsert, and the only insert
   guard on `quiz_attempts` (migration 284) acts on single_attempt items
   only. A batch that passed write admission can therefore be stored after
   a verdict sealed its session; such a row is never scored (a superseded
   session is never collected again) but `/mistakes` returns its
   `correct_answer`/`explain`, `/course/report` level 1 its `is_correct`,
   and `/course-resume` too for a retake session its time filter misses. Separately, migration 119 lets a
   learner read their own `quiz_attempts` rows directly through Supabase
   REST (`quiz_attempts_select`, `auth.uid() = user_id`); staging check
   02/11 (read-only): `authenticated` has `SELECT` on every column,
   `is_correct` included, and no `INSERT`/`UPDATE` grant. That direct read
   shows per-question correctness of a sealed single_attempt hand-in and of
   any late row, bypassing every backend gate.
9. **Server-counted totals are an oracle (CR R10 P1-1).** Once session
   totals are counted from server-graded rows (FR-008), a session's
   `total_correct`/`total_wrong`/`accuracy` say how many of *its* answers
   are right. A single_attempt learner who stores one answer and ends the
   session with `ended_by='paused'` (allowed before hand-in,
   `_assert_course_session_accepting`) reads `total_correct` 0/1 from the
   end response, `/api/quiz/progress` (`recent_sessions`, and
   `totals.avg_accuracy` as a difference), the provisional hand-in
   `score` that `end_session` writes from the completing session's totals,
   or a direct REST read of `quiz_sessions` (staging check 02/11 18:35,
   read-only, job 001q5: `authenticated` and `anon` have `SELECT` on
   `quiz_sessions` through policy `quiz_sessions_select`, and no
   `INSERT`/`UPDATE` grant). Today the totals
   are client-declared, so this oracle is created by FR-008 itself.
10. **Totals counted outside the closing lock go stale forever (CR R10
   P2-1).** The managed Grammar end RPC (`grammar_quiz_end_service`,
   migration 309) takes its totals from `p_summary` and returns an
   already-ended session unchanged; `end_session` returns an ended session
   unchanged too. Totals counted before that call miss a `/check` that
   commits between the count and the end, and no later call repairs them.
   The Python path (legacy self-study, Vocab, Course) has the same gap
   between a count and its conditional update.

## Scope

- A new endpoint `POST /api/quiz/sessions/{session_id}/check` for self-study
  sessions that stores one attempt and only then returns that question's
  verdict and key.
- A server-side grader for every self-study input type, in parity with the
  browser grader.
- Server grading of every stored attempt in every mode (`/progress`,
  time-cap `end_session`) and server-counted session totals, counted in
  the same transaction and under the same session row lock that ends the
  session (FR-008).
- Correctness-derived session totals withheld from every learner output
  while a single_attempt item's key is closed (FR-019).
- A no-store review check that reveals keys only for already-answered
  questions.
- Removing `answer`, `accept`, `explain`, `why_wrong` from the self-study
  learner payload, after the browser uses `/check`.
- `quiz-engine.js` and `quiz-player.tsx` switch to asynchronous server
  verdicts with complete UI states.
- One-sitting key release at the assignment deadline (or when every assigned
  learner has handed in) on every learner read path.
- `/course/verdict` (mastery mode) collects every unconsumed session of the
  item itself, write-locks every open session of the item (empty ones
  included) and accepts answers only in current-generation sessions; one scoring policy
  function; teacher sees session and attempt counts.
- One migration: the existing `quiz_attempts` insert guard takes the
  session row lock and refuses a row for an ended session (Course and
  self-study), so no answer can be stored after a seal or an end
  (FR-018); one counting close function for the Python ends and the
  managed Grammar end RPC count totals under that lock (FR-008); learners
  lose direct REST `SELECT` on `quiz_attempts` and `quiz_sessions`
  (FR-017).

## Non-goals

- Course mastery per-answer feedback and FINAL single_attempt enforcement:
  done in #2091 (J411R2). Course banks never use `/check`.
- Allowing single_attempt for banks with Reading/Listening/Writing/
  Pronunciation: Vinh Q4 (30/10 22:13) "chỉ trắc nghiệm" keeps
  `admin_class_assignments.py` single_attempt MCQ-only.
- Per-learner option permutation for assessments: future direction only
  (recorded in `plan.md`). Not built here.
- Splitting the timed Course `GET /banks/{id}` auto-start
  (`_ensure_timed_course_session`) into a `POST start`: kept as is. Course
  payloads carry no key since #2091, so the auto-start reveals nothing; moving
  it would reopen the timed admission contract (migrations 265/272/273).
- Client-owned mastery snapshots (`word_stats`: status, credits, carried
  over) stay client-owned (QĐ-4). Only correctness and totals move to the
  server.
- Rewriting historical `quiz_attempts.is_correct` rows: no data repair DML
  (see `rollout.md` Repair).
- Auth path changes: none in the application (Q5 b does not apply; no
  login, JWT or route guard changes). The only privilege change is the
  FR-017 database revoke of the learner's direct `quiz_attempts` read.
- Other direct-REST learner policies without a grant
  (`quiz_attempts_insert`, `quiz_sessions_insert`, `quiz_sessions_update`;
  no `INSERT`/`UPDATE` grant, staging check 02/11): unchanged; they allow
  no write. The `quiz_sessions` read is revoked (FR-017) because its
  totals become an oracle under FR-008.
- A teacher-controlled "release answers now" button (needs a stored flag or
  admin UI; out of scope, Q-3).
- Changing how a self-study bank given as non-Course homework is scored
  (the session that completes the work sets the score). A learner can still
  answer junk through `/check` in one session and finish a later session
  perfectly; each junk answer is a stored attempt visible in analytics.
  Recorded limitation, Q-7.

## Users and journeys

- **Learner, self-study Grammar/Vocab:** answers a question, sees "Đang
  chấm…", then right/wrong, the correct answer and the explanation; the
  adaptive loop continues exactly as before.
- **Learner, single_attempt Course assessment:** hands in, sees a score and
  "Đáp án sẽ mở sau …"; after the deadline the per-question review opens.
- **Learner, Course mastery:** a retake or a full retry works as today; an
  abandoned session's first answers count.
- **Teacher:** sees the same verdicts plus session and attempt counts for
  each learner on a Course item; teacher review paths keep every key field.
- **Security Auditor:** retests the five SA retest items (`verification.md`).

## Requirements

- **FR-001:** (check endpoint) `POST /api/quiz/sessions/{session_id}/check`
  with body `{client_id: uuid, qid: string, answer_given: string (≤ 2000
  chars), response_time_ms?: int, attempt_no?: int}`. The server reads the
  question by `qid` from the session's own bank (and, for a managed Grammar
  session, the session's bound revision), grades it with the server grader
  (FR-005), stores exactly one `quiz_attempts` row through the same writer
  `/progress` uses for that session kind, and only after the row is stored
  returns `{client_id, qid, is_correct, corrected, answer, accept, explain,
  why_wrong}` for that question only. `why_wrong` carries only the entry for
  the picked option (as in #2091 mastery feedback). `item_key`, `skill`,
  `type`, `subtype` of the stored row come from the question row, not from
  the client (also in `/progress`, FR-006, so KP evidence keys on server
  truth). The request and response have concrete OpenAPI schemas
  (`extra='forbid'`).
- **FR-002:** (check scope) `/check` serves self-study sessions only
  (Grammar legacy, managed Grammar, Vocab Quick-Check), including a
  self-study bank given as homework through a non-Course assignment item. A
  Course session (bank `skill_area='course'`, or the rule `/progress` uses:
  the session's assignment item belongs to an assignment with
  `skill='course'`) returns 409 `check_not_for_course` with no key. Advanced Vocabulary returns
  409 as on `GET /banks/{id}`. These scope refusals run right after the
  FR-003 ownership check and **before** the FR-004 replay read-back, so a
  `client_id` whose row was stored through `/progress` in a Course session
  (for example a single_attempt answer) gets 409 with no key, never its
  stored verdict.
- **FR-003:** (ownership and state) a session that does not exist or belongs
  to another user returns 404 with no key (same message as `_owned_session`).
  An ended session (`ended_at` or `ended_by` set) returns 409 with no key,
  **after** the FR-004 replay read-back (a retry of a stored `client_id`
  still gets its stored verdict when the session ended in between). This
  ended-session exception applies only to sessions that passed the FR-002
  scope check; it never lets a Course or Advanced Vocabulary session reach
  the read-back. Order: ownership (404) → FR-002 scope (409) → FR-004
  read-back → ended-session refusal (409) → qid lookup. A
  managed Grammar session gets the same refusals as `/progress`
  (reset-stale, revision mismatch, policy ACK) because it writes through the
  same managed RPC. A `qid` not in the session's bank or revision returns 422
  with no key and stores nothing. Malformed body returns 422.
- **FR-004:** (idempotency) `client_id` is the idempotency key (existing
  unique index, migration 119). A replay of a `client_id` already stored for
  the same user and session returns the verdict and key of the **stored**
  row (the stored `answer_given` wins over the replayed one) and stores
  nothing new. The read-back runs only after the FR-002 scope check passed:
  a Course or Advanced Vocabulary session returns 409 with no key even when
  the `client_id` is already stored for that user and session. A `client_id` already stored under another session or user
  returns 409 with no key. A new `client_id` for a `qid` already answered in
  the session is a new attempt (the adaptive loop legitimately re-asks).
- **FR-005:** (server grader) one Python grader
  `grade_quiz_answer(question, answer_given, text_match_mode)` reproduces
  `quiz-engine.js` `gradeQuestion`/`gradeText` for `choice`, `syllable`,
  `boolean` and `text`: normalization (JavaScript `trim`/`\s` whitespace set,
  not Python's), accepted forms, punctuation-only accepts, exact vs
  typo-tolerant mode from the bank's validated `text_match_by_qid` policy
  resolved as `quizTextMatchMode` does (GRAMMARTEXT-0015), the one-edit fuzzy
  rule with the 5-character minimum and first-character rule, orthography
  types with the long-phrase exception (15 characters, 3 words). Lengths and
  edit distance are counted in UTF-16 code units, as in the browser.
  `case_sensitive` is not a learner-visible column; the server treats it as
  false, as the browser does today. Boolean answers arrive serialized
  (`"true"`, `"false"`, `""` for no answer) and grade against a stored key of
  `1`/`true`; a blank grades false. For `choice`/`syllable` it returns the
  same value as `grade_attempt`; boolean does **not** go through
  `grade_attempt` (which would grade `"true"` against `1` as false). An
  unknown input type grades `false`, as the browser does. A shared fixture
  file is run by both `node --test` and pytest and covers each of these
  cases; any divergence fails both suites.
- **FR-006:** (server grading in `/progress`) `log_progress` ignores the
  client's `is_correct` in every mode and no longer requires or filters on it.
  Self-study rows (legacy and managed Grammar, Vocab) are graded with FR-005
  before they are stored or passed to `grammar_quiz_progress_service`; Course
  rows keep #2091's `_grade_single_attempt_rows`. `item_key`, `skill`, `type`,
  `subtype` come from the question row. A row without a `qid`, or whose `qid`
  is not in the session's bank, makes the whole batch 422 with nothing stored
  (no 500, no silent drop). Rows the client already stored through `/check`
  are ignored by the existing `client_id` de-duplication. For a
  single_attempt Course item that is not handed in, `/progress` is refused
  (409) once the assignment no longer accepts submissions
  (`is_accepting_submissions` false), so no answer can be stored after the
  key may have opened.
- **FR-007:** (time-cap path) `end_session` with `ended_by='time_cap'` and a
  final batch forwards only what the verification-only RPC needs
  (`client_id` and row identity); the client flag is never forwarded or used
  as a filter. A test pins that stored rows, the session totals the RPC
  counts, `/mistakes` and the review all show the server verdict for the
  same `answer_given` when the client sends a forged flag.
- **FR-008:** (server-counted session totals, counted under the closing
  lock) every session end that is not a time-cap (self-study and Course,
  including the FR-013 seal and the dead-session sweep) stores
  `total_questions` (`count(*)` of the session's stored attempts),
  `total_correct` (`count(*) filter (where is_correct)`), `total_wrong`
  (the difference) and `accuracy`, counted from the stored, server-graded
  rows, never from the request. The count and the end are one statement
  sequence in **one transaction holding the session row lock**
  (`FOR UPDATE`), so the stored totals are exactly the rows the session
  will ever have:
  - managed Grammar: `grammar_quiz_end_service` is replaced (same
    signature) so that, after its existing `FOR UPDATE` on the session,
    it counts the session's `quiz_attempts` and ignores every count field
    of `p_summary` (`ended_by`, `duration_sec`, `words_mastered`,
    `words_carried_over` still come from it). Its inserts go only through
    `grammar_quiz_progress_service`, which holds `FOR UPDATE` on the same
    row while inserting and refuses an ended session
    (`grammar_session_closed`), so a `/check` either commits before the
    end's lock (counted) or is refused after it (409, no key, nothing
    stored);
  - every other end (legacy self-study, Vocab, Course untimed and timed
    non-time-cap ends, the FR-013 seal, the dead-session sweep):
    `end_session` and the other callers stop counting in Python and call
    one new function `quiz_close_sessions_counted(p_user, p_session_ids,
    p_ended_by, p_summary)` that locks the listed sessions `FOR UPDATE`
    in id order, returns an already-ended session unchanged, and for each
    still-open one counts its attempts and ends it in the same
    transaction. `p_summary` carries only the client-owned fields and,
    for the sweep, its existing `ended_at` (time of the last attempt).
    Inserts into these sessions take `FOR SHARE` on the session row in
    the FR-018 guard, so the close waits for every in-flight insert and
    every later insert is refused. The sweep's totals change from
    "first attempt per qid" to this rule; no scoring path reads the
    totals of an `abandoned` session (verdicts regrade from attempts).
  Because an ended session is returned unchanged by both functions, no
  path recounts later; correctness of the stored totals rests on the
  lock alone. `words_mastered` and `words_carried_over` stay client-owned
  (non-goal). For a single_attempt Course item, `end_session` passes no
  `score` to `mark_item_submitted` (state `submitted`); the item score is
  written only by `/course/verdict` over the whole item (as
  `course_hand_in_score` already states for MCQ banks), so no per-session
  score reaches "Bài của tôi". Learner outputs of these totals follow
  FR-019.
- **FR-009:** (self-study payload without key) once FR-010 is deployed,
  `GET /api/quiz/banks/{id}` for self-study banks no longer contains
  `answer`, `accept`, `explain` or `why_wrong` (keys absent, not null).
  `hint` stays (it is shown before answering by design). The two derived
  non-key fields that keep today's prompts, `answer_word_count` (the shared
  word count of the accepted forms, or null) and `text_match_eligible`
  (whether the question may carry a text-match policy entry), are not part
  of FR-009: they ship earlier, with FR-010, next to the keys (rollout step
  A), and FR-009 only removes the keys. No player mode receives a key
  field. FR-010 players send
  `quiz_contract=server-check-v1` on every self-study bank GET, including
  reset/reopen requests. With FR-009, the server requires that exact marker:
  missing or unknown values return 409 `quiz_client_refresh_required` with
  no questions or key fields, before building/returning the play payload.
  Existing auth, ownership and bank-access checks still apply. Old clients
  are blocked on refetch until a full page reload loads FR-010 JavaScript;
  deployment order alone does not protect already-open tabs. No legacy-key
  fallback is allowed after FR-009. Course bank admission is unchanged.
- **FR-010:** (player uses server verdicts) `quiz-engine.js` separates
  "record an answer" from "apply a verdict": the engine creates the attempt
  (with `client_id`) and applies credit, mastery, carry-over and counters only
  from the `/check` verdict for that `client_id`. `quiz-player.tsx` shows the
  pending, success, error and retry states in `ui-states.md`, never grades
  locally, never advances without a verdict, and builds the end-of-session
  review from verdicts it received. A retry re-sends the same `client_id`.
  Text-match policy eligibility and the word-count prompt come from the
  derived `text_match_eligible` and `answer_word_count` fields, never from
  `accept`; every bank GET carries them from the FR-010 deployment on, while
  the keys are still present, so a bank with an explicit `text_match_by_qid`
  policy validates and plays on the intermediate deployment. A bank payload
  without `text_match_eligible` is a load error (no fallback to `accept`).
- **FR-011:** (one-sitting key release) for a single_attempt Course item,
  every learner read path that reveals per-question correctness or the key
  (`/course/report` level 2, `/mistakes` rows, `/course-resume` `is_correct`
  and `last_stage`; the direct REST read of `quiz_attempts` is removed by
  FR-017) stays sealed until **both** the learner has handed in
  **and** either the assignment `due_at` has passed or every item of a
  learner still active in the class is handed in (items of archived or
  removed learners do not hold the key). Release is computed on each read (no
  stored flag). A read error is treated as sealed. Moving `due_at` later
  re-seals. Teacher paths (`assignment_id`) are unchanged. Mastery items are
  unchanged. (Checked: Reading/Listening solution routes cannot apply because
  single_attempt is MCQ-only. Per-session totals are correctness too and
  follow FR-019; the whole-item hand-in score is the only correctness
  count a learner sees before release, see FR-019 and Q-9.)
- **FR-012:** (sealed-after-hand-in state) while FR-011 keeps a handed-in
  item sealed, `/course/report` returns `sealed: true`, `handed_in: true`,
  `answers_release_at` (the `due_at`, or null) and `release_rule`
  (`due_at` or `all_submitted`), so the page can say when the answers open.
  The score already shown on "Bài của tôi" is unchanged.
- **FR-013:** (verdict collects every session, mastery mode) for a mastery
  Course item (the mode with per-answer feedback, so the only mode where a
  throwaway session can reveal keys), `/course/verdict` first returns an
  already recorded verdict whose session list equals the request (replay,
  unchanged). Otherwise it reads, on the server, every session of (user,
  bank, assignment item; any `kind`, NULL counts as `run`) that has at
  least one stored attempt and is in the **current generation**: not
  listed in an earlier recorded mastery attempt (`sessions`), not listed
  as superseded by one (`superseded`, below), and, for a ledger entry
  recorded before this change (no `superseded` key), created after that
  entry's `at`. This includes sessions that were never ended. The phase
  (run or retake) still decides which qids are scored and which rules
  apply; a collected session of the other `kind` contributes only its
  attempts. If the client's
  `session_ids` omits any of them it returns 422 with code
  `verdict_sessions_incomplete` and the missing ids (the learner's own
  sessions); the runner re-posts with them, at most twice (a second 422 can
  follow the seal, below). The 40-session request cap
  is replaced by a cap of 200 that is never below the collected count. A
  collected session that was not completed (`ended_by` NULL, `paused` or
  `abandoned`) contributes its attempts (before the timed cutoff) but does
  not count as an unfinished session for the "every session completed" and
  on-time checks; coverage (every MCQ answered) still decides. The timed
  reaper calls the verdict with the collected set. single_attempt items keep
  today's verdict rules (no feedback, nothing to peek), including the
  reaper's orphan subset.
  **Seal (write lock):** every session the verdict sees is closed before
  the verdict reads the attempts it scores, whether or not it has attempts
  and whatever its `kind`. After the first completeness check passes (that
  422 seals nothing), the server ends **every open session of (user, bank,
  assignment item)** (`ended_at` and `ended_by` NULL; empty sessions, other
  phase and sessions opened before an earlier verdict included) with
  `ended_by='abandoned'`, `ended_at=now()` and FR-008 counted totals, in
  one call of `quiz_close_sessions_counted` with the ids of every open
  session of the item, read right before the call (a session already
  ended by then is returned unchanged, so a concurrent normal end keeps
  its own `completed`/`time_cap` and its own totals). The call takes each
  session's row lock, so it waits for every insert still holding the
  FR-018 share lock on that session and closes it after that insert
  commits; from then on FR-018 refuses any row for the sealed session. The set of rows in a sealed
  session is therefore final before the verdict reads it. It then re-reads the item's
  sessions and collects again: a session of the first collection still
  open → 500, nothing recorded; a closed current-generation session that
  gained its first attempt between the first collection and the seal and
  is not in `session_ids` → the same 422 `verdict_sessions_incomplete`
  (sessions stay sealed and unconsumed, the re-post collects them). The
  recorded ledger entry lists the collected sessions in `sessions` and
  every other closed current-generation session the re-read saw (no
  attempts) in `superseded`. A session still open in the re-read was
  created after the seal's session read and belongs to the next
  generation (case 17 in `plan.md`). Paused and
  other ended sessions are already write-locked.
  **Write admission (current generation only):** `/progress` to a mastery
  Course session returns 409 `{code: 'course_session_consumed'}` before any
  read-back, with no `feedback`, no key field and nothing stored, for new
  and replayed `client_id`s alike, when the session is ended (sealed
  included), is listed in any ledger entry's `sessions` or `superseded`,
  was created at or before the `at` of a ledger entry recorded before this
  change, or its `kind` is not the one the latest entry allows (`run`
  without an entry, after `retry_full` or while a multi-section attempt
  waits for another section; `retake` after `retake`; none after
  `passed`/`timed_out`). This closes a session opened before a verdict but
  left empty (it is sealed and superseded, or, for a verdict recorded
  before this change, older than its `at`), so it cannot be used to read
  keys before a full retry or retake. **Late batch:** a `/progress` batch
  that passed admission before the seal but reaches the insert after it is
  refused by the FR-018 guard as a whole: nothing is stored, and the
  response is the same 409 `course_session_consumed` with no feedback and
  no key. No row exists for it, so no learner read path (`/mistakes`,
  `/course/report`, `/course-resume`, the `/progress` and `/check`
  read-backs) can show it. A batch whose insert committed before the seal
  is in the attempts the verdict reads after the seal (scored, or 422 if
  the client did not list the session), and a batch stored in a session
  created after the seal belongs to the next generation (collected by the
  next verdict whatever its `kind`). So every stored mastery answer is in
  the attempts a verdict reads (unless the item has already passed, when
  nothing is left to score), and feedback built from a committed row is
  safe. A
  superseded session never gains a row, so it stays empty. A verdict that fails after the
  seal records nothing; the sealed sessions stay unconsumed and the retry
  collects them again. The runner treats `course_session_consumed` as a
  superseded session: drops the queued batch and reloads canonical progress.
- **FR-014:** (one scoring policy) the score over the collected sessions is
  computed by a single function `mastery_score_policy()`. The default and
  approved policy (Vinh 30/10 22:13, "mastery a") is **first stored attempt
  per qid** by server timestamp. A change of policy changes only this
  function and its tests.
- **FR-015:** (teacher sees effort) each recorded verdict stores
  `session_count` and `attempt_count` (all stored attempts of the collected
  sessions, repeats included) in the item's `mastery` ledger entry, and the
  teacher summary and per-learner views show both.

- **FR-016:** (review mode) "Ôn tập lại" calls `/check` with `review: true`
  (managed review sessions are review whatever the body says). A review check
  stores nothing and returns the verdict and key only for a `qid` the learner
  already has a stored attempt for in the same bank; otherwise 409
  `review_needs_attempt` with no verdict and no key (a bare verdict would let
  a learner brute-force a choice question). The player shows "Câu này chưa
  có lượt làm chính nên chưa chấm trong ôn tập." and moves on. A client that
  sends `review: false` in a legacy session simply stores an attempt (the
  normal cost). The review read only ever serves self-study banks: a bank
  with `skill_area='course'` is refused by FR-002 before any read, and a
  Course assignment only takes `skill_area='course'` banks
  (`admin_class_assignments.py`), so no Course attempt can unlock a review
  key.
- **FR-017:** (no direct learner read of attempts or session totals) the
  migration drops the `quiz_attempts_select` and `quiz_sessions_select`
  policies and revokes `SELECT` on `public.quiz_attempts` and
  `public.quiz_sessions` from `anon` and `authenticated`. Learner surfaces
  read attempts and sessions only through the backend (service role),
  where FR-011, FR-013 and FR-019 apply. A learner JWT `GET
  /rest/v1/quiz_attempts` or `GET /rest/v1/quiz_sessions` returns no row
  (permission error or empty), for every session state. Before the build
  writes the migration it confirms read-only, on staging and production,
  that no client code, RPC or view callable by `anon`/`authenticated`
  reads `quiz_attempts` or `quiz_sessions` with the caller's privileges
  (repo check 02/11: no frontend `from('quiz_sessions')` or
  `from('quiz_attempts')` call); any hit is a STOP.
- **FR-018:** (no answer stored after a seal) the existing `BEFORE INSERT`
  trigger function on `quiz_attempts`
  (`guard_single_attempt_course_answer`, migration 284) is replaced so
  that, for **every** insert, it first takes `FOR SHARE` on the row's
  `quiz_sessions` row in its own statement (the same `qs` → `cai` → `ca`
  lock order as the timed insert RPC, migration 279) and raises when that
  row has `ended_at` or `ended_by` set: `course_session_closed` (ERRCODE
  `55000`) for a session whose item belongs to an assignment with
  `skill='course'` (any `completion_mode`, timed or not), else
  `quiz_session_closed` (same ERRCODE). For a Course session it then keeps
  today's `cai`/`ca` lock and single_attempt rules. Because the seal, a
  normal end, the managed end RPC and the dead-session sweep all lock that
  row `FOR UPDATE` before closing it (FR-008), each one waits for
  in-flight inserts to commit, counts them, and every insert after it is
  refused. Managed Grammar inserts already run inside
  `grammar_quiz_progress_service` under `FOR UPDATE` on the same row (the
  guard's share lock is then a no-op) and that RPC refuses an ended
  session first. `/progress` maps the error for an untimed mastery session
  to 409 `course_session_consumed` (no feedback, nothing stored: the
  upsert is one statement), for single_attempt to its existing closed
  message, for the timed RPC to its existing phase conflict, and for a
  self-study session to its existing ended-session 409; `/check` maps it
  to 409 `session_ended` with no key and nothing stored. Function
  privileges stay revoked from `PUBLIC`, `anon` and `authenticated`
  (migration 285).
- **FR-019:** (no correctness totals before release) a **locked
  single_attempt session** is a Course session whose item is
  single_attempt and whose key is not released (FR-011: not handed in, or
  handed in before release; an item, assignment or release read error
  counts as locked; decided per session, as `_sealed_course_session_ids`
  does). For a locked session no learner output carries a value derived
  from correctness: `total_correct`, `total_wrong` and `accuracy` are
  `null` (never `0`) in the `PATCH /sessions/{id}` response (every
  `ended_by`, including the replay of an already-ended session) and in
  `/api/quiz/progress` `recent_sessions`; `/api/quiz/progress`
  `totals.avg_accuracy` is computed over sessions that are not locked;
  `/course-resume` `last_stage` and `retake.right`/`retake.graded` are
  `null`, `answered[].is_correct` is `null` and `answers_sealed` is
  `true`; the Course bank payload's `mastery.answers_sealed` is `true` and
  its `word_cards` is `{}` (a per-item meaning card can name the answer of
  a vocabulary question); no
  per-session `score` is written to the item (FR-008), and the direct REST
  read of `quiz_sessions` is revoked (FR-017). `total_questions` (number
  of stored answers), `duration_sec`, `ended_by` and the client-owned
  `words_*` fields stay, because they carry no correctness. The stored
  totals stay canonical and complete in the database; teacher paths
  (`assignment_id`, admin views) are unchanged. The gate is the FR-011
  release rule, evaluated on each read; once released the totals show.
  The only correctness a learner sees for a single_attempt item before
  release is the whole-item hand-in result (`/course/verdict` `correct`,
  `total`, `pct`, the item `score` on "Bài của tôi" and the bank
  payload's attempt history), one value per learner, written once at
  hand-in over every question of the bank, after which no answer of that
  learner can change (Q-9).

## Acceptance scenarios

### Scenario 1 — check stores before it reveals

- **Given** a learner in an open self-study Grammar session
- **When** the browser posts `/check` for a qid with a wrong `answer_given`
- **Then** one attempt row exists with `is_correct=false` before the response
  is sent, and the response carries the key and explanation of that qid only

### Scenario 2 — no key without a stored attempt

- **Given** a qid of another bank, a session of another learner, an ended
  session, or a Course session
- **When** the browser posts `/check`
- **Then** the response is 422/404/409/409 with no key field and nothing is
  stored

### Scenario 3 — forged correctness is ignored

- **Given** a `/progress` or time-cap batch with `is_correct=true` and a
  wrong `answer_given`
- **When** it is stored
- **Then** the stored row, the session totals, `/mistakes` and the review
  all say wrong

### Scenario 3a — an answer racing the end is counted or refused, never lost

- **Given** an open managed Grammar session with nine stored right answers
  and a `/check` for a tenth, wrong answer in flight, and the same for a
  legacy self-study and an untimed Course session (`/progress`)
- **When** the end (`PATCH /sessions/{id}`) runs concurrently with that
  insert, in both orders
- **Then** either the insert commits first and the stored totals are
  10/9/1, or the end commits first, the stored totals are 9/9/0 and the
  insert is refused (409, no key, nothing stored); stored totals always
  equal a `count(*)` over the session's rows afterwards, and a repeated
  end returns the same totals

### Scenario 4 — self-study payload has no key

- **Given** any self-study bank after FR-009
- **When** an FR-010 player GETs it with `quiz_contract=server-check-v1`
- **Then** no question has `answer`, `accept`, `explain` or `why_wrong`

### Scenario 4a — a pre-upgrade tab refetches after key removal

- **Given** a pre-FR-010 managed Grammar tab kept open across the FR-010
  and FR-009 promotions
- **When** `resetProgress()` refetches its bank without the contract marker
- **Then** the server returns 409 `quiz_client_refresh_required`, no
  questions or key fields reach the old grader/policy validator, and the
  old tab enters its existing load-error state; reopening without a full
  page reload stays blocked. A full page reload loads the FR-010 player,
  which sends the marker, gets a key-free bank and grades through `/check`.

### Scenario 5 — handed in before the deadline

- **Given** a single_attempt assignment with `due_at` tomorrow, learner A
  handed in, learner B not started
- **When** A opens the review or `/mistakes`
- **Then** A sees "Đáp án sẽ mở sau <due_at>" and no per-question
  correctness; after `due_at` the review opens

### Scenario 6 — abandoned mastery session counts

- **Given** a mastery Course item, an abandoned run session with wrong answers
  for some qids, then complete run sessions answering every qid right
- **When** the client posts `/course/verdict` listing only the complete
  sessions
- **Then** 422 `verdict_sessions_incomplete` with the abandoned id; listing
  it too gives a verdict where those qids count as wrong (first attempt)

### Scenario 6a — a consumed session cannot be used to peek

- **Given** the second verdict of Scenario 6 was recorded as not passed
  while the abandoned session was still open (never ended)
- **When** the learner posts `/progress` to that session (new or replayed
  `client_id`)
- **Then** 409 `course_session_consumed`, no `feedback` and no key field in
  the body, no row stored; a new retake/full-retry session still works

### Scenario 6b — an empty session opened before a failing verdict cannot be used to peek

- **Given** an untimed mastery Course item, a run session E opened in a
  second tab with no answer, and a failing verdict with next action
  `retry_full` (or `retake`) recorded from other sessions
- **When** the learner posts `/progress` to E (new or replayed `client_id`)
  before starting the full retry
- **Then** 409 `course_session_consumed`, no `feedback` and no key field in
  the body, no row stored; E shows `ended_by='abandoned'` and is listed in
  the entry's `superseded`; a run session opened after the verdict still
  records answers and gets feedback. The same request against an item whose
  failing verdict was recorded before this change (no seal, no
  `superseded`) is refused because E is older than the entry's `at`

### Scenario 6c — an answer racing the seal leaves no row to read

- **Given** an untimed mastery Course item, a `/progress` batch with a
  wrong answer for qid X in session E (empty or collected) that has passed
  write admission and is held before its insert, and a failing verdict
  that seals E (and lists it in `superseded` or `sessions`)
- **When** the held batch's insert runs, and the learner then opens
  `/mistakes`, `/course/report` and `/course-resume`, and reads
  `quiz_attempts` with their own JWT through Supabase REST
- **Then** the insert is refused (FR-018): 409 `course_session_consumed`,
  no `feedback` or key field, E's row count unchanged; `/mistakes` has no
  entry for X from E (no `correct_answer`, no `explain`), the report and
  resume show no row from E, and the REST read returns no row (FR-017).
  If instead the insert reached the guard before the seal, the seal waits
  for it and the verdict reads the row (scores it, or 422 when E is not
  listed)

### Scenario 6d — no direct read of correctness

- **Given** learner A handed in a single_attempt item before release
- **When** A calls `GET /rest/v1/quiz_attempts?select=qid,is_correct`
  with their own JWT
- **Then** no row is returned (FR-017); today the staging grant and policy
  allow this read (privilege check 02/11, no REST call made)

### Scenario 6e — a paused one-question session reveals nothing

- **Given** a single_attempt Course item (timed and untimed), learner A
  stores one answer in a run session and ends it with `ended_by='paused'`
  (also `completed`), once before hand-in and once (a second item) after
  hand-in but before release
- **When** A reads the end response, `/api/quiz/progress` (with and
  without `skill_area`), `/course-resume`, the bank payload, "Bài của
  tôi" and `GET /rest/v1/quiz_sessions` with their own JWT
- **Then** `total_correct`, `total_wrong` and `accuracy` are `null` in
  every body, `avg_accuracy` is identical whether that answer is right or
  wrong, `last_stage` is `null`, no item `score` is written by the end,
  and the REST read returns no row; the stored row in the database has
  the counted totals; after release the same reads show them

## Edge cases

- **Network failure after the row is stored:** the retry with the same
  `client_id` returns the stored verdict; no second row (FR-004).
- **Slow server:** the player stays in "Đang chấm…" and shows "Thử lại" after
  15 s; the answer is not re-graded locally.
- **Session ends in another tab** between answer and `/check`: 409; the
  player shows the ended-session message and reloads canonical progress.
- **Managed Grammar reset or revision cut-over during a session:** the
  managed RPC refuses as `/progress` does; no key.
- **Old browser bundle after FR-009:** the server rejects an unmarked bank
  refetch with 409 `quiz_client_refresh_required` before delivering any
  questions. The old tab displays its existing load error; a full page
  reload is required. Keys already downloaded before FR-009 cannot be
  recalled; an old tab using only its cached bank may still show local
  feedback, while FR-006/FR-008 keep persisted correctness/totals on the server.
- **`due_at` null:** release only when every item is handed in; a learner
  who never hands in keeps the key closed for the class (Q-3).
- **Teacher extends `due_at` after release:** re-sealed on the next read, but
  copies already taken cannot be recalled (Q-4).
- **Hand-in after `due_at`** is refused by `is_accepting_submissions`, and
  FR-006 refuses further single_attempt answers after it, so no learner can
  still store an answer when the key opens.
- **The same bank assigned in mastery mode to another class** reveals keys
  through mastery feedback there; FINAL banks cannot be assigned in mastery
  (#2091). Other single_attempt banks: teacher's choice, recorded limitation.
- **Verdict lists a session of another learner or bank:** 422 as today.
- **Retake phase with several abandoned retake sessions:** all unconsumed
  retake sessions are collected; first attempt per qid; the sample-size rule
  counts distinct qids.
- **A legitimately lost session id** (tab closed, other device): the 422
  carries the missing ids and the runner re-posts with them (at most twice).
- **Open mastery session after a failing verdict** (second tab, or a
  learner keeping a throwaway tab open to read feedback): the verdict sealed
  it, so `/progress` returns 409 `course_session_consumed` with no key; the
  retake/full retry runs in a new session (FR-013 seal).
- **Answer in flight while the verdict seals:** an insert that reaches the
  FR-018 guard after the seal is refused, nothing is stored, 409 with no
  key; no row is left for `/mistakes`, the report or resume to show. An
  insert that reached the guard first holds the session row, the seal waits
  for its commit, and the verdict reads the row: scores it, or answers 422
  if the client did not list the session (FR-013, FR-018).
- **Retake session sealed empty:** it is listed in `superseded` and
  `/course-resume` never offers it as the pending retake (it filters
  `sessions` and `superseded` ids, not only by time).
- **Empty session opened before a failing verdict** (Codex r4441040944):
  sealed by the verdict and listed as `superseded`, so `/progress` returns
  409 with no key; for a verdict recorded before this change, refused
  because the session is older than the entry's `at` (FR-013).
- **Session of the wrong kind for the current step** (a new `run` session
  while a `retake` is due, a `retake` session after `retry_full`): 409
  `course_session_consumed`, no key (FR-013).
- **Session opened while a verdict is in flight** (after its seal): not
  sealed, not collected by that verdict; any answer it stores with feedback
  is collected by the next verdict whatever its `kind` (FR-013).
- **Learner still in an open single_attempt session at `due_at`:** further
  `/progress` writes are refused (FR-006), as a hand-in after `due_at` is.
- **Review of a never-answered question:** 409 `review_needs_attempt`
  (FR-016), no key.
- **`/check` or `/progress` racing a session end** (any session kind): the
  end waits for the insert's commit and counts it, or the insert is
  refused after the end (FR-008, FR-018); totals are never short by a row.
- **Concurrent ends of one session** (two tabs, end vs seal vs sweep):
  the first close wins under `FOR UPDATE`; the others return that row
  unchanged, with its totals.
- **Locked single_attempt session ended with one answer** (`paused`,
  `completed`, sealed or swept): no learner output shows its counts
  (FR-019); the teacher view does.

## Success criteria

- SA retest PASS on: GET self-study without key; `/check` reveals no key
  before a stored attempt and none for sealed items; forged `is_correct`
  ignored; time-cap regraded; handed-in learner sees no key before `due_at`;
  mastery peek via abandoned session closed, including writes to a session
  a verdict consumed and to an empty session opened before the verdict,
  and an answer racing the seal (no row stored, nothing on `/mistakes`);
  a learner JWT cannot read `quiz_attempts` or `quiz_sessions` through
  REST; a paused one-question single_attempt session shows no
  correctness count before release.
- Learner-perceived feedback latency on staging: p95 of `/check` ≤ 1.5 s
  under normal load (measured in `verification.md`).
- No increase in self-study 5xx rate after release (Railway logs, 24 h).

## Open questions

Decisions the job recommends; Vinh confirms by approving this spec.

- **Q-1 (QĐ-5):** QĐ-5 accepted a client-visible key so the browser could
  grade instantly and reveal the key on grading. This spec keeps the
  learner-visible promise (per-question verdict, answer and explanation
  right after answering) and moves only the grading to the server, adding
  one round trip. `QUICK_CHECK_QUIZ_AND_TOPIC_CONTENT_PLAN.md` §10 already
  names "server-side grading (POST từng câu, ẩn key)" as the path. The job
  reads this as consistent with QĐ-5 and not a reversal; approval of this
  spec confirms it. If Vinh reads it as a reversal, the build does not start.
- **Q-2 (rate limit, D4):** no new limiter. Each `/check` stores one
  permanent attempt (the same cost as one `/progress` row today) and reveals
  only the key of the answer it stored. Alternative: a per-session cap on
  stored attempts (one extra count read per call).
- **Q-3 (`due_at` null):** release only when every item is handed in. No
  manual teacher release in this change.
- **Q-4 (deadline moved later after release):** re-seal on read; no block on
  editing `due_at`.
- **Q-5 (Vocab self-study):** included with Grammar (same player and
  engine). Recommendation: yes.
- **Q-6 (review mode, FR-016):** key only for already-answered qids.
  Alternative: allow review only after the learner finished the bank (needs
  a managed admission change, i.e. a migration: out of this ticket).
- **Q-7 (self-study homework scoring):** keep "session that completes the
  work sets the score" and record the junk-check limitation, or score the
  first stored attempt per qid across sessions (a scoring change, separate
  spec). Recommendation: keep, low stakes.
- **Q-8 (migration, CR R9, R10):** earlier drafts said "no migration".
  Closing the late-row race, the totals race and the direct REST reads
  needs one: the FR-018 trigger function replacement (now covering every
  session), the FR-008 `quiz_close_sessions_counted` function and
  `grammar_quiz_end_service` replacement, and the FR-017 revokes on
  `quiz_attempts` and `quiz_sessions`. Alternative considered: keep
  late rows and filter them on every read path by recording the scored
  attempt ids in each ledger entry. Rejected: it needs the same filter in
  four read paths, cannot cover the direct REST read, and depends on
  per-row bookkeeping instead of one lock. Recommendation: the migration.
- **Q-9 (whole-item score before release, CR R10):** FR-019 withholds
  every per-session count, but keeps the item's hand-in result
  (`/course/verdict` `pct`, the "Bài của tôi" score) visible right after
  hand-in, as today (FR-012). It is one count over the whole bank,
  written once, after which the learner cannot answer again; it already
  exists today (the verdict regrades from `answer_given`), so this spec
  does not create it. An extreme hand-in (a timed item that expires
  with one answer stored) makes it equal to one question's correctness
  for that learner. Recommendation: keep it visible. Alternative: hide
  the score too until release (FR-011), which changes "Bài của tôi" and
  the runner's result screen.
