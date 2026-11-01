# Research (read-only)

Code was read at `origin/staging` `7b5e3ae97` (2026-10-30 16:42 UTC+7). PR
branches `origin/q/001h2-course1-final-assessment-scope` (#2062) and
`origin/q/001ha-c1-final-import` (#2064) are not merged. Staging DB
`zjphffoujxkpltixsbzj` was read with SELECT statements only. Production was not
queried.

## 1. Where the lesson tag lives

- The importer validates `lesson_primary` but does not persist it:
  - `backend/services/course_assessment_import.py:64` reads and validates it;
  - the mapped row (`:140-170`) has no lesson field;
  - `item_key` comes from `truc`/`diem_day` (`:142`), and `skill` from
    `truc_nhom` (`:147`).
- The PR #2064 converter (`convert_course_final_exam_docx.py`, around line 290)
  sets `lesson_primary=Bxx`, `truc="Buổi xx"` and `truc_nhom="Bxx"`. So the
  final's `quiz_questions.skill` is `B01`…`B20` and its `item_key` is
  `Buổi 01`…
- The midterm format uses a knowledge group in `truc_nhom`:
  - the test fixture `backend/tests/test_course_assessment_import.py:15-16`
    uses `KHUNG-CAU`;
  - on staging, the QA midterm-format banks `C1-QA-RESUME-20261010-*` have
    `skill='KHUNG-CAU'` and `item_key='qa N'`.

  The production midterm's values are unknown. There is no production access, so the resolver decides at report time.
- Leader note, 2026-10-30: the production final was imported at 17:12 (UTC+7), with a bank id starting `590ce416`. Its `item_key` is `Buổi xx` and its lesson code is `Bxx`; `dang=A1` is a placeholder. This matches the converter mapping (`skill`=`truc_nhom`=`Bxx`). It is not verified by us.
- `quiz_questions` has no lesson column and no jsonb meta. Its columns on
  staging: `id, bank_id, qid, item_key, type, subtype, input, skill, pair,
  counts_toward_mastery, prompt, options, answer, accept, segments, mask, pairs,
  explain, points, audio_url, grammar_article_slug, order, created_at, hint,
  why_wrong`.
- The bank is written with `meta` taken as is from the payload
  (`import_course_assessment_bank.py:105-122`, mig 271 and mig 268 `UPDATE …
  meta = p_payload -> 'meta'`). That is why `meta.lesson_map` needs no
  migration.
- The final JSON in `/workspace/uploads/final-c1/out/C1-FINAL-B01-B20-300.json`
  has 300 rows:
  - B01, B03, B04, B07, B08, B11, B13, B14, B16, B17, B18, B19, B20 have 16 each;
  - B02, B05, B09, B10 have 14 each;
  - B06, B12, B15 have 12 each.

  The counts are **not** 16 for every lesson.

## 2. How attempts and answers are stored

- Each give creates a `class_assignments` row: `skill='course'`,
  `content_id` → `quiz_banks.id`, and a frozen `content_config` (`bank_code`,
  `bank_revision`, `section_counts`, `completion_mode`, `time_limit_minutes`).
  This happens in `_resolve_course_bank`, `admin_class_assignments.py:799-946`.
  The question content is **not** snapshotted (comment at `:919-922`).
- `bank_revision` is an md5 over `to_jsonb(quiz_banks)`, all of the bank's
  `to_jsonb(quiz_questions)` and its active pronunciation sets (mig 269
  `quiz_course_bank_assignment_revision`). It is checked only when the
  assignment is created.
- Once a bank is referenced by an assignment or a session, the assessment
  replace RPC refuses it (mig 268, `course_assessment_bank_in_use`).
- On staging, all 3 Course assignments with a `bank_revision` still match the
  live token.
- Each learner has one `class_assignment_items` row. The official `score` (%)
  is written by the verdict or the reaper. `mastery` has `threshold`,
  `bank_rev`, `section_attempt_pending` and `attempts[]`, and each attempt has
  `at, phase, pct, next_action, sessions, timed_out`.
- `quiz_sessions` hold `class_assignment_item_id` and `kind` (`run` or
  `retake`), with an index on `class_assignment_item_id`.
- `quiz_attempts` hold one row per answer: `session_id, qid, question_id,
  item_key, skill, answer_given, is_correct, response_time_ms, created_at`.
  `item_key` and `skill` are client-declared (`quiz_service.py:117`), and the
  existing reports deliberately read the axis from the bank instead
  (`quiz_service.py:6224-6229`). The table is indexed on `session_id`.
- `course_verdict` (`quiz_service.py:4635`) regrades from `answer_given`
  against the bank key. It stores
  `bank_rev = sha256("qid:answer"…)[:12]` (`:4798`).
- Single-attempt facts from the final-flow audit
  (`/workspace/cc-jobs/reports/final-flow-audit-20261030.md`):
  - unanswered questions count as wrong, and the denominator is all 300;
  - the reaper finalizes timeouts;
  - keys are released to the learner at hand-in (P1-1);
  - the first-attempt baseline in the detail report uses "answered" as its
    denominator (P2-2).

## 3. Teacher-facing surfaces today (all admin-only)

| Surface | Backend | Frontend | Gap for this feature |
| --- | --- | --- | --- |
| Tally, one row per learner | `GET /admin/cohorts/{c}/assignments/{a}/tally` (`admin_class_assignments.py:1561`). It writes reconcile/"vá sổ" rows | "Tổng kết" tab, `admin-class-submissions.tsx` | Overall score only |
| Tiến độ lớp, class axes | `GET /admin/quiz/banks/{b}/attempt-report?assignment_id=` (`admin_quiz.py:192` → `course_attempt_report`, `quiz_service.py:5974`) | "Tiến độ lớp" tab | Groups by `item_key`, keeps only axes with errors (`:6360`) and caps at 15 (`:6384`). No correct/total against the bank count |
| Per-learner answers | `GET /admin/quiz/banks/{b}/students/{u}/report?assignment_id=` (`admin_quiz.py:209` → `course_answer_report`, `quiz_service.py:5645`) | "Inspect học viên"; client groups by `item_key` | Answered-only denominator. Reused as the drill-down |
| Learner self-report | `GET /api/quiz/course/report` (`quiz.py:294`), gated by `_course_review_gate` (`quiz_service.py:5603`) | `frontend/public/js/course-report.js` groups by `item_key` | Unchanged (non-goal) |

## 4. Instructor access pattern

- `/instructor/*` resolves `me` only through `_me` (`instructor.py:110`), which
  means `require_instructor` plus the audited admin `as_instructor` override.
- Owner-scoped tables go through `instructor_db(me)`
  (`services/instructor_access.py:38-47`), with `cohorts` scoped on
  `created_by`.
- Not-owned reads return 404 "Không tìm thấy." (`get_cohort`,
  `instructor.py:636`).
- No instructor route reads `class_assignments` today.
- On staging, the cohorts with `course_id` were all created by admins (2/2).
