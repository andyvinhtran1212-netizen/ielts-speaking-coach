"""P0-5 / C-1.3 — internal exception detail must NOT leak to the client.

Covers the safe_error/safe_detail helpers + the central HTTPException handler in
main.py (which sanitizes every 5xx). Real values: assert the leaked string is
absent from the response and the safe {error_code,message,ref} dict is present.
"""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

from fastapi import HTTPException
from starlette.requests import Request

sys.path.insert(0, str(Path(__file__).parent.parent))

from services.errors import safe_error, safe_detail, GENERIC_MESSAGE


def _req():
    return Request({"type": "http", "method": "POST", "path": "/x",
                    "query_string": b"", "headers": [],
                    "state": {"request_id": "testref123"}})


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


# ── helpers (pure, real values) ──────────────────────────────────────────────

def test_safe_error_detail_is_safe_dict_no_exc_text():
    exc = KeyError("SUPABASE_SERVICE_KEY")
    he = safe_error(exc, error_code="quota_check_failed", context="POST /sessions")
    assert he.status_code == 500
    assert he.detail["error_code"] == "quota_check_failed"
    assert he.detail["message"] == GENERIC_MESSAGE
    assert he.detail["ref"] and len(he.detail["ref"]) >= 6
    assert "SUPABASE_SERVICE_KEY" not in json.dumps(he.detail)   # no leak


def test_safe_detail_sanitizes_5xx_string():
    out = safe_detail(500, "Lỗi khi tải sessions: KeyError('SECRET')")
    assert out["error_code"] == "internal_error"
    assert "SECRET" not in json.dumps(out)
    assert "ref" in out


def test_safe_detail_passes_through_4xx():
    assert safe_detail(404, "session không tồn tại") == "session không tồn tại"
    assert safe_detail(403, "Forbidden") == "Forbidden"


def test_safe_detail_passes_through_structured_5xx():
    d = {"error_code": "response_persist_failed", "message": "Lỗi lưu", "ref": "x"}
    assert safe_detail(500, d) is d   # already safe → untouched


# ── the REAL central handler in main.py ──────────────────────────────────────

def test_http_handler_sanitizes_5xx_leak():
    import main
    resp = _run(main.http_exception_handler(
        _req(), HTTPException(500, "Không thể tạo session: ValueError('db d>>SECRET<<')")))
    assert resp.status_code == 500
    raw = resp.body.decode()
    assert "SECRET" not in raw, "5xx exception text leaked to the client"
    body = json.loads(raw)
    assert body["detail"]["error_code"] == "internal_error"
    assert body["detail"]["ref"]


def test_http_handler_preserves_4xx_message():
    import main
    resp = _run(main.http_exception_handler(_req(), HTTPException(404, "Không tìm thấy")))
    assert resp.status_code == 404
    assert json.loads(resp.body)["detail"] == "Không tìm thấy"   # intentional 4xx kept


def test_http_handler_keeps_structured_5xx():
    import main
    d = {"error_code": "response_persist_failed", "message": "Lỗi lưu phản hồi", "ref": "r1"}
    resp = _run(main.http_exception_handler(_req(), HTTPException(500, d)))
    assert json.loads(resp.body)["detail"]["error_code"] == "response_persist_failed"


def test_unhandled_handler_no_longer_leaks_exc_string():
    # static guard — the old `f"Internal server error: {exc}"` leak is gone.
    src = (Path(__file__).parent.parent / "main.py").read_text(encoding="utf-8")
    assert 'f"Internal server error: {exc}"' not in src
    assert "@app.exception_handler(StarletteHTTPException)" in src
    assert "safe_detail(" in src
