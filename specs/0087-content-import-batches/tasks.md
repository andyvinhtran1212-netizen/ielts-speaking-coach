# Tasks

Mỗi task là một PR vào `staging`, nhánh `codex/<task>`, lớp `high-risk`, `Spec: CONTENTBATCH-0087`, chỉ sau khi spec này
`approved`. Số task = số nhiệm vụ trong gói (T008 = G09-T08). G09-T21 là chính PR spec này.

- [ ] T036 (G09-T36) Lô nhập và Câu cần kiểm: migration 449, 450, helper cho script, API đọc — MỚI. `depends: spec approved; xem mục 6.0`
- [ ] T037 (G09-T37) Ba trang Nội dung bốn thẻ; ẩn nhập thủ công — MỚI (2 PR). `depends: spec approved; xem mục 6.0`

Chi tiết từng nhiệm vụ (gói mục 6, chép nguyên):

### G09-T36 — Lô nhập và Câu cần kiểm: migration 449, 450, helper cho script, API đọc — MỚI
- Mục đích: FR-162, 163.
- Đầu vào: các script ở 2.6; `routers/admin_exam_content.py`; `routers/feedback.py`; mig 100, 121.
- Việc làm: migration 449, 450; `backend/services/import_batch_log.py` (`start(script, skill, mode) -> batch`, `add_item(batch, kind, id, action)`, `finish(batch, counts, error_report_path)`; lỗi ghi lô **không** làm hỏng lần nhập — bọc try/except, in cảnh báo); nối helper vào các script: `import_listening_content_package.py`, `import_skill_drills.py`, `import_listening_lessons.py`, `upload_listening_source_audio.py`, `import_cambridge_canonical_qa.py`, `import_writing_prompts.py`, `migrate_writing_images.py`, `import_speaking_bank_admin.py`, `import_speaking_lesson_sets.py`, `pregen_speaking_question_audio.py`, `import_reading_drills.py`, `reimport_wp5_reading.py`, `seed_vocab_curated.py`, `import_advanced_vocab_core30.py`, `pregen_vocab_audio.py`, `import_course_exercise_bank.py`, `import_course_assessment_bank.py`, `import_grammar_banks.py`, `reimport_grammar_banks.py` (mỗi script: gọi `start` đầu `main`, `finish` cuối; không đổi logic nhập); bảng tên đọc được của script trong `services/import_batch_log.py`; API `content/batches*`, `content/review*` (5.4); cờ `content_import_batches`.
- Đầu ra: 1 PR backend (tách 2 nếu quá 800 dòng: lõi + nối script).
- Nghiệm thu: pytest: chạy `import_skill_drills.py` chế độ chạy thử trên DB thử → một dòng lô `mode='dry_run'`; ghi lô lỗi (giả lập) → script vẫn thoát mã 0; `GET /admin/content/review` gộp một câu có hai lý do thành một dòng.
- Không làm: không đổi trạng thái mặc định của mục do script tạo (tờ ghi "vào Chờ duyệt" — đó là thay đổi hành vi nhập, ghi vào Q22b, không tự làm); không chặn API nhập cũ; không đụng script của dây chuyền Hermes.
- Vướng mắc → cách gỡ: script chạy không có danh tính người dùng → `actor` = biến môi trường `IMPORT_ACTOR` hoặc tên máy; ghi rõ trên giao diện "không rõ" khi trống. Script không có chế độ chạy thử → `mode='import'`.
- Ước lượng: 3 phiên · 3.

### G09-T37 — Ba trang Nội dung bốn thẻ; ẩn nhập thủ công — MỚI (2 PR)
- Mục đích: FR-160…163, 013.
- Đầu vào: tờ `AdminNoiDung`, `AdminNoiDungVietNoi`, `AdminNoiDungTuVungNguPhap`; T36; các component trang nội dung hiện có (2.6).
- Việc làm: PR 1 (Listening, Reading, Writing, Speaking): `ContentSkillPage` với bốn thẻ; thẻ Đề và bài dùng lại bảng/danh sách hiện có (bỏ cột Phiên bản; thêm cột Lô nhập khi cờ bật; thao tác hàng loạt Đăng… / Gỡ… / Thêm vào bộ…); chi tiết đề giữ route hiện có, bỏ điều khiển tải audio/video và nút nhập hàng loạt, giữ sửa lẻ (đáp án chấp nhận thêm, lời giải, tiêu đề tiếng Anh, ảnh, đường dẫn video); nút "Giao bài này…". PR 2 (Từ vựng, Ngữ pháp): tương tự; `curated`, `d1-curation`, `exercises` → `?tab=items&status=pending`; ẩn form `POST /admin/vocabulary/import`, `POST /admin/quiz/import`; bỏ khối "Số liệu dùng · 30 ngày" (thay bằng link Báo cáo đã lọc). Cả hai: thẻ Lô nhập, Câu cần kiểm; 307 theo 5.1.
- Đầu ra: 2 PR. Nghiệm thu: preview: sáu trang có đúng bốn thẻ, tải lại giữ thẻ; không có `<input type="file">` cho nhập hàng loạt trên sáu trang (`grep -rn 'type="file"' frontend/components/admin/content` chỉ còn ảnh lẻ); `/admin/listening/import-fulltest` vẫn mở được bằng đường dẫn, có dải cảnh báo; Writing còn "Tạo đề lẻ", "Tạo mẹo lẻ"; Speaking còn "Tạo chủ đề lẻ"; OCR `/admin/writing/new` và Import CSV học viên vẫn chạy.
- Không làm: không viết lại editor; không dựng "tính lại điểm khi đăng bản đổi đáp án" (hộp đăng chỉ ghi "bài đã nộp giữ điểm theo bản cũ"); không xoá route/API nhập.
- Vướng mắc → cách gỡ: test cũ ghim chuỗi của trang nội dung → sửa cùng PR, liệt kê; > 30 test → dừng. Quyền "người có quyền duyệt" chưa có khái niệm riêng → admin = có quyền duyệt; ghi trong PR.
- Ước lượng: 4 phiên · 3.
