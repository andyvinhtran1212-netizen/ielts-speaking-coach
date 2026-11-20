---
id: BACKENDSPLIT-0076
title: The three largest backend modules are split into packages without changing any route, import, OpenAPI contract or test patch target
status: approved
risk: high
owner: product
---

# The three largest backend modules are split into packages without changing any route, import, OpenAPI contract or test patch target

Status: **approved** — anh Andy duyệt ngày 20/11/2026 (`approval-decision.md`). Soạn ngày 20/11/2026 cho nhiệm vụ `G10-T08` (thương mại hoá 2026-11), từ `docs/proposals/commercialization-2026-11/GOI-10-repo-pha-2-cau-truc.md` mục 4(c), 5.2 và G10-T08…T12. Số liệu đo lại trên `staging @ 119ad352` (20/11), không chép từ gói (gói đo ở `93c7085`). Chưa dòng mã nào chạy theo spec này. Chỉ anh Andy duyệt; khi duyệt, câu trả lời ghi vào `approval-decision.md` cùng thư mục, nguyên văn kèm thời điểm, và `status` đổi sang `approved`. Số spec lấy từ sổ cấp số ở `01-KE-HOACH-TONG.md` mục 6. Spec này không có migration.

## Tóm tắt (tiếng Việt)

Người dùng cuối **không thấy gì thay đổi**; nếu thấy là lỗi. Spec cho phép tách `backend/routers/listening.py` (9.558 dòng), rồi `backend/routers/admin.py` (6.273) và `backend/services/quiz_service.py` (7.658) thành package, mỗi PR chỉ cắt-dán một khối liền mạch. Ba điều phải giữ nguyên byte: danh sách route (path, method, name, **thứ tự**), OpenAPI và `frontend/types/api.d.ts`. Mọi `monkeypatch.setattr(routers.listening, X, …)` / `mock.patch("routers.listening.X")` đang có trong 72 file test vẫn phải tác dụng lên mã đã dời, nhờ lớp `_SeamModule` ở `__init__.py`.

Đo lại ở `119ad352` cho thấy bốn điều gói việc chưa ghi, spec này xử lý:

1. **Khối không liền mạch làm đổi thứ tự route.** Gói đề xuất `dictation.py` = dòng 903–1176 **và** 6425–7701. Import một module con chứa cả hai khối sẽ đăng ký route 6425–7701 sớm hơn chỗ cũ → FR-003 hỏng. Spec chỉ cho dời **khối liền mạch**.
2. **Khối 7702–hết không phải "admin attempts".** Nó có 2 route admin và 14 route học viên: bắt đầu, lưu đáp án, `check`, `submit`, xem lại bài Listening (luồng chấm và kết thúc bài, 00 §4.7). Spec đặt tên `attempts.py` và xếp nó vào PR cuối.
3. **Phụ thuộc ngược giữa khối.** Quét AST: 4 tên được khối trước gọi nhưng định nghĩa ở khối sau (`_upload_audio_to_bucket`, `_assemble_listening_review`, `_rows_by_id`, `_fetch_attempt_or_404`). Trong file một khối thì chạy được (tra global lúc gọi); tách ra thì module con trước **không thấy** tên của module con sau và chỉ nổ `NameError` khi đúng nhánh đó chạy. Spec đòi dời các tên này vào `_common.py` trước và thêm test quét tên chưa định nghĩa.
4. **Hai test bảo mật đọc nguồn cả module.** `test_listening_blackeye_guard_identity.py::test_identifier_admin_routes_use_module_staff_guard` (mọi route admin phải gọi `require_admin` của Listening làm `await` đầu tiên, rào Black Eye) và `test_staff_guard_inventory.py::test_soft_checks_go_through_the_staff_guard` đọc `inspect.getsource(routers.listening)` rồi tìm hàm. Sau khi tách, hàm ở module con không còn trong nguồn đó → test đỏ, hoặc tệ hơn nếu sửa vội thì kiểm ít đi. Spec quy định cách sửa giữ nguyên điều kiểm.

## Problem

Ba module lớn nhất của backend:

| Module | Dòng (`119ad352`) | Ai bám vào |
| --- | ---: | --- |
| `backend/routers/listening.py` | 9.558 · 204 hàm/lớp cấp module · 76 route | `main.py:93-96,319,321`; 7 module khác import tên riêng (`admin_class_assignments.py` `_dictation_units_for_content`, `_practice_exercise_payloads`; `listening_source_collection.py` `_programme_attempt_state`; `mock_attempt_flags.py`, `mock_corrections.py` import cả module); 72 file test; `tests/sync_in_async_allowlist.tsv` 186 dòng; `tests/test_no_raw_input_echo.py` 41 khoá; 14 file frontend/CI ghim đường dẫn `backend/routers/listening.py` |
| `backend/routers/admin.py` | 6.273 | 40 module ngoài test import `require_admin`, `require_instructor`, `_actor_id`, `_require_db_engine`; 128 file test; allowlist 105 dòng |
| `backend/services/quiz_service.py` | 7.658 | 45 file test; `tests/conftest.py` xoá `_bank_content_cache` mỗi test; `test_quiz_bank_cache.py` đọc `_bank_content_cache._entries` |

Hai phiên sửa song song cùng một file 9.558 dòng gây xung đột rebase lớn, và người review khó thấy một thay đổi nằm ở khối nào. `docs/REPOSITORY_MAINTENANCE.md` mục "Module follow-up" đã chọn hướng "tách theo ranh giới khi có thay đổi miền, giữ hợp đồng route/response"; spec này là quyết định có chủ đích để làm việc đó ngay trước G08 (phòng thi chung sửa luồng nộp Listening), vì "số dòng thôi không đủ lý do" — lý do ở đây là G08/G09 sắp sửa song song các khối này.

Rủi ro chính không nằm ở cắt-dán mà ở chỗ test **vẫn xanh nhưng kiểm ít đi**: một patch không tới được mã đã dời thì test "hàm X không được gọi" (ví dụ `test_listening_blackeye.py:167` patch 4 hàm bằng `forbidden`, `raising=False`; `test_activation_gate_round2.py` đặt tripwire `routers.listening.supabase_admin`) sẽ qua mà không kiểm gì.

## Scope

- Mục (c) của GOI-10: FR dưới đây và nhiệm vụ G10-T09 … G10-T12.
- `routers/listening.py` → package `routers/listening/` (PR đổi tên, rồi mỗi khối một PR).
- `routers/admin.py` → package `routers/admin/` (sau Listening, ranh giới đề xuất trong PR đầu tiên của T11).
- `services/quiz_service.py` → package `services/quiz_service/` (sau cùng).
- Sửa đường dẫn trong allowlist, khoá `test_no_raw_input_echo.py`, test đọc text, bộ lọc CI — chỉ đổi đường dẫn, không đổi điều kiểm.

## Non-goals

- Không đổi logic, tên hàm, chữ ký, thông báo lỗi, tên logger, thứ tự route; không "dọn" import thừa trong PR tách (mục 8 điểm 2 của gói).
- Không sửa test sang đường dẫn module con hàng loạt (Q-c1 mặc định: dùng `_SeamModule`).
- Không tách `services/mock_exam_service.py`, `frontend/public/js/practice.js` hay module khác.
- Không đổi job CI bắt buộc, không đổi `main.py` ngoài dòng import nếu thật cần (mục tiêu: `main.py` không đổi).
- Không thêm lint/công cụ mới vào `requirements.txt`; test quét tên dùng thư viện chuẩn (`dis`, `ast`).

## Users and journeys

- Người thực thi G08/G09: sửa một khối Listening/admin mà không đụng file 9.558 dòng của người khác.
- Người review (CR/SA): đọc một PR tách và thấy ngay đó là cắt-dán (rename/move 100%, diff route rỗng).
- Học viên và admin: không thấy khác biệt; bài Listening bắt đầu, nộp, xem lại như cũ.

## Requirements

Đánh số theo gói (FR-10c-NNN → FR-NNN); FR-006 … FR-010 là yêu cầu mới thêm khi đo lại ở `119ad352`.

- **FR-001:** `from routers.listening import user_router, admin_router` và mọi tên mà mã hoặc test đang import/đọc từ `routers.listening` (kể cả tên bắt đầu bằng `_`) vẫn dùng được, và là **cùng đối tượng** với định nghĩa trong module con.
- **FR-002:** `monkeypatch.setattr(routers.listening, X, v)`, dạng chuỗi `monkeypatch.setattr("routers.listening.X", v)`, `mock.patch("routers.listening.X")` và `patch.object(routers.listening, "X")` vẫn có tác dụng lên mã đã dời, và hoàn tác (undo/exit) trả mọi module con về đúng giá trị gốc.
- **FR-003:** Danh sách route của app (path, methods, name, lớp route, **thứ tự**), `app.openapi()` và `frontend/types/api.d.ts` sinh lại không đổi byte so với SHA trước PR.
- **FR-004:** Allowlist `sync_in_async_allowlist.tsv` và khoá `test_no_raw_input_echo.py` chỉ đổi đường dẫn file/tên callee; tổng số dòng/khoá không tăng, không thêm khoá cho hàm mới.
- **FR-005:** Cùng FR-001…FR-004 cho `routers.admin` (`require_admin`, `require_instructor`, `_actor_id`, `_require_db_engine` giữ định nghĩa ở `routers/admin/__init__.py`) và `services.quiz_service` (đúng một đối tượng `_bank_content_cache`).
- **FR-006:** Mỗi module con là **một khối liền mạch** của file gốc, được import trong `__init__.py` đúng vị trí khối cũ; module con chỉ import từ `_common.py`, từ module con đứng **trước** nó, hoặc từ module ngoài package như file gốc — không bao giờ `from routers.listening import …` (package đang khởi tạo dở).
- **FR-007:** Không có tên global nào trong hàm của package mà lúc chạy không giải được: một test quét mọi code object của mọi hàm định nghĩa trong package (đệ quy vào hàm lồng) và đòi mỗi tên `LOAD_GLOBAL` có trong `vars(<module định nghĩa hàm>)` hoặc `builtins`.
- **FR-008:** Mọi lớp Pydantic định nghĩa trong package hoàn tất được (`model_rebuild()` không lỗi, `__pydantic_complete__` là `True`) ngay sau `import routers.listening`; mọi tham số endpoint có chú thích kiểu (chuỗi, do `from __future__ import annotations` ở dòng 21) giải được trong `__globals__` của module con chứa endpoint.
- **FR-009:** Rào Black Eye không đổi: mọi endpoint của `admin_router` gọi `routers.listening.require_admin` (bọc `_admin_targets`) làm `await` đầu tiên, và `__globals__["require_admin"]` của endpoint **là** đối tượng đó — không phải `routers.admin.require_admin`. `_admin_targets`, `_ListeningRoute`, `_ListeningAdminRoute`, `user_router`, `admin_router` mỗi thứ tồn tại đúng một đối tượng.
- **FR-010:** Log và quan sát không đổi: mọi bản ghi log của mã đã dời vẫn mang tên logger `routers.listening` (dòng 129 hiện là `logging.getLogger(__name__)`; module con dùng chung đối tượng `logger` từ `_common.py`).

## Acceptance scenarios

### Scenario 1 — route và hợp đồng API giống hệt (gói E2E-3)

- **Given** SHA staging trước PR tách và SHA của PR
- **When** chạy lệnh chụp route ở `plan.md` và dump `app.openapi()` trên cả hai, rồi `diff`
- **Then** hai diff rỗng, CI `apitype-drift` xanh (FR-003)

### Scenario 2 — patch thuộc tính module lan tới endpoint đã dời

- **Given** test `monkeypatch.setattr(listening, "supabase_admin", fake)`
- **When** gọi một endpoint đã dời sang `routers/listening/dictation.py` qua `TestClient`
- **Then** endpoint đọc/ghi qua `fake`; sau khi test kết thúc `routers.listening.dictation.supabase_admin is database.supabase_admin` (FR-002)

### Scenario 3 — patch tên chưa có, `raising=False`

- **Given** `monkeypatch.setattr(listening, "load_marking_snapshot", forbidden, raising=False)` (tên chỉ được import **trong thân hàm** ở dòng 8588, không có ở cấp module — `test_listening_blackeye.py:167`)
- **When** test chạy rồi hoàn tác (monkeypatch gọi `delattr` vì tên trước đó không có)
- **Then** không module con nào bị tạo hay xoá thuộc tính; hành vi giống hệt file một khối (patch này vô tác dụng cả trước lẫn sau — ghi nhận, không sửa trong spec này) (FR-002)

### Scenario 4 — patch một tên có ở module con nhưng thiếu re-export

- **Given** một PR tách quên re-export `_student_audio_url_for_test` khỏi package
- **When** test `monkeypatch.setattr(listening, "_student_audio_url_for_test", forbidden, raising=False)` chạy
- **Then** `_SeamModule.__setattr__` ném `AttributeError` nêu tên và module con ("re-export gap"), thay vì gắn giá trị giả vào module con rồi khi hoàn tác không gỡ được (FR-001, FR-002)

### Scenario 5 — `mock.patch` lồng nhau

- **Given** `with mock.patch("routers.listening.require_admin", a): with mock.patch.object(listening, "require_admin", b): …`
- **When** gọi endpoint admin ở module con trong khối trong, rồi ở khối ngoài, rồi sau cả hai
- **Then** lần lượt thấy `b`, `a`, rồi hàm gốc ở **mọi** module con có tên đó (FR-002)

### Scenario 6 — tên định nghĩa ở khối sau, gọi từ khối trước

- **Given** `_fetch_attempt_or_404` (dòng 8232, khối `attempts`) được khối `student_fulltest` (5192–6424) gọi
- **When** PR tách `student_fulltest.py` merge trước khi `_fetch_attempt_or_404` vào `_common.py`
- **Then** test quét tên (FR-007) đỏ ngay trong PR, nêu `student_fulltest: _fetch_attempt_or_404`; không chờ tới khi học viên chạm nhánh đó mới `NameError`

### Scenario 7 — chú thích kiểu dạng chuỗi và Pydantic

- **Given** `from __future__ import annotations` (dòng 21): mọi chú thích là chuỗi; FastAPI giải chú thích tham số endpoint bằng `__globals__` của hàm lúc khai báo route; Pydantic giải tham chiếu tới lớp khác theo namespace của module định nghĩa lớp
- **When** dời một endpoint mà chú thích tham số nhắc model của `_common.py`, hoặc dời một model mà field nhắc model ở module khác
- **Then** module con import tên model tường minh; `import routers.listening` thành công và test FR-008 xác nhận mọi model `__pydantic_complete__`; tên schema trong OpenAPI không đổi (FastAPI đổi tên schema theo `__module__` khi có hai model trùng tên — diff OpenAPI ở Scenario 1 bắt được) (FR-008, FR-003)

### Scenario 8 — test bảo mật đọc nguồn module

- **Given** `test_identifier_admin_routes_use_module_staff_guard` đọc `inspect.getsource(lr)` và đòi `lr.require_admin.__module__ == lr.__name__`
- **When** `require_admin` và endpoint admin dời sang `_common.py`/module con
- **Then** test được sửa trong cùng PR để đọc nguồn **mọi** module của package (gộp hàm cấp module từ `__init__` và mọi module trong `_SUBMODULES`) và thay điều kiện `__module__` bằng `lr.require_admin is lr._common.require_admin` cộng kiểm FR-009 cho từng endpoint; mọi điều kiện cũ (await đầu tiên, không import `require_admin` trong hàm) giữ nguyên; thử âm: đổi một endpoint admin sang `from routers.admin import require_admin` → test đỏ (FR-009)

### Scenario 9 — chặn test qua vô ích

- **Given** bộ test sau PR tách xanh
- **When** người thực thi tạm thay `_SeamModule.__setattr__` bằng bản không lan xuống module con và chạy `test_listening_package_seams.py`, `test_listening_blackeye.py`, `test_activation_gate_round2.py`
- **Then** ít nhất `test_listening_package_seams.py` đỏ (chứng minh test seam phát hiện được seam hỏng); khôi phục seam → xanh. Kết quả dán vào PR (FR-002)

### Scenario 10 — một bài Listening thật trên staging (gói E2E-3)

- **Given** T10 xong và staging chạy SHA sau PR `attempts.py`
- **When** dùng tài khoản thử (không phải production) bắt đầu một bài Listening, lưu đáp án, nộp, mở xem lại; admin mở `/admin/listening/attempts`
- **Then** mọi bước như trước, không lỗi 500 mới trong log Railway staging của `routers.listening`

## Edge cases

- **Tên trùng giữa hai khối:** đã quét ở `119ad352` — không có hàm/lớp cấp module nào định nghĩa hai lần. Nếu PR sau làm phát sinh, hàm re-export của `__init__.py` ném lỗi khi một tên đã có trong package mà trỏ tới đối tượng khác (không để "khối sau thắng" âm thầm như file một khối).
- **Trạng thái module có thể đổi:** `_gist_attempts` (dòng 1260, `conftest.py:160-165` gọi `.clear()`), `_drill_checkpoint_requests` (8254), `_admin_targets` (ContextVar, 153). Không có `global` gán lại nào trong file; cùng một đối tượng nên `.clear()` vẫn đúng; gán lại bằng `setattr` đi qua seam. Nếu PR sau thêm `global X; X = …` trong module con, bản re-export ở package sẽ cũ — test quét FR-007 không bắt được điều này, nên CR kiểm `git grep -n "^\s*global " backend/routers/listening/`.
- **Patch trực tiếp lên module con** (test mới viết `setattr(routers.listening.attempts, X, …)`): không lan lên package hay module khác; hàm ở `__init__.py` vẫn thấy giá trị gốc. Quy ước ghi trong docstring `__init__.py`: test patch package.
- **`delattr` trên package một tên mà module con có:** `_SeamModule.__delattr__` ném `TypeError` thay vì xoá ở module con (hoàn tác của `monkeypatch.delattr` dùng `setattr` sẽ không khôi phục được ở module con). Ở `119ad352` không test nào `delattr` trên `routers.listening`.
- **Chuỗi callee trong allowlist** (`routers.listening._fetch_attempt_or_404`): `sync_io_guard` báo callee theo nơi tên được giải; sau khi dời, chép khoá mới từ thông báo "New sync I/O"/"stale", tổng số không đổi (FR-004).
- **Thứ tự route:** Starlette không cho tham số path khớp `/`, nên `/tests/{test_id}` không nuốt `/tests/dictation/capabilities`; vẫn bắt buộc giữ thứ tự (FR-003) vì cặp cùng số đoạn (ví dụ `/tests/{test_id}/hard` và route tĩnh tương lai) phụ thuộc thứ tự.
- **Hàm import tại chỗ** (`_is_admin` dòng 8435 import `routers.admin.require_admin` trong thân hàm): không đổi; `test_staff_guard_inventory.py` kiểm điều đó qua AST của hàm — sửa test để tìm hàm trong mọi module của package (như Scenario 8).
- **`__pycache__` và file `listening.py` còn sót:** Python ưu tiên package khi có cả hai; `git mv` đảm bảo chỉ còn một; xoá `__pycache__` cục bộ khi lỗi import lạ.
- **PR tính năng Listening đang mở:** PR tách không chạm khối mà một PR mở đang sửa; nếu xung đột, PR tách làm lại từ đầu trên base mới (cắt-dán lại, không merge tay).

## Success criteria

- `wc -l backend/routers/listening/__init__.py` dưới 2.000 dòng sau T10; không module con nào trên 2.000 dòng.
- Diff route + OpenAPI + `api.d.ts` rỗng ở mọi PR tách; tổng dòng allowlist và khoá raw-input không tăng.
- Không lỗi 500 mới trên staging trong 48 giờ sau mỗi PR tách; bài Listening thử chạy đủ vòng (Scenario 10).
- Không test nào bị xoá, skip hay xfail; mọi test sửa chỉ đổi đường dẫn hoặc tập module được đọc, liệt kê trong PR.

## Related specifications

- TESTPOLICY-0057: test mới (`test_listening_package_seams.py`, test quét tên) kiểm hành vi/đối tượng, không so chuỗi mã nguồn. Hai test bảo mật ở Scenario 8 vốn đọc AST; spec này giữ cách đó và chỉ mở rộng tập file đọc.
- Spec Listening đang `implementing`/`approved` (0005, 0006, 0007, 0009, 0011, 0052 BLACKEYE, 0054 SKILLDRILLS) và G08 (phòng thi chung): quyết định thời điểm ở Q-c2.
- ADMINIA-0074 và G09 (T11 tách `routers/admin.py`): ở `119ad352` không PR mở nào chạm `routers/admin.py` (#2393 chỉ chạm `routers/admin_settings.py`); G09 sẽ thêm route admin nên thời điểm T11 cũng do người điều phối báo, như Q-c2.

## Open questions

| # | Câu hỏi | Phương án đề nghị | Mặc định tạm |
| --- | --- | --- | --- |
| Q-c1 | Cơ chế `_SeamModule` (lan monkeypatch xuống module con) có chấp nhận được không, thay vì sửa khoảng 200 lời gọi patch trong 72 file test sang đường dẫn module con? | Chấp nhận, với hai chốt chặn mới của spec: ném lỗi khi thiếu re-export (Scenario 4) và test thử âm (Scenario 9) | Dùng `_SeamModule` |
| Q-c2 | Thời điểm tách `listening.py` so với các spec Listening đang mở và G08? | PR1 (đổi tên, T09) làm ngay khi không có PR mở nào chạm `backend/routers/listening.py` (ở `119ad352`: không có); PR2…PR7 làm lần lượt trước khi G08 sửa backend Listening | Người điều phối báo "cửa sổ trống" trước mỗi PR |
| Q-c3 | Đổi tên khối 7702–hết từ `admin_attempts.py` (gói) thành `attempts.py` và tách `dictation.py` chỉ gồm 6425–7701 (khối 903–1176 ở lại `__init__.py`) vì khối không liền mạch làm đổi thứ tự route? | Đồng ý (FR-006) | Theo spec |
