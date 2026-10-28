# Implementation plan

## Architecture impact

- Database only: new `backend/migrations/321_writing_grade_ratings_feedback_version.sql`
  plus the 321 paragraph and next-number update in `backend/migrations/README.md`
  (PR #1727). `forward-policy.tsv` is unchanged; 321 is a normal forward
  migration.
- Backend: none. `essay_service.get_grade_rating` / `upsert_grade_rating`
  already key on `(essay_id, feedback_version)`.
- Frontend: none.

## Data and contracts

- Target shape (revised 116): `feedback_version int NOT NULL` and
  `writing_grade_ratings_essay_id_feedback_version_key UNIQUE (essay_id, feedback_version)`.
  No `UNIQUE (essay_id)`.
- Backfill source: `writing_essays.current_version` (migration 109,
  `NOT NULL DEFAULT 1`). `writing_feedback_current` joins on
  `wf.version = e.current_version`, and that is the version the service stores.
- Constraint matching uses `conrelid` + `conkey`, not names. The postcondition
  also inspects `pg_index` for standalone unique indexes.
- RLS stays enabled with no policy (service_role only). No grants (320).
- Hosted row count is 0 on both environments (2026-10-26). The `ALTER TABLE`
  lock is brief.

## UI and interaction

- No UI change. The admin grade-quality rating starts working once the schema
  matches; see [ui-states.md](ui-states.md).

## Work decomposition

1. Owner approves this spec on `staging` (separate change).
2. #1727 cites `WRITINGRATE-0025` as `high-risk` with requirement coverage. CI
   green.
3. Apply 321 to staging with the locked runner. Verify, then merge #1727.
4. Apply 321 to production with the locked runner at release. Promote.

## Rollout and rollback

- See [rollout.md](rollout.md). Rollback is a manual three-statement SQL. It
  is valid only while no essay has ratings for two runs, and it brings the 42703
  back with the current backend.

## Verification strategy

- #1727's `backend/tests/test_migration_321_writing_grade_ratings_feedback_version.py`:
  4 static contract tests and 6 real-PostgreSQL tests (`REQUIRE_PG=1`), run on
  PostgreSQL 16 and 17.
- Neighbouring guards: `test_migration_forward_policy.py`,
  `test_migrations_rls.py`, `test_composed_insert_notnull.py`.
- Read-only shape queries and one admin rating round trip on staging, then the
  same shape queries on production.
