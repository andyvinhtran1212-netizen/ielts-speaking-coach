# QA-2 — Báo cáo adversarial answer-check

> Cổng QA lớp 2: agent phản biện giải lại độc lập từng câu rồi đối chiếu đáp án, cờ câu sai/mơ hồ/thiếu. Harness: `backend/scripts/qa2_extract_questions.py` + `docs/QA2_REVIEWER_PROMPT.md`. Chạy khi có lô bank mới, TRƯỚC khi import/publish.

## Lần chạy 1 — cụm `tenses` (2026-07-02)

- **Phạm vi:** 8 bank tenses (future-forms, past-continuous, past-perfect, past-simple, present-continuous, present-perfect, present-perfect-continuous, present-simple) — **203 câu**.
- **Phương pháp:** 4 reviewer agent (2 bank/agent), mỗi agent tự giải trước rồi so `resolved_answer`; kiểm thêm distractor, `accept` (contraction + Anh-Anh/Mỹ), tính tự nhiên tiếng Anh, độ chính xác `explain`.
- **Kết quả:** **0 câu bị cờ** (cả 4 batch trả `[]`). 2 batch liệt kê chi tiết từng câu đã soát (past-perfect/past-simple, present-perfect/present-simple), 2 batch báo sạch.
- **Nhận định:** khớp với audit nội dung (bài Wiki nguồn 0 lỗi factual). Agent tạo bank theo KIT + gold example cho chất lượng cao ở cụm này.

**Kết luận:** cụm tenses **PASS QA-2** → đủ điều kiện import (chờ quyết định go-live).

## Cách chạy cho cụm khác
```
cd backend
mkdir -p /tmp/qa2
python3 scripts/qa2_extract_questions.py --only <category> --outdir /tmp/qa2
# → giao các file JSON cho reviewer agent theo docs/QA2_REVIEWER_PROMPT.md (2 bank/agent),
#   thu mảng JSON flags, tổng hợp vào file này.
```

## Lần chạy 2 — TOÀN BỘ 107 bank (2026-07-02)

- **Phạm vi:** 107 bank / **2387 câu** (9 cụm còn lại + tenses lần 1). 23 reviewer agent (~5 bank/agent) + 4 agent tenses.
- **Kết quả: 3 câu bị cờ (0.13%)** — **0 câu sai đáp án**. Cả 3 là prompt/explain gây nhầm, đã sửa:
  1. `G-modifiers-adverbs / freqpos_i2` (incomplete_accept) — prompt trộn "viết lại" + template `I ____ skip` khiến học viên có thể gõ "sometimes" và bị chấm sai. → làm rõ prompt (yêu cầu viết 3 từ).
  2. `G-foundations-parts-of-speech / pos_id_i2` (explain_error) — câu explain cuối ('His English speaking') gây mơ hồ. → viết lại explain cho chính xác (spoken = phân từ quá khứ làm tính từ).
  3. `G-error-clinic-wrong-pronoun-reference / pr_hesh_i2` (prompt↔accept lệch) — prompt bảo viết lại 'she was worried' nhưng accept chỉ `["sarah"]`; nếu gõ "Sarah was worried" sẽ trượt. → prompt thành điền tên vào chỗ trống + accept `["Sarah","sarah"]`. (Vấn đề hoa/thường mà agent nêu là VÔ HẠI: engine `normalizeText` lowercase khi `case_sensitive:false`.)
- **Nhận định:** chất lượng nội dung rất cao (khớp audit bài Wiki 0 lỗi factual). Không bank nào có đáp án sai. 3 sửa đều là clarity, không đổi đáp án.

**Kết luận: toàn bộ 107 bank PASS QA-2** (sau 3 sửa clarity) → đủ điều kiện import/publish.

## Lịch sử
| Lần | Ngày | Cụm | Bank | Câu | Bị cờ | Kết quả |
|-----|------|-----|------|-----|-------|---------|
| 1 | 2026-07-02 | tenses | 8 | 203 | 0 | PASS |
| 2 | 2026-07-02 | TẤT CẢ (107) | 107 | 2387 | 3 (clarity, đã sửa) | PASS |
