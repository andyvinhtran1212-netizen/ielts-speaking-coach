# Verification

## Requirement coverage

Mọi dòng đang ở trạng thái `PENDING`, vì spec còn `draft`. Cột bằng chứng ghi bằng chứng **dự kiến** của từng task.

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-040 | kind=test; ref=planned React test for lesson page breadcrumb, table of contents, prev/next among published lessons, sanitized Markdown (T19b); journey=staging scenario 1 | PENDING |
| FR-041 | kind=test; ref=planned video-player tests (youtube-nocookie src, private origin empty → "Video chưa sẵn sàng", startAt), 15 s and pagehide saves (T19b); CSP test frame-src (T19a); journey=staging scenario 2 | PENDING |
| FR-042 | kind=test; ref=planned pytest 403 course_access_required / course_access_expired without body_md, video or title; has_course_access error → 503 (T19b) | PENDING |
| FR-044 | kind=test; ref=planned pytest public_outline (no body_md/video_ref, 0 published → null) and _outline_for wiring (T19b); journey=staging scenario 6 lesson_count=3 | PENDING |
| FR-045 | kind=test; ref=planned pytest lesson states done/current/next/todo, coming_soon, next_lesson None and value (T19b) | PENDING |
| FR-046 | kind=test; ref=planned pytest rewind saved, max monotonic, ratio 0.9, early completed ignored, reading completed accepted, concurrent writes keep max, own row only, GET writes nothing (T19b) | PENDING |
| FR-047 | kind=test; ref=planned backend/tests/test_import_course_lessons.py dry-run no writes, --execute idempotent, duplicate lesson_no aborts, flags never changed (T28) | PENDING |
| FR-048 | kind=test; ref=planned pytest admin-only, unpublish clears preview, preview on unpublished → 409, governance_audit row; PG CHECK course_lessons_preview_published (T18, T28) | PENDING |
| FR-049 | kind=test; ref=planned pytest preview 404 cases, guest 200, learner_href for entitled user, flag off → notFound (T29); screenshot 1280/390 | PENDING |

## Kịch bản staging

Dùng tài khoản QA, một sản phẩm online thử và 3 bài nội dung giả, nạp bằng script từ thư mục mẫu. Không dùng khoá hay học viên thật.

1. **Mở bài bất kỳ.** Given QA có quyền khoá thử, chưa học bài nào. When mở bài 3. Then trang mở, breadcrumb đúng, bài 3 `current` ở Lộ trình.
2. **Tiếp tục xem.** Given QA xem bài 1 tới 2:30, tua lùi 1:10, rời trang. When mở lại. Then video tiếp từ khoảng 1:10; tải lại cho cùng vị trí.
3. **Không có quyền.** Given tài khoản QA thứ hai không có quyền. When mở link bài. Then thấy câu báo và "Xem khoá"; Network không có `body_md`.
4. **Sắp có.** Given khoá thử chưa bật `is_published` bài nào. When mở Lộ trình và trang khoá công khai. Then thấy "Bài học của khoá sắp có"; trang khoá không có số bài.
5. **Học thử.** Given bật `is_preview` cho bài 1, cờ `AVER_PUBLIC_COMMERCE` bật trên staging. When khách mở `preview_href`. Then thấy bài 1; đổi mã bài trong URL sang bài 2 thì 404; đăng nhập QA có quyền thì được chuyển sang `/course/learn/...`.
6. **Số bài trên trang khoá.** Given bật `is_published` cả 3 bài. When gọi `GET /api/courses/<slug>`. Then `lesson_count = 3`, `chapters` không có `body_md`.

## Contract evidence

- **OpenAPI và type drift:** route mới sinh vào `frontend/types/api.d.ts` cùng PR T19b, T29, T28. CI kiểm bằng `git diff --exit-code`.
- **Tương thích ngược:** `_outline_for` vẫn trả `null` khi chưa có bài published, giữ đúng hình JSON của G04.

## Data evidence

- **Migration/schema query:** trên staging sau khi áp, chạy truy vấn chỉ đọc `SELECT table_name, row_security FROM information_schema.tables t JOIN pg_class c ON c.relname=t.table_name WHERE table_schema='public' AND table_name IN ('course_lessons','course_lesson_progress');` và `SELECT policyname, roles, cmd FROM pg_policies WHERE tablename IN ('course_lessons','course_lesson_progress');`.
- **Trạng thái ngay sau thao tác so với tải lại trang:** tải lại trang bài cho cùng vị trí phát và cùng trạng thái "Đã xong" (kịch bản 2).

## UI evidence

- **Viewports, theme, cách nhập:** chụp 390px, 820px, 1280px ở cả chế độ sáng và tối cho trang bài giảng và trang bài thử; điều khiển trình phát và "Bài sau" bằng bàn phím.

## Release evidence

- **Staging SHA và checks:** ghi SHA staging sau mỗi lần merge, kèm kết quả CI tích hợp và Staging E2E đúng SHA đó.
- **Production verification:** sau khi promote, chỉ đọc. Gọi `curl -sI https://www.averlearning.com/course/learn/X/Y` (chưa đăng nhập thì chuyển hướng đăng nhập) và xem header CSP có `frame-src`. Không nạp bài, không bật cờ.
