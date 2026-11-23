---
id: MOCKORG-0086
title: Admins organise assigned mock exams for classes, single learners and saved groups, run live or self-paced sittings without breaks, and release results from one tab
status: approved
risk: high
owner: product
---

# Admins organise assigned mock exams for classes, single learners and saved groups, run live or self-paced sittings without breaks, and release results from one tab

Status: **approved** — anh Andy duyệt ngày 23/11/2026 (`approval-decision.md`), kèm câu trả lời Q12, Q13, Q14, Q31 ghi dưới bảng Open questions. Soạn ngày 18/11/2026 cho nhiệm vụ `G09-T21` (đợt A, thương mại hoá 2026-11), từ `docs/proposals/commercialization-2026-11/GOI-09-admin-va-giao-vien.md` và `00-QUY-UOC-CHUNG.md` mục 2 (bản trên `staging` sau PR #2331). Chưa dòng mã nào chạy theo spec này; mọi hợp đồng kỹ thuật là đề xuất đã kiểm trên giấy (BAN-GIAO mục 7). Chỉ anh Andy duyệt; khi duyệt, câu trả lời ghi vào `approval-decision.md` cùng thư mục, nguyên văn kèm thời điểm, và `status` đổi sang `approved`. Số spec lấy từ sổ cấp số ở `01-KE-HOACH-TONG.md` mục 6; migration trong dải G09 (440–459).

## Tóm tắt (tiếng Việt)

Phần của GOI-09 tách thành spec riêng ở G09-T21 vì có migration và hành vi riêng cần duyệt riêng. Tóm tắt cả gói ở ADMINIA-0074; phạm vi của spec này là các FR dưới đây.

## Quyết định đã có

22. **Quyết định ngày 18/11/2026 của anh Andy:**
    - Thực hiện: người thực thi (nay là project Claude Code của repo — điểm 23) làm trước; khi anh Andy báo sẵn sàng thì chuẩn bị bàn giao; sau đó có giám sát tiến độ và tiếp quản nếu cần.
    - Vận hành repo: chỉ có anh Andy. "Leader" trong tài liệu migration của repo chính là anh Andy; số spec và số migration lấy theo bảng ở 01-KE-HOACH-TONG mục 6.
    - Đơn vị lượt chấm Speaking: 1 lượt = 1 bài Part 2, hoặc 1 cụm Part 1 gồm 2–3 câu. (Part 3 tính như Part 1 — đã chốt qua ví dụ full test Speaking mô phỏng, xem gạch cuối điểm này.) Writing: 1 bài = 1 lượt.
    - Phòng thi: chế độ thi không có nút tạm dừng bài nghe (luyện từng phần thì có); full test không có "Save and exit", thoát ra đồng hồ vẫn chạy; đề tự chọn có "Abandon test".
    - Mã kích hoạt: lỗi gộp một câu chung, thêm hai câu riêng an toàn ("Bạn đã có khoá này", "Bạn đã dùng mã này rồi"); giới hạn 5 lần thử trong 15 phút.
    - Đề công khai học viên tự chọn: chỉ có full test TỪNG KỸ NĂNG và mini test, làm lúc nào cũng được, làm lại được; không có full test 4 kỹ năng một mạch. Mock test nhiều kỹ năng CHỈ có khi admin/giáo viên giao (live cùng giờ, hoặc tự bắt đầu trong khoảng thời gian được mở, các phần chạy liền nhau, không nghỉ giữa các phần (điểm 23), làm một lần). Overall band chỉ có ở mock test được giao.
    - Bản ghi âm dùng để cải thiện chấm bài: ĐÃ BỎ khỏi đợt này (anh Andy, 18/11/2026: không nhất thiết phải làm, bỏ ra để tránh vấn đề pháp lý). Không có ô hỏi, không có công tắc, không có API. Bản ghi âm chỉ giữ tối đa 60 ngày rồi xoá. Nếu sau này làm lại thì là lựa chọn tự bật và có rà pháp lý trước.
    - Chấm thử bị chặn vì dùng chung IP: có lối đi cho người dùng (màn bị chặn nêu lý do và cách liên hệ/xác minh). Màn ngoài bài thi của full test (chặn điện thoại, lỗi thiết bị): thêm dòng phụ tiếng Việt.
    - Bốn khoản: gỡ hai trang chẩn đoán (`/next-probe`, `/recorder-spike`) khỏi bản chạy thật, `/exam` chuyển hướng về Thi thử; công cụ nội bộ admin dùng khuôn bảng; vẽ ba trang admin ở 1024px; minh hoạ của web là sơ đồ câu chữ, không dùng tranh khắc.
    - Câu trả lời mẫu Speaking: do repo VIDEO MAKING sản xuất (viết kịch bản, giọng đọc Kokoro, dựng video). Web chỉ hiển thị.
    - Nhận xét học viên: đã có sự đồng ý chia sẻ từ lúc thu. Được đăng.
    - Luyện thi THPT: hoãn; thiết kế trước một khuôn để tái dùng.
    - Full test Speaking mô phỏng (chốt 18/11/2026): 3 câu Part 1, 1 bài Part 2, 2 câu Part 3 = 3 lượt chấm (mỗi Part một lượt). Vậy Part 3 tính như Part 1: một cụm 2–3 câu là một lượt.
    - Đề Reading và Listening tự chọn hết giờ thì TỰ NỘP, không hỏi "chấm hay bỏ" (hai kỹ năng này không tốn lượt). Hỏi "chấm phần đã làm hay bỏ" chỉ áp cho Writing và Speaking tự chọn.
    - Full test Writing tốn 2 lượt (mỗi task một lượt): anh Andy đã xác nhận ngày 18/11/2026.
23. **Quyết định ngày 18/11/2026 (đợt chiều) của anh Andy — thắng các điểm trước nếu khác:**
    - Mỗi lớp chỉ có MỘT giáo viên (hiện tại là anh Andy).
    - Lượt chấm chưa dùng: THAY quy tắc "chuyển 50%". Nếu người học đăng ký lại (không huỷ) thì chuyển TOÀN BỘ lượt chưa dùng sang, bảo lưu tối đa 2 tháng. Nếu không đăng ký lại thì khi khoá hết hạn số lượt còn lại hết hiệu lực. (Cách hiểu của người viết: "huỷ gói" = không đăng ký lại; cần anh xác nhận nếu ý khác.)
    - Lớp đang chạy bằng mã cũ: CÓ chuyển sang đo lượt.
    - Mock test "làm trong khoảng thời gian": KHÔNG được nghỉ giữa các phần; đã bắt đầu thì làm liền các phần.
    - Bài làm giữ 45 ngày sau khi khoá hết hạn.
    - Gửi thư: dùng dịch vụ đã có trong repo (Resend, hiện mới dùng cho thư báo chủ dự án: `backend/services/owner_alerts.py`, biến `RESEND_API_KEY`). Còn cần: địa chỉ gửi cho thư học viên (tên miền đã xác minh).
    - Full test Writing tốn 2 lượt (mỗi task một lượt): đã xác nhận.
    - Kiến thức nền theo chủ đề: MỞ CÔNG KHAI (thuộc Thư viện); đoạn viết ngắn nộp cho AI nhận xét tính 1 lượt.
    - Đọc kỹ: gắn theo 20 mô đun của dàn 381 bài; AI nhận xét bản dịch để sau.
    - Nhận xét học viên: hiện cả ở trang sáu khoá online, KHÔNG ghi là của lớp offline; khi nào khoá online có nhận xét riêng thì mới tách.
    - Thực thi: giao cho project Claude Code của repo averlearning.com (không phải đội Grok). Tên thư mục AVER-GROK giữ nguyên.
    - Bốn chỗ đã vẽ mà chưa có dữ liệu ("Lỗi đang lặp lại", "Lần đăng nhập gần đây", "Đổi email đăng nhập", thư "khoá đã mở đăng ký"): THÊM vào gói.
    - Ba prototype (kiến thức nền, đọc kỹ, khuôn luyện đề) và sáu hướng phát triển (sổ lỗi cá nhân, viết lại sau khi chấm, độ lệch AI–giáo viên, kiểm tra đầu vào, nhắc việc và thư tổng kết tuần, gói giáo viên chấm): làm thiết kế và spec.
    - Rà 19 bộ bài mẫu và vẽ hình 3 bộ Task 1: để bên thực thi làm (G06).

## Problem

### 2.5 Kỳ thi

| Thứ cần biết | File/đường dẫn thật | Ghi chú |
|---|---|---|
| Kỳ thi | `mock_exams` (mig 145: `code`, `title`, đề L/R/W, `speaking_topic_set`, `section_minutes`, `open_from/until`, **`cohort_id` một lớp**, `review_sla_days`, `status ∈ draft/published/archived`); `exam_mode ∈ ('sequential','retake')` (mig 154, CHECK `mock_exams_exam_mode_chk`; hàm đổi chế độ mig 169 `fn_set_exam_mode`) | |
| Lượt thi | `mock_exam_sittings` (mig 146: `assigned_skills`, `listening/reading/writing_started_at`, `integrity`, `needs_retest`) | |
| Giao theo người (chỉ retake) | `mock_exam_assignments` (mig 154: `exam_id`, `user_id`, `skills[]`, `open_from`, `open_until`, `assignment_group_id`, `source_exam_id`) | Một dòng mỗi (exam, user). |
| API admin | `routers/admin_mock_exams.py` prefix `/admin/mock-exams`: `POST ""` (357), `PATCH /{id}` (368), `/open` (384), `/advance` (398), `/collect` (424, 202 + quét nền), `/section-progress` (500), `/live` (512), `/sittings` (525), `/retest-summary` (531), `/roster` (539), `/assignments` GET 548 · POST 555 · DELETE 574, `/writing/bulk-grade` (597), `/sittings/{id}/retest` (686), `/bulk-claim` (717), `/bulk-final-bands` (738), `/bulk-release` (765), `/sittings/{id}/retest-flags` (794), `/sittings/{id}/pacing` (822), `/sittings/{id}/void` (859) | Trả kết quả hiện là `bulk-release`. |
| Theo dõi live | `services/mock_exam_service.py` `admin_live_monitor` dòng 4090 | Trả `answered`, `total`, `last_activity_at`, `live`, `stalled`, `integrity`, `in_roster`, `section_time_left_seconds`. Trang poll 5 giây. |
| Roster sau thi | `services/mock_review_workflow.py` (roster có band L/R/W/S, `review_status`, `needs_retest`, `retest_flags`) | |
| Phía học viên | `routers/mock_exams.py` dòng ~205 đọc `exam_mode` (mặc định `sequential`) | G08 phải khớp khi đổi tên chế độ. |
| Trang hiện có | `/admin/mock-tests` (trung tâm, iframe), `/admin/mock-exams`, `/admin/mock-live`, `/admin/mock-pacing`, `/admin/mock-reviews`, `/admin/mock-reviews/report`, `/admin/mock-exams/corrections` | Mở `/admin/mock-reviews` thiếu `mock_exam_id` → lỗi "Thiếu mock_exam_id…" (`admin-mock-reviews.tsx` dòng 119, 140). |

## Scope

Các FR ở mục Requirements, migration và API ở `plan.md`, nhiệm vụ ở `tasks.md`.

## Non-goals

Mọi phần khác của GOI-09 (khung, danh bạ, hồ sơ, đơn, lượt, chấm bài, sự cố, báo cáo) thuộc ADMINIA-0074. Không viết mã trong PR spec. Không lấy số migration ngoài dải G09.

## Users and journeys

- Admin (anh Andy, hiện cũng là giáo viên duy nhất của mỗi lớp): làm việc hằng ngày từ `/admin`.
- Giáo viên của lớp (một lớp đúng một giáo viên, `cohorts.instructor_id`): chỉ thấy lớp mình qua `services/staff_scope.py`.
- Học viên: thấy kết quả do các thao tác admin sinh ra (giao bài, trả kết quả, công bố điểm) ở màn học viên của G07/G08.

## Requirements

Đánh số theo gói (FR-09-NNN → FR-NNN, giữ nguyên số; số không liên tục vì gói chia dải theo nhóm).

**Kỳ thi**
- **FR-140:** `/admin/mock-tests` là danh sách kỳ thi; trạng thái hiển thị: Nháp → Đã lên lịch (live) / Đang mở (tự làm) → Đang diễn ra → Chờ chấm → Đã trả kết quả. Các trang mock cũ chuyển hướng tạm về trang kỳ thi tương ứng.
- **FR-141:** "Tổ chức kỳ thi" ba bước + bước xem lại; lưu nháp ở mọi bước; thanh bước bấm được không theo thứ tự. Bước 1 Đề: chọn kỹ năng, **cần ít nhất một, không bắt buộc đủ bốn**; mỗi kỹ năng một dòng chọn đề (chỉ đề đã đăng; Listening đủ audio). Bước 2 Người thi. Bước 3 Cách thi.
- **FR-142:** Người thi = cộng dồn ba nguồn: nhiều lớp + học viên lẻ + nhóm đã lưu; khử trùng theo học viên; cột Nguồn giữ nguồn đầu tiên; kỹ năng dự thi sửa được từng người; người chưa có tài khoản tự bỏ chọn và ghi lý do.
- **FR-143:** _(chốt 18/11, sửa theo điểm 23)_ Thi thử **chỉ có khi admin/giáo viên giao** (cho lớp, nhiều lớp hoặc nhóm chọn tay); học viên chưa được giao thì không thấy kỳ thi nào. Người giao chọn một trong hai cách thi: `live` ("Phòng thi cùng giờ"; giám thị mở phòng, bắt đầu phần, thu bài) hoặc `self_paced` ("Làm trong khoảng thời gian": người thi tự chọn lúc bắt đầu trong khoảng mở, **làm một lần**). Kỳ `self_paced` **không có nghỉ giữa các phần**: đã bắt đầu thì các phần chạy **liền nhau** theo thứ tự cố định, mỗi phần có đồng hồ riêng nối tiếp phần trước; không có màn chọn phần, không có "làm phần sau vào lúc khác", không quay lại phần đã nộp (hợp đồng ở 5.5). Giao diện không có lựa chọn "nghỉ giữa các phần" hay "số lần làm"; bước Cách thi ghi một dòng cho người tổ chức: "Người thi cần một quãng liền khoảng N phút" (N = tổng thời lượng các phần). Muốn cho làm lại thì dùng thi bù (FR-149). API và giao diện chỉ dùng hai tên mới; dữ liệu cũ `sequential`/`retake` đọc được qua lớp tương thích. Đề công khai học viên tự chọn (full test từng kỹ năng, không có full test bốn kỹ năng một mạch) là chuyện khác, không thuộc G09.
- **FR-144:** "Lên lịch" chỉ bật khi mỗi kỹ năng dự thi có đề đã đăng, có ít nhất một người được chọn, có ngày giờ (live) hoặc khoảng mở (tự làm); nút tắt nói thiếu gì.
- **FR-145:** Trang một kỳ thi: một route, 7 thẻ (`tab=de|thi-sinh|theo-doi|cham|phan-tich|tra-ket-qua|nhat-ky`); thẻ mặc định theo trạng thái (Nháp/Đã lên lịch → Đề; Đang diễn ra → Theo dõi; Chờ chấm → Chấm; Đã trả → Phân tích).
- **FR-146:** Theo dõi (live): bảng thí sinh với số câu n/tổng, hoạt động gần nhất, kết nối, dấu hiệu; thanh điều khiển giám thị (Mở phòng · Bắt đầu phần · "Thu bài và sang phần sau…" luôn hỏi lại; sau khi thu thì "Bắt đầu phần" mới bật); dải cảnh báo ba loại: mất kết nối, đứng yên quá ngưỡng (Cài đặt), chưa vào sau giờ bắt đầu. Mất cập nhật → làm mờ và khoá điều khiển. Cộng giờ cho một người: lý do bắt buộc, ghi Nhật ký.
- **FR-151:** _(mới, điểm 23)_ Theo dõi (tự làm): không có thanh điều khiển giám thị. Bảng người dự thi có đúng **bốn trạng thái**: "Chưa bắt đầu" · "Đang làm" (kèm phần đang làm, giờ còn lại của phần, giờ dự kiến xong cả bài) · "Đã nộp" (đủ mọi phần của người đó) · "Không dự thi" (khoảng mở đã đóng mà chưa bắt đầu). **Không có** trạng thái "nghỉ giữa phần", "đã xong phần 1, chờ làm phần 2" hay nút "mở lại phần". Người đang làm mà mất kết nối vẫn là "Đang làm" kèm dấu "mất kết nối"; đồng hồ không dừng (00 mục 2 điểm 22). Nút "Nhắc" chỉ gửi cho người "Chưa bắt đầu". Cộng giờ ở kỳ tự làm: chỉ cho **phần đang chạy** của một người đang làm (lý do bắt buộc); các phần sau của người đó lùi theo đúng số giây được cộng; không cộng giờ cho phần đã nộp hay người đã nộp xong — trường hợp đó dùng thi bù.
- **FR-147:** Phân tích sau thi: phân bố band từng kỹ năng (chỉ khi đủ số bài tối thiểu theo Cài đặt); 10 câu sai nhiều nhất và tỉ lệ đúng theo dạng câu Listening/Reading; nhịp làm bài cả phòng; so với kỳ trước (ẩn khi không có); Writing trung vị từng tiêu chí. Không tính band tổng trong thẻ này.
- **FR-148:** **Trả kết quả thi thử chỉ ở thẻ "Trả kết quả" của trang kỳ thi.** Mặc định chỉ trả cho người đã chấm xong đủ kỹ năng dự thi của chính họ; lựa chọn thêm: trả phần đã xong cho người còn thiếu. Hộp hỏi lại nêu số thí sinh, phần được trả, link "Xem như thí sinh thấy"; gõ tên kỳ thi để bật nút. Sau khi trả không thu hồi. "Sửa điểm sau khi trả…" bắt buộc lý do, ghi Nhật ký, gửi thông báo cho thí sinh. (Quy tắc do người thiết kế đề xuất — Q14.) Kỳ tự làm: người đã bắt đầu luôn có đủ mọi phần ở trạng thái đã nộp khi giờ cả bài hết (phần bỏ dở tự nộp với phần đã làm), nên không có người "làm dở chờ làm tiếp" chặn việc trả; người "Không dự thi" không tính vào số chờ chấm và không nhận kết quả.
- **FR-149:** Thi bù theo kỹ năng: thẻ Thí sinh có "Đánh dấu cần thi bù" theo kỹ năng và "Cho thi bù…" (giao lượt tự làm cho riêng người đó với kỹ năng và khoảng mở). Lượt thi bù nhiều kỹ năng cũng chạy liền các phần, không nghỉ giữa (FR-143).
- **FR-150:** Huỷ kỳ thi chỉ trước khi mở, trong Vùng nguy hiểm, gõ tên kỳ thi. Đề khoá từ khi phòng mở (live) hoặc khoảng mở bắt đầu (tự làm).

## Acceptance scenarios

Kịch bản của gói (mục 9), giữ số gốc. Môi trường: preview Vercel của nhánh + backend staging, tài khoản QA admin có TOTP.

15. Given admin tổ chức kỳ thi chỉ Listening + Reading với hai lớp + một học viên lẻ + một nhóm đã lưu, cách thi tự làm, When lưu nháp rồi lên lịch, Then danh sách người thi khử trùng, cột Nguồn đúng, kỳ ở trạng thái "Đang mở" khi tới khoảng mở; giao diện không có chữ "sequential"/"retake".
16. Given kỳ thi live kiểm thử đang diễn ra, When giám thị bấm "Thu bài và sang phần sau…", Then có hộp hỏi lại; sau khi thu, "Bắt đầu phần" mới bật; thí sinh đứng yên quá ngưỡng hiện trong dải cảnh báo.
17. Given kỳ thi đã chấm xong 2/3 thí sinh, When mở thẻ Trả kết quả và trả (gõ tên kỳ thi), Then chỉ 2 người nhận kết quả; hàng chờ Writing, hàng chờ Speaking, trang lớp, Việc cần làm đều không có nút trả kết quả thi thử.
22. Given kỳ thi kiểm thử cách thi "Làm trong khoảng thời gian" có Listening + Reading giao cho tài khoản A và B (sau G08-T22), When A bắt đầu và nộp Listening sớm, Then thẻ Theo dõi ghi A "Đang làm" ở Reading với đồng hồ Reading đã chạy, không có trạng thái chờ giữa hai phần và không có điều khiển cho nghỉ; When A đóng trình duyệt tới hết giờ Reading, Then A thành "Đã nộp"; When khoảng mở đóng mà B chưa bắt đầu, Then B là "Không dự thi" và không chặn việc trả kết quả cho A. Bước "Cách thi" lúc tổ chức không có ô "nghỉ giữa các phần".

## Edge cases

Ca biên phải có test tự động: gán giáo viên cho lớp bằng người không phải nhân sự → 422; lớp `instructor_id` NULL → giáo viên nào gọi cũng 404; `self_paced_timeline` không bao giờ trả trạng thái giữa hai phần sau khi đã bắt đầu; cộng giờ cho phần không chạy của kỳ tự làm → 409; `classes_unmetered` khi G04 chưa có → `unavailable`, không phải 0; G04 không trả lượt chuyển → dòng lượt chuyển ẩn; `ref` sai định dạng → 404; q tìm kiếm 1 ký tự → 422; nguồn tổng hợp lỗi → 200 + `sources_failed`; ngưỡng ngoài khoảng → 422; ngưỡng `null` → lý do tương ứng không bật; nhắc lần hai trong ngày → bỏ qua; nhóm sự cố có dòng mới khi xử lý → 409; xác nhận gõ sai chuỗi → nút không bật; step-up hết hạn → dialog rồi gửi lại; kỳ thi không có kỹ năng nào → 422; tên chế độ cũ gửi vào API admin được ánh xạ; ghi lô lỗi không làm hỏng script nhập.

## Success criteria

- Mọi kịch bản ở trên có bằng chứng trên `staging` (đã merge), không chỉ preview nhánh (gói mục 9).
- Admin thấy dữ liệu gốc của backend, kể cả lỗi tra cứu và trạng thái dở dang; không trạng thái lạc quan (constitution mục 5).

## Related specifications

- MOCKOPS-0006 (`admin-mock-test-operations`, implementing): không gian vận hành kỳ thi hiện có; spec này mở rộng nó (người dự thi nhiều nguồn, tên chế độ mới, nháp, 7 thẻ, trả kết quả một chỗ) và giữ lớp tương thích 5.5 cho tên chế độ cũ.
- MOCKATTACH-0008, MOCKREPAIR-0016: tính toàn vẹn lượt làm Reading/Listening của mock; không đổi.
- EXAMMOCK-0071 (G08): phía học viên đọc `mock_exam_audiences`, `live`/`self_paced`, chạy liền các phần, làm một lần; dùng chung `services/mock_exam_modes.py::self_paced_timeline` (phân xử 27 ở `01-KE-HOACH-TONG.md`).
- CALAPPEND-0041: nhật ký kỳ thi chỉ ghi thêm (`mock_exam_events`).
- COURSETESTRELEASE-0082: công bố điểm bài kiểm tra khoá là luồng khác; trả kết quả thi thử chỉ ở thẻ "Trả kết quả" (00 điểm 19).
- COURSEACCESS-0055: mock test được giao không trừ lượt (mặc định tạm 18/11, phân xử 18).

## Open questions

Câu hỏi của gói (mục 10) liên quan; mỗi câu có mặc định tạm người thực thi dùng tới khi anh Andy trả lời.

| # | Câu hỏi | Phương án đề nghị | Mặc định tạm người thực thi dùng |
|---|---|---|---|
| Q12 | Thêm lớp vào kỳ thi: chụp danh sách lúc thêm, hay học viên vào lớp sau tự được dự thi? (người thiết kế giả định chụp) | Chụp; có nút "Cập nhật theo lớp" để thêm người mới | Chụp lúc thêm |
| Q13 | Thi bù theo kỹ năng: gộp kết quả vào kỳ gốc hay giữ kỳ thi bù riêng như hiện nay? | Gộp vào kỳ gốc (phiếu một kỳ) | Giữ cơ chế hiện có (kỳ riêng có `source_exam_id`), hiện liên kết ở thẻ Thí sinh |
| Q14 | Quy tắc trả kết quả thi thử do người thiết kế đề xuất: (a) mặc định chỉ trả người đã chấm đủ kỹ năng của họ; (b) có lựa chọn trả phần đã xong; (c) không thu hồi sau khi trả; (d) gõ tên kỳ thi để xác nhận; (e) sửa điểm sau khi trả bắt buộc lý do và báo thí sinh. Duyệt? | Duyệt cả năm | Dùng (a), (c), (d), (e); (b) sau cờ `mock_partial_release` tắt |
| Q31 | **(mới)** Kỳ tự làm chạy liền các phần — bốn chi tiết: (a) người thi mất mạng hoặc đóng trình duyệt giữa chừng thì đồng hồ có dừng không; (b) giữa hai phần có một khoảng chuyển cố định vài chục giây (đọc hướng dẫn phần kế) như kỳ live không; (c) đã bắt đầu gần cuối khoảng mở thì được làm hết hay bị cắt khi khoảng mở đóng; (d) nộp sớm một phần thì phần kế bắt đầu ngay hay chờ tới đúng giờ | (a) không dừng, như full test (00 điểm 22); (b) không, hoặc tối đa 60 giây cố định không bấm bỏ qua được; (c) làm hết, trang bắt đầu cảnh báo khi khoảng mở còn ngắn hơn tổng thời lượng; (d) bắt đầu ngay | (a) đồng hồ không dừng, phần hết giờ tự nộp; (b) `MOCK_SELF_PACED_GAP_SECONDS=0`; (c) làm hết; (d) bắt đầu ngay. Cùng mặc định với G08-T22 |

**Đã trả lời 23/11/2026** (anh Andy, `approval-decision.md`): Q12 chụp danh sách lúc thêm, có nút "Cập nhật theo lớp"; Q13 **giữ kỳ thi bù riêng** (kỳ có `source_exam_id`, liên kết ở thẻ Thí sinh), không gộp vào kỳ gốc trong đợt này; Q14 duyệt (a)–(e), trong đó (b) đi sau cờ `mock_partial_release` tắt; Q31 theo mặc định: (a) đồng hồ không dừng, phần hết giờ tự nộp, (b) `MOCK_SELF_PACED_GAP_SECONDS=0`, (c) đã bắt đầu thì làm hết, (d) nộp sớm thì phần kế bắt đầu ngay.
