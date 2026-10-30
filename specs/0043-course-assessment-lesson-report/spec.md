---
id: LESSONREPORT-0043
title: Teachers see a course assessment's results per lesson for each learner and the whole class, with the weakest lessons highlighted
status: approved
risk: high
owner: product
---

# Teachers see a course assessment's results per lesson for each learner and the whole class, with the weakest lessons highlighted

Approval: approved by Vinh on 2026-10-30 at 17:20 (UTC+7). His reply was
relayed verbatim by the Leader from the Leader chat (card `t931s2961`): "Duyệt
spec 0043"; "Giáo viên có dùng, làm cả trang giảng viên"; "Buổi yếu là dưới
60%"; "Đề bị sửa sau khi giao thì không hiện số". See
[`approval-decision.md`](approval-decision.md) and
[Owner decisions](#owner-decisions).
The Leader confirmed spec number 0043 on 2026-10-30. 0040–0042 are held by
open spec branches. The Leader also decided that the FR-002 importer change
ships with the 0043 implementation job, not with PR #2062.
Written by the Feature Developer (spec writer) on 2026-10-30 (UTC+7). Code was
read at `origin/staging` `7b5e3ae97`. Staging (`zjphffoujxkpltixsbzj`) was
queried with SELECTs only. Production was not queried. Citations are in
[`research.md`](research.md).

Production data note (Leader, 2026-10-30): the Course 1 final bank was
imported to production at 17:12 (UTC+7). Its bank id starts with `590ce416`.
Per the Leader, its questions carry `item_key` `Buổi xx` and the lesson code
`Bxx`. Its `dang` value `A1` is a placeholder. That bank was imported before
FR-002 existed, so it has no `meta.lesson_map`. FR-001 resolves its lessons from
`skill`, with `item_key` as the next fallback. This spec does not re-import or
modify it.

## Thay đổi người dùng thấy (tóm tắt cho anh Vinh)

- Trong trang bài giao của lớp (`/admin/classes/<lớp>` → Bài tập theo buổi →
  một bài giao), có thêm tab **"Theo buổi"**. Tab này chỉ hiện với bài giao có
  nhãn buổi cho từng câu, ví dụ đề cuối khoá `C1-FINAL-B01-B20-300`.
- **Cả lớp:** một bảng B01…B20, mỗi buổi có số câu đúng/tổng và % của cả lớp,
  cùng số em yếu ở buổi đó. Buổi yếu được tô và có nhãn chữ "Cần ôn".
  Trên bảng có dòng "3 buổi yếu nhất".
- **Từng em:** một ma trận học viên × buổi. Mỗi ô là số đúng/tổng của buổi
  đó. Mỗi em có tối đa 3 buổi yếu nhất được đánh dấu. Bấm vào tên em sẽ mở
  màn "Inspect học viên" đang có để xem từng câu.
- Chỉ số liệu từ bài đã chốt mới vào bảng. Em đang làm, chưa mở bài hay chưa
  kích hoạt tài khoản hiện trạng thái tương ứng, không hiện số.
- **Giảng viên** có trang riêng trong `/instructor` để xem cùng báo cáo này, nhưng chỉ của lớp mình đứng tên (anh Vinh duyệt: "làm cả trang giảng viên"). Trang chỉ để đọc và không mở được từng câu.
- "Buổi yếu" là buổi có kết quả dưới 60%; buổi đạt đúng 60% thì không tính là yếu. Nếu đề bị sửa sau khi giao, báo cáo không hiện số.
- Học viên không thấy gì mới. Không gửi email hay thông báo nào.

## Problem

After the Course 1 final (`C1-FINAL-B01-B20-300`: 300 five-option questions
covering lessons B01–B20, with 12–16 questions per lesson), teachers need to know
which lessons each learner and the class got wrong, so they can plan review.
Today the product cannot answer that question:

- The tally (`GET /admin/cohorts/{c}/assignments/{a}/tally`) shows only one
  overall score per learner.
- The class "Tiến độ lớp" view (`GET /admin/quiz/banks/{b}/attempt-report`)
  groups mistakes by `quiz_questions.item_key`. It keeps only axes with at least
  one wrong answer and cuts the list to the top 15, so 20 lessons can never all
  be shown. It ranks by "affected students" and has no correct/total per axis
  against the bank's question count.
- The per-learner report groups first answers by `item_key` on the client. Its
  denominator is "answered", not "questions in the bank". A learner who timed
  out after 15/300 questions shows 100% (finding P2-2 of the final-flow audit).
- No view puts learners against lessons.
- These surfaces are admin-only. No instructor-scoped route exists for class
  assignment results.
- The importer validates each question's lesson tag (`lesson_primary`) but
  **does not store it**. The final bank only has its lesson in
  `quiz_questions.skill` (`B01`…`B20`) and `item_key` (`Buổi 01`…), and only
  because the PR #2064 converter sets `truc_nhom`/`truc` that way. The midterm
  format uses `skill` for a knowledge group (for example `KHUNG-CAU`). The
  question-type code (`dang`/`subtype`) can be the same value for all 300
  questions, so it cannot be used for grouping.

## Scope

- One read-only lesson report for one class assignment of any Course bank
  (`skill='course'`, a `quiz_banks` content) whose quiz questions carry a lesson
  tag. This covers the final, a future midterm or checkup imported with tags,
  and the QA banks.
- Lesson-tag resolution from data that already exists, plus a small importer
  change so that future assessment imports store the tag explicitly in the bank
  metadata. No schema migration is needed.
- A per-learner result for each lesson, a class-wide result for each lesson,
  and weak-lesson highlighting.
- A revision integrity check against the assignment's frozen
  `content_config.bank_revision` and each learner's verdict fingerprint
  (`mastery.bank_rev`).
- Admin API and a "Theo buổi" tab in the existing admin assignment workspace.
- An instructor API scoped to the instructor's own classes, with a minimal
  read-only instructor page (owner decision 2).

## Non-goals

- No content editing, no re-import, and no re-tagging or backfill of banks that
  are already imported or assigned. That includes the production midterm
  `C1-MIDTERM-B01-B11-120`. Assigned assessment banks are immutable (mig 268),
  and backfilling them would be a separate data-repair spec.
- No regrade and no change to how scores, verdicts, pass/fail or timeouts are
  computed. The official score stays `class_assignment_items.score`.
- No email, push, in-app notification or digest to learners or teachers.
- No learner-facing change. A learner self-view by lesson is not built. The
  existing learner report already groups the learner's own answers by
  `item_key` after hand-in, which for the final means "Buổi xx". No payload or
  gate changes.
- No change to when single-attempt answer keys are released (final-flow audit
  P1-1). That needs its own spec ("hold key until due / teacher release").
- No CSV/PDF export, no cross-class or cross-assignment comparison, no history
  over time, and no 0–10 scale.
- No grouping by question type (`subtype`/`dang`) or by `muc` points.
- No reconcile/"vá sổ" writes from this report. The existing tally keeps that
  job.

## Users and journeys

- **Admin teacher (anh Vinh or another admin):**
  1. Open `/admin/classes/<cohort>` → Bài tập theo buổi → the final assignment.
  2. Choose the "Theo buổi" tab and read the class table.
  3. Scan the learner × lesson matrix.
  4. Open one learner, which leads to the existing "Inspect học viên"
     per-question view.
- **Instructor who owns the class:** reaches the same read-only report for
  an assignment in a class they own. A class they do not own returns "not
  found".
- **Learner:** nothing changes.

## Requirements

- **FR-001:** Each auto-graded Course quiz question (`_is_course_quiz_question`: type `mcq` or null and `counts_toward_mastery` not false) of the assignment's bank resolves to at most one lesson tag `BNN`. Sources are tried in this order, first match wins: (1) the bank's `meta.lesson_map[qid]` when it matches `^B[0-9]{2}$`; (2) `quiz_questions.skill` when it matches `^B[0-9]{2}$`; (3) `quiz_questions.item_key` when, after NFC normalization and trimming, it matches `Buổi NN` case-insensitively (one or more spaces, one or two digits), normalized to `B` plus two zero-padded digits; (4) otherwise the question is untagged. `subtype`/`dang`, `points`, any other `item_key` text and client-supplied attempt fields (`quiz_attempts.skill`/`item_key`) never decide the lesson. The report states tag coverage as `complete`, `partial` (with the untagged count) or `none`, the number of questions resolved from each source, and `tag_conflicts`: the count of questions where a lower-priority source names a different lesson than the winning one. A conflict is a warning, not a refusal. Writing and other non-quiz sections are excluded and named as excluded.
- **FR-002:** `import_course_assessment_bank.py` stores each question's validated `lesson_primary` in the bank's `meta.lesson_map` (`{qid: "Bxx"}`) and the per-lesson counts in `meta.lesson_counts` for every new create or replace. The dry-run output and all validations stay unchanged, and no other column or row changes. Banks that are already imported are not modified.
- **FR-003:** For each learner (one row per `class_assignment_items` row of the assignment), the graded answer set comes from the canonical verdict. For `single_attempt`, these are the sessions listed in the latest completed main-run attempt of `mastery.attempts`. For `mastery` mode, it is the first answer per question across that item's `kind='run'` sessions, which is the rule the existing reports use. Every answer is regraded on the server against the bank key with `grade_attempt`. Each lesson reports `correct`, `answered` and `total`, where `total` is the number of bank quiz questions with that tag. `pct = correct / total × 100`, rounded to one decimal. Unanswered questions count as not correct.
- **FR-004:** For a quiz-only assignment (`section_counts == {"quiz"}`), the sum of a learner's lesson `correct` values plus the correct untagged questions must match the official `class_assignment_items.score` within 0.05 percentage points. Otherwise the row carries `score_mismatch` and the report-level `stale` flag. For a multi-section assignment, the row states that lesson numbers cover the quiz section only and does not reconcile.
- **FR-005:** Each learner row has one state: `no_account`, `untouched`, `in_progress`, `graded` or `timed_out`. Only `graded` and `timed_out` rows carry lesson numbers. A learner whose item survives a class move or an archive still appears, with a marker. No row is dropped because `user_id` is null.
- **FR-006:** The class result covers only rows with numbers. For each lesson it reports the summed `correct`/`total`, `pct`, the number of learners for whom that lesson is weak, and `counted`/`assigned` learner counts. `sample_low` is true when fewer than 3 learners are counted.
- **FR-007:** A lesson is weak when its `pct` is strictly below 60 (`LESSON_WEAK_PCT = 60`, owner decision 3). A lesson at exactly 60.0% is not weak. Each learner's up to 3 lowest weak lessons are flagged, with ties broken by lesson number. The class shows its weak lessons and the 3 lowest lessons by class `pct`. Lessons are always listed in numeric order B01→Bnn, with untagged last. The highlight is carried by text, not by colour alone.
- **FR-008:** The report compares the assignment's frozen `content_config.bank_revision` with the live `quiz_course_bank_assignment_revision(bank_id)`. The result is `revision_state=verified` when they are equal. It is `keys_verified` when they differ but every graded item's `mastery.bank_rev` equals the live qid:answer fingerprint and every graded qid still exists. It is `unknown` when no frozen revision exists. In any other case it is `drift`, and the API answers 409 `lesson_report_revision_drift` with no numbers. `keys_verified` and `unknown` carry a warning that lesson tags are read from the current bank.
- **FR-009:** `GET /admin/cohorts/{cohort_id}/assignments/{assignment_id}/lesson-report` requires `require_admin`, including AAL2 once ADMINAAL2-0032 enforces it. It returns 404 unless the assignment belongs to that cohort, has `skill='course'` and points at a `quiz_banks` row with `skill_area='course'`. It returns 422 `lesson_report_not_applicable` for an Advanced Vocabulary runtime. It returns 200 with `lesson_tags="none"` and no lesson rows when the bank has no tags. The response is a published Pydantic model in OpenAPI.
- **FR-010:** `GET /instructor/cohorts/{cohort_id}/assignments/{assignment_id}/lesson-report` resolves the caller through `_me`, which covers `require_instructor`, `is_active` and the audited admin `as_instructor` override. It proves ownership with `instructor_db(me).table("cohorts")` on `created_by`. A cohort the caller does not own, an assignment from another cohort, and a missing id all return the same 404 body. When ownership holds, it returns exactly the FR-009 payload.
- **FR-011:** The report is read-only. It writes no row in any table, calls no reconcile or ledger-repair function, sends no notification and spends no paid AI. Its payload carries only `student_id`, `name`, `student_code`, state, markers and counts. It never carries question prompts, options, answer keys, explanations, `why_wrong`, `answer_given`, emails, phones or `user_id`s of other users. No learner-facing route or payload changes.
- **FR-012:** The admin assignment workspace (`admin-class-submissions.tsx`) gains a "Theo buổi" tab for Course assignments. It renders the class table, the learner × lesson matrix, the weak markers, and the revision, stale and coverage banners. Each learner opens the existing "Inspect học viên" view. The tab is hidden when `lesson_tags="none"` and uses OpenAPI-derived types.
- **FR-013:** An instructor who owns at least one class with a Course assignment can open the same read-only report from `/instructor` (owner decision 2). The page lists only their own classes' Course assignments and offers no drill-down to per-question answers.
- **FR-014:** A partial read failure never shows as zeros. It sets `stale: true`, the UI shows "Một phần dữ liệu chưa đọc được — tải lại", and rows that cannot be read are marked unreadable. For 30 learners × 300 questions on staging, the endpoint answers within a p95 of 3 s, and every multi-row read is paged with an explicit order.

## Acceptance scenarios

### AC1: Final, class view

- **Given** a staging QA class on C1 with the final bank (300 questions, B01–B20, 12–16 per lesson) given as `single_attempt`, and 3 learners who submitted with known answers
- **When** an admin opens "Theo buổi"
- **Then** 20 lesson rows show the summed correct/total, which add up to the
  learners' official scores, the weak lessons carry "Cần ôn", and the "3 buổi
  yếu nhất" line is correct

### AC2: Timed-out learner

- **Given** a learner answered 15 of 300 questions (all correct) and was finalized by the reaper with an official score of 5%
- **When** the report loads
- **Then** that row is `timed_out`, the lesson totals use the bank counts (for
  example `2/16`, not `2/2`), the sum is 15/300, and there is no
  `score_mismatch`

### AC3: In-progress and no account

- **Given** one learner mid-exam and one without an activated account
- **Then** both rows show their state with no lesson numbers, and the class
  result says "2/4 học viên đã chốt"

### AC4: Tags absent

- **Given** a midterm-format bank whose `skill` values are knowledge groups (for example `KHUNG-CAU`), whose `item_key` values are not `Buổi NN`, and whose meta has no `lesson_map`
- **Then** the API returns `lesson_tags="none"` and the tab is not offered

### AC4a: Lesson from `meta.lesson_map`

- **Given** a bank whose `meta.lesson_map` maps every qid to `Bxx` while `skill` holds a knowledge group and `item_key` holds other text
- **Then** every question takes its lesson from the map, the source counts
  show `meta=all`, and `tag_conflicts=0`

### AC4b: Lesson from `skill`

- **Given** a bank shaped like the production final (no `lesson_map`, `skill` `B01`…`B20`, `item_key` `Buổi 01`…, every `subtype` `A1`)
- **Then** coverage is `complete`, the source counts show `skill=all`, each
  lesson's total equals its question count, and `subtype` has no effect

### AC4c: Lesson from `item_key`

- **Given** a bank with no `lesson_map`, `skill` holding a knowledge group, and `item_key` values such as `Buổi 7`, `buổi 07` and ` Buổi  12 ` (NFC and NFD forms)
- **Then** these resolve to `B07`, `B07` and `B12`, and `Buổi 7a`, `Bài 07`
  and `B7` stay untagged, so coverage is `partial`

### AC4d: Conflicting sources

- **Given** a question whose `meta.lesson_map` says `B03` while `skill` says `B04`
- **Then** it counts under `B03`, `tag_conflicts=1`, and the UI shows a
  warning

### AC5: Revision drift

- **Given** an assignment whose live bank keys no longer match the learners' `mastery.bank_rev`
- **Then** the API returns 409 `lesson_report_revision_drift` and the UI shows a
  blocking explanation with no numbers

### AC6: IDOR

- **Given** instructor A owns class X and instructor B owns class Y
- **When** A requests Y's assignment, or X's id paired with Y's assignment id
- **Then** both requests return the same 404 as a nonexistent id, and nothing
  from Y appears in A's logs or responses

### AC7: No leak

- **Given** any report response
- **Then** a schema test proves the absence of prompt, options, answer, explain,
  why_wrong and answer_given, and a learner token gets 401/403 on both routes

### AC8: Importer

- **Given** the final JSON
- **When** it is imported on staging with the updated importer
- **Then** `meta.lesson_map` has 300 entries and `meta.lesson_counts` matches the
  dry-run "Phủ bài" line, and the dry-run output is byte-identical to before

## Edge cases

- The same qid is answered twice because a stage was redone. FR-003's rule
  applies, and a single shared helper with the verdict keeps both counts equal.
- An attempt's qid is not in the bank. It is excluded, counted in
  `unmatched_answers`, and sets `stale`.
- A learner has a verdict but the sessions it lists are missing. The row is
  unreadable and `stale` is set.
- A bank has a mix of tagged and untagged questions. Coverage is `partial`, and
  the untagged row is shown last.
- A lesson at exactly 60.0% is not weak (strictly below 60).
- A lesson outside the bank's `meta.scope`. It is shown as tagged, and the
  report does not reinterpret scope.
- Two classes take the same bank. Each report anchors to its own assignment,
  so there is no cross-class mixing (this follows the existing
  `course_attempt_report` lesson).
- Due date not reached. The report is still allowed for staff, and it states
  `sealed=false` so the teacher knows the numbers can still change.
- An admin uses `as_instructor`. The request is audited by the existing
  `governance_audit` path.

## Success criteria

- On the staging QA rehearsal, the per-lesson sums equal the official scores
  for 100% of graded learners. AC1–AC8 pass.
- After the real final, a teacher can name each learner's 3 weakest lessons in
  under a minute, without opening per-question reports.
- Zero cross-class reads in the instructor IDOR tests. Zero answer-bearing
  fields in the report schema.

## Security and privacy risks

| Risk | Control |
| --- | --- |
| IDOR across classes. An instructor guesses another class's `cohort_id`/`assignment_id`, or pairs an owned cohort with a foreign assignment. | FR-010: ownership comes from `cohorts.created_by` through `instructor_db`, and the assignment read is pinned to `.eq("cohort_id", owned_id)`. Not-owned, mixed and missing ids all return the same 404. `me` only comes from `_me`, and `as_instructor` is admin-only and audited. The admin route keeps `.eq("cohort_id")` as the tally does. Tests: AC6. |
| Answer keys reach learners before or after the exam. | FR-011: the report carries no prompts, options, keys, explanations or `answer_given`, so even a leaked response reveals no key. The routes are staff-only, and a learner token is refused. No learner payload or `single_attempt` seal changes. The existing per-student release on hand-in (final-flow audit P1-1) is unchanged and out of scope. The tab must not encourage sharing per-question views with learners. |
| PII. | The payload holds name, `student_code` and the learner's own counts only, which are already shown in the tally. No email, phone, `user_id` or other learner's data. Nothing is exported or sent. Logs record ids only, never names. |
| Misleading numbers from a bank changed after assignment. | FR-008: a revision state, and a refusal on key drift. |
| Data exposure through impersonation. | This uses the existing audited `governance_audit` path. No new override. |
| Denial of service from 300 × N reads. | Reads are paged and indexed, with a p95 budget (FR-014). The route is staff-only. |

## Owner decisions

All questions in the draft are resolved. None remain open.

- **Q1 → instructor page kept.** Vinh: "Giáo viên có dùng, làm cả trang giảng
  viên". FR-010 (API) and FR-013 (page) are both in scope. The page is scoped
  to classes the instructor owns (`cohorts.created_by`). Assigning ownership of
  the C1 classes to instructor accounts is an operational step outside this
  spec. Until it happens, an instructor sees an empty list.
- **Q2 → weak means strictly below 60%.** Vinh: "Buổi yếu là dưới 60%"
  (FR-007).
- **Q3 → no production query.** No production access is granted. The midterm's
  tags are not checked in advance. FR-001's four-source resolver decides at
  report time, and a midterm without tags shows `lesson_tags="none"`. For the
  production final, the Leader reports `item_key` `Buổi xx` and lesson code
  `Bxx`, which FR-001 sources (2) and (3) cover.
- **Q4 → the importer change ships with the 0043 job.** Leader decision.
  FR-002/T004 lands in the 0043 implementation PR, not in PR #2062. If #2062
  has not merged by then, T004 is rebased after it.
- **Q5 → refuse on drift.** Vinh: "Đề bị sửa sau khi giao thì không hiện số".
  FR-008 keeps 409 `lesson_report_revision_drift` with no numbers.
