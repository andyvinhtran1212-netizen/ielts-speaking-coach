-- Migration: 226_course_multisection_results.sql
-- Mô tả: lưu kết quả canonical cho các phần đọc/nghe của bài tập theo buổi và
-- thời lượng của các phần viết/phát âm để điểm tổng hợp có thể kiểm toán được.
--
-- Apply (không chạy trong PR này):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f backend/migrations/226_course_multisection_results.sql

BEGIN;

CREATE TABLE IF NOT EXISTS course_section_submissions (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bank_id                  UUID NOT NULL REFERENCES quiz_banks(id) ON DELETE CASCADE,
    user_id                  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    -- Giữ lịch sử nếu item bị xoá ngoài đường chuẩn; RPC bên dưới vẫn chặn xoá
    -- bài giao khi có bằng chứng và sẽ không chủ động tạo NULL.
    class_assignment_item_id UUID
        REFERENCES class_assignment_items(id) ON DELETE SET NULL,
    section                  TEXT NOT NULL,
    answers                  JSONB NOT NULL DEFAULT '{}'::jsonb,
    answer_key               JSONB NOT NULL DEFAULT '[]'::jsonb,
    total                    INTEGER NOT NULL CHECK (total > 0),
    correct                  INTEGER NOT NULL CHECK (correct >= 0 AND correct <= total),
    score                    NUMERIC(5,2) NOT NULL CHECK (score >= 0 AND score <= 100),
    duration_sec             INTEGER NOT NULL DEFAULT 0 CHECK (duration_sec >= 0),
    submitted_at             TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_at               TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    CONSTRAINT course_section_submissions_section_check
        CHECK (section IN ('reading', 'listening')),
    CONSTRAINT course_section_submissions_answers_object
        CHECK (jsonb_typeof(answers) = 'object'),
    CONSTRAINT course_section_submissions_key_array
        CHECK (jsonb_typeof(answer_key) = 'array'),
    CONSTRAINT course_section_submissions_item_section_unique
        UNIQUE (class_assignment_item_id, section)
);

CREATE INDEX IF NOT EXISTS idx_course_section_submissions_user_bank
    ON course_section_submissions (user_id, bank_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_course_section_submissions_item
    ON course_section_submissions (class_assignment_item_id, section);

ALTER TABLE course_writing_submissions
    ADD COLUMN IF NOT EXISTS duration_sec INTEGER NOT NULL DEFAULT 0;
ALTER TABLE course_writing_submissions
    DROP CONSTRAINT IF EXISTS course_writing_submissions_duration_nonnegative;
ALTER TABLE course_writing_submissions
    ADD CONSTRAINT course_writing_submissions_duration_nonnegative
        CHECK (duration_sec >= 0);

ALTER TABLE course_pronunciation_submissions
    ADD COLUMN IF NOT EXISTS duration_sec INTEGER NOT NULL DEFAULT 0;
ALTER TABLE course_pronunciation_submissions
    DROP CONSTRAINT IF EXISTS course_pronunciation_submissions_duration_nonnegative;
ALTER TABLE course_pronunciation_submissions
    ADD CONSTRAINT course_pronunciation_submissions_duration_nonnegative
        CHECK (duration_sec >= 0);

COMMENT ON TABLE course_section_submissions IS
    'Kết quả chốt một lần cho phần đọc/nghe của một mục bài giao; draft vẫn ở client và không phải kết quả.';
COMMENT ON COLUMN course_section_submissions.answer_key IS
    'Bản chụp đáp án/lời giải tại thời điểm nộp để kết quả không trôi khi bank được nhập lại.';
COMMENT ON COLUMN course_section_submissions.duration_sec IS
    'Thời gian hoạt động do client đo cho riêng phần này; không suy từ khoảng mở tab.';

-- Học viên chỉ đi qua API đã kiểm tra bài giao. Không mở policy PostgREST.
ALTER TABLE course_section_submissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.course_section_submissions
    FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.course_section_submissions TO service_role;

-- Nâng hàng rào xoá bài giao của mig 196. Nếu không thêm hai bảng mới, một bài
-- đã nộp đọc/nghe hoặc phát âm nhưng chưa chốt ledger vẫn bị RPC coi là trắng
-- và xoá; FK CASCADE/SET NULL sau đó làm mất hoặc tách bằng chứng khỏi bài giao.
CREATE OR REPLACE FUNCTION fn_delete_class_assignment_if_unsubmitted(
    p_assignment_id UUID,
    p_cohort_id     UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_exists    BOOLEAN;
    v_submitted BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM class_assignments
         WHERE id = p_assignment_id
           AND cohort_id = p_cohort_id
           FOR UPDATE
    ) INTO v_exists;

    IF v_exists IS NOT TRUE THEN
        RETURN NULL;
    END IF;

    PERFORM 1 FROM class_assignment_items
      WHERE assignment_id = p_assignment_id
      FOR UPDATE;

    PERFORM 1 FROM sessions s
      JOIN class_assignment_items i ON i.id = s.class_assignment_item_id
     WHERE i.assignment_id = p_assignment_id FOR UPDATE OF s;
    PERFORM 1 FROM reading_test_attempts r
      JOIN class_assignment_items i ON i.id = r.class_assignment_item_id
     WHERE i.assignment_id = p_assignment_id FOR UPDATE OF r;
    PERFORM 1 FROM listening_test_attempts l
      JOIN class_assignment_items i ON i.id = l.class_assignment_item_id
     WHERE i.assignment_id = p_assignment_id FOR UPDATE OF l;
    PERFORM 1 FROM quiz_sessions q
      JOIN class_assignment_items i ON i.id = q.class_assignment_item_id
     WHERE i.assignment_id = p_assignment_id FOR UPDATE OF q;
    PERFORM 1 FROM course_writing_submissions w
      JOIN class_assignment_items i ON i.id = w.class_assignment_item_id
     WHERE i.assignment_id = p_assignment_id FOR UPDATE OF w;
    PERFORM 1 FROM course_section_submissions c
      JOIN class_assignment_items i ON i.id = c.class_assignment_item_id
     WHERE i.assignment_id = p_assignment_id FOR UPDATE OF c;
    PERFORM 1 FROM course_pronunciation_submissions p
      JOIN class_assignment_items i ON i.id = p.class_assignment_item_id
     WHERE i.assignment_id = p_assignment_id FOR UPDATE OF p;

    SELECT EXISTS (
        SELECT 1
          FROM class_assignment_items i
         WHERE i.assignment_id = p_assignment_id
           AND (
                i.submitted_at IS NOT NULL
             OR EXISTS (SELECT 1 FROM sessions s
                         WHERE s.class_assignment_item_id = i.id
                           AND s.status = 'completed')
             OR EXISTS (SELECT 1 FROM reading_test_attempts r
                         WHERE r.class_assignment_item_id = i.id
                           AND r.status = 'submitted')
             OR EXISTS (SELECT 1 FROM listening_test_attempts l
                         WHERE l.class_assignment_item_id = i.id
                           AND l.status = 'submitted')
             OR EXISTS (SELECT 1 FROM quiz_sessions q
                         WHERE q.class_assignment_item_id = i.id
                           AND q.ended_by = 'completed')
             OR EXISTS (SELECT 1 FROM course_writing_submissions w
                         WHERE w.class_assignment_item_id = i.id)
             OR EXISTS (SELECT 1 FROM course_section_submissions c
                         WHERE c.class_assignment_item_id = i.id)
             OR EXISTS (SELECT 1 FROM course_pronunciation_submissions p
                         WHERE p.class_assignment_item_id = i.id)
           )
    ) INTO v_submitted;

    IF v_submitted THEN
        RETURN FALSE;
    END IF;

    DELETE FROM class_assignments WHERE id = p_assignment_id;
    RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION fn_delete_class_assignment_if_unsubmitted IS
'Xoá bài giao chỉ khi chưa có bất kỳ bằng chứng làm bài nào. Mig 226 bổ sung
course_section_submissions và course_pronunciation_submissions vào phép kiểm có
khoá dòng. NULL = không tìm thấy, FALSE = đã có bài, TRUE = đã xoá.';

REVOKE EXECUTE ON FUNCTION fn_delete_class_assignment_if_unsubmitted(uuid, uuid)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fn_delete_class_assignment_if_unsubmitted(uuid, uuid)
    TO service_role;

COMMIT;

-- Verify (read-only):
-- SELECT column_name, data_type FROM information_schema.columns
--  WHERE table_name IN ('course_section_submissions',
--                       'course_writing_submissions',
--                       'course_pronunciation_submissions')
--    AND column_name IN ('section', 'score', 'duration_sec')
--  ORDER BY table_name, ordinal_position;
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--  WHERE conrelid = 'course_section_submissions'::regclass;
-- SELECT role_name, privilege_type,
--        has_table_privilege(role_name, 'public.course_section_submissions', privilege_type)
--   FROM (VALUES ('anon'), ('authenticated'), ('service_role')) roles(role_name)
--  CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
--                     ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) privileges(privilege_type)
--  ORDER BY role_name, privilege_type;
-- SELECT prosrc LIKE '%course_section_submissions c%' AS co_doc_nghe,
--        prosrc LIKE '%course_pronunciation_submissions p%' AS co_phat_am
--   FROM pg_proc WHERE proname = 'fn_delete_class_assignment_if_unsubmitted';
