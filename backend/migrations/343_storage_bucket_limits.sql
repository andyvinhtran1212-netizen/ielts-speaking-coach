-- STORAGELIMITS-0038 / PC-J133R. Leader-reserved migration 343.
-- T001 (2026-10-29): all six staging buckets had NULL / NULL limits.
-- Deploy upload prechecks/normalisation first; Leader applies through the
-- advisory-locked runner with MIGRATION_FEATURES=storage_bucket_limits.
-- No apply on merge. Production census/apply requires Vinh's separate
-- authorization at promotion; if pre-apply values differ, amend rollback first.
-- The project-wide limit still bounds these bucket limits (staging: 50 MiB).
-- No visibility changes; objects and unrelated buckets are untouched.
--
-- Read-only postcheck (compare all six rows with the T001 final limit table):
-- SELECT id, file_size_limit, allowed_mime_types, public FROM storage.buckets
-- WHERE id IN ('audio-responses', 'listening-audio', 'listening-images',
--              'reading-images', 'writing-images', 'vocab-audio') ORDER BY id;
--
-- DOWN BEGIN (staging T001 values; emergency rollback under the same lock):
-- BEGIN;
-- SET LOCAL lock_timeout = '5s';
-- UPDATE storage.buckets SET file_size_limit = NULL, allowed_mime_types = NULL
-- WHERE id IN ('audio-responses', 'listening-audio', 'listening-images',
--              'reading-images', 'writing-images', 'vocab-audio');
-- COMMIT;
-- DOWN END

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $migration$
DECLARE
    expected record;
    affected integer;
BEGIN
    -- Lock every target row before changing any; a missing bucket aborts all.
    PERFORM id FROM storage.buckets
    WHERE id IN ('audio-responses', 'listening-audio', 'listening-images',
                 'reading-images', 'writing-images', 'vocab-audio')
    ORDER BY id FOR UPDATE;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 6 THEN
        RAISE EXCEPTION 'storage_limits_missing_bucket: expected 6, found %', affected;
    END IF;

    FOR expected IN SELECT * FROM (VALUES
        ('audio-responses', 52428800::bigint,
         ARRAY['audio/*', 'video/webm', 'video/mp4', 'application/octet-stream']),
        ('listening-audio', 134217728::bigint,
         ARRAY['audio/*', 'image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'application/json']),
        ('listening-images', 10485760::bigint, ARRAY['image/png', 'image/jpeg', 'image/webp']),
        ('reading-images', 5242880::bigint, ARRAY['image/png', 'image/jpeg', 'image/webp']),
        ('writing-images', 5242880::bigint, ARRAY['image/png', 'image/jpeg', 'image/webp']),
        ('vocab-audio', 5242880::bigint, ARRAY['audio/mpeg'])
    ) AS limits(bucket, max_bytes, mime_types)
    LOOP
        UPDATE storage.buckets
        SET file_size_limit = expected.max_bytes, allowed_mime_types = expected.mime_types
        WHERE id = expected.bucket;

        IF NOT EXISTS (
            SELECT 1 FROM storage.buckets
            WHERE id = expected.bucket
              AND file_size_limit IS NOT NULL AND allowed_mime_types IS NOT NULL
              AND file_size_limit = expected.max_bytes
              AND allowed_mime_types = expected.mime_types
        ) THEN
            RAISE EXCEPTION 'storage_limits_postcondition_failed: %', expected.bucket;
        END IF;
    END LOOP;
END;
$migration$;

COMMIT;
