# Gate E — Writing submission failure matrix

Ngày khóa contract ban đầu: **2026-08-14**. Affinity contract được version lại
ngày **2026-08-18**; thay đổi frozen-suite hash này bắt buộc khởi động lại
candidate clean streak từ run staging đầu tiên sau merge.

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

Migration `221_writing_assignment_renderer_affinity.sql` bổ sung affinity
`legacy|next` nullable, không default/backfill lịch sử vì Writing đã Next-canonical
trong lúc Legacy rollback URL vẫn còn sống. Renderer đầu tiên claim nguyên tử
trên assignment đang `pending|in_progress`; cả hai dashboard claim trước `/start`
và redirect về affinity canonical nếu mở nhầm stack. Assignment mới vẫn admit
vào Next để giữ hành vi sản phẩm hiện tại; thay đổi này chỉ chuẩn bị staging
coexistence/rollback, không đổi production deployment.

Live coexistence runner dùng chuỗi phù hợp với trạng thái sản phẩm hiện tại:
`floor (Next) → rollback override (Legacy) → restore (Next)`. Mỗi phase tạo một
assignment mới qua canonical admin API, lưu draft qua chính player đang được
admit, đọc lại canonical affinity/draft và mở lại assignment phase trước bằng
stable URL. Floor còn mở một assignment mới trực tiếp bằng Legacy URL để chứng
minh first claim `NULL → legacy`. Runner bind phase sau vào successful artifact,
assignment UUID và descendant SHA của phase trước; evidence không chứa access
token. Ba workflow run đã pass với matching frontend/backend staging
provenance: floor `32121670793` attempt 3 trên
`fe9000fdfa4e6c5d801ce8c13b7f1723a23455a4`, rollback `32126575888` attempt 2
trên `c800dfedf4c2f5faa921b8230aadfd60d98059b7` và restore `32128868942` attempt
2 trên `b07e8325edc3854e1dbd0f2702f32e4108577839`.

## Bốn failure path được đóng băng

1. `writing-core-player-ambiguous-commit`: fixture commit essay + job rồi abort
   response; client GET readback, giữ đúng một essay/job và clear receipt.
2. `writing-core-player-partial-persistence`: draft cũ đã lưu, PATCH latest trả
   422; submit vẫn dùng toàn bộ exact in-memory text, không chấm draft cũ.
3. `writing-core-player-reload-resume`: reload khôi phục canonical draft và cùng
   `started_at`.
4. `writing-bidirectional-cross-version-core-player`: Legacy claim + lưu; direct
   Next deep-link bị redirect về Legacy affinity rồi tiếp tục đúng canonical
   draft. Reload/copy URL không đổi renderer giữa attempt.

Mọi path fail nếu có production egress hoặc uncaught browser error.

## Verification

- Backend: 44 targeted Writing tests pass, including commit-then-response-loss
  at the assignment claim boundary.
- Browser: `npm run test:e2e:gate-e:writing` → 12/12 pass.
- Manifest/pins: `verify-gate-e-writing-device-matrix.mjs`.
- Semantic evidence: exact 12 tests/3 projects/four titles, zero
  skip/fail/flake và complete embedded Playwright ZIP.
- Affinity/backend drain: 38 targeted tests pass; Gate F đếm cả assignment
  `pending` hoặc `in_progress` đã pin Legacy, kể cả claim thành công nhưng
  `/start` bị gián đoạn. Assignment `in_progress` còn affinity `NULL` từ client
  N−1 cũng fail closed thành blocker; `pending + NULL` không bị tính vì có thể
  chỉ là bài được giao nhưng chưa từng mở.
- CI chạy Writing matrix + verifier trước metadata/ledger; suite/verifier đỏ
  đặt `GATE_E_RUN_OUTCOME=failure`.

`frontend/tooling/gate-e-critical-suite.json` chuyển
`failure_injection.status=complete` sau khi Speaking live-staging journey chứng
minh commit-then-response-loss được canonical GET reconcile mà không replay.
Tại checkpoint 14/08, Gate E còn thiếu Safari/iOS thật và trusted run
`32136607306` là candidate 1/20 của frozen manifest khi đó. Trạng thái này đã
được supersede ngày 19/08: real-device evidence đã COMPLETE, manifest đổi sang
critical-suite v8 và qualifying streak bắt buộc reset về **0/20**.
