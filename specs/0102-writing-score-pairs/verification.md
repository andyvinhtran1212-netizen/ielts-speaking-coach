# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_migration_480_writing_score_pairs.py (snapshot on ai insert, band update, not on prompt_version update or composed) | PENDING |
| FR-002 | kind=test; ref=backend/tests/test_writing_score_pairs.py (instructor keep, admin edit, regrade then edit, version reuse after gc; class with human marker creates a pair; self-practice, Mock and AI-only releases create zero pairs on delivery and reconciliation) | PENDING |
| FR-003 | kind=test; ref=backend/tests/test_migration_480_writing_score_pairs.py (append-only, cascade delete, guard function is SECURITY DEFINER with pinned search_path checked via pg_proc.prosecdef/proconfig, cascade delete by a role without SELECT on users/writing_essays, shadow table in a session search_path ignored) + backend/tests/test_writing_score_pairs.py (duplicate delivery_key, recording failure → reconcile → identical instructor retry leaves exactly one pair, revoke then redeliver) | PENDING |
| FR-004 | kind=test; ref=backend/tests/test_writing_score_pairs.py (record_delivery raises → deliver still delivered) | PENDING |
| FR-005 | kind=test; ref=backend/tests/test_writing_score_pairs.py (reconcile rebuilds, skips missing snapshot and counts) | PENDING |
| FR-006 | kind=check; ref=OpenAPI contract unchanged + existing deliver route tests pass | PENDING |
| FR-007 | kind=test; ref=backend/tests/test_writing_score_pairs.py (flag off → skipped_flag_off, flag read error → skipped) | PENDING |
| FR-008 | kind=test; ref=backend/tests/test_writing_score_pairs.py (dry-run writes nothing, report has no email/name, orphan collection leaves zero missing; retaining that orphan and missing another live capture yields one; a missed band update is detected despite an earlier snapshot; backfill with captured_late restores zero) | PENDING |
| FR-009 | kind=test; ref=backend/tests/test_migration_480_writing_score_pairs.py (forced trigger failure on insert and on flag read: writing_feedback insert commits, WARNING raised, no snapshot) | PENDING |
| FR-010 | kind=test; ref=backend/tests/test_migration_480_writing_score_pairs.py (writing_ai_snapshot_capture=false → no snapshot; missing flag row → capture) | PENDING |
| FR-011 | kind=test; ref=backend/tests/test_migration_480_writing_score_pairs.py (delete reviewer while essay exists: pair kept, bands unchanged, reviewer_id NULL; direct UPDATE incl. reviewer_id-only still rejected; exception requires users row gone) | PENDING |
| FR-012 | kind=test; ref=backend/tests/test_migration_480_writing_score_pairs.py (same transaction as valid essay and reviewer deletes: DELETE/UPDATE on another essay's pair or snapshot rejected, also from a nested trigger) | PENDING |

## Contract evidence

- OpenAPI/type drift: không có, vì không đổi endpoint.
- Backward compatibility: migration chỉ thêm đối tượng mới; cờ tắt thì trả bài giống hệt hôm nay.

## Data evidence

- Migration/schema query: truy vấn đếm ảnh chụp ở `rollout.md` bước 3; PENDING.
- Migration-first: PG17 test áp 480 không có mã G12-C03, chỉ có ảnh chụp, rollback bị
  từ chối khi thiếu `aver.allow_score_pairs_rollback`; PENDING.
- Immediate state versus full reload: N/A, không có giao diện.

## UI evidence

- Viewports/themes/input methods: N/A, không có giao diện.

## Release evidence

- Staging SHA and checks: PENDING.
- Production verification: PENDING.
