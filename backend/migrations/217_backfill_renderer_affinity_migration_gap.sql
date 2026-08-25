-- Migration: 217_backfill_renderer_affinity_migration_gap.sql
--
-- The forward runner commits each migration separately. A Legacy/N-1 request
-- could therefore insert a NULL-affinity session after migration 215's one-time
-- backfill committed but before migration 216 established the Legacy default.
-- Migration 216 prevents any further unversioned NULL inserts; repair the rows
-- that could have landed in that bounded gap before the affinity-aware backend
-- is deployed and begins calling the v3 create RPC intentionally with NULL.

UPDATE public.sessions
   SET renderer_affinity = 'legacy'
 WHERE renderer_affinity IS NULL;
