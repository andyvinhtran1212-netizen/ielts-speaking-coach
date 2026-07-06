# Listening content audit — plan & mechanism

Kế hoạch audit toàn bộ nội dung Listening đang live, và cơ chế **sửa–bổ sung–kiểm tra tại chỗ** (không import lại từ đầu).

## 1. Vì sao

Nội dung listening được import trọn gói (audio + đề + script + bài giải + timings) rồi **đóng băng**. Khi phát hiện sai (đáp án lệch, bài giải mâu thuẫn, window nghe-lại lệch, transcript sai), trước đây phải **re-import cả test**. Cơ chế audit cho phép **kiểm tra + vá từng phần** ngay trên dữ liệu đang lưu.

## 2. Phạm vi (tính đến batch đầu)

20 test published: 1 full-legacy (`ILR-LIS-001`, 40 câu), 13 mini-lesson (`ILR-LIS-…-L01..L13`), 6 drill (FLOW/FORM L1). ~290 câu. Audit áp dụng cho cả draft.

## 3. Năm chiều audit

| Chiều | Kiểm gì | Tự động | Người |
|------|---------|---------|-------|
| **Audio** | có file, thời lượng hợp lệ, window ⊆ thời lượng, audio đúng bài (không lệch/sai file) | bounds (structural+audio pass) | nghe (nút ▶ trong editor) |
| **Đề / câu hỏi** | mọi câu có đáp án, liên tục 1..N, `template_kind` hợp lệ, mcq có options, matching/mcq_multi có metadata, map có ảnh | structural pass | đọc |
| **Script / transcript** | mỗi section có transcript, khớp audio | structural (rỗng?) | đọc/nghe |
| **Bài giải** | có, không mâu thuẫn đáp án, đủ ý | LLM pass | đọc |
| **Timeline / window** | mỗi câu có `audio_window`, end>start, nằm trong audio, trỏ đúng đoạn nói đáp án | structural + audio | nghe |

**Severity**: `error` (chặn chất lượng, phải sửa) · `warning` (nên xem). Roll-up: có ≥1 error chưa resolved → `has_issues`; chỉ warning/không → `passed`; người duyệt sửa xong đặt `fixed`.

## 4. Quy trình

```
(1) Structural + audio pass   →  GET  /admin/listening/tests/{id}/audit     (nhanh, không LLM, không ghi)
(2) LLM content pass          →  POST /admin/listening/tests/{id}/audit/run (ghi listening_audit)
(3) Triage + sửa tại chỗ      →  editor: sửa transcript / đáp án / bài giải / window
(4) Re-check                  →  mỗi lần "Lưu câu" tự re-check câu đó; chạy lại (2) cho toàn test
(5) Đóng                      →  PATCH /admin/listening/tests/{id}/audit  {status:'fixed', notes, resolved_indexes}
```

Vào từ **Admin → Listening tests → 🔎 Audit nội dung** (`audit.html`) → mở 1 test (`audit-detail.html`).

## 5. Cơ chế sửa tại chỗ (thay cho re-import)

| Sửa gì | Endpoint | Ghi chú |
|--------|----------|---------|
| 1 câu: prompt / đáp án / alternatives / bài giải / window | `PATCH /admin/listening/exercises/{exercise_id}/questions/{q_num}` | ghi thẳng `payload` JSONB; giữ mcq_multi group; trả re-check của câu |
| Transcript section | `PATCH /admin/listening/content/{content_id}` | sẵn có |
| Metadata test | `PATCH /admin/listening/tests/{test_id}` | sẵn có |
| Audio 1 section | `POST /admin/listening/tests/{id}/audio/section/{n}` + `…/assemble` | **không** tự tính lại window → audit cờ `window_past_end` để chỉnh window tay |
| Trạng thái/ghi chú audit | `PATCH /admin/listening/tests/{id}/audit` | reviewer triage |

## 6. Engine

`backend/services/listening_audit.py` (pure, test được không cần DB):
- `hydrate_test(test, contents, exercises)` — dựng view chuẩn từ rows.
- `structural_checks` — port `listening_fulltest_import._validate` sang DB rows.
- `audio_bounds_checks` — audio hiện diện + window ⊆ thời lượng.
- `llm_content_audit(h, invoke)` — 1 call LLM/test (`LISTENING_AUDIT_MODEL`), lỗi → cảnh báo `audit_inconclusive` (không chặn).

Trạng thái lưu ở bảng `listening_audit` (migration `137`, 1 dòng/test: status/health/issues/notes/auditor).

## 7. Theo dõi coverage

Dashboard hiện **health** (kết quả nhanh) + **trạng thái audit đã lưu** mỗi test. Mục tiêu: mọi test published đạt `passed`/`fixed`. Test còn `has_issues`/`pending` là việc còn lại.

## 8. Nguyên tắc

- LLM chỉ **cảnh báo**, không tự sửa — người duyệt quyết định (giữ chuẩn feedback truthful).
- Sửa đáp án/transcript = tác động học viên → sửa sau khi xác nhận; không tự đổi status publish của test.
- Không sửa/skip test để ép xanh; test đỏ → sửa code.
