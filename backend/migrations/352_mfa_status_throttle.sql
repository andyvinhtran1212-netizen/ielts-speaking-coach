-- ADMINAAL2-0032 FR-010/FR-011, PC-J201 (SA #1936 P3 c-e).
-- Apply on staging before the backend. One row per caller: successful-pass
-- cooldown, at most six rolling-minute attempts, and a bounded in-flight lease.
-- The backend serializes short admission transactions with a transaction-level
-- advisory lock; no database lock is held during the Auth request.
-- Old backends ignore this table. Without it the new backend logs and skips
-- the caller sweep; the cron still audits every account. No Auth data changes.
-- Forward policy: pending_feature, group mfa_status_throttle. Apply only with
-- explicit authorization, staging first through the advisory-locked runner
-- with MIGRATION_FEATURES=mfa_status_throttle, before deploying PC-J201.
-- Production requires its own authorized staging -> main promotion.
-- One transaction, additive, re-runnable; no existing data is changed.
-- Postcondition: RLS enabled, no policies, and no client/service-role grants.
-- Rollback: deploy the pre-PC-J201 backend first, then use a new forward
-- migration containing:
--   BEGIN;
--   SET LOCAL lock_timeout = '5s';
--   DROP TABLE IF EXISTS public.staff_mfa_status_throttle;
--   COMMIT;
-- This discards only operational cooldown/attempt/lease state; security audit,
-- factor snapshots, alert history and Auth data remain untouched.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.staff_mfa_status_throttle (
    user_id uuid PRIMARY KEY,
    last_success_at timestamptz,
    factor_state jsonb,
    attempts timestamptz[] NOT NULL DEFAULT '{}',
    lease_id uuid,
    in_flight_until timestamptz,
    CHECK (cardinality(attempts) <= 6),
    CHECK ((lease_id IS NULL) = (in_flight_until IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_staff_mfa_status_in_flight
    ON public.staff_mfa_status_throttle (in_flight_until)
    WHERE in_flight_until IS NOT NULL;
ALTER TABLE public.staff_mfa_status_throttle ENABLE ROW LEVEL SECURITY;
-- Only the direct DATABASE_URL owner connection uses this operational state.
REVOKE ALL ON public.staff_mfa_status_throttle
    FROM PUBLIC, anon, authenticated, service_role;

DO $$
DECLARE
    v_role text;
    v_privilege text;
BEGIN
    IF NOT (SELECT relrowsecurity FROM pg_class
             WHERE oid = 'public.staff_mfa_status_throttle'::regclass)
       OR EXISTS (SELECT 1 FROM pg_policy
                   WHERE polrelid = 'public.staff_mfa_status_throttle'::regclass) THEN
        RAISE EXCEPTION 'mfa_status_throttle_not_private';
    END IF;
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
        FOREACH v_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] LOOP
            IF has_table_privilege(v_role, 'public.staff_mfa_status_throttle', v_privilege) THEN
                RAISE EXCEPTION 'mfa_status_throttle_unexpected_grant: % %', v_role, v_privilege;
            END IF;
        END LOOP;
    END LOOP;
END $$;

COMMIT;
