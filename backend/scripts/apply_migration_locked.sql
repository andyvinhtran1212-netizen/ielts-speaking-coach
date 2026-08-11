\set ON_ERROR_STOP on

-- Shared with reconcile_prod_gate_e_migrations.py. This is a session-level
-- lock rather than a transaction lock because several historical migrations
-- intentionally contain their own transactions or CREATE INDEX CONCURRENTLY.
SELECT pg_advisory_lock(173204, 1) AS migration_lock_acquired \gset

-- Never trust a ledger snapshot taken before the lock. A production
-- reconciliation may have verified and recorded this file while this forward
-- runner was queued.
SELECT EXISTS (
    SELECT 1
      FROM public._schema_migrations
     WHERE filename = :'MIGRATION_NAME'
) AS migration_already_applied \gset

\if :migration_already_applied
    SELECT pg_advisory_unlock(173204, 1) AS migration_lock_released \gset
    \echo __apply_migration_status__=skipped
    \quit
\endif

\if :DRY_RUN
    \echo would apply: :MIGRATION_NAME
    SELECT pg_advisory_unlock(173204, 1) AS migration_lock_released \gset
    \echo __apply_migration_status__=would-apply
    \quit
\endif

\if :BASELINE
    INSERT INTO public._schema_migrations (filename)
    VALUES (:'MIGRATION_NAME')
    ON CONFLICT (filename) DO NOTHING;
    \echo baseline: :MIGRATION_NAME
\else
    \echo == :MIGRATION_NAME
    \i :MIGRATION_PATH
    INSERT INTO public._schema_migrations (filename)
    VALUES (:'MIGRATION_NAME')
    ON CONFLICT (filename) DO NOTHING;
\endif

SELECT pg_advisory_unlock(173204, 1) AS migration_lock_released \gset
\echo __apply_migration_status__=processed
