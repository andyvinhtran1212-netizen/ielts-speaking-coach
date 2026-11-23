---
id: EXAMLISTENP-0069
title: Listening practice forms and 80-day lessons ask before finishing, show when answers were saved and keep the learner's work in the shared practice room
status: approved
risk: high
owner: product
---

# Bài luyện nghe (programme, 80 ngày) dùng khung luyện chung, hỏi trước khi hoàn thành

Status: **approved** (anh Andy, 23/11/2026 17:08 giờ VN; nguyên văn trong
[`approval-decision.md`](approval-decision.md)). Soạn ngày 23/11/2026 theo nhiệm vụ G08-T10 của
`docs/proposals/commercialization-2026-11/GOI-08-phong-thi-va-trinh-luyen.md`
(spec S3; số 0069 theo sổ `01-KE-HOACH-TONG.md` mục 6, đã kiểm còn trống trong
`specs/` và trong các PR đang mở). Chưa dòng mã nào chạy theo spec này. Chỉ anh Andy
duyệt. Khi anh duyệt, câu trả lời được ghi nguyên văn kèm thời điểm vào
`approval-decision.md`, và `status` đổi sang `approved`. Bản thực thi là một PR
`high-risk` frontend (G08-T11), chỉ sửa frontend nên không chờ G10.

Spec cha: [EXAMROOM-0066](../0066-exam-room-shell/spec.md) (đã duyệt 23/11). Spec liên
quan, không sửa: [LISTENING-0005](../0005-listening-content-programmes/spec.md),
[LISTENING-0006](../0006-listening-guided-feedback/spec.md),
[LISTENING80-0009](../0009-listening-80-days/spec.md).

FR của gói: FR-08-035, FR-08-024/025 (phần luyện) cùng các FR khung áp cho Listening
luyện. Bảng đối chiếu ở `verification.md`.

## Problem

Đã kiểm `frontend/app/(authed-listening-player)/listening/programmes/form/[testId]/programme-form-runner.tsx`
(459 dòng, `ProgrammeFormRunner`) và `(authed-listening)/listening/ielts/80-days/[day]/source-day.tsx`
trên `staging` @ `cc6dd4c8` (23/11/2026):

- `submit()` (L308) flush hàng đợi lưu rồi **nộp ngay, không hỏi**, kể cả khi còn câu
  trống. Nộp lỗi chỉ đổi chữ ở thanh đáy thành "Có câu chưa lưu được — hãy thử lại".
- `submit()` thoát im lặng khi còn câu đang đối chiếu (`revealPromises`): nút bị khoá
  bằng `disabled` nhưng lần bấm trong khoảnh khắc đối chiếu bị nuốt không báo gì.
- Trạng thái lưu là "Đang lưu…"/"Đã lưu"/"Có câu chưa lưu được — hãy thử lại", không có
  giờ, không có nút thử lại.
- Không lời gọi nào truyền `noRedirect`: phiên hết hạn giữa bài thì `api.js` chuyển sang
  `/login`.
- Bản nháp tại máy đã có (`createProgrammeAnswerDraftStore`, khoá
  `listening-programme-draft:{attemptId}` trong `localStorage`) nhưng không gắn tài khoản
  và không được dọn khi đăng xuất.
- Bài nghe một lần (`replay_policy='once'`) có nút "Tạm dừng"/"Tiếp tục nghe"
  (`onceState` có `'paused'`, L75); EXAMROOM-0066 FR-029 (đã duyệt, theo bố cục
  UIBASE-0056) là không tạm dừng.
- Lượt làm được tạo hoặc tiếp tục ngay khi mở trang (`POST .../attempts?standalone=true`, L142;
  với đề `report_only` đây là một lệnh tiếp-tục-hoặc-tạo nguyên tử, `attempts.py` L384–387, L464).
- Trang 80 ngày chứa nhiều `ProgrammeFormRunner` (mỗi Part một cái, prop `active`,
  `embedded`).

## Scope

- Một nhánh giao diện mới cho `ProgrammeFormRunner`, bật bằng
  `examRoomEnabled('listening-practice')`, áp cho trang `/listening/programmes/form/[testId]`
  và bản nhúng trong trang 80 ngày.
- Chế độ `practice` của khung: tiếng Việt, "bạn"; bài không giờ giữ thanh điều hướng
  bình thường (không dùng thanh tập trung).
- Không đổi request nào: `POST .../attempts?standalone=true`, `GET` đề và
  `guided-state`, `PATCH .../answers`, `POST .../questions/{q}/reveal`,
  `POST .../playback-started`, `POST .../submit` (body rỗng).

## Non-goals

- Listening full test và drill (EXAMLISTENT-0070).
- Tạo lượt lúc tương tác đầu tiên thay vì lúc mở trang: cần đổi backend, ghi ở câu hỏi
  mở 2.
- Trang kết quả programme, trang danh sách programme, nội dung bài.
- Sửa `backend/routers/listening.py`.

## Users and journeys

- Học viên làm một bài luyện programme: nghe, trả lời, đối chiếu từng câu (guided),
  bấm "Hoàn thành và xem lại", được hỏi lại (liệt kê câu trống nếu có), rồi sang trang
  kết quả như hôm nay.
- Học viên học một buổi 80 ngày: các Part là các thẻ; Part đang mở dùng khung, chỉ có
  một hộp và một dải mất mạng cho Part đang `active`.
- Học viên làm bài "Vận dụng" nghe một lần: màn cảnh báo trong trình phát, nghe một lần
  không tạm dừng, xong thì khoá.

## Requirements

- **FR-001:** `ProgrammeFormRunner` rẽ nhánh theo `examRoomEnabled('listening-practice')`
  ở đúng một chỗ sau các hook. Cờ tắt: không đổi DOM, chuỗi, class, request hay thứ tự
  gọi API. Cờ bật: cùng request, cùng thứ tự; chỉ lớp giao diện khác.
- **FR-002:** Nút "Hoàn thành và xem lại" luôn mở hộp nộp của khung (tiếng Việt). Còn câu
  trống: hộp Warning liệt kê số câu ("Câu 3, 7 chưa có câu trả lời") với "Quay lại làm
  bài" (chính) và "Vẫn hoàn thành"; hết câu trống: hộp "Hoàn thành bài này?" với "Hoàn
  thành" (chính) và "Quay lại". Esc hay "Quay lại" đóng hộp, không gọi `submit`, tiêu
  điểm về nút. Câu tự luyện lưu trên thiết bị (`supplements`) không tính là câu trống.
- **FR-003:** Còn câu đang đối chiếu (`revealPromises` không rỗng) khi bấm hoàn thành:
  hộp vẫn mở, nút xác nhận khoá với chữ "Đang đối chiếu, chờ một chút", tự mở khi đối
  chiếu xong; không nuốt lần bấm.
- **FR-004:** Xác nhận thì chạy đúng `submit()` hiện có (flush rồi `POST .../submit` rồi
  sang trang kết quả). Nộp lỗi: hộp giữ mở, báo "Chưa hoàn thành được. Câu trả lời của
  bạn vẫn còn." với "Thử lại"; không chuyển trang khi chưa có phản hồi thành công.
- **FR-005:** Trạng thái lưu theo EXAMROOM-0066 FR-013, tiếng Việt: "Đang lưu…", "Đã lưu
  lúc HH:MM" (mốc lấy từ nhánh `succeed` hiện có của `createProgrammeSaveStatusTracker`,
  không thêm đường lưu), "Chưa lưu được, đang thử lại", và "Thử lưu lại" khi một câu thất
  bại (gọi lại hàng đợi hiện có cho câu đó). Đặt ở thanh đáy của runner như hôm nay.
- **FR-006:** Dải câu dùng `navigator-model` của khung thay chip "Đường nghe": ô theo nhóm
  câu, bốn trạng thái (chưa làm, đã trả lời, đã đối chiếu, đang xem), bấm ô thì chuyển
  sang chế độ guided và tới nhóm đó như hôm nay. Đếm "6/10 câu đã thử · 3 câu đã đối
  chiếu" giữ nguyên nội dung.
- **FR-007:** Trình phát dùng `AudioPlayer` của G03 qua `exam-room/audio-player.tsx`
  (EXAMROOM-0066 FR-028): `replay_policy='allowed'` → `policy='practice'` (tạm dừng, tua 5
  giây, tốc độ, A–B, phím cách); câu có clip riêng (`ListeningQuestionAudio`) giữ cách
  phát hiện có. Âm thanh khác trên trang dừng khi một trình phát bắt đầu
  (`pauseOtherListeningAudio`) như hôm nay.
- **FR-008:** `replay_policy='once'` → `policy='once'` (EXAMROOM-0066 FR-029): màn cảnh
  báo trong trình phát trước khi phát, nút "Bắt đầu nghe"; đang phát **không** có tạm
  dừng; không tua, không phát lại; xong thì "Đã nghe · đã khoá". Giữ nguyên lời gọi
  `playback-started` với `playback_claim_id` và trạng thái "Xác nhận lượt nghe" khi máy
  chủ chưa nhận lần bắt đầu (`unconfirmed`). Mất mạng giữa chừng thì báo phút dừng và
  "Nghe tiếp từ [mm:ss]". Đây là đổi hành vi có chủ ý (bỏ "Tạm dừng"), xem câu hỏi mở 1.
- **FR-009:** Bản nháp tại máy theo EXAMROOM-0066 FR-035, khoá
  `exam-room:local-copy:listening-practice:{ownerKey}:{attemptId}` (`ownerKey` = id tài
  khoản), mỗi câu ghi kèm `baseValue` (đúng `user_answer` máy chủ ack lần cuối, hoặc giá trị
  đọc lúc mở lượt) và `baseSavedAt` (chỉ để hiện giờ).
  - **Bản nháp cũ** `listening-programme-draft:{attemptId}` (của `createProgrammeAnswerDraftStore`,
    chỉ có `{q_num: value}`, không có mốc): chỉ đọc khi lượt do máy chủ trả cho chính tài khoản
    đang đăng nhập. Không bao giờ gắn giá trị hiện tại của máy chủ làm `baseValue` cho câu cũ.
    Với từng câu: bằng `user_answer` hiện tại của máy chủ thì bỏ (không có gì để khôi phục);
    khác thì **không tự gửi**, giữ cả hai và hỏi học viên ("Câu {n}: trên máy này là …, đã lưu
    là …" với "Dùng câu trên máy này" và "Giữ câu đã lưu"); câu được chọn đi qua đường lưu
    thường. Khoá cũ chỉ bị xoá sau khi các câu còn lại đã ghi vào khoá mới **và đọc lại khớp**,
    hoặc máy chủ đã ack các giá trị được chọn; ghi khoá mới lỗi thì giữ khoá cũ nguyên vẹn.
  - Gửi lại câu từ bản sao
  chỉ khi giá trị trên máy chủ vẫn bằng `baseValue` (so theo giá trị, không theo dấu thời
  gian); dọn khi ack, khi hoàn thành,
  khi đăng xuất, khi tài khoản khác đăng nhập (xoá không đọc), và khi quá 7 ngày.
  Khi rời (thoát, chuyển sang đăng nhập lại, `pagehide`): ghi ngay phần đang gộp, đọc lại
  khoá và so với câu trả lời trong runner. Chỉ khi đọc lại khớp (hoặc máy chủ đã ack đúng
  giá trị) thì hộp thoát mới được nói bản trên máy đã giữ; không khớp thì hộp chỉ có "Ở
  lại" và câu nói rõ câu nào chưa được lưu ở đâu cả, và lối dự phòng `/login?next=` không
  chuyển trang (cùng quy tắc với EXAMWRITE-0068 FR-010).
- **FR-010:** Mất mạng và phiên hết hạn theo EXAMROOM-0066 FR-014, FR-015, tiếng Việt.
  Mọi lời gọi `window.api.*` của runner trong nhánh mới truyền `{ noRedirect: true }`. 401
  giữa bài: ghi bản sao, hiện hộp đăng nhập lại (trước G05-T19: `/login?next=<URL hiện
  tại>` cùng tab sau khi đọc lại được bản sao). Nút "Hoàn thành" đổi "Chờ kết nối" khi
  offline. Không có đồng hồ nên không có trạng thái hết giờ.
- **FR-011:** Trang 80 ngày (`embedded`): chỉ đổi phần thân của runner, không thêm thanh
  trên thứ hai. Hộp nộp, dải mất mạng, hộp đăng nhập lại và thông báo tab khác gắn theo
  runner đang `active`; runner không `active` không mở hộp, không giữ khoá ghi và không
  phát audio. Khi một runner thôi `active` (học viên chuyển Part): flush hàng đợi lưu của nó
  (câu lưu lỗi vào bản sao theo FR-009, có đọc lại), rồi mới nhả khoá ghi; không bỏ câu đang
  chờ lưu.
- **FR-012:** Cùng lượt mở ở tab thứ hai: khoá ghi theo EXAMROOM-0066 FR-017 với
  `surface='listening-practice'`, `attemptKey=attemptId`; tab chỉ-đọc không gọi `PATCH`,
  `reveal`, `playback-started` hay `submit`. Với đề `report_only`, lệnh mở lượt là
  tiếp-tục-hoặc-tạo nguyên tử, nên tab thứ hai luôn nhận **cùng** `attempt_id` và khoá ghi luôn
  áp dụng.
- **FR-013:** Khi cờ bật, luồng không gọi `window.confirm`, `alert` hay `prompt` (journey
  bắt sự kiện `dialog` = 0).
- **FR-014:** Sự kiện `exam_room_*` của khung gửi với `surface='listening-practice'`, không
  có nội dung câu trả lời.
- **FR-015:** Tên cờ, phụ thuộc sửa đổi của 0066. Tên bề mặt `'listening-practice'` chưa có
  trong `ExamRoomSurface` của EXAMROOM-0066 đã duyệt; `examRoomEnabled` (#2507, 0066 T001) trả
  `false` cho tên lạ và `generate-runtime-config.mjs` bỏ tên lạ kèm cảnh báo. Vì vậy:
  - Spec này đề xuất **sửa đổi 1 mục (b) của EXAMROOM-0066** (xem mục "Sửa đổi đề xuất cho
    EXAMROOM-0066" bên dưới); anh Andy duyệt riêng.
  - **Cho tới khi sửa đổi đó được duyệt và lên `staging`**, nhánh mới dùng
    `examRoomEnabled('listening')`, `surface='listening'` và khoá bản sao
    `exam-room:local-copy:listening:{ownerKey}:{attemptId}`; cờ `listening` chỉ được bật khi cả
    spec này lẫn EXAMLISTENT-0070 sẵn sàng. Sau khi sửa đổi lên, một PR nhỏ đổi tên ở đúng một
    hằng `LISTENING_PRACTICE_SURFACE` (không chép tên ở nhiều chỗ).
  - Ở các FR dưới, "`'listening-practice'`" nghĩa là giá trị của hằng đó.

## Acceptance scenarios

### Scenario 1: hoàn thành khi còn câu trống

- **Given** cờ bật, bài có 10 câu, câu 3 và 7 trống
- **When** bấm "Hoàn thành và xem lại"
- **Then** hộp liệt kê "Câu 3, 7"; **When** bấm Esc **Then** không có `POST .../submit`,
  tiêu điểm về nút; **When** bấm "Vẫn hoàn thành" **Then** flush, đúng một `POST .../submit`
  body rỗng, sang trang kết quả.

### Scenario 2: đang đối chiếu

- **Given** một câu đang `reveal`
- **When** bấm "Hoàn thành và xem lại"
- **Then** hộp mở, nút xác nhận khoá "Đang đối chiếu, chờ một chút", tự mở khi xong.

### Scenario 3: bài nghe một lần

- **Given** `replay_policy='once'`
- **Then** trước khi phát có màn cảnh báo; **When** bấm "Bắt đầu nghe" **Then** đúng một
  `POST .../playback-started`, không có nút tạm dừng; xong thì "Đã nghe · đã khoá".

### Scenario 4: trang 80 ngày

- **Given** buổi Day 52 có Part 1 và Part 2, Part 1 đang mở
- **When** mất mạng
- **Then** đúng một dải mất mạng của Part 1; chuyển sang Part 2 thì dải theo Part 2; không
  có thanh trên thứ hai.

### Scenario 5: phiên hết hạn

- **Given** `PATCH .../answers` trả 401
- **When** học viên trả lời câu tiếp
- **Then** URL không đổi, hộp đăng nhập lại; đăng nhập lại đúng tài khoản thì câu vừa trả
  lời được gửi lại (máy chủ chưa đổi) và bản sao bị xoá.

### Scenario 7: bản nháp cũ khác bản đã lưu

- **Given** khoá cũ có câu 3 = "B" từ máy A, máy chủ có câu 3 = "C" do máy B lưu sau đó
- **When** mở lượt ở máy A trong nhánh mới
- **Then** hỏi học viên chọn giữa "B" và "C"; không lời gọi `PATCH` nào trước khi chọn.
- **Given** ghi khoá mới bị từ chối **Then** khoá cũ còn nguyên.
- **Given** câu cũ bằng giá trị máy chủ **Then** bỏ, không hỏi.

### Scenario 8: hai tab cùng bài

- **Given** cùng một bài programme mở ở hai tab
- **Then** hai tab cùng `attempt_id`; tab thứ hai chỉ-đọc theo FR-012.

### Scenario 6: cờ tắt

- **Given** `examRoomSurfaces` không có `listening-practice`
- **When** chạy `verify-listening-programme-context-flow.mjs` và React test hiện có
- **Then** xanh như trước, không request nào đổi; nút "Tạm dừng" của bài nghe một lần vẫn
  như hôm nay.

## Edge cases

- Bài không có câu: không có dải câu; hộp nộp là hộp thường.
- Audio không tải được: thông báo hiện có "Không tải được audio. Hãy thử lại sau." trong
  trạng thái lỗi của trình phát, kèm "Tải lại bài nghe".
- Trình duyệt chặn tự phát: nút "Phát" cần thao tác người dùng.
- Đổi ngôn ngữ câu hỏi: chỉ đổi câu hỏi như hôm nay, không đổi đáp án đã lưu.
- Bộ nhớ trình duyệt không dùng được: không có bản sao; vẫn làm và hoàn thành được.
- Nhiều runner trên một trang cùng bị 401: chỉ runner `active` hiện hộp; runner khác chờ
  tới khi được mở.

## Success criteria

- Khi cờ bật: 0 lần hoàn thành mà không qua hộp hỏi; 0 sự kiện `dialog`.
- Khi cờ tắt: journey `verify-listening-programme-context-flow.mjs` và React test
  `listening-programme-form-scope`, `listening-programme-replay-stop` xanh như trước.

## Open questions

Mỗi câu kèm đề xuất; mặc định tạm là đề xuất cho tới khi anh Andy trả lời.

1. **Bỏ "Tạm dừng" ở bài nghe một lần.** GOI-08 FR-08-025 ghi giữ tạm dừng; EXAMROOM-0066
   FR-029 (đã duyệt, theo bố cục UIBASE-0056 và `AudioPlayer` #2492) là không tạm dừng.
   Đề xuất: theo 0066 (không tạm dừng, giống thi thật), chỉ trong nhánh cờ bật; anh có thể
   giữ tạm dừng bằng cách duyệt một sửa đổi của 0066. Mặc định tạm: không tạm dừng.
2. **Tạo lượt khi mở trang.** Hôm nay mở trang là tạo lượt; muốn tạo lúc tương tác đầu
   tiên thì phải đổi `listening.py`. Đề xuất: không làm trong spec này; ghi vào việc tiếp
   theo của G10 (tách `listening.py`). Mặc định tạm: giữ như hôm nay.
3. **Bản nháp cũ.** Đề xuất: theo FR-009 (bằng thì bỏ, khác thì hỏi, xoá khoá cũ chỉ sau khi
   khoá mới đọc lại khớp hoặc máy chủ đã ack), theo HOLD của anh 09:33Z. Mặc định tạm: như đề
   xuất.
4. **Tên cờ riêng cho Listening luyện.** Kiểu `ExamRoomSurface` của EXAMROOM-0066 chỉ có
   `'listening'`, nên luyện và full test sẽ bật cùng lúc, trái với thứ tự chuyển trình ở
   0066 câu hỏi mở 6 (Listening luyện trước, Listening test sau G10). Đề xuất: sửa đổi 1
   của 0066 (cùng sửa đổi đề xuất ở EXAMREAD-0067 câu hỏi mở 6) thêm `'listening-practice'`
   cho spec này, giữ `'listening'` cho full test (EXAMLISTENT-0070). Mặc định tạm: như đề
   xuất; cho tới khi sửa đổi được duyệt, quy tắc dự phòng ở FR-015 là quy tắc đang áp dụng.

## Sửa đổi đề xuất cho EXAMROOM-0066

Sửa đổi 1 (mục (a) là `expired_unsubmitted` của EXAMREAD-0067 câu hỏi mở 6; mục (b) và (c)
dưới đây). Anh Andy đã duyệt (a)(b)(c) lúc 17:08 giờ VN 23/11/2026; đã áp vào EXAMROOM-0066,
nguyên văn trong `specs/0066-exam-room-shell/approval-decision.md` mục "Amendment 1".

- **(b)** `ExamRoomSurface` thêm `'listening-practice'` (Listening luyện, chế độ `practice`,
  tiếng Việt). Đổi kèm: `EXAM_ROOM_SURFACES` trong `frontend/lib/exam-room/flags.mjs` và danh
  sách tên hợp lệ trong `frontend/tooling/generate-runtime-config.mjs`; khoá bản sao
  `exam-room:local-copy:listening-practice:{ownerKey}:{attemptKey}`. `'listening'` giữ cho
  Listening full test, mini test, drill (EXAMLISTENT-0070). Không đổi gì khác của 0066.
- **(c)** FR-035 so bản sao theo giá trị, không theo giờ. Mỗi câu trong bản sao giữ
  `baseValue`: đúng giá trị máy chủ đã ack lần cuối cho câu đó (hoặc giá trị đọc lúc mở
  lượt). `baseSavedAt` vẫn giữ nhưng chỉ để hiện "HH:MM", không dùng để so. Sau khi tải lại
  hoặc đăng nhập lại đúng `ownerKey`: giá trị trên máy chủ bằng `baseValue` (chuỗi so nguyên
  văn, cả độ dài; mảng và đối tượng so sau khi sắp khoá) thì gửi lại câu trong bản sao qua
  đường lưu thường; khác thì giữ bản máy chủ và bỏ câu đó khỏi bản sao, như FR-035 hiện nay
  làm với câu "mới hơn". Câu chữ "chưa đổi kể từ `baseSavedAt`" trong FR-035 và các
  Scenario của 0066 đọc là "giá trị trên máy chủ vẫn bằng `baseValue`".
  - Lý do: giờ lưu trên máy chủ có thể đổi mà giá trị không đổi (Writing: `POST
    .../paste-log` ghi cùng dòng, trigger đổi `writing_drafts.updated_at`, mig 042), và giờ
    của máy học viên với máy chủ không cùng một đồng hồ. So theo giờ khi đó bỏ nhầm câu học
    viên vừa gõ.
  - Đổi kèm ở lib (0066 T001, #2507): `LocalCopyAnswer` thêm `baseValue`;
    `planLocalCopyReplay` so theo `baseValue`. Bản sao ghi trước khi có trường này (không có
    `baseValue`) thì không tự gửi lại mà hỏi học viên giữ bản nào. Không đổi gì khác của 0066.
  - Spec dựa vào mục này: EXAMWRITE-0068 FR-008 (`baseText`), spec này, EXAMLISTENT-0070,
    EXAMMOCK-0071 FR-010. Cho tới khi duyệt, mỗi spec theo quy tắc dự phòng ghi trong spec
    đó (EXAMMOCK-0071: hỏi học viên, không tự gửi lại).
