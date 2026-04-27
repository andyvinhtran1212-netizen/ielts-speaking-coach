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


# ── Decorator: rate_limit_exercise ────────────────────────────────────────────
#
# The decorator extracts authorization from kwargs, resolves user_id via
# routers.auth.get_supabase_user, then enforces the limit.  We stub the auth
# resolver and the counter so these tests don't touch network or DB.

import asyncio

import pytest as _pytest


def _stub_auth(monkeypatch, user_id: str = "u-1") -> None:
    """Patch routers.auth.get_supabase_user to return a fake auth user."""
    async def _fake_auth(_authorization):
        return {"id": user_id}
    import routers.auth
    monkeypatch.setattr(routers.auth, "get_supabase_user", _fake_auth)


def test_decorator_passes_under_limit(monkeypatch):
    _stub_auth(monkeypatch)
    _stub_counter(monkeypatch, 49)

    @rate_limit.rate_limit_exercise(exercise_type="D1", daily_limit=50)
    async def handler(authorization: str | None = None):
        return "ok"

    result = asyncio.run(handler(authorization="Bearer x"))
    assert result == "ok"


def test_decorator_blocks_at_limit(monkeypatch):
    """50/50 → 429 with machine-readable detail."""
    _stub_auth(monkeypatch)
    _stub_counter(monkeypatch, 50)

    @rate_limit.rate_limit_exercise(exercise_type="D1", daily_limit=50)
    async def handler(authorization: str | None = None):
        return "ok"

    with _pytest.raises(HTTPException) as exc:
        asyncio.run(handler(authorization="Bearer x"))
    assert exc.value.status_code == 429
    detail = exc.value.detail
    assert detail["error"] == "rate_limit_exceeded"
    assert detail["limit"] == 50
    assert detail["exercise_type"] == "D1"


def test_decorator_blocks_when_spam_exceeds_limit(monkeypatch):
    """Audit-style probe: simulate the 51st D1 submit by stubbing count=51."""
    _stub_auth(monkeypatch)
    _stub_counter(monkeypatch, 51)

    @rate_limit.rate_limit_exercise(exercise_type="D1", daily_limit=50)
    async def handler(authorization: str | None = None):
        return "ok"

    with _pytest.raises(HTTPException) as exc:
        asyncio.run(handler(authorization="Bearer x"))
    assert exc.value.status_code == 429


def test_decorator_d1_and_d3_limits_are_independent(monkeypatch):
    """A D1 attempt count must NOT leak into the D3 limit, and vice versa.
    The counter helper filters by (user_id, exercise_type) — verify the
    decorator passes that filter through correctly."""
    _stub_auth(monkeypatch)

    seen: list[tuple[str, str]] = []

    def _spy_count(user_id: str, exercise_type: str) -> int:
        seen.append((user_id, exercise_type))
        # Simulate: D1 has 49 attempts (under limit 50), D3 has 4 (over limit 3).
        return 49 if exercise_type == "D1" else 4

    monkeypatch.setattr(rate_limit, "count_attempts_today", _spy_count)

    @rate_limit.rate_limit_exercise(exercise_type="D1", daily_limit=50)
    async def d1_handler(authorization: str | None = None):
        return "d1-ok"

    @rate_limit.rate_limit_exercise(exercise_type="D3", daily_limit=3)
    async def d3_handler(authorization: str | None = None):
        return "d3-ok"

    # D1 49/50 → passes
    assert asyncio.run(d1_handler(authorization="Bearer x")) == "d1-ok"
    # D3 4/3   → blocks
    with _pytest.raises(HTTPException) as exc:
        asyncio.run(d3_handler(authorization="Bearer x"))
    assert exc.value.status_code == 429
    assert exc.value.detail["exercise_type"] == "D3"

    # The counter was called once per handler with the right exercise_type —
    # proves the limits are tracked independently per type.
    assert ("u-1", "D1") in seen
    assert ("u-1", "D3") in seen


def test_decorator_preserves_route_signature(monkeypatch):
    """FastAPI introspects __signature__ — the wrapper must mirror it so that
    path/header/body params still get injected by the framework."""
    @rate_limit.rate_limit_exercise(exercise_type="D1", daily_limit=50)
    async def handler(exercise_id: str, authorization: str | None = None):
        return exercise_id

    sig = handler.__signature__
    assert "exercise_id"   in sig.parameters
    assert "authorization" in sig.parameters


# ── Phase D Wave 2: flashcard rate limit ─────────────────────────────────────
#
# Flashcards count from a different table (flashcard_review_log) so they need
# a parallel test path.  count_flashcard_reviews_today is the helper the
# decorator uses; we stub it directly here just like _stub_counter above.


def _stub_flashcard_counter(monkeypatch, value: int) -> None:
    monkeypatch.setattr(rate_limit, "count_flashcard_reviews_today", lambda *a, **k: value)


def test_flashcard_under_limit_passes(monkeypatch):
    _stub_flashcard_counter(monkeypatch, 0)
    rate_limit.enforce_flashcard_rate_limit("u-1", daily_limit=500)


def test_flashcard_review_rate_limit_500(monkeypatch):
    """501 reviews in one UTC day → 429 with machine-readable detail."""
    _stub_flashcard_counter(monkeypatch, 501)
    with _pytest.raises(HTTPException) as exc:
        rate_limit.enforce_flashcard_rate_limit("u-1", daily_limit=500)
    assert exc.value.status_code == 429
    detail = exc.value.detail
    assert detail["error"] == "rate_limit_exceeded"
    assert detail["exercise_type"] == "FLASHCARD"
    assert detail["limit"] == 500
    assert detail["used"] == 501


def test_flashcard_zero_limit_fails_closed(monkeypatch):
    _stub_flashcard_counter(monkeypatch, 0)
    with _pytest.raises(HTTPException) as exc:
        rate_limit.enforce_flashcard_rate_limit("u-1", daily_limit=0)
    assert exc.value.status_code == 503
    assert exc.value.detail["error"] == "feature_disabled"


def test_flashcard_decorator_blocks_at_limit(monkeypatch):
    _stub_auth(monkeypatch)
    _stub_flashcard_counter(monkeypatch, 500)

    @rate_limit.rate_limit_flashcard(daily_limit=500)
    async def handler(authorization: str | None = None):
        return "ok"

    with _pytest.raises(HTTPException) as exc:
        asyncio.run(handler(authorization="Bearer x"))
    assert exc.value.status_code == 429
    assert exc.value.detail["exercise_type"] == "FLASHCARD"


def test_flashcard_decorator_passes_under_limit(monkeypatch):
    _stub_auth(monkeypatch)
    _stub_flashcard_counter(monkeypatch, 499)

    @rate_limit.rate_limit_flashcard(daily_limit=500)
    async def handler(authorization: str | None = None):
        return "ok"

    assert asyncio.run(handler(authorization="Bearer x")) == "ok"
