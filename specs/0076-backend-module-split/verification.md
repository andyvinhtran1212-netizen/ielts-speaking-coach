# Verification

## Requirement coverage

Mọi dòng ở trạng thái `PENDING`: spec đang ở `draft`, chưa có dòng mã nào. Cột bằng chứng ghi
bằng chứng **dự kiến** theo task sẽ làm; khi mã merge, dòng đổi sang `PASS`/`MANUAL`/`N/A`
theo mẫu ở `specs/_templates/verification.md`.

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_listening_package_seams.py re-export identity + full backend suite (T002–T008) | PENDING |
| FR-002 | kind=test; ref=test_listening_package_seams.py seam/undo/nested/missing-re-export cases; scenarios 2–5, 9 negative control (T002–T008) | PENDING |
| FR-003 | kind=command; ref=plan.md route + app.openapi() snapshot diff empty per PR; CI apitype-drift (T001–T010); scenario 1 | PENDING |
| FR-004 | kind=check; ref=sync_in_async_allowlist.tsv line count and test_no_raw_input_echo.py key count before = after, recorded in each PR (T001–T010) | PENDING |
| FR-005 | kind=test; ref=same checks for routers.admin and services.quiz_service; quiz_service._bank_content_cache identity (T009–T010) | PENDING |
| FR-006 | kind=check; ref=plan.md back-dependency scan prints nothing; review of import lines (T003–T008) | PENDING |
| FR-007 | kind=test; ref=test_listening_package_seams.py LOAD_GLOBAL resolution over every package function; scenario 6 negative control (T002–T008) | PENDING |
| FR-008 | kind=test; ref=test_listening_package_seams.py BaseModel model_rebuild/__pydantic_complete__; OpenAPI diff (T002–T008); scenario 7 | PENDING |
| FR-009 | kind=test; ref=test_listening_blackeye_guard_identity.py package-wide first-await guard + endpoint __globals__ identity; negative control (T002–T008); scenario 8 | PENDING |
| FR-010 | kind=test; ref=test_listening_package_seams.py logger identity and name routers.listening (T002–T008) | PENDING |
