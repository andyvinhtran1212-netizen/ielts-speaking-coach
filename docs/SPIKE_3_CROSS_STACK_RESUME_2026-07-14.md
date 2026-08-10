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

→ **Speaking session là stack-agnostic ở tầng dữ liệu.** Legacy-start →
Next-resume (và ngược lại) hoạt động vì cả hai stack chỉ là view trên cùng
REST state; đã chứng minh gián tiếp bằng spike 1 (client "Next-shaped" tạo
session → ghi âm → upload → chấm trên cùng contract) + spike 4 (client thứ hai
resume cùng session/question và ghi đè hội tụ). Bằng chứng này chỉ áp cho state
đã persist theo session; nó không chứng minh browser handoff của full-test chain
đang nằm trong `sessionStorage`.

## State ngoài backend và giới hạn handoff

| State | Hệ quả khi đổi stack giữa chừng |
|---|---|
| `_recordedBlob` chưa submit | Mất — như refresh thường (audio đã chấm có URL storage riêng) |
| `_currentIdx` | Không tồn tại server-side cho practice thường. Riêng `test_part`, client suy ra câu chưa làm đầu tiên từ responses đã persist. |
| `_ftAllSessionIds` (full-test chain) | Đã mirror vào `sessionStorage` dưới key ổn định `ielts_ft_session_ids`; browser regression chứng minh refresh trong legacy player cùng tab sẽ restore, kiểm tra membership và truncate đúng part hiện tại. Legacy↔Next cùng origin, cùng tab được suy ra từ shared storage nhưng **chưa có browser handoff test**, nên vẫn là unverified. Chain không tái tạo được trên client hoàn toàn mới, tab mới, origin khác hoặc thiết bị khác vì chưa có canonical backend record cho cả chuỗi. |
| `_pendingTestAnswers` | **Không còn tồn tại.** `test_part` await upload+grade từng câu trước khi advance; responses persisted là nguồn resume. |
| `ielts_qmode`, `ielts_ft_p2topic` | sessionStorage CÙNG ORIGIN → **sống qua handoff legacy↔Next trong cùng tab** (coexistence một domain — lợi thế kiến trúc strangler-fig) |

## Phán quyết

**Exit criteria: PARTIAL — practice/backend resume và legacy refresh đã đạt;
full-test cross-stack handoff chưa được test, fresh-client handoff chưa đạt.**
- Practice mode đơn lẻ: cross-stack resume AN TOÀN hôm nay (backend-authoritative,
  upsert idempotent, không state độc quyền client nào cần thiết).
- `test_part`: mỗi câu đã xác nhận được persist trước khi chuyển câu; refresh
  resume ở câu chưa trả lời đầu tiên.
- Full-test cùng origin, cùng tab: chain đã sống qua refresh nhờ
  `ielts_ft_session_ids`; source pins và browser regressions refresh nằm ở
  `frontend/tests/full-test-chain.test.mjs` và
  `frontend/tests/e2e/full_test_chain_persistence.spec.js`. Handoff
  legacy↔Next là inference từ shared storage, chưa phải evidence trực tiếp.
- Full-test trên fresh client/tab khác/origin khác/thiết bị khác: vẫn KHÔNG an
  toàn vì backend chưa sở hữu chain. Gate E phải test đúng boundary này; không
  được dùng bằng chứng same-tab để tuyên bố resume đa thiết bị.
- Điều kiện cutover practice giữ nguyên: cutover NGUYÊN CỤM flow (practice +
  full-test + result), hoặc chặn mọi cross-stack full-test handoff khi
  `mode=test_full` đang dở cho tới khi có browser evidence trực tiếp.
