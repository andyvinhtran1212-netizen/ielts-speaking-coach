-- ACCOUNTDATA-0100 T002 (G04-T18). Account deletion requests, data export
-- jobs and the private account-exports bucket.
-- Number 500 is the spec label; GOI-04 assigns it to G04-T18 because the
-- G04 band 381-389 has no free number left.
-- No apply on merge: pending_feature account_data_rights. Staging first under
-- the advisory lock with MIGRATION_FEATURES=account_data_rights after review
-- and Andy's typed approval; production only at an authorised
-- staging-to-main promotion.
--
-- Both tables are RLS-enabled with no policy and no client grant: every read
-- and write goes through the FastAPI backend as service_role. Neither table
-- stores an email address. users rows are anonymised, never deleted (0055
-- commerce tables hold ON DELETE RESTRICT foreign keys to users), so both
-- foreign keys are ON DELETE RESTRICT too.
-- No append-only trigger is relaxed: credit_covered_requests is kept
-- (open question 6, Andy 2026-11-23 "Q6 giữ").
-- Re-runnable: IF NOT EXISTS / ON CONFLICT, postconditions at the end.
-- Rollback: rollback/500_account_data_rights.sql (only while both tables and
-- the bucket are empty).

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.account_deletion_requests (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    status                text NOT NULL DEFAULT 'pending'
                          CONSTRAINT account_deletion_requests_status
                          CHECK (status IN ('pending', 'cancelled', 'erasing', 'erased', 'failed')),
    requested_at          timestamptz NOT NULL DEFAULT now(),
    erase_after           timestamptz NOT NULL,
    cancelled_at          timestamptz,
    erasing_started_at    timestamptz,
    erased_at             timestamptz,
    erasing_owner         text CONSTRAINT account_deletion_requests_owner_length
                          CHECK (erasing_owner IS NULL OR char_length(erasing_owner) <= 120),
    lease_until           timestamptz,
    erased_notice_sent_at timestamptz,
    step_done             text CONSTRAINT account_deletion_requests_step_length
                          CHECK (step_done IS NULL OR char_length(step_done) <= 40),
    attempts              smallint NOT NULL DEFAULT 0
                          CONSTRAINT account_deletion_requests_attempts_nonneg CHECK (attempts >= 0),
    last_error_code       text CONSTRAINT account_deletion_requests_error_length
                          CHECK (last_error_code IS NULL OR char_length(last_error_code) <= 80),
    CONSTRAINT account_deletion_requests_window CHECK (erase_after >= requested_at),
    CONSTRAINT account_deletion_requests_cancelled_shape
        CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
    CONSTRAINT account_deletion_requests_erased_shape
        CHECK ((status = 'erased') = (erased_at IS NOT NULL)),
    CONSTRAINT account_deletion_requests_lease_shape
        CHECK (status <> 'erasing' OR (erasing_owner IS NOT NULL AND lease_until IS NOT NULL))
);

-- One open request per learner (FR-001: a second POST returns the open one).
CREATE UNIQUE INDEX IF NOT EXISTS account_deletion_requests_one_open
    ON public.account_deletion_requests (user_id)
    WHERE status IN ('pending', 'erasing');
CREATE INDEX IF NOT EXISTS account_deletion_requests_due
    ON public.account_deletion_requests (status, erase_after);
CREATE INDEX IF NOT EXISTS account_deletion_requests_lease
    ON public.account_deletion_requests (status, lease_until);

CREATE TABLE IF NOT EXISTS public.account_data_exports (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    status           text NOT NULL DEFAULT 'queued'
                     CONSTRAINT account_data_exports_status
                     CHECK (status IN ('queued', 'building', 'ready', 'failed', 'cancelled', 'expired', 'purged')),
    requested_at     timestamptz NOT NULL DEFAULT now(),
    started_at       timestamptz,
    ready_at         timestamptz,
    expires_at       timestamptz,
    export_owner     text CONSTRAINT account_data_exports_owner_length
                     CHECK (export_owner IS NULL OR char_length(export_owner) <= 120),
    claim_token      uuid,
    lease_until      timestamptz,
    object_path      text CONSTRAINT account_data_exports_object_path_shape
                     CHECK (object_path IS NULL
                            OR object_path ~ ('^' || user_id::text || '/' || id::text
                                              || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.zip$')),
    size_bytes       bigint CONSTRAINT account_data_exports_size_nonneg
                     CHECK (size_bytes IS NULL OR size_bytes >= 0),
    manifest_version text CONSTRAINT account_data_exports_manifest_length
                     CHECK (manifest_version IS NULL OR char_length(manifest_version) <= 40),
    last_error_code  text CONSTRAINT account_data_exports_error_length
                     CHECK (last_error_code IS NULL OR char_length(last_error_code) <= 80),
    CONSTRAINT account_data_exports_ready_shape
        CHECK (status <> 'ready' OR (ready_at IS NOT NULL AND expires_at IS NOT NULL
                                     AND object_path IS NOT NULL AND claim_token IS NOT NULL)),
    CONSTRAINT account_data_exports_building_shape
        CHECK (status <> 'building' OR (export_owner IS NOT NULL AND claim_token IS NOT NULL
                                        AND lease_until IS NOT NULL))
);

-- One running job per learner (FR-010: a second POST returns the running one).
CREATE UNIQUE INDEX IF NOT EXISTS account_data_exports_one_running
    ON public.account_data_exports (user_id)
    WHERE status IN ('queued', 'building');
CREATE INDEX IF NOT EXISTS account_data_exports_user_recent
    ON public.account_data_exports (user_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS account_data_exports_status_lease
    ON public.account_data_exports (status, lease_until);

ALTER TABLE public.account_deletion_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_data_exports ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.account_deletion_requests, public.account_data_exports
    FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE
    ON public.account_deletion_requests, public.account_data_exports
    TO service_role;

-- Private export bucket. 210 MiB = ACCOUNT_EXPORT_MAX_BYTES (200 MiB) plus
-- room for manifest and JSON; the backend enforces 200 MiB before upload.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('account-exports', 'account-exports', false, 220200960, ARRAY['application/zip'])
ON CONFLICT (id) DO UPDATE
    SET public = false,
        file_size_limit = EXCLUDED.file_size_limit,
        allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Fail-closed guard: a RESTRICTIVE policy is ANDed with every permissive
-- policy, so no client policy on storage.objects can reach this bucket.
-- service_role bypasses RLS and keeps backend access; downloads go out only
-- as 60-second signed URLs after the backend checks ownership (FR-012).
DROP POLICY IF EXISTS account_exports_backend_only ON storage.objects;
CREATE POLICY account_exports_backend_only ON storage.objects
    AS RESTRICTIVE FOR ALL TO PUBLIC
    USING (bucket_id IS DISTINCT FROM 'account-exports')
    WITH CHECK (bucket_id IS DISTINCT FROM 'account-exports');

DO $$
DECLARE
    tbl regclass;
    privilege text;
    role_name text;
BEGIN
    FOREACH tbl IN ARRAY ARRAY[
        'public.account_deletion_requests'::regclass, 'public.account_data_exports'::regclass
    ] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid = tbl AND relrowsecurity)
           OR EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = tbl)
           OR EXISTS (SELECT 1 FROM pg_catalog.pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
                       WHERE c.oid = tbl AND a.grantee <> c.relowner
                         AND (a.grantee <> 'service_role'::regrole OR a.is_grantable)) THEN
            RAISE EXCEPTION USING ERRCODE = '55000',
                MESSAGE = format('500 account data table RLS, policy or grant postcondition failed: %s', tbl);
        END IF;
        FOREACH privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
            IF has_table_privilege('service_role', tbl, privilege)
               IS DISTINCT FROM (privilege IN ('SELECT','INSERT','UPDATE','DELETE')) THEN
                RAISE EXCEPTION USING ERRCODE = '55000',
                    MESSAGE = format('500 service role access is incorrect: %s %s', tbl, privilege);
            END IF;
            FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
                IF has_table_privilege(role_name, tbl, privilege) THEN
                    RAISE EXCEPTION USING ERRCODE = '55000',
                        MESSAGE = format('500 browser role has account data access: %s %s %s', role_name, tbl, privilege);
                END IF;
            END LOOP;
        END LOOP;
    END LOOP;

    IF NOT EXISTS (
        SELECT 1 FROM storage.buckets
         WHERE id = 'account-exports' AND public = false
           AND file_size_limit = 220200960
           AND allowed_mime_types = ARRAY['application/zip']
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '500 account-exports bucket postcondition failed';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_policy p
         WHERE p.polrelid = 'storage.objects'::regclass AND p.polname = 'account_exports_backend_only'
           AND NOT p.polpermissive AND p.polcmd = '*' AND p.polroles = ARRAY[0::oid]
           AND pg_get_expr(p.polqual, p.polrelid) LIKE '%IS DISTINCT FROM%account-exports%'
           AND pg_get_expr(p.polwithcheck, p.polrelid) LIKE '%IS DISTINCT FROM%account-exports%'
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '500 account-exports restrictive storage guard missing';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_policies
         WHERE schemaname = 'storage' AND tablename = 'objects' AND permissive = 'PERMISSIVE'
           AND (coalesce(qual, '') || ' ' || coalesce(with_check, '')) LIKE '%account-exports%'
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '500 a permissive storage.objects policy names account-exports';
    END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
