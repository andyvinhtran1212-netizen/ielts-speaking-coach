"""B5 part 2 — grading rate-limit (Mục 5) + atomic token increment (Mục 15)."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from fastapi import HTTPException

from services import rate_limit
from routers import grading


# ── Mục 5 — grading rate limit ────────────────────────────────────────


def test_enforce_grading_under_limit_passes(monkeypatch):
    monkeypatch.setattr(rate_limit, "count_gradings_today", lambda _u: 5)
    rate_limit.enforce_grading_rate_limit("u1", 200)   # must not raise


def test_enforce_grading_at_limit_raises_429(monkeypatch):
    monkeypatch.setattr(rate_limit, "count_gradings_today", lambda _u: 200)
    with pytest.raises(HTTPException) as ei:
        rate_limit.enforce_grading_rate_limit("u1", 200)
    assert ei.value.status_code == 429
    assert ei.value.detail["exercise_type"] == "GRADING"


def test_enforce_grading_nonpositive_limit_disables_cap(monkeypatch):
    counted = []
    monkeypatch.setattr(rate_limit, "count_gradings_today",
                        lambda _u: counted.append(1) or 9999)
    rate_limit.enforce_grading_rate_limit("u1", 0)     # disabled → no raise
    assert not counted, "must short-circuit before counting when limit <= 0"


def test_count_gradings_fails_open(monkeypatch):
    class _Boom:
        def table(self, *_a, **_k):
            raise RuntimeError("db unreachable")
    monkeypatch.setattr(rate_limit, "supabase_admin", _Boom())
    assert rate_limit.count_gradings_today("u1") == 0   # never block on a lookup error


# ── Mục 15 — atomic token increment via RPC ───────────────────────────


def test_increment_tokens_uses_atomic_rpc(monkeypatch):
    seen = {}

    class _RpcStub:
        def rpc(self, name, params):
            seen["name"] = name
            seen["params"] = params
            return self
        def execute(self):
            return None

    monkeypatch.setattr(grading, "supabase_admin", _RpcStub())
    grading._increment_tokens("sess-1", "a question", "a transcript", {"overall_band": 6})

    assert seen["name"] == "increment_session_tokens"
    assert seen["params"]["p_session_id"] == "sess-1"
    assert seen["params"]["p_delta"] > 0
