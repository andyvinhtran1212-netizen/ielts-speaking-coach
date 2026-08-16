# Gate E — Writing submission failure matrix

Ngày khóa contract: **2026-08-14**.

## Phạm vi và kết luận

Writing dashboard có hai implementation cùng dùng canonical API:

- Next.js: `/writing/dashboard`;
- legacy rollback/parity: `/pages/writing-dashboard.html`.

Batch này bổ sung idempotent student-submit contract và chạy bốn failure path
trên Chromium desktop, WebKit desktop và WebKit/iPhone 13 emulation, tổng cộng
**12 test**, `workers: 1`, `retries: 0`. Cả hai dashboard dùng chung fixture
server-state và production Next build. Đây là **automated synthetic evidence**,
không phải Safari/iOS thiết bị thật và không tự làm Gate E global PASS.

## Root cause

- **Root cause:** `POST /api/writing/my-assignments/{id}/submit` trước đây không
  có idempotency key hay endpoint readback. Nếu assignment→essay đã commit nhưng
  response bị mất, UI báo lỗi; retry tạo một essay speculative khác rồi mới gặp
  `409`, để cleanup best-effort quyết định có sinh orphan hay không.
- **Severity:** Critical — learner có thể không biết bài đã nộp, grading job có
  nguy cơ bị gửi lặp và exact essay text trong textarea có thể lệch server draft.
- **Impacted files/functions:** `backend/routers/writing_student.py`
  `submit_my_assignment()`, `_persist_flagged_submission()`; Next
  `writing-behavior.tsx`; legacy `writing-dashboard.html`.
- **Suggested minimal fix:** persist request UUID + exact normalized-text digest
  trên assignment, replay canonical assignment→essay→job receipt cho cùng
  request, expose ownership-filtered side-effect-free GET readback, và dùng một
  account/assignment-keyed `sessionStorage` receipt ở cả hai clients.

## Contract sau remediation

Migration `207_writing_student_submit_idempotency.sql` thêm cặp
`student_submit_request_id` / `student_submit_text_sha256`, check cả hai cùng
NULL hoặc cùng có giá trị và unique partial index cho request UUID. Client cũ
không gửi UUID vẫn tương thích; client mới giữ exact text + UUID trong tab cho
tới khi canonical ACK được xác thực.

Submit xử lý theo thứ tự:

1. ownership-filter assignment và replay ngay nếu cùng request đã terminal;
2. tạo essay row;
3. conditional claim assignment active, đồng thời lưu essay link + receipt;
4. thử schedule tối đa một grading job sau khi link đã commit; nếu queue lỗi thì giữ canonical link để admin có thể requeue, không xóa essay đã nộp;
5. response mơ hồ được đối chiếu bằng GET, không replay POST trước readback.

Readback không schedule job, không trust essay id từ client và chỉ trả assignment
của student hiện tại. Payload khác nhưng dùng lại request UUID trả `409`.
Flagged submit cũng dùng cùng contract và replay đúng thông điệp moderation.

## Bốn failure path được đóng băng

1. `writing-core-player-ambiguous-commit`: fixture commit essay + job rồi abort
   response; client GET readback, giữ đúng một essay/job và clear receipt.
2. `writing-core-player-partial-persistence`: draft cũ đã lưu, PATCH latest trả
   422; submit vẫn dùng toàn bộ exact in-memory text, không chấm draft cũ.
3. `writing-core-player-reload-resume`: reload khôi phục canonical draft và cùng
   `started_at`.
4. `writing-bidirectional-cross-version-core-player`: Legacy lưu → Next khôi
   phục/lưu → Legacy khôi phục cùng canonical draft.

Mọi path fail nếu có production egress hoặc uncaught browser error.

## Verification

- Backend: 44 targeted Writing tests pass, including commit-then-response-loss
  at the assignment claim boundary.
- Browser: `npm run test:e2e:gate-e:writing` → 12/12 pass.
- Manifest/pins: `verify-gate-e-writing-device-matrix.mjs`.
- Semantic evidence: exact 12 tests/3 projects/four titles, zero
  skip/fail/flake và complete embedded Playwright ZIP.
- CI chạy Writing matrix + verifier trước metadata/ledger; suite/verifier đỏ
  đặt `GATE_E_RUN_OUTCOME=failure`.

`frontend/tooling/gate-e-critical-suite.json` chuyển
`failure_injection.status=complete` sau khi Speaking live-staging journey chứng
minh commit-then-response-loss được canonical GET reconcile mà không replay.
Gate E vẫn còn thiếu Safari/iOS thật, active-session drill và 20 consecutive
clean runs.
