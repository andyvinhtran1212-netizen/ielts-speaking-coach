# Khảo sát repo cho brainstorm sản phẩm — Aver Learning

- Nguồn: bản sao chỉ đọc `repo-ro` (staging @ 93c7085). Mọi đường dẫn dưới đây tính từ gốc repo đó.
- Cách làm: chỉ đọc mã, migration, spec và nội dung trong repo. Không chạy server, không truy vấn database, không gọi mạng. Vì vậy "đang hiện" nghĩa là **mã có render/trả ra**; chưa đối chiếu trên staging hay production.
- Không chép dữ liệu cá nhân học viên nào.

---

## 1. Kết quả bài tập về nhà phía admin/giáo viên (trọng tâm: ngữ pháp Course 1)

### 1.1 Các loại bài ngữ pháp và nơi chúng sống

| Loại | Cách giao | Bảng lưu | Ghi chú |
|---|---|---|---|
| **Bài tập theo buổi Course (skill=`course`)** — đây là bài ngữ pháp KBT theo buổi của Course 1, cùng các đề giữa kỳ và cuối kỳ | `POST /admin/cohorts/{c}/assignments` với `skill="course"`, `content_id`=quiz bank (`backend/routers/admin_class_assignments.py`, `AssignmentCreate`, dòng 168–296) | `class_assignments`, `class_assignment_items` (`backend/migrations/177_class_assignments.sql`), `quiz_sessions` (+`class_assignment_item_id` mig 188, `kind` run/retake mig 189), `quiz_attempts` (`backend/migrations/119_quiz_progress.sql`), `course_section_submissions`, `course_writing_submissions`, `course_pronunciation_submissions` (mig 190, 222, 226) | Nạp bank bằng `backend/scripts/import_course_exercise_bank.py --course C1` (file `KBT-buoi-XX.jsonl`), đề giữa/cuối kỳ bằng `backend/scripts/import_course_assessment_bank.py` |
| Bài Grammar MASTER30 lẻ theo buổi (`skill="grammar"`, `assignment_type="grammar_lesson"`, 12 câu/buổi) | Chỉ giao được cho lớp **Course 5** (`_require_course_five`, `admin_class_assignments.py:2655`) | `grammar_lesson_attempts` (`backend/migrations/312_assigned_master30_grammar_lessons.sql`): `answers` jsonb, `correct_count`, `question_count`, `content_snapshot`, `started_at`, `completed_at` | Không thuộc Course 1 |
| Grammar check-up/diagnostic MASTER30 | `skill="grammar"`, có cờ `master30_grammar_diagnostic` | Bảng diagnostic (spec `specs/0003-master30-grammar-diagnostic`) | Báo cáo từng phiên: `GET /admin/grammar-diagnostic/sessions/{id}/report` (`backend/routers/admin_grammar_diagnostic.py:71`) |

Ánh xạ trường khi nạp bank Course (`backend/scripts/import_course_exercise_bank.py`, dòng 21–28 và 120–147):
`dang`→`subtype` (dạng câu A1…E3), `truc`→`item_key` (trục kiến thức), `truc_nhom`→`skill` (nhóm trục), `bay`→`why_wrong` (vì sao từng phương án nhiễu sai), `muc`→`points`.

### 1.2 Sau khi học viên nộp, admin thấy gì

**Trang:** `/admin/classes/[cohortId]` (`frontend/app/(authed-admin-classes)/admin/classes/[cohortId]/page.tsx` → `admin-class-detail.tsx`). Tab bài tập là `admin-class-homework.tsx`. Bảng danh sách bài giao có 3 cột "Bài giao / Hạn nộp / Tình hình nộp", kèm nhãn "Cả lớp" hoặc "Theo nhóm". Mở một bài sẽ ra `admin-class-submissions.tsx`, có ba tab:

**(a) Tab "Tổng kết"/"Ai nộp"** — `GET /admin/cohorts/{c}/assignments/{a}/tally` (`assignment_tally`, `admin_class_assignments.py:1648–2011`). Mỗi học viên một dòng, gồm các trường:
`student_id, name, student_code, status` (no-account/missing/pending/late/submitted, tính trong `_hand_in_status` dòng 1541), `submitted_at, score, flags, flag_level, course_state` (passed/completed/timed_out/near_pass/retry_full/in_progress/untouched), `next_action, completion_mode, pass_pct, near_pass_pct, sections_done, sections_total, missing_sections, passed_at, retakes, verdicts, artifact_kind, artifact_id`, các trường listening, `skill_drill`, `grammar_attempt_id, grammar_answered, grammar_correct, grammar_question_count, grammar_objective_count, grammar_writing_count, grammar_writing_answered_count, has_writing, writing_expected`.
Phần tổng của bảng là `counts`: `total, submitted, late, missing, no_account, flagged, passed, completed, timed_out, near_pass, retry_full, in_progress, untouched`, kèm cờ `sealed` và `homework_stale`.

**(b) Tab "Tiến độ lớp"** (effort) — `GET /admin/quiz/banks/{bank}/attempt-report?assignment_id=` (`backend/routers/admin_quiz.py:194` → `quiz_service.course_attempt_report`, `backend/services/quiz_service.py:6382`). Các cột đang hiện: Học viên / Tình trạng / Hoàn thành / Lượt đã chấm / Điểm tổng gần nhất / Thời gian các lượt.
Mỗi học viên có các trường: `state` (stalled/needs_retry/completing_sections/doing/untouched/done), `median_sec, idle_sec, minutes, questions, correct, accuracy, last_at, attempts, combined_pct, next_action, section_results, missing_sections, flags` (ví dụ `course_stalled` "Bỏ dở quá 24 giờ"), `attempt_minutes, current_attempt_minutes`.
Cạnh bảng có khối **"Cả lớp vướng ở đâu"** (mảng `axes`): mỗi trục có `axis, wrong, attempted, wrong_rate, affected_students, student_sample, affected_rate, median_sec, sample_low`. Trục tính theo **lượt đầu**, và danh sách **bị cắt còn top 15** (`out["axes"] = axes[:15]`).

**(c) Tab "Inspect học viên"** — `GET /admin/quiz/banks/{bank}/students/{user}/report?assignment_id=` (`quiz_service.course_answer_report`, dòng 6041). Bảng từng câu gồm Phần / Mã câu / Học viên trả lời / Kết quả / Thời gian. Mỗi câu có `qid, item_key, subtype, prompt, options, picked, picked_text, answer, answer_text, is_correct, why_wrong, explain, seconds`. Phần tổng có `answered, correct, median_sec, active_sec, idle_sec`. Lịch sử lượt hiện các cột Lượt / Hình thức / Kết quả / Điểm từng phần / Thời lượng / Bước tiếp / Chốt lúc. Client nhóm câu theo trục bằng `groupReportQuestions` (`frontend/lib/admin-class-submissions-model.mjs`).

### 1.3 Vì sao thông tin trả về "messy" — điểm yếu cụ thể

1. **Ba tab, ba API, ba cách đếm khác nhau.** Tally dùng `status`/`course_state`, Tiến độ dùng `state`, Inspect dùng `answered`. Riêng `course_state` có 8 giá trị, `state` có 6, `status` có 5, và tên các tập này không trùng nhau. Nhãn tiếng Việt cũng khác: `COURSE_STATE`, `EFFORT_BASE`, `NEXT`, `STATUS` trong `admin-class-submissions.tsx` dòng 14–19.
2. **Trục "vướng" quá vụn.** Trục lấy từ `item_key = truc`, mà `truc` gần như duy nhất theo từng câu. Tôi đo trên bản sao bank trong repo (`backend/content/master30-assigned-practice/v3-banks/M30-B01..B20.jsonl`, bản sửa từ `KBT-buoi-XX.jsonl`): B01 có 52 trục trên 100 câu, từ B05 trở đi khoảng **91 trục trên khoảng 100 câu**. Trong khi đó `truc_nhom` chỉ có **6–11 nhóm mỗi buổi**. Kết quả là khối "Cả lớp vướng ở đâu" gần như liệt kê từng câu bằng nhãn văn xuôi dài, lại bị cắt top 15. Nhóm ngữ pháp có nghĩa là `truc_nhom`, lưu ở `quiz_questions.skill`, nhưng **không được dùng để gom**.
3. **Không có tổng hợp theo câu cho cả lớp** trong bài giao, tức không có mục "câu Q17: 12/20 sai, 8 em chọn B". RPC `quiz_item_error_rates` / `quiz_skill_error_rates` có tồn tại (`quiz_service.bank_analytics`, dòng 6796; `backend/migrations/121_quiz_analytics_rpcs.sql`), nhưng chỉ được gọi từ trang Vocab (`/admin/vocab/quiz-analytics`, `/admin/vocab/topics`), tính theo **bank** chứ không theo bài giao, nên trộn dữ liệu nhiều lớp.
4. **Không có**: phân bố điểm (histogram), so sánh với buổi trước hay xu hướng của từng em qua các buổi, danh sách "câu cả lớp sai nhiều nhất", và phân bố phương án nhiễu.
5. **Báo cáo theo buổi cho đề giữa/cuối kỳ** ("Theo buổi", ma trận học viên × buổi, buổi yếu dưới 60%) đã có spec được duyệt (`specs/0043-course-assessment-lesson-report/spec.md`) nhưng **chưa có mã**. `specs/IMPLEMENTATION_STATUS.md:109` ghi "1/9 … no lesson-report implementation". Chính spec này ghi nhận: tally chỉ có một con số; axes top 15 nên 20 buổi không hiện đủ; báo cáo từng em lấy mẫu số là "số câu đã trả lời" nên em hết giờ ở câu 15/300 vẫn hiện 100%; importer không lưu `lesson_primary`.
6. Trang danh sách bài giao chỉ có một cột "Tình hình nộp", không có điểm trung bình hay tỉ lệ đạt cho từng bài.

### 1.4 Dữ liệu ĐÃ lưu nhưng chưa hiển thị (hoặc hiển thị kém)

- `quiz_attempts.answer_given` (phương án em chọn), `response_time_ms`, `attempt_no`, `skill` (= `truc_nhom`), `subtype` (= `dang`), `created_at`: đủ để dựng phân bố phương án nhiễu, thời gian từng câu và lỗi theo nhóm ngữ pháp **cho cả lớp**.
- `quiz_questions.why_wrong` (từ `bay`, kèm mã ngộ nhận như N1/N2/N3 nằm trong văn bản): mới chỉ hiện cho từng câu của từng em, chưa gom thành "ngộ nhận phổ biến".
- `quiz_sessions.kind` (run/retake), `duration_sec`, `ended_by` (completed/time_cap/paused), `started_at`/`ended_at`.
- `class_assignment_items.opened_at`, `passed_at`, `mastery` jsonb (lịch sử verdict), `submitted_at` so với `class_assignments.due_at`.
- `class_lessons` (`lesson_id` của bài giao, `admin_class_lessons.py`): có thể xếp bài theo buổi để so với buổi trước.
- `grammar_lesson_attempts.answers` cho Course 5.

### 1.5 Chỉ số chẩn đoán lớp tính được NGAY từ dữ liệu đang lưu

- Tỉ lệ nộp, đúng hạn, trễ, chưa nộp, chưa kích hoạt; danh sách ai chưa nộp và ai trễ, kèm số giờ trễ (`submitted_at − due_at`).
- Tỉ lệ đúng theo từng câu cho cả bài giao (lượt đầu và lượt mới nhất); top N câu cả lớp sai nhiều nhất.
- Phân bố phương án đã chọn cho mỗi câu, cộng với lời giải thích `why_wrong` của phương án nhiễu phổ biến nhất.
- Tỉ lệ đúng theo **nhóm ngữ pháp `truc_nhom`** và theo **dạng `dang`** cho cả lớp và cho từng em; dựng được heatmap học viên × nhóm.
- Thời gian: trung vị theo câu, theo bài, theo em; tỉ lệ thời gian "idle"; câu có thời gian bất thường (quá nhanh nghĩa là đoán, quá lâu nghĩa là vướng).
- Phân bố điểm lượt đầu và lượt cuối; số lần làm lại trước khi đạt (`retakes`, `verdicts`); tỉ lệ đạt sau lượt đầu.
- So với buổi trước: điểm và tỉ lệ nộp theo chuỗi bài giao của cùng lớp, sắp theo `due_at` hoặc `lesson_id`; em tụt điểm hai buổi liên tiếp.
- Em "bỏ dở" (stalled quá 24 giờ) và em mở bài nhưng chưa trả lời (`opened_at` có, attempts không có).
- Đề giữa/cuối kỳ: kết quả theo buổi B01–B20 từ `quiz_questions.skill`/`item_key` (đúng như spec 0043 đã mô tả).

### 1.6 Chỉ số cần thu thêm dữ liệu

- Thứ tự thao tác và lần đổi đáp án trong một câu: hiện chỉ lưu lượt trả lời đã gửi.
- Mã ngộ nhận có cấu trúc cho từng phương án: hiện nằm lẫn trong văn bản `why_wrong`, cần tách thành cột hoặc mảng.
- Thẻ buổi `lesson_primary` cho mỗi câu: importer kiểm tra nhưng **không lưu** (spec 0043, FR-002).
- Mức tự tin hoặc tự đánh giá của học viên; lý do nộp trễ; lần mở xem lời giải sau khi nộp.

---

## 2. Phòng thi live / mock test phía quản trị

### Hiện trạng
- **Trang Live:** `/admin/mock-live` (`frontend/app/(authed-admin-mock-live)/admin/mock-live/admin-mock-live.tsx`). Trang poll `GET /admin/mock-exams/{id}/live` mỗi 5 giây (dòng 165) và có đồng hồ cập nhật mỗi giây. Các cột: Học viên / Trạng thái / mỗi phần L-R-W / Speaking / Thao tác. Có nút Void (`void-sitting-dialog.tsx`).
- **API live** (`backend/services/mock_exam_service.py:4090 admin_live_monitor`):
  - `exam{id, code, title, exam_mode, status, is_open, active_section, collected_section, collection_sweep_completed_section, section_started_at, section_duration_seconds, section_time_left_seconds}`.
  - Mỗi học viên: `user_id, student_name, sitting_id, status, started, in_roster, assigned_skills, sections{state(absent/working/submitted/missed), answered, total, submitted_at, last_activity_at, live, stalled}, speaking{required, count, completed_at}, needs_retest, integrity{bộ đếm tín hiệu mềm}`.
  - `section_rollup{submitted, working, absent, missed, expected}`.
  - Đọc từ `mock_exam_sittings` và `reading_attempt_answers`.
- **Điều khiển:** `POST /{id}/open`, `/advance`, `/collect` (thu bài, có ACK và sweep nền), `/section-progress` (`backend/routers/admin_mock_exams.py:384–510`).
- **Sau thi:**
  - `/admin/mock-tests?tab=review` (`admin-mock-reviews.tsx`) gọi `GET /{id}/roster` (`backend/services/mock_review_workflow.py:1264`). Mỗi sitting có: `listening/reading{score, max, band}`, writing (số từ, band), `speaking{count, band}`, `review_status, claimed, needs_retest, retest_flags`.
  - `GET /{id}/retest-summary`; các thao tác bulk claim, final-bands, release.
  - `/admin/mock-pacing` gọi `GET /sittings/{id}/pacing` (`mock_exam_service.py:4378`): dựng lại nhịp làm bài của **một** sitting từ `answered_at`.
  - Trang `/admin/mock-reviews/report` hiện nhận xét giám khảo của từng bài.
- Spec vận hành: `specs/0006-admin-mock-test-operations/spec.md`. Trạng thái "implementing"; T007 (hành trình vận hành thực trên production) chưa xong (`specs/IMPLEMENTATION_STATUS.md:31`).

### Điểm yếu và thiếu
- Không có **phân tích câu cho cả kỳ thi**: không có tỉ lệ sai theo câu L/R, loại câu hỏi yếu của lớp, hay phân bố band. Dữ liệu chấm từng câu (`grading_details`/`per_question`, `mock_exam_service.py:2729`) chỉ dùng cho từng bài.
- Pacing chỉ xem được từng sitting một; không có bản tổng hợp nhịp làm bài của cả phòng (ai dừng ở đâu, ai nộp vội).
- Không có cảnh báo chủ động khi em mất kết nối hay đứng yên, ngoài cờ `stalled` hiển thị trong bảng. Không có lịch sử sự kiện integrity theo thời gian, chỉ có bộ đếm.
- Không so sánh được với kỳ thi trước của cùng em hay cùng lớp; không có báo cáo lớp sau thi.

### Đã lưu nhưng chưa hiển thị
- `answered_at` của từng câu cho mọi sitting (mới hiện từng em), `integrity` theo sitting (chỉ hiện bộ đếm), `grading_details` per question của `reading_attempts`/listening attempts, band ước lượng của từng phần, `needs_retest` lịch sử.

---

## 3. Quản lý đề thi và mock test

### Mô hình dữ liệu
- `mock_exams` (`backend/migrations/145_mock_exam_definition.sql`): `code, title, listening_test_id, reading_test_id`, writing prompt (task 1/2), `speaking_topic_set` jsonb, `section_minutes`, `open_from/open_until`, **`cohort_id` (một lớp)**, `review_sla_days, status` (draft/published/archived). Bổ sung `exam_mode` (`sequential`|`retake`), `is_open`, `active_section`, `{section}_started_at`, `collected_section`.
- `mock_exam_sittings` (`146_…`): mỗi lượt thi của một user, `assigned_skills`, đồng hồ riêng `listening/reading/writing_started_at` (cho retake), `speaking_session_ids`, `integrity`, `needs_retest`.
- `mock_exam_assignments` (`154_mock_exam_retake_mode.sql`): `exam_id, user_id, skills[], open_from, open_until, assignment_group_id, source_exam_id`. Mỗi cặp (exam, user) một dòng.
- Nội dung đề: `listening_tests`, `reading_tests`, writing prompts. Quyền hiển thị và cấp lớp của đề quản lý qua `/admin/exam-content/{kind}/{id}/visibility|status|level|cohorts` (`backend/routers/admin_exam_content.py`).
- Một hệ đề riêng không phải mock: `exam_tests/exam_questions/exam_attempts` (`backend/migrations/134_exam_module_foundation.sql`), nạp qua `/admin/exams/import` hoặc `backend/scripts/seed_exams.py`.

### Các bước admin tổ chức một kỳ thi (sequential)
1. Nạp hoặc chuẩn bị đề L/R/W (trang import hoặc script, xem mục 4).
2. `/admin/mock-tests` gọi `POST /admin/mock-exams` (`ExamCreate`, `admin_mock_exams.py:139`): chọn mã, tiêu đề, `exam_mode`, đề L/R, prompt W, bộ Speaking, số phút, cửa sổ mở, **một `cohort_id`**, SLA chấm.
3. Publish (`PATCH status`), rồi `POST /open`.
4. Trong phòng: `advance` (mở Listening), `collect` (thu bài), `advance` (Reading), `collect`, `advance` (Writing), `collect`, `done`. Speaking ghi riêng bằng `POST /sittings/{id}/record-speaking`.
5. Chấm: claim, nhập final bands, chấm Writing hàng loạt (`/writing/bulk-grade`), đánh dấu retest, release.
6. Thi lại: tạo exam `retake`, rồi `POST /{id}/assignments` với danh sách user và kỹ năng, thường dựng từ `retest-summary`.

### Trả lời các câu hỏi
- **Giao cho nhóm chọn tay?** Có, nhưng chỉ ở chế độ `retake`: `AssignBody.assignments[]` theo `user_id`, mỗi em có kỹ năng và cửa sổ riêng (`admin_mock_exams.py:188–201, 555`; UI `retake-assignment-dialog.tsx`). Chế độ `sequential` chỉ gắn **một `cohort_id`**; danh sách dự thi là sĩ số lớp (`in_roster`).
- **Hai chế độ?** Đã có:
  - `sequential`: phòng live cùng giờ, đồng hồ chung, giám thị advance/collect.
  - `retake`: mỗi em tự canh giờ từng phần trong cửa sổ được giao, không có advance (comment trong mig 154).
  - Tuy vậy, retake được thiết kế và đặt tên như "thi lại" (UI dựng từ retest-summary), chưa phải "kỳ thi tự làm" hạng nhất.

### Chỗ cứng nhắc
- Sequential chỉ gắn một lớp: không ghép được hai lớp, không thêm em ngoài lớp, không bớt em.
- Retake luôn cần thao tác giao từng user. Không có "giao cho cả lớp ở chế độ tự làm" hay "giao cho nhóm đã lưu".
- Thứ tự phần cố định L→R→W, Speaking tách riêng. Phải chọn chế độ khi tạo exam; đổi bằng `PATCH exam_mode` có nhưng phụ thuộc trạng thái sitting.
- Bài tập lớp (`class_assignments`) đã hỗ trợ `student_ids` (nhãn "Theo nhóm", `recipient_scope='subset'`), nhưng mock test không dùng chung mô hình này.

### Cần đổi gì (đề xuất kỹ thuật tối thiểu)
- Bảng mới `mock_exam_audiences(exam_id, cohort_id NULL, user_id NULL, skills[], open_from, open_until)` thay cho cặp `mock_exams.cohort_id` + `mock_exam_assignments`. Cách khác: mở rộng `mock_exam_assignments` thêm `cohort_id` và tách nhãn `purpose` (`retake` | `self_paced`).
- Đổi tên hoặc bổ sung `exam_mode`: `live` (= sequential) và `self_paced` (= retake). Giữ `retake` như một mục đích của bài giao, không phải một chế độ.
- API: `POST /admin/mock-exams/{id}/audience` nhận `{cohort_ids[], student_ids[], skills, window}`. Phía sequential, `admin_live_monitor` lấy roster từ audience thay vì `cohort_id`. UI tạo đề có một bước "Giao cho: lớp / nhóm chọn tay" và "Chế độ: live / tự làm".

---

## 4. Trang admin tải nội dung thủ công, và script backend tương ứng

| Trang (route) | File UI | API upload | Script backend làm cùng việc | Đề xuất |
|---|---|---|---|---|
| `/admin/vocab/quiz` (Quick-Check Quiz, import bank, cả grammar và course) | `admin-vocab-quiz-import.tsx`, `admin-grammar-revision.tsx` | `POST /admin/quiz/import` (`admin_quiz.py:147`) | `import_course_exercise_bank.py`, `import_course_assessment_bank.py`, `import_grammar_banks.py`, `reimport_grammar_banks.py` | **Ẩn phần import** (giữ danh sách bank và xem trước) |
| `/admin/vocab/content` | `admin-vocab-content.tsx` | `POST /admin/vocabulary/import` (`admin_vocab.py:136`) | `seed_vocab_curated.py`, `import_advanced_vocab_core30.py`, `pregen_vocab_audio.py`, `migrate_vocab_to_cards.py` | Ẩn import, giữ sửa lẻ |
| `/admin/reading/content` | `admin-reading-content.tsx` | `POST /admin/reading/content/import`, `/import-bundle` (`admin_reading.py:380, 493`) | `import_reading_drills.py`, `reimport_wp5_reading.py`, `import_ilr_rdg_001.py`, `import_cambridge_canonical_qa.py` | Ẩn import; **giữ** lock/share/publish |
| `/admin/reading/preview` | `admin-reading-preview.tsx` | `POST /admin/reading/questions/{id}/upload-diagram-image` | `check_reading_image_links.py` (chỉ kiểm tra) | Giữ (sửa ảnh lẻ) |
| `/admin/listening/import-drills` | `admin-listening-drill-import.tsx` | `POST /admin/listening/drills/import` (+`/commit`) (`listening.py:3611, 3663`) | `import_skill_drills.py`, `import_listening_content_package.py` | **Ẩn** |
| `/admin/listening/import-fulltest` | `admin-listening-fulltest-import.tsx` | `POST /admin/listening/import-fulltest` (+`/commit`) (`listening.py:3101, 3150`) | `import_listening_lessons.py`, `import_listening_content_package.py`, `import_cambridge_canonical_qa.py`, `upload_listening_source_audio.py` | **Ẩn** |
| `/admin/listening/tests/[testId]` (audio, ảnh map) | `admin-listening-test-detail.tsx` | `/tests/{id}/audio/full`, `/audio/section/{n}`, `/audio/assemble`, `/exercises/{id}/upload-map-image` (`listening.py:4514–4981`) | `upload_listening_source_audio.py`, `upload_listening_source_figures.py`, `migrate_legacy_audio_urls.py` | Giữ trang xem và audit; ẩn upload audio |
| `/admin/writing/prompts` | `admin-writing-prompts.tsx` | `POST /admin/writing/prompts`, `/upload-image` (`admin_writing_prompts.py:325`) | `import_writing_prompts.py`, `migrate_writing_images.py` | Giữ sửa lẻ; có thể ẩn tạo hàng loạt |
| `/admin/writing/tips` | `admin-writing-tips.tsx` | `POST /admin/writing/content/import` (`admin_writing_tips.py:240`) | Không có script tương ứng | Giữ cho tới khi có script |
| `/admin/speaking/topics` | `admin-speaking-topics.tsx` | API JSON | `import_speaking_bank_admin.py`, `import_speaking_lesson_sets.py`, `pregen_speaking_question_audio.py` | Giữ (bật/tắt, sửa lẻ) |
| `/admin/students` (CSV học viên) | `admin-students-directory.tsx` | `POST /admin/students/import` (`admin_students.py:67`) | `backfill_class_enrollment_roster.py` | **Giữ** (vận hành, không phải nội dung) |
| `/admin/writing/new` | `admin-writing-new.tsx` | `POST /admin/writing/extract-text` (OCR bài viết) | — | **Giữ** (chấm bài, không phải nội dung) |
| Đề exam module (legacy) | `frontend/js/admin-exam-content.js` | `POST /admin/exams/import` (`admin_exams.py:45`) | `seed_exams.py` | Ẩn |

Thêm: các trang editor Listening (`/admin/listening/segments|gist|tf|mcq|dictation`) không có trong sidebar, chỉ mở theo `content_id` (`frontend/js/components/aver-admin-chrome.js:483–485`).

Cách ẩn ít rủi ro nhất là bỏ mục khỏi sidebar trong `frontend/js/components/aver-admin-chrome.js` (dòng 479–517: "Import bài luyện", "Import Cambridge") hoặc đưa vào nhóm "Thí điểm & QA" vốn `collapsedByDefault` (dòng 563). Giữ route sống để rollback. Chặn ở API chỉ nên làm sau khi script đã thay thế đầy đủ.

---

## 5. Hiện diện trực tiếp / cộng đồng

### Hiện trạng
- **Sự kiện:** bảng `analytics_events(event_name, event_data, session_id, user_id, created_at)` (`backend/migrations/018_analytics_events.sql`, `user_id` thêm ở Sprint 17.4). Ghi qua `POST /api/analytics/events` (`backend/routers/analytics.py:127`), dạng best-effort, bỏ sự kiện khi quá 8 insert đồng thời. Các sự kiện đang phát: `page_view` (`frontend/components/next-page-view-beacon.tsx`, `frontend/js/analytics-beacon.js`), `web_vitals`, `vocab_wiki_viewed`, `writing_tip_view`, `prompt_view`, `prompt_bank_view`, `pronunciation_drilldown_view`.
- **Admin:**
  - `/admin/foot-traffic` gọi `GET /admin/analytics/foot-traffic` (`backend/routers/admin.py:2008`): `total_views, unique_visitors, anonymous_hits, top_pages, daily`.
  - `/admin/usage` gọi `GET /admin/usage/users` (`admin.py:1851`): số phiên, lần hoạt động gần nhất, chi phí AI.
  - `/admin` gọi `GET /admin/overview` (`backend/routers/admin_overview.py:239`, model `backend/models/admin_overview.py`): visitors 7/30 ngày và **`recent_activity[]{timestamp, user_id, user_email, skill, action, score, link}`**. Cache 300 giây.
- **Realtime:** không thấy dùng Supabase Realtime, channel hay presence trong frontend, và không có `ALTER PUBLICATION supabase_realtime` trong migrations. Không có heartbeat hay `last_seen`.
- Streak học viên tính từ hoạt động (`backend/services/student_home_aggregator.py:_build_streak`, `dashboard_aggregator.py:233`).

### Muốn hiện "N người online, N người đang làm bài, ai vừa làm xong loại bài gì"
- **Dùng được ngay:**
  - "Đang làm bài" ước lượng từ các phiên chưa kết thúc gần đây: `quiz_sessions.ended_at IS NULL`, `sessions.status`/`completed_at` (Speaking), `grammar_lesson_attempts.status='in_progress'`, `mock_exam_sittings`, reading/listening attempts, mỗi nguồn lọc theo cửa sổ khoảng 15 phút.
  - "Vừa làm xong": logic `recent_activity` đã có ở overview.
  - "Online" xấp xỉ: số user có `page_view` trong 5 phút gần nhất (`analytics_events`).
- **Thiếu:** heartbeat hoặc presence thật (đóng tab không phát sự kiện); endpoint công khai cho học viên, hiện chỉ có endpoint admin; cache hoặc tổng hợp để không quét bảng nóng (đã có sự cố hiệu năng 2026-10-30 ghi trong `analytics.py`); cờ đồng ý hiển thị.
- **Rủi ro riêng tư:** `recent_activity` trả `user_email` và điểm, tuyệt đối không đưa nguyên dạng ra phía học viên. Nên chỉ hiện số đếm gộp, hoặc tên viết tắt / biệt danh khi học viên **opt-in**, không kèm điểm. Có học viên trẻ (định hướng THPT) và học viên thuộc lớp nhỏ, nơi "ai vừa làm xong" dễ nhận diện ra người cụ thể. Phải lọc tài khoản staff và test (`test_data_visibility` trong `admin_students.py`). Nên đặt ngưỡng tối thiểu, ví dụ chỉ hiện khi N ≥ 3.

---

## 6. Trang tổng hợp MỘT học viên phía admin

### Hiện trạng
- `/admin/students` (`admin-students-directory.tsx`): bảng Học viên / Lớp / Mục tiêu / Tài khoản. Mở một em ra ngăn kéo gồm "Ghi chú học tập", "Bài đã giao", "Lịch sử nộp bài", "Writing", "Listening", "Bài viết gần đây".
  - Nguồn: `GET /admin/students/{id}` (`admin_students.py:108`, "student + recent essay history (up to 50)") và `GET /admin/writing/students/{id}/summary`.
- Trong lớp: `GET /admin/cohorts/{c}/students/{s}/work` (`admin_class_assignments.py:2212`), UI `admin-class-student-work.tsx`. Có Được giao / Đã nộp / Không nộp và danh sách bài, mỗi bài có `title, skill, due_at, status, submitted_at, score, artifact…`.
- Lớp: `GET /admin/cohorts/{c}/progress` (`backend/routers/cohorts.py:542`) dựng ma trận 4 kỹ năng, gồm "Nộp đúng hạn" và "Hoạt động gần nhất" (bảng trong `admin-class-detail.tsx:577`). `speaking-performance` và `speaking-daily` có danh sách "ai cần chú ý".
- Riêng quiz: `GET /admin/quiz/students/{user_id}?skill_area=` (`admin_quiz.py:241`).

### Dữ liệu đang lưu
- `students`: `target_band, target_date, persona_notes, current_band_estimate, flag_count, last_flagged_at, is_under_review, archived_at, archive_reason` (`backend/migrations/033_writing_coach_tables.sql`, `040_spam_detection.sql`, mig 326).
- `users`: `target_band, exam_date, self_level, preferred_topics, onboarding_completed` (`005_add_user_profile.sql`).
- Chuyên cần: `class_assignment_items` (`submitted_at` so với `due_at`), streak (`student_home_aggregator`), phiên các kỹ năng, `analytics_events`.
- Điểm: `quiz_sessions.accuracy`, band Speaking/Writing, mock roster bands.
- Nhật ký thao tác lớp: `GET /{c}/action-log` (append-only, spec 0041).

### Thiếu cho đội chăm sóc khách hàng
- Không có một trang hồ sơ hợp nhất theo thời gian (timeline) gồm mục tiêu, mức hiện tại, điểm qua các buổi và mock, chuyên cần, bài trễ.
- `persona_notes` chỉ là một ô văn bản. Không có bảng ghi chú chăm sóc nhiều dòng (người ghi, thời điểm, kênh liên hệ, việc cần làm, hẹn nhắc).
- Không có cảnh báo tổng hợp cấp học viên, ví dụ: trễ 2 bài liên tiếp, không hoạt động 7 ngày, điểm tụt, gần ngày thi mà còn xa mục tiêu. Hiện cờ chỉ nằm rải trong từng bảng (`course_stalled`, flags Speaking, `flag_count` spam Writing).
- Hai mục tiêu bị trùng lặp: `students.target_band/target_date` (admin nhập) và `users.target_band/exam_date` (học viên tự khai lúc onboarding). Không có chỗ nào đối chiếu hai nguồn này.

---

## 7. Testimonial, khảo sát, kiến thức nền, dịch câu Reading, THPT, dàn bài Course 1

- **Testimonial:** không có bảng hay route nào. Chỉ có kế hoạch tài sản mạng xã hội `post-testimonial-1080`, `story-testimonial` (`docs/SOCIAL_FANPAGE_PLAN_2026-08-09.md:165–166`).
- **Khảo sát / feedback:** không có form builder hay survey sau khoá. Có `user_feedback` (`backend/migrations/100_user_feedback.sql`) với kiểu `rating|report|flag`, nhưng chỉ cho **reading/listening**: chấm sao chất lượng đề và audio, báo lỗi câu. Dùng `POST /feedback` và `/admin/feedback` (`backend/routers/feedback.py`).
- **Kiến thức nền/xã hội theo chủ đề:** không có trang riêng. Gần nhất là Grammar Wiki (`backend/content/_groups.yaml`, các thư mục `backend/content/foundations|tenses|…`), `topic_tags` của bài Reading, và chủ đề Speaking/Vocab.
- **Dịch câu trong Reading:** đã có cho L1/L2. Bài có `metadata.translation_vi` kèm alignment `precision: sentence|paragraph` và hash nguồn (`backend/services/reading_practice_support.py:38–98`), trả ra qua `backend/routers/reading_student.py:431–440`. Spec `specs/0021-reading-practice-support/spec.md` ở trạng thái "implementing": bấm câu thì hiện bản dịch tại chỗ, có liên kết cụm hai chiều. Không có công cụ dịch tự động; bản dịch do người soạn sẵn.
- **THPT quốc gia:** chỉ có khung dữ liệu. `exam_tests.source` cho phép `'thpt_qg'` (`backend/migrations/134_exam_module_foundation.sql:23`, `backend/services/exam_service.py:29`), nhưng `backend/content/exams/` chỉ có toeic-p5, grammar-practice, grammar-reading, vocab-context. **Không có đề THPT nào.**
- **Dàn bài khoá ngữ pháp:** nguồn là `backend/content/master30-assigned-practice/v2.json` (`title` và `focus` của 30 buổi). Bank gốc `Buoi-XX/KBT-buoi-XX.jsonl` (trường `original_source` trong `v3.json`), cùng nguồn với bài tập theo buổi Course 1 (`import_course_exercise_bank.py --course C1`). Đề giữa kỳ của Course 1 phủ B01–B11, đề cuối kỳ `C1-FINAL-B01-B20-300` phủ B01–B20 (`specs/0043…/spec.md`). Khoá MASTER30 có 30 buổi; phần nào thuộc Course 1 thì repo chỉ xác nhận B01–B20 qua đề cuối kỳ.

| Buổi | Chủ đề (title) | Trọng tâm (focus, rút gọn) |
|---|---|---|
| B01 | Bản đồ khoá học & Bộ khung câu | Nòng cốt câu, sửa câu thiếu/lặp thành phần |
| B02 | Âm & chữ | Chính tả vs âm cuối, dạng động từ |
| B03 | Danh từ | Đơn vị đếm, lượng từ |
| B04 | Định từ (1) — Mạo từ | Mạo từ theo âm, xác định, loại danh từ |
| B05 | Định từ (2) & Đại từ | Sở hữu, lượng từ, tham chiếu đại từ |
| B06 | Tính từ | Danh từ bổ nghĩa, cụm mô tả |
| B07 | Ôn + Kiểm tra 1 | Tích hợp B01–B06 |
| B08 | Trạng từ | Dạng, vị trí, phạm vi |
| B09 | So sánh | Dạng và đối tượng so sánh |
| B10 | Giới từ | Cấu trúc, quan hệ nghĩa, cụm cố định |
| B11 | Từ vựng có hệ thống | Họ từ, danh từ hoá |
| B12 | Cây động từ & Thuật toán đọc thì | Thời, thể, dạng theo sau |
| B13 | Thì hiện tại & quá khứ | Thói quen, quá trình, trạng thái, kể chuyện |
| B14 | Thì hoàn thành | Mốc nhìn, kết quả vs quá trình |
| B15 | Diễn đạt tương lai | Cam kết, kế hoạch, lịch hẹn |
| B16 | Hoà hợp chủ ngữ–động từ | Hạt nhân chủ ngữ |
| B17 | Câu bị động | Chủ ngữ nhận tác động, giữ thời |
| B18 | Ôn + Kiểm tra 2 | Tích hợp B12–B17 |
| B19 | Modal (1) — Cách dùng thông thường | Năng lực, cho phép, nghĩa vụ, lời khuyên |
| B20 | Modal (2) — Dự đoán & Hedging | Suy luận vs nghĩa vụ, mức chắc chắn |
| B21 | Câu điều kiện & Ước | Mức độ giả định |
| B22 | Non-finite (1) — Ving/V3ed | Chức năng -ing/V3 |
| B23 | Non-finite (2) — to-Vo & verb patterns | Cặp -ing/to |
| B24 | Câu ghép, liên từ & dấu câu | Nối mệnh đề độc lập |
| B25 | Mệnh đề danh từ & câu tường thuật | Trật tự nhúng, lùi thì |
| B26 | Mệnh đề trạng từ & mệnh đề quan hệ | Bổ nghĩa sự kiện vs danh từ |
| B27 | Rút gọn mệnh đề | Kiểm chủ thể, thể, thời |
| B28 | Nhấn mạnh | Cleft, đảo ngữ |
| B29 | Liên kết cấp độ đoạn | Quy chiếu, quan hệ logic, thay thế |
| B30 | Ngôn ngữ số liệu & Tổng kết | Mô tả dữ liệu, tự chẩn đoán lỗi |

Mỗi bank buổi có khoảng 100–120 câu, gom thành 6–11 nhóm `truc_nhom` (ví dụ B01: NONG-COT, O-VS-C, DONG-TU-NOI, DU-S-V, SAU-V; B13: HIEN-TAI-DON-TIEP-DIEN, TRANG-THAI-CAM-TIEP-DIEN…) và 17 dạng `dang`. Đây chính là trục nên dùng cho báo cáo lớp ở mục 1.

---

## Bảng tóm tắt

| # | Hiện trạng (một dòng) | Khoảng trống (một dòng) |
|---|---|---|
| 1 | Lớp có 3 tab Tổng kết / Tiến độ lớp / Inspect với 3 API (`tally`, `attempt-report`, `students/{u}/report`); lưu từng câu (`quiz_attempts`: đáp án chọn, ms, lượt) | Trục lỗi gom theo `truc` gần như duy nhất mỗi câu và cắt top 15; không có tỉ lệ đúng theo câu, nhóm `truc_nhom`, phân bố điểm, so với buổi trước; báo cáo theo buổi (spec 0043) chưa có mã |
| 2 | Live console poll 5 giây: trạng thái từng phần, số câu đã trả lời, hoạt động gần nhất, integrity; sau thi có roster điểm và pacing từng em | Không có phân tích câu/loại câu cho cả kỳ, pacing tổng hợp, cảnh báo chủ động hay so sánh kỳ trước |
| 3 | `mock_exams` gắn một `cohort_id`; hai chế độ `sequential` (live) và `retake` (tự canh giờ, giao từng user và kỹ năng qua `mock_exam_assignments`) | Live không giao được cho nhóm chọn tay hay nhiều lớp; "tự làm" bị đóng khung là thi lại; cần bảng audience và chế độ `live`/`self_paced` |
| 4 | Khoảng 12 trang có upload/import (quiz, vocab, reading, listening drills/fulltest/audio, prompts, tips, CSV học viên) và phần lớn đã có script tương ứng | Ẩn khỏi sidebar: import quiz/vocab/reading/listening/exams; giữ: CSV học viên, OCR bài viết, tips (chưa có script), sửa lẻ ảnh và prompt |
| 5 | `analytics_events` (page_view có `user_id`), foot-traffic, usage, overview `recent_activity` chỉ dành cho admin; không có realtime hay heartbeat | Thiếu presence thật, endpoint công khai có tổng hợp và cache, opt-in, ngưỡng N; `recent_activity` lộ email và điểm |
| 6 | Ngăn kéo học viên (mục tiêu, ghi chú `persona_notes`, bài đã giao, Writing/Listening) cùng trang work của lớp và ma trận tiến độ lớp | Không có timeline hợp nhất, ghi chú chăm sóc nhiều dòng, cảnh báo cấp học viên; hai nguồn mục tiêu (`students` vs `users`) không đối chiếu |
| 7 | Có dịch câu Reading L1/L2 soạn tay (spec 0021), feedback đề R/L, dàn bài 30 buổi MASTER30 (B01–B20 thuộc đề cuối kỳ Course 1); `thpt_qg` mới là giá trị enum | Không có testimonial, survey sau khoá, trang kiến thức nền theo chủ đề, nội dung THPT |
