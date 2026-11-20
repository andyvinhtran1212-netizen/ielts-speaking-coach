# Verification

## Requirement coverage

Mọi dòng ở trạng thái `PENDING`: spec đang ở `draft`, chưa có dòng mã nào. Cột bằng chứng ghi
bằng chứng **dự kiến** (test hoặc bước kiểm tay) theo nhiệm vụ sẽ làm; khi mã merge, dòng đổi
sang `PASS`/`MANUAL`/`N/A` theo mẫu ở `specs/_templates/verification.md`.

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=check; ref=backend/migrations/register.tsv block rows (G10-T23) | PENDING |
| FR-002 | kind=test; ref=backend/tests/test_migration_register.py negative case 405 in G06 block (G10-T23); scenario 1 | PENDING |
| FR-003 | kind=check; ref=backend/migrations/README.md Finding the next number + review (G10-T23); scenario 2 | PENDING |
| FR-004 | kind=test; ref=test_migration_register.py warning when max >= 900 (G10-T23) | PENDING |
