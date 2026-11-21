# Verification

## Requirement coverage

Mọi dòng ở trạng thái `PENDING`: spec đang ở `draft`, chưa có dòng mã nào. Cột bằng chứng ghi
bằng chứng **dự kiến** theo task sẽ làm; khi mã merge, dòng đổi sang `PASS`/`MANUAL`/`N/A`
theo mẫu ở `specs/_templates/verification.md`.

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=report; ref=PR body evidence table per wave, layers 1–3 (T002–T007); scenario 2, 3, 7 | PENDING |
| FR-002 | kind=check; ref=docs/TEST_INVARIANT_LEDGER.md LEGACYJS-0075 rows per wave (T002–T007); scenario 5, 6 | PENDING |
| FR-003 | kind=journey; ref=CI Next-native browser regression + run-flow-repeat --runs 2 + preview curl 404 + staging console check (T002–T007); scenario 1 | PENDING |
| FR-004 | kind=check; ref=PR file list contains no Non-goals file (T002–T007) | PENDING |
| FR-005 | kind=command; ref=plan.md layer-1 name and dynamic-URL scan incl. public/js and comments (T001); scenario 2, 3, 4 | PENDING |
| FR-006 | kind=report; ref=PR body table file · lines · L1 · L2 · L3 · tests · ledger (T002–T007) | PENDING |
| FR-007 | kind=check; ref=count of edited test files per PR <= 30 (T002–T007) | PENDING |
