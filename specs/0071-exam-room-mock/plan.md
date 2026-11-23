# Implementation plan

## Architecture impact

- Frontend (G08-T16):
  - `frontend/app/(authed-mock-exam)/mock-exam/mock-exam-runner.tsx`: một chỗ rẽ nhánh
    `examRoomEnabled('mock')` sau các hook. Logic boot, đồng hồ, thu bài, `flushEmbed`,
    `doSubmit`, `submitSection`, `MockPostTestCapture`, `integrity`, `startSpeaking` ở lại. Nhánh
    mới thêm `{ noRedirect: true }`, giới hạn tự thử lại 3 lần (FR-007) bằng tham số, không đổi
    nhánh cũ.
  - File mới `mock-exam-room.tsx` cạnh file trên: `ExamRoomShell` (layout `single`, thân là
    iframe hoặc trình soạn), dải phần, hộp thoát, dải thu bài, màn ngoài bài thi.
  - File mới `mock-writing-room.tsx`: trình soạn Writing chế độ test, dùng lại bridge
    `flush`/`finalize` của `WritingWorkspace` (tách bridge thành hook dùng chung, hành vi nhánh
    cũ không đổi).
  - `frontend/lib/mock-exam-model.mjs`: hàm thuần mới `mockSubmitOutcome(state, section,
    flushResult, attempt)` (FR-007) và `reconcileMockWritingCopy(server, legacy, current)`
    (FR-010); hàm cũ (`chooseWritingDraft`…) không đổi.
  - Layout `(authed-mock-exam)` giữ `chrome="none"`; CSS của khung có gốc `[data-exam-room]`.
- Backend: G08-T16 không đổi. G08-T22 (sau G09-T31): PR 1 backend theo GOI-08 T22 (đọc
  `mock_exam_audiences` sau cờ `mock_exam_audiences_learner`, `exam_mode_v2`, `self_paced` qua
  `services/mock_exam_modes.py::self_paced_timeline`, `retake_active_section` không trả
  `not_started` giữa hai phần cho sitting `self_paced` mới, trạng thái từng phần); PR 2
  frontend (màn vào bài `self_paced`, chuyển phần tự động, "Submit section").

## Data and contracts

- G08-T16: không migration, không route mới, không đổi shape. Mọi request giữ nguyên:
  `POST /api/mock-exams/{code}/sittings`, `GET .../sittings/{id}`, `.../sections/{s}/start`,
  `.../flush-ack`, `.../writing`, `.../sections/{s}/submit`, `.../integrity`, `POST /sessions`.
- Hợp đồng `postMessage` giữ nguyên: runner gửi `{type:'mock-flush'}` cùng origin; trang con trả
  `{type:'mock-flushed', section, unsaved}`.
- Khoá trình duyệt: `exam-room:local-copy:mock:{ownerKey}:{sittingId}` (task1, task2, mỗi task
  `text`, `baseText`, `baseSavedAt`); khoá cũ `mock-writing:{sittingId}:{task}` chỉ đối chiếu
  theo FR-010. Khoá ghi `exam-room:mock:{sittingId}` (0066 FR-017).
- G08-T22: hợp đồng API học viên theo MOCKORG-0086 (`exam_mode_v2`, trạng thái từng phần
  `not_started|in_progress|submitted|marking|released`, `started_at`, `ends_at`,
  `expected_end_at`); sinh lại `frontend/types/api.d.ts`. Không migration trong gói G08 nếu
  G09-T31 đã có bảng.

## UI and interaction

- Xem `ui-states.md`. Chế độ `test`, tiếng Anh, phòng thi luôn sáng; màn ngoài bài thi có dòng
  phụ tiếng Việt.
- Bàn phím: bẫy tiêu điểm trong hộp, Esc đóng hộp thoát (không đóng hộp đang nộp).
- Dưới 768px: màn chặn của PHONEGATE-0081 trước khi tạo sitting.

## Work decomposition

1. G08-T16 (PR `high-risk`, frontend, sau G08-T07 và G08-T14): FR-001…013, 015…018.
2. G08-T22 PR 1 (backend, sau G09-T31 trên `staging`): FR-014 phía máy chủ.
3. G08-T22 PR 2 (frontend): FR-014 phía runner.
4. Bật cờ trên staging, nghiệm thu, rồi production khi anh Andy nói rõ.

## Rollout and rollback

Xem `rollout.md`.

## Verification strategy

- `node --test frontend/tests/mock-exam-room-model.test.mjs`: `mockSubmitOutcome` (đã nộp,
  giám thị thu sau `flush-ack`, mới bắt đầu thu (`collected_section` có, `*SubmittedAt` trống) → vẫn `submitting` và thử lưu lại, đã đóng (`*SubmittedAt` có) khi còn câu chưa lưu → `closed_unconfirmed`, lỗi tạm 3 lần
  rồi `unconfirmed_manual`, 403/404), `reconcileMockWritingCopy` (bằng → bỏ, khác → hỏi, khoá mới
  ghi lỗi → giữ khoá cũ, chủ khác → không đọc).
- React test `frontend/tests/react/mock-exam-room.test.tsx`: thanh trên không email, dải phần từ
  dữ liệu kỳ thi, hộp thoát không có "Abandon test", khoá thân khi thu bài, Writing "Words: …
  · minimum …", "Time is up…" chỉ sau `confirmed`.
- Playwright: bước cờ bật trong `verify-mock-exam-flow.mjs` (trong CI): `writes` và thứ tự
  `mock-flush` → `flush-ack` → submit giống hệt hai nhánh, `dialog` = 0; chạy tay
  `verify-mock-ui-remediation-flow.mjs` và `write-flows/reading-exam-mock-sitting.mjs`.
- G08-T22: pytest theo GOI-08 T22 (người ngoài danh sách 404, `self_paced` ba phần với đồng hồ
  giả, job quét, không sitting thứ hai, bắt đầu sau `open_until` → 409); React: DOM `self_paced`
  không có "Continue later", "Start next section".
- Test đọc nguồn hiện có: sửa và liệt kê test vỡ có chủ ý; quá 30 test vỡ thì dừng và báo.
- `test:react`, `tsc --noEmit`, `npm run build`, bộ hợp đồng frontend.
