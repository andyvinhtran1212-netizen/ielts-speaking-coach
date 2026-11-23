-- MOCKORG-0086 G09-T33 (plan 5.5, migration table row 448).
-- Number 448 is from the G09 band 440-459 of the commercialization register.
-- No apply on merge: pending_feature mock_exam_release_parts. Staging first
-- under the advisory lock with anh Andy's typed approval, after 447;
-- production only at an authorised staging-to-main promotion.
--
-- Additive only; no existing row changes:
--   * mock_exam_sittings.released_skills: skills already handed back to the
--     learner by a partial release ("include_partial", behind the runtime flag
--     mock_partial_release, default off). A full release keeps using
--     mock_exam_reviews.status = 'released' / released_at (migration 147); plan
--     row 448 says to reuse that column, so no sitting released_at is added.
--   * mock_exam_score_edits: append-only log of band changes made after a
--     release (FR-148), with the reason that is required.
--   * one release per (exam, request_key): a unique index on the 447 timeline
--     makes POST /release idempotent.
--   * fn_mock_exam_score_edit: band change, log row and timeline event in one
--     transaction (compare-and-set on the bands the service read).
-- Backend-only (spec 0039): RLS on, no policy; service_role SELECT/INSERT only
-- on the log.
-- Re-runnable; postconditions at the end.
-- Rollback: rollback/448_mock_exam_release_parts.sql (refuses while any partial
-- release or score edit exists).

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = pg_catalog, pg_temp;

DO $pre$
BEGIN
    IF to_regclass('public.mock_exam_events') IS NULL THEN
        RAISE EXCEPTION 'mock_exam_448_requires_447' USING ERRCODE = '55000';
    END IF;
END;
$pre$;

-- 1. Partial release --------------------------------------------------------
ALTER TABLE public.mock_exam_sittings
    ADD COLUMN IF NOT EXISTS released_skills text[] NOT NULL DEFAULT '{}'::text[];

DO $chk$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'public.mock_exam_sittings'::regclass
                      AND conname = 'mock_exam_sittings_released_skills_valid') THEN
        ALTER TABLE public.mock_exam_sittings ADD CONSTRAINT mock_exam_sittings_released_skills_valid
            CHECK (released_skills <@ ARRAY['listening', 'reading', 'writing', 'speaking']::text[]);
    END IF;
END;
$chk$;

-- 2. Score edits after release (append-only) --------------------------------
CREATE TABLE IF NOT EXISTS public.mock_exam_score_edits (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sitting_id uuid NOT NULL REFERENCES public.mock_exam_sittings(id) ON DELETE CASCADE,
    skill      text NOT NULL,
    old_band   numeric(2,1),
    new_band   numeric(2,1) NOT NULL,
    reason     text NOT NULL,
    actor_id   uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT mock_exam_score_edits_skill_valid
        CHECK (skill IN ('listening', 'reading', 'writing', 'speaking')),
    CONSTRAINT mock_exam_score_edits_band_valid
        CHECK (new_band BETWEEN 0 AND 9 AND new_band * 2 = trunc(new_band * 2)
               AND (old_band IS NULL OR (old_band BETWEEN 0 AND 9 AND old_band * 2 = trunc(old_band * 2)))),
    CONSTRAINT mock_exam_score_edits_reason_len CHECK (char_length(btrim(reason)) >= 3)
);
CREATE INDEX IF NOT EXISTS idx_mock_exam_score_edits_sitting
    ON public.mock_exam_score_edits (sitting_id, created_at DESC);

COMMENT ON TABLE public.mock_exam_score_edits IS
'MOCKORG-0086 FR-148 / G09-T33: band changes made after a mock result was
released, each with its reason. Append-only; backend-only.';

-- 3. One release per request_key ---------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_mock_exam_events_release_key
    ON public.mock_exam_events (exam_id, (payload->>'request_key'))
    WHERE kind = 'released' AND payload ? 'request_key';

-- 4. One score edit = band change + log row + timeline event, atomically ----
-- The service computes the new final_bands (overall included) with the same
-- rules as save_final_bands and passes the bands it read; the UPDATE is a
-- compare-and-set on them, so a concurrent edit makes this raise, not
-- overwrite. Only a released review can be edited (FR-148).
CREATE OR REPLACE FUNCTION public.fn_mock_exam_score_edit(
    p_exam_id    uuid,
    p_sitting_id uuid,
    p_skill      text,
    p_reason     text,
    p_actor_id   uuid,
    p_expected   jsonb,
    p_new        jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE
    v_review uuid;
    v_edit   uuid;
BEGIN
    IF p_new->p_skill IS NULL OR jsonb_typeof(p_new->p_skill) <> 'number' THEN
        RAISE EXCEPTION 'mock_score_edit_band_missing' USING ERRCODE = '22023';
    END IF;
    UPDATE mock_exam_reviews r
       SET final_bands = p_new
     WHERE r.sitting_id = p_sitting_id
       AND r.status = 'released'
       AND r.final_bands = p_expected
       AND EXISTS (SELECT 1 FROM mock_exam_sittings s
                    WHERE s.id = p_sitting_id AND s.mock_exam_id = p_exam_id)
    RETURNING r.id INTO v_review;
    IF v_review IS NULL THEN
        RAISE EXCEPTION 'mock_score_edit_conflict' USING ERRCODE = '40001';
    END IF;
    INSERT INTO mock_exam_score_edits (sitting_id, skill, old_band, new_band, reason, actor_id)
    VALUES (p_sitting_id, p_skill, (p_expected->>p_skill)::numeric,
            (p_new->>p_skill)::numeric, btrim(p_reason), p_actor_id)
    RETURNING id INTO v_edit;
    INSERT INTO mock_exam_events (exam_id, sitting_id, kind, payload, actor_id)
    VALUES (p_exam_id, p_sitting_id, 'score_edited',
            jsonb_build_object('skill', p_skill, 'old_band', p_expected->p_skill,
                               'new_band', p_new->p_skill, 'overall', p_new->'overall',
                               'edit_id', v_edit),
            p_actor_id);
    RETURN jsonb_build_object('review_id', v_review, 'edit_id', v_edit, 'final_bands', p_new);
END;
$fn$;
REVOKE ALL ON FUNCTION public.fn_mock_exam_score_edit(uuid, uuid, text, text, uuid, jsonb, jsonb)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_mock_exam_score_edit(uuid, uuid, text, text, uuid, jsonb, jsonb)
    TO service_role;

-- 5. Privileges -------------------------------------------------------------
ALTER TABLE public.mock_exam_score_edits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mock_exam_score_edits FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.mock_exam_score_edits TO service_role;

-- 6. Postconditions ----------------------------------------------------------
DO $post$
BEGIN
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.mock_exam_score_edits'::regclass) THEN
        RAISE EXCEPTION 'mock_exam_448_rls_disabled';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.mock_exam_score_edits'::regclass) THEN
        RAISE EXCEPTION 'mock_exam_448_unexpected_policy';
    END IF;
    IF has_table_privilege('anon', 'public.mock_exam_score_edits', 'SELECT')
       OR has_table_privilege('authenticated', 'public.mock_exam_score_edits', 'SELECT') THEN
        RAISE EXCEPTION 'mock_exam_448_client_grant';
    END IF;
    IF has_table_privilege('service_role', 'public.mock_exam_score_edits', 'UPDATE')
       OR has_table_privilege('service_role', 'public.mock_exam_score_edits', 'DELETE') THEN
        RAISE EXCEPTION 'mock_exam_448_not_append_only';
    END IF;
    IF to_regprocedure('public.fn_mock_exam_score_edit(uuid,uuid,text,text,uuid,jsonb,jsonb)') IS NULL THEN
        RAISE EXCEPTION 'mock_exam_448_score_edit_function_missing';
    END IF;
    IF to_regclass('public.uq_mock_exam_events_release_key') IS NULL THEN
        RAISE EXCEPTION 'mock_exam_448_release_key_index_missing';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'mock_exam_sittings'
                      AND column_name = 'released_skills') THEN
        RAISE EXCEPTION 'mock_exam_448_released_skills_missing';
    END IF;
END;
$post$;

COMMIT;

NOTIFY pgrst, 'reload schema';
