# Implementation plan

## Architecture impact

Chỉ cấu trúc file Python của ba module. Không đổi route, response, schema DB, biến môi trường, tên logger hay hành vi chạy thật. `backend/main.py` không đổi (`from routers.listening import user_router, admin_router` giữ nguyên).

Ràng buộc riêng của gói (GOI-10 mục 8) áp dụng: không PR mã nào trước khi spec này `approved` trên `staging`; PR tách chỉ cắt-dán và đổi đường dẫn; mọi thay đổi logic, đổi tên, dọn import là PR khác.

### Bản đồ khối của `routers/listening.py` (đo ở `119ad352`)

Ranh giới lấy từ chú thích `# ── …` thật trong file. Mỗi module con là **một khối liền mạch** (FR-006); số dòng chỉ là mốc lúc đo, người thực thi đo lại bằng `grep -n "^# ──" backend/routers/listening/__init__.py` trước mỗi PR.

| Module | Dòng gốc | Nội dung | Route | PR |
| --- | --- | --- | ---: | --- |
| `_common.py` | 22–710 | import, `logger`, `_ListeningRoute`, `user_router`, `_admin_targets`, `require_admin` (bọc Black Eye), `_ListeningAdminRoute`, `admin_router`, helpers 217–603, schemas 604–710 | 0 | PR2 |
| `__init__.py` (ở lại) | 711–2470 | user content fetch, nộp dictation `/attempts`, graders (dictation/gist/TF/MCQ, `_gist_attempts`), list exercises, admin content + exercise CRUD, browse, analytics | 13 | — |
| `admin_import.py` | 2471–3830 | test bundle CRUD, DOCX convert, import full test, skill-drill import | 12 | PR3 |
| `admin_audit.py` | 3831–5191 | content audit, audio assemble/upload (`_upload_audio_to_bucket` 4488), map image helpers, manual upload | 13 | PR4 |
| `student_fulltest.py` | 5192–6424 | lớp full test học viên, player preview, `_assemble_listening_player_payload` (6152) | 8 | PR5 |
| `dictation.py` | 6425–7701 | chép chính tả theo đề + báo cáo dictation và cờ nội dung | 14 | PR6 |
| `attempts.py` | 7702–9558 | admin đọc lượt làm (2 route) **và** vòng đời lượt làm học viên: bắt đầu, lưu đáp án, `playback-started`, `renderer-affinity`, `check`, `submit`, xem lại, practice windows, Black Eye U1 (14 route) | 16 | PR7 |

Số route đo bằng dòng định nghĩa endpoint của `user_router.routes` + `admin_router.routes` (36 + 40 = 76; app có 649 route).

Dòng 1–21 (docstring, `from __future__ import annotations`) ở lại đầu `__init__.py` **và** được chép (không dời) vào đầu mỗi module con: mọi module con phải có `from __future__ import annotations` để chú thích vẫn là chuỗi như cũ.

Khối 903–1176 (nộp dictation cũ, route `POST /api/listening/attempts`) ở lại `__init__.py`; gói đề xuất gộp nó với 6425–7701 vào `dictation.py`, nhưng như vậy route 6425–7701 sẽ được đăng ký trước route 1503–2470 → đổi thứ tự (Q-c3).

### Phụ thuộc ngược phải gỡ trước (quét AST ở `119ad352`)

Tên được khối **trước** dùng nhưng định nghĩa ở khối **sau**. Trong file một khối, hàm tra global lúc gọi nên chạy được; sau khi tách, module con trước không có tên đó.

| Dùng ở | Định nghĩa ở | Tên |
| --- | --- | --- |
| `admin_import` | `admin_audit` | `_upload_audio_to_bucket` |
| `admin_audit` | `attempts` | `_assemble_listening_review` |
| `student_fulltest` | `attempts` | `_fetch_attempt_or_404` |
| `dictation` | `attempts` | `_rows_by_id` |

`__init__.py` (711–2470) cũng dùng 7 tên của khối sau (`_rows_by_id`; `_assisted_programme_attempt_ids`, `_browse_public_parents`, `_drop_hidden_content`, `_hidden_listening_ids`, `_published_content_modes`, `_published_content_rows` của `student_fulltest`). Những tên này **không** cần gỡ: hàm ở `__init__.py` tra global của package, và package có tên đó sau khi re-export module con.

Cách gỡ: PR "helpers chung" (PR2b, ngay sau PR2) dời 4 hàm ở bảng trên cùng mọi tên mà chúng cần (bao đóng bắc cầu, đo bằng lệnh quét dưới đây chạy lại sau mỗi lần dời) vào **cuối** `_common.py`. Các hàm này không phải route nên dời không đổi thứ tự route. Nếu bao đóng của một hàm vượt 400 dòng, module con dùng nó **không tách** trong T10 (ở lại `__init__.py`), ghi lý do trong PR; không gộp khối không liền mạch để né.

Lệnh quét (stdlib, chạy trên file gốc trước PR2; ghi kết quả vào thân PR):

```bash
cd backend && python - <<'PY'
import ast
src = open("routers/listening/__init__.py").read(); tree = ast.parse(src)
SPANS = [("_common", 1, 710), ("__init__", 711, 2470), ("admin_import", 2471, 3830),
         ("admin_audit", 3831, 5191), ("student_fulltest", 5192, 6424),
         ("dictation", 6425, 7701), ("attempts", 7702, 10**6)]
order = [s[0] for s in SPANS]
span = lambda line: next(n for n, a, b in SPANS if a <= line <= b)
defs = {}
for node in tree.body:
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)): names = [node.name]
    elif isinstance(node, ast.Assign): names = [t.id for t in node.targets if isinstance(t, ast.Name)]
    elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name): names = [node.target.id]
    elif isinstance(node, (ast.Import, ast.ImportFrom)): names = [(a.asname or a.name).split(".")[0] for a in node.names]
    else: names = []
    for n in names: defs.setdefault(n, span(node.lineno))
for node in tree.body:
    user = span(node.lineno)
    for sub in ast.walk(node):
        if isinstance(sub, ast.Name) and isinstance(sub.ctx, ast.Load) and sub.id in defs:
            owner = defs[sub.id]
            if user != "__init__" and order.index(owner) > order.index(user):
                print(user, "->", owner, sub.id)
PY
```

### `__init__.py` sau T10

```python
"""(docstring cũ, dòng 1–20) + đoạn mới: package seam — test patch package `routers.listening`,
không patch module con; xem specs/0076-backend-module-split/plan.md."""
from __future__ import annotations

from . import _common
from ._common import *            # noqa: F401,F403 — kèm _reexport bên dưới cho tên bắt đầu bằng "_"
_reexport(_common)                # hàm nhỏ định nghĩa ngay trên dòng này, xem "Re-export"

# ── dòng 711–2470 giữ nguyên ──

from . import admin_import;     _reexport(admin_import)
from . import admin_audit;      _reexport(admin_audit)
from . import student_fulltest; _reexport(student_fulltest)
from . import dictation;        _reexport(dictation)
from . import attempts;         _reexport(attempts)

_SUBMODULES = (_common, admin_import, admin_audit, student_fulltest, dictation, attempts)
# … định nghĩa _SeamModule …
_sys.modules[__name__].__class__ = _SeamModule
```

Thứ tự `from . import …` chính là thứ tự khối gốc → decorator của route chạy đúng thứ tự cũ (FR-003). Mỗi module con mở đầu bằng `from __future__ import annotations`, chép **nguyên** khối import của file gốc mà khối đó cần (không dọn), rồi `from ._common import <tên cụ thể>` cho `user_router`, `admin_router`, `require_admin`, `logger`, helpers, schemas, và `from .<module con trước> import <tên>` nếu cần. Không module con nào `from routers.listening import …` (FR-006).

### Re-export

`from ._common import *` không lấy tên bắt đầu bằng `_` (gần hết helper và mục tiêu patch: `_require_auth`, `_fetch_attempt_or_404`, `_student_for_user`…). Vì vậy dùng một hàm trong `__init__.py`:

```python
def _reexport(sub):
    g = globals()
    for name, value in vars(sub).items():
        if name.startswith("__") or name == "annotations":
            continue
        if name in g and g[name] is not value:
            raise ImportError(f"routers.listening: {sub.__name__}.{name} shadows a different object")
        g[name] = value
```

Lỗi khi trùng tên mà khác đối tượng (Edge cases "tên trùng giữa hai khối"). Tên module được import (`asyncio`, `json`, `blackeye`…) cũng được re-export: test patch `listening.blackeye` hay `listening.time` vẫn chạy như cũ.

### `_SeamModule`

```python
import sys as _sys, types as _types

class _SeamModule(_types.ModuleType):
    """Patch trên routers.listening lan xuống mọi module con đang giữ cùng tên,
    để monkeypatch/mock.patch tiếp tục tác dụng lên mã đã dời (BACKENDSPLIT-0076 FR-002).
    Không đổi hành vi chạy thật: mã sản phẩm không setattr lên package."""

    def __setattr__(self, name, value):
        holders = [sub for sub in _SUBMODULES if name in vars(sub)]
        if holders and name not in vars(self):
            raise AttributeError(
                f"routers.listening.{name} is defined in {holders[0].__name__} but not re-exported")
        super().__setattr__(name, value)
        for sub in holders:
            vars(sub)[name] = value

    def __delattr__(self, name):
        holders = [sub.__name__ for sub in _SUBMODULES if name in vars(sub)]
        if holders:
            raise TypeError(f"cannot delete routers.listening.{name}: also bound in {holders}; patch the value instead")
        super().__delattr__(name)
```

So với gói việc (5.2), bản này khác hai chỗ, vì đo lại thấy rủi ro thật:

1. `__setattr__` ném lỗi khi một tên có ở module con mà package không có (thiếu re-export). Bản của gói sẽ gắn giá trị giả vào module con, rồi khi monkeypatch hoàn tác bằng `delattr` (vì `raising=False` và package trước đó không có tên) thì `__delattr__` của gói **xoá luôn hàm thật** khỏi module con → mọi test sau `NameError`. `test_listening_blackeye.py:167` patch 4 tên bằng `raising=False`, nên đây không phải ca lý thuyết.
2. `__delattr__` không lan xuống. Nhánh duy nhất hợp lệ của `delattr` trên package là hoàn tác một patch tên mà package (và vì 1, mọi module con) trước đó không có; khi đó không có gì ở dưới để gỡ. Xoá một tên mà module con đang giữ thì ném lỗi rõ thay vì làm hai nơi lệch nhau.

Ghi `vars(sub)[name] = value` (không qua `setattr`) vì module con là module thường; `mock.patch` và `monkeypatch` đều đọc giá trị cũ bằng `getattr(package, name)` rồi khôi phục bằng `setattr(package, …)`, nên lồng nhau tự đúng (Scenario 5).

### `routers/admin.py` và `services/quiz_service.py` (T11, T12)

- `routers/admin/__init__.py` **giữ định nghĩa** `require_admin`, `require_instructor`, `_actor_id`, `_require_db_engine` (40 module import chúng; `routers/listening/_common.py` cũng import `require_admin as _staff_admin_guard`). Ranh giới con do PR đầu của T11 đề xuất theo chú thích `# ──`/`# ===` thật, cùng bảng phụ thuộc ngược và quét như trên. Endpoint dùng `Depends(require_admin)` bắt giá trị lúc khai báo → test của chúng dùng `app.dependency_overrides`, không phụ thuộc seam.
- `services/quiz_service/`: `_bank_content_cache` định nghĩa **một lần** trong module con và được re-export (cùng đối tượng; `conftest.py` `.clear()` mỗi test; `test_quiz_bank_cache.py` đọc `._entries`). `_at`, `get_bank_for_play`, `reap_expired_course_assessments`, `log_progress`, `student_mistakes`, `start_session`, `submit_course_writing`, `supabase_admin` giữ truy cập qua `services.quiz_service` (dạng chuỗi trong `test_activation_gate_round2.py`).
- Hai package này dùng lại đúng cơ chế `_reexport` + `_SeamModule`; mỗi package có bản riêng (không tạo module tiện ích dùng chung trong PR tách — đó là thay đổi khác).

## Data and contracts

Không có thay đổi dữ liệu hay API. Hợp đồng phải giữ, và cách chụp để so (chạy trên SHA trước và SHA của PR):

```bash
cd backend && SUPABASE_URL=https://example.supabase.co SUPABASE_ANON_KEY=test-anon-key \
  SUPABASE_SERVICE_KEY=test-service-key ENABLE_API_DOCS=0 SENTRY_DSN= python - <<'PY' > /tmp/routes-$(git rev-parse --short HEAD).txt
import json
from main import app
for r in app.routes:
    print(getattr(r, "path", ""), sorted(getattr(r, "methods", None) or []), getattr(r, "name", ""), type(r).__name__)
print(json.dumps(app.openapi(), sort_keys=True))
PY
diff /tmp/routes-<sha-trước>.txt /tmp/routes-<sha-PR>.txt   # phải rỗng
```

Biến môi trường lấy từ `backend/tests/conftest.py:20-28` (giá trị giả). `app.openapi()` vẫn sinh được khi `ENABLE_API_DOCS=0` (job `apitype-drift` trong `.github/workflows/typecheck.yml` gọi đúng hàm này); CI so `frontend/types/api.d.ts`.

Đường dẫn file đổi (T09: `backend/routers/listening.py` → `backend/routers/listening/__init__.py`), phải sửa cùng PR:

| Nơi | Số chỗ ở `119ad352` | Sửa |
| --- | ---: | --- |
| `backend/tests/sync_in_async_allowlist.tsv` | 186 dòng | tiền tố `routers/listening.py::` → `routers/listening/__init__.py::`; callee `routers.listening.<x>` giữ |
| `backend/tests/test_no_raw_input_echo.py` | 41 khoá | `"routers/listening.py"` → `"routers/listening/__init__.py"` |
| test backend đọc text: `test_exam_only_content.py`, `test_admin_exam_preview.py`, `test_admin_listening_content_patch.py`, `test_write_flow_fixtures.py` | — | đổi tham số đường dẫn |
| frontend: `admin-listening-audit.test.mjs`, `admin-listening-audit-next-behavior.test.mjs`, `admin-listening-drills-import.test.mjs`, `admin-listening-fulltest-import.test.mjs`, `listening-review-ui.test.mjs`, `write-flow-core.test.mjs`, `react/review-unavailable-solution-context.test.tsx`, `fixtures/dictation-filler-gold.json`, `fixtures/dictation-length-actual-wire.json`, `tooling/write-flow-core.mjs`, `tooling/write-flows/listening-{gist,mcq,tf}-submit.mjs`, `listening-test-class-item.mjs` | 14 file | đổi đường dẫn, giữ số dòng trong chú thích (nội dung chưa đổi ở T09) |
| `.github/workflows/next-native-browser.yml` | 2 (dòng 356, 435) | `'backend/routers/listening.py'` → `'backend/routers/listening/**'` |

Ở PR2…PR7, mỗi hàm dời kéo theo: khoá allowlist/raw-input của hàm đó đổi `routers/listening/__init__.py::<hàm>` → `routers/listening/<module>.py::<hàm>` (callee chép từ thông báo của `test_no_sync_io_in_async.py`); test đọc text chuỗi của hàm đó đổi `_src(...)` sang file con. Hai test đọc AST cả module (Scenario 8) đổi cách đọc một lần ở PR2:

```python
# thay inspect.getsource(lr) bằng:
def _package_functions(pkg):
    mods = [pkg, *getattr(pkg, "_SUBMODULES", ())]
    out = {}
    for m in mods:
        for n in ast.parse(inspect.getsource(m)).body:
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
                assert n.name not in out, n.name
                out[n.name] = n
    return out
```

`inspect.getsource(module)` của package trả nguồn `__init__.py` — vì vậy phải gộp. Điều kiện `lr.require_admin.__module__ == lr.__name__` đổi thành `lr.require_admin is lr._common.require_admin` (ý gốc: hàm bọc Black Eye của Listening, không phải `routers.admin.require_admin`), cộng một vòng mới kiểm FR-009 cho từng route của `admin_router`.

## Rollout and rollback

Xem `rollout.md`. Mỗi PR một bước, revert một PR là quay lại bước trước; không có dữ liệu hay migration.

## Verification strategy

Mỗi PR tách:

1. `git diff -M --stat` (T09: rename 100%; PR2…PR7: dòng xoá ở `__init__.py` = dòng thêm ở module con, cộng phần đầu module con và dòng `from . import`).
2. Diff route + OpenAPI rỗng (lệnh ở trên); CI `apitype-drift` xanh.
3. `cd backend && python -m pytest tests/ -q` qua, đặc biệt `test_no_sync_io_in_async.py`, `test_no_raw_input_echo.py`, `test_exam_only_content.py`, `test_listening_blackeye_guard_identity.py`, `test_staff_guard_inventory.py`, `test_activation_gate.py`, `test_activation_gate_round2.py` và test mới `test_listening_package_seams.py`.
4. Bộ contract frontend + React qua (đường dẫn trong test).
5. Thử âm Scenario 9 (tạm làm hỏng seam → test seam đỏ) và Scenario 6 (tạm xoá một import tên dùng chung → test quét đỏ), dán kết quả, khôi phục.
6. Đếm: tổng dòng `sync_in_async_allowlist.tsv` và số khoá raw-input trước = sau; `wc -l backend/routers/listening/*.py` ghi trong PR.
7. Sau PR7: Scenario 10 trên staging với tài khoản thử.

Test mới `backend/tests/test_listening_package_seams.py` (thêm ở PR2, mở rộng mỗi PR):

- **Seam:** với mỗi cặp (tên, module con) mà tên có trong cả package và module con: `monkeypatch.setattr(listening, name, sentinel)` → `vars(sub)[name] is sentinel`; sau undo → về đối tượng gốc. Danh sách tên lấy động từ `vars()`, không chép tay.
- **Đường đi thật:** patch `listening.supabase_admin` bằng DB giả rồi gọi một endpoint của mỗi module con qua `TestClient(FastAPI().include_router(...))` → DB giả nhận lời gọi.
- **Thiếu re-export:** tạo một module con giả tạm thời, thêm vào `_SUBMODULES` bằng `monkeypatch`, gán tên chỉ có ở đó → `setattr` package ném `AttributeError`.
- **Tên giải được (FR-007):** với mỗi module `m` của package, mỗi hàm có `__module__ == m.__name__` (kể cả method của lớp và hàm lồng, đệ quy qua `co_consts`), mỗi lệnh `LOAD_GLOBAL` (qua `dis.get_instructions`) phải có trong `vars(m)` hoặc `builtins`.
- **Pydantic (FR-008):** mọi `BaseModel` con có `__module__` thuộc package: `model_rebuild()` không lỗi và `__pydantic_complete__ is True`.
- **Đối tượng duy nhất (FR-009, FR-010):** `listening.user_router is listening._common.user_router`; mọi route của `admin_router` là `_ListeningAdminRoute`; `inspect.unwrap(route.endpoint).__globals__["require_admin"] is listening.require_admin`; `getattr(sub, "logger", None)` của mọi module con là `listening._common.logger` và `.name == "routers.listening"`.

Test này kiểm đối tượng và hành vi, không so chuỗi mã nguồn (TESTPOLICY-0057).

Mốc đã chạy thử khi soạn spec (file một khối ở `119ad352`, Python 3.11, `requirements.txt`): bản nháp của kiểm FR-007 tìm **0** tên `LOAD_GLOBAL` không giải được; 24 lớp Pydantic đều `__pydantic_complete__`; `user_router` 36 route, `admin_router` 40 route. Nghĩa là test mới xanh ngay trên file gốc trước khi tách, nên mọi chỗ đỏ sau đó là do PR tách.

Dòng duy nhất trong PR tách không phải cắt-dán: `_common.py` dòng `logger = logging.getLogger("routers.listening")` thay cho `logging.getLogger(__name__)` (nếu không, mọi log của Listening đổi tên thành `routers.listening._common`; FR-010). Ghi rõ trong PR2.
