# PC-J173 — ILR-RDG-001 Q20/Q21 display repair

Status: local rehearsal and staging transaction-ROLLBACK rehearsal passed.
**Staging COMMIT is pending explicit CM OK recorded in
`/workspace/cc-jobs/handoff/content-manager/20261029-PC-J173-q20-q21-staging-confirmation.md`.**
Production apply and rollback are DRAFT, with an unconditional exception before
any content operation. No production connection or write was made by this job.
No PR merge is authorized.

## Audit and provenance

- **Root cause:** in CM's production export, original Q20 has the Q21 stem
  (`elevated 21 ____`) and Q21 solution while its answer remains `zooxanthellae`.
  Q21 has `Câu 21` and only `{"band": 6.5}` as its solution, with the correct
  `sea temperature` answer. The persisted display fields disagree with the keys.
  This audit identifies the data defect; it does not establish which historical
  authoring/import operation introduced it.
- **Severity:** Medium / P2. The summary template binds inputs by `{{20}}` and
  `{{21}}`, so this is a review-content defect, not a scoring change.
- **Impacted locations:** `public.reading_questions` Q20/Q21 below;
  `backend/routers/reading_student.py:_assemble_reading_review` (around 1654–1704)
  joins `payload.solution` by question number and builds the stepper;
  `frontend/lib/reading-review-model.mjs:readingReviewPrompt` (around 200–206)
  uses `solution.question_text` when the prompt is `(see summary above)`.
- **Minimal fix:** update only `prompt`, `explanation`, and `payload.solution`
  from the matching CM REV02 questions. Preserve all keys/alternatives,
  template, instruction, word limit, visibility and other question fields.
  No application code, schema, attempts, snapshots, scores or regrading change.
- **CM source:** `/workspace/cc-jobs/handoff/content-manager/20261029-PC-J110-gioi-han-tu-mac-dinh.md`,
  “CM trả lời (29/10 16:50, UTC+7)”, §9; supporting evidence:
  `/workspace/qa/pcj110/s9-ilr-rdg-001-q19-22-evidence.txt`.
- **Production DRAFT input:** existing CM read-only export
  `/workspace/cc-jobs/handoff/content-manager/prod-export-0129/ILR-RDG-001.json`,
  exported `2026-10-28T19:22:57.098304+00:00`. This is historical evidence, not
  a current live-production verification. RM must read back live rows before
  an approved production run. The md5 guards abort if those rows have changed.

## Environment-specific scope

Read-only staging inspection at `2026-10-29T15:32:32.398328+00:00` found **no
original `ILR-RDG-001`**. Do not import or manufacture that production paper in
staging. The existing staging papers are:

| Role | Paper | Paper UUID | State |
| --- | --- | --- | --- |
| Staging target | `MOCK0016-20261005-ILR001-REV01` | `97d1ed4f-bcba-4ccf-a0ef-1c943ca6410b` | published, private, exam_only |
| Staging source | `MOCK0016-20261006-ILR001-REV02` | `cc548c72-11c1-4798-83be-ffaa8db55423` | draft |
| Production target (DRAFT) | `ILR-RDG-001` | `94254aa9-da65-4222-83c1-1f3cf5c12609` | published in CM export |
| Production source (DRAFT) | `MOCK0016-PROD-20261006-ILR-RDG-001-REV02` | `cc548c72-11c1-4798-83be-ffaa8db55423` | published in CM export |

| Operation | Q | Target UUID | Before | After |
| --- | --- | --- | --- | --- |
| Staging guard, no write | 20 | `802e3eef-1ba7-4ec8-b4e8-c73b8014d78a` | Already matches staging REV02 | Unchanged |
| Staging apply, pending CM | 21 | `a8939a91-9b3e-4e8b-a795-a5df8c12a9ca` | Placeholder prompt; empty explanation; band-only solution | Same placeholder prompt; full REV02 Q21 explanation/solution |
| Production DRAFT | 20 | `133c885d-88f6-4796-964d-3b62384aea6f` | Q21 prompt/solution; empty explanation | Placeholder prompt; full REV02 Q20 explanation/solution |
| Production DRAFT | 21 | `ecc47dd2-8864-415b-a52a-727d1b9d3c46` | `Câu 21`; empty explanation; band-only solution | Placeholder prompt; full REV02 Q21 explanation/solution |

REV02 source question UUIDs are `c1f98c5c-35c9-4762-8456-7803bd27571b`
(Q20) and `e3ac5635-b2ec-4793-9001-95e5611c5191` (Q21). The selected
`prompt`, `explanation`, and `payload.solution` in staging REV02 independently
match CM's exported production REV02. **Every staging literal came from the
staging query, never the production export.** No production row was copied into
local PG or staging, including during rehearsal.

## Files and safety contract

- `staging-apply.sql`: one-row repair; `staging-rollback.sql`: inverse repair.
- `staging-readback.sql`: read-only paper/question inventory and digests.
- `prod-apply.DRAFT.sql` / `prod-rollback.DRAFT.sql`: two-row draft pair;
  the first executable block always raises `PC-J173 PROD DRAFT`.
- `SHA256SUMS`: immutable SQL-file checksums. Verify from this directory with
  `sha256sum -c SHA256SUMS` before executing any request.

All mutation files use one transaction, UTC timestamp serialization, bounded
lock/statement timeouts, and the existing paper advisory lock. They pin the
paper UUID **and** code, published/private/exam-only state, passage 2, question
UUIDs/numbers and full-row md5 excluding only `updated_at`. Source REV02 rows
and staging Q20 are also pinned. All preconditions run before the first update.

Postconditions compare every question in the target paper with the pre-write
snapshot plus the exact expected changes, including all answers and templates.
Paper policy/visibility fields must stay identical; its content revision may
advance through normal triggers. Reapply and repeat rollback deliberately fail
closed. Do not bypass a failed guard: inspect read-only and reconcile first.

Rollback restores the exact prior display content and leaves normal triggers
enabled. It does not rewind `updated_at` or `mock_content_revision`. Historical
mock attempt snapshots and persisted submission-time explanations stay pinned;
this repair does not rewrite old attempts. Retest a fresh authorized preview or
new mock attempt after apply, rather than expecting an old snapshot to change.

## Verification evidence (2026-10-29)

Job evidence directory:
`/workspace/cc-jobs/job-q-19r-pc-j173-ilr-rdg-001-q20-q21.log.d/`.
All requests that write, including transaction-ROLLBACK requests, have exact
saved SQL/JSON plus paired SENDING/RESULT lines in the adjacent job log.

1. **Local PostgreSQL 17:** `local-verification.result` ends with
   `LOCAL PG17 REHEARSAL PASS`. Staging snapshots exercised apply, rollback,
   dry-run preservation, repeated-run rejection, answer/source drift rejection,
   forbidden-answer-write rejection and wrong-paper rejection. The two-row
   production algorithm used entirely synthetic fixtures, including second-row
   drift/atomicity and the unconditional DRAFT gate. Migration 306's real
   source-trigger body was exercised with a local admission-activation stub.
2. **Live staging dry-run:** saved `staging-dry-run.sql` is byte-for-byte
   `staging-apply.sql` except its final `COMMIT;` is replaced by `ROLLBACK;`.
   `staging-dry-run.request.json.result` returned HTTP success (`[]`); every
   internal pre/postcondition passed. This was a rehearsal, not an apply.
3. **Read-only rollback proof:** `staging-before-dry-run.json` at
   `15:37:41.960323Z` and `staging-after-dry-run.json` at `15:38:11.084269Z`
   have identical paper records, question/answer digests and Q19–Q22 rows:

   | Staging paper | Questions | Revision | All-question md5 | Answer md5 |
   | --- | --- | --- | --- | --- |
   | REV01 | 40 | 44 | `045da932835c040478f140a8e4546785` | `a0d5c8d5f424059f645e11df17c5a589` |
   | REV02 | 40 | 45 | `672430b38ab576153bf503613b2c071b` | `7e529398ed3f36980294534968bc990a` |

4. **Rendering contract:** the existing frontend review-model suite passed
   19 tests, including placeholder-to-`solution.question_text` rendering.
   Backend solution/depth/review suites passed 35 tests.
   CM's visible-content retest remains pending after a permitted staging apply.

## Apply / retest handoff

1. CM must explicitly confirm the **staging REV01 Q21** target above in the
   named handoff. J110's production correction direction establishes content
   provenance; it is not a recorded approval for this different staging paper.
2. After recorded CM OK, verify `SHA256SUMS`, run `staging-readback.sql`, and
   compare the pinned rows. Save the exact apply request to the job evidence
   directory. Append SENDING before sending to **staging project
   `zjphffoujxkpltixsbzj`**; redirect output to a result file and append RESULT
   immediately afterward, as required by the job rules. Never retry an unclear
   result without read-only reconciliation.
3. Send `staging-apply.sql` without edits, then run `staging-readback.sql` again.
   Confirm one Q21 row changed, Q20/Q19/Q22 and all answers/templates stayed
   identical, and REV02 stayed unchanged. If rollback is authorized, use only
   `staging-rollback.sql` against the exact applied state with the same logging.
4. CM retests a fresh preview/new staging mock: Q20 asks for the microscopic
   algae and explains **zooxanthellae / paragraph A**; Q21 asks about elevated
   pressure and explains **sea temperature / paragraph B**. Both keep their
   original answers/alternatives. Record CM's result in the handoff.
5. RM keeps production SQL DRAFT until **Vinh's direct approval** at promotion.
   Recheck live original + REV02 rows read-only, review any drift, prepare new
   runnable copies that remove only the unconditional DRAFT exception, record
   their new SHA256 and approval, and execute solely in the approved release.
   Neither these production drafts nor the staging apply run automatically
   when this PR is merged.
