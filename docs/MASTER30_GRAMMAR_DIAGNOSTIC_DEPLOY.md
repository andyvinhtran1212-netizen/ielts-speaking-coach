# MASTER30 Grammar Diagnostic — deploy contract

## Product truth

- Quick: 18 baseline + 10 focused confirmation = hard stop 28 objective items.
- Full: 34 baseline + 20 focused confirmation = hard stop 54 objective items.
- Maximum six objective items per M01–M14 attribute in one session.
- Objective responses are scored on the server and reported immediately.
- Reports are Grammar Readiness Profiles. They are not IELTS band predictions and the active release remains `live_calibrated_ready=false` until field calibration is complete.
- The 19 productive tasks are imported with `auto_scoring_enabled=false`. They are outside the diagnostic critical path and only receive a score through a separate teacher-assigned/reviewed workflow.

## Release order

1. Apply `backend/migrations/283_master30_grammar_diagnostic.sql`.
2. Validate and import the approved package into a non-active release:

   ```bash
   cd backend
   venv/bin/python scripts/import_master30_grammar.py \
     --package "/absolute/path/to/MASTER30-DIAGNOSTIC/web-upload" --apply
   ```

3. Run API and browser smoke checks while the runtime flag remains off.
4. Promote the validated release (rerunning the same manifest is idempotent):

   ```bash
   venv/bin/python scripts/import_master30_grammar.py \
     --package "/absolute/path/to/MASTER30-DIAGNOSTIC/web-upload" --apply --promote
   ```

5. Enable runtime flag `master30_grammar_diagnostic` through the existing admin runtime-flag control.
6. Keep `master30_grammar_self_serve=false` for the assigned-only beta.
7. Verify assigned Quick, assigned Full pause/resume, learner report, and educator report.

Public/self-serve launch is a separate gate. It requires a specific review and
then enabling `master30_grammar_self_serve`; it is not coupled to the assigned
beta release.

## Rollback

- Disable `master30_grammar_diagnostic` first. This blocks new session mutations without destroying evidence.
- Keep the release and session rows intact for audit/recovery.
- If content rollback is needed, validate and promote the prior immutable release; promotion retires the current active release transactionally.
- Frontend rollback is independent because the runtime flag keeps the new API closed.

## Required smoke assertions

- No pre-submit response contains `correct_index`, explanations, misconception codes, or correctness.
- Retrying the same immutable answer returns canonical progress; only a retry
  with a different option or assistance flag returns conflict. Neither path
  creates another response or moves exposure history.
- A completed class assignment has `artifact_kind=grammar_diagnostic`, `score=NULL`, and an educator report accessible to admin.
- General mode never serves Academic-only items.
- A second session excludes prior item IDs, stimulus families, and parallel sets; unreadable exposure history fails closed.
