# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=journey; ref=frontend/tooling/verify-quiz-flow.mjs flag off (unchanged writes and DOM) and flag on (same writes, same order); Review R164 (mytq2y, 23/11, #2614 @d005a3ca gồm #2597): journey quiz cờ tắt/bật cùng request, cùng thứ tự: đạt (26/26). | PENDING |
| FR-002 | kind=test; ref=frontend/tests/react/quiz-room.test.tsx and frontend/tests/react/flashcard-study-room.test.tsx (practice mode, no timer, no submit, surface=drill, no email); Review R164 (mytq2y, 23/11, #2614 @d005a3ca gồm #2597): đạt (vitest 57/57). | PENDING |
| FR-003 | kind=test; ref=frontend/tests/react/flashcard-study-room.test.tsx (rate buttons and number keys inert before the first flip, flipping back keeps them enabled, next card resets, both SRS and public sets); Review R164 (mytq2y, 23/11, #2614 @d005a3ca gồm #2597): đạt; journey flashcard: khoá chấm trước khi lật, phím số không chấm, 4 khổ × sáng/tối. | PENDING |
| FR-004 | kind=ui; ref=screenshots 1280x800 and 390x844 with the longest back face, flip and rate buttons visible without page scroll, buttons at least 44px; Review R164 (mytq2y, 23/11, #2614 @d005a3ca gồm #2597): journey verify-flashcard-drill-screens.mjs 37/37: 1280×800 và 390×844, sáng/tối, nút lật và chấm trên màn đầu, không cuộn trang, nút ≥ 44px, mặt sau dài cuộn trong thẻ; chưa đính ảnh. | PENDING |
| FR-005 | kind=test; ref=frontend/tests/react/flashcard-study-room.test.tsx ("Thẻ N trên M"); Review R164 (mytq2y, 23/11, #2614 @d005a3ca gồm #2597): đạt. | PENDING |
| FR-006 | kind=test; ref=frontend/tests/react/flashcard-study-room.test.tsx (unknown sourceType shows "Từ vựng cá nhân", save error copy without HTTP codes, retry resends the same client_review_id); Review R164 (mytq2y, 23/11, #2614 @d005a3ca gồm #2597): đạt. | PENDING |
| FR-007 | kind=test; ref=frontend/tests/react/flashcard-study-room.test.tsx (summary by level, public-set device note kept); Review R164 (mytq2y, 23/11, #2614 @d005a3ca gồm #2597): đạt với bộ công khai (câu "trên thiết bị này"); Low: chưa có test cho bảng bốn mức SRS của thẻ cá nhân (code có, flashcard-study-room.tsx L172–188). | PENDING |
| FR-008 | kind=test; ref=frontend/tests/react/quiz-room.test.tsx ("Câu N" counts repeats, no "trên M" when the total is unknown, "Đã thuộc X/Y"); Review R164 (mytq2y, 23/11, #2614 @d005a3ca gồm #2597): đạt. | PENDING |
| FR-009 | kind=test; ref=frontend/tests/react/quiz-room.test.tsx (one question per screen, answer locks, immediate feedback, no back button); Review R164 (mytq2y, 23/11, #2614 @d005a3ca gồm #2597): đạt. | PENDING |
| FR-010 | kind=test; ref=frontend/tests/react/quiz-room.test.tsx (in-page reset dialog, "Giữ tiến độ" primary and first focus, reset path and validQuizReset unchanged); Review R164 (mytq2y, 23/11, #2614 @d005a3ca gồm #2597): đạt; journey quiz: reset mất ACK reconcile, 0 hộp gốc. | PENDING |
| FR-011 | kind=test; ref=frontend/tests/quiz-player-next-model.test.mjs (displayPointLabel: title, label, then "Điểm ngữ pháp N"; never the raw key); Review R164 (mytq2y, 23/11, #2614 @d005a3ca gồm #2597): đạt. | PENDING |
| FR-012 | kind=test; ref=frontend/tests/react/quiz-room.test.tsx and frontend/tests/react/flashcard-study-room.test.tsx (flush then exit, "Còn N câu chưa lưu" dialog, Stay keeps the page); Review R164 (mytq2y, 23/11, #2614 @d005a3ca gồm #2597): đạt. | PENDING |
| FR-013 | kind=test; ref=frontend/tests/react/quiz-room.test.tsx (401 mid-attempt with noRedirect keeps the attempt and outbox, re-login dialog, other account discards; 401 on first load still redirects to /login?next=); Review R164 (mytq2y, 23/11, #2614 @d005a3ca gồm #2597): 401 giữa bài và cùng tài khoản quay lại: đạt (vitest + journey quiz); Low: chưa có test "tài khoản khác thì bỏ bài" (code ở quiz-player.tsx L129/L387). | PENDING |
| FR-014 | kind=journey; ref=frontend/tooling/verify-quiz-flow.mjs flag on, Playwright dialog count = 0; Review R164 (mytq2y, 23/11, #2614 @d005a3ca gồm #2597): journey quiz cờ bật dialogs=0: đạt. | PENDING |
| FR-015 | kind=test; ref=frontend/tests/react/flashcard-study-room.test.tsx (space flips, number keys only after flip, keys ignored in inputs and buttons, aria-live, reduced motion); Review R164 (mytq2y, 23/11, #2614 @d005a3ca gồm #2597): đạt; reduced motion chỉ có CSS (flashcard-study-room.module.css L104), chưa có test. | PENDING |
| FR-016 | kind=test; ref=frontend/tests/react/quiz-room.test.tsx (event names, surface=drill, kind, no question, answer or word in payload); Review R164 (mytq2y, 23/11, #2614 @d005a3ca gồm #2597): đạt (kind=quiz, không có câu, đáp án hay từ). | PENDING |

Đối chiếu số FR của GOI-08 ↔ spec này:

| GOI-08 | Spec |
| --- | --- |
| FR-08-039 | FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011 |
| FR-08-011 (chế độ luyện) | FR-012 |
| FR-08-040 | FR-010, FR-014 |
| FR khung khác áp cho bài luyện (EXAMROOM-0066) | FR-001, FR-002, FR-013, FR-015, FR-016 |

## Review độc lập T004 (R164)

Người review: thread mytq2y, không phải tác giả chuỗi 0073. Bản được kiểm: #2614 @`d005a3ca`, đã gồm #2597.

- Node, 29 tệp `quiz*`, `flashcard*` và `exam-room*`: 380/380 đạt.
- vitest `quiz-room` + `flashcard-study-room` + `quiz*` + `flashcard*`: 57/57 đạt. `tsc --noEmit` sạch.
- Journey trên `npm run build` + `next start`, dùng env và fixture API như CI `next-native-browser.yml`:
  - `verify-quiz-flow.mjs`: 26/26 đạt.
  - `verify-grammar-managed-quiz-flow.mjs`: 311/311 đạt trên 64 kịch bản.
  - `verify-grammar-quiz-history-flow.mjs`: 134/134 đạt.
  - `verify-flashcard-drill-screens.mjs`: 37/37 đạt.
- Không có điểm chặn. Còn hai Low về test chưa có: FR-007 (bảng bốn mức SRS) và FR-013 (tài khoản khác thì bỏ bài). Cả hai đã ghi lên #2614.
- Cột Result vẫn để PENDING, vì code chưa lên `staging` và T003 (bật cờ trên staging) cần anh Andy duyệt.

## Contract evidence

- OpenAPI/type drift: không có (không đổi backend).
- Backward compatibility: cờ tắt mặc định; nhánh cũ giữ chuyển trang khi 401 và `window.confirm`
  khi làm lại như hôm nay.

## Data evidence

- Migration/schema query: N/A.
- Immediate state versus full reload: tiến độ Quick Check và lịch SRS đọc lại từ máy chủ sau khi
  tải lại; PENDING.

## UI evidence

- Viewports/themes/input methods: ảnh 1280×800 và 390×844 của thẻ trước và sau khi lật, hộp làm
  lại, hộp thoát; sáng và tối; bàn phím.

## Release evidence

- Staging SHA and checks: PENDING.
- Production verification: N/A cho tới khi anh Andy cho bật.
