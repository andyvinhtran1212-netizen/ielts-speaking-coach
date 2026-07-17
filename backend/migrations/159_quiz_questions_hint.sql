-- Migration: 159_quiz_questions_hint.sql
-- Mô tả: thêm cột `hint` cho quiz_questions (audit quiz display 2026-07-17 §I).
-- Trước đây schema chỉ có `prompt` nên tác giả buộc phải nhét cả yêu-cầu +
-- gợi-ý vào chuỗi prompt ("— write the adjective form of…"), player render
-- nguyên khối chữ to đậm → 3–4 lớp chỉ dẫn trộn nhau trên màn hình. Cột hint
-- tách gợi ý ra dòng riêng (player render nhỏ, màu muted, dưới prompt);
-- instruction "cách trả lời" đã có dòng #qz-instr per-type từ PR #793 lo.
--
-- ADDITIVE + nullable: câu không có hint hoạt động y như cũ. Serve path
-- (get_bank_for_play) select * → cột tự chảy xuống player, không đổi API.
-- Apply by hand BEFORE merge (importer chỉ ghi được hint sau khi RPC dưới
-- đây được thay).

ALTER TABLE quiz_questions
    ADD COLUMN IF NOT EXISTS hint TEXT;

-- Thay bản 118 của quiz_replace_questions: nhận + ghi thêm cột hint.
-- Giữ nguyên hợp đồng all-or-nothing (delete-all + insert-all trong MỘT
-- transaction plpgsql). Payload cũ không có key hint → NULL (backward-compat:
-- jsonb_to_recordset trả NULL cho key vắng mặt).
CREATE OR REPLACE FUNCTION quiz_replace_questions(p_bank_id UUID, p_rows JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE n INTEGER;
BEGIN
    DELETE FROM quiz_questions WHERE bank_id = p_bank_id;
    INSERT INTO quiz_questions (
        bank_id, qid, item_key, type, subtype, input, skill, pair,
        counts_toward_mastery, prompt, hint, options, answer, accept, segments,
        mask, pairs, explain, points, audio_url, grammar_article_slug, "order")
    SELECT p_bank_id, x.qid, x.item_key, x.type, x.subtype, x.input, x.skill, x.pair,
        COALESCE(x.counts_toward_mastery, TRUE), x.prompt, x.hint, x.options, x.answer,
        x.accept, x.segments, x.mask, x.pairs, x.explain, COALESCE(x.points, 1),
        x.audio_url, x.grammar_article_slug, COALESCE(x."order", 0)
    FROM jsonb_to_recordset(p_rows) AS x(
        qid TEXT, item_key TEXT, type TEXT, subtype TEXT, input TEXT, skill TEXT, pair TEXT,
        counts_toward_mastery BOOLEAN, prompt TEXT, hint TEXT, options JSONB, answer INT,
        accept JSONB, segments JSONB, mask TEXT, pairs JSONB, explain TEXT, points INT,
        audio_url TEXT, grammar_article_slug TEXT, "order" INT);
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END; $$;

-- ── Reverse (run manually if needed) ────────────────────────────────────────
-- Chạy lại CREATE OR REPLACE FUNCTION ở migrations/118_quiz_banks.sql rồi:
-- ALTER TABLE quiz_questions DROP COLUMN IF EXISTS hint;
