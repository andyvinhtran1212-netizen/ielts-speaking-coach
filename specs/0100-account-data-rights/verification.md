# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_account_data_api.py (sai email 422, nhân viên 403, gửi lại trả cùng yêu cầu) | PENDING |
| FR-002 | kind=test; ref=test thu hồi phiên và thư xác nhận, ca lỗi thu hồi/thư vẫn giữ yêu cầu | PENDING |
| FR-003 | kind=test; ref=test huỷ, 409 khi không có yêu cầu/đang xoá, test kê danh sách cho phép của `account_deletion_gate` và 403 `account_deletion_pending` ở route học viên | PENDING |
| FR-004 | kind=test; ref=test sweep chỉ chọn yêu cầu đến hạn, huỷ đúng lúc xoá, dry-run không ghi | PENDING |
| FR-005 | kind=journey; ref=staging kịch bản 4, truy vấn kiểm trước/sau ở rollout.md | PENDING |
| FR-006 | kind=test; ref=backend/tests/test_account_data_inventory.py (ca âm: cột `user_id`, `student_id`, `*_user_id` chưa phân loại; cột đã bỏ còn trong danh mục) và tệp danh sách sinh ở T001 (test pass ở máy 23/11; catalog staging T001 gate 2 và 3 đã chạy 23/11, còn một quyết định: `class_action_log.student_name`) | PENDING |
| FR-007 | kind=test; ref=test thu hồi quyền lý do `account_erased`, sổ lượt và `access_codes` không đổi | PENDING |
| FR-008 | kind=journey; ref=staging: đăng nhập email cũ thất bại, đăng ký lại tạo `id` mới | PENDING |
| FR-009 | kind=test; ref=test lỗi giữa chừng rồi chạy lại, cảnh báo sau số lần tối đa | PENDING |
| FR-010 | kind=test; ref=test tạo việc xuất, trả việc đang có, 429 cooldown | PENDING |
| FR-011 | kind=test; ref=test nội dung ZIP và manifest, bỏ ghi âm khi vượt trần | PENDING |
| FR-012 | kind=test; ref=test 404 người khác, 409 chưa xong, 410 quá hạn, 302 no-store | PENDING |
| FR-014 | kind=test; ref=test hai tiến trình xoá; job xuất đang chạy khi sang `erasing`; tiến trình xuất cũ hoàn tất sau khi tiến trình mới `ready`; tiến trình xuất chết sau khi tải lên trong lúc xoá; dọn định kỳ; tiền tố `account-exports/<user_id>/` rỗng sau `erased` | PENDING |
| FR-013 | kind=test; ref=test 401 không phiên, OpenAPI drift, log không chứa email | PENDING |

## Contract evidence

- OpenAPI/type drift: PENDING (PR mã sinh lại `frontend/types/api.d.ts`).
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
