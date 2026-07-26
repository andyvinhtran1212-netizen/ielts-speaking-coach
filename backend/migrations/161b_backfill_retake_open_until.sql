-- 161b_backfill_retake_open_until.sql
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
-- NUMBERED 161b, NOT 164, ON PURPOSE. This must run BEFORE 162 (uq one live
-- sitting per student): it is what clears the stuck legacy rows that would
-- otherwise leave a student holding a permanent lock on every future exam.
-- scripts/apply_migrations.sh applies files in FILENAME order, so a 164 would
-- have run AFTER 162 and the ordering note would have been a lie the runner
-- ignored. The `NNNb` suffix is the repo's existing convention for exactly this
-- (see migrations/README.md — 019/019b, 022/022b) and sorts between 161 and 162
-- under both the default locale and LC_ALL=C.
--
-- POLICY: 14 days. Chosen because it is comfortably longer than any real retake
-- window the admin ever set by hand, so it cannot cut short a legitimately-open
-- assignment. For an ABANDONED row (assigned months ago, never opened) the
-- resulting deadline lands in the past and the reaper collects it on its next
-- run — which is the intended outcome. For a row someone is actually SITTING,
-- the deadline is measured from their own activity instead, so the backfill can
-- never collect a test in progress. Review the SELECTs below before running the
-- UPDATEs if that is not what you want for your data.

-- ── 0. AUDIT FIRST (read-only). What is about to change, and how stale is it?
-- SELECT a.id, a.exam_id, a.user_id, a.created_at,
--        a.created_at + INTERVAL '14 days' AS proposed_open_until
--   FROM mock_exam_assignments a
--  WHERE a.open_until IS NULL
--  ORDER BY a.created_at;
--
-- And the sittings, with the deadline step 2 would give them — check that no
-- row someone is actively sitting comes out with a deadline in the past:
--
-- SELECT s.id, s.user_id, s.status, s.created_at,
--        GREATEST(s.created_at,
--                 COALESCE(s.listening_started_at, s.created_at),
--                 COALESCE(s.reading_started_at,   s.created_at),
--                 COALESCE(s.writing_started_at,   s.created_at))
--          + INTERVAL '14 days' AS floor_deadline
--   FROM mock_exam_sittings s
--   JOIN mock_exams e ON e.id = s.mock_exam_id
--  WHERE e.exam_mode = 'retake' AND s.retake_open_until IS NULL
--    AND s.status IN ('registered', 'lrw_in_progress');
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

-- ── 2. Sittings: the SNAPSHOT taken at sitting-creation time.
--
-- The assignment's (now backfilled) value keeps the two records agreeing, but
-- it CANNOT be used on its own: an assignment created months ago whose student
-- only opened or started the exam recently would inherit a deadline already in
-- the past, and the reaper — enabled by this same wave — would immediately
-- collect every outstanding section of a test that is actively being sat
-- (Codex review, PR #839). So the deadline is the LATEST of:
--
--   · the assignment's deadline,
--   · 14 days from when the sitting was created,
--   · 14 days from the most recent section the student actually started.
--
-- The assignment lookup is a CORRELATED SUBQUERY, not a join in FROM: the
-- UPDATE target alias `s` is not in scope inside a FROM-clause join condition,
-- so `ON a.user_id = s.user_id` raises "invalid reference to FROM-clause entry
-- for table s" and the whole transaction rolls back — leaving every legacy row
-- exactly as it was (Codex review, PR #839).
UPDATE mock_exam_sittings s
   SET retake_open_until = GREATEST(
           COALESCE(
               (SELECT a.open_until
                  FROM mock_exam_assignments a
                 WHERE a.exam_id = s.mock_exam_id
                   AND a.user_id = s.user_id
                 LIMIT 1),
               s.created_at + INTERVAL '14 days'),
           s.created_at + INTERVAL '14 days',
           COALESCE(s.listening_started_at, s.created_at) + INTERVAL '14 days',
           COALESCE(s.reading_started_at,   s.created_at) + INTERVAL '14 days',
           COALESCE(s.writing_started_at,   s.created_at) + INTERVAL '14 days')
  FROM mock_exams e
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
