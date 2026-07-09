-- ============================================================================
-- Migration 141 — add 'grammar_reading' as an exam_source
-- ============================================================================
-- The exam module (mig 134) constrains exam_source to TOEIC/THPT. The new
-- "Grammar for Reading" decode sets — single-sentence grammar-decode MCQs whose
-- steppers carry micro-checks that feed grammar KP evidence — need their own
-- source so they list separately (not polluting the TOEIC groups). Widen the
-- CHECK; exam_service.EXAM_SOURCES + the frontend SOURCE_LABEL are updated to match.
--
-- ADDITIVE (constraint widened, never narrowed). Apply by hand BEFORE merge.
-- ============================================================================

ALTER TABLE exam_tests DROP CONSTRAINT IF EXISTS exam_tests_exam_source_check;
ALTER TABLE exam_tests ADD CONSTRAINT exam_tests_exam_source_check
    CHECK (exam_source IN ('toeic_rc', 'toeic_lc', 'thpt_qg', 'grammar_reading'));

-- ── Reverse (run manually if needed; only safe once no grammar_reading rows) ──
-- ALTER TABLE exam_tests DROP CONSTRAINT IF EXISTS exam_tests_exam_source_check;
-- ALTER TABLE exam_tests ADD CONSTRAINT exam_tests_exam_source_check
--     CHECK (exam_source IN ('toeic_rc', 'toeic_lc', 'thpt_qg'));
