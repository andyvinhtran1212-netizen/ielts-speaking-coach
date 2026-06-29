-- 116 — admin quality-rating of an AI grading run (per essay).
--
-- On the admin grade/review page, the admin can score how good the AI grade
-- was (1–5) and leave an optional note. We snapshot WHICH model produced the
-- grade (+ level + tier) at rate time so later analytics can ask
-- "avg rating by model / by level" and feed model/prompt upgrades — the whole
-- point of the multi-model rollout (see docs/research/MULTI_MODEL_WRITING_GRADING.md).
--
-- Keyed to the GRADED RUN, not just the essay: `feedback_version` is the
-- writing_feedback.version the rating is about. A regrade advances
-- current_version to a NEW row → the old rating no longer matches the current
-- run, so the grade page shows an unrated state for the new grade (instead of
-- mis-preloading the prior run's stars). UNIQUE(essay_id, feedback_version) →
-- the endpoint upserts one rating per (essay, run).
--
-- `grading_model` snapshots writing_feedback.model_used — the model that
-- ACTUALLY produced the run (Deep/Instructor can differ from the requested
-- writing_essays.selected_model) — so /grade-ratings/summary attributes quality
-- to the real grader.

CREATE TABLE IF NOT EXISTS writing_grade_ratings (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    essay_id         uuid NOT NULL REFERENCES writing_essays(id) ON DELETE CASCADE,
    feedback_version int  NOT NULL,                  -- writing_feedback.version being rated
    grading_model    text NOT NULL,                  -- snapshot of writing_feedback.model_used (actual grader)
    analysis_level   int,                            -- snapshot
    grading_tier     text,                           -- snapshot
    rating           int  NOT NULL CHECK (rating BETWEEN 1 AND 5),
    note             text NOT NULL DEFAULT '',
    rated_by         uuid,                            -- admin user id (nullable: backfill/scripts)
    rated_at         timestamptz NOT NULL DEFAULT now(),
    UNIQUE (essay_id, feedback_version)
);

-- Analytics: "avg rating + count grouped by model" (the upgrade-factoring query).
CREATE INDEX IF NOT EXISTS idx_writing_grade_ratings_model
    ON writing_grade_ratings (grading_model);

-- RLS: backend-only (admin-gated routes via service_role). Enable RLS with NO
-- policy so service_role keeps full access while anon/authenticated fall to
-- deny-all — a Supabase client must not read/forge quality ratings. Mirrors
-- the audit-table hardening in migrations 108 / 114.
ALTER TABLE public.writing_grade_ratings ENABLE ROW LEVEL SECURITY;
-- Rollback: DROP TABLE IF EXISTS public.writing_grade_ratings;
