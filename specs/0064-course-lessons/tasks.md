# Tasks

Mỗi task là một PR vào `staging`, mở sau khi spec `approved`. Spec có `risk: high` nên mọi PR cài đặt dùng lớp `high-risk` và `Spec: COURSELESSON-0064`. Mã task giữ mã nhiệm vụ của gói (G07-Tnn) để đối chiếu.

- [ ] T18 (G07-T18) Migration `course_lessons`, `course_lesson_progress`, kèm RLS và rollback (plan 5.1); đổi dòng 506 của `register.tsv` sang `present`; test PG thật. Kiểm ba điểm `CHƯA KIỂM` (a–c) trước. Áp lên staging cần anh Andy gõ duyệt. `depends: spec approved` `owns: backend/migrations/506_course_lessons.sql, backend/migrations/rollback/506_course_lessons.sql, backend/tests/test_course_lessons_postgres.py`
- [ ] T28 (G07-T28) Script `backend/scripts/import_course_lessons.py` (FR-047, plan 5.6), thư mục mẫu `backend/tests/fixtures/course_lessons/`; route admin `PATCH /admin/course-lessons/{id}` và `GET /admin/courses/{course_id}/lessons` (FR-048, plan 5.5); pytest. Không nạp dữ liệu thật. `depends: T18` `owns: backend/scripts/import_course_lessons.py, backend/routers/admin_course_lessons.py, backend/tests/test_import_course_lessons.py, backend/tests/test_admin_course_lessons.py`
- [ ] T19a (G07-T19 PR 1) CSP `frame-src 'self' https://www.youtube-nocookie.com` ở mọi môi trường, gộp với nguồn Vercel toolbar; `docs/CONTENT_SECURITY_POLICY.md`; test CSP. Không đổi `script-src`. `depends: spec approved` `owns: frontend/tooling/content-security-policy.mjs, docs/CONTENT_SECURITY_POLICY.md, frontend/tests/content-security-policy*.test.mjs`
- [ ] T19b (G07-T19 PR 2) Router `course_learner.py` (plan 5.2), `services/course_outline.py` (5.3), nối `_outline_for` của G04; trang `app/(authed-course)/course/learn/[courseCode]/[lessonCode]/page.tsx`, `components/ui/video-player.tsx` (5.7), `lib/course-learner-api.ts`; dòng registry; sinh lại `api.d.ts`; pytest và test React. `depends: T18, T19a, G04-T03 (has_course_access, _outline_for), LEARNERCORE-0063 T05 (cờ learner_v2)` `owns: backend/routers/course_learner.py, backend/services/course_outline.py, backend/tests/test_course_learner.py, frontend/app/(authed-course)/**, frontend/components/ui/video-player.tsx, frontend/lib/course-learner-api.ts`
- [ ] T29 (G07-T29) Bài thử công khai: API `GET /api/courses/{slug}/preview/{lesson_code}` (plan 5.4), trang `app/(public-commerce)/courses/[slug]/preview/[lessonCode]/page.tsx` (`noindex`, cờ `AVER_PUBLIC_COMMERCE`); dòng `ACTIVATION_EXEMPT_ROUTES`; ảnh 1280px và 390px. `depends: T19b, PUBLICSITE-0059 G05-T04 (route group public-commerce)` `owns: frontend/app/(public-commerce)/courses/[slug]/preview/**, backend/tests/test_course_preview.py`

Ràng buộc chung của mọi task:
- Không sửa bảng hay hàm quyền của G04. Chỉ gọi `has_course_access` và `list_access`.
- Không khoá bài theo thứ tự.
- Không hiện nút "Bắt đầu luyện".
- Không soạn hay nạp nội dung thật.
- Không log `body_md`, `video_ref` hay email.
- Không bật cờ trên production.
