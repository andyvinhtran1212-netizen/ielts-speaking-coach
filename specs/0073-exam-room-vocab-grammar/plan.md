# Implementation plan

## Architecture impact

- `frontend/app/(authed-quiz-player)/quiz/quiz-player.tsx`: một chỗ rẽ nhánh `examRoomEnabled('drill')` sau các hook; nhánh mới
  vẽ `quiz-room.tsx` (file mới cùng thư mục) bằng `ExamRoomShell` chế độ `practice`,
  `layout.kind='single'`, không `timer`, không `submit`.
- `frontend/lib/quiz-player-api.ts`: thêm tuỳ chọn `noRedirect` cho 401 (L22), chỉ nhánh mới truyền và chỉ sau khi bài đã tải (FR-013);
  nhánh cũ giữ chuyển trang như hôm nay.
- `frontend/lib/quiz-player-model.mjs`: hàm thuần `displayPointLabel(bank, key, index)` cho FR-011
  (cạnh `displayItemKey` L295); hộp làm lại thay `window.confirm` (L460) chỉ ở nhánh mới.
- `frontend/app/(flashcard-study)/flashcard-study/flashcard-study-player.tsx`: một chỗ rẽ nhánh; nhánh mới vẽ
  `flashcard-study-room.tsx` (file mới) với cờ "đã lật" theo thẻ, vùng cuộn trong thẻ, hàng nút
  cố định; `personalRequest` nhận `noRedirect` (L84–89).
- Nếu G07-T06 (PR #2512) merge trước, thư mục flashcard là
  `frontend/app/(flashcard-study)/vocabulary/flashcards/study/`; PR mã theo đường đang có trên
  `staging` và ghi trong PR.
- Không sửa layout, `pageStylesheets`, `frontend/public/js/*.js`, `components/authed-shell.tsx`.
- Backend: không đổi.

## Data and contracts

- Không migration, không route mới, không đổi shape: `GET /api/quiz/banks/{id}`, các lời gọi
  session/answer/reset của Quick Check, `POST /api/flashcards/{id}/review` (cùng
  `client_review_id`), bộ công khai đọc như hôm nay.
- Outbox Quick Check (`quiz-native-outbox`) và `pagehide` `keepalive` giữ nguyên; `exit.flush`
  gọi `outbox.flush(true)` rồi đếm lượt chưa ack.
- Bộ nhớ trình duyệt: bộ công khai giữ khoá hiện có; không thêm khoá mới, không dùng khoá ghi của
  khung (0066 FR-017).

## UI and interaction

- Xem `ui-states.md`. Chế độ `practice` (tiếng Việt, "bạn").
- Bàn phím: phím cách lật, phím số chấm sau khi lật; hộp có bẫy tiêu điểm, tiêu điểm đầu ở nút
  an toàn ("Giữ tiến độ", "Ở lại").
- Giảm chuyển động: không xoay 3D khi `prefers-reduced-motion: reduce`.
- Bề rộng: 1280×800 và 390×844 là hai khung nghiệm thu FR-004.

## Work decomposition

1. G08-T20 (PR `high-risk`, frontend): FR-001…FR-016 cho cả hai trình, test React, test model và
   journey hai nhánh cờ.
2. Bật cờ `drill` trên staging khi anh Andy gõ duyệt, nghiệm thu, rồi production khi anh nói rõ.

## Rollout and rollback

Xem `rollout.md`. Cờ `drill` mặc định tắt; rollback mức 1 là bỏ `drill` khỏi `examRoomSurfaces`.

## Verification strategy

- `npm --prefix frontend run test:react`: `quiz-room.test.tsx`, `flashcard-study-room.test.tsx`.
- `node --import ./frontend/tests/fixtures/legacy-html-retired/loader.mjs --test frontend/tests/*.test.mjs frontend/tests/*.test.js`:
  test model và test đọc nguồn hai trình ở nhánh cũ.
- Ba journey Quick Check ở hai nhánh cờ, đếm sự kiện `dialog`; ảnh flashcard 1280×800 và 390×844.
- `cd frontend && npx tsc --noEmit && npm run build`.
