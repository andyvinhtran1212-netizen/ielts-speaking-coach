"""
Tests for services/rate_limit.enforce_exercise_rate_limit.

We stub count_attempts_today so the test runs without DB.  The contract is
small but matters: under the limit → no-op, at/over the limit → HTTPException
429 with a machine-readable detail payload, non-positive limit → 503
'feature_disabled' (so a misconfigured env var fails closed instead of meaning
'unlimited').

Run: pytest backend/tests/test_rate_limit.py -v
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from fastapi import HTTPException

from services import rate_limit


def _stub_counter(monkeypatch, value: int) -> None:
    monkeypatch.setattr(rate_limit, "count_attempts_today", lambda *a, **k: value)


# ── Under the limit ───────────────────────────────────────────────────────────


def test_no_attempts_passes(monkeypatch):
    _stub_counter(monkeypatch, 0)
    rate_limit.enforce_exercise_rate_limit("u-1", "D1", daily_limit=3)


def test_just_under_limit_passes(monkeypatch):
    _stub_counter(monkeypatch, 2)
    rate_limit.enforce_exercise_rate_limit("u-1", "D3", daily_limit=3)


# ── At / over the limit ───────────────────────────────────────────────────────


def test_at_limit_blocks(monkeypatch):
    _stub_counter(monkeypatch, 3)
    with pytest.raises(HTTPException) as exc:
        rate_limit.enforce_exercise_rate_limit("u-1", "D3", daily_limit=3)
    assert exc.value.status_code == 429
    detail = exc.value.detail
    assert detail["error"] == "rate_limit_exceeded"
    assert detail["limit"] == 3
    assert detail["used"] == 3
    assert detail["exercise_type"] == "D3"
    assert "reset_at" in detail and detail["reset_at"]


def test_over_limit_blocks(monkeypatch):
    _stub_counter(monkeypatch, 99)
    with pytest.raises(HTTPException) as exc:
        rate_limit.enforce_exercise_rate_limit("u-1", "D3", daily_limit=3)
    assert exc.value.status_code == 429


# ── Misconfigured limit ───────────────────────────────────────────────────────


def test_zero_limit_fails_closed(monkeypatch):
    _stub_counter(monkeypatch, 0)
    with pytest.raises(HTTPException) as exc:
        rate_limit.enforce_exercise_rate_limit("u-1", "D3", daily_limit=0)
    assert exc.value.status_code == 503
    assert exc.value.detail["error"] == "feature_disabled"


def test_negative_limit_fails_closed(monkeypatch):
    _stub_counter(monkeypatch, 0)
    with pytest.raises(HTTPException) as exc:
        rate_limit.enforce_exercise_rate_limit("u-1", "D3", daily_limit=-5)
    assert exc.value.status_code == 503


# ── Day boundary helpers ──────────────────────────────────────────────────────


def test_reset_at_is_next_utc_midnight(monkeypatch):
    _stub_counter(monkeypatch, 3)
    with pytest.raises(HTTPException) as exc:
        rate_limit.enforce_exercise_rate_limit("u-1", "D3", daily_limit=3)
    reset = exc.value.detail["reset_at"]
    # ISO format ends with +00:00 (UTC) and the time is 00:00:00.
    assert "T00:00:00" in reset
    assert reset.endswith("+00:00")


def test_count_lookup_failure_does_not_raise(monkeypatch):
    """A DB error during the lookup must NOT block legitimate users."""
    def boom(*a, **k):
        raise RuntimeError("simulated outage")
    monkeypatch.setattr(
        rate_limit, "supabase_admin",
        type("S", (), {"table": staticmethod(lambda *_: (_ for _ in ()).throw(boom))})()
    )
    # The wrapped count_attempts_today should swallow the error and return 0.
    assert rate_limit.count_attempts_today("u-1", "D3") == 0
