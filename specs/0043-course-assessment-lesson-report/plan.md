# Implementation plan

LESSONREPORT-0043 was approved by Vinh on 2026-10-30 at 17:20 (UTC+7). No code is written until the approved spec has merged to `staging`. This plan
does not need a migration. If review adds one (see "Data and contracts"), its
number is **TBD (Leader assigns)**.

## Architecture impact

### Backend

- **`backend/services/course_lesson_report.py` (new)** owns the report and is the
  only new decision point.
  - `lesson_tag_map(bank, questions) -> (map, coverage, source_counts, conflicts)`
    implements FR-001. Precedence:
    1. `meta.lesson_map[qid]` matching `^B[0-9]{2}$`;
    2. `quiz_questions.skill` matching `^B[0-9]{2}$`;
    3. `quiz_questions.item_key` matching `^buổi\s+([0-9]{1,2})$` after
       `unicodedata.normalize('NFC')`, `strip()` and `casefold()`, mapped to
       `f"B{int(n):02d}"`;
    4. otherwise untagged.

    A lower-priority source that names a different lesson increments
    `tag_conflicts`. `subtype`/`dang` is never read. Only `_is_course_quiz_question` rows count.
  - `graded_answers(item, assignment, sessions, attempts, key_of)` implements
    FR-003. For `single_attempt` it reads the sessions in the latest completed
    `phase='run'` attempt of `mastery.attempts`. For mastery mode it takes the
    first answer per qid over that item's `kind='run'` sessions. Answers are
    regraded with `quiz_service.grade_attempt`.
    - The per-qid duplicate rule is **extracted from `course_verdict`** into a
      shared helper in `quiz_service`, so the verdict and the report cannot
      diverge (FR-004). This is a pure refactor and the verdict's behaviour does
      not change. It is covered by the existing verdict tests and a new
      equality test.
  - `revision_state(assignment, bank_id, items, key_of)` implements FR-008. It
    makes one RPC read of `quiz_course_bank_assignment_revision` (service_role,
    STABLE, already granted). The fallback recomputes the qid:answer sha256[:12]
    exactly as `course_verdict` does. That formula is extracted into a shared
    `course_bank_key_fingerprint(qrows)` helper.
  - `build_lesson_report(cohort_id, assignment_id) -> LessonReport` loads the
    following with `_report_pages` (explicit order, pages of 1000, id chunks of
    100):
    - assignment, items, students (`id, full_name, student_code, user_id`);
    - questions (`qid, type, answer, skill, item_key, counts_toward_mastery, order`);
    - sessions by `class_assignment_item_id` (indexed
      `idx_quiz_sessions_class_item`);
    - attempts by `session_id` (indexed `idx_quiz_attempts_session`).

    It is read-only (FR-011) and calls no `reconcile_*`, `mark_item_submitted`
    or other write helper.
- **`backend/routers/admin_class_assignments.py`**: a new
  `GET /{cohort_id}/assignments/{assignment_id}/lesson-report`. It does
  `require_admin` + `_require_cohort`, then reads the assignment
  `.eq("id").eq("cohort_id")` (the same pattern as `assignment_tally`) and
  calls the service.
- **`backend/routers/instructor.py`**: a new
  `GET /cohorts/{cohort_id}/assignments/{assignment_id}/lesson-report`, plus
  `GET /cohorts/{cohort_id}/course-assignments` for FR-013. Both call
  `_me` and then `instructor_db(me).table("cohorts").select("id").eq("id", …)`.
  A miss returns 404 "Không tìm thấy." with the same body as `get_cohort`.
  - `class_assignments` is **not** added to `_OWNER_COLUMNS`, because it has no
    owner column. Ownership is derived from the cohort, and the assignment read
    is then pinned to `.eq("cohort_id", owned_id)`. This is a derived-owner
    path, like `instructor_essays`, so it is documented in
    `instructor_access.py` as a dedicated helper `instructor_owned_cohort(me,
    cohort_id)`, which also fails closed.
- **`backend/scripts/import_course_assessment_bank.py`** (FR-002): adds
  `lesson_map` and `lesson_counts` to `payload["meta"]`. Neither RPC changes,
  because both write `meta` from the payload as is (mig 267/268/271).

### Frontend

- `frontend/app/(authed-admin-classes)/admin/classes/[cohortId]/admin-class-submissions.tsx`:
  - add a fourth `View` `'lessons'` and the tab "Theo buổi";
  - add a new `admin-class-lesson-report.tsx` component and a
    `lib/course-lesson-report-model.mjs` normaliser;
  - wire types come from `frontend/lib/openapi-contract.ts` after the OpenAPI
    regeneration.
- `frontend/app/(authed-instructor)/instructor/` (FR-013, kept by owner decision 2): add a
  small "Kết quả theo buổi" section that lists owned classes' Course
  assignments and renders the same component in read-only mode, without the
  Inspect link.

## Data and contracts

- **Migration: none.**
  - Everything is derived from `class_assignments.content_config`,
    `class_assignment_items` (`score`, `mastery.attempts[].sessions`,
    `mastery.bank_rev`), `quiz_sessions`, `quiz_attempts`, `quiz_questions` and
    `quiz_banks.meta`.
  - The existing indexes cover the reads: `idx_quiz_sessions_class_item`,
    `idx_quiz_attempts_session`, `quiz_questions_bank_id_qid_key` and
    `class_assignment_items_assignment_id_student_id_key`.
  - A `quiz_questions.lesson_tag` column was considered and rejected. Adding a
    column changes `to_jsonb(qq)`, and with it the md5
    `quiz_course_bank_assignment_revision` of every Course bank. That would
    permanently move every existing assignment off `revision_state=verified`.
    It would also still need a backfill of immutable assigned banks. If review
    still wants a column: migration **TBD (Leader assigns)**, and FR-008 would
    then rely on `keys_verified` for all pre-migration assignments.
- **Response model** `CourseLessonReport` (Pydantic, published in OpenAPI):
  - `assignment {id, title, completion_mode, due_at, sealed}`
  - `bank {id, code, title, quiz_question_count}`
  - `lesson_tags: "complete"|"partial"|"none"`
  - `untagged_count`
  - `tag_sources: {meta, skill, item_key}` (counts) and `tag_conflicts`
  - `excluded_sections: [str]`
  - `revision_state: "verified"|"keys_verified"|"unknown"`
  - `weak_pct`
  - `lessons: [{tag, label, total}]`
  - `class: {counted, assigned, sample_low, lessons: [{tag, correct, total, pct, weak, weak_learners}], weakest: [tag]}`
  - `learners: [{student_id, name, student_code, state, moved_or_archived, score, score_mismatch, quiz_only, lessons: [{tag, correct, answered, total, pct, weak}], weakest: [tag]}]`
  - `unmatched_answers`, `stale`
  - The 409 body is `{code: "lesson_report_revision_drift", detail}`, and the
    422 body is `{code: "lesson_report_not_applicable", detail}`.
- **Compatibility:** these are new routes only. The tally, the attempt report
  and the student reports are unchanged, and the deployed frontend ignores the
  new routes. The FR-002 meta keys are additive, and no reader breaks on
  unknown meta keys.
- **RLS:** no RLS change. The routes use the service-role client behind
  code-level owner scoping, which is the W-3 pattern. No new table grant is
  made. RLSCLEANUP-0039 is unaffected.

## UI and interaction

The states are in [`ui-states.md`](ui-states.md).
- The matrix is a real `<table>` with row and column headers. On narrow
  screens the learner column is sticky and the table scrolls horizontally
  inside its own region.
- "Cần ôn" is text plus an icon, so it does not rely on colour.
- The UI works in both themes with Aver tokens.

## Work decomposition

1. T001: shared helpers extracted from `course_verdict` (duplicate rule and
   key fingerprint), with tests proving no behaviour change.
2. T002: the service, the models and the admin route. Depends on T001.
3. T003: the instructor route plus the owned-cohort helper. Depends on T002.
4. T004: the importer meta. This is independent of T001–T003 and must be
   sequenced after PR #2062 merges, because it touches the same file.
5. T005: the admin UI. Depends on T002 and the OpenAPI regeneration.
6. T006: the instructor UI (FR-013). Depends on T003 and T005.
7. T007: the staging QA rehearsal and the evidence.

## Rollout and rollback

See [`rollout.md`](rollout.md). This change ships code only, with no flag and
no schema change. Rolling back is a code revert, and no data needs repair.

## Verification strategy

- Unit tests for tag resolution: one fixture per source (AC4a meta, AC4b skill as in the production final, AC4c item_key with NFC/NFD and rejects), conflicts (AC4d), none (AC4), and the type code ignored; graded-answer selection (single_attempt sessions, mastery
  first-answer, duplicates, unknown qid), reconciliation, weak ranking and
  revision states.
- An equality test: for each fixture, the report's per-learner sum equals the
  `course_verdict` correct count.
- Router tests for admin 404/422/409/200, instructor ownership (AC6) and the
  as_instructor audit, plus a schema test for forbidden fields (AC7).
- An importer test (AC8) that checks the meta keys and that the dry-run output
  is unchanged.
- Frontend model and React tests for every state in `ui-states.md`, plus an
  OpenAPI contract test.
- The staging QA rehearsal (rollout.md) with recorded MANUAL evidence and a
  timing measurement (FR-014).
