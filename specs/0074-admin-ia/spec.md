---
id: ADMINIA-0074
title: Admins and the class teacher run daily work from one admin frame with eight sidebar groups, a unified learner directory and profile, and canonical queues
status: draft
risk: high
owner: product
---

# Admins and the class teacher run daily work from one admin frame with eight sidebar groups, a unified learner directory and profile, and canonical queues

Status: **draft** — soạn ngày 18/11/2026 cho nhiệm vụ `G09-T01` (đợt A, thương mại hoá 2026-11), từ `docs/proposals/commercialization-2026-11/GOI-09-admin-va-giao-vien.md` và `00-QUY-UOC-CHUNG.md` mục 2 (bản trên `staging` sau PR #2331). Chưa dòng mã nào chạy theo spec này; mọi hợp đồng kỹ thuật là đề xuất đã kiểm trên giấy (BAN-GIAO mục 7). Chỉ anh Andy duyệt; khi duyệt, câu trả lời ghi vào `approval-decision.md` cùng thư mục, nguyên văn kèm thời điểm, và `status` đổi sang `approved`. Số spec lấy từ sổ cấp số ở `01-KE-HOACH-TONG.md` mục 6; migration trong dải G09 (440–459).

## Tóm tắt (tiếng Việt)

- **Mục tiêu.** Người vận hành (hiện là một người vừa quản trị vừa dạy) mở `/admin` thấy đủ việc trong ngày: hàng chờ, kỳ thi hôm nay, bài kiểm tra chờ công bố, lớp hôm nay và tuần này, học viên cần chú ý. Từ một bài đã giao xem được một trang chẩn đoán lớp; tổ chức được kỳ thi cho nhiều lớp, học viên lẻ hoặc nhóm đã lưu, thi live hoặc tự làm, và trả kết quả ở đúng một nơi. Mỗi học viên có một trang hồ sơ có link riêng với trạng thái một dòng, cảnh báo, mục tiêu, ghi chú chăm sóc. Đơn đăng ký, quyền, lượt chấm, mã kích hoạt, sự cố, cài đặt nằm trong cùng một khung có sidebar 8 nhóm. Giáo viên dùng cùng khung với sidebar 5 mục và chỉ thấy lớp của mình (mỗi lớp một giáo viên — chốt 18/11 chiều; hiện tại giáo viên duy nhất là anh Andy).
- **Lớp thay đổi:** `high-risk` (quyền admin/giáo viên, cấp/thu hồi quyền học, lượt chấm trả phí, mã kích hoạt, kết thúc và trả kết quả bài thi, migration, dữ liệu cá nhân). Spec chính: **ADMINIA-0074** (`01-KE-HOACH-TONG.md` mục 6). Ba spec bổ sung đã được cấp số ở `01-KE-HOACH-TONG.md` mục 6 (18/11): `CLASSRESULT-0085` (kết quả bài giao), `MOCKORG-0086` (tổ chức kỳ thi), `CONTENTBATCH-0087` (lô nhập và câu cần kiểm). Repo chỉ có anh Andy vận hành; bảng mục 6 là sổ cấp số, người thực thi kiểm số chưa bị dùng rồi ghi vào sổ đăng ký trong repo; xem T21. Không dùng 0049, 0051, 0053.
- **Phụ thuộc:**
  - G03 (khung admin, bảng, modal, ngăn kéo, nút, dải thông báo trong `frontend/components/ui/`; chế độ sáng/tối mục 5.9) — trước mọi nhiệm vụ giao diện.
  - G10 phần gộp route group thành `(authed-admin)` — trước mọi nhiệm vụ frontend tạo trang mới (T08 trở đi). Lý do ở 6.0.
  - G04 (`course_products`, `entitlements`, `credit_ledger`, `enrollment_orders`, mã kích hoạt có sản phẩm và số lượt) — trước T13, T14, T15, T43, và phần mã/lượt của T29. G09 không tạo bảng hay API ghi của G04 (kể cả API chuyển lớp mã cũ sang đo lượt và quy tắc chuyển lượt khi đăng ký lại — G09 chỉ gọi và hiển thị). Tên route, tên trường của G04 mà G09 gọi đã đối chiếu với GOI-04 bản 18/11 ở bảng "API G04 mà G09 gọi" (mục 5.4); lệch thì theo GOI-04 và báo.
  - GOI-11 phần A (thông báo, `admin_notifications.py`) — trước mọi nút "Gửi nhắc" (T26, T28, T29, T34) và T40. GOI-11 phần E (migration 473–474, API công bố) — trước T30. GOI-11 T16 dựng `/admin/settings` thẻ Chấm thử — T23 dựng phần còn lại trên cùng trang.
  - G06: trang `/admin/library` (tờ AdminThuVienCongKhai) — G09 chỉ đặt mục sidebar (mục 5.1).
  - G08: phía học viên của kỳ thi phải đọc bảng người dự thi và tên chế độ mới (T31) — xem mục 7.
  - Chạy song song được: các nhiệm vụ backend (T03–T07, T22, T24, T25, T27, T31, T33, T35, T36) với G10; G05, G06, G07.
- **Ước lượng (giả định: G03 xong khung + bảng + modal + ngăn kéo; G10 đã gộp route group admin; G04 và GOI-11 phần A, E đã merge khi tới nhiệm vụ cần chúng; mỗi phiên = một nhiệm vụ trọn kèm test):** 48 PR, khoảng 97 phiên agent (bảng cuối mục 6; bản sáng 18/11 là 47 PR / 95 phiên — tăng vì thêm T43). Độ khó chung 4/5: phạm vi rộng, 149 test hợp đồng đọc chuỗi `aver-admin-chrome`, đổi mô hình người dự thi của kỳ thi đang chạy thật, và nhiều thao tác cấp quyền high-risk. Đây là ước lượng, không phải cam kết.

## Quyết định đã có

8. Admin: gộp Người dùng + Học viên thành một danh bạ có trang hồ sơ; sidebar 8 nhóm việc, mục con thụt lề, nhóm gập/mở được.
19. **Admin (17/11/2026):** các tờ admin dùng một sidebar, một bảng ngưỡng cảnh báo (Cài đặt), một thành phần giao bài, một bộ dữ liệu mẫu — bản chuẩn ở `thiet-ke/CHUAN-ADMIN.md`. Trang nhập nội dung thủ công bị ẩn khỏi sidebar; nội dung nhập qua script backend. Trả kết quả thi thử chỉ ở thẻ "Trả kết quả" của trang kỳ thi.
20. **Quyết định ngày 17/11/2026 (đợt chiều) của anh Andy:**
    - Điều hướng admin: gói G09 làm chuẩn, không theo spec 0049 (PR chưa merge); phần giao bài của 0049 chỉ giữ nếu không trùng.
    - Quy tắc "đường dẫn lịch sử giữ nguyên" nới thành "giữ khi còn được tham chiếu".
    - Lượt chấm AI: Speaking và Writing dùng CHUNG một kho. Lượt của học viên đăng ký khoá online có hạn dùng (con số: cấu hình, chưa có). ~~Lượt chưa dùng được chuyển sang 50% khi đăng ký lại~~ — thay bởi điểm 23: chuyển toàn bộ, bảo lưu tối đa 2 tháng.
    - Học viên lớp offline: mã kích hoạt do admin cấp đã kèm quyền và SỐ LƯỢT CHẤM; bài của lớp dùng lượt đó. Hết lượt thì admin cấp thêm (mặc định tạm 18/11, chờ anh Andy xác nhận; câu cũ ghi "giáo viên/admin"; hiện mỗi lớp một giáo viên là anh Andy, cũng là admin).
    - Speaking của lớp offline: AI chấm và trả ngay. Chỉ Writing của lớp offline qua giáo viên duyệt. Speaking thi thử do giáo viên chấm từ bản ghi.
    - Xác nhận đơn một khoá online là kích hoạt tài khoản: mở luôn các phần Reading, Listening, ngữ pháp, từ vựng dành cho tài khoản đã kích hoạt. Chấp nhận.
    - Một phiên đăng nhập mỗi tài khoản: chỉ áp học viên. Không bao giờ đẩy người đang làm bài có giờ ra; thiết bị mới phải hỏi trước khi chiếm phiên.
    - Bản ghi âm giữ tối đa 60 ngày rồi xoá. ~~Dùng audio làm mẫu hoặc để cải thiện chấm bài~~ — đã bỏ khỏi đợt này (điểm 22).
    - Chấm phát âm (dịch vụ Azure, đắt): chỉ chấm trên một đoạn mẫu — bài nói khoảng 2 phút thì cắt một đoạn; Part 1 nhiều câu thì chỉ chấm phát âm một câu. Các tiêu chí khác chấm trên cả bài. Phiếu phải nói rõ đoạn nào được chấm phát âm.
    - Dữ liệu sáu khoá online (học phí, thời hạn, số lượt, ngày mở, tài khoản nhận tiền, hạn giữ đơn): để placeholder/cấu hình, anh Andy điền sau.
    - Kho 549 bài mẫu và hình Task 1: mở công khai được. 19 bộ chưa có trạng thái duyệt và 3 bộ Task 1 thiếu hình: đội thực hiện rà và tạo luôn (thêm vào G06).
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

Đường dẫn backend tính từ `backend/`, frontend tính từ `frontend/`. Số dòng là số dòng ở 93c7085; lượt kiểm lại ở `c3bc71574` (commit 15/11) đối chiếu hơn 40 tham chiếu của mục này (số trang, route group, số dòng router, migration, script, test) — còn đúng, trừ các chỗ đã sửa tại dòng tương ứng. Lệch vài dòng thì tìm theo tên hàm. Migration mới nhất trong repo ở `c3bc71574`: 380.

### 2.1 Khung và điều hướng

| Thứ cần biết | File/đường dẫn thật | Ghi chú |
|---|---|---|
| Số trang admin | `app/(authed-admin-*)/admin/**/page.tsx` | Đúng **75** `page.tsx` trong **39** route group. Mỗi group có `layout.tsx` riêng gọi `AuthedShell chrome="admin"`. |
| Sidebar + thanh trên hiện tại | `public/js/components/aver-admin-chrome.js` (1078 dòng); `NAV_GROUPS` dòng ~425–574 | Custom element Shadow DOM. Mục nhập nội dung đang có trong sidebar: dòng 486 "Import bài luyện" (`/admin/listening/import-drills`), dòng 487 "Import Cambridge" (`/admin/listening/import-fulltest`), dòng 506 "Quick-Check Quiz" (`/admin/vocab/quiz`), dòng 505 "Nội dung từ vựng" (`/admin/vocab/content`), dòng 455 "Soạn bài viết" (`/admin/writing/new`), dòng 463 "Gán bài tập", dòng 469 "Hàng đợi Instructor", dòng 541 "Giảng viên". Nhóm "Thí điểm & QA" dòng 563–571. |
| Mỗi trang tự gắn khung | ví dụ `app/(authed-admin-users)/admin/users/page.tsx` | Bọc nội dung trong `<aver-admin-chrome active="users">`. |
| Cổng quyền phía trình duyệt | `components/admin-access-gate.tsx`, `lib/admin-mfa-model.mjs` | Có `AdminStepUpDialog` dùng chung cho vùng nguy hiểm. |
| Môi trường | `public/js/api.js` dòng 44–45: runtime config (`window.__AVER_RUNTIME_CONFIG__`) có `environment` | Dùng cho nhãn Production/Staging. Không suy từ hostname. |
| Liên kết học viên → giáo viên | `public/js/components/aver-chrome.js` dòng ~704–723 `_applyRole` | Chèn "Trang giảng viên" (`/instructor`); chưa có link tới `/admin`. |
| Redirect cố định đã có | `next.config.ts`: `/admin/access-codes` → `/admin/users?tab=codes`, `permanent: true` | Không dùng lại `/admin/access-codes` làm route mới. |
| Cổng sở hữu route | `tooling/route-ownership-check.mjs`, CI `.github/workflows/route-manifest.yml` | Thêm route Next phải gỡ redirect/rewrite cùng nguồn trong cùng commit. |
| Route được nhúng iframe | `next.config.ts` `EMBEDDABLE_SAME_ORIGIN_ROUTES`: `/admin/mock-exams`, `/admin/mock-live`, `/admin/mock-reviews`, `/admin/writing/queue`, `/admin/writing/status`, `/admin/writing/grade` | Trung tâm Mock Test nhúng bằng `?embed=1` (`lib/admin-mock-tests-model.mjs` `mockTestsFrame`). T34 bỏ kiểu nhúng này. |
| Test đọc chuỗi khung admin | `tests/aver-admin-chrome.test.mjs` (752 dòng) và 148 file test khác; `tests/react/admin-chrome-navigation.test.tsx` | Parse `NAV_GROUPS` bằng regex; ghim nhãn, thứ tự, href. |
| Test ghim route group | 109 file trong `tests/` chứa `(authed-admin-` | G10 lo. |
| Sáng/tối hiện có | `public/css/aver-design/tokens.css`, khoá `av-theme`, đoạn chống nháy trong `components/authed-shell.tsx` | Khung mới theo GOI-03 mục 5.9 (token `--av2-*`, `[data-theme]` trên `<html>`). |

### 2.2 Người dùng, học viên, lớp, mã

| Thứ cần biết | File/đường dẫn thật | Ghi chú |
|---|---|---|
| Trang Người dùng + tab Mã | `app/(authed-admin-users)/admin/users/` (`admin-users-panel.tsx`, `admin-access-codes-panel.tsx`, `admin-security-history.tsx`) | `?tab=codes` mở tab mã. |
| Trang Học viên | `app/(authed-admin-students)/admin/students/admin-students-directory.tsx` | Chi tiết là ngăn kéo gọi `GET /admin/students/{id}` và `GET /admin/writing/students/{id}/summary`. Có "Import CSV" (`POST /admin/students/import`, `routers/admin_students.py` dòng 67) — **giữ**. |
| Hai thực thể cho một người | `users` và `students` (`migrations/033_writing_coach_tables.sql`; `students.user_id` có thể NULL) | Hồ sơ có thể chưa có tài khoản và ngược lại. |
| Mục tiêu hai nguồn | `students.target_band`, `students.target_date`, `students.persona_notes`, `students.current_band_estimate` (mig 033 dòng 56–59); `users.target_band`, `users.exam_date` (`migrations/005_add_user_profile.sql` dòng 6–7) | Admin nhập ở `students`; học viên tự khai ở `users`. Chưa có chỗ đối chiếu. |
| Vai trò | `users.role ∈ ('user','student','instructor','admin')` (mig 323) | Đổi vai trò: `PATCH /admin/users/{user_id}/role` (`routers/admin.py` dòng 854, có `require_recent_mfa`). |
| Lớp | bảng `cohorts` (mig 060: `name`, `code_prefix`, `description`, `is_active`; thêm `course_id` mig 175; `archived_at`, `archived_by`, `archive_reason` mig 337 — mig 326 là cùng ba cột cho `students`) | **Không có** cột giáo viên của lớp (kiểm lại ở `c3bc71574`: `grep -rn "instructor_id" backend/migrations/*.sql` chỉ ra `students.instructor_id`), **không có** lịch tuần hay ngày khai giảng. |
| Thành viên lớp | `student_cohort_memberships` (mig 227: `student_id`, `cohort_id`, `is_active`, `joined_at`, `left_at`) là danh sách lớp **chuẩn**; `students.cohort_id` (mig 060) chỉ còn là con trỏ lớp chính kiểu cũ | Một học viên có thể đang ở nhiều lớp. Mọi chỗ trong gói nói "thành viên active của lớp" là đọc bảng này. |
| Giáo viên ↔ học viên | `students.instructor_id` (mig 106, "1 GV / student"); `routers/instructor.py` `_me` dòng 113, `instructor_db(me)` | Phạm vi giáo viên hiện tính theo **học viên**, không theo lớp. Đã chốt 18/11 chiều: mỗi lớp một giáo viên → T24 thêm `cohorts.instructor_id`; "lớp của giáo viên" chỉ tính ở `services/staff_scope.py`. |
| Buổi học | `class_lessons` (mig 176: `cohort_id`, `lesson_no`, `lesson_date` DATE, `title`, `body_md`, `attachments`, `is_published`); API `routers/admin_class_lessons.py` (`GET/POST /admin/cohorts/{c}/lessons`, `PATCH/DELETE …/lessons/{id}`) | Có ngày, không có giờ; không có chỗ lưu "câu nên chữa". |
| Bài giao | `class_assignments` (mig 177: `cohort_id`, `lesson_id`, `skill`, `content_id`, `content_config`, `title`, `due_at`…; `recipient_scope ∈ ('class','subset')` mig 193), `class_assignment_items` (`student_id`, `state`, `opened_at`, `submitted_at`, `score`, `artifact_kind`, `artifact_id`) | Tạo: `POST /admin/cohorts/{c}/assignments` (`routers/admin_class_assignments.py` dòng 2742); đổi hạn `PATCH …/due` (3110); nhật ký lớp `GET …/action-log` (3031, spec 0041). |
| Bài một học viên trong lớp | `GET /admin/cohorts/{c}/students/{s}/work` (`admin_class_assignments.py` dòng 2212) | |
| Mã kích hoạt | `routers/admin.py`: `/admin/access-codes` (list 1347, generate 1201 có step-up, patch 2328, delete 2417, audit 3004); cột `access_codes`: `session_limit`, `expires_at`, `is_active`, `code_type`, `cohort_id`, `notes`, `issued_by`, `grants_role`, `intended_email` | **Chưa có** cột số lượt chấm kèm mã (G04 thêm). `is_used/used_by/used_at` bất biến. |
| Giáo trình lớp | `routers/admin_courses.py` prefix `/admin/courses`, bảng `courses` (mig 175, C1–C5) | Khác `course_products` của G04. |
| Giáo viên (admin) | `routers/admin_instructors.py` (`GET /admin/instructors` dòng 28); trang `app/(authed-admin-instructors)/admin/instructors/admin-instructors.tsx` (lưới thẻ) | Chỉ có danh sách. |
| Bảo mật tài khoản | `routers/admin_staff_security.py`: `PATCH /admin/users/{id}/active`, `POST …/revoke-sessions` (step-up), `GET …/security-audit` | Docstring ghi cho admin/giáo viên; nhận học viên hay không: CHƯA KIỂM (Q9). |
| Nhật ký có sẵn | `access_code_audit`, `staff_security_audit`, `class_action_log` (mig 356, chỉ ghi thêm), `governance_audit` | Chưa có nhật ký gom theo một học viên. |
| Streak, hoạt động | `services/student_home_aggregator.py` `_build_streak`; `analytics_events` (mig 018) | Dùng cho lưới 8 tuần. |

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

### 2.4 Chấm bài

| Thứ cần biết | File/đường dẫn thật | Ghi chú |
|---|---|---|
| Hàng chờ Writing | `GET /admin/writing/essay-queue` (`routers/admin_writing.py`), trang `/admin/writing/queue` | Làn hiện có: Đang chấm · Cần duyệt · Chờ trả · Đã trả · Tất cả · Mock Writing. |
| Màn chấm một bài | `/admin/writing/grade?essay_id=`; `PATCH /admin/writing/essays/{id}/feedback`, `POST …/mark-delivered`, `…/revoke-delivery`, `…/regrade` | Bài chỉ tới học viên khi `status == 'delivered'`. |
| Tầng duyệt | `routers/admin_instructor_queue.py` prefix `/admin/instructor` (`/queue`, `/reviews/{id}/claim|release|deliver`); bảng `instructor_reviews` (mig 047, có `claimed_by`) | Chỉ admin; "instructor" ở đây là tầng chấm. Giáo viên có bản riêng ở `routers/instructor.py` (`/instructor/reviews/queue`, `claim`, `release`, `deliver`, dòng 828–859). Khoá tự nhả theo thời gian: CHƯA KIỂM (`grep -n "claimed_at\|claim" backend/migrations/047_instructor_review.sql backend/services/instructor_workflow.py`). |
| Yêu cầu chấm lại | `routers/admin_writing_regrade.py` prefix `/admin/writing/regrade-requests`; bảng `essay_regrade_requests` (mig 084: `reason` 50–500 ký tự, `admin_response`) | |
| Speaking luyện tập | `GET /admin/sessions`, `/admin/sessions/{id}` (`routers/admin.py` 3981–4897), trang `/admin/speaking/sessions` | Không phải hàng chờ chấm. |
| Speaking thi thử | `POST /admin/mock-exams/sittings/{id}/record-speaking` (`routers/admin_mock_exams.py` dòng 840); band nhập qua `POST /{exam_id}/bulk-final-bands` (738) | Chưa có hàng chờ Speaking thi thử riêng. |
| OCR bài viết | `POST /admin/writing/extract-text` (`admin_writing.py` dòng 1172), trang `/admin/writing/new` | **Giữ** (chấm bài, không phải nội dung). |
| Loại chú thích Writing | CHƯA KIỂM | `grep -rn "annotation" backend/services/essay_service.py backend/models/*.py \| head -20` để biết chú thích có trường loại hay không. |

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

### 2.6 Nội dung: trang nhập thủ công và script tương ứng

Mọi script dưới đây có trong `backend/scripts/` (đã kiểm tên file).

| Trang (route) | API tải lên | Script backend làm cùng việc | Xử lý trong gói |
|---|---|---|---|
| `/admin/listening/import-drills` | `POST /admin/listening/drills/import` (+`/commit`) (`routers/listening.py` 3611, 3663) | `import_skill_drills.py`, `import_listening_content_package.py` | **Ẩn** khỏi sidebar |
| `/admin/listening/import-fulltest` | `POST /admin/listening/import-fulltest` (+`/commit`) (3101, 3150) | `import_listening_lessons.py`, `import_listening_content_package.py`, `import_cambridge_canonical_qa.py`, `upload_listening_source_audio.py` | **Ẩn** |
| `/admin/listening/tests/[testId]` (tải audio, ảnh map) | `/tests/{id}/audio/...`, `/exercises/{id}/upload-map-image` (`listening.py`) | `upload_listening_source_audio.py`, `upload_listening_source_figures.py`, `migrate_legacy_audio_urls.py` | Giữ trang xem; **ẩn điều khiển tải audio**; giữ sửa ảnh lẻ |
| `/admin/vocab/quiz` (nhập bank quiz, cả ngữ pháp và course) | `POST /admin/quiz/import` (`routers/admin_quiz.py` 147) | `import_course_exercise_bank.py`, `import_course_assessment_bank.py`, `import_grammar_banks.py`, `reimport_grammar_banks.py` | **Ẩn phần nhập**; giữ danh sách bank và xem trước |
| `/admin/vocab/content` | `POST /admin/vocabulary/import` (`routers/admin_vocab.py` 133) | `seed_vocab_curated.py`, `import_advanced_vocab_core30.py`, `pregen_vocab_audio.py`, `migrate_vocab_to_cards.py` | **Ẩn nhập**; giữ sửa lẻ |
| `/admin/reading/content` | `POST /admin/reading/content/import`, `/import-bundle` (`routers/admin_reading.py` 378, 491) | `import_reading_drills.py`, `reimport_wp5_reading.py`, `import_ilr_rdg_001.py`, `import_cambridge_canonical_qa.py` | **Ẩn nhập**; giữ khoá/chia sẻ/đăng |
| Đề exam module cũ | `POST /admin/exams/import` (`routers/admin_exams.py` 45) | `seed_exams.py` | **Ẩn** |
| `/admin/writing/tips` (nhập nhiều mẹo từ file) | `POST …/content/import` (`routers/admin_writing_tips.py` 238) | chưa có script | **Ẩn nút nhập nhiều**; giữ soạn lẻ; giữ API |
| `/admin/writing/prompts` | `POST /admin/writing/prompts`, `/upload-image` | `import_writing_prompts.py`, `migrate_writing_images.py` | Giữ tạo/sửa lẻ và ảnh lẻ |
| `/admin/speaking/topics` | API JSON topics | `import_speaking_bank_admin.py`, `import_speaking_lesson_sets.py`, `pregen_speaking_question_audio.py` | Giữ bật/tắt, sửa lẻ |
| `/admin/reading/preview` | `POST /admin/reading/questions/{id}/upload-diagram-image` | — | Giữ (sửa ảnh lẻ) |
| `/admin/students` (CSV học viên) | `POST /admin/students/import` | — | **Giữ**, dời vào Danh bạ |
| `/admin/writing/new` (OCR) | `POST /admin/writing/extract-text` | — | **Giữ**, mở từ Chấm bài › Writing |

Chưa script nào ghi "bản ghi lô". Trạng thái, cấp lớp, hiển thị của đề quản lý qua `routers/admin_exam_content.py` (`/admin/exam-content/{kind}/{id}/visibility|status|level|cohorts`). Báo lỗi câu của học viên: `user_feedback` (mig 100, chỉ Reading/Listening). Tỉ lệ sai theo câu của quiz: RPC `quiz_item_error_rates` (mig 121).

### 2.7 Hệ thống, quyền ở máy chủ

| Thứ cần biết | File | Ghi chú |
|---|---|---|
| Guard | `routers/admin.py` dòng 102 `require_admin`, dòng 112 `require_instructor` → `services/staff_guard.py` | Admin cần AAL2 (spec 0032). |
| Step-up | `staff_guard.require_recent_mfa`; danh sách route trong `tests/test_staff_guard_inventory.py` (`STEP_UP_ROUTES`) | |
| Kiểm kê route staff | `tests/test_staff_guard_inventory.py` | Guard phải là lệnh `await` đầu tiên của handler. |
| RLS | spec 0039 (mig 344) | Mọi màn admin đi qua backend `supabase_admin`. |
| Báo lỗi | `routers/error_logs.py` prefix `/admin/error-logs` | Không gom nhóm, không trạng thái nhóm. |
| Sự cố chấm | `GET /admin/alerts` (`admin.py` dòng 4225) | Chỉ Speaking. |
| Phản hồi | `routers/feedback.py`: `GET/PATCH /api/admin/feedback` | Tiền tố `/api`. |
| Công tắc model AI | `app/(authed-admin-overview)/admin/admin-ai-panel.tsx`; `GET /admin/ai/models`, `PATCH /admin/ai/models/{feature}` (`routers/admin_ai.py`, spec 0024) | PATCH không có step-up. |
| Công tắc tính năng | `routers/admin_flags.py`: `GET /admin/runtime-flags`, `PATCH /admin/runtime-flags/{key}`; `services/runtime_flags.py` | Dùng cho thẻ Tính năng của Cài đặt. |
| Bảng cài đặt/ngưỡng chung | Không có (`grep -rn "system_settings\|app_settings\|operational_thresholds" backend/migrations/*.sql` rỗng) | T22 tạo. |
| Ẩn dữ liệu kiểm thử | `services/test_data_visibility.py` | Dùng cho mọi API đếm mới. |
| Khu giáo viên | `app/(authed-instructor)/instructor/page.tsx`, `(authed-instructor-grade)`, `(authed-instructor-compare)`; `instructor-dashboard.tsx` | Khung riêng, tab là state React. Production: 0 tài khoản giáo viên (16/11). |

### 2.8 Spec 0049

Trên staging @ 93c7085 không có `specs/0049-*`; chỉ có tham chiếu ở `specs/0052-blackeye-u1/spec.md` và `specs/0054-listening-skill-drill-homework/spec.md`. **Đã chốt 17/11:** G09 làm chuẩn điều hướng; phần giao bài của 0049 chỉ giữ nếu không trùng thành phần giao bài dùng chung (T26). T01 vẫn đọc PR #2254 (chỉ đọc) để liệt kê phần nào trùng; nếu #2254 merge giữa chừng, xem mục 7.

## Scope

**Trong phạm vi**
1. Khung admin mới gắn một lần ở layout `(authed-admin)`; sidebar 8 nhóm; thanh trên; sáng/tối; sổ đăng ký điều hướng; bảng ánh xạ 75 trang; ẩn trang nhập thủ công.
2. Việc cần làm (hàng chờ, kỳ thi hôm nay, bài kiểm tra chờ công bố, lớp hôm nay và tuần này, cần chú ý tuần này, cần liên hệ hôm nay).
3. Danh bạ hợp nhất; hồ sơ học viên 5 thẻ bản một người dùng; ghi chú chăm sóc; vùng nguy hiểm.
4. Lớp: thẻ có URL, bảng học viên × bài, gửi nhắc, cấp mã kèm lượt, cấp thêm lượt, **cấp lượt cho lớp cũ** (chuyển lớp chạy bằng mã cũ sang đo lượt — T43), quyền luyện lại; chọn **một** giáo viên của lớp; thành phần giao bài dùng chung; nhóm đã lưu.
5. Kết quả một bài giao (một API tổng hợp, 5 khối, ba biến thể).
6. Bảng công bố điểm bài kiểm tra khoá phía admin/giáo viên (giao diện; backend ở GOI-11 phần E).
7. Khoá học, đơn đăng ký, lượt AI, mã kích hoạt (giao diện trên API G04).
8. Chấm bài: Writing (hàng chờ duyệt của lớp offline), Speaking thi thử, Yêu cầu chấm lại.
9. Kỳ thi: danh sách, tổ chức ba bước, trang một kỳ thi 7 thẻ, bảng người dự thi, tên chế độ mới.
10. Nội dung: ba trang 4 thẻ, lô nhập chỉ đọc, câu cần kiểm.
11. Báo cáo một trang 4 thẻ; Hộp thư sự cố; AI và mô hình; Công cụ QA; Cài đặt (trừ thẻ Chấm thử do GOI-11 T16 dựng).
12. Giáo viên: danh sách và hồ sơ giáo viên; khu giáo viên 5 mục; nối "Gửi thông báo" với danh sách đã chọn.
13. Tìm nhanh Ctrl/⌘ K.

**Ngoài phạm vi (kèm nơi lo)**
- Bảng và API ghi của khoá, quyền, sổ lượt, đơn, mã có số lượt; trừ/hoàn lượt khi chấm; tự mở lại đơn hết hạn khi khoản chuyển khớp mã; chuyển lượt chưa dùng khi đăng ký lại và hạn của phần lượt chuyển; API chuyển lớp mã cũ sang đo lượt (`/admin/credits/convert-class…`); xoá bài làm sau 45 ngày kể từ khi khoá hết hạn và xoá bản ghi âm sau tối đa 60 ngày (G04). G09 chỉ hiển thị và gọi.
- "Lần đăng nhập gần đây" của học viên (bảng `learner_login_events`, API học viên `GET /api/account/login-events` — nhiệm vụ mới của GOI-04, migration 387): hồ sơ học viên phía admin **chưa** có khối này; G09 không thêm API admin đọc bảng đó. Đợt sau nếu cần.
- Trang "Khảo sát và nhận xét" (tờ AdminKhaoSat) và trang công khai "Học viên nói gì" (tờ HocVienNoiGi): đã vẽ; GOI-13 phần A nhận dựng (Q34 đã đóng) (sửa 18/11 theo GOI-13). G09 chỉ đặt mục sidebar (`href: '/admin/surveys'`), ở trạng thái "Chưa mở" tới khi trang của GOI-13 lên. Khi dựng: nhận xét hiện cả ở trang sáu khoá online và **không** ghi là của lớp offline (00 mục 2 điểm 23).
- Backend thông báo, API gửi của nhân sự, ba trần chấm thử, luồng trả điểm bài kiểm tra khoá (GOI-11 phần A, B, E). Nộp trễ, làm bù, làm lại bài kiểm tra khoá: **để đợt sau**, không dựng giao diện ở gói này.
- Trang đăng nhập (Google hoặc mã email) cho mọi vai trò, một phiên mỗi tài khoản học viên (G05, G04-T09). G09 chỉ không thêm giới hạn phiên cho admin/giáo viên.
- Trang `/admin/library` (G06). Phía học viên của kỳ thi và phòng thi (G08). Thông báo phía học viên (GOI-11, G07).
- Gộp 39 route group, gỡ JS cũ, thay test đọc chuỗi (G10).
- Vai trò "đội chăm sóc", người liên hệ, kênh liên hệ, nhật ký đa kênh, phân công: **chưa làm** (bản một người dùng).
- Tác vụ tính lại điểm cho bài đã nộp khi đăng bản đề đổi đáp án; tỉ lệ sai theo câu Listening/Reading mức toàn kho; lưu `lesson_primary` cho mọi câu (spec 0043); tách mã ngộ nhận N1–N6: gói sau (Q22).
- Thẻ Pháp lý của Cài đặt (phiên bản điều khoản bất biến, đồng ý lại): gói sau (Q21). Ngân sách AI theo tháng, tự kiểm nhà cung cấp 5 phút, bảng phiên và nhật ký nhạy cảm ở Bảo mật: gói sau; gói này giữ `/admin/mfa`.
- Thay đổi logic chấm AI. Production: không kiểm, không bấm gì.

## Non-goals

Xem mục Scope (phần "Ngoài phạm vi" của gói). Ba phần Kết quả một bài giao, Tổ chức kỳ thi, Lô nhập thuộc CLASSRESULT-0085, MOCKORG-0086, CONTENTBATCH-0087.

## Users and journeys

- Admin (anh Andy, hiện cũng là giáo viên duy nhất của mỗi lớp): làm việc hằng ngày từ `/admin`.
- Giáo viên của lớp (một lớp đúng một giáo viên, `cohorts.instructor_id`): chỉ thấy lớp mình qua `services/staff_scope.py`.
- Học viên: thấy kết quả do các thao tác admin sinh ra (giao bài, trả kết quả, công bố điểm) ở màn học viên của G07/G08.

## Requirements

Đánh số theo gói (FR-09-NNN → FR-NNN, giữ nguyên số; số không liên tục vì gói chia dải theo nhóm).

**Khung và điều hướng**
- **FR-001:** Mọi trang `/admin/**` hiện cùng một thanh trên: logo Ấn ký + "Aver Learning", nhãn vai trò "Quản trị", nhãn môi trường, nút tìm nhanh ("⌘K" trên macOS, "Ctrl K" nơi khác), "Xem như học viên" (`/home`), nút tài khoản.
- **FR-002:** Nhãn môi trường lấy từ runtime config `environment`: `production` → "Production · dữ liệu thật"; khác → "Staging · dữ liệu thử". Không bao giờ ẩn (dưới 768px thành dải ngang dưới thanh).
- **FR-003:** _(sửa)_ Menu tài khoản có: chế độ hiển thị ba lựa chọn Sáng · Tối · Theo thiết bị (GOI-03 mục 5.9, lưu trên trình duyệt bằng khoá `av-theme`); "Sang khu học viên"; "Sang khu giáo viên" khi `role ∈ {instructor, admin}`; "Đăng xuất". Không có mục đổi mật khẩu (đăng nhập không mật khẩu).
- **FR-004:** Trong khung học viên, "Sang khu quản trị" chỉ hiện khi `/auth/me` trả `role = 'admin'`.
- **FR-005:** _(sửa)_ Sidebar có đúng 8 nhóm, đúng mục và thứ tự ở bảng "Sidebar chuẩn" mục 5.1 (gồm mục "Khảo sát và nhận xét" cuối nhóm thứ hai, theo `CHUAN-ADMIN.md` sửa đổi 18/11). Không có mục "Giáo viên duyệt", "Chấm bài › Thi thử", hay mục tải lên / nhập hàng loạt nào.
- **FR-006:** Bấm tên nhóm thì thu/mở; nhóm chứa trang hiện tại mở sẵn; nhóm đang thu hiện tổng số việc chờ của các mục con; trạng thái nhớ theo trình duyệt (localStorage, bọc try/catch).
- **FR-007:** Mục đang ở có gạch trái, chữ đậm, `aria-current="page"`; xác định từ pathname qua sổ đăng ký.
- **FR-008:** Một file sổ đăng ký liệt kê mọi trang admin: đường dẫn, nhóm, mục, loại (`nav` | `tab` | `context` | `hidden` | `redirect`). Test hành vi: mọi `page.tsx` dưới `/admin` có trong sổ; mọi mục sidebar trỏ tới route `nav`.
- **FR-009:** Dòng sidebar cao 36px máy tính, 44px điện thoại; dưới 1200px sidebar chỉ biểu tượng (có `aria-label`, tooltip); dưới 768px thành ngăn kéo. Ở 1024px: ba trang Việc cần làm, Chấm Writing, Lớp theo tờ `Admin1024.dc.html` (đã có trong `thiet-ke/`); mọi trang khác theo quy tắc co giãn chung: sidebar thu thành biểu tượng, bảng cuộn ngang trong hộp và **giữ cột đầu**.
- **FR-010:** Trang bị gộp/bỏ trả chuyển hướng tạm (307) ít nhất một vòng phát hành; đổi 308 khi anh Andy duyệt (Q5).
- **FR-011:** Mở trang thiếu tham số hoặc thiếu quyền → về trang cha gần nhất kèm một dòng giải thích bằng lời thường (tờ ThanhPhanKhungTrang2 mục 10).
- **FR-012:** Số đếm trên sidebar: Đơn đăng ký = đơn `transfer_reported`; Writing = bài Writing lớp offline chờ duyệt (gồm bài AI lỗi); Speaking = bài **Speaking thi thử chờ giáo viên chấm**; Yêu cầu chấm lại = yêu cầu Mới; Hộp thư sự cố = nhóm Mới + Đang xem. Cùng nguồn với Việc cần làm (FR-090). Mục "Khảo sát và nhận xét" có số (nhận xét chờ duyệt) khi trang đó được dựng; trước đó mục ở trạng thái "Chưa mở", không có số.
- **FR-013:** Trang nhập thủ công bị ẩn (loại `hidden`, danh sách ở 5.1) vẫn mở được bằng đường dẫn; đầu trang có dải Cảnh báo "Trang nhập thủ công đã ẩn. Nội dung nhập bằng script trên máy chủ." và nút "Vẫn mở" chỉ với vai trò quản trị; mỗi lần bấm "Vẫn mở" ghi một dòng log.
- **FR-014:** Giao diện không bao giờ dùng "giảng viên", "thầy"; dùng "giáo viên". Không "Đơn hàng", "bán", "giá".

**Danh bạ và hồ sơ học viên**
- **FR-020:** `/admin/learners` mỗi người một dòng, hợp nhất `users` và `students`; hồ sơ chưa có tài khoản ghi "Chưa có tài khoản"; tài khoản chưa có hồ sơ ghi "Chưa có hồ sơ học viên" ở cột Dạng. Mặc định ẩn vai trò `admin`/`instructor`.
- **FR-021:** _(sửa)_ Tìm theo tên (không phân biệt dấu), email, mã học viên, mã kích hoạt; lọc theo lớp, Dạng, Trạng thái (Đang học · Sắp hết hạn · Hết hạn · Lưu trữ), Cần chú ý, Lượt chấm còn; phân trang máy chủ **25 dòng**; bộ lọc và trang ghi vào địa chỉ.
- **FR-022:** Mỗi dòng mở `/admin/learners/{ref}`; `ref` = `u-<users.id>` hoặc `s-<students.id>`; người có tài khoản mở bằng `s-…` thì 307 về `u-…`.
- **FR-023:** _(sửa)_ Trang hồ sơ có **5 thẻ** có URL (`?tab=tong-quan|hoc-tap|ghi-chu|khoa-va-quyen|nhat-ky`). Đầu trang giống nhau ở mọi thẻ = khối tóm tắt học viên dùng chung (`CHUAN-ADMIN.md` mục H) + nút "Thêm ghi chú", "Gửi nhắc", "Giao bài", "Cấp quyền luyện lại".
- **FR-024:** _(sửa)_ Thẻ Tổng quan gồm 5 khối: (1) Cảnh báo đang mở; (2) Mục tiêu và ngày thi; (3) Độ liên tục — lưới 8 tuần × 7 ngày; (4) Bài được giao; (5) Điểm theo thời gian; cột phải: việc đã hẹn, khoá và hạn, lượt chấm còn (có phần lượt chuyển thì thêm một dòng "trong đó N lượt chuyển từ khoá trước, dùng tới dd/mm/yyyy" — FR-056). Mỗi khối tải riêng; lỗi một khối chỉ khối đó báo, có nút tải lại.
- **FR-025:** _(sửa)_ Thẻ Học tập: bảng bài làm mọi kỹ năng (lọc kỹ năng, trạng thái, "Tải thêm"); "Lỗi lặp lại ở Writing"; "Nhóm ngữ pháp yếu". Mỗi dòng mở màn xem/chấm đúng loại bài.
- **FR-026:** _(sửa)_ Chi phí AI của một người chỉ hiện ở thẻ Khoá và quyền (cửa sổ 7/30/90 ngày, USD 2 chữ số thập phân, ghi rõ lượt gọi chưa có đơn giá).
- **FR-027:** _(sửa)_ Thẻ Nhật ký hệ thống: chỉ ghi thêm, mới trước, lọc theo loại; hợp nhất `access_code_audit`, `staff_security_audit`, `class_action_log`, đổi vai trò, sự kiện quyền/lượt/đơn của G04, sự kiện gộp mục tiêu. **Không** chứa ghi chú chăm sóc.
- **FR-028:** Ngăn kéo chi tiết học viên cũ và modal "Lịch sử quyền" được thay bằng link tới hồ sơ.
- **FR-029:** Trạng thái một dòng: "Đang ổn" hoặc "Cần chú ý: <tối đa hai lý do nặng nhất>". Lý do tính từ bốn ngưỡng ở Cài đặt (trễ liên tiếp, không hoạt động, quyền khoá sắp hết, còn ít lượt chấm). Cùng một hàm máy chủ cho hồ sơ, danh bạ (cột và bộ lọc "Cần chú ý"), Việc cần làm, khu giáo viên. Mức "Có nguy cơ bỏ" và lý do "điểm tụt", "bỏ dở bài", "gần ngày thi" **chưa dựng** (Q15).
- **FR-030:** Khối Mục tiêu hiện cả hai nguồn kèm nhãn nguồn ("Admin nhập", "Học viên khai"). Hai nguồn lệch → mỗi nguồn có nút "Dùng giá trị này"; bấm → hộp hỏi lại → ghi giá trị đó vào **cả** `students.target_band/target_date` và `users.target_band/exam_date`, ghi Nhật ký. Lệch mục tiêu không phải cảnh báo. Band ước tính chỉ hiện khi có bài thi thử gần nhất đủ bốn kỹ năng.
- **FR-031:** Lưới 8 tuần: ô "có học" = ngày (giờ Việt Nam) có phiên học hoặc bài nộp; tuần hiện tại ở dòng cuối, ngày sau hôm nay để trống; kèm chuỗi ngày hiện tại và số phút tuần này so với tuần trước.
- **FR-032:** Ghi chú chăm sóc: mỗi ghi chú có người ghi, ngày giờ, nội dung, việc tiếp theo (tuỳ chọn), ngày hẹn (tuỳ chọn), đã xong lúc. `students.persona_notes` hiện thành ghi chú đầu tiên nhãn "Ghi chú ban đầu". Việc có ngày hẹn ≤ hôm nay và chưa xong vào "Cần liên hệ hôm nay" ở Việc cần làm.
- **FR-033:** Vùng nguy hiểm nằm cuối thẻ Khoá và quyền: Thu hồi quyền học (không hoàn tác, gõ đúng họ tên, lý do bắt buộc); Gỡ khỏi lớp và Khoá tài khoản (hoàn tác được, hỏi lại một bước; khoá tài khoản bắt buộc lý do). Mọi thao tác ghi Nhật ký.
- **FR-034:** Khối tóm tắt học viên dùng chung là một component, dùng ở đầu hồ sơ, ngăn "Xem nhanh" của danh bạ (400px), ngăn học viên của khu giáo viên; đúng 7 trường theo thứ tự `CHUAN-ADMIN.md` mục H; không thêm trường.
- **FR-035:** Thanh hàng loạt của danh bạ: Gán vào lớp · Gửi nhắc đăng ký lại (chuyển sang Gửi thông báo với "Danh sách đã chọn") · Gia hạn quyền luyện lại (lý do bắt buộc, hỏi lại nêu số người, bỏ qua và báo lại người không có quyền luyện lại) · Xuất danh sách (CSV, chỉ cột đang thấy). Không có thao tác nguy hiểm hàng loạt. Giữ "Import CSV" và "Thêm học viên".

**Khoá học, đơn đăng ký, lượt, mã**
- **FR-040:** _(sửa)_ `/admin/courses`: danh sách khoá; trang một khoá 4 thẻ (`?tab=info|curriculum|learners|log`). Nhãn trạng thái: "Sắp mở" = `coming_soon`, "Đang mở đăng ký" = `open`, "Tạm dừng" = `closed`, "Bản nháp" = `draft`. "Lưu trữ": G04 bản 18/11 đã có (`archived_at`, route `archive` — phân xử 14 xong); khoá đã lưu trữ không hiện ở danh mục công khai. Không xoá cứng.
- **FR-041:** _(sửa)_ `/admin/enrollments`: làn theo trạng thái G04 với nhãn admin: `awaiting_transfer` "Chờ chuyển khoản" · `transfer_reported` "Đã báo chuyển" (mặc định) · `needs_info` "Cần bổ sung" · `confirmed` "Đã xác nhận" · `expired` "Hết hạn" · `cancelled` "Đã huỷ". Làn không có đơn ghi 0, không ẩn. Nút không hợp lệ với trạng thái thì ẩn.
- **FR-042:** _(sửa)_ Trang một đơn `/admin/enrollments/{orderCode}`: lời nhắn của học viên; ba ô đối chiếu (số tiền, nội dung chuyển khoản, ngày); nút "Điền đúng học phí, mã đơn, hôm nay"; kết quả đối chiếu tính ở trình duyệt: Khớp · Thiếu · Thừa · Sai nội dung. Thiếu → nút xác nhận khoá. Thừa → xác nhận được, ghi chú bắt buộc, không tự hoàn tiền. Sai nội dung → xác nhận được sau khi đánh dấu đã đối chiếu người chuyển và ghi chú.
- **FR-043:** _(sửa)_ "Yêu cầu bổ sung": lời nhắn bắt buộc và **hạn bổ sung**; đơn sang `needs_info` (sai lệch số tiền là một lý do của `needs_info`, nhãn "Cần bổ sung · sai lệch"); học viên nhận thư "Cần bổ sung / chưa tìm thấy khoản chuyển" chép nguyên văn lời nhắn kèm hạn và đường về trang đơn, song song có thông báo trong ứng dụng.
- **FR-044:** Huỷ đơn: lý do bắt buộc, gõ đúng mã đơn.
- **FR-049:** Hộp "Xác nhận và mở khoá" nêu đúng **năm việc** làm cùng lúc (tờ AdminDonDangKy mục 3a): (1) cấp quyền khoá từ hôm nay tới hết ngày = ngày xác nhận + thời hạn đã chụp lúc tạo đơn (nối tiếp nếu đang có quyền cùng khoá); (2) cộng lượt chấm AI vào sổ lượt (Writing và Speaking dùng chung); đơn là **đăng ký lại** thì dòng này nêu thêm "chuyển sang N lượt chưa dùng của khoá trước, dùng tới dd/mm/yyyy" theo số G04 trả (FR-056); (3) **kích hoạt tài khoản** — mở luôn phần luyện Reading, Listening, ngữ pháp, từ vựng dành cho tài khoản đã kích hoạt (tài khoản đã kích hoạt từ trước thì bỏ qua bước này); (4) gửi thư "Khoá đã mở"; (5) ghi vào dòng thời gian của đơn và nhật ký hồ sơ học viên. Năm việc cùng thành công hoặc không việc nào xảy ra; bấm lặp hoặc hai admin cùng bấm → "đã xác nhận", không cấp hai lần.
- **FR-050:** Bốn thư về đơn (tờ EmailMau neo e4, e5, e14, e6): đã tạo đơn · nhắc chuyển khoản một lần trước hạn · cần bổ sung / chưa tìm thấy khoản chuyển · khoá đã mở. Cả bốn bắt buộc, không tắt được ở Cài đặt. Huỷ, hết hạn, báo đã chuyển chỉ là thông báo trong ứng dụng. G09 hiển thị lịch sử thư của đơn; gửi thư là việc của G04/GOI-11.
- **FR-051:** Trang đơn Hết hạn ghi rõ: khoản chuyển khớp mã đơn và đủ học phí lúc tạo đơn sẽ làm đơn tự mở lại và mở khoá; đơn Đã huỷ không bao giờ mở lại. Đơn Chờ chuyển khoản quá hạn tự Hết hạn; Đã báo chuyển và Cần bổ sung không tự hết hạn. (Hành vi do G04 làm; G09 hiển thị đúng sự kiện G04 trả.)
- **FR-052:** Sau khi xác nhận: hiện "Đơn kế tiếp (còn N)" theo hàng Đã báo chuyển, cũ nhất trước; phím J đơn kế, K đơn trước; không bắt phím khi con trỏ trong ô nhập. Cột "Đã chờ" tính từ lúc báo chuyển; vượt ngưỡng ở Cài đặt thì đậm và có biểu tượng cảnh báo.
- **FR-045:** _(sửa)_ Cấp quyền luyện lại: **một** biểu mẫu dùng chung ở trang lớp và hồ sơ (khoá — chỉ Course 1–5 học viên chưa có quyền, trừ khoá của lớp; áp dụng cho; thời hạn; luồng chấm "AI trả ngay" / "qua giáo viên duyệt"; lý do bắt buộc); hỏi lại nêu số người; không tạo mã. Tên nguồn quyền theo G04 (phân xử 12).
- **FR-046:** Thu hồi quyền: vùng nguy hiểm, gõ đúng họ tên, lý do bắt buộc.
- **FR-047:** _(sửa)_ `/admin/credits`: sổ lượt đọc từ sổ chỉ ghi thêm của G04; nhãn việc: cộng kèm khoá (`grant`), chấm bài (`reserve`), hoàn do lỗi (`release`), cấp thêm (`grant_extra`), điều chỉnh (`admin_adjust`), hết hạn (`expire`), chuyển lượt chưa dùng khi đăng ký lại (`carry_over` — chuyển **toàn bộ**, không còn "50%") — hết hạn phần lượt chuyển (`carry_expire`, G04 thêm theo điểm 23) — đủ tám giá trị `reason` của GOI-04 mục 5.3, 5.9 bản 18/11 chiều; chữ hiển thị lấy `label_vi` G04 trả, giao diện **không** ghi cứng phần trăm hay số ngày. Dòng `carry_over` hiện thêm hạn của phần lượt chuyển (FR-056). **Số dư theo khoá, một kho chung cho Writing và Speaking**, không theo kỹ năng; số dư lấy từ máy chủ. "Điều chỉnh lượt": chọn khoá (quyền còn hiệu lực), cộng hoặc trừ, số nguyên dương, lý do ≥ 10 ký tự, hộp hỏi lại, gửi kèm khoá chống gửi trùng. Không có nút sửa/xoá dòng.
- **FR-048:** _(sửa)_ `/admin/activation-codes` là **sổ tra cứu**: trạng thái Chưa dùng · Đã dùng (kèm người, ngày) · Hết hạn nhập · Đã thu hồi; cột "Số lượt chấm cấp kèm mã". Không có trang tạo mã riêng: nút "Tạo mã cho một lớp" hỏi chọn lớp rồi mở hộp "Cấp mã kích hoạt cho lớp" của trang Lớp.
- **FR-053:** Hộp "Cấp mã kích hoạt cho lớp" (trang Lớp, bản duy nhất) luôn có ô "Số lượt chấm cấp kèm mã"; tạo mã chạy một lần cho cả đợt (lỗi thì không tạo mã nào). Dưới ô ghi đơn vị lượt (chốt 18/11): 1 lượt = 1 bài Writing, hoặc 1 bài Speaking Part 2, hoặc 1 cụm Speaking Part 1 hay Part 3 gồm 2–3 câu (00 mục 2 điểm 22); full test Writing = 2 lượt (đã xác nhận, điểm 23), full test Speaking mô phỏng = 3 lượt.
- **FR-054:** "Cấp thêm lượt cho học viên/lớp…" là một hộp ở trang Lớp (cũng mở từ Lượt AI và hồ sơ): cho cả lớp hoặc người đã chọn, số lượt (cùng đơn vị ở FR-053), lý do bắt buộc. Gọi `POST /admin/credits/grant-extra` của G04; kết quả có hai danh sách: `granted` và `skipped` — hộp hiện "Đã cấp cho N người" và liệt kê người bị bỏ qua kèm lý do (`no_class_entitlement`: học viên dùng mã cũ không kèm lượt, không có nơi nhận lượt; `not_usable`: quyền không còn dùng được lượt). Có người bị bỏ qua vì `no_class_entitlement` → hộp kết quả có nút "Cấp lượt cho lớp cũ…" (FR-057). Hết lượt, học viên lớp thấy "Liên hệ giáo viên để được cấp thêm".
- **FR-056:** _(mới, điểm 23)_ **Lượt chuyển khi đăng ký lại.** Quy tắc (G04 làm, G09 hiển thị): đăng ký lại cùng khoá thì TOÀN BỘ lượt chưa dùng của quyền trước chuyển sang quyền mới; phần lượt chuyển có **hạn riêng** (cấu hình G04 `credit_carry_percent` = 100, `credit_carry_valid_days` = 60; mặc định tạm của G04: tính là đăng ký lại khi đơn cùng khoá được tạo trước ngày hết hạn hoặc trong 60 ngày sau đó; phần lượt chuyển hết hạn sau 60 ngày tính từ ngày khoá mới bắt đầu); không đăng ký lại thì lượt còn lại hết hiệu lực khi khoá hết hạn. Ba màn hiện đúng **số lượt được chuyển** và **hạn của phần lượt chuyển**, lấy từ máy chủ: (1) sổ lượt `/admin/credits` — dòng chuyển lượt và dòng hết hạn phần lượt chuyển; (2) hồ sơ học viên — cột phải thẻ Tổng quan và khối lượt ở thẻ Khoá và quyền; khoá đã hết hạn mà chưa đăng ký lại ghi "N lượt đã hết hiệu lực ngày dd/mm/yyyy" (khi G04 trả dòng `expire`); (3) trang một đơn đăng ký lại — trước khi xác nhận: "Đơn đăng ký lại · sẽ chuyển N lượt chưa dùng, dùng tới dd/mm/yyyy"; sau khi xác nhận: số đã chuyển thật. Giao diện không tự tính số lượt chuyển hay hạn; G04 chưa trả trường tương ứng thì dòng đó ẩn, không đoán.
- **FR-057:** _(mới, điểm 23)_ **Cấp lượt cho lớp cũ** (chuyển lớp đang chạy bằng mã cũ sang đo lượt). Thao tác ở trang Lớp, chỉ vai trò Quản trị: (1) xem trước — danh sách thành viên dùng mã cũ chưa có nơi nhận lượt (`GET /admin/credits/convert-class/preview?cohort_id=…` của G04), kèm số người sẽ được cấp và số người bỏ qua kèm lý do; (2) nhập "Số lượt mỗi người" (số nguyên dương; điền sẵn từ cấu hình G04 `legacy_class_initial_credits` nếu có, không có thì để trống và bắt nhập), dưới ô ghi đơn vị lượt như FR-053; (3) hộp xác nhận nêu tên lớp, số người, số lượt mỗi người, và câu "Sau khi cấp, bài của các bạn này bắt đầu được tính lượt"; (4) gọi `POST /admin/credits/convert-class` (`cohort_id`, `credits_per_member`, `request_key`); (5) kết quả: đã cấp cho N người, bỏ qua M người kèm lý do. Bấm lặp cùng `request_key` không cấp hai lần. Thao tác ghi Nhật ký lớp và Nhật ký hồ sơ từng người. Chưa có tờ thiết kế riêng cho hộp này: dựng từ thành phần có sẵn (hộp xác nhận của "Cấp thêm lượt").
- **FR-058:** _(mới, điểm 23)_ Lớp còn ít nhất một thành viên active dùng mã cũ chưa có nơi nhận lượt là **"lớp chưa chuyển sang đo lượt"** (mặc định tạm của G04: thành viên đó chưa bị đo cho tới khi lớp được chuyển). Danh sách lớp gắn nhãn "Chưa chuyển sang đo lượt" kèm số người; đầu trang lớp có dải thông báo với nút "Cấp lượt cho lớp cũ…"; Việc cần làm có dòng "Lớp chưa chuyển sang đo lượt" (FR-090). Lớp đã lưu trữ không tính.
- **FR-055:** Thu hồi mã chưa dùng: mục cuối menu "⋯". Thu hồi mã đã dùng: chỉ ở Vùng nguy hiểm trang mã, gõ đúng mã, lý do bắt buộc, nói rõ học viên mất quyền.

**Chấm bài**
- **FR-060:** _(sửa)_ Nhóm Chấm bài gồm ba mục: Writing · Speaking · Yêu cầu chấm lại. **Chỉ Writing của lớp offline** vào hàng chờ duyệt. Speaking luyện tập (lớp offline và khoá online) AI chấm và trả ngay, không có hàng chờ. Hàng chờ Speaking **chỉ** gồm Speaking thi thử chờ giáo viên chấm (AI chỉ đề xuất). Bài khoá online và tự luyện chỉ tới giáo viên qua Yêu cầu chấm lại.
- **FR-061:** `/admin/writing/status?essay_id=` thành khối trạng thái trong màn chấm; route cũ 307 tới `/admin/writing/grade?essay_id=…&panel=status`.
- **FR-062:** _(sửa)_ Yêu cầu chấm lại: trạng thái Mới → Đang xem → Đã trả lời; hiện nguyên văn lý do; "Giữ nguyên điểm" bắt buộc giải thích ≥ 40 ký tự; "Điều chỉnh điểm" mở màn chấm ở chế độ chấm lại; "Chấm lại bằng AI" qua hộp cảnh báo chi phí. Không quyết định nào trừ lượt của học viên.
- **FR-063:** Mở `/admin/mock-reviews` không có tham số không bao giờ ra lỗi "Thiếu mock_exam_id".
- **FR-064:** Nhãn "Hàng đợi Instructor", "Claim atomic", "canonical", "OWNER-SCOPED QUEUE" thay bằng lời thường.
- **FR-065:** Phím tắt màn chấm Writing: Ctrl Enter = "Trả bài và mở bài kế" (trả ngay, có thu hồi); J/K chỉ chuyển bài. Màn chấm Speaking thi thử: Ctrl Enter = lưu điểm và mở bài kế. Không bắt phím khi con trỏ trong ô nhập (trừ Ctrl Enter).
- **FR-066:** Sắp xếp hàng chờ "Lớp có buổi học sớm nhất trước": theo `class_lessons.lesson_date` kế tiếp của lớp, rồi chờ lâu nhất. Đầu màn chấm ghi "còn N bài · M bài của lớp học hôm nay".
- **FR-067:** Dải tóm tắt dưới tên học viên ở màn chấm: band 4 bài gần nhất đã trả (cùng kỹ năng), mục tiêu band, loại chú thích/lỗi lặp nhiều nhất kèm số bài, link hồ sơ. Thiếu dữ liệu ghi "chưa có bài" / "mục tiêu chưa đặt"; không ghi band.
- **FR-068:** Quá hạn ở mọi hàng chờ so với bảng ngưỡng ở Cài đặt; mốc của bài chờ duyệt là lúc AI chấm xong (bài AI lỗi: lúc nộp). Trang không ghi số giờ riêng.
- **FR-069:** Bài Writing và Speaking thi thử: chấm xong là lưu điểm vào kỳ thi; **không có nút trả** ở hàng chờ hay màn chấm.

**Nội dung và báo cáo**
- **FR-164:** `/admin/reports` một trang 4 thẻ (`?tab=hoat-dong|luu-luong|chi-phi-ai|chat-luong`), khoảng thời gian dùng chung (`?range=7|30|90`); bốn mục sidebar nhóm Báo cáo trỏ thẳng thẻ tương ứng.

**Hệ thống, cài đặt, tìm nhanh, vùng nguy hiểm**
- **FR-070:** _(sửa)_ `/admin/incidents` thay ba trang cũ; thẻ nguồn trên URL (`?source=errors|grading|feedback`); số cạnh thẻ là số **nhóm** chưa xử lý.
- **FR-071:** _(sửa)_ Gom nhóm lỗi hệ thống theo nguồn, mức, đường dẫn đã bỏ id, thông báo đã bỏ số. Nhóm có 4 trạng thái: Mới · Đang xem · Đã xử lý · Bỏ qua; nhóm Đã xử lý/Bỏ qua có ghi nhận mới thì tự mở lại thành Mới, giữ ghi chú. "Nhận xử lý" chuyển Mới → Đang xem. Hành động hàng loạt có hộp xác nhận nói số nhóm và số lần ghi nhận.
- **FR-072:** Tên học viên trong sự cố luôn là link tới hồ sơ.
- **FR-073:** _(sửa)_ "Tạo lỗi thử" không ở Hộp thư sự cố: nằm ở `/admin/qa-tools`, chỉ khi môi trường không phải Production (máy chủ cũng chặn).
- **FR-074:** _(sửa)_ `/admin/ai-models` chứa bảng chọn mô hình; `/admin` không còn bảng này. Mỗi thay đổi qua khối xác nhận nói tính năng, cũ → mới, và lý do ≥ 10 ký tự.
- **FR-080:** `/admin/settings` có thẻ `?tab=payment|email|legal|features|trial|notices|thresholds`; chỉ vai trò Quản trị có AAL2. Mọi lưu đi qua máy chủ, ghi một dòng nhật ký: ai, lúc, thẻ, cũ → mới, lý do.
- **FR-081:** **Bảng ngưỡng vận hành duy nhất** ở thẻ `thresholds`. Mọi trang (hàng chờ, Việc cần làm, danh bạ, lớp, giáo viên, kỳ thi, mã, kết quả bài giao) đọc ngưỡng qua một API; không trang nào có hằng số ngưỡng riêng. Giá trị trên tờ thiết kế là **mặc định đề xuất** nạp lúc cài; chủ dự án sửa ở trang này.
- **FR-082:** Thẻ Chấm thử (do GOI-11 T16 dựng) hiện: ba trần cho từng kỹ năng (hạn mức mỗi người, trần mỗi ngày mỗi người, trần mỗi ngày toàn web — **ngân sách 5 USD/ngày**), **hệ số IP dùng chung**, **số lượt bị từ chối vì IP** theo ngày, **công tắc tạm dừng** (tạm dừng không trừ hay xoá lượt của ai). G09 chỉ bảo đảm thẻ nằm đúng trang và sidebar.
- **FR-083:** Thẻ Thư: bốn thư về đơn và thư "Mã đăng nhập" bắt buộc, không tắt được; không có mẫu xác minh email hay đặt lại mật khẩu; tắt loại khác có xác nhận. Thư học viên gửi bằng dịch vụ đã có trong repo (Resend, `backend/services/owner_alerts.py`, biến `RESEND_API_KEY` — điểm 23); không chọn nhà cung cấp trên trang. Đầu thẻ có một dòng chỉ đọc "Địa chỉ gửi": hiện giá trị G04 đang dùng (`LEARNER_EMAIL_FROM`); chưa đặt → dải Cảnh báo "Chưa có địa chỉ gửi. Thư cho học viên chưa gửi được." Câu còn mở chỉ là địa chỉ gửi và tên miền đã xác minh (Q36).
- **FR-084:** Nhóm "Lưu dữ liệu" trong bảng ngưỡng có hai dòng: "Giữ bản ghi âm" mặc định **60 ngày** kể từ lúc ghi (đã chốt, tối đa 60); "Giữ bài làm sau khi khoá hết hạn" **45 ngày** (chốt ở điểm 23) — dòng này **chỉ đọc** (`fixed`), lấy từ cấu hình G04 `RETENTION_CONTENT_DAYS_AFTER_EXPIRY`, không sửa trên trang. Giảm thời gian lưu phải nói rõ việc xoá không lấy lại được.
- **FR-075:** _(sửa)_ Tìm nhanh: kết quả gom Học viên · Lớp · Bài nộp · Đề · Đơn đăng ký, tối đa 3 dòng mỗi nhóm; ↑ ↓ chọn, Enter mở, Esc đóng; tối thiểu 2 ký tự; chờ 250ms.
- **FR-076:** Thao tác phá huỷ không nằm trong dòng bảng cạnh nút thường: nằm ở "Vùng nguy hiểm" cuối trang bản ghi, hoặc mục cuối của menu "⋯", tách bằng đường kẻ.
- **FR-077:** Mỗi thao tác phá huỷ mở hộp xác nhận nói việc sẽ xảy ra và số học viên bị ảnh hưởng; thao tác không hoàn tác được yêu cầu gõ đúng chuỗi xác nhận.
- **FR-078:** Mỗi thao tác phá huỷ được ghi nhật ký ở máy chủ và hiện ở Nhật ký của hồ sơ liên quan.
- **FR-079:** Route đổi quyền học (thu hồi quyền, điều chỉnh lượt, xác nhận đơn, yêu cầu bổ sung, huỷ đơn, tạm dừng/lưu trữ khoá, khoá tài khoản) đòi step-up khi máy chủ yêu cầu; giao diện mở `AdminStepUpDialog` rồi gửi lại, giữ dữ liệu đã nhập.

**Tổng quan và giáo viên**
- **FR-090:** _(sửa)_ `/admin` (Việc cần làm) khối hàng chờ, thứ tự cố định theo mức khẩn: Kỳ thi hôm nay (chỉ hiện trong ngày có kỳ thi, luôn đứng đầu) · Bài chờ duyệt (hai số: Writing · AI lỗi cần chấm tay, AI lỗi nằm trong số Writing) · Bài Speaking thi thử chờ chấm · Bài kiểm tra chờ công bố · Bài giao quá hạn còn người chưa nộp · Yêu cầu chấm lại · Đơn đăng ký · Cần liên hệ hôm nay · Sự cố · Phản hồi · Quyền sắp hết hạn · Lớp chưa chuyển sang đo lượt (FR-058; mở danh sách lớp đã lọc). Mỗi dòng một nguồn riêng; nguồn lỗi → chỉ dòng đó thành Cảnh báo, số ghi "chưa có", nút tải lại riêng; không bao giờ thay bằng 0. Dòng không có việc vẫn hiện "Không có".
- **FR-091:** Khối "Lớp hôm nay và tuần này": mỗi lớp hiện buổi kế tiếp (lớp có buổi hôm nay hiện thêm buổi sau nếu trong 7 ngày); đánh dấu buổi chưa có bài giao hoặc lớp còn bài chờ duyệt; nút "Giao bài…" và "Xem kết quả bài giao".
- **FR-092:** Khối "Cần chú ý tuần này": cùng quy tắc với bộ lọc "Cần chú ý" của danh bạ; tối đa 8 người, xếp theo số lý do rồi theo tên; "Gửi nhắc" mở Gửi thông báo với người đó trong "Danh sách đã chọn".
- **FR-093:** Khối "Vận hành tuần này": ba số, mỗi số có lối vào; thiếu dữ liệu ghi "chưa có". Trang này không có nút trả kết quả thi thử.
- **FR-100:** _(sửa)_ Khu giáo viên dùng cùng khung, nhãn vai trò "Giáo viên", sidebar phẳng **năm mục**: Việc của tôi · Lớp của tôi · Học viên · Giao bài · Chấm và duyệt bài (số = Writing chờ duyệt + Speaking thi thử chờ chấm của các lớp mình).
- **FR-101:** _(sửa)_ Mỗi mục có URL riêng (`/instructor?tab=today|classes|students|assign|grading`), tải lại giữ mục và bước.
- **FR-102:** Mọi truy vấn của giáo viên lọc ở máy chủ theo lớp của giáo viên đó (`cohorts.instructor_id`, tính ở `services/staff_scope.py`); mở lớp khác → về trang cha kèm một dòng giải thích, không lộ tên lớp hay học viên. Tìm nhanh của giáo viên không có nhóm Đề và Đơn đăng ký.
- **FR-103:** Admin xem như giáo viên (`?as_instructor=`) giữ dải thông báo và nút thoát.
- **FR-104:** "Việc của tôi" dùng cùng API với Việc cần làm, máy chủ lọc theo lớp của giáo viên; bỏ các dòng đơn đăng ký, sự cố, phản hồi, kỳ thi và khối vận hành. Khu giáo viên không trả kết quả thi thử, không thao tác mã/quyền/lưu trữ, không thấy Nhật ký lớp.
- **FR-105:** Admin và giáo viên đăng nhập không mật khẩu (Google hoặc mã 6 số qua email) và **không** bị giới hạn một phiên; quản trị vẫn bắt buộc xác thực hai bước (spec 0032). Lời mời giáo viên: email hợp lệ, chưa là nhân sự, không phải tài khoản học viên; có hạn; hết hạn hiện "Hết hạn" kèm "Mời lại".
- **FR-106:** Trang Giáo viên là bảng sắp xếp được (thay lưới thẻ); hồ sơ giáo viên là route con. Cột "Lớp phụ trách" liệt kê các lớp có `cohorts.instructor_id` là người đó. "Gỡ khỏi lớp" làm lớp **không còn giáo viên** (chỉ admin thấy và xử lý); hộp hỏi lại nêu số bài Writing chờ duyệt và Speaking thi thử chờ chấm sẽ chuyển về hàng chờ của admin. "Đổi giáo viên của lớp" là thay thẳng người này bằng người khác (một bước), không có trạng thái hai giáo viên cùng lúc.
- **FR-107:** "Gửi thông báo" khớp GOI-11 phần A: máy chủ tính số người nhận theo bộ chọn và kênh; hộp xác nhận nêu đúng số đó; gửi tất cả phải gõ "gửi tất cả"; hẹn giờ huỷ được tới trước giờ gửi. Người nhận "Danh sách đã chọn" chỉ nhận danh sách đẩy sang từ Danh bạ, bảng lớp, Kết quả bài giao, Việc cần làm, kèm dòng nguồn; ở đây chỉ bớt người. Giáo viên chỉ chọn được lớp của mình và học viên đang là thành viên active của các lớp đó (cùng `staff_scope`); thư và "tất cả" chỉ admin (GOI-11).
- **FR-108:** _(mới, điểm 23)_ **Mỗi lớp có nhiều nhất một giáo viên.** Trang Lớp hiện "Giáo viên" của lớp ở đầu trang và ở danh sách lớp; chỉ Quản trị đổi được, bằng một ô chọn một người (vai trò `instructor` hoặc `admin`; có lựa chọn "Chưa có giáo viên"). Không màn nào có điều khiển thêm giáo viên thứ hai, đồng giáo viên hay trợ giảng. Lớp chưa có giáo viên: chỉ admin thấy; danh sách lớp ghi "chưa có giáo viên". Đổi giáo viên ghi Nhật ký lớp; người cũ mất quyền với lớp ngay ở lần gọi API kế tiếp.

**Quyền**
- **FR-110:** Mọi API mới gọi `require_admin` (hoặc `require_instructor`) là lệnh `await` đầu tiên của handler; `test_staff_guard_inventory.py` qua mà không thêm ngoại lệ.
- **FR-111:** Không màn nào đọc/ghi Supabase trực tiếp từ trình duyệt.
- **FR-112:** Ẩn/hiện theo vai trò chỉ là giao diện; gọi thẳng API bằng tài khoản không đủ quyền phải nhận 403 (có test).
- **FR-113:** API cho phép giáo viên (kết quả bài giao, giao bài, gửi nhắc, công bố điểm, việc của tôi) kiểm lớp thuộc giáo viên bằng một hàm chung (5.4 `staff_scope`); lớp không thuộc → 404, không phải 403, để không lộ lớp tồn tại. `services/staff_scope.py` là **nơi duy nhất** trả lời "lớp này có phải của giáo viên này không" (`cohorts.instructor_id = user_id`); không router, service hay truy vấn nào khác tự so `instructor_id` của lớp.

## Acceptance scenarios

Kịch bản của gói (mục 9), giữ số gốc. Môi trường: preview Vercel của nhánh + backend staging, tài khoản QA admin có TOTP.

1. Given admin AAL2, When mở mọi route loại `nav` ở 5.1, Then đúng một mục sidebar được tô, sidebar đúng 8 nhóm theo bảng chuẩn, không có "Giáo viên duyệt", không có mục nhập/tải lên, nhãn "Staging · dữ liệu thử" hiện cả ở 390px.
2. Given admin, When mở `/admin/listening/import-drills` bằng đường dẫn, Then trang còn sống, có dải "Trang nhập thủ công đã ẩn…" và nút "Vẫn mở"; sidebar không có mục này.
3. Given admin đổi chế độ hiển thị sang Tối, When tải lại, Then khung và các màn mới ở nền tối, chữ đạt tương phản; chọn "Theo thiết bị" thì theo hệ điều hành.
4. Given admin, When mở `/admin/learners`, tìm email học viên kiểm thử, bấm tên, Then tới `/admin/learners/u-…`; dán link sang tab mới vẫn đúng hồ sơ và thẻ.
5. Given hồ sơ chỉ có `students`, When mở `s-…`, Then đầu trang ghi "Chưa có tài khoản", không lỗi trang, không band.
6. Given học viên kiểm thử có mục tiêu khác nhau ở hai nguồn, When bấm "Dùng giá trị này" ở nguồn admin và xác nhận, Then cả hai nguồn bằng nhau và Nhật ký hệ thống có một dòng.
7. Given admin thêm ghi chú chăm sóc có ngày hẹn hôm nay, When mở `/admin`, Then "Cần liên hệ hôm nay" là 1; When đánh dấu xong, Then dòng ghi "Không có".
8. Given ngưỡng "Bài Writing chờ giáo viên duyệt" = 48, When admin đổi thành 1 ở Cài đặt › Ngưỡng vận hành và lưu, Then bài kiểm thử đã chờ 2 giờ hiện "quá hạn" ở hàng chờ Writing và ở Việc cần làm; nhật ký cài đặt có dòng cũ → mới.
9. Given một nguồn của Việc cần làm lỗi (giả lập), When mở `/admin`, Then chỉ dòng đó thành cảnh báo với "chưa có" và nút tải lại; các dòng khác có số; không dòng nào hiện 0 thay cho lỗi.
18. Given bài Speaking luyện tập của lớp offline vừa nộp, When mở Chấm bài › Speaking, Then bài đó không có trong hàng chờ; số trên sidebar chỉ đếm Speaking thi thử chờ chấm.
19. Given đơn kiểm thử ở "Đã báo chuyển" (sau G04), When admin điền nhanh, kết quả "Khớp", xác nhận, Then hộp nêu năm việc; sau đó đơn "Đã xác nhận", hồ sơ có khoá hạn đúng, sổ lượt có dòng cộng theo khoá, tài khoản vào được Reading/Listening; bấm lần hai → "đã xác nhận", không cấp thêm. When yêu cầu bổ sung, Then bắt buộc lời nhắn và hạn.
20. Given admin tạo 3 mã cho lớp kiểm thử kèm 5 lượt (sau G04), When mở `/admin/activation-codes`, Then thấy 3 mã với cột lượt = 5; trang không có biểu mẫu tạo mã; When cấp thêm 2 lượt cho một học viên, Then sổ lượt người đó có dòng mới kèm lý do.
21. Given lớp kiểm thử có 2 thành viên dùng mã cũ chưa có nơi nhận lượt (sau G04), When admin mở `/admin`, Then dòng "Lớp chưa chuyển sang đo lượt" là 1 và danh sách lớp có nhãn "Chưa chuyển sang đo lượt · 2 người"; When admin mở "Cấp lượt cho lớp cũ…", xem trước, nhập 10, xác nhận, Then kết quả "Đã cấp cho 2 người", sổ lượt mỗi người có dòng cộng 10, nhãn và dòng ở Việc cần làm biến mất; bấm xác nhận lặp không cấp lần hai; tài khoản giáo viên không thấy nút.
23. Given học viên kiểm thử có khoá online sắp hết hạn, còn 3 lượt chưa dùng, và có đơn đăng ký lại cùng khoá ở "Đã báo chuyển" (sau G04), When admin mở trang đơn, Then thấy "Đơn đăng ký lại · sẽ chuyển 3 lượt chưa dùng, dùng tới <ngày>"; When xác nhận, Then sổ lượt có dòng chuyển 3 lượt (toàn bộ, không phải một nửa) kèm hạn, hồ sơ học viên hiện "3 lượt chuyển từ khoá trước, dùng tới <ngày>"; không màn nào có chữ "50%". Given học viên khác hết hạn khoá mà không đăng ký lại, Then hồ sơ ghi số lượt đã hết hiệu lực và ngày.

## Edge cases

Ca biên phải có test tự động: gán giáo viên cho lớp bằng người không phải nhân sự → 422; lớp `instructor_id` NULL → giáo viên nào gọi cũng 404; `self_paced_timeline` không bao giờ trả trạng thái giữa hai phần sau khi đã bắt đầu; cộng giờ cho phần không chạy của kỳ tự làm → 409; `classes_unmetered` khi G04 chưa có → `unavailable`, không phải 0; G04 không trả lượt chuyển → dòng lượt chuyển ẩn; `ref` sai định dạng → 404; q tìm kiếm 1 ký tự → 422; nguồn tổng hợp lỗi → 200 + `sources_failed`; ngưỡng ngoài khoảng → 422; ngưỡng `null` → lý do tương ứng không bật; nhắc lần hai trong ngày → bỏ qua; nhóm sự cố có dòng mới khi xử lý → 409; xác nhận gõ sai chuỗi → nút không bật; step-up hết hạn → dialog rồi gửi lại; kỳ thi không có kỹ năng nào → 422; tên chế độ cũ gửi vào API admin được ánh xạ; ghi lô lỗi không làm hỏng script nhập.

| Tình huống | Dấu hiệu nhận biết | Cách gỡ | Khi nào dừng và hỏi |
|---|---|---|---|
| Test đọc chuỗi `aver-admin-chrome.js` vỡ | `aver-admin-chrome.test.mjs` không parse được `NAV_GROUPS` | Không đổi `NAV_GROUPS` của element; khung mới đọc sổ đăng ký riêng | G10 đã xoá element: theo G10 |
| Thêm route mới trước G10 | Phải tạo `(authed-admin-xxx)/layout.tsx` | Không tạo; chờ G10 | G10 chậm hơn 3 nhiệm vụ backend: hỏi có cho tạo tạm một group dùng chung không |
| Route vừa là route vừa là redirect | `route-ownership-check.mjs` báo SHADOWED | Xoá `page.tsx` cũ và thêm redirect cùng commit | — |
| API G04 chưa có hoặc khác tên | Import/endpoint không tồn tại; GOI-04 bản mới đổi tên trường | Theo GOI-04 bản mới; trường liên quan trả `null`, giao diện "chưa có"; T13–T15 dừng | Không tự viết API G04 |
| Bảng công bố điểm | (đã khớp 18/11) G11-T28 **ĐÃ BỎ**; G09-T30 là nơi duy nhất dựng giao diện; ô "Chế độ trả điểm" lúc giao bài nằm trong `AssignDrawer` (T26); backend ở GOI-11 T21–T24 | Làm T30 sau khi GOI-11 T23 merge | — |
| GOI-11 T13/T16 và G09-T23/T40 cùng sửa một trang | Xung đột ở `settings/page.tsx`, trang Gửi thông báo | Bên vào sau rebase; mỗi bên chỉ thêm thẻ/khối của mình | — |
| Phía học viên chưa đọc bảng người dự thi | Học viên lớp thứ hai không vào được phòng live | `schedule` từ chối kỳ live nhiều nguồn khi cờ `mock_exam_audiences_learner` tắt (T31) | Luôn báo G08 trước khi bật |
| Phía học viên của kỳ tự làm còn cho nghỉ giữa phần | Thẻ Theo dõi thấy người ở giữa hai phần mà không đồng hồ nào chạy; G08-T22 chưa merge | Màn admin vẫn tính theo `self_paced_timeline` (5.5) và ghi rõ trong PR là phía học viên chưa khớp; **không** lên lịch kỳ tự làm nhiều phần cho lớp thật trước khi G08-T22 lên staging | Luôn báo người điều phối |
| API `convert-class` của G04 chưa có hoặc khác hợp đồng | 404 khi gọi `preview`; tên trường khác bảng 5.4 | T43 dừng; nhãn và dòng "Lớp chưa chuyển sang đo lượt" hiện "chưa có"; theo GOI-04 khi có | Không tự viết lệnh cấp lượt ở G09 |
| G04 chưa trả số lượt chuyển và hạn của phần lượt chuyển | Trường không có trong `GET /admin/users/{id}/credits` | Ẩn dòng lượt chuyển ở sổ lượt, hồ sơ, trang đơn; không tự tính từ sổ | Báo G04 |
| Ngưỡng bị ghi cứng lại ở một trang | `grep -rnE "(24|48|72) ?giờ" frontend/components/admin` ra mã không phải test | Thay bằng `useThreshold` | — |
| Lệch số đếm do ẩn dữ liệu kiểm thử | Danh bạ khác số trang cũ | Dùng `test_data_visibility` cho mọi API mới; ghi số trước/sau trong PR | Lệch không giải thích được |
| Step-up mới cho route G04 | API G04 không gọi `require_recent_mfa` | Không thêm ở frontend; ghi `CẦN ANH ANDY QUYẾT` (Q7) | Luôn hỏi (đổi spec 0032) |
| Dữ liệu cá nhân trong ảnh PR hoặc URL | Ảnh có email thật; danh sách người nhận trong query | Chỉ chụp tài khoản `@staging-e2e.averlearning.com`; danh sách đi bằng state điều hướng | Có dữ liệu thật trong ảnh: xoá ảnh |
| PR #2254 (0049) merge giữa chừng | Sidebar/giao bài trên staging đổi | G09 vẫn là chuẩn: rebase, giữ sổ đăng ký G09; liệt kê phần giao bài của 0049 không trùng để giữ | Mã 0049 xoá API mà G09 đang gọi: hỏi |
| Số migration 440–451 đã bị gói khác dùng | Sổ đăng ký migration có số trùng | Lấy số trống kế tiếp trong 440–459, cập nhật bảng 5.3 trong PR | Hết dải 440–459: dừng, xin thêm dải |
| Trang cũ trong khung mới ở nền tối bị lệch màu | Chữ tối trên nền tối ở trang chưa chuyển | Trang chưa chuyển giữ `data-theme="light"` trong vùng nội dung | — |

**Chỗ G09 đòi gói khác phải khớp** (người điều phối sửa gói kia; người thực thi G09 không sửa file gói khác). Các dòng thêm ở bản 18/11 chiều (điểm 23) ghi "(mới 18/11 chiều)" — chưa đối chiếu với thân GOI-04, GOI-08 vì hai gói đó đang được sửa song song. **Trạng thái sau khớp chéo 18/11/2026:** các dòng GOI-04 đã có trong GOI-04 bản 18/11 (đối chiếu ở bảng "API G04 mà G09 gọi", 5.4), trừ thẻ Thanh toán (Q20 còn mở); các dòng GOI-11, GOI-08, GOI-07, GOI-06, GOI-03, GOI-05, 01 đã được đưa vào thân các gói đó, trừ "Nhóm theo điều kiện" của trang Gửi thông báo (GOI-11 chỉ có ba kiểu audience — GOI-11 mục 10 câu 25). Trang `/admin/library` thuộc G06 (G06-T20 mới); script nhập của G06 ghi bản ghi lô qua `import_batch_log.py` (GOI-06 mục 5.8).

| Gói · mục | G09 cần |
|---|---|
| GOI-04 §5.2 (bảng mã/sản phẩm), G04-T06 | Mã kích hoạt của lớp có **số lượt chấm kèm mã**; API tạo mã nhận số lượt; cột đọc được ở sổ mã. |
| GOI-04 §5.6, §5.10 (`CREDIT_COST_SPEAKING_RESPONSE`), G04-T07 | **Đơn vị lượt Speaking** (chốt 18/11): 1 lượt = 1 bài Part 2 hoặc 1 cụm 2–3 câu Part 1 hay Part 3 (đã chốt 18/11; full test Speaking mô phỏng = 3 lượt); bản 16/11 trừ theo từng câu trả lời. G09 chỉ hiện đơn vị này ở ô cấp lượt. |
| GOI-04 §5.3, §5.9 | Lệnh **cấp thêm lượt** cho một người và cho cả lớp (lý do bắt buộc, `request_key`); lý do sổ `carry_over`; số dư **theo khoá**. |
| GOI-04 §5.3, §5.9, §5.10 (mới 18/11 chiều) | **Chuyển toàn bộ lượt khi đăng ký lại** (`credit_carry_percent` = 100, `credit_carry_valid_days` = 60): API admin trả cho mỗi quyền số lượt chuyển còn lại và mốc hết hạn của phần lượt chuyển; trang đơn đọc được "đơn đăng ký lại", số lượt sẽ chuyển (xem trước) và đã chuyển; sổ có dòng hết hạn phần lượt chuyển với `label_vi`; `label_vi` của `carry_over` không còn chữ "50%". |
| GOI-04 §5.9, §5.10 (mới 18/11 chiều) | **Chuyển lớp mã cũ sang đo lượt:** `GET /admin/credits/convert-class/preview?cohort_id=…` (danh sách thành viên dùng mã cũ chưa có nơi nhận lượt, người bỏ qua kèm lý do, số gợi ý từ `legacy_class_initial_credits`), `POST /admin/credits/convert-class` (`cohort_id`, `credits_per_member`, `request_key`; idempotent; chỉ admin); đếm lớp chưa chuyển cho T06 (`classes_unmetered`): `GET /admin/credits/convert-class/pending` / `credits.list_classes_pending_conversion()` — GOI-04 đã có ở bản 18/11 chiều (mục 5.9, 5.18). |
| GOI-04 (lưu dữ liệu) (mới 18/11 chiều) | `RETENTION_CONTENT_DAYS_AFTER_EXPIRY` = 45 đọc được qua một hàm cấu hình để bảng ngưỡng hiện dòng chỉ đọc (5.6); bản ghi âm tối đa 60 ngày kể từ lúc ghi. |
| GOI-04 §5.10 `LEARNER_EMAIL_FROM` (mới 18/11 chiều) | Thẻ Thư đọc được địa chỉ gửi đang dùng (hoặc "chưa đặt") qua API cấu hình chỉ đọc; gửi bằng Resend. |
| GOI-04 §5.5, §5.9 (`request-info`) | Trường **hạn bổ sung** kèm lời nhắn; lý do "sai lệch" là thuộc tính của `needs_info`. |
| GOI-04 §5.3 (`fn_enrollment_order_confirm`), phân xử 4 của 01 | Xác nhận đơn **kích hoạt tài khoản** trong cùng giao dịch; response nêu đã kích hoạt hay bỏ qua. |
| GOI-04 §5.5 | Đơn `expired` **tự mở lại** khi khoản chuyển khớp mã và đủ học phí (hiện chỉ có `confirm` với `allow_expired`); sự kiện đọc được ở trang đơn. |
| GOI-04 §5.11–5.12, đầu file; GOI-11 phần C (§5.3), G11-T18 | **Bốn** thư (thêm `order_needs_info` có hạn và lời nhắn) — đã khớp 18/11: G04 gửi cả bốn. |
| GOI-04 §5.2 `course_products.status` | Trạng thái **lưu trữ** (phân xử 14) — đã khớp 18/11: G04 có `archived_at` và route `archive`. |
| GOI-04 §5.7, G04-T08 | `review_mode` để hàng chờ Writing lọc đúng "lớp offline"; Speaking lớp offline trả ngay (cờ `speaking_teacher_review` không dùng cho lớp). |
| GOI-04 §5.10 (`ENROLL_BANK_*`), G04-T10 | Thẻ Thanh toán của Cài đặt: đọc/ghi qua cấu hình trên web hay giữ env (Q20); job dọn bản ghi âm đọc `RETENTION_AUDIO_DAYS`. |
| GOI-04 §5.13, G04-T09 | Một phiên mỗi tài khoản **chỉ áp học viên**; không áp admin/giáo viên. |
| GOI-11 §5.1.7, G11-T13 | Trang ở route `/admin/notifications`; audience nhận danh sách học viên đẩy sang; "Nhóm theo điều kiện" (chưa nộp một bài · quyền sắp hết hạn · không hoạt động) đọc ngưỡng từ `GET /admin/settings/thresholds`; phạm vi giáo viên dùng `services/staff_scope.py` (T24) — mỗi lớp một giáo viên, GOI-11 không tự đọc `cohorts.instructor_id`; câu 6 mục 10 của GOI-11 không còn "phụ thuộc Q18 của GOI-09" (Q18 đã đóng). |
| GOI-11 §5.1.3 | Service tạo thông báo `reminder` gọi được từ `POST …/assignments/{a}/remind` với khoá chống trùng theo ngày. |
| GOI-11 §5.2, G11-T16 | Thẻ Chấm thử hiện đủ: ngân sách 5 USD/ngày, hệ số IP dùng chung, số lượt bị từ chối vì IP, công tắc tạm dừng; cùng router `/admin/settings/*` với T22. |
| GOI-11 §5.5.8, G11-T28 | T28 của GOI-11 bỏ phần dựng bảng (G09-T30 làm); câu "không thêm API đọc thứ tư" bỏ (G09-T27 thêm `result`); quyền "giáo viên của lớp" dùng `staff_scope`; `tally` mở rộng vẫn giữ. Nộp trễ/làm bù/làm lại (G11-T25, T26): giao diện để đợt sau. |
| GOI-08 (phòng thi, ThiThu, ThiThuTruocGio) | Cổng vào phòng và danh sách kỳ thi của học viên đọc `mock_exam_audiences` (nhiều lớp, người lẻ); hiểu `live`/`self_paced` (`exam_mode_v2`); kỳ thiếu kỹ năng (không đủ bốn); học viên **chưa được giao thì không thấy** kỳ thi nào; phiếu kết quả có trạng thái "Đang chấm" khi trả từng phần (đã có ở G08-T22, FR-08-043). **(mới 18/11 chiều)** Kỳ `self_paced` chạy liền các phần theo hợp đồng 8 điểm ở 5.5: G08-T22 ghi mốc phần kế ở máy chủ ngay khi phần trước nộp hoặc hết giờ, tự nộp phần hết giờ, bỏ màn chọn phần, dùng chung hàm `services/mock_exam_modes.py::self_paced_timeline` của G09-T31; job quét đi hết chuỗi phần. GOI-08 mục 5 hiện có nhãn "Continue later" cho mock `self_paced` (dòng `sectionDone / nextSection / continueLater`) — phải bỏ "Continue later" và nút "Start next section" do người học quyết định lúc bấm; màn sau khi nộp một phần chỉ là màn chuyển sang phần kế. Câu còn mở dùng chung: Q31. |
| GOI-07 (Lộ trình, Hôm nay, PhieuKetQua) | Bài giao cho "nhóm đã lưu"/chọn tay hiện đúng với người nhận (đã có `recipient_scope='subset'`); màn kết quả bài kiểm tra dùng lại được ở chế độ xem trước cho "Xem như học viên thấy"; thông báo sửa điểm thi thử. |
| GOI-06 | Trang `/admin/library` (tờ AdminThuVienCongKhai) — đã khớp 18/11: G06-T20; script nhập 549 đề ghi bản ghi lô theo `services/import_batch_log.py` (T36). |
| Chưa có gói (mới 18/11 chiều) | Trang "Khảo sát và nhận xét" (tờ AdminKhaoSat) và trang công khai "Học viên nói gì" (tờ HocVienNoiGi): GOI-13 phần A dựng (route `/admin/surveys`; trang công khai G13-A10); khi trang lên, bật mục sidebar và số đếm trong sổ đăng ký G09 (Q34 đã đóng) (sửa 18/11 theo GOI-13). |
| GOI-03 §5.9, bảng component | Khung admin có điều khiển Sáng · Tối · Theo thiết bị; `StaffTopBar` nhãn "Giáo viên". |
| GOI-05 (đăng nhập) | Admin và giáo viên đăng nhập bằng Google hoặc mã email; lời mời giáo viên không dùng mật khẩu. |
| 01-KE-HOACH-TONG mục 6 | Ba số spec cho T21 đã cấp (0085, 0086, 0087); ghi G09 dùng 440–451 (bản 18/11 chiều không thêm migration); số nhiệm vụ G09 nay là 43 mã / 48 PR / 97 phiên. |

## Success criteria

- Mọi kịch bản ở trên có bằng chứng trên `staging` (đã merge), không chỉ preview nhánh (gói mục 9).
- Admin thấy dữ liệu gốc của backend, kể cả lỗi tra cứu và trạng thái dở dang; không trạng thái lạc quan (constitution mục 5).

## Related specifications

- ADMINSIMPLE-0049 (PR #2254, chưa merge, `draft`): theo quyết định 17/11/2026 (00 mục 2 điểm 20), **G09 thay thế phần điều hướng** của 0049 — FR-001 (cờ `ADMIN_NAV_SIMPLIFIED`, `GET /admin/ui-config`), FR-002 (`NAV_GROUPS_SIMPLIFIED`), FR-003 (ẩn không chặn; ở đây là FR-013 kèm dải cảnh báo), FR-004 (chuyển hướng hub; ở đây là FR-010, 307), FR-005 (nhóm thu gọn; ở đây là FR-006), FR-006 (đo đường cũ), FR-010 (cổng xoá giai đoạn 2). **Phần giao bài của 0049, từng điểm trùng với thành phần giao bài dùng chung (G09-T26, CLASSRESULT-0085):** FR-007 "Giao bài mới" một nút ở tab Bài tập của lớp ↔ thành phần giao bài dùng chung thay mọi nút giao rời; FR-008 đổi "Gán bài tập" thành "Lịch sử giao Writing" ↔ G09-T26 bỏ hai sổ giao bài. FR-009 (không route nào đổi quyền) giữ, tương thích với FR-110…FR-113 ở đây. Nếu 0049 merge trước, phần mã của 0049 bị thay bởi G09-T08 và G09-T26.
- AIOPS-0024 (trang AI và mô hình), ADMINAAL2-0032 (AAL2, guard nhân sự, step-up — Q7), CALAPPEND-0041 (nhật ký lớp chỉ ghi thêm), LESSONREPORT-0043 (báo cáo bài kiểm tra theo bài học), RLSCLEANUP-0039, ROLECHECK-0026.
- CLASSRESULT-0085, MOCKORG-0086, CONTENTBATCH-0087: ba spec bổ sung của G09-T21, tách vì có migration và hành vi riêng.
- COURSEACCESS-0055 (G04): route và bảng khoá, quyền, lượt, đơn, mã mà các màn G09 gọi; G09 không tạo bảng hay API ghi của G04.
- NOTIFY-0079, TRIALCAP-0080, COURSETESTRELEASE-0082 (GOI-11): gửi thông báo, thẻ Chấm thử của Cài đặt, công bố điểm bài kiểm tra khoá.
- UIBASE-0056 (G03): `StaffShell`, bảng, modal, ngăn kéo; ADMINGROUP-0077 (G10): route group `(authed-admin)`.

## Open questions

Câu hỏi của gói (mục 10) liên quan; mỗi câu có mặc định tạm người thực thi dùng tới khi anh Andy trả lời.

**Đã chốt (không hỏi lại):** Q1 cũ — G09 là chuẩn điều hướng, không theo 0049. Q2 cũ — "giáo viên" mọi nơi. Q4 cũ — đã có tờ AdminDonDangKy, dựng theo tờ. Q8 cũ — khu giáo viên 5 mục, trang đầu "Việc của tôi". Q10, Q11 (kỳ thi tự làm có được nghỉ giữa phần, có được làm lại) — chốt 18/11: thi thử chỉ có khi được giao; một lần; làm lại = thi bù do admin cấp; **chốt 18/11 chiều (điểm 23): KHÔNG nghỉ giữa các phần, đã bắt đầu thì các phần chạy liền nhau** (hợp đồng ở 5.5; chi tiết còn mở ở Q31). **Q18 — chốt 18/11 chiều (điểm 23): mỗi lớp MỘT giáo viên** (hiện tại là anh Andy); một cột `cohorts.instructor_id` (migration 441), không có bảng nhiều giáo viên; `services/staff_scope.py` là nơi duy nhất xác định "lớp của giáo viên"; `students.instructor_id` giữ cho đường Writing cũ. **Lượt chưa dùng — chốt 18/11 chiều:** đăng ký lại thì chuyển toàn bộ, bảo lưu tối đa 2 tháng; không đăng ký lại thì hết hiệu lực khi khoá hết hạn (định nghĩa chi tiết "đăng ký lại" là mặc định tạm của G04, hỏi ở GOI-04). **Lớp chạy bằng mã cũ — chốt 18/11 chiều:** có chuyển sang đo lượt (T43). **Bài làm** giữ 45 ngày sau khi khoá hết hạn; **bản ghi âm** tối đa 60 ngày. **Full test Writing** = 2 lượt (đã xác nhận). **Gửi thư** dùng Resend. **Q30** — tờ `Admin1024.dc.html` đã có trong `thiet-ke/`. Số migration và số spec: anh Andy cấp, không có "Leader" khác.

| # | Câu hỏi | Phương án đề nghị | Mặc định tạm người thực thi dùng |
|---|---|---|---|
| Q3 | Đơn chuyển thừa tiền xử lý thế nào? | Cho xác nhận, ghi chú bắt buộc số thừa, hoàn tiền ngoài hệ thống | Như đề nghị; không có nút hoàn tiền |
| Q5 | Khi nào đổi chuyển hướng admin 307 → 308? | Sau một vòng phát hành không có báo lỗi link | Giữ 307 |
| Q6 | Bật khung admin mới trên production khi nào? | Sau khi anh tự dùng trên staging ≥ 1 ngày làm việc | Cờ tắt ở production |
| Q7 | Có thêm step-up cho đổi model AI, xác nhận/huỷ đơn, thu hồi quyền, điều chỉnh lượt, tạm dừng/lưu trữ khoá không? (đổi spec 0024/0032; tờ AdminDonDangKy, AdminKhoaHoc, AdminLuotVaMa đều ghi "đòi xác thực lại") | Có cho mọi thao tác đổi quyền học; không cho đổi model (đã có khối xác nhận + lý do) | Giao diện xử lý được `step_up_required`; không tự thêm step-up ở backend |
| Q9 | Có cần khoá tài khoản **học viên** từ hồ sơ không? (route hiện viết cho admin/giáo viên) | Có, làm nhiệm vụ backend nhỏ sau T11b | Vùng nguy hiểm chỉ có Gỡ khỏi lớp, Thu hồi quyền học; Khoá tài khoản chỉ hiện nếu route nhận học viên |
| Q12 | Thêm lớp vào kỳ thi: chụp danh sách lúc thêm, hay học viên vào lớp sau tự được dự thi? (người thiết kế giả định chụp) | Chụp; có nút "Cập nhật theo lớp" để thêm người mới | Chụp lúc thêm |
| Q13 | Thi bù theo kỹ năng: gộp kết quả vào kỳ gốc hay giữ kỳ thi bù riêng như hiện nay? | Gộp vào kỳ gốc (phiếu một kỳ) | Giữ cơ chế hiện có (kỳ riêng có `source_exam_id`), hiện liên kết ở thẻ Thí sinh |
| Q14 | Quy tắc trả kết quả thi thử do người thiết kế đề xuất: (a) mặc định chỉ trả người đã chấm đủ kỹ năng của họ; (b) có lựa chọn trả phần đã xong; (c) không thu hồi sau khi trả; (d) gõ tên kỳ thi để xác nhận; (e) sửa điểm sau khi trả bắt buộc lý do và báo thí sinh. Duyệt? | Duyệt cả năm | Dùng (a), (c), (d), (e); (b) sau cờ `mock_partial_release` tắt |
| Q15 | Bảng ngưỡng: (1) duyệt các mặc định ở 5.6; (2) mốc của "Speaking thi thử chờ chấm": tờ Cài đặt ghi "từ lúc thí sinh nộp bài", `CHUAN-ADMIN.md` ghi "từ lúc AI chấm xong"; (3) số cho các ngưỡng chưa có: làm quá nhanh (giây mỗi câu), làm lại nhiều lần, số bài tối thiểu để hiện phân bố band, "dừng lâu" trong nhịp làm bài; (4) có thêm lý do "điểm tụt", "bỏ dở bài", "gần ngày thi mà còn xa mục tiêu" và mức "Có nguy cơ bỏ" không | Duyệt (1); (2) từ lúc nộp; (3) 8 giây · 3 lần · 5 bài · 3 phút; (4) thêm ở đợt sau | (1) dùng mặc định 5.6; (2) từ lúc nộp; (3) để `null` — lý do/khối đó không bật; (4) không dựng |
| Q16 | Ghi chú chăm sóc: (a) được sửa/xoá trong bao lâu (người thiết kế gợi ý 24 giờ, chỉ tác giả); (b) giáo viên có được đọc/ghi ghi chú của học viên lớp mình không | (a) 24 giờ, sau đó chỉ đánh dấu xong; (b) đọc và ghi, không xoá | (a) `CARE_NOTE_EDIT_HOURS=24`, xoá mềm; (b) chỉ admin |
| Q17 | Mục tiêu band và ngày thi hai nguồn: lâu dài giữ nguồn nào làm chính? | `students` (admin) là chính; học viên sửa thì thành đề nghị chờ admin nhận | Giữ cả hai; "Dùng giá trị này" ghi vào cả hai |
| Q18 | **ĐÃ TRẢ LỜI 18/11 chiều** (00 mục 2 điểm 23): mỗi lớp một giáo viên — một cột `cohorts.instructor_id`, không có bảng nhiều giáo viên | — | Migration 441 như 5.3; `students.instructor_id` giữ cho đường Writing cũ, gỡ ở gói sau |
| Q19 | Màn chấm: (a) khoá mềm tự nhả sau 30 phút; (b) Ctrl Enter trả bài ngay không hỏi lại (có thu hồi) | Duyệt cả hai | (a) `REVIEW_SOFT_LOCK_MINUTES=30`, chỉ hiện ai đang giữ, chưa tự nhả ở backend; (b) như tờ |
| Q20 | Thẻ Thanh toán của Cài đặt: sửa tài khoản nhận học phí và hạn giữ đơn trên web (cần G04 đọc từ cấu hình trên web thay cho biến môi trường) hay giữ biến môi trường? | Sửa trên web, có gõ lại số tài khoản và nhật ký | Thẻ chỉ đọc, hiện giá trị G04 trả |
| Q21 | Thẻ Pháp lý (phiên bản điều khoản, buộc đồng ý lại) và thẻ Thông báo hệ thống (bảo trì): làm trong gói này? | Thông báo hệ thống: có; Pháp lý: gói sau | Như đề nghị |
| Q22 | (a) Tác vụ "tính lại điểm cho bài đã nộp khi đăng bản đổi đáp án"; tỉ lệ sai theo câu Listening/Reading toàn kho; lưu `lesson_primary`; tách mã ngộ nhận — làm ở gói nào? (b) Mục do script tạo/cập nhật mặc định vào "Chờ duyệt" (tờ đề xuất; hiện nhiều script đăng thẳng) | (a) gói sau, sau khi 0043 có mã; (b) có, áp cho lần nhập mới | (a) không làm; (b) không đổi hành vi script |
| Q23 | **ĐÃ TRẢ LỜI 18/11** — cấp ba số: CLASSRESULT-0085, MOCKORG-0086, CONTENTBATCH-0087 (`01-KE-HOACH-TONG.md` mục 6) | — | Dùng ba số này |
| Q24 | **ĐÃ KHỚP** — G04 bản 18/11 có lưu trữ khoá (`archived_at`, `POST /admin/course-products/{id}/archive`) | — | Hiện nút Lưu trữ, gọi route G04 |
| Q25 | Trang Lớp: "Tạo lớp ba bước" sinh danh sách buổi từ lịch tuần + ngày khai giảng, và "Dời buổi" (hạn bài chưa tới hạn dời theo) — duyệt luồng này? | Duyệt; làm thành nhiệm vụ riêng sau T29 | Không dựng; buổi tạo tay như hiện nay; cột lịch đã có ở 441 để dùng sau |
| Q26 | Gửi nhắc bài: tối đa một lần mỗi ngày cho mỗi bài mỗi người — duyệt? | Duyệt | Như đề nghị |
| Q27 | Tên hiển thị tiếng Việt cho mã nhóm ngữ pháp (`truc_nhom`) và mã dạng câu: ai duyệt, lấy từ đâu? (tên trên tờ AdminKetQuaBaiGiao là tên đề xuất) | Lấy từ dàn bài Course 1, anh duyệt một lần | File nhãn rỗng; giao diện hiện mã cho tới khi có tên |
| Q28 | Hạn của lời mời giáo viên; hạn mặc định của "hạn bổ sung" đơn | 7 ngày · 3 ngày | Cấu hình, để trống thì không có hạn mặc định (admin phải chọn hạn bổ sung) |
| Q29 | **ĐÃ TRẢ LỜI 18/11** (00 mục 2 điểm 22): Part 3 tính như Part 1 — một cụm 2–3 câu là một lượt; full test Speaking mô phỏng = 3 lượt | — | G09 chỉ hiển thị, cách trừ do G04 làm |
| Q30 | **ĐÃ ĐÓNG 18/11 chiều** — tờ `Admin1024.dc.html` đã có trong `thiet-ke/` | — | T17, T18, T29 dựng bản 1024px theo tờ |
| Q31 | **(mới)** Kỳ tự làm chạy liền các phần — bốn chi tiết: (a) người thi mất mạng hoặc đóng trình duyệt giữa chừng thì đồng hồ có dừng không; (b) giữa hai phần có một khoảng chuyển cố định vài chục giây (đọc hướng dẫn phần kế) như kỳ live không; (c) đã bắt đầu gần cuối khoảng mở thì được làm hết hay bị cắt khi khoảng mở đóng; (d) nộp sớm một phần thì phần kế bắt đầu ngay hay chờ tới đúng giờ | (a) không dừng, như full test (00 điểm 22); (b) không, hoặc tối đa 60 giây cố định không bấm bỏ qua được; (c) làm hết, trang bắt đầu cảnh báo khi khoảng mở còn ngắn hơn tổng thời lượng; (d) bắt đầu ngay | (a) đồng hồ không dừng, phần hết giờ tự nộp; (b) `MOCK_SELF_PACED_GAP_SECONDS=0`; (c) làm hết; (d) bắt đầu ngay. Cùng mặc định với G08-T22 |
| Q32 | **(mới)** Cấp lượt cho lớp cũ: (a) số lượt mặc định mỗi người (`legacy_class_initial_credits`); (b) lớp chưa được chuyển thì thành viên dùng mã cũ vẫn làm bài không bị đo — tới khi nào; (c) giáo viên có được tự chạy thao tác này cho lớp mình không | (a) anh điền một số theo số buổi còn lại của lớp; (b) tới khi admin chuyển, Việc cần làm nhắc mỗi ngày; (c) chỉ admin | (a) để trống, admin phải nhập mỗi lần; (b) như mặc định tạm của G04: chưa chuyển thì chưa đo; (c) chỉ admin (mặc định tạm 18/11, chờ anh Andy xác nhận) |
| Q33 | **(mới)** Hồ sơ học viên của khoá đã hết hạn mà chưa đăng ký lại: trong 60 ngày còn được chuyển lượt, có hiện "còn N lượt sẽ được chuyển nếu đăng ký lại trước dd/mm" để admin tư vấn không? (phụ thuộc cách G04 ghi: đóng sổ ngay khi hết hạn hay chờ hết 60 ngày) | Có hiện, khi G04 trả được số đó | Chỉ hiện những gì G04 trả; không tự tính |
| Q34 | **(mới) — ĐÃ ĐÓNG (sửa 18/11 theo GOI-13): GOI-13 phần A nhận dựng trang AdminKhaoSat (`/admin/surveys`) và trang công khai "Học viên nói gì"; hai ngưỡng khảo sát đã thêm vào 5.6.** Trang "Khảo sát và nhận xét" (tờ AdminKhaoSat; có trong sidebar chuẩn 18/11 với số đếm nhận xét chờ duyệt) và trang công khai "Học viên nói gì" (tờ HocVienNoiGi) chưa có gói nào nhận dựng. Giao cho gói nào? Hai ngưỡng khảo sát ở `CHUAN-ADMIN.md` mục D cũng chưa có trong bảng 5.6 | Một gói riêng nhỏ sau G09-T08 (hoặc thêm vào G05/G06 phần công khai và G09 phần admin); nhận xét hiện ở trang sáu khoá online, không ghi là của lớp offline | Mục sidebar có mặt, trạng thái "Chưa mở", không số đếm; không dựng trang; không thêm hai ngưỡng khảo sát |
| Q35 | **(mới)** Lớp đang có mà migration 441 không suy được giáo viên (hiện production chưa có tài khoản vai trò giáo viên): để trống hay gán hết cho anh Andy? | Để trống — anh là admin nên vẫn thấy mọi lớp; chọn giáo viên khi có người dạy thứ hai | Để NULL, in danh sách lớp ra NOTICE, danh sách lớp ghi "chưa có giáo viên" |
| Q36 | **(mới)** Thư cho học viên gửi bằng Resend (đã có trong repo): địa chỉ gửi và tên miền đã xác minh là gì? (cùng câu Q9 của GOI-04) | `hoc@averlearning.com` sau khi xác minh tên miền ở Resend | Thẻ Thư hiện dòng chỉ đọc; chưa đặt thì Cảnh báo "Chưa có địa chỉ gửi", không gửi thử |
