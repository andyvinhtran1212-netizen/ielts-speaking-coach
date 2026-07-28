-- ============================================================================
-- Migration 162 — one LIVE sitting per student, across all exams (C3)
-- ============================================================================
--
-- uq_mock_sitting_active (mig 146) is per (mock_exam_id, user_id): it stops a
-- student holding two sittings on the SAME exam, and never stopped them holding
-- one on each of two DIFFERENT exams. `_user_in_cohort` matches ANY students
-- row for the user, so someone in two cohorts genuinely sees both exams and can
-- open a sitting in each.
--
-- Product decision (2026-07-25): block it. A student sits one exam at a time.
--
-- Scoped to the ACTIVELY-SEATED statuses only. speaking_pending is deliberately
-- excluded: it waits on a viva appointment and can legitimately last days, so
-- including it would lock a student out of an unrelated exam for a week over
-- something that is not a conflict.
--
-- The service checks this first and returns a friendly message; this index is
-- the backstop for the race where two tabs pass that check simultaneously.
--
-- ─── APPLY THIS FIRST ───────────────────────────────────────────────────────
-- CREATE UNIQUE INDEX FAILS if any student already holds two live sittings.
-- Find them, and decide which to void, BEFORE running the DDL below:
--
--   SELECT s.user_id,
--          COUNT(*)                        AS live_sittings,
--          array_agg(s.id)                 AS sitting_ids,
--          array_agg(e.code ORDER BY e.code) AS exam_codes
--     FROM mock_exam_sittings s
--     JOIN mock_exams e ON e.id = s.mock_exam_id
--    WHERE s.status IN ('registered', 'lrw_in_progress')
--    GROUP BY s.user_id
--   HAVING COUNT(*) > 1;
--
-- Void the ones that should not survive (keeps the row for audit, keeps it
-- sealed) — the admin "Huỷ lượt" button on /pages/admin/mock-live/ does exactly
-- this, or by hand:
--
--   UPDATE mock_exam_sittings
--      SET status = 'void',
--          integrity = integrity || '{"void_reason":"C3 backfill: two live sittings"}'::jsonb
--    WHERE id = '<sitting-id>';
--
-- Re-run the SELECT until it returns no rows, THEN apply the index.
-- ────────────────────────────────────────────────────────────────────────────
--
-- ADDITIVE + idempotent. Apply by hand in the Supabase SQL editor.
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_mock_sitting_one_live_per_user
    ON mock_exam_sittings (user_id)
    WHERE status IN ('registered', 'lrw_in_progress');

COMMENT ON INDEX uq_mock_sitting_one_live_per_user IS
'C3 — a student may be seated at only ONE exam at a time. Complements
uq_mock_sitting_active (per exam+user, mig 146), which never covered the
cross-exam case. Excludes speaking_pending on purpose: that state waits on a
viva appointment and is not a seating conflict.';
