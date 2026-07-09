-- ============================================================================
-- Migration 142 — add 'grammar_practice' as an exam_source
-- ============================================================================
-- Sibling of mig 141 (grammar_reading). Houses self-authored single-sentence
-- grammar-decode drill sets for the non-reading grammar clusters — word
-- formation, modifiers, grammar-for-writing — as their own "Luyện Ngữ pháp"
-- section (not mislabeled as TOEIC). Each question's stepper carries a
-- micro-check feeding grammar KP evidence. Recreates the CHECK with the full
-- value set (must re-list grammar_reading from mig 141). exam_service.EXAM_SOURCES
-- + the frontend SOURCE_LABEL are updated to match.
--
-- ADDITIVE (constraint widened). Apply by hand BEFORE merge.
-- ============================================================================

ALTER TABLE exam_tests DROP CONSTRAINT IF EXISTS exam_tests_exam_source_check;
ALTER TABLE exam_tests ADD CONSTRAINT exam_tests_exam_source_check
    CHECK (exam_source IN (
        'toeic_rc', 'toeic_lc', 'thpt_qg', 'grammar_reading', 'grammar_practice'));

-- ── Reverse (run manually if needed; only safe once no grammar_practice rows) ─
-- ALTER TABLE exam_tests DROP CONSTRAINT IF EXISTS exam_tests_exam_source_check;
-- ALTER TABLE exam_tests ADD CONSTRAINT exam_tests_exam_source_check
--     CHECK (exam_source IN ('toeic_rc', 'toeic_lc', 'thpt_qg', 'grammar_reading'));
