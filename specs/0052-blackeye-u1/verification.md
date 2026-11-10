# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_listening_blackeye.py::test_openapi_strict_binding_and_real_response_registration + backend/tests/test_listening_source_collection.py | PENDING |
| FR-002 | kind=test; ref=backend/tests/test_listening_blackeye.py::test_n2_t01_public_allowlist, test_n2_t01_error_bodies_headers_never_echo_private | PENDING |
| FR-003 | kind=test; ref=backend/tests/test_listening_blackeye.py::test_locked_start_cannot_mint_attempt + PR2 frontend test nút khóa A8/A14/A19 | PENDING |
| FR-004 | kind=test; ref=backend/tests/test_listening_blackeye.py::test_n1_missing_null_malformed_binding, test_n2_t02_answer_set_input_no_oracle_no_private_io, test_n2_t03_start_server_frozen_and_t06_key_only_change, test_n2_t05_wrong_stale_binding | PENDING |
| FR-005 | kind=test; ref=backend/tests/test_listening_blackeye.py::test_n4_composite_save_reload_submit_retry_review_lossless, test_malformed_composite_never_falls_back, test_composite_incomplete_component_roundtrip | PENDING |
| FR-006 | kind=test; ref=backend/tests/test_listening_blackeye.py::test_n4_cap_validation, test_n4_a13_48_save_submit_review_one_boundary | PENDING |
| FR-007 | kind=test; ref=backend/tests/test_listening_blackeye.py::test_cas_lost_race_is_conflict_not_optimistic_submit | PENDING |
| FR-008 | kind=test; ref=backend/tests/test_listening_blackeye.py::test_n2_t07_in_progress_projection_and_pre_submit_review_gate, test_n4_wrong_frozen_mapping_and_missing_snapshot_fail_closed | PENDING |
| FR-009 | kind=test; ref=backend/tests/test_listening_blackeye.py::test_review_failure_preserves_persisted_submit_and_answers, test_cross_owner_and_global_admin_do_not_read_marking | PENDING |
| FR-010 | kind=test; ref=backend/tests/test_listening_blackeye.py::test_n2_t08_exact_teacher_scope_and_no_answer_identity | PENDING |
| FR-011 | kind=test; ref=backend/tests/test_listening_blackeye.py::test_r2_o5_guided_denies_before_marking_reads, test_o6_player_playback_interim_no_bundle_no_sign_no_mutation, test_no_section_or_dictation_side_door, test_f1_content_grading_rejects_before_private_reads_or_writes | PENDING |
| FR-012 | kind=test; ref=backend/tests/test_listening_blackeye.py::test_assignment_seam_never_catalogs_creates_receipts, test_r6_http_generic_assignment_seam_preempts_validation_and_service | PENDING |
| FR-013 | kind=test; ref=backend/tests/test_listening_blackeye.py::test_n2_t11_opaque_ids_independent_of_identical_answers_and_digest + web-security chạy lại N2-T01…T12 | PENDING |
| FR-014 | kind=test; ref=backend/tests/test_listening_blackeye.py::test_n2_t12_generic_http_receipts_remain_unchanged, test_f1_generic_dictation_still_grades_and_saves + backend sync-in-async allowlist gate | PENDING |
| FR-015 | kind=test; ref=backend/tests/test_blackeye_admission_proposal_static.py | PENDING |
| FR-016 | kind=test; ref=PR2 test catalog admin (N2-T09: học viên/cohort khác/admin toàn cục 403/404) | PENDING |
| FR-017 | kind=test; ref=PR2 test giao bài idempotent, 409 dấu vân tay, N2-T04, N2-T10 | PENDING |
| FR-018 | kind=test; ref=PR2 test bảng tiến độ sau tải lại + E2E local dữ liệu giả | PENDING |
| FR-019 | kind=test; ref=PR2 frontend test danh sách, nhãn khóa, runner, xác nhận ô trống | PENDING |
| FR-020 | kind=test; ref=PR2 test HTML/SSR/RSC/cache/preload không có sentinel hay đáp án trước nộp | PENDING |
| FR-021 | kind=report; ref=biên bản nghiệm thu CM theo T011 + tham chiếu anh Vinh duyệt answer set | PENDING |
| FR-022 | kind=test; ref=PR3 test tải gói: dry-run, bản nháp, chặn publish khi thiếu nghiệm thu | PENDING |
| FR-023 | kind=test; ref=test card chính tả khóa và start 422 cho tới release 0011 v2 | PENDING |
| FR-024 | kind=report; ref=bằng chứng QA staging nêu id lớp giả và tài khoản giả | PENDING |
| FR-025 | kind=report; ref=quyết định release của anh Vinh cho đúng SHA + đọc lại sau release | PENDING |
| FR-026 | kind=report; ref=phiếu Security Auditor cho spec và từng PR Black Eye | PENDING |

## Contract evidence

- OpenAPI/type drift: `frontend/types/api.d.ts` khớp OpenAPI có các response model Black Eye (T002).
- Backward compatibility: caller chung giữ request/response/mã lỗi (FR-014, AC12).

## Data evidence

- Migration/schema query: chưa có; admission.sql chỉ là đề xuất, chưa chạy.
- Immediate state versus full reload: save → reload → submit → review giống từng byte (FR-005, FR-007).

## UI evidence

- Viewports/themes/input methods: PR2, 1440×900 và 390×844, bàn phím, trình đọc màn hình, hai theme.

## Release evidence

- Staging SHA and checks: PENDING (chỉ dữ liệu giả).
- Production verification: chỉ sau T014.
