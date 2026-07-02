"""Guard: quiz progress-saving write path is healthy.

Regression cover for the incident where every POST /api/quiz/sessions/{id}/progress
returned 500 because PostgREST did not recognize the migration-119 ON CONFLICT
unique constraints (manual migration without a schema reload). quiz_sessions
inserts kept working, so sessions were created + marked 'paused' while attempts /
word_stats never persisted. `quiz_write_health` probes the exact upserts.

The probe is non-destructive (bogus FKs → the row is rejected, never written).
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest

from services.quiz_service import quiz_write_health
from database import supabase_admin


def _db_or_skip(fn):
    """Run fn(); skip (not fail) on a transient DB connectivity blip so this
    live-DB probe test doesn't flake CI on a one-off DNS/network hiccup."""
    try:
        return fn()
    except Exception as exc:  # noqa: BLE001
        if "ConnectError" in type(exc).__name__ or "nodename" in str(exc) or "Timeout" in type(exc).__name__:
            pytest.skip(f"DB unreachable (transient): {exc}")
        raise


def test_quiz_write_health_healthy_and_non_destructive():
    r = _db_or_skip(quiz_write_health)
    # shape
    assert set(r) == {"ok", "checks"}
    assert set(r["checks"]) == {"quiz_attempts.client_id", "quiz_word_stats.user_bank_item"}
    for name, c in r["checks"].items():
        assert "ok" in c and "note" in c, f"{name} missing keys: {c}"
    # Constraints from migration 119 must be recognized by PostgREST — otherwise
    # progress-saving is broken for every student (the incident).
    assert r["ok"] is True, f"ON CONFLICT constraints not usable: {r['checks']}"
    # Non-destructive: the bogus-FK probe must never leave sentinel rows behind.
    for table in ("quiz_attempts", "quiz_word_stats"):
        n = _db_or_skip(lambda t=table: (
            supabase_admin.table(t).select("id", count="exact")
            .eq("item_key", "__healthcheck__").limit(0).execute()
        ).count)
        assert n == 0, f"{table} leaked {n} sentinel rows"
