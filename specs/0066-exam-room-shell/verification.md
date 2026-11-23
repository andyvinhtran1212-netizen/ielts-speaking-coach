# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=frontend/tests/react/exam-room-shell.test.tsx (top bar); shell không nhận prop email/tên/mã học viên · R150: đạt | PENDING |
| FR-002 | kind=test; ref=frontend/tests/exam-room-strings.test.mjs (bộ Anh không có chữ Việt, Highlight/Note/Clear tiếng Anh) + exam-room-shell.test.tsx (test=en, practice=vi); `fullTestRoom={isFullTest}` truyền thẳng vào FocusShell · R150: đạt | PENDING |
| FR-003 | kind=test; ref=frontend/tests/exam-room-split.test.mjs (pointer, ±5, Home/End, Enter, bấm đúp, kẹp 30–70 và 360px) + exam-room-shell.test.tsx (phím mũi tên) · R150: đạt sau review lại (R150-1 sửa ở #2518 `7ffe3cd5`) | PENDING |
| FR-004 | kind=test; ref=frontend/tests/exam-room-split.test.mjs (theo lượt, lượt mới 50, 80 đọc thành 70, hẹp rồi rộng trả tỉ lệ cũ) · R150: đạt | PENDING |
| FR-005 | kind=test; ref=frontend/tests/react/exam-room-shell.test.tsx (dưới 900px hai thẻ, cả hai panel còn mount); kiểm Chromium: panel `hidden` giữ `scrollTop` · R150: đạt sau review lại (R150-1 sửa ở #2518 `7ffe3cd5`) | PENDING |
| FR-006 | kind=test; ref=frontend/tests/exam-room-navigator.test.mjs (13/13/14, 10×4, 3 Passage không đều, phần gọn có cờ, Part 40 câu xuống dòng) · R150: đạt | PENDING |
| FR-007 | kind=test; ref=frontend/tests/exam-room-navigator.test.mjs + exam-room-shell.test.tsx (nhãn đọc, `aria-current`) · R150: đạt sau review lại (viền câu hiện tại dùng `outline: var(--av2-focus)`, #2518 `7ffe3cd5`) | PENDING |
| FR-008 | kind=test; ref=frontend/tests/exam-room-navigator.test.mjs (mật độ ở 1280/1100/768/390) + exam-room-shell.test.tsx (thanh gọn dưới 1024px) · R150: đạt sau review lại (R150-1 sửa ở #2518 `7ffe3cd5`) | PENDING |
| FR-009 | kind=test; ref=frontend/tests/react/exam-room-shell.test.tsx (một nút cờ cho câu hiện tại) · R150: đạt | PENDING |
| FR-010 | kind=test; ref=frontend/tests/exam-room-submit.test.mjs + exam-room-shell.test.tsx (37/40 liệt kê Q7, Q12, Q13; tối đa 5 số; tiêu điểm nút an toàn; Esc; `costNote` chỉ khi có; nút chính `danger` ở hộp cảnh báo) · R150: đạt | PENDING |
| FR-011 | kind=test; ref=frontend/tests/react/exam-room-shell.test.tsx (flush khi mở, số câu chưa lưu, không thoát âm thầm, practice thoát ngay, `exit.locked`) · R150: đạt | PENDING |
| FR-012 | kind=test; ref=frontend/tests/react/exam-room-shell.test.tsx (chỉ khi có `exit.abandon`, hỏi lại) · R150: đạt | PENDING |
| FR-013 | kind=test; ref=frontend/tests/exam-room-submit.test.mjs (giờ lần lưu thành công cuối) + exam-room-shell.test.tsx (Retry) · R150: đạt | PENDING |
| FR-014 | kind=test; ref=frontend/tests/exam-room-connection.test.mjs + exam-room-shell.test.tsx (offline, nút chờ kết nối, back online 5 giây sau khi hàng đợi hết) · R150: đạt một phần (chỉ nhận sự kiện `offline`; "một lần lưu thất bại vì mạng" chưa có đường vào, R150-4) | PENDING |
| FR-015 | kind=test; ref=frontend/tests/react/exam-room-shell.test.tsx (lưu bản sao trước, hộp chặn, `/login?next=`, cảnh báo khi không giữ được bản sao, sửa đổi 2: chỉ Stay) · R150: đạt sau review lại (R150-2 sửa ở #2518 `dd496ef4`, có test câu còn trong debounce) | PENDING |
| FR-016 | kind=test; ref=frontend/tests/react/exam-room-shell.test.tsx (not_current: thông báo + Back) · R150: đạt ((phương án dự phòng); nhánh `displaced` dùng chung code với `expired` nhưng chưa có test riêng) | PENDING |
| FR-017 | kind=test; ref=frontend/tests/exam-room-tab-guard.test.mjs (flush rồi mới nhả, 5 giây → stuck, nhả muộn không làm tab mới ghi, token dự phòng, không có gì thì tắt, hand-over bị từ chối khi chưa giữ được bài) + exam-room-shell.test.tsx · R150: đạt | PENDING |
| FR-018 | kind=test; ref=frontend/tests/react/exam-room-shell.test.tsx ("5 minutes left" bằng chữ, đọc một lần, `onExpire` một lần, ô khoá) · R150: đạt | PENDING |
| FR-019 | kind=test; ref=frontend/tests/react/exam-room-shell.test.tsx (ô khoá ở 0, chỉ nộp tự động chạy khi hộp nộp đang mở) · R150: đạt ((phần khung); đưa giá trị chưa qua debounce vào lần nộp thuộc spec trình) | PENDING |
| FR-020 | kind=test; ref=frontend/tests/react/exam-room-shell.test.tsx (hai nút, không có câu "saved and submitted") · R150: đạt | PENDING |
| FR-021 | kind=test; ref=frontend/tests/exam-room-split.test.mjs + exam-room-shell.test.tsx (tỉ lệ theo lượt sau remount) · R150: đạt ((phần khung); câu trả lời, cờ, Passage và giờ đọc từ server thuộc spec trình) | PENDING |
| FR-022 | kind=test; ref=frontend/tests/exam-room-flags.test.mjs (mặc định rỗng, config null, ghi đè bị bỏ ở production và khi thiếu environment); `public/js/runtime-config.js` commit ở bản chưa cấu hình (`examRoomSurfaces: []`) · R150: đạt | PENDING |
| FR-023 | kind=test; ref=frontend/tests/react/exam-room-shell.test.tsx (embedded) · R150: đạt | PENDING |
| FR-024 | R150: chưa áp dụng tới khi có `ExamEntryGate` (PHONEGATE-0081) (khung chưa chặn; điều kiện của câu hỏi mở 7 vẫn áp: không trình full test nào bật production trước đó) | PENDING |
| FR-025 | kind=test; ref=frontend/tests/react/exam-room-questions.test.tsx (so với bản chép nguyên văn hàm của trình Reading/Listening @ cc6dd4c8; R150 đã đối chiếu bản chép vẫn khớp code hiện tại) · R150: đạt | PENDING |
| FR-026 | kind=test; ref=frontend/tests/react/exam-room-questions.test.tsx (đúng/sai bằng chữ, đáp án, giải thích, không 0/0) · R150: đạt | PENDING |
| FR-027 | kind=test; ref=frontend/tests/react/exam-room-questions.test.tsx (bản đồ, tóm tắt có/không ngân hàng từ, ma trận, trả lời ngắn) · R150: đạt | PENDING |
| FR-028 | kind=test; ref=frontend/tests/react/exam-room-audio.test.tsx (practice có phím cách; test không tạm dừng/tua/tốc độ, tiếng Anh) · R150: đạt (câu hỏi mở 9 giải bằng prop `lang='en'` có sẵn ở AudioPlayer (#2492) thay cho `copy`; #2528 mang theo commit của #2492 nên #2492 phải vào `staging` trước) | PENDING |
| FR-029 | kind=test; ref=frontend/tests/react/exam-room-audio.test.tsx (cảnh báo trước khi phát, báo bắt đầu một lần, không nút tạm dừng) · R150: đạt | PENDING |
| FR-030 | kind=test; ref=frontend/tests/react/exam-room-annotation.test.tsx (tô, ghi chú, Clear, theo tài khoản, CSS Highlight API và `<mark>`, bản hẹp) · R150: đạt sau review lại (R150-1 sửa ở #2528 `dfae1e2d`) | PENDING |
| FR-031 | kind=journey; ref=journey của spec trình (0067–0073) bắt sự kiện `dialog` · R150: chờ spec trình | PENDING |
| FR-032 | kind=test; ref=frontend/tests/exam-room-split.test.mjs, exam-room-local-copy.test.mjs, exam-room-annotation.test.tsx (khoá, hạn, storage ném lỗi) · R150: đạt một phần (khung gọi `pruneSplitRatios` khi mở và `clearSplitRatio` khi xong lượt, #2518 `dd496ef4`; còn lại: hạn ghi chú tính từ lần ghi cuối, không từ lúc nộp) | PENDING |
| FR-033 | kind=test; ref=frontend/tests/react/exam-room-shell.test.tsx (tên sự kiện, payload không có câu trả lời, `exam_room_offline` có `duration_s`) · R150: đạt | PENDING |
| FR-034 | kind=test; ref=frontend/tests/exam-room-submit.test.mjs + exam-room-shell.test.tsx (sáu trạng thái, chỉ `confirmed` mới nói đã nộp, `closed_unconfirmed`/`expired_unsubmitted` xoá bản sao) · R150: đạt | PENDING |
| FR-035 | kind=test; ref=frontend/tests/exam-room-local-copy.test.mjs (ownerKey, baseValue, so theo giá trị, tài khoản khác không đọc được); journey Scenario 6a thuộc spec trình · R150: đạt khi có đủ hai PR (khung: khi mở, `confirmed`, đóng, hết hạn và bỏ bài, #2518 `dd496ef4`; đăng xuất và tài khoản khác đăng nhập: #2659 R162) | PENDING |

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

## Review độc lập (T005, R150)

Người review: một thread không viết PR nào trong chuỗi (kiểm commit các nhánh so với `staging`: không commit nào của thread review). Ngày 23/11/2026.

Đầu nhánh đã review: #2507 `8a4fa5f9`, #2518 `8c9752ad`, #2517 `95bfe226`, #2528 `79ce8004`, #2586 `01ab8281`. Gộp cả năm cục bộ (một xung đột chú thích CSS ở `exam-room.module.css`, giữ bản #2518): `node --test tests/exam-room-*.test.mjs` 59/59, `vitest tests/react/exam-room-*` 102/102. Không sửa PR nào; phát hiện gửi cho tác giả bằng comment trên PR.

| Mã | Mức | PR | Phát hiện | Đề xuất sửa |
| --- | --- | --- | --- | --- |
| R150-1 | P1 | #2518, #2528 | `--av2-focus` là shorthand đủ (`3px solid var(--av2-ink)`, `styles/av2/tokens.css`). Viết `outline: var(--av2-rule-strong-w) solid var(--av2-focus)` hay `outline: 3px solid var(--av2-focus)` thành giá trị sai lúc tính, nên `outline-style` về `none` (đã kiểm trên Chromium). Mất viền focus ở tay nắm, thẻ Passage/Questions, nút chữ, ô câu, nút phần, số ghi chú, và mất viền 3px của câu hiện tại. | `outline: var(--av2-focus)` như #2517 đã sửa ở `14f4f98b`, cho cả `.cell[aria-current='true']`. |
| R150-2 | P2 | #2518 | Sửa đổi 2: `stayOnly` chỉ xét `pendingSaves`. Trình có câu vừa gõ chưa qua debounce (chưa vào hàng đợi lưu, `losesWork()` đúng) vẫn được nút "Sign in again", tức rời trang khi bài chưa được giữ (trình duyệt sẽ bật hộp `beforeunload`, trái FR-031). | `stayOnly = copySaved === false && (pendingSaves > 0 \|\| exit.losesWork())`, kèm test. |
| R150-3 | P2 | #2518 (dùng hàm của #2507) | FR-035/FR-032: có `clearForeignLocalCopies`, `clearOwnerLocalCopies`, `clearSplitRatio`, `pruneSplitRatios` nhưng không chỗ nào gọi. Bản sao không bị xoá khi bỏ bài, khi `confirmed`, khi đăng xuất hay khi tài khoản khác đăng nhập (cách ly đọc vẫn đúng: tài khoản khác không đọc được). Tỉ lệ cột của lượt đã nộp không bao giờ bị xoá. Không task nào của 0066 sở hữu chỗ nối đăng xuất. | Khung: khi mở thì `clearForeignLocalCopies(storage, ownerKey)` và `pruneSplitRatios`; khi bỏ bài thành công và khi `confirmed` thì `clearLocalCopy` và `clearSplitRatio`. Đăng xuất: thêm một dòng task nhỏ (auth provider) trước khi trình đầu tiên bật cờ. |
| R150-4 | P2 | #2518 | FR-014: "một lần lưu thất bại vì mạng" không có đường vào (tác giả đã ghi ở mục Deviations 6). | Prop `connection` do trình truyền, hoặc sửa đổi spec, trước khi trình đầu tiên bật cờ. |
| R150-5 | P3 | #2586 | Nhánh dựa trên `dc996d82` cũ. Phần CSS xuống dòng đã có ở #2518 `8c9752ad`, và xung đột chú thích với đầu #2528. Phần còn giá trị là `registerNavigationGuard` cho chế độ `bare` (đầu #2518 vẫn dùng `beforeunload` thô). | Merge đầu #2528 vào, giữ phần guard và test của nó. |
| R150-6 | P3 | #2518 | Body coverage chưa có các unit của `8c9752ad`. Nhánh `displaced` của FR-016 chưa có test riêng. | Thêm unit vào body; thêm một test `session='displaced'`. |

Cột Result giữ `PENDING` vì code của bốn PR chưa có trên `staging`; kết luận review ghi ở cột Evidence sau "R150:". Đổi sang `PASS` sau khi các PR vào `staging`.

Review lại 23/11 (delta): R150-1 đã sửa (#2518 `7ffe3cd5`, #2528 `dfae1e2d`, đủ 6 chỗ, không còn `solid var(--av2-focus)` trong `components/exam-room`). R150-2 đã sửa (#2518 `dd496ef4`). R150-3 đã sửa ở khung (#2518 `dd496ef4`) và ở auth provider (#2659). Trên đầu #2528 `8ef471c1`: React exam-room 83/83, node exam-room 58/58, `tsc` sạch. R150-4, R150-5, R150-6 vẫn mở (P2/P3, không chặn T005).

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
