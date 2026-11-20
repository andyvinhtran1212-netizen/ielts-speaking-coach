# Verification

## Requirement coverage

Mọi dòng ở trạng thái `PENDING`: spec đang ở `draft`, chưa có dòng mã nào. Cột bằng chứng ghi
bằng chứng **dự kiến** theo task sẽ làm; khi mã merge, dòng đổi sang `PASS`/`MANUAL`/`N/A`
theo mẫu ở `specs/_templates/verification.md`.

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=command; ref=plan.md stylesheet link diff empty per page + TESTPOLICY-0057 visual baseline unchanged (T001–T007); scenario 1, 5 | PENDING |
| FR-002 | kind=check; ref=first G09 page under (authed-admin) without shell layout passes route-ownership-check.mjs (ADMINIA-0074); scenario 6 | PENDING |
| FR-003 | kind=check; ref=ls frontend/app shows the three kept groups after T007 | PENDING |
| FR-004 | kind=journey; ref=/admin/writing/queue and /admin links contain no parent-prefix page sheet (T001–T007); scenario 4 | PENDING |
| FR-005 | kind=journey; ref=frontend/tests/visual/admin.spec.js client-navigation screenshot + DOM link list equals direct load (T001); scenario 2, 3 | PENDING |
| FR-006 | kind=test; ref=route-ownership-check.mjs, route-ledger-matches-app, workflow-path-coverage, authed-shell tests per PR (T001–T007) | PENDING |
| FR-007 | kind=check; ref=group and edited-test counts per PR (T001–T007) | PENDING |
