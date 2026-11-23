# Implementation plan

## Architecture impact

- Frontend:
  - `frontend/app/(authed-writing)/writing/dashboard/writing-behavior.tsx`: một chỗ rẽ
    nhánh `examRoomEnabled('writing')` khi mở trình soạn (`openSubmitModal`). Nhánh cờ tắt
    giữ nguyên từng dòng. Nhánh cờ bật thay hai `confirm()` trong `submitFromModal` bằng
    lời gọi hộp của khung; `force=true` (hết giờ) không hỏi như hôm nay.
  - File mới `writing-exam-room.tsx` cạnh file trên: chỉ vẽ, dựng trên `ExamRoomShell`
    (EXAMROOM-0066) chế độ `practice` cho bài có giờ, và trên các thành phần lẻ của khung
    (trạng thái lưu, dải mất mạng, hộp nộp, hộp đóng, hộp đăng nhập lại) cho bài không giờ.
  - File mới `frontend/lib/writing-draft-recovery.mjs`: hàm thuần chọn bản nháp
    (FR-009) từ `{receipt, localCopy, serverDraft}`; test bằng `node --test`.
  - `frontend/tooling/write-flows/writing-submit.mjs`: thêm `clickIfPresent:
    '[data-exam-room-submit-confirm]'` (cơ chế có sẵn ở `verify-write-flows.mjs` L83).
  - Không sửa `page-shell.tsx`, `public/js/writing-submit-receipt.js`, layout hay
    `pageStylesheets`; CSS của khung có gốc `[data-exam-room]`.
- Backend: không đổi.

## Data and contracts

- Không migration, không route mới, không đổi shape.
- Request giữ nguyên: `POST .../renderer-affinity`, `POST .../start`, `PATCH .../draft`
  (`draft_text`), `GET .../timer`, `POST .../paste-log` (`char_count`, `blocked`),
  `POST .../submit` (`essay_text`, `request_id`). Nhánh mới chỉ thêm `{ noRedirect: true }`
  vào tuỳ chọn của `window.api.*` (không đổi request trên dây).
- `baseSavedAt` của bản sao lấy từ `draft.updated_at` của `GET /api/writing/my-assignments/{id}`
  (`writing_student.py` L1607 đã select `updated_at`) và từ phản hồi của `PATCH /draft`
  khi có; nếu phản hồi PATCH không có `updated_at` thì nhánh mới đọc lại chi tiết bài sau
  lần lưu để biết mốc. PR thực thi ghi rõ cách đã chọn.
- Khoá trình duyệt theo EXAMROOM-0066 FR-032/FR-035 với `surface='writing'`,
  `attemptKey=assignmentId`, `ownerKey=ms.accountId`.
- Trạng thái nộp đưa cho khung: `submit.outcome` theo EXAMROOM-0066 FR-034, suy từ kết quả
  `normalizeAck`/`reconcileSubmission`/mã lỗi của `submitFromModal`.

## UI and interaction

- Xem `ui-states.md`. Chế độ `practice`, tiếng Việt, "bạn"; theo tờ `BaiTapWriting`.
- Bài không giờ: lớp phủ trên trang; bài có giờ: thanh tập trung chế độ luyện.
- Bàn phím: Esc đóng hộp khi không đang nộp; bẫy tiêu điểm trong hộp; 390px dùng được.

## Work decomposition

1. G08-T09 (PR `high-risk`, frontend): nhánh mới sau cờ, FR-001…015, hàm khôi phục nháp,
   bước `clickIfPresent`, Playwright journey cờ bật, cập nhật test đọc nguồn bị vỡ có chủ ý
   (liệt kê trong PR). Phụ thuộc EXAMROOM-0066 T001–T004.
2. Bật cờ `writing` trên staging, nghiệm thu, rồi production khi anh Andy nói rõ.

## Rollout and rollback

Xem `rollout.md`.

## Verification strategy

- `node --test frontend/tests/writing-draft-recovery.test.mjs`: bốn nhánh của FR-009,
  bài chỉ đọc, chủ khác.
- Playwright `frontend/tests/writing-exam-room.spec.js` với `?exam_room=on` và API giả:
  nộp thiếu từ Task 1/Task 2, hộp hỏi lại, `dialog` = 0, offline → online, tải lại sau
  offline, hết giờ khi đang gõ (`page.clock`), 401 giữa bài, đóng X, hai tab.
- `node frontend/tooling/verify-write-flows.mjs` (luồng `writing-submit`) ở hai nhánh cờ:
  `writes` giống hệt.
- `node frontend/tooling/verify-writing-admission-flow.mjs <base>` ở hai nhánh.
- Bộ test đọc nguồn hiện có (`writing-*.test.mjs`, `core-operation-integration.test.mjs`),
  `test:react`, `tsc --noEmit`, `npm run build`.
- Staging: bài "QA TEST Task 2 – do not use": gõ, offline, có mạng lại, đóng X, mở lại,
  nộp với 182 từ.
