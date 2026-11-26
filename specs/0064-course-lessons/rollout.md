# Rollout and rollback

## Preconditions

- Spec đã `approved` trên `staging` (anh Andy duyệt, có `approval-decision.md`).
- Số migration trong dải 420–439 chưa bị file hay PR nào khác dùng. Dòng `register.tsv` thêm cùng PR T18.
- T19b chỉ merge khi G04-T03 đã ở staging (`services/entitlements.py::has_course_access`, `routers/courses_public.py::_outline_for`) và cờ `learner_v2` của LEARNERCORE-0063 đã có.
- T29 chỉ merge khi route group `(public-commerce)` của G05 đã có.

## Staging

- **Thứ tự:**
  1. T18: áp migration qua runner có khoá advisory, anh Andy gõ duyệt cho đúng lần áp; đọc lại bằng truy vấn ở `verification.md`.
  2. T28.
  3. T19a: CSP, một PR riêng. Sau merge kiểm header của 5 trang bất kỳ: không trang nào mất tài nguyên.
  4. T19b.
  5. T29.
- Mỗi PR chờ CI tích hợp và Staging E2E xanh đúng SHA.
- **Dữ liệu thử:** chạy `import_course_lessons.py --course <khoá thử> --source backend/tests/fixtures/course_lessons --execute` trên staging. Lệnh này là ghi DB staging, nên anh Andy gõ duyệt trong thread trước khi chạy. Bật `is_published` cho 3 bài thử bằng route admin, rồi chạy kịch bản 1–6.
- Không nạp bài vào sản phẩm hay khoá thật trên staging.

## Production

- Chỉ đi qua PR promote `staging → main`. Migration production áp trước mã phụ thuộc, qua runner có khoá advisory, sau khi anh Andy gõ duyệt cho đúng lần áp.
- Lên production với bảng rỗng: không ai thấy đổi gì, ngoài header CSP có thêm `frame-src`.
- Nạp nội dung thật, bật `is_published`/`is_preview` và bật `learner_v2` hay `AVER_PUBLIC_COMMERCE` trên production đều là quyết định riêng của anh Andy, không nằm trong spec này.

## Rollback and repair

- **Mã:** `git revert` PR lỗi, merge vào `staging`, rồi promote như bình thường. Trang bài giảng biến mất; dữ liệu giữ nguyên.
- **Muốn ẩn bài ngay mà không revert:** tắt `is_published` các bài bằng route admin. API trả 404 và trang khoá công khai trả `lesson_count: null`.
- **CSP (T19a):** revert riêng PR đó. Video YouTube bị chặn lại, các trang khác không bị ảnh hưởng.
- **Migration:** giữ bảng khi revert mã. Chỉ chạy `rollback/<số>_course_lessons.sql` khi anh Andy duyệt. File rollback từ chối khi `course_lesson_progress` có dòng, trừ khi đặt `aver.allow_course_lessons_rollback = 'on'`, vì sẽ mất tiến độ học.

## Observability

- Log mức info cho 403/404/503 của `/api/course/*`, chỉ kèm `user_id` nội bộ, `course_code`, `error_code`. Không log nội dung bài, `video_ref` hay email.
- Mỗi lần `--execute` của script in và ghi lô gồm số bài thêm, sửa, không đổi; có `import_batch_log` thì ghi vào đó.
- **Đếm hằng ngày:** số 503 `course_access_unavailable`, mong đợi 0; số PATCH tiến độ bị 403 sau khi hết hạn.
- **CSP:** báo cáo vi phạm (nếu đã bật `report-to`) không có `frame-src` cho `youtube-nocookie.com`.
