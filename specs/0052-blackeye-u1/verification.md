# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_listening_blackeye.py::test_openapi_strict_binding_and_real_response_registration + backend/tests/test_listening_source_collection.py | PENDING |
| FR-002 | kind=test; ref=backend/tests/test_listening_blackeye.py::test_n2_t01_public_allowlist, test_n2_t01_error_bodies_headers_never_echo_private | PENDING |
| FR-003 | kind=test; ref=backend/tests/test_listening_blackeye.py::test_locked_start_cannot_mint_attempt + PR2 frontend test nút khóa A8/A14/A19 | PENDING |
| FR-004 | kind=test; ref=backend/tests/test_listening_blackeye.py::test_n1_missing_null_malformed_binding, test_n2_t02_answer_set_input_no_oracle_no_private_io, test_n2_t03_start_server_frozen_and_t06_key_only_change, test_n2_t05_wrong_stale_binding | PENDING |
| FR-005 | kind=test; ref=backend/tests/test_listening_blackeye.py::test_n4_composite_save_reload_submit_retry_review_lossless, test_malformed_composite_never_falls_back, test_composite_incomplete_component_roundtrip | PENDING |
| FR-006 | kind=test; ref=backend/tests/test_listening_blackeye.py::test_n4_cap_validation, test_n4_a13_48_save_submit_review_one_boundary + backend/tests/test_blackeye_package_import.py + backend/tests/test_blackeye_package_import_postgres.py (package metadata/review persistence, actual 295 import/353 publish/306 capture/376 admission) | PENDING |
| FR-007 | kind=test; ref=backend/tests/test_listening_blackeye.py::test_cas_lost_race_is_conflict_not_optimistic_submit | PENDING |
| FR-008 | kind=test; ref=backend/tests/test_listening_blackeye.py::test_n2_t07_in_progress_projection_and_pre_submit_review_gate, test_n4_wrong_frozen_mapping_and_missing_snapshot_fail_closed | PENDING |
| FR-009 | kind=test; ref=backend/tests/test_listening_blackeye.py::test_review_failure_preserves_persisted_submit_and_answers, test_cross_owner_and_global_admin_do_not_read_marking | PENDING |
| FR-010 | kind=test; ref=backend/tests/test_listening_blackeye.py::test_n2_t08_exact_teacher_scope_and_no_answer_identity | PENDING |
| FR-011 | kind=test; ref=test kiểm kê route `app.routes` (plan.md) + backend/tests/test_listening_blackeye.py::test_r2_o5_guided_denies_before_marking_reads, test_o6_player_preview_and_playback_use_positive_contract, test_no_section_or_dictation_side_door, test_f1_content_grading_rejects_before_private_reads_or_writes | PENDING |
| FR-012 | kind=test; ref=backend/tests/test_listening_blackeye.py::test_assignment_invalid_request_never_reads_or_writes, test_r6_http_generic_assignment_seam_preempts_validation_and_service + test backfill/update/due/delete/return trả 503 với bài giao Black Eye | PENDING |
| FR-013 | kind=test; ref=backend/tests/test_listening_blackeye.py::test_n2_t11_opaque_ids_independent_of_identical_answers_and_digest + web-security chạy lại N2-T01…T12 | PENDING |
| FR-014 | kind=test; ref=backend/tests/test_listening_blackeye.py::test_n2_t12_generic_http_receipts_remain_unchanged, test_f1_generic_dictation_still_grades_and_saves + backend/tests/test_blackeye_package_import.py::test_generic_plan_does_not_consult_or_store_blackeye_fields + backend sync-in-async allowlist gate | PENDING |
| FR-015 | kind=test; ref=backend/tests/test_blackeye_admission_proposal_static.py (gồm `search_path = pg_catalog, pg_temp`, REVOKE/GRANT) + test catalog chỉ đọc `pg_policies`/grant | PENDING |
| FR-016 | kind=test; ref=backend/tests/test_exercise_book_api.py::test_grant_based_first_assignment_catalog_and_denial + test_grant_body_cannot_spoof_actor_or_step_up; query doubles only; D1/QA pending | PENDING |
| FR-017 | kind=test; ref=backend/tests/test_exercise_book_api.py::test_create_replay_close_receipt_and_single_auth, test_exact_sqlstate_message_mapping, test_multi_activity_receipt_never_uses_parent_artifact_or_one_test; query doubles only; D1 PG atomicity/idempotency pending | PENDING |
| FR-018 | kind=test; ref=backend/tests/test_exercise_book_api.py::test_progress_is_one_rpc_no_n_plus_one; query doubles only; deployed reload/E2E pending | PENDING |
| FR-019 | kind=test; ref=PR2 frontend test danh sách, nhãn khóa, runner, xác nhận ô trống | PENDING |
| FR-020 | kind=test; ref=PR2 test HTML/SSR/RSC/cache/preload không có sentinel hay đáp án trước nộp | PENDING |
| FR-021 | kind=report; ref=biên bản nghiệm thu CM theo T011 + tham chiếu anh Vinh duyệt answer set | PENDING |
| FR-022 | kind=test; ref=PR3 test tải gói: dry-run, bản nháp, chặn publish khi thiếu nghiệm thu | PENDING |
| FR-023 | kind=test; ref=test card chính tả khóa và start 422 cho tới release 0011 v2 | PENDING |
| FR-024 | kind=report; ref=bằng chứng QA staging nêu id lớp giả và tài khoản giả | PENDING |
| FR-025 | kind=report; ref=quyết định release của anh Vinh cho đúng SHA + đọc lại sau release | PENDING |
| FR-026 | kind=test; ref=test ma trận IDOR (plan.md) + test sentinel `caplog`/`error_logs`/Sentry `before_send` (sentinel `user_id` không có trong `error_logs.message`/`error_logs.stack`, URL/query, log text, event Sentry; cột `error_logs.user_id` được phép, SA-2280-F11); kind=report; ref=phiếu Security Auditor cho spec và từng PR Black Eye | PENDING |
| FR-027 | kind=test; ref=test ma trận quyền FR-027 (plan.md, vai × route) + test kiểm kê route + PR2 test danh sách cấp quyền (plan.md "Danh sách cấp quyền FR-027": admin toàn cục tự cấp → 403 và 0 dòng, ghi qua JWT `authenticated` bị từ chối, nhật ký cấp/thu đọc lại được) + test catalog chỉ đọc grant/policy của bảng; kind=report; ref=phiếu Security Auditor (C3 của SA-2280-R2 trên đúng head PR2) + quyết định CV-1 của anh Vinh | PENDING |

## Contract evidence

- OpenAPI/type drift: `frontend/types/api.d.ts` khớp OpenAPI có các response model Black Eye (T002).
- Backward compatibility: caller chung giữ request/response/mã lỗi (FR-014, AC12).

## Data evidence

- Migration/schema query: chưa có; admission.sql chỉ là đề xuất, chưa chạy.
  Migration danh sách cấp quyền FR-027 (PR2) chưa viết, chưa có số; khi có,
  đọc lại catalog: không policy và không quyền ghi cho `anon`/`authenticated`.
- Immediate state versus full reload: save → reload → submit → review giống từng byte (FR-005, FR-007).

## UI evidence

- Viewports/themes/input methods: PR2, 1440×900 và 390×844, bàn phím, trình đọc màn hình, hai theme.

## Release evidence

- Staging SHA and checks: PENDING (chỉ dữ liệu giả).
- Production verification: chỉ sau T014, theo 5 hậu kiểm của T014 và phiếu Security Auditor cho đúng bản release.

## D2 route/service evidence (draft)

- D2 consumes FD's frozen D↔E API contract §1–§7 and §8 v1.3. Its tests use
  synthetic query doubles and pin all twelve RPC parameter sets. This evidence
  does not prove database ACL/RLS, locking, atomicity or deployed schema compatibility.
- `backend/tests/test_exercise_book_api.py` covers token-derived identities,
  child-row context without snapshot edits, sequence acknowledgments,
  expected-answer submit/replay, grant list/write/log, HTTP/SQL cursor limits,
  fixed errors and owner-authorized snapshot audio. Grant routes refuse missing,
  stale and cool-off MFA even when the global step-up flag is false.
- `backend/tests/test_listening_blackeye_boundaries.py` expands the route
  inventory and sentinel checks to grant and admin class/cohort surfaces;
  `backend/tests/test_staff_guard_inventory.py` includes all three grant routes.
- All requirement result cells remain PENDING. D2 must integrate D1 and repeat
  verification against real PostgreSQL before merge. Independent CR/SA, MV1,
  frontend/deployed QA, academic acceptance and release authorization remain
  separate gates; D2 performs no shared database writes or release operations.
