-- 144_gold_set_eval.sql
-- Audit Giai đoạn 2 (#4) — human-graded GOLD SET for the grading-quality
-- regression harness (backend/eval). Two tables, one per grader module.
--
-- Design notes:
--   * Reference bands are HUMAN truth. Each item is graded independently by 2+
--     raters (rater_bands JSONB array) so the harness can also report
--     inter-rater agreement (the human ceiling). `ref_*` = the adjudicated /
--     mean value the harness scores the grader against.
--   * band_bucket + tags drive STRATIFIED reporting: the audit cares most about
--     the low band (fabrication) and the 6/7 boundary, so the sampling query
--     (eval/sampling.sql) fills these buckets deliberately rather than letting
--     the corpus pile up at band 6–7.
--   * Speaking audio is NOT stored here — audio_path points into a PRIVATE
--     Supabase Storage bucket (`gold-audio`, created out-of-band in the
--     dashboard). Only the #2 Azure→P calibration needs the audio; band
--     agreement for FC/LR/GRA runs off the transcript alone.
--   * This is an OPS asset (nightly / pre-prompt-change), never touched by the
--     request path, so no RLS policy for anon — service-role access only.

-- ── Speaking gold set ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gold_speaking (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- provenance (nullable — a hand-authored item may have no prod origin)
    source_session_id  UUID,
    source_response_id UUID,

    -- graded material
    question           TEXT        NOT NULL,
    transcript         TEXT        NOT NULL,
    part               SMALLINT    NOT NULL CHECK (part IN (1, 2, 3)),
    audio_path         TEXT,       -- key in the private `gold-audio` bucket (nullable)

    -- adjudicated human reference bands (0–9, whole or .5). P nullable — audio
    -- may be absent, and P is only needed for the Azure→P calibration.
    ref_band_fc        NUMERIC(2,1) NOT NULL CHECK (ref_band_fc  BETWEEN 0 AND 9),
    ref_band_lr        NUMERIC(2,1) NOT NULL CHECK (ref_band_lr  BETWEEN 0 AND 9),
    ref_band_gra       NUMERIC(2,1) NOT NULL CHECK (ref_band_gra BETWEEN 0 AND 9),
    ref_band_p         NUMERIC(2,1)          CHECK (ref_band_p   BETWEEN 0 AND 9),
    ref_overall        NUMERIC(2,1) NOT NULL CHECK (ref_overall  BETWEEN 0 AND 9),

    -- per-rater raw grades: [{"rater":"T1","fc":6,"lr":6,"gra":5,"p":6,"overall":6}, ...]
    rater_bands        JSONB       NOT NULL DEFAULT '[]'::jsonb,

    -- stratification
    band_bucket        TEXT        CHECK (band_bucket IN ('low', 'mid', 'high')),
    tags               TEXT[]      NOT NULL DEFAULT '{}',   -- off_topic, short, zero_mistake, incident, ...
    notes              TEXT,

    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gold_speaking_bucket ON gold_speaking (band_bucket);
CREATE INDEX IF NOT EXISTS idx_gold_speaking_tags   ON gold_speaking USING GIN (tags);

-- ── Writing gold set ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gold_writing (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    source_essay_id    UUID,

    task_type          TEXT        NOT NULL,   -- task1_academic / task1_general / task2
    prompt_text        TEXT        NOT NULL,
    prompt_image_url   TEXT,                   -- Task 1 chart (nullable)
    essay_text         TEXT        NOT NULL,
    analysis_level     SMALLINT    CHECK (analysis_level BETWEEN 1 AND 5),

    -- adjudicated human reference bands (TR = Task Response/Achievement)
    ref_band_tr        NUMERIC(2,1) NOT NULL CHECK (ref_band_tr  BETWEEN 0 AND 9),
    ref_band_cc        NUMERIC(2,1) NOT NULL CHECK (ref_band_cc  BETWEEN 0 AND 9),
    ref_band_lr        NUMERIC(2,1) NOT NULL CHECK (ref_band_lr  BETWEEN 0 AND 9),
    ref_band_gra       NUMERIC(2,1) NOT NULL CHECK (ref_band_gra BETWEEN 0 AND 9),
    ref_overall        NUMERIC(2,1) NOT NULL CHECK (ref_overall  BETWEEN 0 AND 9),

    rater_bands        JSONB       NOT NULL DEFAULT '[]'::jsonb,

    band_bucket        TEXT        CHECK (band_bucket IN ('low', 'mid', 'high')),
    tags               TEXT[]      NOT NULL DEFAULT '{}',   -- zero_mistake, off_topic, incident, ...
    notes              TEXT,

    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gold_writing_bucket ON gold_writing (band_bucket);
CREATE INDEX IF NOT EXISTS idx_gold_writing_tags   ON gold_writing USING GIN (tags);
