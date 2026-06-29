-- Migration: 115_writing_assignment_grading_tier.sql
-- Mô tả: Cho GIÁO VIÊN chọn TIER chấm (standard / deep) khi giao bài writing,
--        song song với analysis_level (mig 104). Bài giáo viên giao VẪN vào
--        hàng đợi review như cũ — tier ở đây chỉ là ĐỘ SÂU AI (1-pass standard
--        vs 3-pass deep), KHÔNG đổi luồng review.
--
-- Bối cảnh: hôm nay bài giáo viên giao luôn chấm ở 'instructor' tier
-- (= AI Standard Pass 1 + đẩy vào instructor review queue, xem
-- `_assignment_grading_tier`). Không có cách chọn deep. Migration này tách
-- 2 trục:
--   • ROUTING review  : vẫn quyết bởi quyền-sở-hữu (instructor → 'instructor'
--                        tier trên essay → tạo review row). KHÔNG đổi.
--   • ĐỘ SÂU AI        : giáo viên chọn standard|deep khi giao; lưu vào
--                        writing_assignments.grading_tier → chảy xuống
--                        writing_essays.instructor_ai_tier → `_grade_instructor`
--                        chạy `_grade_standard` hoặc `_grade_deep` tương ứng.
--
-- Purely ADDITIVE. Default 'standard' = đúng hành vi hiện tại (zero regression).
--
-- Columns:
--   writing_assignments.grading_tier      — độ sâu AI chọn lúc giao (standard|deep)
--   writing_essays.instructor_ai_tier     — độ sâu AI áp dụng dưới 'instructor'
--                                           tier khi chấm (standard|deep)

ALTER TABLE writing_assignments
    ADD COLUMN IF NOT EXISTS grading_tier grading_tier_enum NOT NULL DEFAULT 'standard'
        CHECK (grading_tier IN ('standard', 'deep'));

COMMENT ON COLUMN writing_assignments.grading_tier IS
    'AI grading depth chosen at assign time: standard (1-pass) or deep (3-pass). '
    'Flows to essay.instructor_ai_tier on submit. Review routing is unchanged '
    '(instructor-owned assignments still grade at the instructor tier and queue '
    'for human review); this dial only controls the AI pass depth underneath.';

ALTER TABLE writing_essays
    ADD COLUMN IF NOT EXISTS instructor_ai_tier grading_tier_enum NOT NULL DEFAULT 'standard'
        CHECK (instructor_ai_tier IN ('standard', 'deep'));

COMMENT ON COLUMN writing_essays.instructor_ai_tier IS
    'When grading_tier = instructor, the AI pass depth to run underneath: '
    'standard (_grade_standard) or deep (_grade_deep). Default standard = '
    'pre-feature behaviour. Ignored when grading_tier is not instructor.';
