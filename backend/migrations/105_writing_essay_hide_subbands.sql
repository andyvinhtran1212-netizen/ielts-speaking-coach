-- Migration: 105_writing_essay_hide_subbands.sql
-- Mô tả: ẨN/HIỆN 4 điểm tiêu chí (sub-band) cho học viên khi TRẢ bài writing.
--
-- Thread 3 of the writing-grading arc. At deliver time the admin can choose to
-- hide the 4 IELTS criterion sub-bands (Task/Achievement, Coherence & Cohesion,
-- Lexical Resource, Grammatical Range) from the student view. The OVERALL band
-- is always shown — this flag only suppresses the 4 sub-band cards.
--
-- Purely ADDITIVE. The flag lives next to delivered_at / delivery_method on the
-- essay row (delivery is a status + columns on writing_essays, no per-delivery
-- table — see _deliver_essay). It survives regrades (regrade clears feedback +
-- admin edits, not delivery columns) and is queryable.
--
-- Column:
--   hide_subbands — BOOLEAN NOT NULL DEFAULT false. Default false = SHOW the 4
--     sub-bands, which is exactly the behavior before this change, so every
--     existing (already-delivered) essay and any deliver call that omits the
--     flag keeps the current behavior — zero regression, apply-forward.

ALTER TABLE writing_essays
    ADD COLUMN IF NOT EXISTS hide_subbands BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN writing_essays.hide_subbands IS
    'Deliver-time flag: when true, the student view hides the 4 IELTS criterion sub-bands (overall band always shown). Default false = show (legacy behavior). Set by mark-delivered; survives regrades.';
