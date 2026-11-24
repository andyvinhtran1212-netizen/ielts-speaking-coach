# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=existing listening-programme-form-scope.test.tsx, listening-programme-replay-stop.test.tsx, verify-listening-programme-context-flow.mjs with flag off (unchanged) | PENDING |
| FR-002 | kind=test; ref=frontend/tests/react/programme-form-room.test.tsx (blank list, Esc no submit, supplements not counted) | PENDING |
| FR-003 | kind=test; ref=frontend/tests/react/programme-form-room.test.tsx (reveal pending locks confirm, unlocks after) | PENDING |
| FR-004 | kind=test; ref=frontend/tests/react/programme-form-room.test.tsx (submit error keeps dialog and answers, retry) | PENDING |
| FR-005 | kind=test; ref=frontend/tests/react/programme-form-room.test.tsx (Saved at HH:MM from tracker succeed, retry failed question) | PENDING |
| FR-006 | kind=test; ref=frontend/tests/react/programme-form-room.test.tsx (navigator states, click moves to group in guided mode) | PENDING |
| FR-007 | kind=test; ref=frontend/tests/react/programme-form-room.test.tsx (practice policy maps to AudioPlayer practice, other audio paused) | PENDING |
| FR-008 | kind=test; ref=frontend/tests/react/programme-form-room.test.tsx (once: warning first, one playback-started, no pause, unconfirmed state kept) | PENDING |
| FR-009 | kind=test; ref=frontend/tests/listening-programme-draft-migrate.test.mjs (legacy draft: equal to server → dropped; differs → learner asked, nothing sent; legacy key removed only after the new key reads back; new-key write refused → legacy key kept; other owner key never read; cleanup; compare by baseValue not timestamps; storage refuses writes + offline/401 → exit dialog has only Stay, no keep-copy promise, no /login redirect) | PENDING |
| FR-010 | kind=test; ref=frontend/tests/react/programme-form-room.test.tsx (noRedirect on calls, 401 dialog, offline label) | PENDING |
| FR-011 | kind=test; ref=frontend/tests/react/programme-form-room.test.tsx (two runners: only active shows dialogs and holds the lock; deactivating flushes the queue, failed answers go to the verified local copy, then releases the lock) | PENDING |
| FR-012 | kind=test; ref=frontend/tests/react/programme-form-room.test.tsx (second tab gets the same attempt_id from resume-or-create and is read-only; sends no PATCH/reveal/playback-started/submit) | PENDING |
| FR-013 | kind=journey; ref=verify-listening-programme-context-flow.mjs flag on, Playwright dialog count = 0 | PENDING |
| FR-014 | kind=test; ref=frontend/tests/react/programme-form-room.test.tsx (event names, surface, no answers in payload) | PENDING |
| FR-015 | kind=test; ref=frontend/tests/react/programme-form-room.test.tsx (LISTENING_PRACTICE_SURFACE is the only place the name appears; before 0066 amendment 1(b) it is 'listening') | PENDING |

Đối chiếu số FR của GOI-08 ↔ spec này:

| GOI-08 | Spec |
| --- | --- |
| FR-08-035 | FR-002, FR-003, FR-004 |
| FR-08-024 (phần luyện) | FR-007 |
| FR-08-025 | FR-008 (theo EXAMROOM-0066 FR-029, câu hỏi mở 1) |
| FR-08-010 (khung) | FR-002 |
| FR-08-012, 013, 014 (khung) | FR-005, FR-010 |
| FR-08-015 (khung) | FR-012 |
| FR-08-040 | FR-013 |
| GOI-08 mục 5.5, 5.6 | FR-009, FR-014 |

## Contract evidence

- OpenAPI/type drift: không có (không đổi backend).
- Backward compatibility: cờ tắt mặc định; nhánh cũ không đổi.

## Data evidence

- Migration/schema query: N/A.
- Immediate state versus full reload: tải lại giữa bài khôi phục câu đã ack từ máy chủ và
  câu chưa ack từ bản sao; PENDING.

## UI evidence

- Viewports/themes/input methods: ảnh 1280px và 390px của bài programme và Day 52, sáng và
  tối.

## Release evidence

- Staging SHA and checks: PENDING.
- Production verification: N/A cho tới khi anh Andy cho bật.
