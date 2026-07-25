-- 164_backfill_retake_open_until.sql
--
-- D3 remediation, part 2: give EXISTING open-ended retakes a finite deadline.
--
-- `_validate_window()` now refuses to write a retake assignment with no
-- `open_until`, but that only protects FUTURE assign() calls. Migration 154
-- deliberately allowed both `mock_exam_assignments.open_until` and the
-- snapshotted `mock_exam_sittings.retake_open_until` to be NULL, and the admin
-- UI created exactly such rows by default for months. Those rows are the bug
-- the validation exists to prevent, still sitting in the table:
--
--   reap_expired_retake_sittings() computes
--       window_closed = bool(window_until and now > window_until)
--   so a NULL deadline makes window_closed permanently false. A student who was
--   assigned a retake and never pressed "Bắt đầu" leaves the sitting in
--   `registered` FOREVER — never collected, never reviewed, never finished —
--   and it permanently occupies their one-live-sitting slot.
--
-- ORDERING NOTE: if migration 162 (uq one live sitting per student) has NOT
-- been applied yet, run THIS one first. It is what clears the stuck legacy
-- rows that would otherwise make 162's unique index fail its pre-check.
--
-- POLICY: 14 days from when the assignment was created. Chosen because it is
-- comfortably longer than any real retake window the admin ever set by hand, so
-- it cannot cut short a legitimately-open assignment; every affected row is
-- already months old in practice, so the deadline lands in the past and the
-- reaper collects the paper on its next run — which is the intended outcome.
-- Review the SELECT below before running the UPDATEs if that is not what you
-- want for your data.

-- ── 0. AUDIT FIRST (read-only). What is about to change, and how stale is it?
-- SELECT a.id, a.exam_id, a.user_id, a.created_at,
--        a.created_at + INTERVAL '14 days' AS proposed_open_until
--   FROM mock_exam_assignments a
--  WHERE a.open_until IS NULL
--  ORDER BY a.created_at;
--
-- SELECT s.id, s.mock_exam_id, s.user_id, s.status, s.created_at
--   FROM mock_exam_sittings s
--   JOIN mock_exams e ON e.id = s.mock_exam_id
--  WHERE e.exam_mode = 'retake'
--    AND s.retake_open_until IS NULL
--    AND s.status IN ('registered', 'lrw_in_progress')
--  ORDER BY s.created_at;

BEGIN;

-- ── 1. Assignments: the canonical definition of the window.
UPDATE mock_exam_assignments
   SET open_until = created_at + INTERVAL '14 days'
 WHERE open_until IS NULL;

-- ── 2. Sittings: the SNAPSHOT taken at sitting-creation time. Prefer the
--      assignment's (now backfilled) value so the two agree; fall back to the
--      sitting's own age when no assignment row survives.
UPDATE mock_exam_sittings s
   SET retake_open_until = COALESCE(a.open_until, s.created_at + INTERVAL '14 days')
  FROM mock_exams e
  LEFT JOIN mock_exam_assignments a
         ON a.exam_id = e.id AND a.user_id = s.user_id
 WHERE e.id = s.mock_exam_id
   AND e.exam_mode = 'retake'
   AND s.retake_open_until IS NULL
   -- Terminal sittings are already finished; stamping them would only muddy
   -- the audit trail with a deadline that never applied to anything.
   AND s.status IN ('registered', 'lrw_in_progress');

COMMIT;

-- ── 3. VERIFY (read-only). Both must return 0.
-- SELECT COUNT(*) FROM mock_exam_assignments WHERE open_until IS NULL;
-- SELECT COUNT(*) FROM mock_exam_sittings s JOIN mock_exams e ON e.id = s.mock_exam_id
--  WHERE e.exam_mode = 'retake' AND s.retake_open_until IS NULL
--    AND s.status IN ('registered', 'lrw_in_progress');

-- NOT adding a NOT NULL constraint on mock_exam_assignments.open_until here.
-- The column is shared with sequential exams' own bookkeeping paths, and a hard
-- constraint would turn any future code path that legitimately writes a partial
-- row into a 500 rather than the explicit 400 _validate_window() already
-- raises. The service-level guard is the enforcement point; this migration only
-- repairs the rows written before it existed.
