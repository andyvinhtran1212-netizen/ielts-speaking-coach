# GÓI 11 — Bổ sung theo quyết định 17/11/2026: thông báo, chấm thử, thư đơn đăng ký, chặn full test trên điện thoại, trả điểm bài kiểm tra của khoá, tên khoá, nhận diện

Lập 17/11/2026 từ bản sao chỉ đọc `staging @ 93c7085`. Mọi đường dẫn là đường dẫn trong repo `ielts-speaking-coach`. Gói này thực hiện các quyết định 11–16 ở `00-QUY-UOC-CHUNG.md` mục 2 và các tờ thiết kế thêm/sửa ngày 17/11. Từ ngày 18/11/2026 GOI-04, GOI-05, GOI-09 đã được viết lại theo các quyết định mới; mục 3.3 ghi điểm nào đã khớp và điểm nào còn chờ. Chỗ file này khác `00-QUY-UOC-CHUNG.md` mục 2: **00 thắng**.

**Khớp chéo ngày 18/11/2026:** (C) thư về đơn là bốn thư và do G04 gửi (migration 381/382) — G11-T07, G11-T18 ĐÃ BỎ, migration 472 không dùng; (E) giao diện bảng công bố thuộc G09-T30 — G11-T28 ĐÃ BỎ, gói này giữ backend; (B) lối vào chấm thử trên trang công khai thuộc G05-T21, loại người từng có khoá online bằng `entitlements.has_ever_had_online_course` của G04, tài khoản đăng nhập bằng mã email cũng được chấm thử, đơn vị Speaking là một bài Part 2, trần theo trả lời 17/11 đưa vào thân; (A) thêm nguồn "được cấp thêm lượt" từ sổ lượt, phạm vi giáo viên dùng `staff_scope` của G09-T24, thêm service nhắc cho nút "Gửi nhắc" của G09; (D) mini test không bị chặn, màn ngoài bài thi có dòng phụ tiếng Việt; (G) minh hoạ là sơ đồ câu chữ; mục 10 chỉ còn câu chưa có trả lời; ước lượng tính lại: 30 PR, 38 phiên (mục 1, bảng mục 6).

**Cập nhật 18/11/2026 chiều (00 mục 2 điểm 23):** (A) mỗi lớp chỉ có MỘT giáo viên — phạm vi gửi thông báo của giáo viên là các lớp có `cohorts.instructor_id` là mình (G09-T24, migration 441); mục 10 câu 6 không còn phụ thuộc Q18 của GOI-09 (đã đóng). Lượt chưa dùng: bỏ "chuyển 50%" — nguồn `credits_granted` bỏ qua thêm `carry_expire`; thư và thông báo "khoá sắp hết hạn" nói đúng quy tắc mới (đăng ký lại thì chuyển toàn bộ lượt chưa dùng, bảo lưu tối đa 60 ngày; không đăng ký lại thì lượt hết hiệu lực khi khoá hết hạn), số lấy từ cấu hình G04. Gửi thư: dùng Resend đã có trong repo qua `services/learner_email.py` của G04; câu còn mở về thư chỉ còn địa chỉ gửi và tên miền đã xác minh (GOI-04 Q9). Thư "khoá đã mở đăng ký" (`course_open_alert`) thuộc G04-T17 và G05-T22, không thuộc gói này. Người làm gói này là người thực thi (project Claude Code của repo). Số nhiệm vụ, PR, phiên không đổi (30 / 30 / khoảng 38).

## 1. Tóm tắt

**Mục tiêu (người dùng thấy gì).**
- (A) Học viên thấy chuông thông báo trên thanh điều hướng (máy tính, máy tính bảng, điện thoại): bài mới được giao, nhắc nhở của giáo viên, bài sắp đến hạn, bài đã có kết quả, kết quả bài kiểm tra của khoá đã công bố, khoá sắp hết hạn hoặc đã hết hạn (nút "Đăng ký lại"), đơn đăng ký đổi trạng thái. Cạnh chuông có thẻ cảnh báo "N quá hạn" đếm **tổng số bài đã quá hạn chưa nộp**, không phụ thuộc đã đọc. Giáo viên và admin gửi được thông báo cho lớp hoặc nhóm học viên.
- (B) Người có tài khoản miễn phí (đăng nhập bằng Google hoặc mã email 6 số), chưa từng có khoá online, được AI chấm thử Writing Task 1, Task 2 và Speaking Part 2 với các trần do admin đặt ở trang Cài đặt: hạn mức tổng mỗi người (theo email và IP), trần mỗi ngày mỗi người, trần chi phí mỗi ngày toàn web; có công tắc tạm dừng. Lối vào ở trang chủ và menu công khai do G05-T21 dựng.
- (C) Về đơn đăng ký, học viên nhận đúng bốn thư: đã tạo đơn, một thư nhắc trước hạn giữ đơn, đơn cần bổ sung hoặc chưa tìm thấy khoản chuyển, khoá đã mở. Huỷ, hết hạn, báo đã chuyển chỉ là thông báo trong ứng dụng. **Việc gửi bốn thư thuộc G04** (GOI-04 mục 5.11, 5.12; migration 381/382); gói này chỉ sinh thông báo trong ứng dụng từ sự kiện đơn (phần A).
- (D) Mở full test (full test từng kỹ năng, mock test được giao, kỳ thi xếp lịch) trên điện thoại (vùng nhìn hẹp hơn ngưỡng, mặc định 768px) thấy màn cảnh báo tiếng Anh kèm một dòng phụ tiếng Việt và không có lượt thi nào được tạo; tablet vẫn vào; **mini test và luyện từng phần vẫn làm được trên điện thoại**.
- (E) Bài kiểm tra giữa kỳ, cuối kỳ của khoá có hai chế độ trả điểm: "trả ngay" hoặc "giáo viên công bố"; ở chế độ công bố, máy chủ không trả điểm hay đáp án cho học viên trước khi giáo viên công bố; giáo viên công bố cho cả lớp, từng người, theo mức hiển thị, hoặc hẹn giờ; học viên nhận thông báo. Kết quả là số câu đúng, không phải band.
- (F) Sáu khoá online mang đúng tên đã chốt; nhãn khoá hết hạn là "Đăng ký lại" ở mọi nơi, lấy từ một nguồn.
- (G) Logo "Ấn ký", favicon, icon ứng dụng, manifest, ảnh chia sẻ liên kết mới; bộ 94 icon nét đơn thay emoji; bài Grammar Wiki hiển thị sơ đồ câu dựng từ khối Markdown có ngữ nghĩa. Minh hoạ của web là **sơ đồ câu chữ**, không dùng tranh khắc hay ảnh minh hoạ (00 mục 2 điểm 22).

**Lớp thay đổi và mã spec đề xuất.** Số spec trong `specs/` hiện lớn nhất là `0054`; `01-KE-HOACH-TONG.md` mục 6 đã cấp 0055–0078. Gói này đề xuất 0079–0084 (người thực thi kiểm lại ở G11-T01 bước 1 trước khi dùng):

| Phần | Mã spec | Thư mục | Lớp |
|---|---|---|---|
| A | `NOTIFY-0079` | `specs/0079-learner-notifications/` | high-risk (migration, RLS, gửi thư) |
| B | `TRIALCAP-0080` | `specs/0080-free-trial-caps-settings/` (sửa đổi FREETRIAL-0047) | high-risk (hành vi AI trả phí, migration) |
| C | không có spec riêng và **không còn nhiệm vụ ở gói này**: bốn thư đã nằm trong `COURSEACCESS-0055` (G04); câu chữ và bản HTML ở `ENROLL-0060` (G05-T14) | — | — |
| D | `PHONEGATE-0081` | `specs/0081-full-test-phone-gate/` | feature |
| E | `COURSETESTRELEASE-0082` | `specs/0082-course-test-result-release/` | high-risk (lưu kết quả, kết thúc bài, migration, RLS) |
| F | không spec | — | content |
| G1 | `BRANDMARK-0083` | `specs/0083-brand-mark-ank-ky/` | feature |
| G2 | không spec mới: sửa đổi `UIBASE-0056` (G03) phần bộ icon | trong thư mục G03 | feature |
| G3 | `GRAMMARFIG-0084` | `specs/0084-grammar-wiki-figures/` | feature |

**Dải số migration.** `backend/migrations/README.md` dòng 23 ghi "As of 2026-11-12 the highest is `380`". `01-KE-HOACH-TONG.md` mục 6 cấp 381–469 cho G04…G09 và để "dự phòng: 470 trở đi". Gói này lấy **470–479**: 470 (A), 471 (B), 472 **không dùng** (CHECK mẫu thư, RPC nhắc và bốn thư đơn đã nằm trong 381/382 của G04; số 472 để trống, không cấp lại cho việc khác trong gói), 473 (E lược đồ), 474 (E hàm công bố), 475 (E nộp trễ), 476 (E làm bù/làm lại; 475 và 476 hoãn cùng G11-T25, T26), 477–479 để dành cho gói. Anh Andy là người duy nhất vận hành repo; số lấy theo bảng ở `01-KE-HOACH-TONG.md` mục 6, người thực thi ghi số đã dùng vào sổ đăng ký trong repo, không tự nhảy số.

**Phụ thuộc và song song.**

| Phần | Phải xong trước | Chạy song song được với |
|---|---|---|
| A backend (T08–T10) | spec T01 duyệt | mọi gói; producer đơn và khoá hết hạn tự bỏ qua khi bảng G04 chưa có |
| A giao diện (T11) | G03 `LearnerShell` (G03-T1x), cờ `learner_v2` G07-T05 | G05, G06, G08 |
| A thư (T12), gửi của nhân sự (T13) | G04-T01 (`learner_email_outbox`, CHECK đã có ba mẫu của A), G04-T04 (dispatcher); G09-T08 (khung admin) và G09-T24 (`services/staff_scope.py`) cho T13 | — |
| B | FREETRIAL-0047 các task T001… (route `/api/trial/*`, migration 371); G04-T03 (`entitlements.has_ever_had_online_course`) cho điều kiện loại người từng có khoá online; G05-T18 (đăng nhập bằng mã email) để kiểm ca tài khoản mã email | A, D, E, F, G; lối vào trên trang công khai là G05-T21 |
| C | không còn nhiệm vụ (G04-T01, T02, T04 làm; G05-T14 hoàn thiện câu chữ) | — |
| D | không; phần nối phòng thi mới cần G08-T03 (khung `ExamRoom`) | mọi phần |
| E backend | spec T04 duyệt; nên sau SERVERCHECK-0046 (draft) nếu 0046 được làm trước | A, B, C, D, F, G |
| E giao diện (chỉ còn màn học viên, T27) | G03, G07-T15 (Lộ trình). Bảng công bố phía giáo viên: G09-T30, chạy sau T23 của gói này | — |
| F | G04-T05 (API admin sản phẩm khoá) cho phần dữ liệu | mọi phần |
| G1 logo, G3 sơ đồ | không | mọi phần; G3 xếp hàng sau các PR Grammar của G06-T1x đụng cùng file |
| G2 icon | thay G03-T03 (cùng phạm vi) | — |

**Ước lượng (giả định).** 36 mã nhiệm vụ (thêm T14a tối 18/11 theo rà soát chéo), trong đó 3 ĐÃ BỎ (T07, T18, T28) và 2 hoãn theo trả lời câu 16 (T25, T26). Còn hiệu lực đợt đầu: **31 nhiệm vụ = 32 PR, khoảng 42 phiên agent** (cộng lại từ bảng mục 6; bản 17/11 ghi tổng 46 phiên cho 35 nhiệm vụ nhưng cột Phiên cộng ra 45); nếu anh Andy mở lại T25, T26 thì thêm 2 PR và 3 phiên. Độ khó tổng 4/5: phần E là 5 vì động vào đường chấm, kết thúc bài có giờ và quyền đọc trực tiếp bảng đáp án; phần B là 5 ở migration vì sửa hàm giữ chỗ của 0047 có khoá đồng thời. Số phiên của T14, T15 lập trước khi có trả lời về trần theo task, theo IP và theo chi phí (mục 5.2.1) và **chưa được ước lượng lại**. Giả định: một phiên ≈ một nhiệm vụ kèm test; G03, G04 đã có các nhiệm vụ nêu ở bảng trên khi tới phần giao diện; không tính thời gian chờ duyệt và chờ merge. Đây là ước lượng sau khi đọc mã, chưa có số đo; ước lượng, không phải cam kết.

## 2. Hiện trạng trong repo (đã kiểm ở staging @ 93c7085)

| Thứ cần biết | File/đường dẫn thật | Ghi chú |
|---|---|---|
| Thông báo trong ứng dụng | không có bảng, route hay component nào (`grep -rn "notification" backend/migrations` chỉ ra cột `users.notification_email`) | Làm mới hoàn toàn. |
| Cột bật/tắt thư | `backend/migrations/013_extend_user_profile.sql` dòng 6 `users.notification_email BOOLEAN DEFAULT TRUE`; đọc/ghi ở `backend/routers/auth.py` dòng 80, 463, 1121, 1155; `PATCH /auth/profile` (dòng 1083) sau cờ `profile_update` | Là công tắc chung, không theo loại thư. Giữ làm công tắc tổng. |
| Bài được giao của học viên | `backend/routers/class_student.py`: `_visible_assignments` (dòng 493), `_visible_writing_gives` (dòng 439), `_decorate` (dòng 268) tính `is_late`, `is_missing = not submitted_at and due and due < now`; `is_assignment_open` (import dòng 44, dùng dòng 588); `GET /api/class/my-assignments` (658), `GET /api/class/me` (1066) | Bộ đếm quá hạn phải dùng đúng các hàm này, không viết truy vấn thứ hai. |
| Bảng bài giao | `backend/migrations/177_class_assignments.sql`: `class_assignments(cohort_id, lesson_id, skill, content_id, content_config jsonb, title, due_at, publish_at, status draft/published/archived)`; `class_assignment_items(assignment_id, student_id, state assigned/opened/submitted/graded, opened_at, submitted_at, score NUMERIC(3,1), UNIQUE(assignment_id, student_id))`; RLS chỉ policy admin (dòng 233–245), học viên đọc qua backend | "Trễ" và "bỏ bài" không lưu, suy từ mốc thời gian (comment dòng 262–270). `class_assignments.timed_started_at` (mig 272) khoá hạn khi bài có giờ đã bắt đầu. |
| Giao bài | `backend/routers/admin_class_assignments.py` (prefix `/admin/cohorts`, dòng 99): model tạo bài dòng 195–290 (`completion_mode: mastery|single_attempt`, `time_limit_minutes`, `student_ids` giao cho một nhóm, `pass_pct`…); kiểm Course dòng 930–1033 (đề `meta.assessment_kind == "final"` bắt buộc `single_attempt`; `single_attempt` chỉ cho bộ trắc nghiệm thuần; trùng bank trong lớp → 409); `POST /{cohort_id}/assignments` (2742), `PATCH …/{assignment_id}` chỉ đổi `status` (2995), `PATCH …/due` (3110), `GET …/tally` (1648) | `MAX_COURSE_TIME_LIMIT_MINUTES = 12 * 60` ở `backend/services/class_assignment_service.py` dòng 81 (khớp "1–720 phút" của tờ KiemTraKhoa). |
| Chấm bài kiểm tra của khoá | `backend/services/quiz_service.py` (7.373 dòng): `course_completion_mode` (363), `single_attempt_answers_sealed` (376), `_ensure_timed_course_session` (2058), `start_session` (2175), `log_progress` (3086) trả phản hồi từng câu qua `_course_attempt_feedback` (3233: `is_correct`, `answer`, `explain`, `why_wrong`), `end_session` (3349), `course_verdict` (5025), `reap_expired_course_assessments` (5596), `_course_review_gate` (5999), `course_answer_report` (6041), `_sealed_course_session_ids` (7209), `student_progress` (7263) | Chấm và trả **ngay** trong backend. Chỉ có "niêm phong đáp án tới khi nộp" của `single_attempt`; không có trạng thái "chờ công bố", không có bảng công bố. |
| Route học viên lộ kết quả | `backend/routers/quiz.py` (prefix `/api/quiz`): `GET /banks/{bank_id}` (136), `/banks/{bank_id}/course-timer` (154), `/banks/{bank_id}/course-resume` (168), `/progress` (93), `/mistakes` (107), `POST /sessions/{id}/progress` (349), `PATCH /sessions/{id}` (361), `GET /course/report` (321), `POST /course/verdict` (338); `backend/routers/class_student.py` trả `score`, `passed_at`, `course_action` trong `_decorate`; `backend/routers/kp.py` `/api/me/kp-mastery` (67), `/api/me/roadmap` (83) | Mọi đường này phải qua cổng công bố ở phần E. |
| Đọc thẳng bảng đáp án | `backend/migrations/119_quiz_progress.sql` dòng 40, 86: policy `quiz_sessions_select`, `quiz_attempts_select` (`auth.uid() = user_id`); `quiz_attempts.is_correct BOOLEAN NOT NULL` (dòng 60) | Học viên đọc được `is_correct` của mình qua Supabase REST, vượt mọi cổng backend. `specs/0046-quiz-server-check-key-release/spec.md` (status **draft**) FR-017 định thu quyền này. |
| Spec liên quan đã có | `specs/0043-course-assessment-lesson-report/` (approved: báo cáo theo buổi cho giáo viên, "Buổi yếu là dưới 60%"); `specs/0046-…` (draft: chấm ở máy chủ, đáp án bài một lượt mở sau hạn hoặc khi cả lớp nộp, FR-011, FR-017–FR-019); `specs/0047-free-trial-grading/` (approved 10/11, migration 371 đã cấp, chưa có mã) | E xây trên 0043 và 0046; B sửa đổi 0047. |
| Chấm thử 0047 | `specs/0047-free-trial-grading/spec.md` FR-001 (chỉ tài khoản chưa từng kích hoạt, cột mới `users.first_activated_at`), FR-003 (hạn mức theo env `TRIAL_SPEAKING_PER_DAY=5`, `TRIAL_WRITING_PER_DAY=1`, `TRIAL_SPEAKING_TOTAL=20`, `TRIAL_WRITING_TOTAL=5`; giữ chỗ nguyên tử, hoàn khi lỗi, `request_key`), FR-004 (trần USD riêng), FR-007–FR-010 (chống nhiều tài khoản); `plan.md` dòng 117–128 bảng `trial_accounts`, `trial_usage(status reserved/consumed/released/filtered, vn_day)`; `rollout.md` cờ `free_trial_enabled`, env `TRIAL_KILL_SWITCH` | Không có "trần mỗi ngày toàn web" tính theo số bài; các trần đang là env, không sửa được từ trang admin. |
| Cờ chạy thật | `backend/services/runtime_flags.py` (`is_enabled`, `set_flag`, `require_flag`), bảng `runtime_flags` (mig 155), `backend/routers/admin_flags.py` `GET /admin/runtime-flags` (34), `PATCH /admin/runtime-flags/{key}` (46) | Không có bảng cài đặt có giá trị số. |
| Thư cho học viên | chưa có; G04 định `learner_email_outbox` (G04 mục 5.2) và `services/learner_email.py`, cron `scripts/enrollment_sweep.py`; mẫu gửi hiện có `backend/services/owner_alerts.py`, cron `backend/railway.staff-security-sweep.json` (`*/5 * * * *`) | — |
| Phòng thi, điểm tạo lượt | Reading: `POST /api/reading/test/{test_id}/attempts` (`backend/routers/reading_student.py` dòng 1284), gọi từ `frontend/app/(authed-reading-player)/reading/exam/session/reading-exam-session.tsx` dòng 965–981; Mock: `POST /api/mock-exams/{code}/sittings` (`backend/routers/mock_exams.py` dòng 153); trang `(authed-full-test)`, `(authed-mock-exam)`, `(authed-exam)`, `(authed-listening-player)` | Chưa có kiểm độ rộng vùng nhìn nào. |
| Cấu hình chạy cho trình duyệt | `frontend/public/js/runtime-config.js`; `frontend/tooling/content-security-policy.mjs` dòng 5 dẫn xuất từ cùng nguồn | CHƯA KIỂM cách sinh file này: `grep -rn "runtime-config" frontend/tooling frontend/scripts frontend/package.json`. |
| Nhận diện | `frontend/public/favicon.svg` (trùng `frontend/favicon.svg`, `docs/brand/assets/favicon.svg`); `frontend/app/manifest.ts` (một icon SVG, `theme_color '#0f766e'`, `background_color '#f7f8f7'`); `frontend/app/layout.tsx` dòng 41–55 (`metadataBase`, `icons: { icon: '/favicon.svg' }`, `openGraph` không có ảnh); không có `opengraph-image.*` trong `frontend/app`; `docs/brand/social-assets/` 17 SVG | `frontend/tests/brand-favicon.test.mjs` ghim hình "Mũi lên" (`d="M25 72 L50 32 L75 72"`, chấm `#F59E0B`, màu `#0F766E`), ghim bản trùng byte với `docs/brand/assets/favicon.svg`, và ghim chuỗi `icons: { icon: '/favicon.svg' }` trong `layout.tsx`. |
| Icon | G03-T03 định dựng ~30 icon từ gói `lucide` nét 1,5; tờ `ThanhPhanNenTang` định bộ **94 icon tự vẽ** (lưới 24, nét 2, đầu nét tròn, dữ liệu path trong `iconGroups` của tờ) thay emoji và ký tự (›, ‹, ×, →…) | Hai nguồn khác nhau, xem 3.3. |
| Grammar Wiki | Nội dung `backend/content/<category>/<slug>.md`, nhóm `backend/content/_groups.yaml`; dựng HTML ở `backend/services/grammar_content.py` (`markdown.Markdown(extensions=["tables","fenced_code","toc","attr_list", strikethrough])` dòng 323) rồi `inject_learning_blocks` (dòng 334) từ `backend/services/grammar_learning_blocks.py`: khối khai trong frontmatter `learning_blocks`, đặt bằng `<!-- learning-block: id -->`, kiểu `check|visual|repair|transfer|takeaways`, `visual.variant ∈ decision-tree|timeline|sentence-xray|chart-map|flow`, mọi chuỗi được `escape`; 20 bài đang dùng; test `backend/tests/test_grammar_learning_blocks.py`; trang `frontend/app/(public-content)/grammar/[category]/[slug]/page-shell.tsx` chèn HTML bằng `dangerouslySetInnerHTML` | Renderer sơ đồ mới phải là kiểu khối mới trong cơ chế này, không thêm đường dựng HTML thứ hai. |
| Giáo viên | `backend/routers/admin.py::require_instructor` (dòng 112, `staff_guard.resolve_staff(need="instructor")`); `students.instructor_id` (mig 106) | Đã kiểm ở `c3bc71574` (18/11): repo chỉ có `students.instructor_id`; bảng `cohorts` chưa có cột giáo viên. Đã chốt (00 mục 2 điểm 23): mỗi lớp MỘT giáo viên, cột `cohorts.instructor_id` do G09-T24 thêm (migration 441); không có bảng nhiều giáo viên. |
| Tên khoá online, nhãn "Đăng ký lại" | Không có chuỗi tên khoá online hay "Đăng ký lại"/"Gia hạn" nào trong `frontend/app`, `frontend/lib`, `frontend/components` (đã grep) | Tên chỉ tồn tại sau khi G04 có `course_products`. |

## 3. Phạm vi

### 3.1 Trong phạm vi
1. (A) Bảng thông báo, bảng khoá chống trùng sự kiện, bảng gửi của nhân sự, bảng tuỳ chọn thư; API học viên (danh sách, số chưa đọc, số quá hạn, đánh dấu đọc); job sinh thông báo từ dữ liệu nguồn; chuông, thẻ quá hạn, ngăn, trang `/notifications`; cài đặt nhận thư; phía gửi của giáo viên/admin.
2. (B) Bảng cấu hình trần chấm thử, nhật ký cài đặt, sửa hàm giữ chỗ của 0047 để thêm trần theo task, theo IP và trần chi phí toàn web, API trạng thái/cấu hình công khai, thẻ "Chấm thử miễn phí" của trang `/admin/settings`, các trạng thái phía người dùng trong các màn `/trial/*`. **Lối vào chấm thử ở trang chủ và menu công khai thuộc G05-T21.**
3. (C) **Không còn việc ở gói này.** Bốn mẫu thư đơn, bước nhắc trong sweep và việc không gửi thư ở các chuyển trạng thái khác đều do G04 làm (GOI-04 mục 5.11, 5.12; G04-T01, T02, T04); G05-T14 hoàn thiện câu chữ và bản HTML. Gói này chỉ đọc `enrollment_order_events` để sinh thông báo (phần A).
4. (D) Thư viện kiểm vùng nhìn, màn chặn tiếng Anh, nối vào mọi lối vào full test/thi thử (trang cũ và khung mới).
5. (E) Chế độ trả điểm, mức hiển thị, hẹn giờ, công bố cả lớp/từng người, máy trạng thái, cổng máy chủ trên mọi đường đọc của học viên, thu quyền đọc thẳng bảng đáp án nếu 0046 chưa làm, và màn học viên. Nộp trễ, vắng, làm bù/làm lại: hoãn (trả lời câu 16). **Giao diện bảng công bố phía giáo viên thuộc G09-T30**; gói này cấp API ở 5.5.8.
6. (F) Dữ liệu tên sáu khoá; một nguồn cho nhãn "Đăng ký lại".
7. (G) Component `Logo`, favicon, icon ứng dụng, manifest, ảnh OG theo route, tài nguyên social PNG; bộ 94 icon; kiểu khối sơ đồ trong Grammar Wiki và nội dung thí điểm.

### 3.2 Ngoài phạm vi
- Thông báo đẩy của hệ điều hành, ứng dụng điện thoại gốc, SMS, Zalo.
- Các loại thông báo "lượt chấm AI", "thi thử", "phản hồi", "bảo trì" ở tờ ThongBao: giữ chỗ trong CHECK, không viết nguồn sinh (gói sau, khi G04 lượt, G08 thi thử, G09 phản hồi và AdminCaiDat thẻ Thông báo hệ thống có dữ liệu).
- Các thẻ khác của `/admin/settings` (Thanh toán, Thư, Pháp lý, Tính năng, Thông báo hệ thống, Ngưỡng vận hành): thuộc G09-T22, T23. Gói này dựng thẻ Chấm thử trên cùng trang (G11-T16); bên vào sau rebase.
- Phần chống lạm dụng, trần USD, Turnstile, bộ lọc trước chấm của 0047: giữ nguyên, không làm lại.
- Phiếu kết quả Writing/Speaking (G07), phòng thi (G08), danh bạ và hồ sơ (G09).
- Bài kiểm tra của khoá online không có lớp (chưa có đường giao bài cho người đăng ký online; chờ G07 COURSELESSON).
- Thay emoji trong các trang cũ chưa được dựng lại (mục 10 câu 21).

### 3.3 Chỗ lệch với gói khác — trạng thái sau khi khớp chéo 18/11/2026

Đã khớp (thân các gói đã theo; không còn "gói này thắng"):

| Điểm | Nay nằm ở |
|---|---|
| Thư về đơn: bốn mẫu `order_created`, `order_pay_reminder`, `order_needs_info`, `order_confirmed`; các chuyển trạng thái khác chỉ ghi `enrollment_order_events` | GOI-04 mục 5.2 (CHECK của outbox, gồm cả ba mẫu của A), 5.11, 5.12; G04-T01, T02, T04. G05 không tạo bảng outbox (GOI-05 "Thay đổi so với bản 16/11") |
| Tên trạng thái và trường của đơn: `transfer_reported`, `needs_info`, `pay_by` | GOI-05 mục 5.2 theo GOI-04 mục 5.9 |
| Không gộp chấm thử vào sổ lượt; `entitlements.source` không có `trial` | GOI-04 mục 5.8 |
| Sidebar admin có "Cài đặt", "Gửi thông báo"; một kho lượt chung | GOI-09 mục 5.1, G09-T15, T22, T23, T40 |
| `LearnerShell` có chuông và thẻ quá hạn; `StaffTopBar` nhãn "Giáo viên" | GOI-03 (khớp chéo 18/11) |
| Bảng công bố điểm phía giáo viên | G09-T30 (G11-T28 ĐÃ BỎ) |
| Lối vào chấm thử trên trang chủ và menu công khai | G05-T21 (G11-T17 thu hẹp) |
| Trang Hôm nay, Lộ trình dùng cùng bộ đếm quá hạn; bài kiểm tra đọc khối `course_test` | GOI-07 (khớp chéo 18/11) |
| Full test dưới ngưỡng chỉ có màn chặn; mini test không chặn | GOI-08 (khớp chéo 18/11) |

Còn mở (ghi ở mục 10 hoặc chờ gói khác):

| Gói · mục | Điểm | Trạng thái |
|---|---|---|
| G03-T03 | ~30 icon `lucide` nét 1,5 so với bộ 94 icon của tờ ThanhPhanNenTang, nét 2 | G11-T32 thay G03-T03 (không đổi) |
| Tờ ThanhPhanKhungTrang mục 6 | đang thi mà xoay xuống dưới 768px: tờ ghi che bài; yêu cầu 17/11 ghi không chặn giữa bài | mặc định tạm: dải nhắc không che bài (mục 10 câu 12) |
| Tờ NhanDienLogo ghi chú cuối | "Hướng logo chờ chủ dự án chọn" | đã chốt Hướng 1 (00 mục 2 điểm 16); tờ chưa sửa chữ |
| G09 "Nhóm theo điều kiện" (GOI-09 mục 7) | G09 muốn audience theo điều kiện (chưa nộp một bài · quyền sắp hết hạn · không hoạt động) đọc ngưỡng từ `GET /admin/settings/thresholds` | Gói này chỉ có ba kiểu audience (`cohorts`, `learners`, `all`); G09-T40 đẩy danh sách đã lọc sẵn qua `learners`. Kiểu audience theo điều kiện: chưa làm, mục 10 câu 25 |

## 4. Yêu cầu (FR)

### A — Thông báo trong ứng dụng
- **FR-11-001** Mỗi thông báo thuộc đúng một người học, có `kind`, `severity` (`normal`|`warning`), đích (kiểu + id), thời điểm sự kiện cuối, số sự kiện gộp, `read_at`. Không lưu nội dung bài làm, số tiền, band; tiêu đề và câu chữ dựng ở máy chủ lúc đọc từ `kind` + tham số an toàn.
- **FR-11-002** Loại bắt buộc có nguồn sinh trong gói: `assignment_new`, `reminder`, `center_notice`, `due_soon`, `overdue`, `result_ready`, `course_test_released`, `enrollment_order`, `credits_granted` (được cấp thêm lượt — nguồn là sổ lượt của G04), `course_expiring`, `course_expired`; thêm 18/11 theo rà soát: `mock_assigned` (được giao kỳ thi hoặc kỳ được sửa khoảng mở), `mock_closing` (24 giờ trước giờ đóng, chưa thi), `mock_result` (mỗi lần giáo viên trả thêm phần), `credits_out` (sổ lượt về 0). Loại để dành (CHECK có, không nguồn sinh): `credits_low`, `feedback_reply`, `maintenance`.
- **FR-11-003** Một sự kiện nguồn sinh tối đa một lần thông báo (khoá chống trùng `dedupe_key` duy nhất toàn hệ thống); chạy lại job bao nhiêu lần cũng không sinh thêm.
- **FR-11-004** Gộp: sự kiện cùng `kind` + cùng `group_key` khi dòng cũ **chưa đọc** và `severity='normal'` → tăng `event_count`, cập nhật `last_event_at` và tham số, đưa lên đầu; cảnh báo không bao giờ gộp; dòng đã đọc không bị gộp thêm (sự kiện mới tạo dòng mới).
- **FR-11-005** Số trên chuông = số dòng chưa đọc (nhóm gộp tính một); 0 thì không hiện số; trên 9 hiện "9+" (máy chủ trả số thật, giao diện cắt).
- **FR-11-006** Số "quá hạn" = số bài được giao của người học đã qua hạn, chưa nộp, bài còn mở (chưa lưu trữ, lớp chưa lưu trữ), tính ở máy chủ mỗi lần đọc từ `_visible_assignments` + `_decorate(...)["is_missing"]`, **không** phụ thuộc thông báo hay đã đọc; bài kiểm tra một lượt đã đóng (vắng) không tính (mục 10 câu 5). 0 thì ẩn thẻ.
- **FR-11-007** Bấm một dòng: đánh dấu đã đọc rồi điều hướng tới đích; đích không còn → trang 404 sau đăng nhập có lối về Thông báo.
- **FR-11-008** "Đánh dấu đã đọc tất cả" áp cho mọi thông báo của người đó, idempotent, không hỏi lại.
- **FR-11-009** Học viên lớp offline (không có quyền khoá online) không nhận `course_expiring`, `course_expired`.
- **FR-11-010** Người chưa kích hoạt (đơn đang chờ, người dùng chấm thử) vẫn đọc được thông báo của mình (route miễn cổng kích hoạt, chỉ đọc/đánh dấu dữ liệu của chính họ).
- **FR-11-011** Thông báo giữ `NOTIFY_RETENTION_DAYS` (mặc định 90) tính từ `last_event_at` rồi bị xoá.
- **FR-11-012** Thư tắt được theo loại ở Hồ sơ: "Bài đã chấm xong" (`result_ready`, `course_test_released`) và "Khoá sắp hết hạn" (`course_expiring`; công tắc này cũng áp cho thư 8 "Khoá đã hết hạn" `course_expired`, thêm 18/11 theo rà soát); `users.notification_email=false` tắt mọi thư tuỳ chọn; thư bắt buộc (bốn thư đơn của G04, thư mã đăng nhập của G05) không đọc công tắc. Thông báo trong ứng dụng không có công tắc.
- **FR-11-013** Giáo viên/admin gửi thông báo `reminder` hoặc `center_notice` tới lớp, nhóm học viên chọn tay hoặc (chỉ admin) tất cả học viên; máy chủ tính số người nhận theo kênh trước khi gửi; gửi cho tất cả phải gõ đúng "gửi tất cả"; hẹn giờ huỷ được tới trước giờ gửi; giáo viên chỉ chọn được lớp/học viên của mình — máy chủ kiểm bằng `services/staff_scope.py` của G09-T24 (lớp của giáo viên = `cohorts.instructor_id`; mỗi lớp đúng một giáo viên — 00 mục 2 điểm 23, nên một lớp không bao giờ nằm trong phạm vi của hai giáo viên), không viết cách xác định phạm vi thứ hai.
- **FR-11-014** Gửi lặp cùng `request_key` không tạo lần gửi thứ hai.
- **FR-11-015** (khớp G09) Có một hàm service tạo thông báo `reminder` cho một bài giao và một danh sách học viên, gọi được từ route `POST /admin/cohorts/{c}/assignments/{a}/remind` của G09-T27 (nút "Gửi nhắc" ở G09-T26, T28, T29, T34); khoá chống trùng theo (bài giao, học viên, ngày giờ Việt Nam) nên nhắc lần hai trong ngày không sinh dòng mới.

### B — Chấm thử miễn phí
- **FR-11-020** Trần chấm thử là cấu hình, sửa ở trang Cài đặt, gồm ba lớp (00 mục 2 điểm 11): (1) **hạn mức tổng mỗi người** suốt chương trình, theo hạng mục `writing_task1`, `writing_task2`, `speaking_part2` — số đã chốt 5 / 5 / 10; tính theo **cả** email tài khoản **và** địa chỉ IP (bản băm), một lượt bị từ chối khi một trong hai đã chạm hạn mức; hạn mức theo IP = hạn mức mỗi người × `ip_quota_multiplier` (mặc định 1); (2) **trần mỗi ngày mỗi người** theo cùng ba hạng mục — số đã chốt 1 / 1 / 2, làm mới 00:00 giờ Việt Nam; (3) **trần mỗi ngày toàn web tính bằng chi phí chấm** — số đã chốt 5 USD mỗi ngày cho cả Writing và Speaking. Ràng buộc: số nguyên ≥ 0; trần ngày ≤ hạn mức tổng của cùng hạng mục; ngân sách ≥ 0. Đặt 0 ở trần của một hạng mục = đóng hạng mục đó; ngân sách 0 = đóng chấm thử.
- **FR-11-021** Một lượt Writing = một bài được nhận chấm (Task 1 và Task 2 đếm riêng). Một lượt Speaking = **một bài Part 2**; chấm thử Speaking chỉ nhận Part 2 (Part 1, Part 3 không có trong chấm thử). Chỉ dòng `trial_usage` ở trạng thái `reserved` hoặc `consumed` được đếm; `released` (lỗi hệ thống) và `filtered` (bài chưa đạt bước kiểm tra) không đếm lượt và trả lại phần chi phí ước tính đã giữ.
- **FR-11-022** Trạng thái của một người cho một hạng mục, theo thứ tự ưu tiên khi trùng: `paused` › `site_daily_exhausted` (ngân sách ngày đã chạm) › `user_total_exhausted` › `ip_total_exhausted` › `user_daily_exhausted` › `available`. Còn lại hôm nay = min(trần ngày − đã dùng hôm nay, hạn mức tổng − đã dùng tổng), không âm. Trạng thái `ip_total_exhausted` có màn riêng nêu lý do (nhiều người dùng chung một mạng) và lối liên hệ/xác minh (00 mục 2 điểm 22; cách xác minh ở mục 10 câu 26).
- **FR-11-023** Giữ chỗ là nguyên tử với mọi trần: N yêu cầu đồng thời khi ngân sách ngày chỉ còn đủ cho K lượt (K < N, tính theo chi phí ước tính tối đa của một lượt) cho đúng K giữ chỗ; không bao giờ vượt ngân sách ngày, trần người hay trần IP.
- **FR-11-024** Cấu hình đọc ở máy chủ **mỗi lần nộp** (không cache quá 15 s); đọc lỗi → từ chối `503 trial_unavailable`, không gọi provider (fail-closed).
- **FR-11-025** Công tắc "Tạm dừng chấm thử" là cờ `free_trial_enabled` của 0047; tạm dừng không trừ, không xoá, không hoàn lượt của ai; bài đã giữ chỗ trước khi tạm dừng được chấm xong.
- **FR-11-026** Đổi trần áp từ lần nộp kế tiếp; giảm hạn mức không thu hồi bài đã chấm.
- **FR-11-027** Trang công khai biết chấm thử đang mở hay không và số lượt mỗi ngày qua một API không cần đăng nhập, không lộ số người dùng hay số đã dùng của ai.
- **FR-11-028** Mọi lần lưu cấu hình hoặc bật/tắt tạm dừng ghi một dòng nhật ký chỉ ghi thêm: ai, lúc, thẻ, giá trị cũ → mới, lý do (≥ 10 ký tự). Chỉ admin có AAL2.
- **FR-11-029** Đường chấm của học viên có khoá hoặc lớp không đọc bảng cấu hình chấm thử và không bị trần chấm thử chặn (giữ 0047 FR-002).
- **FR-11-030** (khớp G04) Người từng có khoá online, kể cả đã hết hạn hoặc bị thu hồi, không được chấm thử: đường chấm thử gọi `entitlements.has_ever_had_online_course(user_id)` của G04 (GOI-04 mục 5.8, FR-04-042); hàm ném lỗi → từ chối 503 `trial_unavailable` (fail-closed). Chấm thử **không** ghi và không đọc `credit_ledger`; nếu đi chung hàm chấm với học viên thì truyền `trial=True` vào `credits.charge_plan`.
- **FR-11-031** (khớp G05, 00 mục 2 điểm 21) Tài khoản đăng nhập bằng mã 6 số gửi qua email được chấm thử như tài khoản Google: điều kiện provider của 0047 FR-001(d)/FR-007 nới từ "provider = `google`" thành "provider ∈ {`google`, `email`} và `email_confirmed_at` khác null" (mã đăng nhập đúng chính là bước xác minh email). Các lớp chống lạm dụng khác của 0047 (băm email chuẩn hoá, IP/thiết bị, Turnstile, admin chặn) giữ nguyên.
- **FR-11-032** Lối vào chấm thử ở trang chủ và menu công khai do G05-T21 dựng, đọc `GET /api/trial/public-config`; gói này dựng các màn `/trial/*` và trạng thái trong đó.

### C — Thư về đơn đăng ký (hành vi gửi thuộc G04; các FR dưới đây giữ số để dẫn chiếu)
- **FR-11-040** Học viên nhận đúng **bốn** thư cho một đơn: `order_created` (ngay khi tạo đơn), `order_pay_reminder` (tối đa một lần trước `pay_by`, chỉ khi đơn còn `awaiting_transfer`), `order_needs_info` (mỗi lần admin đánh dấu đơn cần bổ sung hoặc chưa tìm thấy khoản chuyển; có hạn bổ sung và lời nhắn của admin chép nguyên văn), `order_confirmed` (khi admin xác nhận, kể cả đơn hết hạn được mở lại vì khoản chuyển khớp mã). Không thư nào khác cho đơn. **Thực hiện: G04** (GOI-04 FR-04-039, mục 5.11, 5.12); gói này không viết mã cho FR này.
- **FR-11-041** Thư nhắc không gửi nếu lúc gửi đơn không còn `awaiting_transfer`, nếu `pay_by` đã qua, hoặc nếu đơn mới tạo chưa đủ tuổi tối thiểu. **Thực hiện: G04** (`fn_enrollment_order_pay_reminders`, migration 382).
- **FR-11-042** `transfer_reported`, `needs_info`, `expired`, `cancelled` và xác nhận đều sinh thông báo `enrollment_order` trong ứng dụng — **thực hiện ở gói này, phần A**, đọc `enrollment_order_events` của G04. Huỷ, hết hạn, báo đã chuyển không sinh thư.
- **FR-11-043** Bốn thư là thư bắt buộc (không đọc công tắc thư), câu chữ theo tờ EmailMau thư 4, 5, 14, 6, không có "mua", "bán", "giá", "đơn hàng", xưng "bạn". **Thực hiện: G04-T04 (bản `.txt`), G05-T14 (câu chữ và bản `.html`).**

### D — Full test trên điện thoại
- **FR-11-050** Khi mở bất kỳ lối vào nào của full test — full test từng kỹ năng (đề tự chọn), mock test được giao, kỳ thi xếp lịch; gồm phòng chờ, Before you begin, chuyển phần, tiếp tục bài dở — mà chiều rộng vùng nhìn < `fullTestMinViewportPx` (mặc định 768): hiện màn chặn tiếng Anh theo tờ ThanhPhanKhungTrang mục 6, kèm **một dòng phụ tiếng Việt** (FR-11-056), không gọi API tạo lượt/sitting, không chạy đồng hồ, không trừ lượt.
- **FR-11-051** Từ ngưỡng trở lên (tablet dọc 768px) vào được mọi phần của full test.
- **FR-11-052** Đang trong lượt thi đã bắt đầu mà vùng nhìn hẹp lại (xoay, thu cửa sổ): không kết thúc bài, không đẩy ra, không dừng đồng hồ; hiện dải nhắc tiếng Anh không che bài (mặc định tạm, mục 10 câu 12).
- **FR-11-053** **Mini test**, luyện từng phần (chế độ luyện, bài giao dạng luyện) và bài kiểm tra của khoá **không** bị chặn (00 mục 2 điểm 13; trả lời câu 11).
- **FR-11-054** Trên trang `/tests` (ThiThu) dưới ngưỡng không có nút vào full test; nút thay bằng dòng Cảnh báo; nút vào mini test vẫn có; mở thẳng đường dẫn phòng thi full test cũng về màn chặn.
- **FR-11-055** Máy chủ không dựa vào độ rộng do trình duyệt báo để cho/không cho; máy chủ bảo đảm mở trang không tạo lượt, tạo lượt chỉ qua lệnh bắt đầu tường minh, lệnh đó idempotent, và không giữ chỗ lượt AI lúc bắt đầu.
- **FR-11-056** Màn ngoài bài thi của full test — màn chặn điện thoại và màn lỗi thiết bị (micro, loa, trình duyệt không hỗ trợ) — có thêm một dòng phụ tiếng Việt dưới nội dung tiếng Anh, đánh dấu `lang="vi"` (00 mục 2 điểm 22). Đây là ngoại lệ có chủ đích của quy tắc "không trộn nhãn Việt–Anh" và chỉ áp cho màn **ngoài** bài thi; trong bài thi vẫn toàn tiếng Anh. Câu chữ dòng phụ: mục 10 câu 27.

### E — Trả điểm bài kiểm tra của khoá
- **FR-11-060** Chỉ bài giao `skill='course'` có `content_config.completion_mode='single_attempt'` mới có chế độ trả điểm. Cột `result_release_mode ∈ {immediate, teacher_release}`; NULL = mọi bài giao đã có trước gói này, hành xử đúng như `immediate`.
- **FR-11-061** Mức hiển thị: `score` (số câu đúng/tổng và tỉ lệ), `score_correctness` (thêm kết quả theo buổi và từng câu đúng/sai), `full` (thêm đáp án đúng, lời giải, phương án nhiễu). Không band ở mọi mức.
- **FR-11-062** Trạng thái một học viên với một bài, do máy chủ tính: `not_open` → `open` → `in_progress` → (`awaiting_release` chỉ ở chế độ công bố) → `released`; nhánh `absent` (đóng mà chưa bắt đầu); cờ `late_minutes` khi nộp sau hạn trong khoảng cho nộp trễ; làm bù/làm lại tạo lượt mới (bài giao mới nối `retake_of`). Bảng chuyển ở 5.5.3. Nhánh `absent`, `late_minutes` và lượt làm bù/làm lại thuộc phần hoãn.
- **FR-11-063** Ở chế độ `teacher_release`, trước khi bản ghi của học viên có mức công bố, **mọi** phản hồi máy chủ cho học viên đó không chứa: `score`, `correct`, `total` (số câu đúng), `pct`, `passed_at` có nghĩa điểm, `is_correct`, `answer`, `accept`, `explain`, `why_wrong`, `total_correct`, `total_wrong`, `accuracy`, kết quả theo buổi, lịch sử lượt có điểm, bằng chứng KP. Chỉ được trả: trạng thái, thời điểm nộp, số câu đã làm/bỏ trống, thời lượng, giờ công bố dự kiến.
- **FR-11-064** Ở mức `score` chỉ thêm `correct`, `total`, `pct`; ở `score_correctness` thêm `is_correct` từng câu và bảng theo buổi; ở `full` thêm đáp án và lời giải **nhưng** vẫn theo luật mở đáp án của bài một lượt (0046 FR-011: sau hạn hoặc khi cả lớp đã nộp) để học viên nộp trước không chuyển đáp án cho bạn chưa làm (mục 10 câu 14).
- **FR-11-065** Không có đường đọc thẳng nào bỏ qua cổng: học viên dùng JWT của mình gọi `GET /rest/v1/quiz_attempts` và `GET /rest/v1/quiz_sessions` nhận lỗi quyền hoặc rỗng.
- **FR-11-066** Công bố ghi theo từng học viên: thời điểm, người công bố, mức, nguồn (`manual_class`, `manual_learner`, `schedule`), nhận xét (tuỳ chọn). Mức chỉ nâng, không hạ, không thu hồi; công bố lặp cùng mức là no-op.
- **FR-11-067** Hẹn giờ là lệnh công bố cả lớp ở một mức: tới giờ, mọi bài **đã nộp lúc đó** mà chưa có mức ≥ mức hẹn được công bố; bài nộp sau giờ hẹn chờ công bố tay (mục 10 câu 15). Huỷ hoặc đổi hẹn được tới trước giờ.
- **FR-11-068** Mỗi lần công bố hoặc nâng mức cho một học viên sinh đúng một thông báo `course_test_released` (A) và, nếu học viên bật thư "Bài đã chấm xong", gộp vào thư tổng hợp.
- **FR-11-069** `result_release_mode` khoá sau bài nộp đầu tiên của bài giao: đổi sau đó → 409 `release_mode_locked`, không đổi gì (máy chủ và trigger CSDL).
- **FR-11-070** Chế độ `immediate`: nộp xong (hoặc hết giờ tự nộp) là `released` mức `full` như hôm nay; không ghi dòng công bố; luật mở đáp án 0046 vẫn áp nếu 0046 đã có.
- **FR-11-071** **HOÃN (00 điểm 15; câu 16 — làm cùng G11-T25/T26 khi anh mở):** Nộp trễ chỉ khi giáo viên đặt `late_until > due_at`; bắt đầu và nộp được tới `late_until`; với bài có giờ, mốc cắt = min(`opened_at` + giới hạn, `late_until`); bài mang `late_minutes = ceil((submitted_at − due_at)/1 phút)`.
- **FR-11-072** **HOÃN (00 điểm 15; câu 16 — làm cùng G11-T25/T26 khi anh mở):** Vắng: tới mốc đóng (`late_until` hoặc `due_at`) mà `opened_at` NULL → `absent`; không điểm, không ghi 0, không tính vào trung bình lớp.
- **FR-11-073** **HOÃN (00 điểm 15; câu 16 — làm cùng G11-T25/T26 khi anh mở):** Làm bù (cho người vắng) và làm lại (sau khi đã công bố) là bài giao mới cùng bank, giao cho đúng người được chọn, có `retake_of` trỏ bài gốc và hạn mới; kết quả tính lượt mới nhất, lượt cũ vẫn xem được.
- **FR-11-074** Bài giao trước gói này (NULL) và mọi bài `mastery` không đổi hành vi, không đổi số truy vấn ở đường chấm.
- **FR-11-075** Phía giáo viên (admin, giáo viên của lớp) luôn thấy điểm của mọi bài đã nộp, ở mọi chế độ.

### F — Tên khoá và nhãn
- **FR-11-100** Sáu sản phẩm khoá online có tên đúng 00 mục 2 điểm 2; tên hiển thị mọi nơi lấy từ dữ liệu khoá (`course_products.title`), không ghi cứng.
- **FR-11-101** Mọi nút hành động của khoá đã hết hạn ghi "Đăng ký lại", lấy từ một module nhãn dùng chung (frontend) và một hằng ở backend (thông báo), không chuỗi rời rạc.

### G — Nhận diện, icon, sơ đồ Grammar
- **FR-11-110** Một component `Logo` (variant `horizontal|stacked|mark`, tone `color|mono|reverse`) dùng cho khung mới; SVG viewBox 48, chỉ `rect` và `polygon`; nền navy/mực dùng `reverse`.
- **FR-11-111** `/favicon.svg` là biểu tượng Ấn ký; manifest có icon 192, 512, maskable 512; có `apple-touch-icon` 180; `theme_color`, `background_color` theo tờ NhanDienLogo mục 3d.
- **FR-11-112** Ảnh OG 1200×630 cho trang chủ, trang khoá, bài mẫu Writing, bài Grammar Wiki, đề Speaking, theo khuôn tờ NhanDienSocial mục 1; `og:title`, `og:description` giữ cách sinh hiện có.
- **FR-11-113** Bộ icon `Icon` gồm đúng các icon của tờ ThanhPhanNenTang (94), nét 2, `currentColor`; component mới không dùng emoji hay ký tự thay icon.
- **FR-11-114** Minh hoạ của web là **sơ đồ câu chữ**: người biên tập viết sơ đồ câu bằng khối có ngữ nghĩa trong bài Markdown; renderer dựng HTML (không ảnh, không tranh khắc, không hình vẽ trang trí), đánh số "Hình N", có `role="img"` và `aria-label` đọc thành câu, chữ ví dụ `lang="en"`; khối sai cấu trúc bị loại và ghi cảnh báo, bài vẫn hiện. Trang Grammar Wiki theo ba tờ GrammarWiki, GrammarWikiBai, GrammarWikiMinhHoa do G06 dựng; gói này cấp renderer và nội dung thí điểm.

## 5. Hợp đồng kỹ thuật

Quy ước chung: JSON, thời gian ISO 8601 UTC có `Z`; lỗi theo khuôn hiện có `{"detail": {"error_code": "...", "message": "<tiếng Việt, xưng bạn>"}}`; bảng mới RLS bật, không policy, `REVOKE ALL … FROM PUBLIC, anon, authenticated`; hàm mới `SECURITY DEFINER`, `SET search_path = pg_catalog, pg_temp`, ghi đủ `public.`, chỉ `service_role` EXECUTE (theo G04 mục 5.2 và `tests/test_client_write_invariant_postgres.py`). Route `/admin/*` mới gọi `await require_admin(authorization)` (hoặc `require_instructor`) là lệnh await đầu tiên (`tests/test_staff_guard_inventory.py`).

### 5.1 Phần A — Thông báo

#### 5.1.1 Migration 470 `backend/migrations/470_learner_notifications.sql`

**`notification_broadcasts`** (tạo trước vì bảng sau trỏ tới)

| Cột | Kiểu | Ràng buộc |
|---|---|---|
| id | uuid | PK default `gen_random_uuid()` |
| created_by | uuid | NOT NULL FK `users(id)` ON DELETE RESTRICT |
| created_role | text | NOT NULL CHECK IN (`admin`,`instructor`) |
| kind | text | NOT NULL CHECK IN (`reminder`,`center_notice`) |
| title | text | NOT NULL, `char_length` 1..120 |
| body | text | NOT NULL, 1..1000, văn bản thuần |
| audience | jsonb | NOT NULL; `{"type":"cohorts","ids":[uuid…]}` · `{"type":"learners","ids":[user_id…]}` · `{"type":"all"}`; CHECK `jsonb_typeof = 'object'` |
| channels | text[] | NOT NULL, CHECK `channels <@ ARRAY['in_app','email'] AND cardinality(channels) >= 1 AND 'in_app' = ANY(channels)` |
| scheduled_at | timestamptz | NULL = gửi ngay ở lượt sweep kế tiếp |
| status | text | NOT NULL DEFAULT `scheduled` CHECK IN (`scheduled`,`sending`,`sent`,`cancelled`,`failed`) |
| recipient_count, email_count | integer | NULL, ≥ 0 (ghi khi gửi xong) |
| request_key | text | NOT NULL 8..80; `UNIQUE (created_by, request_key)` |
| sent_at, cancelled_at | timestamptz | NULL |
| created_at | timestamptz | NOT NULL DEFAULT now() |

**`learner_notifications`**

| Cột | Kiểu | Ràng buộc |
|---|---|---|
| id | uuid | PK |
| user_id | uuid | NOT NULL FK `users(id)` ON DELETE CASCADE (thông báo là dữ liệu bỏ được) |
| kind | text | NOT NULL CHECK IN (`assignment_new`,`reminder`,`center_notice`,`due_soon`,`overdue`,`result_ready`,`course_test_released`,`enrollment_order`,`credits_granted`,`course_expiring`,`course_expired`,`credits_low`,`credits_out`,`mock_assigned`,`mock_closing`,`mock_result`,`feedback_reply`,`maintenance`,`survey_open`,`survey_reminder`) |
| severity | text | NOT NULL DEFAULT `normal` CHECK IN (`normal`,`warning`) |
| target | jsonb | NOT NULL; `{"type": "class_item"|"writing_give"|"essay"|"order"|"course"|"course_test"|"credits"|"broadcast"|"survey", "id": "<uuid hoặc mã đơn>"}` |
| params | jsonb | NOT NULL DEFAULT `'{}'`; CHECK object và `octet_length(params::text) <= 2000`; chỉ khoá trong danh sách cho phép ở 5.1.3 |
| group_key | text | NULL, ≤ 200 |
| event_count | integer | NOT NULL DEFAULT 1 CHECK ≥ 1 |
| last_event_at | timestamptz | NOT NULL DEFAULT now() |
| read_at | timestamptz | NULL |
| broadcast_id | uuid | NULL FK `notification_broadcasts(id)` ON DELETE SET NULL |
| created_at | timestamptz | NOT NULL DEFAULT now() |

Index: `(user_id, last_event_at DESC)`; `(user_id) WHERE read_at IS NULL`; `UNIQUE (user_id, kind, group_key) WHERE read_at IS NULL AND group_key IS NOT NULL AND severity = 'normal'` (chỗ dựa của gộp); `(last_event_at)` cho dọn.

**`notification_event_keys`** — chống trùng sự kiện, tách khỏi dòng thông báo vì một dòng gộp nhiều sự kiện: `dedupe_key text PK (≤ 200)`, `notification_id uuid NULL FK learner_notifications ON DELETE SET NULL`, `created_at timestamptz NOT NULL DEFAULT now()`.

**`notification_email_prefs`**: `user_id uuid PK FK users ON DELETE CASCADE`, `result_ready boolean NOT NULL DEFAULT true`, `course_expiring boolean NOT NULL DEFAULT true`, `staff_notice boolean NOT NULL DEFAULT true`, `updated_at timestamptz NOT NULL DEFAULT now()`. Không có dòng = mặc định.

**Hàm `fn_notify(p_user_id uuid, p_kind text, p_severity text, p_target jsonb, p_params jsonb, p_group_key text, p_dedupe_key text, p_broadcast_id uuid)` → jsonb** `{status: "created"|"grouped"|"duplicate", notification_id}`:
1. `INSERT INTO notification_event_keys(dedupe_key) VALUES (p_dedupe_key) ON CONFLICT DO NOTHING`; không chèn được → `duplicate`, dừng.
2. Nếu `p_group_key` không NULL và `p_severity='normal'`: `UPDATE learner_notifications SET event_count = event_count + 1, last_event_at = now(), params = p_params WHERE user_id=… AND kind=… AND group_key=… AND read_at IS NULL AND severity='normal' RETURNING id`; có dòng → `grouped`.
3. Không thì INSERT dòng mới → `created`. Ghi `notification_id` vào dòng khoá. Chèn trùng do đua ở bước 3 (unique partial) → bắt `unique_violation` rồi chạy lại bước 2 một lần.

**Hàm `fn_notify_batch(p_items jsonb)`** gọi `fn_notify` cho tối đa 500 phần tử (job dùng), trả `{created, grouped, duplicate}`.

**Hàm `fn_notifications_purge(p_days int)`**: xoá `learner_notifications` có `last_event_at < now() - p_days`; xoá `notification_event_keys` có `created_at < now() - (p_days + 30)`; trả số dòng.

Có file `backend/migrations/rollback/470_learner_notifications.sql` (DROP hàm, bảng; từ chối nếu `notification_broadcasts` có dòng `sent` trừ khi `SET aver.allow_notify_rollback='on'`), dòng `forward-policy.tsv` theo README, test PG17 `backend/tests/test_migration_470_learner_notifications.py`.

**Ghi chú (sửa 18/11 theo GOI-13):** hai `kind` `survey_open`, `survey_reminder` và `target.type = survey` (bảng 5.1.1), cùng bước `surveys` (5.1.3), do G13-A08 làm. Nếu G11-T08 (migration 470) đang mở PR thì thêm thẳng vào CHECK của 470; nếu migration 470 đã merge trước thì G13-A03 dùng migration 491 (`491_notification_kinds_survey.sql`) để thêm.

#### 5.1.2 API học viên — `backend/routers/notifications.py` (prefix `/api/notifications`)

Đăng ký trong `backend/main.py`; **thêm cả 5 route vào `ACTIVATION_EXEMPT_ROUTES`** (`backend/services/activation_gate.py`) với lý do "chỉ đọc/đánh dấu thông báo của chính người gọi" (FR-11-010), và cập nhật `tests/test_activation_gate_inventory.py`.

| Method · Path | Request | Response 200 | Lỗi |
|---|---|---|---|
| GET `/api/notifications` | `?kind=<kind>&cursor=<opaque>&limit=20` (limit 1..50) | `{"items":[Notification],"next_cursor":str|null}` | 401; 422 `invalid_kind` |
| GET `/api/notifications/summary` | — | `{"unread": int, "overdue": int, "latest": [Notification ×≤6]}` | 401; 503 `notifications_unavailable` (giao diện ẩn số, không báo lỗi) |
| POST `/api/notifications/{id}/read` | `{}` | `{"id","read_at"}` (idempotent; của người khác → 404) | 401; 404 `notification_not_found` |
| POST `/api/notifications/read-all` | `{}` | `{"updated": int}` | 401 |
| GET · PATCH `/api/me/notification-settings` | PATCH `{"result_ready"?:bool,"course_expiring"?:bool,"staff_notice"?:bool}` | `{"email_enabled": bool (users.notification_email), "result_ready", "course_expiring", "staff_notice"}` | 401 |

`Notification` = `{"id","kind","severity","title","body"|null,"action_label"|null,"target":{"type","id"},"event_count","last_event_at","read_at"|null}`. `title`, `body`, `action_label` dựng trong `backend/services/notification_copy.py` từ `kind` + `params` (tiếng Việt, xưng "bạn"; `course_expired` có `action_label = RENEW_LABEL` — 5.6). Không trả `params` thô.

Frontend dựng đường dẫn đích từ `target` bằng `frontend/lib/notification-target-model.mjs`, **dùng lại** bộ dựng href của `frontend/lib/my-class-model.mjs` cho `class_item`/`writing_give` (G07 mục 2 ghi `my-class-model.mjs` so đường dẫn bằng chuỗi tuyệt đối; không viết bộ dựng thứ hai). Đích khác: `essay` → trang kết quả Writing hiện có, `order` → `/enroll/<order_code>` (G05), `course` → `/courses/<slug>` (G05), `credits` → trang Tài khoản mục lịch sử lượt (G07), `course_test` → trang bài kiểm tra (E-T27), `broadcast` → `/notifications?open=<id>`.

#### 5.1.3 Nguồn sinh thông báo (job) — `backend/scripts/notification_sweep.py`

Chạy `python -m scripts.notification_sweep` mỗi 5 phút qua `backend/railway.notification-sweep.json` (chép khuôn `backend/railway.staff-security-sweep.json`; tạo service cron trên Railway là việc của anh Andy). Mỗi bước độc lập, lỗi một bước không chặn bước khác, ghi log `[notify] step=<s> created=<n> grouped=<n> duplicate=<n>` (không email, tên). Cờ `--dry-run`, `--step <tên>`. Mọi bước quét cửa sổ `NOTIFY_SWEEP_LOOKBACK_HOURS` (mặc định 48) và dựa vào `dedupe_key` để không trùng; không có bảng con trỏ.

| Bước | Nguồn (đọc bằng service role) | Người nhận | `kind` · `severity` | `dedupe_key` | `group_key` | `params` cho phép |
|---|---|---|---|---|---|---|
| `assignment_new` | `class_assignment_items` ⋈ `class_assignments` có `status='published'`, `coalesce(publish_at, created_at)` trong cửa sổ và ≤ now, lớp chưa lưu trữ; bài Writing từ bảng của `_visible_writing_gives` (CHƯA KIỂM tên bảng/cột: đọc `class_student.py` dòng 439–492) | `students.user_id` không NULL | `assignment_new` · normal | `asg:<assignment_id>:<user_id>:new` | `cohort:<cohort_id>:day:<YYYY-MM-DD giờ VN của publish>` | `assignment_title`, `cohort_name`, `due_at`, `count` |
| `due_soon` | item chưa nộp, `due_at ∈ (now, now + NOTIFY_DUE_SOON_HOURS]`, bài còn mở | như trên | `due_soon` · normal | `item:<item_id>:due_soon:<epoch(due_at)>` (dời hạn thì báo lại) | `due:<YYYY-MM-DD>` | `assignment_title`, `due_at`, `count` |
| `overdue` | item chưa nộp, `due_at ∈ [now − lookback, now)`, bài còn mở, không phải bài một lượt đã đóng | như trên | `overdue` · warning | `item:<item_id>:overdue:<epoch(due_at)>` | NULL | `assignment_title`, `due_at` |
| `result_ready` | `writing_essays` có `delivered_at` trong cửa sổ (G04 `ai_instant` và luồng duyệt đều ra `delivered`) | chủ bài | `result_ready` · normal | `essay:<id>:delivered` | `results:<YYYY-MM-DD>` | `task_label`, `count` |
| `course_test_released` | `course_result_releases` (E) `created_at` trong cửa sổ; bỏ qua nếu bảng chưa có | học viên của item | `course_test_released` · normal | `ctr:<release_id>` | NULL | `test_title`, `level` |
| `enrollment_order` | `enrollment_order_events` (G04, GOI-04 mục 5.12) trong cửa sổ, `to_status ∈ {transfer_reported, needs_info, confirmed, expired, cancelled}` (không sinh cho sự kiện `pay_reminder`, tạo đơn, bổ sung); bỏ qua nếu bảng chưa có | chủ đơn | `enrollment_order` · normal (`needs_info` là warning) | `orderev:<event_id>` | NULL | `order_code`, `product_title`, `to_status`, `reopened` |
| `credits_granted` | `credit_ledger` (G04, GOI-04 mục 5.3, 5.15) có `reason = 'grant_extra'` và thời điểm ghi trong cửa sổ; bỏ qua nếu bảng chưa có. Không sinh cho `grant`, `carry_over`, `carry_expire`, `reserve`, `release`, `admin_adjust`, `expire` (lượt chuyển khi đăng ký lại và lượt chuyển hết hạn bảo lưu hiện ở lịch sử lượt của Tài khoản, không có thông báo riêng ở đợt này — mục 10 câu 29) | chủ quyền (`entitlements.user_id`) | `credits_granted` · normal | `ledger:<ledger_id>` | NULL | `credits` (số lượt được cấp), `course_title` |
| `course_expiring` | `entitlements` (G04) `status='active'`, nguồn `enrollment_order`/`admin_grant`, sản phẩm `kind='online'`, `expires_at ∈ (now, now + NOTIFY_EXPIRING_DAYS]`, không có quyền khác cùng khoá hết hạn muộn hơn | người có quyền | `course_expiring` · warning | `ent:<id>:expiring:<epoch(expires_at)>` | NULL | `product_title`, `product_slug`, `expires_at` |
| `course_expired` | như trên, `expires_at ∈ [now − lookback, now]` | như trên | `course_expired` · warning | `ent:<id>:expired:<epoch(expires_at)>` | NULL | `product_title`, `product_slug` |
| `mock_exams` (thêm 18/11) | `mock_exam_audiences` và `mock_exam_events` (G09-T31, T33) trong cửa sổ: thêm người dự thi hoặc sửa khoảng mở → `mock_assigned`; kỳ còn mở, người chưa bắt đầu, giờ đóng trong 24 giờ tới → `mock_closing`; sự kiện trả kết quả → `mock_result`; bỏ qua nếu bảng chưa có | người dự thi | `mock_assigned` · normal; `mock_closing` · warning; `mock_result` · normal | `mock:<exam_id>:<user_id>:<loại>:<epoch(mốc)>` | NULL | `exam_title`, `closes_at` |
| `credits_out` (thêm 18/11) | `credit_ledger` (G04): số dư dùng được của một quyền về 0 sau dòng ghi trong cửa sổ; bỏ qua nếu bảng chưa có | người có quyền | `credits_out` · warning | `ent:<id>:credits_out:<id dòng sổ>` | NULL | `product_title`, `source` |
| `broadcasts` | `notification_broadcasts` `status='scheduled'` và `coalesce(scheduled_at, created_at) ≤ now` → `sending` (UPDATE … WHERE status='scheduled' để một job nhận) → giải người nhận → `fn_notify_batch` → thư (5.1.4) → `sent` + số đếm | theo `audience` | `reminder`/`center_notice` · normal | `bc:<broadcast_id>:<user_id>` | NULL | `broadcast_id` (tiêu đề đọc từ bảng gửi lúc hiển thị) |
| `surveys` | (G13-A08 thêm: mở/đóng khảo sát theo ngày, sinh `survey_open`, `survey_reminder`; log `[notify] step=surveys opened=<n> reminded=<n> closed=<n>`) | — | `survey_open`/`survey_reminder` | — | — | — |
| `course_release_schedule` | (E-T24 thêm) | — | — | — | — | — |
| `purge` | `fn_notifications_purge(NOTIFY_RETENTION_DAYS)` | — | — | — | — | — |

Không viết thông báo ở trong giao dịch chấm/giao bài/xác nhận đơn: các đường đó đang chạy thật và nhiều đường là RPC; job đọc dữ liệu nguồn nên không phải sửa chúng, trễ tối đa một chu kỳ 5 phút.

**Service nhắc dùng chung (FR-11-015)** — `backend/services/notification_service.py::send_assignment_reminder(assignment_id, student_user_ids, *, actor_id, vn_day) -> {"created": int, "duplicate": int}`: gọi `fn_notify_batch` với `kind='reminder'`, `target={"type":"class_item",…}`, `dedupe_key = 'remind:<assignment_id>:<user_id>:<YYYY-MM-DD giờ VN>'` (đúng khoá GOI-09 mục 5.4 ghi). Route `POST /admin/cohorts/{c}/assignments/{a}/remind` của G09-T27 gọi hàm này sau khi tự ghi `class_assignment_reminders`; hàm không kiểm quyền (bên gọi đã kiểm bằng `staff_scope`), không gửi thư, chạy ngay trong request (không chờ job). Cờ `notifications_enabled` tắt → trả `{"created": 0, "duplicate": 0}` và G09 hiện nút tắt kèm lý do. Thuộc G11-T09.

#### 5.1.4 Thư tuỳ chọn của A (bật bằng cờ `notification_emails`, mặc định tắt)
- `result_ready_digest`: gộp các `result_ready`/`course_test_released` của một người trong `NOTIFY_DIGEST_MINUTES` (mặc định 30) thành một thư; dedupe `digest:<user_id>:<window_start>`; chỉ khi `users.notification_email` và `notification_email_prefs.result_ready` đều đúng lúc gửi.
- `course_expiring`: câu về lượt trong thư và trong thông báo theo 00 mục 2 điểm 23 — "Đăng ký lại thì toàn bộ lượt chưa dùng được chuyển sang kỳ mới và dùng thêm được N ngày; không đăng ký lại thì lượt hết hiệu lực khi khoá hết hạn." (N = `CREDIT_CARRY_VALID_DAYS` của G04, không gõ cứng; tờ EmailMau thư 7, 8 còn ghi "50% số lượt": không dùng câu đó). Một thư cho mỗi thông báo `course_expiring`; dedupe `ent:<id>:expiring_mail:<epoch>`; không gửi khi người đó đang có đơn mở cùng khoá (tờ EmailMau ghi chú 3).
- `staff_notice`: thư của lần gửi nhân sự khi `channels` có `email` và người nhận bật `staff_notice`.
- Ghi vào `learner_email_outbox` của G04 (ba mẫu này đã có sẵn trong CHECK của migration 381; không cần migration 472), gửi bằng dispatcher của G04 (`services/learner_email.py`). Không có cờ thì không ghi outbox.

#### 5.1.5 Bộ đếm quá hạn — `backend/services/learner_overdue.py`
`count_overdue(user_id, *, now=None) -> int`: lấy mọi `students` có `user_id` (một người có thể có nhiều hồ sơ — CHƯA KIỂM: `grep -n "students" backend/routers/class_student.py | head -40`, xem hàm lấy hồ sơ hiện tại), lấy `cohort_ids` như `class_student` đang làm, gọi `_visible_assignments(student, now, cohort_ids)` và `_decorate(item, assignment, now)`; đếm `is_missing` đúng, loại bài `skill='course'` có `completion_mode='single_attempt'` đã qua mốc đóng (vắng). Dùng lại hàm qua import, **không** dời hay sửa hàm gốc (cùng cách G07 mục 5.3). G07 dùng hàm này cho nhãn "Đã quá hạn".

#### 5.1.6 Giao diện (khung mới)
- Component trong `frontend/components/notifications/`: `NotificationBell` (props `unread: number|null`, `onOpen`; `null` → không số; hiện "9+" khi > 9; `aria-label` "Thông báo, N chưa đọc"), `OverdueBadge` (`count`; "N quá hạn", viền và nền nhạt màu đánh dấu, có chữ "quá hạn"; bấm tới trang bài được giao — đường dẫn từ danh mục trang G07), `NotificationDrawer` (rộng 420px, neo dưới chuông, canh phải, tối đa 6 dòng mới nhất, Tab qua từng dòng, Esc đóng, "Xem tất cả" → `/notifications`; chỉ một trong ngăn và menu tài khoản mở một lúc), `NotificationList` (dùng cho trang).
- Hook `frontend/lib/notifications-client.ts`: gọi `/summary` khi tải trang và mỗi `NOTIFY_POLL_SECONDS` (runtime config, mặc định 60) khi `document.visibilityState === 'visible'`; dừng khi ẩn; không hộp bật lên.
- Điện thoại (< 768px): bấm chuông mở trang `/notifications`; có bài quá hạn thì thẻ "N quá hạn" thế chỗ ô "Lượt AI" (tờ ThanhPhanKhungTrang mục 3).
- Trang `/notifications`: nhóm route mới `frontend/app/(authed-notifications)/notifications/page.tsx` trong `AuthedShell design="v2"`, **không** dùng `activationGate` (FR-11-010); lọc bằng `?kind=`; dải cảnh báo tổng số quá hạn ở đầu khi > 0; trạng thái rỗng "Bạn chưa có thông báo nào." Đăng ký trang vào danh mục trang G03/G07 với trang cha `/home`. Thêm route vào `frontend/tests/route-auth-guard-inventory.test.mjs` theo cách test đó yêu cầu.

#### 5.1.7 Phía gửi của nhân sự — `backend/routers/admin_notifications.py` (prefix `/admin/notifications`)

| Method · Path | Auth | Request | Response | Lỗi |
|---|---|---|---|---|
| POST `/admin/notifications/broadcasts/preview` | `resolve_staff_scope` của G09-T24 (admin ⊃ giáo viên; lệnh `await` đầu tiên) | `{"audience":{…},"channels":[…]}` | `{"in_app": int, "email": int}` (trừ người không có tài khoản, đã tắt thư) | 403 `audience_forbidden` (giáo viên chọn `all`); 404 khi giáo viên chọn lớp/người không thuộc lớp mình (`scope.assert_cohort`, cùng quy ước FR-09-113: không lộ lớp tồn tại) |
| POST `/admin/notifications/broadcasts` | như trên | `{"kind","title","body","audience","channels","scheduled_at"|null,"request_key","confirm_text"|null}` | 201 `{"broadcast": Broadcast}`; replay → 200 | 403; 422 `confirm_required` (audience `all` mà `confirm_text != "gửi tất cả"`), `scheduled_in_past` |
| GET `/admin/notifications/broadcasts` | như trên (giáo viên chỉ thấy của mình) | `?cursor&limit` | `{"items":[Broadcast]}` | — |
| POST `/admin/notifications/broadcasts/{id}/cancel` | người tạo hoặc admin | `{}` | `{"broadcast"}` | 409 `already_sending` |

Phạm vi giáo viên: `services/staff_scope.py::resolve_staff_scope` (G09-T24, GOI-09 mục 5.4) — `cohort_ids = None` là admin; giáo viên chỉ chọn được lớp có `cohorts.instructor_id` là mình và học viên đang là thành viên active của các lớp đó; kênh thư và audience `all` chỉ admin. G09-T24 chưa merge → bản đầu chỉ admin gọi được, giáo viên ẩn nút. Audience `learners` nhận danh sách do G09-T40 đẩy sang (Danh bạ, bảng lớp, Kết quả bài giao, Việc cần làm). Trang ở route `/admin/notifications` (mục sidebar "Gửi thông báo" của G09).

Mỗi lần tạo/huỷ ghi nhật ký thao tác nhạy cảm theo cơ chế G09 dùng cho vùng nguy hiểm (CHƯA KIỂM tên bảng: `grep -rn "staff_security_audit\|class_action_log" backend/routers/admin*.py | head`). Giao diện: trang "Gửi thông báo" theo tờ AdminGiaoVienThongBao, trong khung admin G09 (`ADMIN_FRAME_V2`); hộp xác nhận nêu đúng số người nhận từ `/preview`.

#### 5.1.8 Cấu hình A

| Tên | Loại | Mặc định | Ý nghĩa |
|---|---|---|---|
| `notifications_enabled` | runtime flag (`default=False, on_error=False`) | tắt | Tắt: API trả `summary` rỗng, job chỉ chạy `purge` |
| `notification_emails` | runtime flag | tắt | Thư tuỳ chọn 5.1.4 |
| `NOTIFY_SWEEP_LOOKBACK_HOURS` | env int | 48 | Cửa sổ quét |
| `NOTIFY_DUE_SOON_HOURS` | env int | 24 (tạm, mục 10 câu 3) | "Sắp đến hạn" |
| `NOTIFY_EXPIRING_DAYS` | env int | 7 (tạm) | "Khoá sắp hết hạn" |
| `NOTIFY_RETENTION_DAYS` | env int | 90 (tạm, tờ ghi XXX) | Giữ thông báo |
| `NOTIFY_DIGEST_MINUTES` | env int | 30 (tạm) | Gộp thư kết quả |
| `notifyPollSeconds` | runtime config trình duyệt | 60 (tạm) | Chu kỳ hỏi `/summary` |

### 5.2 Phần B — Chấm thử miễn phí

#### 5.2.1 Migration 471 `backend/migrations/471_free_trial_caps.sql` (phụ thuộc 371 của 0047)

**Sửa theo trả lời ngày 17/11 (00 mục 2 điểm 11) — bảng dưới đây thay bản "một con số cho mỗi kỹ năng" của bản 17/11:**

**`free_trial_caps`**: `cap_key text PK CHECK IN ('writing_task1','writing_task2','speaking_part2')`, `per_user_total integer NOT NULL CHECK (per_user_total BETWEEN 0 AND 10000)`, `per_user_daily integer NOT NULL CHECK (per_user_daily BETWEEN 0 AND 1000)`, `CHECK (per_user_daily <= per_user_total)`, `updated_at timestamptz NOT NULL DEFAULT now()`, `updated_by uuid NULL FK users ON DELETE SET NULL`. Seed `INSERT … ON CONFLICT DO NOTHING` theo số đã chốt: `writing_task1 (5, 1)`, `writing_task2 (5, 1)`, `speaking_part2 (10, 2)`.

**`free_trial_site_config`** (một dòng, `id boolean PK DEFAULT true CHECK (id)`): `daily_budget_usd numeric(8,2) NOT NULL CHECK (daily_budget_usd BETWEEN 0 AND 10000)` — seed `5.00` (tên trong trả lời: `TRIAL_DAILY_BUDGET_USD`); `ip_quota_multiplier integer NOT NULL CHECK (ip_quota_multiplier BETWEEN 1 AND 1000)` — seed `1` (`TRIAL_IP_QUOTA_MULTIPLIER`); `max_cost_usd jsonb NOT NULL` — chi phí ước tính tối đa của một lượt theo `cap_key`, dùng để giữ chỗ ngân sách (giá trị seed lấy từ bảng đơn giá đang dùng cho `ai_usage_logger` — CHƯA KIỂM: `grep -rn "price\|cost" backend/services/ai_usage_logger.py | head`; không tìm được thì để cấu hình và ghi `CẦN ANH ANDY QUYẾT`); `updated_at`, `updated_by`.

**Cột thêm vào `trial_usage`** (bảng của 0047): `cap_key text NULL CHECK IN (ba giá trị trên)` (dòng cũ NULL), `est_cost_usd numeric(8,4) NULL` (giữ lúc `reserved` = chi phí tối đa; chốt lúc `consumed` = chi phí ước tính thật từ số token/giây âm thanh; `released`/`filtered` → 0), `ip_hash text NULL` (cùng bản băm HMAC có muối `TRIAL_HASH_SALT` mà 0047 dùng cho `trial_accounts.ip_hash`; **không lưu IP thô**; IP lấy từ header do hạ tầng tin cậy đặt, không tin header client gửi; xoá theo lịch 90 ngày của 0047; ghi vào chính sách quyền riêng tư — G05-T06).

**`admin_settings_log` — KHÔNG tạo ở 471.** Bảng nhật ký cài đặt đã do **migration 440 của G09-T22** tạo (`admin_settings_log(id, key, old_value jsonb, new_value jsonb, reason text, actor_id uuid, created_at)`, chỉ ghi thêm). Bản 17/11 của file này định tạo một bảng cùng tên với lược đồ khác (`tab`, `change`): bỏ, để không có hai định nghĩa. Thẻ Chấm thử ghi vào bảng của 440 với `key` dạng `trial.caps.<cap_key>`, `trial.site.daily_budget_usd`, `trial.site.ip_quota_multiplier`, `trial.paused`; mỗi khoá đổi một dòng; `reason` 10..500 ký tự kiểm ở backend; không bao giờ ghi giá trị bí mật. 471 phụ thuộc 440: G09-T22 phải merge trước G11-T14 (440 chưa có → dừng, không tự tạo bảng).

**Index đếm**: `trial_usage_site_day ON trial_usage (vn_day) WHERE status IN ('reserved','consumed')`; `trial_usage_user_cap ON trial_usage (user_id, cap_key) WHERE status IN ('reserved','consumed')`; `trial_usage_ip_cap ON trial_usage (ip_hash, cap_key) WHERE status IN ('reserved','consumed') AND ip_hash IS NOT NULL`.

**Sửa `fn_trial_reserve`** (định nghĩa gốc ở 371 theo `specs/0047-free-trial-grading/plan.md` dòng 319–330). Hai đường:
- (a) 371 **chưa** viết: đưa thay đổi dưới đây thẳng vào 371 qua amendment 0047 (G11-T02), 471 chỉ còn bảng, index và seed.
- (b) 371 đã merge: 471 `CREATE OR REPLACE FUNCTION public.fn_trial_reserve(...)` giữ nguyên chữ ký và mọi bước chống lạm dụng; chỉ thay phần kiểm lượt.

Phần kiểm lượt mới, trong cùng giao dịch với bước giữ chỗ (hàm nhận thêm `p_cap_key`, `p_ip_hash`):
1. `PERFORM pg_advisory_xact_lock(hashtextextended('aver.trial.site:' || v_vn_day::text, 0));` rồi `PERFORM pg_advisory_xact_lock(hashtextextended('aver.trial.user:' || p_user_id::text, 0));` — luôn đúng thứ tự site → user để không khoá chéo.
2. Đọc `free_trial_caps WHERE cap_key = p_cap_key` và dòng `free_trial_site_config` (thiếu một trong hai → `{"granted": false, "reason": "config_missing"}`, backend đổi thành 503).
3. Tính `site_spent` = tổng `est_cost_usd` của mọi dòng `reserved|consumed` trong `vn_day` (cả Writing và Speaking); `user_today`, `user_total` theo (`user_id`, `cap_key`); `ip_total` theo (`ip_hash`, `cap_key`) qua mọi tài khoản.
4. Thứ tự: `daily_budget_usd = 0 OR site_spent + max_cost_usd[cap_key] > daily_budget_usd` → `site_daily_exhausted`; `per_user_total = 0 OR user_total >= per_user_total` → `user_total_exhausted`; `p_ip_hash IS NOT NULL AND ip_total >= per_user_total * ip_quota_multiplier` → `ip_total_exhausted`; `per_user_daily = 0 OR user_today >= per_user_daily` → `user_daily_exhausted`. (`paused` do backend kiểm cờ trước khi gọi RPC; điều kiện "từng có khoá online" do backend kiểm bằng hàm của G04 trước khi gọi RPC — FR-11-030.)
5. Còn lượt → giữ chỗ như 0047 (chèn `reserved` kèm `cap_key`, `ip_hash`, `est_cost_usd = max_cost_usd[cap_key]`; `request_key` idempotent theo `(user_id, request_key)`; trả `reservation_id`). Lúc chốt (`consumed`) backend ghi lại `est_cost_usd` thật; lúc `released`/`filtered` đặt 0.
Hàm đọc trần từ bảng, **không** từ env; các env `TRIAL_*_PER_DAY`, `TRIAL_*_TOTAL` của 0047 thôi dùng (ghi trong amendment). Trần USD theo provider của 0047 FR-004 giữ làm lớp chặn cuối; ngân sách ngày ở đây là trần chung thấp hơn (5 USD so với 7 USD/ngày của 0047 `trial_total`) nên sẽ chạm trước.

Speaking: route chấm thử Speaking chỉ nhận Part 2 (`cap_key = 'speaking_part2'`); yêu cầu Part 1/Part 3 → 422 `trial_part_not_allowed`. Đây là thu hẹp so với 0047 (0047 cho Part 1/3 ≤ 60 s), ghi trong amendment TRIALCAP-0080.


Test PG17 `backend/tests/test_migration_471_free_trial_caps.py`: 20 lời gọi song song (luồng thật trên PG) khi ngân sách còn đủ đúng 3 lượt → đúng 3 `granted`; hai người khác nhau cùng đua ngân sách ngày; `released` không đếm lượt và trả lại chi phí; hai tài khoản cùng `ip_hash` chung hạn mức tổng (hệ số 1) và tách khi hệ số 2; Task 1 và Task 2 đếm riêng; ràng buộc CHECK từ chối `per_user_daily > per_user_total`.

#### 5.2.2 Thứ tự trạng thái (backend `services/trial_caps.py`)
`trial_state(user_id | None, cap_key, *, ip_hash=None, now) -> TrialState(state, remaining_today|None, remaining_total|None, resets_at)`: `free_trial_enabled` tắt (`runtime_flags.is_enabled("free_trial_enabled", default=False, on_error=False)`) → `paused`; rồi các bước 4 ở trên bằng truy vấn đọc (không khoá) — chỉ để hiển thị; quyết định thật luôn ở RPC lúc nộp. `resets_at` = 00:00 giờ Việt Nam hôm sau.

`trial_eligible(auth_user, user_row) -> Eligibility`: gộp điều kiện của 0047 FR-001 với hai điểm khớp: (1) provider ∈ {`google`, `email`} và `email_confirmed_at` khác null (FR-11-031); (2) `entitlements.has_ever_had_online_course(user_id)` của G04 trả false (FR-11-030) — trước khi G04-T03 merge dùng điều kiện "chưa từng kích hoạt" (`users.first_activated_at IS NULL`) của 0047; hai điều kiện khớp nhau với người đăng ký online vì xác nhận đơn bật `users.is_active`. Tài khoản đã kích hoạt bằng mã lớp vẫn bị loại theo 0047 FR-001 (không đổi).

#### 5.2.3 API

| Method · Path | Auth | Response | Ghi chú |
|---|---|---|---|
| GET `/api/trial/public-config` | không; thêm vào `ACTIVATION_EXEMPT_ROUTES` | `{"writing":{"open":bool,"reason":null|"paused"|"site_daily_exhausted","per_user_daily":{"task1":int,"task2":int},"per_user_total":{"task1":int,"task2":int},"resets_at"},"speaking":{"open","reason","per_user_daily":{"part2":int},"per_user_total":{"part2":int},"resets_at"}}` | Cache trong tiến trình 30 s; lỗi đọc → `{"writing":{"open":false,"reason":"unavailable"},…}` (trang công khai giữ lối cũ). Không trả số đã dùng, không trả số tiền ngân sách. G05-T21 đọc route này cho lối vào (FR-05-021). |
| GET `/api/trial/status` (0047) | bắt buộc | thêm cho mỗi hạng mục (`writing_task1`, `writing_task2`, `speaking_part2`) `{"state","remaining_today","remaining_total","resets_at"}` | Tài khoản không eligible giữ 403 `trial_not_eligible` của 0047 (gồm người từng có khoá online — FR-11-030). |
| nộp bài (route 0047 `/api/trial/*`) | bắt buộc | lỗi mới 409 `trial_quota` `{"state": "site_daily_exhausted"|"user_total_exhausted"|"ip_total_exhausted"|"user_daily_exhausted"}`; 422 `trial_part_not_allowed`; 503 `trial_unavailable` | Mã lỗi khác của 0047 giữ nguyên. |
| GET `/admin/settings/trial` | `require_admin` | `{"paused":bool,"paused_note":str|null,"caps":{"writing_task1":{per_user_total,per_user_daily},"writing_task2":{…},"speaking_part2":{…}},"site":{"daily_budget_usd","ip_quota_multiplier"},"today":{"spent_usd","by_cap":{<cap_key>:{"used","users_hit_daily","users_hit_total"}},"refused_by_ip":int},"log":[{at, actor_name, change, reason}×20]}` | Đủ các mục G09 cần ở thẻ Chấm thử (GOI-09 mục 7): ngân sách ngày, hệ số IP dùng chung, số lượt bị từ chối vì IP, công tắc tạm dừng. Cùng tiền tố router `/admin/settings/*` với G09-T22. |
| PUT `/admin/settings/trial` | `require_admin` | body `{"caps":{…},"site":{…},"reason":str 10..500}` → `{"caps","site","log_id"}` | 422 `invalid_caps` (thông điệp tiếng Việt theo ràng buộc FR-11-020); ghi `admin_settings_log` cùng giao dịch (hàm `fn_trial_caps_update`). |
| POST `/admin/settings/trial/pause` | `require_admin` | body `{"paused":bool,"reason":str 10..500}` → `{"paused"}` | Gọi `runtime_flags.set_flag("free_trial_enabled", not paused, note=reason, updated_by=…)` rồi ghi `admin_settings_log`; nếu ghi log lỗi sau khi đổi cờ: trả 200 kèm `log_failed: true` và log lỗi (không đảo cờ). |

#### 5.2.4 Giao diện
- `/admin/settings`: trang trong khung admin G09 (nhóm route `(authed-admin)` của G10; G10 chưa gộp thì nhóm tạm `frontend/app/(authed-admin-settings)/admin/settings/page.tsx`). Gói này dựng thẻ `?tab=trial`; các thẻ khác do G09-T23 dựng trên cùng trang (bên vào sau rebase; thẻ chưa có hiện "Chưa có ở đợt này", không bịa nội dung). Thẻ theo tờ AdminCaiDat mục 5: bảng hạn mức tổng và trần ngày × ba hạng mục, ô ngân sách ngày (USD) và hệ số IP dùng chung, cột "Hôm nay" (đã chi, số lượt, số lượt bị từ chối vì IP), "Lưu…" mở hộp liệt kê cũ → mới, kiểm ràng buộc ngay ở trình duyệt và lại ở máy chủ; công tắc "Tạm dừng chấm thử" có hộp xác nhận và ô lý do ≥ 10 ký tự; nhật ký cuối thẻ.
- Trang chấm thử (route của 0047, tờ ChamThuMienPhi màn 2–9): màn 7 hiện đúng một trong sáu trạng thái theo `status.state`; `ip_total_exhausted` hiện màn riêng nêu lý do và lối liên hệ/xác minh (FR-11-022). **Lối vào ở trang chủ (màn 1) và menu công khai thuộc G05-T21** (GOI-05 FR-05-021); gói này không sửa trang chủ.

#### 5.2.5 Chống lạm dụng
Giữ nguyên 0047 FR-007–FR-010 (email đã xác minh, băm email chuẩn hoá và bia mộ, giới hạn theo IP/thiết bị, Turnstile, admin chặn), **trừ** điều kiện provider: nới thành `google` hoặc `email` (mã đăng nhập 6 số) theo FR-11-031. Ngân sách ngày toàn web là lớp chặn đốt lượt bằng nhiều tài khoản trong một ngày; trần USD theo provider của 0047 FR-004 vẫn là lớp chặn chi phí cuối.

#### 5.2.6 Quan hệ với sổ lượt của G04
Không gộp vào `credit_ledger`. Lý do: (1) `credit_ledger` gắn với một `entitlements` và chỉ chạy khi có quyền khoá, còn người dùng thử theo định nghĩa không có quyền nào; (2) trần toàn web và trần theo ngày đếm qua mọi người, sổ G04 không có khái niệm này; (3) 0047 đã duyệt với `trial_usage`. Hai hệ không chạm nhau: xác nhận đơn bật `users.is_active` và 0047 FR-001 đặt `first_activated_at`, nên người đã có khoá không bao giờ dùng thử nữa. G04 đã bỏ giá trị `trial` khỏi `entitlements.source` và cấp hai điểm móc cho gói này (GOI-04 mục 5.8): `entitlements.has_ever_had_online_course(user_id)` (FR-11-030) và tham số `trial=True` của `credits.charge_plan`.

### 5.3 Phần C — Bốn thư về đơn (thuộc G04; gói này không còn hợp đồng kỹ thuật riêng)

- Bốn mẫu `order_created`, `order_pay_reminder`, `order_needs_info`, `order_confirmed`; CHECK của `learner_email_outbox.template` (gồm cả ba mẫu của phần A); RPC `fn_enrollment_order_pay_reminders`; quy tắc "huỷ, hết hạn, báo đã chuyển không ghi outbox"; kiểm lại trạng thái đơn lúc gửi; cấu hình `ENROLL_PAY_REMINDER_*`: **tất cả nằm trong migration 381/382 và G04-T01, T02, T04** — đọc GOI-04 mục 5.2, 5.3, 5.11, 5.12. Câu chữ và bản `.html` theo tờ EmailMau thư 4, 5, 14, 6: G05-T14.
- **Migration 472 không dùng.** Bản 17/11 của file này định dùng 472 để sửa CHECK mẫu thư và thêm RPC nhắc; việc đó không còn. Nếu 381/382 đã merge theo bản cũ trước khi GOI-04 bản 18/11 được dùng, phần chênh đi bằng một migration mới trong dải của G04 (386–389), không phải 472 (GOI-04 cuối mục 8).
- Việc còn lại của gói này liên quan tới đơn: bước `enrollment_order` của job thông báo (5.1.3) và đích `order` của thông báo (5.1.2).


### 5.4 Phần D — Chặn full test trên điện thoại

- Module `frontend/lib/full-test-device-gate.mjs` (ES module thuần, test bằng node):
  - `fullTestMinViewportPx(config = globalThis.__AVER_RUNTIME_CONFIG__)` → số nguyên ≥ 320, mặc định 768. Tên biến cấu hình trình duyệt `fullTestMinViewportPx`; cách thêm khoá vào `runtime-config.js`: CHƯA KIỂM (lệnh ở mục 2).
  - `measureViewportWidth(win = window)` → `win.innerWidth` (cùng thước với `@media (min-width: …)`).
  - `fullTestEntryDecision({width, min})` → `'allowed' | 'blocked'`.
- Hook `frontend/lib/use-full-test-gate.ts`: trả `'measuring'` khi chưa có `window` (SSR), rồi `'allowed'|'blocked'` sau lần đo đầu; **mọi lệnh tạo lượt/sitting chỉ được gọi khi `'allowed'`**. Nghe `resize` và `orientationchange` chỉ để báo `narrowDuringAttempt: boolean` sau khi lượt đã tạo.
- Component `frontend/components/exam-room/full-test-phone-block.tsx` (tiếng Anh, `lang="en"`), câu chữ đúng tờ ThanhPhanKhungTrang mục 6: tiêu đề "Full tests cannot be taken on a phone"; đoạn "This test needs a screen at least {min} pixels wide: a computer or a tablet. Open it there to start. Nothing has started and no AI credits were used."; nút "Back to Mock tests"; khối "Practise on this phone instead" + nút "Go to section practice"; dưới cùng một dòng phụ tiếng Việt `lang="vi"` (FR-11-056; câu đề xuất: "Bài thi đầy đủ cần màn hình rộng từ {min} điểm ảnh: máy tính hoặc máy tính bảng. Mini test và luyện từng phần vẫn làm được trên điện thoại." — mục 10 câu 27). Component nhận prop `viNote` để G08 dùng lại cho màn lỗi thiết bị. Dùng `Notice kind="warning" lang="en"` của G03 khi đã có; trước đó dựng bằng CSS tạm trong cùng thư mục và ghi rõ trong PR.
- Dải nhắc giữa bài `full-test-narrow-notice.tsx`: "Your screen is now narrower than {min} pixels. Your test continues and the timer keeps running. Rotate your device or widen the window to see the full layout." (câu chữ đề xuất, mục 10 câu 12); không che bài.
- Lối vào phải nối (G11-T19 và T20): `/tests` (trang mới G07-T12a/T16); `(authed-full-test)/full-test` (Speaking full test); `(authed-mock-exam)` (phòng thi thử, gồm phòng chờ/chuyển phần); `(authed-reading-player)/reading/exam/session` khi chạy chế độ test (gate phải chạy **trước** effect gọi `POST /api/reading/test/{id}/attempts`, file `reading-exam-session.tsx` dòng 965–981); `(authed-listening-player)/listening/test/session` (CHƯA KIỂM endpoint tạo lượt: `grep -n "attempts" frontend/app/(authed-listening-player)/listening/test/session/listening-test-session.tsx | head`); Writing full test trong Mock; khung `ExamRoom` của G08 khi `mode === 'exam'` **và bài là full test** (gate đặt trong một wrapper `ExamEntryGate` để mọi trình G08 dùng chung; G08 truyền `isFullTest`). Không gate: **mini test** (kể cả khi chạy ở chế độ thi tiếng Anh), chế độ luyện, bài giao `delivery_mode='assigned_practice'`, bài kiểm tra của khoá (tờ KiemTraKhoa "điện thoại vẫn làm được").
- Máy chủ: không chặn theo độ rộng. Người thực thi kiểm và ghi vào PR cho từng lối vào: (1) GET trang không tạo lượt; (2) lệnh tạo lượt là POST tường minh và idempotent (bài dở → trả lượt cũ); (3) không giữ chỗ lượt AI lúc tạo lượt. Nếu một lối vào tạo lượt ngay khi mở trang mà không thể gate trước ở client, ghi `CHƯA AN TOÀN` trong PR và mở nhiệm vụ backend riêng, không sửa backend trong PR D.
- Sự kiện: `full_test_phone_blocked {surface, width_bucket: "<360|360-479|480-767"}` qua `POST /api/analytics/events` (CHƯA KIỂM danh sách tên sự kiện cho phép: `grep -n "event_name\|ALLOWED" backend/routers/analytics.py`; có danh sách thì bỏ log, ghi vào PR).

### 5.5 Phần E — Luồng trả điểm bài kiểm tra của khoá

#### 5.5.1 Mô hình
- Một "bài kiểm tra" = một `class_assignments` `skill='course'`, `content_config.completion_mode='single_attempt'`, bộ đề trắc nghiệm thuần (ràng buộc hiện có dòng 975–988 của `admin_class_assignments.py`). Một lượt của một học viên = một `class_assignment_items` (UNIQUE theo bài giao + học viên). Làm bù/làm lại = **bài giao mới** cùng bank cho đúng người được chọn (đã có `student_ids`), nối bằng `retake_of`; không nhét lượt thứ hai vào cùng item, vì các RPC bài có giờ (mig 270, 276, 279, 280, 284, 285) đều giả định một item một lượt.
- Điểm chính thức của một lượt: `correct/total` do `course_verdict` ghi khi nộp (đã có). Gói này **không** đổi cách chấm, chỉ đổi **ai được đọc gì, lúc nào**.

#### 5.5.2 Migration 473 `backend/migrations/473_course_test_release_schema.sql`

**`class_assignments` (sửa, mọi cột NULL để bài cũ không đổi):**

| Cột | Kiểu | Ràng buộc · nghĩa |
|---|---|---|
| result_release_mode | text | NULL CHECK IN (`immediate`,`teacher_release`); NULL = như `immediate` |
| release_default_level | text | NULL CHECK IN (`score`,`score_correctness`,`full`); mức gợi ý sẵn ở bảng công bố |
| release_scheduled_at | timestamptz | NULL; hẹn công bố cả lớp |
| release_schedule_level | text | NULL, cùng CHECK; `(release_scheduled_at IS NULL) = (release_schedule_level IS NULL)` |
| release_expected_at | timestamptz | NULL; giờ dự kiến chỉ để hiển thị khi không hẹn |
| release_mode_locked_at | timestamptz | NULL; đặt ở lần nộp đầu tiên |
| opens_at | timestamptz | NULL = mở ngay khi bài hiện (`publish_at`); bắt đầu được từ mốc này |
| late_until | timestamptz | NULL; CHECK `late_until IS NULL OR (due_at IS NOT NULL AND late_until > due_at)` |
| retake_of | uuid | NULL FK `class_assignments(id)` ON DELETE RESTRICT; CHECK `retake_of <> id` |
| retake_kind | text | NULL CHECK IN (`makeup`,`retake`); `(retake_of IS NULL) = (retake_kind IS NULL)` |

CHECK thêm: `result_release_mode IS NULL OR (skill = 'course' AND content_config->>'completion_mode' = 'single_attempt')`.

**`course_result_releases`** (chỉ ghi thêm):

| Cột | Kiểu | Ràng buộc |
|---|---|---|
| id | uuid | PK |
| assignment_id | uuid | NOT NULL FK `class_assignments(id)` ON DELETE RESTRICT |
| item_id | uuid | NOT NULL FK `class_assignment_items(id)` ON DELETE RESTRICT |
| student_id | uuid | NOT NULL FK `students(id)` ON DELETE RESTRICT |
| level | text | NOT NULL CHECK IN (`score`,`score_correctness`,`full`) |
| level_rank | smallint | NOT NULL CHECK IN (1,2,3); khớp `level` (CHECK) |
| source | text | NOT NULL CHECK IN (`manual_class`,`manual_learner`,`schedule`) |
| note | text | NULL ≤ 2000 (nhận xét giáo viên, học viên đọc được) |
| released_by | uuid | NULL FK `users(id)` ON DELETE SET NULL (NULL khi `schedule`) |
| request_key | text | NOT NULL; `UNIQUE (item_id, level_rank)` (một dòng mỗi mức), `UNIQUE (request_key, item_id)` |
| created_at | timestamptz | NOT NULL DEFAULT now() |

Trigger: BEFORE INSERT từ chối khi đã có dòng của item với `level_rank >= NEW.level_rank` (`release_level_not_higher`), khi item chưa `submitted_at` (`not_submitted`), khi bài giao không phải `teacher_release` (`not_release_mode`); BEFORE UPDATE/DELETE/TRUNCATE → `course_result_releases_append_only`.

**Khoá chế độ:** trigger `trg_course_release_mode_lock` BEFORE UPDATE OF `result_release_mode` ON `class_assignments`: `OLD.result_release_mode IS DISTINCT FROM NEW.result_release_mode` và (`OLD.release_mode_locked_at IS NOT NULL` hoặc tồn tại item của bài có `submitted_at`) → `RAISE EXCEPTION 'release_mode_locked'`. Trigger AFTER UPDATE OF `submitted_at` ON `class_assignment_items` WHEN `OLD.submitted_at IS NULL AND NEW.submitted_at IS NOT NULL`: `UPDATE class_assignments SET release_mode_locked_at = coalesce(release_mode_locked_at, now()) WHERE id = NEW.assignment_id AND result_release_mode IS NOT NULL`. Thứ tự khoá: trigger này chạy trong giao dịch đã khoá item rồi mới tới assignment — đúng thứ tự item → assignment mà 0046 FR-018 quy định; người thực thi đối chiếu lại với mig 270 trước khi viết.

**Thu quyền đọc thẳng** (chỉ khi 0046 chưa làm; kiểm bằng `select policyname from pg_policies where tablename in ('quiz_attempts','quiz_sessions')` trên PG test sau khi áp mọi migration): `DROP POLICY IF EXISTS quiz_attempts_select ON public.quiz_attempts; DROP POLICY IF EXISTS quiz_sessions_select ON public.quiz_sessions; REVOKE SELECT ON public.quiz_attempts, public.quiz_sessions FROM anon, authenticated;`. Trước khi viết, người thực thi chạy `grep -rn "from('quiz_attempts')\|from(\"quiz_attempts\")\|from('quiz_sessions')\|from(\"quiz_sessions\")" frontend/ backend/` và kiểm view/RPC gọi được bởi `authenticated` đọc hai bảng này (`select … from pg_views` / `pg_proc` có `prosecdef=false` nhắc tên bảng) — có kết quả là **dừng** (0046 FR-017 ghi cùng điều kiện). Kiểm thêm `course_section_submissions` không có quyền client đọc (`select grantee, privilege_type from information_schema.role_table_grants where table_name='course_section_submissions'`).

Rollback `backend/migrations/rollback/473_course_test_release_schema.sql`: gỡ trigger, giữ cột và bảng; **không** khôi phục policy đọc thẳng.

#### 5.5.3 Máy trạng thái (một học viên · một bài kiểm tra)

Tính ở `backend/services/course_result_release.py::course_test_state(item, assignment, releases, *, now)`, không lưu cột trạng thái. Ký hiệu: `close_at = coalesce(late_until, due_at)`; `start_at = coalesce(opens_at, publish_at, created_at)`.

| Trạng thái | Điều kiện | Học viên thấy (màn tờ KiemTraKhoa) | Chuyển tiếp |
|---|---|---|---|
| `not_open` | `now < start_at` | Màn 6 "Chưa mở": giờ mở, đếm ngược; nút Bắt đầu khoá kèm lý do | → `open` khi tới giờ (không cần tải lại) |
| `open` | `start_at ≤ now < close_at` (hoặc `close_at` NULL), `opened_at` NULL | Màn 2 trước khi làm, hộp xác nhận | Bắt đầu → `in_progress` |
| `in_progress` | `opened_at` có, `submitted_at` NULL, chưa quá mốc cắt | Màn 3 đang làm | Nộp, hết giờ, hoặc tới `close_at` (job `reap_expired_course_assessments` thu bài) → `submitted` |
| `submitted` (chỉ tức thời) | `submitted_at` có | — | `immediate`/NULL → `released` mức `full` ngay; `teacher_release` → `awaiting_release` |
| `awaiting_release` | `teacher_release`, `submitted_at` có, chưa có dòng công bố | Màn 4 "Đã nộp, chờ giáo viên công bố": giờ nộp, số câu đã làm/bỏ trống, thời lượng, giờ dự kiến = `coalesce(release_scheduled_at, release_expected_at)`; nếu `late_minutes` có: "Đã nộp trễ N phút" | Công bố/hẹn giờ → `released` |
| `released` | có dòng công bố (mức = `max(level_rank)`), hoặc chế độ `immediate` đã nộp | Màn 5/6 theo mức | Nâng mức (giữ `released`); làm lại → bài giao mới `retake` |
| `absent` | `opened_at` NULL và `close_at` có và `now ≥ close_at` | Màn 6 "Bạn chưa làm bài này": không điểm, không 0 | Làm bù → bài giao mới `makeup` |

`late_minutes = ceil((submitted_at − due_at) / 60 s)` khi `due_at` có và `submitted_at > due_at`, ngược lại NULL. Một lượt nối `retake_of`: học viên xem "lượt mới nhất" theo chuỗi `retake_of` (gốc → con mới nhất theo `created_at`), lượt cũ vẫn mở được bằng đường dẫn của chính nó.

#### 5.5.4 Mức hiển thị → trường được trả cho học viên

| Trường | chưa công bố | `score` | `score_correctness` | `full` |
|---|---|---|---|---|
| trạng thái, `submitted_at`, `answered_count`, `blank_count`, `duration_sec`, `late_minutes`, giờ dự kiến | có | có | có | có |
| `correct`, `total`, `pct` (cả bài) | **không** | có | có | có |
| nhận xét giáo viên (`note` của dòng công bố mới nhất) | không | có | có | có |
| bảng theo buổi (0043: đúng/tổng, tỉ lệ, "Cần ôn" < 60%) | không | không | có | có |
| `is_correct` từng câu, đáp án học viên chọn | không | không | có | có |
| đáp án đúng, `accept`, `explain`, `why_wrong` | không | không | không | có, **và** luật mở đáp án 0046 FR-011 (sau `due_at`/`close_at` hoặc khi mọi học viên còn trong lớp đã nộp) đã thoả; chưa thoả → `answers_release_at` cho giao diện ghi "Đáp án mở sau …" |

`immediate`/NULL = cột `full` ngay khi nộp (đúng hành vi hiện tại, cộng các luật của 0046 nếu 0046 đã merge).

#### 5.5.5 Cổng máy chủ — một hàm, áp mọi đường đọc
- `course_result_release.result_gate(item_id | None, *, user_id, now) -> ResultGate(applies: bool, state, level_rank: 0..3, answers_open: bool)`; `applies=False` cho mọi phiên/item không phải bài `teacher_release` (đường cũ chạy y nguyên, không thêm truy vấn khi item không có `result_release_mode` — đọc cột cùng lượt đọc `class_assignments` sẵn có). Đọc lỗi → coi như chưa công bố (fail-closed), giống `_sealed_course_session_ids`.
- Áp ở (mỗi điểm một dòng trong `verification.md`):

| Đường | Hàm | Việc phải làm khi `applies` và `level_rank` < yêu cầu |
|---|---|---|
| `POST /api/quiz/sessions/{id}/progress` | `log_progress` → `_course_attempt_feedback` | không trả phần tử phản hồi nào (mảng rỗng, chỉ `client_id` đã lưu) |
| `PATCH /api/quiz/sessions/{id}` | `end_session` | `total_correct`, `total_wrong`, `accuracy` = `null` |
| `POST /api/quiz/course/verdict` | `course_verdict` | vẫn ghi điểm vào item như hôm nay; phản hồi bỏ `correct`, `total`, `pct`, `passed`, chỉ trả `{"state":"awaiting_release", "submitted_at", "answered_count", "blank_count"}` |
| `GET /api/quiz/course/report` | `course_answer_report` | `< 2`: `{"sealed": true, "state", …}` không có câu; `= 2`: có `is_correct`, không đáp án/lời giải; `3`: như hôm nay (kèm luật 0046) |
| `GET /api/quiz/banks/{bank_id}` | `get_bank_for_play` | lịch sử lượt (`mastery.attempts`) bỏ `pct`, `correct`, `right`; `answers_sealed: true` |
| `GET /api/quiz/banks/{bank_id}/course-resume` | `get_course_resume` | `last_stage`, `retake.*` = `null`; `answered[].is_correct` = `null` |
| `GET /api/quiz/progress` | `student_progress` | phiên của bài bị gate không vào `recent_sessions` có điểm, không vào `avg_accuracy` |
| `GET /api/quiz/mistakes` | `student_mistakes` | không có dòng của bài bị gate (đang dùng `_sealed_course_session_ids`, mở rộng hàm đó gọi `result_gate`) |
| `GET /api/class/my-assignments`, `GET /api/class/me` | `_decorate` | `score`, `passed_at` = `null`; thêm khối `course_test` (5.5.6) |
| `GET /api/student/today` (G07) | `services/student_today.py` | dùng khối `course_test`, không đọc `score` thô |
| `GET /api/me/kp-mastery`, `/api/me/roadmap` | `backend/routers/kp.py` | không ghi bằng chứng KP từ hàng của bài một lượt (0046 FR-019); CHƯA KIỂM nơi ghi: `grep -n "_record_quiz_kp_evidence" backend/services/quiz_service.py` (dòng 2961) |
| Mọi đường admin/giáo viên (`assignment_id`, `/admin/...`) | — | không đổi (FR-11-075) |

- Test hành vi bắt buộc `backend/tests/test_course_result_release_no_leak.py`: dựng một item `teacher_release` đã nộp (supabase giả theo mẫu test quiz hiện có — `grep -ln "single_attempt" backend/tests | head`), gọi **mọi** route ở bảng trên bằng TestClient, duyệt đệ quy JSON trả về và khẳng định không có khoá `score, correct, pct, accuracy, total_correct, total_wrong, is_correct, answer, accept, explain, why_wrong, right` mang giá trị khác `null`; rồi công bố mức `score` → chỉ `correct/total/pct` xuất hiện; mức 2 → thêm `is_correct`; mức 3 → thêm đáp án. Đây là test hành vi theo phản hồi, không đọc mã nguồn.

#### 5.5.6 Khối `course_test` trả cho học viên (thêm vào `_decorate` và API G07)
```json
"course_test": {
  "release_mode": "immediate" | "teacher_release",
  "state": "not_open" | "open" | "in_progress" | "awaiting_release" | "released" | "absent",
  "attempt_kind": "initial" | "makeup" | "retake",
  "root_assignment_id": "uuid",
  "opens_at": "…Z" | null, "due_at": "…Z" | null, "late_until": "…Z" | null,
  "time_limit_minutes": 60 | null,
  "submitted_at": "…Z" | null, "late_minutes": 12 | null,
  "answered_count": 117 | null, "blank_count": 3 | null,
  "expected_release_at": "…Z" | null,
  "release": null | {"level": "score" | "score_correctness" | "full", "released_at": "…Z", "released_by_name": "…", "note": "…" | null},
  "result": null | {"correct": 96, "total": 120, "pct": 80},
  "answers_release_at": "…Z" | null
}
```
`pct` = `round(correct * 100 / total)`; không bao giờ trả band; không trả "0/0" (total = 0 → `result: null`).

#### 5.5.7 Migration 474 — hàm công bố `backend/migrations/474_course_test_release_rpcs.sql`

| Hàm | Tham số | Kết quả |
|---|---|---|
| `fn_course_result_release` | `p_actor_id uuid, p_assignment_id uuid, p_student_ids uuid[] NULL (NULL = mọi bài đã nộp), p_level text, p_note text, p_request_key text, p_source text` | `{released: n, upgraded: n, skipped_not_submitted: n, skipped_same_or_higher: n}`; `not_release_mode`, `not_found` | 
| `fn_course_result_schedule` | `p_actor_id, p_assignment_id, p_at timestamptz NULL (NULL = huỷ hẹn), p_level text` | `scheduled`, `cancelled`, `in_past`, `not_release_mode` |
| `fn_course_result_run_schedules` | `p_limit int` | `{assignments: n, released: n}` — bài có `release_scheduled_at <= now()`: gọi `fn_course_result_release(..., NULL, release_schedule_level, NULL, 'schedule:'||id||':'||epoch, 'schedule')` chỉ cho item có `submitted_at <= release_scheduled_at`, rồi đặt `release_scheduled_at = NULL`, `release_schedule_level = NULL` |
| `fn_course_release_mode_set` | `p_actor_id, p_assignment_id, p_mode text, p_default_level text, p_expected_at timestamptz` | `updated`, `locked`, `not_eligible` |

`fn_course_result_release`: `SELECT … FROM class_assignments WHERE id = … FOR UPDATE` (khoá bài trước), rồi chèn dòng cho từng item thoả (`submitted_at IS NOT NULL`, mức mới > mức hiện có) theo thứ tự `item_id` tăng; `request_key` lặp → trả kết quả cũ (không chèn thêm). Không ghi thông báo trong hàm (job A đọc bảng công bố).

#### 5.5.8 API giáo viên/admin (thêm vào `backend/routers/admin_class_assignments.py`, prefix `/admin/cohorts`)

| Method · Path | Auth | Request | Response | Lỗi |
|---|---|---|---|---|
| POST `/{cohort_id}/assignments` (sửa model `AssignmentCreate`) | admin (như hiện tại) | thêm `result_release_mode: "immediate"|"teacher_release"|null`, `release_default_level`, `release_expected_at`, `opens_at`, `late_until` | như hiện tại | 400 khi đặt các trường này cho bài không phải `single_attempt` |
| PATCH `/{cohort_id}/assignments/{id}/release-mode` | admin hoặc giáo viên của lớp | `{"mode","default_level","expected_at"}` | `{"assignment"}` | 409 `release_mode_locked` |
| POST `/{cohort_id}/assignments/{id}/release` | admin hoặc giáo viên của lớp | `{"student_ids": [uuid]|null, "level", "note": str≤2000|null, "request_key"}` | `{"released","upgraded","skipped_not_submitted","skipped_same_or_higher"}` | 409 `not_release_mode`; 422 `invalid_level` |
| PUT `/{cohort_id}/assignments/{id}/release-schedule` | như trên | `{"at": "…Z"|null, "level"}` | `{"release_scheduled_at","release_schedule_level"}` | 422 `scheduled_in_past` |
| PATCH `/{cohort_id}/assignments/{id}/late-until` | như trên | `{"late_until": "…Z"|null}` | `{"assignment"}` | 409 khi bài đã đóng và có người vắng mà `late_until` mới đã qua (không mở lại bằng cách lùi) |
| POST `/{cohort_id}/assignments/{id}/retakes` | như trên | `{"student_ids":[uuid], "kind":"makeup"|"retake", "due_at", "time_limit_minutes"|null, "request_key"}` | 201 `{"assignment"}` (bài giao mới, `retake_of`, cùng `content_id`, cùng `content_config` trừ hạn) | 409 `makeup_not_absent` (makeup cho người không vắng), `retake_not_released` (retake trước khi người đó có kết quả) |
| GET `/{cohort_id}/assignments/{id}/tally` (sửa) | như hiện tại | — | thêm mỗi dòng `course_test_state`, `late_minutes`, `release_level`, `released_at`; thêm `counts.awaiting_release`, `counts.released`, `counts.absent` | — |

Trùng bank trong lớp (`backend/routers/admin_class_assignments.py`, khối trả 409 quanh dòng 986–998 ở `c3bc71574`; bản trước ghi 1000–1007) được bỏ qua khi `retake_of` có giá trị. Quyền "giáo viên của lớp": `services/staff_scope.py::resolve_staff_scope` + `scope.assert_cohort` của G09-T24 (lớp không thuộc giáo viên → 404); G09-T24 chưa merge thì chỉ admin. Hai dòng `late-until` và `retakes` hoãn cùng G11-T25, T26 (trả lời câu 16). **Giao diện gọi các route này là của G09**: bảng công bố ở G09-T30 (route `/admin/classes/[cohortId]/assignments/[assignmentId]/release`, tờ KiemTraKhoaGiaoVien); ô "Chế độ trả điểm" lúc giao bài ở `AssignDrawer` của G09-T26. G09-T27 thêm API đọc `result` riêng cho trang Kết quả một bài giao; `tally` mở rộng ở bảng trên vẫn giữ cho bảng công bố.

#### 5.5.9 Migration 475 — nộp trễ và vắng (`475_course_test_late_window.sql`)
Mốc cắt bài có giờ hiện tính `min(opened_at + time_limit, due_at)` (mig 280 "snapshot timed course cutoff", mig 272 khoá `due_at` sau khi bắt đầu). Thay mốc `due_at` bằng `coalesce(late_until, due_at)` trong các hàm: `quiz_finalize_timed_course_session`, `quiz_insert_timed_course_attempts`, hàm bắt đầu bài có giờ (mig 270), `mark_timed_course_assignment_started` (mig 272) và `_assert_course_session_accepting` (Python, `quiz_service.py` dòng 3299), `reap_expired_course_assessments` (5596). Người thực thi **phải** đọc định nghĩa mới nhất của từng hàm (`grep -ln "FUNCTION public.quiz_finalize_timed_course_session" backend/migrations/*.sql | sort | tail -1`, tương tự các hàm khác) và chép nguyên thân, chỉ đổi biểu thức mốc. `late_until` cũng bị khoá như `due_at` sau khi bài có giờ bắt đầu, **trừ** lệnh kéo dài `late_until` (chỉ tăng). Điều kiện dừng: nếu một hàm đọc `due_at` ở hơn hai chỗ với nghĩa khác nhau, dừng và báo danh sách chỗ.

#### 5.5.10 Migration 476 — làm bù/làm lại (`476_course_test_retake_links.sql`)
Chỉ cần nếu 473 chưa có `retake_of` (473 đã có) → 476 thay `class_assignments` unique/dup guard nếu có ràng buộc CSDL chặn cùng bank trong lớp (CHƯA KIỂM: `grep -n "content_id" backend/migrations/*class_assign*.sql | grep -i "unique"`; không có ràng buộc CSDL thì không viết 476, chỉ sửa kiểm Python).

### 5.6 Phần F — Tên khoá và nhãn
- Dữ liệu (staging, qua `POST /admin/course-products` của G04-T05, không seed trong migration): sáu dòng `courses` `kind='online'` và sáu `course_products` `kind='online'`, `status='coming_soon'` (học phí, thời hạn, số lượt chưa chốt → NULL/0). Tên (`title`) theo 00 mục 2 điểm 2; slug đề xuất ở mục 10 câu 23. Người thực thi ghi lệnh/payload đã chạy vào PR, không chép token.
- Module nhãn `frontend/lib/course-access-labels.mjs`: `export const COURSE_ACCESS_ACTIONS = { enroll: 'Đăng ký khoá này', renew: 'Đăng ký lại', continue: 'Vào học' }` và hàm `accessActionLabel(viewerState)` (`guest|can_enroll` → `enroll`, `expired` → `renew`, `enrolled` → `continue`). Mọi màn (G05 `/courses`, `/courses/[slug]`, G07 tài khoản và Lộ trình, Grammar Wiki khối "Trong khoá", thông báo) gọi module này. Backend: `RENEW_LABEL = "Đăng ký lại"` trong `backend/services/notification_copy.py`.
- Test: `frontend/tests/course-access-labels.test.mjs` kiểm `accessActionLabel('expired') === 'Đăng ký lại'` và từng trạng thái; test React của màn có trạng thái hết hạn kiểm nút đúng chữ (test hành vi).

### 5.7 Phần G — Nhận diện, icon, sơ đồ

#### 5.7.1 Logo
- Nguồn hình duy nhất: `frontend/lib/brand/logo-geometry.mjs` (toạ độ `rect`/`polygon` trên lưới 48 theo tờ NhanDienLogo Hướng 1, màu bằng tên vai trò `frame|letter|bar|paper`).
- `frontend/components/brand/logo.tsx`: `<Logo variant tone size title?>` render SVG nội tuyến, màu qua `var(--av2-…)` của G03 (ánh xạ `--accent`, `--mark`, `--paper`, `--ink` của tờ sang token G03; G03 chưa có thì dùng mã màu 00 mục 2 điểm 10 trong một file token tạm và ghi trong PR); chữ "Aver Learning" Source Serif 4 600.
- Script `frontend/tooling/build-brand-assets.mjs`: sinh từ hình gốc các file tĩnh `frontend/public/favicon.svg`, `frontend/public/brand/logo-{horizontal,stacked,mark}-{color,mono,reverse}.svg`, `frontend/public/brand/logo-horizontal-color@2x.png` (đầu thư `.html` của G05-T14, vì nhiều ứng dụng thư chặn SVG — thêm 18/11 theo rà soát), `frontend/public/icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png` (180); chế độ `--check` so kết quả sinh với file trong repo và thoát mã 1 nếu lệch (chạy trong CI ở job frontend hiện có; tên job bắt buộc không đổi). PNG sinh bằng thư viện đã có trong `frontend/package.json` (CHƯA KIỂM có `sharp`/`@resvg/resvg-js` không: `grep -n "sharp\|resvg" frontend/package.json`; không có thì hỏi trước khi thêm dependency, mục 10 câu 19).
- Chép `frontend/public/favicon.svg` sang `docs/brand/assets/favicon.svg` và `frontend/favicon.svg` (giữ ba bản trùng như hôm nay để test byte-identical còn đúng); ghi vào `docs/brand/README.md` rằng bộ "Mũi lên" đã thay.
- Sửa `frontend/tests/brand-favicon.test.mjs` trong cùng PR (đổi có chủ ý): giữ test bản trùng và test mọi trang dùng `/favicon.svg`; thay hai test hình bằng kiểm Ấn ký (`<rect` khung, `<polygon` chữ A, thanh ngang màu đánh dấu `#8A1C1C`, không `<text>`, không `#0F766E`, không `#F59E0B`); test `layout.tsx` đổi theo khối `icons` mới (`icons: { icon: '/favicon.svg', apple: '/icons/apple-touch-icon.png' }`) — ghi lý do từng dòng sửa trong PR.
- `frontend/app/manifest.ts`: thêm icon 192, 512, maskable 512 (`purpose: 'maskable'`), giữ SVG `any`; `theme_color`, `background_color` theo tờ NhanDienLogo mục 3d (đọc tờ; mặc định tạm: nền `#FAF6EF`, theme `#1A3561`).
- Thay chữ trần ở khung mới (G03 `LearnerShell`, khung công khai, `StaffShell`) bằng `<Logo variant="horizontal" size={24}>`. Khung cũ (`frontend/public/js/components/aver-chrome.js` dòng ~438, `aver-admin-chrome.js` dòng 697–698): dùng `<img src="/brand/logo-horizontal-color.svg" alt="Aver Learning" height="24">`, theo thứ tự sửa file `aver-chrome.js` ở 01 mục 3 (G02-T09 → G07 → G09-T09 → gói này).

#### 5.7.2 Ảnh chia sẻ liên kết
- `frontend/app/opengraph-image.tsx` (trang chủ, `ImageResponse`, 1200×630, nhúng Source Serif 4 và Source Sans 3 từ file font trong repo — CHƯA KIỂM đường dẫn font G03 đặt: `ls frontend/public/fonts frontend/app/fonts 2>/dev/null`), và `opengraph-image.tsx` trong segment `courses/[slug]` (G05), `library/writing/[id]` (G06, theo route thật G06 đặt), `grammar/[category]/[slug]`, đề Speaking (G06). Khuôn: nhãn loại đỏ mận · tiêu đề Serif 64 tối đa hai dòng, cắt "…" · một dòng phụ · chân trang domain. Không đặt band, số học viên, học phí chưa chốt.
- Không đổi cách sinh `og:title`/`og:description` (`layout.tsx` dòng 19–31 giải thích bẫy merge nông của Next: segment nào thêm `opengraph-image` thì kiểm lại `tests/next-metadata.test.mjs`).
- Tài nguyên social: xuất PNG theo tờ NhanDienSocial mục 2–3 vào `docs/brand/social-assets/png/` bằng cùng script (`--social`), giữ các SVG cũ trong thư mục `archive/`.

#### 5.7.3 Bộ 94 icon
- `frontend/components/ui/icon/icon-set.ts`: đúng tên và path của mảng `iconGroups` trong `thiet-ke/ThanhPhanNenTang.dc.html` (người thực thi chép từ phần `<script>` của tờ; hàm `c(x, y, r)` trong tờ là vòng tròn — chuyển thành `<circle>`), `export type IconName`; `icon.tsx` render `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">`; ngoại lệ tô kín duy nhất là `record` (theo tờ). `title` có → `role="img"` + `<title>`; không → `aria-hidden="true"`.
- Bảng ánh xạ emoji/ký tự → icon (tờ ThanhPhanNenTang mục "Đang lệch") lưu ở `frontend/components/ui/icon/legacy-glyph-map.ts` để các gói dựng lại trang dùng khi thay.
- Thay G03-T03: nếu G03-T03 đã merge với bộ lucide thì PR này thay `icon-set.ts`, giữ API `Icon` và các tên trùng; tên lucide không có trong bộ 94 thì đổi sang tên gần nghĩa nhất và liệt kê trong PR.

#### 5.7.4 Sơ đồ câu trong Grammar Wiki
- Minh hoạ của web là sơ đồ câu chữ dựng bằng HTML/CSS; không tranh khắc, không ảnh minh hoạ (00 mục 2 điểm 22). Trang danh sách và trang bài Grammar Wiki theo tờ GrammarWiki, GrammarWikiBai do G06 dựng; tờ GrammarWikiMinhHoa là chuẩn cho mười kiểu sơ đồ dưới đây.
- Thêm kiểu khối `figure` vào `backend/services/grammar_learning_blocks.py` (không đụng năm kiểu cũ): `ALLOWED_FIGURES = {"sentence-anatomy","noun-phrase","timeline","voice-shift","clause-levels","morphemes","agreement","error-pair","role-translation","word-slot"}` (tờ GrammarWikiMinhHoa). Khai trong frontmatter `learning_blocks` như các khối khác, đặt bằng `<!-- learning-block: <id> -->`.
- Lược đồ chung: `{id, type: "figure", figure: <kiểu>, title (chú thích), caption_vi?, alt_vi (bắt buộc, câu đọc cho trình đọc màn hình), lang: "en", parts: [...]}`; `parts` theo kiểu, ví dụ `sentence-anatomy`: `[{text: "The report", role: "subject", label_vi: "Chủ ngữ", n: 1}, {text: "written by the team", role: "reduced-clause", label_vi: "Mệnh đề rút gọn", n: 2, mark: true}, …]`; `error-pair`: `{wrong, right, reason_vi}`; `timeline`: `{points: [{label, at: "past|now|future", span?}], sentence}`. Người thực thi viết đủ mười lược đồ theo đúng các hình trong tờ GrammarWikiMinhHoa, mỗi kiểu một hàm `_validate_<kiểu>` và một hàm `_render_<kiểu>`; mọi chuỗi qua `escape`; chỉ sinh các lớp CSS trong danh sách cho phép (`gw-fig`, `gw-fig--<kiểu>`, `gw-fig__part`, `gw-fig__part--<role>`, `gw-fig__mark`…).
- Lược đồ `figure` được mở rộng (trường tuỳ chọn và ba kiểu `quick-choice`, `intensity-scale`, `annotated-paragraph`) bởi spec GRAMMAREDIT-0096 trong GOI-13; renderer phần mở rộng là G13-B06, làm sau G11-T33. (sửa 18/11 theo GOI-13)
- HTML: `<figure class="gw-fig gw-fig--<kiểu>" id="fig-<n>" role="img" aria-label="<alt_vi>">…<figcaption>Hình <n>. <title></figcaption></figure>`; chữ ví dụ bọc `<span lang="en">`. Đánh số "Hình N" theo thứ tự xuất hiện trong bài khi `inject_learning_blocks` chạy; tham chiếu "(Hình 2)" trong văn bài viết bằng `[Hình 2](#fig-2)`. Tối đa 4 khối `figure` mỗi bài (khối thứ 5 bị bỏ, cảnh báo).
- Khối sai cấu trúc: bỏ khối, ghi `logger.warning` (như hiện tại dòng 315–320 của `grammar_content.py`), bài vẫn hiện; thêm lỗi vào danh sách để `backend/scripts/` kiểm nội dung (nếu đã có script kiểm frontmatter thì nối vào; CHƯA KIỂM: `ls backend/scripts | grep -i grammar`).
- CSS: `frontend/app/(public-content)/grammar/grammar-figures.css` (hoặc trong stylesheet bài đọc của G06-T07 nếu đã có), chỉ dùng biến `--ink, --muted, --accent, --ok, --danger, --rule, --surface` của tờ (ánh xạ sang token G03); rộng tối đa bằng cột chữ (640px); dưới 600px theo quy tắc điện thoại của từng kiểu trong tờ; `@media print` đen trắng. Không ảnh, không chuyển động.
- Nội dung thí điểm: thêm khối `figure` cho 5 bài (đề xuất mục 10 câu 22), mỗi bài 1–3 hình, sửa trong `backend/content/<category>/<slug>.md`; không đổi frontmatter khác, không đổi anchor (`tests/test_anchor_drift.py`).

## 6. Nhiệm vụ (theo thứ tự phụ thuộc)

Bảng tổng (chi tiết từng nhiệm vụ ở dưới):

| Mã | Tên | Phần | Phụ thuộc | Phiên | Độ khó |
|---|---|---|---|---|---|
| G11-T01 | Spec NOTIFY-0079 | A | — | 1 | 3 |
| G11-T02 | Spec TRIALCAP-0080 (sửa đổi 0047) | B | — | 1 | 3 |
| G11-T03 | Spec PHONEGATE-0081 | D | — | 1 | 2 |
| G11-T04 | Spec COURSETESTRELEASE-0082 | E | — | 1 | 4 |
| G11-T05 | Spec BRANDMARK-0083 | G1 | — | 1 | 2 |
| G11-T06 | Spec GRAMMARFIG-0084 | G3 | — | 1 | 2 |
| G11-T07 | **ĐÃ BỎ** — sửa spec G04/G05 cho thư đơn (GOI-04, GOI-05 bản 18/11 đã ghi bốn thư) | C | — | 0 | — |
| G11-T08 | Migration 470 thông báo | A | T01 | 1 | 4 |
| G11-T09 | API thông báo + bộ đếm quá hạn + service nhắc dùng chung | A | T08 | 1 | 3 |
| G11-T10 | Job sinh thông báo + cron | A | T09 | 2 | 4 |
| G11-T11 | Chuông, thẻ quá hạn, ngăn, trang | A | T09, G03 LearnerShell, G07-T05 | 2 | 3 |
| G11-T12 | Cài đặt thư + thư tuỳ chọn | A | T09, G04-T01 (CHECK outbox), G04-T04 (dispatcher) | 1 | 3 |
| G11-T13 | Gửi thông báo của nhân sự | A | T10, G09-T08, G09-T24 (`staff_scope`) | 2 | 4 |
| G11-T14 | Migration 471 + sửa hàm giữ chỗ (trần theo task, IP, ngân sách ngày) | B | T02, 0047 migration 371, G09-T22 (migration 440: `admin_settings_log`) | 2 | 5 |
| G11-T14a | (mới 18/11 tối) Thực thi FREETRIAL-0047 (migration 371, `/api/trial/*`, màn `/trial/writing`, `/trial/speaking`); việc đầu: kiểm nhánh/PR đã có | B | T02 duyệt | 4 | 5 |
| G11-T15 | Trạng thái, điều kiện được chấm thử, cấu hình công khai, chặn khi nộp | B | T14, route `/api/trial/*` của 0047, G04-T03 (`has_ever_had_online_course`) | 1 | 4 |
| G11-T16 | `/admin/settings` thẻ Chấm thử | B | T15, G09-T08 | 1 | 3 |
| G11-T17 | Sáu trạng thái trong các màn chấm thử (thu hẹp: lối vào trang chủ/menu thuộc G05-T21) | B | T15, UI 0047 | 1 | 3 |
| G11-T18 | **ĐÃ BỎ** — thư đơn và thư nhắc (G04-T01, T02, T04 làm trong 381/382; migration 472 không dùng) | C | — | 0 | — |
| G11-T19 | Thư viện cổng + màn chặn (có dòng phụ tiếng Việt) + `/tests` | D | T03 | 1 | 3 |
| G11-T20 | Nối cổng vào các phòng thi cũ và `ExamRoom` | D | T19 | 1 | 3 |
| G11-T21 | Migration 473 lược đồ công bố + thu quyền đọc thẳng | E | T04 | 1 | 5 |
| G11-T22 | Cổng máy chủ trên mọi đường đọc + test không lộ | E | T21 | 2 | 5 |
| G11-T23 | Migration 474 + API chế độ, công bố, hẹn giờ | E | T22 | 1 | 4 |
| G11-T24 | Bước hẹn giờ trong job + thông báo công bố | E | T23, T10 | 1 | 3 |
| G11-T25 | **HOÃN** (trả lời câu 16) — nộp trễ và vắng (migration 475) | E | T23 | (2) | 5 |
| G11-T26 | **HOÃN** (trả lời câu 16) — làm bù / làm lại | E | T23 | (1) | 4 |
| G11-T27 | Màn học viên bài kiểm tra (KiemTraKhoa 1–6, 8) | E | T22, G03, G07-T15 | 2 | 3 |
| G11-T28 | **ĐÃ BỎ** — bảng công bố phía giáo viên (G09-T30 dựng giao diện; chọn chế độ lúc giao bài ở G09-T26; backend giữ ở T21–T24) | E | — | 0 | — |
| G11-T29 | Tên sáu khoá + nhãn "Đăng ký lại" | F | G04-T05 | 1 | 2 |
| G11-T30 | Logo, favicon, icon ứng dụng, manifest | G1 | T05 | 1 | 3 |
| G11-T31 | Ảnh OG theo route + PNG social | G1 | T30 | 1 | 3 |
| G11-T32 | Bộ 94 icon (thay G03-T03) | G2 | G03-T02 | 2 | 3 |
| G11-T33 | Renderer khối `figure` + CSS | G3 | T06 | 2 | 4 |
| G11-T34 | Nội dung sơ đồ thí điểm 5 bài | G3 | T33 | 1 | 2 |
| G11-T35 | Áp staging, nghiệm thu đầu-cuối cả gói | — | các nhiệm vụ cần kiểm đã merge | 1 | 3 |
| **Tổng còn hiệu lực đợt đầu** | **32 PR** (36 mã − 3 ĐÃ BỎ − 2 hoãn = 31 nhiệm vụ; T14a 2 PR) | | | **42** | |
| Hoãn (T25, T26) | 2 PR | | | 3 | |

Song song ngay từ đầu: T01–T06 (spec), T19 sau T03, T30 sau T05, T33 sau T06. Luồng E (T21→T24, T27) độc lập với A, B, chỉ T24 cần T10; G09-T30 chạy sau T23. Phần C không còn nhiệm vụ.

### G11-T01 — Spec NOTIFY-0079
- Mục đích: thư mục spec được duyệt trước mọi mã của phần A (00 mục 4 điểm 6).
- Đầu vào: `specs/README.md`, `specs/_meta/constitution.md`, `specs/_templates/*`; file này mục 4 (FR-11-001…014), 5.1; tờ `ThongBao`, `ThanhPhanKhungTrang` mục 1–3, `AdminGiaoVienThongBao`, `EmailMau` (ghi chú 2–3).
- Việc làm:
  1. Kiểm số: `ls specs | sort | tail -5`; hỏi sổ số spec; 0079 đã bị giữ → lấy số được cấp, đổi mọi chỗ `0079` trong spec (không cần sửa file này, ghi số thật trong PR).
  2. Tạo `specs/0079-learner-notifications/` gồm `spec.md` (frontmatter `id: NOTIFY-0079`, `status: draft`, `risk: high`), `plan.md` (mục 5.1 nguyên văn), `tasks.md` (T001…T006 ↔ G11-T08…T13), `verification.md` (FR → test, mục 9), `rollout.md` (cờ tắt, thứ tự áp 470 → backend → job → giao diện), `ui-states.md` (chuông 3 trạng thái, ngăn, trang rỗng/tải/lỗi).
  3. `spec.md` có mục "Quan hệ với spec khác": COURSEACCESS-0055 (bảng đơn, quyền), ENROLL-0060, LEARNERCORE (G07), UIBASE-0056, COURSETESTRELEASE-0082.
  4. Thêm một dòng vào bảng chỉ mục của `specs/README.md`.
  5. `python backend/scripts/validate_specs.py`; `git diff --check`.
- Đầu ra: một PR chỉ có `specs/`.
- Nghiệm thu: `validate_specs.py` 0 lỗi; mỗi FR-11-001…014 có ít nhất một dòng trong `verification.md`; diff không có file ngoài `specs/`.
- Không làm: không viết migration, không tạo file giữ số.
- Vướng mắc → cách gỡ: `validate_specs.py` đòi id khớp 4 số của thư mục → đặt đúng `NOTIFY-0079`; sửa `specs/README.md` làm CI chạy đủ bộ test (bình thường, không phải lỗi).
- Ước lượng: 1 phiên · 3.

### G11-T02 — Spec TRIALCAP-0080 (sửa đổi FREETRIAL-0047)
- Mục đích: chốt các trần cấu hình (theo task, theo IP, ngân sách ngày toàn web), thứ tự trạng thái, điều kiện được chấm thử (FR-11-030, 031), quan hệ với 0047 và G04 trước khi ai viết migration 371/471.
- Đầu vào: `specs/0047-free-trial-grading/spec.md` FR-001…FR-006, FR-014, FR-017; `plan.md` dòng 110–135, 319–345; `rollout.md`; file này 4 (FR-11-020…029), 5.2; tờ `ChamThuMienPhi`, `AdminCaiDat` mục 5, 8.
- Việc làm:
  1. Kiểm trạng thái 0047: `git log origin/staging --oneline -- backend/migrations/371_*` và `ls backend/migrations | grep ^371`. Có 371 → đường (b) của 5.2.1; chưa có → đường (a).
  2. Hỏi người điều phối: amendment ghi trong thư mục 0047 (theo cách repo sửa spec đã duyệt — xem `specs/README.md` mục về amendment) hay thư mục mới 0080. Mặc định: thư mục mới `specs/0080-free-trial-caps-settings/` có `spec.md` ghi rõ "thay FR-003 phần hạn mức, bổ sung FR-006 trạng thái" của 0047, và một PR nhỏ thêm dòng "Sửa đổi bởi TRIALCAP-0080" vào đầu `specs/0047-…/spec.md` (chỉ dòng này).
  3. Viết `spec.md`, `plan.md` (5.2), `tasks.md`, `verification.md`, `rollout.md`, `ui-states.md` (sáu trạng thái màn 7).
- Đầu ra: PR spec.
- Nghiệm thu: như T01; `verification.md` có ca đua đồng thời trần toàn web; spec ghi rõ env `TRIAL_*_PER_DAY`, `TRIAL_*_TOTAL` thôi dùng.
- Không làm: không đổi FR-001 (đối tượng dùng thử) của 0047; không đổi trần USD.
- Vướng mắc → cách gỡ: 0047 đang có PR mã mở chạm `fn_trial_reserve` → ghi đường (b) và báo PR đó; repo không cho sửa file spec đã duyệt → bỏ bước thêm dòng, chỉ để liên kết trong 0080.
- Ước lượng: 1 phiên · 3.

### G11-T03 — Spec PHONEGATE-0081
- Mục đích: chốt ngưỡng cấu hình, danh sách lối vào, hành vi giữa bài, ranh giới máy chủ.
- Đầu vào: file này 4 (FR-11-050…055), 5.4; tờ `ThanhPhanKhungTrang` mục 6, `ThiThu` ghi chú cuối, `ThiThuTruocGio`, `PhongThi` ghi chú 5; `GOI-08` mục 2 (bảng trình làm bài).
- Việc làm: như T01 bước 1, 2, 4, 5 với thư mục `specs/0081-full-test-phone-gate/` (`risk: medium`); `spec.md` liệt kê từng lối vào kèm file thật và endpoint tạo lượt; mục câu hỏi mở chép mục 10 câu 10–12.
- Đầu ra/Nghiệm thu/Không làm: như T01.
- Vướng mắc → cách gỡ: G08 chưa có `ExamRoom` → spec ghi hai giai đoạn (trang cũ trước, khung mới khi G08-T03 merge).
- Ước lượng: 1 phiên · 2.

### G11-T04 — Spec COURSETESTRELEASE-0082
- Mục đích: spec high-risk cho luồng trả điểm; đây là spec chủ dự án yêu cầu viết cụ thể nhất.
- Đầu vào: file này 4 (FR-11-060…075), 5.5; `specs/0043-…/spec.md`, `specs/0046-…/spec.md` FR-011, FR-012, FR-017–FR-019; `backend/services/quiz_service.py` các hàm ở mục 2; `backend/routers/admin_class_assignments.py` dòng 195–290, 930–1033; mig 270, 272, 276, 279, 280, 284, 285; tờ `KiemTraKhoa` (toàn bộ), `AdminLop` (thẻ Kết quả kiểm tra), `ThongBao`.
- Việc làm:
  1. Kiểm số như T01.
  2. Đọc trạng thái 0046: `head -12 specs/0046-quiz-server-check-key-release/spec.md` và `gh pr list --search 0046` (chỉ đọc). Ghi vào spec: phần nào dựa 0046 (FR-011 mở đáp án, FR-017 thu quyền đọc thẳng, FR-019 tổng phiên), phần nào gói này tự làm nếu 0046 chưa merge (5.5.2 "thu quyền đọc thẳng").
  3. `spec.md` (`risk: critical`): bảng trạng thái 5.5.3, bảng mức 5.5.4, bảng đường đọc 5.5.5 (mỗi đường một FR con), các ca biên mục 7; `plan.md`: 5.5 nguyên văn kèm thứ tự áp 473 → 474 (475, 476 ghi là hoãn); `rollout.md`: mặc định `COURSE_TEST_DEFAULT_RELEASE_MODE`, cách kiểm bài cũ không đổi.
  4. `ui-states.md`: màn KiemTraKhoa 1–8 theo trạng thái × mức.
- Đầu ra: PR spec; dừng chờ duyệt.
- Nghiệm thu: `validate_specs.py` 0 lỗi; mỗi dòng bảng 5.5.5 có test trong `verification.md`; mục câu hỏi mở có câu 13–18 của mục 10.
- Không làm: không sửa file của 0046; không viết mã.
- Vướng mắc → cách gỡ: 0046 được duyệt giữa chừng với khác biệt (ví dụ luật mở đáp án) → spec 0082 dẫn chiếu 0046 thay vì chép, và ghi chỗ khác; spec dài quá giới hạn review → tách `research.md` cho phần đọc mã.
- Ước lượng: 1 phiên · 4.

### G11-T05 — Spec BRANDMARK-0083
- Mục đích: chốt hình gốc, danh sách file sinh, test đổi có chủ ý, thứ tự sửa `aver-chrome.js`.
- Đầu vào: tờ `NhanDienLogo`, `NhanDienSocial`; file này 5.7.1–5.7.2; `frontend/tests/brand-favicon.test.mjs`; `frontend/app/manifest.ts`, `layout.tsx`.
- Việc làm: như T01 với `specs/0083-brand-mark-ank-ky/` (`risk: medium`); `spec.md` ghi rõ test `brand-favicon.test.mjs` được sửa có chủ ý và sửa những dòng nào.
- Đầu ra/Nghiệm thu/Không làm: như T01.
- Vướng mắc → cách gỡ: cần dependency sinh PNG → ghi câu hỏi mục 10 câu 19 vào spec, không tự thêm.
- Ước lượng: 1 phiên · 2.

### G11-T06 — Spec GRAMMARFIG-0084
- Mục đích: chốt lược đồ mười kiểu khối `figure`, quy tắc trợ năng, giới hạn mỗi bài. Lược đồ này sẽ được mở rộng bởi GRAMMAREDIT-0096 (GOI-13, G13-B01/B06); không làm trong T06. (sửa 18/11 theo GOI-13)
- Đầu vào: tờ `GrammarWikiMinhHoa`, `GrammarWikiBai`; `backend/services/grammar_learning_blocks.py`; `backend/tests/test_grammar_learning_blocks.py`; 5.7.4.
- Việc làm: như T01 với `specs/0084-grammar-wiki-figures/` (`risk: medium`); `plan.md` có lược đồ YAML từng kiểu kèm một ví dụ lấy từ tờ.
- Đầu ra/Nghiệm thu/Không làm: như T01.
- Vướng mắc → cách gỡ: một hình trong tờ không biểu diễn được bằng `parts` tuyến tính (ví dụ `clause-levels` lồng nhau) → cho `parts` lồng một cấp (`children`), không hơn.
- Ước lượng: 1 phiên · 2.

### G11-T07 — ĐÃ BỎ (sửa spec G04/G05 cho thư đơn)
- Lý do: GOI-04 và GOI-05 bản 18/11 đã ghi bốn thư ngay trong thân (GOI-04 mục 5.2, 5.11, 5.12; GOI-05 "Thay đổi so với bản 16/11"); spec COURSEACCESS-0055 và ENROLL-0060 soạn từ hai file đó nên không còn gì để sửa. GOI-04 mục 6 (G04-T00) ghi: nếu việc này đã mở PR riêng thì đóng.
- Ước lượng: 0 phiên.


### G11-T08 — Migration 470 thông báo
- Mục đích: lược đồ 5.1.1 có test PG17 và rollback.
- Đầu vào: `backend/migrations/README.md` (mục "Finding the next number"), `forward-policy.tsv`, mẫu chỉ ghi thêm `356_class_action_log_no_truncate.sql`, mẫu RPC + postcondition `334_*.sql`; `tests/test_migration_334_activate_attempt_rate_limit.py`; `tests/test_client_write_invariant_postgres.py`.
- Việc làm:
  1. Xin số (đề xuất 470). Không dùng 370–375.
  2. Viết `backend/migrations/470_learner_notifications.sql` (một giao dịch, `SET LOCAL lock_timeout='5s'`, idempotent, khối DO cuối kiểm RLS bật, không quyền client, ACL hàm, `search_path`).
  3. `backend/migrations/rollback/470_learner_notifications.sql`; dòng `forward-policy.tsv`; sửa hai câu "highest"/"next" trong README nếu test yêu cầu.
  4. `backend/tests/test_migration_470_learner_notifications.py`: (a) `fn_notify` cùng `dedupe_key` hai lần → `created` rồi `duplicate`; (b) hai sự kiện cùng group chưa đọc → một dòng `event_count=2`; (c) đọc rồi sự kiện mới → dòng mới; (d) `warning` không gộp; (e) 20 lời gọi song song cùng group → một dòng, `event_count=20`; (f) `authenticated` SELECT bảng → lỗi quyền; (g) `fn_notifications_purge`.
- Đầu ra: 1 PR migration + test.
- Nghiệm thu: `REQUIRE_PG=1 TEST_PG_URL=… python -m pytest backend/tests/test_migration_470_*.py backend/tests/test_client_write_invariant_postgres.py backend/tests/test_migration_forward_policy.py -q` pass; `cd backend && python -m pytest tests/ -q` pass.
- Không làm: không FK tới bảng của G04/E (bảng có thể chưa có).
- Vướng mắc → cách gỡ: bất biến client đỏ vì `PUBLIC` có EXECUTE mặc định → `REVOKE EXECUTE … FROM PUBLIC`; partial unique không làm đích `ON CONFLICT` được → dùng UPDATE-rồi-INSERT như 5.1.1 bước 2–3, bắt `unique_violation`.
- Ước lượng: 1 phiên · 4.

### G11-T09 — API thông báo, bộ đếm quá hạn và service nhắc dùng chung
- Mục đích: 5.1.2, 5.1.5.
- Đầu vào: `backend/routers/class_student.py` (dòng 268–330, 439–620), `backend/services/activation_gate.py`, `tests/test_activation_gate_inventory.py`, `backend/main.py` (cách include router học viên), `backend/routers/auth.py` dòng 1083–1160 (profile).
- Việc làm:
  1. `backend/services/learner_overdue.py` (5.1.5).
  2. `backend/services/notification_copy.py`: hàm `render(kind, params, event_count) -> (title, body, action_label)`; câu chữ tiếng Việt, xưng "bạn", không mã nội bộ; bảng câu chữ trong PR để người duyệt đọc.
  3. `backend/services/notifications.py` (đọc danh sách theo cursor `(last_event_at, id)`, summary, read, read-all, prefs).
  4. `backend/routers/notifications.py` + model trong `backend/models/notifications.py`, `response_model` khai đủ; include trong `main.py`; thêm route vào `ACTIVATION_EXEMPT_ROUTES` kèm lý do.
  5. Sinh lại `frontend/types/api.d.ts` theo lệnh G07 mục 7.
  6. Test `backend/tests/test_notifications_api.py`: người A không đọc/đánh dấu được của B (404); `read-all` idempotent; `summary.overdue` = số `is_missing` (dựng lớp giả có 2 bài quá hạn, 1 đã nộp, 1 bài một lượt đã đóng → 2); cờ `notifications_enabled` tắt → `unread: 0, overdue` vẫn tính (bộ đếm không phụ thuộc cờ thông báo — mục 10 câu 1 nếu anh muốn khác); người chưa kích hoạt gọi được.
- Đầu ra: 1 PR.
- Nghiệm thu: `cd backend && python -m pytest tests/test_notifications_api.py tests/test_activation_gate_inventory.py -q` pass; bộ đầy đủ pass.
- Không làm: không sửa `_visible_assignments`, `_decorate`.
- Vướng mắc → cách gỡ: import `routers.class_student` từ service gây vòng import → bọc trong hàm và import muộn bên trong hàm, như G07 mục 5.3; `_visible_assignments` cần `student` dict đầy đủ → đọc đúng cột như `GET /api/class/me` đang đọc.
- Ước lượng: 1 phiên · 3.

### G11-T10 — Job sinh thông báo và cron
- Mục đích: 5.1.3.
- Đầu vào: 5.1.3; `backend/scripts/staff_security_sweep.py`, `backend/railway.staff-security-sweep.json` (mẫu); bảng nguồn ở mục 2.
- Việc làm:
  1. `backend/scripts/notification_sweep.py` với các bước ở bảng 5.1.3 (trừ `course_release_schedule`); mỗi bước một hàm `step_<tên>(db, now, dry_run) -> dict`; bảng nguồn chưa tồn tại (G04, E) → bắt lỗi "relation does not exist", trả `{"skipped": "missing_table"}`.
  2. `backend/railway.notification-sweep.json` (`*/5 * * * *`, `restartPolicyType: NEVER`).
  3. Test `backend/tests/test_notification_sweep.py` dùng DB giả: mỗi bước sinh đúng `dedupe_key`; chạy hai lần không trùng; dời `due_at` → `due_soon` mới; học viên lớp không có `course_expiring`; một bước ném lỗi không chặn bước sau.
  4. Ghi trong PR: cần anh Andy tạo service cron trên Railway (không tự tạo).
- Đầu ra: 1 PR (2 phiên).
- Nghiệm thu: test pass; `python -m scripts.notification_sweep --dry-run` trên staging (khi được phép) in số đếm từng bước, không ghi dòng nào.
- Không làm: không gửi thư trong PR này (bước `broadcasts` chỉ ghi thông báo; thư ở T12/T13).
- Vướng mắc → cách gỡ: quét `class_assignment_items` toàn bảng chậm → lọc bằng `class_assignments` trước (index `idx_class_assignments_due_open` mig 177 có `due_at` cho bài published), rồi `in_` item theo lô 100 như `_sealed_course_session_ids`; `students.user_id` NULL (chưa kích hoạt) → bỏ, không lỗi.
- Ước lượng: 2 phiên · 4.

### G11-T11 — Chuông, thẻ quá hạn, ngăn, trang Thông báo
- Mục đích: 5.1.6.
- Đầu vào: tờ `ThongBao`, `ThanhPhanKhungTrang` mục 1–3; component G03 (`LearnerShell`, `Dialog variant="drawer"`, `Notice`, `PageState`); `frontend/lib/my-class-model.mjs`; danh mục trang G03/G07.
- Việc làm:
  1. Component 5.1.6 trong `frontend/components/notifications/`; hook `frontend/lib/notifications-client.ts`; `frontend/lib/notification-target-model.mjs`.
  2. Gắn vào `LearnerShell` qua slot (phối hợp phiên làm G03; nếu `LearnerShell` chưa có slot, PR nhỏ thêm prop `notificationsSlot?: ReactNode` vào G03 trước, theo quy tắc phiên trước làm trước).
  3. Trang `frontend/app/(authed-notifications)/notifications/page.tsx` + layout (`AuthedShell design="v2"`, không `activationGate`), lọc `?kind=`, "Đánh dấu đã đọc tất cả" chỉ bật khi còn chưa đọc.
  4. Test React: chuông không số khi 0; "9+" khi 12; thẻ quá hạn ẩn khi 0, có chữ "quá hạn"; bấm dòng gọi `/read` rồi điều hướng đúng href của `my-class-model`; Esc đóng ngăn và trả tiêu điểm về chuông; dưới 768px bấm chuông mở trang; polling dừng khi `visibilitychange` sang ẩn.
- Đầu ra: 1 PR (2 phiên).
- Nghiệm thu: `npm --prefix frontend run test:react` pass; `cd frontend && npx tsc --noEmit && npm run build` pass; ảnh 1280/768/390 đối chiếu tờ ThongBao đính vào PR (`[preview]`).
- Không làm: không thêm chuông vào `aver-chrome.js` (mục 10 câu 2); không hộp bật lên.
- Vướng mắc → cách gỡ: `route-auth-guard-inventory.test.mjs` đỏ vì route mới → thêm route đúng nhóm theo cách test đó mô tả; CSP chặn polling tới backend → `connect-src` dẫn từ runtime config đã gồm backend (`content-security-policy.mjs` dòng 5), kiểm bằng `npm run build` rồi mở trang.
- Ước lượng: 2 phiên · 3.

### G11-T12 — Cài đặt thư và thư tuỳ chọn
- Mục đích: FR-11-012, 5.1.4.
- Đầu vào: G04 `services/learner_email.py` (sau G04-T04); tờ `EmailMau` thư 9–13, `TaiKhoan`/`HoSoHocVien` (khối công tắc thư ở Hồ sơ — CHƯA KIỂM tờ nào vẽ khối này: `grep -l "Bài đã chấm xong" thiet-ke/*.dc.html`); migration 381 của G04 (CHECK của outbox đã có bốn mẫu `result_ready_digest`, `course_expired` (thêm 18/11), `course_expiring`, `staff_notice`).
- Việc làm: API prefs (đã có ở T09) nối vào màn Hồ sơ (G07-T17 — nếu chưa có màn mới thì thêm khối vào trang hồ sơ hiện tại, ghi rõ); bước `digests` trong `notification_sweep.py` gom `result_ready`/`course_test_released` theo cửa sổ và ghi outbox `result_ready_digest`; bước `course_expiring` (và cùng bước sweep đó: `course_expired`, thư 8 "Khoá đã hết hạn" của tờ EmailMau — thêm 18/11 theo rà soát, mặc định tạm 18/11, chờ anh Andy xác nhận) ghi outbox; ba mẫu thư văn bản + HTML; test: công tắc tắt → không ghi outbox; `users.notification_email=false` → không ghi; cờ tắt → không ghi; gộp 3 kết quả trong 30 phút → 1 thư.
- Đầu ra: 1 PR.
- Nghiệm thu: test pass; render mẫu không có "mua/bán/giá/đơn hàng", không band, không nội dung bài.
- Không làm: không gửi thư thật trên production.
- Vướng mắc → cách gỡ: G04-T01/T04 chưa merge → chưa có bảng outbox và dispatcher; PR này đợi, làm phần prefs trước trong PR riêng nếu cần. 381 đã merge theo bản cũ (CHECK thiếu ba mẫu của A) → báo người điều phối; phần chênh đi bằng migration mới trong dải của G04 (GOI-04 cuối mục 8), không dùng 472.
- Ước lượng: 1 phiên · 3.

### G11-T13 — Gửi thông báo của nhân sự
- Mục đích: FR-11-013, FR-11-014, 5.1.7.
- Đầu vào: tờ `AdminGiaoVienThongBao` (phần Gửi thông báo); `backend/routers/admin.py::require_instructor` (112); `backend/services/staff_scope.py` của G09-T24 (GOI-09 mục 5.4); khung admin G09; G09-T40 (nguồn "Danh sách đã chọn" đẩy sang trang này).
- Việc làm: router `admin_notifications.py`; giải người nhận (`cohorts` → `student_cohort_memberships` đang active → `students.user_id`; `learners` → kiểm từng id là học viên); bước `broadcasts` trong job gửi thông báo + thư (khi `channels` có `email`, cờ `notification_emails` bật, người nhận bật `staff_notice`); trang trong khung admin: soạn, xem trước số người nhận, hẹn giờ, lịch sử, huỷ; hộp xác nhận "gửi tất cả".
- Đầu ra: 1 PR (2 phiên: backend + giao diện).
- Nghiệm thu: test backend: giáo viên chọn lớp không của mình → 404 (quy ước `staff_scope`), giáo viên chọn `all` → 403; `all` thiếu `confirm_text` → 422; cùng `request_key` hai lần → một dòng; hẹn giờ huỷ trước giờ → không thông báo nào; `test_staff_guard_inventory.py` pass. Giao diện: bước bấm soạn → xem trước thấy đúng số → gửi → học viên thử thấy dòng trong chuông sau một chu kỳ job.
- Không làm: không cho đính kèm file, không HTML trong thân.
- Vướng mắc → cách gỡ: G09-T24 (`staff_scope`) chưa merge → bản đầu chỉ cho admin, giáo viên ẩn nút, nối `staff_scope` trong PR nhỏ sau; G09-T40 và nhiệm vụ này cùng sửa trang `/admin/notifications` → bên vào sau rebase, mỗi bên chỉ thêm khối của mình; số người nhận lớn (tất cả) → `fn_notify_batch` theo lô 500.
- Ước lượng: 2 phiên · 4.

### G11-T14 — Migration 471 và sửa hàm giữ chỗ chấm thử
- Mục đích: 5.2.1.
- Đầu vào: `specs/0047-…/plan.md` 110–135, 319–345; migration 371 (nếu đã có); spec 0080 đã duyệt; mẫu test đua đồng thời của G04 (`tests/test_migration_382_*`, nếu đã có) hoặc `tests/test_migration_334_*`.
- Việc làm:
  1. Xác định đường (a)/(b) (T02 bước 1).
  2. (a): sửa `backend/migrations/371_*.sql` trong PR của 0047 hoặc phối hợp phiên làm 0047 — gói này chỉ viết 471 gồm hai bảng cấu hình, cột thêm của `trial_usage`, index, seed, `fn_trial_caps_update` (ghi nhật ký vào `admin_settings_log` của migration 440, G09-T22). (b): 471 gồm thêm `CREATE OR REPLACE FUNCTION public.fn_trial_reserve` chép nguyên thân 371, chỉ thay phần kiểm lượt.
  3. Rollback giữ bảng; khôi phục thân hàm 371 (đường b).
  4. Test PG17 ở 5.2.1.
- Đầu ra: 1 PR (2 phiên).
- Nghiệm thu: test PG17 pass, gồm ca 20 lời gọi song song cho đúng số giữ chỗ mà ngân sách ngày còn đủ; bất biến client pass.
- Không làm: không đổi bước chống lạm dụng, trần USD, `request_key` của 0047.
- Vướng mắc → cách gỡ: hai khoá tư vấn trong một giao dịch gây chờ dài khi đông → đo bằng test 200 lời gọi; quá 2 s ở p95 trên PG cục bộ thì báo, không tự đổi thiết kế; `vn_day` tính sai múi giờ → dùng đúng biểu thức của 371 (`(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`), test ca 23:59 và 00:01.
- Ước lượng: 2 phiên · 5.

### G11-T14a — (mới 18/11 tối) Thực thi spec FREETRIAL-0047 (high-risk)
- Mục đích: chấm thử miễn phí (00 mục 2 điểm 11) chạy được: 0047 đã duyệt nhưng chưa có mã và trước đây không gói nào nhận viết mã (rà soát độ phủ 18/11, P-01).
- Đầu vào: `specs/0047-*/` (`spec.md`, `plan.md`, `tasks.md`; `CHƯA KIỂM` tên thư mục: `ls specs | grep 0047`); spec TRIALCAP-0080 đã duyệt (T02); 5.2 của gói này; tờ `ChamThuMienPhi`.
- Việc làm:
  1. **Việc đầu tiên:** kiểm trong repo đã có nhánh hoặc PR nào thực thi 0047 chưa (`git fetch && git branch -r | grep -i trial`, `gh pr list --state all --search "0047"`, `ls backend/migrations | grep '^371'`). Có phiên khác đang làm → dừng, báo anh Andy, không làm song song (câu chờ anh ở `04`).
  2. Không có: làm theo `tasks.md` của 0047 — migration 371, route `/api/trial/*`, màn `/trial/writing`, `/trial/speaking`; 371 chưa viết thì gộp thay đổi của 471 vào 371 theo 5.2.1 (a), và T14 chỉ còn phần chưa gộp.
- Đầu ra: 2 PR (backend + migration · màn `/trial/*`).
- Nghiệm thu: test của `tasks.md` 0047 và các ca trần ở 5.2 pass; không gọi AI trả phí trong test (grader giả); trên staging một tài khoản thử chưa từng có khoá online chấm thử được một bài Writing Task 2, lần thứ hai trong ngày bị chặn đúng câu.
- Không làm: không bật `free_trial_enabled` trên production; không gộp chấm thử vào sổ lượt (GOI-04 5.8).
- Vướng mắc → cách gỡ: `tasks.md` của 0047 khác 5.2 của gói (sau TRIALCAP-0080) → 0080 thắng phần trần; phần còn lại theo 0047, ghi chỗ khác trong PR.
- Ước lượng: 4 phiên · độ khó 5.

### G11-T15 — Trạng thái, cấu hình công khai và chặn khi nộp
- Mục đích: 5.2.2, 5.2.3 (ba route học viên và công khai).
- Đầu vào: router `/api/trial/*` của 0047 (CHƯA KIỂM tên file khi 0047 merge: `grep -rln "/api/trial" backend/routers`); `services/runtime_flags.py`.
- Việc làm: `backend/services/trial_caps.py` (`trial_state`, `trial_eligible` — provider `google` hoặc `email`, loại người từng có khoá online bằng `entitlements.has_ever_had_online_course` của G04, FR-11-030, 031); route Speaking chấm thử chỉ nhận Part 2; `GET /api/trial/public-config` (miễn cổng kích hoạt); mở rộng `status`; ánh xạ lý do RPC → 409 `trial_quota`/503; test: thứ tự ưu tiên (bảng chân trị 5 trạng thái × chồng nhau), cờ tắt → `paused`, đọc bảng lỗi → 503 và không gọi provider giả, đường chấm học viên có khoá không đọc `free_trial_caps` (đếm truy vấn như 0047 FR-002).
- Đầu ra: 1 PR.
- Nghiệm thu: `cd backend && python -m pytest tests/test_trial_caps.py tests/test_activation_gate_inventory.py -q` pass; bộ đầy đủ pass.
- Không làm: không đổi FR-001 của 0047 ngoài hai điểm ở FR-11-030, 031 (đã ghi trong amendment TRIALCAP-0080); không ghi, không đọc `credit_ledger`.
- Vướng mắc → cách gỡ: cache public-config làm admin đổi trần mà trang công khai trễ → chấp nhận ≤ 30 s, ghi trong spec; route 0047 chưa có → PR chờ, làm `trial_caps.py` + test trước; G04-T03 chưa merge → dùng `users.first_activated_at IS NULL` của 0047, đổi sang hàm G04 trong PR nhỏ sau (test có ca "từng có khoá online đã hết hạn → 403").
- Ước lượng: 1 phiên · 4.

### G11-T16 — `/admin/settings` thẻ Chấm thử
- Mục đích: 5.2.3 (route admin), 5.2.4 (trang).
- Đầu vào: tờ `AdminCaiDat` mục 5, 8, 9; khung admin G09 (`ADMIN_FRAME_V2`, sổ điều hướng `frontend/lib/admin-nav-registry.mjs` của G09); `backend/routers/admin_flags.py`.
- Việc làm: route `GET/PUT /admin/settings/trial`, `POST /admin/settings/trial/pause`; trang `frontend/app/(authed-admin-settings)/admin/settings/page.tsx` với thẻ `?tab=`; thêm "Cài đặt" vào nhóm Hệ thống trong sổ điều hướng G09; hộp xác nhận liệt kê cũ → mới; nhật ký.
- Đầu ra: 1 PR.
- Nghiệm thu: test backend: ràng buộc FR-11-020 trả 422 tiếng Việt; lưu ghi một dòng log; người không phải admin → 403; test React: nhập `per_user_daily > per_user_total` → lỗi dưới ô, nút Lưu không gửi; bước bấm trên staging: đổi trần ngày của Writing Task 2 → lần nộp kế tiếp của tài khoản thử theo trần mới.
- Không làm: không dựng nội dung sáu thẻ khác (G09-T23); không tạo router `/admin/settings` thứ hai nếu G09-T22 đã có — thêm route `trial` vào router đó.
- Vướng mắc → cách gỡ: G09 chưa có khung mới → đặt trang trong khung admin cũ hiện có và ghi rõ, không dựng khung riêng; `test_staff_guard_inventory.py` đỏ → guard là lệnh await đầu.
- Ước lượng: 1 phiên · 3.

### G11-T17 — Sáu trạng thái trong các màn chấm thử (thu hẹp)
- Mục đích: tờ ChamThuMienPhi màn 2, 7 theo dữ liệu thật. **Lối vào ở trang chủ (màn 1) và mục "Chấm thử" trong menu công khai thuộc G05-T21** (GOI-05 FR-05-021); nhiệm vụ này không sửa trang chủ, `PublicTopNav` hay trang Thư viện.
- Đầu vào: tờ `ChamThuMienPhi`; trang chấm thử của 0047 (CHƯA KIỂM route khi 0047 merge: `ls frontend/app | grep -i trial`); `public-config`, `status`.
- Việc làm: trong các màn `/trial/*`: màn 7 hiện đúng một trong sáu trạng thái theo `status.state` (thêm `ip_total_exhausted` với lý do và lối liên hệ/xác minh); bộ đếm ở thanh trên theo ba hạng mục (Task 1, Task 2, Part 2); "Đây là lượt miễn phí cuối hôm nay" khi còn 1; chọn Speaking chỉ có Part 2.
- Đầu ra: 1 PR.
- Nghiệm thu: test React sáu trạng thái + thứ tự ưu tiên; không hiện số tiền, không đếm ngược, không hộp bật lên.
- Không làm: không đổi màn viết, ghi âm, kết quả của 0047; không dựng lối vào ở trang công khai (G05-T21).
- Vướng mắc → cách gỡ: câu chữ tờ ghi XXX → lấy số từ API, không ghi cứng; cách xác minh cho người bị chặn vì dùng chung IP chưa chốt (mục 10 câu 26) → màn chỉ nêu lý do và kênh liên hệ lấy từ `site-info` của G05-T23.
- Ước lượng: 1 phiên · 3.


### G11-T18 — ĐÃ BỎ (thư đơn và thư nhắc; migration 472)
- Lý do: bốn mẫu thư đơn, CHECK của outbox (gồm ba mẫu của phần A), RPC nhắc `fn_enrollment_order_pay_reminders`, bước nhắc trong sweep và việc kiểm lại trạng thái lúc gửi đã nằm trong G04-T01, T02, T04 (migration 381/382; GOI-04 mục 5.11, 5.12 và cuối mục 8). Câu chữ và bản `.html`: G05-T14. Số 472 để trống.
- Ước lượng: 0 phiên.


### G11-T19 — Thư viện cổng, màn chặn và `/tests`
- Mục đích: 5.4 (module, hook, component); FR-11-050, 054.
- Đầu vào: tờ `ThanhPhanKhungTrang` mục 6, `ThiThu` ghi chú cuối; `frontend/public/js/runtime-config.js`.
- Việc làm: `full-test-device-gate.mjs` + test node `frontend/tests/full-test-device-gate.test.mjs` (767 → blocked, 768 → allowed, cấu hình 800 → 799 blocked, cấu hình hỏng → 768); hook; `full-test-phone-block.tsx` (có dòng phụ tiếng Việt `lang="vi"`, prop `viNote`), `full-test-narrow-notice.tsx`; thêm khoá `fullTestMinViewportPx` vào runtime config; nối vào trang `/tests` (nếu G07 đã có) hoặc trang danh sách thi thử hiện có (`(authed-full-test)` / `(authed-mock-exam)` — ghi rõ trong PR).
- Đầu ra: 1 PR.
- Nghiệm thu: test node + React pass; bước bấm: Chrome DevTools 390×844 mở trang danh sách thi thử → không có nút vào full test, thấy dòng Cảnh báo, nút vào mini test vẫn có; 820×1180 → có nút.
- Không làm: không đổi backend.
- Vướng mắc → cách gỡ: SSR không biết độ rộng → hook trả `measuring`, nút vào thi chỉ render sau đo (tránh nhấp nháy bằng chỗ giữ cùng kích thước); trình duyệt phóng to (zoom) làm `innerWidth` nhỏ hơn 768 trên máy tính → đúng là bị chặn (thước là CSS px), ghi vào trợ giúp.
- Ước lượng: 1 phiên · 3.

### G11-T20 — Nối cổng vào các phòng thi
- Mục đích: FR-11-050…053, 055 cho mọi lối vào ở 5.4.
- Đầu vào: các file trang ở 5.4; `GOI-08` mục 2 và 5.1 (`ExamRoom`).
- Việc làm: với mỗi lối vào: đặt `ExamEntryGate` bọc trước mọi effect tạo lượt; kiểm và ghi bảng trong PR: file · endpoint tạo lượt · tạo khi mở trang hay khi bấm · đã gate trước chưa; thêm `narrowDuringAttempt` → dải nhắc; journey trình duyệt hiện có cho từng trình chạy lại (`frontend/tooling/verify-*-flow.mjs` liên quan, theo bảng G08 mục 9).
- Đầu ra: 1 PR.
- Nghiệm thu: test React mỗi lối vào: độ rộng 390 → không có lời gọi `fetch` tới endpoint tạo lượt (mock fetch đếm 0); 1024 → có; mini test ở 390 → vào được (có lời gọi tạo lượt); lượt đang chạy rồi đổi 1024 → 390 → không điều hướng, không gọi submit, dải nhắc hiện.
- Không làm: không gate mini test, chế độ luyện, bài giao luyện, bài kiểm tra của khoá.
- Vướng mắc → cách gỡ: trình tạo lượt ngay trong render đầu (không phải effect) → tách lời gọi vào effect sau gate, kèm test cũ của trình phải xanh; endpoint tạo lượt không idempotent → ghi `CHƯA AN TOÀN`, báo người điều phối, không sửa backend ở PR này.
- Ước lượng: 1 phiên · 3.

### G11-T21 — Migration 473: lược đồ công bố và thu quyền đọc thẳng
- Mục đích: 5.5.2.
- Đầu vào: mig 177, 189, 270, 272, 280, 284, 285; spec 0082 đã duyệt; trạng thái 0046.
- Việc làm:
  1. Xin số 473. Đọc định nghĩa mới nhất của mọi trigger trên `class_assignment_items` (`grep -n "TRIGGER.*class_assignment_items\|ON public.class_assignment_items" backend/migrations/*.sql`) để trigger khoá chế độ không xung đột thứ tự.
  2. Viết 473 theo 5.5.2; khối thu quyền đọc thẳng có điều kiện (`IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename='quiz_attempts' AND policyname='quiz_attempts_select')`).
  3. Rollback; `forward-policy.tsv`; test PG17 `test_migration_473_course_test_release.py`: CHECK chế độ chỉ cho `single_attempt`; nộp item đầu → `release_mode_locked_at` có; đổi chế độ sau đó → lỗi `release_mode_locked`; chèn mức thấp hơn → lỗi; UPDATE/DELETE dòng công bố → lỗi; `authenticated` SELECT `quiz_attempts` → lỗi quyền; bài NULL không bị trigger đụng.
- Đầu ra: 1 PR.
- Nghiệm thu: test PG17 pass; `test_client_write_invariant_postgres.py` pass; bộ backend đầy đủ pass (đặc biệt test đang dựa `quiz_attempts_select` — nếu có test dựa policy này, liệt kê và dừng hỏi, không sửa hàng loạt).
- Không làm: không đổi `quiz_attempts` ngoài policy/grant; không backfill chế độ cho bài cũ.
- Vướng mắc → cách gỡ: client nào đó đọc thẳng `quiz_attempts` (grep 5.5.2 có kết quả) → dừng, báo (0046 FR-017 cùng điều kiện); trigger AFTER UPDATE trên item làm chậm `course_verdict` → đo số truy vấn trong test hiện có, chỉ chạy khi `result_release_mode IS NOT NULL` nhờ WHERE.
- Ước lượng: 1 phiên · 5.

### G11-T22 — Cổng máy chủ trên mọi đường đọc của học viên
- Mục đích: 5.5.4–5.5.6; FR-11-063, 064, 070, 074.
- Đầu vào: `backend/services/quiz_service.py` (các hàm ở bảng 5.5.5), `backend/routers/quiz.py`, `backend/routers/class_student.py`, `backend/routers/kp.py`; spec 0046 FR-011, FR-019.
- Việc làm:
  1. `backend/services/course_result_release.py`: `course_test_state`, `result_gate`, `course_test_block` (khối 5.5.6), hàm đọc release theo lô.
  2. Sửa từng điểm ở bảng 5.5.5; mỗi điểm một commit, cùng PR.
  3. Mở rộng `_sealed_course_session_ids` gọi `result_gate` (một nơi quyết niêm phong).
  4. Test `test_course_result_release_no_leak.py` (5.5.5) + test hồi quy: bài NULL và bài `mastery` trả đúng như trước (so phản hồi trước/sau trên cùng dữ liệu giả), số truy vấn ở `log_progress` cho bài không gate không tăng.
- Đầu ra: 1 PR (2 phiên).
- Nghiệm thu: `cd backend && python -m pytest tests/test_course_result_release_no_leak.py tests/test_quiz_service.py -q` pass; bộ đầy đủ pass; `-k "course or quiz"` không có test bị bỏ qua mới.
- Không làm: không đổi cách chấm, không đổi điểm lưu ở item, không đổi đường admin.
- Vướng mắc → cách gỡ: một hàm trả điểm qua nhiều lớp (verdict → payload → hàm phụ) → gate ở lớp cuối trước `return` của route, không rải trong lõi chấm; 0046 merge giữa chừng và đã sửa cùng hàm → rebase, dùng hàm niêm phong của 0046 làm lớp trong, gate công bố là lớp ngoài; test hiện có ghim khoá `score` trong `_decorate` → giữ khoá với giá trị `null` (không xoá khoá) để test cũ đọc được.
- Ước lượng: 2 phiên · 5.

### G11-T23 — Migration 474 và API chế độ, công bố, hẹn giờ
- Mục đích: 5.5.7, 5.5.8 (trừ `late-until`, `retakes`).
- Đầu vào: `admin_class_assignments.py` dòng 195–290, 930–1033, 1648–2011, 2742–2950; tờ `KiemTraKhoa` mục 7, `AdminLop`.
- Việc làm: migration 474 + test PG17 (hai giáo viên cùng bấm công bố → một dòng mỗi item; lặp `request_key` → cùng kết quả; hẹn giờ chỉ công bố bài nộp trước giờ); sửa `AssignmentCreate` + kiểm; route `release-mode`, `release`, `release-schedule`; `tally` thêm trường; config `COURSE_TEST_DEFAULT_RELEASE_MODE` (env, mặc định `immediate` — mục 10 câu 13) dùng cho giá trị chọn sẵn trên giao diện, **không** tự gán cho bài khi admin không gửi trường.
- Đầu ra: 1 PR.
- Nghiệm thu: test backend + PG17 pass; `test_staff_guard_inventory.py` pass; tạo bài giao mastery với `result_release_mode` → 400.
- Không làm: không gửi thông báo trong RPC.
- Vướng mắc → cách gỡ: RPC giao bài nguyên tử hiện có ghi `content_config` — cột mới phải truyền vào RPC đó (CHƯA KIỂM tên hàm tạo bài: `grep -n "rpc(" backend/routers/admin_class_assignments.py`) hoặc UPDATE ngay sau trong cùng lệnh gọi; chọn cách đổi RPC nếu RPC đang là nơi duy nhất ghi bài giao.
- Ước lượng: 1 phiên · 4.

### G11-T24 — Bước hẹn giờ trong job và thông báo công bố
- Mục đích: FR-11-067, 068.
- Đầu vào: T10, T23.
- Việc làm: bước `course_release_schedule` (gọi `fn_course_result_run_schedules(200)`) chạy **trước** bước `course_test_released` trong `notification_sweep.py`; test: hẹn 10:00, item A nộp 09:50, B nộp 10:03 → sau job lúc 10:05 A `released`, B `awaiting_release`, một thông báo cho A; nâng mức A → thông báo thứ hai.
- Đầu ra: 1 PR.
- Nghiệm thu: test pass.
- Không làm: không chạy công bố trong request của học viên.
- Vướng mắc → cách gỡ: job trễ (cron 5 phút) → học viên thấy kết quả trễ tối đa 5 phút sau giờ hẹn; ghi trong spec, không dựng cron thứ hai.
- Ước lượng: 1 phiên · 3.

### G11-T25 — Nộp trễ và vắng (migration 475)
- Mục đích: FR-11-071, 072; 5.5.9.
- Đầu vào: định nghĩa mới nhất của các hàm liệt kê ở 5.5.9; `quiz_service.py` dòng 2058–2175, 3299–3348, 5596–5973.
- Việc làm: đọc và lập bảng mọi chỗ dùng `due_at` trong các hàm (ghi vào PR); migration 475 `CREATE OR REPLACE` từng hàm với mốc `coalesce(late_until, due_at)`; sửa Python tương ứng; route `PATCH …/late-until`; trạng thái `absent` và `late_minutes` trong `course_test_state`; tally đếm vắng.
- Đầu ra: 1 PR (2 phiên).
- Nghiệm thu: test PG17: bài có giờ 60 phút, `due_at` 21:00, `late_until` 21:30, bắt đầu 20:50 → mốc cắt 21:30 (không phải 21:00 hay 21:50); không có `late_until` → hành vi y như trước (test cũ của 272/280 xanh không sửa); vắng không có điểm, `pct` lớp tính trên người đã nộp.
- Không làm: không cho lùi `late_until` sau khi bài có người bắt đầu.
- Vướng mắc → cách gỡ: điều kiện dừng ở 5.5.9; test cũ ghim chuỗi lỗi "hạn" → giữ nguyên chuỗi khi không có `late_until`.
- Ước lượng: 2 phiên · 5.

### G11-T26 — Làm bù và làm lại
- Mục đích: FR-11-073; route `retakes`.
- Đầu vào: kiểm trùng bank quanh dòng 986–998 của `backend/routers/admin_class_assignments.py` (`grep -n "409" backend/routers/admin_class_assignments.py | sed -n 1,8p`); RPC giao bài; `course_test_state` (chuỗi `retake_of`).
- Việc làm: route `POST …/retakes` tạo bài giao mới (`student_ids`, `retake_of`, `retake_kind`, hạn mới) qua cùng đường giao bài (không viết đường ghi thứ hai); bỏ qua kiểm trùng khi có `retake_of`; khối `course_test` trả `attempt_kind` và `root_assignment_id`; danh sách bài của học viên chỉ hiện lượt mới nhất của chuỗi, lượt cũ mở được bằng đường dẫn riêng; migration 476 chỉ khi có ràng buộc CSDL chặn trùng (5.5.10).
- Đầu ra: 1 PR.
- Nghiệm thu: test: makeup cho người không vắng → 409; retake trước khi người đó có kết quả → 409; chuỗi 3 lượt → danh sách hiện lượt 3, report lượt 1 vẫn đọc được (theo mức công bố của lượt 1).
- Không làm: không xoá hay sửa item của lượt cũ.
- Vướng mắc → cách gỡ: tally và báo cáo 0043 đếm theo bài giao → mỗi lượt là bài giao riêng, giao diện giáo viên gom theo `retake_of` (T28); `unactivated_count` của RPC giao bài tính lại cho nhóm nhỏ — giữ nguyên.
- Ước lượng: 1 phiên · 4.

### G11-T27 — Màn học viên của bài kiểm tra
- Mục đích: tờ KiemTraKhoa mục 1–6, 8 theo khối `course_test`.
- Đầu vào: tờ `KiemTraKhoa`; trình làm bài Course hiện có (CHƯA KIỂM file: `ls frontend/app | grep -i course-exercises` và `grep -rln "course-timer" frontend/app frontend/lib | head`); component G03; Lộ trình G07-T15.
- Việc làm: màn trước khi làm (hộp xác nhận), màn chờ công bố, màn đã công bố theo mức, vắng, chưa mở (đếm ngược theo giờ máy chủ); nộp trễ và làm lại hoãn cùng T25, T26 nên không hiện nút; component màn kết quả nhận prop `preview` để G09-T30 dựng lại ở "Xem như học viên thấy"; báo cáo theo buổi (0043) chỉ khi mức ≥ 2; "Xem lại từng câu" chỉ khi mức ≥ 2, đáp án chỉ khi mức 3 và `answers_release_at` đã qua; câu chữ tiếng Việt (bài kiểm tra của khoá **không** dùng phòng thi tiếng Anh); bản 390px theo mục 8 của tờ.
- Đầu ra: 1 PR (2 phiên).
- Nghiệm thu: test React mỗi trạng thái × mức theo dữ liệu giả của khối `course_test`; không bao giờ hiện "0/0" hay band; ảnh 1280/390 đính PR.
- Không làm: không đổi trình làm bài (đồng hồ, lưu từng câu) ngoài phần hiện trạng thái.
- Vướng mắc → cách gỡ: trình làm bài cũ là JS trong `public/js` → chỉ thêm màn trạng thái ở trang React bao ngoài, ghi rõ; dữ liệu theo buổi thiếu (đề không gắn buổi) → ẩn bảng theo buổi, không hiện 0% (tờ ghi chú 6).
- Ước lượng: 2 phiên · 3.

### G11-T28 — ĐÃ BỎ (bảng công bố phía giáo viên)
- Lý do: trùng G09-T30. G09-T30 dựng giao diện bảng công bố theo tờ `KiemTraKhoaGiaoVien` (route `/admin/classes/[cohortId]/assignments/[assignmentId]/release`); ô "Chế độ trả điểm" lúc giao bài nằm trong `AssignDrawer` của G09-T26; khoá chế độ sau bài nộp đầu cũng hiện ở G09-T30. Gói này giữ **backend phần E**: migration 473, 474 và API ở 5.5.8 (T21–T24), gồm `tally` mở rộng. Câu "không thêm API đọc thứ tư" của bản 17/11 bỏ (G09-T27 thêm `result`).
- Ước lượng: 0 phiên.


### G11-T29 — Tên sáu khoá và nhãn "Đăng ký lại"
- Mục đích: 5.6.
- Đầu vào: 00 mục 2 điểm 2, 14; G04 `/admin/course-products` (G04-T05).
- Việc làm: `frontend/lib/course-access-labels.mjs` + test; thay chỗ dùng ở các màn đã có (grep "Đăng ký khoá này", trạng thái `expired`); hằng backend; nhập sáu khoá trên staging bằng API admin (ghi payload, không token); ghi trong PR danh sách tên đã nhập.
- Đầu ra: 1 PR + dữ liệu staging.
- Nghiệm thu: `node --test frontend/tests/course-access-labels.test.mjs` pass; `GET /api/courses` trên staging trả sáu khoá đúng tên, `coming_soon`.
- Không làm: không nhập học phí/thời hạn/lượt (chưa chốt); không nhập trên production.
- Vướng mắc → cách gỡ: G04-T05 chưa merge → làm phần module nhãn trước, dữ liệu sau; tiêu đề có hay không chữ "Khoá" → theo mục 10 câu 23, mặc định tạm như cột "title" ở đó.
- Ước lượng: 1 phiên · 2.

### G11-T30 — Logo, favicon, icon ứng dụng, manifest
- Mục đích: 5.7.1; FR-11-110, 111.
- Đầu vào: tờ `NhanDienLogo` (mục 2 Hướng 1, mục 3), `frontend/tests/brand-favicon.test.mjs`, `frontend/app/manifest.ts`, `layout.tsx`, `aver-chrome.js` (~438), `aver-admin-chrome.js` (697–698).
- Việc làm: như 5.7.1, theo thứ tự: hình gốc → script sinh → file sinh → component → manifest/layout → sửa test → khung mới → khung cũ (nếu tới lượt theo 01 mục 3, không thì PR sau).
- Đầu ra: 1 PR.
- Nghiệm thu: `node frontend/tooling/build-brand-assets.mjs --check` thoát 0; bộ test hợp đồng frontend pass (gồm `brand-favicon.test.mjs` đã sửa, `next-metadata.test.mjs`); `curl -s http://localhost:3100/manifest.webmanifest` (sau `npm run build && npx next start -p 3100`) có 4 icon; ảnh favicon 16/32 đính PR.
- Không làm: không xoá tài liệu cũ trong `docs/brand/` (giữ làm lưu trữ).
- Vướng mắc → cách gỡ: test ghim chuỗi `icons: { icon: '/favicon.svg' }` vỡ → sửa đúng dòng đó, ghi lý do; thiếu thư viện sinh PNG → dừng phần PNG, giữ SVG, hỏi (mục 10 câu 19).
- Ước lượng: 1 phiên · 3.

### G11-T31 — Ảnh OG theo route và PNG social
- Mục đích: 5.7.2; FR-11-112.
- Đầu vào: tờ `NhanDienSocial` mục 1–3; `layout.tsx` dòng 19–55; `frontend/tests/next-metadata.test.mjs`; route thật của G05, G06.
- Việc làm: `opengraph-image.tsx` cho trang chủ và các segment đã tồn tại lúc làm (segment chưa có → để lại danh sách cho G05/G06); font nhúng; `--social` xuất PNG.
- Đầu ra: 1 PR.
- Nghiệm thu: `npm run build` pass; `curl -sI http://localhost:3100/opengraph-image` → `200 image/png`; HTML trang chủ có `og:image` tuyệt đối `https://averlearning.com/...`; test metadata pass.
- Không làm: không đổi `og:title/description`.
- Vướng mắc → cách gỡ: `ImageResponse` không có font tiếng Việt → nạp file TTF Source Serif 4/Source Sans 3 trong repo (subset đủ dấu); thêm `opengraph-image` vào segment làm segment mất `openGraph` kế thừa (bẫy merge nông) → kiểm `og:title` từng trang mẫu.
- Ước lượng: 1 phiên · 3.

### G11-T32 — Bộ 94 icon
- Mục đích: 5.7.3; FR-11-113.
- Đầu vào: `thiet-ke/ThanhPhanNenTang.dc.html` (`iconGroups`, mục "Đang lệch"); G03-T02/T03.
- Việc làm: như 5.7.3; test React render mỗi `IconName` (đếm đúng 94 tên), `title` → `role="img"`; trang `/ui-library` (G03) thêm lưới icon theo nhóm.
- Đầu ra: 1 PR (2 phiên).
- Nghiệm thu: `npm --prefix frontend run test:react` pass; `npm run build` pass; bundle trang dùng icon không có `lucide.min.js`.
- Không làm: không thay emoji ở trang cũ (mục 10 câu 21).
- Vướng mắc → cách gỡ: đếm ra khác 94 (tờ tính bằng `iconTotal` từ `count` từng nhóm, có thể lệch số phần tử thật) → lấy theo phần tử thật, ghi chênh lệch trong PR; tên trùng nghĩa với icon lucide đã dùng ở component G03 → giữ tên cũ làm bí danh.
- Ước lượng: 2 phiên · 3.

### G11-T33 — Renderer khối `figure` và CSS
- Mục đích: 5.7.4; FR-11-114. G13-B06 (GOI-13) thêm renderer cho phần mở rộng, làm sau T33 (sửa 18/11 theo GOI-13).
- Đầu vào: `backend/services/grammar_learning_blocks.py`, `grammar_content.py` dòng 300–380, `backend/tests/test_grammar_learning_blocks.py`, `test_anchor_drift.py`; tờ `GrammarWikiMinhHoa`, `GrammarWikiBai`; `page-shell.tsx`.
- Việc làm: kiểu `figure` với mười lược đồ; đánh số; giới hạn 4; CSS; test backend mỗi kiểu (khối đúng → HTML có `role="img"`, `aria-label`, `lang="en"`, `Hình N`; chuỗi có `<script>` → bị escape; khối sai → bị bỏ, có cảnh báo, bài vẫn render); test frontend hợp đồng không cần (HTML do backend dựng).
- Đầu ra: 1 PR (2 phiên).
- Nghiệm thu: `cd backend && python -m pytest tests/test_grammar_learning_blocks.py tests/test_grammar_content_render_fixes.py tests/test_anchor_drift.py -q` pass; mở một bài thử local thấy hình đúng tờ ở 1280 và 390.
- Không làm: không đổi năm kiểu khối cũ; không thêm thư viện Markdown.
- Vướng mắc → cách gỡ: CSS bài đọc đang do G06-T07 dựng lại → xếp hàng sau PR đó hoặc đặt file CSS riêng chỉ nạp ở trang bài Grammar; HTML được làm sạch ở frontend (nếu có bộ lọc thẻ/thuộc tính) → CHƯA KIỂM: `grep -rn "sanitize\|DOMPurify" frontend/app/(public-content)/grammar frontend/lib | head`; có thì thêm `figure`, `figcaption`, `role`, `aria-label`, `lang` vào danh sách cho phép.
- Ước lượng: 2 phiên · 4.

### G11-T34 — Nội dung sơ đồ thí điểm
- Mục đích: năm bài có sơ đồ thật để anh Andy duyệt hướng.
- Đầu vào: T33; danh sách bài (mục 10 câu 22); tờ `GrammarWikiMinhHoa`.
- Việc làm: thêm khối `figure` vào năm file `backend/content/<category>/<slug>.md`; mỗi hình một câu ví dụ đúng ngữ pháp, `alt_vi` đọc thành câu.
- Đầu ra: 1 PR content.
- Nghiệm thu: test backend Grammar pass; không đổi anchor; ảnh từng bài đính PR.
- Không làm: không sửa văn bài ngoài chỗ đặt khối và câu dẫn "(Hình N)".
- Vướng mắc → cách gỡ: bài thuộc `_archive` → chọn bài khác; câu ví dụ lấy từ bài đã có để không phát sinh nội dung chưa duyệt.
- Ước lượng: 1 phiên · 2.

### G11-T35 — Áp staging và nghiệm thu đầu-cuối cả gói
- Mục đích: bằng chứng trên staging cho mục 9; cập nhật `verification.md` của các spec.
- Đầu vào: các nhiệm vụ đã merge; phê duyệt chạy migration của anh Andy.
- Việc làm: `DRY_RUN=1 ./backend/scripts/apply_migrations.sh "$STAGING_DB_URL"` xem danh sách; áp khi được duyệt; truy vấn chỉ đọc kiểm RLS/ACL bảng mới; chạy job `--dry-run` rồi thật trên staging; chạy kịch bản mục 9 bằng tài khoản thử; PR cập nhật `verification.md`, `tasks.md`.
- Đầu ra: 1 PR tài liệu + bằng chứng.
- Nghiệm thu: mọi kịch bản mục 9 có lệnh + đầu ra hoặc bước bấm + ảnh; test RLS live ghi rõ "skip vì thiếu credential" nếu xảy ra, không tính là pass.
- Không làm: không bật cờ nào trên production; không tạo service cron trên production.
- Vướng mắc → cách gỡ: thiếu biến môi trường RLS → `bash backend/scripts/setup_phase_d_test_env.sh` như G04-T11; không được phép chạy → báo bị chặn, làm phần kiểm local.
- Ước lượng: 1 phiên · 3.

## 7. Vướng mắc chung của gói và cách tháo gỡ

| Tình huống | Dấu hiệu nhận biết | Cách gỡ | Khi nào dừng và hỏi |
|---|---|---|---|
| Số spec/migration đã bị giữ | `ls specs`, PR mở có `backend/migrations/47*` | Số theo bảng `01-KE-HOACH-TONG.md` mục 6 (anh Andy là người duy nhất vận hành repo); trùng thì lấy số trống kế tiếp trong dải 470–479 (không dùng 472 cho việc khác), đổi tên file + forward-policy + README + sổ đăng ký cùng lúc | Hết số trong dải → báo anh Andy |
| 0047 chưa có mã khi tới B | không có `/api/trial/*`, không có 371 | Làm T14 đường (a), T15 phần service; giao diện chờ | Người thực thi 0047 đang sửa `fn_trial_reserve` cùng lúc → hỏi người điều phối thứ tự |
| 0046 chưa duyệt khi tới E | `status: draft` | E tự thu quyền đọc thẳng (5.5.2), luật mở đáp án ở mức `full` dùng `due_at`/cả lớp như 0046 FR-011 viết, ghi trong spec 0082 | 0046 được duyệt với luật khác → theo 0046 |
| Lộ điểm qua đường chưa liệt kê | test không lộ đỏ ở route mới, hoặc người thực thi thấy route trả `score` không có trong 5.5.5 | Thêm vào bảng 5.5.5 và test trong cùng PR | Route đó là của admin nhưng học viên gọi được → dừng báo (lỗi quyền) |
| Đổi `_decorate` vỡ test ghim | test frontend/backend ghim `score` | Giữ khoá, trả `null`; thêm `course_test` | Quá 30 test đỏ ngoài dự kiến → dừng, báo danh sách |
| Trigger mới đụng RPC bài có giờ | test 270/276/279/280 đỏ | Đọc thứ tự khoá trong RPC; trigger chỉ UPDATE `class_assignments` khi `result_release_mode IS NOT NULL` | Có khoá chéo (deadlock) trong test đua → dừng |
| Bảng nguồn của job chưa có | lỗi "relation does not exist" | Bước trả `skipped: missing_table` | — |
| G04 đổi tên trường/sự kiện | bước `enrollment_order`, `credits_granted` không sinh dòng | Theo GOI-04 bản mới nhất (mục 5.3, 5.12, 5.15); sửa truy vấn nguồn và test trong cùng PR | — |
| Hai gói cùng sửa một trang admin | xung đột ở `/admin/settings` (G09-T23), `/admin/notifications` (G09-T40) | Bên vào sau rebase; mỗi bên chỉ thêm thẻ/khối của mình | — |
| G09-T30 cần API phần E trước khi có | G09 báo dừng ở T30 | Ưu tiên T21 → T23; `tally` mở rộng nằm trong T23 | — |
| Học viên có nhiều hồ sơ `students` | bộ đếm quá hạn thiếu/thừa | Gộp mọi hồ sơ theo `user_id` | Không rõ hồ sơ nào là "đang học" → hỏi |
| Cổng kích hoạt chặn route thông báo | 403 cho người chưa kích hoạt | Thêm vào `ACTIVATION_EXEMPT_ROUTES` kèm lý do | Muốn miễn trừ route có ghi dữ liệu ngoài `read`/`read-all`/prefs → hỏi |
| Cron chưa có trên Railway | thông báo không sinh, thư không đi | Chạy tay `python -m scripts.notification_sweep`; báo "đã có ở nhánh, chưa chạy định kỳ" | — |
| hai phiên thực thi sửa `aver-chrome.js`, `next.config.ts`, `grammar_learning_blocks.py` | xung đột merge | Theo thứ tự 01 mục 3; phiên sau rebase | — |
| Tờ thiết kế và yêu cầu 17/11 khác nhau | ví dụ dải nhắc giữa bài thi | Theo yêu cầu 17/11, ghi chỗ khác trong PR | Mục 10 có câu tương ứng chưa trả lời và hành vi khó đổi về sau → hỏi |
| Test gọi mạng | `tests/test_suite_makes_no_live_calls.py` đỏ | Resend, Supabase qua giả | — |

## 8. Ràng buộc riêng của gói

- Không sửa migration cũ; mọi thay đổi CSDL là migration mới trong dải 470–479 (472 không dùng). Gói này không sửa 381–388 của G04 và 440–451 của G09.
- Không viết mã gửi thư đơn, không dựng bảng công bố phía giáo viên, không dựng lối vào chấm thử trên trang công khai: ba việc đó thuộc G04, G09-T30, G05-T21.
- Không đổi cách chấm, điểm lưu, hay đường admin của bài kiểm tra; phần E chỉ đổi ai đọc được gì.
- Ở chế độ công bố, che ở giao diện không bao giờ là đủ: mọi trường ở 5.5.4 phải vắng khỏi phản hồi máy chủ; test 5.5.5 là cổng merge của T22.
- Mọi cờ mới mặc định tắt (`notifications_enabled`, `notification_emails`); production không bật cờ nào trong gói; `free_trial_enabled` theo rollout 0047.
- Không ghi email, tên, số tiền, mã đơn, nội dung bài vào log hay vào `params` của thông báo (trừ `order_code` trong `params` thông báo đơn của chính chủ đơn — cần để mở đúng đơn; không ghi vào log).
- Câu chữ: "giáo viên", "Đơn đăng ký", "Học phí", "Thanh toán", "Đăng ký khoá", "Đăng ký lại"; không "mua", "bán", "giá", "đơn hàng"; xưng "bạn"; full test tiếng Anh, bài kiểm tra của khoá tiếng Việt; không emoji; không "0/0", không band ở bài kiểm tra.
- Không gọi AI trả phí trong test; không gửi thư thật; không thao tác dữ liệu production.
- Không viết test kiểu đọc mã nguồn so chuỗi; riêng `brand-favicon.test.mjs` đã tồn tại được sửa có chủ ý, và `build-brand-assets.mjs --check` là kiểm tài sản sinh, không phải test mã nguồn.

## 9. Kiểm thử và bằng chứng hoàn tất của cả gói

Dữ liệu thử (staging): lớp thử QA có 3 học viên thử (tài khoản từ `setup_phase_d_test_env.sh` và tài khoản QA hiện có, không học viên thật); một bank Course trắc nghiệm thuần thử (ví dụ bản sao nhỏ 20 câu của đề giữa kỳ, gắn buổi); sản phẩm khoá thử `test-grammar-online` của G04; tài khoản chấm thử mới chưa kích hoạt.

| # | Given | When | Then | Môi trường |
|---|---|---|---|---|
| A1 | Học viên H thuộc lớp thử, cờ `notifications_enabled` bật | Admin giao một bài, chờ một chu kỳ job | Chuông của H có 1; ngăn hiện "bài mới được giao"; bấm → mở đúng bài; số về 0 | staging |
| A2 | H có 2 bài quá hạn chưa nộp | Mở bất kỳ trang học viên | Thẻ "2 quá hạn" cạnh chuông, cả khi đã đọc mọi thông báo; nộp một bài → "1 quá hạn" | staging |
| A3 | Giao 3 bài cùng buổi | Job chạy | Một dòng gộp "3 bài mới" chưa đọc; đọc rồi giao thêm 1 → dòng mới | local + staging |
| A4 | Chạy job hai lần liên tiếp | — | Không dòng mới ở lần hai (`duplicate` = số sự kiện) | local |
| A5 | Giáo viên gửi nhắc nhở cho lớp, kênh in-app | Xem trước → gửi | Số người nhận đúng; mỗi học viên một dòng; gửi lặp `request_key` không thêm | staging |
| A6 | Tài khoản chưa kích hoạt có đơn `needs_info` | Mở `/notifications` | Thấy thông báo đơn; không 403 | staging |
| B1 | Ngân sách ngày chỉ còn đủ 2 lượt Writing Task 2 (đặt `daily_budget_usd` thấp trong PG thử), ba tài khoản dùng thử | Ba bài nộp gần như cùng lúc | Hai được nhận chấm, một thấy "Hôm nay toàn web đã hết lượt chấm thử" | PG17 (đua) + staging |
| B2 | Bài thứ hai bị lỗi hệ thống (grader giả lỗi) | Tài khoản thứ ba nộp lại | Được nhận (lượt và chi phí trả lại cộng lại ngân sách ngày) | local |
| B5 | Tài khoản tạo bằng mã email 6 số, chưa có khoá | Mở chấm thử, nộp 1 Task 1, 1 Task 2, 2 bài Speaking Part 2 rồi bài Part 2 thứ ba | Bốn bài đầu được nhận; bài thứ năm `user_daily_exhausted`; yêu cầu Speaking Part 1 → 422 | local + staging |
| B6 | Tài khoản từng có khoá online đã hết hạn (sản phẩm thử của G04) | Gọi `GET /api/trial/status` | 403 `trial_not_eligible`; không dòng `trial_usage`, không dòng `credit_ledger` nào được ghi | local + staging |
| B7 | Hai tài khoản thử cùng `ip_hash`, hệ số IP = 1, hạn mức tổng Part 2 đặt 2 (PG thử) | Mỗi tài khoản nộp Part 2 qua nhiều ngày giả | Lượt thứ ba tính chung theo IP bị từ chối `ip_total_exhausted`, màn nêu lý do và lối liên hệ; thẻ Chấm thử của admin tăng "bị từ chối vì IP" | PG17 + local |
| B3 | Admin bật "Tạm dừng" kèm lý do | Trang công khai | Lối vào biến mất trong ≤ 30 s; nhật ký có dòng; lượt của ai không đổi | staging |
| B4 | Admin đặt trần ngày > hạn mức tổng của một hạng mục | Lưu | 422 tiếng Việt, không đổi | local |
| C1 | (kiểm thư thuộc G04 — kịch bản E1, E2, E9c của GOI-04 mục 9) Đơn chuyển `needs_info`, rồi `expired` ở một đơn khác; cờ `notifications_enabled` bật | Job thông báo chạy | Chủ đơn có thông báo `enrollment_order` cho từng chuyển; gói này không ghi dòng outbox nào | local + staging |
| C2 | Admin cấp thêm 2 lượt cho một học viên lớp thử (API `grant-extra` của G04) | Job thông báo chạy hai lần | Đúng một thông báo `credits_granted` "được cấp thêm 2 lượt"; bấm → mở lịch sử lượt ở Tài khoản | local + staging |
| D1 | Chrome giả 390×844 | Mở `/tests` và mở thẳng đường dẫn phòng thi Reading full test | Không nút vào full test; màn chặn tiếng Anh có một dòng phụ tiếng Việt; network không có POST tạo lượt | staging (preview) |
| D2 | 820×1180 | Vào thi Reading test | Vào được; xoay về 390 giữa bài → bài tiếp tục, đồng hồ chạy, dải nhắc hiện | staging |
| D3 | 390×844 | Mở luyện từng phần Reading, rồi một mini test | Cả hai làm được, không màn chặn | staging |
| E1 | Bài kiểm tra thử chế độ `teacher_release`, H nộp | H gọi mọi route 5.5.5 (qua trang và qua `curl` với JWT của H), và `GET /rest/v1/quiz_attempts` bằng JWT | Không có điểm, câu đúng sai hay đáp án ở bất kỳ phản hồi nào; REST trả lỗi quyền | staging |
| E2 | E1 (bảng công bố là giao diện của G09-T30; trước khi G09-T30 merge thì gọi API 5.5.8 bằng `curl` với tài khoản admin thử) | Giáo viên công bố mức "chỉ điểm" cho H | H thấy "N trên M câu đúng · P%", không có bảng theo buổi; có thông báo "Đã có kết quả" | staging |
| E3 | E2 | Nâng mức "kèm đáp án", `due_at` đã qua | H thấy đáp án và lời giải; thông báo thứ hai | staging |
| E4 | Hẹn giờ công bố 10:00; H2 nộp 10:03 | Job 10:05 | H1 có kết quả, H2 còn "chờ giáo viên công bố" | staging |
| E5 | Có một người nộp | Đổi chế độ sang `immediate` | 409 `release_mode_locked` | local + staging |
| E6 | Bài giao cũ (trước gói), chế độ NULL | H mở kết quả | Y như trước gói (so ảnh và JSON trước/sau) | staging |
| E7 | (HOÃN cùng T25) `late_until` = hạn + 30 phút | H3 bắt đầu sau hạn 10 phút | Làm được; nộp mang "Nộp trễ N phút" | PG17 + staging |
| E8 | (HOÃN cùng T26) H4 không làm, bài đóng | Giáo viên mở làm bù | H4 thấy "vắng" ở bài gốc, bài làm bù mở được; báo cáo lớp không tính H4 là 0 | staging |
| F1 | Sau T29 | `GET /api/courses` staging | Sáu khoá đúng tên; trạng thái hết hạn ở màn thử ghi "Đăng ký lại" | staging |
| G1 | Sau T30, T31 | Mở trang chủ, xem tab trình duyệt; dán link vào trình gỡ lỗi chia sẻ (chỉ xem) | Favicon Ấn ký; `og:image` có ảnh khuôn mới | staging |
| G2 | Bài thí điểm có 2 sơ đồ | Mở bài ở 1280 và 390; đọc bằng VoiceOver | "Hình 1", "Hình 2"; trình đọc màn hình đọc câu `aria-label` | staging |

Lệnh mỗi PR (00 mục 5): backend `cd backend && python -m pytest tests/ -q`; PG17 `REQUIRE_PG=1 TEST_PG_URL=… python -m pytest tests/test_migration_47*.py tests/test_client_write_invariant_postgres.py -q`; frontend hợp đồng, React, `tsc`, `build`; `python backend/scripts/validate_specs.py`; `git diff --check`.

Không kiểm trên production: không nộp bài thử, không công bố điểm, không gửi thông báo hay thư, không bật cờ, không đổi trần chấm thử. Production chỉ xem sau khi anh Andy cho promote.

## 10. Cần anh Andy quyết

> **Anh Andy đã trả lời ngày 17/11/2026** (giữ nguyên văn để đối chiếu; từ lần khớp chéo 18/11 các điểm này **đã được đưa vào thân gói**: câu 7, 8 → FR-11-020…023, 030, mục 5.2; câu 11 → FR-11-053, 5.4; câu 13 → 5.5; phần C → mục 3.1, 5.3, G11-T07/T18 ĐÃ BỎ; câu 16 → T25, T26 hoãn):
> - **Câu 7 — trần chấm thử.** Mỗi người mỗi ngày: 1 bài Writing Task 1 + 1 bài Writing Task 2; 2 bài Speaking Part 2. Trần toàn web mỗi ngày tính bằng **chi phí chấm: 5 USD mỗi ngày** cho cả Writing và Speaking (không phải số bài). Hệ quả kỹ thuật: (a) trần mỗi ngày của Writing tách theo task (`task1`, `task2`), không phải một con số chung; (b) Speaking thử chỉ nhận Part 2; (c) cần ghi chi phí ước tính của từng lượt chấm thử (USD, từ số token/giây âm thanh và bảng đơn giá cấu hình) và cộng dồn theo ngày giờ Việt Nam; khi tổng chạm `TRIAL_DAILY_BUDGET_USD=5` thì dừng nhận bài thử tới 00:00; (d) kiểm ngân sách trước khi nhận bài bằng chi phí ước tính tối đa của một lượt, để không vượt trần khi nhiều yêu cầu đồng thời. **Hạn mức tổng mỗi người, suốt chương trình chấm thử (chốt 17/11/2026):** 10 bài Writing (5 Task 1 + 5 Task 2) và 10 bài Speaking Part 2, tính theo CẢ email tài khoản VÀ địa chỉ IP của máy: một lượt bị từ chối khi email đã chạm hạn mức hoặc IP đã chạm hạn mức. Lưu ý khi làm: (1) không lưu IP thô — lưu bản băm có muối xoay theo cấu hình, ghi vào chính sách quyền riêng tư; (2) nhiều người dùng chung một IP (công ty, trường, mạng di động) sẽ chung hạn mức — làm hệ số cấu hình `TRIAL_IP_QUOTA_MULTIPLIER` (mặc định 1 theo quyết định) để nới được mà không sửa mã, và ghi số lượt bị từ chối vì IP vào báo cáo admin; (3) lấy IP từ header do hạ tầng tin cậy đặt, không tin header do client gửi.
> - **Câu 8.** Người từng có khoá online, kể cả đã hết hạn: KHÔNG được chấm thử.
> - **Câu 11.** Mini test KHÔNG tính là full test: không bị chặn trên điện thoại. Chỉ chặn full test 4 kỹ năng, full test từng kỹ năng và kỳ thi xếp lịch. (Ngược với đề nghị trong bảng.)
> - **Câu 13.** Chế độ trả điểm mặc định khi giao bài kiểm tra cho lớp offline: "giáo viên công bố" (`teacher_release`). Khoá online tự học: trả ngay.
> - **Phần C — sửa:** thư về đơn là BỐN thư, thêm mẫu `order_needs_info` (gửi khi admin đánh dấu đơn cần bổ sung hoặc sai lệch số tiền; có hạn bổ sung và lời nhắn của admin chép nguyên văn; tờ EmailMau thư 14). Mọi chỗ trong gói ghi "ba thư" đọc thành bốn. Khoản chuyển khớp mã của một đơn đã hết hạn thì đơn tự mở lại, mở khoá và gửi thư "khoá đã mở".
> - **Câu 16.** Nộp trễ và làm lại/làm bù ĐỂ ĐỢT SAU. Đợt đầu chỉ làm chế độ trả điểm (G11-T21–T24, T27–T28). KHÔNG làm G11-T25 (nộp trễ, vắng; migration 475) và G11-T26 (làm bù/làm lại; migration 476) cho tới khi anh Andy mở lại. Trong đợt đầu, học viên vắng được giáo viên giao lại như một bài mới; màn hình không hiện nút "cho nộp trễ" hay "cho làm lại".

**Đã có trả lời, không còn hỏi:** câu 7 (trần chấm thử), 8 (người từng có khoá online không được chấm thử), 9 (không gộp chấm thử vào sổ lượt — GOI-04 mục 5.8), 11 (mini test không bị chặn), 13 (lớp offline mặc định "giáo viên công bố"), 16 (nộp trễ, làm bù để đợt sau), 23 phần tên khoá (00 mục 2 điểm 2; G04 đã có cột `short_title`). Theo 00 mục 2 điểm 22: minh hoạ là sơ đồ câu chữ; màn ngoài bài thi có dòng phụ tiếng Việt; người bị chặn chấm thử vì dùng chung IP có lối đi. Các dòng đó giữ trong bảng với nhãn **ĐÃ TRẢ LỜI** để giữ số câu.

| # | Câu hỏi | Phương án đề nghị | Mặc định tạm người thực thi dùng |
|---|---|---|---|
| 1 | Thẻ "N quá hạn" có hiện cả khi kênh thông báo đang tắt (cờ `notifications_enabled`)? | Có — bộ đếm tính thẳng từ bài giao, không phụ thuộc thông báo | Hiện theo cờ giao diện `learner_v2`, không theo `notifications_enabled` |
| 2 | Chuông có cần trên thanh điều hướng cũ (`aver-chrome.js`) trong lúc chưa chuyển hết sang giao diện mới? | Không; chỉ khung mới để khỏi sửa file cũ thêm một lần | Chỉ khung mới |
| 3 | "Sắp đến hạn" báo trước bao lâu, mấy lần? | Một lần, trước 24 giờ | `NOTIFY_DUE_SOON_HOURS=24`, một lần |
| 4 | Chu kỳ cập nhật số trên chuông; giữ thông báo bao nhiêu ngày (tờ ghi XXX) | 60 giây khi tab mở; giữ 90 ngày | 60 s; 90 ngày |
| 5 | Bài kiểm tra một lượt đã đóng mà học viên chưa làm (vắng) có tính vào "N quá hạn" không? | Không; hiện "vắng" ở bài đó | Không tính |
| 6 | Giáo viên được gửi thông báo cho lớp mình không, có kênh thư không? Ai được gửi cho tất cả học viên? (Cách xác định lớp của giáo viên: `staff_scope` của G09-T24, một cột `cohorts.instructor_id` — mỗi lớp một giáo viên, đã chốt ở 00 mục 2 điểm 23; Q18 của GOI-09 đã đóng) | Giáo viên gửi in-app cho lớp mình; thư và "tất cả" chỉ admin | Như đề nghị khi G09-T24 đã merge; trước đó chỉ admin |
| 7 | **ĐÃ TRẢ LỜI 17/11** — trần chấm thử: mỗi ngày mỗi người 1 Task 1 + 1 Task 2 + 2 Speaking Part 2; tổng mỗi người 5 + 5 + 10 theo email và IP; toàn web 5 USD chi phí chấm mỗi ngày | — | Seed đúng các số này (5.2.1); cờ `free_trial_enabled` vẫn tắt |
| 8 | **ĐÃ TRẢ LỜI 17/11** — người từng có khoá online, kể cả đã hết hạn, không được chấm thử | — | FR-11-030 |
| 9 | **ĐÃ TRẢ LỜI** — không gộp chấm thử vào sổ lượt của G04 (GOI-04 bản 18/11 mục 5.8) | — | Không gộp |
| 10 | Ngưỡng chặn full test (00 mục 2 điểm 13 ghi 768px là "ngưỡng đề xuất, chưa chốt") | 768px | 768px, cấu hình được |
| 11 | **ĐÃ TRẢ LỜI 17/11** — mini test không tính là full test, không bị chặn trên điện thoại | — | FR-11-053 |
| 12 | Đang thi mà màn hẹp lại: dải nhắc không che bài (yêu cầu 17/11) hay che bài kèm "Rotate your tablet back to continue." (tờ ThanhPhanKhungTrang)? | Dải nhắc không che bài; bài và đồng hồ chạy tiếp | Dải nhắc không che bài |
| 13 | **ĐÃ TRẢ LỜI 17/11** — lớp offline mặc định "giáo viên công bố"; khoá online tự học trả ngay | — | Giao diện giao bài (G09-T26) chọn sẵn `teacher_release` cho lớp offline; bài không gửi trường thì giữ hành vi cũ |
| 14 | Mức "kèm đáp án" công bố cho một học viên khi bạn cùng lớp chưa làm: mở đáp án ngay hay chờ qua hạn/cả lớp nộp? | Chờ qua hạn hoặc cả lớp nộp (chống chuyển đáp án) | Chờ |
| 15 | Hẹn giờ công bố: bài nộp sau giờ hẹn (nộp trễ, làm bù) có tự công bố không? | Không, giáo viên công bố tay (theo tờ) | Không |
| 16 | **ĐÃ TRẢ LỜI 17/11** — nộp trễ và làm bù/làm lại để đợt sau | — | T25, T26 hoãn |
| 17 | Nhận xét khi công bố: một nhận xét chung cho các học viên được chọn hay từng người một? | Theo lần công bố (chung cho nhóm được chọn), sửa từng người bằng cách công bố riêng | Theo lần công bố |
| 18 | Bài tập theo buổi (chế độ làm đến khi đạt) có cần chế độ công bố không? | Không | Không |
| 19 | Cho thêm thư viện sinh PNG (ví dụ `@resvg/resvg-js`) vào `frontend` nếu repo chưa có? | Có, chỉ dùng trong script sinh, không vào bundle | Không thêm; chỉ SVG cho tới khi anh đồng ý |
| 20 | Ảnh OG riêng cho từng trang khoá/bài/đề, hay một ảnh chung trước? | Trang chủ + Grammar Wiki trước; trang khoá khi có dữ liệu | Như đề nghị |
| 21 | Thay emoji ở các trang cũ chưa dựng lại (tờ ghi 28 tệp), hay chỉ ở trang mới? | Chỉ trang mới; trang cũ thay khi được dựng lại | Chỉ trang mới |
| 22 | Năm bài Grammar Wiki thí điểm sơ đồ | `sentence-structures` (một bài câu cơ bản), `grammar-for-meaning/conditionals`, `error-clinic/subject-verb-agreement`, một bài mệnh đề quan hệ, một bài thì (timeline) — người thực thi chọn file thật trong các thư mục này | Như đề nghị, danh sách file trong PR |
| 23 | Tên sáu khoá: **ĐÃ TRẢ LỜI** (00 mục 2 điểm 2). Còn mở: slug (thành URL công khai) | slug `ngu-phap-nen-tang`, `listening-for-ielts`, `reading-for-ielts`, `writing-for-ielts`, `speaking-for-ielts`, `vocabulary-skills-ideas-for-ielts` | Như đề nghị, trạng thái `coming_soon`, chỉ trên staging |
| 24 | Thư nhắc chuyển khoản gửi trước hạn giữ đơn bao lâu (tờ ghi XXX)? Cấu hình và việc gửi nay thuộc G04; GOI-04 mục 10 chưa có câu này nên giữ ở đây | 24 giờ, chỉ khi đơn đã tạo ít nhất 6 giờ | `ENROLL_PAY_REMINDER_HOURS_BEFORE=24`, `ENROLL_PAY_REMINDER_MIN_AGE_HOURS=6` (G04) |
| 25 | G09 muốn trang Gửi thông báo có "Nhóm theo điều kiện" (chưa nộp một bài · quyền sắp hết hạn · không hoạt động) đọc ngưỡng từ Cài đặt; gói này chỉ có ba kiểu audience (lớp, danh sách, tất cả). Có làm kiểu audience theo điều kiện ở đợt đầu không? | Không ở đợt đầu: G09 lọc sẵn ở Danh bạ rồi đẩy danh sách sang (G09-T40) | Không làm; ghi là chỗ hai gói chưa khớp |
| 26 | Người bị chặn chấm thử vì dùng chung IP: "lối đi" cụ thể là gì (00 mục 2 điểm 22 chỉ ghi màn nêu lý do và cách liên hệ/xác minh)? Ai nới, bằng cách nào? | Màn nêu lý do + kênh liên hệ; admin nới bằng hệ số IP chung ở Cài đặt (chưa có nới riêng một người) | Như đề nghị; không có nới riêng một người |
| 27 | Câu chữ dòng phụ tiếng Việt ở màn ngoài bài thi của full test (chặn điện thoại, lỗi thiết bị) | Câu ở 5.4 | Như đề nghị |
| 28 | Chi phí ước tính tối đa một lượt chấm thử (Task 1, Task 2, Speaking Part 2) để giữ chỗ ngân sách 5 USD/ngày: lấy từ đâu? | Từ bảng đơn giá đang dùng để ghi chi phí AI trong repo; anh xem lại số | Cấu hình `max_cost_usd`; không tìm được đơn giá thì dừng hỏi |
| 29 | (mới, 18/11 chiều) Có báo riêng khi lượt chuyển sắp hết hạn bảo lưu (60 ngày sau khi kỳ mới bắt đầu) không? CHECK `kind` hiện không có loại này | Để đợt sau; nếu làm thì thêm loại `credits_carry_expiring` sinh từ `entitlements.carry_expires_at` của G04, nhắc một lần trước N ngày | Không làm; lượt chuyển và hạn của nó chỉ hiện ở Tài khoản (FR-07-060) |

**Điều chưa kiểm được trong mã (người thực thi kiểm khi làm, lệnh ở chỗ ghi `CHƯA KIỂM`):** cách sinh `runtime-config.js`; bảng/cột bài Writing được giao trong `_visible_writing_gives`; cách gắn giáo viên với lớp; route và file của 0047 khi được viết; endpoint tạo lượt của Listening test và Speaking full test; danh sách sự kiện analytics cho phép; nơi ghi bằng chứng KP; RPC tạo bài giao nguyên tử và ràng buộc trùng bank ở CSDL; có thư viện sinh PNG và font trong repo không; bộ lọc HTML ở trang Grammar; thư mục mẫu thư của G04; tờ nào vẽ khối công tắc thư ở Hồ sơ.
