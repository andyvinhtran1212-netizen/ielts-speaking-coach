# Verification

## Requirement coverage

The bounded endpoint is implemented and locally verified. Canonical repair and
release remain pending; local synthetic data does not certify deployed behavior.

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=pytest tests/test_reading_grammar_focus.py tests/test_reading_grammar_focus_integration.py; observed=`backend/tests/test_reading_grammar_focus.py` canonical fingerprint tests and `test_missing_and_other_library_records_remain404` (local actual-PG/wire scope; live release pending) | PASS |
| FR-002 | kind=test; ref=pytest tests/test_reading_grammar_focus.py tests/test_reading_grammar_focus_routes.py; observed=`backend/tests/test_reading_grammar_focus.py` strict-shape tests; `test_original_oversized_json_is_rejected_before_decode_or_write` (local actual-PG/wire scope; live release pending) | PASS |
| FR-003 | kind=test; ref=pytest tests/test_reading_grammar_focus_integration.py; observed=`test_actual_one_analysis_edit_preserves_all_other_values_questions_and_private_projection`, `test_real_parent_question_and_immediate_fk_locks_fence_competing_writes` in `backend/tests/test_reading_grammar_focus_integration.py` (local actual-PG/wire scope; live release pending) | PASS |
| FR-004 | kind=test; ref=pytest tests/test_reading_grammar_focus_integration.py; observed=`test_unchanged_timestamp_source_metadata_and_question_drifts_conflict`, `test_import_paused_after_question_delete_conflicts_and_zero_question_scope_still_fences_insert` (local actual-PG/wire scope; live release pending) | PASS |
| FR-005 | kind=test; ref=pytest tests/test_reading_grammar_focus_integration.py; observed=`test_empty_legacy_noop_records_one_receipt_without_timestamp_or_metadata_rewrite`, `test_concurrent_identical_operations_serialize_to_one_audit_receipt`, `test_same_actor_passage_operation_id_reuse_rejects_changed_payload` (local actual-PG/wire scope; live release pending) | PASS |
| FR-006 | kind=test; ref=pytest tests/test_reading_grammar_focus_integration.py; observed=`test_audit_failure_rolls_back_content_and_uses_safe_error`, `test_duplicate_corrupt_matching_receipts_fail_closed_without_rewriting_content`, `test_other_action_non_json_logs_are_never_cast_or_misinterpreted` (local actual-PG/wire scope; live release pending) | PASS |
| FR-007 | kind=test; ref=pytest tests/test_reading_grammar_focus_routes.py tests/test_reading_grammar_focus_integration.py; observed=`backend/tests/test_reading_grammar_focus_routes.py` OpenAPI/auth/error contracts; `test_lost_ack_retry_after_source_and_question_import_uses_saved_component_fingerprints`; generated types and both tsc boundaries (local actual-PG/wire scope; live release pending) | PASS |
| FR-008 | Independent source parse, reviewed one-analysis diff and canonical read-after | PENDING |
| FR-009 | Separate approval, exact-SHA staging/release and bounded production/restore evidence | PENDING |

## Discovery evidence

- Production read probe confirms wrong first `analysis`; audit artifact
  `evidence/production-canonical-probe.json` captured2026-09-30.
- Local staging probe contains no copy of this record; it cannot prove repair.
- Existing import updates passage payload/metadata then deletes/reinserts
  comprehension questions; existing admin L1 list omits full metadata.
- Existing database transaction and governance audit schemas are present in
  source; actual configured environment availability remains to be verified.

## Contract evidence

- 36 model/service tests, 11 actual route/auth/error/size/OpenAPI tests and
  34 actual PostgreSQL cases passed (81 focused tests). Generated api.d.ts and
  main/legacy TypeScript boundaries passed.
- Full backend with explicit owned PostgreSQL prerequisite: 8,981 passed,
  355 unrelated integration skips, 13 warnings. Full Node: 9,204 passed,
  3 skips. Skips do not certify live contracts.
- Local logs and independently bound hashes are in the external remediation
  audit directory: admin-reading-focus-handoff.md, reading-editor-full-backend.log,
  reading-editor-full-node.log and reading-focus route/type evidence.

## Data evidence

- Actual PG verifies unrelated Unicode/large metadata, questions/IDs/hashes,
  whole-state CAS including unchanged-timestamp drift, no-op timestamp retention,
  concurrent retries, audit rollback, child update/delete/insert locks and
  immediate FK protection. Deferrable/unknown FK state fails before writes.
- Lost ACK after later source/question import returns the committed component
  hashes separately from current hashes. Matching duplicate/corrupt receipts
  fail closed; unrelated non-JSON audit TEXT is never cast.
- These are synthetic owned-schema results; configured staging/production
  transaction, source and preservation readback remain pending.

## Academic evidence

- Proposed corrected analysis is in the external council evidence report.
- Second reviewer, actual source-text match and exact field diff: pending.

## Release evidence

- Spec approval and implementation PR/head: pending.
- Exact staging frontend/backend SHA and synthetic journey: pending.
- Actual production read-before/operation/read-after/restore evidence: pending.
