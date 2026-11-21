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

## Ghi chú coverage sau merge

`validate_specs.py` không có cơ chế sửa coverage cho PR đã merge, nên các cặp commit/đường dẫn
còn thiếu được ghi ở đây. Các bảng ở trên không đổi.

- **#2413 (T001, head `dbf68271`)** merge vào staging ngày 21/11 khi gate Spec governance chưa
  được chạy lại sau #2398. Chạy lại `validate_specs.py --github-event` trên base sau #2398
  (`4b397732`) báo thiếu ownership cho các cặp sau. Mỗi cặp thuộc **FR-003** (đổi tên
  `routers/listening.py` thành package, route và OpenAPI giữ nguyên):
  - `d710df69:backend/routers/listening.py` (đường dẫn cũ bị xoá khi `git mv` sang
    `backend/routers/listening/__init__.py`).
  - `dbf68271:frontend/tests/admin-listening-content-editor-next-behavior.test.mjs`
  - `dbf68271:frontend/tests/admin-listening-gist-next-behavior.test.mjs`
  - `dbf68271:frontend/tests/admin-listening-mcq-next-behavior.test.mjs`
  - `dbf68271:frontend/tests/admin-listening-segments-next-behavior.test.mjs`
  - `dbf68271:frontend/tests/admin-listening-tests-detail.test.mjs`
  - `dbf68271:frontend/tests/admin-listening-true-false-next-behavior.test.mjs`
  - `dbf68271:frontend/tests/listening-landing-counts.test.mjs`
  - `dbf68271:frontend/tests/listening-test-player.test.mjs`

  Commit `dbf68271` chỉ đổi đường dẫn mà 8 test frontend đọc (một dòng mỗi file, sang
  `backend/routers/listening/__init__.py`). Không có mã chạy nào khác đổi. CI của #2413 trên head
  này xanh ở mọi job trừ gate metadata.
- **#2416 (T002, head `93dd30f6`)** cũng merge khi gate đỏ, nhưng khi chạy lại trên base sau #2413
  (`b6d1ce6f`) thì gate qua. Không thiếu cặp nào.
