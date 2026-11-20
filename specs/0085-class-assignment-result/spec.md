---
id: CLASSRESULT-0085
title: Teachers open one result page per class assignment with five blocks from one aggregate API, and give work to saved learner groups through one shared component
status: draft
risk: high
owner: product
---

# Teachers open one result page per class assignment with five blocks from one aggregate API, and give work to saved learner groups through one shared component

Status: **draft** — soạn ngày 18/11/2026 cho nhiệm vụ `G09-T21` (đợt A, thương mại hoá 2026-11), từ `docs/proposals/commercialization-2026-11/GOI-09-admin-va-giao-vien.md` và `00-QUY-UOC-CHUNG.md` mục 2 (bản trên `staging` sau PR #2331). Chưa dòng mã nào chạy theo spec này; mọi hợp đồng kỹ thuật là đề xuất đã kiểm trên giấy (BAN-GIAO mục 7). Chỉ anh Andy duyệt; khi duyệt, câu trả lời ghi vào `approval-decision.md` cùng thư mục, nguyên văn kèm thời điểm, và `status` đổi sang `approved`. Số spec lấy từ sổ cấp số ở `01-KE-HOACH-TONG.md` mục 6; migration trong dải G09 (440–459).

## Tóm tắt (tiếng Việt)

Phần của GOI-09 tách thành spec riêng ở G09-T21 vì có migration và hành vi riêng cần duyệt riêng. Tóm tắt cả gói ở ADMINIA-0074; phạm vi của spec này là các FR dưới đây.

## Quyết định đã có

19. **Admin (17/11/2026):** các tờ admin dùng một sidebar, một bảng ngưỡng cảnh báo (Cài đặt), một thành phần giao bài, một bộ dữ liệu mẫu — bản chuẩn ở `thiet-ke/CHUAN-ADMIN.md`. Trang nhập nội dung thủ công bị ẩn khỏi sidebar; nội dung nhập qua script backend. Trả kết quả thi thử chỉ ở thẻ "Trả kết quả" của trang kỳ thi.
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

### 2.3 Kết quả bài giao (ba tab, ba API hiện có)

| Thứ cần biết | File/đường dẫn thật | Ghi chú |
|---|---|---|
| Giao diện | `app/(authed-admin-classes)/admin/classes/[cohortId]/admin-class-homework.tsx` → `admin-class-submissions.tsx` (ba tab); model `lib/admin-class-submissions-model.mjs` | Ba bộ trạng thái: `status` 5 giá trị, `course_state` 8, `state` 6. |
| API "Tổng kết" | `GET /admin/cohorts/{c}/assignments/{a}/tally` (`admin_class_assignments.py` dòng 1648, `_hand_in_status` dòng 1541) | `status`: no-account / missing / pending / late / submitted. GOI-11 phần E mở rộng API này (5.5.8). |
| API "Tiến độ lớp" | `GET /admin/quiz/banks/{bank}/attempt-report?assignment_id=` (`routers/admin_quiz.py` dòng 194 → `services/quiz_service.py` `course_attempt_report` dòng 6382) | Khối `axes` gom theo `item_key` (trục) và cắt `axes[:15]` (dòng 6792). |
| API "Inspect học viên" | `GET /admin/quiz/banks/{bank}/students/{user}/report?assignment_id=` (`admin_quiz.py` dòng 211 → `course_answer_report` dòng 6041) | Từng câu của một học viên. **Giữ** để mở "bài làm từng câu". |
| Dữ liệu từng câu | `quiz_attempts` (mig 119: `item_key`, `skill`, `subtype`, `answer_given`, `response_time_ms`, `attempt_no`); `quiz_questions.why_wrong` (mig 186); `quiz_sessions` (`kind` run/retake mig 189, `accuracy`, `duration_sec`, `class_assignment_item_id` mig 188) | Importer `scripts/import_course_exercise_bank.py`: `dang`→`subtype`, `truc`→`item_key`, `truc_nhom`→`skill`, `bay`→`why_wrong`. Nhóm ngữ pháp = `skill` (6–11 nhóm mỗi buổi). |
| Báo cáo theo buổi cho đề giữa/cuối kỳ | spec `specs/0043-course-assessment-lesson-report` (đã duyệt, chưa có mã) | `lesson_primary` chưa được importer lưu. |
| Gửi nhắc | Không có API nhắc trong `admin_class_assignments.py`, `cohorts.py`, `instructor.py` | Dùng kênh thông báo của GOI-11 phần A. |

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

**Lớp, giao bài, kết quả bài giao, bài kiểm tra khoá**
- **FR-120:** Trang lớp có thẻ trên URL (`tab=tong-quan|hoc-vien|buoi-hoc|bai-nop|kiem-tra|nhat-ky`). Thẻ Học viên mặc định là bảng học viên × bài.
- **FR-121:** **Một** thành phần giao bài (ngăn kéo phải ~480px) mở từ: thẻ Buổi học / Bài nộp của lớp, Việc cần làm, khu giáo viên, hồ sơ học viên (chọn sẵn người đó), trang một đề ở Nội dung ("Giao bài này…"). Trường theo thứ tự: Lớp · Buổi (mặc định buổi kế tiếp chưa có bài) · Bài · Giao cho (Cả lớp / Chọn tay / Nhóm đã lưu, có "Lưu nhóm này…") · Hạn nộp (mặc định 23:59 ngày học của buổi) · Chế độ trả điểm (chỉ khi bài là bài kiểm tra; lớp offline mặc định "Giáo viên công bố") · dòng xem lại + "Giao bài".
- **FR-122:** Không tạo bản giao thứ hai cho cùng (lớp, bài): hiện cảnh báo với hai lựa chọn giữ hạn cũ hoặc dời hạn lần giao cũ. Nút Giao đếm đúng số bài tạo mới.
- **FR-123:** Hai sổ giao bài ở Nội dung (Writing "Gán bài tập", ngữ pháp "assign") bị bỏ khỏi giao diện.
- **FR-124:** Gửi nhắc: chỉ người chưa nộp và đã qua hạn (không tính người chưa có tài khoản); mỗi bài mỗi người tối đa một lần một ngày; gửi xong dòng ghi "Đã nhắc HH:MM".
- **FR-125:** Trang "Kết quả một bài giao" là một trang cuộn 5 khối: (1) Ai đã nộp; (2) Lớp làm thế nào; (3) Lớp vướng ở đâu; (4) Ai cần chú ý; (5) Nên chữa ở buổi tới. Thay ba tab cũ.
- **FR-126:** Cả trang dùng **một bộ 5 trạng thái**: Đã nộp đúng hạn · Nộp trễ · Đang làm · Chưa mở · Chưa có tài khoản.
- **FR-127:** Khối 3 gom theo **nhóm ngữ pháp** (`quiz_questions.skill` = `truc_nhom`), hiện đủ mọi nhóm, không cắt top 15, không gom theo `item_key`; có nút đổi cách gom sang dạng câu (`subtype`); tính lượt đầu; câu tự luận E1–E3 loại khỏi bảng. Mở một nhóm: ba câu sai nhiều nhất, mỗi câu có đề, đáp án đúng, phương án sai được chọn nhiều nhất kèm số người và lời giải thích (`why_wrong`). Giao diện không hiện mã ngộ nhận.
- **FR-128:** Khối 2 chỉ tính người đã nộp (người chưa nộp không bị tính 0); ngưỡng đạt lấy từ `pass_pct` của bài; không có bài trước thì bỏ dòng so sánh.
- **FR-129:** Biến thể Writing/Speaking: khối 3 thành "Tiêu chí thấp nhất của lớp" (trung vị từng tiêu chí trên bài đã trả) và "Loại chú thích xuất hiện nhiều nhất"; chưa có bài nào được trả → "chưa có điểm". Biến thể giữa kỳ/cuối kỳ: khối 3 gom theo buổi B01–B20; ma trận học viên × buổi lấy mẫu số là số câu của buổi; có nút "Mở bảng công bố điểm"; trang này không công bố điểm.
- **FR-130:** Khối 5: máy đề xuất câu (câu sai nhiều nhất trong nhóm có tỉ lệ sai cao nhất, ưu tiên câu có từ 40% người sai chọn cùng một phương án); giáo viên bỏ chọn hoặc thêm; "Lưu vào buổi N" lưu danh sách câu vào buổi học. Bản "Chữa trên lớp" không hiện tên học viên.
- **FR-131:** Bảng công bố điểm (chỉ với bài chế độ "giáo viên công bố"): khối "Theo buổi" trên bảng; có dòng được chọn thì nút "Công bố cho cả lớp" tắt, chỉ còn "Công bố cho N bạn đã chọn" và "Bỏ chọn"; mọi lệnh công bố qua hộp hỏi lại nêu số người, tên, mức hiển thị, học viên thấy gì, kèm "Xem như học viên thấy"; chỉ nâng mức, không hạ, không thu hồi; hẹn giờ huỷ được tới trước giờ. Không band; người không làm ghi "vắng". Không có điều khiển nộp trễ, làm bù, làm lại.

## Acceptance scenarios

Kịch bản của gói (mục 9), giữ số gốc. Môi trường: preview Vercel của nhánh + backend staging, tài khoản QA admin có TOTP.

10. Given bài giao Course 1 có bài nộp, When mở "Kết quả một bài giao", Then thấy 5 khối, một bộ 5 trạng thái, khối 3 liệt kê đủ mọi nhóm ngữ pháp của bank (không cắt 15), không có chữ "trục"; mở một nhóm thấy câu sai nhiều nhất và phương án sai phổ biến kèm lời giải thích.
11. Given bài giao chưa ai nộp, When mở trang kết quả, Then chỉ có khối 1, không vẽ điểm.
12. Given giáo viên A, When giao bài bằng thành phần giao bài cho "Chọn tay" 2 học viên lớp 1 rồi giao lại cùng bài, Then lần một tạo đúng 2 mục; lần hai hiện cảnh báo, không tạo bản thứ hai.
13. Given giáo viên A, When mở URL trang lớp hoặc kết quả bài giao của lớp 2, Then về trang cha kèm một dòng giải thích; gọi thẳng API → 404; tìm nhanh không ra học viên lớp 2. When admin đổi giáo viên của lớp 1 từ A sang B ở trang Lớp, Then trang lớp ghi B là giáo viên (đúng một người), A mất quyền với lớp 1 ở lần mở kế tiếp, B thấy lớp 1; trang lớp không có nút thêm giáo viên thứ hai.
14. Given đề giữa kỳ chế độ "giáo viên công bố" đã có bài nộp (sau GOI-11 E), When giáo viên chọn 1 học viên và công bố mức điểm, Then nút "cả lớp" tắt khi có dòng chọn; học viên đó thấy điểm, học viên khác chưa thấy; không có nút thu hồi.

## Edge cases

Ca biên phải có test tự động: gán giáo viên cho lớp bằng người không phải nhân sự → 422; lớp `instructor_id` NULL → giáo viên nào gọi cũng 404; `self_paced_timeline` không bao giờ trả trạng thái giữa hai phần sau khi đã bắt đầu; cộng giờ cho phần không chạy của kỳ tự làm → 409; `classes_unmetered` khi G04 chưa có → `unavailable`, không phải 0; G04 không trả lượt chuyển → dòng lượt chuyển ẩn; `ref` sai định dạng → 404; q tìm kiếm 1 ký tự → 422; nguồn tổng hợp lỗi → 200 + `sources_failed`; ngưỡng ngoài khoảng → 422; ngưỡng `null` → lý do tương ứng không bật; nhắc lần hai trong ngày → bỏ qua; nhóm sự cố có dòng mới khi xử lý → 409; xác nhận gõ sai chuỗi → nút không bật; step-up hết hạn → dialog rồi gửi lại; kỳ thi không có kỹ năng nào → 422; tên chế độ cũ gửi vào API admin được ánh xạ; ghi lô lỗi không làm hỏng script nhập.

## Success criteria

- Mọi kịch bản ở trên có bằng chứng trên `staging` (đã merge), không chỉ preview nhánh (gói mục 9).
- Admin thấy dữ liệu gốc của backend, kể cả lỗi tra cứu và trạng thái dở dang; không trạng thái lạc quan (constitution mục 5).

## Related specifications

- ADMINIA-0074: khung, sidebar, trang Lớp (G09-T29), "Cấp lượt cho lớp cũ", mỗi lớp một giáo viên (`staff_scope.py`, FR-108).
- LESSONREPORT-0043: báo cáo bài kiểm tra của khoá theo bài học; khối kết quả ở đây dùng lại cách tính, không tính lại khác.
- CALAPPEND-0041: mọi lần giao bài và gửi nhắc ghi `class_action_log` chỉ ghi thêm.
- COURSETESTRELEASE-0082 (GOI-11 phần E): backend công bố điểm bài kiểm tra khoá; bảng công bố (G09-T30) là giao diện của nó.
- ADMINSIMPLE-0049 FR-007, FR-008: thay bởi thành phần giao bài dùng chung (G09-T26).
- NOTIFY-0079: nút "Gửi nhắc" dùng `admin_notifications.py`.

## Open questions

Câu hỏi của gói (mục 10) liên quan; mỗi câu có mặc định tạm người thực thi dùng tới khi anh Andy trả lời.

| # | Câu hỏi | Phương án đề nghị | Mặc định tạm người thực thi dùng |
|---|---|---|---|
| Q25 | Trang Lớp: "Tạo lớp ba bước" sinh danh sách buổi từ lịch tuần + ngày khai giảng, và "Dời buổi" (hạn bài chưa tới hạn dời theo) — duyệt luồng này? | Duyệt; làm thành nhiệm vụ riêng sau T29 | Không dựng; buổi tạo tay như hiện nay; cột lịch đã có ở 441 để dùng sau |
| Q26 | Gửi nhắc bài: tối đa một lần mỗi ngày cho mỗi bài mỗi người — duyệt? | Duyệt | Như đề nghị |
| Q27 | Tên hiển thị tiếng Việt cho mã nhóm ngữ pháp (`truc_nhom`) và mã dạng câu: ai duyệt, lấy từ đâu? (tên trên tờ AdminKetQuaBaiGiao là tên đề xuất) | Lấy từ dàn bài Course 1, anh duyệt một lần | File nhãn rỗng; giao diện hiện mã cho tới khi có tên |
