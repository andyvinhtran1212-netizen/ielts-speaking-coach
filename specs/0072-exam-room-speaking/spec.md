---
id: EXAMSPEAK-0072
title: Speaking practice shows clear microphone and recording states, blocks too-short answers with a reason, and asks in the page before discarding unsent recordings, behind a flag and with the same uploads and grading
status: draft
risk: high
owner: product
---

# Speaking: micro, ghi âm, rời bài và nộp trong khung chung

Status: **draft**. Soạn ngày 23/11/2026 theo nhiệm vụ G08-T17 của
`docs/proposals/commercialization-2026-11/GOI-08-phong-thi-va-trinh-luyen.md` (spec S6; số 0072
theo sổ `01-KE-HOACH-TONG.md` mục 6, đã kiểm còn trống trong `specs/` và trong các PR đang mở).
Chưa dòng mã nào chạy theo spec này. Chỉ anh Andy duyệt. Khi anh duyệt, câu trả lời được ghi
nguyên văn kèm thời điểm vào `approval-decision.md`, và `status` đổi sang `approved`. Bản thực
thi là hai PR `high-risk` frontend: G08-T18 (micro và ghi âm) và G08-T19 (rời bài và nộp).

Spec cha: [EXAMROOM-0066](../0066-exam-room-shell/spec.md) (đã duyệt 23/11). Spec liên quan,
không sửa: [LEARNERDRAFT-0010](../0010-learner-draft-preservation/spec.md) (giữ bản ghi chưa
gửi), [EXAMMOCK-0071](../0071-exam-room-mock/spec.md) (runner thi thử mở phòng Speaking).

FR của gói: FR-08-038 cùng các FR khung áp cho Speaking (lối thoát FR-08-011 chế độ luyện, hộp
nộp FR-08-034, thanh tập trung). Bảng đối chiếu ở `verification.md`.

## Problem

Đã kiểm `frontend/public/js/practice.js` (6.056 dòng) và các cầu nối trong
`frontend/app/(authed-practice)/practice/session/` (`practice-page-shell.tsx` 598 dòng) trên
`staging` @ `cc6dd4c8` (23/11/2026).

- Micro: lỗi `getUserMedia` (L838–853) chỉ thành một dòng chữ đỏ (`_showRecError`) sau khi học
  viên bấm "Bắt đầu ghi âm"; không có trạng thái "đang chờ trình duyệt" trong lúc hộp xin quyền
  gốc đang mở, nên bấm lần hai không thấy phản hồi; bị từ chối không có hướng dẫn mở lại theo
  từng bước.
- Ghi âm chỉ có ba trạng thái con `idle`/`recording`/`recorded` (`practice-page-shell.tsx`
  L481–495); không báo im lặng.
- "Ghi lại" (L495, `resetRecording`) xoá bản hiện tại ngay, không hỏi.
- Bản quá ngắn: chặn theo `MIN_RECORD_SEC = {1: 15, 2: 80, 3: 25}` (L18) và `detail.min_seconds`
  của 422 `AudioTooShortError`; Part 2 báo bằng `window.alert` (L1326).
- Rời bài khi còn bản ghi chưa gửi: `window.confirm` trong `_canLeave` (L272–277). Nộp khi còn
  bản ghi mới chưa gửi: `window.confirm` (L5284).
- Speaking full test (`test_full`) trong sitting thi thử quay về `/mock-exam?sitting=` sau khi
  xong (L3733).

## Scope

- Một nhánh giao diện mới cho `/practice/session`, bật bằng `examRoomEnabled('speaking')`: trạng
  thái micro bốn ca, trạng thái ghi âm có im lặng, chặn bản quá ngắn bằng chữ, hỏi trước khi
  ghi lại, hộp trong trang khi rời bài và khi nộp còn bản chưa gửi, thanh tập trung chế độ luyện
  với "‹ Thoát" và đồng hồ đếm lên.
- Logic ghi âm, tải lên và hoàn tất vẫn ở `practice.js`; nhánh mới chỉ thêm sự kiện trạng thái
  qua `_updateNativeView` và vẽ bằng React trong cầu nối.
- Không đổi `MIN_RECORD_SEC`, MIME, định dạng `POST /sessions/{id}/responses`, `PATCH
  /sessions/{id}/complete`, cách chấm (`grading.py`), luồng Part 2 (`p2a` → `p2b` → `p2c`).

## Non-goals

- Trang kết quả Speaking, feedback, chấm phát âm.
- Trừ lượt (G04, G08-T25): spec này chỉ hiện câu về lượt khi API của G04 có số liệu.
- Màn hết giờ có lựa chọn của Speaking tự chọn (FR-08-042): Speaking không có đồng hồ phía máy
  chủ hôm nay (câu hỏi mở 3).
- Đổi `practice.js` sang React. Gỡ nhánh cũ (G08-T21).

## Users and journeys

- Học viên luyện từng Part: mở bài, cho phép micro, ghi, nghe lại, ghi lại nếu muốn, gửi.
- Học viên làm full test mô phỏng: ba Part liền nhau, rời bài có hỏi nếu còn bản chưa gửi.
- Học viên trong sitting thi thử: Speaking mở từ runner, xong thì về runner như hôm nay.
- Học viên bị từ chối micro hoặc không có micro: thấy lý do và cách sửa ngay trong trang.

## Requirements

- **FR-001:** Trang `/practice/session` rẽ nhánh theo `examRoomEnabled('speaking')` ở đúng một
  chỗ trong `practice-page-shell.tsx` sau các hook. Cờ tắt: không đổi DOM, chuỗi, class, request
  hay thứ tự gọi API; `practice.js` không phát sự kiện mới nào. Cờ bật: cùng URL, cùng request,
  cùng thứ tự.
- **FR-002:** Logic ở lại `practice.js`. Cờ chỉ được quyết ở một chỗ:
  `practice-session-boot.tsx` gọi `examRoomEnabled('speaking')` một lần và đưa kết quả vào
  bootstrap của `PracticeApp.init` (trường `examRoomMode: true|false`, cạnh `navigate`,
  L123). `practice.js` chỉ đọc `bootstrap.examRoomMode === true` trong `init`; không dùng
  `callPractice` cho việc này, vì `callPractice` bỏ qua khi app chưa nạp và sự kiện `mic` có
  thể phát ngay khi `init` chạy. `practice.js` không tự đọc
  `__AVER_RUNTIME_CONFIG__` hay `?exam_room` (để quy tắc `?exam_room` chỉ ngoài production của
  0066 giữ ở một nơi). Nhánh mới thêm lời gọi `_updateNativeView('mic', {...})` và
  `_updateNativeView('recording', { level })` khi chế độ đó đã được đặt (một dòng mỗi chỗ), và lời
  gọi tải lên (`POST /sessions/{id}/responses`) cùng hoàn tất (`PATCH /sessions/{id}/complete`)
  rẽ theo cùng cờ đó để truyền `{ noRedirect: true }` (FR-010); nhánh cờ tắt gọi như hôm nay; test
  `node --test`: bootstrap không có `examRoomMode: true` thì không phát sự kiện mới nào. Thêm các lệnh mới `requestLeave`, `confirmLeave`, `confirmRerecord`,
  `confirmSubmitWithUnsent` mà cầu nối gọi qua `callPractice`. Chuỗi tiếng Việt của nhánh cũ giữ
  trong `practice.js` cho test đọc nguồn.
- **FR-003:** Bốn trạng thái micro (FR-08-038, tờ `BaiTapSpeaking` mục 3):
  - Trước khi xin: "Cần micro để ghi âm câu trả lời." với "Cho phép micro".
  - Đang chờ trình duyệt: hiện **ngay khi** gọi `getUserMedia`, trước khi có kết quả: "Hãy chọn
    Cho phép trong hộp của trình duyệt."; nút khoá để không bấm lần hai.
  - Bị từ chối (`NotAllowedError`, `PermissionDeniedError`): ba bước mở lại (biểu tượng ổ khoá
    trên thanh địa chỉ → Micro → Cho phép, rồi "Thử lại"), không xoá câu đã gửi.
  - Không tìm thấy micro (`NotFoundError`, `DevicesNotFoundError`): "Không tìm thấy micro. Hãy cắm
    micro rồi bấm Thử lại."; `NotReadableError` dùng chuỗi hiện có (micro đang bị ứng dụng khác
    dùng).
  Đã cho phép rồi (`navigator.permissions` trả `granted` khi trình duyệt hỗ trợ) thì bỏ qua bước
  đầu. Trình duyệt không có `getUserMedia`/`MediaRecorder`: chuỗi hiện có, không ghi được.
- **FR-004:** Trạng thái ghi âm bằng chữ, không chỉ màu: "Sẵn sàng", "Đang ghi" kèm đồng hồ,
  "Không nghe thấy tiếng" khi mức âm dưới ngưỡng quá 3 giây liên tục. Mức âm là RMS của
  `getByteTimeDomainData` quy về 0–1 (`|byte − 128| / 128`); ngưỡng là hằng `SILENCE_RMS = 0.02`
  trong `recording-status.tsx` (câu hỏi mở 4), để test dùng số cố định (đọc từ `AnalyserNode` đã có
  cho dạng sóng; không có `AudioContext`, hoặc recorder native (`_getNativeRecorder`) không cho
  `AnalyserNode`, thì không báo im lặng), "Tạm dừng" khi rãnh micro bị
  `mute` hoặc `MediaRecorder` ở `paused` do trình duyệt (không thêm nút tạm dừng), "Đã ghi" kèm
  thời lượng và trình phát nghe lại.
- **FR-005:** Bản quá ngắn: chặn trước khi tải lên bằng `MIN_RECORD_SEC[part]` như hôm nay, và
  theo `detail.min_seconds` khi máy chủ trả 422; lý do bằng chữ trong trang ("Bản ghi 12 giây,
  Part 1 cần ít nhất 15 giây. Hãy ghi lại với câu trả lời dài hơn."), kể cả Part 2 (thay
  `window.alert` L1326 ở nhánh mới; Part 2 vẫn quay về `p2a` như hôm nay). Không viết cứng số
  giây ở chỗ mới: chuỗi do hàm `speakingTooShortReason` trong
  `frontend/lib/exam-room/strings-speaking.mjs` (cạnh bộ chuỗi của khung, EXAMROOM-0066 T001) dựng từ thời lượng, Part và số giây tối thiểu (`MIN_RECORD_SEC[part]`
  hoặc `detail.min_seconds`).
- **FR-006:** "Ghi lại" khi đã có bản ghi chưa gửi hỏi trong trang "Xoá bản ghi này và ghi lại?"
  với "Giữ bản ghi" (chính) và "Xoá và ghi lại"; bản đã gửi lên máy chủ thì không hỏi (bản trên
  máy chủ không bị xoá). Áp cho cả nút "Ghi lại" của Part 2 (`discardP2SubmissionRetry`).
- **FR-007:** Rời bài (FR-08-011 chế độ luyện): thanh tập trung chế độ luyện có "‹ Thoát" và
  đồng hồ đếm lên. Không còn bản chưa gửi (`_hasUnsentWork` sai) thì thoát ngay. Còn bản chưa gửi
  thì chặn điều hướng trước, mở hộp "Bạn có bản ghi chưa gửi" với "Ở lại" (chính) và "Bỏ bản ghi
  và thoát"; chọn thoát thì điều hướng lại bằng mã. Áp cho "‹ Thoát", liên kết trong trang và
  `registerNavigationGuard` của `FocusShell`; đóng tab vẫn dùng `beforeunload` của trình duyệt.
- **FR-008:** Nộp khi còn bản ghi chưa gửi được. Hai ca, phân biệt theo trạng thái ô mà
  `_sheetSubmitBlob` đặt hôm nay:
  - Lần ghi **đầu tiên** của câu gửi lỗi (ô ở `retry`, `retryHadWork` rỗng, máy chủ chưa có bản
    nào của câu đó): Nộp vẫn khoá như hôm nay (`ready` cần mọi ô `saved`/`ungraded`), chữ "Đã lưu
    N/M câu — lưu nốt rồi mới nộp được." và "Gửi lại bản ghi" trên ô đó. Không có lựa chọn dùng
    bản cũ, không có "Vẫn nộp".
  - **Ghi lại** gửi lỗi khi câu đã có bản được lưu (ô giữ `saved`/`ungraded`, có `retryBlob`,
    `retryHadWork` khác rỗng): Nộp mở được; bấm Nộp mở hộp trong trang. N chỉ đếm các ô này. Hộp
    "Còn N bản ghi mới chưa gửi
  được" nói rõ "Nộp bây giờ sẽ dùng bản cũ trên máy chủ và bỏ các bản ghi mới." với "Gửi lại bản
  ghi" (chính) và "Vẫn nộp". Khi không có `confirm` (nhánh `typeof window.confirm !== 'function'`
  hiện có) thì hành vi cũ giữ cho nhánh cũ. Hộp nộp có câu về lượt chỉ khi API của G04 có số liệu
  (FR-08-034); 402 `insufficient_credits` thì khối "Hết lượt chấm" của G07-T27, không mất bản ghi.
- **FR-009:** Bản ghi chưa gửi chỉ ở bộ nhớ trang như hôm nay (LEARNERDRAFT-0010); không lưu
  âm thanh vào `localStorage`. Mọi hộp và chữ của nhánh mới không hứa giữ bản ghi khi tải lại.
- **FR-010:** Phiên hết hạn: lời gọi tải lên và hoàn tất trong nhánh mới truyền
  `{ noRedirect: true }`; 401 giữa bài giữ bản ghi trong trang và hiện hộp đăng nhập lại của
  khung (cùng tab, không tải lại trang khi có component G05-T19; trước đó báo rõ bản ghi chưa gửi
  sẽ mất nếu chuyển trang và để học viên chọn).
- **FR-011:** Chế độ và chuỗi: `practice` và `test_part` dùng chế độ `practice` (tiếng Việt,
  "bạn"). `test_full` trong sitting thi thử dùng chế độ `test` (tiếng Anh) theo câu hỏi mở 1. Về
  `/mock-exam?sitting=` sau khi xong như hôm nay.
- **FR-012:** Khi cờ bật, luồng không gọi `window.confirm`, `alert` hay `prompt` (journey bắt
  sự kiện `dialog` = 0).
- **FR-013:** Sự kiện `exam_room_*` của khung với `surface='speaking'`, không có âm thanh, bản
  chép hay nội dung câu trả lời; sự kiện micro chỉ ghi tên ca (`denied`, `not_found`…).

## Acceptance scenarios

### Scenario 1: lần đầu xin micro

- **Given** trình duyệt chưa cho quyền micro
- **When** bấm "Cho phép micro"
- **Then** ngay lập tức hiện "Hãy chọn Cho phép trong hộp của trình duyệt." và nút khoá; cho
  phép xong thì "Sẵn sàng".

### Scenario 2: bị từ chối

- **Given** học viên chọn Chặn
- **Then** ba bước mở lại và "Thử lại"; mở lại quyền rồi "Thử lại" thì ghi được, không mất câu đã
  gửi.

### Scenario 3: bản quá ngắn ở Part 2

- **Given** Part 2, dừng ở giây 40
- **Then** không tải lên; chữ "Bản ghi 40 giây, Part 2 cần ít nhất 80 giây…" trong trang, không
  `alert`; quay về màn thẻ đề như hôm nay.

### Scenario 4: ghi lại

- **Given** có bản ghi chưa gửi
- **When** bấm "Ghi lại"
- **Then** hộp "Xoá bản ghi này và ghi lại?" với "Giữ bản ghi" là nút chính.

### Scenario 5: rời bài còn bản chưa gửi

- **Given** một bản ghi gửi lỗi, đang chờ "Gửi lại bản ghi"
- **When** bấm "‹ Thoát"
- **Then** hộp "Bạn có bản ghi chưa gửi"; "Ở lại" giữ nguyên trang; "Bỏ bản ghi và thoát" mới
  điều hướng.

### Scenario 6: cờ tắt

- **Given** `examRoomSurfaces` không có `speaking`
- **When** chạy `verify-speaking-flow.mjs`, `write-flows/speaking-*.mjs` và bộ
  `playwright.speaking-regression.config.js`
- **Then** xanh như trước, không request nào đổi.

### Scenario 7: nộp khi còn bản gửi lỗi

- **Given** câu 3 gửi lỗi ở lần ghi đầu tiên (máy chủ chưa có bản nào)
- **Then** Nộp khoá, chữ "Đã lưu N/M câu — lưu nốt rồi mới nộp được."; không có "Vẫn nộp".
- **Given** câu 5 đã có bản lưu, ghi lại rồi gửi lỗi
- **When** bấm Nộp
- **Then** hộp "Còn 1 bản ghi mới chưa gửi được", "Gửi lại bản ghi" là nút chính; "Vẫn nộp" nộp
  với bản cũ của câu 5 còn nguyên trên máy chủ.

## Edge cases

- Micro bị rút giữa lúc ghi: rãnh `ended` → dừng ghi, giữ phần đã ghi nếu đủ dài, báo "Mất kết
  nối micro" và trạng thái "Không tìm thấy micro" cho lần ghi sau.
- Trình duyệt không có `navigator.permissions` (Safari cũ): bắt đầu từ ca "Trước khi xin".
- Recorder native (`_getNativeRecorder`) có trước: nhánh mới đọc cùng sự kiện, không đổi đường
  ghi native.
- Hai tab cùng phiên: khoá ghi theo 0066 FR-017 (`surface='speaking'`, `attemptKey=session_id`);
  tab chỉ-đọc không mở micro và không tải lên. Bàn giao khoá chỉ xảy ra khi `flush` trả
  `{ secured: true }`; bản ghi chưa gửi chỉ ở bộ nhớ trang (FR-009) nên không bao giờ "secured".
  Khi tab cũ còn bản chưa gửi hoặc đang tải lên, nó từ chối bàn giao (`onHandoverRefused`) và giữ
  khoá; tab mới vào `stuck` ("Bài này đang mở ở tab khác và còn bản ghi chưa gửi. Hãy gửi hoặc
  bỏ bản ghi ở tab đó."), không mở micro.
- Test đọc nguồn `js/practice.js` (15 test, ví dụ `speaking-length-gate.test.mjs`,
  `practice-recorder-mime-lane.test.mjs`, `core-player-affinity.test.mjs`): giữ chuỗi bị ghim;
  test vỡ có chủ ý thì sửa cùng PR và liệt kê; quá 30 test vỡ thì dừng và báo.

## Success criteria

- Khi cờ bật: 0 sự kiện `dialog`; không lần bấm micro nào không có phản hồi trên màn hình trong
  200 ms; không bản ghi chưa gửi nào bị xoá mà không hỏi.
- Khi cờ tắt: journey Speaking và bộ regression xanh như trước.

## Open questions

Mỗi câu kèm đề xuất; mặc định tạm là đề xuất cho tới khi anh Andy trả lời.

1. **Ngôn ngữ của Speaking full test.** Hôm nay tiếng Việt ở mọi chế độ. Đề xuất: `test_full`
   trong sitting thi thử dùng chế độ `test` (tiếng Anh, như phòng thi), luyện và `test_part`
   giữ tiếng Việt. Mặc định tạm: như đề xuất.
2. **Nút tạm dừng ghi âm.** Tờ `BaiTapSpeaking` có trạng thái "Tạm dừng". Đề xuất: chỉ hiện khi
   trình duyệt tự tạm dừng (micro `mute`); không thêm nút tạm dừng vì thi thật không có. Mặc định
   tạm: như đề xuất.
3. **Hết giờ của Speaking tự chọn (FR-08-042).** Máy chủ không có đồng hồ cho phiên Speaking.
   Đề xuất: ngoài spec này; làm cùng nguồn "bài có giờ" (G08-T24) nếu cần. Mặc định tạm: không có
   màn hết giờ.
4. **Ngưỡng im lặng.** Đề xuất: 3 giây dưới mức âm cố định, đặt trong một hằng của cầu nối để
   chỉnh sau thử trên staging bằng micro giả. Mặc định tạm: 3 giây.
