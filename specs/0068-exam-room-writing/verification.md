# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=existing frontend/tests/writing-*.test.mjs with flag off (unchanged) + verify-write-flows writing-submit writes identical | PENDING |
| FR-002 | kind=check; ref=node frontend/tooling/verify-write-flows.mjs (writing-submit, both flag branches, clickIfPresent confirm) | PENDING |
| FR-003 | kind=test; ref=frontend/tests/writing-exam-room.spec.js (untimed overlay without focus bar; timed uses focus bar practice mode, Vietnamese timer, no email) | PENDING |
| FR-004 | kind=test; ref=frontend/tests/writing-exam-room.spec.js (counter 150/250 by task_type, warning style below minimum) | PENDING |
| FR-005 | kind=test; ref=frontend/tests/writing-exam-room.spec.js (short-essay dialog, confirm dialog, one submit request, zero dialog events) | PENDING |
| FR-006 | kind=test; ref=frontend/tests/writing-exam-room.spec.js (page.clock time up while typing; confirmed only after ack; offline at 0 queues submit with same request_id; bounded retries) | PENDING |
| FR-007 | kind=test; ref=frontend/tests/writing-exam-room.spec.js (Saved at HH:MM persists, retry after failed save) | PENDING |
| FR-008 | kind=test; ref=frontend/tests/writing-exam-room.spec.js (local copy keyed by ownerKey and assignment, cleanup on ack/submit/sign-out/other account) | PENDING |
| FR-009 | kind=test; ref=frontend/tests/writing-draft-recovery.test.mjs (receipt wins; local newer and server unchanged → local; server changed → ask; same text → server; read-only → server) | PENDING |
| FR-010 | kind=test; ref=frontend/tests/writing-exam-room.spec.js (close saved → closes and URL drops assignment_id; unsaved → dialog with Stay primary) | PENDING |
| FR-011 | kind=test; ref=frontend/tests/writing-exam-room.spec.js (offline banner; 401 on PATCH keeps URL, timer sync uses noRedirect, fallback login link) | PENDING |
| FR-012 | kind=test; ref=frontend/tests/writing-exam-room.spec.js (no credits line without data; 402 class/online notices keep text; 403/503 server message) | PENDING |
| FR-013 | kind=test; ref=frontend/tests/writing-exam-room.spec.js (two tabs: read-only tab sends no PATCH/paste-log/submit) | PENDING |
| FR-014 | kind=check; ref=frontend/tests/writing-exam-room.spec.js (existing submit notices unchanged text, bạn wording) | PENDING |
| FR-015 | kind=test; ref=frontend/tests/writing-exam-room.spec.js (event names, surface=writing, no essay text in payload) | PENDING |

Đối chiếu số FR của GOI-08 ↔ spec này:

| GOI-08 | Spec |
| --- | --- |
| FR-08-032 | FR-004, FR-005 |
| FR-08-033 | FR-008, FR-009, FR-010 |
| FR-08-034 (phần Writing bài giao) | FR-012 |
| FR-08-012, 013, 014 (khung) | FR-007, FR-011 |
| FR-08-015 (khung) | FR-013 |
| FR-08-016, 017 (khung, bài có giờ) | FR-003, FR-006 |
| FR-08-040 | FR-005 |
| GOI-08 mục 5.6 | FR-015 |
| FR-08-046 (Writing tự luyện) | ngoài phạm vi, câu hỏi mở 1 |

## Contract evidence

- OpenAPI/type drift: không có (không đổi backend).
- Backward compatibility: cờ `writing` tắt mặc định; nhánh cũ không đổi.

## Data evidence

- Migration/schema query: N/A, không migration.
- Immediate state versus full reload: Scenario 4 (tải lại sau mất mạng), PENDING.

## UI evidence

- Viewports/themes/input methods: ảnh 1280px và 390px của trình soạn bài không giờ và
  bài có giờ, sáng và tối; bàn phím theo journey.

## Release evidence

- Staging SHA and checks: PENDING.
- Production verification: N/A cho tới khi anh Andy cho bật Writing.
