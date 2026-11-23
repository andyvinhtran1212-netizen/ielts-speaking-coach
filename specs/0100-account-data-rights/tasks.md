# Tasks

Spec ACCOUNTDATA-0100 thuộc G04-T18 (GOI-04). Tasks theo thứ tự phụ thuộc.

- [ ] T001 Đối chiếu danh mục: truy vấn catalog chỉ đọc trên staging liệt kê mọi khoá ngoại và cột `user_id`/`learner_id` của schema `public` (kể cả bảng gốc `users`, `sessions`, `responses`, bảng con của `writing_essays`) và khoá ngoại `public.users.id → auth.users`; xác nhận `ai_usage_logs` không chứa nội dung bài. Chạy cần anh Andy gõ duyệt; ghi kết quả vào `verification.md`. `owns: specs/0100-account-data-rights/verification.md` `depends: spec approved`
- [ ] T002 Migration nhãn 500 + rollback + hàng `reserved` trong `register.tsv` (mục 1 của plan); test lược đồ. `owns: backend/migrations/NNN_account_data_rights.sql, backend/migrations/rollback/NNN_*, backend/migrations/register.tsv (một hàng), backend/services/storage_limits.py (một dòng), backend/tests/test_account_data_schema.py` `depends: T001`
- [ ] T003 Danh mục `services/account_data_inventory.py` và `tests/test_account_data_inventory.py` (FR-006, có ca âm). `owns: backend/services/account_data_inventory.py, backend/tests/test_account_data_inventory.py` `depends: T001`
- [ ] T004 Router và service yêu cầu xoá, huỷ, kiểm `account_deletion_pending` trong cổng học viên (FR-001…FR-003, FR-013); sinh lại `api.d.ts`. `owns: backend/routers/account_data.py, backend/services/account_erasure.py (phần yêu cầu), backend/services/activation_gate.py (các dòng mới), backend/main.py (một dòng), backend/config.py (khối biến), frontend/types/api.d.ts` `depends: T002, G04-T04, G04-T09`
- [ ] T005 Các bước xoá và bước sweep (FR-004, FR-005, FR-007…FR-009). `owns: backend/services/account_erasure.py, scripts/enrollment_sweep.py (bước account_data) hoặc backend/jobs/account_data_sweep.py` `depends: T003, T004`
- [ ] T006 Xuất dữ liệu (FR-010…FR-012). `owns: backend/services/account_export.py, backend/routers/account_data.py (route export)` `depends: T003, T004`
- [ ] T007 Test theo yêu cầu và CR/SA độc lập; `python -m pytest tests/ -q` pass. `depends: T004, T005, T006`
- [ ] T008 Staging: áp migration (anh gõ duyệt), kịch bản 4 và 6 trên tài khoản thử, kiểm FR-008 (đăng ký lại email cũ), ghi bằng chứng. `depends: T007`
