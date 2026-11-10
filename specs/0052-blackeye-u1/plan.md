# Implementation plan

Kế hoạch đi kèm spec BLACKEYE-0052 (approved 10/11/2026, t1601s5314). Không phải lệnh triển khai. Code
mới chỉ bắt đầu sau khi spec được merge vào `staging` ở trạng thái `approved`.

## Architecture impact

- Module mới (PR1, đã có trong PR #2279): `backend/models/listening_blackeye.py`
  (DTO strict), `backend/services/listening_blackeye.py` (nhận diện Black Eye,
  chiếu allowlist công khai/bảo vệ, start/save/submit/state/review/teacher
  review, seam giao bài).
- Điểm tích hợp có sẵn (PR1 sửa hẹp, chỉ nhánh Black Eye):
  `backend/routers/listening.py`, `backend/routers/admin_class_assignments.py`,
  `backend/services/listening_package_import.py`,
  `backend/services/class_assignment_service.py`.
- PR2 (S0 §2): `frontend/app/(authed-listening-player)/listening/programmes/form/[testId]/programme-form-runner.tsx`,
  `frontend/app/(authed-listening-review)/listening/programmes/result/[attemptId]/programme-result.tsx`,
  `frontend/app/(authed-admin-classes)/admin/classes/[cohortId]/admin-class-homework.tsx`,
  `frontend/types/api.d.ts`; backend: catalog, giao bài, tiến độ, start/save/
  submit cho attempt được giao, player DTO.
- PR3+: trang tải gói ở admin, chính tả Black Eye.
- Không đổi: định danh bộ 80 ngày, guard chung, importer 40 câu, đường chữa
  từng câu 0006 (vẫn từ chối bài được giao), `DICTATION_LEXICAL_V2_ENABLED`.

### Ánh xạ FR → PR1 (diff `origin/staging...3a7d494e2`)

| FR | Route / model / service trong PR1 | Test trong PR1 |
| --- | --- | --- |
| FR-001 | `models/listening_blackeye.py`: `PROGRAMME`, `COLLECTION`, `CONTRACT`, `BlackEyeModel(extra='forbid', strict=True)`, `BlackEyeLearnerBinding`, `BlackEyeRevisionBinding` | `test_openapi_strict_binding_and_real_response_registration`; `test_listening_source_collection.py` (+9) |
| FR-002 | `GET /api/listening/source-collections/blackeye-v5-upper/units/U1` → `get_blackeye_unit`; service `public_inventory`, `require_published`, `activity_from_paper` | `test_n2_t01_public_allowlist`, `test_n2_t01_error_bodies_headers_never_echo_private` |
| FR-003 | `BlackEyeActivityPublic.cells` validator (locked map), service `LOCKS`, `require_ready` | `test_locked_start_cannot_mint_attempt` |
| FR-004 | `POST /api/listening/tests/{test_id}/attempts` (`start_listening_test_attempt` nhánh Black Eye; `_ListeningAttemptStartRequest.blackeye_binding`); service `start` → RPC `fn_acquire_blackeye_attempt` | `test_n1_missing_null_malformed_binding`, `test_n2_t02_answer_set_input_no_oracle_no_private_io`, `test_n2_t03_start_server_frozen_and_t06_key_only_change`, `test_n2_t05_wrong_stale_binding`, `test_r5_rpc_inactive_and_server_mismatch_sanitized` |
| FR-005 | `PATCH /api/listening/tests/attempts/{attempt_id}/answers` → `BlackEyeSaveAck`; service `save`, `decode_answer`, `BlackEyeKeepChange` | `test_n4_composite_save_reload_submit_retry_review_lossless`, `test_malformed_composite_never_falls_back`, `test_composite_incomplete_component_roundtrip` |
| FR-006 | `listening_package_import.validate_form_response_cells`, nhánh Black Eye trong `build_import_plan`; `BlackEyePublicItem.q_num le=48` | `test_n4_cap_validation`, `test_n4_a13_48_save_submit_review_one_boundary`, `test_n4_malformed_authoritative_cells_never_admit` |
| FR-007 | `POST /api/listening/tests/attempts/{attempt_id}/submit` → `BlackEyeAttemptState`; service `submit` (cập nhật có điều kiện + đọc lại) | `test_cas_lost_race_is_conflict_not_optimistic_submit`, `test_n4_composite_save_reload_submit_retry_review_lossless` |
| FR-008 | `GET /api/listening/tests/attempts/{attempt_id}`, `GET /api/listening/tests/{test_id}/attempts/in-progress` → `BlackEyeAttemptState`/`BlackEyeInProgress`; service `state`, `frozen_public`, `attempt_is_blackeye` | `test_n2_t07_in_progress_projection_and_pre_submit_review_gate`, `test_n4_wrong_frozen_mapping_and_missing_snapshot_fail_closed` |
| FR-009 | `GET /api/listening/tests/attempts/{attempt_id}/review` → `BlackEyeActivityReview`; service `review`; `BlackEyeReviewItem.source_limit` | `test_review_failure_preserves_persisted_submit_and_answers`, `test_cross_owner_and_global_admin_do_not_read_marking` |
| FR-010 | `GET /admin/cohorts/{cohort_id}/assignments/{assignment_id}/items/{item_id}/listening-review` → `blackeye_teacher_review`; service `teacher_review`, `validate_assigned_context` | `test_n2_t08_exact_teacher_scope_and_no_answer_identity` |
| FR-011 | Nhánh Black Eye ở `_programme_guided_context` (guided-state, reveal), `check_listening_practice_answer`, `_resolve_attempt_target`, `_fetch_published_listening_content_with_signed_url`, `_fetch_published_exercises_for_student`, `get_published_listening_test`, `acknowledge_listening_attempt_playback_started`, `_assemble_listening_player_payload`, `get_listening_test_dictation`, `_published_test_for_dictation` | `test_r2_o5_guided_denies_before_marking_reads`, `test_o6_player_playback_interim_no_bundle_no_sign_no_mutation`, `test_no_section_or_dictation_side_door`, `test_admin_preview_also_cannot_use_generic_assembler`, `test_f1_content_grading_rejects_before_private_reads_or_writes` |
| FR-012 | `admin_class_assignments.blackeye_assignment_closed` (3 route), nhánh Black Eye trong `create_assignment`; `class_assignment_service.create_class_assignment`; service `assignment_seam` | `test_assignment_seam_never_catalogs_creates_receipts`, `test_assigned_start_seam_and_generic_give_service_reject`, `test_r6_http_generic_assignment_seam_preempts_validation_and_service`; `test_class_assignment_service.py` (+2) |
| FR-013 | `_ListeningRoute` (422 làm sạch cho `blackeye_binding`, `no-store`), `BlackEyeRevisionBinding.opaque_answer_identity` (UUID) | `test_n2_t11_opaque_ids_independent_of_identical_answers_and_digest`, `test_n2_t02_…`, `test_n2_t07_…` |
| FR-014 | Nhánh chung giữ nguyên; `run_in_threadpool` cho `_resolve_attempt_target`, `_programme_guided_context`; xóa 3 dòng `backend/tests/sync_in_async_allowlist.tsv` | `test_n2_t12_generic_http_receipts_remain_unchanged`, `test_f1_generic_dictation_still_grades_and_saves`, `test_r2_legacy_dispatch_has_no_catalog_io_or_missing_test_keyerror`, `test_r2_frozen_generic_dispatch_reads_identity_once_not_live_catalog`; `test_listening_router.py`, `test_class_archive_listening_submit_snapshot.py` (chỉnh 1–2 dòng) |
| FR-015 | `docs/proposals/blackeye-u1/admission.sql`, `docs/proposals/blackeye-u1/README.md` | `backend/tests/test_blackeye_admission_proposal_static.py` |
| FR-026, FR-027 (R2) | Chưa có trong head `3a7d494e2`; PR1 dựng lại (T001) phải thêm: lọc Black Eye ở route admin chung, nhánh 422/503 ở route kiểm kê, 404 khác chủ ở FR-005/FR-009, `search_path = pg_catalog, pg_temp` trong `admission.sql` | Ma trận quyền, ma trận IDOR, test kiểm kê route, test sentinel log/`error_logs`/Sentry, test tĩnh `admission.sql` |
| (không FR) | `evidence/blackeye-u1-s0/record_tests.py`, `evidence/blackeye-u1-s0/test_s0_characterization.py`, `evidence/blackeye-u1-s0/tests.md`, `handoffs/LISTENING-BLACKEYE-V5-UNIT1-S0-FINDINGS-20261110.md` | Q-6: đề xuất bỏ khỏi PR |

## Data and contracts

Route Black Eye (PR1 trừ khi ghi khác). Mọi response Black Eye mang
`Cache-Control: private, no-store`.

| Method + route | Request → response | Lỗi Black Eye |
| --- | --- | --- |
| GET `/api/listening/source-collections/blackeye-v5-upper/units/U1` | — → `BlackEyeUnitPublic` | 401, 404, 503 |
| POST `/api/listening/tests/{test_id}/attempts?standalone=true` | body cũ + `blackeye_binding: BlackEyeLearnerBinding` → `BlackEyeAttemptState` | 422 binding/khóa/inactive, 409 revision cũ, 404 bị cấm, 503 thiếu RPC/snapshot |
| POST `/api/listening/tests/{test_id}/attempts?class_item=…` | như trên | PR1: 503 seam; PR2: mở |
| GET `/api/listening/tests/{test_id}/attempts/in-progress` | — → `BlackEyeInProgress` | PR1: có class_item/sitting → 503 |
| PATCH `/api/listening/tests/attempts/{attempt_id}/answers` | `{q_num:int, user_answer:string}` → `BlackEyeSaveAck` | 422, 409, 503 |
| POST `/api/listening/tests/attempts/{attempt_id}/submit` | — → `BlackEyeAttemptState` | 409, 422, 503 |
| GET `/api/listening/tests/attempts/{attempt_id}` | — → `BlackEyeAttemptState` | 404, 422, 503 |
| GET `/api/listening/tests/attempts/{attempt_id}/review` | — → `BlackEyeActivityReview` | 404 khác chủ, 409, 503 |
| GET `/admin/cohorts/{cohort_id}/assignments/{assignment_id}/items/{item_id}/listening-review` | — → `BlackEyeActivityReview` | 403, 404, 409, 503 |
| GET guided-state, POST reveal, POST check | — | 422 trước mọi đọc bảo vệ |
| GET `/api/listening/tests/{test_id}`, POST `…/playback-started` | — | 503 tạm (PR2 thay bằng DTO dương, Q-11) |
| Route chính tả cho test Black Eye | — | 422 |
| GET `/admin/cohorts/{cohort_id}/listening-source-catalog` | PR2: — → `BlackEyeSourceCatalog` | PR1: 503 |
| POST `/admin/cohorts/{cohort_id}/listening-source-assignments` | PR2: `BlackEyeAssignmentCreate` → `BlackEyeAssignmentReceipt` | PR1: 503; PR2: 409 dấu vân tay/revision, 422 |
| GET `/admin/cohorts/{cohort_id}/listening-source-assignments/{assignment_id}` | PR2: — → `BlackEyeAssignmentReceipt` | PR1: 503 |
| Tiến độ course 2 | PR2: route cụ thể do PR2 đề xuất, web-reviewer + Security Auditor duyệt trong commit | — |

- Lưu trữ: `listening_test_attempts` (answers dạng `{q_num, user_answer}`,
  `result_summary`, `paper_revision`, `policy_revision`), snapshot
  `mock_paper_attempt_snapshots.paper_row` (metadata `blackeye`,
  `blackeye_context`, `blackeye_db_revisions`) và `marking_rows` (dữ liệu bảo
  vệ). Ánh xạ revision chuỗi ↔ số DB phải tường minh (S0 §6).
- RLS/quyền: không đổi so với migration 306; RPC đề xuất chỉ `service_role`,
  `SET search_path = pg_catalog, pg_temp` (spec, mục bảo mật); bất biến
  PostgREST/Realtime theo spec.
- Migration: xem spec "Thay đổi dữ liệu, config, migration". Không cấp số.
  PR2 cần thêm một migration riêng tạo danh sách cấp quyền FR-027 (xem mục
  "Danh sách cấp quyền FR-027 (PR2)" dưới đây).
- OpenAPI: PR1 đăng ký response model thật; `frontend/types/api.d.ts` phải khớp.

### Kiểm kê route (FR-011, FR-027)

Allowlist route Black Eye: các route ở bảng trên. Route chung nhận
`attempt_id`, `test_id`, `content_id`, `exercise_id`, `programme_id` hoặc
`lesson_id` mà không thuộc allowlist phải trả 422/503 với dữ liệu Black Eye
trước mọi đọc bảo vệ và mọi ghi; test kiểm kê duyệt `app.routes` và fail khi
có route mới chưa xếp loại.

| Route chung | PR1 | Từ PR2 |
| --- | --- | --- |
| GET/PATCH `/api/listening/tests/attempts/{attempt_id}/review-flags` | 422 | 422 |
| POST `/api/mock-corrections/{skill}/attempts/{attempt_id}/post-test-capture` | 422 | 422 |
| POST `/api/mock-corrections/{skill}/attempts/{attempt_id}/items/{q}/events` | 422 | 422 |
| POST `/api/listening/tests/attempts/{attempt_id}/renderer-affinity` | 503 | 503 hoặc nhánh Black Eye được duyệt |
| GET `/api/listening/tests/{test_id}/practice-windows` | 503 | 503 hoặc nhánh Black Eye được duyệt |
| GET `/api/listening/programmes/{programme_id}/lessons`, `…/lessons/{lesson_id}` | loại Black Eye hoặc 503 | như PR1 |
| backfill, update, update due, delete, return bài giao Black Eye | 503 trước mọi ghi | chỉ route Black Eye, quyền FR-027 |

### Ma trận quyền FR-027 (vai × route × kết quả)

Vai: **C** = người tạo bài giao (PR1) / người có quyền FR-027 của cohort đó
(PR2); **G** = admin toàn cục không có quyền FR-027 với cohort; **O** = người
có quyền FR-027 ở cohort khác; **S** = học viên (cả chủ attempt và học viên
khác). "Không có dòng Black Eye" nghĩa là response không chứa attempt, test,
email, tên hay trạng thái Black Eye nào.

| Route | C | G | O | S |
| --- | --- | --- | --- | --- |
| GET `/admin/cohorts/{cohort_id}/assignments/{assignment_id}/items/{item_id}/listening-review` | 200 | 403 | 404 | 401/403 |
| GET `/admin/listening/attempts` | không có dòng Black Eye (PR1); PR2 chỉ khi có quyền | không có dòng Black Eye | không có dòng Black Eye | 401/403 |
| GET `/admin/listening/attempts/{attempt_id}` (attempt Black Eye) | 404 (PR1); PR2 chỉ khi có quyền | 404 | 404 | 401/403 |
| Trang học viên admin (`student_service`) | không có dòng Black Eye (PR1) | không có dòng Black Eye | không có dòng Black Eye | 401/403 |
| Tổng quan admin (`admin_overview`), `cohort_progress_aggregator` | không có dữ liệu Black Eye (PR1) | không có dữ liệu Black Eye | không có dữ liệu Black Eye | 401/403 |
| `student_work`, `assignment_tally`, `class_action_log` | 503/không có Black Eye (PR1); PR2 200 | 403 hoặc không có Black Eye | 404 hoặc không có Black Eye | 401/403 |
| Catalog, tạo, biên nhận bài giao Black Eye | 503 (PR1); PR2 200 | 403 | 404 | 401/403 |
| Bảng tiến độ course 2 (PR2) | 200 | 403 | 404 | 401/403 |
| Route học viên với attempt của người khác | 404 | 404 | 404 | 404 (khác chủ) |

Mỗi ô là một test; ô "không có dòng Black Eye" kiểm bằng fixture có cả dữ liệu
Black Eye và dữ liệu thường, và spy không đọc snapshot/`marking_rows`.

### Danh sách cấp quyền FR-027 (PR2; SA-2280-F10, C3 (a)–(e))

- Ai được cấp/thu: **CV-1, còn mở, chặn T005**. Đề xuất: chỉ anh Vinh hoặc vai
  riêng do anh chỉ định. Cho tới khi anh quyết: không có đường cấp quyền,
  danh sách rỗng, mặc định từ chối, PR2 chỉ người tạo bài giao (như PR1).
- Lưu ở đâu: bảng riêng theo lớp trong DB, tạo bằng migration riêng (Release
  Manager cấp số từ sổ migration, Security Auditor review SQL, anh Vinh duyệt
  chạy). Tên bảng/cột chốt trong PR migration; spec không viết SQL.
- Ai ghi: chỉ `service_role` ở backend. Không GRANT INSERT/UPDATE/DELETE cho
  `anon`/`authenticated`; không RLS policy cho client.
- Cấm tự cấp: server từ chối khi người cấp = người nhận. Admin toàn cục
  (`users.role='admin'`) không có route ghi danh sách.
- Nhật ký: mỗi lần cấp/thu một dòng (người cấp, người nhận, cohort, vai, thời
  điểm, lý do); không sửa/xóa dòng cũ; đọc lại được để đối chiếu (T014 hậu kiểm 1).

| Hành động | Người có thẩm quyền CV-1 | G (admin toàn cục) | O | S | JWT `authenticated` qua PostgREST |
| --- | --- | --- | --- | --- | --- |
| Cấp/thu quyền cho người khác ở cohort A | 200 + 1 dòng nhật ký (chỉ sau CV-1) | 403, 0 dòng | 403, 0 dòng | 401/403, 0 dòng | bị từ chối, 0 dòng |
| Tự cấp cho chính mình | 403, 0 dòng | 403, 0 dòng | 403, 0 dòng | 401/403, 0 dòng | bị từ chối, 0 dòng |

Test catalog chỉ đọc: `pg_policies` không có policy cho `anon`/`authenticated`
trên bảng này; `information_schema.role_table_grants` không có quyền ghi cho
hai vai đó.

## UI and interaction

- PR1 không có UI. PR2 theo `ui-states.md`.

## Work decomposition

Xem `tasks.md`. Một executor làm tuần tự từng PR; không sửa song song
`backend/routers/listening.py`. Viết nội dung (T011) chạy song song với code vì
khác file và không vào fixture code.

## Rollout and rollback

- Xem `rollout.md`. Mọi phần đều đóng cho học viên tới bước release riêng
  (T014). Rollback code an toàn vì nhánh Black Eye fail closed và không đổi
  shape chung.

## Verification strategy

- Backend pytest thật qua FastAPI/Pydantic với dữ liệu giả, sentinel
  answer-set (MV1 §5 N2-T01…T12), spy chứng minh "trước khi đọc dữ liệu bảo
  vệ".
- Regression chung: importer 40/41, 80 ngày, chính tả chung, bài Listening đã
  giao (AC12).
- PR2: test frontend hành vi, khớp OpenAPI, E2E local dữ liệu giả, kiểm HTML/
  SSR/RSC/cache/preload không có sentinel/đáp án.
- Staging: chỉ lớp/tài khoản giả (FR-024), sau quyết định migration và ghi
  staging.
- Security Auditor review từng PR; web-security chạy lại AC01.
