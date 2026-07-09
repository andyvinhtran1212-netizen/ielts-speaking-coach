-- ============================================================================
-- Migration 143 — add 'vocab_context' as an exam_source
-- ============================================================================
-- Third sibling of mig 141/142. Houses "Từ vựng theo ngữ cảnh" — vocabulary-in-
-- context decode sets (academic words in a sentence, meaning probed via a
-- micro-check that feeds VOCAB KP evidence). exam_service.EXAM_SOURCES + the
-- frontend SOURCE_LABEL are updated to match.
--
-- NOTE — shared constraint: migrations 141, 142, 143 each DROP+recreate
-- exam_tests_exam_source_check. Apply in ASCENDING NUMBER ORDER (143 last); this
-- migration lists the FULL final set of all five non-TOEIC/base sources, so once
-- 143 is applied the constraint is complete regardless of what 141/142 left.
--
-- ADDITIVE (constraint widened). Apply by hand BEFORE merge, AFTER 141 + 142.
-- ============================================================================

ALTER TABLE exam_tests DROP CONSTRAINT IF EXISTS exam_tests_exam_source_check;
ALTER TABLE exam_tests ADD CONSTRAINT exam_tests_exam_source_check
    CHECK (exam_source IN (
        'toeic_rc', 'toeic_lc', 'thpt_qg',
        'grammar_reading', 'grammar_practice', 'vocab_context'));

-- ── Reverse (run manually if needed; only safe once no vocab_context rows) ────
-- ALTER TABLE exam_tests DROP CONSTRAINT IF EXISTS exam_tests_exam_source_check;
-- ALTER TABLE exam_tests ADD CONSTRAINT exam_tests_exam_source_check
--     CHECK (exam_source IN ('toeic_rc','toeic_lc','thpt_qg','grammar_reading','grammar_practice'));
