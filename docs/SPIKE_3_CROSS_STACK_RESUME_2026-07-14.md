# SPIKE 3 — Legacy-start → Next-resume (và ngược lại) trên cùng backend session

Plan Phase 2, critical-risk spike #3. **Artifact:** hợp đồng reconstruct-từ-URL
được kiểm chứng: một client MỚI TINH (không storage, không in-memory) chỉ cầm
`?session_id=` tái tạo được gì — vì "đổi stack giữa chừng" chính là trường hợp
đặc biệt của "mất sạch client state".

## Hợp đồng resume (backend-only)

Client mới cần đúng 3 call:
1. `GET /sessions/{id}` → mode/part/topic/status/sitting_id (+ responses đã chấm)
2. `GET /sessions/{id}/questions` → bộ câu hỏi persisted (bootstrap qua
   `POST .../questions/generate` nếu rỗng)
3. Responses đã persist → suy ra câu nào đã chấm, band, feedback

→ **Speaking session là stack-agnostic ở tầng dữ liệu**, nhưng tầng client chỉ
an toàn khi cả hai renderer cùng dùng một persistence controller. Trước Gate E,
Legacy không mount controller đó: chain còn sống nhưng renderer không đọc
canonical question receipts để bỏ qua câu đã làm. Gate E đã đóng khoảng trống
bằng `speaking-legacy-runtime.mjs`; Legacy và Next cùng import controller từ
`frontend/public/js/`, không có hai bản thuật toán resume.

## State ngoài backend và giới hạn handoff

| State | Hệ quả khi đổi stack giữa chừng |
|---|---|
| `_recordedBlob` chưa submit | Controller giữ blob trong pending/retry queue và bật cảnh báo rời trang. Handoff chỉ an toàn sau canonical confirmation; cố rời khi còn blob local vẫn có thể mất như refresh thường. |
| `_currentIdx` | Không tồn tại server-side cho practice thường. `test_part` suy ra câu chưa làm đầu tiên từ responses; `test_full` suy ra từ responses hoặc sealed-safe `response_receipts`. |
| `_ftAllSessionIds` (full-test chain) | Cả hai stack restore owner-scoped `ielts_ft_state_v2` và mirror tương thích `ielts_ft_session_ids`; handoff **cùng origin, cùng tab** kiểm membership/truncate và canonical readback thay thế local confirmation, kể cả readback rỗng. Chain vẫn chưa được dựng lại chỉ từ `session_id` cho client hoàn toàn mới, tab mới, origin khác hoặc thiết bị khác. |
| `_pendingTestAnswers` | **Không còn tồn tại.** `test_part` await upload+grade từng câu trước khi advance; responses persisted là nguồn resume. |
| `ielts_qmode`, `ielts_ft_p2topic` | sessionStorage CÙNG ORIGIN → **sống qua handoff legacy↔Next trong cùng tab** (coexistence một domain — lợi thế kiến trúc strangler-fig) |

## Phán quyết

**Exit criteria: ĐẠT bằng browser runtime trong boundary same-origin/same-tab;
chưa đạt cho fresh-client full-test handoff.**
- Practice mode đơn lẻ: cross-stack resume AN TOÀN hôm nay (backend-authoritative,
  upsert idempotent, không state độc quyền client nào cần thiết).
- `test_part`: mỗi câu đã xác nhận được persist trước khi chuyển câu; refresh
  resume ở câu chưa trả lời đầu tiên.
- Full-test cùng origin/cùng tab: browser thật chạy Legacy lưu câu 1 → Next
  resume câu 2 → Next lưu câu 2 → Legacy resume câu 3; cả multipart audio lẫn
  owner-scoped confirmation ledger đều được assert trong
  `frontend/tests/gate-e/native-speaking-cross-version-resume.spec.js` trên ba
  project Gate E. Source/legacy chain tests vẫn là lớp contract phụ, không còn
  bị dùng thay cho runtime evidence.
- Full-test trên fresh client/tab khác/origin khác/thiết bị khác: vẫn KHÔNG an
  toàn vì backend chưa sở hữu chain. Gate E phải test đúng boundary này; không
  được dùng bằng chứng same-tab để tuyên bố resume đa thiết bị.
- Điều kiện cutover practice giữ nguyên: cutover NGUYÊN CỤM flow (practice +
  full-test + result), hoặc chặn mọi cross-stack full-test handoff khi
  `mode=test_full` đang dở cho tới khi có browser evidence trực tiếp.
