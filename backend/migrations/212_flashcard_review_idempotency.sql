-- Migration: 212_flashcard_review_idempotency.sql
-- One learner rating owns one durable client UUID. A lost HTTP acknowledgement
-- can therefore be replayed without incrementing SRS or the daily counter twice.

ALTER TABLE flashcard_review_log
    ADD COLUMN IF NOT EXISTS client_review_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_flashcard_review_log_user_client_review
    ON flashcard_review_log (user_id, client_review_id)
    WHERE client_review_id IS NOT NULL;

COMMENT ON COLUMN flashcard_review_log.client_review_id IS
    'Client-generated idempotency key. Reusing a key with the same vocabulary/rating replays the receipt; different input is rejected.';

CREATE OR REPLACE FUNCTION fn_apply_srs_review_idempotent(
    p_client_review_id uuid,
    p_vocab_id         uuid,
    p_rating           text,
    p_interval         integer,
    p_ease             real,
    p_lapse_delta      integer,
    p_last_reviewed_at timestamptz,
    p_next_review_at   timestamptz
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id uuid := auth.uid();
    v_log_id uuid;
    v_existing flashcard_review_log%ROWTYPE;
    v_review flashcard_reviews%ROWTYPE;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
    END IF;
    IF p_client_review_id IS NULL THEN
        RAISE EXCEPTION 'client_review_id is required' USING ERRCODE = '22023';
    END IF;
    IF p_rating NOT IN ('again', 'hard', 'good', 'easy') THEN
        RAISE EXCEPTION 'Unknown flashcard rating' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM user_vocabulary
         WHERE id = p_vocab_id
           AND user_id = v_user_id
           AND NOT is_archived
           AND NOT is_pending
    ) THEN
        RAISE EXCEPTION 'Vocabulary entry is not reviewable' USING ERRCODE = '22023';
    END IF;

    -- The unique index serializes concurrent calls with the same operation ID.
    -- If the SRS write later fails, PostgreSQL rolls this receipt back too.
    INSERT INTO flashcard_review_log (
        user_id, vocabulary_id, rating, client_review_id
    ) VALUES (
        v_user_id, p_vocab_id, p_rating, p_client_review_id
    )
    ON CONFLICT (user_id, client_review_id)
        WHERE client_review_id IS NOT NULL
        DO NOTHING
    RETURNING id INTO v_log_id;

    IF v_log_id IS NULL THEN
        SELECT * INTO v_existing
          FROM flashcard_review_log
         WHERE user_id = v_user_id
           AND client_review_id = p_client_review_id;

        IF NOT FOUND OR v_existing.vocabulary_id IS DISTINCT FROM p_vocab_id
           OR v_existing.rating IS DISTINCT FROM p_rating THEN
            RAISE EXCEPTION 'client_review_id is already bound to different input'
                USING ERRCODE = '22023';
        END IF;

        SELECT * INTO v_review
          FROM flashcard_reviews
         WHERE user_id = v_user_id
           AND vocabulary_id = p_vocab_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Persisted review receipt has no SRS state'
                USING ERRCODE = 'P0002';
        END IF;

        RETURN jsonb_build_object(
            'replayed', true,
            'interval_days', v_review.interval_days,
            'ease_factor', v_review.ease_factor,
            'review_count', v_review.review_count,
            'lapse_count', v_review.lapse_count,
            'last_reviewed_at', v_review.last_reviewed_at,
            'next_review_at', v_review.next_review_at
        );
    END IF;

    INSERT INTO flashcard_reviews AS fr (
        user_id, vocabulary_id, interval_days, ease_factor,
        review_count, lapse_count, last_reviewed_at, next_review_at, updated_at
    ) VALUES (
        v_user_id, p_vocab_id, p_interval, p_ease,
        1, GREATEST(COALESCE(p_lapse_delta, 0), 0),
        p_last_reviewed_at, p_next_review_at, p_last_reviewed_at
    )
    ON CONFLICT (user_id, vocabulary_id) DO UPDATE SET
        interval_days    = EXCLUDED.interval_days,
        ease_factor      = EXCLUDED.ease_factor,
        review_count     = fr.review_count + 1,
        lapse_count      = fr.lapse_count + GREATEST(COALESCE(p_lapse_delta, 0), 0),
        last_reviewed_at = EXCLUDED.last_reviewed_at,
        next_review_at   = EXCLUDED.next_review_at,
        updated_at       = EXCLUDED.updated_at
    RETURNING * INTO v_review;

    RETURN jsonb_build_object(
        'replayed', false,
        'interval_days', v_review.interval_days,
        'ease_factor', v_review.ease_factor,
        'review_count', v_review.review_count,
        'lapse_count', v_review.lapse_count,
        'last_reviewed_at', v_review.last_reviewed_at,
        'next_review_at', v_review.next_review_at
    );
END;
$$;

REVOKE ALL ON FUNCTION fn_apply_srs_review_idempotent(
    uuid, uuid, text, integer, real, integer, timestamptz, timestamptz
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_apply_srs_review_idempotent(
    uuid, uuid, text, integer, real, integer, timestamptz, timestamptz
) TO authenticated;

COMMENT ON FUNCTION fn_apply_srs_review_idempotent(
    uuid, uuid, text, integer, real, integer, timestamptz, timestamptz
) IS 'Atomically claims one client review ID, applies SRS once, and returns a replay-safe receipt.';

-- Rollback (manual):
-- DROP FUNCTION IF EXISTS fn_apply_srs_review_idempotent(uuid, uuid, text, integer, real, integer, timestamptz, timestamptz);
-- DROP INDEX IF EXISTS uq_flashcard_review_log_user_client_review;
-- ALTER TABLE flashcard_review_log DROP COLUMN IF EXISTS client_review_id;
