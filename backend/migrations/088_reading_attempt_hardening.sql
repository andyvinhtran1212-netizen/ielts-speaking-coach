-- Migration: 088_reading_attempt_hardening.sql
-- Sprint 20.9 — Codex audit P1-2 + P1-3 closure.
-- Forward-only.
--
-- Two integrity seams that 20.5 and 20.6 left as application-level conventions
-- become DB-enforced invariants:
--
--   1. (D2 — P1-2) Q7 "one active attempt" was enforced only by router code
--      (`_abandon_open_attempts` → INSERT). Two concurrent POSTs to
--      /attempts could both observe no in-progress row, then both insert
--      one — breaking the invariant. The partial unique index below makes
--      this impossible at the database level; the router catches the
--      ensuing unique-violation and retries (abandon-then-insert).
--
--   2. (D3 — P1-3) Per-question auto-save was a non-atomic read-modify-write
--      against the `reading_test_attempts.answers` JSONB array — two
--      overlapping PATCHes for different q_nums could each read the same
--      stale snapshot and lose the other's update. The new
--      `reading_attempt_answers` table stores one row per (attempt, q_num),
--      and PATCH becomes an UPSERT-by-PK — intrinsically atomic in
--      PostgreSQL, no race possible between different q_nums.
--
-- `reading_test_attempts.answers` JSONB is KEPT for backward compatibility:
-- submit captures the final answer snapshot into it (immutable post-submit
-- history). In-progress reads/writes now go through the new table.

-- ── D2 — Partial unique index: one in_progress attempt per user+test ──

CREATE UNIQUE INDEX IF NOT EXISTS uniq_reading_test_attempts_active
    ON reading_test_attempts (user_id, test_id)
    WHERE status = 'in_progress';

COMMENT ON INDEX uniq_reading_test_attempts_active IS
    'Sprint 20.9 D2 — enforces Q7 "one active attempt per user+test" at the '
    'database level. Router POST /attempts handles unique-violation by '
    'retrying its abandon-then-insert sequence (newest start wins).';

-- ── D3 — Per-question answer rows ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS reading_attempt_answers (
    attempt_id  UUID NOT NULL
                REFERENCES reading_test_attempts(id) ON DELETE CASCADE,
    q_num       INTEGER NOT NULL CHECK (q_num >= 1 AND q_num <= 40),
    user_answer TEXT    NOT NULL DEFAULT '',
    answered_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    PRIMARY KEY (attempt_id, q_num)
);

CREATE INDEX IF NOT EXISTS idx_reading_attempt_answers_attempt
    ON reading_attempt_answers (attempt_id);

-- RLS — read/write only the rows attached to your own attempts.
-- Authorization is mirrored from reading_test_attempts (user_id = auth.uid()).
ALTER TABLE reading_attempt_answers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users own their reading attempt answers" ON reading_attempt_answers;
CREATE POLICY "Users own their reading attempt answers"
    ON reading_attempt_answers FOR ALL
    USING (EXISTS (
        SELECT 1 FROM reading_test_attempts a
        WHERE a.id = attempt_id AND a.user_id = auth.uid()
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM reading_test_attempts a
        WHERE a.id = attempt_id AND a.user_id = auth.uid()
    ));

COMMENT ON TABLE reading_attempt_answers IS
    'Sprint 20.9 D3 — per-(attempt, q_num) answer rows. The PATCH /answers '
    'autosave endpoint UPSERTs into this table by PK, so concurrent PATCHes '
    'for different q_nums cannot lose each other (intrinsically atomic). '
    'Replaces the read-modify-write JSONB-array pattern that 20.6 inherited '
    'from listening. The reading_test_attempts.answers JSONB is kept as the '
    'post-submit immutable snapshot.';
COMMENT ON COLUMN reading_attempt_answers.attempt_id IS
    'FK to reading_test_attempts; ON DELETE CASCADE so dropping an attempt '
    'cleans up its in-flight answers.';
COMMENT ON COLUMN reading_attempt_answers.q_num IS
    'Question number 1..40 — bounded by the IELTS L3 reading test size and '
    'enforced by CHECK so out-of-range PATCHes are rejected at the DB layer '
    'in addition to the Pydantic guard in the router.';
