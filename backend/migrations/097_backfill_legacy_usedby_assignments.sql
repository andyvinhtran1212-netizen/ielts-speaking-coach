-- Migration: 097_backfill_legacy_usedby_assignments.sql
-- Mã kích hoạt — FIX revoke không tức thì · PR3 (a).
-- Run once in the Supabase SQL editor (Dashboard → SQL Editor → New query).
--
-- Context: read-path fix #442 made the legacy `access_codes.used_by` fallback
-- apply ONLY to codes the user has NO assignment row for. That correctly fixes
-- silent-fail for the ~27 users who already have an active assignment, but it
-- leaves a residue: 19 users hold access purely via `used_by` with NO
-- user_code_assignments row at all (activated after Migration 009's original
-- backfill, by a path that set used_by but never created an assignment). For
-- those 19, the admin per-user remove button (PR2) returns 404 — there is no
-- assignment row to deactivate — so they cannot be revoked through the UI.
--
-- This backfills an ACTIVE assignment row for each such (user, live code) pair,
-- mirroring Migration 009's used_by → assignment backfill. After this runs, the
-- per-user remove button works uniformly for everyone (deactivating the row
-- cuts access via #442's read path).
--
-- Non-destructive and idempotent:
--   - NEVER clears/changes access_codes.used_by / used_at / is_used (immutable).
--   - Creates a row ONLY when the user has NO assignment row (active OR inactive)
--     for that code — the NOT EXISTS guard plus ON CONFLICT DO NOTHING ensure a
--     deliberately-revoked (inactive) row is never resurrected, and re-running
--     inserts nothing.
--   - Scoped to LIVE codes only (not revoked, not locked, not expired) so we
--     don't fabricate access for dead codes.

INSERT INTO user_code_assignments (user_id, code_id, assigned_at, is_active)
SELECT
    ac.used_by,
    ac.id,
    COALESCE(ac.used_at, ac.created_at, NOW()),
    true
FROM access_codes ac
WHERE ac.used_by IS NOT NULL
  AND COALESCE(ac.is_revoked, false) = false
  AND COALESCE(ac.is_active, true) = true
  AND (ac.expires_at IS NULL OR ac.expires_at > NOW())
  AND NOT EXISTS (
      SELECT 1 FROM user_code_assignments u
      WHERE u.code_id = ac.id
        AND u.user_id = ac.used_by
  )
ON CONFLICT (user_id, code_id) DO NOTHING;

-- ── Verify (run after; expect the 19 to now have an active assignment) ─────────
-- SELECT count(*) AS still_usedby_without_assignment
-- FROM access_codes ac
-- WHERE ac.used_by IS NOT NULL
--   AND COALESCE(ac.is_revoked, false) = false
--   AND COALESCE(ac.is_active, true) = true
--   AND (ac.expires_at IS NULL OR ac.expires_at > NOW())
--   AND NOT EXISTS (
--       SELECT 1 FROM user_code_assignments u
--       WHERE u.code_id = ac.id AND u.user_id = ac.used_by AND u.is_active = true
--   );
-- -- Expected: 0 (was 19 before this migration).

-- ── Reverse (run manually if needed) ──────────────────────────────────────────
-- Deactivate ONLY the rows this migration created (active rows with no audit
-- author, on codes whose used_by matches). Adjust the time window if needed.
-- UPDATE user_code_assignments u SET is_active = false
-- FROM access_codes ac
-- WHERE u.code_id = ac.id AND u.user_id = ac.used_by
--   AND u.assigned_by IS NULL AND u.reason IS NULL;
