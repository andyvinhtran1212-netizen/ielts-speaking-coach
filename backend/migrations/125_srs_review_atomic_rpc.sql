-- Migration: 125_srs_review_atomic_rpc.sql
-- Audit 2026-07-03 L8 (LOW-MEDIUM): SRS review submit is a read-then-write that
-- loses increments under concurrency.
--
-- routers/flashcards.py POST review did: SELECT review_count/interval/ease →
-- compute in Python → UPSERT. Two concurrent reviews of the SAME card (two tabs)
-- both read review_count=N, both write N+1 → one increment lost, so the mastery
-- threshold (which keys on review_count) under-counts.
--
-- Fix without duplicating the SM-2 formula in SQL: the Python `update_srs` stays
-- the single source of truth for the DERIVED fields (interval_days, ease_factor,
-- next_review_at) — those are last-writer-wins under a rare double-review, which
-- is acceptable. The ACCUMULATING fields (review_count, lapse_count) — the ones
-- the audit flagged — are incremented SERVER-SIDE inside the atomic UPSERT, so
-- concurrent reviews each add their delta with no lost update.
--
-- p_lapse_delta is the rating-determined increment (0 or 1), so it does not
-- depend on the possibly-stale value the caller read.
--
-- Idempotent: CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION fn_apply_srs_review(
    p_user_id          uuid,
    p_vocab_id         uuid,
    p_interval         integer,
    p_ease             real,
    p_lapse_delta      integer,
    p_last_reviewed_at timestamptz,
    p_next_review_at   timestamptz
)
RETURNS TABLE (
    interval_days    integer,
    ease_factor      real,
    review_count     integer,
    lapse_count      integer,
    last_reviewed_at timestamptz,
    next_review_at   timestamptz
)
-- Pin search_path so a malicious one can't shadow flashcard_reviews (matches the
-- hardening in migrations 108 / 113).
LANGUAGE sql
SET search_path = public, pg_temp
AS $$
    INSERT INTO flashcard_reviews AS fr (
        user_id, vocabulary_id, interval_days, ease_factor,
        review_count, lapse_count, last_reviewed_at, next_review_at, updated_at
    )
    VALUES (
        p_user_id, p_vocab_id, p_interval, p_ease,
        1, GREATEST(p_lapse_delta, 0), p_last_reviewed_at, p_next_review_at, p_last_reviewed_at
    )
    ON CONFLICT (user_id, vocabulary_id) DO UPDATE SET
        interval_days    = EXCLUDED.interval_days,
        ease_factor      = EXCLUDED.ease_factor,
        -- Server-side increments: read the committed value under the row lock the
        -- upsert already holds, so concurrent reviews don't clobber each other.
        review_count     = fr.review_count + 1,
        lapse_count      = fr.lapse_count + GREATEST(p_lapse_delta, 0),
        last_reviewed_at = EXCLUDED.last_reviewed_at,
        next_review_at   = EXCLUDED.next_review_at,
        updated_at       = EXCLUDED.updated_at
    RETURNING fr.interval_days, fr.ease_factor, fr.review_count,
              fr.lapse_count, fr.last_reviewed_at, fr.next_review_at;
$$;

COMMENT ON FUNCTION fn_apply_srs_review IS
    'Audit 2026-07-03 L8: atomic SRS review write. Derived fields (interval/ease/next) from the Python SM-2 formula; review_count/lapse_count incremented server-side to avoid lost updates under concurrent reviews of the same card.';
