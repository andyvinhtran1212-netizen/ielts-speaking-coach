---
id: EXAMROOM-0066
title: Learners take every timed test and practice in one exam room that saves visibly, asks before submitting and never loses work to a dropped connection or expired session
status: draft
risk: high
owner: product
---

# Một khung phòng thi chung cho mọi bài thi và bài luyện

Status: **draft**. Soạn ngày 23/11/2026 theo nhiệm vụ G08-T01 của
`docs/proposals/commercialization-2026-11/GOI-08-phong-thi-va-trinh-luyen.md`
(spec S0 của gói; số 0066 lấy từ sổ ở `01-KE-HOACH-TONG.md` mục 6, đã kiểm còn
trống trong `specs/` và trong các PR đang mở). Chưa dòng mã nào chạy theo spec
này. Chỉ anh Andy duyệt. Khi anh duyệt, câu trả lời được ghi nguyên văn kèm thời
điểm vào `approval-decision.md`, và `status` đổi sang `approved`. Bản thực thi là
bốn PR `high-risk` (G08-T02…T05), mở sau khi spec đã được duyệt trên `staging`.

Spec này chỉ định nghĩa **khung và thành phần dùng chung**. Việc lắp khung vào
từng trình (Reading, Writing, Listening luyện, Listening test, Mock, Speaking,
Quick Check/flashcard) thuộc bảy spec riêng EXAMREAD-0067 … EXAMDRILL-0073. Khi
cờ của một trình còn tắt, trình đó chạy y như hôm nay.

Bảng đối chiếu số FR của gói ↔ số FR ở đây nằm trong `verification.md`.

## Problem

Bảy trình làm bài hiện mỗi trình có vòng đời lưu, nộp và thoát riêng, và hành vi
khác nhau ở đúng những chỗ có thể làm học viên mất bài hoặc nộp nhầm. Đã kiểm
trên `staging` @ `cc6dd4c8` (23/11/2026):

- **Nộp mà không hỏi hoặc dùng hộp thoại của trình duyệt.** Listening luyện
  (`programme-form-runner.tsx`, `submit()`) flush rồi nộp ngay kể cả khi còn câu
  trống. Writing bài giao (`writing-behavior.tsx`) dùng hai `confirm()` mặc định,
  với ngưỡng cứng 100 từ thay vì 150/250 theo Task. Reading dùng
  `window.confirm` cho "Start new attempt"; Speaking (`practice.js`) dùng
  `window.confirm` khi rời bài và khi nộp còn bản chưa gửi.
- **Phiên hết hạn đẩy học viên ra giữa bài.** `public/js/api.js` chuyển thẳng
  sang `/login` khi gặp 401 mà lời gọi không có `noRedirect`, nên token hết hạn
  giữa bài làm rời phòng thi và không có đường quay lại.
- **Trạng thái lưu không nói rõ.** Reading chỉ có "Saving" từng câu, Writing chỉ
  "Đang lưu…"; không trình nào nói "đã lưu lúc mấy giờ", nên khi mất mạng học
  viên không biết bài đã lưu tới đâu.
- **Thanh trên in email học viên** (Reading).
- **Không có lối thoát rõ sau khi bắt đầu full test** (Reading), và không trình
  nào nói đồng hồ vẫn chạy khi rời đi.
- **Hai tab cùng ghi một lượt** không bị chặn ở giao diện.
- **Tỉ lệ hai cột, dải câu, cờ xem lại** mỗi trình một kiểu; dải câu của Reading
  có nút "Review" trùng ở từng câu và ở thanh đáy.

## Scope

- Component `ExamRoomShell` và các thành phần con: thanh trên, tách hai cột, dải
  câu, ô câu, hộp nộp, hộp thoát (có "Abandon test" cho đề tự chọn), dải mất mạng,
  hộp phiên hết hạn (đăng nhập lại trong phòng thi), thông báo tab khác, đồng hồ,
  trạng thái tự lưu, màn hết giờ có lựa chọn (Writing/Speaking tự chọn).
- Sáu dạng câu khách quan và các dạng riêng Reading/Listening dùng chung; trình
  phát audio một thành phần; lớp Highlight/Note.
- Bộ chuỗi tiếng Anh (chế độ `test`) và tiếng Việt (chế độ `practice`).
- Cờ bật theo trình `examRoomEnabled(surface)` và ghi đè `?exam_room=on|off`
  chỉ ngoài production.
- Logic thuần trong `frontend/lib/exam-room/` test được bằng đầu vào/đầu ra.

## Non-goals

- Lắp khung vào bất kỳ trình nào (bảy spec 0067–0073).
- Đổi bất kỳ request nào (method, path, body, header, thứ tự), hợp đồng chấm,
  lưu kết quả, khoá renderer (`renderer_affinity` vẫn chỉ `legacy`/`next`), thời
  gian giới hạn, ân hạn 5 phút. Shell không gọi API.
- Tác động backend của "Abandon test", hết giờ với bài dở, chiếm phiên, lượt chấm
  (T22–T25, mỗi việc trong spec high-risk của trình tương ứng). Spec này chỉ định
  nghĩa phần giao diện của các hộp đó.
- Trang kết quả, xem lại, phiếu (G07); hub `/practice`, `/tests` (G07); màn chặn
  điện thoại `ExamEntryGate` (GOI-11 phần D, PHONEGATE-0081): khung chỉ bọc nó.
- Xoá hay sửa trình cũ trong `frontend/pages/*.html`, `frontend/public/js/*.js`.
- Dictation, gist/MCQ/TF clip, sách bài tập Black Eye, Grammar Check-up, `/exam`.
- Lưu Highlight/Note trên server.

## Users and journeys

- Học viên làm full test hoặc mini test (chế độ `test`, tiếng Anh): thấy tên bài,
  đồng hồ, trạng thái lưu; trả lời, đánh dấu xem lại, nhảy câu; nộp qua một hộp
  hỏi lại; rời đi biết đồng hồ vẫn chạy; mất mạng hay hết phiên không mất bài.
- Học viên luyện (chế độ `practice`, tiếng Việt, xưng "bạn"): cùng các thành phần,
  thoát ngay khi mọi thứ đã lưu, chỉ hỏi khi thoát sẽ mất bài.
- Người thực thi các spec 0067–0073: lắp khung bằng props, giữ nguyên hàm lưu/nộp
  của trình.
- Anh Andy: bật/tắt khung theo từng trình, quay lui không mất dữ liệu.

## Requirements

**Khung**

- **FR-001:** `ExamRoomShell` dựng thanh trên: lối thoát bên trái, tên bài ở giữa
  (ví dụ "Reading · Academic Test 1 · Passage 1 of 3"), trạng thái lưu và đồng hồ
  bên phải. Không in email, tên hay mã học viên ở bất kỳ đâu trong phòng thi.
- **FR-002:** Chế độ `test` dùng nền mực và toàn bộ chuỗi tiếng Anh, kể cả lỗi,
  `aria-label` và chữ cho trình đọc màn hình; số câu ghi "Q5"/"Question 5". Chế độ
  `practice` dùng nền giấy và chuỗi tiếng Việt, xưng "bạn". Highlight, Note, Clear
  luôn tiếng Anh. Một màn không trộn hai bộ chuỗi. Phòng thi full test
  (`isFullTest`) đặt `data-theme="light"` bất kể lựa chọn giao diện của người
  dùng; mini test và chế độ luyện theo lựa chọn của người dùng. Màn **ngoài** bài
  thi của full test (chặn điện thoại, lỗi thiết bị) có thêm một dòng phụ tiếng
  Việt `lang="vi"`.
- **FR-003:** Tay nắm giữa hai cột có `role="separator"`,
  `aria-orientation="vertical"`, `aria-valuenow` 30–70, `tabindex="0"`,
  `touch-action: none`; kéo bằng pointer, kẹp 30–70% và mỗi bên không dưới 360px;
  bấm đúp hoặc Enter về 50/50; mũi tên trái/phải đổi 5%; Home/End về 30%/70%;
  khi kéo thì tắt chọn chữ; không có cuộn ngang.
- **FR-004:** Tỉ lệ cột lưu theo lượt (`attemptKey`), còn sau khi đổi Passage và
  tải lại; lượt mới bắt đầu 50/50. Đổi cỡ cửa sổ giữ phần trăm, tự nới về 360px
  khi hẹp, trả tỉ lệ cũ khi rộng ra.
- **FR-005:** Dưới 900px bỏ tay nắm, dùng hai thẻ "Passage"/"Questions"
  (Listening: chỉ cột câu hỏi); mỗi thẻ giữ vị trí cuộn riêng.
- **FR-006:** Dải số câu sinh từ cấu trúc đề (danh sách phần kèm câu đầu, cuối),
  không viết cứng 13·13·14. Phần chứa câu hiện tại bung đủ ô; phần khác là nút
  "Passage 2 · 3/13" (Listening "Part 3 · 0/10"); bấm thì bung phần đó và nhảy tới
  câu đầu tiên chưa trả lời. Phần thu gọn có câu đánh dấu thì có vạch đáy đỏ mận
  và nhãn đọc thêm "N flagged".
- **FR-007:** Ô câu có bốn trạng thái không chỉ dựa vào màu: chưa trả lời, đã trả
  lời, đánh dấu xem lại (đi cùng hai trạng thái trên), hiện tại (viền ngoài 3px,
  `aria-current="true"`). Nhãn đọc dạng "Question 18, answered, flagged for review".
- **FR-008:** Ô câu 32×44px cách 4px ở 1280px; 1024–1279px bỏ chữ "Answered … of
  40" rồi rút ô còn 28px; dưới 1024px thanh đáy gọn (lùi, "Q18 of 40 · Passage 2 ·
  4/13", tới, "Review", "Submit test"), bảng Review trượt từ đáy, 10 ô một hàng,
  ô 44px; 390px bỏ "Passage 2 · 4/13", bảng phủ cả màn, 6 ô một hàng.
- **FR-009:** Mỗi câu có đúng một điều khiển cờ xem lại; bấm đổi trạng thái tại
  chỗ và trên dải câu.
- **FR-010:** Một hộp nộp cho mọi trình, là thành phần của trang, không dùng
  `window.confirm`: tiêu đề là câu hỏi, nút chính lặp đúng động từ. Còn câu trống
  thì là hộp cảnh báo (viền `--mark`, vạch trái dày, biểu tượng tam giác, nhãn
  "Warning"/"Cảnh báo"), liệt kê tối đa 5 số câu trống rồi "và N câu khác", nút
  chính đỏ mận "Submit test"/"Nộp bài", nút phụ "Return to test"/"Quay lại làm
  tiếp". Không còn câu trống thì là hộp thường. Tiêu điểm đầu vào nút an toàn; Esc
  đóng khi không đang nộp. Hộp hiện câu tốn lượt (`costNote`) chỉ khi trình
  truyền vào; không có số liệu thì không hiện câu đó và không bịa số.
- **FR-011:** Lối thoát. Full test không có "Save and exit". Chế độ `test` mở hộp
  "Leave the test?" với nút chính "Continue test", nút phụ "Leave test", và câu
  "Your answers so far are saved. The timer keeps running while you are away.".
  Trước khi rời phải flush hết hàng đợi lưu; còn câu chưa lưu được thì hộp báo rõ
  số câu chưa lưu và không cho thoát âm thầm. Chế độ `practice`: mọi thứ đã lưu
  thì thoát ngay ("Thoát"), chỉ hỏi khi `losesWork()` đúng.
- **FR-012:** Đề tự chọn (trình truyền `exit.abandon`) có thêm nút "Abandon test"
  trong hộp thoát; bấm thì hộp hỏi lại "Abandon this test? Your answers will not be
  marked and this attempt will not appear in your results." với "Keep working"
  (chính) và "Abandon test" (đỏ mận). Mock test được giao không truyền `abandon`
  nên không có nút. Tác động server của việc bỏ bài thuộc spec của trình.
- **FR-013:** Trạng thái tự lưu bằng chữ ở thanh trên: "Saving…"/"Đang lưu…",
  "Saved at 10:42"/"Đã lưu lúc 10:42", "Not saved. Retrying…"/"Chưa lưu được, đang
  thử lại", kèm "Retry"/"Thử lưu lại" khi hết lượt thử tự động. Giờ là lần lưu
  thành công gần nhất theo giờ máy.
- **FR-014:** Mất mạng (sự kiện `offline` hoặc một lần lưu thất bại vì mạng): dải
  trên cùng không che ô làm bài, "Connection lost. Your work was saved up to
  [HH:MM]…" (test) hoặc "Mất kết nối mạng. Bài của bạn đã lưu tới [HH:MM]…" (luyện).
  Nút nộp đổi thành "Waiting for connection"/"Chờ kết nối", bị khoá có lý do bằng
  chữ. Có mạng lại: trình tự lưu phần còn lại, rồi dải "Back online. Your work has
  been saved."/"Đã kết nối lại. Bài của bạn đã được lưu." hiện 5 giây. Đồng hồ vẫn
  chạy.
- **FR-015:** Phiên hết hạn (401 khi đang làm): không chuyển trang; gọi
  `saveLocalCopy()` trước, rồi hiện hộp chặn "Sign in again"/"Đăng nhập lại" nói
  bài đã lưu tới [HH:MM]; đăng nhập lại ngay trong phòng thi bằng component đăng
  nhập của G05-T19 (Google hoặc email + mã 6 số), không rời URL phòng thi; đồng hồ
  vẫn chạy. Mở trang mà phiên đã hết thì chuyển tới đăng nhập như hôm nay. Mọi lời
  gọi `window.api.*` của trình trong phòng thi phải truyền `{ noRedirect: true }`
  (spec của trình kiểm điều này).
- **FR-016:** Phiên bị chiếm: nhận 401 `session_displaced` thì lưu bản sao tại máy
  và hiện màn 8c của G05-T20 (tiếng Anh ở full test); nhận 409
  `session_not_current` khi mở phòng thi ở thiết bị mới thì hiện màn 8a/8b, không
  tạo lượt. Shell chỉ hiển thị qua `onSessionConflict`; nguồn "bài có giờ" cho
  G04 thuộc spec trình.
- **FR-017:** Cùng một lượt ở tab thứ hai: tab mới báo "This test is open in
  another tab"/"Bài này đang mở ở tab khác" với "Use this tab"/"Dùng tab này"; bấm
  thì tab kia chuyển chỉ-đọc kèm thông báo tương tự. Không có hai tab cùng ghi một
  lượt. Trình duyệt không có `BroadcastChannel` thì bỏ qua tính năng này, không
  chặn làm bài.
- **FR-018:** Đồng hồ chế độ `test`: "Time remaining" + mm:ss số đều cột; mốc 5 phút
  đổi trạng thái có chữ "5 minutes left" và đọc cho trình đọc màn hình đúng một
  lần; về 0 hiện "Time is up" và "Your answers have been saved and submitted."; không
  nhấp nháy. Thời gian còn lại luôn do trình tính từ mốc của server; shell không
  có đồng hồ thứ hai.
- **FR-019:** Hết giờ khi đang gõ: khoá ô nhập ngay khi đồng hồ về 0, đưa giá trị
  cuối cùng đã gõ (kể cả chưa qua debounce) vào lần nộp; không hỏi lại; không mất
  ký tự gõ trước mốc 0.
- **FR-020:** Màn hết giờ có lựa chọn (trình truyền `timeUpChoice`, chỉ Writing và
  Speaking đề tự chọn): "Time is up" với "Send for marking" và "Discard this
  attempt". Shell chỉ hiển thị và gọi hai hàm; điều kiện hiện và tác động lượt chấm
  thuộc spec trình.
- **FR-021:** Tải lại giữa bài trở về đúng lượt, đúng câu trả lời và cờ đã lưu ở
  server, đúng thời gian còn lại từ server, đúng tỉ lệ cột và Passage đang xem;
  không tạo lượt mới.
- **FR-022:** Bật/tắt theo từng trình bằng `examRoomEnabled(surface)`. Cờ tắt:
  trình chạy y như trước, không đổi DOM, id, chuỗi, class hay request. Cờ bật: cùng
  URL, cùng request, cùng thứ tự gọi API; chỉ lớp giao diện khác. Ghi đè
  `?exam_room=on|off` bị bỏ qua khi `environment === 'production'`.
- **FR-023:** Chế độ nhúng (`embedded`, tức `mock_embed=1`) không hiện thanh trên,
  đồng hồ, nút nộp, hộp thoát; trình vẫn trả lời `mock-flush` như hôm nay.
- **FR-024:** Full test (`isFullTest`) bọc `ExamEntryGate` của GOI-11 trước mọi lệnh
  tạo lượt: dưới ngưỡng (mặc định 768px, cấu hình) chỉ có màn chặn, không tạo
  lượt, không chạy đồng hồ. Mini test và luyện không bị chặn và có bản 390px. Chưa
  có `ExamEntryGate` thì shell không chặn và spec trình full test không được bật
  production.

**Dạng câu và công cụ**

- **FR-025:** Sáu dạng khách quan: chọn một; chọn nhiều (luôn ghi phải chọn mấy,
  đếm "Đã chọn 1 trên 2"); True/False/Not Given (cùng kiểu Yes/No/Not Given, Đúng/
  Sai); điền chỗ trống (giới hạn từ ghi trên đề, ô nhập trong câu); nối tiêu đề/
  thông tin (lựa chọn đã dùng gạch ngang, mờ 0.6, chữ ẩn "(used in Q6)"); hoàn
  thành bảng/biểu mẫu/ghi chú (giữ hình dạng, ô nhập trong bảng). Mỗi dạng nhận và
  trả chuỗi đáp án **giống hệt** `user_answer` mà trình hiện gửi lên server; không
  "chuẩn hoá" chung giữa Reading và Listening.
- **FR-026:** Sau khi chấm (chế độ luyện hoặc trang xem lại): mỗi câu có đúng/sai
  bằng chữ, đáp án đúng, một dòng giải thích; ghi "đúng 9 trên 13 câu"; không quy ra
  band khi chưa làm đủ đề 40 câu; không bao giờ hiện "0/0".
- **FR-027:** Dạng riêng: Listening gắn nhãn bản đồ/sơ đồ (lựa chọn đặt cạnh hình),
  Reading trả lời ngắn, hoàn thành tóm tắt, nối đặc điểm (bảng ma trận).
- **FR-028:** Trình phát audio một thành phần, prop `policy`: `practice` có tạm
  dừng, tua 5 giây, tốc độ 0,75–1,5× (nhớ cho bài sau), lặp đoạn A–B; `test` không
  có tạm dừng, tua, tốc độ, A–B, chỉ có âm lượng; bản đầy đủ, thu gọn và điện thoại
  dùng chung một trạng thái. Phím cách phát/tạm dừng chỉ ở `practice` và khi con
  trỏ không ở ô nhập. Audio không tự phát được thì có nút "Play" cần thao tác người
  dùng.
- **FR-029:** `policy='once'` (bài "Vận dụng" chế độ luyện): hỏi lại trước khi phát
  ("Bài này chỉ được nghe một lần · Dài 3:42…"); **giữ nút tạm dừng**, không tua
  lùi, không phát lại; xong ghi "Đã nghe · đã khoá"; mất kết nối giữa chừng thì báo
  phút dừng và cho nghe tiếp từ đó. Lời gọi ghi nhận bắt đầu phát do trình truyền
  qua `onPlaybackStart`.
- **FR-030:** Highlight/Note trên bài đọc: chọn chữ hiện thanh nổi "Highlight ·
  Note · Clear"; ghi chú ở lề (bản hẹp: số nhỏ trong bài, bấm mở); tô và ghi chú còn
  khi tải lại trong cùng lượt (lưu trên máy). Trình duyệt không có CSS Highlight API
  thì dùng `<mark>`.
- **FR-031:** Khi cờ của một trình bật, luồng làm bài của trình đó không gọi
  `window.confirm`/`alert`/`prompt` nào. Kiểm bằng journey trình duyệt bắt sự kiện
  `dialog`, không bằng grep mã nguồn.

**Lưu tại trình duyệt và log**

- **FR-032:** Khoá trình duyệt: `exam-room:split:{attemptKey}` (xoá khi nộp xong hoặc
  quá 7 ngày), `exam-room:marks:{surface}:{attemptKey}` (nộp xong + 30 ngày),
  `exam-room:local-copy:{surface}:{attemptKey}` (xoá khi server xác nhận lưu),
  BroadcastChannel `aver-exam-room`. Mọi đọc/ghi bọc `try/catch`; bộ nhớ không dùng
  được thì khung vẫn chạy, không chặn làm bài. Bản sao tại máy không bao giờ tự ghi
  đè bản trên server.
- **FR-033:** Sự kiện qua `POST /api/analytics/events` hiện có (tên khớp
  `^[a-zA-Z0-9_.:-]+$`, tối đa 64 ký tự, đã kiểm `backend/routers/analytics.py`):
  `exam_room_submit_dialog_opened` `{surface, unanswered}`,
  `exam_room_submit_confirmed`, `exam_room_exit_confirmed` `{unsaved}`,
  `exam_room_offline` `{duration_s}`, `exam_room_session_expired`,
  `exam_room_other_tab`. Không gửi nội dung câu trả lời hay thông tin học viên.

## Acceptance scenarios

### Scenario 1: nộp còn câu trống

- **Given** học viên đã trả lời 37/40 câu trong một lượt dùng khung
- **When** bấm "Submit test"
- **Then** hiện hộp Warning liệt kê "Q7, Q12, Q13", nút chính "Submit test" đỏ mận
  và "Return to test"; **When** bấm "Return to test" **Then** không có lời gọi
  `onSubmit`, tiêu điểm về nút "Submit test".

### Scenario 2: kéo tỉ lệ và tải lại

- **Given** lượt đang ở 50/50
- **When** kéo tay nắm tới 64% rồi tải lại trang
- **Then** trở lại đúng lượt, 64%, cùng Passage; **When** bắt đầu lượt mới **Then** 50/50.

### Scenario 3: hết giờ khi đang gõ

- **Given** còn 2 giây và học viên đang gõ "dozen pie"
- **When** đồng hồ về 0
- **Then** ô khoá, giá trị đưa vào lần nộp chứa "dozen pie", hiện "Time is up";
  không có hộp hỏi.

### Scenario 4: mở hai tab

- **Given** lượt đang mở ở tab A
- **When** mở cùng lượt ở tab B
- **Then** tab B báo "This test is open in another tab." và không ghi; **When** bấm
  "Use this tab" ở B **Then** A chuyển chỉ-đọc, B ghi được.

### Scenario 5: mất mạng lúc nộp

- **Given** trình duyệt offline
- **When** bấm "Submit test"
- **Then** nút ghi "Waiting for connection" và bị khoá, dải "Connection lost…" có giờ
  lưu cuối; **When** có mạng lại **Then** dải "Back online…" 5 giây, nút nộp mở lại,
  không có màn lỗi toàn trang.

### Scenario 6: phiên hết hạn

- **Given** lời gọi lưu trả 401
- **When** học viên gõ câu tiếp
- **Then** không chuyển trang, hiện hộp "Your session has expired"; **When** đăng
  nhập lại **Then** vẫn ở đúng URL phòng thi, câu vừa gõ còn (từ bản sao máy) và
  được lưu.

### Scenario 7: thoát full test

- **Given** đang làm full test tự chọn
- **When** bấm lối thoát
- **Then** hộp có "Continue test", "Leave test", "Abandon test" và câu "The timer
  keeps running while you are away."; không có chữ "Save and exit". **Given** mock
  test được giao **Then** không có "Abandon test".

### Scenario 8: bài nghe

- **Given** `policy='test'` **Then** không có nút tạm dừng, tua, tốc độ.
- **Given** `policy='once'` **When** bấm bắt đầu **Then** có hộp hỏi lại trước; có
  tạm dừng, không tua lùi.

### Scenario 9: cờ tắt

- **Given** `examRoomSurfaces` rỗng
- **When** chạy toàn bộ journey hiện có của bảy trình
- **Then** tất cả xanh như trước, không request nào đổi.

## Edge cases

- Test đọc mã nguồn của trình cũ vỡ khi lắp khung: thuộc spec trình; spec này không
  thêm test kiểu đọc nguồn.
- CSS cũ (`exam-chrome` trên `body`, `reading-exam.css`) đè khung: khung dùng CSS
  module có gốc `[data-exam-room]`, không dựa selector toàn cục, không đổi
  `pageStylesheets` hay `authed-shell.tsx`.
- Nộp hai lần: shell khoá nút trong lúc `onSubmit` chạy; các khoá sẵn có của trình
  giữ nguyên.
- Đồng hồ máy học viên lệch: shell chỉ hiển thị số trình đưa (từ server).
- Ghi đè `?exam_room=on` đi qua `/core-player/launch` bị bỏ: chỉ dùng trên URL trình
  đích; không thêm `exam_room` vào `allowed_query` của `core-player-affinity.mjs`.
- Đổi cờ giữa một lượt: lần tải sau dùng giao diện theo cờ mới; cả hai giao diện là
  renderer `next`, cùng đọc trạng thái server, không mất câu trả lời; tỉ lệ cột và
  ghi chú không bắt buộc chuyển sang giao diện cũ.
- Node test không có `BroadcastChannel`/`localStorage`: hàm nhận đối tượng lưu trữ
  qua tham số.
- `frontend/public/js/runtime-config.js` bị commit đã cấu hình: phải trả về bản chưa
  cấu hình trước khi commit.
- Bài làm hết thời hạn xem (410 `content_expired`): thuộc G07 và spec trình.

## Success criteria

- Khi cờ của một trình bật: 0 sự kiện `dialog` của trình duyệt trong journey làm bài
  của trình đó (FR-031), và không còn lối nộp nào bỏ qua hộp hỏi khi còn câu trống.
- Khi mọi cờ tắt: mọi journey ở GOI-08 mục 9.1 xanh như trước, danh sách `writes` của
  write-flows không đổi.
- Phiên hết hạn giữa bài trong journey Scenario 6 không làm đổi URL và không mất câu
  vừa gõ.

## Open questions

Mỗi câu kèm đề xuất; mặc định tạm là đề xuất cho tới khi anh Andy trả lời (GOI-08
mục 10).

1. **Nguồn cờ bật.** A: `AVER_EXAM_ROOM_SURFACES` → `window.__AVER_RUNTIME_CONFIG__.examRoomSurfaces`
   (không đổi backend; tắt cần redeploy hoặc Instant Rollback). B: trường chỉ-đọc
   `exam_room_surfaces` trong `GET /auth/me` đọc `runtime_flags` (tắt trong khoảng
   15 giây, nhưng đổi API auth và sinh lại kiểu). Đề xuất: B cho production vì phòng
   thi cần tắt nhanh nhất; làm A trước trong G08-T02 (không đổi backend), B là PR
   backend riêng trước khi bật production trình đầu tiên. Mặc định tạm: A.
2. **Tay nắm hai cột.** Đề xuất: kéo 30–70%, dưới 900px chuyển thẻ (cách hiểu trong
   tờ `PhongThi`). Mặc định tạm: như đề xuất.
3. **Nơi lưu Highlight/Note.** Đề xuất: lưu trên máy theo lượt; lưu server làm spec
   sau nếu cần. Mặc định tạm: lưu máy.
4. **Ngưỡng chặn full test.** Đề xuất: 768px, cấu hình (khớp GOI-11 câu 10). Mặc định
   tạm: 768.
5. **"Abandon test" có giới hạn số lần không.** Đề xuất: không giới hạn, làm lại
   ngay. Mặc định tạm: như đề xuất (tác động server thuộc spec trình).
6. **Thứ tự chuyển trình.** Đề xuất: Reading → Writing → Listening luyện → Quick
   Check/flashcard → Listening test (sau G10) → Mock → Speaking. Mặc định tạm: thứ tự
   này.
7. **Màn chặn điện thoại chưa có.** `ExamEntryGate` (PHONEGATE-0081) chưa có trên
   staging. Đề xuất: shell nhận `isFullTest` ngay, nhưng không trình full test nào
   được bật production trước khi PHONEGATE-0081 lên. Mặc định tạm: như đề xuất.
