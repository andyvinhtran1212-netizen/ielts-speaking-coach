# SPIKE 2 — Practice state-machine qua refresh/back/reopen/resume

Plan Phase 2, critical-risk spike #2. **Artifact:** characterization đầy đủ của
practice.js (3187 dòng) — states, persistence, và hành vi CHÍNH XÁC ở từng
kịch bản gián đoạn. Đây là hợp đồng hành vi mà port Next PHẢI thỏa (hoặc cải
thiện có chủ đích, ghi rõ).

## State inventory

- `showState()`: `loading / error / mode-choice / prep / p2a / p2b / p2c /
  processing / feedback / test-results / completion` (practice.js:103).
- `_showRecSub()`: `idle / recording / recorded` (:124).
- Persistence 3 tầng: **URL** (`?session_id=` — nguồn chân lý duy nhất),
  **sessionStorage** (`ielts_qmode`, `ielts_ft_p2topic`, `gr_shown_v1`),
  **backend** (sessions/questions/responses). MỌI THỨ KHÁC là in-memory và
  mất khi refresh: `_currentIdx`, `_recordedBlob`, `_stream`, timers,
  `_ftAllSessionIds`, `_pendingTestAnswers`.

## Ma trận refresh (hành vi legacy hiện tại)

| Kịch bản refresh | Kết quả | Mất dữ liệu? |
|---|---|---|
| (a) prep, chưa ghi | init() reload session/questions; **`_currentIdx = 0` vô điều kiện (:3011)** → quay về câu 1 | Không (chỉ mất chỗ đứng) |
| (b) giữa lúc ghi âm | OS tự nhả mic; bản ghi chưa hoàn thành mất | Bản ghi local (chưa có gì server-side) |
| (c) recorded, chưa submit | Blob in-memory mất | Bản ghi local |
| (d) đang processing (upload bay) | Server có thể ĐÃ commit (xem SPIKE 4 — upsert idempotent); client về câu 1 | Không mất server-side; UI không biết đã chấm |
| (e) màn feedback | Feedback đã persist; về câu 1, phải bấm tới mới thấy lại | Không |
| (f) **full-test giữa Part 2/3** | `_ftAllSessionIds` in-memory bị reset → **MẤT session id của Part 1** → finalize gửi sai id | **CÓ — CRITICAL** (điểm Part 1 không vào tổng) |
| (g) test_part với `_pendingTestAnswers` | Queue in-memory mất → các câu đã ghi-chưa-nộp biến mất | **CÓ** (câu trả lời đã ghi) |

Không có `beforeunload`/`pagehide` handler nào (đóng tab im lặng). Re-answer
sau refresh: backend upsert theo (session_id, question_id) — **một row duy
nhất, lần chấm sau ĐÈ lần trước im lặng** (grading.py:969-997; latest-wins).

## Phán quyết & hợp đồng cho port Next

1. **Refresh-resume:** legacy KHÔNG resume (`_currentIdx=0`). Port Next tối
   thiểu phải GIỮ mức này (không tệ hơn); khuyến nghị cải thiện: suy ra câu
   chưa trả lời từ responses đã persist (backend đã có đủ dữ liệu — không cần
   schema mới).
2. **CRITICAL — full-test chaining: ĐÃ FIX trên legacy (2026-07-14, cùng ngày
   spike).** Chain giờ mirror vào sessionStorage `ielts_ft_session_ids`
   (restore theo membership + truncate sau vị trí hiện tại), URL
   `replaceState` theo part hiện hành, clear khi finalize. Regression:
   `tests/e2e/full_test_chain_persistence.spec.js` (4 case, chạy trong CI
   e2e). Port Next thừa kế contract này nguyên trạng.
3. `ielts_ft_p2topic` là contract NGẦM giữa 2 trang: `speaking.html:2088` ghi,
   `practice.js:2950` đọc — port phải giữ key này nguyên tên.
4. `test_part` deferred-answers: **ĐÃ FIX trên legacy (2026-07-14)** — chuyển
   sang eager-upload cùng pattern với test_full (quyết định chốt tại đây thay
   vì lúc port): grading persist server-side per answer, cuối bài chỉ chờ
   upload in-flight rồi giao cho result.html canonical; init resume tại câu
   CHƯA trả lời đầu tiên (dựa trên responses đã persist — không re-grade).
   Regression: `tests/e2e/test_part_resume.spec.js` + pins
   `tests/test-part-eager.test.mjs`. Port Next thừa kế nguyên trạng.
5. Timers Part 2 (prep 60s/speak 120s) không recover được — chấp nhận restart.

**Exit criteria: ĐẠT** — mọi kịch bản gián đoạn có hành vi được ghi nhận +
hợp đồng port rõ ràng; 2 defect legacy có sẵn được phát hiện và khoanh vùng
((f) CRITICAL, (g) HIGH — đưa vào backlog riêng, KHÔNG âm thầm "sửa kèm" khi
port).
