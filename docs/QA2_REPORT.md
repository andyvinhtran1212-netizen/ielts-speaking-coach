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

## Lịch sử
| Lần | Ngày | Cụm | Bank | Câu | Bị cờ | Kết quả |
|-----|------|-----|------|-----|-------|---------|
| 1 | 2026-07-02 | tenses | 8 | 203 | 0 | PASS |
