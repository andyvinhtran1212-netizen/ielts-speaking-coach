# Implementation plan

## Architecture impact

- Database: migration 338 creates `update_<table>_updated_at` BEFORE UPDATE
  row triggers calling `public.update_updated_at_column()` on `reading_tests`,
  `listening_tests`, `reading_passages`, `reading_questions` and
  `listening_content`. PostgreSQL fires same-timing row triggers in name order,
  so `trg_mock_paper_policy`, `trg_mock_paper_source` and
  `trg_protect_listening_package_child` run first and see the writer's row; all
  of them already ignore or allow-list `updated_at`.
- Database (FR-008): migration NNN (Leader cấp số, after 353) replaces
  `fn_guard_mock_paper_source` so a child INSERT/UPDATE under
  `app.listening_package_import` for the never-published, attempt-free package
  being imported skips the parent `mock_content_revision` UPDATE, the UPDATE
  that `fn_protect_listening_package_child` refuses during import. 295, 306 and
  353 files are not edited.
- Frontend: `exam-create-form.tsx` renders `PUBLIC_SOURCE_HIDE_WARNING` under a
  Listening/Reading picker whose selected row has `is_public: true`; one CSS
  rule in `admin-mock-exams-next.css`.
- FastAPI is unchanged.

## Data and contracts

- No row is written by the migration; no column, grant or function changes.
- After apply, any UPDATE on the five tables returns the new `updated_at`.
- API and OpenAPI contract: unchanged; the picker already returns `is_public`.

## UI and interaction

- See `ui-states.md`. The warning appears on selection and disappears when the
  picker is cleared or a private source is chosen.

## Rollout and rollback

- Staging first under the advisory lock, production at promotion
  (`rollout.md`). Order with code is free.
- Rollback: drop the five triggers (statement in the 338 header).
- FR-008 / migration NNN: rollback re-installs the 353 body from
  `rollback/NNN_*.sql`; new-package import fails with 55000 again, no row
  changes (papers imported meanwhile keep revision 0, correct for
  never-published packages). Staging first; production only through a normal
  promote whose scope Vinh approves.

## Verification strategy

- `backend/tests/test_migration_338_paper_updated_at_triggers.py`: static
  contract plus PostgreSQL on the 306/315/316 fixture: `updated_at` advances on
  visibility flips, raw updates, explicit stale values and child edits;
  `policy_revision`, release events and `mock_content_revision` behave as
  before; the Mock Test copy hides the source and advances its `updated_at`;
  double apply; precondition and postcondition failures.
- `frontend/tests/react/mock-public-source-hide-warning.test.tsx` and the
  existing `mock-private-draft-create.test.tsx`.
- FR-008: local PostgreSQL 17 (and 16) test importing a new package through
  the real 295 RPC with 306, 353 and NNN active, plus the negative cases in
  T010; staging read-only SELECT by WM after apply (T011).
