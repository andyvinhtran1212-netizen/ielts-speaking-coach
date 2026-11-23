---
id: EXAMDRILL-0073
title: Quick Check and flashcards run in the shared practice room behind a flag, with rating only after the card is flipped, the flip and rating buttons on the first screen, in-page confirmations and no internal codes
status: approved
risk: high
owner: product
---

# Quick Check và flashcard trong khung luyện chung

Status: **approved** (anh Andy, 23/11/2026 17:57 giờ VN; nguyên văn trong
[`approval-decision.md`](approval-decision.md)). Soạn ngày 23/11/2026 theo nhiệm vụ G08-T20 của
`docs/proposals/commercialization-2026-11/GOI-08-phong-thi-va-trinh-luyen.md` (spec S7; số 0073
theo sổ `01-KE-HOACH-TONG.md` mục 6, đã kiểm còn trống trong `specs/` và trong các PR đang mở).
Chưa dòng mã nào chạy theo spec này. Chỉ anh Andy duyệt. Khi anh duyệt, câu trả lời được ghi
nguyên văn kèm thời điểm vào `approval-decision.md`, và `status` đổi sang `approved`. Bản thực
thi là một PR `high-risk` frontend (phần mã của G08-T20).

Spec cha: [EXAMROOM-0066](../0066-exam-room-shell/spec.md) (đã duyệt 23/11, kèm sửa đổi 1).
Spec liên quan, không sửa: [LEARNERNAV-0062](../0062-learner-navigation/spec.md) (G07-T06 dời
trình học thẻ sang `/vocabulary/flashcards/study`, PR #2512).

FR của gói: FR-08-039 cùng các FR khung áp cho bài luyện (lối thoát FR-08-011 chế độ luyện,
FR-08-040 không có hộp gốc của trình duyệt). Bảng đối chiếu ở `verification.md`.

## Problem

Đã kiểm hai trình trên `staging` @ `cc6dd4c8` (23/11/2026):
`frontend/app/(authed-quiz-player)/quiz/quiz-player.tsx` (629 dòng) và
`frontend/app/(flashcard-study)/flashcard-study/flashcard-study-player.tsx` (561 dòng).

- Flashcard: nút đánh giá bấm được trước khi lật thẻ. Ở thẻ cá nhân là bốn nút SRS "Quên",
  "Khó", "Tốt", "Dễ" (L511–523); ở bộ công khai là hai nút "Cần ôn", "Tự đánh giá nhớ" (L506–509).
  Phím số 1–4 (hoặc 1–2) cũng chấm được khi thẻ chưa lật (L385–390). Học viên có thể chấm một từ
  mà chưa xem nghĩa.
- Flashcard: mặt sau có nhiều khối (nghĩa, ví dụ, collocation, đồng nghĩa, trái nghĩa, mẹo nhớ,
  lỗi hay gặp). Trên khung 390×844 các nút đánh giá bị đẩy xuống dưới, phải cuộn mới thấy.
- Flashcard: dòng nguồn của thẻ cá nhân in thẳng `card.sourceType` khi không có trong
  `SOURCE_LABEL` (L500), tức có thể hiện mã nội bộ.
- Quick Check: thanh trên chỉ có "Đã thuộc X/Y" (L549), không nói đang ở câu thứ mấy.
- Quick Check: "Làm lại từ đầu" hỏi bằng `window.confirm` (L460).
- Quick Check: 401 làm trang tự chuyển sang `/login` (`frontend/lib/quiz-player-api.ts` L22); flashcard cá
  nhân cũng chuyển sang `/login?next=` (L84–89). Phần đang làm dở không được báo trước.
- Kết quả Quick Check ngữ pháp in khoá điểm ngữ pháp bằng `displayItemKey` (chỉ thay `-` bằng
  dấu cách, `frontend/lib/quiz-player-model.mjs` L295), nên hiện dạng mã như "present perfect vs past simple".

## Scope

- Một nhánh giao diện mới cho `/quiz` và cho trình học thẻ (`/flashcard-study`, sau #2512 là
  `/vocabulary/flashcards/study`), bật bằng `examRoomEnabled('drill')`. Nhánh dựng trên
  `ExamRoomShell` của EXAMROOM-0066 ở chế độ `practice`.
- Flashcard: nút chấm chỉ bật sau khi lật; nút lật và nút chấm nằm trong màn hình đầu ở
  1280×800 và 390×844; nhãn nguồn không lộ mã.
- Quick Check: báo "Câu N" và "trên M" khi biết tổng; hộp trong trang thay `window.confirm`;
  kết quả không hiện mã nội bộ.
- Cả hai: lối thoát chế độ luyện ("‹ Thoát"), 401 giữ phần đang làm và hiện hộp đăng nhập lại
  của khung.
- Logic giữ nguyên: engine `public/js/quiz-engine.js`, `QuizProgressOutbox`, `quizPlayerApi`,
  `POST /api/flashcards/{id}/review` (cùng `client_review_id`), đánh dấu bộ công khai trong
  `localStorage` như hôm nay.

## Non-goals

- Đổi số mức đánh giá (bốn mức SRS, hai mức bộ công khai) hay cách tính SRS. Tờ thiết kế vẽ ba
  mức; xem câu hỏi mở 1.
- Các dạng câu khác của tờ `BaiTapTuVungNguPhap` (gõ đáp án, điền từ theo ngữ cảnh, viết lại
  câu, Grammar Check-up). Grammar Check-up là `/grammar-checkup`, không thuộc G08-T20.
- Trang `/vocabulary/flashcards` (danh sách bộ thẻ), `/quiz/progress`, trang Grammar.
- Đổi đường dẫn (LEARNERNAV-0062). Gỡ nhánh cũ (G08-T21).
- Backend: không đổi.

## Users and journeys

- Học viên ôn thẻ cá nhân: mở bộ, lật thẻ, chấm một trong bốn mức, sang thẻ kế, xong bộ.
- Khách mở link chia sẻ bộ công khai (`stack=wiki:…`, `stack=examlist:…`) khi chưa đăng nhập:
  lật, tự đánh dấu, xong bộ.
- Học viên làm Quick Check từ vựng hoặc ngữ pháp: một câu mỗi màn, phản hồi ngay, xem kết quả.
- Học viên trên điện thoại làm cả hai bằng ngón cái, không cần cuộn để chấm.

## Requirements

- **FR-001:** Hai trang rẽ nhánh theo `examRoomEnabled('drill')` ở đúng một chỗ trong mỗi file
  player, sau các hook. Cờ tắt: không đổi DOM, chuỗi, class, request hay thứ tự gọi API. Cờ
  bật: cùng URL, cùng request, cùng thứ tự; chỉ lớp giao diện khác. File vẽ mới đặt cạnh file
  player: `quiz-room.tsx` và `flashcard-study-room.tsx`.
- **FR-002:** Nhánh mới dùng `ExamRoomShell` chế độ `practice` (tiếng Việt, "bạn"), không có
  đồng hồ đếm ngược, không có nút nộp của khung. Thanh trên: "‹ Thoát", tên bài hoặc tên bộ, và
  bộ đếm (FR-005, FR-008). Không in email. `surface='drill'`.
- **FR-003:** Flashcard, nút chấm chỉ bật sau khi lật:
  - Trước lần lật đầu tiên của thẻ đang xem, mọi nút chấm `disabled` kèm dòng "Lật thẻ để chấm
    mức nhớ."; phím số không chấm.
  - Lật (bấm thẻ, nút "Lật thẻ" hoặc phím cách) đặt cờ "đã lật" cho thẻ đó. Lật lại về mặt
    trước không khoá lại nút chấm.
  - Sang thẻ kế thì cờ về lại "chưa lật".
  - Áp cho cả bốn nút SRS và hai nút bộ công khai.
- **FR-004:** Flashcard, màn hình đầu: ở 1280×800 và 390×844 (sau khi lật, mặt sau dài nhất của
  bộ thử), thẻ, nút lật và hàng nút chấm cùng nằm trong khung nhìn, không cần cuộn trang. Mặt
  sau dài thì cuộn **bên trong** thẻ (vùng cuộn có `tabIndex=0` và nhãn), còn hàng nút chấm cố
  định dưới thẻ. Trên điện thoại hàng nút sát mép dưới, mỗi nút cao tối thiểu 44px, có chữ (không
  chấm bằng vuốt).
- **FR-005:** Flashcard, bộ đếm "Thẻ N trên M" dùng `index + 1` và `cards.length` như hôm nay.
- **FR-006:** Flashcard, nhãn nguồn của thẻ cá nhân chỉ lấy từ `SOURCE_LABEL`; giá trị không có
  trong bảng thì hiện "Từ vựng cá nhân", không in `sourceType`. Lỗi lưu đánh giá hiện chữ cho
  người học ("Chưa lưu được đánh giá. Kiểm tra mạng rồi bấm Thử lưu lại."), không in `HTTP 5xx`
  hay thông điệp kỹ thuật; nút "Thử lưu lại" gửi lại đúng `client_review_id` cũ như hôm nay.
- **FR-007:** Flashcard, màn xong bộ: số thẻ theo từng mức bằng chữ (thẻ cá nhân: bốn mức SRS;
  bộ công khai: "Cần ôn", "Tự đánh giá nhớ"), nút "Học lại" và "Chọn bộ khác" như hôm nay. Bộ
  công khai: câu về việc đánh dấu chỉ lưu trên thiết bị này giữ như hôm nay (L427).
- **FR-008:** Quick Check, bộ đếm: "Câu N" là số câu đã hiện trong lượt này (gồm câu lặp lại do
  engine), luôn hiện. "trên M" chỉ hiện khi biết trước tổng số câu của lượt. Engine mastery hôm
  nay không biết tổng (câu sai được lặp lại), nên chỉ hiện "Câu N" cùng "Đã thuộc X/Y" (ngữ pháp:
  "Đã nắm X/Y") như hôm nay. Không ước lượng M.
- **FR-009:** Quick Check giữ một câu mỗi màn và khoá đáp án khi đã chọn, phản hồi ngay ("Đúng."/
  "Sai." kèm đáp án đúng và dòng giải thích khi có), nút "Câu tiếp theo". Không có nút quay lại
  câu trước. Hành vi chấm, `provisional` và lặp câu theo engine như hôm nay.
- **FR-010:** Quick Check, "Làm lại từ đầu" mở hộp trong trang "Xoá tiến độ của bài này?" với
  câu "Toàn bộ tiến độ đã thuộc của bài này sẽ bị xoá và bạn làm lại từ đầu.", nút "Giữ tiến
  độ" (chính, tiêu điểm đầu) và "Xoá và làm lại". Chọn xoá thì gọi đúng đường `reset` hiện có
  và giữ bước đối chiếu `validQuizReset` như hôm nay.
- **FR-011:** Quick Check, kết quả không hiện mã nội bộ: khoá điểm ngữ pháp hiện bằng tên điểm
  (`title` hay `label` từ bank khi có); không có tên thì hiện "Điểm ngữ pháp N" theo thứ tự
  trong bank, không in khoá. Khoá từ vựng là chính từ đó nên giữ. Không in `qid`, `item_key`
  dạng mã, `session_id` hay mã lỗi.
- **FR-012:** Lối thoát (FR-08-011 chế độ luyện), cả hai trang:
  - Bấm "‹ Thoát" thì gọi `exit.flush()` của khung. Quick Check: `outbox.flush(true)`, số câu
    chưa lưu là số lượt trả lời chưa được máy chủ ack. Flashcard: đánh giá đang chờ
    (`pendingRating`) tính là 1 câu chưa lưu.
  - Không còn gì chưa lưu thì thoát ngay về `area.backHref` (Quick Check) hoặc
    `flashcardReturnHref(stack)` (flashcard).
  - Còn câu chưa lưu thì hiện hộp "Còn N câu chưa lưu" với "Ở lại" (chính) và "Vẫn thoát"; không
    thoát âm thầm.
  - Đóng tab: Quick Check giữ `pagehide` gửi `keepalive` như hôm nay.
- **FR-013:** Phiên hết hạn, tách hai trường hợp:
  - Chưa đăng nhập lúc tải trang (lời gọi đầu tiên trả 401 trước khi bài bắt đầu): giữ chuyển
    sang `/login?next=` như hôm nay, ở cả hai nhánh cờ.
  - 401 giữa bài (sau khi lượt Quick Check hoặc bộ thẻ đã tải): trong nhánh mới, `quizPlayerApi`
    và `personalRequest` của flashcard không tự chuyển trang mà hiện hộp đăng nhập lại của khung
    (EXAMROOM-0066 FR-015). Quick Check giữ lượt trên trang và các câu chưa gửi trong outbox;
    flashcard giữ `pendingRating`. Đăng nhập lại đúng tài khoản thì gửi lại; khác tài khoản thì
    bỏ, không gửi.
  - Bộ công khai khi chưa đăng nhập không gọi API có xác thực nên không có ca này.
- **FR-014:** Khi cờ bật, cả hai luồng không gọi `window.confirm`, `alert` hay `prompt` (journey
  bắt sự kiện `dialog` = 0).
- **FR-015:** Bàn phím và trợ năng: phím cách lật thẻ; phím số chỉ chấm sau khi lật (FR-003);
  phím bị bỏ qua khi tiêu điểm ở ô nhập, nút hay liên kết như hôm nay. Trạng thái lật và kết
  quả chấm báo qua `aria-live="polite"`. Giảm chuyển động: lật thẻ không xoay 3D khi
  `prefers-reduced-motion: reduce`.
- **FR-016:** Sự kiện `exam_room_*` của khung với `surface='drill'` và trường `kind`
  (`quiz` hoặc `flashcard`), không có nội dung câu, đáp án hay từ.

## Acceptance scenarios

### Scenario 1: chấm trước khi lật

- **Given** thẻ cá nhân đang ở mặt trước
- **When** bấm "Tốt" hoặc phím 3
- **Then** không có gì xảy ra, không có request `POST /api/flashcards/{id}/review`; dòng "Lật
  thẻ để chấm mức nhớ." hiện cạnh hàng nút.
- **When** lật thẻ rồi bấm "Tốt"
- **Then** gửi đúng một request với `rating: 'good'` và sang thẻ kế ở mặt trước, nút chấm khoá
  lại.

### Scenario 2: điện thoại, mặt sau dài

- **Given** khung 390×844, bộ công khai có thẻ đủ collocation, đồng nghĩa, trái nghĩa, mẹo nhớ
- **When** lật thẻ
- **Then** hai nút "Cần ôn" và "Tự đánh giá nhớ" nhìn thấy mà không cuộn trang; nội dung dài
  cuộn trong thẻ.

### Scenario 3: Quick Check, bộ đếm và làm lại

- **Given** Quick Check từ vựng 10 từ, đã trả lời 4 câu (1 câu sai được lặp lại)
- **Then** thanh trên hiện "Câu 5" và "Đã thuộc 3/10"; không có "trên M".
- **Given** màn đã thuộc hết
- **When** bấm "Làm lại từ đầu"
- **Then** hộp trong trang, "Giữ tiến độ" là nút chính; không có hộp gốc của trình duyệt.

### Scenario 4: thoát khi còn câu chưa lưu

- **Given** Quick Check offline, đã trả lời 2 câu chưa được ack
- **When** bấm "‹ Thoát"
- **Then** hộp "Còn 2 câu chưa lưu"; "Ở lại" giữ trang; có mạng lại thì outbox gửi và thoát
  ngay.

### Scenario 5: 401 giữa bài

- **Given** đang làm Quick Check, phiên đăng nhập hết hạn
- **When** trả lời câu kế
- **Then** không chuyển trang; hộp đăng nhập lại; đăng nhập đúng tài khoản thì câu đó được gửi
  và bài tiếp tục đúng chỗ.
- **Given** chưa đăng nhập, mở thẳng link Quick Check
- **Then** chuyển sang `/login?next=` như hôm nay, không có hộp.

### Scenario 6: kết quả ngữ pháp

- **Given** Quick Check ngữ pháp xong, còn 2 điểm cần ôn
- **Then** mục "Cần ôn lại" hiện tên điểm (hoặc "Điểm ngữ pháp N"), không có chuỗi dạng khoá.

### Scenario 7: cờ tắt

- **Given** `examRoomSurfaces` không có `drill`
- **When** chạy `verify-quiz-flow.mjs`, `verify-grammar-managed-quiz-flow.mjs`,
  `verify-grammar-quiz-history-flow.mjs` và test đọc nguồn của hai trình
- **Then** xanh như trước, không request nào đổi.

## Edge cases

- Link chia sẻ bộ công khai khi chưa đăng nhập: trang vẫn công khai (`authGated={false}`), nhánh
  mới không đòi đăng nhập, không có hộp đăng nhập lại.
- Trình duyệt chặn `localStorage` ở bộ công khai: câu "kết quả chỉ còn trong phiên này" như hôm
  nay; không chặn chấm.
- Bấm nhanh hai lần một nút chấm: chỉ một request (khoá `busy` như hôm nay).
- Hai tab cùng một bộ thẻ cá nhân: mỗi đánh giá có `client_review_id` riêng, máy chủ ghi theo thẻ;
  không dùng khoá ghi của khung (0066 FR-017) cho flashcard. Quick Check: hai tab cùng bank thì
  mỗi tab có `session_id` riêng như hôm nay; không thêm khoá.
- Bank Quick Check bản cũ (`managed && !isCurrent`): các dòng thông báo bản trước, bản đã sửa
  giữ nguyên chữ như hôm nay.
- Test đọc nguồn hai trình (`quiz-player-next-behavior.test.mjs`,
  `flashcard-study-next-behavior.test.mjs`, `quiz-results-ui.test.mjs`…) giữ chuỗi bị ghim ở nhánh
  cũ; test vỡ có chủ ý thì sửa cùng PR và liệt kê; quá 30 test vỡ thì dừng và báo.

## Success criteria

- Khi cờ bật: 0 request chấm thẻ trước khi lật; 0 sự kiện `dialog`; ảnh 1280×800 và 390×844 cho
  thấy nút lật và nút chấm không cần cuộn.
- Khi cờ tắt: ba journey Quick Check và test đọc nguồn xanh như trước.

## Open questions

Mỗi câu kèm đề xuất; mặc định tạm là đề xuất cho tới khi anh Andy trả lời.

1. **Ba mức đánh giá như tờ thiết kế.** Tờ `BaiTapTuVungNguPhap` vẽ ba mức "Nhớ rồi", "Hơi nhớ",
   "Chưa nhớ"; mã hôm nay có bốn mức SRS cho thẻ cá nhân (máy chủ tính lịch ôn theo bốn mức) và
   hai mức cho bộ công khai. Đề xuất: giữ số mức hôm nay, chỉ đổi cách bày; đổi số mức cần đổi
   hợp đồng SRS ở máy chủ, nên làm spec riêng nếu anh muốn. Mặc định tạm: giữ bốn và hai mức.
2. **"trên M" của Quick Check.** Engine mastery không biết trước số câu. Đề xuất: chỉ "Câu N" và
   "Đã thuộc X/Y" (FR-008); không ước lượng. Mặc định tạm: như đề xuất.
3. **Tên điểm ngữ pháp trong kết quả.** Chưa kiểm hết bank ngữ pháp có `title` cho mỗi điểm. Đề
   xuất: PR mã kiểm `GET /api/quiz/banks/{id}` của bank ngữ pháp trên staging; thiếu tên thì
   dùng "Điểm ngữ pháp N" (FR-011), không thêm trường ở máy chủ trong spec này. Mặc định tạm:
   như đề xuất.
4. **Thứ tự bật cờ.** 0066 câu hỏi mở 6 đặt Quick Check/flashcard sớm trong thứ tự chuyển trình.
   Đề xuất: bật `drill` trên staging ngay sau Reading. Mặc định tạm: như đề xuất, mỗi lần bật cần
   anh Andy duyệt.
