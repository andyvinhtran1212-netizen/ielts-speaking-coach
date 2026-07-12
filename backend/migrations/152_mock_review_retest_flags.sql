-- ============================================================================
-- Migration 152 — mock_exam_reviews.retest_flags (per-skill "cần test lại")
-- ============================================================================
--
-- While banding a sitting, an admin may judge that a specific skill doesn't
-- meet the bar and flag it as needing a retest — independent of final_bands
-- (which is the SCORE; retest_flags is the PASS/FAIL judgment). Sibling
-- column, same shape keys as final_bands so the two stay easy to read
-- together: {listening: bool, reading: bool, writing: bool, speaking: bool}.
-- Missing/absent skill keys mean "no flag" — a sitting with an empty object
-- has nothing flagged.
--
-- Feeds:
--   - GET /admin/mock-exams/{id}/retest-summary (per-cohort retest counts)
--   - the score-report gate (only issued when a sitting has ZERO flags true)
--
-- ADDITIVE + idempotent. Apply by hand in the Supabase SQL editor.
-- ============================================================================

ALTER TABLE mock_exam_reviews
    ADD COLUMN IF NOT EXISTS retest_flags JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN mock_exam_reviews.retest_flags IS
'Per-skill "cần test lại" judgment set by the admin during review:
{listening: bool, reading: bool, writing: bool, speaking: bool}. Independent
of final_bands (the score) — this is the pass/fail decision. A sitting is
eligible for the final score report only when every present flag is false.';
