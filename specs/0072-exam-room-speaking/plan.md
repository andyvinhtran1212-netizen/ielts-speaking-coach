# Implementation plan

## Architecture impact

- `practice-session-boot.tsx`: thêm `examRoomMode: examRoomEnabled('speaking')` vào bootstrap
  của `PracticeApp.init` (L123). Đây là chỗ duy nhất quyết cờ cho `practice.js` (FR-002).
- `frontend/public/js/practice.js`: chỉ khi `bootstrap.examRoomMode === true` (đọc trong `init`): phát `_updateNativeView('mic', { state, reason })` quanh lời
  gọi `getUserMedia` (L838, L3361), `_updateNativeView('recording', { level })` từ `AnalyserNode`
  sẵn có, và thay `window.confirm`/`window.alert` ở L275, L1326, L5284 bằng lời gọi mở hộp của cầu
  nối; thêm lệnh `requestLeave`, `confirmLeave`, `confirmRerecord`, `confirmSubmitWithUnsent`.
  Nhánh cờ tắt không đổi một dòng hành vi.
- `frontend/app/(authed-practice)/practice/session/practice-page-shell.tsx`: một chỗ rẽ nhánh;
  file vẽ mới `practice-exam-room.tsx` dùng `FocusShell` (thanh tập trung chế độ luyện), hộp của
  khung, `mic-status.tsx` và `recording-status.tsx` mới trong cùng thư mục.
- `practice-recorder-bridge.tsx`, `practice-submission-bridge.tsx`: nhận trạng thái mới, không
  đổi đường ghi native.
- Không sửa `frontend/public/js/*.js` khác, layout hay `pageStylesheets`.
- Backend: không đổi.

## Data and contracts

- Không migration, không route mới, không đổi shape: `POST /sessions`, `GET /sessions/{id}`,
  `POST /sessions/{id}/responses` (multipart, MIME như hôm nay), `PATCH /sessions/{id}/complete`,
  `POST /sessions/{id}/renderer-affinity`, báo về sitting như hôm nay.
- Không lưu âm thanh trong bộ nhớ trình duyệt. Khoá ghi `exam-room:speaking:{session_id}` (0066
  FR-017).
- Ngưỡng im lặng (`SILENCE_RMS = 0.02`, RMS của `getByteTimeDomainData` quy về 0–1) và thời gian
  (3 giây) là hằng trong `recording-status.tsx`.

## UI and interaction

- Xem `ui-states.md`. Chế độ `practice` (tiếng Việt) trừ `test_full` trong sitting (câu hỏi mở 1).
- Bàn phím: hộp có bẫy tiêu điểm, tiêu điểm đầu ở nút an toàn ("Ở lại", "Giữ bản ghi"); phím cách
  không bắt đầu ghi âm.
- Trạng thái micro và ghi âm ở vùng `aria-live="polite"`; ca bị từ chối `role="alert"` một lần.

## Work decomposition

1. G08-T18 (PR `high-risk`, frontend): FR-001…005, FR-009, FR-011, FR-013, phần micro và ghi âm.
2. G08-T19 (PR `high-risk`, frontend): FR-006…008, FR-010, FR-012, hộp ghi lại, rời bài, nộp.
3. Bật cờ trên staging, nghiệm thu bằng micro giả, rồi production khi anh Andy nói rõ.

## Rollout and rollback

Xem `rollout.md`.

## Verification strategy

- React test `frontend/tests/react/practice-exam-room.test.tsx`: bốn ca micro (ca chờ hiện trước
  khi `getUserMedia` trả), năm trạng thái ghi âm, bản quá ngắn Part 1/2/3 theo `MIN_RECORD_SEC` và
  `detail.min_seconds`, hộp ghi lại, hộp rời bài, hộp nộp còn bản chưa gửi.
- `node --test frontend/tests/practice-exam-room-events.test.mjs`: `practice.js` không phát sự kiện
  mới khi cờ tắt; phát đúng tên ca khi cờ bật.
- Journey: `node frontend/tooling/verify-speaking-flow.mjs`, `write-flows/speaking-*.mjs` (thêm
  `clickIfPresent` cho nút xác nhận mới), `npx playwright test -c
  frontend/playwright.speaking-regression.config.js --trace off`, cả hai nhánh, `dialog` = 0 ở nhánh
  mới; Chromium với `--use-fake-device-for-media-stream` và
  `--use-fake-ui-for-media-stream` (ca cho phép), không dùng cờ UI giả cho ca từ chối.
- Test đọc nguồn `js/practice.js`: sửa và liệt kê test vỡ có chủ ý.
- `test:react`, `tsc --noEmit`, `npm run build`.
