-- 100_user_feedback.sql
-- User feedback for Reading + Listening tests (feature: Feedback).
--
-- ONE polymorphic table (discriminated by skill + type) rather than per-skill
-- tables: a single FK cannot span reading_tests + listening_tests, and the
-- established precedent for cross-cutting records is exactly this — error_logs
-- (polymorphic frontend/backend, admin-only) and access_code_audit (FK-free by
-- design, "to survive hard-delete"). attempt_id is polymorphic across
-- reading_test_attempts / listening_test_attempts → NO FK (gated by `skill`).
-- Questions are referenced by `q_num` (the review payload has no question_id PK).
--
-- Decisions (Phase A, chốt):
--   • anon reading takers may submit feedback via anon_id (created_by NULL);
--   • one rating per attempt per identity (unique indexes below); report/flag
--     are uncapped;
--   • note is admin-only (RLS admins-read; backend serves via service-role);
--   • test_id (text) is DENORMALISED for admin grouping — no FK.
--
-- Three feedback types:
--   rating — post-review survey: rating_de (1-5) [+ rating_audio (1-5) listening] + optional note
--   report — "báo lỗi đề" modal: category + note (+ optional q_num)
--   flag   — per-question "flag bài giải" on a review card: q_num (+ optional note)

CREATE TABLE IF NOT EXISTS user_feedback (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type         TEXT NOT NULL CHECK (type IN ('rating', 'report', 'flag')),
    skill        TEXT NOT NULL CHECK (skill IN ('reading', 'listening')),
    attempt_id   UUID,                       -- reading/listening_test_attempts.id (no FK: polymorphic)
    test_id      TEXT,                       -- denormalised human id (ILR-…) for admin grouping
    q_num        INTEGER,                    -- flag/report target question (NULL for a test-level rating)
    rating_de    SMALLINT CHECK (rating_de    IS NULL OR (rating_de    BETWEEN 1 AND 5)),  -- "Chất lượng đề"
    rating_audio SMALLINT CHECK (rating_audio IS NULL OR (rating_audio BETWEEN 1 AND 5)),  -- listening only
    category     TEXT,                       -- report error-type chip
    note         TEXT,                       -- optional comment / description (ADMIN-ONLY)
    status       TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'resolved')),
    created_by   UUID REFERENCES users(id) ON DELETE SET NULL,   -- NULL for anonymous reading takers
    anon_id      TEXT,                       -- mirrors reading_test_attempts.anon_id (share-link takers)
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at  TIMESTAMPTZ,
    resolved_by  UUID REFERENCES users(id) ON DELETE SET NULL
);

-- Anti-spam: ONE rating per attempt per identity. report/flag stay uncapped.
CREATE UNIQUE INDEX IF NOT EXISTS uq_feedback_rating_user
    ON user_feedback (attempt_id, created_by)
    WHERE type = 'rating' AND created_by IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_feedback_rating_anon
    ON user_feedback (attempt_id, anon_id)
    WHERE type = 'rating' AND anon_id IS NOT NULL;

-- Admin inbox: list grouped by test, filter skill/status, newest first.
CREATE INDEX IF NOT EXISTS ix_feedback_inbox
    ON user_feedback (skill, status, test_id, created_at DESC);

-- RLS is defensive only — the backend reads/writes via the service-role client
-- (which bypasses RLS) and gates admin reads with require_admin in the router.
-- Mirrors error_logs (admins-read).
ALTER TABLE user_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read feedback" ON user_feedback;
CREATE POLICY "admins read feedback"
    ON user_feedback FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin'
    ));
