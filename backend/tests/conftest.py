"""
Test fixtures + bootstrap for backend tests.

Pytest loads this file before collecting any sibling test modules.  We use
that window to ensure the Supabase client can be imported even when no real
.env is present — handy in CI and when running pytest from the repo root.

The dummy values aren't valid credentials; tests that need to actually hit
Supabase (e.g. test_rls_vocab_integration, test_exercise_rls) detect their
own RLS_TEST_USER_* env vars and skip otherwise.
"""

import os
import socket

import pytest

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "test-service-key")


# Sprint 5.2 — Writing permission gate is checked on every Writing
# submit. Pre-5.2 tests in test_admin_writing.py / test_writing_student_*
# don't seed access-code rows for their fixtures, so the live lookup
# returns [] and the gate (correctly) 403s — but the regression here
# is "old tests broke", not "the gate is wrong". Default the lookup to
# the admin-override permission set so unrelated tests stay green;
# tests that exercise the gate itself patch the same symbol locally
# (the local `with patch()` wins over this autouse override).
@pytest.fixture(autouse=True)
def _writing_permission_lookup_grants_all(monkeypatch):
    monkeypatch.setattr(
        "routers.admin_writing.get_student_access_code_permissions",
        lambda _student_id: ["all"],
        raising=False,
    )
    monkeypatch.setattr(
        "routers.writing_student.get_user_access_code_permissions",
        lambda _user_id: ["all"],
        raising=False,
    )


# The unhandled-exception handler in main.py fires a background INSERT into
# error_logs on the REAL Supabase (asyncio.to_thread → supabase_admin). Every
# test that deliberately provokes a 500 — the CORS-preflight suite does exactly
# that — therefore opened a live network call, and TestClient's teardown waits
# for that task to finish. With Supabase slow (2026-07-28) the whole suite hung
# at ~16% instead of finishing in ~60s. Same class of bug as the
# sync_writing_band_for_essay hang in test_admin_writing.py: a module-level
# supabase_admin used on a side-effect path no test thinks to patch.
#
# test_cors_5xx_diagnosability.py already patched this symbol locally — its
# decorator re-patches on top of this fixture, so nothing changes there.
@pytest.fixture(autouse=True)
def _no_live_error_log_insert(monkeypatch):
    try:
        import main
        monkeypatch.setattr(main, "_insert_error_log_safely",
                            lambda payload: None, raising=True)
    except Exception:
        pass


@pytest.fixture(autouse=True)
def _reset_activate_rate_limit():
    """B4 — /auth/activate uses a module-global per-user attempt window. Reset it
    before each test so accumulated attempts don't leak across tests (many tests
    activate with the same fake user id and would otherwise trip the 429 cap)."""
    try:
        from routers import auth
        auth._activate_attempts.clear()
    except Exception:
        pass
    yield


# ── CỔNG CHO TEST TỐN TIỀN: MỘT CỜ RIÊNG, KHÔNG PHẢI BIỂU THỨC MARKER ───────
#
# `addopts = -m "not smoke"` trong pytest.ini là lớp một, nhưng nó KHÔNG đủ:
# bất kỳ `-m` nào trên dòng lệnh cũng ghi đè addopts. `pytest tests -m asyncio`
# — một câu lệnh hoàn toàn bình thường — sẽ thu lại test smoke, mà marker
# `smoke` của nó còn tự tắt luôn hai chốt chặn mạng bên dưới. Khoá cửa xong để
# chìa ngay dưới thảm (codex cục bộ 08/08 vòng 2).
#
# Hook dưới đây loại chúng ở tầng THU THẬP, độc lập hoàn toàn với `-m`. Muốn
# chạy thì phải nói ra bằng một cờ chỉ dùng cho việc ấy:
#     pytest tests/smoke --run-smoke
def pytest_addoption(parser):
    parser.addoption(
        "--run-smoke", action="store_true", default=False,
        help="Chạy cả test gọi dịch vụ ngoài và TỐN TIỀN THẬT (mặc định: bỏ).",
    )


def pytest_collection_modifyitems(config, items):
    if config.getoption("--run-smoke"):
        return
    skip = pytest.mark.skip(reason="test tốn tiền thật — thêm --run-smoke nếu cố ý")
    for item in items:
        if item.get_closest_marker("smoke"):
            item.add_marker(skip)


# ── KHÔNG TEST NÀO ĐƯỢC GỌI RA NGOÀI ────────────────────────────────────────
#
# Ngày 08/08 `tests/smoke/test_gemini_smoke.py` chạy khoảng 24 lượt trong một
# ngày — mỗi lần `pytest tests/` chạy tay và mỗi lần `git push` (hook pre-push
# cũng gọi cả bộ, kể cả push XOÁ NHÁNH). Không ai biết cho tới khi nhìn thấy bài
# văn mẫu trong log của Google.
#
# ── DỰNG NGAY LÚC IMPORT, KHÔNG PHẢI LÚC CHẠY TEST ──────────────────────────
# Bản đầu của tôi dựng chốt bằng fixture autouse — tức là chỉ có hiệu lực khi
# một test BẮT ĐẦU CHẠY. Nhưng nhiều lời gọi mạng xảy ra sớm hơn thế: import
# `main` là dựng `vocab_service`, và nó truy vấn Supabase NGAY LÚC IMPORT, tức
# là trong lúc pytest còn đang thu thập. Chốt dựng muộn nhìn không thấy gì
# (codex cục bộ 08/08 vòng 3, P1).
#
# `conftest.py` được import TRƯỚC mọi module test, nên dựng ở tầng module là
# sớm nhất có thể mà không phải viết một plugin riêng.
#
# ── VÌ SAO PHẢI CÓ CẢ CHỐT SDK ──────────────────────────────────────────────
# SDK Gemini đi bằng gRPC — thư viện C tự mở kết nối ở tầng dưới, KHÔNG đụng
# `socket.socket.connect` của Python. Tôi biết vì đã phá thử: chạy chính test
# smoke dưới chốt socket thì nó VẪN gọi tới Google và VẪN pass sau 40 giây.
_LOCAL_HOSTS = {"127.0.0.1", "::1", "localhost", ""}

_REAL_CONNECT = socket.socket.connect
_REAL_GETADDRINFO = socket.getaddrinfo


def _blocked_connect(self, address, *a, **k):
    host = address[0] if isinstance(address, tuple) else str(address)
    if host not in _LOCAL_HOSTS:
        raise RuntimeError(
            f"Test gọi ra ngoài: {host}. Bộ test phải chạy được khi rút mạng. "
            "Hãy mock lời gọi, hoặc đánh dấu @pytest.mark.smoke / "
            "@pytest.mark.livenet nếu nó CỐ Ý cần mạng."
        )
    return _REAL_CONNECT(self, address, *a, **k)


def _blocked_getaddrinfo(host, *a, **k):
    # `socket.create_connection` giải tên TRƯỚC khi connect. Chặn mỗi connect
    # thì resolver chậm hoặc đứt mạng vẫn làm bộ test TREO — đúng cảnh đã ghi
    # trong ghi chú dự án (mất mạng ⇒ treo ~16%, không phải đỏ).
    if str(host) not in _LOCAL_HOSTS:
        raise RuntimeError(
            f"Test tra tên miền ra ngoài: {host}. Bộ test phải chạy được khi rút "
            "mạng — hãy mock lời gọi, hoặc đánh dấu @pytest.mark.smoke / "
            "@pytest.mark.livenet nếu nó CỐ Ý cần mạng."
        )
    return _REAL_GETADDRINFO(host, *a, **k)


socket.socket.connect = _blocked_connect
socket.getaddrinfo = _blocked_getaddrinfo


def _may_use_network(item) -> bool:
    """Ca này có được phép ra ngoài không.

    `smoke` = cố ý tốn tiền. `livenet` = cố ý cần dịch vụ thật (Supabase/RLS,
    thăm dò sức khoẻ đường ghi) — không tốn tiền, và chúng tự bỏ qua khi thiếu
    biến môi trường, nên chặn chúng là làm hỏng một đường kiểm đã có mà chẳng
    được gì.
    """
    return any(item.get_closest_marker(m) for m in ("smoke", "livenet"))


_GEMINI_ORIG: dict = {}


def _blocked_gemini(*_a, **_k):
    raise RuntimeError(
        "Test gọi Gemini THẬT (tốn tiền). Hãy mock `generate_content` / "
        "`generate_content_async`, hoặc đánh dấu @pytest.mark.smoke."
    )


def _set_gemini(blocked: bool) -> None:
    try:
        import google.generativeai as genai
    except Exception:
        return
    for name in ("generate_content", "generate_content_async"):
        _GEMINI_ORIG.setdefault(name, getattr(genai.GenerativeModel, name, None))
        target = _blocked_gemini if blocked else _GEMINI_ORIG[name]
        if target is not None:
            setattr(genai.GenerativeModel, name, target)


# Dựng NGAY LÚC IMPORT, cùng lý do với chốt socket bên trên: một lời gọi xảy ra
# trong lúc THU THẬP thì chưa hook nào chạy, mà đường gRPC của Gemini lại là
# đường chốt socket không thấy (codex cục bộ 08/08 vòng 5).
def _set_network(blocked: bool) -> None:
    socket.socket.connect = _blocked_connect if blocked else _REAL_CONNECT
    socket.getaddrinfo = _blocked_getaddrinfo if blocked else _REAL_GETADDRINFO


_set_gemini(blocked=True)


# HOOK, không phải fixture autouse — và đó là điểm mấu chốt.
#
# Fixture autouse có phạm vi HÀM, nên nó chạy SAU những fixture phạm vi module.
# `test_stack_rls.py` đăng nhập trong fixture phạm vi module: tới lúc autouse
# kịp mở cổng thì lời gọi mạng đã bị chặn và cả bộ lỗi, dù nó mang đúng dấu
# `livenet` (codex cục bộ 08/08 vòng 4). `pytest_runtest_setup` chạy TRƯỚC mọi
# fixture của ca ấy.
def pytest_runtest_setup(item):
    # HAI quyền TÁCH RỜI, không phải một.
    #
    # `livenet` nói "tôi cần Supabase thật", không nói "tôi được phép tiêu tiền".
    # Gộp chúng làm một thì một test RLS vô tình đi qua đường chấm sẽ gọi API
    # tính tiền mà chẳng ai nêu `--run-smoke` (codex cục bộ 08/08 vòng 5).
    _set_network(blocked=not _may_use_network(item))
    _set_gemini(blocked=item.get_closest_marker("smoke") is None)


def pytest_runtest_teardown(item, nextitem):
    # Về trạng thái chặn giữa hai ca: một ca `livenet` không được để cổng mở
    # cho ca thường chạy sau nó.
    _set_network(blocked=True)
    _set_gemini(blocked=True)
