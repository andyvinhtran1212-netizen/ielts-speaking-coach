# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=journey; ref=frontend/tooling/verify-speaking-flow.mjs flag off (unchanged writes and DOM) and flag on (same writes, same order) | PENDING |
| FR-002 | kind=test; ref=frontend/tests/practice-exam-room-events.test.mjs (no new events when the flag is off; mic and level events when on) | PENDING |
| FR-003 | kind=test; ref=frontend/tests/react/practice-exam-room.test.tsx (four mic cases, waiting state shown before getUserMedia resolves, button locked, granted skips the first step) | PENDING |
| FR-004 | kind=test; ref=frontend/tests/react/practice-exam-room.test.tsx (Ready, Recording, silent after 3 s, browser pause on mute, Recorded with duration) | PENDING |
| FR-005 | kind=test; ref=frontend/tests/react/practice-exam-room.test.tsx (too short per MIN_RECORD_SEC and detail.min_seconds, Part 2 in-page reason, no alert) | PENDING |
| FR-006 | kind=test; ref=frontend/tests/react/practice-exam-room.test.tsx (re-record asks only for unsent takes, Keep recording primary, Part 2 retry discard asks) | PENDING |
| FR-007 | kind=test; ref=frontend/tests/react/practice-exam-room.test.tsx (leave with unsent work blocks navigation, Stay keeps the page, discard navigates in code; leave without unsent work is immediate) | PENDING |
| FR-008 | kind=journey; ref=frontend/tooling/write-flows/speaking-record-submit.mjs (submit with unsent takes opens the in-page dialog, Resend primary, writes unchanged both branches) | PENDING |
| FR-009 | kind=test; ref=frontend/tests/react/practice-exam-room.test.tsx (no audio in browser storage, no copy promising a kept recording after reload) | PENDING |
| FR-010 | kind=test; ref=frontend/tests/react/practice-exam-room.test.tsx (noRedirect on upload and complete, 401 keeps the take and shows the re-login dialog) | PENDING |
| FR-011 | kind=test; ref=frontend/tests/react/practice-exam-room.test.tsx (practice and test_part Vietnamese, test_full in a sitting English, return to /mock-exam?sitting=) | PENDING |
| FR-012 | kind=journey; ref=frontend/playwright.speaking-regression.config.js flag on, Playwright dialog count = 0 | PENDING |
| FR-013 | kind=test; ref=frontend/tests/practice-exam-room-events.test.mjs (event names, surface=speaking, no audio or transcript in payload) | PENDING |

Đối chiếu số FR của GOI-08 ↔ spec này:

| GOI-08 | Spec |
| --- | --- |
| FR-08-038 | FR-003, FR-004, FR-005, FR-006, FR-007, FR-008 |
| FR-08-011 (chế độ luyện) | FR-007 |
| FR-08-034 | FR-008 |
| FR-08-015 (khung) | Edge cases (hai tab) |
| FR khung khác áp cho Speaking (EXAMROOM-0066) | FR-001, 002, 009…013 |

## Contract evidence

- OpenAPI/type drift: không có (không đổi backend).
- Backward compatibility: cờ tắt mặc định; `practice.js` không phát sự kiện mới khi cờ tắt.

## Data evidence

- Migration/schema query: N/A.
- Immediate state versus full reload: câu đã gửi hiện lại từ máy chủ; bản chưa gửi mất khi tải lại
  như hôm nay và không có chữ nào hứa khác; PENDING.

## UI evidence

- Viewports/themes/input methods: ảnh 1280px và 390px của bốn ca micro, đang ghi, đã ghi và các
  hộp; sáng và tối.

## Release evidence

- Staging SHA and checks: PENDING.
- Production verification: N/A cho tới khi anh Andy cho bật.
