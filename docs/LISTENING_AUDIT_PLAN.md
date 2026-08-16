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

Vào từ **Admin → Listening tests → Audit nội dung** (`/admin/listening/audit`) → mở
workspace native `/admin/listening/audit-detail?id={test_uuid}`. HTML tương ứng chỉ
còn là watchdog/manual rollback.

## 5. Cơ chế sửa tại chỗ (thay cho re-import)

| Sửa gì | Endpoint | Ghi chú |
|--------|----------|---------|
| 1 câu: prompt / đáp án / alternatives / options / traps / bài giải / window | `PATCH /admin/listening/exercises/{exercise_id}/questions/{q_num}` | yêu cầu `expected_updated_at`; ghi thẳng `payload` JSONB; giữ mcq_multi group; UI đọc lại canonical GET; draft giữ nguyên nhưng bị khóa nếu row đã đổi từ tab khác |
| Transcript section | `PATCH /admin/listening/content/{content_id}` | yêu cầu `expected_updated_at`; UI đọc lại canonical GET |
| Metadata test | `PATCH /admin/listening/tests/{test_id}` | sẵn có |
| Audio 1 section | `POST /admin/listening/tests/{id}/audio/section/{n}` + `…/assemble` | **không** tự tính lại window → audit cờ `window_past_end` để chỉnh window tay |
| Trạng thái/ghi chú audit | `PATCH /admin/listening/tests/{id}/audit` | bắt buộc `expected_updated_at`; reviewer triage; index sai/trùng bị từ chối; không `passed/fixed` khi còn error |

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
- Full-audit POST ghi receipt có `request_id` trước khi gọi; timeout/5xx chỉ được
  reconcile bằng GET có đúng `health.request_id`, không tự replay một lượt LLM
  có tính phí. Receipt chỉ được bỏ qua hộp xác nhận cảnh báo lượt chạy mới có
  thể phát sinh thêm chi phí.
- Window trong dữ liệu full test dùng timebase tuyệt đối. Player assembled/full
  phát nguyên mốc; khi fallback sang track section thì trừ `audio_offset` của
  chính section đó. Section >1 thiếu offset hoặc window khai sai section sẽ bị
  khóa playback thay vì phát một đoạn nghe có vẻ hợp lệ nhưng sai. Câu không
  cần audio vẫn sửa được khi để trống cả hai mốc.
- Editor vẫn mở câu có option/window canonical hỏng, giữ dữ liệu đọc được và
  hiện cảnh báo sửa tại card. Field list sai shape phải được nhập lại trước khi
  Save, nên sửa một field khác không thể vô tình ghi đè đáp án/options thành
  mảng rỗng. Xóa cả hai mốc của window đang tồn tại gửi explicit `null` và được
  GET xác nhận. Alternatives/traps dùng mỗi dòng một giá trị để không làm vỡ
  đáp án chứa dấu phẩy.
- `q_num` hỏng/trùng không làm sập workspace: card mơ hồ bị khóa read-only vì
  PATCH theo số câu không an toàn, còn transcript và card có identity hợp lệ
  vẫn sửa được. Các section editor luôn được giữ mounted nên chuyển tab/keyboard
  không làm mất draft chưa lưu.
- Sửa đáp án/transcript = tác động học viên → sửa sau khi xác nhận; không tự đổi status publish của test.
- Không sửa/skip test để ép xanh; test đỏ → sửa code.
