-- Schema rollback of 500 (ACCOUNTDATA-0100), only while it holds nothing.
-- Refuses while either table has a row or account-exports has an object:
-- a deletion request is the learner's recorded choice and an erased row is
-- the evidence that erasure ran, so neither may be dropped silently. With
-- data present, keep the schema and turn the feature off instead
-- (ACCOUNT_ERASURE_ENABLED=false, hide the routes). Delete account-exports
-- objects through the Storage API first; a direct DELETE on storage.objects
-- leaves the files behind.
BEGIN;
SET LOCAL lock_timeout = '5s';

LOCK TABLE public.account_data_exports, public.account_deletion_requests IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.account_deletion_requests) THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'account_deletion_requests has rows; keep schema and turn the feature off';
    END IF;
    IF EXISTS (SELECT 1 FROM public.account_data_exports) THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'account_data_exports has rows; keep schema and turn the feature off';
    END IF;
    IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'account-exports') THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'account-exports still has objects; delete them through Storage first';
    END IF;
END;
$$;

DROP TABLE public.account_data_exports;
DROP TABLE public.account_deletion_requests;
DROP POLICY IF EXISTS account_exports_backend_only ON storage.objects;
DELETE FROM storage.buckets WHERE id = 'account-exports';

DO $$
BEGIN
    IF to_regclass('public.account_deletion_requests') IS NOT NULL
       OR to_regclass('public.account_data_exports') IS NOT NULL
       OR EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'account-exports') THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = '500 rollback postcondition failed';
    END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
