-- backend/eval/sampling.sql
-- Stratified candidate picker for the gold set (audit Giai đoạn 2, #4).
--
-- The audit's risk is concentrated at the LOW band (fabrication) and the 6/7
-- boundary — NOT at band 6–7 where prod naturally piles up. So we sample a
-- BALANCED slate across band buckets instead of a random draw, plus explicit
-- edge cases (off-topic, very short, zero-mistake). Run in the Supabase SQL
-- editor, review the candidates, then a human grades them into gold_* (2 raters).
--
-- These read the current prod schema — verify the column names against your DB
-- before trusting the buckets (writing_feedback.overall_band_score,
-- responses.band_fc/…/transcript are the audit-2026-07 shapes).

-- ── Writing candidates: N per band bucket ─────────────────────────────────────
-- Tweak :per_bucket (e.g. 7 → ~21 across 3 buckets ≈ the 20-essay MVP).
WITH writing_scored AS (
    SELECT
        e.id                AS essay_id,
        e.task_type,
        e.analysis_level,
        f.overall_band_score AS band,
        CASE
            WHEN f.overall_band_score < 5.5 THEN 'low'
            WHEN f.overall_band_score < 7.0 THEN 'mid'
            ELSE 'high'
        END                  AS band_bucket,
        -- edge-case flags to prioritise
        (jsonb_array_length(COALESCE(f.feedback_json->'mistakeAnalysis', '[]'::jsonb)) = 0
             AND f.overall_band_score < 7)                       AS zero_mistake_low,
        char_length(e.essay_text)                                AS essay_chars,
        row_number() OVER (
            PARTITION BY CASE
                WHEN f.overall_band_score < 5.5 THEN 'low'
                WHEN f.overall_band_score < 7.0 THEN 'mid'
                ELSE 'high' END
            -- deterministic spread; swap ORDER BY for random() to reshuffle
            ORDER BY e.created_at DESC
        )                    AS rn
    FROM writing_essays e
    JOIN writing_feedback f ON f.essay_id = e.id
    WHERE e.deleted_at IS NULL
      AND f.overall_band_score IS NOT NULL
)
SELECT essay_id, task_type, analysis_level, band, band_bucket, zero_mistake_low, essay_chars
FROM writing_scored
WHERE rn <= 7                 -- :per_bucket
ORDER BY band_bucket, band;

-- ── Speaking candidates: N per band bucket ────────────────────────────────────
-- (run separately; same shape). Assumes responses carries the transcript + the
-- three transcript-scored bands. Verify column names first.
--
-- WITH speaking_scored AS (
--     SELECT
--         r.id AS response_id, r.session_id, r.part, r.transcript,
--         r.overall_band AS band,
--         CASE WHEN r.overall_band < 5.5 THEN 'low'
--              WHEN r.overall_band < 7.0 THEN 'mid' ELSE 'high' END AS band_bucket,
--         (r.off_topic_penalty_applied IS TRUE) AS off_topic,
--         array_length(regexp_split_to_array(trim(r.transcript), '\s+'), 1) AS word_count,
--         row_number() OVER (
--             PARTITION BY CASE WHEN r.overall_band < 5.5 THEN 'low'
--                               WHEN r.overall_band < 7.0 THEN 'mid' ELSE 'high' END
--             ORDER BY r.created_at DESC) AS rn
--     FROM responses r
--     WHERE r.transcript IS NOT NULL AND r.overall_band IS NOT NULL
-- )
-- SELECT response_id, session_id, part, band, band_bucket, off_topic, word_count
-- FROM speaking_scored WHERE rn <= 7 ORDER BY band_bucket, band;
