-- 027_flashcard_reviews.sql
-- Phase D Wave 2: SRS state per (user, vocabulary) + append-only review log
-- for daily rate-limit counting.
--
-- flashcard_reviews:
--   - One row per (user_id, vocabulary_id) — UPSERT on review.
--   - Holds the SM-2-inspired SRS fields (ease_factor, interval_days, etc.).
--   - SRS state is shared across stacks: reviewing word X in stack A and then
--     in stack B continues the same progression (acceptance criterion §12).
--
-- flashcard_review_log:
--   - Append-only audit row written on every successful review.
--   - Powers the per-user-per-day rate limit; flashcards can't reuse
--     vocabulary_exercise_attempts because that table FKs to
--     vocabulary_exercises and CHECKs exercise_type IN ('D1','D3').
--   - Kept in the same migration as flashcard_reviews because rolling back
--     SRS state without rolling back the rate-limit log would leave orphan
--     audit rows referencing a vanished feature.
--
-- Idempotent: safe to re-apply.


-- ── flashcard_reviews ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS flashcard_reviews (
    id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID         NOT NULL REFERENCES auth.users(id)     ON DELETE CASCADE,
    vocabulary_id     UUID         NOT NULL REFERENCES user_vocabulary(id) ON DELETE CASCADE,
    last_reviewed_at  TIMESTAMPTZ,
    next_review_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    ease_factor       REAL         NOT NULL DEFAULT 2.5
                                    CHECK (ease_factor >= 1.3 AND ease_factor <= 3.0),
    interval_days     INTEGER      NOT NULL DEFAULT 1
                                    CHECK (interval_days >= 0),
    review_count      INTEGER      NOT NULL DEFAULT 0
                                    CHECK (review_count >= 0),
    lapse_count       INTEGER      NOT NULL DEFAULT 0
                                    CHECK (lapse_count >= 0),
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, vocabulary_id)
);

-- Powers GET /api/flashcards/due — sorted ascending so the earliest-due
-- card pops first in the queue.
CREATE INDEX IF NOT EXISTS idx_flashcard_reviews_due
    ON flashcard_reviews (user_id, next_review_at);

ALTER TABLE flashcard_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS flashcard_reviews_select ON flashcard_reviews;
CREATE POLICY flashcard_reviews_select ON flashcard_reviews
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS flashcard_reviews_insert ON flashcard_reviews;
CREATE POLICY flashcard_reviews_insert ON flashcard_reviews
    FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS flashcard_reviews_update ON flashcard_reviews;
CREATE POLICY flashcard_reviews_update ON flashcard_reviews
    FOR UPDATE
    USING      (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS flashcard_reviews_delete ON flashcard_reviews;
CREATE POLICY flashcard_reviews_delete ON flashcard_reviews
    FOR DELETE USING (auth.uid() = user_id);


-- ── flashcard_review_log (rate-limit audit) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS flashcard_review_log (
    id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    vocabulary_id  UUID         REFERENCES user_vocabulary(id) ON DELETE SET NULL,
    rating         TEXT         NOT NULL CHECK (rating IN ('again','hard','good','easy')),
    reviewed_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_flashcard_review_log_user_day
    ON flashcard_review_log (user_id, reviewed_at DESC);

ALTER TABLE flashcard_review_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS flashcard_review_log_select ON flashcard_review_log;
CREATE POLICY flashcard_review_log_select ON flashcard_review_log
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS flashcard_review_log_insert ON flashcard_review_log;
CREATE POLICY flashcard_review_log_insert ON flashcard_review_log
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Append-only from the user's perspective — no UPDATE/DELETE policy so the
-- rate-limit count cannot be tampered with by the client.  Service-role
-- admin client retains full access for ops & cleanup.


-- ────────────────────────────────────────────────────────────────────────────
-- ROLLBACK SCRIPT (commented out, run manually if needed):
-- ────────────────────────────────────────────────────────────────────────────
-- DROP POLICY IF EXISTS flashcard_review_log_insert ON flashcard_review_log;
-- DROP POLICY IF EXISTS flashcard_review_log_select ON flashcard_review_log;
-- DROP INDEX  IF EXISTS idx_flashcard_review_log_user_day;
-- DROP TABLE  IF EXISTS flashcard_review_log CASCADE;
--
-- DROP POLICY IF EXISTS flashcard_reviews_delete ON flashcard_reviews;
-- DROP POLICY IF EXISTS flashcard_reviews_update ON flashcard_reviews;
-- DROP POLICY IF EXISTS flashcard_reviews_insert ON flashcard_reviews;
-- DROP POLICY IF EXISTS flashcard_reviews_select ON flashcard_reviews;
-- DROP INDEX  IF EXISTS idx_flashcard_reviews_due;
-- DROP TABLE  IF EXISTS flashcard_reviews CASCADE;
