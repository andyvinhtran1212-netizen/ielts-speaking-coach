"""
Tests for routers/health.

Direct async-function calls against the route handlers — same pattern as
tests/test_d1_e2e.py.  We mock `database.supabase_admin` to simulate
DB up / DB down / migrations missing without needing a real Supabase
connection.

Coverage:
- /health is unconditional ok with timestamp + version.
- /health/ready returns ok with all checks passing when DB + migrations +
  Gemini key are healthy.
- /health/ready returns degraded when DB query throws.
- /health/ready returns degraded when GEMINI_API_KEY is empty.
- /health/ready feature_flags block reflects current settings values.
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest

from routers import health as health_module


def _run(coro):
    """Run an async coroutine to completion.

    A fresh event loop per call avoids the cross-test pollution that
    happens when a sibling test's TestClient closes the shared loop.
    """
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


# ── /health ──────────────────────────────────────────────────────────────────


def test_health_basic_returns_ok():
    """GET /health is unconditional — no DB, no env probes."""
    out = _run(health_module.health_basic())
    assert out["status"] == "ok"
    assert "timestamp" in out and out["timestamp"]
    assert "version" in out


# ── /health/ready ────────────────────────────────────────────────────────────


class _OkBuilder:
    """A chainable PostgREST builder stub that always succeeds."""
    def select(self, *_a, **_k): return self
    def limit(self, *_a, **_k): return self
    def execute(self, *_a, **_k):
        class _R:
            data, count = [], 0
        return _R()


class _OkClient:
    def table(self, *_a, **_k):
        return _OkBuilder()


class _FailingClient:
    """Raises on every .table() call — simulates DB unreachable."""
    def table(self, *_a, **_k):
        raise RuntimeError("simulated supabase outage")


def test_health_ready_all_ok(monkeypatch):
    """Healthy DB + Gemini key set → status ok, every check ok."""
    monkeypatch.setattr(health_module, "supabase_admin", _OkClient())
    monkeypatch.setattr(health_module.settings, "GEMINI_API_KEY", "fake-key")

    out = _run(health_module.health_ready())
    assert out["status"] == "ok"
    assert out["checks"]["database"]["status"] == "ok"
    assert out["checks"]["migrations"]["status"] == "ok"
    # All critical tables are listed in the verified array.
    assert set(out["checks"]["migrations"]["verified"]) == set(health_module._CRITICAL_TABLES)
    assert out["checks"]["gemini_api"]["status"] == "ok"
    assert out["checks"]["feature_flags"]["status"] == "ok"


def test_health_ready_degrades_on_db_failure(monkeypatch):
    """When supabase_admin raises, both DB and migrations checks fail and
    overall status drops to degraded — but the endpoint still returns 200
    so external probes can distinguish "down" from "degraded"."""
    monkeypatch.setattr(health_module, "supabase_admin", _FailingClient())
    monkeypatch.setattr(health_module.settings, "GEMINI_API_KEY", "fake-key")

    out = _run(health_module.health_ready())
    assert out["status"] == "degraded"
    assert out["checks"]["database"]["status"] == "fail"
    assert "error" in out["checks"]["database"]
    assert out["checks"]["migrations"]["status"] == "fail"
    assert out["checks"]["migrations"]["missing"], "missing list should be populated"


def test_health_ready_flags_missing_gemini_key(monkeypatch):
    """Missing GEMINI_API_KEY → status degraded but DB still reads ok."""
    monkeypatch.setattr(health_module, "supabase_admin", _OkClient())
    monkeypatch.setattr(health_module.settings, "GEMINI_API_KEY", "")

    out = _run(health_module.health_ready())
    assert out["status"] == "degraded"
    assert out["checks"]["database"]["status"] == "ok"
    assert out["checks"]["gemini_api"]["status"] == "missing_key"


def test_health_ready_exposes_feature_flag_state(monkeypatch):
    """The feature_flags block mirrors current settings (booleans only —
    never secrets), so a single curl confirms whether dogfood flags are on."""
    monkeypatch.setattr(health_module, "supabase_admin", _OkClient())
    monkeypatch.setattr(health_module.settings, "GEMINI_API_KEY", "fake-key")
    monkeypatch.setattr(health_module.settings, "VOCAB_BANK_FEATURE_FLAG_ENABLED", True)
    monkeypatch.setattr(health_module.settings, "D1_ENABLED", True)
    monkeypatch.setattr(health_module.settings, "D3_ENABLED", False)
    monkeypatch.setattr(health_module.settings, "FLASHCARD_ENABLED", True)

    flags = _run(health_module.health_ready())["checks"]["feature_flags"]
    assert flags["vocab_bank_enabled"] is True
    assert flags["d1_enabled"] is True
    assert flags["d3_enabled"] is False
    assert flags["flashcard_enabled"] is True
