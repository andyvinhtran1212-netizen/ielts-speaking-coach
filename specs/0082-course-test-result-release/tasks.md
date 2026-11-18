# Tasks

Mỗi task một PR vào `staging`, nhánh `codex/<task>`, lớp `high-risk`, `Spec: COURSETESTRELEASE-0082`, sau khi spec `approved`.
G11-T04 là chính PR spec này. Số task = số nhiệm vụ trong gói.

- [ ] T21 (G11-T21) Migration 473: lược đồ công bố và thu quyền đọc thẳng. `depends: spec approved; xem bảng gói mục 6`
- [ ] T22 (G11-T22) Cổng máy chủ trên mọi đường đọc của học viên. `depends: spec approved; xem bảng gói mục 6`
- [ ] T23 (G11-T23) Migration 474 và API chế độ, công bố, hẹn giờ. `depends: spec approved; xem bảng gói mục 6`
- [ ] T24 (G11-T24) Bước hẹn giờ trong job và thông báo công bố. `depends: spec approved; xem bảng gói mục 6`
- [ ] T27 (G11-T27) Màn học viên của bài kiểm tra. `depends: spec approved; xem bảng gói mục 6`
- [ ] T25 (G11-T25) Nộp trễ và vắng (migration 475). **HOÃN** (câu 16) — không làm trong đợt đầu. `depends: spec approved; xem bảng gói mục 6`
- [ ] T26 (G11-T26) Làm bù và làm lại. **HOÃN** (câu 16) — không làm trong đợt đầu. `depends: spec approved; xem bảng gói mục 6`

Bảng phụ thuộc của cả gói và chi tiết từng nhiệm vụ (gói mục 6, chép nguyên):

| Mã | Tên | Phần | Phụ thuộc | Phiên | Độ khó |
|---|---|---|---|---|---|
| G11-T21 | Migration 473 lược đồ công bố + thu quyền đọc thẳng | E | T04 | 1 | 5 |
| G11-T22 | Cổng máy chủ trên mọi đường đọc + test không lộ | E | T21 | 2 | 5 |
| G11-T23 | Migration 474 + API chế độ, công bố, hẹn giờ | E | T22 | 1 | 4 |
| G11-T24 | Bước hẹn giờ trong job + thông báo công bố | E | T23, T10 | 1 | 3 |
| G11-T25 | **HOÃN** (trả lời câu 16) — nộp trễ và vắng (migration 475) | E | T23 | (2) | 5 |
| G11-T26 | **HOÃN** (trả lời câu 16) — làm bù / làm lại | E | T23 | (1) | 4 |
| G11-T27 | Màn học viên bài kiểm tra (KiemTraKhoa 1–6, 8) | E | T22, G03, G07-T15 | 2 | 3 |

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
- Mục đích: 5.5.4–5.5.6; FR-063, 064, 070, 074.
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
- Việc làm: migration 474 + test PG17 (hai giáo viên cùng bấm công bố → một dòng mỗi item; lặp `request_key` → cùng kết quả; hẹn giờ chỉ công bố bài nộp trước giờ); sửa `AssignmentCreate` + kiểm; route `release-mode`, `release`, `release-schedule`; `tally` thêm trường; giá trị chọn sẵn trên giao diện giao bài theo câu 13 đã trả lời 17/11: lớp offline chọn sẵn `teacher_release`, khoá online tự học chọn sẵn `immediate`; config `COURSE_TEST_DEFAULT_RELEASE_MODE` (env) chỉ là giá trị dự phòng khi không xác định được loại lớp, mặc định `teacher_release`; **không** tự gán cho bài khi request không gửi trường (giữ hành vi cũ). Test: drawer của lớp offline mở ra đã chọn `teacher_release`; request tạo bài không có `result_release_mode` giữ hành vi cũ.
- Đầu ra: 1 PR.
- Nghiệm thu: test backend + PG17 pass; `test_staff_guard_inventory.py` pass; tạo bài giao mastery với `result_release_mode` → 400.
- Không làm: không gửi thông báo trong RPC.
- Vướng mắc → cách gỡ: RPC giao bài nguyên tử hiện có ghi `content_config` — cột mới phải truyền vào RPC đó (CHƯA KIỂM tên hàm tạo bài: `grep -n "rpc(" backend/routers/admin_class_assignments.py`) hoặc UPDATE ngay sau trong cùng lệnh gọi; chọn cách đổi RPC nếu RPC đang là nơi duy nhất ghi bài giao.
- Ước lượng: 1 phiên · 4.

### G11-T24 — Bước hẹn giờ trong job và thông báo công bố
- Mục đích: FR-067, 068.
- Đầu vào: T10, T23.
- Việc làm: bước `course_release_schedule` (gọi `fn_course_result_run_schedules(200)`) chạy **trước** bước `course_test_released` trong `notification_sweep.py`; test: hẹn 10:00, item A nộp 09:50, B nộp 10:03 → sau job lúc 10:05 A `released`, B `awaiting_release`, một thông báo cho A; nâng mức A → thông báo thứ hai.
- Đầu ra: 1 PR.
- Nghiệm thu: test pass.
- Không làm: không chạy công bố trong request của học viên.
- Vướng mắc → cách gỡ: job trễ (cron 5 phút) → học viên thấy kết quả trễ tối đa 5 phút sau giờ hẹn; ghi trong spec, không dựng cron thứ hai.
- Ước lượng: 1 phiên · 3.

### G11-T27 — Màn học viên của bài kiểm tra
- Mục đích: tờ KiemTraKhoa mục 1–6, 8 theo khối `course_test`.
- Đầu vào: tờ `KiemTraKhoa`; trình làm bài Course hiện có (CHƯA KIỂM file: `ls frontend/app | grep -i course-exercises` và `grep -rln "course-timer" frontend/app frontend/lib | head`); component G03; Lộ trình G07-T15.
- Việc làm: màn trước khi làm (hộp xác nhận), màn chờ công bố, màn đã công bố theo mức, vắng, chưa mở (đếm ngược theo giờ máy chủ); nộp trễ và làm lại hoãn cùng T25, T26 nên không hiện nút; component màn kết quả nhận prop `preview` để G09-T30 dựng lại ở "Xem như học viên thấy"; báo cáo theo buổi (0043) chỉ khi mức ≥ 2; "Xem lại từng câu" chỉ khi mức ≥ 2, đáp án chỉ khi mức 3 và `answers_release_at` đã qua; câu chữ tiếng Việt (bài kiểm tra của khoá **không** dùng phòng thi tiếng Anh); bản 390px theo mục 8 của tờ.
- Đầu ra: 1 PR (2 phiên).
- Nghiệm thu: test React mỗi trạng thái × mức theo dữ liệu giả của khối `course_test`; không bao giờ hiện "0/0" hay band; ảnh 1280/390 đính PR.
- Không làm: không đổi trình làm bài (đồng hồ, lưu từng câu) ngoài phần hiện trạng thái.
- Vướng mắc → cách gỡ: trình làm bài cũ là JS trong `public/js` → chỉ thêm màn trạng thái ở trang React bao ngoài, ghi rõ; dữ liệu theo buổi thiếu (đề không gắn buổi) → ẩn bảng theo buổi, không hiện 0% (tờ ghi chú 6).
- Ước lượng: 2 phiên · 3.

### G11-T25 — Nộp trễ và vắng (migration 475)
- Mục đích: FR-071, 072; 5.5.9.
- Đầu vào: định nghĩa mới nhất của các hàm liệt kê ở 5.5.9; `quiz_service.py` dòng 2058–2175, 3299–3348, 5596–5973.
- Việc làm: đọc và lập bảng mọi chỗ dùng `due_at` trong các hàm (ghi vào PR); migration 475 `CREATE OR REPLACE` từng hàm với mốc `coalesce(late_until, due_at)`; sửa Python tương ứng; route `PATCH …/late-until`; trạng thái `absent` và `late_minutes` trong `course_test_state`; tally đếm vắng.
- Đầu ra: 1 PR (2 phiên).
- Nghiệm thu: test PG17: bài có giờ 60 phút, `due_at` 21:00, `late_until` 21:30, bắt đầu 20:50 → mốc cắt 21:30 (không phải 21:00 hay 21:50); không có `late_until` → hành vi y như trước (test cũ của 272/280 xanh không sửa); vắng không có điểm, `pct` lớp tính trên người đã nộp.
- Không làm: không cho lùi `late_until` sau khi bài có người bắt đầu.
- Vướng mắc → cách gỡ: điều kiện dừng ở 5.5.9; test cũ ghim chuỗi lỗi "hạn" → giữ nguyên chuỗi khi không có `late_until`.
- Ước lượng: 2 phiên · 5.

### G11-T26 — Làm bù và làm lại
- Mục đích: FR-073; route `retakes`.
- Đầu vào: kiểm trùng bank quanh dòng 986–998 của `backend/routers/admin_class_assignments.py` (`grep -n "409" backend/routers/admin_class_assignments.py | sed -n 1,8p`); RPC giao bài; `course_test_state` (chuỗi `retake_of`).
- Việc làm: route `POST …/retakes` tạo bài giao mới (`student_ids`, `retake_of`, `retake_kind`, hạn mới) qua cùng đường giao bài (không viết đường ghi thứ hai); bỏ qua kiểm trùng khi có `retake_of`; khối `course_test` trả `attempt_kind` và `root_assignment_id`; danh sách bài của học viên chỉ hiện lượt mới nhất của chuỗi, lượt cũ mở được bằng đường dẫn riêng; migration 476 chỉ khi có ràng buộc CSDL chặn trùng (5.5.10).
- Đầu ra: 1 PR.
- Nghiệm thu: test: makeup cho người không vắng → 409; retake trước khi người đó có kết quả → 409; chuỗi 3 lượt → danh sách hiện lượt 3, report lượt 1 vẫn đọc được (theo mức công bố của lượt 1).
- Không làm: không xoá hay sửa item của lượt cũ.
- Vướng mắc → cách gỡ: tally và báo cáo 0043 đếm theo bài giao → mỗi lượt là bài giao riêng, giao diện giáo viên gom theo `retake_of` (T28); `unactivated_count` của RPC giao bài tính lại cho nhóm nhỏ — giữ nguyên.
- Ước lượng: 1 phiên · 4.
