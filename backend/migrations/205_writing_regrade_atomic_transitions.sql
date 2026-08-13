-- Migration: 205_writing_regrade_atomic_transitions.sql
-- Mô tả: đóng hai khe saga trong vòng đời yêu cầu chấm lại Writing.
--
-- Trước migration này, Accept ghi writing_essays rồi mới ghi
-- essay_regrade_requests; re-deliver làm chiều ngược lại nhưng bước fulfil chỉ
-- best-effort. Một lỗi giữa hai câu UPDATE khiến học viên và admin nhìn hai sự
-- thật khác nhau. Hai RPC dưới đây khoá dòng và đổi cả hai bảng trong CÙNG giao
-- dịch. Chỉ backend service_role được gọi trực tiếp.

BEGIN;

CREATE OR REPLACE FUNCTION fn_list_writing_regrade_requests(
    p_status    TEXT DEFAULT NULL,
    p_cohort_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    WITH ranked AS (
        SELECT r.*,
               ROW_NUMBER() OVER (
                   PARTITION BY r.status
                   ORDER BY r.created_at DESC, r.id DESC
               ) AS lane_rank,
               COUNT(*) OVER (PARTITION BY r.status) AS lane_total
          FROM essay_regrade_requests AS r
          LEFT JOIN students AS s ON s.id = r.student_id
         WHERE (p_status IS NULL OR r.status = p_status)
           AND (p_cohort_id IS NULL OR s.cohort_id = p_cohort_id)
    )
    SELECT jsonb_build_object(
        'requests', COALESCE(
            jsonb_agg(to_jsonb(ranked) - 'lane_rank' - 'lane_total'
                      ORDER BY created_at DESC, id DESC)
                FILTER (WHERE lane_rank <= 300),
            '[]'::JSONB
        ),
        'capped', COALESCE(BOOL_OR(lane_total > 300), FALSE)
    )
      FROM ranked;
$$;

CREATE OR REPLACE FUNCTION fn_action_writing_regrade_request(
    p_request_id UUID,
    p_admin_id   UUID,
    p_action     TEXT,
    p_response   TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_request essay_regrade_requests%ROWTYPE;
    v_essay   writing_essays%ROWTYPE;
    v_now     TIMESTAMPTZ := NOW();
BEGIN
    IF p_action NOT IN ('accept', 'reject') THEN
        RETURN jsonb_build_object('ok', FALSE, 'reason', 'invalid_action');
    END IF;

    IF p_action = 'reject' THEN
        SELECT * INTO v_request
          FROM essay_regrade_requests
         WHERE id = p_request_id
         FOR UPDATE;

        IF NOT FOUND THEN
            RETURN jsonb_build_object('ok', FALSE, 'reason', 'not_found');
        END IF;
        IF v_request.status <> 'pending' THEN
            RETURN jsonb_build_object(
                'ok', FALSE, 'reason', 'already_actioned',
                'status', v_request.status
            );
        END IF;
        IF NULLIF(BTRIM(p_response), '') IS NULL THEN
            RETURN jsonb_build_object('ok', FALSE, 'reason', 'response_required');
        END IF;

        UPDATE essay_regrade_requests
           SET status = 'rejected',
               admin_response = BTRIM(p_response),
               admin_id = p_admin_id,
               actioned_at = v_now
         WHERE id = p_request_id
         RETURNING * INTO v_request;
    ELSE
        -- Read identity without a lock, then take locks in the global delivery
        -- order: essay → request. Instructor delivery already owns the essay
        -- row before its fulfil trigger touches the request; reversing this
        -- order here would create a deadlock cycle.
        SELECT * INTO v_request
          FROM essay_regrade_requests
         WHERE id = p_request_id;

        IF NOT FOUND THEN
            RETURN jsonb_build_object('ok', FALSE, 'reason', 'not_found');
        END IF;

        SELECT * INTO v_essay
          FROM writing_essays
         WHERE id = v_request.essay_id
           AND deleted_at IS NULL
         FOR UPDATE;

        IF NOT FOUND THEN
            RETURN jsonb_build_object('ok', FALSE, 'reason', 'essay_not_found');
        END IF;

        -- Re-read under lock after waiting for the essay. A concurrent reject
        -- may have committed while we acquired that first lock.
        SELECT * INTO v_request
          FROM essay_regrade_requests
         WHERE id = p_request_id
         FOR UPDATE;

        IF NOT FOUND THEN
            RETURN jsonb_build_object('ok', FALSE, 'reason', 'not_found');
        END IF;
        IF v_request.status <> 'pending' THEN
            RETURN jsonb_build_object(
                'ok', FALSE, 'reason', 'already_actioned',
                'status', v_request.status
            );
        END IF;
        IF v_essay.status <> 'delivered' THEN
            RETURN jsonb_build_object(
                'ok', FALSE, 'reason', 'essay_not_delivered',
                'essay_status', v_essay.status
            );
        END IF;

        UPDATE writing_essays
           SET status = 'reviewed', delivered_at = NULL
         WHERE id = v_request.essay_id;

        UPDATE essay_regrade_requests
           SET status = 'accepted',
               admin_response = NULL,
               admin_id = p_admin_id,
               actioned_at = v_now
         WHERE id = p_request_id
         RETURNING * INTO v_request;
    END IF;

    RETURN jsonb_build_object('ok', TRUE, 'request', to_jsonb(v_request));
END;
$$;

CREATE OR REPLACE FUNCTION fn_deliver_writing_essay(
    p_essay_id      UUID,
    p_method        TEXT,
    p_hide_subbands BOOLEAN DEFAULT FALSE
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_essay writing_essays%ROWTYPE;
    v_now   TIMESTAMPTZ := NOW();
BEGIN
    -- Global lock order is essay → request. The UPDATE below fires the fulfil
    -- trigger, which acquires the request lock inside this same transaction.
    SELECT * INTO v_essay
      FROM writing_essays
     WHERE id = p_essay_id
       AND deleted_at IS NULL
     FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', FALSE, 'reason', 'not_found');
    END IF;
    IF v_essay.status <> 'reviewed' THEN
        RETURN jsonb_build_object(
            'ok', FALSE, 'reason', 'not_reviewed',
            'status', v_essay.status
        );
    END IF;

    UPDATE writing_essays
       SET delivered_at = v_now,
           delivery_method = p_method,
           status = 'delivered',
           hide_subbands = COALESCE(p_hide_subbands, FALSE)
     WHERE id = p_essay_id;

    RETURN jsonb_build_object('ok', TRUE, 'status', 'delivered');
END;
$$;

-- Instructor delivery owns additional review/note/version writes and therefore
-- cannot use fn_deliver_writing_essay directly. This trigger closes the same
-- accepted request inside whatever transaction changes an essay to delivered,
-- so every current/future delivery path gets the invariant automatically.
CREATE OR REPLACE FUNCTION fn_fulfil_writing_regrade_on_delivery()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.status = 'delivered' AND OLD.status IS DISTINCT FROM 'delivered' THEN
        UPDATE essay_regrade_requests
           SET status = 'fulfilled', fulfilled_at = COALESCE(NEW.delivered_at, NOW())
         WHERE essay_id = NEW.id
           AND status = 'accepted';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fulfil_writing_regrade_on_delivery ON writing_essays;
CREATE TRIGGER trg_fulfil_writing_regrade_on_delivery
    AFTER UPDATE OF status ON writing_essays
    FOR EACH ROW EXECUTE FUNCTION fn_fulfil_writing_regrade_on_delivery();

COMMENT ON FUNCTION fn_action_writing_regrade_request(UUID, UUID, TEXT, TEXT) IS
'Atomic admin accept/reject for a Writing regrade request. Accept also moves the delivered essay to reviewed in the same locked transaction.';

COMMENT ON FUNCTION fn_list_writing_regrade_requests(TEXT, UUID) IS
'Reads every status lane from one PostgreSQL statement snapshot, capped independently at 300 rows per lane.';

COMMENT ON FUNCTION fn_deliver_writing_essay(UUID, TEXT, BOOLEAN) IS
'Atomic reviewed-to-delivered transition. Any accepted regrade request is fulfilled in the same transaction.';

COMMENT ON FUNCTION fn_fulfil_writing_regrade_on_delivery() IS
'Closes an accepted Writing regrade request in the same transaction as every essay delivery path, including Instructor delivery.';

REVOKE EXECUTE ON FUNCTION fn_action_writing_regrade_request(UUID, UUID, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_action_writing_regrade_request(UUID, UUID, TEXT, TEXT)
    TO service_role;

REVOKE EXECUTE ON FUNCTION fn_list_writing_regrade_requests(TEXT, UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_list_writing_regrade_requests(TEXT, UUID)
    TO service_role;

REVOKE EXECUTE ON FUNCTION fn_deliver_writing_essay(UUID, TEXT, BOOLEAN)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_deliver_writing_essay(UUID, TEXT, BOOLEAN)
    TO service_role;

REVOKE EXECUTE ON FUNCTION fn_fulfil_writing_regrade_on_delivery()
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_fulfil_writing_regrade_on_delivery()
    TO service_role;

COMMIT;

-- Kiểm sau khi chạy:
-- SELECT has_function_privilege('anon',
--          'fn_action_writing_regrade_request(uuid,uuid,text,text)', 'EXECUTE') AS anon_action,
--        has_function_privilege('authenticated',
--          'fn_deliver_writing_essay(uuid,text,boolean)', 'EXECUTE') AS user_deliver,
--        has_function_privilege('service_role',
--          'fn_action_writing_regrade_request(uuid,uuid,text,text)', 'EXECUTE') AS backend_action;
-- Kỳ vọng: f | f | t
