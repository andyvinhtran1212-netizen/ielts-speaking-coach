# GÓI 09 — Khu quản trị và khu giáo viên

Đã viết lại ngày 18/11/2026 theo các quyết định tới 17/11/2026 (`00-QUY-UOC-CHUNG.md` mục 2 điểm 8, 15, 17–21; `thiet-ke/CHUAN-ADMIN.md` kể cả phần "Sửa đổi 17/11 chiều"; bộ tờ Admin đã kiểm duyệt theo `khao-sat/kiem-duyet-admin.md`).

**Khớp chéo ngày 18/11/2026:** đối chiếu lại với GOI-04 bản 18/11 — thêm bảng "API G04 mà G09 gọi" ở mục 5.4 (`request-info` với `info_kind` + `supplement_by`; huỷ đơn với `confirm_order_code`, `cancel_reason`/`cancel_note`; `POST /admin/credits/grant-extra` có danh sách `skipped`; `POST /admin/course-products/{id}/archive`; một kho lượt; tạo mã kèm `grant_credits`); nhãn sổ lượt thêm `grant_extra`; ba số spec đã cấp: CLASSRESULT-0085, MOCKORG-0086, CONTENTBATCH-0087 (Q23 đóng); Q24 đóng (G04 có lưu trữ); GOI-11: G11-T28 đã bỏ (T30 là nơi duy nhất dựng bảng công bố), service nhắc và `staff_scope` đã ghi ở GOI-11; hồ sơ học viên **không** có khối "đồng ý dùng bản ghi âm" (tính năng hoãn 18/11). Số nhiệm vụ, PR, phiên lúc đó: 42 mã (43 dòng), 47 PR, 95 phiên (số hiện hành ở dòng cập nhật dưới).

**Cập nhật 18/11/2026 chiều (00 mục 2 điểm 23):** (a) mỗi lớp MỘT giáo viên — T24 chỉ thêm một cột `cohorts.instructor_id` (migration 441), không có bảng nhiều giáo viên; `services/staff_scope.py` là nơi duy nhất xác định "lớp của giáo viên"; Q18 đóng; thêm FR-09-108. (b) Lượt chưa dùng: bỏ "chuyển 50%"; đăng ký lại thì chuyển TOÀN BỘ, phần lượt chuyển có hạn riêng (60 ngày); không đăng ký lại thì lượt hết hiệu lực khi khoá hết hạn — sửa FR-09-047, 049; thêm FR-09-056; sửa T04, T11a, T13, T15. (c) Lớp chạy bằng mã cũ CÓ chuyển sang đo lượt: thêm FR-09-057, 058, nhiệm vụ mới **T43** "Cấp lượt cho lớp cũ" (API G04 `convert-class`), dòng "Lớp chưa chuyển sang đo lượt" ở Việc cần làm (T06, T18) và nhãn ở danh sách lớp. (d) Kỳ `self_paced` KHÔNG nghỉ giữa các phần: một mốc bắt đầu, các phần chạy liền nhau — sửa FR-09-143, 146, 148, 149; thêm FR-09-151; viết lại mục 5.5 phần tự làm; sửa T31–T34; Q10/Q11 đóng hẳn, câu còn mở dời vào Q31. (e) Khác: bài làm giữ 45 ngày sau khi khoá hết hạn (dòng chỉ đọc ở bảng ngưỡng); full test Writing = 2 lượt (đã xác nhận); gửi thư dùng Resend, còn mở địa chỉ gửi (FR-09-083); sidebar thêm mục "Khảo sát và nhận xét" theo `CHUAN-ADMIN.md` bản 18/11 (trang chưa có gói dựng — Q34); tờ `Admin1024.dc.html` đã có (Q30 đóng). (g) Rà soát từng dòng: sửa 17 chỗ lệch và đưa 6 câu mới vào mục 10 (Q31–Q36); các chỗ chính: `cohorts.archived_at` là migration 337 không phải 326; danh sách lớp chuẩn là `student_cohort_memberships` migration 227; lỗi 409 trùng bài giao ở dòng ~995; kiểm kê guard chỉ nhận hàm bọc cùng module; trường `unavailable` của `Q`; cờ `mock_partial_release`. Hiện trạng repo kiểm lại ở staging `c3bc71574` (15/11). Chữ "bot" ở các câu nói về người làm đổi thành "người thực thi" (project Claude Code của repo averlearning.com). **Số hiện hành: 43 mã (44 dòng bảng), 48 PR, khoảng 97 phiên; migration vẫn 440–451.**

### Thay đổi so với bản 16/11

- Điều hướng: G09 là chuẩn, **không** theo spec 0049 (Q1 cũ đã chốt). Sidebar 8 nhóm theo `CHUAN-ADMIN.md` mục A: bỏ "Giáo viên duyệt" và "Chấm bài › Thi thử"; thêm "Gửi thông báo", "Thư viện công khai", "Cài đặt"; không có mục tải lên. Khung giáo viên 5 mục (trước là 4).
- Trang nhập nội dung thủ công bị ẩn khỏi sidebar; ba trang Nội dung còn 4 thẻ, có thẻ "Lô nhập" chỉ đọc.
- Màn mới: Kết quả một bài giao · Tổ chức kỳ thi và trang một kỳ thi 7 thẻ · Cài đặt · Chấm Speaking thi thử · bảng công bố điểm bài kiểm tra khoá · trang Báo cáo một trang bốn thẻ.
- Hồ sơ học viên đổi từ 6 tab sang 5 thẻ (bản một người dùng), thêm ghi chú chăm sóc; vùng nguy hiểm dời vào thẻ "Khoá và quyền".
- Một thành phần giao bài dùng chung, một bảng ngưỡng (Cài đặt), một nơi trả kết quả thi thử.
- Lượt chấm: một kho chung theo khoá (không theo kỹ năng); mã lớp cấp kèm số lượt; trang Mã kích hoạt chỉ tra cứu.
- Đơn đăng ký: nhãn trạng thái theo tờ AdminDonDangKy; bốn thư; xác nhận đơn = kích hoạt tài khoản.
- Nhiệm vụ: T01–T20 giữ mã (phần lớn sửa nội dung); thêm T21–T42 (18/11 chiều thêm T43). Ước lượng tăng từ 21 PR / 34 phiên lên 47 PR / 95 phiên (18/11 chiều: 48 PR / 97 phiên).
- Migration: dùng 440–451 trong dải 440–459 (mục 5.3).
- Bổ sung theo quyết định 18/11 (nhận lúc viết lại): thi thử chỉ có khi được giao, tự làm đi lần lượt từng phần và làm một lần (FR-09-143; 18/11 chiều: không nghỉ giữa các phần); đơn vị lượt chấm Speaking (FR-09-053); repo chỉ có anh Andy vận hành; bản 1024px có tờ `Admin1024.dc.html` cho ba trang (FR-09-009).

## 1. Tóm tắt

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

## 2. Hiện trạng trong repo (đã kiểm ở staging @ 93c7085; kiểm lại 18/11/2026 ở `c3bc71574`)

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

## 3. Phạm vi

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

## 4. Yêu cầu (FR)

Số FR cũ còn đúng được giữ; FR đổi nghĩa ghi "(sửa)"; FR mới đánh số tiếp trong dải của nhóm.

**Khung và điều hướng**
- FR-09-001: Mọi trang `/admin/**` hiện cùng một thanh trên: logo Ấn ký + "Aver Learning", nhãn vai trò "Quản trị", nhãn môi trường, nút tìm nhanh ("⌘K" trên macOS, "Ctrl K" nơi khác), "Xem như học viên" (`/home`), nút tài khoản.
- FR-09-002: Nhãn môi trường lấy từ runtime config `environment`: `production` → "Production · dữ liệu thật"; khác → "Staging · dữ liệu thử". Không bao giờ ẩn (dưới 768px thành dải ngang dưới thanh).
- FR-09-003 (sửa): Menu tài khoản có: chế độ hiển thị ba lựa chọn Sáng · Tối · Theo thiết bị (GOI-03 mục 5.9, lưu trên trình duyệt bằng khoá `av-theme`); "Sang khu học viên"; "Sang khu giáo viên" khi `role ∈ {instructor, admin}`; "Đăng xuất". Không có mục đổi mật khẩu (đăng nhập không mật khẩu).
- FR-09-004: Trong khung học viên, "Sang khu quản trị" chỉ hiện khi `/auth/me` trả `role = 'admin'`.
- FR-09-005 (sửa): Sidebar có đúng 8 nhóm, đúng mục và thứ tự ở bảng "Sidebar chuẩn" mục 5.1 (gồm mục "Khảo sát và nhận xét" cuối nhóm thứ hai, theo `CHUAN-ADMIN.md` sửa đổi 18/11). Không có mục "Giáo viên duyệt", "Chấm bài › Thi thử", hay mục tải lên / nhập hàng loạt nào.
- FR-09-006: Bấm tên nhóm thì thu/mở; nhóm chứa trang hiện tại mở sẵn; nhóm đang thu hiện tổng số việc chờ của các mục con; trạng thái nhớ theo trình duyệt (localStorage, bọc try/catch).
- FR-09-007: Mục đang ở có gạch trái, chữ đậm, `aria-current="page"`; xác định từ pathname qua sổ đăng ký.
- FR-09-008: Một file sổ đăng ký liệt kê mọi trang admin: đường dẫn, nhóm, mục, loại (`nav` | `tab` | `context` | `hidden` | `redirect`). Test hành vi: mọi `page.tsx` dưới `/admin` có trong sổ; mọi mục sidebar trỏ tới route `nav`.
- FR-09-009: Dòng sidebar cao 36px máy tính, 44px điện thoại; dưới 1200px sidebar chỉ biểu tượng (có `aria-label`, tooltip); dưới 768px thành ngăn kéo. Ở 1024px: ba trang Việc cần làm, Chấm Writing, Lớp theo tờ `Admin1024.dc.html` (đã có trong `thiet-ke/`); mọi trang khác theo quy tắc co giãn chung: sidebar thu thành biểu tượng, bảng cuộn ngang trong hộp và **giữ cột đầu**.
- FR-09-010: Trang bị gộp/bỏ trả chuyển hướng tạm (307) ít nhất một vòng phát hành; đổi 308 khi anh Andy duyệt (Q5).
- FR-09-011: Mở trang thiếu tham số hoặc thiếu quyền → về trang cha gần nhất kèm một dòng giải thích bằng lời thường (tờ ThanhPhanKhungTrang2 mục 10).
- FR-09-012: Số đếm trên sidebar: Đơn đăng ký = đơn `transfer_reported`; Writing = bài Writing lớp offline chờ duyệt (gồm bài AI lỗi); Speaking = bài **Speaking thi thử chờ giáo viên chấm**; Yêu cầu chấm lại = yêu cầu Mới; Hộp thư sự cố = nhóm Mới + Đang xem. Cùng nguồn với Việc cần làm (FR-09-090). Mục "Khảo sát và nhận xét" có số (nhận xét chờ duyệt) khi trang đó được dựng; trước đó mục ở trạng thái "Chưa mở", không có số.
- FR-09-013: Trang nhập thủ công bị ẩn (loại `hidden`, danh sách ở 5.1) vẫn mở được bằng đường dẫn; đầu trang có dải Cảnh báo "Trang nhập thủ công đã ẩn. Nội dung nhập bằng script trên máy chủ." và nút "Vẫn mở" chỉ với vai trò quản trị; mỗi lần bấm "Vẫn mở" ghi một dòng log.
- FR-09-014: Giao diện không bao giờ dùng "giảng viên", "thầy"; dùng "giáo viên". Không "Đơn hàng", "bán", "giá".

**Danh bạ và hồ sơ học viên**
- FR-09-020: `/admin/learners` mỗi người một dòng, hợp nhất `users` và `students`; hồ sơ chưa có tài khoản ghi "Chưa có tài khoản"; tài khoản chưa có hồ sơ ghi "Chưa có hồ sơ học viên" ở cột Dạng. Mặc định ẩn vai trò `admin`/`instructor`.
- FR-09-021 (sửa): Tìm theo tên (không phân biệt dấu), email, mã học viên, mã kích hoạt; lọc theo lớp, Dạng, Trạng thái (Đang học · Sắp hết hạn · Hết hạn · Lưu trữ), Cần chú ý, Lượt chấm còn; phân trang máy chủ **25 dòng**; bộ lọc và trang ghi vào địa chỉ.
- FR-09-022: Mỗi dòng mở `/admin/learners/{ref}`; `ref` = `u-<users.id>` hoặc `s-<students.id>`; người có tài khoản mở bằng `s-…` thì 307 về `u-…`.
- FR-09-023 (sửa): Trang hồ sơ có **5 thẻ** có URL (`?tab=tong-quan|hoc-tap|ghi-chu|khoa-va-quyen|nhat-ky`). Đầu trang giống nhau ở mọi thẻ = khối tóm tắt học viên dùng chung (`CHUAN-ADMIN.md` mục H) + nút "Thêm ghi chú", "Gửi nhắc", "Giao bài", "Cấp quyền luyện lại".
- FR-09-024 (sửa): Thẻ Tổng quan gồm 5 khối: (1) Cảnh báo đang mở; (2) Mục tiêu và ngày thi; (3) Độ liên tục — lưới 8 tuần × 7 ngày; (4) Bài được giao; (5) Điểm theo thời gian; cột phải: việc đã hẹn, khoá và hạn, lượt chấm còn (có phần lượt chuyển thì thêm một dòng "trong đó N lượt chuyển từ khoá trước, dùng tới dd/mm/yyyy" — FR-09-056). Mỗi khối tải riêng; lỗi một khối chỉ khối đó báo, có nút tải lại.
- FR-09-025 (sửa): Thẻ Học tập: bảng bài làm mọi kỹ năng (lọc kỹ năng, trạng thái, "Tải thêm"); "Lỗi lặp lại ở Writing"; "Nhóm ngữ pháp yếu". Mỗi dòng mở màn xem/chấm đúng loại bài.
- FR-09-026 (sửa): Chi phí AI của một người chỉ hiện ở thẻ Khoá và quyền (cửa sổ 7/30/90 ngày, USD 2 chữ số thập phân, ghi rõ lượt gọi chưa có đơn giá).
- FR-09-027 (sửa): Thẻ Nhật ký hệ thống: chỉ ghi thêm, mới trước, lọc theo loại; hợp nhất `access_code_audit`, `staff_security_audit`, `class_action_log`, đổi vai trò, sự kiện quyền/lượt/đơn của G04, sự kiện gộp mục tiêu. **Không** chứa ghi chú chăm sóc.
- FR-09-028: Ngăn kéo chi tiết học viên cũ và modal "Lịch sử quyền" được thay bằng link tới hồ sơ.
- FR-09-029: Trạng thái một dòng: "Đang ổn" hoặc "Cần chú ý: <tối đa hai lý do nặng nhất>". Lý do tính từ bốn ngưỡng ở Cài đặt (trễ liên tiếp, không hoạt động, quyền khoá sắp hết, còn ít lượt chấm). Cùng một hàm máy chủ cho hồ sơ, danh bạ (cột và bộ lọc "Cần chú ý"), Việc cần làm, khu giáo viên. Mức "Có nguy cơ bỏ" và lý do "điểm tụt", "bỏ dở bài", "gần ngày thi" **chưa dựng** (Q15).
- FR-09-030: Khối Mục tiêu hiện cả hai nguồn kèm nhãn nguồn ("Admin nhập", "Học viên khai"). Hai nguồn lệch → mỗi nguồn có nút "Dùng giá trị này"; bấm → hộp hỏi lại → ghi giá trị đó vào **cả** `students.target_band/target_date` và `users.target_band/exam_date`, ghi Nhật ký. Lệch mục tiêu không phải cảnh báo. Band ước tính chỉ hiện khi có bài thi thử gần nhất đủ bốn kỹ năng.
- FR-09-031: Lưới 8 tuần: ô "có học" = ngày (giờ Việt Nam) có phiên học hoặc bài nộp; tuần hiện tại ở dòng cuối, ngày sau hôm nay để trống; kèm chuỗi ngày hiện tại và số phút tuần này so với tuần trước.
- FR-09-032: Ghi chú chăm sóc: mỗi ghi chú có người ghi, ngày giờ, nội dung, việc tiếp theo (tuỳ chọn), ngày hẹn (tuỳ chọn), đã xong lúc. `students.persona_notes` hiện thành ghi chú đầu tiên nhãn "Ghi chú ban đầu". Việc có ngày hẹn ≤ hôm nay và chưa xong vào "Cần liên hệ hôm nay" ở Việc cần làm.
- FR-09-033: Vùng nguy hiểm nằm cuối thẻ Khoá và quyền: Thu hồi quyền học (không hoàn tác, gõ đúng họ tên, lý do bắt buộc); Gỡ khỏi lớp và Khoá tài khoản (hoàn tác được, hỏi lại một bước; khoá tài khoản bắt buộc lý do). Mọi thao tác ghi Nhật ký.
- FR-09-034: Khối tóm tắt học viên dùng chung là một component, dùng ở đầu hồ sơ, ngăn "Xem nhanh" của danh bạ (400px), ngăn học viên của khu giáo viên; đúng 7 trường theo thứ tự `CHUAN-ADMIN.md` mục H; không thêm trường.
- FR-09-035: Thanh hàng loạt của danh bạ: Gán vào lớp · Gửi nhắc đăng ký lại (chuyển sang Gửi thông báo với "Danh sách đã chọn") · Gia hạn quyền luyện lại (lý do bắt buộc, hỏi lại nêu số người, bỏ qua và báo lại người không có quyền luyện lại) · Xuất danh sách (CSV, chỉ cột đang thấy). Không có thao tác nguy hiểm hàng loạt. Giữ "Import CSV" và "Thêm học viên".

**Khoá học, đơn đăng ký, lượt, mã**
- FR-09-040 (sửa): `/admin/courses`: danh sách khoá; trang một khoá 4 thẻ (`?tab=info|curriculum|learners|log`). Nhãn trạng thái: "Sắp mở" = `coming_soon`, "Đang mở đăng ký" = `open`, "Tạm dừng" = `closed`, "Bản nháp" = `draft`. "Lưu trữ": G04 bản 18/11 đã có (`archived_at`, route `archive` — phân xử 14 xong); khoá đã lưu trữ không hiện ở danh mục công khai. Không xoá cứng.
- FR-09-041 (sửa): `/admin/enrollments`: làn theo trạng thái G04 với nhãn admin: `awaiting_transfer` "Chờ chuyển khoản" · `transfer_reported` "Đã báo chuyển" (mặc định) · `needs_info` "Cần bổ sung" · `confirmed` "Đã xác nhận" · `expired` "Hết hạn" · `cancelled` "Đã huỷ". Làn không có đơn ghi 0, không ẩn. Nút không hợp lệ với trạng thái thì ẩn.
- FR-09-042 (sửa): Trang một đơn `/admin/enrollments/{orderCode}`: lời nhắn của học viên; ba ô đối chiếu (số tiền, nội dung chuyển khoản, ngày); nút "Điền đúng học phí, mã đơn, hôm nay"; kết quả đối chiếu tính ở trình duyệt: Khớp · Thiếu · Thừa · Sai nội dung. Thiếu → nút xác nhận khoá. Thừa → xác nhận được, ghi chú bắt buộc, không tự hoàn tiền. Sai nội dung → xác nhận được sau khi đánh dấu đã đối chiếu người chuyển và ghi chú.
- FR-09-043 (sửa): "Yêu cầu bổ sung": lời nhắn bắt buộc và **hạn bổ sung**; đơn sang `needs_info` (sai lệch số tiền là một lý do của `needs_info`, nhãn "Cần bổ sung · sai lệch"); học viên nhận thư "Cần bổ sung / chưa tìm thấy khoản chuyển" chép nguyên văn lời nhắn kèm hạn và đường về trang đơn, song song có thông báo trong ứng dụng.
- FR-09-044: Huỷ đơn: lý do bắt buộc, gõ đúng mã đơn.
- FR-09-049: Hộp "Xác nhận và mở khoá" nêu đúng **năm việc** làm cùng lúc (tờ AdminDonDangKy mục 3a): (1) cấp quyền khoá từ hôm nay tới hết ngày = ngày xác nhận + thời hạn đã chụp lúc tạo đơn (nối tiếp nếu đang có quyền cùng khoá); (2) cộng lượt chấm AI vào sổ lượt (Writing và Speaking dùng chung); đơn là **đăng ký lại** thì dòng này nêu thêm "chuyển sang N lượt chưa dùng của khoá trước, dùng tới dd/mm/yyyy" theo số G04 trả (FR-09-056); (3) **kích hoạt tài khoản** — mở luôn phần luyện Reading, Listening, ngữ pháp, từ vựng dành cho tài khoản đã kích hoạt (tài khoản đã kích hoạt từ trước thì bỏ qua bước này); (4) gửi thư "Khoá đã mở"; (5) ghi vào dòng thời gian của đơn và nhật ký hồ sơ học viên. Năm việc cùng thành công hoặc không việc nào xảy ra; bấm lặp hoặc hai admin cùng bấm → "đã xác nhận", không cấp hai lần.
- FR-09-050: Bốn thư về đơn (tờ EmailMau neo e4, e5, e14, e6): đã tạo đơn · nhắc chuyển khoản một lần trước hạn · cần bổ sung / chưa tìm thấy khoản chuyển · khoá đã mở. Cả bốn bắt buộc, không tắt được ở Cài đặt. Huỷ, hết hạn, báo đã chuyển chỉ là thông báo trong ứng dụng. G09 hiển thị lịch sử thư của đơn; gửi thư là việc của G04/GOI-11.
- FR-09-051: Trang đơn Hết hạn ghi rõ: khoản chuyển khớp mã đơn và đủ học phí lúc tạo đơn sẽ làm đơn tự mở lại và mở khoá; đơn Đã huỷ không bao giờ mở lại. Đơn Chờ chuyển khoản quá hạn tự Hết hạn; Đã báo chuyển và Cần bổ sung không tự hết hạn. (Hành vi do G04 làm; G09 hiển thị đúng sự kiện G04 trả.)
- FR-09-052: Sau khi xác nhận: hiện "Đơn kế tiếp (còn N)" theo hàng Đã báo chuyển, cũ nhất trước; phím J đơn kế, K đơn trước; không bắt phím khi con trỏ trong ô nhập. Cột "Đã chờ" tính từ lúc báo chuyển; vượt ngưỡng ở Cài đặt thì đậm và có biểu tượng cảnh báo.
- FR-09-045 (sửa): Cấp quyền luyện lại: **một** biểu mẫu dùng chung ở trang lớp và hồ sơ (khoá — chỉ Course 1–5 học viên chưa có quyền, trừ khoá của lớp; áp dụng cho; thời hạn; luồng chấm "AI trả ngay" / "qua giáo viên duyệt"; lý do bắt buộc); hỏi lại nêu số người; không tạo mã. Tên nguồn quyền theo G04 (phân xử 12).
- FR-09-046: Thu hồi quyền: vùng nguy hiểm, gõ đúng họ tên, lý do bắt buộc.
- FR-09-047 (sửa): `/admin/credits`: sổ lượt đọc từ sổ chỉ ghi thêm của G04; nhãn việc: cộng kèm khoá (`grant`), chấm bài (`reserve`), hoàn do lỗi (`release`), cấp thêm (`grant_extra`), điều chỉnh (`admin_adjust`), hết hạn (`expire`), chuyển lượt chưa dùng khi đăng ký lại (`carry_over` — chuyển **toàn bộ**, không còn "50%") — hết hạn phần lượt chuyển (`carry_expire`, G04 thêm theo điểm 23) — đủ tám giá trị `reason` của GOI-04 mục 5.3, 5.9 bản 18/11 chiều; chữ hiển thị lấy `label_vi` G04 trả, giao diện **không** ghi cứng phần trăm hay số ngày. Dòng `carry_over` hiện thêm hạn của phần lượt chuyển (FR-09-056). **Số dư theo khoá, một kho chung cho Writing và Speaking**, không theo kỹ năng; số dư lấy từ máy chủ. "Điều chỉnh lượt": chọn khoá (quyền còn hiệu lực), cộng hoặc trừ, số nguyên dương, lý do ≥ 10 ký tự, hộp hỏi lại, gửi kèm khoá chống gửi trùng. Không có nút sửa/xoá dòng.
- FR-09-048 (sửa): `/admin/activation-codes` là **sổ tra cứu**: trạng thái Chưa dùng · Đã dùng (kèm người, ngày) · Hết hạn nhập · Đã thu hồi; cột "Số lượt chấm cấp kèm mã". Không có trang tạo mã riêng: nút "Tạo mã cho một lớp" hỏi chọn lớp rồi mở hộp "Cấp mã kích hoạt cho lớp" của trang Lớp.
- FR-09-053: Hộp "Cấp mã kích hoạt cho lớp" (trang Lớp, bản duy nhất) luôn có ô "Số lượt chấm cấp kèm mã"; tạo mã chạy một lần cho cả đợt (lỗi thì không tạo mã nào). Dưới ô ghi đơn vị lượt (chốt 18/11): 1 lượt = 1 bài Writing, hoặc 1 bài Speaking Part 2, hoặc 1 cụm Speaking Part 1 hay Part 3 gồm 2–3 câu (00 mục 2 điểm 22); full test Writing = 2 lượt (đã xác nhận, điểm 23), full test Speaking mô phỏng = 3 lượt.
- FR-09-054: "Cấp thêm lượt cho học viên/lớp…" là một hộp ở trang Lớp (cũng mở từ Lượt AI và hồ sơ): cho cả lớp hoặc người đã chọn, số lượt (cùng đơn vị ở FR-09-053), lý do bắt buộc. Gọi `POST /admin/credits/grant-extra` của G04; kết quả có hai danh sách: `granted` và `skipped` — hộp hiện "Đã cấp cho N người" và liệt kê người bị bỏ qua kèm lý do (`no_class_entitlement`: học viên dùng mã cũ không kèm lượt, không có nơi nhận lượt; `not_usable`: quyền không còn dùng được lượt). Có người bị bỏ qua vì `no_class_entitlement` → hộp kết quả có nút "Cấp lượt cho lớp cũ…" (FR-09-057). Hết lượt, học viên lớp thấy "Liên hệ giáo viên để được cấp thêm".
- FR-09-056 (mới, điểm 23): **Lượt chuyển khi đăng ký lại.** Quy tắc (G04 làm, G09 hiển thị): đăng ký lại cùng khoá thì TOÀN BỘ lượt chưa dùng của quyền trước chuyển sang quyền mới; phần lượt chuyển có **hạn riêng** (cấu hình G04 `credit_carry_percent` = 100, `credit_carry_valid_days` = 60; mặc định tạm của G04: tính là đăng ký lại khi đơn cùng khoá được tạo trước ngày hết hạn hoặc trong 60 ngày sau đó; phần lượt chuyển hết hạn sau 60 ngày tính từ ngày khoá mới bắt đầu); không đăng ký lại thì lượt còn lại hết hiệu lực khi khoá hết hạn. Ba màn hiện đúng **số lượt được chuyển** và **hạn của phần lượt chuyển**, lấy từ máy chủ: (1) sổ lượt `/admin/credits` — dòng chuyển lượt và dòng hết hạn phần lượt chuyển; (2) hồ sơ học viên — cột phải thẻ Tổng quan và khối lượt ở thẻ Khoá và quyền; khoá đã hết hạn mà chưa đăng ký lại ghi "N lượt đã hết hiệu lực ngày dd/mm/yyyy" (khi G04 trả dòng `expire`); (3) trang một đơn đăng ký lại — trước khi xác nhận: "Đơn đăng ký lại · sẽ chuyển N lượt chưa dùng, dùng tới dd/mm/yyyy"; sau khi xác nhận: số đã chuyển thật. Giao diện không tự tính số lượt chuyển hay hạn; G04 chưa trả trường tương ứng thì dòng đó ẩn, không đoán.
- FR-09-057 (mới, điểm 23): **Cấp lượt cho lớp cũ** (chuyển lớp đang chạy bằng mã cũ sang đo lượt). Thao tác ở trang Lớp, chỉ vai trò Quản trị: (1) xem trước — danh sách thành viên dùng mã cũ chưa có nơi nhận lượt (`GET /admin/credits/convert-class/preview?cohort_id=…` của G04), kèm số người sẽ được cấp và số người bỏ qua kèm lý do; (2) nhập "Số lượt mỗi người" (số nguyên dương; điền sẵn từ cấu hình G04 `legacy_class_initial_credits` nếu có, không có thì để trống và bắt nhập), dưới ô ghi đơn vị lượt như FR-09-053; (3) hộp xác nhận nêu tên lớp, số người, số lượt mỗi người, và câu "Sau khi cấp, bài của các bạn này bắt đầu được tính lượt"; (4) gọi `POST /admin/credits/convert-class` (`cohort_id`, `credits_per_member`, `request_key`); (5) kết quả: đã cấp cho N người, bỏ qua M người kèm lý do. Bấm lặp cùng `request_key` không cấp hai lần. Thao tác ghi Nhật ký lớp và Nhật ký hồ sơ từng người. Chưa có tờ thiết kế riêng cho hộp này: dựng từ thành phần có sẵn (hộp xác nhận của "Cấp thêm lượt").
- FR-09-058 (mới, điểm 23): Lớp còn ít nhất một thành viên active dùng mã cũ chưa có nơi nhận lượt là **"lớp chưa chuyển sang đo lượt"** (mặc định tạm của G04: thành viên đó chưa bị đo cho tới khi lớp được chuyển). Danh sách lớp gắn nhãn "Chưa chuyển sang đo lượt" kèm số người; đầu trang lớp có dải thông báo với nút "Cấp lượt cho lớp cũ…"; Việc cần làm có dòng "Lớp chưa chuyển sang đo lượt" (FR-09-090). Lớp đã lưu trữ không tính.
- FR-09-055: Thu hồi mã chưa dùng: mục cuối menu "⋯". Thu hồi mã đã dùng: chỉ ở Vùng nguy hiểm trang mã, gõ đúng mã, lý do bắt buộc, nói rõ học viên mất quyền.

**Chấm bài**
- FR-09-060 (sửa): Nhóm Chấm bài gồm ba mục: Writing · Speaking · Yêu cầu chấm lại. **Chỉ Writing của lớp offline** vào hàng chờ duyệt. Speaking luyện tập (lớp offline và khoá online) AI chấm và trả ngay, không có hàng chờ. Hàng chờ Speaking **chỉ** gồm Speaking thi thử chờ giáo viên chấm (AI chỉ đề xuất). Bài khoá online và tự luyện chỉ tới giáo viên qua Yêu cầu chấm lại.
- FR-09-061: `/admin/writing/status?essay_id=` thành khối trạng thái trong màn chấm; route cũ 307 tới `/admin/writing/grade?essay_id=…&panel=status`.
- FR-09-062 (sửa): Yêu cầu chấm lại: trạng thái Mới → Đang xem → Đã trả lời; hiện nguyên văn lý do; "Giữ nguyên điểm" bắt buộc giải thích ≥ 40 ký tự; "Điều chỉnh điểm" mở màn chấm ở chế độ chấm lại; "Chấm lại bằng AI" qua hộp cảnh báo chi phí. Không quyết định nào trừ lượt của học viên.
- FR-09-063: Mở `/admin/mock-reviews` không có tham số không bao giờ ra lỗi "Thiếu mock_exam_id".
- FR-09-064: Nhãn "Hàng đợi Instructor", "Claim atomic", "canonical", "OWNER-SCOPED QUEUE" thay bằng lời thường.
- FR-09-065: Phím tắt màn chấm Writing: Ctrl Enter = "Trả bài và mở bài kế" (trả ngay, có thu hồi); J/K chỉ chuyển bài. Màn chấm Speaking thi thử: Ctrl Enter = lưu điểm và mở bài kế. Không bắt phím khi con trỏ trong ô nhập (trừ Ctrl Enter).
- FR-09-066: Sắp xếp hàng chờ "Lớp có buổi học sớm nhất trước": theo `class_lessons.lesson_date` kế tiếp của lớp, rồi chờ lâu nhất. Đầu màn chấm ghi "còn N bài · M bài của lớp học hôm nay".
- FR-09-067: Dải tóm tắt dưới tên học viên ở màn chấm: band 4 bài gần nhất đã trả (cùng kỹ năng), mục tiêu band, loại chú thích/lỗi lặp nhiều nhất kèm số bài, link hồ sơ. Thiếu dữ liệu ghi "chưa có bài" / "mục tiêu chưa đặt"; không ghi band.
- FR-09-068: Quá hạn ở mọi hàng chờ so với bảng ngưỡng ở Cài đặt; mốc của bài chờ duyệt là lúc AI chấm xong (bài AI lỗi: lúc nộp). Trang không ghi số giờ riêng.
- FR-09-069: Bài Writing và Speaking thi thử: chấm xong là lưu điểm vào kỳ thi; **không có nút trả** ở hàng chờ hay màn chấm.

**Lớp, giao bài, kết quả bài giao, bài kiểm tra khoá**
- FR-09-120: Trang lớp có thẻ trên URL (`tab=tong-quan|hoc-vien|buoi-hoc|bai-nop|kiem-tra|nhat-ky`). Thẻ Học viên mặc định là bảng học viên × bài.
- FR-09-121: **Một** thành phần giao bài (ngăn kéo phải ~480px) mở từ: thẻ Buổi học / Bài nộp của lớp, Việc cần làm, khu giáo viên, hồ sơ học viên (chọn sẵn người đó), trang một đề ở Nội dung ("Giao bài này…"). Trường theo thứ tự: Lớp · Buổi (mặc định buổi kế tiếp chưa có bài) · Bài · Giao cho (Cả lớp / Chọn tay / Nhóm đã lưu, có "Lưu nhóm này…") · Hạn nộp (mặc định 23:59 ngày học của buổi) · Chế độ trả điểm (chỉ khi bài là bài kiểm tra; lớp offline mặc định "Giáo viên công bố") · dòng xem lại + "Giao bài".
- FR-09-122: Không tạo bản giao thứ hai cho cùng (lớp, bài): hiện cảnh báo với hai lựa chọn giữ hạn cũ hoặc dời hạn lần giao cũ. Nút Giao đếm đúng số bài tạo mới.
- FR-09-123: Hai sổ giao bài ở Nội dung (Writing "Gán bài tập", ngữ pháp "assign") bị bỏ khỏi giao diện.
- FR-09-124: Gửi nhắc: chỉ người chưa nộp và đã qua hạn (không tính người chưa có tài khoản); mỗi bài mỗi người tối đa một lần một ngày; gửi xong dòng ghi "Đã nhắc HH:MM".
- FR-09-125: Trang "Kết quả một bài giao" là một trang cuộn 5 khối: (1) Ai đã nộp; (2) Lớp làm thế nào; (3) Lớp vướng ở đâu; (4) Ai cần chú ý; (5) Nên chữa ở buổi tới. Thay ba tab cũ.
- FR-09-126: Cả trang dùng **một bộ 5 trạng thái**: Đã nộp đúng hạn · Nộp trễ · Đang làm · Chưa mở · Chưa có tài khoản.
- FR-09-127: Khối 3 gom theo **nhóm ngữ pháp** (`quiz_questions.skill` = `truc_nhom`), hiện đủ mọi nhóm, không cắt top 15, không gom theo `item_key`; có nút đổi cách gom sang dạng câu (`subtype`); tính lượt đầu; câu tự luận E1–E3 loại khỏi bảng. Mở một nhóm: ba câu sai nhiều nhất, mỗi câu có đề, đáp án đúng, phương án sai được chọn nhiều nhất kèm số người và lời giải thích (`why_wrong`). Giao diện không hiện mã ngộ nhận.
- FR-09-128: Khối 2 chỉ tính người đã nộp (người chưa nộp không bị tính 0); ngưỡng đạt lấy từ `pass_pct` của bài; không có bài trước thì bỏ dòng so sánh.
- FR-09-129: Biến thể Writing/Speaking: khối 3 thành "Tiêu chí thấp nhất của lớp" (trung vị từng tiêu chí trên bài đã trả) và "Loại chú thích xuất hiện nhiều nhất"; chưa có bài nào được trả → "chưa có điểm". Biến thể giữa kỳ/cuối kỳ: khối 3 gom theo buổi B01–B20; ma trận học viên × buổi lấy mẫu số là số câu của buổi; có nút "Mở bảng công bố điểm"; trang này không công bố điểm.
- FR-09-130: Khối 5: máy đề xuất câu (câu sai nhiều nhất trong nhóm có tỉ lệ sai cao nhất, ưu tiên câu có từ 40% người sai chọn cùng một phương án); giáo viên bỏ chọn hoặc thêm; "Lưu vào buổi N" lưu danh sách câu vào buổi học. Bản "Chữa trên lớp" không hiện tên học viên.
- FR-09-131: Bảng công bố điểm (chỉ với bài chế độ "giáo viên công bố"): khối "Theo buổi" trên bảng; có dòng được chọn thì nút "Công bố cho cả lớp" tắt, chỉ còn "Công bố cho N bạn đã chọn" và "Bỏ chọn"; mọi lệnh công bố qua hộp hỏi lại nêu số người, tên, mức hiển thị, học viên thấy gì, kèm "Xem như học viên thấy"; chỉ nâng mức, không hạ, không thu hồi; hẹn giờ huỷ được tới trước giờ. Không band; người không làm ghi "vắng". Không có điều khiển nộp trễ, làm bù, làm lại.

**Kỳ thi**
- FR-09-140: `/admin/mock-tests` là danh sách kỳ thi; trạng thái hiển thị: Nháp → Đã lên lịch (live) / Đang mở (tự làm) → Đang diễn ra → Chờ chấm → Đã trả kết quả. Các trang mock cũ chuyển hướng tạm về trang kỳ thi tương ứng.
- FR-09-141: "Tổ chức kỳ thi" ba bước + bước xem lại; lưu nháp ở mọi bước; thanh bước bấm được không theo thứ tự. Bước 1 Đề: chọn kỹ năng, **cần ít nhất một, không bắt buộc đủ bốn**; mỗi kỹ năng một dòng chọn đề (chỉ đề đã đăng; Listening đủ audio). Bước 2 Người thi. Bước 3 Cách thi.
- FR-09-142: Người thi = cộng dồn ba nguồn: nhiều lớp + học viên lẻ + nhóm đã lưu; khử trùng theo học viên; cột Nguồn giữ nguồn đầu tiên; kỹ năng dự thi sửa được từng người; người chưa có tài khoản tự bỏ chọn và ghi lý do.
- FR-09-143 (chốt 18/11, sửa theo điểm 23): Thi thử **chỉ có khi admin/giáo viên giao** (cho lớp, nhiều lớp hoặc nhóm chọn tay); học viên chưa được giao thì không thấy kỳ thi nào. Người giao chọn một trong hai cách thi: `live` ("Phòng thi cùng giờ"; giám thị mở phòng, bắt đầu phần, thu bài) hoặc `self_paced` ("Làm trong khoảng thời gian": người thi tự chọn lúc bắt đầu trong khoảng mở, **làm một lần**). Kỳ `self_paced` **không có nghỉ giữa các phần**: đã bắt đầu thì các phần chạy **liền nhau** theo thứ tự cố định, mỗi phần có đồng hồ riêng nối tiếp phần trước; không có màn chọn phần, không có "làm phần sau vào lúc khác", không quay lại phần đã nộp (hợp đồng ở 5.5). Giao diện không có lựa chọn "nghỉ giữa các phần" hay "số lần làm"; bước Cách thi ghi một dòng cho người tổ chức: "Người thi cần một quãng liền khoảng N phút" (N = tổng thời lượng các phần). Muốn cho làm lại thì dùng thi bù (FR-09-149). API và giao diện chỉ dùng hai tên mới; dữ liệu cũ `sequential`/`retake` đọc được qua lớp tương thích. Đề công khai học viên tự chọn (full test từng kỹ năng, không có full test bốn kỹ năng một mạch) là chuyện khác, không thuộc G09.
- FR-09-144: "Lên lịch" chỉ bật khi mỗi kỹ năng dự thi có đề đã đăng, có ít nhất một người được chọn, có ngày giờ (live) hoặc khoảng mở (tự làm); nút tắt nói thiếu gì.
- FR-09-145: Trang một kỳ thi: một route, 7 thẻ (`tab=de|thi-sinh|theo-doi|cham|phan-tich|tra-ket-qua|nhat-ky`); thẻ mặc định theo trạng thái (Nháp/Đã lên lịch → Đề; Đang diễn ra → Theo dõi; Chờ chấm → Chấm; Đã trả → Phân tích).
- FR-09-146: Theo dõi (live): bảng thí sinh với số câu n/tổng, hoạt động gần nhất, kết nối, dấu hiệu; thanh điều khiển giám thị (Mở phòng · Bắt đầu phần · "Thu bài và sang phần sau…" luôn hỏi lại; sau khi thu thì "Bắt đầu phần" mới bật); dải cảnh báo ba loại: mất kết nối, đứng yên quá ngưỡng (Cài đặt), chưa vào sau giờ bắt đầu. Mất cập nhật → làm mờ và khoá điều khiển. Cộng giờ cho một người: lý do bắt buộc, ghi Nhật ký.
- FR-09-151 (mới, điểm 23): Theo dõi (tự làm): không có thanh điều khiển giám thị. Bảng người dự thi có đúng **bốn trạng thái**: "Chưa bắt đầu" · "Đang làm" (kèm phần đang làm, giờ còn lại của phần, giờ dự kiến xong cả bài) · "Đã nộp" (đủ mọi phần của người đó) · "Không dự thi" (khoảng mở đã đóng mà chưa bắt đầu). **Không có** trạng thái "nghỉ giữa phần", "đã xong phần 1, chờ làm phần 2" hay nút "mở lại phần". Người đang làm mà mất kết nối vẫn là "Đang làm" kèm dấu "mất kết nối"; đồng hồ không dừng (00 mục 2 điểm 22). Nút "Nhắc" chỉ gửi cho người "Chưa bắt đầu". Cộng giờ ở kỳ tự làm: chỉ cho **phần đang chạy** của một người đang làm (lý do bắt buộc); các phần sau của người đó lùi theo đúng số giây được cộng; không cộng giờ cho phần đã nộp hay người đã nộp xong — trường hợp đó dùng thi bù.
- FR-09-147: Phân tích sau thi: phân bố band từng kỹ năng (chỉ khi đủ số bài tối thiểu theo Cài đặt); 10 câu sai nhiều nhất và tỉ lệ đúng theo dạng câu Listening/Reading; nhịp làm bài cả phòng; so với kỳ trước (ẩn khi không có); Writing trung vị từng tiêu chí. Không tính band tổng trong thẻ này.
- FR-09-148: **Trả kết quả thi thử chỉ ở thẻ "Trả kết quả" của trang kỳ thi.** Mặc định chỉ trả cho người đã chấm xong đủ kỹ năng dự thi của chính họ; lựa chọn thêm: trả phần đã xong cho người còn thiếu. Hộp hỏi lại nêu số thí sinh, phần được trả, link "Xem như thí sinh thấy"; gõ tên kỳ thi để bật nút. Sau khi trả không thu hồi. "Sửa điểm sau khi trả…" bắt buộc lý do, ghi Nhật ký, gửi thông báo cho thí sinh. (Quy tắc do người thiết kế đề xuất — Q14.) Kỳ tự làm: người đã bắt đầu luôn có đủ mọi phần ở trạng thái đã nộp khi giờ cả bài hết (phần bỏ dở tự nộp với phần đã làm), nên không có người "làm dở chờ làm tiếp" chặn việc trả; người "Không dự thi" không tính vào số chờ chấm và không nhận kết quả.
- FR-09-149: Thi bù theo kỹ năng: thẻ Thí sinh có "Đánh dấu cần thi bù" theo kỹ năng và "Cho thi bù…" (giao lượt tự làm cho riêng người đó với kỹ năng và khoảng mở). Lượt thi bù nhiều kỹ năng cũng chạy liền các phần, không nghỉ giữa (FR-09-143).
- FR-09-150: Huỷ kỳ thi chỉ trước khi mở, trong Vùng nguy hiểm, gõ tên kỳ thi. Đề khoá từ khi phòng mở (live) hoặc khoảng mở bắt đầu (tự làm).

**Nội dung và báo cáo**
- FR-09-160: Mỗi kỹ năng một trang (`/admin/listening`, `/admin/reading`, `/admin/writing`, `/admin/speaking`, `/admin/vocab`, `/admin/grammar`) với 4 thẻ `?tab=items|programs|batches|review`: Đề và bài · Chương trình và bộ · Lô nhập · Câu cần kiểm.
- FR-09-161: Không có nút chính "Tạo đề" ở Listening, Reading, Từ vựng, Ngữ pháp; "Tạo đề lẻ" / "Tạo mẹo lẻ" (Writing), "Tạo chủ đề lẻ" (Speaking) là nút phụ. Không có điều khiển tải audio, video hay ô chọn file nhập hàng loạt.
- FR-09-162: Thẻ Lô nhập chỉ đọc: mỗi lần script chạy một dòng (thời điểm, người chạy, tên đọc được của script, môi trường, chạy thử hay nhập, số tạo / cập nhật / lỗi, trạng thái, "Xem các mục của lô", tải báo cáo lỗi). Trạng thái rỗng: "Chưa có lô nào. Nội dung nhập bằng script trên máy chủ."
- FR-09-163: Thẻ Câu cần kiểm: một hàng chờ theo câu (mỗi câu một dòng dù nhiều lý do); trạng thái: Câu cần kiểm → Đã kiểm (ghi người, lúc) hoặc Đã sửa ở bản N. Báo cáo › Chất lượng nội dung và Hộp thư sự cố chỉ hiện số và link về thẻ này.
- FR-09-164: `/admin/reports` một trang 4 thẻ (`?tab=hoat-dong|luu-luong|chi-phi-ai|chat-luong`), khoảng thời gian dùng chung (`?range=7|30|90`); bốn mục sidebar nhóm Báo cáo trỏ thẳng thẻ tương ứng.

**Hệ thống, cài đặt, tìm nhanh, vùng nguy hiểm**
- FR-09-070 (sửa): `/admin/incidents` thay ba trang cũ; thẻ nguồn trên URL (`?source=errors|grading|feedback`); số cạnh thẻ là số **nhóm** chưa xử lý.
- FR-09-071 (sửa): Gom nhóm lỗi hệ thống theo nguồn, mức, đường dẫn đã bỏ id, thông báo đã bỏ số. Nhóm có 4 trạng thái: Mới · Đang xem · Đã xử lý · Bỏ qua; nhóm Đã xử lý/Bỏ qua có ghi nhận mới thì tự mở lại thành Mới, giữ ghi chú. "Nhận xử lý" chuyển Mới → Đang xem. Hành động hàng loạt có hộp xác nhận nói số nhóm và số lần ghi nhận.
- FR-09-072: Tên học viên trong sự cố luôn là link tới hồ sơ.
- FR-09-073 (sửa): "Tạo lỗi thử" không ở Hộp thư sự cố: nằm ở `/admin/qa-tools`, chỉ khi môi trường không phải Production (máy chủ cũng chặn).
- FR-09-074 (sửa): `/admin/ai-models` chứa bảng chọn mô hình; `/admin` không còn bảng này. Mỗi thay đổi qua khối xác nhận nói tính năng, cũ → mới, và lý do ≥ 10 ký tự.
- FR-09-080: `/admin/settings` có thẻ `?tab=payment|email|legal|features|trial|notices|thresholds`; chỉ vai trò Quản trị có AAL2. Mọi lưu đi qua máy chủ, ghi một dòng nhật ký: ai, lúc, thẻ, cũ → mới, lý do.
- FR-09-081: **Bảng ngưỡng vận hành duy nhất** ở thẻ `thresholds`. Mọi trang (hàng chờ, Việc cần làm, danh bạ, lớp, giáo viên, kỳ thi, mã, kết quả bài giao) đọc ngưỡng qua một API; không trang nào có hằng số ngưỡng riêng. Giá trị trên tờ thiết kế là **mặc định đề xuất** nạp lúc cài; chủ dự án sửa ở trang này.
- FR-09-082: Thẻ Chấm thử (do GOI-11 T16 dựng) hiện: ba trần cho từng kỹ năng (hạn mức mỗi người, trần mỗi ngày mỗi người, trần mỗi ngày toàn web — **ngân sách 5 USD/ngày**), **hệ số IP dùng chung**, **số lượt bị từ chối vì IP** theo ngày, **công tắc tạm dừng** (tạm dừng không trừ hay xoá lượt của ai). G09 chỉ bảo đảm thẻ nằm đúng trang và sidebar.
- FR-09-083: Thẻ Thư: bốn thư về đơn và thư "Mã đăng nhập" bắt buộc, không tắt được; không có mẫu xác minh email hay đặt lại mật khẩu; tắt loại khác có xác nhận. Thư học viên gửi bằng dịch vụ đã có trong repo (Resend, `backend/services/owner_alerts.py`, biến `RESEND_API_KEY` — điểm 23); không chọn nhà cung cấp trên trang. Đầu thẻ có một dòng chỉ đọc "Địa chỉ gửi": hiện giá trị G04 đang dùng (`LEARNER_EMAIL_FROM`); chưa đặt → dải Cảnh báo "Chưa có địa chỉ gửi. Thư cho học viên chưa gửi được." Câu còn mở chỉ là địa chỉ gửi và tên miền đã xác minh (Q36).
- FR-09-084: Nhóm "Lưu dữ liệu" trong bảng ngưỡng có hai dòng: "Giữ bản ghi âm" mặc định **60 ngày** kể từ lúc ghi (đã chốt, tối đa 60); "Giữ bài làm sau khi khoá hết hạn" **45 ngày** (chốt ở điểm 23) — dòng này **chỉ đọc** (`fixed`), lấy từ cấu hình G04 `RETENTION_CONTENT_DAYS_AFTER_EXPIRY`, không sửa trên trang. Giảm thời gian lưu phải nói rõ việc xoá không lấy lại được.
- FR-09-075 (sửa): Tìm nhanh: kết quả gom Học viên · Lớp · Bài nộp · Đề · Đơn đăng ký, tối đa 3 dòng mỗi nhóm; ↑ ↓ chọn, Enter mở, Esc đóng; tối thiểu 2 ký tự; chờ 250ms.
- FR-09-076: Thao tác phá huỷ không nằm trong dòng bảng cạnh nút thường: nằm ở "Vùng nguy hiểm" cuối trang bản ghi, hoặc mục cuối của menu "⋯", tách bằng đường kẻ.
- FR-09-077: Mỗi thao tác phá huỷ mở hộp xác nhận nói việc sẽ xảy ra và số học viên bị ảnh hưởng; thao tác không hoàn tác được yêu cầu gõ đúng chuỗi xác nhận.
- FR-09-078: Mỗi thao tác phá huỷ được ghi nhật ký ở máy chủ và hiện ở Nhật ký của hồ sơ liên quan.
- FR-09-079: Route đổi quyền học (thu hồi quyền, điều chỉnh lượt, xác nhận đơn, yêu cầu bổ sung, huỷ đơn, tạm dừng/lưu trữ khoá, khoá tài khoản) đòi step-up khi máy chủ yêu cầu; giao diện mở `AdminStepUpDialog` rồi gửi lại, giữ dữ liệu đã nhập.

**Tổng quan và giáo viên**
- FR-09-090 (sửa): `/admin` (Việc cần làm) khối hàng chờ, thứ tự cố định theo mức khẩn: Kỳ thi hôm nay (chỉ hiện trong ngày có kỳ thi, luôn đứng đầu) · Bài chờ duyệt (hai số: Writing · AI lỗi cần chấm tay, AI lỗi nằm trong số Writing) · Bài Speaking thi thử chờ chấm · Bài kiểm tra chờ công bố · Bài giao quá hạn còn người chưa nộp · Yêu cầu chấm lại · Đơn đăng ký · Cần liên hệ hôm nay · Sự cố · Phản hồi · Quyền sắp hết hạn · Lớp chưa chuyển sang đo lượt (FR-09-058; mở danh sách lớp đã lọc). Mỗi dòng một nguồn riêng; nguồn lỗi → chỉ dòng đó thành Cảnh báo, số ghi "chưa có", nút tải lại riêng; không bao giờ thay bằng 0. Dòng không có việc vẫn hiện "Không có".
- FR-09-091: Khối "Lớp hôm nay và tuần này": mỗi lớp hiện buổi kế tiếp (lớp có buổi hôm nay hiện thêm buổi sau nếu trong 7 ngày); đánh dấu buổi chưa có bài giao hoặc lớp còn bài chờ duyệt; nút "Giao bài…" và "Xem kết quả bài giao".
- FR-09-092: Khối "Cần chú ý tuần này": cùng quy tắc với bộ lọc "Cần chú ý" của danh bạ; tối đa 8 người, xếp theo số lý do rồi theo tên; "Gửi nhắc" mở Gửi thông báo với người đó trong "Danh sách đã chọn".
- FR-09-093: Khối "Vận hành tuần này": ba số, mỗi số có lối vào; thiếu dữ liệu ghi "chưa có". Trang này không có nút trả kết quả thi thử.
- FR-09-100 (sửa): Khu giáo viên dùng cùng khung, nhãn vai trò "Giáo viên", sidebar phẳng **năm mục**: Việc của tôi · Lớp của tôi · Học viên · Giao bài · Chấm và duyệt bài (số = Writing chờ duyệt + Speaking thi thử chờ chấm của các lớp mình).
- FR-09-101 (sửa): Mỗi mục có URL riêng (`/instructor?tab=today|classes|students|assign|grading`), tải lại giữ mục và bước.
- FR-09-102: Mọi truy vấn của giáo viên lọc ở máy chủ theo lớp của giáo viên đó (`cohorts.instructor_id`, tính ở `services/staff_scope.py`); mở lớp khác → về trang cha kèm một dòng giải thích, không lộ tên lớp hay học viên. Tìm nhanh của giáo viên không có nhóm Đề và Đơn đăng ký.
- FR-09-103: Admin xem như giáo viên (`?as_instructor=`) giữ dải thông báo và nút thoát.
- FR-09-104: "Việc của tôi" dùng cùng API với Việc cần làm, máy chủ lọc theo lớp của giáo viên; bỏ các dòng đơn đăng ký, sự cố, phản hồi, kỳ thi và khối vận hành. Khu giáo viên không trả kết quả thi thử, không thao tác mã/quyền/lưu trữ, không thấy Nhật ký lớp.
- FR-09-105: Admin và giáo viên đăng nhập không mật khẩu (Google hoặc mã 6 số qua email) và **không** bị giới hạn một phiên; quản trị vẫn bắt buộc xác thực hai bước (spec 0032). Lời mời giáo viên: email hợp lệ, chưa là nhân sự, không phải tài khoản học viên; có hạn; hết hạn hiện "Hết hạn" kèm "Mời lại".
- FR-09-106: Trang Giáo viên là bảng sắp xếp được (thay lưới thẻ); hồ sơ giáo viên là route con. Cột "Lớp phụ trách" liệt kê các lớp có `cohorts.instructor_id` là người đó. "Gỡ khỏi lớp" làm lớp **không còn giáo viên** (chỉ admin thấy và xử lý); hộp hỏi lại nêu số bài Writing chờ duyệt và Speaking thi thử chờ chấm sẽ chuyển về hàng chờ của admin. "Đổi giáo viên của lớp" là thay thẳng người này bằng người khác (một bước), không có trạng thái hai giáo viên cùng lúc.
- FR-09-107: "Gửi thông báo" khớp GOI-11 phần A: máy chủ tính số người nhận theo bộ chọn và kênh; hộp xác nhận nêu đúng số đó; gửi tất cả phải gõ "gửi tất cả"; hẹn giờ huỷ được tới trước giờ gửi. Người nhận "Danh sách đã chọn" chỉ nhận danh sách đẩy sang từ Danh bạ, bảng lớp, Kết quả bài giao, Việc cần làm, kèm dòng nguồn; ở đây chỉ bớt người. Giáo viên chỉ chọn được lớp của mình và học viên đang là thành viên active của các lớp đó (cùng `staff_scope`); thư và "tất cả" chỉ admin (GOI-11).
- FR-09-108 (mới, điểm 23): **Mỗi lớp có nhiều nhất một giáo viên.** Trang Lớp hiện "Giáo viên" của lớp ở đầu trang và ở danh sách lớp; chỉ Quản trị đổi được, bằng một ô chọn một người (vai trò `instructor` hoặc `admin`; có lựa chọn "Chưa có giáo viên"). Không màn nào có điều khiển thêm giáo viên thứ hai, đồng giáo viên hay trợ giảng. Lớp chưa có giáo viên: chỉ admin thấy; danh sách lớp ghi "chưa có giáo viên". Đổi giáo viên ghi Nhật ký lớp; người cũ mất quyền với lớp ngay ở lần gọi API kế tiếp.

**Quyền**
- FR-09-110: Mọi API mới gọi `require_admin` (hoặc `require_instructor`) là lệnh `await` đầu tiên của handler; `test_staff_guard_inventory.py` qua mà không thêm ngoại lệ.
- FR-09-111: Không màn nào đọc/ghi Supabase trực tiếp từ trình duyệt.
- FR-09-112: Ẩn/hiện theo vai trò chỉ là giao diện; gọi thẳng API bằng tài khoản không đủ quyền phải nhận 403 (có test).
- FR-09-113: API cho phép giáo viên (kết quả bài giao, giao bài, gửi nhắc, công bố điểm, việc của tôi) kiểm lớp thuộc giáo viên bằng một hàm chung (5.4 `staff_scope`); lớp không thuộc → 404, không phải 403, để không lộ lớp tồn tại. `services/staff_scope.py` là **nơi duy nhất** trả lời "lớp này có phải của giáo viên này không" (`cohorts.instructor_id = user_id`); không router, service hay truy vấn nào khác tự so `instructor_id` của lớp.

## 5. Hợp đồng kỹ thuật

### 5.1 Bảng ánh xạ đủ 75 trang admin

Loại: **nav** = mục sidebar · **tab** = thành thẻ của một trang khác (URL cũ 307 tới trang đó kèm tham số) · **context** = trang bản ghi/công cụ mở từ trang khác, giữ URL, không có mục sidebar · **hidden** = trang nhập thủ công bị ẩn khỏi sidebar, route vẫn sống, có dải cảnh báo (FR-09-013) · **bỏ** = xoá trang, 307. "Gộp" = nội dung dời vào trang đích trong gói này.

| # | Route hiện có | Nhóm mới › mục | Loại | Ghi chú (nhiệm vụ) |
|---|---|---|---|---|
| 1 | `/admin` | Tổng quan › Việc cần làm | nav | Bỏ `AdminAiPanel` (T18). |
| 2 | `/admin/dashboard/reading-attempts` | Báo cáo › Hoạt động học viên | context | Link "Xem chi tiết" từ thẻ Hoạt động (T41). |
| 3 | `/admin/users` | Học viên và quyền truy cập › Học viên | bỏ → `/admin/learners` | Đổi vai trò dời vào hồ sơ (T10). |
| 4 | `/admin/students` | › Học viên | bỏ → `/admin/learners` | Import CSV, Thêm học viên dời sang danh bạ (T10). |
| 5 | `/admin/classes` | › Lớp | nav | |
| 6 | `/admin/classes/[cohortId]` | › Lớp | context | Thẻ trên URL (T29). Kết quả bài giao là route con mới. |
| 7 | `/admin/classes/[cohortId]/exercise-book` | › Lớp | context | Tính năng đang tắt trên staging; không đổi. |
| 8 | `/admin/classes/[cohortId]/exercise-book/grants` | › Lớp | context | Như trên. |
| 9 | `/admin/instructors` | › Giáo viên | nav | Lưới thẻ → bảng; hồ sơ là route con mới (T40). |
| 10 | `/admin/usage` | Báo cáo › Chi phí AI | context | Link từ thẻ Chi phí AI; mỗi người link tới hồ sơ. |
| 11 | `/admin/writing/cohorts` | › Lớp | bỏ → `/admin/classes` | Gộp: tiến độ Writing xem ở trang lớp. Có `cohort_id` thì 307 tới `/admin/classes/{id}?tab=bai-nop`. |
| 12 | `/admin/grammar-lessons` | › Lớp | context | Mở từ bài nộp của lớp. |
| 13 | `/admin/grammar-diagnostic` | › Lớp | context | Như trên. |
| 14 | `/admin/writing/queue` | Chấm bài › Writing | nav | Một hàng chờ "Bài chờ duyệt" (T17). |
| 15 | `/admin/writing/grade` | Chấm bài › Writing | context | Màn chấm. |
| 16 | `/admin/writing/status` | Chấm bài › Writing | bỏ → `grade?…&panel=status` | FR-09-061. |
| 17 | `/admin/writing/instructor-queue` | Chấm bài › Writing | bỏ → `/admin/writing/queue` | **Gộp**: không còn mục "Giáo viên duyệt" (T17). |
| 18 | `/admin/writing/regrade-requests` | Chấm bài › Yêu cầu chấm lại | nav | T39. |
| 19 | `/admin/writing/new` | Chấm bài › Writing (nút "Gửi bài chấm thay học viên") | context | **Giữ** (OCR). Không còn mục sidebar. |
| 20 | `/admin/speaking/sessions` | Báo cáo › Hoạt động học viên | context | Phiên Speaking luyện tập; **không** còn là mục Chấm bài › Speaking. Mục đó trỏ route mới `/admin/speaking/grading` (T38). |
| 21 | `/admin/mock-reviews` | Thi thử › Kỳ thi | bỏ → `/admin/mock-tests/{id}?tab=cham` | Thiếu `mock_exam_id` → `/admin/mock-tests` (T02 làm tạm, T34 làm hẳn). |
| 22 | `/admin/mock-reviews/report` | Thi thử › Kỳ thi | context | Phiếu điểm một thí sinh; mở từ thẻ Chấm. |
| 23 | `/admin/speaking` | Nội dung › Speaking | nav | Hub → trang 4 thẻ (T37). |
| 24 | `/admin/speaking/topics` | Nội dung › Speaking | tab → `/admin/speaking?tab=items` | |
| 25 | `/admin/writing` | Nội dung › Writing | nav | Hub → trang 4 thẻ. |
| 26 | `/admin/writing/prompts` | Nội dung › Writing | tab → `/admin/writing?tab=items` | Giữ tạo/sửa lẻ. |
| 27 | `/admin/writing/tips` | Nội dung › Writing | tab → `/admin/writing?tab=items&type=tips` | Ẩn nút nhập nhiều mẹo từ file. |
| 28 | `/admin/writing/assignments` | › Lớp | bỏ → `/admin/classes` | **Sổ giao bài Writing bị bỏ** (FR-09-123). |
| 29 | `/admin/listening` | Nội dung › Listening | nav | Trang 4 thẻ. |
| 30 | `/admin/listening/tests` | Nội dung › Listening | tab → `/admin/listening?tab=items&type=tests` | |
| 31 | `/admin/listening/tests/[testId]` | › Listening | context | Ẩn điều khiển tải audio; giữ sửa ảnh lẻ. |
| 32 | `/admin/listening/content/[contentId]` | › Listening | context | |
| 33 | `/admin/listening/content/[contentId]/edit` | › Listening | context | |
| 34 | `/admin/listening/segments` | › Listening | context | Thiếu `content_id` → về `/admin/listening` (đã có). |
| 35 | `/admin/listening/gist` | › Listening | context | Như trên. |
| 36 | `/admin/listening/tf` | › Listening | context | Như trên. |
| 37 | `/admin/listening/mcq` | › Listening | context | Như trên. |
| 38 | `/admin/listening/import-drills` | — | **hidden** | Script: `import_skill_drills.py`, `import_listening_content_package.py`. |
| 39 | `/admin/listening/import-fulltest` | — | **hidden** | Script: `import_listening_lessons.py`, `import_listening_content_package.py`, `import_cambridge_canonical_qa.py`, `upload_listening_source_audio.py`. |
| 40 | `/admin/listening/audit` | Báo cáo › Chất lượng nội dung | context | Link từ thẻ Chất lượng. |
| 41 | `/admin/listening/audit-detail` | Báo cáo › Chất lượng nội dung | context | |
| 42 | `/admin/listening/attempts` | Báo cáo › Hoạt động học viên | context | |
| 43 | `/admin/listening/dictation` | Báo cáo › Hoạt động học viên | context | |
| 44 | `/admin/reading` | Nội dung › Reading | nav | Hub → trang 4 thẻ. |
| 45 | `/admin/reading/content` | Nội dung › Reading | tab → `/admin/reading?tab=items` | Ẩn nhập; giữ khoá/chia sẻ/đăng. |
| 46 | `/admin/reading/preview` | › Reading | context | Giữ sửa ảnh lẻ. |
| 47 | `/admin/vocab` | Nội dung › Từ vựng | nav | Hub → trang 4 thẻ. |
| 48 | `/admin/vocab/sets` | Nội dung › Từ vựng | tab → `/admin/vocab?tab=programs` | |
| 49 | `/admin/vocab/sets/[setId]` | › Từ vựng | context | |
| 50 | `/admin/vocab/topics` | Nội dung › Từ vựng | context | Mở từ thẻ Chương trình và bộ; `?skill_area=grammar` mở từ Ngữ pháp. |
| 51 | `/admin/vocab/content` | — | **hidden** (phần nhập) | Script: `seed_vocab_curated.py`, `import_advanced_vocab_core30.py`, `pregen_vocab_audio.py`, `migrate_vocab_to_cards.py`. Sửa lẻ mục từ dời vào `/admin/vocab?tab=items`. |
| 52 | `/admin/vocab/quiz` | — | **hidden** (phần nhập) | Script: `import_course_exercise_bank.py`, `import_course_assessment_bank.py`, `import_grammar_banks.py`, `reimport_grammar_banks.py`. Danh sách bank và xem trước dời vào thẻ Chương trình và bộ. |
| 53 | `/admin/vocab/curated` | Nội dung › Từ vựng | tab → `/admin/vocab?tab=items&status=pending` | |
| 54 | `/admin/vocab/d1-curation` | Nội dung › Từ vựng | tab → như trên | |
| 55 | `/admin/vocab/exercises` | Nội dung › Từ vựng | tab → như trên | |
| 56 | `/admin/vocab/lemmas` | Nội dung › Từ vựng | context | Thành thao tác "sửa dạng từ" trong mục từ; URL giữ tới khi dời xong. |
| 57 | `/admin/vocab/stats` | Báo cáo › Hoạt động học viên | context | |
| 58 | `/admin/vocab/quiz-analytics` | Báo cáo › Hoạt động học viên | context | |
| 59 | `/admin/vocab/pilot-metrics` | Báo cáo › Hoạt động học viên | context | |
| 60 | `/admin/grammar` | Nội dung › Ngữ pháp | nav | Hub → trang 4 thẻ. |
| 61 | `/admin/grammar/articles` | Nội dung › Ngữ pháp | tab → `/admin/grammar?tab=items` | |
| 62 | `/admin/grammar/analytics` | Báo cáo › Hoạt động học viên | context | |
| 63 | `/admin/grammar/recommend-test` | Hệ thống › Công cụ QA | context | Link từ `/admin/qa-tools`. |
| 64 | `/admin/mock-tests` | Thi thử › Kỳ thi | nav | Trung tâm iframe → danh sách kỳ thi (T32). |
| 65 | `/admin/mock-exams` | Thi thử › Kỳ thi | bỏ → `/admin/mock-tests` | Hết nhúng `?embed=1`. |
| 66 | `/admin/mock-exams/corrections` | Hệ thống › Công cụ QA | context | |
| 67 | `/admin/mock-live` | Thi thử › Kỳ thi | bỏ → `/admin/mock-tests/{id}?tab=theo-doi` | Không có id → `/admin/mock-tests`. |
| 68 | `/admin/mock-pacing` | Thi thử › Kỳ thi | bỏ → `/admin/mock-tests/{id}?tab=phan-tich` | Cần ánh xạ `sitting` → kỳ thi; không ra thì về danh sách. |
| 69 | `/admin/error-logs` | Hệ thống › Hộp thư sự cố | tab → `/admin/incidents?source=errors` | |
| 70 | `/admin/system/alerts` | Hệ thống › Hộp thư sự cố | tab → `/admin/incidents?source=grading` | |
| 71 | `/admin/feedback` | Hệ thống › Hộp thư sự cố | tab → `/admin/incidents?source=feedback` | |
| 72 | `/admin/system` | — | bỏ → `/admin/incidents` | Hub 2 thẻ. |
| 73 | `/admin/system/ai-usage` | Báo cáo › Chi phí AI | context | Link từ thẻ Chi phí AI. |
| 74 | `/admin/foot-traffic` | Báo cáo › Lưu lượng | context | Link từ thẻ Lưu lượng. |
| 75 | `/admin/mfa` | Hệ thống › Bảo mật | nav | Giữ URL. |

Trang ẩn khỏi sidebar so với hiện tại: #38, #39, #51, #52 (nhập nội dung) và mục "Import" của exam module cũ (không có `page.tsx` Next; đã kiểm ở `c3bc71574`: `grep -rln "exams/import" frontend/js frontend/public/js frontend/app frontend/lib frontend/components` rỗng — không còn nơi nào ở frontend gọi API này, nên không có gì phải ẩn; API `POST /admin/exams/import` giữ nguyên). Trang gộp: #11, #17, #28, #65, #67, #68, #69–72 và sáu hub/nội dung (#23–27, #29–30, #44–45, #47–48, #53–55, #60–61).

**Route mới của gói** (đều trong `(authed-admin)` của G10): `/admin/learners`, `/admin/learners/[ref]`, `/admin/classes/[cohortId]/assignments/[assignmentId]` (Kết quả một bài giao), `/admin/classes/[cohortId]/assignments/[assignmentId]/release` (bảng công bố điểm), `/admin/activation-codes`, `/admin/courses`, `/admin/courses/[id]`, `/admin/enrollments`, `/admin/enrollments/[orderCode]`, `/admin/credits`, `/admin/speaking/grading`, `/admin/mock-tests/new`, `/admin/mock-tests/[examId]`, `/admin/mock-tests/[examId]/setup`, `/admin/reports`, `/admin/incidents`, `/admin/ai-models`, `/admin/qa-tools`, `/admin/notifications` (trang "Gửi thông báo"; nội dung do GOI-11 T13 dựng), `/admin/instructors/[id]`. Route do gói khác tạo nhưng có mục sidebar ở đây: `/admin/settings` (GOI-11 T16 tạo trang; T23 thêm thẻ), `/admin/library` (G06). `/admin/courses` phía frontend không đụng API backend `/admin/courses` (khác host); chạy `node frontend/tooling/route-ownership-check.mjs`. Thao tác "Cấp lượt cho lớp cũ" (T43) là một hộp trên trang Lớp, không có route riêng.

**Sidebar chuẩn** (nguyên văn `CHUAN-ADMIN.md` mục A kèm sửa đổi 18/11; người thực thi không thêm bớt):

| Nhóm | Mục → route |
|---|---|
| Tổng quan | Việc cần làm → `/admin` |
| Học viên và quyền truy cập | Học viên → `/admin/learners` · Lớp → `/admin/classes` · Giáo viên → `/admin/instructors` · Mã kích hoạt → `/admin/activation-codes` · Gửi thông báo → `/admin/notifications` · Khảo sát và nhận xét (số) → `/admin/surveys` (GOI-13 phần A dựng; trước khi trang có thì `available: false`) (sửa 18/11 theo GOI-13) |
| Khoá học và đăng ký | Khoá học → `/admin/courses` · Đơn đăng ký (số) → `/admin/enrollments` · Lượt AI → `/admin/credits` |
| Chấm bài | Writing (số) → `/admin/writing/queue` · Speaking (số) → `/admin/speaking/grading` · Yêu cầu chấm lại (số) → `/admin/writing/regrade-requests` |
| Nội dung | Listening → `/admin/listening` · Reading → `/admin/reading` · Writing → `/admin/writing` · Speaking → `/admin/speaking` · Từ vựng → `/admin/vocab` · Ngữ pháp → `/admin/grammar` · Thư viện công khai → `/admin/library` |
| Thi thử | Kỳ thi → `/admin/mock-tests` |
| Báo cáo | Hoạt động học viên → `/admin/reports?tab=hoat-dong` · Lưu lượng → `?tab=luu-luong` · Chi phí AI → `?tab=chi-phi-ai` · Chất lượng nội dung → `?tab=chat-luong` |
| Hệ thống | Hộp thư sự cố (số) → `/admin/incidents` · AI và mô hình → `/admin/ai-models` · Bảo mật → `/admin/mfa` · Công cụ QA → `/admin/qa-tools` · Cài đặt → `/admin/settings` |

Mục trỏ tới trang chưa có (`/admin/library` trước G06, `/admin/notifications` trước GOI-11 T13, `/admin/settings` trước GOI-11 T16): sổ đăng ký có trường `available: false` → mục hiện mờ, không bấm được, tooltip "Chưa mở"; không tạo trang giữ chỗ. Mục "Khảo sát và nhận xét" có `href: '/admin/surveys'` trong sổ đăng ký; `available: false` cho tới khi trang của GOI-13 phần A (G13-A09…) lên, rồi bật (G09 không tự dựng trang) (sửa 18/11 theo GOI-13).

Khung giáo viên (sidebar phẳng, `CHUAN-ADMIN.md` mục B): Việc của tôi → `/instructor?tab=today` · Lớp của tôi → `?tab=classes` · Học viên → `?tab=students` · Giao bài → `?tab=assign` · Chấm và duyệt bài (số) → `?tab=grading`.

### 5.2 Sổ đăng ký điều hướng

- File `frontend/lib/admin-nav-registry.mjs` (ES module thuần, không import React). Xuất `ADMIN_NAV_GROUPS` (8 nhóm: `id`, `label`, `items[]` với `id`, `label`, `href` (`null` khi `available` là `false` và trang chưa có route), `countKey?`, `available`), `ADMIN_ROUTES` (mỗi route của 5.1 và route mới: `pattern`, `kind`, `group`, `item`, `redirectTo?`), `adminNavMatch(pathname, search)` → `{ groupId, itemId }`, `INSTRUCTOR_NAV_ITEMS` (5 mục), `HIDDEN_IMPORT_ROUTES` (4 route `hidden`).
- `countKey` trỏ vào trường của `GET /admin/attention` (5.4): `enrollments_reported`, `writing_review`, `speaking_mock_pending`, `regrade_new`, `incident_groups_open`.
- Test hành vi `frontend/tests/admin-nav-registry.test.mjs`: (1) mọi `page.tsx` dưới `app/**/admin/**` có pattern trong `ADMIN_ROUTES`; (2) mọi `href` khác `null` của sidebar khớp một route `nav`; (3) `adminNavMatch` đúng cho 12 đường dẫn mẫu; (4) đúng 8 nhóm và đúng danh sách mục theo bảng "Sidebar chuẩn"; (5) không mục nào có nhãn chứa "Import", "Nhập", "Tải lên", "Giáo viên duyệt"; (6) nhóm Chấm bài không có mục "Thi thử".

### 5.3 Migration mới (dải G09: 440–459)

Số migration lấy theo dải ở `01-KE-HOACH-TONG.md` mục 6 (G09: 440–459); người cấp và duyệt là anh Andy. Người thực thi kiểm `backend/migrations/README.md` (và sổ đăng ký migration nếu G10 đã lập) trước khi dùng số; không nhảy số, không lấy số ngoài dải. Mọi bảng mới: bật RLS, **không** có policy cho `authenticated`/`anon` (chỉ backend `supabase_admin` đọc/ghi, theo spec 0039), kèm file `rollback/`.

| Số | File | Nội dung | Nhiệm vụ |
|---|---|---|---|
| 440 | `440_admin_settings.sql` | Bảng `admin_settings(key text PK, value jsonb NOT NULL, updated_by uuid, updated_at timestamptz)`; bảng `admin_settings_log(id, key, old_value jsonb, new_value jsonb, reason text, actor_id uuid, created_at)` chỉ ghi thêm (trigger chặn UPDATE/DELETE như `class_action_log` mig 356). Nạp sẵn khoá `ops_thresholds` với giá trị mặc định ở 5.6. | T22 |
| 441 | `441_cohort_teacher_schedule.sql` | `cohorts.instructor_id uuid NULL REFERENCES users(id) ON DELETE SET NULL` + index; `cohorts.weekly_schedule jsonb NULL` (ví dụ `[{"dow":2,"start":"19:30"},{"dow":4,"start":"19:30"}]`), `cohorts.start_date date NULL`; `class_lessons.starts_at time NULL`. **Một cột trên lớp, không có bảng nhiều giáo viên** (mỗi lớp một giáo viên — điểm 23). Điền cho lớp đang có (trong cùng migration): với mỗi lớp chưa lưu trữ, lấy `students.instructor_id` của các thành viên active (`student_cohort_memberships.is_active`); mọi giá trị khác NULL trùng nhau → ghi giá trị đó vào `cohorts.instructor_id`; lẫn nhiều giáo viên hoặc không ai có giáo viên → để NULL và in tên lớp ra NOTICE. Lớp NULL: chỉ admin thấy; admin chọn giáo viên ở trang Lớp (FR-09-108). Không tự gán anh Andy cho lớp NULL (Q35). | T24 |
| 442 | `442_learner_care_notes.sql` | Bảng `learner_care_notes(id, student_id uuid NULL REFERENCES students, user_id uuid NULL REFERENCES users, author_id uuid NOT NULL, body text NOT NULL CHECK (length 1..4000), next_action text NULL, due_on date NULL, done_at timestamptz NULL, done_by uuid NULL, is_initial boolean DEFAULT false, created_at, updated_at, deleted_at NULL)`; CHECK có ít nhất một trong `student_id`, `user_id`; index `(due_on) WHERE done_at IS NULL AND deleted_at IS NULL`. G13-A12 (GOI-13) cần phân biệt ghi chú tự sinh: đề nghị thêm cột `source text not null default 'manual'` ngay trong 442 nếu 442 chưa merge (sửa 18/11 theo GOI-13). Không chép `persona_notes` trong migration (API dựng ghi chú đầu lúc đọc — 5.4). | T35 |
| 443 | `443_saved_learner_groups.sql` | `saved_learner_groups(id, name text NOT NULL, owner_id uuid NOT NULL, cohort_id uuid NULL, created_at, archived_at NULL)`; `saved_learner_group_members(group_id, student_id, PRIMARY KEY (group_id, student_id))`. Nhóm là danh sách tên cố định. | T25 |
| 444 | `444_class_lesson_review_items.sql` | `class_lessons.review_items jsonb NOT NULL DEFAULT '[]'` (mỗi phần tử `{bank_id, qid, source_assignment_id, added_by, added_at}`); `class_assignment_reminders(assignment_id, student_id, sent_on date, sent_at timestamptz, sent_by uuid, PRIMARY KEY (assignment_id, student_id, sent_on))` để chặn nhắc quá một lần một ngày và hiện "Đã nhắc HH:MM". | T27 |
| 445 | `445_mock_exam_audiences.sql` | Bảng `mock_exam_audiences` và các cột mới của `mock_exams` (5.5). Nới CHECK `mock_exams_exam_mode_chk` thành `IN ('sequential','retake','live','self_paced')`. Chưa đổi dữ liệu. | T31 |
| 446 | `446_mock_exam_mode_backfill.sql` | Điền `mock_exam_audiences` từ roster lớp của `mock_exams.cohort_id` và từ `mock_exam_assignments`; đổi `exam_mode` cũ sang tên mới; sửa `fn_set_exam_mode` (bản mới nhất: `grep -ln "fn_set_exam_mode" backend/migrations/*.sql \| sort \| tail -1`) nhận cả bốn giá trị. Chỉ chạy sau khi backend đọc được cả hai tên đã lên staging. | T31 |
| 447 | `447_mock_exam_events.sql` | `mock_exam_events(id, exam_id, sitting_id NULL, kind text, payload jsonb, actor_id NULL, created_at)` chỉ ghi thêm; `mock_exam_sittings.extra_seconds jsonb NOT NULL DEFAULT '{}'` (theo phần); `mock_exam_room_messages(id, exam_id, body, sent_by, sent_at)`. | T33 |
| 448 | `448_mock_exam_release_parts.sql` | `mock_exam_sittings.released_skills text[] NOT NULL DEFAULT '{}'`, `released_at timestamptz NULL`; `mock_exam_score_edits(id, sitting_id, skill, old_band, new_band, reason text NOT NULL, actor_id, created_at)` chỉ ghi thêm. Cột hiện có đánh dấu "đã trả" của sitting: CHƯA KIỂM (`grep -n "release" backend/services/mock_review_workflow.py \| head -20`); nếu đã có cột tương đương thì dùng lại, không thêm `released_at`. | T33 |
| 449 | `449_content_import_batches.sql` | `content_import_batches(id, code text UNIQUE, script text, skill text, environment text, mode text CHECK IN ('dry_run','import'), actor text, started_at, finished_at, created_count int, updated_count int, error_count int, status text, error_report_path text NULL)`; `content_import_batch_items(batch_id, item_kind text, item_id text, action text CHECK IN ('created','updated','error'), PRIMARY KEY (batch_id, item_kind, item_id))`. Dùng bảng nối thay vì thêm `batch_id` vào từng bảng nội dung. | T36 |
| 450 | `450_content_review_items.sql` | `content_review_items(id, item_kind text, item_id text, question_ref text, status text CHECK IN ('open','checked','fixed'), checked_by, checked_at, fixed_version text NULL, note text NULL, UNIQUE (item_kind, item_id, question_ref))`. Lý do (báo lỗi N người, tỉ lệ sai) tính lúc đọc. | T36 |
| 451 | `451_incident_groups.sql` | `incident_groups(fingerprint text, source text CHECK IN ('errors','grading','feedback'), status text CHECK IN ('new','in_review','resolved','ignored'), claimed_by, claimed_at, resolved_by, resolved_at, last_seen_at, note text NULL, PRIMARY KEY (source, fingerprint))`; `incident_group_notes(id, source, fingerprint, body, auto boolean, actor_id, created_at)`. | T07 |
| 452–459 | — | Dự phòng (8 số). | |

**Vừa dải:** dùng 12/20 số. Không cần số ngoài dải với phạm vi ghi ở mục 3. Nếu anh Andy duyệt các việc đang "gói sau" (tính lại điểm, thẻ Pháp lý, `lesson_primary`, tỉ lệ sai toàn kho) thì cần thêm khoảng 4–6 số, vẫn trong 452–459.

Cột và bảng **không** thuộc G09 nhưng màn G09 cần (gói kia phải có): số lượt chấm kèm mã kích hoạt và lệnh cấp thêm lượt cho lớp/học viên, trạng thái lưu trữ của khoá, hạn bổ sung của đơn, mốc hết hạn riêng của phần lượt chuyển và dòng sổ hết hạn phần lượt chuyển, lệnh chuyển lớp mã cũ sang đo lượt (G04); `result_release_mode`, mức công bố, hẹn giờ (GOI-11 mig 473–474); bảng thông báo và lần gửi (GOI-11 mig 470).

### 5.4 API mới và API sửa

Tiền tố theo router admin hiện có: `/admin/...` (không `/api`, trừ feedback). Model Pydantic với `_StrictOut` như `models/admin_overview.py`. Lỗi trả `{"detail": {"error_code", "message"}}`. Thời gian ISO 8601 UTC có `Z`. Mọi API tổng hợp trả 200 kèm `sources_failed: [str]` khi một nguồn lỗi (không làm hỏng cả trang).

**API G04 mà G09 gọi (đối chiếu GOI-04 bản 18/11, mục 5.9; G09 không viết các route này):**

| Việc ở G09 | Route G04 | Điểm phải khớp |
|---|---|---|
| Danh sách, tạo, sửa khoá (T13) | `GET · POST /admin/course-products`, `PATCH /admin/course-products/{id}` | Trả kèm `open_orders`, `active_learners`; lỗi 409 `slug_taken`, 422 thông điệp tiếng Việt |
| Lưu trữ khoá (T13) | `POST /admin/course-products/{id}/archive` body `{confirm_title}` | 409 `has_active_learners`, `has_open_orders`; 422 `title_mismatch`. Phân xử 14 đã xong: G04 có `archived_at` |
| Làn đơn và số đếm (T13, T06) | `GET /admin/enrollment-orders?status=&q=&late=1`, `GET /admin/enrollment-orders/counts` | `counts` có `expired_late_reported` (đơn hết hạn mà học viên báo đã chuyển) — hiện thành dòng cần xem ở làn Hết hạn |
| Trang một đơn (T13) | `GET /admin/enrollment-orders/{id}` | `Order` + `events[]` + `other_open_order_code`; đọc `info_kind`, `received_vnd`, `overpaid_vnd`, `supplement_by`, `admin_message`, `cancel_reason` (`learner`/`admin`), `cancel_note`, `late_transfer_reported_at`, `reopened_at` |
| Xác nhận và mở khoá (T13) | `POST …/{id}/confirm` body `{note, allow_expired, received_vnd}` | Trả `status` (`confirmed`/`already_confirmed`), `entitlement`, `credits_granted`, `reopened`; 409 `invalid_transition`, `has_open_order`, `account_suspended` |
| Yêu cầu bổ sung (T13) | `POST …/{id}/request-info` body `{info_kind: 'underpaid'\|'not_found'\|'other', received_vnd, message 3..1000, supplement_by}` | `supplement_by` null → máy chủ lấy `now() + ENROLL_SUPPLEMENT_HOURS`; `info_kind='underpaid'` hiện nhãn "Cần bổ sung · sai lệch"; G04 gửi thư `order_needs_info` |
| Huỷ đơn (T13) | `POST …/{id}/cancel` body `{message 3..500, confirm_order_code}` | 422 `order_code_mismatch`; lý do đọc lại ở `cancel_note` |
| Thẻ Khoá và quyền của hồ sơ (T04, T11) | `GET /admin/users/{user_id}/access`, `GET /admin/users/{user_id}/credits` | Số dư **một kho chung** theo quyền (`credits.balance`), tổng theo nguồn `by_kind.online` / `by_kind.class`; không có số dư theo kỹ năng. Điểm 23: mỗi quyền cần đọc được **số lượt chuyển còn lại** và **mốc hết hạn của phần lượt chuyển** — đã đối chiếu GOI-04 mục 5.9 bản 18/11 chiều: mỗi phần tử của `GET /admin/users/{user_id}/access` có `credits.carry_balance` (số lượt chuyển còn dùng được, 0 khi không có hoặc đã quá hạn bảo lưu) và `credits.carry_expires_at`; cùng response có `content_visible_until`, `content_days_after_expiry`. Dòng sổ ở `GET /admin/users/{user_id}/credits` có `reason` ∈ `carry_over`, `carry_expire` và `label_vi` do G04 trả ("Chuyển lượt chưa dùng từ kỳ trước khi đăng ký lại", "Lượt chuyển hết hạn bảo lưu", "Cộng khi lớp chuyển sang tính lượt") — G09 in đúng `label_vi`. `carry_balance = 0` hoặc thiếu trường → G09 ẩn dòng lượt chuyển |
| Lượt chuyển khi đăng ký lại ở trang đơn (T13) | `GET /admin/enrollment-orders/{id}`; `POST …/{id}/confirm` (hàm `fn_enrollment_order_confirm` của G04 trả `renews_entitlement_id`, `credits_granted`) | Đơn đăng ký lại cần đọc được: đây là đơn đăng ký lại, số lượt sẽ chuyển (xem trước) và đã chuyển (sau xác nhận), hạn của phần lượt chuyển. Cấu hình hiển thị: `credit_carry_percent` (100), `credit_carry_valid_days` (60). Đã đối chiếu GOI-04 mục 5.9: G04 **không** có trường "xem trước số lượt sẽ chuyển" trên đơn. Trước khi xác nhận, G09 hiện "Ước tính chuyển: N lượt" với N = `credits.balance` của quyền cũ cùng sản phẩm đọc từ `GET /admin/users/{user_id}/access` (ghi rõ chữ "ước tính"; quyền cũ đã đóng sổ hoặc không đọc được → không hiện số); sau xác nhận đọc `credits.carry_balance`, `carry_expires_at` của quyền mới. `credits_granted` của đơn chưa gồm lượt chuyển |
| Cấp lượt cho lớp cũ (T43) | `GET /admin/credits/convert-class/preview?cohort_id=…`, `POST /admin/credits/convert-class` body `{cohort_id, credits_per_member, request_key}` | Xem trước trả danh sách thành viên dùng mã cũ chưa có nơi nhận lượt và số gợi ý từ cấu hình `legacy_class_initial_credits`; lệnh ghi idempotent theo `request_key`. Hình dạng response (đã đối chiếu GOI-04 mục 5.9 bản 18/11 chiều): `preview` → `{cohort, product, products[], suggested_credits, members[{user_id, display_name, state, expires_at}], counts{to_convert, already_metered, no_account}}`, `state` ∈ `to_convert`, `already_metered`, `no_account`; `POST` nhận thêm `product_id` (bắt buộc khi `products` có hơn một) → `{status: converted|replay, converted[], skipped[{user_id, reason}]}`; lỗi 409 `cohort_archived`, `cohort_has_no_course`, `no_class_product`, `product_ambiguous`. Danh sách lớp chưa chuyển cho T06 và bộ lọc `/admin/classes?metering=legacy`: `GET /admin/credits/convert-class/pending` → `{items[{cohort_id, cohort_name, course_code, members, pending_members}]}`. Chỉ admin |
| Đếm "lớp chưa chuyển sang đo lượt" (T06, T43) | hàm đọc của G04 dùng chung với `preview` | G09 cần đếm theo lớp số thành viên active dùng mã cũ chưa có nơi nhận lượt. G04 chưa có hàm đếm nhiều lớp một lần → T06 gọi phần lõi của `preview` cho từng lớp chưa lưu trữ (số lớp nhỏ), nhớ tạm 60 giây |
| Cấp, gia hạn, thu hồi quyền (T14) | `POST /admin/entitlements` (`request_key`), `POST /admin/entitlements/{id}/extend`, `…/revoke` | Mỗi người một lời gọi; không có route lô |
| Điều chỉnh lượt (T15) | `POST /admin/credits/adjust` body `{entitlement_id, delta, reason 10..500, request_key}` | 409 `would_go_negative`, `not_usable` |
| Cấp thêm lượt (T15, T29) | `POST /admin/credits/grant-extra` body `{cohort_id \| null, user_ids \| null, credits, reason 3..500, request_key}` | Trả `{granted:[{user_id, entitlement_id, balance}], skipped:[{user_id, reason}]}`; hiện cả hai danh sách (FR-09-054). Giáo viên có được gọi hay không: GOI-04 Q5 — hiện chỉ admin |
| Tạo mã cho lớp kèm lượt (T29) | route tạo mã hiện có `/admin/access-codes/generate`, G04-T06 thêm `product_id`, `grant_days`, `grant_credits` | Cột "Số lượt chấm cấp kèm mã" đọc `grant_credits` |
| Một phiên mỗi tài khoản | — | Chỉ áp học viên; admin, giáo viên không bao giờ nhận 409 `session_not_current` (GOI-04 mục 5.13) |

Không có ở G04 và **không dựng ở G09**: khối "đồng ý dùng bản ghi âm" trong hồ sơ học viên (tính năng hoãn theo quyết định 18/11/2026; GOI-04 mục 5.17 ĐÃ BỎ).


**Hàm phạm vi dùng chung** — `backend/services/staff_scope.py` (T24):
`async def resolve_staff_scope(authorization) -> StaffScope` (gọi `require_instructor`; trả `role`, `user_id`, `cohort_ids: set | None` — `None` nghĩa admin thấy tất cả) và `scope.assert_cohort(cohort_id)` ném 404 khi lớp không thuộc giáo viên. Lớp của giáo viên = `cohorts.instructor_id = user_id` — **đã chốt 18/11 chiều: mỗi lớp một giáo viên, một cột, không có bảng `cohort_instructors`** (Q18 đóng). Đây là nơi duy nhất trong backend đọc `cohorts.instructor_id` để quyết định quyền; GOI-11 (gửi thông báo, công bố điểm) và mọi route G09 gọi hàm này, không tự truy vấn. Học viên thuộc phạm vi của giáo viên = thành viên active (`student_cohort_memberships`) của các lớp trong `cohort_ids`. Lớp có `instructor_id` NULL không thuộc giáo viên nào.
Kiểm kê guard (đã kiểm ở `c3bc71574`, `backend/tests/test_staff_guard_inventory.py` dòng 57–63 và 260–275): lệnh `await` đầu tiên của handler phải gọi một tên trong `GUARD_NAMES` (`require_admin`, `require_instructor`, `_me`, `_require_curated_admin`, `_require_private_admin`), hoặc một hàm bọc **cùng module với router** có lệnh đầu là guard và nhận thẳng `authorization`. `resolve_staff_scope` nằm ở `services/` nên **không** được nhận. Cách làm: T24 thêm tên `resolve_staff_scope` vào `GUARD_NAMES` trong cùng PR (đổi test có chủ ý, ghi rõ trong PR) kèm một test khẳng định lệnh đầu của `resolve_staff_scope` là `await require_instructor(authorization)` (mẫu `test_guard_wrappers_await_the_shared_guard_first`, dòng 277). Nếu anh Andy không muốn đổi kiểm kê: mỗi route gọi `await require_instructor(authorization)` trước rồi mới gọi hàm phạm vi.
Gắn giáo viên vào lớp: `PATCH /admin/cohorts/{cohort_id}` hiện có (`routers/cohorts.py` dòng 143, chỉ admin) nhận thêm `instructor_id: uuid | null`, `weekly_schedule`, `start_date`. `instructor_id` khác null phải là người dùng có `role ∈ ('instructor','admin')` và đang hoạt động → sai thì 422 `invalid_instructor` (thông điệp tiếng Việt). Mỗi lần đổi ghi `class_action_log`. `GET /admin/cohorts` (danh sách, `routers/cohorts.py` dòng 66) và `GET /admin/cohorts/{cohort_id}/members` (dòng 302 — route trang lớp đang dùng để lấy thông tin lớp; repo ở `c3bc71574` không có route đọc một lớp riêng) trả thêm `instructor: {id, name} | null` cho lớp.

**Danh bạ, hồ sơ, ghi chú** (`routers/admin_learners.py`, `routers/admin_care_notes.py`)

| Method · path | Quyền | Request | Response (rút gọn) | Lỗi |
|---|---|---|---|---|
| `GET /admin/learners` | admin | `q`, `cohort_id`, `kind` (`offline`/`online`/`both`/`none`), `status` (`active`/`expiring`/`expired`/`archived`), `attention` (`any`/`late_streak`/`inactive`/`expiring`/`low_credits`), `credits_max`, `role` (mặc định `user,student`), `page` (≥1), `page_size` = 25 | `{ items: [{ ref, name, email?, student_code?, account_state, profile_state, kind, cohorts: [{id,name}], courses: [{title, state, expires_at?, days_left?}]\|null, credits_left: int\|null, attention: [{code, text}], last_active_at? }], total, page }` | 422 |
| `GET /admin/learners/{ref}` | admin; giáo viên qua `GET /instructor/learners/{ref}` cùng service, 404 nếu không thuộc lớp mình | — | `{ ref, canonical_ref, summary: Summary, sources_failed }` | 404 |
| `GET /admin/learners/{ref}/summary` | admin, giáo viên (lớp mình) | — | `Summary` = `{ name, cohorts, courses, status: {level: 'ok'\|'attention', reasons: [{code,text}] (≤2)}, goal: {target_band?, exam_date?, source: 'admin'\|'learner'\|'both_equal'\|'conflict'\|'none'}, overdue: {count, latest_title?}, recent_bands: {writing: [..≤4]\|null, speaking: [..≤4]\|null}, last_active_at?, latest_note: {author, at, text}\|null }` | 404 |
| `GET /admin/learners/{ref}/overview` | admin | — | `{ alerts: {open: [{code, text, action}], checked_off: [code]}, goal: {admin: {target_band?, target_date?}, learner: {target_band?, exam_date?}, conflict: bool, estimated_band?: num\|null}, continuity: {weeks: [[bool\|null ×7] ×8], streak_days, minutes_this_week, minutes_last_week}, assigned: {on_time, late, missing, open: [...], overdue: [{assignment_id, title, days_overdue, last_reminded_at?}]}, scores: {grammar: [{at, pct, lesson_no?}], writing: [{at, band}], speaking: [...], mock: [...], milestones: [{at, label}]}, side: {due_notes: [...], courses: [...], credits_left: int\|null, credits_carried: {amount: int, expires_at}\|null}, sources_failed }` — `credits_carried` chép từ trường G04 trả (FR-09-056), `null` khi không có lượt chuyển hoặc G04 chưa trả | |
| `POST /admin/learners/{ref}/goal/resolve` | admin | `{ use: 'admin'\|'learner' }` | `{ goal }` — ghi cả hai bảng, ghi nhật ký | 409 `no_conflict` |
| `GET /admin/learners/{ref}/attempts` | admin | `skill?`, `state?`, `cursor` | `{ items: [{ skill, kind, id, title, state, result_text?, submitted_at, open_href }], next_cursor?, writing_repeated_errors: [...]\|null, weak_grammar_groups: [...]\|null }` | |
| `GET /admin/learners/{ref}/ai-cost` | admin | `window` 7\|30\|90 | `{ total_usd, unpriced_calls, by_feature: [...] }` | |
| `GET /admin/learners/{ref}/log` | admin | `kind?`, `cursor` | `{ items: [{ at, actor_name?, source: 'access_code'\|'security'\|'class'\|'role'\|'entitlement'\|'credit'\|'order'\|'goal', text }] }` | |
| `GET /admin/learners/{ref}/care-notes` | admin | — | `{ items: [{ id, author_name, created_at, body, next_action?, due_on?, done_at?, is_initial, editable: bool }] }` — khi chưa có dòng `is_initial` mà `students.persona_notes` khác rỗng, chèn một phần tử ảo `is_initial: true` (không ghi DB) | |
| `POST /admin/learners/{ref}/care-notes` | admin | `{ body, next_action?, due_on? }` | 201 `{ note }` | 422 |
| `PATCH /admin/care-notes/{id}` | admin | `{ body?, next_action?, due_on?, done?: bool }` | `{ note }` | 409 `note_locked` (quá `CARE_NOTE_EDIT_HOURS`, chỉ còn đổi `done`) |
| `DELETE /admin/care-notes/{id}` | admin | — | 204 (xoá mềm) | 409 `note_locked` |

`attention.code`/`status.reasons.code` ∈ `late_streak`, `inactive`, `course_expiring`, `low_credits`. Một hàm duy nhất `services/learner_attention.py::compute(student_ids, thresholds)` dùng cho mọi nơi (FR-09-029). Nguồn bắt buộc dùng lại: `services/student_service.get_student_with_history`, `essay_service.get_student_summary`, `_aggregate_usage_for_users` (`routers/admin.py`), `student_home_aggregator._build_streak`, hàm bài làm trong lớp của `admin_class_assignments.py` (`student_work`), API đọc của G04 (chưa có → trường liên quan `null`). Cột khoá người dùng của `listening_test_attempts`, `reading_test_attempts`, `mock_exam_sittings`: CHƯA KIỂM — `grep -n "CREATE TABLE.*<bảng>" -A25 backend/migrations/*.sql`.

**Việc cần làm, ngưỡng, tìm nhanh** (`routers/admin_attention.py`, `routers/admin_settings.py`, `routers/admin_search.py`)

| Method · path | Quyền | Response (rút gọn) |
|---|---|---|
| `GET /admin/attention` | admin; giáo viên gọi `GET /instructor/attention` (cùng service, lọc `cohort_ids`, bỏ trường admin) | `{ queues: { exams_today: Q, writing_review: Q & {ai_failed: int}, speaking_mock_pending: Q, course_tests_awaiting_release: Q, assignments_overdue: Q, regrade_new: Q, enrollments_reported: Q, care_due_today: Q, incident_groups_open: Q, feedback_open: Q, entitlements_expiring: Q, classes_unmetered: Q }, classes_week: [{ cohort_id, name, next_lesson: {lesson_id, lesson_no, date, starts_at?}, following_lesson?, has_assignment: bool, pending_review: int, last_assignment_id? }], attention_learners: [{ ref, name, cohort, reasons: [...] }] (≤8), ops_week: { on_time_rate: {value, lowest_cohort_id}\|null, … }, generated_at }` với `Q = { count: int\|null, oldest_at: str\|null, overdue: bool, error: bool, unavailable: bool }`. `count = null` khi nguồn lỗi (`error: true`) hoặc gói phụ thuộc chưa có (`unavailable: true`). `classes_unmetered.count` = số lớp chưa lưu trữ còn thành viên active dùng mã cũ chưa có nơi nhận lượt (FR-09-058); chỉ có ở bản admin. |
| `GET /admin/settings/thresholds` | admin, giáo viên (chỉ đọc) | `{ items: [{ key, group, label, anchor, value, unit, min, max, fixed: bool }] }` |
| `PUT /admin/settings/thresholds` | admin (AAL2) | `{ changes: [{key, value}], reason }` → `{ items }`; 422 `out_of_range` kèm thông điệp tiếng Việt; ghi `admin_settings_log` |
| `GET /admin/settings/{section}` · `PUT` (`section` ∈ `email`, `notices`, `payment`) | admin | đọc/ghi một khoá của `admin_settings`; `payment` chỉ có PUT khi Q20 được duyệt |
| `GET /admin/settings/log` | admin | `?section&cursor` → `{ items: [{at, actor_name, section, changes, reason}] }`. Khai báo route này (và `/thresholds`, `/trial` của GOI-11) **trước** route `/{section}`; `section` là enum nên `log` không bao giờ khớp nhầm. |
| `GET /admin/search` | admin | `q` (≥2) → `{ learners[≤3], classes[≤3], submissions[≤3], content[≤3], orders[≤3] }` mỗi dòng `{title, meta, href}`; 422 q ngắn |
| `GET /instructor/search` | giáo viên | như trên, không có `content`, `orders`; lọc theo `cohort_ids` |

**Kết quả một bài giao** — **một** API tổng hợp thay ba API của ba tab (thêm vào `routers/admin_class_assignments.py`, logic ở `services/assignment_result.py`):

`GET /admin/cohorts/{cohort_id}/assignments/{assignment_id}/result?group_by=truc_nhom|subtype` — quyền: admin, hoặc giáo viên của lớp (`staff_scope`). Response:

```json
{
  "assignment": {"id": "…", "title": "…", "skill": "course", "variant": "objective",
                 "lesson": {"id": "…", "lesson_no": 13, "date": "2026-11-19"},
                 "due_at": "…Z", "pass_pct": 70, "question_count": 90,
                 "release_mode": null, "recipient_scope": "class"},
  "states": {"on_time": 9, "late": 2, "in_progress": 1, "not_opened": 1, "no_account": 1},
  "who": [{"student_id": "…", "name": "…", "state": "late", "submitted_at": "…Z",
           "late_minutes": 190, "opened_at": "…Z", "stalled": false,
           "overdue": false, "last_reminded_at": null}],
  "performance": {"submitted": 11,
                  "first_run": {"scores": [{"student_id": "…", "pct": 64}],
                                "median_pct": 64, "pass_rate": 0.45, "retake_students": 4},
                  "median_duration_sec": 1380,
                  "previous": {"assignment_id": "…", "title": "…", "median_pct": 71}},
  "weak_spots": {"group_by": "truc_nhom", "excluded_essay_questions": 3,
                 "groups": [{"key": "HIEN-TAI-DON-TIEP-DIEN", "label": "…",
                             "label_source": "table", "question_count": 12,
                             "wrong_rate": 0.41, "students_wrong_2plus": 7, "median_sec": 22,
                             "top_questions": [{"qid": "…", "prompt": "…", "answer_text": "…",
                                                "attempted": 11, "wrong": 8,
                                                "top_wrong": {"option": "B", "text": "…",
                                                              "count": 6, "why_wrong": "…"}}]}]},
  "attention": [{"student_id": "…", "name": "…", "first_pct": 42, "delta_prev": -18,
                 "reasons": ["below_pass", "dropped_twice", "too_fast", "many_retakes", "stalled"]}],
  "teach_next": {"suggested": [{"qid": "…", "group_key": "…"}],
                 "saved": {"lesson_id": "…", "items": ["…"], "saved_at": "…Z"}},
  "sources_failed": []
}
```

Quy tắc:
- `variant` ∈ `objective` (bài `skill='course'` chấm máy, quiz), `rubric` (Writing/Speaking), `course_test` (đề giữa/cuối kỳ: `content_config.completion_mode='single_attempt'`). Với `rubric`: `weak_spots.group_by = "criterion"`, `groups[]` là từng tiêu chí với `median_band`, thêm `top_annotation_kinds: [{kind, essays}] | null`; `performance.first_run` thành `bands`. Với `course_test`: `group_by = "lesson"`, `groups[].key` = `B01`…`B20`, thêm `matrix: [{student_id, cells: [{lesson, correct, total}]}]` với `total` = số câu của buổi trong đề.
- Năm trạng thái suy từ dữ liệu hiện có: `no_account` = `students.user_id IS NULL`; `on_time` = `submitted_at <= due_at`; `late` = `submitted_at > due_at`; `in_progress` = chưa nộp và `opened_at` có; `not_opened` = chưa nộp và `opened_at` NULL. Người chưa nộp đã qua hạn mang thêm `overdue: true` (không phải trạng thái thứ sáu). `stalled` lấy cờ `course_stalled` sẵn có của `course_attempt_report`.
- `weak_spots` chỉ tính lượt đầu (`quiz_sessions.kind='run'`, `attempt_no` nhỏ nhất của mỗi câu); gom theo `quiz_attempts.skill` (hoặc `subtype`); **không cắt** số nhóm; `top_questions` tối đa 3 câu mỗi nhóm; loại câu tự luận (subtype E1–E3 — tên subtype CHƯA KIỂM: `grep -n "E1\|E2\|E3" backend/scripts/import_course_exercise_bank.py`).
- `label`: tra bảng tên hiển thị `backend/content/course-labels/truc_nhom_vi.json` và `subtype_vi.json` (file mới, không phải migration); không có tên → trả chính mã và `label_source: "code"` (giao diện vẫn hiện, không báo lỗi). Tên trên tờ thiết kế là tên đề xuất (Q27).
- `performance`, `weak_spots` = `null` khi chưa ai nộp. `performance.previous` = `null` khi lớp không có bài trước cùng loại (xếp theo `class_lessons.lesson_no`, rồi `due_at`).
- `attention.reasons` dùng ngưỡng ở Cài đặt (`too_fast_sec_per_question`, `many_retakes_count`, `stalled_hours`); `below_pass` dùng `pass_pct` của bài.
- `teach_next.suggested`: tối đa 3 câu theo FR-09-130.
- GOI-11 phần E: với bài chế độ công bố, API này (phía nhân sự) luôn có điểm (FR-11-075).

API đi kèm:

| Method · path | Quyền | Request → Response |
|---|---|---|
| `PUT /admin/cohorts/{c}/lessons/{lesson_id}/review-items` | admin, giáo viên của lớp | `{ items: [{bank_id, qid, source_assignment_id}] }` → `{ lesson }` |
| `POST /admin/cohorts/{c}/assignments/{a}/remind` | admin, giáo viên của lớp | `{ student_ids: [uuid] \| null }` (null = mọi người chưa nộp đã qua hạn) → `{ sent: int, skipped_already_today: int, skipped_no_account: int }`; ghi `class_assignment_reminders`; tạo thông báo `reminder` qua service của GOI-11 phần A (khoá chống trùng `remind:{assignment}:{student}:{ngày VN}`) |
| `GET /admin/cohorts/{c}/assignment-matrix` | admin, giáo viên của lớp | `{ assignments: [{id,title,due_at}], rows: [{student_id, name, cells: [{state_text}], done: int, due: int}] }` — bảng học viên × bài |

Ba API cũ (`tally`, `attempt-report`, `students/{u}/report`): **không xoá** trong gói này. `tally` còn được GOI-11 phần E mở rộng và bảng công bố dùng; `students/{u}/report` còn dùng cho "bài làm từng câu" của một học viên; `attempt-report` chỉ gỡ lời gọi ở frontend. Xoá endpoint là việc gói sau, sau khi không còn nơi gọi.

**Nhóm đã lưu và giao bài** (`routers/admin_learner_groups.py`; giao bài dùng `POST /admin/cohorts/{c}/assignments` hiện có)

| Method · path | Quyền | Ghi chú |
|---|---|---|
| `GET /admin/learner-groups?cohort_id=` · `POST` · `PATCH /{id}` · `DELETE /{id}` (lưu trữ) | admin, giáo viên (chỉ nhóm mình tạo, thành viên thuộc lớp mình) | `POST` body `{ name, cohort_id?, student_ids: [uuid] }` |
| `POST /admin/cohorts/{c}/assignments` (hiện có) | như hiện tại + giáo viên của lớp (T26) | Thành phần giao bài gửi `student_ids` khi "Chọn tay" hoặc "Nhóm đã lưu" (đã có `recipient_scope='subset'`, mig 193); thêm trường của GOI-11 5.5.8 (`result_release_mode`…) khi bài là bài kiểm tra |

**Kỳ thi** (sửa `routers/admin_mock_exams.py`)

| Method · path | Ghi chú |
|---|---|
| `POST /admin/mock-exams` (sửa) | Nhận `exam_mode: "live"\|"self_paced"` (vẫn nhận tên cũ, ánh xạ sang tên mới); cho phép thiếu đề của kỹ năng không dự thi; `skills: [..]` (≥1); tạo ở trạng thái `draft` không cần người thi. |
| `GET /admin/mock-exams` (sửa) | Mỗi kỳ thêm `display_state` ∈ `draft`, `scheduled`, `open`, `running`, `grading`, `released`; `audience_count`; `exam_mode` tên mới. |
| `GET /admin/mock-exams/{id}/audience` | `{ items: [{ user_id, student_id, name, cohort?, source: {kind: 'cohort'\|'learner'\|'group', label}, skills: [...], selected: bool, excluded_reason?, open_from?, open_until? }], practice_overlap: [{ skill, count }] }` |
| `PUT /admin/mock-exams/{id}/audience` | `{ add_cohort_ids?: [], add_student_ids?: [], add_group_ids?: [], set: [{user_id, selected?, skills?}], window?: {open_from, open_until} }` → như GET. 409 `exam_locked` khi đề đã khoá (thêm người sau khi phòng mở vẫn được, ghi `mock_exam_events`). |
| `POST /admin/mock-exams/{id}/schedule` | Kiểm điều kiện FR-09-144; 422 `not_ready` kèm `missing: [...]`; chuyển `status='published'`; gửi thông báo cho người được chọn (GOI-11). |
| `POST /admin/mock-exams/{id}/extra-time` | `{ sitting_id, section, seconds, reason }`. Kỳ `self_paced`: `section` phải là phần **đang chạy** của sitting đó, không thì 409 `section_not_running`; các phần sau lùi theo (5.5). |
| `GET /admin/mock-exams/{id}/live` (sửa) | Kỳ `self_paced`: mỗi người thêm `self_paced_state` ∈ `not_started` \| `in_progress` \| `submitted` \| `missed`, `current_section`, `section_time_left_seconds`, `started_at`, `expected_end_at`. `submitted` = mọi phần của người đó đã nộp, hoặc giờ cả bài đã hết (phần bỏ dở được tự nộp); `missed` = khoảng mở đã đóng mà chưa bắt đầu. Không có giá trị nào cho "nghỉ giữa phần" (FR-09-151). Thêm `idle_threshold_minutes` (T33). |
| `POST /admin/mock-exams/{id}/room-message` | `{ body }` |
| `GET /admin/mock-exams/{id}/analysis` | `{ band_distribution: {listening: [...]\|null, …}, top_wrong: {listening: [..≤10], reading: [..≤10]}, by_question_type: {...}, pacing: [{sitting_id, name, points: [...], long_pauses: [...]}], vs_previous: {...}\|null, writing_criteria_median: {...}\|null }` |
| `POST /admin/mock-exams/{id}/release` | `{ mode: 'complete_only'\|'include_partial', confirm_title, request_key }` → `{ released: int, partial: int, skipped: int }`; 422 `confirm_mismatch`. Gọi logic của `bulk-release` hiện có cho người đủ điều kiện; `include_partial` ghi `released_skills`. |
| `POST /admin/mock-exams/sittings/{id}/score-edit` | `{ skill, new_band, reason }` — chỉ sau khi đã trả; ghi `mock_exam_score_edits`, gửi thông báo. |
| `GET /admin/mock-exams/{id}/events` | Dòng thời gian cho thẻ Nhật ký; lọc `kind`. |
| `GET /admin/speaking/mock-queue` | Hàng chờ Speaking thi thử: `{ items: [{ sitting_id, exam: {id,title}, name, cohort, submitted_at, waited_hours, overdue, flags: [..], claimed_by? }] }`; lọc `exam_id`. Quyền: admin, giáo viên (lớp mình). |

Giữ nguyên: `/open`, `/advance`, `/collect`, `/live`, `/roster`, `/retest-summary`, `/assignments` (dùng cho thi bù), `/sittings/{id}/retest-flags`, `/sittings/{id}/pacing`, `/sittings/{id}/record-speaking`, `/bulk-final-bands`.

**Nội dung, sự cố** (`routers/admin_content_batches.py`; sửa `routers/error_logs.py`; `routers/admin_incidents.py`)

| Method · path | Response (rút gọn) |
|---|---|
| `GET /admin/content/batches?skill=&cursor=` | `{ items: [{ id, code, script_label, environment, mode, actor, started_at, created_count, updated_count, error_count, status, pending_review: int, has_error_report: bool }] }` |
| `GET /admin/content/batches/{id}/items` | `{ items: [{ item_kind, item_id, title, action, open_href }] }` |
| `GET /admin/content/batches/{id}/error-report` | file `.csv` |
| `GET /admin/content/review?skill=&status=open` | `{ items: [{ id?, item_kind, item_id, question_ref, question_text, item_title, reasons: [{code: 'reported'\|'high_error'\|'common_wrong', text}], attempts: int\|null, status }] }` — nguồn: `user_feedback` (Reading/Listening), `quiz_item_error_rates` (quiz Từ vựng/Ngữ pháp) |
| `POST /admin/content/review/mark` | `{ item_kind, item_id, question_ref, status: 'checked'\|'fixed', fixed_version?, note? }` |
| `GET /admin/incidents/groups?source=&status=open&page=` | `{ items: [{ source, fingerprint, title, level?, count, learners: int, first_at, last_at, status, claimed_by_name?, overdue: bool }], total, counts: {errors, grading, feedback}, review_items_open: int }` (25 nhóm/trang) |
| `GET /admin/incidents/groups/{source}/{fingerprint}` | chi tiết: mô tả bằng lời, ảnh hưởng, học viên (link hồ sơ), `technical` (gập sẵn), `notes[]` |
| `POST /admin/incidents/groups/bulk` | `{ groups: [{source, fingerprint, expected_count}], action: 'resolve'\|'claim'\|'ignore'\|'reopen', note? }` → `{ changed: int, conflicts: [...] }`; 409 từng nhóm khi `expected_count` lệch |

`fingerprint` = sha1 của `source|level|path đã thay uuid/số bằng :id|message đã thay uuid/số/chuỗi trong nháy bằng ?`, tính ở Python (`services/error_log_grouping.py`); quét 5.000 dòng mới nhất, vượt thì `truncated: true`. Trạng thái nhóm lưu ở `incident_groups`; nhóm chưa có dòng = `new`; khi có dòng lỗi mới sau `resolved_at` thì đọc ra là `new` (tự mở lại) và giữ ghi chú.

### 5.5 Mô hình người dự thi và tên chế độ (migration 445–446)

`mock_exam_audiences`:

| Cột | Kiểu | Ghi chú |
|---|---|---|
| id | uuid PK | |
| exam_id | uuid NOT NULL REFERENCES mock_exams ON DELETE CASCADE | |
| user_id | uuid NULL REFERENCES users | NULL khi học viên chưa có tài khoản (dòng chỉ để hiện, `selected=false`) |
| student_id | uuid NOT NULL REFERENCES students | |
| source_kind | text CHECK IN ('cohort','learner','group') | Nguồn đầu tiên đưa người này vào |
| source_cohort_id / source_group_id | uuid NULL | |
| skills | text[] NOT NULL | ⊆ kỹ năng của kỳ thi, ≥1 |
| selected | boolean NOT NULL DEFAULT true | Bỏ chọn = không dự thi |
| excluded_reason | text NULL | Ví dụ `no_account` |
| open_from, open_until | timestamptz NULL | Khoảng mở riêng (tự làm, thi bù) |
| purpose | text CHECK IN ('main','makeup') DEFAULT 'main' | Thi bù là mục đích, không phải chế độ |
| added_by, added_at | | |
| UNIQUE (exam_id, student_id, purpose) | | Khử trùng theo học viên |

Cột mới của `mock_exams`: `skills text[] NULL` (NULL = đủ bốn như cũ), `allow_early_advance boolean NOT NULL DEFAULT false`, `starts_at timestamptz NULL` (giờ bắt đầu phòng live), `draft_state jsonb NULL` (bước đang soạn).

Lớp tương thích (bắt buộc, vì phía học viên và các test hiện đọc tên cũ):
1. `services/mock_exam_modes.py`: `normalize(mode)` ánh xạ `sequential→live`, `retake→self_paced`; `is_live(mode)`, `is_self_paced(mode)`. Mọi chỗ so sánh chuỗi `'sequential'`/`'retake'` trong backend đổi sang gọi hai hàm này (liệt kê bằng `grep -rn "sequential\|retake" backend/routers backend/services --include="*.py" | grep -v "/tests/"`; có khoảng 20 file frontend chứa hai chuỗi này — phần admin sửa ở T32/T34, phần học viên thuộc G08).
2. API admin trả tên mới; nhận cả hai. API học viên (`routers/mock_exams.py`) **giữ trả tên cũ** cho tới khi G08 đổi (trường `exam_mode` cũ + trường mới `exam_mode_v2`).
3. Ghi kép: thêm/bớt người dự thi cập nhật cả `mock_exam_audiences` và, khi kỳ thi tự làm, `mock_exam_assignments` (để đường học viên hiện tại vẫn chạy). Với kỳ live có nhiều lớp hoặc người lẻ: `admin_live_monitor` và cổng vào phòng của học viên phải đọc roster từ `mock_exam_audiences` thay cho `cohort_id` — sửa `admin_live_monitor` ở T31; cổng học viên là điểm G08 phải khớp (mục 7). `mock_exams.cohort_id` giữ nguyên, đặt bằng lớp đầu tiên của danh sách.
4. Không xoá cột, bảng cũ trong gói này.

**Kỳ `self_paced`: một mốc bắt đầu, các phần chạy liền, làm một lần (chốt 18/11; điểm 23: KHÔNG nghỉ giữa các phần).**

Hiện trạng (đã kiểm ở `c3bc71574`, `backend/services/mock_exam_service.py` dòng 656–700): chế độ `retake` hiện **cho nghỉ giữa phần** — mỗi phần có mốc `<phần>_started_at` riêng trên sitting, chỉ ghi khi học viên bấm bắt đầu phần đó; giữa hai phần `retake_active_section` trả `not_started` (học viên đứng ở màn chọn phần, không đồng hồ nào chạy). Hành vi này phải đổi cho kỳ `self_paced`.

Hợp đồng mới (máy chủ là chủ đồng hồ; G09-T31 ghi hợp đồng và phần admin, G08-T22 làm phía học viên):
1. **Một mốc bắt đầu cho cả bài** = `<phần đầu>_started_at` của sitting (phần đầu theo thứ tự cố định Listening → Reading → Writing trong các kỹ năng của người đó). Không thêm cột mốc mới.
2. **Phần kế bắt đầu ngay khi phần trước kết thúc.** Mốc `<phần kế>_started_at` do **máy chủ** ghi, bằng thời điểm nhỏ hơn giữa lúc nộp phần trước và lúc phần trước hết giờ (`started_at` + thời lượng + giờ cộng của phần đó), cộng `MOCK_SELF_PACED_GAP_SECONDS` (mặc định 0 — Q31). Người học không có nút nào quyết định lúc bắt đầu phần kế.
3. Phần hết giờ mà chưa nộp → máy chủ tự nộp với phần đã làm và ghi mốc phần kế như điểm 2, kể cả khi người thi đã đóng trình duyệt hay mất mạng (đồng hồ không dừng — theo quy tắc full test ở 00 mục 2 điểm 22; mặc định tạm, Q31). Job quét sitting hết giờ hiện có (`reap_expired_retake_sittings`, dòng 3565) phải đi hết chuỗi phần còn lại, không dừng sau một phần.
4. Không có trạng thái "giữa hai phần": sau khi bắt đầu, hàm tính phần đang chạy chỉ trả một phần đang chạy hoặc `done`. Không có màn chọn phần, không "làm phần sau vào lúc khác", không mở lại phần đã nộp.
5. Giờ dự kiến xong cả bài `expected_end_at` = mốc bắt đầu + tổng thời lượng các phần + tổng giờ cộng (+ khoảng chuyển nếu có); nộp sớm một phần thì các phần sau bắt đầu sớm hơn.
6. Bắt đầu chỉ trong khoảng mở (`open_from`…`open_until` của người đó). Đã bắt đầu thì làm hết chuỗi phần dù vượt `open_until` (mặc định tạm, Q31). Chưa bắt đầu khi khoảng mở đóng → `missed` ("Không dự thi").
7. Một lần: một lượt `main` mỗi người mỗi kỳ (UNIQUE ở bảng trên); làm lại = thi bù do admin cấp.
8. Cộng giờ (`extra-time`): chỉ cho phần đang chạy; ghi vào `mock_exam_sittings.extra_seconds` theo phần (migration 447); mốc của các phần sau tính theo điểm 2 nên tự lùi.

Dữ liệu `retake` cũ (thi bù đang mở lúc đổi): sitting đã có phần nộp xong mà phần kế chưa bắt đầu giữ cách cũ tới khi xong (không tự bấm giờ thay người thi); quy tắc mới áp cho sitting tạo sau khi cờ `mock_exam_audiences_learner` bật.

Giả định của người thiết kế (Q12, Q13): thêm lớp chụp danh sách lúc thêm (học viên vào lớp sau không tự vào kỳ thi); thi bù hiện tạo kỳ `retake` riêng có `source_exam_id` — gói này **giữ cơ chế đó**, chỉ hiện liên kết ở thẻ Thí sinh; gộp kết quả thi bù vào kỳ gốc chờ duyệt.

### 5.6 Bảng ngưỡng vận hành (khoá `ops_thresholds` của `admin_settings`)

Giá trị dưới đây là **mặc định đề xuất** từ tờ AdminCaiDat mục 7, nạp ở migration 440; chủ dự án sửa trên trang (Q15). Mã giao diện và backend không ghi các số này ở chỗ khác; đọc qua `services/ops_thresholds.py::get()` (cache 60 giây) và `GET /admin/settings/thresholds`.

| Khoá | Nhãn · mốc tính | Mặc định | Khoảng |
|---|---|---|---|
| `order_confirm_hours` | Đơn đăng ký chờ xác nhận · từ lúc học viên báo đã chuyển | 24 giờ | 1–168 |
| `writing_review_hours` | Bài Writing chờ giáo viên duyệt (lớp offline) · từ lúc AI chấm xong (bài AI lỗi: từ lúc nộp) | 48 giờ | 1–336 |
| `regrade_hours` | Yêu cầu chấm lại · từ lúc học viên gửi | 48 giờ | 1–336 |
| `speaking_mock_hours` | Bài Speaking thi thử chờ chấm · từ lúc thí sinh nộp bài | 72 giờ | 1–336 |
| `incident_unclaimed_hours` | Sự cố chưa có người nhận | 24 giờ | 1–168 |
| `feedback_unanswered_hours` | Phản hồi học viên chưa trả lời | 72 giờ | 1–336 |
| `late_streak_count` | Trễ bài liên tiếp | 2 bài | 1–20 |
| `inactive_days` | Không hoạt động | 7 ngày | 1–90 |
| `course_expiring_days` | Quyền khoá sắp hết | 7 ngày | 1–90 |
| `low_credits` | Sắp hết lượt chấm AI | 3 lượt | 0–100 |
| `code_expiring_days` | Mã kích hoạt chưa dùng sắp hết hạn | 14 ngày | 1–90 |
| `exam_idle_minutes` | Thí sinh đứng yên (phòng live) | 5 phút | 1–60 |
| `audio_retention_days` | Giữ bản ghi âm Speaking · từ lúc ghi (đã chốt tối đa 60) — dòng **chỉ đọc** (`fixed: true`): API đọc từ cấu hình G04 `RETENTION_AUDIO_DAYS`, **không** lưu trong `ops_thresholds`, `PUT` gửi khoá này → 422 | theo cấu hình G04 (tối đa 60) | cố định |
| `content_retention_after_expiry_days` | Giữ bài làm sau khi khoá hết hạn (chốt ở điểm 23) — dòng **chỉ đọc** (`fixed: true`): API đọc từ cấu hình G04 `RETENTION_CONTENT_DAYS_AFTER_EXPIRY`, **không** lưu trong `ops_thresholds`, `PUT` gửi khoá này → 422 | 45 ngày | cố định |
| `import_error_report_days` | Giữ báo cáo lỗi nhập liệu | 30 ngày | 7–365 |
| `too_fast_sec_per_question` | Làm quá nhanh (kết quả bài giao) — **chưa có trên tờ** | `null` (tắt lý do) | 1–60 |
| `many_retakes_count` | Làm lại nhiều lần — **chưa có trên tờ** | `null` (tắt lý do) | 2–20 |
| `stalled_hours` | Bỏ dở (đang dùng cờ `course_stalled` 24 giờ sẵn có) | 24 giờ | 1–168 |
| `lesson_review_pct` | "Cần ôn" theo buổi (tờ ghi dưới 60%) | 60 % | 1–100 |
| `survey_min_respondents` | Số người trả lời tối thiểu để hiện phần trăm và trung bình khảo sát (sửa 18/11 theo GOI-13) | 5 người | 1–100 |
| `survey_remaining_sessions` | Lớp sắp kết thúc khoá mà chưa có khảo sát · số buổi còn lại — repo chưa có dữ liệu buổi học (sửa 18/11 theo GOI-13) | `null` (ẩn dòng) | 1–50 |
| `band_dist_min_papers` | Số bài tối thiểu để hiện phân bố band — **chưa có trên tờ** | `null` (không hiện phân bố) | 1–50 |
| `score_gap_review_band` | Độ lệch AI–giáo viên cần xem lại (GOI-12, chỉ nạp khi phần đó được mở) | 1.0 band | 0.5–3.0 |
| `score_gap_publish_min_papers` | Số bài tối thiểu để công bố độ lệch (GOI-12, chỉ nạp khi phần đó được mở) | 50 bài | 10–1000 |
| `score_gap_publish_max_mean` | Độ lệch trung bình tối đa để công bố (GOI-12, chỉ nạp khi phần đó được mở) | 0.5 band | 0.1–2.0 |
| `score_gap_row_min_papers` | Số bài tối thiểu cho một dòng bảng độ lệch (GOI-12, chỉ nạp khi phần đó được mở) | 30 bài | 5–500 |
| `report_min_group_size` | Cỡ nhóm tối thiểu để hiện số liệu báo cáo (GOI-12, chỉ nạp khi phần đó được mở) | 10 người | khoảng do anh Andy chọn |
| `review_pack_due_soon_hours` | Bài gói giáo viên chấm sắp tới hạn (GOI-12, chỉ nạp khi phần đó được mở) | 12 giờ | — |
| `review_pack_on_time_min_pct` | Tỉ lệ trả đúng hạn tối thiểu của gói giáo viên chấm (GOI-12, chỉ nạp khi phần đó được mở) | 90 % | — |

Ngưỡng `null` = lý do/khối tương ứng không bật cho tới khi chủ dự án điền; không tự chọn số. `audio_retention_days` chỉ hiển thị giá trị `RETENTION_AUDIO_DAYS` của G04 (GOI-04 mục 5.10, 5.14); job dọn bản ghi âm thuộc G04-T10 — G09 không viết job xoá. Hiện trạng ở `c3bc71574`: `backend/services/retention.py` dòng 28–29 ghi cứng `RETENTION_AUDIO_DAYS = 15`, `RETENTION_CONTENT_DAYS = 60`; việc đổi sang 60 ngày cho bản ghi âm và 45 ngày sau khi khoá hết hạn cho bài làm là của G04.

### 5.7 Component frontend (đặt trong `frontend/components/admin/`; thành phần chung G03 ở `components/ui/`)

| Component | Props chính | Trạng thái phải có |
|---|---|---|
| `AdminFrame` | `role: 'admin'\|'instructor'`, `environment`, `children` | đang tải quyền, bị từ chối, sẵn sàng; sidebar mở/thu/biểu tượng/ngăn kéo; sáng/tối |
| `AdminSidebar` | `groups`, `match`, `counts` | nhóm thu có badge; mục hiện tại; mục `available:false` |
| `AdminCommandPalette` | `scope` | rỗng, đang tìm, không thấy, lỗi mạng |
| `RecordPage` | `breadcrumb`, `title`, `meta`, `actions`, `tabs` | thẻ qua `?tab=` |
| `DangerZone` | `items: [{label, description, impactText, confirmPhrase?, reasonRequired?, onConfirm}]` | hộp xác nhận, gõ chuỗi, đang gửi, lỗi, cần step-up |
| `LearnerSummary` | `summary`, `actions` | đủ 7 trường; "chưa có bài", "chưa đặt" |
| `AssignDrawer` | `cohortId?`, `lessonId?`, `preselect?: {studentIds?, contentId?}`, `onDone` | chọn lớp; trùng (lớp, bài); bài kiểm tra hiện chế độ trả điểm; đã giao |
| `LegacyClassCreditsDialog` (T43; chưa có tờ thiết kế riêng, dựng từ hộp xác nhận của "Cấp thêm lượt") | `cohortId`, `onDone` | đang tải xem trước; không còn ai cần cấp ("Lớp này đã đo lượt"); nhập số lượt (trống, không hợp lệ); xác nhận; đang gửi; kết quả có danh sách bỏ qua; lỗi; cần step-up |
| `ThresholdsProvider` + `useThreshold(key)` | — | đang tải (không tô "quá hạn" khi chưa có ngưỡng), lỗi |
| `QueueRow` | `label`, `q: Q`, `href` | có việc, "Không có", lỗi nguồn + tải lại riêng, quá hạn |
| `AssignmentResultPage` (5 khối) | `cohortId`, `assignmentId` | chưa ai nộp (chỉ khối 1), mỗi khối một khung chờ, lỗi một khối |
| `ReleaseBoard` | `cohortId`, `assignmentId` | có/không dòng chọn; hộp hỏi lại; hẹn giờ |
| `ExamWizard`, `ExamRecord` (7 thẻ), `ProctorBar`, `ExamAnalysis`, `ExamRelease` | `examId` | theo ghi chú tờ AdminKyThi, AdminKyThiChiTiet |
| `ContentSkillPage` (4 thẻ), `BatchList`, `ReviewQueue`, `HiddenImportBanner` | `skill` | rỗng, đang tải, lỗi từng thẻ |
| `LearnerDirectory`, `LearnerRecord`, `CareNotes`, `EnrollmentQueue`, `EnrollmentDetail`, `CreditLedger`, `CodeLookup`, `IncidentInbox`, `SettingsPage`, `ReportsPage` | — | rỗng, đang tải, lỗi, một phần nguồn lỗi |

### 5.8 Cờ cấu hình và nhật ký

- `ADMIN_FRAME_V2` (biến môi trường build frontend): `1` → khung mới. Bật ở preview/staging, tắt ở production tới khi anh Andy duyệt (Q6). Đường lui của T08.
- Runtime flag (qua `services/runtime_flags.py`, mặc định tắt): `mock_exam_audiences` (T31: tắt → `admin_live_monitor` đọc roster theo `cohort_id` như cũ), `assignment_result_v2` (T27/T28: tắt → trang lớp dùng ba tab cũ), `content_import_batches` (T36), `mock_partial_release` (T33: tắt → `release` từ chối `include_partial`).
- Cờ của gói khác mà G09 đọc: `mock_exam_audiences_learner` (G08-T22: cổng học viên đọc bảng người dự thi và áp quy tắc chạy liền các phần; tắt → `schedule` từ chối kỳ live nhiều nguồn, T31), `credit_metering` (G04: bật đo lượt ở đường chấm; nhãn "Chưa chuyển sang đo lượt" và thao tác T43 **không** phụ thuộc cờ này — chuyển lớp cũ làm được trước khi bật đo).
- Env: `CARE_NOTE_EDIT_HOURS` (mặc định 24, Q16), `REVIEW_SOFT_LOCK_MINUTES` (mặc định 30, Q19), `MOCK_SELF_PACED_GAP_SECONDS` (mặc định 0 = phần kế bắt đầu ngay; Q31).
- Sự kiện log backend (logger, không bảng mới): `admin_search` (độ dài q, số kết quả, không ghi q), `hidden_import_opened` (route, actor id), `incident_group_action`, `assignment_remind` (số người).

## 6. Nhiệm vụ (theo thứ tự phụ thuộc)

### 6.0 Thứ tự và lý do phụ thuộc

- **Backend trước, song song G10:** T03–T07, T22, T24, T25, T27, T31, T33, T35, T36 chỉ thêm router/migration, không đụng route group frontend.
- **Frontend sau khi G10 gộp `(authed-admin)`** (T08 trở đi). Lý do: (1) trang mới làm trước G10 phải tạo thêm route group thứ 40+ rồi G10 lại gộp; (2) khung mới chỉ gắn được một lần khi có một layout chung; (3) G10 sửa 109 test ghim route group — hai gói cùng sửa một file test là vi phạm quy ước chung mục 7.
- **Làm được ngay:** T01, T21 (spec), T02.
- **Thứ tự chuyển sau khi có khung (T08):** Cài đặt/ngưỡng (T22, T23 — mọi màn sau đọc ngưỡng) → phạm vi giáo viên (T24) → Học viên (T10, T11, T35) → Lớp và giao bài (T25, T26, T27, T28, T29, T30) → Việc cần làm (T06, T18) → Chấm bài (T17, T38, T39) → Kỳ thi (T31–T34) → Khoá, đơn, lượt, mã (T12–T15, T43, cần G04; T43 sau T29) → Nội dung (T36, T37) → Sự cố, báo cáo (T07, T16, T41) → Giáo viên (T20, T40) → Tìm nhanh (T05, T19) → T42.
- Mỗi PR mã ghi `Spec:` đúng spec của nó (0074 hoặc một trong ba spec bổ sung).

### 6.1 Khối nào làm ngay từ dữ liệu đang lưu, khối nào cần bảng/cột mới

[NGAY] = tính được từ bảng đang có (đã kiểm ở mục 2). [THÊM] = cần migration ở 5.3, hoặc gói khác, hoặc quy tắc chưa chốt. Lấy từ "Ghi chú cho lập trình" của từng tờ rồi đối chiếu repo.

| Màn (tờ) | [NGAY] | [THÊM] |
|---|---|---|
| Việc cần làm (AdminViecCanLam) | Writing chờ duyệt, AI lỗi, chấm lại, sự cố/phản hồi (theo dòng), kỳ thi hôm nay (`mock_exams.open_from`), bài giao quá hạn (`class_assignment_items` + `due_at`), lớp tuần này (`class_lessons.lesson_date`), cần chú ý: trễ liên tiếp và không hoạt động | Ngưỡng (440); đơn, quyền sắp hết, còn ít lượt, lớp chưa chuyển sang đo lượt (G04); bài kiểm tra chờ công bố (GOI-11 mig 473); cần liên hệ hôm nay (442); Speaking thi thử chờ chấm (cần cách xác định "chờ chấm" — T38); giờ buổi học (441) |
| Danh bạ (AdminDanhBa) | Hợp nhất `users`+`students`, lớp, hoạt động gần nhất, tìm, xuất CSV, gán lớp | Dạng và khoá/hạn theo quyền, lọc lượt (G04); cần chú ý dùng ngưỡng (440); tìm không dấu (đã kiểm ở `c3bc71574`: `grep -rn "unaccent" backend/migrations/*.sql` rỗng — không có extension `unaccent`, chuẩn hoá bỏ dấu ở Python) |
| Hồ sơ học viên (HoSoHocVien) | Cảnh báo (dữ liệu), mục tiêu hai nguồn (hiện), lưới 8 tuần, bài được giao, điểm theo thời gian, thẻ Học tập, nhật ký lớp (spec 0041), chi phí AI | Quy tắc trạng thái + ngưỡng (440); ghi chú chăm sóc và việc đã hẹn (442); khoá/hạn/lượt, phần lượt chuyển và hạn của nó (G04); gom nhật ký quyền/lượt/đơn (G04); "Lỗi lặp lại ở Writing" nếu chú thích chưa có loại; gộp mục tiêu về một nguồn (Q17) |
| Lớp (AdminLop) | Thẻ, bảng học viên × bài, buổi học, bài nộp, nhật ký, lưu trữ | Giáo viên của lớp — một người (441); lịch tuần, ngày khai giảng, giờ buổi, tạo lớp ba bước, dời buổi (441, Q25); mã kèm lượt, cấp thêm lượt, cấp lượt cho lớp cũ (T43), quyền luyện lại (G04); gửi nhắc và "Đã nhắc" (444 + GOI-11 A); thẻ Kiểm tra theo buổi (spec 0043 chưa có mã) |
| Kết quả bài giao (AdminKetQuaBaiGiao) | Khối 1 (trừ giờ nhắc), khối 2, khối 3 gom theo `skill`/`subtype`, khối 4 (dữ liệu), khối 5 (đề xuất); biến thể Writing: trung vị tiêu chí | Giờ nhắc gần nhất (444); tên hiển thị `truc_nhom`/dạng (file nhãn, Q27); ngưỡng "quá nhanh", "làm lại nhiều" (Q15); lưu câu vào buổi (444); loại nhận xét Speaking; `lesson_primary` cho biến thể giữa kỳ (spec 0043 — tạm dùng `skill`/`item_key` theo buổi) |
| Bảng công bố (KiemTraKhoaGiaoVien) | — | Toàn bộ backend ở GOI-11 phần E (mig 473–474); khối "Theo buổi" cần spec 0043 hoặc `result` biến thể `course_test` (T27) |
| Khoá học (AdminKhoaHoc) | — | Toàn bộ trên API G04; "Lưu trữ" (phân xử 14) |
| Đơn đăng ký (AdminDonDangKy) | Đối chiếu tính ở trình duyệt | Toàn bộ trên API G04; hạn bổ sung, tự mở lại đơn hết hạn, kích hoạt tài khoản khi xác nhận (G04) |
| Lượt AI và mã (AdminLuotVaMa) | Sổ mã hiện có (`/admin/access-codes`) | Sổ lượt, điều chỉnh, lượt kèm mã, chuyển toàn bộ lượt khi đăng ký lại (`carry_over`) và hạn của phần lượt chuyển (G04); ngưỡng sắp hết lượt, mã sắp hết hạn (440) |
| Chấm Writing (AdminChamWriting) | Hàng chờ, màn chấm, trả, thu hồi, chấm lại bằng AI; band 4 bài gần nhất; mục tiêu | Lọc "chỉ lớp offline" cần `review_mode` của G04 (trước G04: mọi bài ở tầng duyệt hiện có); khoá mềm tự nhả 30 phút (CHƯA KIỂM, 2.4); lưu riêng điểm AI và điểm giáo viên từng tiêu chí (đã kiểm 18/11: repo chưa lưu; làm ở G12-C01…C03, migration 480, đợt D); sắp theo buổi học (`class_lessons`, [NGAY] theo ngày; giờ cần 441) |
| Chấm lại (AdminChamLai) | Danh sách, lý do, chấp nhận/từ chối | Trạng thái "Đang xem" + khoá mềm; năm lý do chọn sẵn (đã kiểm ở `c3bc71574`: `migrations/084_essay_regrade_requests.sql` dòng 21 `reason TEXT NOT NULL`, văn bản tự do 50–500 ký tự do API kiểm — chưa có cột lý do chọn sẵn); chấm lại hàng loạt |
| Chấm Speaking thi thử (AdminChamSpeakingThiThu) | Bản ghi (`record-speaking`), nhập band (`bulk-final-bands`), roster | Hàng chờ riêng (API mới, T38); đề xuất của AI cho Speaking thi thử; cờ "Quá ngắn"/"Không nghe được"; đoạn mẫu chấm phát âm (G08/gói chấm) |
| Kỳ thi (AdminKyThi) | Danh sách kỳ một lớp, chọn kỹ năng theo lượt thi, chọn đề, cảnh báo đã làm ở Luyện tập, cơ chế live, cơ chế tự làm kiểu cũ (mỗi phần tự bấm bắt đầu), `review_sla_days` | Người thi nhiều nguồn, nhóm lưu (443, 445); nháp nhiều bước; tên `live`/`self_paced` (445–446); `allow_early_advance`; kỳ tự làm chạy liền các phần, không nghỉ giữa (5.5 — phía học viên ở G08-T22) |
| Trang một kỳ thi (AdminKyThiChiTiet) | Thẻ Đề; kỹ năng từng người; đánh dấu cần thi bù; theo dõi live (số câu, hoạt động, đứng yên, dấu hiệu, điều khiển mở/bắt đầu/thu); theo dõi tự làm; thẻ Chấm (roster); phân bố band, câu sai nhiều, nhịp làm bài, so kỳ trước, trung vị tiêu chí Writing; trả kết quả (cả kỳ) | Danh sách nhiều nguồn (445); cộng giờ theo người, nhắn phòng, dòng thời gian sự kiện (447); bốn trạng thái của người dự thi tự làm (`self_paced_state`, FR-09-151); ngưỡng đứng yên đọc từ bảng chung (440); trả từng phần, lịch sử sửa điểm (448); số bài tối thiểu cho phân bố (Q15); gộp thi bù vào kỳ gốc (Q13) |
| Nội dung (3 tờ) | Thẻ Đề và bài (danh sách, trạng thái, nơi dùng, đăng/gỡ hàng loạt, sửa lẻ); Chương trình và bộ; Câu cần kiểm từ `user_feedback` và `quiz_item_error_rates`; ẩn route nhập | Lô nhập (449) và cột Lô nhập; trạng thái Đã kiểm/Đã sửa (450); tìm theo câu đầu đề; tính lại điểm khi đổi đáp án (gói sau); tỉ lệ sai toàn kho L/R (gói sau) |
| Báo cáo (AdminBaoCao) | Lưu lượng (`/admin/analytics/foot-traffic`), chi phí AI (`/admin/ai-usage`), hoạt động (các trang hiện có), ba số chất lượng | Bảng theo lớp và khoá có "cần chú ý" (440 + G04); xuất CSV gộp; khoảng ngày tuỳ chọn |
| Hộp thư sự cố (AdminSuCo) | Ba nguồn, gom nhóm lỗi (tính lúc đọc) | Bốn trạng thái nhóm, ghi chú, tự mở lại (451); hoàn lượt (G04); gom nhóm sự cố chấm và phản hồi |
| AI và mô hình, Bảo mật, QA (AdminHeThong) | Bảng mô hình (spec 0024), `/admin/mfa`, công cụ QA hiện có | Lý do + nhật ký đổi mô hình; ngân sách tháng; tự kiểm nhà cung cấp; bảng phiên; nhật ký nhạy cảm (gói sau) |
| Cài đặt (AdminCaiDat) | Thẻ Tính năng (`/admin/runtime-flags`) | Ngưỡng, thư, thông báo hệ thống (440); Chấm thử (GOI-11 mig 471); Thanh toán (G04, Q20); Pháp lý (gói sau, Q21) |
| Giáo viên, Gửi thông báo (AdminGiaoVienThongBao) | Danh sách giáo viên | Lớp phụ trách (441); mời có hạn (CHƯA KIỂM cơ chế mời hiện có qua `access_codes.grants_role` + `intended_email`: `grep -n "grants_role\|intended_email" backend/routers/admin.py \| head`); gửi thông báo (GOI-11 A); nhóm theo điều kiện |
| Khu giáo viên (GiaoVien) | Chấm/duyệt Writing (`/instructor/reviews/*`), học viên, giao bài Writing | Phạm vi theo lớp (441); Việc của tôi (T06); bảng tiến độ học viên × bài cho giáo viên; gửi nhắc |

### G09-T01 — Soạn spec ADMINIA-0074, mở PR spec, DỪNG chờ duyệt — SỬA
- Mục đích: có spec `high-risk` được duyệt cho khung, điều hướng, danh bạ, hồ sơ, ghi chú chăm sóc, cài đặt/ngưỡng, khoá-đơn-lượt-mã (giao diện), chấm bài, sự cố, báo cáo, giáo viên.
- Đầu vào: `specs/README.md`, `specs/_meta/constitution.md`, `specs/_templates/*`, spec 0024, 0026, 0032, 0039, 0041; PR #2254 (chỉ đọc: `gh pr view 2254 --json title,state,files,body`); file này; `thiet-ke/CHUAN-ADMIN.md`; các tờ ở mục 8.
- Việc làm: 1) Kiểm số 0074 còn trống (`ls specs | grep 0074`; kiểm PR đang mở). 2) Tạo `specs/0074-admin-ia/` với `spec.md` (mục 4 làm FR; mục 9 làm kịch bản; mục 10 làm câu hỏi mở; bảng 5.1), `plan.md` (mục 5, 6.0), `tasks.md`, `verification.md`, `rollout.md` (cờ 5.8, 307, đường lui), `ui-states.md` (5.7). 3) "Related specifications": 0049/PR #2254 — ghi rõ "G09 thay thế phần điều hướng; phần giao bài liệt kê từng điểm trùng với thành phần giao bài dùng chung"; 0024, 0032, 0041, 0043; ba spec bổ sung của T21; GOI-11 (0079, 0080, 0082). 4) `python backend/scripts/validate_specs.py`, `git diff --check`. 5) Mở PR `high-risk`.
- Đầu ra: 1 PR chỉ chứa thư mục spec.
- Nghiệm thu: validate_specs qua; PR không có file mã; spec có đủ FR của mục 4 thuộc phạm vi 0074 và ≥ 10 kịch bản.
- Không làm: không viết mã; không tự duyệt; không merge.
- Vướng mắc → cách gỡ: thiếu khoá front-matter → lấy spec 0039 làm mẫu. PR #2254 đã merge khi người thực thi đọc → vẫn theo quyết định 17/11 (G09 chuẩn), liệt kê phần mã 0049 sẽ bị thay và báo lại.
- Ước lượng: 1 phiên · 2.

### G09-T02 — "Duyệt bài thi" không còn mở lỗi thiếu mock_exam_id — GIỮ
- Mục đích: FR-09-063, làm ngay trên trang hiện có (lớp `small`). T34 thay hẳn trang này sau.
- Đầu vào: `app/(authed-admin-mock-reviews)/admin/mock-reviews/page.tsx`, `admin-mock-reviews.tsx` dòng 119/140, `lib/admin-mock-tests-model.mjs`, test `tests/admin-mock-reviews-next-behavior.test.mjs`; GOI-02.
- Việc làm: 1) Kiểm G02 đã sửa chưa (`git log origin/staging --oneline -- 'frontend/app/(authed-admin-mock-reviews)'`); đã sửa → đóng bằng bằng chứng. 2) Trong `page.tsx`: `mock_exam_id` rỗng và không `embed=1` → `redirect('/admin/mock-tests?tab=review&notice=choose-exam')`; `embed=1` mà rỗng → đổi câu thành "Chọn một kỳ thi để duyệt bài." 3) Trung tâm Mock Test đọc `notice=choose-exam` hiện một dòng. 4) Test React.
- Đầu ra: 1 PR.
- Nghiệm thu: mở `/admin/mock-reviews` → về trung tâm với dòng "Chọn một kỳ thi để duyệt bài."; `grep -rn "Thiếu mock_exam_id" frontend/app` rỗng; test frontend qua.
- Không làm: không đổi API, không đổi iframe.
- Vướng mắc → cách gỡ: test cũ ghim chuỗi → sửa cùng PR, ghi tên test. `searchParams` là Promise → `await` trước (mẫu `admin/users/page.tsx`).
- Ước lượng: 1 phiên · 2.

### G09-T03 — API danh bạ hợp nhất và khối tóm tắt học viên — SỬA
- Mục đích: `GET /admin/learners`, `GET /admin/learners/{ref}`, `…/summary`, `GET /instructor/learners/{ref}` (5.4); hàm `learner_attention.compute`.
- Đầu vào: `routers/admin.py` (dòng 975), `routers/admin_students.py`, `services/student_service.py`, `services/test_data_visibility.py`, `services/ops_thresholds.py` (T22), `services/staff_scope.py` (T24), `tests/test_staff_guard_inventory.py`.
- Việc làm: 1) Tạo `routers/admin_learners.py`, `models/admin_learners.py`, `services/admin_learner_directory.py`, `services/learner_attention.py`. 2) Hợp nhất `students` + `users` theo `students.user_id`; `ref` theo FR-09-022; áp `test_data_visibility` như `list_students`. 3) Phân trang `page`/`page_size=25`, sắp theo tên gọi (từ cuối của họ tên) rồi id. 4) `kind`, `courses`, `credits_left`: đọc qua hàm G04 nếu có; chưa có → `null` (không đoán). 5) `attention`: `late_streak` từ chuỗi bài giao đã tới hạn gần nhất của học viên (`class_assignment_items` + `due_at`), `inactive` từ lần hoạt động gần nhất; `course_expiring`, `low_credits` chỉ khi có G04. 6) `summary` đúng 7 trường mục H. 7) Test: ba ca hợp nhất, ẩn staff, `s-` của người có tài khoản → `canonical_ref = u-…`, một nguồn lỗi vẫn 200, ngưỡng đổi thì kết quả đổi, giáo viên xem học viên lớp khác → 404, token học viên → 403.
- Đầu ra: 1 PR backend.
- Nghiệm thu: `cd backend && python -m pytest tests/test_admin_learners.py tests/test_staff_guard_inventory.py -q` qua; bộ đầy đủ qua.
- Không làm: không ghi dữ liệu; không migration; không đổi `/admin/users`, `/admin/students`.
- Vướng mắc → cách gỡ: T22/T24 chưa merge → dùng mặc định ở 5.6 qua một hàm giả có cùng chữ ký và chỉ mở route admin; nối thật khi hai nhiệm vụ kia vào. Fixture không dùng email học viên thật.
- Ước lượng: 2 phiên · 3.

### G09-T04 — API các thẻ hồ sơ — SỬA
- Mục đích: `…/overview`, `…/goal/resolve`, `…/attempts`, `…/ai-cost`, `…/log` (5.4).
- Đầu vào: 5.4; `admin_class_assignments.py` `student_work`; `services/student_home_aggregator.py`; `routers/admin.py` `_aggregate_usage_for_users`; `services/ai_pricing.py`; bảng audit ở 2.2.
- Việc làm: 1) Kiểm cột khoá người của `listening_test_attempts`, `reading_test_attempts`, `mock_exam_sittings` (lệnh ở 5.4), ghi vào PR. 2) `overview`: mỗi khối một hàm, chạy `asyncio.gather`, lỗi → tên khối vào `sources_failed`. Lưới 8 tuần: ngày theo giờ Việt Nam; tuần hiện tại cuối; ngày tương lai `null`. `estimated_band` chỉ khi có lượt thi thử gần nhất đủ bốn band. `side.credits_carried` chép từ trường G04 trả (số lượt chuyển còn lại và hạn của phần đó — FR-09-056); không tự tính từ sổ. 3) `goal/resolve`: ghi cả `students` và `users` trong một giao dịch (RPC hoặc hai lệnh có bù trừ), ghi `class_action_log`-kiểu sự kiện `goal` vào nguồn nhật ký (nếu không có bảng phù hợp: `staff_security_audit` với action `learner_goal_resolved` — CHƯA KIỂM ràng buộc action: `grep -n "action" backend/services/staff_security.py | head`). 4) `log`: hợp nhất nguồn, `text` tiếng Việt thường (`services/admin_learner_log_text.py`; action lạ → "Thao tác khác"). 5) Test từng endpoint: rỗng, có dữ liệu, một nguồn lỗi; không band khi thiếu dữ liệu.
- Đầu ra: 1 PR backend.
- Nghiệm thu: pytest file mới + bộ đầy đủ qua; response mẫu không có `0/0`, không có band khi chưa có bài đã trả; test: G04 (giả) trả quyền có 6 lượt chuyển hạn 20/01 → `side.credits_carried = {amount: 6, expires_at: …}`; G04 không trả trường → `null`.
- Không làm: không gọi AI; không tính lại band; không chép `persona_notes`.
- Vướng mắc → cách gỡ: `sessions` có phiên E2E staging → lọc như `/admin/sessions` (`_STAGING_E2E_*`). Hai nguồn mục tiêu khác kiểu (`NUMERIC(2,1)` và `DECIMAL(2,1)`, `target_date` và `exam_date`) → so sánh sau khi chuẩn hoá về số một chữ số thập phân và ngày.
- Ước lượng: 3 phiên · 4.

### G09-T05 — API tìm nhanh — SỬA
- Mục đích: `GET /admin/search`, `GET /instructor/search`.
- Việc làm: học viên qua service T03 (≤3); lớp từ `cohorts`; bài nộp `writing_essays`; đề (chỉ admin); **đơn đăng ký** theo mã `AVER-…` hoặc email qua API G04 (chưa có → bỏ nhóm). Escape `%`/`_`. Giáo viên: lọc `scope.cohort_ids`. Log `admin_search` không ghi `q`.
- Đầu ra: 1 PR backend. Nghiệm thu: pytest: giáo viên A không thấy học viên lớp B; q 1 ký tự → 422; `%` không thành wildcard; inventory qua.
- Không làm: không full-text index, không migration.
- Vướng mắc → cách gỡ: chậm > 800ms trên staging → ghi số đo vào PR, không tự thêm index. G04 chưa có → nhóm `orders` trả mảng rỗng và ghi trong PR.
- Ước lượng: 1 phiên · 3.

### G09-T06 — API Việc cần làm — SỬA
- Mục đích: `GET /admin/attention`, `GET /instructor/attention` (5.4), FR-09-090…093, 104.
- Đầu vào: `routers/admin_overview.py`, `models/admin_overview.py`; T03 (`learner_attention`), T22, T24, T07; API G04; GOI-11 phần E (đếm `awaiting_release`).
- Việc làm: mỗi hàng chờ một hàm trả `Q`; lỗi hoặc gói phụ thuộc chưa có → `count=null, error=true|false` (phân biệt "lỗi" và "chưa có nguồn" bằng trường `unavailable: true`). `exams_today`: kỳ thi có `starts_at`/`open_from` trong ngày giờ Việt Nam. `classes_week`: `class_lessons` có `lesson_date` trong 7 ngày tới, `has_assignment` = có `class_assignments.lesson_id` trỏ buổi đó. `attention_learners`: ≤ 8, xếp theo số lý do rồi tên. `ops_week.on_time_rate`: bài giao có hạn trong 7 ngày qua. `classes_unmetered`: số lớp chưa lưu trữ còn thành viên active dùng mã cũ chưa có nơi nhận lượt — gọi hàm đọc của G04 (cùng lõi với `convert-class/preview`, bảng "API G04 mà G09 gọi"); G04 chưa có → `unavailable: true`. Bản giáo viên: cùng service với `cohort_ids`, bỏ `enrollments_reported`, `incident_groups_open`, `feedback_open`, `exams_today`, `classes_unmetered`, `ops_week`.
- Đầu ra: 1 PR backend. Nghiệm thu: pytest: một nguồn lỗi → chỉ trường đó `error`, các trường khác có số; không bao giờ trả 0 thay cho lỗi; bản giáo viên không có trường admin; lớp thử có 2 thành viên mã cũ chưa có nơi nhận lượt → `classes_unmetered.count = 1`, sau khi chuyển (giả) → 0; lớp đã lưu trữ không tính.
- Không làm: không đổi `/admin/overview` hiện có.
- Vướng mắc → cách gỡ: `speaking_mock_pending` phụ thuộc T38 → trước T38 trả `unavailable`. Lớp không có `lesson_date` → không có trong `classes_week`, không suy từ lịch tuần ở nhiệm vụ này.
- Ước lượng: 2 phiên · 3.

### G09-T07 — Nhóm sự cố: migration 451, API gom nhóm và trạng thái — SỬA
- Mục đích: FR-09-070, 071; API `incidents/groups*` (5.4).
- Đầu vào: `routers/error_logs.py`, `routers/admin.py` (`/admin/alerts` dòng 4225), `routers/feedback.py`, tờ AdminSuCo.
- Việc làm: migration 451 + rollback; `services/error_log_grouping.py` (`fingerprint`); `routers/admin_incidents.py`; gom `errors` theo fingerprint, `grading` theo (kỹ năng, bước, loại bài), `feedback` theo (đề hoặc màn, lý do); trạng thái đọc từ `incident_groups`, tự mở lại khi có ghi nhận sau `resolved_at`; `bulk` so `expected_count`; mọi đổi trạng thái thêm một dòng `incident_group_notes` với `auto=true`. Giữ nguyên endpoint dismiss từng dòng của `error_logs.py`; khi nhóm `resolved` thì dismiss các dòng chưa xử lý của nhóm theo lô 200.
- Đầu ra: 1 PR backend (có migration → `high-risk`).
- Nghiệm thu: pytest: hai lỗi khác uuid cùng nhóm; nhóm đã xử lý có dòng mới → `new`, ghi chú còn; 409 khi `expected_count` lệch; inventory qua.
- Không làm: không xoá dòng; không hoàn lượt (nút hoàn lượt chỉ hiện khi G04 có API).
- Vướng mắc → cách gỡ: báo lỗi đáp án (`user_feedback` kiểu report) **không** vào đây — đi vào Câu cần kiểm (T36); `review_items_open` chỉ là số đếm. Bảng nhiều dòng → giới hạn quét 5.000, trả `truncated`.
- Ước lượng: 2 phiên · 3.

### G09-T08 — Khung admin mới + sổ đăng ký điều hướng (sau G10) — SỬA
- Mục đích: FR-09-001…014; 5.1, 5.2.
- Đầu vào: layout `(authed-admin)` của G10 (GOI-10 mục 5.3); component khung của G03; GOI-03 mục 5.9; `aver-admin-chrome.js`; `components/authed-shell.tsx`; `admin-access-gate.tsx`; tờ ThanhPhanKhungTrang2 mục 7, 10; `CHUAN-ADMIN.md` mục A.
- Việc làm: 1) `frontend/lib/admin-nav-registry.mjs` theo 5.2 và 5.1. 2) `frontend/components/admin/admin-frame.tsx` dùng khung G03. 3) Layout admin: `process.env.ADMIN_FRAME_V2 === '1'` → bọc `AdminFrame`, thêm `av-admin-frame-v2` vào `bodyClass`. 4) `aver-admin-chrome.js`: trong `connectedCallback`, body có class đó thì chỉ render `<slot></slot>` → 75 `page.tsx` chưa phải sửa. 5) Số đếm sidebar từ `GET /admin/attention` (`countKey`). 6) Menu tài khoản theo FR-09-003, điều khiển sáng/tối theo GOI-03 5.9. 7) `HiddenImportBanner` cho 4 route `hidden` (gắn trong `AdminFrame` theo pathname; "Vẫn mở" ghi `sessionStorage` và gọi log). 8) Mục `available:false`. 9) Test: registry (5.2), React `AdminFrame` (nhóm mở, badge, Esc đóng ngăn kéo, nhãn môi trường không ẩn, dải ẩn-nhập hiện đúng 4 route, element ở chế độ v2 chỉ có slot).
- Đầu ra: 1 PR `feature`.
- Nghiệm thu: preview 1280px và 390px: mọi route `nav` có đúng một mục tô; không có mục "Import…", "Giáo viên duyệt", "Thi thử" trong Chấm bài; mở `/admin/listening/import-drills` thấy dải cảnh báo và nút "Vẫn mở"; đổi Sáng/Tối/Theo thiết bị có hiệu lực và nhớ sau tải lại; đăng xuất về `/login`; cờ tắt → khung cũ y nguyên; bộ test frontend + `tsc` + build qua.
- Không làm: không xoá `aver-admin-chrome.js`; không đổi `NAV_GROUPS` của element (khung cũ là đường lui); không sửa 75 `page.tsx`; không đổi cascade CSS trong `authed-shell.tsx`; không chặn API nhập.
- Vướng mắc → cách gỡ: hai thanh trên chồng nhau → class phải đặt bằng `bodyClass` phía server. CSS `admin-surface.css` cũ chừa lề trái → thêm quy tắc `.av-admin-frame-v2 …` trong CSS mới. `?embed=1` → `AdminFrame` không render khung. Trang cũ dùng token v1 trong khung v2 ở nền tối bị lệch màu → trang chưa chuyển giữ nền sáng trong vùng nội dung (bọc `data-theme="light"`), ghi danh sách trang trong PR.
- Ước lượng: 3 phiên · 4.

### G09-T09 — Liên kết vai trò trong khung học viên — GIỮ
- Mục đích: FR-09-004.
- Việc làm: trong `aver-chrome.js` `_applyRole` (hoặc khung React của G07 nếu đã thay) thêm `#admin-link` ("Sang khu quản trị") chỉ khi role `admin`; đổi "Trang giảng viên" → "Sang khu giáo viên". Test React: admin có hai link, giáo viên một, học viên không.
- Đầu ra: 1 PR. Nghiệm thu: test qua; preview đúng theo vai trò.
- Không làm: không đổi cách lấy role.
- Vướng mắc → cách gỡ: G07 sửa cùng file → bên vào sau rebase; file đã bị xoá → làm trong component G07. Test cũ ghim "Trang giảng viên" → sửa cùng PR.
- Ước lượng: 1 phiên · 2.

### G09-T10 — Danh bạ học viên `/admin/learners` — SỬA
- Mục đích: FR-09-020, 021, 028, 034, 035.
- Đầu vào: T03; tờ `AdminDanhBa`; `ThanhPhanDuLieu` (bảng; khối tóm tắt học viên); `admin-students-directory.tsx` (Import CSV, Thêm học viên, gán lớp hàng loạt).
- Việc làm: trang theo tờ: bảng 25 dòng, tìm, lọc ghi vào URL, cột Dạng · Khoá và hạn · Cần chú ý · Lượt chấm còn · Hoạt động gần nhất; ngăn "Xem nhanh" 400px chỉ chứa `LearnerSummary` + Mở hồ sơ / Gửi nhắc / Giao bài; thanh hàng loạt FR-09-035 (Gửi nhắc đăng ký lại → `/admin/notifications?from=learners&ids=…` qua state điều hướng, không đặt email vào URL); giữ Import CSV và Thêm học viên; 307 `/admin/users`, `/admin/students` → `/admin/learners` (giữ `?q=`).
- Đầu ra: 1 PR.
- Nghiệm thu: preview: tìm email ra đúng 1 dòng; lọc "Cần chú ý" khớp số ở Việc cần làm; "Xem nhanh" đóng bằng Esc và trả focus; route-ownership-check qua; test React (rỗng, đang tải, lỗi, phân trang, cột `null` hiện "chưa có").
- Không làm: không có thao tác nguy hiểm trong dòng hay hàng loạt; không đổi vai trò trong dòng.
- Vướng mắc → cách gỡ: `/admin/users` vừa là route vừa thành redirect → xoá `page.tsx` cũ và thêm redirect cùng commit. Test cũ đọc file trang đã bỏ (`tests/merge-codes-users-tabs.test.mjs`, `tests/admin-students-redesign.test.mjs`, `tests/sprint-18-3-2-students-chrome.test.mjs`) → thay bằng test hành vi, liệt kê trong PR; vỡ > 30 test ngoài dự kiến → dừng, báo.
- Ước lượng: 2 phiên · 3.

### G09-T11 — Hồ sơ học viên 5 thẻ + vùng nguy hiểm — SỬA (tách 2 PR)
- **T11a — Hồ sơ đọc:** `/admin/learners/[ref]` theo tờ `HoSoHocVien`: đầu trang `LearnerSummary`; thẻ Tổng quan (5 khối + cột phải), Học tập, Khoá và quyền (đọc; mỗi khoá hiện hạn, lượt còn, và nếu có: "N lượt chuyển từ khoá trước, dùng tới dd/mm/yyyy"; khoá đã hết hạn chưa đăng ký lại: "N lượt đã hết hiệu lực ngày …" — FR-09-056), Nhật ký hệ thống; thẻ Ghi chú chăm sóc gắn ở T35. Mỗi khối tải riêng; khối mục tiêu có "Dùng giá trị này" (FR-09-030). "Giao bài" mở `AssignDrawer` chọn sẵn người; "Gửi nhắc" mở hộp gửi một người (GOI-11). 3 phiên · 3.
- **T11b — Vùng nguy hiểm + đổi vai trò:** `DangerZone` cuối thẻ Khoá và quyền: Gỡ khỏi lớp (`DELETE /admin/cohorts/{id}/students/{student_id}`), Khoá tài khoản (`PATCH /admin/users/{id}/active`, step-up, lý do), Thu hồi quyền học (API G04, T14). **CHƯA KIỂM:** `admin_set_staff_active` (`routers/admin_staff_security.py`) có nhận tài khoản học viên không — kiểm `services/staff_security.py` và `grep -rn "suspended_at" backend/migrations/*.sql | head`; chỉ cho staff → bỏ "Khoá tài khoản" khỏi hồ sơ học viên, đưa vào Q9, không tự mở rộng route. Đổi vai trò (`PATCH /admin/users/{id}/role`) trong thẻ Khoá và quyền với hộp xác nhận. 2 phiên · 4.
- Đầu vào: tờ `HoSoHocVien`; T03, T04; `admin-access-gate.tsx` (`ADMIN_STEP_UP_EVENT`, `AdminStepUpDialog`).
- Nghiệm thu: staging với học viên kiểm thử: 5 thẻ mở được bằng link dán sang tab mới; band không hiện khi chưa có bài đã trả; hai nguồn mục tiêu lệch → bấm "Dùng giá trị này" → cả hai nguồn bằng nhau, Nhật ký có dòng; thẻ Tổng quan **không** có vùng nguy hiểm; học viên kiểm thử vừa đăng ký lại (sau G04) → cột phải và thẻ Khoá và quyền hiện đúng số lượt chuyển và hạn G04 trả, không có chữ "50%"; gỡ học viên kiểm thử khỏi lớp kiểm thử → hộp hỏi lại → Nhật ký có dòng; admin AAL1 gọi thẳng API → 403.
- Không làm: không thêm API ghi mới ở T11b; không xoá cứng; không dựng vai trò "Chăm sóc".
- Vướng mắc → cách gỡ: step-up 403 `step_up_required` → bắt `ADMIN_STEP_UP_EVENT`, mở dialog, gửi lại một lần. Biểu đồ "Điểm theo thời gian": đường chỉ vẽ khi có từ 2 điểm; dùng thành phần biểu đồ của G03, không thêm thư viện mới.

### G09-T12 — Mã kích hoạt: sổ tra cứu `/admin/activation-codes` — SỬA
- Mục đích: FR-09-048, 055.
- Việc làm: trang mới dùng lại `AdminAccessCodesPanel` cho phần danh sách; **bỏ** biểu mẫu tạo mã khỏi trang này; nút "Tạo mã cho một lớp" → chọn lớp → mở hộp của trang Lớp (T29); cột "Số lượt chấm cấp kèm mã" (đọc từ G04; chưa có → "chưa có"); thu hồi mã chưa dùng ở menu "⋯", mã đã dùng ở Vùng nguy hiểm trang mã; nhãn "sắp hết hạn" theo `code_expiring_days`. `/admin/users?tab=codes` → 307; redirect 308 `/admin/access-codes` đổi đích thành `/admin/activation-codes`.
- Đầu ra: 1 PR. Nghiệm thu: preview: hai đường cũ tới trang mới; không có `/admin/activation-codes/new`; test hợp đồng redirect ("Canonical clean alias") cập nhật cùng PR.
- Không làm: không đổi API mã; không đụng `is_used/used_by/used_at`.
- Vướng mắc → cách gỡ: trình duyệt nhớ 308 cũ → vẫn tới đích mới qua 307 của `/admin/users`. T29 chưa xong → nút "Tạo mã cho một lớp" tạm dẫn tới `/admin/classes/{id}` và ghi trong PR.
- Ước lượng: 1 phiên · 2.

### G09-T13 — Khoá học và đơn đăng ký (cần G04) — SỬA
- Mục đích: FR-09-040…044, 049…052, 056 (phần trang đơn), 079.
- Đầu vào: GOI-04 bản mới (route, mã lỗi, trạng thái); tờ `AdminKhoaHoc`, `AdminDonDangKy`; tờ `EmailMau` (e4, e5, e14, e6).
- Việc làm: 1) `/admin/courses` + `/admin/courses/[id]` 4 thẻ; thẻ Chương trình đọc `course_lessons` của G07 (sau G07-T18; nội dung nạp bằng script G07-T28, thẻ chỉ đọc danh sách bài và bật/tắt `is_preview`, `is_published`); chưa có thì hiện trạng thái 6a "Khoá chưa có nội dung" (sửa 18/11 theo rà soát); mọi số chưa chốt đọc từ dữ liệu; tạm dừng một hộp hỏi lại; lưu trữ qua `POST /admin/course-products/{id}/archive` của G04 (gõ đúng tên khoá; 409 khi còn người học hoặc đơn mở). 2) `/admin/enrollments` sáu làn, nhãn FR-09-041; `/admin/enrollments/[orderCode]`: lời nhắn học viên, ba ô đối chiếu, nút điền nhanh, kết quả đối chiếu, hộp "Xác nhận và mở khoá" đúng năm việc (FR-09-049), "Yêu cầu bổ sung" có lời nhắn + hạn, huỷ trong `DangerZone`, lịch sử thư, "Đơn kế tiếp", phím J/K. Đơn **đăng ký lại**: đầu trang đơn có dòng "Đơn đăng ký lại · sẽ chuyển N lượt chưa dùng, dùng tới dd/mm/yyyy" và hộp xác nhận nêu cùng số đó trong việc (2); sau xác nhận hiện số đã chuyển thật (FR-09-056); mọi số lấy từ G04. 3) Step-up khi máy chủ trả `step_up_required`.
- Đầu ra: 1 PR (hoặc 2: khoá · đơn).
- Nghiệm thu: staging với đơn kiểm thử: Đã báo chuyển → điền nhanh → Khớp → xác nhận → hồ sơ học viên có khoá hạn đúng, sổ lượt có dòng cộng, tài khoản kiểm thử vào được Reading/Listening; nhập thiếu → nút xác nhận khoá; yêu cầu bổ sung thiếu hạn → không gửi được; huỷ đòi gõ mã đơn; bấm xác nhận hai lần → một quyền; đơn đăng ký lại của học viên kiểm thử còn 3 lượt chưa dùng → trang đơn ghi "sẽ chuyển 3 lượt", sau xác nhận sổ lượt có dòng chuyển 3 lượt kèm hạn (không phải 1 hay 2 lượt); `grep -rnE "chuyển 50|50% lượt" frontend/components/admin frontend/app` rỗng.
- Không làm: không tính học phí ở frontend ngoài so sánh; không tự hoàn tiền; không gửi thư từ frontend; không tự viết logic mở lại đơn hết hạn.
- Vướng mắc → cách gỡ: G04 chưa merge → dừng, làm nhiệm vụ khác. Hợp đồng theo bảng "API G04 mà G09 gọi" (5.4): `request-info` có `info_kind` và `supplement_by`, huỷ có `confirm_order_code`, xác nhận trả `reopened`; bản G04 đã merge thiếu trường nào → không giả lập ở frontend, ẩn phần tương ứng và báo G04.
- Ước lượng: 3 phiên · 4.

### G09-T14 — Quyền luyện lại và thu hồi quyền (cần G04) — SỬA
- Mục đích: FR-09-045, 046.
- Việc làm: component `PracticeGrantForm` dùng chung (trang lớp: cả lớp hoặc người đã chọn; hồ sơ: một người; danh bạ: gia hạn hàng loạt); hỏi lại nêu số người; gọi API G04 (lô nếu có, không thì từng người kèm "Thử lại phần còn lại"); thu hồi trong `DangerZone` của hồ sơ.
- Đầu ra: 1 PR. Nghiệm thu: staging: cấp Course 2 luyện lại cho học viên kiểm thử lớp Course 1 → vào được Course 2; thu hồi (gõ họ tên) → mất quyền; Nhật ký có hai dòng; danh sách khoá không có khoá của chính lớp.
- Không làm: không tạo mã kích hoạt giả để cấp quyền.
- Vướng mắc → cách gỡ: lỗi giữa chừng khi gọi N lần → hiện danh sách đã cấp/chưa cấp, không rollback ở frontend. Tên nguồn quyền → theo G04 (phân xử 12).
- Ước lượng: 2 phiên · 4.

### G09-T15 — Sổ lượt AI `/admin/credits` (cần G04) — SỬA
- Mục đích: FR-09-047, 054, 056 (phần sổ lượt).
- Việc làm: tìm người → số dư **theo khoá** + lịch sử; dòng chuyển lượt (`carry_over`) hiện số lượt và "dùng tới dd/mm/yyyy"; dòng hết hạn phần lượt chuyển hiện theo `label_vi`; cạnh số dư có dòng "trong đó N lượt chuyển, dùng tới …" khi G04 trả; "Điều chỉnh lượt" (chọn quyền còn hiệu lực, cộng/trừ, số nguyên dương, lý do ≥ 10 ký tự, hộp hỏi lại, `request_key`); khối "Sắp hết lượt chấm" theo `low_credits` link sang danh bạ đã lọc; "Cấp thêm lượt cho học viên/lớp…" mở hộp của trang Lớp. Không có ô chọn kỹ năng.
- Đầu ra: 1 PR. Nghiệm thu: staging: cộng 5 lượt cho học viên kiểm thử → số dư tăng 5, dòng mới có lý do và người làm; trừ quá số dư → hiện nguyên thông báo máy chủ; không có nút sửa/xoá dòng; học viên kiểm thử đã đăng ký lại → sổ có dòng chuyển lượt với đúng số lượt chưa dùng của khoá trước và hạn; trang không có chữ "50%".
- Không làm: không cộng dồn số dư ở trình duyệt; không tự tính số lượt chuyển hay hạn của phần lượt chuyển.
- Vướng mắc → cách gỡ: gặp `reason` ngoài các giá trị đã biết của G04 (bảy giá trị ở mục 5.9 và dòng hết hạn phần lượt chuyển) → hiện `label_vi` máy chủ trả, không có thì "Điều chỉnh khác", báo G04. `grant-extra` trả `skipped` khác rỗng → hộp kết quả liệt kê từng người và lý do, không coi là lỗi.
- Ước lượng: 1 phiên · 3.

### G09-T16 — Hộp thư sự cố `/admin/incidents` — SỬA
- Mục đích: FR-09-070…073.
- Đầu vào: T07; tờ `AdminSuCo`; `admin-error-logs.tsx`, trang alerts, `admin-feedback.tsx`.
- Việc làm: một trang, thẻ nguồn `?source=`; danh sách nhóm 25/trang, mặc định Chưa xử lý; hành động hàng loạt có Hoàn tác; trang chi tiết nhóm ("Chi tiết kỹ thuật" gập sẵn); dòng "N câu đang chờ ở Câu cần kiểm" (ẩn khi 0); 307 ba route cũ + `/admin/system`. Bỏ "Tạo lỗi test" khỏi đây (dời sang `/admin/qa-tools`, T18).
- Đầu ra: 1 PR. Nghiệm thu: staging: số nhóm < số dòng; xử lý một nhóm → số giảm đúng; tạo lỗi mới cùng loại → nhóm tự về "Mới" và còn ghi chú.
- Không làm: không kiểm trên production.
- Vướng mắc → cách gỡ: feedback dùng `/api/admin/feedback` → giữ đường gọi cho thao tác trả lời. Test `tests/admin-error-logs.test.mjs` ghim "ADR-012", "FREEZE §4" → sửa cùng PR.
- Ước lượng: 2 phiên · 3.

### G09-T17 — Chấm Writing: một hàng chờ duyệt, phím tắt, dải tóm tắt — SỬA
- Làm cùng đợt (00 điểm 24, thêm 18/11): G12-C01…C03 lưu cặp điểm AI–giáo viên ở bảng riêng `writing_score_pairs` (migration 480), ghi lúc trả bài trong `instructor_workflow.deliver` (sau bước 2) và `admin_writing._deliver_essay` (sau khi RPC trả `ok`; C03 thêm tham số `actor_id` cho `_deliver_essay`, đây không phải đổi luồng `mark-delivered`). T17 không thêm cột điểm và không đổi chữ ký hai hàm này; hai bên cùng chạm luồng trả bài nên xếp PR nối nhau, T17 trước, C03 rebase.
- Mục đích: FR-09-060, 061, 064…069.
- Đầu vào: tờ `AdminChamWriting`; `routers/admin_writing.py` (`essay-queue`), `routers/admin_instructor_queue.py`, `services/instructor_workflow.py`; trang `/admin/writing/queue`, `/grade`, `/instructor-queue`, `/status`.
- Việc làm: 1) Backend: `essay-queue` thêm tham số `sort=next_lesson` (theo `class_lessons.lesson_date` kế tiếp của lớp rồi `waited`), `mock_exam_id`, `ai_failed=1`; mỗi dòng thêm `cohort`, `waited_from`, `next_lesson_date`; đầu ra thêm `remaining`, `remaining_today_classes`. Bài AI lỗi là bộ lọc, không cộng thêm. 2) Frontend: một bảng "Bài chờ duyệt"; `/admin/writing/instructor-queue` → 307 về `/admin/writing/queue`; khối trạng thái vào màn chấm (`panel=status`); Ctrl Enter / J / K; dòng "còn N bài · M bài của lớp học hôm nay"; dải tóm tắt (`LearnerSummary` rút gọn: 4 band gần nhất, mục tiêu, loại chú thích lặp, link hồ sơ); bài thi thử không có nút trả; nhãn lời thường. 3) "Quá hạn" theo `writing_review_hours`.
- Đầu ra: 1 PR (backend + frontend nếu nhỏ; tách hai nếu quá 600 dòng).
- Nghiệm thu: preview: sidebar không còn "Giáo viên duyệt"; bài Speaking luyện tập không xuất hiện trong hàng chờ; Ctrl Enter trả bài kiểm thử rồi mở bài kế; J/K không trả; bài thi thử không có nút trả; `grep -rn "Claim atomic\|Hàng đợi Instructor" frontend/app` rỗng.
- Không làm: không đổi thuật toán chấm; không đổi luồng `mark-delivered`; không thêm cột điểm AI/giáo viên vào `writing_essays`, `instructor_reviews`, `writing_feedback`: cặp điểm do G12-C02/C03 lưu ở `writing_ai_score_snapshots` và `writing_score_pairs` (migration 480). Nếu T17 thêm đường sửa điểm mới thì đường đó phải đi qua `essay_service.upsert_composed_version` (GOI-12 K5).
- Vướng mắc → cách gỡ: trước G04 chưa có `review_mode` để tách "lớp offline" → hàng chờ = bài đang ở tầng duyệt hiện có; ghi trong PR. Khoá mềm tự nhả 30 phút chưa có → chỉ hiện ai đang giữ + nút "Nhận chấm thay" dùng `release`/`claim` sẵn có; tự nhả theo thời gian là việc backend riêng sau khi Q19 chốt. Test `admin-writing-status-redesign.test.mjs`, `admin-instructor-queue-redesign.test.mjs` ghim chuỗi → sửa cùng PR, liệt kê.
- Ước lượng: 3 phiên · 4.

### G09-T18 — Trang Việc cần làm, AI và mô hình, Công cụ QA — SỬA
- Mục đích: FR-09-073, 074, 090…093.
- Đầu vào: T06, T22; tờ `AdminViecCanLam`, `AdminHeThong`.
- Việc làm: `/admin`: khối hàng chờ (`QueueRow`, thứ tự cố định, dòng lỗi có tải lại riêng), "Lớp hôm nay và tuần này" ("Giao bài…" mở `AssignDrawer` với lớp và buổi chọn sẵn; "Xem kết quả bài giao"), "Cần chú ý tuần này", "Vận hành tuần này"; dòng hàng chờ "Lớp chưa chuyển sang đo lượt" (`classes_unmetered`) mở `/admin/classes?metering=legacy`. Dời `AdminAiPanel` sang `/admin/ai-models` + khối xác nhận có lý do ≥ 10 ký tự (lý do ghi log phía client gửi kèm nếu API nhận; API 0024 không nhận → chỉ xác nhận, Q7). `/admin/qa-tools`: link `recommend-test`, `mock-exams/corrections`, nút "Tạo lỗi thử" (`POST /admin/error-logs/test`) chỉ khi `environment !== 'production'`.
- Đầu ra: 1 PR. Nghiệm thu: preview: `/admin` không còn bảng model; dòng nguồn lỗi (giả lập 500) ghi "chưa có" và các dòng khác vẫn có số; "Kỳ thi hôm nay" chỉ hiện ngày có kỳ thi; không có nút trả kết quả thi thử; `tests/react/admin-ai-panel.test.tsx` qua.
- Không làm: không đổi API 0024; không thêm step-up cho đổi model.
- Vướng mắc → cách gỡ: panel poll 30 giây → dừng poll khi rời trang. `admin-overview-partial-failures.test.tsx` ghim panel → cập nhật.
- Ước lượng: 2 phiên · 3.

### G09-T19 — Tìm nhanh Ctrl/⌘ K — GIỮ
- Mục đích: FR-09-075, 102.
- Việc làm: `AdminCommandPalette` trong `AdminFrame`; bỏ qua phím tắt khi con trỏ ở ô nhập; gọi T05; `role="dialog"`, `aria-modal`, danh sách `role="listbox"`.
- Đầu ra: 1 PR. Nghiệm thu: React test: Ctrl+K và Meta+K mở, Esc đóng và trả focus, ↑↓ Enter mở đúng href; preview: tìm học viên kiểm thử → hồ sơ trong 2 thao tác.
- Không làm: không lưu lịch sử tìm; không làm "bảng lệnh".
- Vướng mắc → cách gỡ: ⌘K trùng phím trình duyệt → chỉ `preventDefault` khi palette xử lý. Nhóm rỗng → ẩn nhóm, không hiện tiêu đề trống.
- Ước lượng: 1 phiên · 3.

### G09-T20 — Khu giáo viên trong khung chung, 5 mục — SỬA
- Mục đích: FR-09-100…104.
- Đầu vào: `instructor-dashboard.tsx`, `instructor-grade.tsx`, `instructor-compare.tsx`; tờ `GiaoVien`; T06, T24, T26, T27.
- Việc làm: layout giáo viên dùng `AdminFrame role="instructor"`; `?tab=today|classes|students|assign|grading`; **Việc của tôi** (trang đầu) từ `GET /instructor/attention`; Lớp của tôi (bảng tiến độ học viên × bài từ `assignment-matrix`, bài quá hạn "Xem ai chưa nộp" + gửi nhắc); Học viên (ngăn `LearnerSummary`); Giao bài = `AssignDrawer`; Chấm và duyệt bài (Writing chờ duyệt + Speaking thi thử chờ chấm của lớp mình). Bỏ "Đăng xuất" cạnh "Làm mới".
- Đầu ra: 1–2 PR. Nghiệm thu: staging với hai tài khoản giáo viên kiểm thử: 5 mục, tải lại giữ mục; giáo viên A mở URL lớp của B → về trang cha kèm một dòng, không lộ tên; không có nút trả kết quả thi thử, không có thao tác mã/quyền; admin "xem như giáo viên" vẫn có dải và nút thoát.
- Không làm: không đổi `/instructor` sang đường dẫn khác; không cho giáo viên xem Nhật ký lớp.
- Vướng mắc → cách gỡ: G10 không gộp ba group giáo viên → gắn `AdminFrame` trong từng layout (3 file). API lớp hiện chỉ `require_admin` (ví dụ `tally`, `assignments`) → chỉ mở cho giáo viên những route liệt kê ở 5.4 qua `staff_scope`, không mở rộng hàng loạt.
- Ước lượng: 3 phiên · 3.

### G09-T21 — Ba spec bổ sung (CLASSRESULT, MOCKORG, CONTENTBATCH) — MỚI
- Mục đích: phạm vi mới vượt một spec; mỗi phần có migration và hành vi riêng cần duyệt riêng.
- Việc làm: dùng ba số đã cấp ở `01-KE-HOACH-TONG.md` mục 6 (kiểm `ls specs` và PR đang mở trước khi dùng; ghi vào sổ đăng ký trong repo); soạn `specs/0085-class-assignment-result/` (`CLASSRESULT-0085`; FR-09-120…131, migration 443–444, API `result`), `specs/0086-mock-exam-organisation/` (`MOCKORG-0086`; FR-09-140…150, migration 445–448, lớp tương thích 5.5; ghi quan hệ với spec 0006 `admin-mock-test-operations`), `specs/0087-content-import-batches/` (`CONTENTBATCH-0087`; FR-09-160…163, migration 449–450). Spec 0086 ghi nguyên hợp đồng kỳ `self_paced` chạy liền các phần (5.5, FR-09-143, 151) và quan hệ với spec `EXAMMOCK-0071` của G08. Thao tác "Cấp lượt cho lớp cũ" (FR-09-057, 058) và "mỗi lớp một giáo viên" (FR-09-108) thuộc 0074. Mỗi spec một PR.
- Đầu ra: 3 PR spec. Nghiệm thu: validate_specs qua; mỗi spec có mục "Related specifications" (0043, 0006, 0041, 0082) và mục câu hỏi mở tương ứng (Q12–Q14, Q22, Q27).
- Không làm: không viết mã; không lấy số ngoài bảng mục 6; không gộp vào 0074 nếu chưa được phép.
- Vướng mắc → cách gỡ: số 0085–0087 đã bị thư mục hoặc PR khác dùng → dừng, báo anh Andy, không tự nhảy số. Anh Andy muốn gộp tất cả vào 0074 → dời nội dung thành các phần của 0074, T01 mở lại.
- Ước lượng: 3 phiên · 2.

### G09-T22 — Migration 440 và API Cài đặt / ngưỡng — MỚI
- Mục đích: FR-09-080, 081, 084; 5.6.
- Đầu vào: `routers/admin_flags.py`, `services/runtime_flags.py` (mẫu cache), mig 356 (mẫu chỉ ghi thêm), tờ `AdminCaiDat` mục 7, 8.
- Việc làm: `440_admin_settings.sql` + rollback; `services/ops_thresholds.py` (`get()`, `set_many(changes, reason, actor)`; kiểm khoảng; `fixed` không sửa được); `routers/admin_settings.py` theo 5.4 (thêm route vào file GOI-11 T16 đã tạo nếu đã có — một router cho `/admin/settings/*`); test: ngoài khoảng → 422 tiếng Việt; lưu ghi log cũ → mới; giáo viên đọc được, không ghi được; ngưỡng `null` giữ `null`.
- Đầu ra: 1 PR backend (`high-risk`: migration).
- Nghiệm thu: pytest qua; áp migration trên DB thử: `SELECT value FROM admin_settings WHERE key='ops_thresholds'` có đủ khoá 5.6; UPDATE vào `admin_settings_log` bị từ chối.
- Không làm: không viết job xoá bản ghi âm; không lưu bí mật trong `admin_settings`.
- Vướng mắc → cách gỡ: GOI-11 T16 đã tạo `routers/admin_settings.py` → thêm vào file đó, không tạo router thứ hai cùng prefix. Số 440 đã bị dùng → theo sổ đăng ký của G10, lấy số kế trong dải và cập nhật bảng 5.3 trong PR.
- Ước lượng: 1 phiên · 3.

### G09-T23 — Trang Cài đặt (các thẻ ngoài Chấm thử) — MỚI
- Mục đích: FR-09-080…084.
- Đầu vào: tờ `AdminCaiDat`; T22; trang `/admin/settings` của GOI-11 T16 (nếu đã có).
- Việc làm: thẻ `thresholds` (bảng nhóm · ngưỡng · giá trị · dùng ở; "Lưu…" liệt kê thay đổi cũ → mới; giảm thời gian lưu hiện cảnh báo không lấy lại được); thẻ `email` (bảng loại thư: năm thư bắt buộc không có công tắc; loại khác tắt có xác nhận; "Gửi thử" chỉ khi GOI-11/G04 có API gửi thử, không thì ẩn); thẻ `features` (dùng `GET/PATCH /admin/runtime-flags`, lý do ≥ 10 ký tự); thẻ `notices` (thông báo bảo trì: lưu vào `admin_settings` khoá `system_notices`; không được trùng kỳ thi đã lên lịch — máy chủ kiểm); thẻ `payment` chỉ đọc từ cấu hình G04 cho tới khi Q20 chốt; thẻ `legal` hiện "chưa mở" (Q21); khối "Nhật ký thay đổi cài đặt" cuối mọi thẻ. `ThresholdsProvider` trong `AdminFrame`.
- Đầu ra: 1 PR. Nghiệm thu: staging: đổi `writing_review_hours` từ 48 xuống 1 → một bài chờ duyệt kiểm thử hiện "quá hạn" ở hàng chờ và Việc cần làm mà không cần deploy; nhập 0 hoặc chữ → lỗi dưới ô; thẻ Chấm thử của GOI-11 vẫn chạy; `grep -rnE "48 ?giờ|72 ?giờ" frontend/components/admin frontend/app` không ra hằng số ngưỡng trong mã (chỉ được có trong test/fixture).
- Không làm: không dựng nội dung thẻ Chấm thử; không cho sửa số tài khoản nhận tiền khi chưa có Q20.
- Vướng mắc → cách gỡ: GOI-11 T16 chưa merge → tạo trang với các thẻ của G09, thẻ `trial` `available:false`; khi T16 vào thì T16 thêm thẻ. Hai gói cùng sửa một `page.tsx` → gói đứng sau rebase.
- Ước lượng: 2 phiên · 3.

### G09-T24 — Migration 441 và phạm vi giáo viên theo lớp — MỚI
- Mục đích: FR-09-102, 108, 113; "lớp của giáo viên" có ở máy chủ, **mỗi lớp một giáo viên** (00 mục 2 điểm 23 — Q18 đã đóng). Đây cũng là "cách G09 chốt phạm vi giáo viên" mà GOI-11 (5.1.7, 5.5.8) dùng.
- Đầu vào: mig 060, 106, 227 (`student_cohort_memberships`); `routers/instructor.py` (`_me`, `instructor_db`); `routers/cohorts.py` (`PATCH /{cohort_id}` dòng 143); `services/staff_guard.py`; `tests/test_staff_guard_inventory.py` (`GUARD_NAMES` dòng 57).
- Việc làm: 1) `441_cohort_teacher_schedule.sql` + rollback: **một cột** `cohorts.instructor_id` (không tạo bảng nối giáo viên–lớp), cột lịch, và phần điền cho lớp đang có theo đúng quy tắc ở 5.3 (suy từ `students.instructor_id` của thành viên active khi cả lớp cùng một giáo viên; còn lại để NULL, in NOTICE). 2) `services/staff_scope.py` (5.4) — nơi duy nhất đọc `cohorts.instructor_id` để quyết định quyền. 3) `PATCH /admin/cohorts/{cohort_id}` nhận `instructor_id`, `weekly_schedule`, `start_date`; kiểm vai trò người được gán (5.4); ghi `class_action_log`; `GET` lớp trả `instructor`. 4) Khi đặt `cohorts.instructor_id` thì **không** tự đổi `students.instructor_id` (giữ đường Writing hiện tại của giáo viên). 5) Thêm `resolve_staff_scope` vào `GUARD_NAMES` kèm test hàm bọc (5.4). 6) Test: giáo viên chỉ thấy lớp mình; admin thấy tất cả; lớp `instructor_id` NULL chỉ admin thấy; đổi giáo viên lớp từ A sang B → A nhận 404 ở lần gọi kế, B thấy lớp; gán người có vai trò `user` → 422 `invalid_instructor`; học viên ở hai lớp của hai giáo viên → mỗi giáo viên chỉ thấy bài của lớp mình.
- Đầu ra: 1 PR backend (`high-risk`: quyền + migration).
- Nghiệm thu: pytest qua; áp migration trên DB thử: `\d cohorts` có đúng một cột `instructor_id`, không có bảng `cohort_instructors`; lớp thử có mọi thành viên cùng giáo viên → cột được điền, lớp lẫn hai giáo viên → NULL và có tên trong NOTICE; PR liệt kê kết quả `grep -rnE "cohorts.*instructor_id|instructor_id.*cohorts" backend/routers backend/services --include="*.py"`: ngoài `services/staff_scope.py` và phần đọc/ghi của `routers/cohorts.py`, không file nào tự truy vấn cột này để quyết định quyền; inventory qua.
- Không làm: không đổi RLS của `students`; không gộp hai khái niệm "giáo viên của học viên" (`students.instructor_id`, đường Writing cũ) và "giáo viên của lớp"; không tạo bảng hay cột cho giáo viên thứ hai, trợ giảng; không tự gán anh Andy vào lớp đang NULL (Q35).
- Vướng mắc → cách gỡ: lớp sau khi điền còn NULL → chỉ admin thấy, mọi việc của lớp về hàng chờ admin; admin chọn giáo viên ở trang Lớp (T29). Production hiện 0 tài khoản vai trò giáo viên (16/11) → phần điền gần như để NULL toàn bộ, đây là kết quả đúng (anh Andy là admin, thấy mọi lớp). Sau này cần nhiều giáo viên một lớp → quyết định mới của anh Andy; hàm `staff_scope` giữ nguyên chữ ký nên nơi gọi không đổi. Inventory không nhận guard bọc → xem 5.4.
- Ước lượng: 2 phiên · 4.

### G09-T25 — Nhóm đã lưu (migration 443) — MỚI
- Mục đích: nhóm dùng chung cho giao bài, kỳ thi; FR-09-121, 142.
- Việc làm: migration + rollback; `routers/admin_learner_groups.py` (5.4); giáo viên chỉ thấy/sửa nhóm mình tạo; thành viên phải là học viên active; test quyền.
- Đầu ra: 1 PR backend. Nghiệm thu: pytest: giáo viên thêm học viên lớp khác vào nhóm → 404; lưu trữ nhóm không xoá thành viên.
- Không làm: không làm nhóm "theo điều kiện" (động).
- Vướng mắc → cách gỡ: học viên rời lớp → vẫn ở nhóm; nơi dùng nhóm lọc lại theo lớp/kỳ thi lúc áp dụng và báo số người bị bỏ. Tên nhóm trùng trong cùng chủ → 409 `name_taken`.
- Ước lượng: 1 phiên · 2.

### G09-T26 — Thành phần giao bài dùng chung; bỏ hai sổ giao bài — MỚI
- Mục đích: FR-09-121…123.
- Đầu vào: tờ `ThanhPhanDuLieu` mục "Giao bài theo buổi", `CHUAN-ADMIN.md` mục E; `admin-class-homework.tsx`; `routers/admin_class_assignments.py` (`AssignmentCreate` dòng 168–296, `POST …/assignments` dòng 2742, `course-banks` 1035, `PATCH …/due` 3110); T24, T25; GOI-11 5.5.8.
- Việc làm: `AssignDrawer` (5.7); chọn nhiều bài → gọi `POST` từng bài; trùng (lớp, bài) (API trả 409 "Lớp này đã được giao … rồi": bank khoá ở dòng ~995, chủ đề Speaking ~595, bộ đề ~751 — số dòng ở `c3bc71574`) → cảnh báo hai lựa chọn (giữ hạn cũ / gọi `PATCH …/due`); "Chế độ trả điểm" chỉ khi bài là bài kiểm tra **và** GOI-11 phần E đã có; backend: mở `POST …/assignments` và `PATCH …/due` cho giáo viên của lớp. Bỏ khỏi giao diện: thẻ/sổ giao bài Writing (`/admin/writing/assignments` → 307) và tab `assign` ngữ pháp; trang một đề ở Nội dung có nút "Giao bài này…".
- Đầu ra: 1 PR. Nghiệm thu: staging: mở từ lớp, Việc cần làm, hồ sơ (chọn sẵn một người), trang một đề (chọn sẵn đề) đều ra cùng một ngăn; giao "Chọn tay 3 người" → 3 `class_assignment_items`; giao trùng → cảnh báo, không tạo bản thứ hai; hạn mặc định 23:59 ngày học của buổi.
- Không làm: không xoá API `admin_writing_assignments.py` (khu giáo viên hiện tại và dữ liệu cũ còn dùng); không tự thêm giới hạn "ngữ pháp chỉ Course 5" trên giao diện (máy chủ đã chặn ở `_require_course_five`).
- Vướng mắc → cách gỡ: buổi không có `lesson_date` → hạn mặc định trống, bắt người dùng chọn. PR #2254 có luồng giao bài khác → giữ phần không trùng, liệt kê trong PR.
- Ước lượng: 2 phiên · 3.

### G09-T27 — API tổng hợp Kết quả một bài giao (migration 444) — MỚI
- Mục đích: FR-09-124…130; hợp đồng `result` ở 5.4.
- Đầu vào: `admin_class_assignments.py` (`assignment_tally` 1649, `_hand_in_status` 1541); `services/quiz_service.py` (`course_attempt_report` 6382, `course_answer_report` 6041); mig 119, 186, 188, 189; `scripts/import_course_exercise_bank.py`; spec 0043; `backend/content/master30-assigned-practice/v2.json` (tên buổi).
- Việc làm: 1) Migration 444 + rollback. 2) `services/assignment_result.py`: dùng lại hàm sẵn có để lấy danh sách học viên và lượt làm (không chép truy vấn), viết phần gom mới theo `skill`/`subtype`. 3) Ba biến thể. 4) File nhãn `backend/content/course-labels/truc_nhom_vi.json`, `subtype_vi.json` (bắt đầu rỗng `{}` + cơ chế; tên do anh Andy duyệt — Q27). 5) `remind`, `review-items`, `assignment-matrix`. 6) Cờ `assignment_result_v2`. 7) Test: người chưa nộp không bị tính 0; không cắt nhóm (bank thử 11 nhóm → 11 nhóm); gom theo `subtype`; `previous=null` khi không có bài trước; nhắc hai lần một ngày → lần hai `skipped_already_today`; giáo viên lớp khác → 404; bài chế độ công bố vẫn có điểm cho nhân sự.
- Đầu ra: 1 PR backend.
- Nghiệm thu: pytest qua; trên staging gọi API cho một bài Course 1 kiểm thử: số nhóm = số giá trị `skill` khác nhau của bank, tổng `states` = sĩ số nhận bài.
- Không làm: không sửa, không xoá `tally`, `attempt-report`, `students/{u}/report`; không lưu `lesson_primary`; không tách mã ngộ nhận.
- Vướng mắc → cách gỡ: đề giữa/cuối kỳ có câu không suy được buổi → nhóm `key="unknown"`, nhãn "Chưa gắn buổi", ghi số câu; không đoán. Chậm với lớp lớn → một truy vấn `quiz_attempts` theo danh sách session, gom ở Python; đo và ghi vào PR, không thêm index khi chưa hỏi. GOI-11 T28 hiện ghi "không thêm API đọc thứ tư" → điểm phải khớp ở mục 7.
- Ước lượng: 3 phiên · 4.

### G09-T28 — Trang Kết quả một bài giao — MỚI
- Mục đích: FR-09-125…130.
- Đầu vào: tờ `AdminKetQuaBaiGiao`; T27; `admin-class-submissions.tsx` (thay); `lib/admin-class-submissions-model.mjs`.
- Việc làm: route `/admin/classes/[cohortId]/assignments/[assignmentId]`; 5 khối, mỗi khối khung chờ riêng; khối 1 thanh năm trạng thái + ba nhóm cần việc + "Gửi nhắc"; khối 2 dải điểm lượt đầu; khối 3 bảng nhóm, mở nhóm, nút đổi cách gom; khối 4 bảng + "Thêm ghi chú" (mở thẻ ghi chú của hồ sơ), "Gửi thông báo cho N người đã chọn…"; khối 5 chọn câu + "Lưu vào buổi N" + bản "Chữa trên lớp" (không tên học viên); biến thể `rubric`, `course_test` (nút "Mở bảng công bố điểm"). Trang lớp: tên bài mở trang này khi cờ bật; ba tab cũ còn sau cờ tắt.
- Đầu ra: 1 PR. Nghiệm thu: staging với bài kiểm thử: chưa ai nộp → chỉ khối 1; có bài nộp → 5 khối; không có chữ "trục"; không có ba bộ nhãn trạng thái cũ (`COURSE_STATE`, `EFFORT_BASE`) trên trang; lỗi giả lập ở một khối không làm hỏng khối khác; 1024px bảng khối 3 gộp cột phụ.
- Không làm: không công bố điểm ở trang này; không xoá file ba tab cũ trong PR này (xoá khi gỡ cờ).
- Vướng mắc → cách gỡ: nhãn nhóm chưa có tên Việt → hiện mã (`label_source: "code"`), không chặn phát hành. "Gửi thông báo" khi GOI-11 A chưa có → nút tắt kèm lý do.
- Ước lượng: 3 phiên · 3.

### G09-T29 — Trang Lớp: thẻ, bảng học viên × bài, mã kèm lượt, cấp thêm lượt — MỚI
- Mục đích: FR-09-053, 054, 108, 120, 124. (Thao tác "Cấp lượt cho lớp cũ" tách thành T43 vì T29 đã lớn và T43 phụ thuộc API mới của G04.)
- Đầu vào: tờ `AdminLop`, `Admin1024` (bản 1024px của trang Lớp); `admin-class-detail.tsx`, `admin-class-homework.tsx`; T24, T26, T27; G04 (mã có sản phẩm và số lượt).
- Việc làm: thẻ trên URL; thẻ Học viên = bảng học viên × bài (`assignment-matrix`); thẻ Buổi học (danh sách buổi, giao bài theo buổi, câu nên chữa đã lưu); thẻ Bài nộp (tên bài → T28; "Gửi nhắc" → hộp liệt kê người thiếu bài đã qua hạn); thẻ Kiểm tra (danh sách bài kiểm tra → T30); thẻ Nhật ký (`action-log`); hộp "Cấp mã kích hoạt cho lớp" có ô số lượt (gọi API tạo mã của G04); nút "Gửi thư mời" khi tạo mã cho học viên có email: xếp thư `class_invite` (to_email, mã, tên lớp, liên kết `/activate#code=`) qua `learner_email.send_direct` của G04; "Gửi lại" ghi nhật ký (thư 3 tờ EmailMau; mẫu chữ do G05-T14 viết — sửa 18/11 theo rà soát); hộp "Cấp thêm lượt…" (API G04); biểu mẫu quyền luyện lại (T14); lưu trữ lớp trong Vùng nguy hiểm (gõ đúng tên lớp, bỏ khoảng trắng hai đầu). Giáo viên của lớp (FR-09-108): đầu trang lớp và cột ở danh sách lớp hiện tên giáo viên hoặc "chưa có giáo viên"; admin đổi bằng **một ô chọn một người** (gọi `PATCH /admin/cohorts/{id}` của T24), hỏi lại khi lớp đang có bài chờ duyệt (nêu số bài sẽ đổi người nhận); không có điều khiển thêm giáo viên thứ hai.
- Đầu ra: 1–2 PR. Nghiệm thu: staging: tải lại giữ thẻ; đổi giáo viên lớp kiểm thử 1 từ A sang B → trang lớp ghi B, Nhật ký lớp có dòng, tài khoản A mở lớp đó nhận trang cha kèm một dòng giải thích; trang lớp không có nút "Thêm giáo viên"; tạo 3 mã kèm 5 lượt cho lớp kiểm thử → sổ mã hiện cột lượt = 5; cấp thêm 2 lượt cho một người → sổ lượt người đó có dòng mới có lý do; gửi nhắc lần hai trong ngày không gửi thêm.
- Không làm: **không** dựng "Tạo lớp ba bước sinh buổi từ lịch tuần" và "Dời buổi" khi Q25 chưa chốt (cột đã có ở 441 nhưng luồng là đề xuất của người thiết kế); không dựng thẻ Kiểm tra "Theo buổi" khi chưa có spec 0043/T27 biến thể `course_test`.
- Vướng mắc → cách gỡ: G04 chưa có số lượt kèm mã → hộp tạo mã vẫn dùng API hiện tại (`/admin/access-codes/generate`), ô số lượt ẩn kèm ghi chú trong PR. Tính năng exercise-book đang tắt → không đụng.
- Ước lượng: 3 phiên · 3.

### G09-T30 — Bảng công bố điểm bài kiểm tra khoá (giao diện) — MỚI
- Mục đích: FR-09-131. Backend ở GOI-11 phần E (T21–T24 của GOI-11); nhiệm vụ này **thay** phần giao diện mà G11-T28 mô tả (mục 7).
- Đầu vào: tờ `KiemTraKhoaGiaoVien`, `KiemTraKhoa` mục 5–7; GOI-11 5.5.8 (`release`, `release-schedule`, `release-mode`, `tally` mở rộng); T27 (khối "Theo buổi" lấy từ `result` biến thể `course_test`).
- Việc làm: route `/admin/classes/[cohortId]/assignments/[assignmentId]/release` (admin và giáo viên của lớp); bảng học viên (bài nộp, câu đúng, tỉ lệ, mức đã công bố, "vắng"); chọn mức; quy tắc nút cả lớp / đã chọn; hộp hỏi lại + "Xem như học viên thấy" (dựng component màn học viên của G07/GOI-11 T27 ở chế độ xem trước cho người đầu danh sách); hẹn giờ; khoá chế độ sau bài nộp đầu (ẩn nút, ghi lý do).
- Đầu ra: 1 PR. Nghiệm thu: test React: có dòng chọn → nút cả lớp tắt; mức thấp hơn mức đã công bố bị tắt; `release` gửi đúng `student_ids`; staging: công bố mức `score` cho 2 người → hai tài khoản kiểm thử thấy điểm, người thứ ba chưa thấy; không có điều khiển nộp trễ/làm bù/làm lại trên trang.
- Không làm: không thu hồi, không hạ mức; không dựng nộp trễ, làm bù, làm lại (đợt sau).
- Vướng mắc → cách gỡ: GOI-11 phần E chưa merge → dừng, làm nhiệm vụ khác. Component màn học viên chưa có → "Xem như học viên thấy" hiện danh sách trường sẽ hiện ở mức đó (theo GOI-11 5.5.4), ghi trong PR.
- Ước lượng: 2 phiên · 3.

### G09-T31 — Kỳ thi backend 1: người dự thi, tên chế độ, nháp (migration 445, 446) — MỚI
- Mục đích: FR-09-141…144, 151 (phần dữ liệu theo dõi); 5.5.
- Đầu vào: mig 145, 146, 154, 169; `routers/admin_mock_exams.py`; `services/mock_exam_service.py` (`admin_live_monitor` 4090; phần retake dòng 656–700: `is_retake`, `retake_time_remaining_seconds`, `retake_active_section`; `reap_expired_retake_sittings` 3565); `routers/mock_exams.py`; spec 0006; T25; GOI-08 T22.
- Việc làm: PR 1: migration 445 + `services/mock_exam_modes.py` + API `audience`, `schedule`, sửa `POST`/`GET` (5.4), ghi kép, cờ `mock_exam_audiences`, `admin_live_monitor` đọc roster từ audiences khi cờ bật. Kỳ `self_paced`: viết **một hàm thuần** `services/mock_exam_modes.py::self_paced_timeline(sitting, exam, now)` trả mốc bắt đầu, phần đang chạy, giờ còn lại của phần, `expected_end_at`, `self_paced_state` theo đúng 8 điểm hợp đồng ở 5.5 (không ghi DB); `admin_live_monitor` dùng hàm này để trả các trường `self_paced_*` (5.4). G08-T22 dùng **cùng hàm** cho phía học viên và là nơi ghi mốc phần kế, tự nộp phần hết giờ, bỏ màn chọn phần; T31 không sửa đường nộp bài của học viên. PR 2 (sau khi PR 1 lên staging): migration 446 backfill + sửa `fn_set_exam_mode`. Test: kỳ cũ một lớp vẫn chạy y như trước khi cờ tắt; ba nguồn cộng dồn khử trùng, nguồn đầu tiên được giữ; kỹ năng từng người ⊆ kỹ năng kỳ thi; kỳ chỉ có Listening + Reading lên lịch được; người chưa có tài khoản `selected=false`; tên cũ gửi vào API được ánh xạ; `self_paced_timeline` (đồng hồ giả): kỳ ba phần 30 · 60 · 60 phút, nộp phần 1 ở phút 20 → phần 2 bắt đầu đúng phút 20, không có khoảng `not_started` giữa hai phần; không nộp phần 1 → phần 2 bắt đầu đúng phút 30; quá phút 150 không thao tác → `submitted`; chưa bắt đầu khi khoảng mở đóng → `missed`; cộng 300 giây cho phần 2 đang chạy → `expected_end_at` lùi 300 giây.
- Đầu ra: 2 PR backend (`high-risk`).
- Nghiệm thu: pytest toàn bộ `tests/*mock*` qua không sửa nghĩa test cũ; trên DB thử sau 446: `SELECT count(*) FROM mock_exams WHERE exam_mode IN ('sequential','retake')` = 0 và số dòng audiences ≥ số dòng assignments cũ.
- Không làm: không xoá `mock_exams.cohort_id`, `mock_exam_assignments`; không đổi API học viên ngoài thêm `exam_mode_v2`; không cho một người có hai lượt `main` của cùng kỳ (làm một lần — đã có UNIQUE ở 5.5); không tạo kỳ thi "mở cho mọi người"; không thêm trường, tham số hay trạng thái nào cho "nghỉ giữa các phần" hoặc "làm phần sau vào lúc khác".
- Vướng mắc → cách gỡ: test cũ ghim chuỗi `sequential`/`retake` ở response admin → sửa trong PR, liệt kê; vỡ > 30 test → dừng, báo. Kỳ thi đang diễn ra lúc backfill → 446 bỏ qua kỳ có `is_open = true`, in NOTICE; chạy lại sau. G08 chưa đổi cổng học viên → kỳ live nhiều lớp **không được lên lịch** (API `schedule` trả 422 `learner_gate_not_ready` khi danh sách có người ngoài `cohort_id` và cờ `mock_exam_audiences_learner` tắt).
- Ước lượng: 3 phiên · 5.

### G09-T32 — Danh sách kỳ thi và "Tổ chức kỳ thi" ba bước — MỚI
- Mục đích: FR-09-140…144.
- Đầu vào: tờ `AdminKyThi`; T31; `admin-mock-tests.tsx`, `lib/admin-mock-exams-model.mjs`, `retake-assignment-dialog.tsx`.
- Việc làm: `/admin/mock-tests` thành danh sách (lọc trạng thái; "Đang diễn ra" gồm cả kỳ tự làm đang mở); `/admin/mock-tests/new` và `/[examId]/setup`: bước Đề · Người thi · Cách thi · Xem lại; tự lưu nháp khi đổi bước; cảnh báo "N người đã làm đề này ở Luyện tập" (`practice_overlap`); "Lưu thành nhóm…"; bước Cách thi **không** có lựa chọn "Được nghỉ giữa các phần" và "Số lần làm" (đã chốt: các phần chạy liền nhau, không nghỉ giữa, một lần — bỏ hai ô này dù tờ AdminKyThi còn vẽ); chọn "Làm trong khoảng thời gian" thì hiện dòng "Đã bắt đầu thì làm liền các phần, không nghỉ giữa. Người thi cần một quãng liền khoảng N phút." (N = tổng thời lượng các phần đã chọn) và cảnh báo khi khoảng mở ngắn hơn N phút; nút "Lên lịch" nói thiếu gì.
- Đầu ra: 1 PR. Nghiệm thu: staging: tạo kỳ nháp chỉ Listening + Reading, thêm 2 lớp kiểm thử + 1 học viên lẻ + 1 nhóm → danh sách khử trùng, cột Nguồn đúng; bỏ một kỹ năng của một người; lưu nháp, tải lại còn nguyên; không thấy chữ "sequential", "retake", mã kỳ thi dạng máy trên giao diện; kỳ tự làm Listening + Reading hiện dòng "cần một quãng liền khoảng N phút" với N bằng tổng `section_minutes` của hai phần, và không có ô "nghỉ giữa các phần".
- Không làm: không giữ iframe; không thêm lựa chọn hiển thị kỳ thi cho học viên chưa được giao.
- Vướng mắc → cách gỡ: lưu nháp lỗi → giữ thay đổi trên trang, hiện dải lỗi. Đề bị gỡ sau khi lên lịch → kỳ về Nháp, hiện lý do (API trả `not_ready`).
- Ước lượng: 3 phiên · 3.

### G09-T33 — Kỳ thi backend 2: sự kiện, cộng giờ, nhắn phòng, phân tích, trả kết quả (migration 447, 448) — MỚI
- Mục đích: FR-09-146…149.
- Đầu vào: `admin_mock_exams.py` (`bulk-release` 765, `pacing` 822, `retest-flags` 794, `assignments` 555); `services/mock_review_workflow.py`; `mock_exam_service.py` dòng ~2729 (`grading_details`), ~4378 (pacing); T22.
- Việc làm: migration 447, 448; ghi `mock_exam_events` ở open/advance/collect/đóng, thêm người, cộng giờ, nhắn phòng, thi bù, trả, sửa điểm; `extra-time` (đồng hồ của người đó cộng thêm; kiểm cách tính `section_time_left_seconds`; kỳ `self_paced`: chỉ nhận phần đang chạy theo `self_paced_timeline` của T31, phần khác → 409 `section_not_running`, các phần sau tự lùi vì mốc tính nối tiếp — 5.5 điểm 8); `room-message` (chỉ kỳ live); `analysis` (tổng hợp từ `grading_details`, `answered_at`, roster band; phân bố band chỉ khi ≥ `band_dist_min_papers`, ngưỡng `null` → `null`); `release` (hai chế độ; `confirm_title` phải khớp tiêu đề; idempotent theo `request_key`); `score-edit`; `events`; `/live` thêm `idle_threshold_minutes` đọc từ `exam_idle_minutes`; ghi thêm sự kiện `mock_exam_events` khi sửa khoảng mở (cùng các sự kiện thêm người, trả kết quả đã có) để bước sweep của GOI-11 sinh thông báo `mock_assigned`, `mock_closing`, `mock_result` — không gọi thông báo trong giao dịch (GOI-11 mục 5.1.3, FR-11-002; sửa 18/11 theo rà soát).
- Đầu ra: 1 PR backend (`high-risk`: kết thúc/trả kết quả bài thi).
- Nghiệm thu: pytest: `complete_only` không trả người thiếu Speaking; `include_partial` ghi `released_skills`; trả lặp cùng `request_key` không đổi gì; sửa điểm trước khi trả → 409; cộng giờ thiếu lý do → 422; kỳ `self_paced`: cộng giờ cho phần đã nộp → 409 `section_not_running`; `complete_only` ở kỳ tự làm trả được cho người đã hết giờ cả bài (mọi phần đã tự nộp) và bỏ qua người `missed`.
- Không làm: không thu hồi kết quả; không gộp thi bù vào kỳ gốc (Q13); không đổi `bulk-release` hiện có (API mới gọi lại logic của nó).
- Vướng mắc → cách gỡ: phía học viên chưa hiểu "trả từng phần" (phiếu ghi "Đang chấm") → `include_partial` sau cờ `mock_partial_release` mặc định tắt; G07/G08 khớp rồi mới bật (mục 7). Cộng giờ ở phòng live đồng hồ chung → chỉ áp cho người đó; thu bài cả phòng phải bỏ qua người còn giờ cộng — nếu `collect` hiện không hỗ trợ từng người, dừng và báo, không tự viết lại `collect`.
- Ước lượng: 3 phiên · 4.

### G09-T34 — Trang một kỳ thi 7 thẻ — MỚI (2 PR)
- Mục đích: FR-09-145…150; thay trung tâm iframe.
- Đầu vào: tờ `AdminKyThiChiTiet`; T31, T33; `admin-mock-live.tsx`, `admin-mock-reviews.tsx`, `void-sitting-dialog.tsx`, `lib/admin-mock-live-model.mjs`.
- Việc làm: PR 1: route `/admin/mock-tests/[examId]`, thẻ Đề, Thí sinh (nguồn, kỹ năng, "Đánh dấu cần thi bù", "Cho thi bù…"), Theo dõi (live: `ProctorBar`, bảng, dải cảnh báo ba loại, poll 5 giây, mất cập nhật → làm mờ + khoá điều khiển; tự làm: bảng người dự thi với bốn trạng thái Chưa bắt đầu · Đang làm · Đã nộp · Không dự thi (FR-09-151), người đang làm hiện phần đang chạy, giờ còn lại của phần và giờ dự kiến xong cả bài; "Nhắc" chỉ cho người chưa bắt đầu; "Cộng giờ…" chỉ bật với người đang làm; không có nút hay nhãn nào về nghỉ giữa phần, làm tiếp sau, mở lại phần), Nhật ký. PR 2: thẻ Chấm (bảng trạng thái theo phần; link sang Chấm bài › Writing/Speaking đã lọc theo kỳ; không nút trả), Phân tích, Trả kết quả (hộp hỏi lại, gõ tên kỳ thi, "Xem như thí sinh thấy", "Sửa điểm sau khi trả…"), Vùng nguy hiểm (huỷ trước khi mở); 307 các trang mock cũ (5.1 #21, #65, #67, #68); gỡ ba route mock khỏi `EMBEDDABLE_SAME_ORIGIN_ROUTES` khi không còn nơi nhúng.
- Đầu ra: 2 PR. Nghiệm thu: staging với kỳ thi kiểm thử 3 thí sinh: mở phòng → bắt đầu phần → thu bài (hỏi lại) → bắt đầu phần sau; một thí sinh đứng yên quá ngưỡng (đặt ngưỡng 1 phút) hiện trong dải cảnh báo; trả kết quả chỉ ở thẻ Trả kết quả — `grep -rn "bulk-release" frontend/app frontend/lib` chỉ còn trong thẻ này; hàng chờ chấm và trang lớp không có nút trả kết quả thi thử. Kỳ tự làm kiểm thử hai phần (sau G08-T22): thí sinh A nộp phần 1 → thẻ Theo dõi vẫn ghi "Đang làm" với phần 2 và đồng hồ phần 2 đã chạy; không lúc nào hiện trạng thái chờ giữa hai phần; thí sinh B chưa vào khi khoảng mở đóng → "Không dự thi".
- Không làm: không đổi phòng thi của học viên; không viết lại logic `open/advance/collect`; không dựng điều khiển "cho nghỉ", "mở lại phần" cho kỳ tự làm.
- Vướng mắc → cách gỡ: `/admin/mock-pacing?sitting=` cần ánh xạ sang kỳ thi → gọi `GET /sittings/{id}/pacing` lấy `exam_id` nếu có; không có → về danh sách. Test `aver-admin-chrome.test.mjs` ghim mục "Duyệt bài thi" → không đổi `NAV_GROUPS` cũ; chỉ sổ đăng ký mới đổi.
- Ước lượng: 4 phiên · 4.

### G09-T35 — Ghi chú chăm sóc (migration 442) — MỚI
- Mục đích: FR-09-032; dòng "Cần liên hệ hôm nay".
- Việc làm: migration + rollback; `routers/admin_care_notes.py` (5.4); phần tử ảo từ `persona_notes`; `editable` = tác giả và trong `CARE_NOTE_EDIT_HOURS`; thẻ "Ghi chú chăm sóc" của hồ sơ (danh sách mới trước, biểu mẫu thêm, đánh dấu xong); `care_due_today` trong T06; cột phải thẻ Tổng quan "việc đã hẹn"; `latest_note` trong `LearnerSummary`.
- Đầu ra: 1 PR. Nghiệm thu: pytest (sửa sau hạn → 409, đánh dấu xong vẫn được; xoá mềm); staging: thêm ghi chú hẹn hôm nay cho học viên kiểm thử → Việc cần làm có 1 ở "Cần liên hệ hôm nay"; đánh dấu xong → về "Không có"; ghi chú không xuất hiện ở Nhật ký hệ thống.
- Không làm: không có kênh liên hệ, người liên hệ, phân công, vai trò "Chăm sóc"; không cho giáo viên đọc/ghi ghi chú ở gói này (Q16 phần b).
- Vướng mắc → cách gỡ: hồ sơ chỉ có `users` (chưa có `students`) → ghi theo `user_id`. Quy tắc sửa/xoá chưa chốt → giá trị cấu hình (Q16).
- Ước lượng: 2 phiên · 3.

### G09-T36 — Lô nhập và Câu cần kiểm: migration 449, 450, helper cho script, API đọc — MỚI
- Mục đích: FR-09-162, 163.
- Đầu vào: các script ở 2.6; `routers/admin_exam_content.py`; `routers/feedback.py`; mig 100, 121.
- Việc làm: migration 449, 450; `backend/services/import_batch_log.py` (`start(script, skill, mode) -> batch`, `add_item(batch, kind, id, action)`, `finish(batch, counts, error_report_path)`; lỗi ghi lô **không** làm hỏng lần nhập — bọc try/except, in cảnh báo); nối helper vào các script: `import_listening_content_package.py`, `import_skill_drills.py`, `import_listening_lessons.py`, `upload_listening_source_audio.py`, `import_cambridge_canonical_qa.py`, `import_writing_prompts.py`, `migrate_writing_images.py`, `import_speaking_bank_admin.py`, `import_speaking_lesson_sets.py`, `pregen_speaking_question_audio.py`, `import_reading_drills.py`, `reimport_wp5_reading.py`, `seed_vocab_curated.py`, `import_advanced_vocab_core30.py`, `pregen_vocab_audio.py`, `import_course_exercise_bank.py`, `import_course_assessment_bank.py`, `import_grammar_banks.py`, `reimport_grammar_banks.py` (mỗi script: gọi `start` đầu `main`, `finish` cuối; không đổi logic nhập); bảng tên đọc được của script trong `services/import_batch_log.py`; API `content/batches*`, `content/review*` (5.4); cờ `content_import_batches`.
- Đầu ra: 1 PR backend (tách 2 nếu quá 800 dòng: lõi + nối script).
- Nghiệm thu: pytest: chạy `import_skill_drills.py` chế độ chạy thử trên DB thử → một dòng lô `mode='dry_run'`; ghi lô lỗi (giả lập) → script vẫn thoát mã 0; `GET /admin/content/review` gộp một câu có hai lý do thành một dòng.
- Không làm: không đổi trạng thái mặc định của mục do script tạo (tờ ghi "vào Chờ duyệt" — đó là thay đổi hành vi nhập, ghi vào Q22b, không tự làm); không chặn API nhập cũ; không đụng script của dây chuyền Hermes.
- Vướng mắc → cách gỡ: script chạy không có danh tính người dùng → `actor` = biến môi trường `IMPORT_ACTOR` hoặc tên máy; ghi rõ trên giao diện "không rõ" khi trống. Script không có chế độ chạy thử → `mode='import'`.
- Ước lượng: 3 phiên · 3.

### G09-T37 — Ba trang Nội dung bốn thẻ; ẩn nhập thủ công — MỚI (2 PR)
- Mục đích: FR-09-160…163, 013.
- Đầu vào: tờ `AdminNoiDung`, `AdminNoiDungVietNoi`, `AdminNoiDungTuVungNguPhap`; T36; các component trang nội dung hiện có (2.6).
- Việc làm: PR 1 (Listening, Reading, Writing, Speaking): `ContentSkillPage` với bốn thẻ; thẻ Đề và bài dùng lại bảng/danh sách hiện có (bỏ cột Phiên bản; thêm cột Lô nhập khi cờ bật; thao tác hàng loạt Đăng… / Gỡ… / Thêm vào bộ…); chi tiết đề giữ route hiện có, bỏ điều khiển tải audio/video và nút nhập hàng loạt, giữ sửa lẻ (đáp án chấp nhận thêm, lời giải, tiêu đề tiếng Anh, ảnh, đường dẫn video); nút "Giao bài này…". PR 2 (Từ vựng, Ngữ pháp): tương tự; `curated`, `d1-curation`, `exercises` → `?tab=items&status=pending`; ẩn form `POST /admin/vocabulary/import`, `POST /admin/quiz/import`; bỏ khối "Số liệu dùng · 30 ngày" (thay bằng link Báo cáo đã lọc). Cả hai: thẻ Lô nhập, Câu cần kiểm; 307 theo 5.1.
- Đầu ra: 2 PR. Nghiệm thu: preview: sáu trang có đúng bốn thẻ, tải lại giữ thẻ; không có `<input type="file">` cho nhập hàng loạt trên sáu trang (`grep -rn 'type="file"' frontend/components/admin/content` chỉ còn ảnh lẻ); `/admin/listening/import-fulltest` vẫn mở được bằng đường dẫn, có dải cảnh báo; Writing còn "Tạo đề lẻ", "Tạo mẹo lẻ"; Speaking còn "Tạo chủ đề lẻ"; OCR `/admin/writing/new` và Import CSV học viên vẫn chạy.
- Không làm: không viết lại editor; không dựng "tính lại điểm khi đăng bản đổi đáp án" (hộp đăng chỉ ghi "bài đã nộp giữ điểm theo bản cũ"); không xoá route/API nhập.
- Vướng mắc → cách gỡ: test cũ ghim chuỗi của trang nội dung → sửa cùng PR, liệt kê; > 30 test → dừng. Quyền "người có quyền duyệt" chưa có khái niệm riêng → admin = có quyền duyệt; ghi trong PR.
- Ước lượng: 4 phiên · 3.

### G09-T38 — Chấm Speaking thi thử — MỚI
- Mục đích: FR-09-060, 065, 067, 069; số "Speaking" trên sidebar.
- Đầu vào: tờ `AdminChamSpeakingThiThu`; `admin_mock_exams.py` (`record-speaking` 840, `bulk-final-bands` 738, `roster` 539); `services/mock_review_workflow.py`.
- Việc làm: `GET /admin/speaking/mock-queue` (5.4): bài "chờ chấm" = sitting có kỹ năng Speaking, đã có bản ghi (`speaking.count > 0` / `completed_at`) và chưa có band Speaking cuối — người thực thi xác nhận tên trường trong roster (`grep -n "speaking" backend/services/mock_review_workflow.py | head -30`) và ghi vào PR; trang `/admin/speaking/grading` (hàng chờ, lọc Kỳ thi) + màn chấm (trình phát A–B, tốc độ 0.75/1/1.25, bốn tiêu chí, đề xuất của AI nếu dữ liệu có, lưu điểm vào kỳ thi qua API band hiện có); Ctrl Enter lưu và mở bài kế; không có nút trả; giáo viên chỉ thấy lớp mình.
- Đầu ra: 1 PR. Nghiệm thu: staging: bài Speaking luyện tập không có trong hàng chờ; chấm xong một bài → số trên sidebar và Việc cần làm giảm 1, thẻ Chấm của kỳ thi cập nhật; không có nút trả.
- Không làm: không gọi AI chấm mới; không dựng cờ "Quá ngắn"/"Không nghe được" nếu dữ liệu chưa có (ẩn cột); không dựng "đoạn mẫu chấm phát âm" (thuộc gói chấm).
- Vướng mắc → cách gỡ: bản ghi lưu ở Storage riêng tư → dùng URL ký của API hiện có, không mở bucket. Không có dữ liệu đề xuất AI → khối đề xuất ghi "chưa có đề xuất".
- Ước lượng: 2 phiên · 3.

### G09-T39 — Yêu cầu chấm lại — MỚI
- Mục đích: FR-09-062.
- Đầu vào: tờ `AdminChamLai`; `routers/admin_writing_regrade.py`; mig 084.
- Việc làm: danh sách (nguyên văn lý do, lớp/khoá, band hiện tại, "Đã chờ" theo `regrade_hours`); màn xử lý ba quyết định; "Giữ nguyên điểm" ≥ 40 ký tự; dòng "Không trừ lượt chấm AI của học viên" luôn hiện; đã trả lời là chỉ xem; ghi vào nhật ký hồ sơ (nguồn `log` của T04 đọc `essay_regrade_requests`).
- Đầu ra: 1 PR. Nghiệm thu: preview: từ chối thiếu giải thích không gửi được; yêu cầu đã trả lời không còn nút.
- Không làm: không dựng trạng thái "Đang xem", lọc năm lý do, chấm lại hàng loạt khi bảng chưa có cột tương ứng (kiểm theo lệnh ở 6.1; thiếu → ghi vào PR, ẩn phần đó). Sau khi G07-T21 merge (có `reason_code`): bật lọc Lý do và "Chấm lại bằng AI" hàng loạt cho `wrong_submission` trong PR nhỏ cùng nhiệm vụ; "Đang xem" cần cột khoá mềm — để sau, ghi vào mục 10.
- Vướng mắc → cách gỡ: người nhận theo "giáo viên lớp đó" cần T24; trước T24 mọi yêu cầu về admin. Thư trả lời học viên do backend hiện có gửi hay không: CHƯA KIỂM (`grep -n "email\|notify" backend/routers/admin_writing_regrade.py`); không có → chỉ thông báo trong ứng dụng qua GOI-11.
- Ước lượng: 2 phiên · 3.

### G09-T40 — Giáo viên (bảng, hồ sơ) và nối "Gửi thông báo" — MỚI
- Mục đích: FR-09-105…107.
- Đầu vào: tờ `AdminGiaoVienThongBao`; `routers/admin_instructors.py`; `admin-instructors.tsx`; T24; GOI-11 T13 (trang và API gửi).
- Việc làm: `/admin/instructors` thành bảng sắp xếp được (lớp phụ trách, số bài chờ, thời gian duyệt trung bình 30 ngày — dưới ngưỡng số bài thì để trống); `/admin/instructors/[id]` (cột và khối "Lớp phụ trách" = các lớp có `cohorts.instructor_id` là người này — mỗi lớp chỉ thuộc một giáo viên nên một lớp không bao giờ hiện ở hai hồ sơ); "Gỡ khỏi lớp" (gọi `PATCH /admin/cohorts/{id}` với `instructor_id: null`, hỏi lại nêu số bài chuyển về admin); "Đổi giáo viên của lớp…" (chọn một người thay thế, cùng route); không có "Thêm giáo viên vào lớp" khi lớp đã có giáo viên; lời mời theo cơ chế hiện có (kiểm theo lệnh ở 6.1). Trang `/admin/notifications`: G09 thêm nguồn "Danh sách đã chọn" (nhận danh sách từ Danh bạ, bảng lớp, Kết quả bài giao, Việc cần làm qua state điều hướng; hiện dòng nguồn; chỉ bớt người) vào trang của GOI-11 T13; gửi dùng `audience: {learners: [...]}` của GOI-11.
- Đầu ra: 1 PR. Nghiệm thu: staging: chọn 3 người ở Danh bạ → "Gửi nhắc đăng ký lại" → trang Gửi thông báo có đúng 3 người và dòng nguồn; bớt 1 người → hộp xác nhận nêu 2; danh sách trống → nút Gửi tắt; gỡ giáo viên kiểm thử A khỏi lớp 1 → lớp ghi "chưa có giáo viên", hồ sơ A không còn lớp đó; đổi giáo viên lớp 2 từ B sang A → lớp 2 chỉ hiện ở hồ sơ A.
- Không làm: không viết API gửi (GOI-11); không dựng "Nhóm theo điều kiện" nếu GOI-11 chưa có kiểu audience đó (ghi vào mục 7); không thu hồi quyền nhân sự ở đây (thuộc Bảo mật, gói sau).
- Vướng mắc → cách gỡ: GOI-11 T13 chưa merge → chỉ làm phần Giáo viên, mục sidebar "Gửi thông báo" `available:false`. Danh sách người nhận không đặt trong URL (dữ liệu cá nhân) → dùng state điều hướng/`sessionStorage`, mất khi tải lại thì hiện "Danh sách đã hết hạn, chọn lại từ Danh bạ".
- Ước lượng: 2 phiên · 3.

### G09-T41 — Báo cáo một trang bốn thẻ — MỚI
- Mục đích: FR-09-164.
- Đầu vào: tờ `AdminBaoCao`; API hiện có `GET /admin/analytics/foot-traffic`, `GET /admin/ai-usage?days=`, `GET /admin/usage/users`, `GET /admin/overview`; T06, T36.
- Việc làm: `/admin/reports` với `?tab=` và `?range=`; mỗi thẻ dựng các số và bảng tính được từ API hiện có, kèm link "Xem chi tiết" tới trang báo cáo cũ (loại `context` ở 5.1); thẻ Hoạt động: bảng theo lớp (số cần chú ý mở Danh bạ đã lọc); thẻ Chất lượng: ba số + link Câu cần kiểm; thiếu dữ liệu ghi "chưa có" kèm lý do; "Xuất CSV" cho thẻ đang mở từ dữ liệu đã tải.
- Đầu ra: 1 PR. Nghiệm thu: preview: bốn mục sidebar mở đúng thẻ; tải lại giữ thẻ và khoảng; không có "0/0"; lỗi một nguồn chỉ hỏng khối đó.
- Không làm: không viết API báo cáo mới; không vẽ lại các hình của trang cũ; không dựng khoảng ngày tuỳ chọn nếu API chưa nhận `from/to` (ẩn).
- Vướng mắc → cách gỡ: API cũ chỉ nhận `days` → `range` ánh xạ sang `days`. Bảng theo khoá cần G04 → ẩn cho tới khi có.
- Ước lượng: 2 phiên · 3.

### G09-T42 — Áp staging và nghiệm thu đầu-cuối — MỚI
- Mục đích: chứng minh 23 kịch bản mục 9 trên staging đã merge.
- Việc làm: áp migration 440–451 lên staging theo thứ tự (bước do người có quyền chạy; người thực thi chuẩn bị lệnh và kiểm sau); bật cờ từng phần; chạy từng kịch bản bằng tài khoản QA; ghi bằng chứng (bước bấm, ảnh chỉ có tài khoản `@staging-e2e.averlearning.com`); liệt kê kịch bản chưa chạy được và lý do (gói phụ thuộc chưa xong).
- Đầu ra: báo cáo theo mẫu mục 8 của quy ước chung. Nghiệm thu: mỗi kịch bản có trạng thái đạt / chưa đạt / chưa chạy được kèm bằng chứng.
- Không làm: không đụng production; không bật `ADMIN_FRAME_V2` ở production.
- Vướng mắc → cách gỡ: một migration lỗi trên staging → dừng ở đó, không chạy số sau; báo kèm đầu ra. Thiếu tài khoản giáo viên kiểm thử → xin anh Andy tạo, không tự tạo trên production.
- Ước lượng: 2 phiên · 3.

### G09-T43 — Cấp lượt cho lớp cũ: chuyển lớp chạy bằng mã cũ sang đo lượt (cần G04) — MỚI (18/11 chiều)
- Mục đích: FR-09-057, 058 (00 mục 2 điểm 23: lớp đang chạy bằng mã cũ CÓ chuyển sang đo lượt). Tách khỏi T29 vì T29 đã lớn và nhiệm vụ này chờ API mới của G04.
- Đầu vào: tờ `AdminLop` (trang Lớp; **chưa có tờ thiết kế riêng** cho hộp thao tác này — dựng từ hộp xác nhận của "Cấp thêm lượt" và thành phần modal/bảng của G03); T29 (trang Lớp, hộp "Cấp thêm lượt"); T06 (`classes_unmetered`); API G04 `GET /admin/credits/convert-class/preview`, `POST /admin/credits/convert-class`, cấu hình `legacy_class_initial_credits` (GOI-04 mục 5.9, 5.10 bản 18/11 chiều); `admin-access-gate.tsx` (step-up).
- Việc làm: 1) `LegacyClassCreditsDialog` (5.7) mở từ: dải thông báo đầu trang lớp, menu thao tác của trang lớp, hộp kết quả "Cấp thêm lượt" khi có người bị bỏ qua vì `no_class_entitlement`. Bốn bước trong một hộp: xem trước (bảng thành viên dùng mã cũ chưa có nơi nhận lượt; số người sẽ cấp; người bỏ qua kèm lý do) → nhập "Số lượt mỗi người" (điền sẵn số gợi ý G04 trả; trống thì bắt nhập; số nguyên dương; ghi đơn vị lượt như FR-09-053) → xác nhận (tên lớp, số người, số lượt mỗi người, câu "Sau khi cấp, bài của các bạn này bắt đầu được tính lượt") → kết quả. 2) Gửi `POST` kèm `request_key` sinh một lần cho mỗi lần mở hộp; lỗi mạng thì "Thử lại" dùng lại đúng khoá đó. 3) Danh sách lớp `/admin/classes`: nhãn "Chưa chuyển sang đo lượt · N người" và bộ lọc `?metering=legacy` (đích của dòng Việc cần làm, T18); trang lớp: dải thông báo có nút "Cấp lượt cho lớp cũ…", tự ẩn khi xem trước trả 0 người. 4) Sau khi cấp: làm mới bảng học viên của lớp và số đếm `classes_unmetered`. 5) Chỉ vai trò Quản trị thấy nút; khu giáo viên không có. 6) Test React: xem trước rỗng → "Lớp này đã đo lượt", không có nút cấp; ô số lượt trống hoặc 0 → nút xác nhận tắt; bấm xác nhận hai lần → một lời gọi; kết quả có người bị bỏ qua → liệt kê tên và lý do; step-up → mở dialog rồi gửi lại cùng `request_key`.
- Đầu ra: 1 PR.
- Nghiệm thu: staging (sau G04): lớp kiểm thử có 2 thành viên dùng mã cũ → danh sách lớp có nhãn "Chưa chuyển sang đo lượt · 2 người", Việc cần làm có 1 ở dòng "Lớp chưa chuyển sang đo lượt"; mở hộp → xem trước đúng 2 người → nhập 10 → xác nhận → kết quả "Đã cấp cho 2 người"; sổ lượt của mỗi người có dòng cộng 10; nhãn và dòng ở Việc cần làm biến mất; mở lại hộp → "Lớp này đã đo lượt"; Nhật ký lớp có một dòng; tài khoản giáo viên không thấy nút và gọi thẳng API nhận 403.
- Không làm: không viết API hay logic cấp lượt (G04); không tự quyết ai đủ điều kiện ở trình duyệt; không chuyển nhiều lớp một lần (mỗi lần một lớp, để người làm đọc được danh sách); không tự chạy khi lớp được tạo; không thu hồi lượt đã cấp ở hộp này (dùng "Điều chỉnh lượt").
- Vướng mắc → cách gỡ: G04 chưa merge API `convert-class` → dừng, làm nhiệm vụ khác; nhãn ở danh sách lớp và dòng Việc cần làm hiện "chưa có". Response của G04 khác tên trường với bảng "API G04 mà G09 gọi" (5.4) → theo GOI-04, sửa bảng 5.4 trong PR. `legacy_class_initial_credits` chưa đặt → ô để trống, không tự chọn số (Q32). Lớp có thành viên chưa có tài khoản → G04 trả trong danh sách bỏ qua; hộp ghi "chưa có tài khoản — cấp sau khi bạn ấy kích hoạt".
- Ước lượng: 2 phiên · 3.

### Bảng nhiệm vụ và ước lượng

| Mã | Tên | Trạng thái so với bản 16/11 | PR | Phiên | Độ khó |
|---|---|---|---|---|---|
| T01 | Spec ADMINIA-0074 | sửa | 1 | 1 | 2 |
| T02 | "Duyệt bài thi" hết lỗi thiếu tham số | giữ | 1 | 1 | 2 |
| T03 | API danh bạ + khối tóm tắt | sửa | 1 | 2 | 3 |
| T04 | API các thẻ hồ sơ | sửa | 1 | 3 | 4 |
| T05 | API tìm nhanh | sửa | 1 | 1 | 3 |
| T06 | API Việc cần làm | sửa | 1 | 2 | 3 |
| T07 | Nhóm sự cố (mig 451) | sửa | 1 | 2 | 3 |
| T08 | Khung + sổ đăng ký | sửa | 1 | 3 | 4 |
| T09 | Link vai trò | giữ | 1 | 1 | 2 |
| T10 | Danh bạ | sửa | 1 | 2 | 3 |
| T11a | Hồ sơ 5 thẻ | sửa | 1 | 3 | 3 |
| T11b | Vùng nguy hiểm | sửa | 1 | 2 | 4 |
| T12 | Mã kích hoạt (sổ tra cứu) | sửa | 1 | 1 | 2 |
| T13 | Khoá học + đơn đăng ký | sửa | 1 | 3 | 4 |
| T14 | Quyền luyện lại, thu hồi | sửa | 1 | 2 | 4 |
| T15 | Sổ lượt AI | sửa | 1 | 1 | 3 |
| T16 | Hộp thư sự cố | sửa | 1 | 2 | 3 |
| T17 | Chấm Writing | sửa | 1 | 3 | 4 |
| T18 | Việc cần làm, AI và mô hình, QA | sửa | 1 | 2 | 3 |
| T19 | Tìm nhanh | giữ | 1 | 1 | 3 |
| T20 | Khu giáo viên 5 mục | sửa | 1 | 3 | 3 |
| T21 | Ba spec bổ sung | mới | 3 | 3 | 2 |
| T22 | Mig 440 + API cài đặt/ngưỡng | mới | 1 | 1 | 3 |
| T23 | Trang Cài đặt | mới | 1 | 2 | 3 |
| T24 | Mig 441 + phạm vi giáo viên | mới | 1 | 2 | 4 |
| T25 | Nhóm đã lưu (mig 443) | mới | 1 | 1 | 2 |
| T26 | Thành phần giao bài dùng chung | mới | 1 | 2 | 3 |
| T27 | API Kết quả bài giao (mig 444) | mới | 1 | 3 | 4 |
| T28 | Trang Kết quả bài giao | mới | 1 | 3 | 3 |
| T29 | Trang Lớp | mới | 1 | 3 | 3 |
| T30 | Bảng công bố điểm | mới | 1 | 2 | 3 |
| T31 | Kỳ thi backend 1 (mig 445, 446) | mới | 2 | 3 | 5 |
| T32 | Danh sách + Tổ chức kỳ thi | mới | 1 | 3 | 3 |
| T33 | Kỳ thi backend 2 (mig 447, 448) | mới | 1 | 3 | 4 |
| T34 | Trang một kỳ thi 7 thẻ | mới | 2 | 4 | 4 |
| T35 | Ghi chú chăm sóc (mig 442) | mới | 1 | 2 | 3 |
| T36 | Lô nhập + Câu cần kiểm (mig 449, 450) | mới | 1 | 3 | 3 |
| T37 | Ba trang Nội dung | mới | 2 | 4 | 3 |
| T38 | Chấm Speaking thi thử | mới | 1 | 2 | 3 |
| T39 | Yêu cầu chấm lại | mới | 1 | 2 | 3 |
| T40 | Giáo viên + Gửi thông báo | mới | 1 | 2 | 3 |
| T41 | Báo cáo | mới | 1 | 2 | 3 |
| T42 | Áp staging, nghiệm thu | mới | 0 | 2 | 3 |
| T43 | Cấp lượt cho lớp cũ (18/11 chiều, cần G04) | mới | 1 | 2 | 3 |
| **Tổng** | | | **48** | **97** | |

Nhiệm vụ **ĐÃ BỎ** (không có mã riêng, là phần việc trong nhiệm vụ cũ):
- Trong T17 cũ: "đổi nhãn trang Giáo viên duyệt (`/admin/writing/instructor-queue`) và giữ làm mục sidebar" — ĐÃ BỎ: mục "Giáo viên duyệt" gộp vào Writing (AD-02).
- Trong T08 cũ: mục sidebar "Chấm bài › Thi thử" — ĐÃ BỎ: trùng "Thi thử › Kỳ thi" (AD-22).
- Trong T15 cũ: "số dư theo kỹ năng", modal chọn kỹ năng — ĐÃ BỎ: một kho chung (phân xử 11).
- Trong T12 cũ: dời nguyên biểu mẫu tạo mã sang trang Mã kích hoạt — ĐÃ BỎ: tạo mã ở trang Lớp.
- Trong T16 cũ: nút "Tạo lỗi test" ở Hộp thư sự cố — ĐÃ BỎ: dời sang Công cụ QA.
- Trong T11a cũ: tab "Chi phí AI", "Điểm và tiến độ" riêng — ĐÃ BỎ: gộp vào thẻ Khoá và quyền / Tổng quan theo tờ mới.

Giả định: G03, G04, G10, GOI-11 phần A và E xong phần liên quan khi tới nhiệm vụ cần chúng; mỗi PR qua review ≤ 2 vòng; không tính thời gian chờ duyệt. Tăng so với bản 16/11 (21 PR / 34 phiên) vì thêm 23 nhiệm vụ (T21–T43) và 12 migration. Bản 18/11 chiều: 43 mã nhiệm vụ, 44 dòng bảng (T11 tách a/b), không nhiệm vụ nào bị bỏ; T24, T31–T34 đổi nội dung theo điểm 23 nhưng giữ ước lượng (T24 bớt nhánh "bảng nhiều giáo viên", T31 thêm hàm `self_paced_timeline`).

Nhiệm vụ **ĐÃ BỎ ở bản 18/11 chiều** (phần việc trong nhiệm vụ, không có mã riêng):
- Trong T24: phương án "bảng `cohort_instructors` nhiều giáo viên một lớp" — ĐÃ BỎ: mỗi lớp một giáo viên (điểm 23).
- Trong T15, T13, T11a: hiển thị "chuyển 50% lượt" — ĐÃ BỎ: chuyển toàn bộ, có hạn riêng (điểm 23).
- Trong T31–T34: kỳ tự làm "mỗi phần tự bấm bắt đầu, nghỉ giữa các phần" — ĐÃ BỎ: các phần chạy liền (điểm 23).

## 7. Vướng mắc chung của gói và cách tháo gỡ

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

## 8. Ràng buộc riêng của gói

- **Tờ thiết kế là chuẩn** cho mọi màn của gói; mọi màn nay đã có tờ, trừ hộp "Cấp lượt cho lớp cũ" (T43) và các chỗ điểm 23 đổi mà tờ chưa vẽ lại (bốn trạng thái theo dõi kỳ tự làm; dòng lượt chuyển và hạn) — các chỗ này dựng từ thành phần có sẵn theo FR, ghi trong PR "chưa có tờ". Tờ nào còn chữ "chuyển 50%", "nghỉ giữa các phần", "nhiều giáo viên" thì FR của file này thắng. Khung, sidebar, khung giáo viên, bảng ngưỡng, thành phần giao bài, khối tóm tắt học viên, dữ liệu mẫu: theo `thiet-ke/CHUAN-ADMIN.md`; phần "Sửa đổi 17/11 chiều" thắng phần trên của chính file đó và thắng tờ nào còn sót chữ cũ. Bảng tờ → nhiệm vụ:

| Tờ | Nhiệm vụ |
|---|---|
| ThanhPhanKhungTrang2 (mục 7, 8, 10), CheDoToiCongKhaiAdmin | T08, T19, T20 |
| ThanhPhanDuLieu (bảng, modal, ngăn kéo, "Giao bài theo buổi", khối tóm tắt học viên) | T10, T26, T03 |
| AdminViecCanLam | T06, T18 |
| AdminDanhBa | T03, T10 |
| HoSoHocVien | T04, T11, T35 |
| AdminLop | T29, T14, T43 (hộp "Cấp lượt cho lớp cũ" chưa có tờ thiết kế riêng: dựng từ hộp xác nhận của "Cấp thêm lượt") |
| AdminKhaoSat, HocVienNoiGi | GOI-13 phần A dựng (Q34 đã đóng) (sửa 18/11 theo GOI-13); G09 chỉ có mục sidebar "Chưa mở" tới khi trang lên |
| Admin1024 | T17, T18, T29 (bản 1024px của ba trang) |
| AdminKetQuaBaiGiao | T27, T28 |
| KiemTraKhoaGiaoVien | T30 |
| AdminKhoaHoc, AdminDonDangKy | T13 |
| AdminLuotVaMa | T12, T15 |
| AdminChamWriting · AdminChamLai · AdminChamSpeakingThiThu | T17 · T39 · T38 |
| AdminKyThi · AdminKyThiChiTiet | T31, T32 · T33, T34 |
| AdminNoiDung, AdminNoiDungVietNoi, AdminNoiDungTuVungNguPhap | T36, T37 |
| AdminThuVienCongKhai | G06 (G09 chỉ có mục sidebar) |
| AdminBaoCao | T41 |
| AdminSuCo | T07, T16 |
| AdminHeThong | T18 (AI và mô hình, Công cụ QA); Bảo mật giữ `/admin/mfa` |
| AdminCaiDat | T22, T23 (thẻ Chấm thử: GOI-11 T16) |
| AdminGiaoVienThongBao | T40 (Gửi thông báo: GOI-11 T13) |
| GiaoVien | T20 |

- Quy tắc trong "Ghi chú cho lập trình" của các tờ Đợt 5 là **đề xuất của người thiết kế** trừ khi `00-QUY-UOC-CHUNG.md` mục 2 đã chốt. Chỗ đề xuất chưa chốt nằm ở mục 10 kèm mặc định tạm; người thực thi dùng mặc định tạm và làm thành cấu hình, không tự đổi.
- Bản 1024px: chỉ ba trang có tờ riêng (`Admin1024.dc.html`: Việc cần làm → T18, Chấm Writing → T17, Lớp → T29). Công cụ nội bộ của admin (Công cụ QA, các trang `context` cũ) dùng khuôn bảng có sẵn của G03, không có tờ riêng và không chờ tờ.
- Nhãn `[NGAY]`/`[THÊM]`, tên cột, tên API, mã kỳ thi dạng máy, mã ngộ nhận, UUID, slug, đường dẫn file, tên model **không** hiện trên giao diện.
- Câu chữ: "giáo viên" (không "giảng viên", "thầy"); "Đơn đăng ký", "Học phí"; ngày dd/mm/yyyy, giờ 24 giờ, múi giờ Việt Nam; USD 2 chữ số thập phân; không band khi thiếu dữ liệu; không "0/0"; ô không có việc ghi "Không có"/"chưa có".
- Sáng/tối: mọi màn mới chỉ dùng token `--av2-*` (GOI-03 mục 5.9), không màu hex trong component; kiểm cả hai chế độ ở 1280px.
- Quyền: mọi kiểm ở máy chủ; giáo viên qua `staff_scope` (mỗi lớp một giáo viên; không nơi nào khác tự so `cohorts.instructor_id`); không gọi Supabase trực tiếp cho dữ liệu admin.
- Lượt chấm: G09 không tính số lượt chuyển, hạn của phần lượt chuyển, hay ai đủ điều kiện nhận lượt; mọi số lấy từ G04. Giao diện không ghi cứng "50%", "100%", "60 ngày", "45 ngày" — đọc từ cấu hình hoặc response.
- Kỳ tự làm: không màn admin nào có điều khiển hay nhãn cho "nghỉ giữa các phần", "làm tiếp sau", "mở lại phần". Admin và giáo viên không bị giới hạn một phiên; admin vẫn AAL2.
- Trả kết quả thi thử: không nút nào ngoài thẻ "Trả kết quả" của trang kỳ thi gọi API trả.
- Ngưỡng: không hằng số ngưỡng trong mã giao diện hay backend ngoài `services/ops_thresholds.py` (giá trị mặc định) và migration 440.
- Trang nhập thủ công: chỉ ẩn khỏi sidebar và thêm dải cảnh báo; không xoá route, không chặn API (đường lui).
- Mọi chuyển hướng admin trong gói là 307. Không đổi URL công khai. Không đổi cascade CSS trong `components/authed-shell.tsx`.
- Không đụng script và dữ liệu của dây chuyền Hermes ngoài việc gọi helper ghi lô (T36); nếu một script thuộc Hermes, bỏ qua và ghi trong PR.

## 9. Kiểm thử và bằng chứng hoàn tất của cả gói

Môi trường: preview Vercel của nhánh + backend staging. Tài khoản: QA admin có TOTP; hai tài khoản giáo viên kiểm thử (A dạy lớp kiểm thử 1, B dạy lớp kiểm thử 2); ba học viên kiểm thử `@staging-e2e.averlearning.com` (một có tài khoản + hồ sơ ở lớp 1, một chỉ có hồ sơ, một ở lớp 2). Dữ liệu: một bài giao Course 1 chấm máy có bài nộp, một đề giữa kỳ chế độ "giáo viên công bố", một kỳ thi kiểm thử live và một kỳ tự làm hai phần, một đơn kiểm thử và một đơn đăng ký lại (sau G04), một lớp kiểm thử có thành viên dùng mã cũ không kèm lượt. Không dùng production cho bất kỳ bước nào; không chép dữ liệu học viên thật.

1. Given admin AAL2, When mở mọi route loại `nav` ở 5.1, Then đúng một mục sidebar được tô, sidebar đúng 8 nhóm theo bảng chuẩn, không có "Giáo viên duyệt", không có mục nhập/tải lên, nhãn "Staging · dữ liệu thử" hiện cả ở 390px.
2. Given admin, When mở `/admin/listening/import-drills` bằng đường dẫn, Then trang còn sống, có dải "Trang nhập thủ công đã ẩn…" và nút "Vẫn mở"; sidebar không có mục này.
3. Given admin đổi chế độ hiển thị sang Tối, When tải lại, Then khung và các màn mới ở nền tối, chữ đạt tương phản; chọn "Theo thiết bị" thì theo hệ điều hành.
4. Given admin, When mở `/admin/learners`, tìm email học viên kiểm thử, bấm tên, Then tới `/admin/learners/u-…`; dán link sang tab mới vẫn đúng hồ sơ và thẻ.
5. Given hồ sơ chỉ có `students`, When mở `s-…`, Then đầu trang ghi "Chưa có tài khoản", không lỗi trang, không band.
6. Given học viên kiểm thử có mục tiêu khác nhau ở hai nguồn, When bấm "Dùng giá trị này" ở nguồn admin và xác nhận, Then cả hai nguồn bằng nhau và Nhật ký hệ thống có một dòng.
7. Given admin thêm ghi chú chăm sóc có ngày hẹn hôm nay, When mở `/admin`, Then "Cần liên hệ hôm nay" là 1; When đánh dấu xong, Then dòng ghi "Không có".
8. Given ngưỡng "Bài Writing chờ giáo viên duyệt" = 48, When admin đổi thành 1 ở Cài đặt › Ngưỡng vận hành và lưu, Then bài kiểm thử đã chờ 2 giờ hiện "quá hạn" ở hàng chờ Writing và ở Việc cần làm; nhật ký cài đặt có dòng cũ → mới.
9. Given một nguồn của Việc cần làm lỗi (giả lập), When mở `/admin`, Then chỉ dòng đó thành cảnh báo với "chưa có" và nút tải lại; các dòng khác có số; không dòng nào hiện 0 thay cho lỗi.
10. Given bài giao Course 1 có bài nộp, When mở "Kết quả một bài giao", Then thấy 5 khối, một bộ 5 trạng thái, khối 3 liệt kê đủ mọi nhóm ngữ pháp của bank (không cắt 15), không có chữ "trục"; mở một nhóm thấy câu sai nhiều nhất và phương án sai phổ biến kèm lời giải thích.
11. Given bài giao chưa ai nộp, When mở trang kết quả, Then chỉ có khối 1, không vẽ điểm.
12. Given giáo viên A, When giao bài bằng thành phần giao bài cho "Chọn tay" 2 học viên lớp 1 rồi giao lại cùng bài, Then lần một tạo đúng 2 mục; lần hai hiện cảnh báo, không tạo bản thứ hai.
13. Given giáo viên A, When mở URL trang lớp hoặc kết quả bài giao của lớp 2, Then về trang cha kèm một dòng giải thích; gọi thẳng API → 404; tìm nhanh không ra học viên lớp 2. When admin đổi giáo viên của lớp 1 từ A sang B ở trang Lớp, Then trang lớp ghi B là giáo viên (đúng một người), A mất quyền với lớp 1 ở lần mở kế tiếp, B thấy lớp 1; trang lớp không có nút thêm giáo viên thứ hai.
14. Given đề giữa kỳ chế độ "giáo viên công bố" đã có bài nộp (sau GOI-11 E), When giáo viên chọn 1 học viên và công bố mức điểm, Then nút "cả lớp" tắt khi có dòng chọn; học viên đó thấy điểm, học viên khác chưa thấy; không có nút thu hồi.
15. Given admin tổ chức kỳ thi chỉ Listening + Reading với hai lớp + một học viên lẻ + một nhóm đã lưu, cách thi tự làm, When lưu nháp rồi lên lịch, Then danh sách người thi khử trùng, cột Nguồn đúng, kỳ ở trạng thái "Đang mở" khi tới khoảng mở; giao diện không có chữ "sequential"/"retake".
16. Given kỳ thi live kiểm thử đang diễn ra, When giám thị bấm "Thu bài và sang phần sau…", Then có hộp hỏi lại; sau khi thu, "Bắt đầu phần" mới bật; thí sinh đứng yên quá ngưỡng hiện trong dải cảnh báo.
17. Given kỳ thi đã chấm xong 2/3 thí sinh, When mở thẻ Trả kết quả và trả (gõ tên kỳ thi), Then chỉ 2 người nhận kết quả; hàng chờ Writing, hàng chờ Speaking, trang lớp, Việc cần làm đều không có nút trả kết quả thi thử.
18. Given bài Speaking luyện tập của lớp offline vừa nộp, When mở Chấm bài › Speaking, Then bài đó không có trong hàng chờ; số trên sidebar chỉ đếm Speaking thi thử chờ chấm.
19. Given đơn kiểm thử ở "Đã báo chuyển" (sau G04), When admin điền nhanh, kết quả "Khớp", xác nhận, Then hộp nêu năm việc; sau đó đơn "Đã xác nhận", hồ sơ có khoá hạn đúng, sổ lượt có dòng cộng theo khoá, tài khoản vào được Reading/Listening; bấm lần hai → "đã xác nhận", không cấp thêm. When yêu cầu bổ sung, Then bắt buộc lời nhắn và hạn.
20. Given admin tạo 3 mã cho lớp kiểm thử kèm 5 lượt (sau G04), When mở `/admin/activation-codes`, Then thấy 3 mã với cột lượt = 5; trang không có biểu mẫu tạo mã; When cấp thêm 2 lượt cho một học viên, Then sổ lượt người đó có dòng mới kèm lý do.
21. Given lớp kiểm thử có 2 thành viên dùng mã cũ chưa có nơi nhận lượt (sau G04), When admin mở `/admin`, Then dòng "Lớp chưa chuyển sang đo lượt" là 1 và danh sách lớp có nhãn "Chưa chuyển sang đo lượt · 2 người"; When admin mở "Cấp lượt cho lớp cũ…", xem trước, nhập 10, xác nhận, Then kết quả "Đã cấp cho 2 người", sổ lượt mỗi người có dòng cộng 10, nhãn và dòng ở Việc cần làm biến mất; bấm xác nhận lặp không cấp lần hai; tài khoản giáo viên không thấy nút.
22. Given kỳ thi kiểm thử cách thi "Làm trong khoảng thời gian" có Listening + Reading giao cho tài khoản A và B (sau G08-T22), When A bắt đầu và nộp Listening sớm, Then thẻ Theo dõi ghi A "Đang làm" ở Reading với đồng hồ Reading đã chạy, không có trạng thái chờ giữa hai phần và không có điều khiển cho nghỉ; When A đóng trình duyệt tới hết giờ Reading, Then A thành "Đã nộp"; When khoảng mở đóng mà B chưa bắt đầu, Then B là "Không dự thi" và không chặn việc trả kết quả cho A. Bước "Cách thi" lúc tổ chức không có ô "nghỉ giữa các phần".
23. Given học viên kiểm thử có khoá online sắp hết hạn, còn 3 lượt chưa dùng, và có đơn đăng ký lại cùng khoá ở "Đã báo chuyển" (sau G04), When admin mở trang đơn, Then thấy "Đơn đăng ký lại · sẽ chuyển 3 lượt chưa dùng, dùng tới <ngày>"; When xác nhận, Then sổ lượt có dòng chuyển 3 lượt (toàn bộ, không phải một nửa) kèm hạn, hồ sơ học viên hiện "3 lượt chuyển từ khoá trước, dùng tới <ngày>"; không màn nào có chữ "50%". Given học viên khác hết hạn khoá mà không đăng ký lại, Then hồ sơ ghi số lượt đã hết hiệu lực và ngày.

Ca biên phải có test tự động: gán giáo viên cho lớp bằng người không phải nhân sự → 422; lớp `instructor_id` NULL → giáo viên nào gọi cũng 404; `self_paced_timeline` không bao giờ trả trạng thái giữa hai phần sau khi đã bắt đầu; cộng giờ cho phần không chạy của kỳ tự làm → 409; `classes_unmetered` khi G04 chưa có → `unavailable`, không phải 0; G04 không trả lượt chuyển → dòng lượt chuyển ẩn; `ref` sai định dạng → 404; q tìm kiếm 1 ký tự → 422; nguồn tổng hợp lỗi → 200 + `sources_failed`; ngưỡng ngoài khoảng → 422; ngưỡng `null` → lý do tương ứng không bật; nhắc lần hai trong ngày → bỏ qua; nhóm sự cố có dòng mới khi xử lý → 409; xác nhận gõ sai chuỗi → nút không bật; step-up hết hạn → dialog rồi gửi lại; kỳ thi không có kỹ năng nào → 422; tên chế độ cũ gửi vào API admin được ánh xạ; ghi lô lỗi không làm hỏng script nhập.

Lệnh bắt buộc mỗi PR (theo tầng): `cd backend && python -m pytest tests/ -q`; `node --import ./frontend/tests/fixtures/legacy-html-retired/loader.mjs --test frontend/tests/*.test.mjs frontend/tests/*.test.js`; `npm --prefix frontend run test:react`; `cd frontend && npx tsc --noEmit && npx tsc --noEmit -p tsconfig.legacy.json && npm run build`; `node frontend/tooling/route-ownership-check.mjs`; `python backend/scripts/validate_specs.py`; `git diff --check`.

Gói chỉ được báo "xong" khi 23 kịch bản có bằng chứng trên staging (đã merge vào `staging`), không phải chỉ trên preview nhánh. Kịch bản phụ thuộc gói khác chưa xong ghi "chưa chạy được" kèm tên gói, không tính là đạt. Lên production và bật `ADMIN_FRAME_V2` ở production là bước riêng, chờ anh Andy.

## 10. Cần anh Andy quyết

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
