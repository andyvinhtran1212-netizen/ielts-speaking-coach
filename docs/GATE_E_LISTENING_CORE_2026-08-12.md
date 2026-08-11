# Gate E — Listening core-player failure matrix

Ngày khóa contract: **2026-08-12**.

## Phạm vi và kết luận

Listening có hai implementation cùng sống trên canonical API:

- Next.js: `/listening/test/session?id=<test_id>`;
- legacy fallback: `/pages/listening-test.html?id=<test_id>`.

Gate E slice này chạy đúng bốn failure path trên Chromium desktop, WebKit
desktop và WebKit/iPhone 13 emulation, tổng cộng **12 test**, `workers: 1`,
`retries: 0`, dùng production Next build và fixture server-state dùng chung cho
cả hai implementation. Đây là automated synthetic evidence; không được gọi là
Safari/iOS thiết bị thật.

## Root cause và mức độ

- **Root cause:** native Listening player đã có autosave/retry/resume, nhưng
  chưa có failure-injection evidence chứng minh canonical attempt không mất dữ
  liệu khi transport mơ hồ, một PATCH bị từ chối, refresh hoặc đổi stack.
- **Severity:** Critical — Listening submit chỉ gửi `{}`; backend chấm từ đáp án
  đã persist. Nếu client submit khi còn một câu chưa lưu, câu đó mất vĩnh viễn.
- **Impacted contracts:** `createListeningSaveCoordinator()`, native
  `startFresh()/resume()/submit()`, legacy `detectResumable()/resumeAttempt()` và
  `flushAllPendingSaves()/confirmSubmit()`.

## Bốn failure path đã đóng băng

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

Mọi path đều fail nếu có request tới Railway/Supabase production origin hoặc có
uncaught browser error.

## Artifacts và verification

- Runner: `npm run test:e2e:gate-e:listening`
- Matrix manifest: `frontend/tooling/gate-e-listening-device-matrix.json`
- JSON: `frontend/test-results/gate-e-listening-device-matrix-results.json`
- HTML: `frontend/playwright-report/gate-e-listening/index.html`
- Semantic verifier:
  `frontend/tooling/verify-gate-e-listening-failure-evidence.mjs`

Verifier chỉ nhận exact 12 test/3 project/four title, zero skip/fail/flake, mỗi
test đúng một passed result và HTML có embedded ZIP hoàn chỉnh chứa
`report.json`. CI chạy verifier trước metadata/ledger; matrix hoặc verifier đỏ
đều đặt `GATE_E_RUN_OUTCOME=failure`.

## Trạng thái global Gate E

Batch này hoàn tất Listening slice, không hoàn tất global Gate E. Writing vẫn
thiếu bốn failure path, chưa có Safari/iOS real-device evidence và chưa có 20
consecutive clean critical-suite executions.
