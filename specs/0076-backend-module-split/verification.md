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

## Scenario 10 trên staging (sau T008, #2450 hold 4)

Chạy ngày 23/11/2026 trên staging, FE và BE cùng ở `cc6dd4c8f` (merge #2457, sau PR `attempts.py`
#2433). Railway deployment `c7b888df-9cef-4afd-8fb0-6f92aa95f51e`, app khởi động 05:09:09Z.
FE SHA đọc từ `data-release`, BE SHA từ `/health/runtime`.

- **Tài khoản:** tài khoản staging của anh Andy (`andyvinhtran1212`), theo lựa chọn của anh ngày
  23/11 ("dùng tài khoản anh cho Listening"). Không dùng tài khoản production.
- **Máy:** Chrome trên Mac mini (Browser 1).
- **Bài:** Listening IELTS, Bài 2 "Photosynthesis process completion" (form player, 2 câu điền
  từ, chế độ luyện "Không tính điểm"). Attempt `cc51432c-a035-44bc-9118-19a684b466f0`.

| Bước | Kết quả |
| --- | --- |
| Bắt đầu bài | `POST /api/listening/tests/{id}/attempts?standalone=true` 200 |
| Nghe audio | phát đủ 0:21 / 0:21 |
| Lưu đáp án | 2 lần `PATCH /api/listening/tests/attempts/{id}/answers` 200 |
| Tải lại trang (resume) | cùng attempt id; `GET …?attempt_id=…` và `guided-state` 200; hai ô vẫn còn `dioxide`, `chlorophyll`; "2/2 câu đã thử" |
| Đối chiếu câu 1 | thành công (log: reveal 200) |
| Nộp | chuyển sang `/listening/programmes/result/{id}`; log: `submit` 200 |
| Xem lại (tải lại trang kết quả) | `GET /api/listening/tests/attempts/{id}/review` 200; hiện cả 2 câu, đáp án và transcript |
| Admin `/admin/listening/attempts` | danh sách hiện attempt (Đã nộp, Không tính điểm, 2 câu, 2 phút 45 giây); "Xem từng câu" hiện 2 câu trả lời |
| Console trình duyệt | không có lỗi trên trang player và trang kết quả |

**Log Railway staging** (chỉ đọc, `railway logs` cho deployment trên, 05:09:08Z đến 05:17:16Z,
180 dòng): 0 dòng status 5xx, 0 `Traceback`, 0 `ResponseValidationError`, 0 `extra_forbidden`.
Có 14 WARNING chứa `listening` và không có ERROR. 12 trong số đó là cảnh báo request chậm
(khoảng 1–2,5 giây, đều 200). 2 là `staff_guard admin_aal2_would_block` (tài khoản admin chưa bật
MFA; chế độ chỉ cảnh báo, không chặn).

Lần đọc lại lúc 05:20:16Z (203 dòng, cùng deployment `c7b888df`, chưa có deployment staging nào
mới hơn), theo các nhóm lỗi trong `rollout.md`: `NameError` 0, `AttributeError` 0,
`PydanticUserError` 0, `Traceback` 0, 5xx trên `/api/listening/*` hoặc `/admin/listening/*` 0,
5xx bất kỳ 0. Đây là kết quả giữa cửa sổ, chưa phải kết quả 48 giờ.

**Cửa sổ theo dõi 48 giờ: `48h: pending`.** Mục này chỉ là biên nhận Scenario 10, chưa phải
kết quả theo dõi 48 giờ. Cửa sổ bắt đầu 2026-11-23 05:09Z trên deployment `c7b888df` /
`cc6dd4c8f`, đủ 48 giờ lúc 2026-11-25 05:09Z. Khi đủ cửa sổ, kết quả đối chiếu đủ các nhóm lỗi
trong `rollout.md`: `NameError`, `AttributeError`, `PydanticUserError`, và 500 mới trên
`/api/listening/*`, `/admin/listening/*`. Nếu staging đổi deployment trong lúc theo dõi, mốc và
log ghi riêng theo từng deployment, và chỉ log của deployment chạy SHA đem promote mới được dùng
làm bằng chứng cho SHA đó.
