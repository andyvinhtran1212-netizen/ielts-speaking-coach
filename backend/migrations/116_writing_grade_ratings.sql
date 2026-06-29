-- 116 — admin quality-rating of an AI grading run (per essay).
--
-- On the admin grade/review page, the admin can score how good the AI grade
-- was (1–5) and leave an optional note. We snapshot WHICH model produced the
-- grade (+ level + tier) at rate time so later analytics can ask
-- "avg rating by model / by level" and feed model/prompt upgrades — the whole
-- point of the multi-model rollout (see docs/research/MULTI_MODEL_WRITING_GRADING.md).
--
-- One CURRENT rating per essay (UNIQUE essay_id) → the endpoint upserts; a
-- re-rating overwrites. The snapshot columns are filled from writing_essays at
-- rate time so a later regrade with a different model doesn't rewrite history's
-- attribution (the rating is about the grade the admin actually saw).

CREATE TABLE IF NOT EXISTS writing_grade_ratings (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    essay_id       uuid NOT NULL REFERENCES writing_essays(id) ON DELETE CASCADE,
    grading_model  text NOT NULL,                    -- snapshot of writing_essays.selected_model
    analysis_level int,                              -- snapshot
    grading_tier   text,                             -- snapshot
    rating         int  NOT NULL CHECK (rating BETWEEN 1 AND 5),
    note           text NOT NULL DEFAULT '',
    rated_by       uuid,                             -- admin user id (nullable: backfill/scripts)
    rated_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (essay_id)
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
