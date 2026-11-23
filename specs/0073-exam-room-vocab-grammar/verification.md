# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=journey; ref=frontend/tooling/verify-quiz-flow.mjs flag off (unchanged writes and DOM) and flag on (same writes, same order) | PENDING |
| FR-002 | kind=test; ref=frontend/tests/react/quiz-room.test.tsx and frontend/tests/react/flashcard-study-room.test.tsx (practice mode, no timer, no submit, surface=drill, no email) | PENDING |
| FR-003 | kind=test; ref=frontend/tests/react/flashcard-study-room.test.tsx (rate buttons and number keys inert before the first flip, flipping back keeps them enabled, next card resets, both SRS and public sets) | PENDING |
| FR-004 | kind=ui; ref=screenshots 1280x800 and 390x844 with the longest back face, flip and rate buttons visible without page scroll, buttons at least 44px | PENDING |
| FR-005 | kind=test; ref=frontend/tests/react/flashcard-study-room.test.tsx ("Thẻ N trên M") | PENDING |
| FR-006 | kind=test; ref=frontend/tests/react/flashcard-study-room.test.tsx (unknown sourceType shows "Từ vựng cá nhân", save error copy without HTTP codes, retry resends the same client_review_id) | PENDING |
| FR-007 | kind=test; ref=frontend/tests/react/flashcard-study-room.test.tsx (summary by level, public-set device note kept) | PENDING |
| FR-008 | kind=test; ref=frontend/tests/react/quiz-room.test.tsx ("Câu N" counts repeats, no "trên M" when the total is unknown, "Đã thuộc X/Y") | PENDING |
| FR-009 | kind=test; ref=frontend/tests/react/quiz-room.test.tsx (one question per screen, answer locks, immediate feedback, no back button) | PENDING |
| FR-010 | kind=test; ref=frontend/tests/react/quiz-room.test.tsx (in-page reset dialog, "Giữ tiến độ" primary and first focus, reset path and validQuizReset unchanged) | PENDING |
| FR-011 | kind=test; ref=frontend/tests/quiz-player-next-model.test.mjs (displayPointLabel: title, label, then "Điểm ngữ pháp N"; never the raw key) | PENDING |
| FR-012 | kind=test; ref=frontend/tests/react/quiz-room.test.tsx and frontend/tests/react/flashcard-study-room.test.tsx (flush then exit, "Còn N câu chưa lưu" dialog, Stay keeps the page) | PENDING |
| FR-013 | kind=test; ref=frontend/tests/react/quiz-room.test.tsx (401 with noRedirect keeps the attempt and outbox, re-login dialog, other account discards) | PENDING |
| FR-014 | kind=journey; ref=frontend/tooling/verify-quiz-flow.mjs flag on, Playwright dialog count = 0 | PENDING |
| FR-015 | kind=test; ref=frontend/tests/react/flashcard-study-room.test.tsx (space flips, number keys only after flip, keys ignored in inputs and buttons, aria-live, reduced motion) | PENDING |
| FR-016 | kind=test; ref=frontend/tests/react/quiz-room.test.tsx (event names, surface=drill, kind, no question, answer or word in payload) | PENDING |

Đối chiếu số FR của GOI-08 ↔ spec này:

| GOI-08 | Spec |
| --- | --- |
| FR-08-039 | FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011 |
| FR-08-011 (chế độ luyện) | FR-012 |
| FR-08-040 | FR-010, FR-014 |
| FR khung khác áp cho bài luyện (EXAMROOM-0066) | FR-001, FR-002, FR-013, FR-015, FR-016 |

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
