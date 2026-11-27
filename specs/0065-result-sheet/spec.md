---
id: RESULTSHEET-0065
title: Learners read every Writing, Speaking and mock-test result sheet with the same next steps, honest grading source and band rules, and ask for a Writing regrade by choosing a reason
status: approved
risk: high
owner: product
---

# Learners read every Writing, Speaking and mock-test result sheet with the same next steps, honest grading source and band rules, and ask for a Writing regrade by choosing a reason

Status: **approved**: anh Andy duyệt toàn bộ spec ngày 26/11/2026 lúc 09:03 giờ VN (xem `approval-decision.md`). Spec này soạn ngày 23/11/2026 cho nhiệm vụ `G07-T04` (thương mại hoá 2026-11), dựa trên `docs/proposals/commercialization-2026-11/GOI-07-loi-hoc-vien.md` (bản 18/11): mục 4.6 (FR-07-050…058), 5.6, 5.7, 5.9 (phần T27), các nhiệm vụ G07-T20, T21, T22, T27 và câu hỏi mở #7, #8, #9. Chưa có dòng mã nào chạy theo spec này. Chỉ anh Andy duyệt. Khi anh duyệt, câu trả lời được ghi nguyên văn kèm thời điểm vào `approval-decision.md` cùng thư mục, và `status` đổi sang `approved`. Số 0065 lấy từ sổ cấp số ở `01-KE-HOACH-TONG.md` mục 6 và còn trống ở staging `31725a9b`.

## Problem

Ba phiếu kết quả (Writing, Speaking, thi thử) đang dựng riêng từng trang. Hệ quả:

- Không có chung mục "Làm gì tiếp".
- Không nói rõ ai chấm và chấm theo quyền nào.
- Quy tắc hiện band mỗi nơi một kiểu: có chỗ còn "0/0", "—".
- Overall có thể hiện ở đề tự chọn.

Yêu cầu chấm lại Writing hiện là một ô chữ 50–500 ký tự, xưng "em" ở vài chỗ, nên học viên khó biết phải viết gì. Admin thì phải đọc văn tự do để phân loại. Hai thứ nữa chưa có: khối "Hết lượt chấm" dùng chung và liên kết học cho từng "việc nên sửa".

**Đối chiếu staging `31725a9b`.**
- Đã có:
  - `essay_regrade_requests` (mig 084): `reason` NOT NULL, UNIQUE(`essay_id`), trạng thái `pending/accepted/rejected/fulfilled`.
  - Ràng buộc `essay_regrade_reason_length` 50–500 (mig 085).
  - RPC `fn_list_writing_regrade_requests` trả `to_jsonb(r)` (mig 205, viết lại ở mig 227), nên cột mới tự có trong danh sách admin.
  - Route `POST/GET /api/writing/essays/{essay_id}/regrade-request` (`writing_student.py` ~L2770–2830). Thông điệp 409 đã xưng "Bạn".
  - `band_source` ∈ `ai|teacher|unknown` trên phiếu Writing.
  - `course_products.review_mode` và `entitlements.review_mode` (mig 383).
  - `writing_essays.review_mode` (mig 384, `ai_instant | teacher_review | NULL`), nguồn của FR-051.
  - `mock_exam_service.overall_readiness` với `MOCK_OVERALL_MIN_SKILLS = 4` (G02-T05).
  - `mock_exams.cohort_id` (mig 145, kỳ được giao) và `mock_exam_sittings.assigned_skills` (mig 154).
- Chưa có:
  - Cột đoạn chấm phát âm của G04-T13 (mig 502, mới giữ chỗ).
  - `CreditsEmptyNotice`, `fix-link-model`.

**Đánh số.** `FR-07-050…058` của gói được đổi thành `FR-050…FR-058`, giữ nguyên số. Tham chiếu sang spec khác ghi `<SPEC-ID> FR-0NN`.

## Scope

- Khung phiếu dùng chung: "Làm gì tiếp", "Nguồn chấm", trạng thái chờ giáo viên duyệt. Áp lên phiếu Writing, phiếu Speaking và phiếu thi thử.
- Quy tắc hiện band (gói 5.6) và Overall chỉ ở mock test được giao.
- Yêu cầu chấm lại Writing có 5 lý do và ghi chú. Gồm một migration (số 507 đã giữ chỗ), API nhận hai dạng body, màn học viên và màn admin.
- Khối "Hết lượt chấm" dùng chung (`CreditsEmptyNotice`) và liên kết học cho "việc nên sửa" (`fixLink`).
- Dòng đoạn được chấm phát âm trên phiếu Speaking (khi G04-T13 đã có dữ liệu) và dòng lượt ở lối "làm lại".

## Non-goals

- Không mở chấm lại cho Speaking (câu hỏi mở 2): nút ẩn ở phiếu Speaking.
- Không đổi luồng duyệt chấm lại của admin (accept/reject/fulfil), không đổi cách chấm hay cách tính band.
- Không sửa backend thi thử khi nó còn trả `overall` sai chỗ. Frontend tự ẩn và báo trong PR; việc sửa backend thuộc G02.
- Không gọi AI để sinh liên kết học. Không tạo đơn "thêm lượt" lẻ (GOI-04 Q14).
- Không dựng trang xem lại bài làm (G07-T31, spec khác).
- Không đổi URL phiếu: URL theo LEARNERNAV-0062.

## Users and journeys

- Học viên mở phiếu Writing vừa trả. Họ thấy ai chấm, band, việc nên sửa có liên kết học, rồi ba lối "Xem lại", "Làm lại", "Bài tiếp".
- Học viên lớp nộp Writing. Phiếu hiện 4 bước chờ giáo viên duyệt, không lộ band.
- Học viên không đồng ý với điểm. Họ chọn một lý do (thêm ghi chú nếu chọn "Khác"), gửi, rồi thấy trạng thái yêu cầu.
- Admin xem yêu cầu chấm lại. Admin thấy lý do, ghi chú, và chấp nhận hoặc từ chối như cũ.
- Học viên hết lượt. Họ thấy đúng một khối báo theo nguồn lượt: lớp hay khoá online.

## Requirements

- **FR-050:** Mọi phiếu có mục "Làm gì tiếp" với đúng ba lối:
  - (1) **Xem lại** (chú thích, câu sai).
  - (2) **Làm lại** (đúng bài này).
  - (3) **Bài tiếp**, chọn theo thứ tự: bài giao chưa nộp kế tiếp (`/api/class/my-assignments`), rồi bài tiếp trong lộ trình (`next_lesson` của COURSELESSON-0064), rồi hub của kỹ năng.

  Lối "Làm lại" dùng lượt AI thì ghi dòng lượt theo FR-058. Không có đích cho một lối thì ẩn lối đó, không dẫn về trang chung.
- **FR-051:** Dòng "Nguồn chấm" ghép từ hai trục độc lập:
  - **Đường trả bài** (Writing), lấy từ `writing_essays.review_mode` (mig 384), không lấy từ `band_source`:
    - `ai_instant` → "trả ngay";
    - `teacher_review` hoặc `NULL` (luồng hiện có của lớp và admin, mọi bài đều qua giáo viên trước `delivered`) → "giáo viên duyệt rồi trả".
  - **Người đặt band**, lấy từ `band_source` (`_band_source` ở `writing_student.py`): `ai` là band giống hệt band AI, kể cả khi giáo viên đã duyệt mà không đổi; `teacher` là band giáo viên đã đổi.
  - Ghép lại:
    - `ai` + trả ngay → "AI chấm, trả ngay";
    - `ai` + qua giáo viên → "AI chấm, giáo viên duyệt rồi trả";
    - `teacher` (mọi đường) → "Giáo viên chấm";
    - Speaking thi thử chấm từ bản ghi → "Giáo viên chấm".

  Dòng có kèm nguồn quyền ("khoá online" hoặc "lớp", từ `credit_source` hoặc quyền dùng để chấm). Câu "Đây là điểm ước lượng để luyện tập, không phải điểm thi." chỉ hiện khi band là của AI (`band_source = 'ai'`, hoặc Speaking luyện tập). Speaking luyện tập luôn là "AI chấm, trả ngay", kể cả bài của lớp. `band_source = 'unknown'` thì không hiện dòng.
- **FR-052:** Bài Writing đang chờ giáo viên duyệt (`status != 'delivered'` và `review_mode = 'teacher_review'`, hoặc bài của lớp theo luồng duyệt hiện có) không hiện band, tiêu chí hay nhận xét. Phiếu hiện tiến trình 4 bước: Đã nộp · AI đã chấm · Giáo viên đang duyệt · Trả kết quả, đánh dấu đúng bước hiện tại. Kèm câu "Bạn sẽ nhận thông báo khi có kết quả."

  Bài AI đang chấm (`status` ∈ `pending`, `grading`) cũng không hiện band, tiêu chí hay nhận xét, với mọi `review_mode`. Bước hiện tại là "AI đang chấm" (`teacher_review`/`NULL`: 4 bước như trên; `ai_instant`: 3 bước Đã nộp · AI đang chấm · Trả kết quả), kèm câu "AI đang chấm bài, thường xong trong vài phút." Chấm lỗi thì dùng trạng thái lỗi hiện có của phiếu. Speaking không có trạng thái chờ duyệt.
- **FR-053:** Yêu cầu chấm lại Writing:
  - Học viên chọn một trong 5 lý do theo tờ KetQuaWriting:
    - `score_lower` "Điểm thấp hơn mình nghĩ"
    - `feedback_mismatch` "Nhận xét không khớp bài"
    - `ai_false_flag` "AI bắt lỗi sai"
    - `wrong_submission` "Nộp nhầm bài"
    - `other` "Khác"
  - Ghi chú tối đa 300 ký tự, bắt buộc khi chọn "Khác". Có bộ đếm ký tự.
  - Mỗi bài chỉ gửi một lần. Sau khi gửi, phiếu hiện "Đã gửi yêu cầu chấm lại · <thời gian>", lý do, ghi chú và trạng thái (Đang chờ / Đã nhận / Không chấp nhận kèm phản hồi của admin / Đã chấm lại).
  - Điểm giữ nguyên tới khi có kết quả mới. Không trừ lượt.
  - API nhận **cả hai dạng body**: dạng cũ `{reason}` (50–500 ký tự) cho frontend cũ, và dạng mới `{reason_code, note?}`. Cả hai cùng tồn tại cho tới ngày gỡ dạng cũ ghi trong PR gỡ (câu hỏi mở 1).
  - Màn admin hiện "Lý do: <nhãn> · Ghi chú: <ghi chú>". Bản ghi cũ hiện nguyên văn `reason` như hôm nay.
- **FR-054:** Overall band **chỉ có ở mock test được giao** (kỳ có `cohort_id`, hoặc học viên có trong danh sách dự thi của G09-T31), khi đủ cả bốn kỹ năng và cả bốn đã có band (`overall_readiness`: `banded_skill_count >= overall_min_skills`, với `overall_min_skills = 4`).
  - Kỳ không đủ bốn kỹ năng (`assigned_skills` ít hơn 4): không có dòng Overall.
  - Đủ bốn kỹ năng nhưng còn phần đang chấm: hiện "Chưa có Overall: còn chờ chấm <kỹ năng>", và phần đó hiện "Đang chấm" (component của G08).
  - Full test từng kỹ năng và mini test (đề tự chọn): không bao giờ có Overall, kể cả khi backend trả `overall`.
  - Đề gọi bằng tên, không dùng mã nội bộ.
- **FR-055:** Khối "Hết lượt chấm" dùng chung `CreditsEmptyNotice`, theo tờ GiaHanThemLuot, hiện ở mọi nơi nhận 402 `insufficient_credits` hoặc số dư 0: phiếu kết quả, Hôm nay, `/tests`, màn nộp bài của G08. Nội dung theo `credit_source` (từ 402); `can_renew` đọc từ `GET /api/me/courses`, `ai_credits` từ sản phẩm công khai của khoá; cả hai không có trong 402:
  - `class`: "Liên hệ giáo viên để được cấp thêm", không có nút đăng ký.
  - `online` và `can_renew = true`: nút "Đăng ký lại khoá · kèm N lượt", với N là `ai_credits` của sản phẩm.
  - `online` và `can_renew = false`: "Liên hệ Aver để được cấp thêm lượt" kèm khối liên hệ của G05 (phương án B, câu hỏi mở 3).

  Không có chữ "mua" hay "giá". Bài đang viết hoặc ghi âm được lưu nháp và không trừ lượt.
- **FR-056:** Mỗi dòng "việc nên sửa" trên phiếu Writing và Speaking có một liên kết học khi tìm được đích. Đích là một trong ba: bài Grammar Wiki (mục chữa lỗi), mục từ vựng của Thư viện, hoặc bài trong lộ trình. Liên kết dựng bằng `frontend/lib/fix-link-model.mjs::fixLink(fix, ctx) -> {href, label} | null`, từ bảng dữ liệu `frontend/lib/fix-link-map.json`. Không tìm được đích thì dòng không có liên kết. Slug Grammar trong bảng phải tồn tại; test kiểm với danh sách bài của Wiki.
- **FR-057:** Phiếu Speaking hiện đoạn được chấm phát âm, đọc từ dữ liệu của G04-T13 (COURSEACCESS-0055 mig 502):
  - `scope = 'segment'`: hiện "Phát âm được chấm trên một đoạn trích N giây (từ m:ss đến m:ss); ba tiêu chí còn lại chấm trên toàn bộ bài." và nút "Nghe đoạn được chấm phát âm". Nút phát bản ghi gốc từ `start_s` tới `end_s`, qua URL ký sau khi kiểm quyền (`recording_audio.py`).
  - `scope = 'full'`: hiện "Phát âm được chấm trên toàn bộ câu trả lời."
  - `scope = 'not_sampled'`: hiện câu máy chủ trả, không hiện band phát âm cho câu đó.

  Khi trường này chưa có thì không hiện dòng. Bản ghi đã quá hạn giữ thì vẫn hiện dòng chữ nhưng ẩn nút nghe.
- **FR-058:** Dòng lượt ở lối "Làm lại": "sẽ dùng <k> lượt chấm AI. Bạn còn X lượt, Writing và Speaking dùng chung." Đơn vị theo G04:
  - Writing: 1 bài = 1.
  - Speaking: 1 bài Part 2, hoặc 1 cụm Part 1/Part 3 = 1.
  - Full test Speaking = 3.
  - Full test Writing = 2.

  X lấy từ số dư của G04. Học viên lớp dùng mã cũ không đo lượt thì không hiện dòng. Số dư lỗi thì không hiện dòng và không đoán số.

## Acceptance scenarios

### Chấm lại bằng lý do

- **Given** bài Writing đã trả của học viên QA, chưa có yêu cầu
- **When** chọn "Khác" mà không ghi chú, rồi bấm gửi
- **Then** nút gửi báo lỗi dưới ô ghi chú, không có request nào đi; ghi chú 20 ký tự rồi gửi → 201, phiếu hiện "Đã gửi yêu cầu chấm lại · <giờ>", lý do "Khác", ghi chú

### Dạng cũ vẫn qua

- **Given** frontend cũ gửi `{reason: <60 ký tự>}`
- **When** `POST …/regrade-request`
- **Then** 201 như hôm nay; dòng có `reason_code = null`; admin thấy `reason` nguyên văn

### Lẫn lộn hai dạng

- **Given** body `{reason: "…", reason_code: "other"}`
- **When** gửi
- **Then** 422 `regrade_body_ambiguous`, không ghi gì

### Chờ duyệt không lộ band

- **Given** bài Writing của lớp ở `status = 'graded'` (AI đã chấm, chờ giáo viên)
- **When** mở phiếu
- **Then** không có band, tiêu chí, nhận xét trong DOM; tiến trình ở bước "Giáo viên đang duyệt"

### Overall

- **Given** kỳ thi thử được giao đủ 4 kỹ năng, Writing còn đang chấm
- **When** mở phiếu thi thử
- **Then** "Chưa có Overall: còn chờ chấm Writing"; mini test tự chọn của cùng người không có dòng Overall

### Hết lượt

- **Given** học viên lớp nhận 402 `insufficient_credits` với `credit_source = 'class'`
- **When** bấm "Làm lại"
- **Then** khối "Hết lượt chấm" hiện "Liên hệ giáo viên để được cấp thêm", không có nút đăng ký

## Edge cases

- Hai tab cùng gửi yêu cầu chấm lại: một bên 201, bên kia 409 "Bạn đã gửi yêu cầu chấm lại cho bài này rồi." (UNIQUE `essay_id`). Phiếu tải lại trạng thái từ `GET`.
- Ghi chú có khoảng trắng: cắt hai đầu trước khi đếm. Lý do `other` mà ghi chú chỉ toàn khoảng trắng → 422.
- `reason_code` lạ → 422. `note` dài hơn 300 ký tự → 422 (kiểm ở API và CHECK ở DB).
- Bài chưa `delivered` → 409 như hôm nay. Bài đã xoá mềm → 404.
- Backend trả `overall` cho mini test: frontend ẩn và ghi log `[result] overall_suppressed`.
- `fixLink` gặp mã lỗi không có trong bảng → `null`. Slug Grammar trong bảng bị xoá khỏi Wiki → test CI đỏ trước khi lên.
- Số dư lượt chưa tải xong khi bấm "Làm lại": giữ chỗ dòng lượt, không hiện số 0.

## Success criteria

- 100% phiếu Writing, Speaking, thi thử có đúng ba lối "Làm gì tiếp" (hoặc ít hơn khi không có đích), có test React.
- Không phiếu nào hiện "0/0", "—" đứng một mình hay mã đề nội bộ (test quét chuỗi).
- Mọi yêu cầu chấm lại mới có `reason_code`. Dạng cũ vẫn 201 trong suốt khoảng chuyển tiếp.
- Không bản ghi `essay_regrade_requests` cũ nào vi phạm ràng buộc mới. Truy vấn chỉ đọc trước khi áp: kết quả 0.

## Dependencies

- COURSEACCESS-0055 (G04):
  - 402 `insufficient_credits` mang `credit_source` và số dư (`CreditRefused` của G04-T05). Ngày 23/11, chưa route nào đổi lỗi này thành thân 402; tên trường trong thân chốt ở G04-T08.
  - `can_renew` và `ai_credits` không nằm trong 402: `can_renew` và `product_slug` lấy từ `GET /api/me/courses` (`me_access.py`), `ai_credits` lấy từ trang sản phẩm công khai theo `product_slug` (`courses_public.py`).
  - `writing_essays.review_mode` (mig 384) cho FR-051; `course_products`/`entitlements.review_mode` (mig 383).
  - Đoạn chấm phát âm (G04-T13, mig 502).
  - Chưa có thì khối hoặc dòng tương ứng ẩn.
- COURSELESSON-0064 `next_lesson` cho lối "Bài tiếp". LEARNERCORE-0063 cờ `learner_v2`: cây phiếu mới vẽ khi cờ bật, cây cũ giữ nguyên khi tắt.
- LEARNERNAV-0062: URL phiếu, trang cha.
- G08: component "Đang chấm" từng phần, màn nộp bài dùng `CreditsEmptyNotice`. G09-T31: danh sách dự thi.
- PUBLICSITE-0059 FR-026: khối liên hệ dùng chung.

## Decisions already made

- Gói câu 9 (00 mục 2 điểm 3, 20; G04-T08):
  - Writing khoá online và tự luyện: AI trả ngay.
  - Writing lớp offline: giáo viên duyệt.
  - Speaking: luôn trả ngay.

  G07 hiển thị theo dữ liệu thật (`band_source`, `status`, `review_mode`).
- 00 mục 2 điểm 22: Overall chỉ có ở mock test được giao.

**Khác với gói (ghi khi soạn):**
- (a) Gói ghi "thông điệp 409 đổi Em → Bạn". Staging đã xưng "Bạn" nên không còn việc này.
- (b) RPC danh sách admin trả `to_jsonb(r)`, nên hai cột mới tự có. Không cần viết lại RPC; chỉ sửa màn admin và model.
- (c) Thêm mã lỗi `regrade_body_ambiguous` cho dạng lẫn lộn, thay cho 422 mặc định của FastAPI.
- (d) FR-055…058 nằm trong spec này vì đều là phần của phiếu. Gói chỉ giao T04 FR-050…054; FR-055…058 được thêm sau ngày 18/11.

## Open questions

Cả 4 câu đã chốt theo đề xuất: anh Andy gõ "duyệt … 0065 Q1–Q4 theo đề xuất" lúc 23/11 13:21Z. Cột cuối giữ đúng giá trị người thực thi dùng.

| # | Câu hỏi | Đề xuất | Mặc định tạm |
|---|---|---|---|
| 1 | (gói câu 7) Dùng 5 lý do + ghi chú ≤ 300 ký tự thay ô chữ 50–500 ký tự? Bao giờ gỡ dạng cũ? | Có. Giữ dạng cũ song song tới khi log 14 ngày không còn request dạng cũ, rồi gỡ ở một PR riêng | **Đã chốt 23/11 13:21Z** (anh Andy duyệt theo đề xuất): Hai dạng cùng chạy |
| 2 | (gói câu 8) Chấm lại Speaking làm trong G07 hay sau? | Sau, spec riêng (backend chưa có) | **Đã chốt 23/11 13:21Z** (anh Andy duyệt theo đề xuất): Ẩn nút ở phiếu Speaking |
| 3 | Khối "Hết lượt chấm" khi khoá online còn hạn lâu (`can_renew = false`): phương án B "Liên hệ Aver để được cấp thêm lượt" kèm khối liên hệ | Phương án B tới khi G04 mở bán lượt lẻ (GOI-04 Q14) | **Đã chốt 23/11 13:21Z** (anh Andy duyệt theo đề xuất): Phương án B |
| 4 | Bảng `fix-link-map.json` bắt đầu với bao nhiêu mã lỗi? | Chỉ các mã đã có bài Grammar Wiki chữa đúng lỗi đó; mã khác để trống (không liên kết sai) | **Đã chốt 23/11 13:21Z** (anh Andy duyệt theo đề xuất): Như đề xuất |
