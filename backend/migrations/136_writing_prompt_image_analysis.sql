-- Migration: 136_writing_prompt_image_analysis.sql
-- Mô tả: Task 1 verified "answer key" — one-time vision extraction of the chart
-- into static, admin-reviewed facts used to anchor Task Achievement grading.
-- See docs/WRITING_TASK1_ANALYSIS_SPEC.md.
--
-- writing_prompts gets the extraction + its review state:
--   • prompt_image_analysis           — JSONB answer key (schema: PromptImageAnalysis).
--   • prompt_image_analysis_status    — pending | ready | failed (NULL = never run).
--   • prompt_image_analysis_reviewed  — admin approved. Facts are used at grade
--                                       time ONLY when this is TRUE (safety gate:
--                                       un-reviewed AI extraction never drives a grade).
--   • prompt_image_analysis_model     — the vision model that produced it.
--   • prompt_image_analysis_public_id — the prompt_image_public_id the analysis was
--                                       derived from; when the image is replaced the
--                                       two differ → re-analysis + reviewed resets.
--   • prompt_image_analysis_error     — failure message for the admin UI.
--   • prompt_image_analysis_at        — when the extraction last ran.
--
-- writing_essays gets a snapshot column, mirroring prompt_image_url (mig 033):
--   • prompt_image_analysis — the reviewed facts captured at submit time so a later
--                             prompt edit doesn't retroactively change a past grade
--                             (canonical truth; only a regrade re-snapshots).
--
-- All columns NULL-able + idempotent ADD — re-running is a no-op.

ALTER TABLE writing_prompts
    ADD COLUMN IF NOT EXISTS prompt_image_analysis           JSONB,
    ADD COLUMN IF NOT EXISTS prompt_image_analysis_status    TEXT
        CHECK (prompt_image_analysis_status IS NULL
               OR prompt_image_analysis_status IN ('pending', 'ready', 'failed')),
    ADD COLUMN IF NOT EXISTS prompt_image_analysis_reviewed  BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS prompt_image_analysis_model     TEXT,
    ADD COLUMN IF NOT EXISTS prompt_image_analysis_public_id TEXT,
    ADD COLUMN IF NOT EXISTS prompt_image_analysis_error     TEXT,
    ADD COLUMN IF NOT EXISTS prompt_image_analysis_at        TIMESTAMPTZ;

ALTER TABLE writing_essays
    ADD COLUMN IF NOT EXISTS prompt_image_analysis JSONB;

COMMENT ON COLUMN writing_prompts.prompt_image_analysis IS
    'Verified Task 1 answer key (chart facts). Schema: PromptImageAnalysis. NULL until extracted.';
COMMENT ON COLUMN writing_prompts.prompt_image_analysis_reviewed IS
    'Admin approved. Facts anchor grading ONLY when TRUE — un-reviewed extraction never grades.';
COMMENT ON COLUMN writing_prompts.prompt_image_analysis_public_id IS
    'The prompt_image_public_id the analysis came from; mismatch with current image → re-analyze.';
COMMENT ON COLUMN writing_essays.prompt_image_analysis IS
    'Snapshot of the reviewed prompt answer key at submit time (mirrors prompt_image_url).';
