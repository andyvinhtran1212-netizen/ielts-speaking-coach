# Rollout and rollback

## Preconditions

- PAPERUPDATEDAT-0037 approved on `staging`.
- Migrations 033/108 (`public.update_updated_at_column()`), 306
  (`trg_mock_paper_policy`) and 208 (`trg_listening_exercises_updated_at`)
  applied; 338 aborts otherwise.
- No long transaction on the five tables: each `CREATE TRIGGER` takes a brief
  `SHARE ROW EXCLUSIVE` lock under `lock_timeout = 5s`; on timeout re-run
  off-peak (the file is re-runnable).

## Staging

1. The Leader applies 338 with the advisory-locked runner.
2. Run the read-only catalog query in the 338 header: five rows, enabled.
3. Toggle visibility on a QA Reading paper (not a learner-facing one) and back;
   `updated_at` advances and two release events are written.
4. Frontend: pick a public source on `/admin/mock-exams` and see the warning
   (do not save unless using a QA source).

## Production

With the owner's explicit authorization at the `staging` → `main` promotion:
apply 338 under the advisory lock, then run the catalog query read-only. No
production write probes.

## FR-008 (migration NNN, ticket PC-J562)

1. Preconditions: #2204 (353) merged and applied on the target; this amendment
   merged into `staging`.
2. Staging: the Leader applies NNN under the advisory lock; WM imports one new
   QA Listening package (`import_listening_source_collection.py`), then runs a
   read-only SELECT: `mock_content_revision` of that package's tests is 0 and
   the trigger function catalog matches; publish/archive a QA package as in
   FR-006/FR-007.
3. Production: only through a normal promote whose scope Vinh approves; apply
   under the advisory lock and run the catalog check read-only. No production
   import as a probe.

## Rollback and repair

- Rollback: `DROP TRIGGER IF EXISTS update_<table>_updated_at ON public.<table>`
  for the five tables (in the 338 header). Safe at any time; `updated_at` stops
  advancing again. No data to repair; advanced `updated_at` values are correct
  timestamps.
- Frontend: revert the form commit; no data involved.
- NNN: run `rollback/NNN_*.sql` (restores the 353 `fn_guard_mock_paper_source`).
  No data to repair; new-package import fails with 55000 again until re-applied.

## Observability

- `mock_correction_release_events` remains the audit trail for policy changes;
  `updated_at` now agrees with its latest event for each paper.
- FastAPI logs: any 409/500 from Listening editor saves mentioning a stale
  `expected_updated_at` after apply would indicate an editor holding an old
  token (expected only for genuinely concurrent edits).
- Owner: product owner; the implementing agent reports T005 on the PR.
