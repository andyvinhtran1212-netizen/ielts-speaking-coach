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

## Rollback and repair

- Rollback: `DROP TRIGGER IF EXISTS update_<table>_updated_at ON public.<table>`
  for the five tables (in the 338 header). Safe at any time; `updated_at` stops
  advancing again. No data to repair; advanced `updated_at` values are correct
  timestamps.
- Frontend: revert the form commit; no data involved.

## Observability

- `mock_correction_release_events` remains the audit trail for policy changes;
  `updated_at` now agrees with its latest event for each paper.
- FastAPI logs: any 409/500 from Listening editor saves mentioning a stale
  `expected_updated_at` after apply would indicate an editor holding an old
  token (expected only for genuinely concurrent edits).
- Owner: product owner; the implementing agent reports T005 on the PR.
