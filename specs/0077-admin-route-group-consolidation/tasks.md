# Tasks

Mỗi task một PR vào `staging`, lớp `feature`, `Spec: ADMINGROUP-0077`, chỉ sau khi spec `approved`. G10-T13 là chính PR spec này.

- [ ] T001 (G10-T14) Thí điểm: tạo `(authed-admin)/layout.tsx`; chuyển `(authed-admin-error-logs)`, `(authed-admin-feedback)`, `(authed-admin-foot-traffic)` thành group con với `<link>` thường; đo `<link precedence>` trên một nhánh tạm để so (không merge); dán `<head>` trước/sau, DOM sau điều hướng client (stylesheet, mục sidebar đang chọn, class `<body>`, cổng kích hoạt với một tài khoản chưa kích hoạt trong fixture), ảnh mốc. Nếu bằng chứng xấu → dừng, hỏi Q-d1 với phương án ~8 group. `depends: spec approved; ảnh mốc 3 trang (TESTPOLICY-0057 T03 hoặc thêm trong PR này)`
- [ ] T002 (G10-T15-1) hệ thống còn lại: `system`, `usage`, `mfa`, `overview`. `depends: T001, Andy trả lời Q-d1`
- [ ] T003 (G10-T15-2) `users`, `students`, `classes`, `instructors`. `depends: T002`
- [ ] T004 (G10-T15-3) `grammar`, `grammar-analytics`, `grammar-articles`, `grammar-recommend`, `vocab`. `depends: T003`
- [ ] T005 (G10-T15-4) `listening`, `speaking`, `speaking-sessions`, `speaking-topics`. `depends: T004`
- [ ] T006 (G10-T15-5) `reading`, `reading-attempts`, `reading-content`, `mock-exams`, `mock-live`, `mock-reviews`. `depends: T005`
- [ ] T007 (G10-T15-6/7) `mock-tests`, `writing`, `writing-assignments`, `writing-cohorts`, `writing-instructor-queue`, `writing-new`, `writing-prompts`, `writing-queue`, `writing-regrade`, `writing-status` (hai PR). `depends: T006`

Thứ tự đợt có thể đổi theo nhu cầu G09 (đợt chứa trang G09 sắp sửa đi trước), giữ ≤ 6 group và ≤ 30 file test mỗi PR. Mỗi PR: quy tắc chuyển ở `plan.md`, nghiệm thu ở "Verification strategy", ghi SHA và kết quả vào `verification.md`.
