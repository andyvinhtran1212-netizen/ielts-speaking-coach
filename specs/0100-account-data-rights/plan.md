# Implementation plan

## Architecture impact

- **Backend mới:** `backend/routers/account_data.py` (năm route học viên dưới `/api/account/`), `backend/services/account_data_inventory.py` (danh mục), `backend/services/account_erasure.py` (các bước xoá), `backend/services/account_export.py` (tạo gói), bước mới `account_data` trong `scripts/enrollment_sweep.py` (G04-T04). Nếu T04 chưa merge khi làm PR mã thì đặt bước ở `backend/jobs/account_data_sweep.py` và để `enrollment_sweep.py` gọi lại sau; ghi trong PR.
- **Backend sửa:** `services/account_deletion_gate.py` (mới, một hàm `allows(method, route)` với danh sách cho phép trong mã) gọi ngay sau cổng kích hoạt trong `services/activation_gate.py::require_active_learner` (FR-003); `config.py` thêm biến ở mục 3; `main.py` đăng ký router (một dòng); `services/activation_gate.py` khai các route `/api/account/*` là miễn cổng kích hoạt và cổng xoá.
- **Dùng lại, không viết lại:** `services/staff_security.py::delete_auth_sessions` (thu hồi mọi phiên; khi G04-T09 merge thì dùng `session_gate.revoke_all` bản không hoãn), `services/learner_email.py::send_direct` (G04-T04), `services/owner_alerts.py`, `services/pdf_generator.py`, đường thu hồi quyền của 0055.
- **Không đổi:** luồng chấm bài, retention hiện có (`jobs/retention_sweep.py`), mã kích hoạt.
- **Phụ thuộc:** spec này duyệt; G04-T04 (outbox, `send_direct`, sweep), G04-T09 (phiên học viên) cho PR mã; G07-T17 cho giao diện.

## Data and contracts

### 1. Migration nhãn 500 (`NNN_account_data_rights.sql` + rollback)

- `account_deletion_requests(id uuid PK, user_id uuid NOT NULL FK users ON DELETE RESTRICT, status text CHECK IN ('pending','cancelled','erasing','erased','failed'), requested_at timestamptz NOT NULL DEFAULT now(), erase_after timestamptz NOT NULL, cancelled_at, erasing_started_at, erased_at timestamptz NULL, erasing_owner text NULL ≤ 120, lease_until timestamptz NULL, erased_notice_sent_at timestamptz NULL, step_done text NULL, attempts smallint NOT NULL DEFAULT 0, last_error_code text NULL ≤ 80)`; chỉ mục duy nhất một phần `(user_id) WHERE status IN ('pending','erasing')`; chỉ mục `(status, erase_after)` và `(status, lease_until)`. Không cột email. `step_done` chỉ để quan sát; tiếp quản luôn làm lại từ bước đầu.
- `account_data_exports(id uuid PK, user_id uuid NOT NULL FK users ON DELETE RESTRICT, status text CHECK IN ('queued','building','ready','failed','cancelled','expired','purged'), requested_at, started_at, ready_at, expires_at timestamptz, export_owner text NULL, claim_token uuid NULL, lease_until timestamptz NULL, object_path text NULL CHECK (object_path IS NULL OR object_path LIKE user_id::text || '/' || id::text || '/%.zip'), size_bytes bigint NULL, manifest_version text NULL, last_error_code text NULL)`; chỉ mục duy nhất một phần `(user_id) WHERE status IN ('queued','building')`.
- Bucket `account-exports`: `public = false`, `file_size_limit` = `ACCOUNT_EXPORT_MAX_BYTES` + biên, MIME `application/zip`; object luôn ở `<user_id>/<export_id>/<claim_token>.zip`; khai trong `services/storage_limits.py`. Không policy `storage.objects` cho `anon`/`authenticated`.
- RLS bật trên hai bảng, không policy; `REVOKE ALL` khỏi `anon`, `authenticated`; chỉ `service_role` (như 0055 5.2).
- Không nới trigger chỉ ghi thêm nào (`credit_covered_requests` là `keep`, câu hỏi mở 6). Nếu anh chọn xoá bảng này, phần hàm và trigger theo đúng điều kiện ở câu hỏi mở 6 được thêm vào migration này kèm test PG.
- Hàng `reserved` trong `register.tsv`; rollback xoá hai bảng và bucket (khi rỗng).

### 2. Danh mục dữ liệu theo người học

`services/account_data_inventory.py` là danh sách khai báo `(table, column, action, export, storage, json_paths)`; `action` ∈ `delete`, `anonymize`, `keep`, `staff_actor`, `staff_only`. Thứ tự xoá theo khoá ngoại (bảng con trước). Bảng dưới phân loại theo quét của CR/SA R1 trên `2b2599de` (134 cột trong 112 bảng theo quy tắc cũ, `/mnt/project-files/reviews/0100-user-columns-scan-20261123.tsv`) cộng các cột theo quy tắc mở rộng của FR-006 (`student_id`, `*_user_id`, `used_by`, khoá ngoại tới `students`). Tham số hàm (`p_user_id`, `v_user_id`) không phải cột. T001 sinh lại danh sách `(bảng, cột, migration, action)` bằng script và công bố thành tệp kèm PR mã, để con số tái lập được; test FR-006 giữ danh mục và migration khớp nhau.

| Loại | Bảng (cột) | Ghi chú |
| --- | --- | --- |
| delete — Speaking, chấm | `sessions`, `responses` (bảng gốc, đối chiếu catalog), `grammar_recommendations`, `grading_attempts`, `ai_deferred_grading_jobs`, `speaking_progress_marks` | Object `audio-responses` xoá trước |
| delete — Writing (theo `student_id`) | `writing_essays` và bảng con (`essay_regrade_requests`, `instructor_reviews`, `core_writing_origins`; T001 kê đủ theo khoá ngoại), `writing_drafts`, `writing_assignments` của người học, `course_writing_submissions`, `course_writing_drafts` | `writing-images` không chạm (ảnh đề dùng chung) |
| delete — lớp, khoá học | `class_assignment_items`, `class_assignment_activities`, `exercise_book_attempt_links`, `instructor_writing_assignment_requests` (theo `student_id`), `course_pronunciation_submissions`, `course_section_submissions`, `grammar_lesson_attempts`, `exam_attempts` | |
| delete — Reading, Listening, thi thử (cột `user_id` hoặc `learner_id`) | `reading_test_attempts`, `listening_attempts`, `listening_sessions`, `listening_test_attempts`, `dictation_sessions`, `dictation_attempts` (+ `dictation_attempt_answers`), `mock_exam_assignments` (bản giao lẻ cho người đó), `mock_exam_sittings`, `mock_item_attempts`, `mock_post_test_captures`, `mock_runtime_events`, `mock_correction_sessions`, `mock_error_hypotheses`, `mock_attempt_review_flags`, `mock_paper_attempt_snapshots` | |
| delete — từ vựng, ngữ pháp | `user_vocabulary`, `vocabulary_exercise_attempts`, `d1_sessions`, `user_d1_questions`, `flashcard_stacks`, `flashcard_reviews`, `flashcard_review_log`, `quiz_sessions`, `quiz_attempts`, `quiz_word_stats`, `vocab_unit_attempts`, `user_kp_dimension_mastery`, `user_kp_mastery`, `kp_evidence`, `vocab_unit_recommendations`, `vocab_curated_cohort_events`, `advanced_vocab_stage_progress`, `advanced_vocab_question_attempts`, `advanced_vocab_listening_attempts`, `advanced_vocab_practice_selections`, `advanced_vocab_rewrite_submissions`, `grammar_diagnostic_sessions`, `grammar_diagnostic_responses`, `grammar_diagnostic_reports`, `grammar_exposure_events`, `vocabulary_shared_progress`, `vocabulary_set_receipts`, `vocabulary_set_sessions` | |
| delete — đọc, phản hồi, nhật ký | `article_views`, `saved_articles`, `library_marks`, `user_feedback` (`created_by` của người học), `error_logs` (`user_id`), `analytics_events`, `activation_attempts`, `learner_goal_events` | |
| delete — ghi chú của nhân viên | `learner_care_notes` (mig 442) | Không đưa vào gói tải (câu hỏi mở 7) |
| delete — thương mại có PII | `learner_email_outbox`, `credit_cluster_members`; `learner_active_sessions` (G04-T09) khi có | Theo 0055 C2 |
| anonymize | `users` (giữ `id`, `role`, `created_at`); `students` (bỏ tên, email, điện thoại; giữ hàng, câu hỏi mở 5); `learner_login_events` (G04-T16; bỏ IP, user agent, vị trí); `class_action_log.student_name` → NULL (nhật ký chỉ-thêm, mig 198; qua hàm hẹp, amendment 1); `enrollment_orders.learner_note` → NULL; khoá `intended_email` trong `access_code_audit.after` khi bằng email người học | |
| keep, trỏ `id` đã ẩn danh | `enrollment_orders`, `enrollment_order_events`, `entitlements`, `entitlement_events`, `credit_ledger`, `credit_reservations`, `credit_covered_requests` (10 năm, `COMMERCE_RECORD_RETENTION_YEARS`; câu hỏi mở 6); `ai_budget_reservations`, `ai_usage_logs` (chi phí; T001 là cổng cứng: không cột nào chứa nội dung bài); `access_codes.used_by`; `user_code_assignments` (`is_active=false`); `exercise_book_grant_owners`, `exercise_book_cohort_grants`, `exercise_book_cohort_grant_log` (`grantee_id`); `student_cohort_memberships`; nhật ký thao tác `class_action_log`, `class_lifecycle_audit`, `student_lifecycle_audit`, `access_code_audit` (`target_user_id`; đường JSON `before`/`after` `->>assigned_user`), `staff_security_audit`, `staff_privilege_evidence` (`target_user_id`); `account_deletion_requests` | Nhật ký chỉ giữ id. T001 kiểm từng cột JSON của nhật ký: có email, tên hay số điện thoại thì xếp đường JSON đó vào `anonymize` |
| staff_only | `staff_mfa_factor_snapshot`, `staff_mfa_status_throttle` | Chỉ có dòng của nhân viên; FR-001 từ chối tài khoản nhân viên |
| staff_actor | mọi cột người thao tác của nhân viên: `created_by`, `reviewed_by`, `assigned_by`, `added_by`, `issued_by`, `imported_by`, `actor_id`, `actor_user_id`, `changed_by`, `archived_by`, `dismissed_by`, `resolved_by`, `confirmed_by`, `cancelled_by`, `granted_by`, `revoked_by`, `claimed_by`, `last_edited_by`, `last_regraded_by`, `submitted_by_admin`, `admin_id`, `authored_by`, `published_by`, `reviewer_id`, `instructor_id`, `web_explanations_released_by`, `status_changed_by` | Người học không có các vai trò này, nên không cột nào bị chạm. Bảng chỉ có cột loại này: `access_codes` (`issued_by`), `class_assignments`, `class_lessons`, `cohorts`, `course_products`, `courses`, `exam_content_cohorts`, `grammar_content_releases`, `lemma_overrides`, `listening_content`, `listening_content_packages`, `listening_tests`, `mock_correction_release_events`, `mock_exams`, `reading_passages`, `reading_tests`, `speaking_lesson_sets`, `vocab_context_lookup_terms`, `vocab_learning_units`, `vocab_pathways`, `vocab_speaking_signal_maps`, `vocab_unit_publication_events`, `vocab_unit_version_reviews`, `vocab_unit_versions`, `vocabulary_exercises`, `vocabulary_sets`, `web_explanation_objects`, `writing_assignment_requests`, `writing_prompts`, `writing_tips` |

Bảng có từ trước hệ migration và bảng của gói chưa merge (385/387/388/389/502 của 0055) được thêm khi có; test FR-006 bắt buộc.

### 3. Cấu hình (`config.py`)

| Biến | Mặc định | Ghi chú |
| --- | --- | --- |
| `ACCOUNT_DELETE_GRACE_DAYS` | 30 | `CẦN ANH ANDY QUYẾT`; kẹp 7..90 |
| `ACCOUNT_ERASURE_ENABLED` | false | tắt thì job chỉ dry-run |
| `ACCOUNT_ERASURE_MAX_ATTEMPTS` | 5 | |
| `ACCOUNT_ERASURE_LEASE_SECONDS` | 300 | hợp đồng thuê, gia hạn trước mỗi bước; job xuất dùng cùng giá trị |
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
| `POST /api/account/data-export` | 200 việc đang có hoặc việc mới | 401, 409 `account_erasing`, 429 `export_recently_requested` + `retry_after` |
| `GET /api/account/data-export/{export_id}/download` | 302 URL ký 60 s, `Cache-Control: no-store` | 401, 404 `export_not_found`, 409 `export_not_ready`, 410 `export_expired` |

Mọi route có model Pydantic cho request và response; `frontend/types/api.d.ts` sinh lại. Thêm route mới, không đổi route cũ: người dùng hiện tại không bị ảnh hưởng.

### 5. Các bước xoá (một người, `services/account_erasure.py`)

0. **Nhận việc** (một câu cập nhật có điều kiện, một giao dịch): `UPDATE account_deletion_requests SET status='erasing', erasing_owner=:me, lease_until=now()+lease, erasing_started_at=coalesce(erasing_started_at, now()), attempts=attempts+1 WHERE id=:id AND ((status='pending' AND erase_after<=now()) OR (status='erasing' AND lease_until<now()))`; cùng giao dịch: `UPDATE account_data_exports SET status='cancelled' WHERE user_id=:uid AND status IN ('queued','building')`. Không cập nhật được dòng nào thì bỏ qua (đã huỷ hoặc người khác đang giữ). Khi yêu cầu đã ở `erasing`, không nhận việc xuất mới. Các dòng export vừa huỷ giữ nguyên lease đang có để theo dõi worker cũ.
1. Trước mỗi bước dưới đây: gia hạn `lease_until` bằng câu cập nhật có điều kiện `erasing_owner=:me`; không gia hạn được thì dừng ngay, không làm bước đó.
2. Thu hồi mọi phiên Auth (lặp lại vô hại).
3. Thu hồi quyền khoá còn hiệu lực, lý do `account_erased` (quyền đã thu hồi thì bỏ qua).
4. Xoá object Storage: các object `audio-responses` mà dòng loại `delete` trỏ tới, và toàn bộ tiền tố `account-exports/<user_id>/`; object không còn coi là đã xoá.
5. **Chờ lease xuất trước khi xoá trong DB.** Nếu còn lease xuất hiệu lực, yêu cầu giữ trạng thái `erasing`, nhả lease xoá và ghi `last_error_code=export_lease_active` để thử lại; lượt chờ không tính vào `attempts`. Khi không còn lease xuất hiệu lực, hàm `SECURITY DEFINER` của migration 504 (chỉ `service_role`/`postgres` gọi được) khoá dòng yêu cầu `FOR UPDATE`, kiểm tra `erasing_owner = :me`, khoá các dòng export và kiểm tra lease xuất lần nữa trong cùng giao dịch. Nếu có lease hiệu lực, hàm trả về trạng thái chờ trước khi thay đổi dữ liệu. Sau khi qua kiểm tra, hàm xoá bảng `delete` theo thứ tự, ẩn danh bảng `anonymize`, đặt `user_code_assignments.is_active=false` và xoá các dòng `account_data_exports` của người đó. Bước này chạy lại an toàn.
6. Gửi thư "đã xoá" bằng `learner_email.send_direct` (không qua outbox, để không để lại email của người đã xoá trong `learner_email_outbox`), tới email đọc từ Supabase Auth admin ngay ở bước này (trước bước 7). Bỏ qua khi `erased_notice_sent_at` đã có. Gửi xong thì ghi `erased_notice_sent_at = now()` bằng câu cập nhật có điều kiện `erasing_owner = :me AND erased_notice_sent_at IS NULL`. Lỗi gửi chỉ ghi log và không chặn các bước sau. Tiếp quản làm lại từ bước 2 nên không gửi lần hai khi cột đã có; giữa lúc gửi xong và lúc ghi cột, nếu tiến trình chết thì có thể gửi trùng một lần, chấp nhận được.
7. Xoá mềm người dùng Auth (người dùng đã xoá mềm thì bỏ qua).
8. **Quét lần cuối rồi hoàn tất.** Sau bước 5 và xoá mềm Auth, quét lại toàn bộ tiền tố `account-exports/<user_id>/`. Chỉ sau khi lượt quét thành công mới ghi `erased` và `erased_at`, bỏ `erasing_owner`/`lease_until` bằng cập nhật có điều kiện `erasing_owner=:me`. Dọn định kỳ ở mục 6 là lớp dự phòng cho object tới muộn sau khi đầu gửi đã hết lease; bằng chứng hoàn tất tại bước này là đã kiểm tra lease trước khi xoá DB và lượt quét cuối đã thành công.

Lỗi ở bước nào thì ghi `last_error_code`, nhả hợp đồng thuê (`lease_until=now()`), dừng người đó; lần nhận sau làm lại từ bước 2. Bước 5 là một giao dịch nên DB không có trạng thái xoá nửa chừng.

### 6. Job xuất gói (`services/account_export.py`)

- **Nhận việc:** câu cập nhật có điều kiện nhận việc `queued` (hoặc `building` hết hạn thuê), ghi `status='building'`, `export_owner`, một `claim_token` mới (uuid) và `lease_until`; bỏ qua khi người đó có yêu cầu xoá `erasing`/`erased`. Đường tải của lần nhận này là `account-exports/<user_id>/<export_id>/<claim_token>.zip`, khác với mọi lần nhận khác của cùng việc.
- **Gia hạn:** câu cập nhật có điều kiện `status='building' AND export_owner=:me AND claim_token=:token`; gia hạn ngay trước khi tải lên và kiểm lại ngay sau khi tải xong. Không gia hạn được (việc đã bị huỷ hoặc bị tiếp quản) thì xoá đúng đường của mình và dừng.
- **Hoàn tất:** `UPDATE account_data_exports SET status='ready', ready_at=now(), expires_at=now()+7 ngày, object_path=:my_path, lease_until=NULL WHERE id=:id AND status='building' AND export_owner=:me AND claim_token=:token AND lease_until >= now() AND NOT EXISTS (SELECT 1 FROM account_deletion_requests WHERE user_id=:uid AND status IN ('erasing','erased'))`. Không cập nhật được thì xoá **đúng đường của mình** (không bao giờ xoá đường của lần nhận khác) và dừng. Tiến trình cũ tỉnh lại sau khi tiến trình mới đã `ready` không chạm được object của tiến trình mới.
- **Dọn định kỳ (bền):** mỗi chu kỳ sweep liệt kê bucket `account-exports` và xoá mọi object không phải (a) `object_path` của một việc `ready` còn hạn, hoặc (b) đường `<user_id>/<export_id>/<claim_token>.zip` của một việc `building` còn hạn thuê. Nhờ vậy object bỏ dở (tiến trình chết sau khi tải lên, lần nhận thua) luôn bị xoá dù không còn tiến trình nào nhớ tới.

## UI and interaction

- Không có UI trong spec này. G07-T17 dựng hai khối theo `ui-states.md` và tờ `TaiKhoan`; mọi chữ "XXX" lấy từ API (`erase_after`, số ngày cấu hình), không ghi cứng.

## Work decomposition

- PR 1 (này): spec, chỉ `specs/0100-account-data-rights/` và một dòng `specs/README.md`.
- PR 2 (mã, high-risk) sau khi anh duyệt spec và T04, T09 đã merge: migration nhãn 500, danh mục và test FR-006, service, router, bước sweep, test. `owns:` các file mới ở trên, `backend/config.py` (khối biến mới), `backend/main.py` (một dòng), `backend/services/activation_gate.py` (kiểm FR-003, khai miễn cổng), `backend/services/storage_limits.py` (một dòng bucket), `backend/migrations/register.tsv` (một hàng), `frontend/types/api.d.ts`.
- PR 3: G07-T17 (giao diện), ngoài spec này.

## Rollout and rollback

Xem `rollout.md`.

## Verification strategy

- pytest với DB giả và catalog giả: FR-001 đến FR-014, đặc biệt huỷ đúng lúc xoá, chạy lại sau lỗi, dry-run không ghi; hai tiến trình xoá cùng một yêu cầu (chỉ một nhận được; tiến trình bị tiếp quản dừng trước bước kế); một job xuất đang chạy khi yêu cầu sang `erasing` (không ghi được `ready`, object bị xoá, sau `erased` tiền tố rỗng và tải về 404); tiến trình xuất cũ hoàn tất sau khi tiến trình mới đã `ready` (object của tiến trình mới còn nguyên, tải về được); tiến trình xuất chết ngay sau khi tải lên trong lúc xoá (bước 8 chờ hết hạn thuê, dọn định kỳ và quét cuối xoá object, `erased` chỉ ghi khi không còn hợp đồng thuê xuất nào); mỗi bước chạy lại sau khi đã xong không đổi gì.
- `tests/test_account_data_inventory.py` (FR-006) và ca âm: migration giả có cột chưa phân loại → test đỏ.
- Staging: kịch bản 4 và 6 trên tài khoản thử, truy vấn kiểm trước/sau ở `rollout.md`.
