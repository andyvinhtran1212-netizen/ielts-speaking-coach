# Rollout and rollback

## Preconditions

- The owner (Vinh) has approved this spec and the approval is on `staging`.
  **Not yet: approval is pending.**
- #1727 cites `WRITINGRATE-0025` as `high-risk` and is green.
- 321 is still the next free migration number on `staging`. Draft #1720 also
  proposes a 321 file and renumbers when it is re-created; 321 stays with #1727.
- No database write is part of this spec change.

## Staging

1. Dry-run, then apply 321 with the advisory-locked runner
   (`backend/scripts/apply_migrations.sh` / `apply_migration_locked.sql`).
2. Read-only verification:

   ```sql
   SELECT attname, attnotnull, format_type(atttypid, atttypmod) FROM pg_attribute
    WHERE attrelid = 'public.writing_grade_ratings'::regclass AND attname = 'feedback_version';
   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
    WHERE conrelid = 'public.writing_grade_ratings'::regclass AND contype = 'u';
   -- expect: feedback_version | t | integer
   --         writing_grade_ratings_essay_id_feedback_version_key | UNIQUE (essay_id, feedback_version)
   ```

3. Rate a graded essay on the staging admin grade page and reload. The stars
   persist and the backend logs show no 42703.
4. Merge #1727. Confirm integrated staging CI on the merged SHA.

## Production

1. At release, apply 321 to production with the advisory-locked runner, before
   or with the staging → main promotion.
2. Run the same read-only queries. Expect the same result.
3. Promote through the exact-SHA gate.

## Rollback and repair

The migration is atomic. Any failure, including the postcondition, rolls back
and leaves no ledger row. Manual rollback is valid only while no essay has
ratings for two runs:

```sql
ALTER TABLE public.writing_grade_ratings DROP CONSTRAINT IF EXISTS writing_grade_ratings_essay_id_feedback_version_key;
ALTER TABLE public.writing_grade_ratings ADD CONSTRAINT writing_grade_ratings_essay_id_key UNIQUE (essay_id);
ALTER TABLE public.writing_grade_ratings DROP COLUMN IF EXISTS feedback_version;
```

Rolling back brings the 42703 back with the current backend. Fixing forward is
preferred.

## Observability

- Backend logs: no `42703 … writing_grade_ratings.feedback_version` after
  apply.
- Postcondition exception names (`writing_grade_ratings_feedback_version_missing`,
  `…_not_integer`, `…_nullable`, `…_single_essay_unique_survives`,
  `…_essay_feedback_version_unique_missing`) identify any failed apply.
- The `_schema_migrations` ledger shows 321 on staging before production.
