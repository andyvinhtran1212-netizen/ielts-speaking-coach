# Rollout and rollback

## Preconditions

- Spec `approved` trên `staging`; số migration 473, 474 (475, 476 hoãn) chưa bị file hay PR khác dùng; ghi vào sổ số migration (`backend/migrations/register.tsv` khi G01-T06 đã merge).
- Không có cờ bật/tắt tính năng. Chế độ trả điểm là cột của từng bài giao; bài cũ (NULL) chạy như `immediate`. Biến env `COURSE_TEST_DEFAULT_RELEASE_MODE` (mặc định `teacher_release`) chỉ là giá trị chọn sẵn dự phòng trên giao diện giao bài khi không xác định được loại lớp (`tasks.md` T23); thiếu biến hay giá trị lạ thì dùng `teacher_release` (không mở điểm). Đổi hay xoá biến này không che và không mở điểm của bài nào đã giao.
- Bài giao trước gói (chế độ NULL) và bài `mastery` không đổi hành vi (FR-074, E6): so JSON và ảnh trước/sau trên staging.
- Giá trị chọn sẵn khi giao bài: lớp offline `teacher_release`, khoá online tự học `immediate` (câu 13); do giao diện T23 chọn sẵn.

## Staging

- Thứ tự áp: 473 (lược đồ + thu quyền đọc thẳng) → cổng máy chủ trên mọi đường đọc → 474 (RPC công bố, hẹn giờ) → bước hẹn giờ trong job → màn học viên; 475, 476 hoãn. Migration chạy trên staging trước dưới khoá advisory, test PG17 + postcondition; nghiệm thu các kịch bản E* bằng tài khoản QA/thử.

## Production

- Chỉ qua PR `staging → main`; migration production cần anh Andy duyệt bằng lời trước khi mã phụ thuộc lên. Không bật cờ, không gửi thông báo hay thư, không nộp bài trên production trong gói này.

## Rollback and repair

- Migration chỉ thêm đối tượng nên **không hạ migration** trên staging hay production. File `backend/migrations/rollback/473_*.sql` và `474_*.sql` chỉ dùng cho PG test cục bộ và CI, không chạy trên môi trường thật (xem `plan.md` 5.5.2). Thu quyền đọc thẳng ở 473 không bao giờ quay lui (là sửa lỗ hổng dữ liệu đã ghi ở `01` mục 6).
- **Cổng đọc không được quay lui khi còn bài chờ công bố.** Bản backend trước T22 trả điểm mà không xem bảng công bố, và không có cờ nào che được. Mốc lui thấp nhất là bản đã có cổng đọc 5.5.5 (T22). Các phần khác (route công bố, hẹn giờ, giao diện T23, T24, T27) lui bằng revert riêng PR đó, giữ T22.
- **Cấm lui xuống dưới T22 khi `awaiting_release > 0`.** Không có lối thoát "khoá đọc" thay thế. Trước khi lui, chạy truy vấn đếm chỉ đọc dưới đây; kết quả khác 0 thì dừng, không deploy:
  ```sql
  SELECT count(*) AS awaiting_release
  FROM public.class_assignment_items i
  JOIN public.class_assignments a ON a.id = i.assignment_id
  WHERE a.result_release_mode = 'teacher_release'
    AND NOT EXISTS (SELECT 1 FROM public.course_result_releases r
                    WHERE r.item_id = i.id AND r.level_rank = 3);
  ```
  Bản trước T22 trả cả đáp án và lời giải, nên chỉ mức `full` (`level_rank = 3`) mới được tính là đã công bố hết. Truy vấn đếm **mọi** item của bài `teacher_release`, kể cả item chưa nộp: bài còn mở mà lui về bản cũ thì lần nộp sau sẽ đi thẳng qua đường đọc không có cổng. Kết quả bằng 0 nghĩa là mọi item của mọi bài `teacher_release` đều đã công bố ở mức `full`, nên bản cũ không còn gì để lộ. Truy vấn cố ý chặt: còn một bài `teacher_release` chưa công bố hết thì không lui dưới T22, kể cả khi học viên chưa nộp. Test T21 có ba ca: item chỉ công bố mức `score` vẫn được đếm; item `score_correctness` vẫn được đếm; item chưa nộp của bài `teacher_release` đang mở vẫn được đếm. Kết quả và giờ chạy được ghi vào PR revert.
- Kiểm lui trên staging bằng chính test vi sai của FR-094: hai học viên thử cùng bài `teacher_release` chưa công bố, một đậu và một trượt; sau khi lui phần khác (giữ T22), gọi mọi đường đọc của học viên ở 5.5.5, kể cả `POST /course/full-retry`; mã HTTP và JSON của hai người phải giống hệt nhau sau khi bỏ id và giờ, và điểm cùng đáp án vẫn vắng.

## Observability

- Log theo lý do và trạng thái, không ghi email, tên, số tiền, mã đơn, nội dung bài (gói mục 8). Job ghi số dòng sinh / trùng / bỏ qua mỗi lần chạy.
