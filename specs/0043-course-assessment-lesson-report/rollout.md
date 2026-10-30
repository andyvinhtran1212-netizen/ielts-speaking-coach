# Rollout and rollback

## Preconditions

- LESSONREPORT-0043 is approved (Vinh, 2026-10-30 17:20 UTC+7), and the spec-only PR has merged to `staging` with a merge commit.
- No migration and no feature flag. The routes are new and additive.
- T004 (importer meta) ships in the 0043 implementation PR. If PR #2062
  (importer `--scope/--kind final`) is still open then, T004 rebases after it,
  because both touch `import_course_assessment_bank.py`.
- Staging has **no active C1 class and no C1 final bank** (structure report
  P2-3). The rehearsal therefore needs QA fixtures, created on staging only by
  the QA job, never on production:
  - a QA class on staging C1 (`887e3566-7294-4d24-9f89-d3615e127d60`);
  - at least 4 QA learners, one of them unactivated;
  - the final JSON imported with the updated importer (dry-run, then
    `--commit`);
  - a second QA class owned by a QA instructor, for the IDOR checks.

## Staging

1. Merge to `staging` and deploy the exact SHA (Railway + Vercel preview).
   Backend and frontend CI must be green, and the OpenAPI contract test must
   pass.
2. Import the final on staging with the T004 importer. Read back `meta.lesson_map`
   (300 entries) and `meta.lesson_counts` (matching the dry-run "Phủ bài").
3. Give the bank to the QA class as `single_attempt`, with a short time limit
   and the whole class.
4. QA learners sit the exam with scripted, known answers:
   - L1 answers everything;
   - L2 answers 15 questions and times out;
   - L3 is still in progress;
   - L4 has no account.
5. Check the report (AC1–AC3):
   - the per-lesson sums equal each item `score`;
   - the states are correct;
   - the weak lessons match a hand calculation.
6. Source coverage: on staging, import three QA banks:
   - one with `meta.lesson_map`;
   - one shaped like the production final (`skill` `Bxx`, `item_key`
     `Buổi xx`, `dang` `A1`);
   - one with only `item_key` `Buổi N`.

   Check that `tag_sources` matches each bank (AC4a–AC4c).
7. Bank with no tags: give a QA midterm-format bank (skill `KHUNG-CAU`) and
   check `lesson_tags="none"` with the tab hidden (AC4).
8. IDOR: as the QA instructor, request the admin-owned QA
   class's assignment, and a mixed pair of ids. Both must return an identical
   404 (AC6). Learner tokens must be refused on both routes (AC7).
9. Timing: seed or simulate 30 learners × 300 answers on staging and record the
   p95 of 10 calls (FR-014).
10. Record MANUAL evidence in `verification.md`. Then clean up the QA
   fixtures, or keep them labelled as test data per `test_data_visibility`.

## Production

- Promote by exact SHA from `staging` → `main` only with anh Vinh's explicit
  authorisation, after the staging evidence above. There is no database step.
- The production final bank already exists. It was imported on 2026-10-30 at
  17:12 (UTC+7), with a bank id starting `590ce416`, before FR-002. **Do not
  re-import it.** FR-001 resolves its lessons from `skill` `Bxx`, with
  `item_key` `Buổi xx` as the fallback. If it has already been given, the bank
  is immutable.
- Post-deploy: an admin opens "Theo buổi" for the real C1 final assignment
  once learners have submitted. The check is read-only: the class sums must
  equal the tally scores. No production writes and no test data.

## Rollback and repair

- Revert the code. The new routes and the tab disappear. Nothing was written,
  so no data needs repair.
- The FR-002 meta keys on any newly imported bank are inert for older code and
  can stay.
- When `drift` is seen in production, do not "fix" the bank in place, because
  assigned banks are immutable. Raise a separate data-repair spec.

## Observability

- One structured log line per request:
  - `event=lesson_report`, with `assignment_id`, `cohort_id`, caller role,
    `as_instructor`;
  - `lesson_tags`, `revision_state`, `counted/assigned`, `stale`,
    `score_mismatch_count`, `duration_ms`.

  The line holds no names and no answers.
- A warning log on `stale`, `score_mismatch` or `drift`. Any `score_mismatch`
  or `drift` in production is a defect, and the Feature Developer owns its
  triage.
- 404s on the instructor route are logged with caller id only, so that
  probing can be seen.
