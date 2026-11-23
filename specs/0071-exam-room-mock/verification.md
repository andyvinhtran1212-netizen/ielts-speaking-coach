# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=journey; ref=frontend/tooling/verify-mock-exam-flow.mjs flag off (unchanged writes and DOM) and flag on (same writes, same order) | PENDING |
| FR-002 | kind=test; ref=frontend/tests/react/mock-exam-room.test.tsx (render-only file receives state and handlers) | PENDING |
| FR-003 | kind=test; ref=frontend/tests/react/mock-exam-room.test.tsx (runner owns timer from sectionTimeLeftSeconds, 5-minute and 0 marks, no email, embedded child has no top bar/timer/submit/exit) | PENDING |
| FR-004 | kind=journey; ref=frontend/tooling/verify-mock-exam-flow.mjs (no manual submit in sequential/retake; mock-flush → flush-ack → domain submit → section submit order; invalid mock-flushed rejected) | PENDING |
| FR-005 | kind=test; ref=frontend/tests/react/mock-exam-room.test.tsx (section strip from configuredMockSections, not clickable) | PENDING |
| FR-006 | kind=test; ref=frontend/tests/react/mock-exam-room.test.tsx (Words: n · minimum 150/250, no separate save button, Saved at HH:MM, time-up locks and submits both tasks, message only after confirmed) | PENDING |
| FR-007 | kind=test; ref=frontend/tests/mock-exam-room-model.test.mjs (mockSubmitOutcome: settled, collected after flush-ack, collected with unsaved → closed_unconfirmed, 3 retries then unconfirmed_manual, 403/404) | PENDING |
| FR-008 | kind=test; ref=frontend/tests/react/mock-exam-room.test.tsx (Leave the test? dialog, no Abandon test, flush before leaving, unsaved count, return resumes the running section) | PENDING |
| FR-009 | kind=test; ref=frontend/tests/react/mock-exam-room.test.tsx (collection locks the body with Saving your final answers…, no blocking dialog) | PENDING |
| FR-010 | kind=test; ref=frontend/tests/mock-exam-room-model.test.mjs (reconcileMockWritingCopy: compare by baseText, legacy equal → dropped, differs → ask, legacy key kept until new key reads back, other owner never read) + mock-exam-room.test.tsx (read-back on leave) | PENDING |
| FR-011 | kind=test; ref=frontend/tests/react/mock-exam-room.test.tsx (offline banner, owed timed submit queued) | PENDING |
| FR-012 | kind=test; ref=frontend/tests/react/mock-exam-room.test.tsx (noRedirect on runner calls, 401 dialog, /login fallback only after verified copy, other account sees no copy) | PENDING |
| FR-013 | kind=test; ref=frontend/tests/react/mock-exam-room.test.tsx (read-only tab: no writing save, no flush-ack, no submit, no iframe) | PENDING |
| FR-014 | kind=test; ref=backend/tests/test_mock_exam_learner_audience.py (audience 404, self_paced timeline with fake clock, sweep job, single sitting, start after open_until 409) + frontend/tests/react/mock-exam-self-paced.test.tsx (no Continue later / Start next section, Submit section dialog) | PENDING |
| FR-015 | kind=test; ref=frontend/tests/react/mock-exam-room.test.tsx (no credit line in any runner dialog) | PENDING |
| FR-016 | kind=test; ref=frontend/tests/react/mock-exam-room.test.tsx (outside-exam screens in English with Vietnamese sub-line, Start Speaking unchanged) | PENDING |
| FR-017 | kind=journey; ref=frontend/tooling/verify-mock-exam-flow.mjs flag on, Playwright dialog count = 0 | PENDING |
| FR-018 | kind=test; ref=frontend/tests/react/mock-exam-room.test.tsx (event names, surface=mock, no answers in payload, integrity reports unchanged) | PENDING |

Đối chiếu số FR của GOI-08 ↔ spec này:

| GOI-08 | Spec |
| --- | --- |
| FR-08-037 | FR-003, FR-005, FR-006 |
| FR-08-043 | FR-014 |
| FR-08-044 | FR-015 |
| FR-08-011 (khung, không bỏ bài) | FR-008 |
| FR-08-020 (nhúng) | FR-003, FR-004 |
| FR-08-012, 013, 014 (khung) | FR-010, FR-011, FR-012 |
| FR-08-015 (khung) | FR-013 |
| FR khung khác áp cho runner (EXAMROOM-0066) | FR-001, 002, 007, 009, 016…018 |

## Contract evidence

- OpenAPI/type drift: G08-T16 không có. G08-T22 PR 1 thêm trường phía học viên theo MOCKORG-0086
  và sinh lại `frontend/types/api.d.ts`.
- Backward compatibility: cờ `mock` tắt mặc định; cờ `mock_exam_audiences_learner` tắt giữ đường
  `cohort_id`/`mock_exam_assignments` cũ.

## Data evidence

- Migration/schema query: N/A ở G08-T16; G08-T22 dùng bảng của G09-T31.
- Immediate state versus full reload: tải lại giữa phần vào đúng phần với thời gian còn lại theo
  máy chủ và chữ Writing đã ack; PENDING.

## UI evidence

- Viewports/themes/input methods: ảnh 1280px phần Reading, Listening, Writing và hộp thoát; 390px
  là ảnh màn chặn. Luôn sáng.

## Release evidence

- Staging SHA and checks: PENDING.
- Production verification: N/A cho tới khi anh Andy cho bật.
