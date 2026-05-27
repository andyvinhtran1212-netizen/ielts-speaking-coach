-- Migration: 084_essay_regrade_requests.sql
-- Sprint 19.4 — student-initiated re-grade requests (cluster 19.x closure).
--
-- A student who disagrees with a delivered essay's feedback files ONE
-- regrade request with a reason; an admin accepts (→ essay un-delivered
-- back to 'reviewed' for re-handling) or rejects (with a note). UNIQUE
-- (essay_id) enforces the Phase-1 "1 regrade per essay" rule (D4) at the
-- DB layer. student_id is denormalised (derivable via essay→student) for
-- cheap admin-queue / student-history queries — same pattern as 19.2.
--
-- Reuses the shared update_updated_at_column() trigger (migration 033).

CREATE TABLE IF NOT EXISTS essay_regrade_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- One open request per essay (Phase 1). ON DELETE CASCADE: if the
    -- essay is removed the request is meaningless.
    essay_id   UUID NOT NULL UNIQUE REFERENCES writing_essays(id) ON DELETE CASCADE,
    student_id UUID NOT NULL        REFERENCES students(id)       ON DELETE CASCADE,

    reason     TEXT NOT NULL,                       -- 50–500 chars (API-enforced)

    -- Lifecycle: pending → accepted → fulfilled (re-delivered)
    --                    → rejected (terminal, with admin_response)
    status     TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted', 'rejected', 'fulfilled')),

    admin_response TEXT,                            -- note shown to student on reject
    admin_id       UUID REFERENCES users(id),       -- who actioned

    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actioned_at  TIMESTAMPTZ,                       -- accept/reject time
    fulfilled_at TIMESTAMPTZ                        -- re-delivery time
);

-- Admin queue hot path: pending requests. Partial — actioned rows leave
-- the index. Plus a per-student lookup for the student-side status check.
CREATE INDEX IF NOT EXISTS idx_regrade_requests_pending
    ON essay_regrade_requests (created_at DESC) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_regrade_requests_student
    ON essay_regrade_requests (student_id);
-- UNIQUE(essay_id) already provides the essay lookup index.

ALTER TABLE essay_regrade_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS regrade_requests_admin_all ON essay_regrade_requests;
CREATE POLICY regrade_requests_admin_all ON essay_regrade_requests
    FOR ALL TO authenticated
    USING      (public.is_current_user_admin())
    WITH CHECK (public.is_current_user_admin());

-- Student may read + create requests for their own essays.
DROP POLICY IF EXISTS regrade_requests_student_own ON essay_regrade_requests;
CREATE POLICY regrade_requests_student_own ON essay_regrade_requests
    FOR SELECT TO authenticated
    USING (student_id IN (SELECT id FROM students WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS regrade_requests_student_insert ON essay_regrade_requests;
CREATE POLICY regrade_requests_student_insert ON essay_regrade_requests
    FOR INSERT TO authenticated
    WITH CHECK (student_id IN (SELECT id FROM students WHERE user_id = auth.uid()));

DROP TRIGGER IF EXISTS update_essay_regrade_requests_updated_at ON essay_regrade_requests;
CREATE TRIGGER update_essay_regrade_requests_updated_at
    BEFORE UPDATE ON essay_regrade_requests
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE essay_regrade_requests IS
    'Student-initiated re-grade requests (Sprint 19.4). One per essay (UNIQUE). Accept un-delivers the essay to reviewed for admin re-handling; reject carries admin_response.';
