# Implementation plan

## Architecture impact

- **Backend mới:** `backend/routers/account_data.py` (năm route học viên dưới `/api/account/`), `backend/services/account_data_inventory.py` (danh mục), `backend/services/account_erasure.py` (các bước xoá), `backend/services/account_export.py` (tạo gói), bước mới `account_data` trong `scripts/enrollment_sweep.py` (G04-T04). Nếu T04 chưa merge khi làm PR mã thì đặt bước ở `backend/jobs/account_data_sweep.py` và để `enrollment_sweep.py` gọi lại sau; ghi trong PR.
- **Backend sửa:** `services/activation_gate.py::require_active_learner` thêm kiểm `account_deletion_pending` (FR-003); `config.py` thêm biến ở mục 3; `main.py` đăng ký router (một dòng); `services/activation_gate.py` khai các route `/api/account/*` là miễn cổng kích hoạt và cổng xoá.
- **Dùng lại, không viết lại:** `services/staff_security.py::delete_auth_sessions` (thu hồi mọi phiên; khi G04-T09 merge thì dùng `session_gate.revoke_all` bản không hoãn), `services/learner_email.py::send_direct` (G04-T04), `services/owner_alerts.py`, `services/pdf_generator.py`, đường thu hồi quyền của 0055.
- **Không đổi:** luồng chấm bài, retention hiện có (`jobs/retention_sweep.py`), mã kích hoạt.
- **Phụ thuộc:** spec này duyệt; G04-T04 (outbox, `send_direct`, sweep), G04-T09 (phiên học viên) cho PR mã; G07-T17 cho giao diện.

## Data and contracts

### 1. Migration nhãn 500 (`NNN_account_data_rights.sql` + rollback)

- `account_deletion_requests(id uuid PK, user_id uuid NOT NULL FK users ON DELETE RESTRICT, status text CHECK IN ('pending','cancelled','erasing','erased','failed'), requested_at timestamptz NOT NULL DEFAULT now(), erase_after timestamptz NOT NULL, cancelled_at, erasing_started_at, erased_at timestamptz NULL, attempts smallint NOT NULL DEFAULT 0, last_error_code text NULL ≤ 80)`; chỉ mục duy nhất một phần `(user_id) WHERE status IN ('pending','erasing')`; chỉ mục `(status, erase_after)`. Không cột email.
- `account_data_exports(id uuid PK, user_id uuid NOT NULL FK users ON DELETE RESTRICT, status text CHECK IN ('queued','building','ready','failed','expired','purged'), requested_at, started_at, ready_at, expires_at timestamptz, object_path text NULL, size_bytes bigint NULL, manifest_version text NULL, last_error_code text NULL)`; chỉ mục duy nhất một phần `(user_id) WHERE status IN ('queued','building')`.
- Bucket `account-exports`: `public = false`, `file_size_limit` = `ACCOUNT_EXPORT_MAX_BYTES` + biên, MIME `application/zip`; khai trong `services/storage_limits.py`. Không policy `storage.objects` cho `anon`/`authenticated`.
- RLS bật trên hai bảng, không policy; `REVOKE ALL` khỏi `anon`, `authenticated`; chỉ `service_role` (như 0055 5.2).
- `fn_account_erase_covered_requests(p_request_id uuid) RETURNS integer`, `SECURITY DEFINER`, `search_path` cố định, chỉ `service_role` EXECUTE: kiểm yêu cầu `p_request_id` đang `erasing`, đặt `set_config('aver.account_erasure_user', user_id, true)`, xoá `credit_covered_requests` của đúng `user_id` đó. Trigger chỉ ghi thêm của bảng này được thay bằng bản cho phép `DELETE` khi và chỉ khi `current_setting('aver.account_erasure_user', true)` bằng `OLD.user_id`; `UPDATE`, `TRUNCATE` vẫn bị chặn (câu hỏi mở 6, SA duyệt).
- Hàng `reserved` trong `register.tsv`; rollback xoá hai bảng, hàm, bucket (khi rỗng) và trả trigger cũ.

### 2. Danh mục dữ liệu theo người học

`services/account_data_inventory.py` là một danh sách khai báo `(table, column, action, export, storage)`; `action` ∈ `delete`, `anonymize`, `keep`, `staff_actor`. Thứ tự xoá theo khoá ngoại (bảng con trước). Bảng dưới đây là phân loại từ migration trên `origin/staging` 23/11 (130 cột trỏ người dùng); PR mã sinh lại bằng script và test FR-006 giữ cho hai bên khớp.

| Loại | Bảng (cột) | Ghi chú |
| --- | --- | --- |
| delete — Speaking và chấm | `sessions`, `responses` (bảng gốc, đối chiếu catalog), `grammar_recommendations`, `credit_covered_requests` (qua hàm ở mục 1) | Object `audio-responses` của các dòng này xoá trước |
| delete — Writing | `writing_essays` của `students.user_id` đó, `instructor_reviews`/`essay_regrade_requests` gắn bài đó, `course_writing_submissions`, `course_writing_drafts` | Bảng con theo khoá ngoại của `writing_essays` liệt kê ở T001 |
| delete — khoá học, lớp | `course_pronunciation_submissions`, `course_section_submissions`, `grammar_lesson_attempts`, `class_assignment_items` đã nộp của người đó | |
| delete — Reading, Listening, thi thử | `reading_test_attempts`, `listening_attempts`, `listening_sessions`, `listening_test_attempts`, `dictation_sessions`, `dictation_attempts`, `mock_item_attempts`, `mock_post_test_captures`, `mock_runtime_events`, `mock_correction_sessions`, `mock_error_hypotheses` | |
| delete — từ vựng, ngữ pháp | `user_vocabulary`, `vocabulary_exercise_attempts`, `d1_sessions`, `user_d1_questions`, `flashcard_stacks`, `flashcard_reviews`, `flashcard_review_log`, `quiz_sessions`, `quiz_attempts`, `quiz_word_stats`, `vocab_unit_attempts`, `user_kp_dimension_mastery`, `vocab_unit_recommendations`, `vocab_curated_cohort_events`, `advanced_vocab_*` (5 bảng của người học), `grammar_diagnostic_*` (3), `grammar_exposure_events`, `vocabulary_shared_progress`, `vocabulary_set_receipts`, `vocabulary_set_sessions` | |
| delete — nội dung đọc, ghi chú, phản hồi | `article_views`, `saved_articles`, `library_marks`, `user_feedback` (`created_by` của người học), `error_logs` (`user_id`), `learner_goal_events` (cột `user_id` không khoá ngoại) | |
| delete — thương mại có PII | `learner_email_outbox`, `credit_cluster_members`; `learner_active_sessions` (G04-T09) khi có | Theo 0055 C2 |
| anonymize | `users` (giữ `id`, `role`, `created_at`); `students` của lớp (bỏ tên, email, điện thoại; giữ hàng, câu hỏi mở 5); `learner_login_events` (G04-T16; bỏ IP, user agent, vị trí) | |
| keep, trỏ `id` đã ẩn danh | `enrollment_orders`, `enrollment_order_events`, `entitlements`, `entitlement_events`, `credit_ledger`, `credit_reservations` (10 năm, `COMMERCE_RECORD_RETENTION_YEARS`); `access_codes.used_by`; `user_code_assignments` (`is_active=false`); `exercise_book_grant_owners`, `exercise_book_cohort_grants`, `exercise_book_cohort_grant_log` (`grantee_id`); `ai_usage_logs` (chi phí, T001 xác nhận không có nội dung bài); `account_deletion_requests`; `student_cohort_memberships` | |
| staff_actor | mọi cột người thao tác của nhân viên: `created_by`, `reviewed_by`, `assigned_by`, `issued_by`, `imported_by`, `actor_id`, `changed_by`, `archived_by`, `dismissed_by`, `resolved_by`, `confirmed_by`, `cancelled_by`, `granted_by`, `revoked_by`, `claimed_by`, `last_edited_by`, `last_regraded_by`, `submitted_by_admin`, `admin_id`, `authored_by`, `published_by`, `reviewer_id`, `instructor_id`, `web_explanations_released_by`, `status_changed_by` | Người học không có các vai trò này; đường xoá từ chối tài khoản nhân viên (FR-001) nên không cột nào bị chạm |

Bảng có từ trước hệ migration và bảng của gói chưa merge (385/387/388/389/502 của 0055) được thêm khi có; test FR-006 bắt buộc.

### 3. Cấu hình (`config.py`)

| Biến | Mặc định | Ghi chú |
| --- | --- | --- |
| `ACCOUNT_DELETE_GRACE_DAYS` | 30 | `CẦN ANH ANDY QUYẾT`; kẹp 7..90 |
| `ACCOUNT_ERASURE_ENABLED` | false | tắt thì job chỉ dry-run |
| `ACCOUNT_ERASURE_MAX_ATTEMPTS` | 5 | |
| `ACCOUNT_EXPORT_READY_HOURS` | 24 | chỉ để hiện cho người học và cảnh báo trễ |
| `ACCOUNT_EXPORT_COOLDOWN_HOURS` | 24 | |
| `ACCOUNT_EXPORT_MAX_BYTES` | 200 MiB | |
| `ACCOUNT_EXPORT_LINK_DAYS` | 7 | theo tờ TaiKhoan |
| `ACCOUNT_EXPORT_SIGNED_URL_SECONDS` | 60 | |

### 4. API

| Route | Thành công | Lỗi |
| --- | --- | --- |
| `GET /api/account/deletion-request` | `{status: "none"\|"pending"\|"erasing", requested_at, erase_after}` | 401 |
| `POST /api/account/deletion-request` `{confirm_email}` | 200 `{status:"pending", requested_at, erase_after, sessions_revoked, email_sent}` | 401, 403 `staff_account_not_self_deletable`, 422 `confirm_email_mismatch` |
| `POST /api/account/deletion-request/cancel` | 200 `{status:"cancelled", cancelled_at}` | 401, 409 `no_pending_deletion_request`, 409 `deletion_in_progress` |
| `GET /api/account/data-export` | `{status, export_id, requested_at, ready_at, expires_at, size_bytes}` hoặc `{status:"none"}` | 401 |
| `POST /api/account/data-export` | 200 việc đang có hoặc việc mới | 401, 429 `export_recently_requested` + `retry_after` |
| `GET /api/account/data-export/{export_id}/download` | 302 URL ký 60 s, `Cache-Control: no-store` | 401, 404 `export_not_found`, 409 `export_not_ready`, 410 `export_expired` |

Mọi route có model Pydantic cho request và response; `frontend/types/api.d.ts` sinh lại. Thêm route mới, không đổi route cũ: người dùng hiện tại không bị ảnh hưởng.

### 5. Các bước xoá (một người, `services/account_erasure.py`)

1. `SELECT … FOR UPDATE SKIP LOCKED` một yêu cầu `pending` đến hạn; đọc lại; chuyển `erasing`, `attempts += 1`.
2. Thu hồi mọi phiên Auth.
3. Thu hồi quyền khoá còn hiệu lực (lý do `account_erased`).
4. Tạo danh sách object Storage từ các dòng loại `delete` có `storage`; xoá theo lô; object không có coi là đã xoá.
5. Một giao dịch DB: xoá bảng `delete` theo thứ tự, gọi `fn_account_erase_covered_requests`, ẩn danh bảng `anonymize`, `user_code_assignments.is_active=false`, xoá dòng `account_data_exports` (object xoá ở bước 4).
6. Gửi thư "đã xoá" tới email đọc từ Auth ở bước 1 (lỗi chỉ ghi log).
7. Xoá mềm người dùng Auth.
8. `erased`, `erased_at`.

Lỗi ở bước nào thì dừng người đó, ghi `last_error_code`, giữ `erasing`; lượt sau bắt đầu lại từ bước 1 với yêu cầu `erasing` (bước nào đã xong thì không còn gì để làm). Bước 5 là một giao dịch nên không có trạng thái xoá nửa chừng trong DB.

## UI and interaction

- Không có UI trong spec này. G07-T17 dựng hai khối theo `ui-states.md` và tờ `TaiKhoan`; mọi chữ "XXX" lấy từ API (`erase_after`, số ngày cấu hình), không ghi cứng.

## Work decomposition

- PR 1 (này): spec, chỉ `specs/0100-account-data-rights/` và một dòng `specs/README.md`.
- PR 2 (mã, high-risk) sau khi anh duyệt spec và T04, T09 đã merge: migration nhãn 500, danh mục và test FR-006, service, router, bước sweep, test. `owns:` các file mới ở trên, `backend/config.py` (khối biến mới), `backend/main.py` (một dòng), `backend/services/activation_gate.py` (kiểm FR-003, khai miễn cổng), `backend/services/storage_limits.py` (một dòng bucket), `backend/migrations/register.tsv` (một hàng), `frontend/types/api.d.ts`.
- PR 3: G07-T17 (giao diện), ngoài spec này.

## Rollout and rollback

Xem `rollout.md`.

## Verification strategy

- pytest với DB giả và catalog giả: FR-001 đến FR-013, đặc biệt huỷ đúng lúc xoá, chạy lại sau lỗi, dry-run không ghi.
- `tests/test_account_data_inventory.py` (FR-006) và ca âm: migration giả có cột chưa phân loại → test đỏ.
- Staging: kịch bản 4 và 6 trên tài khoản thử, truy vấn kiểm trước/sau ở `rollout.md`.
