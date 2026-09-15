# Advanced Vocabulary core-30 deployment

This release is assignment-only. Admins assign one of 30 C4 banks; learners
complete six required stages. Writing and Speaking remain reference-only and
the assignment has no default overall score.

This runbook deliberately activates the agreed 30-lesson core (Day-0) scope
only. The six cluster review checkpoints, D+1/D+7 retention flow, public catalog
and self-enrolment remain separate follow-up releases; none is silently implied
by a core assignment marked complete here.

## Release contents

- `ADV-T01` through `ADV-T30`
- 720 vocabulary cards, all with `common_error`
- 1,440 deterministic practice questions selected from 8,090 authored items
- 600 controlled-rewrite prompts revealed through a required self-check
- 407 Reading questions and 180 Listening questions
- 30 Listening tracks, 60 Writing Task 1 illustrations
- Kokoro headword and example audio for every vocabulary card
- 30 assignment-only banks named `C4-ADV-T01` through `C4-ADV-T30`

The canonical deploy inventory is
`backend/content/advanced_vocab/core30-manifest.json`.

## Pre-deploy verification

From the repository root:

```bash
backend/venv/bin/python backend/scripts/sync_advanced_vocab_core30.py \
  --source "/absolute/path/to/advanced_vocab_core30_package_v5_writing_reference" \
  --course-source "/absolute/path/to/Vocab course"

backend/venv/bin/python backend/scripts/import_advanced_vocab_core30.py

cd backend
venv/bin/python -m pytest \
  tests/test_advanced_vocab_service.py \
  tests/test_advanced_vocab_importer.py \
  tests/test_quiz_service.py \
  tests/test_class_student_page.py \
  tests/test_course_assignment.py \
  tests/test_student_work_drawer.py -q
```

The dry-run is intentionally offline and must report `30/30 lesson hợp lệ`
without Supabase environment variables. `--course-source` is required when the
built package omits a referenced Listening figure; the sync resolves exactly
one source file and verifies that the committed deploy copy has the same
SHA-256. Do not use `--write` during a deployment; deploy assets must already
be committed and match the manifest.

## Deployment order

1. Apply `backend/migrations/263_advanced_vocab_stage_progress.sql` to the
   target Supabase database with `ON_ERROR_STOP=1`.
2. Deploy backend and frontend from the same revision.
3. Load the target backend environment and run:

   ```bash
   backend/venv/bin/python backend/scripts/import_advanced_vocab_core30.py --commit
   ```

   The importer is idempotent and performs a post-write verification. Success
   ends with `HOÀN TẤT + VERIFY: 30 bank` and confirms 48 questions per bank.
4. In Admin → Classes → Bài tập, verify that `C4-ADV-T01` through
   `C4-ADV-T30` appear after the numbered course-session banks. They must show
   the self-paced/no-grade notice and must not show pass-threshold controls.

## Release smoke test

Use one test learner and one test class assignment:

1. Assign `C4-ADV-T01` and open it from My Class.
2. Confirm both audio buttons work on a vocabulary card.
3. Complete the 24 cards and both practice stages.
4. Confirm Reading passage and questions scroll independently.
5. Complete the 20-item controlled rewrite self-check, submit Listening, then
   open Writing and Speaking references.
6. Confirm the class item becomes submitted with `score = NULL` and
   `artifact_kind = advanced_vocab_progress`.
7. In Admin results, confirm six completed stages, each practice answer,
   Reading/Listening correct totals, and response/section timing are visible.
8. Reload both learner and admin pages. The state must remain identical.

Repeat the content-loading check with `C4-ADV-T30` before broad assignment to
cover the first and last bank boundaries.

## Operational constraints

- Do not set `lesson_no` on these banks. Numbered lesson slots belong to the
  canonical C4 course banks and are protected by a unique index.
- Do not publish these banks into the generic quiz browser. They are entered
  only through an active class assignment.
- Do not add Writing submission or Speaking grading to this runtime. A graded
  Writing task must continue to originate from a teacher assignment.
- Do not delete an assignment item after it has Advanced Vocabulary evidence;
  migration 263 deliberately blocks that data loss.
