-- ============================================================================
-- Migration 119 — quiz progress (Quick-Check player, Pha 2)
-- ============================================================================
-- Per-session/per-attempt/per-word progress for the Adaptive Mastery player.
-- The mastery LOOP runs client-side; these tables persist what the client
-- reports so we can (a) resume carry-over across sessions and (b) later compute
-- "từ dễ sai" / per-skill weakness analytics (§5/§7 of the plan).
--
-- Owner-scoped RLS (auth.uid() = user_id) like d1_sessions; the backend also
-- writes via supabase_admin (service-role) scoped by user_id in code.
--
-- ADDITIVE. Depends on mig 118 (quiz_banks). Apply by hand BEFORE merge.
-- ============================================================================

-- ── quiz_sessions ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS quiz_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    bank_id         UUID NOT NULL REFERENCES quiz_banks(id) ON DELETE CASCADE,
    code            TEXT,

    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at        TIMESTAMPTZ,
    duration_sec    INT,
    total_questions INT NOT NULL DEFAULT 0,
    total_correct   INT NOT NULL DEFAULT 0,
    total_wrong     INT NOT NULL DEFAULT 0,
    accuracy        REAL,
    words_mastered      INT NOT NULL DEFAULT 0,
    words_carried_over  INT NOT NULL DEFAULT 0,
    ended_by        TEXT,             -- 'completed' | 'time_cap' | 'paused'

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_quiz_sessions_user ON quiz_sessions (user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_quiz_sessions_bank ON quiz_sessions (bank_id);

ALTER TABLE quiz_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS quiz_sessions_select ON quiz_sessions;
CREATE POLICY quiz_sessions_select ON quiz_sessions FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS quiz_sessions_insert ON quiz_sessions;
CREATE POLICY quiz_sessions_insert ON quiz_sessions FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS quiz_sessions_update ON quiz_sessions;
CREATE POLICY quiz_sessions_update ON quiz_sessions
    USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── quiz_attempts (one row per answered question) ───────────────────────────
CREATE TABLE IF NOT EXISTS quiz_attempts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    session_id      UUID NOT NULL REFERENCES quiz_sessions(id) ON DELETE CASCADE,
    bank_id         UUID NOT NULL REFERENCES quiz_banks(id) ON DELETE CASCADE,

    item_key        TEXT NOT NULL,
    question_id     UUID REFERENCES quiz_questions(id) ON DELETE SET NULL,
    qid             TEXT,
    skill           TEXT,
    type            TEXT,
    subtype         TEXT,
    is_correct      BOOLEAN NOT NULL,
    answer_given    TEXT,
    response_time_ms INT,
    attempt_no      INT,
    -- client-generated idempotency key: a retried or keepalive-on-unload re-send
    -- of the same attempt is deduped (the backend upserts ON CONFLICT DO NOTHING)
    -- so per-question analytics aren't skewed by duplicate inserts.
    client_id       UUID,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Re-run safety: CREATE TABLE IF NOT EXISTS is a no-op if the table was created by
-- an earlier version of this migration, so columns added later won't appear.
-- ADD COLUMN IF NOT EXISTS backfills them (no-op on a fresh table).
ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS client_id UUID;

CREATE INDEX IF NOT EXISTS idx_quiz_attempts_session ON quiz_attempts (session_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_bank_item ON quiz_attempts (bank_id, item_key);
-- Plain (non-partial) unique index so it can serve as the ON CONFLICT (client_id)
-- target for the idempotent upsert. Postgres treats NULLs as distinct, so rows
-- without a client_id are still allowed (no false collisions).
CREATE UNIQUE INDEX IF NOT EXISTS uq_quiz_attempts_client_id
    ON quiz_attempts (client_id);

ALTER TABLE quiz_attempts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS quiz_attempts_select ON quiz_attempts;
CREATE POLICY quiz_attempts_select ON quiz_attempts FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS quiz_attempts_insert ON quiz_attempts;
CREATE POLICY quiz_attempts_insert ON quiz_attempts FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ── quiz_word_stats (one row per (user, bank, word) — survives sessions) ────
CREATE TABLE IF NOT EXISTS quiz_word_stats (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    bank_id         UUID NOT NULL REFERENCES quiz_banks(id) ON DELETE CASCADE,
    last_session_id UUID REFERENCES quiz_sessions(id) ON DELETE SET NULL,

    item_key        TEXT NOT NULL,
    correct_count   INT NOT NULL DEFAULT 0,
    wrong_count     INT NOT NULL DEFAULT 0,
    first_try_correct BOOLEAN,
    attempts_to_master INT,
    status          TEXT NOT NULL DEFAULT 'testing',  -- testing|provisional|mastered|carried_over
    is_difficult    BOOLEAN NOT NULL DEFAULT FALSE,
    skills_passed   JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- carry-over truth: the unconfirmed-MCQ skill + production flag + confirmed-
    -- credit count so a resumed session rehydrates full mastery state (incl.
    -- require_distinct_skill:false banks), not just confirmed skills_passed.
    provisional_skill TEXT,
    production_done   BOOLEAN NOT NULL DEFAULT FALSE,
    credit_count      INT NOT NULL DEFAULT 0,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (user_id, bank_id, item_key)   -- resume key
);
-- Re-run safety (see note above): backfill columns added after the table's first
-- creation so re-applying this migration on a partially-applied DB succeeds.
ALTER TABLE quiz_word_stats ADD COLUMN IF NOT EXISTS provisional_skill TEXT;
ALTER TABLE quiz_word_stats ADD COLUMN IF NOT EXISTS production_done BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE quiz_word_stats ADD COLUMN IF NOT EXISTS credit_count INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_quiz_word_stats_user_bank ON quiz_word_stats (user_id, bank_id);

DROP TRIGGER IF EXISTS trg_quiz_word_stats_updated_at ON quiz_word_stats;
CREATE TRIGGER trg_quiz_word_stats_updated_at
    BEFORE UPDATE ON quiz_word_stats
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE quiz_word_stats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS quiz_word_stats_select ON quiz_word_stats;
CREATE POLICY quiz_word_stats_select ON quiz_word_stats FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS quiz_word_stats_insert ON quiz_word_stats;
CREATE POLICY quiz_word_stats_insert ON quiz_word_stats FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS quiz_word_stats_update ON quiz_word_stats;
CREATE POLICY quiz_word_stats_update ON quiz_word_stats
    USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── Reverse (run manually if needed) ────────────────────────────────────────
-- DROP TABLE IF EXISTS quiz_word_stats;
-- DROP TABLE IF EXISTS quiz_attempts;
-- DROP TABLE IF EXISTS quiz_sessions;
