# Implementation plan

## Architecture impact

- `backend/services/sentence_lab_grader.py` (new): prompt, strict batch schema, validator, batching and retry, usage logging.
- `backend/services/quiz_service.py`: `course_writing_state`, `submit_course_writing` branch on `meta.sentence_lab.kind='sentence_lab_v1'`; new `revise_course_writing`; play-path guide strip.
- `backend/routers/quiz.py`: `POST /course/writing/revise`.
- `backend/config.py`, `backend/services/ai_usage_logger.py`: model settings and an OpenAI chat usage row.
- `backend/scripts/import_sentence_lab_course5.py`, `backend/scripts/calibrate_sentence_lab.py`, `backend/assets/sentence_lab/error_codes.json` (public part of the pack). The private grading prompt is a server-side setting, not a repo file.
- Frontend: `frontend/public/js/course-writing.js`, `frontend/app/(authed)/course-exercises/course-behavior.tsx`, `frontend/public/css/course-exercises.css`, regenerated `frontend/types/api.d.ts`.

## Data and contracts

- No schema change. Banks: `quiz_banks` (`skill_area='course'`, `course_id`=Course 5, `lesson_no` NULL, `meta.sentence_lab`). Items: `quiz_questions` `type='writing'`, key in `segments.sentence_lab`, reference answer in `explain`.
- Submission: `course_writing_submissions.items[i]` gains `feedback` (pack schema) and later `revision`; Course 1 rows are unaffected.
- `GET /api/quiz/course/writing` adds `sentence_lab` and per-question `sentence_lab_item` for lab banks only. `POST /api/quiz/course/writing/revise` takes the existing `CourseWritingBody` and returns items/total/clean/graded_at/revision_done.

## UI and interaction

- Existing course exercise page; lab banks render their own form, results, rewrite bar and guide. See `ui-states.md`.

## Rollout and rollback

- Merge spec, then implementation to staging; import to staging unpublished, publish after the code is live; calibrate; promote; import to production under separate approval. See `rollout.md`.

## Verification strategy

- Backend unit tests (`tests/test_sentence_lab.py`) for validator, batching/retry, importer rejects, submit routing, state gating, rewrite rules and play-path strip; frontend contract tests (`course-writing-sentence-lab.test.mjs`); importer dry run on the real package; calibration report; staging journey on S01.
