-- STORAGELIMITS-0038 / PC-J522: BUCKET50 a, Vinh t1246u 02/11 06:37.
-- 343 is already applied on staging (2026-11-02 01:51:21Z); keep it immutable.
-- Align listening-audio with the staging project cap: 52,428,800 bytes.
-- Only file_size_limit changes; MIME types, visibility and objects stay intact.
-- No apply on merge. Leader applies staging through the advisory-locked runner
-- with MIGRATION_FEATURES=storage_bucket_limits. Production is not authorized.
--
-- Read-only postcheck:
-- SELECT id, file_size_limit, allowed_mime_types, public FROM storage.buckets
-- WHERE id = 'listening-audio';
--
-- DOWN BEGIN (historical 343 value; manual emergency rollback under same lock):
-- BEGIN;
-- SET LOCAL lock_timeout = '5s';
-- UPDATE storage.buckets SET file_size_limit = 134217728
-- WHERE id = 'listening-audio';
-- COMMIT;
-- DOWN END

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $migration$
BEGIN
    PERFORM id FROM storage.buckets
    WHERE id = 'listening-audio' FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'listening_audio_limit_missing_bucket';
    END IF;

    UPDATE storage.buckets SET file_size_limit = 52428800
    WHERE id = 'listening-audio';

    IF NOT EXISTS (
        SELECT 1 FROM storage.buckets
        WHERE id = 'listening-audio' AND file_size_limit = 52428800
    ) THEN
        RAISE EXCEPTION 'listening_audio_limit_postcondition_failed';
    END IF;
END;
$migration$;

COMMIT;
