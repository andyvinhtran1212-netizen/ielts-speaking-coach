# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_account_data_routes.py::test_create_checks_email_and_staff, ::test_create_revokes_sessions_sends_letter_and_is_idempotent (sai email 422, nhân viên 403, gửi lại trả cùng yêu cầu). Kết quả: PASS (local PG16, 23/11, nhánh phần 2 chưa push) | PASS |
| FR-002 | kind=test; ref=backend/tests/test_account_data_routes.py::test_create_revokes_sessions_sends_letter_and_is_idempotent, ::test_letter_and_revoke_failures_keep_the_request. Kết quả: PASS (local PG16, 23/11) | PASS |
| FR-003 | kind=test; ref=backend/tests/test_account_data_routes.py::test_cancel; backend/tests/test_account_deletion_gate.py (danh sách cho phép đối chiếu app thật, 403 `account_deletion_pending` qua cổng thật, tra cứu lỗi thì 503). Kết quả: PASS (local, 23/11) | PASS |
| FR-004 | kind=test; ref=backend/tests/test_account_erasure_job.py::test_not_due_and_cancelled_are_never_claimed, ::test_dry_run_counts_without_changing, ::test_sweep_is_dry_run_until_the_flag_is_on. Kết quả: PASS (local PG16, 23/11) | PASS |
| FR-005 | kind=journey; ref=staging kịch bản 4, truy vấn kiểm trước/sau ở rollout.md. Test local: backend/tests/test_account_erasure_job.py::test_full_erasure_of_one_learner, ::test_guards_still_refuse_outside_erasure, ::test_rollback_removes_the_pass (migration 504, guard thay thế). Kết quả: PENDING (local PASS, staging chưa chạy) | PENDING |
| FR-006 | kind=test; ref=backend/tests/test_account_data_inventory.py (ca âm: cột chưa phân loại; cột đã bỏ còn trong danh mục) và tệp danh sách sinh ở T001; catalog staging T001 gate 2 và 3 chạy 23/11; `class_action_log.student_name` đã chốt `anonymize` (sửa đổi 1); `credit_attempt_outcomes.user_id` (#2554) xếp `keep` trong `UPCOMING`. Kết quả: PASS (local, 23/11) | PASS |
| FR-007 | kind=test; ref=backend/tests/test_account_erasure_job.py::test_full_erasure_of_one_learner (quyền `revoked`/`account_erased`, sự kiện `revoke:system:account_erased`, `credit_ledger` và `access_codes` không đổi). Kết quả: PASS (local PG16, 23/11) | PASS |
| FR-008 | kind=journey; ref=staging: đăng nhập email cũ thất bại, đăng ký lại tạo `id` mới | PENDING |
| FR-009 | kind=test; ref=backend/tests/test_account_erasure_job.py::test_failure_releases_retries_and_marks_failed (một cảnh báo chủ dự án đúng lúc chuyển `failed`, không gửi lại), ::test_owner_alert_names_the_request_only_and_never_raises (thư chỉ có mã yêu cầu, bước, mã lỗi; khoá idempotency theo yêu cầu; thiếu transport hoặc bị từ chối thì ghi log, không làm hỏng job), ::test_lost_lease_stops_before_the_database_step. Kết quả: PASS local PG16 23/11 | PASS |
| FR-010 | kind=test; ref=backend/tests/test_account_data_routes.py::test_export_request_status_cooldown_and_erasing. Kết quả: PASS (local PG16, 23/11) | PASS |
| FR-011 | kind=test; ref=backend/tests/test_account_data_export_job.py::test_builds_package_with_only_own_data, ::test_over_size_drops_recordings, ::test_build_failure_marks_failed_and_learner_can_ask_again. Kết quả: PASS (local PG16, 23/11) | PASS |
| FR-012 | kind=test; ref=backend/tests/test_account_data_routes.py::test_download (404 người khác, 409 chưa xong, 410 quá hạn, 302 no-store, ký 60 s). Kết quả: PASS (local PG16, 23/11) | PASS |
| FR-014 | kind=test; ref=backend/tests/test_account_data_export_job.py::test_erasing_account_is_not_claimed_and_cancel_during_build_removes_own_object, ::test_expired_lease_is_taken_over_with_a_new_token, ::test_cleanup_lists_first_and_keeps_live_objects; backend/tests/test_account_erasure_job.py::test_running_export_lease_defers_the_final_step. Kết quả: PASS (local PG16, 23/11) | PASS |
| FR-013 | kind=test; ref=backend/tests/test_account_data_routes.py::test_unauthenticated_is_401; OpenAPI drift: `frontend/types/api.d.ts` sinh lại bằng openapi-typescript 7.13.0 (bước CI typecheck). Kết quả: PASS (local, 23/11); log không chứa email: kiểm bằng đọc mã, chưa có test riêng | PASS |

## Contract evidence

- OpenAPI/type drift: `frontend/types/api.d.ts` sinh lại ở nhánh phần 2 (thêm 4 đường dẫn /api/account, 6 route); CI typecheck sẽ kiểm lại khi push.
- Backward compatibility: chỉ thêm route và bảng mới; route cũ không đổi.

## Data evidence

- Migration/schema query: T001 gate 2 PASS (xem dưới); áp migration 500 lên staging còn PENDING (T008).
- T001 gate 1 (tĩnh, 2026-11-23, nhánh `claude/project-thread-t9dexw-g04-t18`): `python backend/scripts/account_data_inventory_scan.py --with-action` liệt kê 155 cột trỏ người dùng trong 372 migration (gồm 2 cột của migration 500); phân loại: 69 `delete`, 26 `keep`, 1 `anonymize` (`students.user_id`; `users.id` ghi tay ở `PRE_MIGRATION`), 57 `staff_actor`, 2 `staff_only`, 0 chưa phân loại. So với quét CR/SA R1 (133 dòng, quy tắc cũ): thêm 21 cột theo quy tắc mở rộng (`student_id`, `*_user_id`), bỏ `vocabulary_set_sessions.id` (quét cũ đọc nhầm dòng có hai cột; cột đúng là `user_id`). Bảng từ trước hệ migration: `users.id`, `sessions.user_id`, `access_codes.used_by`. `learner_care_notes` (#2471), `learner_active_sessions` (G04-T09), `learner_login_events` (G04-T16) đã phân loại trước trong `UPCOMING`.
- T001 gate 2 (2026-11-23 ~11:10Z, anh Andy duyệt truy vấn catalog chỉ đọc lúc 11:06Z): chạy `backend/scripts/account_data_catalog_check.sql` (`BEGIN READ ONLY` … `ROLLBACK`, chỉ đọc catalog, tên khoá và số đếm, không in giá trị dòng) bằng psql trên Mac mini ("Andy's Mac mini (2)"), exit 0. Kết quả:
  - 92 cột trỏ người dùng theo quy tắc FR-006 trong `public`; cả 92 đã có trong danh mục. 4 cột trong danh mục chưa có trên staging, đúng với `forward-policy.tsv`: `account_deletion_requests.user_id`, `account_data_exports.user_id` (500, chưa áp), `core_writing_origins.student_id` (249, `retired`), `exercise_book_grant_owners.user_id` (377, `pending_feature`). Danh mục vẫn giữ chúng để bắt kịp khi áp.
  - 122 khoá ngoại tới `public.users`/`auth.users`/`public.students`; không có khoá ngoại `public.users.id → auth.users`. Khoá ngoại tới `auth.users` có `NO ACTION` (`vocabulary_set_*`, `vocabulary_shared_progress`) không cản vì Auth user chỉ bị xoá mềm.
  - 286 khoá ngoại giữa các bảng `public`. Bảng con không có cột người học đã bổ sung vào `CHILD_TABLES` (12 bảng). `listening_drill_playback → class_assignment_items` là `ON DELETE RESTRICT`: phải xoá trước. Thứ tự bắt buộc giữa các bảng `delete` (khoá `NO ACTION`/`RESTRICT`): `grammar_recommendations` trước `responses`/`sessions`; `vocabulary_set_receipts` trước `vocabulary_set_sessions`; `writing_drafts` trước `writing_assignments`; `dictation_attempts`, `dictation_sessions`, `grammar_diagnostic_sessions`, `listening_drill_playback` trước `class_assignment_items`. Bảng `keep` trỏ vào bảng `delete`: chỉ `ai_usage_logs.session_id → sessions` (`SET NULL`), không cản.
  - Cột chữ tự do trong bảng `keep` ghi vào `TEXT_COLUMNS`: `enrollment_orders.learner_note` → NULL (0 dòng có giá trị), `enrollment_order_events.note` 0 dòng; `class_action_log.student_name` là tên học viên trong nhật ký chỉ-thêm (mig 198), cần anh Andy quyết cách ẩn danh.
  - Storage: `audio-responses` 96 object, mọi đường bắt đầu bằng một uuid; `writing-images` 19 object, đều dưới `prompts/` (ảnh đề của admin, không phải bài học viên); `account-exports` chưa có (500 chưa áp). Đường ghi Storage trong mã chỉ có `audio-responses` là của người học; các bucket còn lại do admin hoặc hệ thống ghi.
- T001 gate 3 (cùng lượt chạy, mục 5 của script): khoá JSON cấp một của nhật ký `keep`. `ai_usage_logs.metadata` chỉ có cờ, số đếm, id (`student_id`, `essay_id`, `prompt_id`) và `error_detail` (lý do vận hành từ `ai_router.rejection_detail`, không chứa nội dung bài); không có email, tên hay số điện thoại. `access_code_audit.after.intended_email` (1 dòng) là email: xếp `anonymize` trong `JSON_PATHS`. `access_code_audit.after.notes` (1 dòng) là ghi chú của staff khi tạo mã: `keep`. `staff_security_audit`, `class_lifecycle_audit`, `student_lifecycle_audit`: chỉ cờ và id. `class_action_log.details`, `entitlement_events`, `staff_privilege_evidence`, `credit_*`: không có khoá nào (rỗng hoặc chưa có dòng).
- Immediate state versus full reload: trạng thái yêu cầu và gói đọc lại từ API sau mỗi thao tác.

## UI evidence

- Viewports/themes/input methods: thuộc G07-T17.

## Release evidence

- Staging SHA and checks: PENDING.
- Production verification: PENDING (cần anh Andy duyệt).
