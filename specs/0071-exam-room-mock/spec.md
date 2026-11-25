---
id: EXAMMOCK-0071
title: Assigned mock tests run in the shared exam room behind a flag, with the runner as the only clock and submit owner, the same collection order and a learner side that follows the exam audience and run mode
status: approved
risk: high
owner: product
---

# Mock test được giao chạy trong khung phòng thi chung

Status: **approved** (anh Andy, 23/11/2026 17:08 giờ VN; nguyên văn trong
[`approval-decision.md`](approval-decision.md)). Soạn ngày 23/11/2026 theo nhiệm vụ G08-T15 của
`docs/proposals/commercialization-2026-11/GOI-08-phong-thi-va-trinh-luyen.md` (spec S5; số 0071
theo sổ `01-KE-HOACH-TONG.md` mục 6, đã kiểm còn trống trong `specs/` và trong các PR đang mở).
Chưa dòng mã nào chạy theo spec này. Chỉ anh Andy duyệt. Khi anh duyệt, câu trả lời được ghi
nguyên văn kèm thời điểm vào `approval-decision.md`, và `status` đổi sang `approved`. Bản thực
thi là PR `high-risk` frontend G08-T16 (sau G08-T07 và G08-T14) và hai PR của G08-T22 (phía học
viên của kỳ thi được giao, sau G09-T31).

Spec cha: [EXAMROOM-0066](../0066-exam-room-shell/spec.md) (đã duyệt 23/11). Spec liên quan,
không sửa: [MOCKATTACH-0008](../0008-mock-attempt-integrity/spec.md) (gắn sitting trước khi
lượt dùng được), [MOCKREPAIR-0016](../0016-mock-content-remediation/spec.md),
[MOCKOPS-0006](../0006-admin-mock-test-operations/spec.md),
[MOCKORG-0086](../0086-mock-exam-organisation/spec.md) (G09, nháp: `mock_exam_audiences`,
`exam_mode_v2`, `services/mock_exam_modes.py`). Trang con nhúng: Reading theo
[EXAMREAD-0067](../0067-exam-room-reading/spec.md), Listening theo
[EXAMLISTENT-0070](../0070-exam-room-listening-test/spec.md); phần Speaking của kỳ thi theo
EXAMSPEAK-0072.

FR của gói: FR-08-037, FR-08-043, FR-08-044 cùng các FR khung áp cho runner thi thử. Bảng đối
chiếu ở `verification.md`.

## Problem

Đã kiểm `frontend/app/(authed-mock-exam)/mock-exam/mock-exam-runner.tsx` (1.232 dòng),
`frontend/lib/mock-exam-model.mjs` và `backend/routers/mock_exams.py` trên `staging` @ `cc6dd4c8`
(23/11/2026).

- Runner có thanh riêng `me-bar` (đồng hồ, tên phần, "Answers saved automatically"), không có
  lối thoát nào; học viên chỉ rời được bằng cách đóng tab.
- Không có nộp tay: một phần kết thúc khi đồng hồ chung của phần về 0 (runner gọi
  `submitSection`) hoặc khi giám thị thu bài (`collected_section`); docstring của
  `submit_section` ghi rõ "No early manual submit exists client-side".
- Reading/Listening chạy trong `<iframe>` (`mock_embed=1`). Trước khi nộp, runner gửi
  `postMessage({type:'mock-flush'})`, trang con trả `mock-flushed` kèm `unsaved`; khi giám thị
  thu thì runner flush rồi gọi `.../flush-ack`; nộp là `POST` domain (`/api/reading|listening/...
  /submit`) rồi `POST .../sections/{s}/submit`, trong một `coreOperationRequest`.
- Nộp lỗi tạm thì thử lại theo `SUBMIT_RETRY_DELAYS` (4 lần: 2, 5, 10, 20 giây), rồi dải
  "Answers have not been submitted…"; 403/404 thì màn lỗi toàn trang.
- Writing có `WritingWorkspace` riêng: lưu sau 5 giây/15 giây, bản sao `localStorage` khoá
  `mock-writing:{sittingId}:{task}` **không gắn tài khoản**, và `chooseWritingDraft` so
  `submittedAt` của máy chủ với `ts` theo đồng hồ máy học viên.
- Chế độ kỳ thi trên `staging` chỉ có `sequential` và `retake` (`mock-exam-model.mjs` L22);
  `retake` có màn chọn phần ("Start <section>", `Checklist`). Chưa có `mock_exam_audiences`,
  `exam_mode_v2` hay `self_paced` (MOCKORG-0086 còn nháp).
- Màn chờ, màn đã thu, màn huỷ và màn lỗi là thẻ tiếng Anh riêng, không có dòng phụ tiếng Việt.

## Scope

- Một nhánh giao diện mới cho runner `/mock-exam`, bật bằng `examRoomEnabled('mock')`: thanh
  trên và đồng hồ của khung chế độ `test`, thân là iframe (Reading/Listening) hoặc trình soạn
  Writing chế độ test; lối thoát có hỏi; trạng thái nộp theo 0066 FR-034; bản sao Writing gắn
  tài khoản.
- Phía học viên của kỳ thi được giao theo hợp đồng của MOCKORG-0086 (người dự thi, `live` /
  `self_paced`, kỳ thiếu kỹ năng, làm một lần), sau cờ riêng `mock_exam_audiences_learner`.
- Không đổi thứ tự `mock-flush` → `flush-ack` → `submit`, hợp đồng `postMessage`, cách chấm,
  cách gắn sitting (MOCKATTACH-0008), báo cáo `integrity`.

## Non-goals

- API và màn admin của kỳ thi (G09, MOCKORG-0086). Trang kết quả, phiếu kỳ thi (G07).
- Phòng Speaking của kỳ thi (EXAMSPEAK-0072): runner chỉ mở nó như hôm nay.
- Danh sách kỳ thi ở `/tests` (G07-T16). Nguồn "bài có giờ" cho `services/timed_work.py`
  (G08-T24).
- Thi bù do admin cấp (G09); không cho học viên làm lại phần đã nộp.

## Users and journeys

- Học viên được giao kỳ thi `sequential`/`live`: vào phòng chờ, giám thị mở từng phần, làm bài
  trong khung, phần kết thúc khi hết giờ hoặc giám thị thu.
- Học viên của kỳ `self_paced` (sau G09-T31): tự bấm bắt đầu trong khoảng mở, các phần chạy liền
  nhau theo mốc máy chủ, không nghỉ giữa các phần.
- Học viên rời giữa chừng: hộp "Leave this test?", đồng hồ vẫn chạy, quay lại vào đúng phần.
- Học viên mất mạng hoặc hết phiên: dải mất mạng, hộp đăng nhập lại, bài không mất.

## Requirements

- **FR-001:** `MockExamRunner` rẽ nhánh theo `examRoomEnabled('mock')` ở đúng một chỗ sau các
  hook. Cờ tắt: không đổi DOM, chuỗi, class, request hay thứ tự gọi API. Cờ bật: cùng URL,
  cùng request, cùng thứ tự.
- **FR-002:** Nhánh mới là file vẽ `mock-exam-room.tsx` nhận state và hàm từ file cũ
  (`loadState`, `flushEmbed`, `acknowledgeCollectionFlush`, `doSubmit`, `submitSection`,
  `startRetake`, `startSpeaking`, `registerWriting`, báo `integrity`…). Logic boot, đồng hồ,
  thu bài, nộp, gắn sitting, `MockPostTestCapture` ở lại file cũ.
- **FR-003:** **Runner là chủ duy nhất của đồng hồ và việc nộp.** Thanh trên của khung chế độ
  `test`, tiếng Anh: "Mock test · <tên kỳ thi>", "Section i of n: <tên phần>", "Time remaining"
  từ `sectionTimeLeftSeconds` của máy chủ (neo như hôm nay), mốc 5 phút và 0 theo 0066 FR-018,
  kèm câu hiện có "This section will be submitted automatically." Không in email hay tên.
  `isFullTest` luôn đúng: phòng thi luôn sáng; màn chặn điện thoại của PHONEGATE-0081 chỉ gắn khi
  spec đó đã lên `staging`. Trước đó theo phương án dự phòng 0066 FR-024: không chặn, chỉ luôn sáng,
  và thân bài dưới 768px vẫn dùng được (iframe cuộn dọc). Trang con
  nhúng chạy chế độ `embedded` của khung (0067, 0070): không thanh trên, không đồng hồ, không
  nộp, không thoát.
- **FR-004:** Không có nút nộp tay ở kỳ `sequential`, `live` và `retake`: một phần kết thúc khi
  đồng hồ về 0 hoặc giám thị thu, như hôm nay. Thứ tự `mock-flush` → (thu bài) `flush-ack` →
  `POST` domain → `POST .../sections/{s}/submit` và hợp đồng `mock-flushed` (`unsaved` là số
  hữu hạn ≥ 0; thiếu hoặc sai là lỗi) không đổi. Kỳ `self_paced` xem FR-014.
- **FR-005:** Danh sách phần dựng từ dữ liệu kỳ thi (`configuredMockSections`, sau G09-T31 là
  các phần được giao), không viết cứng bốn phần. Thanh trên có dải phần bằng chữ: phần đã xong
  "✓ Submitted", phần đang làm, phần chưa tới; không bấm được để nhảy phần.
- **FR-006:** Phần Writing dùng trình soạn chế độ test của khung (FR-08-037): hai thẻ Task, bộ
  đếm "Words: 187 · minimum 250" (Task 1: 150, theo `MOCK_WRITING_GUIDANCE`), không nút lưu
  nháp riêng, đồng hồ ở thanh trên, trạng thái lưu "Saving…"/"Saved at HH:MM" (giờ ack của lần
  lưu gần nhất). Nhịp lưu 5 giây/15 giây giữ nguyên. Hết giờ: khoá ô, nộp cả hai task không
  hỏi; "Time is up. Your test has been submitted." kèm số từ từng task chỉ hiện khi nộp được xác
  nhận (FR-007).
- **FR-007:** Trạng thái nộp theo EXAMROOM-0066 FR-034, suy từ `submitSection` hiện có:
  - `confirmed` cần **cả hai**: (1) trạng thái nộp từ máy chủ cho đúng sitting và đúng phần —
    `loadState` thấy `*SubmittedAt` của phần đó (Writing: `writingSubmittedAt`; Reading/Listening:
    `readingSubmittedAt`/`listeningSubmittedAt`, cùng lượt domain ở `submitted`), kể cả khi giám thị
    thu; và (2) bằng chứng câu cuối đã được giữ: lần `mock-flushed` gần nhất báo `unsaved: 0` (hoặc
    Writing `bridge.flush` thành công với đúng chữ trong ô) **trước** mốc nộp đó. `flush-ack` thành
    công chỉ là báo lần lưu cuối cho đợt thu, **không** phải xác nhận đã nộp: chỉ có ACK thì vẫn
    `submitting`/chờ, không hiện "submitted". `isMockSubmitSettled` (đúng cả khi `activeSection`
    đã đổi) không đủ một mình cho `confirmed` ở nhánh mới.
  - `unconfirmed`: lỗi tạm, offline, 401, mất phản hồi. Nhánh mới tự thử lại tối đa 3 lần (theo
    0066 FR-034, nhánh cũ giữ 4), cùng ý định hai bước của `coreOperationRequest`; rồi
    `unconfirmed_manual` với "Try again" (gọi lại `submitSection`).
  - Giám thị bắt đầu thu (`collected_section` bằng phần này) mà `*SubmittedAt` của phần còn
    trống: máy chủ còn chờ lần lưu cuối (`collect_section_after_flush_grace`, tối đa khoảng
    15 giây). Đây **chưa** phải `closed_unconfirmed`: trình ở `submitting`, tiếp tục gửi lần lưu
    cuối và `flush-ack`, lưu lỗi thì thử lại trong cửa sổ đó; không khoá, không nói "submitted".
  - `closed_unconfirmed`: máy chủ đã đóng phần (có `*SubmittedAt` của phần, hoặc sitting không
    còn ở trạng thái làm bài), chỉ thấy cờ thu thì không đủ, mà câu cuối chưa được xác nhận
    theo (2): "This section was
    closed by our server at HH:MM." với HH:MM là mốc `*SubmittedAt` máy chủ trả. Câu "Your answers
    were saved up to HH:MM" chỉ hiện khi máy chủ trả mốc lưu đó; trình **không tự suy** giờ lưu từ
    đồng hồ máy hay từ lần ACK. Không thử lại, không nói "submitted".
  - Máy chủ chưa đóng phần mà domain submit lỗi hoặc xác nhận phần thi chưa tới (dù `flush-ack`
    đã thành công): ở `unconfirmed`/`unconfirmed_manual`, không hiện đã nộp.
  - Điều kiện (2) chỉ áp cho lần nộp mà tab này khởi động hoặc quan sát được. Phần đã nộp trước
    khi mở tab (tải lại trang, mở tab mới) chỉ hiện "✓ Submitted" trên dải phần (FR-005) theo
    `*SubmittedAt` của máy chủ; không hiện màn trạng thái nộp và không thành `closed_unconfirmed`
    chỉ vì tab mới không có bằng chứng flush.
  - 403/404: giữ thông điệp hiện có ("Contact your invigilator."), không thêm thử lại.
- **FR-008:** Lối thoát (FR-08-011): "Leave test" mở hộp "Leave this test?" với "Stay in test"
  (chính) và "Leave test", câu "Your answers so far are saved. The timer keeps running while
  you are away." **Không có "Abandon test"** (kỳ thi được giao). Trước khi rời: flush phần đang
  làm (Writing qua `writingBridge.flush`, Reading/Listening qua `mock-flush`); còn câu chưa lưu
  thì hộp nêu số câu và không cho thoát âm thầm. Rời về `/home` (đích hiện có của
  `SubmittedCard`); quay lại trong giờ thì `loadState` vào đúng phần với thời gian còn lại theo
  máy chủ.
- **FR-009:** Thu bài của giám thị: trong lúc chờ `flush-ack`, khung khoá thân bài (`inert` như
  hôm nay) và hiện "Saving your final answers…"; không mở hộp nào chặn. Hộp đang mở (ví dụ
  "Leave this test?") khi giám thị thu thì tự đóng rồi chuyển sang "Saving your final answers…";
  lối thoát không tiếp tục điều hướng trong lúc thu.
- **FR-010:** Bản sao Writing theo 0066 FR-035, khoá
  `exam-room:local-copy:mock:{ownerKey}:{sittingId}`, mỗi task có `baseText` (đúng chữ máy chủ
  ack lần cuối, hoặc chữ đọc lúc mở phần) và `baseSavedAt` (chỉ để hiện giờ). Khôi phục so chữ
  máy chủ với `baseText`, không so dấu thời gian (bỏ phép so `submittedAt` với `ts` của máy học
  viên trong nhánh mới; nhánh cũ giữ `chooseWritingDraft`).
  - Trong `answers` của bản sao (lib của 0066 đánh khoá theo `q`), hai task là `q = 'task1'` và
    `q = 'task2'`. So theo chữ là đề xuất sửa đổi 1 mục (c) của 0066 (bên review soạn); tới khi
    mục đó được duyệt, T001 không gửi lại tự động bản trên máy mà hỏi học viên khi chữ khác.
  - Khoá cũ `mock-writing:{sittingId}:{task}` không có mốc: chỉ đọc khi sitting thuộc tài khoản
    đang đăng nhập; bằng chữ máy chủ thì bỏ; khác thì không tự ghi đè, hỏi học viên ("Use the
    text on this device" / "Keep the saved text"); khoá cũ chỉ bị xoá sau khi khoá mới đọc lại
    khớp hoặc máy chủ đã ack (cùng quy tắc với EXAMLISTENP-0069 FR-009).
  - Khi rời (thoát, đăng nhập lại, `pagehide`): ghi ngay, đọc lại và so với ô nhập; chỉ khi
    khớp thì hộp mới nói bản trên máy đã giữ (cùng quy tắc với EXAMWRITE-0068 FR-010).
  - Dọn khi nộp được xác nhận, đăng xuất, tài khoản khác đăng nhập (xoá không đọc), quá 7 ngày.
- **FR-011:** Mất mạng: dải của khung, tiếng Anh, thay `CONNECTION_MESSAGES` ở nhánh mới mà giữ
  nghĩa ("Keep this tab open"); đồng hồ vẫn chạy theo neo máy chủ; lần nộp khi hết giờ được xếp
  hàng như hôm nay (`owedSubmitRef`).
- **FR-012:** Phiên hết hạn: mọi lời gọi `window.api.*` của runner trong nhánh mới truyền
  `{ noRedirect: true }`. 401 giữa bài: bản sao FR-010, hộp đăng nhập lại của khung; trước
  G05-T19, `/login?next=` cùng tab chỉ khi bản sao đọc lại khớp. Quay lại tài khoản khác chủ
  sitting (`ownerRef`): không thấy bản sao, màn lỗi hiện có.
- **FR-013:** Hai tab cùng sitting: khoá ghi theo 0066 FR-017 (`surface='mock'`,
  `attemptKey=sittingId`). Tab chỉ-đọc không lưu Writing, không gửi `flush-ack`, không nộp, và
  không nạp iframe (iframe tự giữ khoá của trang con).
- **FR-014:** Phía học viên của kỳ thi được giao (FR-08-043, G08-T22, sau G09-T31 và cờ
  `mock_exam_audiences_learner`; cờ tắt thì đường `cohort_id`/`mock_exam_assignments` y nguyên).
  Phần này **chỉ được viết code sau khi MOCKORG-0086 được anh Andy duyệt** và G09-T31 lên
  `staging`; `self_paced_timeline` và `mock_exam_audiences` là hợp đồng của 0086, đổi theo 0086:
  - Cổng vào và API kỳ thi của học viên đọc `mock_exam_audiences`; người không trong danh sách
    nhận 404 như kỳ không tồn tại.
  - `live`: phòng chờ, giám thị mở từng phần, như FR-004.
  - `self_paced`: màn vào bài nêu tổng thời lượng và "Once you start, the sections run back to
    back. You cannot pause between sections." kèm dòng phụ tiếng Việt; khoảng mở còn lại ngắn
    hơn tổng thời lượng thì thêm Warning nêu giờ đóng. Đã bắt đầu thì máy chủ ghi mốc phần kế
    ngay khi phần trước được nộp hoặc hết giờ (hàm chung `self_paced_timeline` của
    `services/mock_exam_modes.py`, không viết công thức lần hai); runner chuyển thẳng sang phần
    kế, chỉ có dải "Section submitted. Next: <section>" (và màn đếm ngược cố định khi
    `MOCK_SELF_PACED_GAP_SECONDS` > 0). Không có "Start next section", "Continue later", màn chọn
    phần. Có nút "Submit section" qua hộp nộp của khung (liệt kê câu trống); nộp sớm thì phần kế
    bắt đầu ngay.
  - Mở lại giữa chừng: vào thẳng phần đang chạy; mọi phần đã xong: "Test submitted".
  - Kỳ thiếu kỹ năng: chỉ các phần được giao, không Overall. Làm một lần.
- **FR-015:** Lượt chấm (FR-08-044): kỳ thi được giao không trừ lượt, cả Writing lẫn Speaking
  (GOI-04 5.6, `metered=False, reason='mock'`); không câu về lượt trong hộp nào của runner.
- **FR-016:** Màn ngoài bài thi (phòng chờ, màn vào bài, "Test collected", huỷ, lỗi) dùng thành
  phần của khung, tiếng Anh kèm dòng phụ tiếng Việt (FR-08 điểm 22). Nút "Start Speaking →" mở
  phòng Speaking như hôm nay.
- **FR-017:** Khi cờ bật, runner và trang con không gọi `window.confirm`, `alert` hay `prompt`
  (journey bắt sự kiện `dialog` = 0).
- **FR-018:** Sự kiện `exam_room_*` của khung với `surface='mock'`, không có nội dung câu trả
  lời; báo `integrity` hiện có không đổi.

## Acceptance scenarios

### Scenario 1: hết giờ phần Reading

- **Given** kỳ `sequential`, phần Reading còn 3 giây, trang con còn một câu đang lưu
- **When** đồng hồ về 0
- **Then** runner gửi `mock-flush`, nhận `mock-flushed` với `unsaved: 0`, rồi `POST` domain và
  `POST .../sections/reading/submit` đúng thứ tự; khung hiện `confirmed` sau khi `loadState`
  thấy phần đã nộp.

### Scenario 2: giám thị thu khi mất mạng

- **Given** giám thị thu phần Listening, tab này offline và còn 2 câu chưa lưu
- **When** có mạng lại sau khi máy chủ đã đóng phần
- **Then** "This section was closed by our server at HH:MM." (mốc của máy chủ); không thử lại,
  không "submitted", không tự suy giờ lưu.
- **Given** giám thị vừa bắt đầu thu (`collected_section` có, `listeningSubmittedAt` còn trống),
  tab này có 1 câu chưa lưu và lần lưu cuối đầu tiên lỗi
- **Then** vẫn ở `submitting`, thử lưu lại trong cửa sổ chờ của máy chủ; không hiện
  `closed_unconfirmed` cho tới khi máy chủ có `listeningSubmittedAt`.
- **Given** `flush-ack` thành công nhưng domain submit lỗi, hoặc `*SubmittedAt` của phần chưa tới
- **Then** không hiện đã nộp; ở `unconfirmed` rồi `unconfirmed_manual`.

### Scenario 3: rời giữa phần Writing

- **Given** đang viết Task 2, lần lưu cuối đã ack
- **When** bấm "Leave test" rồi "Leave test"
- **Then** flush, về `/home`; mở lại trong giờ vào đúng Writing với thời gian còn lại theo máy
  chủ; không có "Abandon test".

### Scenario 4: bản sao Writing cũ khác bản đã lưu

- **Given** khoá cũ `mock-writing:{sittingId}:task2` khác chữ máy chủ
- **Then** hỏi học viên chọn; không tự ghi đè; khoá cũ còn tới khi khoá mới đọc lại khớp.

### Scenario 5: kỳ `self_paced`

- **Given** kỳ ba phần, học viên nộp phần 1 ở phút 10
- **Then** phần 2 bắt đầu ngay với đồng hồ theo mốc máy chủ, chỉ có dải "Section submitted.
  Next: Reading"; DOM không có "Continue later" hay "Start next section".

### Scenario 6: cờ tắt

- **Given** `examRoomSurfaces` không có `mock`
- **When** chạy `verify-mock-exam-flow.mjs` và test đọc nguồn hiện có
- **Then** xanh như trước, không request nào đổi.

### Scenario 7: tải lại sau khi đã nộp một phần

- **Given** Listening đã nộp (máy chủ có `listeningSubmittedAt`), đang làm Reading
- **When** tải lại trang
- **Then** dải phần hiện "✓ Submitted" cho Listening, không hiện màn trạng thái nộp và không
  hiện `closed_unconfirmed` cho phần đó; Reading tiếp tục với thời gian còn lại theo máy chủ.

## Edge cases

- `mock-flushed` thiếu `unsaved` hoặc quá 8 giây: lỗi như hôm nay, thử lại flush; không nộp khi
  chưa flush xong.
- Trang con nhúng bị 401: trang con không tự chuyển trang (`noRedirect` theo 0067/0070); runner
  hiện hộp đăng nhập lại một lần cho cả trang.
- `post_test_capture_required`: `MockPostTestCapture` như hôm nay, trước bước nộp thứ hai.
- Kỳ bị huỷ (`void`) giữa chừng: màn "This test has been cancelled…" như hôm nay, bản sao bị xoá.
- Sitting `retake` cũ đang dở khi cờ `mock_exam_audiences_learner` bật: giữ cách cũ tới khi xong
  (MOCKORG-0086).
- Test đọc nguồn (`mock-exam-next-model.test.mjs`, `mock-exam-next-behavior.test.mjs`,
  `core-operation-integration`): giữ chuỗi bị ghim trong file cũ; test vỡ có chủ ý thì sửa cùng
  PR và liệt kê.

## Success criteria

- Khi cờ bật: 0 sự kiện `dialog`; mọi lần rời có hộp hỏi; không màn nào nói "submitted" khi máy
  chủ chưa xác nhận.
- Khi cờ tắt: `verify-mock-exam-flow.mjs` và test mock hiện có xanh không sửa.

## Open questions

Mỗi câu kèm đề xuất; mặc định tạm là đề xuất cho tới khi anh Andy trả lời.

1. **Số lần tự thử lại khi nộp.** Hôm nay 4 lần; 0066 FR-034 (đã duyệt) là tối đa 3 rồi nút thử
   lại. Đề xuất: nhánh mới theo 0066 (3 lần); máy chủ vẫn thu phần đã lưu khi hết giờ nên học
   viên không mất câu đã lưu. Mặc định tạm: 3.
2. **Nộp sớm ở kỳ `self_paced`.** GOI-08 FR-08-043 viết "nộp một phần (hoặc hết giờ)". Đề xuất:
   có "Submit section" qua hộp nộp chỉ ở `self_paced`; `sequential`/`live` giữ không nộp tay
   (giám thị điều khiển). Mặc định tạm: như đề xuất.
3. **Không trừ lượt ở kỳ được giao.** GOI-08 ghi mặc định tạm 18/11, chờ anh xác nhận. Đề xuất:
   không trừ cả Writing lẫn Speaking. Mặc định tạm: không trừ.
4. **Dữ liệu nghiệm thu staging.** Đề xuất: fixture của `verify-mock-exam-flow.mjs` (trong CI)
   và chạy tay `verify-mock-ui-remediation-flow.mjs`; thử tay trên staging chỉ khi admin mở
   được một kỳ cho tài khoản QA (GOI-08 mục 10 câu 6). Mặc định tạm: chỉ fixture; không bật cờ
   production trước một lần nghiệm thu thật.
5. **Đích khi rời.** Đề xuất: `/home` như hôm nay; đổi sang `/tests` khi G07-T16 xong. Mặc định
   tạm: `/home`.
