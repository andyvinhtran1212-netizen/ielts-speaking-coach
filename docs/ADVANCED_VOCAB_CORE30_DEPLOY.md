# Advanced Vocabulary core-30 deployment

This release is assignment-only. Admins assign one of 30 C5 banks; learners
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
- 600 controlled-rewrite prompts with one immutable, batch-graded submission per unit
- 407 Reading questions and 180 Listening questions
- 30 Listening tracks, 60 Writing Task 1 illustrations
- Kokoro headword and example audio for every vocabulary card
- 30 assignment-only banks named `C5-ADV-T01` through `C5-ADV-T30`

The canonical deploy inventory is
`backend/content/advanced_vocab/core30-manifest.json`.
Each canonical lesson also has an immutable snapshot at
`backend/content/advanced_vocab/versions/{lesson_id}/{content_checksum}.json`.
Its deploy media is frozen under
`frontend/public/assets/advanced-vocab/versions/{lesson_id}/{content_checksum}/`.
Assignments resolve both frozen paths, so a later versioned release cannot
replace the content or media needed to reopen work already in progress.

## Pre-deploy verification

The deployable source of truth is the checksum-versioned snapshot already
committed under `backend/content/advanced_vocab/` and
`frontend/public/assets/advanced-vocab/`. Do not rebuild it from an earlier
Downloads export during deployment. The first release is the corrected v6
T11-map build locked by these SHA-256 identities:

- authored input map: `2d2750cd7dbe55c19adaf2c8b102a653627f494437546740ea2c4ebbad7591fc`
- Kokoro bundle: `c0495ddac3a1c865d6f07963f11534693f024ba9042eea0ab4b737511fb4c166`
- generated package: `176344b624eaf2edcd8b7407b60338ff3a7b3d4fd3a76be268022a6ba1f85e2e`

The earlier `v5-writing-reference` export is not publish-ready and must never
be passed to the sync command. Rebuilding content is a separate authoring
operation: it must first reproduce all three locked identities and pass the
package validator before `--write` is permitted.

From the repository root, validate the committed deploy snapshot:

```bash
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
SHA-256. `--write` also archives the previous lesson JSON and media, then writes
the new lesson and media under checksum-versioned paths. Versioned media is
immutable: sync fails instead of overwriting different bytes for an existing
checksum. Do not use `--write` during a deployment; deploy assets and version
snapshots must already be committed and match the manifest.

## Deployment order

1. Run the advisory-locked forward migration runner through migration 293.
   The required Advanced Vocabulary set is 281, 282, and 287–293; migration
   286 is also required for AI usage logging. Verify the migration ledger,
   the `claim_advanced_vocab_rewrite_submission` RPC, the complete evidence
   deletion guard, and `/health/ready` before deploying application code.
   Migration 292 is the compatibility bridge for migration-first rollout: an
   old backend writer can continue answering while the new application is
   deploying, and historical Practice attempts receive canonical selections.
   Migration 293 makes each bank import/publication atomic with its canonical
   48 questions; a failed replacement leaves the previous bank revision and
   publication state unchanged.
2. Deploy backend and frontend from the same revision.
3. Load the target backend environment and run:

   ```bash
   backend/venv/bin/python backend/scripts/import_advanced_vocab_core30.py --commit
   ```

   The importer is idempotent and performs a post-write verification. Success
   ends with `HOÀN TẤT + VERIFY: 30 bank` and confirms 48 questions per bank.
   An unchanged package may be imported again. If a changed lesson checksum is
   detected after that bank has been assigned, the importer fails closed:
   publish the revision under a versioned bank/content path so existing frozen
   assignments remain reopenable.
4. After the new backend and frontend are healthy, preview the imported
   lessons, then explicitly open them for assignment:

   ```bash
   backend/venv/bin/python backend/scripts/import_advanced_vocab_core30.py \
     --commit --publish
   ```

   `--commit` by itself preserves an existing bank's publication state and
   never silently hides a released bank. `--publish` is the deliberate release
   control required before Admin can assign the banks.
5. In Admin → Classes → Bài tập, verify that `C5-ADV-T01` through
   `C5-ADV-T30` appear after the numbered course-session banks. They must show
   the self-paced/no-grade notice and must not show pass-threshold controls.

## Release smoke test

Use one test learner and one test class assignment:

1. Assign `C5-ADV-T01` and open it from My Class.
2. Confirm both audio buttons work on a vocabulary card.
3. Complete the 24 cards and both practice stages.
4. Confirm Reading passage and questions scroll independently.
5. Submit all 20 Controlled Rewrite answers once for batch grammar/style feedback,
   submit Listening, then
   open Writing and Speaking references.
6. Confirm the class item becomes submitted with `score = NULL` and
   `artifact_kind = advanced_vocab_progress`.
7. In Admin results, confirm six completed stages, each practice answer,
   Reading/Listening correct totals, and response/section timing are visible.
8. Reload both learner and admin pages. The state must remain identical.

Repeat the content-loading check with `C5-ADV-T30` before broad assignment to
cover the first and last bank boundaries.

## Operational constraints

- Do not set `lesson_no` on these banks. Numbered lesson slots belong to the
  canonical C5 course banks and are protected by a unique index.
- Although `is_published` marks these banks ready for assignment, they remain
  course content and are entered by learners only through an active class
  assignment; do not add them to a public catalog.
- Do not add Writing submission or Speaking grading to this runtime. A graded
  Writing task must continue to originate from a teacher assignment.
- Do not delete an assignment item after it has Advanced Vocabulary evidence;
  migration 281 deliberately blocks that data loss.
