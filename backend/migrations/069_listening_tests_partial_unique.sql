-- Migration: 069_listening_tests_partial_unique.sql
-- Sprint 13.5.4 — relax the strict UNIQUE on listening_tests.test_id to a
-- partial UNIQUE index that excludes archived rows.
--
-- Why:
--   Andy iterates Cambridge test content frequently (parser fixes,
--   editorial passes, re-uploads after audio re-cuts). The Sprint 13.4
--   schema put a strict UNIQUE on test_id which blocks re-import the
--   instant an old row is archived — Andy hits "Test ID 'ILR-LIS-001'
--   đã tồn tại" even after soft-deleting via Vùng nguy hiểm.
--
-- Contract:
--   * 0 or 1 ACTIVE rows (status='draft' or 'published') per test_id
--   * Unbounded ARCHIVED rows per test_id (audit history preserved)
--   * Re-import after archive succeeds — new draft row written, old
--     archived row stays for analytics + attempt history
--
-- Pre-migration check (run manually before apply):
--   SELECT test_id, COUNT(*) FROM listening_tests
--   WHERE status != 'archived' GROUP BY test_id HAVING COUNT(*) > 1;
--   (must return 0 rows)
--
-- Forward-only.

ALTER TABLE listening_tests
    DROP CONSTRAINT IF EXISTS listening_tests_test_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS listening_tests_test_id_active_idx
    ON listening_tests (test_id)
    WHERE status != 'archived';

COMMENT ON INDEX listening_tests_test_id_active_idx IS
    'Sprint 13.5.4 partial UNIQUE: test_id is unique among rows where '
    'status IN (draft, published). Archived rows can repeat freely so '
    'admins can re-import the same test_id after soft-deleting an old '
    'version. Hard delete (cluster-deletion endpoint) removes archived '
    'rows when historical retention is no longer needed.';
