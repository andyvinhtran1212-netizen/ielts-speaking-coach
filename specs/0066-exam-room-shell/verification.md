# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=frontend/tests/react/exam-room-shell.test.tsx (top bar slots, no email/name rendered) | PENDING |
| FR-002 | kind=test; ref=frontend/tests/react/exam-room-shell.test.tsx (test=en strings, practice=vi strings, full test data-theme=light) | PENDING |
| FR-003 | kind=test; ref=frontend/tests/react/exam-room-shell.test.tsx (separator pointer drag, keys, double click) | PENDING |
| FR-004 | kind=test; ref=frontend/tests/exam-room-split-ratio.test.mjs (clamp, per-attempt key, resize) | PENDING |
| FR-005 | kind=test; ref=frontend/tests/react/exam-room-shell.test.tsx (below 900px tabs keep scroll) | PENDING |
| FR-006 | kind=test; ref=frontend/tests/exam-room-navigator-model.test.mjs (13/13/14, 10x4, uneven passages, collapsed flagged) | PENDING |
| FR-007 | kind=test; ref=frontend/tests/exam-room-navigator-model.test.mjs + exam-room-shell.test.tsx (four states, labels, aria-current) | PENDING |
| FR-008 | kind=test; ref=frontend/tests/react/exam-room-shell.test.tsx (1280/1100/768/390 widths) | PENDING |
| FR-009 | kind=test; ref=frontend/tests/react/exam-room-shell.test.tsx (single flag control per question) | PENDING |
| FR-010 | kind=test; ref=frontend/tests/react/exam-room-shell.test.tsx + exam-room-submit-guard.test.mjs (blank list, focus, Esc, no costNote without data) | PENDING |
| FR-011 | kind=test; ref=frontend/tests/react/exam-room-shell.test.tsx (flush before leave, unsaved count, practice leaves at once) | PENDING |
| FR-012 | kind=test; ref=frontend/tests/react/exam-room-shell.test.tsx (abandon only when exit.abandon given) | PENDING |
| FR-013 | kind=test; ref=frontend/tests/react/exam-room-shell.test.tsx (save status texts and retry) | PENDING |
| FR-014 | kind=test; ref=frontend/tests/exam-room-connection-state.test.mjs + exam-room-shell.test.tsx (offline banner, waiting button, back online 5 s) | PENDING |
| FR-015 | kind=test; ref=frontend/tests/react/exam-room-shell.test.tsx (401 → saveLocalCopy then dialog, URL unchanged; fallback: Sign in again enabled only after read-back, opens /login?next= same tab; storage failure message; amendment 2: 401 + refused storage with unsaved answers offers only Stay and never navigates) | PENDING |
| FR-016 | kind=test; ref=frontend/tests/react/exam-room-shell.test.tsx (onSessionConflict displaced/not_current; fallback before G05-T20: displaced uses FR-015 flow, not_current shows another-device notice with Back) | PENDING |
| FR-017 | kind=test; ref=frontend/tests/exam-room-tab-guard.test.mjs (fake navigator.locks + BroadcastChannel: old tab flushes then releases lock, new tab writes only while holding lock; no lock in 5 s → new tab stays read-only with Reload; old tab answering after timeout does not make new tab write; no Web Locks → localStorage writer token checked before each save; nothing supported → no-op) | PENDING |
| FR-018 | kind=test; ref=frontend/tests/react/exam-room-shell.test.tsx (5-minute announcement once, time up text, never extends time) | PENDING |
| FR-019 | kind=test; ref=frontend/tests/react/exam-room-shell.test.tsx (input locks at 0, last typed value passed to submit; offline at 0 still queues auto-submit while manual button stays locked) | PENDING |
| FR-020 | kind=test; ref=frontend/tests/react/exam-room-shell.test.tsx (time-up choice calls onSend/onDiscard; no "saved and submitted" text; outcome states as FR-034) | PENDING |
| FR-021 | kind=test; ref=frontend/tests/react/exam-room-shell.test.tsx (remount restores ratio and section from props/storage) | PENDING |
| FR-022 | kind=test; ref=frontend/tests/exam-room-flags.test.mjs (empty default, null config false, override ignored in production and when environment is missing) | PENDING |
| FR-023 | kind=test; ref=frontend/tests/react/exam-room-shell.test.tsx (embedded hides top bar, timer, submit, exit) | PENDING |
| FR-024 | kind=test; ref=frontend/tests/react/exam-room-shell.test.tsx (isFullTest wraps gate before children mount) | PENDING |
| FR-025 | kind=test; ref=frontend/tests/react/exam-room-questions.test.tsx (six types; answer strings equal current renderer on reading-exam.json fixture) | PENDING |
| FR-026 | kind=test; ref=frontend/tests/react/exam-room-questions.test.tsx (in-room practice result view, never 0/0, no band under 40) | PENDING |
| FR-027 | kind=test; ref=frontend/tests/react/exam-room-questions.test.tsx (map labelling, short answer, summary, matrix) | PENDING |
| FR-028 | kind=test; ref=frontend/tests/react/exam-room-audio.test.tsx (maps policy to G03 AudioPlayer props; practice A–B; test has no seek/speed/pause and English copy; space key only in practice) | PENDING |
| FR-029 | kind=test; ref=frontend/tests/react/exam-room-audio.test.tsx (once: in-player warning before play, no pause and no shortcut while playing, no rewind, resume point) | PENDING |
| FR-030 | kind=test; ref=frontend/tests/react/exam-room-annotation.test.tsx, owned by T004 (highlight, note, mark fallback) | PENDING |
| FR-031 | kind=journey; ref=surface spec journeys (0067–0073) capturing Playwright `dialog` events with the surface flag on | PENDING |
| FR-032 | kind=test; ref=frontend/tests/exam-room-*.test.mjs (storage keys, expiry, try/catch on throwing storage) | PENDING |
| FR-033 | kind=test; ref=frontend/tests/react/exam-room-shell.test.tsx (event names and payload without answers; exam_room_offline sent on reconnect with duration_s) | PENDING |
| FR-034 | kind=test; ref=frontend/tests/react/exam-room-shell.test.tsx (submitting/confirmed/unconfirmed/unconfirmed_manual/closed_unconfirmed/expired_unsubmitted copy; closed attempt is never shown as confirmed; no auto-retry promise after the bounded tries; "saved and submitted" only after outcome=confirmed; offline, 401 and lost-response cases stay unconfirmed; shell never sets confirmed from calling onSubmit) | PENDING |
| FR-035 | kind=test; ref=frontend/tests/exam-room-local-copy.test.mjs (record holds ownerKey/attemptKey/baseValue/baseSavedAt, no email or name; other owner cannot read/restore/send; cleanup on ack, submit, abandon, sign-out, other-account sign-in, expiresAt; re-login resend only where the server value still equals baseValue, a paste-log-style timestamp bump with an unchanged value still resends, a record without baseValue asks instead of resending) + journey: shared browser A then B (Scenario 6a) | PENDING |

Đối chiếu số FR của GOI-08 ↔ spec này:

| GOI-08 | Spec | GOI-08 | Spec |
| --- | --- | --- | --- |
| FR-08-001…010 | FR-001…010 | FR-08-019 | FR-022 |
| FR-08-011 (thoát) | FR-011 | FR-08-020 | FR-023 |
| FR-08-041 (phần hộp) | FR-012 | FR-08-027 | FR-024 |
| FR-08-012 | FR-013 | FR-08-021…023 | FR-025…027 |
| FR-08-013 | FR-014 | FR-08-024 | FR-028 |
| FR-08-014 | FR-015 | FR-08-025 | FR-029 |
| FR-08-014a (phần hiển thị) | FR-016 | FR-08-026 | FR-030 |
| FR-08-015 | FR-017 | FR-08-040 | FR-031 |
| FR-08-016, 017 | FR-018, 019 | GOI-08 mục 5.5 | FR-032 |
| FR-08-042 (phần hộp) | FR-020 | GOI-08 mục 5.6 | FR-033 |
| FR-08-018 | FR-021 | FR-08-016 (phần xác nhận nộp), HOLD anh Andy #2487 | FR-034 |
| — | — | GOI-08 mục 5.5 (phần bản sao), HOLD anh Andy #2487 | FR-035 |

## Contract evidence

- OpenAPI/type drift: không có với phương án A (không đổi backend).
- Backward compatibility: cờ rỗng mặc định; không trình nào dùng khung trong bốn PR
  thực thi; journey GOI-08 mục 9.1 xanh như trước.

## Data evidence

- Migration/schema query: N/A, không có migration và không ghi server.
- Immediate state versus full reload: FR-021, kiểm bằng test remount.

## UI evidence

- Viewports/themes/input methods: ảnh 1280px và 390px của trang thử trong test,
  sáng và tối (mini test), full test luôn sáng; bàn phím và pointer theo test React.

## Release evidence

- Staging SHA and checks: PENDING.
- Production verification: N/A cho tới khi một spec trình bật cờ.
