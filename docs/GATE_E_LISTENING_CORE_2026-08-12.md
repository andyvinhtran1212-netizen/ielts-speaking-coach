# Gate E — Listening core-player failure matrix

Ngày khóa contract: **2026-08-12**.

## Phạm vi và kết luận

Listening có hai core surface; mỗi surface có hai implementation cùng sống
trên canonical API:

- full test: Next.js `/listening/test/session?id=<test_id>` và legacy fallback
  `/pages/listening-test.html?id=<test_id>`;
- test-linked Dictation: Next.js
  `/listening/dictation/session?test_id=<test_id>` và legacy fallback
  `/pages/listening-test-dictation.html?test_id=<test_id>`.

Gate E slice này chạy đúng tám failure path trên Chromium desktop, WebKit
desktop và WebKit/iPhone 13 emulation, tổng cộng **24 test**, `workers: 1`,
`retries: 0`, dùng production Next build và fixture server-state dùng chung cho
cả hai implementation. Đây là automated synthetic evidence; không được gọi là
Safari/iOS thiết bị thật.

## Root cause và mức độ

- **Root cause:** native Listening full-test đã có autosave/retry/resume và
  Dictation đã có durable completion receipt, nhưng trước matrix v2 chưa có
  failure-injection evidence cho Dictation chứng minh một completion không mất
  hoặc nhân đôi khi mất ACK, lỗi trước commit, refresh hay legacy/Next cùng sống.
- **Severity:** Critical — full-test submit chỉ gửi `{}` nên một answer chưa
  persist sẽ mất vĩnh viễn; Dictation completion là canonical progress/analytics
  nên mất ACK không được phép làm mất lượt học hoặc tạo session trùng.
- **Impacted contracts:** `createListeningSaveCoordinator()`, native
  `startFresh()/resume()/submit()`, legacy `detectResumable()/resumeAttempt()` và
  `flushAllPendingSaves()/confirmSubmit()`; cùng Dictation durable receipt,
  `/dictation/session/by-request/{client_request_id}` và legacy no-receipt POST.

## Tám failure path đã đóng băng

1. `listening-core-player-ambiguous-commit`
   - PATCH đầu tiên commit vào canonical fixture rồi connection reset.
   - Retry idempotent không tạo answer/attempt thứ hai.
   - Reload native và mở legacy đều đọc cùng answer.
2. `listening-core-player-partial-persistence`
   - Câu 1 persist; PATCH câu 2 trả 422 terminal.
   - Native hiện cảnh báo và **không gọi submit** khi canonical state còn thiếu.
   - Sau khi fault được gỡ, `Thử lại` persist câu 2; submit mới được phép chạy
     đúng một lần và legacy không còn thấy attempt đang mở.
3. `listening-core-player-reload-resume`
   - Answer sống qua reload trên cùng attempt.
   - Full-test audio tiếp tục theo `started_at`, không quay lại giây 0.
4. `listening-bidirectional-cross-version-core-player`
   - Legacy tạo attempt/lưu câu 1 → Next resume/lưu câu 2 → legacy resume lại.
   - Hai stack cùng đọc một `attempt_id` và một canonical answer map.
5. `listening-dictation-core-player-ambiguous-commit`
   - Completion đã commit nhưng response bị reset.
   - Next read-back đúng `client_request_id`, chỉ có một canonical session và
     chỉ xoá receipt sau khi server xác nhận.
6. `listening-dictation-core-player-pre-commit-failure-retry`
   - POST đầu trả 503 trước commit; canonical store vẫn rỗng và receipt còn bền.
   - CTA retry gửi lại cùng request id, tạo đúng một session rồi xoá receipt.
7. `listening-dictation-core-player-reload-receipt-resume`
   - Connection reset trước commit, sau đó reload toàn trang.
   - Next khôi phục exact payload từ receipt theo account/test/section, gửi lại
     cùng request id và nhận canonical report mà không tạo session trùng.
8. `listening-dictation-legacy-next-canonical-coexistence`
   - Legacy no-receipt POST và Next receipt POST đều hoạt động qua cùng endpoint.
   - Hai lượt học có chủ ý tạo hai canonical session; chỉ lượt Next tham gia
     request-id reconciliation, không làm hỏng rollback client.

Mọi path đều fail nếu có request tới Railway/Supabase production origin hoặc có
uncaught browser error.

## Artifacts và verification

- Runner: `npm run test:e2e:gate-e:listening`
- Matrix manifest: `frontend/tooling/gate-e-listening-device-matrix.json`
- JSON: `frontend/test-results/gate-e-listening-device-matrix-results.json`
- HTML: `frontend/playwright-report/gate-e-listening/index.html`
- Semantic verifier:
  `frontend/tooling/verify-gate-e-listening-failure-evidence.mjs`

Verifier chỉ nhận exact 24 test/3 project/eight title, zero skip/fail/flake, mỗi
test đúng một passed result và HTML có embedded ZIP hoàn chỉnh chứa
`report.json`. CI chạy verifier trước metadata/ledger; matrix hoặc verifier đỏ
đều đặt `GATE_E_RUN_OUTCOME=failure`.

## Trạng thái global Gate E

Batch này hoàn tất Listening slice, không hoàn tất global Gate E. Writing đã
có automated synthetic matrix riêng ngày 2026-08-14; Speaking live-staging
ambiguous-commit evidence sau đó đóng failure-injection matrix. Global gate vẫn
thiếu Safari/iOS real-device evidence, active-session drill và 20 consecutive
clean critical-suite executions.
