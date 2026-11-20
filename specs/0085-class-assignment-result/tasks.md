# Tasks

Mỗi task là một PR vào `staging`, nhánh `codex/<task>`, lớp `high-risk`, `Spec: CLASSRESULT-0085`, chỉ sau khi spec này
`approved`. Số task = số nhiệm vụ trong gói (T008 = G09-T08). G09-T21 là chính PR spec này.

- [ ] T025 (G09-T25) Nhóm đã lưu (migration 443) — MỚI. `depends: spec approved; xem mục 6.0`
- [ ] T026 (G09-T26) Thành phần giao bài dùng chung; bỏ hai sổ giao bài — MỚI. `depends: spec approved; xem mục 6.0`
- [ ] T027 (G09-T27) API tổng hợp Kết quả một bài giao (migration 444) — MỚI. `depends: spec approved; xem mục 6.0`
- [ ] T028 (G09-T28) Trang Kết quả một bài giao — MỚI. `depends: spec approved; xem mục 6.0`
- [ ] T030 (G09-T30) Bảng công bố điểm bài kiểm tra khoá (giao diện) — MỚI. `depends: spec approved; xem mục 6.0`

Chi tiết từng nhiệm vụ (gói mục 6, chép nguyên):

### G09-T25 — Nhóm đã lưu (migration 443) — MỚI
- Mục đích: nhóm dùng chung cho giao bài, kỳ thi; FR-121, 142.
- Việc làm: migration + rollback; `routers/admin_learner_groups.py` (5.4); giáo viên chỉ thấy/sửa nhóm mình tạo; thành viên phải là học viên active; test quyền.
- Đầu ra: 1 PR backend. Nghiệm thu: pytest: giáo viên thêm học viên lớp khác vào nhóm → 404; lưu trữ nhóm không xoá thành viên.
- Không làm: không làm nhóm "theo điều kiện" (động).
- Vướng mắc → cách gỡ: học viên rời lớp → vẫn ở nhóm; nơi dùng nhóm lọc lại theo lớp/kỳ thi lúc áp dụng và báo số người bị bỏ. Tên nhóm trùng trong cùng chủ → 409 `name_taken`.
- Ước lượng: 1 phiên · 2.

### G09-T26 — Thành phần giao bài dùng chung; bỏ hai sổ giao bài — MỚI
- Mục đích: FR-121…123.
- Đầu vào: tờ `ThanhPhanDuLieu` mục "Giao bài theo buổi", `CHUAN-ADMIN.md` mục E; `admin-class-homework.tsx`; `routers/admin_class_assignments.py` (`AssignmentCreate` dòng 168–296, `POST …/assignments` dòng 2742, `course-banks` 1035, `PATCH …/due` 3110); T24, T25; GOI-11 5.5.8.
- Việc làm: `AssignDrawer` (5.7); chọn nhiều bài → gọi `POST` từng bài; trùng (lớp, bài) (API trả 409 "Lớp này đã được giao … rồi": bank khoá ở dòng ~995, chủ đề Speaking ~595, bộ đề ~751 — số dòng ở `c3bc71574`) → cảnh báo hai lựa chọn (giữ hạn cũ / gọi `PATCH …/due`); "Chế độ trả điểm" chỉ khi bài là bài kiểm tra **và** GOI-11 phần E đã có; backend: mở `POST …/assignments` và `PATCH …/due` cho giáo viên của lớp. Bỏ khỏi giao diện: thẻ/sổ giao bài Writing (`/admin/writing/assignments` → 307) và tab `assign` ngữ pháp; trang một đề ở Nội dung có nút "Giao bài này…".
- Đầu ra: 1 PR. Nghiệm thu: staging: mở từ lớp, Việc cần làm, hồ sơ (chọn sẵn một người), trang một đề (chọn sẵn đề) đều ra cùng một ngăn; giao "Chọn tay 3 người" → 3 `class_assignment_items`; giao trùng → cảnh báo, không tạo bản thứ hai; hạn mặc định 23:59 ngày học của buổi.
- Không làm: không xoá API `admin_writing_assignments.py` (khu giáo viên hiện tại và dữ liệu cũ còn dùng); không tự thêm giới hạn "ngữ pháp chỉ Course 5" trên giao diện (máy chủ đã chặn ở `_require_course_five`).
- Vướng mắc → cách gỡ: buổi không có `lesson_date` → hạn mặc định trống, bắt người dùng chọn. PR #2254 có luồng giao bài khác → giữ phần không trùng, liệt kê trong PR.
- Ước lượng: 2 phiên · 3.

### G09-T27 — API tổng hợp Kết quả một bài giao (migration 444) — MỚI
- Mục đích: FR-124…130; hợp đồng `result` ở 5.4.
- Đầu vào: `admin_class_assignments.py` (`assignment_tally` 1649, `_hand_in_status` 1541); `services/quiz_service.py` (`course_attempt_report` 6382, `course_answer_report` 6041); mig 119, 186, 188, 189; `scripts/import_course_exercise_bank.py`; spec 0043; `backend/content/master30-assigned-practice/v2.json` (tên buổi).
- Việc làm: 1) Migration 444 + rollback. 2) `services/assignment_result.py`: dùng lại hàm sẵn có để lấy danh sách học viên và lượt làm (không chép truy vấn), viết phần gom mới theo `skill`/`subtype`. 3) Ba biến thể. 4) File nhãn `backend/content/course-labels/truc_nhom_vi.json`, `subtype_vi.json` (bắt đầu rỗng `{}` + cơ chế; tên do anh Andy duyệt — Q27). 5) `remind`, `review-items`, `assignment-matrix`. 6) Cờ `assignment_result_v2`. 7) Test: người chưa nộp không bị tính 0; không cắt nhóm (bank thử 11 nhóm → 11 nhóm); gom theo `subtype`; `previous=null` khi không có bài trước; nhắc hai lần một ngày → lần hai `skipped_already_today`; giáo viên lớp khác → 404; bài chế độ công bố vẫn có điểm cho nhân sự.
- Đầu ra: 1 PR backend.
- Nghiệm thu: pytest qua; trên staging gọi API cho một bài Course 1 kiểm thử: số nhóm = số giá trị `skill` khác nhau của bank, tổng `states` = sĩ số nhận bài.
- Không làm: không sửa, không xoá `tally`, `attempt-report`, `students/{u}/report`; không lưu `lesson_primary`; không tách mã ngộ nhận.
- Vướng mắc → cách gỡ: đề giữa/cuối kỳ có câu không suy được buổi → nhóm `key="unknown"`, nhãn "Chưa gắn buổi", ghi số câu; không đoán. Chậm với lớp lớn → một truy vấn `quiz_attempts` theo danh sách session, gom ở Python; đo và ghi vào PR, không thêm index khi chưa hỏi. GOI-11 T28 hiện ghi "không thêm API đọc thứ tư" → điểm phải khớp ở mục 7.
- Ước lượng: 3 phiên · 4.

### G09-T28 — Trang Kết quả một bài giao — MỚI
- Mục đích: FR-125…130.
- Đầu vào: tờ `AdminKetQuaBaiGiao`; T27; `admin-class-submissions.tsx` (thay); `lib/admin-class-submissions-model.mjs`.
- Việc làm: route `/admin/classes/[cohortId]/assignments/[assignmentId]`; 5 khối, mỗi khối khung chờ riêng; khối 1 thanh năm trạng thái + ba nhóm cần việc + "Gửi nhắc"; khối 2 dải điểm lượt đầu; khối 3 bảng nhóm, mở nhóm, nút đổi cách gom; khối 4 bảng + "Thêm ghi chú" (mở thẻ ghi chú của hồ sơ), "Gửi thông báo cho N người đã chọn…"; khối 5 chọn câu + "Lưu vào buổi N" + bản "Chữa trên lớp" (không tên học viên); biến thể `rubric`, `course_test` (nút "Mở bảng công bố điểm"). Trang lớp: tên bài mở trang này khi cờ bật; ba tab cũ còn sau cờ tắt.
- Đầu ra: 1 PR. Nghiệm thu: staging với bài kiểm thử: chưa ai nộp → chỉ khối 1; có bài nộp → 5 khối; không có chữ "trục"; không có ba bộ nhãn trạng thái cũ (`COURSE_STATE`, `EFFORT_BASE`) trên trang; lỗi giả lập ở một khối không làm hỏng khối khác; 1024px bảng khối 3 gộp cột phụ.
- Không làm: không công bố điểm ở trang này; không xoá file ba tab cũ trong PR này (xoá khi gỡ cờ).
- Vướng mắc → cách gỡ: nhãn nhóm chưa có tên Việt → hiện mã (`label_source: "code"`), không chặn phát hành. "Gửi thông báo" khi GOI-11 A chưa có → nút tắt kèm lý do.
- Ước lượng: 3 phiên · 3.

### G09-T30 — Bảng công bố điểm bài kiểm tra khoá (giao diện) — MỚI
- Mục đích: FR-131. Backend ở GOI-11 phần E (T21–T24 của GOI-11); nhiệm vụ này **thay** phần giao diện mà G11-T28 mô tả (mục 7).
- Đầu vào: tờ `KiemTraKhoaGiaoVien`, `KiemTraKhoa` mục 5–7; GOI-11 5.5.8 (`release`, `release-schedule`, `release-mode`, `tally` mở rộng); T27 (khối "Theo buổi" lấy từ `result` biến thể `course_test`).
- Việc làm: route `/admin/classes/[cohortId]/assignments/[assignmentId]/release` (admin và giáo viên của lớp); bảng học viên (bài nộp, câu đúng, tỉ lệ, mức đã công bố, "vắng"); chọn mức; quy tắc nút cả lớp / đã chọn; hộp hỏi lại + "Xem như học viên thấy" (dựng component màn học viên của G07/GOI-11 T27 ở chế độ xem trước cho người đầu danh sách); hẹn giờ; khoá chế độ sau bài nộp đầu (ẩn nút, ghi lý do).
- Đầu ra: 1 PR. Nghiệm thu: test React: có dòng chọn → nút cả lớp tắt; mức thấp hơn mức đã công bố bị tắt; `release` gửi đúng `student_ids`; staging: công bố mức `score` cho 2 người → hai tài khoản kiểm thử thấy điểm, người thứ ba chưa thấy; không có điều khiển nộp trễ/làm bù/làm lại trên trang.
- Không làm: không thu hồi, không hạ mức; không dựng nộp trễ, làm bù, làm lại (đợt sau).
- Vướng mắc → cách gỡ: GOI-11 phần E chưa merge → dừng, làm nhiệm vụ khác. Component màn học viên chưa có → "Xem như học viên thấy" hiện danh sách trường sẽ hiện ở mức đó (theo GOI-11 5.5.4), ghi trong PR.
- Ước lượng: 2 phiên · 3.
