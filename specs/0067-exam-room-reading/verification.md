# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=frontend/tests/reading-native/*.spec.js with flag off (unchanged) + write-flows reading-exam-* writes identical | PENDING |
| FR-002 | kind=check; ref=node frontend/tooling/verify-write-flows.mjs (same writes both flag branches) | PENDING |
| FR-003 | kind=test; ref=frontend/tests/reading-native/exam-room.spec.js (no email in DOM, title and passage label) | PENDING |
| FR-004 | kind=test; ref=frontend/tests/reading-native/exam-room.spec.js (390px full test shows block and no attempt POST; mini test works) | PENDING |
| FR-005 | kind=test; ref=frontend/tests/reading-native/exam-room.spec.js (start new attempt dialog, no dialog event) | PENDING |
| FR-006 | kind=test; ref=frontend/tests/reading-native/exam-room.spec.js (drag to 64%, reload keeps ratio) | PENDING |
| FR-007 | kind=test; ref=frontend/tests/reading-native/exam-room.spec.js (navigator by passage, one flag control, flags restore on resume) | PENDING |
| FR-008 | kind=test; ref=frontend/tests/react/exam-room-questions.test.tsx (answer strings equal current Reading renderer) | PENDING |
| FR-009 | kind=test; ref=frontend/tests/reading-native/exam-room.spec.js (Saved at HH:MM, retry on failed) | PENDING |
| FR-010 | kind=test; ref=frontend/tests/reading-native/exam-room.spec.js (blank list; page.clock time up while typing; outcome confirmed only after submit ack or re-read; offline at 0 queues auto-submit) | PENDING |
| FR-011 | kind=test; ref=frontend/tests/reading-native/exam-room.spec.js (leave flushes, unsaved count) | PENDING |
| FR-012 | kind=test; ref=backend/tests/test_reading_abandon_attempt.py + exam-room.spec.js (abandon self-selected only, 404/409 cases, excluded from results) | PENDING |
| FR-013 | kind=test; ref=frontend/tests/reading-native/exam-room.spec.js (offline → online) | PENDING |
| FR-014 | kind=test; ref=frontend/tests/reading-native/exam-room.spec.js (401 on PATCH, URL unchanged, local copy keyed by ownerKey, resend only unchanged answers after same-account sign-in, other account cannot see it) | PENDING |
| FR-015 | kind=test; ref=frontend/tests/reading-native/exam-room.spec.js (two tabs; old tab flushes before releasing the lock; no lock in 5 s keeps new tab read-only) | PENDING |
| FR-016 | kind=check; ref=node frontend/tooling/verify-mock-exam-flow.mjs (mock-flush answered with flag on) | PENDING |
| FR-017 | kind=test; ref=frontend/tests/reading-native/exam-room.spec.js (admin_preview no PATCH, no submit) | PENDING |
| FR-018 | kind=test; ref=frontend/tests/reading-native/exam-room.spec.js (highlight and note survive reload) | PENDING |
| FR-019 | kind=journey; ref=exam-room.spec.js Playwright dialog listener count = 0 | PENDING |
| FR-020 | kind=test; ref=frontend/tests/reading-native/exam-room.spec.js (analytics events surface=reading, no answers) | PENDING |

Đối chiếu với GOI-08: FR-08-030 → FR-001, 002, 016, 017; FR-08-031 → FR-005; FR-08-041
(phần Reading) → FR-012; FR khung áp cho Reading (EXAMROOM-0066) → FR-003, 004, 006…011,
013…015, 018…020.

## Contract evidence

- OpenAPI/type drift: một route mới `POST /api/reading/test/attempts/{attempt_id}/abandon`;
  `frontend/types/api.d.ts` sinh lại trong PR T003. Mọi route khác không đổi.
- Backward compatibility: cờ tắt thì giao diện và request như hôm nay; route mới chỉ được
  gọi từ nhánh cờ bật.

## Data evidence

- Migration/schema query: không có migration. Sau T004 trên staging:
  `SELECT status, count(*) FROM reading_test_attempts WHERE user_id = '<qa>' GROUP BY 1;`
- Immediate state versus full reload: Scenario 2 và FR-007 (cờ xem lại khôi phục sau tải lại).

## UI evidence

- Viewports/themes/input methods: ảnh 1280/768/390 (full test 390 là màn chặn), giao diện
  Tối của người dùng vẫn ra phòng thi sáng; bàn phím cho tay nắm, dải câu, hộp.

## Release evidence

- Staging SHA and checks: PENDING.
- Production verification: PENDING (chỉ sau khi anh Andy cho bật).
