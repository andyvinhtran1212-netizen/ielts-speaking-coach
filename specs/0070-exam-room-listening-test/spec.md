---
id: EXAMLISTENT-0070
title: Listening full tests, mini tests and drills run in the shared exam room behind a flag, with the same requests, audio rules and results as today
status: draft
risk: high
owner: product
---

# Listening full test, mini test và drill chạy trong khung phòng thi chung

Status: **draft**. Soạn ngày 23/11/2026 theo nhiệm vụ G08-T12 (kèm ghi chú dữ liệu thử của
G08-T13) của `docs/proposals/commercialization-2026-11/GOI-08-phong-thi-va-trinh-luyen.md`
(spec S4; số 0070 theo sổ `01-KE-HOACH-TONG.md` mục 6, đã kiểm còn trống trong `specs/` và
trong các PR đang mở). Chưa dòng mã nào chạy theo spec này. Chỉ anh Andy duyệt. Khi anh
duyệt, câu trả lời được ghi nguyên văn kèm thời điểm vào `approval-decision.md`, và `status`
đổi sang `approved`. Bản thực thi là PR `high-risk` frontend G08-T14 (sau G10) và phần
Listening của G08-T23 (bỏ bài).

Spec cha: [EXAMROOM-0066](../0066-exam-room-shell/spec.md) (đã duyệt 23/11). Spec liên quan,
không sửa: [MOCKATTACH-0008](../0008-mock-attempt-integrity/spec.md),
[MOCKCONTENT-0016](../0016-mock-content-remediation/spec.md),
[LISTENDRILL-0054](../0054-listening-skill-drill-homework/spec.md) (drill dùng cùng trình).

FR của gói: FR-08-036 cùng các FR khung áp cho Listening test, và phần Listening của
FR-08-041 (bỏ bài). Bảng đối chiếu ở `verification.md`.

## Problem

Đã kiểm `frontend/app/(authed-listening-player)/listening/test/session/listening-test-session.tsx`
(1.005 dòng), `frontend/lib/listening-test-controller.mjs` và
`backend/routers/listening/attempts.py` trên `staging` @ `cc6dd4c8` (23/11/2026). G10 đã tách
`listening.py` thành gói `backend/routers/listening/`.

- Thanh trên in email học viên (`exam-topbar__candidate`, `user?.email`, L914).
- "Start a new attempt" khi có lượt dở dùng `window.confirm` (L936).
- Nộp lỗi (`submit`, L712) chuyển cả trang sang màn lỗi "Unable to submit Listening answers…";
  không giữ học viên trong bài, không phân biệt mất phản hồi với bị từ chối.
- Có hộp nộp trong trang (`submitOpen`) và chặn nộp khi còn câu chưa lưu (`submitBlocked`),
  nhưng không có lối thoát có hỏi, không nói đồng hồ vẫn chạy khi rời đi.
- Không có đồng hồ "Time remaining": full test phát audio một lần từ vị trí
  `listeningResumeOffsetSeconds(started_at)` (thời gian trôi kể từ khi bắt đầu); mini test,
  drill và bài practice (`test_type` `mini`/`drill`/`practice`) có audio tạm dừng và tua được.
- `submit` phía máy chủ không có hạn giờ (chỉ `require_resume_active`, hạn 24 giờ) và không có
  ân hạn hay 422 hết giờ như Reading.
- Không có cách bỏ đề tự chọn trừ khi bắt đầu lượt mới (`attempts.py` L527 đặt `abandoned`).
- Staging không có đề Listening test hay mini test nào (báo cáo 09a: `/listening/tests` rỗng).

## Scope

- Một nhánh giao diện mới cho `/listening/test/session` (full test, mini test, drill, bài giao
  của lớp, sitting thi thử nhúng, xem trước của admin), dựng trên `ExamRoomShell` chế độ
  `test` (tiếng Anh), bật bằng `examRoomEnabled('listening')`.
- Bỏ bài cho đề tự chọn (full test, mini test của chính học viên): một route đóng lượt không
  chấm.
- Không đổi hợp đồng chấm, lưu, khoá renderer, phát audio một lần, vị trí tiếp tục audio.

## Non-goals

- Trang kết quả (`ResultView`), trang xem lại, chép chính tả sau drill: giữ nguyên.
- Listening luyện programme (EXAMLISTENP-0069); runner thi thử bên ngoài iframe (EXAMMOCK-0071).
- Thêm đồng hồ hạn nộp phía máy chủ cho Listening (câu hỏi mở 1).
- Nhập đề thử lên staging (quy trình nội dung, cần anh Andy cho; câu hỏi mở 3).

## Users and journeys

- Học viên làm full test tự chọn: màn trước khi bắt đầu tiếng Anh, nghe 4 Part một lần, trả
  lời, nộp qua hộp hỏi lại; hoặc rời đi (audio và thời gian vẫn tính) hay bỏ bài.
- Học viên làm mini test hoặc drill: audio tạm dừng và tua được; drill có bước chép chính tả
  sau đó như hôm nay.
- Học viên làm bài giao của lớp: như trên, không có "Abandon test".
- Học viên trong sitting thi thử: Listening nhúng (`mock_embed=1`), không có thanh trên, vẫn
  trả lời `mock-flush`.
- Admin xem trước đề: dải "Admin preview", không lưu, không nộp.

## Requirements

- **FR-001:** `ListeningTestSession` rẽ nhánh theo `examRoomEnabled('listening')` ở đúng một
  chỗ sau các hook. Cờ tắt: không đổi DOM, chuỗi, class, request hay thứ tự gọi API. Cờ bật:
  cùng URL, cùng request, cùng thứ tự.
- **FR-002:** Nhánh mới là một file vẽ `listening-test-room.tsx` nhận state và hàm từ file cũ
  (`startFresh`, `resume`, `submit`, `updateAnswer`, `startAudio`, `retryAudio`,
  `bootWithRecovery`…). Logic boot, lưu (`createListeningSaveCoordinator`), cờ xem lại, nộp,
  khoá renderer, `MockHook`, tín hiệu `mock-flush` ở lại file cũ.
- **FR-003:** Thanh trên chế độ `test`: "Listening · <tên đề>" và "Part i of n" theo
  `activeSection` của trình (cue `section_start` tự đổi Part như hôm nay; dải câu không tự
  quản Part). Không in email hay tên; admin xem trước hiện "Admin preview".
- **FR-004:** Không có "Time remaining" (Listening không có hạn giờ phía máy chủ). Thanh trên
  hiện tiến độ audio bằng chữ: "Audio 12:30 / 30:00" cho full test, "Audio ready",
  "Audio is playing", "Audio has ended" như các chuỗi hiện có. `isFullTest` (cho
  `ExamEntryGate`) đúng khi `test_type` là `full` và không phải `mock_embed`, admin xem
  trước.
- **FR-005:** Màn trước khi bắt đầu tiếng Anh, giữ các luật hiện có ("Your answers are saved
  automatically.", "Reloading the page resumes your current attempt.", luật audio theo loại
  đề). "Start a new attempt" khi có lượt dở mở hộp trong trang "Start a new attempt? Your
  current attempt will be discarded." với "Keep current attempt" (chính) và "Start new
  attempt"; không còn `window.confirm`.
- **FR-006:** Trình phát dùng `AudioPlayer` của G03 qua `exam-room/audio-player.tsx`
  (EXAMROOM-0066 FR-028): full test (`test_type='full'`, bài giao kiểu full, sitting) →
  `policy='test'` (không tạm dừng, tua, tốc độ; chỉ âm lượng; tiếp tục từ
  `listeningResumeOffsetSeconds` khi tải lại); mini test, drill, practice → `policy='practice'`.
  Audio không tự phát được thì nút "Play" cần thao tác, kèm câu hiện có "The test timer
  continues." Chuỗi của trình phát ở chế độ `test` là tiếng Anh (0066 câu hỏi mở 9).
- **FR-007:** Dải câu theo Part (FR-08-036): ô theo Part, bốn trạng thái; bấm số câu chỉ cuộn
  tới câu, **không** tua audio. Cờ xem lại một điều khiển mỗi câu.
- **FR-008:** Câu hỏi hiển thị bằng dạng câu dùng chung của 0066 (gồm gắn nhãn bản đồ/sơ đồ);
  chuỗi đáp án gửi lên giống hệt trình hiện tại (test so chuỗi trên fixture hiện có).
- **FR-009:** Trạng thái lưu theo 0066 FR-013, tiếng Anh: "Saving…", "Saved at HH:MM" (mốc
  đặt trong nhánh ack hiện có của `createListeningSaveCoordinator`, không thêm đường lưu),
  "Not saved. Retrying…", "Retry".
- **FR-010:** Nộp qua hộp của khung, liệt kê câu trống. Giữ chặn nộp khi còn câu chưa lưu
  (`submitBlocked`): hộp nói rõ câu nào chưa lưu và có "Retry". Trạng thái nộp theo 0066
  FR-034, suy từ `coreOperationRequest` hiện có:
  - `confirmed`: phản hồi có `attempt_id` khớp, hoặc biên nhận `sealed`, hoặc đọc lại lượt
    thấy `submitted`.
  - `unconfirmed`: offline, 401, lỗi tạm hay mất phản hồi; học viên ở lại trong bài, ô khoá,
    tự thử tối đa 3 lần (có mạng lại, sau khi đăng nhập lại), rồi `unconfirmed_manual` với
    "Try again". Không chuyển cả trang sang màn lỗi.
  - 409 "Attempt đã thay đổi" (một lần lưu tới sau khi máy chủ đọc lại): đọc lại lượt; còn
    `in_progress` thì cho nộp lại, đã `submitted` thì `confirmed`.
  - Máy chủ Listening không đóng lượt theo giờ, nên không dùng `closed_unconfirmed` hay
    `expired_unsubmitted`; lượt chỉ hết hạn sau 24 giờ (`require_resume_active`), khi đó
    hiện thông điệp của máy chủ và nút "Back".
- **FR-011:** Lối thoát: "Leave test" mở hộp của khung; khung flush hàng đợi lưu và nêu số câu
  chưa lưu; rời về `backHref` hiện tại. Full test: hộp nói "The recording keeps playing on our
  side while you are away; when you return, it continues from the current point." (đúng với
  `listeningResumeOffsetSeconds`).
- **FR-012:** Bỏ bài (đề tự chọn: lượt của chính học viên, không `class_item`, không
  `sitting_id`, không admin xem trước): nút "Abandon test" và hộp hỏi lại của khung. Route mới
  `POST /api/listening/tests/attempts/{attempt_id}/abandon` trong
  `backend/routers/listening/attempts.py`:
  - Một câu UPDATE có điều kiện, cùng cách điều phối với `submit` (CAS trên trạng thái): `id`,
    `user_id`, `status='in_progress'`, `mock_sitting_id IS NULL`, không bài giao,
    `resume_expires_at > now` lấy ngay trước câu UPDATE. Listening không có hạn giờ phía máy
    chủ nên không có điều kiện giờ khác (khác Reading, EXAMREAD-0067 FR-012).
  - Câu UPDATE của bỏ bài không gắn với mảng `answers` (bỏ là huỷ cả lượt). Hai câu UPDATE
    hoàn tất của `submit` đã gắn CAS với `status='in_progress'` và đúng mảng đã chấm
    (`attempts.py` L1413–1463), nên bỏ thắng trước thì `submit` không ghi được và trả 409;
    `submit` thắng trước thì bỏ đọc lại thấy `submitted` và trả 409 `already_submitted`.
    Router Listening không có khoá ghi trong tiến trình như `_learner_write` của Reading;
    spec này không thêm khoá đó (CAS trong câu UPDATE là bảo đảm duy nhất cần có).
  - Không có dòng nào đổi thì đọc lại: đã `abandoned` → 200 cùng kết quả; đã `submitted` →
    409 `already_submitted`; gắn sitting/bài giao → 409 `not_self_selected`; không phải chủ →
    404.
  - Nộp và bỏ đồng thời: đúng một câu UPDATE thắng; bên thua nhận 409 kèm trạng thái thật.
  - Lượt bỏ không có kết quả, không vào lịch sử hay Tiến độ (thêm test cho ba chỗ đọc đó); làm
    lại được ngay.
- **FR-013:** Mất mạng: dải của khung; lưu thử lại khi `online`; nút nộp tay "Waiting for
  connection". Audio full test vẫn phát nếu đã tải; tải lại audio lỗi thì nút "Reload audio"
  hiện có.
- **FR-014:** Phiên hết hạn: mọi lời gọi `window.api.*` của nhánh mới truyền
  `{ noRedirect: true }` (lời gọi lưu đã có). 401 giữa bài: bản sao câu trả lời theo 0066
  FR-035 (`exam-room:local-copy:listening:{ownerKey}:{attemptId}`, mỗi câu có `baseValue` là
  đúng giá trị máy chủ ack lần cuối, và `baseSavedAt` chỉ để hiện giờ), hộp đăng nhập lại;
  quay lại đúng tài khoản thì gửi lại câu mà giá trị trên máy chủ vẫn bằng `baseValue` (so
  theo giá trị, không theo dấu thời gian). Khi rời (thoát, chuyển sang đăng nhập lại,
  `pagehide`): ghi ngay phần đang gộp, đọc lại khoá và so với câu trả lời trong trình. Chỉ
  khi đọc lại khớp (hoặc máy chủ đã ack đúng giá trị) thì hộp mới được nói bản trên máy đã
  giữ, và phương án dự phòng trước G05-T19 (`/login?next=` cùng tab) mới được chuyển trang;
  không khớp thì hộp chỉ có "Stay" và nêu câu nào chưa được lưu ở đâu cả (cùng quy tắc với
  EXAMWRITE-0068 FR-010). Tài khoản khác đăng nhập trong
  tab (hôm nay khoá theo `user.id` và tải lại) thì bản sao của tài khoản cũ bị xoá không đọc.
- **FR-015:** Hai tab cùng lượt: khoá ghi theo 0066 FR-017 (`surface='listening'`,
  `attemptKey=attemptId`); tab chỉ-đọc không gửi `PATCH`, không phát audio.
- **FR-016:** Nhúng (`mock_embed=1`): không thanh trên, không nộp, không thoát; vẫn trả lời
  `mock-flush` → `mock-flushed` với `unsaved` như hôm nay.
- **FR-017:** Xem trước của admin: không lưu, không nộp, cờ xem lại chỉ trong trang như hôm nay.
- **FR-018:** Khi cờ bật, luồng không gọi `window.confirm`, `alert` hay `prompt` (journey bắt
  sự kiện `dialog` = 0).
- **FR-019:** Sự kiện `exam_room_*` của khung với `surface='listening'`, không có nội dung câu
  trả lời.

## Acceptance scenarios

### Scenario 1: nộp còn câu trống và câu chưa lưu

- **Given** full test, 37/40 câu đã trả lời, một câu chưa lưu
- **When** bấm "Submit test"
- **Then** hộp liệt kê 3 câu trống và câu chưa lưu, nút nộp khoá kèm "Retry"; lưu xong thì nút
  mở; bấm nộp thì đúng một `POST .../submit` body rỗng.

### Scenario 2: tải lại giữa Part 3

- **Given** full test đang phát ở Part 3
- **When** tải lại trang rồi "Resume test"
- **Then** cùng lượt, audio tiếp tục từ `listeningResumeOffsetSeconds(started_at)`, thanh trên
  "Part 3 of 4", không có nút tạm dừng.

### Scenario 3: mất phản hồi nộp

- **Given** request nộp đã gửi, phản hồi mất
- **Then** học viên ở lại trong bài, trạng thái `unconfirmed`; đọc lại lượt thấy `submitted`
  thì `confirmed` và sang kết quả; không có màn lỗi toàn trang.

### Scenario 4: bỏ bài

- **Given** full test tự chọn đang làm
- **When** bấm "Abandon test" rồi xác nhận
- **Then** `POST .../abandon` trả `abandoned`, lượt không có kết quả, "Start test" tạo lượt mới.
- **Given** bài giao của lớp **Then** không có "Abandon test".
- **Given** nộp và bỏ cùng lúc **Then** đúng một bên thắng.

### Scenario 5: mini test

- **Given** `test_type='mini'`
- **Then** trình phát có tạm dừng và tua; thanh trên tiếng Anh; không bị chặn trên 390px.

### Scenario 6: nhúng trong thi thử

- **Given** `mock_embed=1`
- **Then** không có thanh trên; runner gửi `mock-flush` thì nhận `mock-flushed` với `unsaved`.

### Scenario 7: cờ tắt

- **Given** `examRoomSurfaces` không có `listening`
- **When** chạy các journey Listening test hiện có
- **Then** xanh như trước, không request nào đổi.

## Edge cases

- Drill có `skill_drill_homework`: dừng audio và chờ `drillPlayback` trước khi nộp như hôm nay.
- `post_test_capture_required`: chuyển sang phase `capture` như hôm nay.
- Lượt quá 24 giờ (`require_resume_active`): thông điệp máy chủ và "Back"; không bỏ được
  (route trả 409 vì `resume_expires_at`).
- Lớp đã lưu trữ (CLASSARCHIVE-0030): `submit` từ chối như hôm nay; hiện thông điệp máy chủ.
- `BroadcastChannel`, Web Locks hay `localStorage` không có: vẫn làm bài, không có tính năng phụ.
- Test đọc nguồn (`listening-test-native-controller.test.mjs`, `core-operation-integration`,
  `mock-exam-next-*`): giữ chuỗi bị ghim trong file cũ; test vỡ có chủ ý thì sửa cùng PR và
  liệt kê.

## Success criteria

- Khi cờ bật: 0 sự kiện `dialog`; nộp lỗi không còn đưa học viên ra màn lỗi toàn trang.
- Khi cờ tắt: các journey ở GOI-08 mục 9.1 cho Listening test xanh như trước.

## Open questions

Mỗi câu kèm đề xuất; mặc định tạm là đề xuất cho tới khi anh Andy trả lời.

1. **Hạn nộp phía máy chủ cho Listening.** Hôm nay `submit` không có hạn (chỉ 24 giờ), nên
   học viên có thể nộp rất lâu sau khi audio hết. Đề xuất: không đổi trong spec này; nếu cần
   (ví dụ audio + 2 phút kiểm bài như thi máy), làm spec backend riêng rồi thêm đồng hồ. Mặc
   định tạm: không có đồng hồ.
2. **Bỏ bài.** Đề xuất: route mới như FR-012, PR riêng của G08-T23 phần Listening, sau cờ.
   Mặc định tạm: như đề xuất.
3. **Dữ liệu thử trên staging (G08-T13).** Staging không có đề Listening test hay mini test.
   Đề xuất: nghiệm thu tự động bằng fixture của `verify-listening-test-session-flow.mjs` và
   `verify-listening-player-overflow-flow.mjs`; nhập một đề thử lên staging chỉ khi anh Andy
   cho (GOI-08 mục 10 câu 6), theo quy trình nội dung. Mặc định tạm: chỉ fixture; không bật cờ
   production trước khi có một lần nghiệm thu thật trên staging.
