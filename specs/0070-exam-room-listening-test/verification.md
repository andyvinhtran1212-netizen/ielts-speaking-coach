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
