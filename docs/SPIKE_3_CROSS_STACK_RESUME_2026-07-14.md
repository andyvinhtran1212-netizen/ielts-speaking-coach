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
resume cùng session/question và ghi đè hội tụ).

## Cái KHÔNG tái tạo được từ backend (đúng cho MỌI client, không riêng Next)

| State | Hệ quả khi đổi stack giữa chừng |
|---|---|
| `_recordedBlob` chưa submit | Mất — như refresh thường (audio đã chấm có URL storage riêng) |
| `_currentIdx` | Không tồn tại server-side — cả hai stack đều về câu 1 (xem SPIKE 2 §1) |
| `_ftAllSessionIds` (full-test chain) | **MẤT — CRITICAL, giống hệt refresh (f) SPIKE 2.** Cross-stack handoff giữa full-test = vỡ finalize |
| `_pendingTestAnswers` | Mất (test_part) |
| `ielts_qmode`, `ielts_ft_p2topic` | sessionStorage CÙNG ORIGIN → **sống qua handoff legacy↔Next trong cùng tab** (coexistence một domain — lợi thế kiến trúc strangler-fig) |

## Phán quyết

**Exit criteria: ĐẠT có điều kiện.**
- Practice mode đơn lẻ: cross-stack resume AN TOÀN hôm nay (backend-authoritative,
  upsert idempotent, không state độc quyền client nào cần thiết).
- Full-test: cross-stack resume KHÔNG an toàn cho tới khi chain được persist
  (cùng fix với SPIKE 2 §2 — sessionStorage cùng origin nên fix một lần dùng
  được cho cả refresh lẫn handoff).
- Điều kiện cutover practice: cutover NGUYÊN CỤM flow (practice + full-test +
  result) hoặc chặn handoff giữa chừng full-test (không link chéo stack khi
  `mode=test_full` đang dở).
