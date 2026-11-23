---
id: EXAMWRITE-0068
title: Learners write class Writing assignments in the shared practice room, with in-page submit checks, visible saving and draft recovery instead of browser dialogs
status: draft
risk: high
owner: product
---

# Bài Writing được giao chạy trong khung luyện chung, hỏi lại trong trang và không mất nháp

Status: **draft**. Soạn ngày 23/11/2026 theo nhiệm vụ G08-T08 của
`docs/proposals/commercialization-2026-11/GOI-08-phong-thi-va-trinh-luyen.md`
(spec S2; số 0068 theo sổ `01-KE-HOACH-TONG.md` mục 6, đã kiểm còn trống trong
`specs/` và trong các PR đang mở). Chưa dòng mã nào chạy theo spec này. Chỉ anh Andy
duyệt. Khi anh duyệt, câu trả lời được ghi nguyên văn kèm thời điểm vào
`approval-decision.md`, và `status` đổi sang `approved`. Bản thực thi là một PR
`high-risk` frontend (G08-T09), mở sau khi spec đã được duyệt trên `staging`.

Spec cha: [EXAMROOM-0066](../0066-exam-room-shell/spec.md) (khung chung, đã duyệt
23/11). Spec liên quan, không sửa: [WRITINGBAND-0050](../0050-writing-band-save-consistency/spec.md),
[WRITINGDRAFTGUARD-0027](../0027-writing-draft-assignment-delete-guard/spec.md),
[LEARNERDRAFT-0010](../0010-learner-draft-preservation/spec.md) (không áp cho bài Writing).

FR của gói: FR-08-032, 033, 034 cùng các FR khung áp cho Writing bài giao. Bảng đối
chiếu ở `verification.md`. Writing full test thuộc EXAMMOCK-0071 (S5); Writing tự luyện
giữ lượt (G08-T25, FR-08-046) chưa nằm trong spec này, xem câu hỏi mở 1.

## Problem

Đã kiểm `frontend/app/(authed-writing)/writing/dashboard/writing-behavior.tsx` (2.207
dòng, DOM mệnh lệnh gắn vào id của `page-shell.tsx`) trên `staging` @ `cc6dd4c8`
(23/11/2026):

- `submitFromModal` (L1282) hỏi bằng **hai `confirm()` của trình duyệt**: "Bài viết chỉ
  có N từ. IELTS Task 2 yêu cầu tối thiểu 250 từ…" khi dưới **100** từ (con số cứng, và
  câu luôn nói Task 2 kể cả bài Task 1), rồi "Sau khi nộp bạn không thể chỉnh sửa…".
  Hết giờ gọi `submitFromModal(ms, true)` bỏ qua hỏi.
- Bộ đếm từ có `data-word-target` 150/250 (L1505) nhưng không có cảnh báo khi thiếu
  từ lúc nộp theo đúng Task.
- Trạng thái lưu nháp là chữ "Đang lưu…" rồi dấu đã lưu biến mất sau 2 giây; không có
  "Đã lưu lúc HH:MM". Lưu lỗi hiện "Không lưu được bản nháp: …" nhưng không có nút thử
  lại.
- Không có bản sao nháp tại máy. Mất mạng hay phiên hết hạn giữa bài thì phần gõ sau
  lần `PATCH /draft` thành công cuối chỉ còn trong ô nhập; tải lại là mất. Biên nhận
  `WritingSubmitReceipt` (sessionStorage, theo tài khoản và bài) chỉ giữ bài **lúc nộp**.
- Đóng trình soạn (X) không hỏi khi còn chưa lưu và không nói đã lưu tới đâu; đóng xong
  `assignment_id` vẫn ở URL.
- Bài có giờ: đồng hồ trong overlay, mốc 5 phút là toast "⚠️ Còn 5 phút!", hết giờ là
  toast rồi tự nộp; lần đồng bộ đồng hồ 30 giây gọi `api.get` không có `noRedirect`.

## Scope

- Một nhánh giao diện mới cho trình soạn bài giao (overlay `submit-modal` của
  `/writing/dashboard?assignment_id=`), bật bằng `examRoomEnabled('writing')`.
- Chế độ `practice` của khung: tiếng Việt, xưng "bạn".
- Không đổi request nào: `renderer-affinity`, `start`, `PATCH draft`, `GET timer`,
  `paste-log`, `submit` (body `essay_text`, `request_id`), `WritingSubmitReceipt`.

## Non-goals

- Writing full test, Writing trong thi thử (EXAMMOCK-0071).
- Route Writing tự luyện giữ lượt (G08-T25) và hộp nộp có số lượt từ
  `GET /api/me/credits` khi G04 chưa có API đó (FR-012 chỉ hiện khi có số liệu).
- Màn hết giờ có lựa chọn "Send for marking"/"Discard" (FR-08-042): chỉ cho đề tự chọn,
  không cho bài giao.
- Danh sách bài giao, tab bài đã nộp, Thư viện đề, trang kết quả `/writing/result`.
- Kiểm chính tả mềm (`allowSoftCheck`, `runSpellCheck`), tải ảnh, phân loại dán: giữ
  nguyên hành vi, chỉ đổi chỗ hiển thị.
- Trình cũ `frontend/pages/writing-dashboard.html`: không sửa.
- Khoá ghi phía server theo bài (EXAMROOM-0066 câu hỏi mở 10).

## Users and journeys

- Học viên mở bài giao không giờ: trình soạn mở trên trang (overlay như hôm nay), gõ,
  thấy "Đã lưu lúc HH:MM", nộp qua hộp hỏi lại trong trang.
- Học viên mở bài giao có giờ (`timer.is_timed`): trình soạn dùng thanh tập trung của
  khung ở chế độ luyện (tiếng Việt) với đồng hồ "Thời gian còn lại"; hết giờ tự nộp.
- Học viên quay lại bài đang viết trên máy khác hoặc sau khi mất mạng: được hỏi chọn
  bản nháp nào khi bản trên máy mới hơn bản trên server.
- Bài của lớp đã lưu trữ (WRITINGDRAFTGUARD-0027 FR-004): chỉ đọc như hôm nay.

## Requirements

- **FR-001:** `writing-behavior.tsx` rẽ nhánh theo `examRoomEnabled('writing')` ở đúng
  một chỗ khi mở trình soạn. Cờ tắt: không đổi DOM, id, chuỗi, class, request hay thứ tự
  gọi API so với hôm nay. Cờ bật: cùng URL, cùng request, cùng thứ tự; chỉ lớp giao diện
  của trình soạn khác.
- **FR-002:** Nhánh mới giữ các id mà test và luồng ghi đang dùng (`submit-modal`,
  `modal-essay-textarea`, `modal-btn-submit`, `modal-btn-save`, `modal-timer-display`);
  hộp mới có thuộc tính `data-exam-room-*` riêng (ví dụ
  `data-exam-room-submit-confirm`). Luồng `frontend/tooling/write-flows/writing-submit.mjs`
  thêm bước `clickIfPresent: '[data-exam-room-submit-confirm]'` để chạy được cả hai
  nhánh; danh sách `writes` của luồng giống hệt ở hai nhánh.
- **FR-003:** Bài không giờ: trình soạn vẫn là lớp phủ trên trang bảng điều khiển, không
  dùng thanh tập trung kiểu thi; dùng các thành phần của khung cho trạng thái lưu, dải
  mất mạng, hộp nộp, hộp đóng và hộp đăng nhập lại. Bài có giờ (`timer.is_timed` và
  `time_limit_minutes`): dùng `ExamRoomShell` `mode='practice'` với thanh tập trung,
  tiêu đề là tên bài giao, đồng hồ theo EXAMROOM-0066 FR-018 với chữ tiếng Việt
  ("Thời gian còn lại", "Còn 5 phút"). Không in email hay tên học viên trên thanh.
- **FR-004:** Bộ đếm "182 từ · cần ít nhất 250" (Task 1: 150) cập nhật khi gõ, dùng
  `countWords` hiện có. Dưới mức tối thiểu của Task thì viền `--mark` và nhãn "Cảnh
  báo"; đủ thì bình thường. Mức lấy từ `task_type` của **đề đang mở trong trình soạn**
  (`task2` → 250, còn lại → 150, như `data-word-target` ở `writing-behavior.tsx` L1505),
  không từ loại của bài giao (`task_2`, `both`), và không dùng con số 100.
- **FR-005:** Nộp tay (không phải hết giờ), theo đúng thứ tự:
  1. Kiểm chính tả mềm như hôm nay khi `allowSoftCheck` (có lỗi thì hiện bảng chính tả và
     dừng).
  2. Thiếu từ theo FR-004: hộp Warning "Nộp chấm khi bài mới có 182 từ?" (nêu mức tối
     thiểu của đúng Task) với "Viết tiếp" (chính) và "Vẫn nộp chấm". "Viết tiếp" đóng hộp,
     tiêu điểm về ô nhập, không gọi `submit`.
  3. Luôn hiện hộp "Nộp chấm bài này?" với câu "Sau khi nộp bạn không sửa được bài." và
     "Nộp chấm" (chính) / "Quay lại". Chỉ nút "Nộp chấm" gọi đường nộp hiện có.
  Không còn `window.confirm`, `alert` hay `prompt` nào trong luồng của nhánh mới (kiểm
  bằng journey bắt sự kiện `dialog`).
- **FR-006:** Hết giờ (đồng hồ về 0, `timer.is_expired` lúc mở, hoặc `PATCH /draft` trả
  **410**; nhánh mới xét mã `status === 410`, không dò chữ "Hết giờ" trong thông điệp như
  code cũ): khoá ô nhập, đưa giá trị cuối cùng đã gõ vào lần nộp, không hỏi lại, nộp
  qua đường hiện có (`submitFromModal(ms, true)`, cùng `request_id` của biên nhận). Trạng
  thái nộp đưa cho khung theo EXAMROOM-0066 FR-034:
  - `confirmed` chỉ khi `WritingSubmitReceipt.normalizeAck` nhận phản hồi nộp khớp bài,
    hoặc `reconcileSubmission` đối chiếu được lần nộp đó.
  - `unconfirmed` khi offline, 401, lỗi tạm hay mất phản hồi; biên nhận giữ nguyên chữ đã
    nộp; tự thử lại tối đa 3 lần (mỗi lần có mạng lại hoặc sau khi đăng nhập lại) với
    cùng `request_id` **và** đúng `essayText` của biên nhận (như hôm nay, `helper.begin`
    trả lại chữ cũ khi biên nhận còn treo), nên một lần thử lại không bao giờ gửi chữ mới
    hơn dưới `request_id` cũ; rồi `unconfirmed_manual` có nút "Thử lại".
  - Máy chủ hôm nay vẫn nhận bài nộp sau giờ (đánh `auto_submitted`), nên Writing bài giao
    không dùng `closed_unconfirmed`; 409 (bài đã đổi trạng thái hoặc đã nộp ở tab khác)
    giữ thông báo hiện có và đồng bộ lại danh sách.
  Không thêm thời gian làm bài; nút nộp tay khoá khi offline nhưng lần nộp tự động vẫn
  được xếp hàng (EXAMROOM-0066 FR-014, FR-019).
- **FR-007:** Trạng thái lưu bằng chữ ở thanh hoặc đầu trình soạn: "Đang lưu…", "Đã lưu
  lúc HH:MM" (giờ của lần `PATCH /draft` được ack gần nhất, giữ nguyên tới lần lưu sau),
  "Chưa lưu được, đang thử lại", và "Thử lưu lại" khi lần lưu tự động thất bại (gọi lại
  đúng `saveDraft`). Nhịp lưu giữ 3 giây ngừng gõ như hôm nay; nút "Lưu nháp" giữ nguyên.
  Mỗi lúc chỉ một `PATCH /draft` đang chạy: lần lưu đến khi còn lần trước thì xếp hàng (chỉ
  giữ một lần chờ) và gửi chữ mới nhất của ô khi lần trước xong. Hôm nay ack chỉ so
  `assignment_id` (`coreOperationRequest`), nên hai lần cùng chạy có thể về sai thứ tự và
  `baseText` (FR-008) thành chữ cũ trong khi máy chủ giữ chữ khác.
- **FR-008:** Bản sao nháp tại máy theo EXAMROOM-0066 FR-035, khoá
  `exam-room:local-copy:writing:{ownerKey}:{assignmentId}` (`ownerKey` là id tài khoản
  của phiên), ghi mỗi lần ô nhập đổi (gộp tối đa 1 lần mỗi giây) và khi có 401. Bản ghi
  giữ chữ, số từ, `savedAt`, `baseText` là đúng `draft_text` mà `PATCH /draft` ack lần cuối
  (hoặc bản server đọc lúc mở bài), và `baseSavedAt` (giờ của lần ack đó, chỉ để hiện
  "HH:MM", không dùng để so). Không so theo `writing_drafts.updated_at`, vì `POST
  .../paste-log` ghi cùng dòng và trigger đổi `updated_at` mà chữ không đổi (mig 042).
  - **Khi rời** (đóng, Esc, chuyển sang đăng nhập lại, `pagehide`): ghi ngay phần đang gộp,
    không chờ hết 1 giây, rồi đọc lại khoá và so chữ (cả độ dài) với ô nhập. Bản sao chỉ
    được coi là "đã giữ" khi đọc lại khớp đúng ô nhập, hoặc khi `PATCH /draft` đã ack đúng
    chữ đó; không thì coi như không có bản sao.
  Xoá khi `PATCH /draft` ack đúng chữ đó, khi nộp được xác nhận,
  khi đăng xuất, khi tài khoản khác đăng nhập (xoá không đọc), và khi quá 7 ngày. Bài
  của tài khoản khác không đọc, không khôi phục, không gửi được.
- **FR-009:** Khôi phục khi mở lại bài, theo thứ tự:
  1. Có biên nhận nộp chưa xác nhận (`WritingSubmitReceipt.read`): giữ hành vi hiện có
     (biên nhận thắng, đối chiếu trước).
  2. Bản sao tại máy khác chữ bản nháp server **và** `draft_text` của server bằng `baseText`
     (chữ trên server chưa đổi kể từ lần máy biết): dùng bản trên máy, không hỏi, và lưu
     lên qua `PATCH /draft` bình thường. Dán chữ (ghi `paste-log`) không làm bước này đổi.
  3. `draft_text` của server khác cả `baseText` lẫn chữ bản sao (viết tiếp ở nơi khác):
     hỏi "Viết tiếp bản nháp còn trên máy này?" kèm số từ và giờ của cả hai bản, với
     "Dùng bản trên máy này" và "Dùng bản đã lưu lúc HH:MM". Không tự ghi đè bên nào;
     chọn bản trên máy thì lưu lên bằng `PATCH /draft`, chọn bản server thì xoá bản sao.
  4. Không có bản sao hoặc trùng chữ: dùng bản nháp server như hôm nay.
  Bài chỉ đọc (lưu trữ) không hỏi và không dùng bản sao.
- **FR-010:** Đóng trình soạn (nút X, Esc): mọi thứ đã lưu (server ack đúng chữ trong ô)
  thì đóng ngay và báo "Đã lưu lúc HH:MM" một lần; còn chưa lưu thì gọi `saveDraft` trước.
  Vẫn chưa lưu được thì hỏi "Bài còn phần chưa lưu", và nút trong hộp tuỳ kết quả kiểm khi
  rời của FR-008:
  - Bản sao đọc lại khớp đúng ô nhập: "Ở lại" (chính) và "Đóng, giữ bản trên máy này",
    kèm câu "Bản trên máy này chỉ mở lại được trên trình duyệt này."
  - Bản sao không ghi được hoặc đọc lại không khớp: **chỉ "Ở lại"**, kèm câu nói rõ phần
    chưa lưu: "Phần viết sau HH:MM chưa được lưu ở đâu cả. Kiểm tra kết nối rồi thử lưu
    lại." (HH:MM là lần ack cuối; chưa có lần ack nào thì "Bài này chưa được lưu ở đâu
    cả.") với nút "Thử lưu lại". Không có nút nào gắn nhãn giữ bản. Đóng xong bỏ `assignment_id` khỏi URL bằng `history.replaceState`, không
  tải lại trang. Bài có giờ: hộp nói thêm "Đồng hồ vẫn chạy khi bạn đóng bài."
- **FR-011:** Mất mạng và phiên hết hạn theo EXAMROOM-0066 FR-014, FR-015: dải mất mạng
  tiếng Việt; khi có mạng lại thì lưu phần còn lại. Mọi lời gọi `window.api.*` của trình
  soạn trong nhánh mới truyền `{ noRedirect: true }`, kể cả lần đồng bộ đồng hồ 30 giây
  (`GET /timer`) và hai lời gọi đi qua `coreOperationRequest` (`PATCH /draft`, `POST
  /submit`: tuỳ chọn là tham số thứ tư của `patchWith`/`postWith`). `api.js` chuyển trang cả
  khi 401 lẫn 403 nếu thiếu tuỳ chọn này, nên FR-012 (403 `no_entitlement`) cũng cần nó. 401 giữa bài: ghi bản sao FR-008 và kiểm khi rời, hiện hộp đăng nhập lại
  của khung. Trước G05-T19, phương án dự phòng `/login?next=<URL hiện tại có
  assignment_id>` cùng tab chỉ được chạy khi bài đã giữ theo FR-008 (bản sao đọc lại khớp
  đúng ô nhập, **hoặc** `PATCH /draft` đã ack đúng chữ trong ô), như EXAMROOM-0066 FR-015
  sửa đổi 2; chưa giữ thì hộp đăng nhập lại ở yên trong trang, nói rõ phần chưa lưu như FR-010, và không
  chuyển trang (học viên có thể chép chữ ra trước); quay lại đúng tài khoản thì khôi phục theo FR-009.
- **FR-012:** Hộp nộp chỉ nói về lượt chấm khi có số liệu từ API của G04; API chưa có
  thì không có câu đó, không hiện `XXX`, không bịa số. Máy chủ trả 402
  `insufficient_credits`: giữ nguyên bài (bản nháp đã lưu, bản sao còn), hiện khối "Hết
  lượt chấm" của G07-T27 (`CreditsEmptyNotice`) theo `credit_source`; khi component đó
  chưa có thì hiện thông báo trong trang "Bạn đã hết lượt chấm. Liên hệ giáo viên để được
  cấp thêm." (`class`) hoặc "Hết lượt chấm. Đăng ký lại để tiếp tục." (`online`). 403
  `no_entitlement`, 503 `credits_unavailable`: hiện thông điệp của máy chủ, bài không mất.
  Hôm nay `submit` của bài giao chưa trả 402; FR này có hiệu lực khi G04 bật.
- **FR-013:** Cùng bài mở ở tab thứ hai: khoá ghi và thông báo theo EXAMROOM-0066 FR-017
  (`surface='writing'`, `attemptKey=assignmentId`); tab chỉ-đọc không gọi `PATCH /draft`,
  `paste-log` hay `submit`. Giới hạn: hai trình duyệt hay hai thiết bị vẫn có thể cùng lưu
  nháp như hôm nay; `submit` đã idempotent theo `request_id` và trả 409 cho lần nộp thứ hai.
- **FR-014:** Chuỗi trong nhánh mới xưng "bạn" và không chứa mã HTTP, tên tham số hay id.
  Các thông báo hiện có của luồng nộp (đối chiếu, 409, bị gắn cờ không chấm, nộp thành
  công "Giảng viên sẽ duyệt và trả bài trong 24–48 tiếng") giữ nội dung, chỉ đổi chỗ hiển
  thị sang `Notice` của G03.
- **FR-015:** Sự kiện `exam_room_*` của khung gửi với `surface='writing'`, thêm
  `exam_room_short_essay_warning` `{task_type, words_bucket}` (nhóm 0–99, 100–149,
  150–249) khi hộp thiếu từ mở. Không gửi chữ bài viết, email hay tên.

## Acceptance scenarios

### Scenario 1: nộp bài thiếu từ

- **Given** cờ bật, bài Task 2 có 182 từ
- **When** bấm "Nộp chấm"
- **Then** hộp "Nộp chấm khi bài mới có 182 từ?" nêu mức 250; **When** bấm "Viết tiếp"
  **Then** không có request `submit`, tiêu điểm ở ô nhập; **When** bấm "Vẫn nộp chấm"
  **Then** hộp "Nộp chấm bài này?"; **When** bấm "Nộp chấm" **Then** đúng một `POST
  /submit` với `essay_text` và `request_id` như hôm nay; 0 sự kiện `dialog`.

### Scenario 2: Task 1 không dùng số 100

- **Given** bài Task 1 có 120 từ
- **When** bấm "Nộp chấm"
- **Then** hộp thiếu từ nêu mức 150 (hôm nay: không cảnh báo vì 120 ≥ 100).

### Scenario 3: mất mạng rồi có lại

- **Given** đang gõ, DevTools offline
- **When** gõ thêm hai câu
- **Then** dải "Mất kết nối mạng. Bài của bạn đã lưu tới HH:MM…", bản sao tại máy có hai
  câu đó; **When** có mạng lại **Then** `PATCH /draft` gửi chữ mới, "Đã lưu lúc HH:MM"
  cập nhật, dải "Đã kết nối lại…" 5 giây.

### Scenario 4: tải lại sau khi mất mạng

- **Given** bản sao tại máy mới hơn, server chưa đổi kể từ `baseSavedAt`
- **When** tải lại trang
- **Then** ô nhập có chữ của bản sao, không hỏi, và được lưu lên.
- **Given** học viên đã dán chữ (ghi `paste-log`, `updated_at` của server đổi) nhưng
  `draft_text` của server vẫn bằng `baseText`
- **Then** không hỏi, dùng chữ của bản sao.
- **Given** cùng lúc đó bài đã được viết tiếp ở máy khác (`draft_text` của server khác cả
  `baseText` lẫn bản sao)
- **When** mở bài
- **Then** hỏi "Viết tiếp bản nháp còn trên máy này?" với số từ và giờ của hai bản; không
  bên nào bị ghi đè trước khi chọn.

### Scenario 5: hết giờ khi đang gõ

- **Given** bài có giờ, còn 2 giây, đang gõ
- **When** đồng hồ về 0
- **Then** ô khoá, lần nộp chứa chữ cuối cùng, không có hộp hỏi; "Bài của bạn đã được lưu
  và nộp." chỉ hiện sau khi phản hồi nộp được xác nhận.
- **Given** đang offline lúc về 0 **Then** trạng thái "Chưa xác nhận được bài đã nộp…",
  biên nhận giữ chữ; có mạng lại thì nộp lại cùng `request_id`.

### Scenario 6: phiên hết hạn

- **Given** `PATCH /draft` trả 401
- **When** học viên gõ tiếp
- **Then** URL không đổi, hộp "Phiên đăng nhập đã hết hạn"; đăng nhập lại đúng tài khoản
  thì bài mở lại với chữ vừa gõ (từ bản sao) và được lưu; tài khoản khác đăng nhập thì
  không thấy bản sao.

### Scenario 7: đóng trình soạn

- **Given** mọi thứ đã lưu
- **When** bấm X
- **Then** trình soạn đóng, "Đã lưu lúc HH:MM", URL không còn `assignment_id`.
- **Given** còn phần chưa lưu và lưu thất bại
- **When** bấm X
- **Then** hộp "Bài còn phần chưa lưu" với "Ở lại" là nút chính.
- **Given** bộ nhớ trình duyệt từ chối ghi và `PATCH /draft` offline hoặc 401
- **When** bấm X hoặc Esc
- **Then** hộp chỉ có "Ở lại" (và "Thử lưu lại"), câu "Phần viết sau HH:MM chưa được lưu ở
  đâu cả."; không có nút giữ bản; học viên ở lại trình soạn; 401 không chuyển sang
  `/login`.
- **Given** vừa gõ phím cuối, chưa hết 1 giây gộp ghi
- **When** bấm X ngay
- **Then** bản sao đọc lại có phím cuối đó trước khi hộp hiện "Đóng, giữ bản trên máy này".

### Scenario 8: cờ tắt

- **Given** `examRoomSurfaces` không có `writing`
- **When** chạy `verify-writing-admission-flow.mjs`, `verify-write-flows.mjs` và các test
  đọc nguồn hiện có
- **Then** tất cả xanh như trước, danh sách `writes` không đổi.

## Edge cases

- Bài lưu trữ chỉ đọc: không bản sao, không khôi phục, không nộp, không đồng hồ (giữ
  hành vi hiện có).
- Biên nhận nộp chưa xác nhận có chữ khác bản sao: biên nhận thắng (FR-009 bước 1); bản
  sao bị xoá khi nộp được xác nhận.
- Dán quá 200 ký tự: chặn và báo trong trình soạn như hôm nay, không dùng `alert`.
- Bộ nhớ trình duyệt không ghi được: không có bản sao; dải mất mạng nói rõ phần sau
  HH:MM có thể mất nếu tải lại; vẫn viết và nộp được; khi rời thì theo FR-010 (chỉ "Ở
  lại"), không bao giờ hứa giữ bản.
- `assignment_id` trên URL không khớp bài nào: giữ hành vi hiện có của danh sách.
- Hai tab không có Web Locks: cảnh báo kiểu BroadcastChannel, không bảo đảm độc quyền
  (EXAMROOM-0066 FR-017).
- Người học đổi tài khoản trong cùng tab: `ms.accountId` đổi thì nhánh mới huỷ mọi hẹn
  giờ lưu như hôm nay; bản sao của tài khoản cũ bị xoá không đọc.

## Success criteria

- Khi cờ `writing` bật: 0 sự kiện `dialog` trong journey nộp bài, và không còn lối nộp
  tay nào bỏ qua hộp "Nộp chấm bài này?".
- Journey mất mạng rồi tải lại (Scenario 4) không mất chữ đã gõ sau lần lưu cuối.
- Khi cờ tắt: danh sách `writes` của `writing-submit.mjs` không đổi; bộ test đọc nguồn
  hiện có xanh.

## Open questions

Mỗi câu kèm đề xuất; mặc định tạm là đề xuất cho tới khi anh Andy trả lời.

1. **Writing tự luyện giữ lượt (G08-T25).** GOI-08 đặt route này trong S2, nhưng nó cần
   `essay_service.reserve_writing_credit` của G04-T08, chưa có trên `staging`. Đề xuất:
   tách thành bản sửa đổi của spec này (hoặc spec riêng) khi G04-T08 đã merge; spec này
   chỉ làm trình soạn bài giao. Mặc định tạm: như đề xuất.
2. **Ngưỡng cảnh báo thiếu từ.** Đề xuất: đúng mức tối thiểu của Task (150/250) như
   FR-08-032, bỏ số 100. Mặc định tạm: như đề xuất.
3. **Bản sao tại máy cho bài không giờ.** Đề xuất: có, giống bài có giờ, vì mất mạng
   cũng làm mất chữ ở bài không giờ. Mặc định tạm: có.
4. **Thời hạn bản sao.** Đề xuất: 7 ngày, hoặc sớm hơn khi nộp được xác nhận. Mặc định
   tạm: 7 ngày.
5. **FR-009 bước 3 khác EXAMROOM-0066 FR-035.** 0066 FR-035 giữ bản máy chủ và bỏ bản trên
   máy, không hỏi, khi giá trị máy chủ khác `baseValue`; spec này hỏi học viên chọn. Đề
   xuất: hỏi, ghi là ngoại lệ có chủ ý cho trình chỉ có một ô chữ dài, vì bỏ âm thầm là mất
   cả một bản bài viết (với Reading/Listening, bỏ một câu mất ít). Mặc định tạm: hỏi, chờ anh
   Andy quyết.
