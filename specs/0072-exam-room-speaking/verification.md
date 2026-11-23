# Verification

## Requirement coverage

Review độc lập 0072 T005 (READY-QUEUE R152, 23/11/2026), trên cây gộp `cbff3629` (#2642, đã
gồm #2615 `69218093` và #2599 `765b3c4f`) + `f935d3d0` (#2626), merge cục bộ sạch. Người review
không viết mã của chuỗi này. Kết quả chạy trên cây đó:

- `node --test` 69 tệp `practice*`, `speaking*`, `exam-room*`, `core-player*`: 1051/1051 qua.
- `vitest run tests/react`: 136 tệp, 1473/1473 qua. `tsc --noEmit`: sạch.
- `tooling/verify-speaking-flow.mjs` trên `next build` cục bộ (backend giả, micro giả của
  Chromium, không gọi STT hay chấm trả phí): 78/79. Dòng hỏng là "không có lỗi JS chưa bắt" ở
  `/speaking` do `/vendor/lucide.min.js` và `/vendor/chart.umd.min.js` trả 404: bản dựng chạy
  `next build` trực tiếp, bỏ qua `prebuild` (`tooling/vendor-runtime.mjs`), không liên quan
  chuỗi này. Mọi dòng của phòng (cờ bật) và cờ tắt đều qua.

Cột Result vẫn là PENDING: mã của chuỗi chưa lên `staging` (các tệp test chưa có trên nhánh spec này) và
nghiệm thu staging (T004) cần anh Andy bật cờ. Kết quả review ghi cuối cột Evidence ("đạt (cục bộ)" =
đủ bằng chứng ở mức test và journey cục bộ). Đổi sang PASS khi chuỗi đã merge và T004 xong.

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=journey; ref=frontend/tooling/verify-speaking-flow.mjs hai nhánh (cờ tắt: header cũ, không có phòng, cùng request; cờ bật: thanh tập trung thay header, cùng request); kind=test; ref=frontend/tests/react/practice-exam-room.test.tsx "renders the page exactly as before…", "ignores room-only view fields while the flag is off". Review R152: đạt (cục bộ) | PENDING |
| FR-002 | kind=test; ref=frontend/tests/practice-exam-room-events.test.mjs "every helper returns before touching the view", "practice.js reads only bootstrap.examRoomMode…", "the boot passes examRoomEnabled(…)"; `practice-session-boot.tsx` gọi `examRoomEnabled('speaking')` một lần. Review R152: đạt (cục bộ) | PENDING |
| FR-003 | kind=test; ref=frontend/tests/react/practice-exam-room.test.tsx "pending shows before the browser answers, with the button locked", "denied: three steps…", "not found and busy…", "unsupported…"; frontend/tests/practice-exam-room-events.test.mjs "permissions granted skips the first step", "no navigator.permissions starts at…". Review R152: đạt (cục bộ) | PENDING |
| FR-004 | kind=test; ref=frontend/tests/react/practice-exam-room.test.tsx "ready, recording with the clock, recorded with the duration, in words", ""Không nghe thấy tiếng" only after 3 s…", "no level (no analyser) never reports silence", "paused by the browser (muted mic)"; events test "RMS of \|b − 128\| / 128". Review R152: đạt (cục bộ) | PENDING |
| FR-005 | kind=test; ref=frontend/tests/react/practice-exam-room.test.tsx "Part 1 too short…never an alert", "Part 2 too short…(server detail.min_seconds)"; frontend/tests/exam-room-strings-speaking.test.mjs "too-short reason uses the numbers it is given"; ảnh `team/g08/r85-shots/mic-lost-3s.png`. Review R152: đạt (cục bộ) | PENDING |
| FR-006 | kind=test; ref=frontend/tests/practice-exam-room-boxes.test.mjs "an unsent take opens the box and keeps the take", "no take: no box", "Part 2 …"; react "re-record: …" ("Giữ bản ghi" là nút chính). Review R152: đạt (cục bộ) | PENDING |
| FR-007 | kind=test; ref=frontend/tests/practice-exam-room-boxes.test.mjs "a link with unsent work opens the box; never window.confirm", "nothing unsent: leave at once", "a navigation that never leaves guards the page again"; react "leave box from a link", "a link in the page with unsent work asks practice.js first…". Review R152: đạt (cục bộ) | PENDING |
| FR-008 | kind=test; ref=frontend/tests/practice-exam-room-boxes.test.mjs "Nộp opens the box with the count, and nothing is completed yet", "closing the box submits nothing"; react "submit with failed re-records: the count…"; lần ghi đầu gửi lỗi giữ Nộp khoá bằng chữ "Đã lưu N/M câu — lưu nốt rồi mới nộp được." của nhánh cũ. Câu về lượt chưa có (cần G04). Review R152: đạt (cục bộ), trừ câu lượt | PENDING |
| FR-009 | kind=review; `practice.js` không ghi âm thanh vào `localStorage`/`sessionStorage`/IndexedDB (chỉ `ielts_qmode` và chuỗi id full test); không chuỗi nào của phòng hứa giữ bản ghi khi tải lại. Chưa có test riêng. Review R152: đạt (review), thiếu test | PENDING |
| FR-010 | kind=test; ref=frontend/tests/practice-exam-room-boxes.test.mjs "complete answers 401: the sign-in box opens, nothing navigates", "upload auth_required with an unsent take counts it…", "finishSession signed out in the room…"; react "401 with an unsent take: says it would be lost…". Review R152: đạt (cục bộ) | PENDING |
| FR-011 | kind=test; ref=frontend/tests/exam-room-strings-speaking.test.mjs "mode: only test_full is English", "English has no Vietnamese letters"; react "a full test uses the English room words", "a full test asks in English". Review R152: đạt (cục bộ) | PENDING |
| FR-012 | kind=journey; ref=frontend/tooling/verify-speaking-flow.mjs "phòng (cờ bật): không hộp thoại trình duyệt nào (FR-012)" (bắt sự kiện `dialog`); boxes test "no window.confirm, alert or prompt is reached in the room branch…". `playwright.speaking-regression.config.js` chưa chạy trong review này. Review R152: đạt (cục bộ); regression config pending | PENDING |
| FR-013 | kind=test; ref=frontend/tests/react/practice-exam-room.test.tsx (MicStatus gửi `exam_room_mic` với `surface: 'speaking'` và tên ca, không nội dung). Review R152: đạt (cục bộ) | PENDING |

Edge cases:

| Edge case | Evidence | Result |
| --- | --- | --- |
| Micro bị rút giữa lúc ghi | #2642 (R139); frontend/tests/practice-exam-room-mic-lost.test.mjs 9 test; ảnh `mic-lost-3s.png`, `mic-lost-17s.png`. Còn một điểm thấp: đường `_recorder` cũ không xoá `_timerId` P1/P3 ở nhánh `stopping` (đường native, đường thật của trang Next, không bị) | Đạt (cục bộ), một điểm thấp mở |
| Không có `navigator.permissions` | events test "no navigator.permissions starts at…" | Đạt (cục bộ) |
| Recorder native có trước | events test "native start emits no mic event and keeps the old error text"; mic-lost đọc `PracticeRecorder.stream`, `onstop` gọi `onRecorded` trước `#releaseMedia` | Đạt (cục bộ) |
| Hai tab cùng phiên | R149 (G08-T19c), chưa có PR | PENDING |
| Test đọc nguồn `practice.js` | 1051 test node của nhóm practice/speaking/exam-room qua, không test nào bị bỏ qua | Đạt (cục bộ) |

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
  hộp; sáng và tối. Đã có: ảnh phòng của #2626 (journey `SHOTS`) và `team/g08/r85-shots/`
  (mic-lost 3 s, 17 s). `/ui-review` theo mắt: hộp micro sau khi mất kết nối dùng tông thông tin
  (teal), chưa phải tông cảnh báo; spec chỉ yêu cầu chữ nên không chặn.

## Release evidence

- Staging SHA and checks: PENDING.
- Production verification: N/A cho tới khi anh Andy cho bật.
