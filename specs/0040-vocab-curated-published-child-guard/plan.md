# Implementation plan

## Architecture impact

- Database only: migration 355 runs `CREATE OR REPLACE FUNCTION` for
  `fn_guard_published_vocab_review()` (from 234) and
  `fn_guard_published_vocab_task()` (from 235). The triggers
  `trg_guard_published_vocab_review` and `trg_guard_published_vocab_task`
  (`BEFORE INSERT OR UPDATE OR DELETE`) keep pointing at the same functions and
  are not recreated. No table, data, grant, policy or RLS change.
- FastAPI and frontend: unchanged. The curated vocabulary service already
  surfaces the existing immutable errors.

## Data and contracts

- Guard rule after 355 (FR-001):
  - INSERT: check `NEW.version_id` (unchanged).
  - DELETE: check `OLD.version_id` (unchanged).
  - UPDATE: check `OLD.version_id` and `NEW.version_id`; if either version is
    `published`, raise the existing error (`published_vocab_review_is_immutable`
    or `published_vocab_task_is_immutable`).
- Both version rows are read `FOR SHARE`, as today, so a concurrent publish
  cannot slip between the check and the write.
- Function attributes stay the same: `LANGUAGE plpgsql`,
  `SET search_path = public, pg_temp`, same owner and grants.

## Rollout and rollback

- Staging first under the advisory lock (`rollout.md`); production only with
  the owner's approval at promotion.
- Rollback: the 355 down script restores the 234/235 function bodies. Safe at
  any time; no data is written.

## Verification strategy

- `backend/tests/test_vocab_curated_postgres.py`: the reparent cases
  (published review/task → draft version rejected, no row change) pass; every
  existing case keeps its result (draft edit/delete, publish, rollback,
  attempts, recommendations).
- `backend/tests/test_migration_355_vocab_curated_guard_reparent.py`: static
  contract (only the two functions replaced, no trigger/grant/data statement,
  down script present) and PostgreSQL apply/double apply.
- Staging: read-only catalog check that both function bodies match 355.
