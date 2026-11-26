# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=journey; ref=frontend/tooling/verify-listening-test-session-flow.mjs flag off (unchanged writes and DOM) and flag on (same writes, same order) | PENDING |
| FR-002 | kind=test; ref=frontend/tests/react/listening-test-room.test.tsx (render-only file receives state and handlers) | PENDING |
| FR-003 | kind=test; ref=frontend/tests/react/listening-test-room.test.tsx (no email in top bar, Part i of n follows activeSection, Admin preview) | PENDING |
| FR-004 | kind=test; ref=frontend/tests/react/listening-test-room.test.tsx (no Time remaining, audio progress text, isFullTest only for full and not embed/preview) | PENDING |
| FR-005 | kind=test; ref=frontend/tests/react/listening-test-room.test.tsx (start new attempt dialog, Keep current attempt primary, no window.confirm) | PENDING |
| FR-006 | kind=test; ref=frontend/tests/listening-test-room-model.test.mjs (listeningAudioPolicy per test_type, assignment, sitting) + listening-test-room.test.tsx (test policy has no pause/seek/speed, resume offset) | PENDING |
| FR-007 | kind=test; ref=frontend/tests/react/listening-test-room.test.tsx (navigator by Part, four states, click scrolls without seeking audio) | PENDING |
| FR-008 | kind=test; ref=frontend/tests/react/listening-test-room.test.tsx (shared question types produce the same answer strings as the current renderer on existing fixtures) | PENDING |
| FR-009 | kind=test; ref=frontend/tests/react/listening-test-room.test.tsx (Saved at HH:MM from the existing ack branch, Retry) | PENDING |
| FR-010 | kind=test; ref=frontend/tests/listening-test-room-model.test.mjs (listeningSubmitOutcome: ack, sealed receipt, re-read submitted, offline, 401, lost response, 409, re-read abandoned → abandoned message, never confirmed, local copy cleared) + listening-test-room.test.tsx (stays in the test, no full-page error, 3 automatic retries then Try again) | PENDING |
| FR-011 | kind=test; ref=frontend/tests/react/listening-test-room.test.tsx (leave flushes queue, unsaved count, full-test away notice) | PENDING |
| FR-012 | kind=test; ref=backend/tests/test_listening_abandon_attempt.py (self-selected only, conditions in the UPDATE, attempt bound to a sitting via sitting_id → 409 not_self_selected, 200 idempotent, 404/409 cases, race with submit one winner, excluded from results/history/progress) | PENDING |
| FR-013 | kind=test; ref=frontend/tests/react/listening-test-room.test.tsx (offline banner, Waiting for connection, Reload audio) | PENDING |
| FR-014 | kind=test; ref=frontend/tests/react/listening-test-room.test.tsx (noRedirect on calls, local copy keyed by ownerKey with baseValue, flush and read back on leave, storage refuses writes + 401 → only Stay and no /login redirect, other account never reads the copy) | PENDING |
| FR-015 | kind=test; ref=frontend/tests/react/listening-test-room.test.tsx (read-only tab sends no PATCH and plays no audio) | PENDING |
| FR-016 | kind=journey; ref=frontend/tooling/verify-listening-test-session-flow.mjs (mock_embed: no top bar, mock-flush answered with unsaved) | PENDING |
| FR-017 | kind=test; ref=frontend/tests/react/listening-test-room.test.tsx (admin preview: no save, no submit) | PENDING |
| FR-018 | kind=journey; ref=frontend/tooling/verify-listening-test-session-flow.mjs flag on, Playwright dialog count = 0 | PENDING |
| FR-019 | kind=test; ref=frontend/tests/react/listening-test-room.test.tsx (event names, surface=listening, no answers in payload) | PENDING |

Đối chiếu số FR của GOI-08 ↔ spec này:

| GOI-08 | Spec |
| --- | --- |
| FR-08-036 | FR-003, FR-006, FR-007 |
| FR-08-041 (phần Listening) | FR-012 |
| FR-08-010 (khung) | FR-010 |
| FR-08-012, 013, 014 (khung) | FR-009, FR-013, FR-014 |
| FR-08-015 (khung) | FR-015 |
| FR khung khác áp cho Listening test (EXAMROOM-0066) | FR-001, 002, 004, 005, 008, 011, 016…019 |

## Independent review (T006)

Review độc lập lần 1, ngày 23/11/2026 (R142), người review không phải tác giả chuỗi 0070. Đối tượng: #2542 (T001, `7d0c5d60`) → #2557 (T002, `a2e09fad`) → #2584 (T003, head `da419152`, đã gồm cả #2549 T004 phần backend, `b19e81ba`). Chỉ xét phần riêng của 0070: `listening-test-controller.mjs`, `listening-test-room.tsx`, `listening-test-session.tsx`, route `abandon`, test và hai journey. Ghi chép đầy đủ ở bình luận review trên #2557.

- Lệnh chạy lại trên `da419152`:
  - `node --test` các file `listening-test*`, `core-operation*`, `mock-exam-next*`: 317 pass.
  - `vitest` `listening-test-room` và `exam-room*`: 88/88.
  - `pytest test_listening_abandon_attempt.py test_listening_blackeye_boundaries.py`: 130 pass.
  - Journey **chưa chạy lại** trong lần review này. Theo PR #2584, journey session đạt 20/20, journey overflow đạt 272/278. 6 lỗi khi bật cờ là do dải câu của khung tràn ngang với một Part 40 ô ở 1024–1440 px; lỗi này thuộc khung 0066 (#2518/#2528) và đang được sửa ở chuỗi đó.
- **F1 (Medium, FR-010 và FR-014), còn mở.** Nộp bài gặp 401 thì trạng thái là `unconfirmed` với `waitFor: 'signin'`. Không có lần thử lại nào được hẹn, trong khi khung hiện `unconfirmed` mà không có nút và khoá ô. Học viên chọn ở lại trong bài thì kẹt, không có "Try again", cho tới khi tải lại trang. Cách sửa: khi chờ đăng nhập thì chuyển sang `unconfirmed_manual` (có "Try again"), hoặc tự nộp lại khi phiên trở lại; kèm một test React ở mức `listening-test-session`.
- **F2 (Medium, FR-004 và FR-010), còn mở.** Chuỗi tiếng Anh `unconfirmed` của khung là "Time is up. We have not confirmed your submission yet…". Listening không có hạn giờ phía máy chủ, nên khi mất phản hồi hay offline, học viên Listening đọc "Time is up" là sai. Cách sửa: khung cho bề mặt không có đồng hồ một câu không nhắc hết giờ (ví dụ "We have not confirmed your submission yet. Keep this page open while we try again."), và test chuỗi cho Listening.
- **F3 (Low, FR-011), còn mở.** Câu "The recording keeps playing on our side while you are away…" đang nằm trong thân trang, không nằm trong hộp rời bài. `ExamRoomExit.note` có sẵn cho đúng việc này nhưng chưa dùng. Cách sửa: `exit.note = isFullTest ? AWAY_NOTE : undefined`.
- **F4 (Low, FR-010).** Trong vòng tự thử lại, nếu đọc lại lượt thất bại (`{status: 'unknown'}`), trạng thái chuyển ngay sang `unconfirmed_manual`, nên ngừng thử trước khi dùng hết 3 lần.
- Nit, không chặn:
  - Nhãn nút là "Submit answers", còn Scenario 1 ghi "Submit test".
  - Kỳ thi gắn sitting dùng đề mini thì `policy='test'` nhưng biến `practice` vẫn đúng. Hệ quả: offset khi tải lại, trạng thái hết audio và luật ở màn đầu theo kiểu luyện tập, không khớp trình phát.
- **Thiếu test.** Phần logic mới ở mức phiên chưa có test React: `runRoomSubmit`, `abandonRoom`, gửi lại từ bản sao (`planLocalCopyReplay`), `saveRoomLocalCopy`, `reloadRoomFromServer`, `onRoomWriteRight`. Các dòng FR-007, FR-008, FR-013, FR-014, FR-015, FR-019 ở bảng trên trỏ tới `listening-test-room.test.tsx`, nhưng file đó chưa có các ca này.
- **Đã kiểm khớp, không thấy lỗi:**
  - FR-001: boot có `bootKeyRef` giữ; khi cờ tắt, các đường cũ không đổi.
  - FR-002, FR-003, FR-005; FR-006 ở mức hàm thuần; FR-009; FR-016; FR-017.
  - FR-012 phía backend: một câu UPDATE CAS; các mã `reason` của 409 khớp với chỗ frontend đọc `detail.reason`; lượt bỏ không vào lịch sử, Tiến độ hay review. FR-012 vẫn chờ anh Andy gỡ HOLD trên #2549.
- **Chưa kiểm ở lần này:** FR-018 (cần journey), FR-019 (sự kiện), `/ui-review` trên ảnh chụp (cần staging, T005).
- Các dòng PENDING ở bảng trên giữ nguyên PENDING cho tới khi F1–F3 được sửa và qua nghiệm thu staging (T005).
- **Sau lần 1 (25/11).** F1, F3 và F4 đã được sửa ở #2557 `69ef254a`; F2 sửa ở #2518 `8c9752ad`, commit này đã vào `staging`. Trạng thái của cả bốn là **đã sửa, chờ review lần 2**. Các dòng "còn mở" ở trên là ghi nhận của lần 1. Dòng PENDING trong bảng vẫn giữ PENDING tới T005.

## Contract evidence

- OpenAPI/type drift: một route mới `POST /api/listening/tests/attempts/{attempt_id}/abandon`;
  `frontend/types/api.d.ts` sinh lại trong PR T004. Mọi route khác không đổi.
- Backward compatibility: cờ tắt thì giao diện và request như hôm nay; route mới chỉ được gọi
  từ nhánh cờ bật.

## Data evidence

- Migration/schema query: N/A (`abandoned` đã được ghi bởi đường bắt đầu lượt mới).
- Immediate state versus full reload: tải lại giữa bài khôi phục câu đã ack từ máy chủ, audio
  full test tiếp từ `listeningResumeOffsetSeconds`; PENDING.

## UI evidence

- Viewports/themes/input methods: ảnh 1280px, 768px và 390px (mini test) theo tờ `PhongThi`;
  full test luôn sáng.

## Release evidence

- Staging SHA and checks: PENDING.
- Production verification: N/A cho tới khi anh Andy cho bật.
