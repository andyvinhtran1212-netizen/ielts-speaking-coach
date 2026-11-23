---
id: EXAMREAD-0067
title: Reading full tests and mini tests run in the shared exam room behind a flag, with the same requests, answers and results as today
status: draft
risk: high
owner: product
---

# Reading full test và mini test chạy trong khung phòng thi chung

Status: **draft**. Soạn ngày 23/11/2026 theo nhiệm vụ G08-T06 của
`docs/proposals/commercialization-2026-11/GOI-08-phong-thi-va-trinh-luyen.md`
(spec S1; số 0067 theo sổ `01-KE-HOACH-TONG.md` mục 6, đã kiểm còn trống). Chưa
dòng mã nào chạy theo spec này. Chỉ anh Andy duyệt. Khi anh duyệt, câu trả lời
được ghi nguyên văn kèm thời điểm vào `approval-decision.md`, và `status` đổi sang
`approved`.

Spec cha: [EXAMROOM-0066](../0066-exam-room-shell/spec.md) (khung chung, đang ở
dạng nháp; spec này chỉ được duyệt sau hoặc cùng lúc với 0066). Spec liên quan,
không sửa: [MOCKATTACH-0008](../0008-mock-attempt-integrity/spec.md) (gắn sitting
trước khi lượt dùng được), [MOCKCONTENT-0016](../0016-mock-content-remediation/spec.md)
(cờ xem lại khi tiếp tục lượt).

FR của gói: FR-08-030, 031 cùng các FR khung áp cho Reading, và phần Reading của
FR-08-041 (bỏ bài, nhiệm vụ G08-T23). Bảng đối chiếu ở `verification.md`.

## Problem

Reading là trình gần với khung đích nhất nhưng vẫn khác ở những chỗ có thể làm học
viên mất bài, nộp nhầm hay lộ thông tin. Đã kiểm `reading-exam-session.tsx` trên
`staging` @ `cc6dd4c8` (23/11/2026):

- Thanh trên in email học viên (`exam-topbar__candidate`, `user?.email`).
- "Start a new attempt" khi đang có lượt dở dùng `window.confirm`.
- Không có lối thoát sau khi bắt đầu bài; không nói đồng hồ vẫn chạy khi rời đi.
- Trạng thái lưu chỉ là chữ "Saving…" từng câu và "Saving N answers." ở thanh đáy;
  không có "đã lưu lúc mấy giờ".
- Cờ xem lại có hai điều khiển cho cùng một câu (nút "Review" ở từng câu và ô
  "Review" ở thanh đáy).
- Lời gọi boot của lượt có tài khoản không truyền `noRedirect`, nên 401 lúc tải lại
  trang đẩy học viên sang `/login`; giữa bài chưa có hộp đăng nhập lại.
- Không có cách bỏ một đề tự chọn mà không bắt đầu lượt mới: backend chỉ đặt
  `status='abandoned'` khi tạo lượt mới cho cùng đề (`reading_student.py`).

## Scope

- Một nhánh giao diện mới cho `/reading/exam/session` (full test, mini test, link
  chia sẻ, bài giao của lớp, sitting của thi thử, xem trước của admin) dựng trên
  `ExamRoomShell`, bật bằng `examRoomEnabled('reading')`.
- Bỏ bài cho đề tự chọn (full test, mini test của chính học viên): một route đóng
  lượt không chấm.
- Không đổi hợp đồng chấm, lưu, khoá renderer, thời gian giới hạn, ân hạn 5 phút.

## Non-goals

- Trang kết quả, xem lại bài (`ResultView`, `/reading/review`), màn `sealed`, màn
  `capture` của thi thử: giữ nguyên (G07 làm sau).
- Trình cũ `frontend/pages/reading-exam.html`, `public/js/reading-exam.js`: không sửa.
- Đổi `readingPlayerQuery`, `core-player-affinity.mjs` hay `allowed_query`.
- Nguồn "bài có giờ" cho G04 và phiên bị chiếm (G08-T24, nhiệm vụ riêng).
- Mock runner bên ngoài iframe (EXAMMOCK-0071).
- Lưu Highlight/Note trên server.

## Users and journeys

- Học viên làm full test tự chọn (`from=full`): vào màn trước khi bắt đầu, làm 3
  Passage trong khung tiếng Anh, nộp qua hộp hỏi lại, hoặc rời đi (đồng hồ vẫn chạy)
  hay bỏ bài.
- Học viên làm mini test, bài giao của lớp: như trên, mini test không bị chặn trên
  điện thoại; bài giao của lớp không có "Abandon test".
- Khách mở link chia sẻ: làm bài không cần tài khoản, như hôm nay.
- Học viên trong sitting thi thử: Reading nhúng trong runner (`mock_embed=1`), không
  có thanh trên.
- Admin xem trước đề (`admin_preview=1`): thấy dải "Admin preview", không lưu gì.

## Requirements

- **FR-001:** `ReadingExamSession` rẽ nhánh render theo `examRoomEnabled('reading')`
  ở đúng một chỗ, sau khi mọi hook đã chạy (không gọi hook có điều kiện). Nhánh cờ
  tắt giữ nguyên DOM, id, class, chuỗi và request của hôm nay.
- **FR-002:** Nhánh mới là một file vẽ `reading-exam-room.tsx` nhận state và hàm từ
  `ReadingExamSession` (`saveAnswer`, `submit`, `toggleFlag`, `jumpToQuestion`,
  `bootWithRecovery`, `startFresh`…). Logic boot, lưu, nộp, khoá renderer ở lại file
  cũ; không nhân bản. Cùng URL, cùng tham số, cùng request (method, path, body,
  header, thứ tự), `renderer_affinity` vẫn là `next`.
- **FR-003:** Thanh trên chế độ `test`: tên "Reading · <tên đề>" và "Passage i of n";
  không in email, tên hay mã học viên. Link chia sẻ không có tên khách. Admin xem
  trước có dải "Admin preview" như hôm nay.
- **FR-004:** `isFullTest` đúng khi `from=full` và không phải `mock_embed`, `admin_preview`.
  Khi đó phòng thi luôn sáng và bọc màn chặn điện thoại của PHONEGATE-0081 trước khi
  tạo lượt. Mini test, bài giao của lớp và link chia sẻ không bị chặn và có bản 390px.
  Hộp Options hiện có (khoá `ielts-exam-theme`) giữ trong khe phải của thanh trên.
- **FR-005:** Màn trước khi bắt đầu tiếng Anh, "Start test" là nút chính, "Back" là
  nút phụ. Khi có lượt dở, "Start a new attempt" mở hộp trong trang ("Start a new
  attempt? Your current attempt will be discarded and replaced." với "Continue current
  attempt" là nút chính) thay `window.confirm`; chỉ khi xác nhận mới gọi `startFresh`.
- **FR-006:** Hai cột dùng tay nắm của khung (30–70%, tỉ lệ lưu theo `attempt_id`,
  dưới 900px là hai thẻ "Passage"/"Questions").
- **FR-007:** Dải câu sinh từ `readingDisplayQuestionRuns` theo Passage, không viết cứng
  13·13·14. Cờ xem lại đọc và ghi qua `useAttemptReviewFlags` như hôm nay (lưu server,
  khôi phục khi tiếp tục lượt theo MOCKCONTENT-0016); mỗi câu chỉ một điều khiển cờ, bỏ
  ô "Review" trùng ở thanh đáy trong nhánh mới. Cờ chưa sẵn sàng thì điều khiển khoá
  và `AttemptReviewFlagStatus` vẫn hiện lỗi và nút thử lại.
- **FR-008:** Câu hỏi hiển thị bằng dạng câu dùng chung của 0066; chuỗi đáp án gửi lên
  giống hệt chuỗi `user_answer` nhánh cũ gửi cho cùng thao tác (chọn nhiều vẫn nối dấu
  phẩy như hôm nay).
- **FR-009:** Trạng thái lưu lấy từ `saveStates` của bộ lưu hiện có (chỉ chứa câu chưa
  lưu: `pending`/`retrying`/`failed`, câu được bỏ khỏi đó khi ack) và một mốc mới
  `lastSavedAt` mà T001 đặt ngay trong nhánh xử lý ack hiện có của bộ lưu (chỗ bỏ câu
  khỏi `saveStates`), không thêm đường lưu thứ hai: "Saving…", "Saved at HH:MM", "Not saved. Retrying…", "Retry"
  khi một câu ở trạng thái `failed` (gọi lại đường lưu hiện có).
- **FR-010:** Nộp qua hộp của khung, liệt kê câu trống. Hết giờ thì trình tự nộp qua đường
  hiện có (`readingRemainingSeconds` từ `started_at` của server), đưa giá trị cuối cùng đã
  gõ vào lần nộp, không hỏi lại. Khoá nộp hai lần giữ nguyên (`autoSubmittedRef`, phase
  `submitting`, biên nhận `sealed` của backend). Máy chủ Reading **không** tự đóng hay tự
  nộp lượt theo giờ: lượt bỏ dở vẫn `in_progress` cho tới khi học viên bắt đầu lượt mới;
  `submit` của lượt không gắn sitting bị từ chối 422 "Time limit exceeded — attempt
  expired." khi đã quá `time_limit + 5 phút` (`_SUBMIT_GRACE_SECONDS`, `reading_student.py`
  L675, L1598). Trạng thái nộp đưa cho khung qua `submit.outcome` (0066 FR-034):
  - `confirmed`: lời gọi nộp trả thành công (kể cả biên nhận `sealed`), hoặc đọc lại lượt
    thấy `submitted`.
  - `unconfirmed`: offline, 401, lỗi tạm hay mất phản hồi. Hết giờ lúc offline thì lần nộp
    tự động được xếp hàng và gửi khi có mạng (không chờ nút nộp tay, 0066 FR-019); 401 thì
    làm theo FR-014 rồi nộp lại; mất phản hồi thì đọc lại lượt trước, chỉ nộp lại khi lượt
    vẫn `in_progress`. Tự thử tối đa 3 lần, rồi `unconfirmed_manual`.
  - Hàng đợi chỉ còn tác dụng trong 5 phút ân hạn: màn `unconfirmed` nói rõ "Reconnect
    within 5 minutes of the end time so we can submit your answers." Lần nộp tới máy chủ
    sau mốc đó nhận 422 thì chuyển sang `expired_unsubmitted` (FR-021), không bao giờ
    hiện "submitted".
  Không thêm thời gian.
- **FR-011:** Lối thoát: "Leave test" mở hộp của khung; khung flush hàng đợi lưu hiện có
  và nêu số câu chưa lưu; rời về `backHref` hiện tại. Đồng hồ server không dừng; quay lại
  trong giờ thì tiếp tục đúng lượt.
- **FR-012:** Bỏ bài (đề tự chọn: `from=full` hoặc `from=mini`, lượt của chính học viên,
  không có `class_item`, `sitting_id`, `share`, `admin_preview`): nút "Abandon test" và hộp
  hỏi lại của khung. Xác nhận thì gọi route mới `POST /api/reading/test/attempts/{id}/abandon`;
  `status='abandoned'` đã có trong CHECK của mig 087, không cần migration; không chấm.
  - Mọi điều kiện nằm **trong chính câu UPDATE**, cùng cách điều phối với `submit` (UPDATE
    có điều kiện, đọc lại khi không có dòng nào đổi): `id`, chủ lượt, `status =
    'in_progress'`, không gắn `sitting_id`/bài giao, không phải lượt khách, `resume_expires_at
    > now` như `submit`, và **còn trong giờ** theo mốc canonical: `started_at > now_ghi -
    time_limit` với `now_ghi` lấy ngay trước câu UPDATE (không phải lúc request bắt đầu).
  - Không có dòng nào đổi thì đọc lại lượt: đã `abandoned` → 200 cùng kết quả (gọi lại
    an toàn); đã `submitted` → 409 `already_submitted`; còn `in_progress` mà đã hết giờ
    → 409 `time_expired`; gắn sitting/bài giao → 409 `not_self_selected`.
  - Hết giờ thì không bỏ được: lần nộp tự động của trình có quyền ưu tiên. Màn của học viên
    sau 409 `time_expired` theo trạng thái nộp ở FR-010, không hứa "đã tự nộp" khi máy chủ
    chưa xác nhận.
  - Nộp và bỏ đồng thời: hai câu UPDATE cùng điều kiện `status='in_progress'`, đúng một câu
    thắng; bên thua nhận 409 kèm trạng thái thật, giao diện hiện theo trạng thái đó.
  - Lượt bỏ không xuất hiện ở kết quả, lịch sử hay Tiến độ. Lượt `abandoned` đã có từ hôm nay
    (khi bắt đầu lượt mới), nên T003 chỉ thêm test lượt bỏ cho kết quả, lịch sử và Tiến độ,
    không rà toàn bộ. Làm lại được ngay, không giới hạn số lần.
  - Bài giao của lớp, sitting thi thử và link chia sẻ không có nút này và route từ chối.
- **FR-013:** Mất mạng: dải của khung; lưu thử lại khi `online` như hôm nay; nút nộp tay
  đổi "Waiting for connection" và khoá trong lúc offline hoặc còn câu chưa lưu. Khoá này
  không chặn lần nộp tự động khi hết giờ (FR-010).
- **FR-014:** Phiên hết hạn: trong nhánh mới, mọi lời gọi `window.api.*` của lượt có tài
  khoản truyền `{ noRedirect: true }`. 401 giữa bài: ghi bản sao câu trả lời
  `exam-room:local-copy:reading:{ownerKey}:{attempt_id}` theo 0066 FR-035 (`ownerKey` là
  `user.id` của lượt; mỗi câu ghi kèm `baseSavedAt` là `updated_at`/giờ ack gần nhất mà bộ
  lưu biết), hiện hộp đăng nhập lại của khung. Trước khi có G05-T19, hộp dùng phương án dự
  phòng của 0066 FR-015: `/login?next=<URL phòng thi>` cùng tab, chỉ bật sau khi đọc lại
  được bản sao. Đăng nhập lại đúng tài khoản: tải lượt từ server, rồi gửi lại qua bộ lưu
  hiện có chỉ những câu mà server chưa đổi kể từ `baseSavedAt`; câu server mới hơn thì giữ
  bản server; lượt đã nộp hay đã bỏ thì chỉ xoá bản sao. Xoá bản sao khi server ack, khi
  bỏ bài (FR-012), khi đăng xuất, khi tài khoản khác đăng nhập (xoá không đọc). Tài khoản
  khác không đọc, khôi phục hay gửi được bản sao này. Link chia sẻ dùng quyền khách, không có
  hộp này; lỗi 403/404 của khách giữ như hôm nay.
  Hôm nay tài khoản khác đăng nhập trong tab làm `window.location.reload()` (khoảng L869)
  trước khi đọc gì; việc dọn bản sao của tài khoản cũ chạy ở lần tải lại đó (xoá mà không
  đọc). Khoá theo `ownerKey` bảo đảm không ai khác đọc được kể cả khi việc dọn chưa chạy.
- **FR-015:** Cùng lượt mở ở tab thứ hai: thông báo tab khác của khung; tab chỉ-đọc không
  gửi `PATCH`. "Use this tab": tab cũ flush bộ lưu hiện có (câu lỗi vào bản sao FR-014)
  rồi mới nhả khoá ghi; tab mới chỉ ghi khi giữ khoá và đã tải lại lượt từ server; 5 giây
  không có khoá thì vẫn chỉ-đọc (0066 FR-017). Reading chưa có khoá ghi phía server, nên hai
  trình duyệt hay hai thiết bị vẫn có thể cùng ghi; giới hạn này giữ như hôm nay (bộ lưu ghi
  đè theo câu) và ghi ở câu hỏi mở 5.
- **FR-016:** Chế độ nhúng (`mock_embed=1`): không thanh trên, đồng hồ, nộp, thoát; vẫn trả
  lời `mock-flush` bằng `mock-flushed` với số câu chưa lưu như hôm nay; màn `sealed` và
  `capture` giữ nguyên. Thứ tự gắn sitting của MOCKATTACH-0008 không đổi.
- **FR-017:** Xem trước của admin (`admin_preview=1`): không lưu gì, không có nút nộp, giữ
  link "Review answers" của admin; cờ xem lại chỉ trong tab như hôm nay.
- **FR-018:** Highlight/Note bằng lớp của khung (dùng lại cách CSS Highlight API hiện có, có
  `<mark>` dự phòng), lưu trên máy theo lượt.
- **FR-019:** Khi cờ `reading` bật, luồng làm bài không gọi `window.confirm`, `alert` hay
  `prompt` nào (journey bắt sự kiện `dialog` = 0), kể cả đề có mật khẩu (FR-022).
- **FR-020:** Sự kiện `exam_room_*` của khung gửi với `surface='reading'`, không có nội
  dung câu trả lời.

- **FR-021:** Trạng thái `expired_unsubmitted` (đề xuất thêm vào EXAMROOM-0066 FR-034 bằng
  sửa đổi 1, câu hỏi mở 6): `submit` trả 422 "attempt expired". Màn: "Time ran out before
  your answers reached our server. This attempt was not submitted and has no score. Your
  answers were saved on our server up to [HH:MM]." với nút "Back" về `backHref`, không nút
  thử lại, không chữ "submitted". Bản sao tại máy bị xoá (không còn gửi được). Lượt vẫn
  `in_progress` trên máy chủ cho tới khi học viên bắt đầu lượt mới (câu hỏi mở 7).
- **FR-022:** Đề có mật khẩu: 403 khi boot trong nhánh mới hiện ô nhập mật khẩu trong trang
  của khung (tiếng Anh: "This test is locked. Enter the test password." với "Unlock" và
  "Back"), lưu vào đúng khoá `reading-pw:{testId}` của sessionStorage như hôm nay, boot lại
  một lần; sai mật khẩu thì báo "That password is not correct." và cho nhập lại. Không có
  `window.prompt`. `bootWithRecovery` nhận thêm một hàm hỏi mật khẩu; nhánh cờ tắt truyền
  hàm gọi `window.prompt` y như hôm nay, nên không đổi.

## Acceptance scenarios

### Scenario 1: nộp còn câu trống

- **Given** cờ `reading` bật và học viên đã trả lời 37/40 câu
- **When** bấm "Submit test"
- **Then** hộp Warning liệt kê "Q7, Q12, Q13"; **When** "Return to test" **Then** không có
  `POST .../submit`.

### Scenario 2: kéo tỉ lệ và tải lại

- **Given** lượt đang ở 50/50
- **When** kéo tới 64% rồi tải lại
- **Then** cùng lượt, cùng câu trả lời, 64%, cùng Passage, không có `POST .../attempts` mới.

### Scenario 3: hết giờ khi đang gõ

- **Given** còn 2 giây, học viên đang gõ "dozen pie" vào ô điền
- **When** đồng hồ về 0
- **Then** body `POST .../submit` (hoặc `PATCH` ngay trước nó) chứa "dozen pie"; không có hộp hỏi.

### Scenario 4: thoát và bỏ bài

- **Given** full test tự chọn đang làm
- **When** bấm "Leave test"
- **Then** hộp nói đồng hồ vẫn chạy; không có "Save and exit".
- **When** "Abandon test" rồi xác nhận
- **Then** `POST .../abandon` trả `abandoned`, lượt không có kết quả, "Start test" tạo lượt mới.
- **Given** bài giao của lớp **Then** không có "Abandon test".

### Scenario 5: mất mạng và phiên hết hạn

- **Given** trình duyệt offline
- **When** bấm nộp
- **Then** nút "Waiting for connection" khoá; có mạng lại thì câu chưa lưu được lưu.
- **Given** `PATCH .../answers` trả 401
- **When** học viên gõ tiếp
- **Then** URL không đổi, hộp "Your session has expired"; đăng nhập lại đúng tài khoản thì
  câu vừa gõ được gửi lại (server chưa đổi câu đó) và bản sao bị xoá; tài khoản khác đăng
  nhập thì không thấy và không gửi được bản sao.
- **Given** offline và đồng hồ về 0
- **Then** "Time is up", "We have not confirmed your submission yet…", ô khoá; có mạng lại
  thì lần nộp trong hàng đợi được gửi, chỉ khi server xác nhận mới hiện "saved and
  submitted".

### Scenario 6: điện thoại

- **Given** 390×844
- **When** mở full test
- **Then** chỉ có màn chặn, không có `POST .../attempts`; **When** mở mini test **Then** làm được.

### Scenario 7: cờ tắt

- **Given** `examRoomSurfaces` không có `reading`
- **When** chạy `frontend/tests/reading-native/*.spec.js` và write-flow `reading-exam-*`
- **Then** tất cả xanh như trước.

### Scenario 8: kết quả trùng

- **Given** cùng một bộ câu trả lời cho đề AVR-READ-001
- **When** nộp ở nhánh cũ và ở nhánh mới
- **Then** điểm và từng câu đúng/sai trùng nhau.

### Scenario 9: đề có mật khẩu

- **Given** cờ bật, đề bị khoá bằng mật khẩu
- **When** mở đề
- **Then** ô mật khẩu trong trang; nhập đúng thì vào bài; sai thì "That password is not
  correct."; 0 sự kiện `dialog`.

### Scenario 10: offline quá ân hạn

- **Given** đồng hồ về 0 khi offline
- **When** có mạng lại sau `time_limit + 5 phút`
- **Then** lần nộp trong hàng đợi nhận 422; màn "Time ran out before your answers reached
  our server…" với giờ lưu cuối; không chữ "submitted".
- **Given** có mạng lại trong 5 phút **Then** nộp được và chỉ khi phản hồi thành công mới
  hiện "saved and submitted".

### Scenario 11: bỏ bài sát giờ và đua với nộp

- **Given** request bỏ bài bắt đầu trước mốc hết giờ nhưng câu UPDATE chạy sau mốc
- **Then** 409 `time_expired`, lượt không bị bỏ.
- **Given** nộp và bỏ gửi cùng lúc
- **Then** đúng một bên thắng; bên kia nhận 409 kèm trạng thái thật.

## Edge cases

- Test đọc chuỗi nguồn (`reading-exam-native-controller.test.mjs` và các test khác ở
  GOI-08 T07): giữ các chuỗi bị ghim trong `reading-exam-session.tsx`; test vỡ do đổi có chủ
  ý thì sửa cùng PR và liệt kê; quá 30 test vỡ thì dừng và báo.
- Đổi cờ giữa một lượt: tải lại dùng giao diện mới hay cũ theo cờ, cùng dữ liệu server.
- Bỏ bài đúng lúc hết giờ: điều kiện giờ nằm trong câu UPDATE (FR-012); quá giờ thì 409
  `time_expired` và màn theo trạng thái nộp của FR-010; không có "kết quả tự nộp".
- Bỏ bài khi còn câu chưa lưu: bỏ không cần lưu; câu chưa lưu bị bỏ cùng lượt.
- Bấm "Abandon test" hai lần: lần hai trả cùng kết quả, không lỗi.
- Ghi đè `?exam_room=on` chỉ dùng trên URL `/reading/exam/session`, không đi qua
  `/core-player/launch`; bị bỏ khi production.
- `BroadcastChannel` hay `localStorage` không có: bài vẫn làm được, không có tính năng phụ.

## Success criteria

- Với cờ `reading` bật trên staging: journey Scenario 1–6 xanh, 0 sự kiện `dialog`, không
  có email trên trang.
- Với cờ tắt: toàn bộ bộ `reading-native` và write-flow `reading-exam-*` xanh như trước.
- Scenario 8: kết quả nhánh mới trùng nhánh cũ cho cùng câu trả lời.

## Open questions

1. **Bỏ bài.** Đề xuất: route mới `POST /api/reading/test/attempts/{id}/abandon` dùng trạng
   thái `abandoned` có sẵn, không migration; làm trong PR riêng của G08-T23, sau cờ
   `reading`. Mặc định tạm: như đề xuất.
2. **Hộp đăng nhập lại khi chưa có component G05-T19.** Đề xuất: dùng phương án dự phòng
   của 0066 FR-015 (`/login?next=` cùng tab sau khi đọc lại được bản sao), nên cờ `reading`
   không phải chờ G05-T19. Mặc định tạm: như đề xuất.
3. **Link chia sẻ có "Abandon test" không.** Đề xuất: không (khách không có lịch sử để bảo
   vệ, bắt đầu lại đã bỏ lượt cũ). Mặc định tạm: không.
4. **Chữ hộp "Start a new attempt".** Đề xuất như FR-005; tờ `PhongThi` chưa vẽ, chữ cuối
   theo tờ khi có.
5. **Khoá ghi phía server cho Reading.** Đề xuất: chưa làm (Reading lưu từng câu, ghi đè
   theo câu, nên hai nơi cùng ghi chỉ làm câu sau thắng); xét lại khi Full test bật
   production, theo câu hỏi mở 10 của 0066. Mặc định tạm: như đề xuất.
6. **Trạng thái `expired_unsubmitted` cho khung.** EXAMROOM-0066 (đã duyệt) chưa có trạng
   thái cho "nộp tới máy chủ sau ân hạn, bị từ chối". Đề xuất: sửa đổi 1 của 0066 thêm giá
   trị này vào `submit.outcome` với chữ ở FR-021, duyệt cùng spec này; không đổi trạng thái
   nào khác. Mặc định tạm: như đề xuất.
7. **Lượt bỏ dở không được đóng.** Reading không có tác vụ phía máy chủ đóng lượt quá giờ;
   lượt nằm `in_progress` tới khi học viên bắt đầu lượt mới. Đề xuất: ngoài phạm vi spec
   này; thêm vào danh sách việc tiếp theo (finalizer theo giờ cho Reading/Listening), xét
   khi làm nguồn "bài có giờ" của G08-T24. Mặc định tạm: như đề xuất.
8. **Bỏ lượt đã quá ân hạn.** CR gợi ý cho bỏ lượt đã quá `time_limit + 5 phút` (không còn
   nộp được). Đề xuất: chưa cho, theo HOLD của anh Andy (từ chối bỏ bài sau khi hết giờ);
   lượt đó được dọn khi bắt đầu lượt mới như hôm nay. Mặc định tạm: như đề xuất.
