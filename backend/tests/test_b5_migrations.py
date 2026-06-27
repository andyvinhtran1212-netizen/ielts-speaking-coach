"""B5 part 2 — grading rate-limit (Mục 5) + atomic token increment (Mục 15)."""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

_MIG = Path(__file__).parent.parent / "migrations"

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


# ── Migration hardening (PR #596 review) ──────────────────────────────


def test_grading_attempts_enables_rls():
    """PR #596 review (P1): the quota log is backend-only. It MUST enable RLS (no
    policy) so anon/authenticated Supabase clients can't read others' activity or
    forge quota rows; service_role (backend) bypasses RLS."""
    sql = (_MIG / "114_grading_attempts.sql").read_text(encoding="utf-8")
    assert re.search(
        r"ALTER\s+TABLE\s+(public\.)?grading_attempts\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY",
        sql, re.IGNORECASE,
    ), "grading_attempts must ENABLE ROW LEVEL SECURITY"
    assert "CREATE POLICY" not in sql.upper(), \
        "no client-facing policy — service_role bypass only (deny anon/authenticated)"


def test_increment_session_tokens_pins_search_path():
    """The RPC pins search_path (matches the function hardening in migration 108)."""
    sql = (_MIG / "113_increment_session_tokens_rpc.sql").read_text(encoding="utf-8")
    assert re.search(r"SET\s+search_path\s*=\s*public", sql, re.IGNORECASE)
