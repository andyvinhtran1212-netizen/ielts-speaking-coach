-- Migration: 204_reconcile_course_and_gate_e_schema.sql
-- Mô tả: Khôi phục final schema cho production từng được provision thủ công
-- một phần ngoài forward-migration ledger.
--
-- Migration này cố ý lặp lại final contract của 189 và 200–202 theo dạng
-- idempotent. Trên môi trường đã chạy đủ 173–203, nó là no-op về dữ liệu. Trên
-- production lệch ledger, nó chỉ bổ sung constraint pairing còn thiếu và ba
-- contract Gate E chưa tồn tại. Không migration lịch sử nào được replay mù.
--
-- QUAN TRỌNG: production không được chạy file này qua forward runner thông
-- thường khi ledger 173–203 còn lệch. Dùng procedure fail-closed:
--   DRY_RUN=1 python backend/scripts/reconcile_prod_gate_e_migrations.py "$DATABASE_URL"
--   ALLOW_PROD=1 python backend/scripts/reconcile_prod_gate_e_migrations.py "$DATABASE_URL"
-- Procedure chạy 204 trước, audit final state, rồi mới ghi đúng manifest lịch
-- sử đã kiểm; tuyệt đối không dùng `apply_migrations.sh --baseline` ở đây.

BEGIN;

-- ── Course assignment artifact truth ────────────────────────────────────────
-- Một artifact phải có cả kind lẫn id, hoặc không có cả hai. Kiểm dữ liệu trước
-- để migration fail closed thay vì âm thầm hợp thức hoá row mồ côi.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM class_assignment_items
         WHERE (artifact_kind IS NULL) <> (artifact_id IS NULL)
    ) THEN
        RAISE EXCEPTION 'class_assignment_items_artifact_pairing_violation'
            USING ERRCODE = '23514';
    END IF;

END;
$$;

-- Rebuild by its canonical name so a same-named but weaker hand-written check
-- cannot masquerade as the migration contract.
ALTER TABLE class_assignment_items
    DROP CONSTRAINT IF EXISTS class_assignment_items_artifact_pairing;
ALTER TABLE class_assignment_items
    ADD CONSTRAINT class_assignment_items_artifact_pairing CHECK (
        (artifact_kind IS NULL AND artifact_id IS NULL)
        OR (artifact_kind IS NOT NULL AND artifact_id IS NOT NULL)
    ) NOT VALID;

ALTER TABLE class_assignment_items
    VALIDATE CONSTRAINT class_assignment_items_artifact_pairing;

-- ── Speaking Full Test canonical attempt identity (final contract of 200) ───
ALTER TABLE sessions
    ADD COLUMN IF NOT EXISTS full_test_attempt_id UUID;

-- Legacy chains cannot be reconstructed reliably. A unique id per historical
-- row deliberately fails closed instead of joining unrelated Parts 1/2/3.
UPDATE sessions
   SET full_test_attempt_id = gen_random_uuid()
 WHERE mode = 'test_full'
   AND full_test_attempt_id IS NULL;

CREATE OR REPLACE FUNCTION set_speaking_full_test_attempt_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.mode = 'test_full' AND NEW.full_test_attempt_id IS NULL THEN
        NEW.full_test_attempt_id := gen_random_uuid();
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sessions_full_test_attempt_id ON sessions;
CREATE TRIGGER trg_sessions_full_test_attempt_id
    BEFORE INSERT OR UPDATE OF mode, full_test_attempt_id ON sessions
    FOR EACH ROW
    EXECUTE FUNCTION set_speaking_full_test_attempt_id();

CREATE UNIQUE INDEX IF NOT EXISTS uq_sessions_full_test_attempt_part
    ON sessions (full_test_attempt_id, part)
    WHERE mode = 'test_full' AND full_test_attempt_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sessions_full_test_attempt_id
    ON sessions (full_test_attempt_id)
    WHERE full_test_attempt_id IS NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conrelid = 'sessions'::regclass
           AND conname = 'sessions_full_test_attempt_required'
    ) THEN
        ALTER TABLE sessions
            ADD CONSTRAINT sessions_full_test_attempt_required
            CHECK (mode <> 'test_full' OR full_test_attempt_id IS NOT NULL)
            NOT VALID;
    END IF;
END;
$$;

ALTER TABLE sessions
    VALIDATE CONSTRAINT sessions_full_test_attempt_required;

COMMENT ON COLUMN sessions.full_test_attempt_id IS
    'Server-owned identity shared by exactly one Speaking Full Test Part 1/2/3 chain.';

-- ── Idempotent POST /sessions retry (final contract of 201) ─────────────────
CREATE OR REPLACE FUNCTION fn_create_session_daily_capped_v2(
    p_session_id uuid,
    p_user_id    uuid,
    p_mode       text,
    p_part       integer,
    p_topic      text,
    p_day_start  timestamptz,
    p_max_daily  integer
)
RETURNS SETOF sessions
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_count    integer;
    v_existing sessions%ROWTYPE;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text)::bigint);
    PERFORM pg_advisory_xact_lock(hashtext(p_session_id::text)::bigint);

    SELECT * INTO v_existing
      FROM sessions
     WHERE id = p_session_id;

    IF FOUND THEN
        IF v_existing.user_id IS DISTINCT FROM p_user_id
           OR v_existing.mode IS DISTINCT FROM p_mode
           OR v_existing.part IS DISTINCT FROM p_part
           OR v_existing.topic IS DISTINCT FROM p_topic THEN
            RAISE EXCEPTION 'session_id_conflict'
                USING ERRCODE = 'P0001';
        END IF;
        RETURN NEXT v_existing;
        RETURN;
    END IF;

    SELECT count(*) INTO v_count
      FROM sessions
     WHERE user_id = p_user_id
       AND started_at >= p_day_start;

    IF v_count >= p_max_daily THEN
        RAISE EXCEPTION 'daily_quota_exceeded'
            USING ERRCODE = 'P0001', HINT = v_count::text;
    END IF;

    RETURN QUERY
    INSERT INTO sessions (id, user_id, mode, part, topic, status)
    VALUES (p_session_id, p_user_id, p_mode, p_part, p_topic, 'in_progress')
    RETURNING *;
END;
$$;

COMMENT ON FUNCTION fn_create_session_daily_capped_v2 IS
    'Idempotent daily-capped session create. Same client UUID + owner + payload returns the existing row; conflicting reuse fails closed.';

-- ── Canonical response persistence timestamp (final contract of 202) ────────
ALTER TABLE responses
    ADD COLUMN IF NOT EXISTS persisted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();

COMMENT ON COLUMN responses.persisted_at IS
    'Server-authored first persistence time for rows created after migration 202; legacy rows are backfilled at migration time. Stable across response upsert retries and used only with fresh post-deploy evidence journeys.';

COMMIT;
