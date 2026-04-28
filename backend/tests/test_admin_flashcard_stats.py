"""
Tests for GET /admin/flashcards/stats and its four aggregator helpers.

Pattern mirrors tests/test_health.py: the helpers are pure given a stubbed
`supabase_admin`, so we monkeypatch `routers.admin.supabase_admin` to a
fake client that returns canned data per table.

The route handler itself is tested by patching `require_admin` to either
let through or raise 403 — that decouples the auth path from the
aggregation logic.
"""

import asyncio
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from fastapi import HTTPException

from routers import admin as admin_module


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def _today_iso() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def _yesterday_iso() -> str:
    return (datetime.now(timezone.utc).date() - timedelta(days=1)).isoformat()


# ── Stub Supabase client ─────────────────────────────────────────────────────


class _StubBuilder:
    """Chainable PostgREST-shaped builder that resolves to a canned payload.

    `responses` is keyed by the table name passed to .table(); each entry is
    a tuple (data, count) returned from .execute().  We accept (and ignore)
    every chainable call (.select, .gte, .in_, .limit) so tests don't have
    to mirror PostgREST's full surface.
    """

    def __init__(self, table: str, responses: dict):
        self._table = table
        self._responses = responses

    def select(self, *_a, **_k): return self
    def gte(self, *_a, **_k): return self
    def in_(self, *_a, **_k): return self
    def limit(self, *_a, **_k): return self

    def execute(self):
        data, count = self._responses.get(self._table, ([], 0))

        class _R:
            pass
        r = _R()
        r.data = list(data) if data else []
        r.count = count
        return r


class _StubClient:
    def __init__(self, responses: dict):
        self._responses = responses

    def table(self, name: str):
        return _StubBuilder(name, self._responses)


def _install_stub(monkeypatch, responses: dict) -> None:
    monkeypatch.setattr(admin_module, "supabase_admin", _StubClient(responses))


# ── Auth: admin-only ─────────────────────────────────────────────────────────


def test_admin_only_access(monkeypatch):
    """require_admin raising 403 must propagate; the aggregators must not run."""
    async def _deny(_authz):
        raise HTTPException(403, "Bạn không có quyền truy cập trang này")

    monkeypatch.setattr(admin_module, "require_admin", _deny)
    # Stub responses unset on purpose: if any helper runs, it would crash.
    _install_stub(monkeypatch, {})

    with pytest.raises(HTTPException) as exc_info:
        _run(admin_module.admin_flashcard_stats(days=30, authorization="Bearer x"))
    assert exc_info.value.status_code == 403


def _allow_admin(monkeypatch):
    async def _ok(_authz):
        return {"id": "admin-uuid"}

    monkeypatch.setattr(admin_module, "require_admin", _ok)


# ── Full structure ───────────────────────────────────────────────────────────


def test_returns_full_stats_structure(monkeypatch):
    _allow_admin(monkeypatch)
    _install_stub(monkeypatch, {
        "flashcard_stacks":     ([], 5),
        "flashcard_cards":      ([], 42),
        "flashcard_reviews": (
            [
                {"user_id": "u1", "review_count": 10, "ease_factor": 2.5, "interval_days": 35, "lapse_count": 0},
                {"user_id": "u2", "review_count":  4, "ease_factor": 2.0, "interval_days":  3, "lapse_count": 1},
                {"user_id": "u1", "review_count":  6, "ease_factor": 2.5, "interval_days":  1, "lapse_count": 0},
            ],
            None,
        ),
        "flashcard_review_log": (
            [
                {"user_id": "u1", "vocabulary_id": "v1", "rating": "good",  "reviewed_at": _today_iso() + "T10:00:00+00:00"},
                {"user_id": "u1", "vocabulary_id": "v1", "rating": "easy",  "reviewed_at": _today_iso() + "T11:00:00+00:00"},
                {"user_id": "u2", "vocabulary_id": "v2", "rating": "again", "reviewed_at": _today_iso() + "T12:00:00+00:00"},
                {"user_id": "u2", "vocabulary_id": "v3", "rating": "hard",  "reviewed_at": _today_iso() + "T13:00:00+00:00"},
            ],
            None,
        ),
        "user_vocabulary": (
            [{"id": "v1", "headword": "mitigate"}, {"id": "v2", "headword": "elucidate"}, {"id": "v3", "headword": "obfuscate"}],
            None,
        ),
    })

    out = _run(admin_module.admin_flashcard_stats(days=30, authorization="Bearer x"))

    assert set(out["stats"].keys()) == {"activity", "srs_health", "engagement", "timeseries"}
    assert out["period_days"] == 30
    assert out["computed_at"]

    activity = out["stats"]["activity"]
    assert activity["total_manual_stacks"] == 5
    assert activity["total_cards_in_manual_stacks"] == 42
    assert activity["total_active_users"] == 2  # u1 + u2
    assert activity["total_reviews_all_time"] == 20  # 10+4+6


def test_handles_empty_data(monkeypatch):
    """No flashcard data anywhere → every aggregator returns zeros without raising."""
    _allow_admin(monkeypatch)
    _install_stub(monkeypatch, {
        "flashcard_stacks":     ([], 0),
        "flashcard_cards":      ([], 0),
        "flashcard_reviews":    ([], None),
        "flashcard_review_log": ([], None),
        "user_vocabulary":      ([], None),
    })

    out = _run(admin_module.admin_flashcard_stats(days=30, authorization="Bearer x"))

    assert out["stats"]["activity"]["total_active_users"] == 0
    assert out["stats"]["activity"]["total_reviews_all_time"] == 0
    assert out["stats"]["srs_health"]["rating_total_count"] == 0
    assert out["stats"]["srs_health"]["avg_ease_factor"] == 0.0
    assert out["stats"]["srs_health"]["cards_mastered_30plus_days"] == 0
    assert out["stats"]["srs_health"]["cards_with_lapses"] == 0
    assert out["stats"]["engagement"]["top_reviewed_words"] == []
    # All four buckets present and zero.
    assert out["stats"]["srs_health"]["rating_distribution_percent"] == {
        "again": 0.0, "hard": 0.0, "good": 0.0, "easy": 0.0,
    }


# ── Rating distribution ──────────────────────────────────────────────────────


def test_rating_distribution_sums_to_100(monkeypatch):
    """Even when individual rounding causes drift (e.g. 3 evenly-split items
    each rounding to 33.3%), the helper must absorb the residual into the
    largest bucket so the four percentages sum to exactly 100.0."""
    _allow_admin(monkeypatch)
    # 3 ratings — each individually = 33.333%, sum of round-to-1dp = 99.9.
    _install_stub(monkeypatch, {
        "flashcard_reviews":    ([], None),
        "flashcard_review_log": (
            [
                {"rating": "again", "reviewed_at": _today_iso() + "T01:00:00+00:00"},
                {"rating": "good",  "reviewed_at": _today_iso() + "T02:00:00+00:00"},
                {"rating": "easy",  "reviewed_at": _today_iso() + "T03:00:00+00:00"},
            ],
            None,
        ),
    })
    health = admin_module._fc_compute_srs_health(
        (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    )

    rd = health["rating_distribution_percent"]
    assert set(rd.keys()) == {"again", "hard", "good", "easy"}
    total = round(sum(rd.values()), 1)
    assert total == 100.0, f"distribution sums to {total}, not 100.0: {rd}"


# ── Timeseries: missing-day fill ─────────────────────────────────────────────


def test_timeseries_fills_missing_days(monkeypatch):
    """A 7-day window with reviews only on today and 3 days ago must still
    return 8 entries (today + previous 7), with `reviews=0` on quiet days."""
    _allow_admin(monkeypatch)
    today = datetime.now(timezone.utc).date()
    three_days_ago = (today - timedelta(days=3)).isoformat()
    today_str = today.isoformat()

    _install_stub(monkeypatch, {
        "flashcard_review_log": (
            [
                {"reviewed_at": today_str + "T10:00:00+00:00"},
                {"reviewed_at": today_str + "T11:00:00+00:00"},
                {"reviewed_at": three_days_ago + "T08:00:00+00:00"},
            ],
            None,
        ),
    })

    series = admin_module._fc_compute_reviews_timeseries(days=7)
    # `range(days, -1, -1)` yields days+1 entries (inclusive of both ends).
    assert len(series) == 8
    by_date = {d["date"]: d["reviews"] for d in series}
    assert by_date[today_str] == 2
    assert by_date[three_days_ago] == 1
    # At least one of the other days must be 0 (proves missing-day fill).
    quiet_days = [d for d, n in by_date.items()
                  if d not in (today_str, three_days_ago)]
    assert quiet_days, "expected quiet days in the window"
    assert all(by_date[d] == 0 for d in quiet_days)


# ── Period-days param ────────────────────────────────────────────────────────


def test_period_days_flows_into_cutoff(monkeypatch):
    """?days=7 must produce a cutoff_iso roughly 7 days before now and feed
    it into the engagement helper.  We capture the cutoff via the gte() call
    on flashcard_review_log.

    This pins a regression where the route handler computed `days=30`
    statically regardless of the query param.
    """
    _allow_admin(monkeypatch)

    captured = {"cutoff_iso": None}

    class _CapturingBuilder(_StubBuilder):
        def gte(self, _col, value):
            if self._table == "flashcard_review_log":
                captured["cutoff_iso"] = value
            return self

    class _CapturingClient(_StubClient):
        def table(self, name):
            return _CapturingBuilder(name, self._responses)

    monkeypatch.setattr(admin_module, "supabase_admin", _CapturingClient({
        "flashcard_stacks":     ([], 0),
        "flashcard_cards":      ([], 0),
        "flashcard_reviews":    ([], None),
        "flashcard_review_log": ([], None),
        "user_vocabulary":      ([], None),
    }))

    out = _run(admin_module.admin_flashcard_stats(days=7, authorization="Bearer x"))
    assert out["period_days"] == 7

    assert captured["cutoff_iso"] is not None, "expected a gte('reviewed_at', cutoff) call"
    cutoff_dt = datetime.fromisoformat(captured["cutoff_iso"])
    delta = datetime.now(timezone.utc) - cutoff_dt
    # ~7 days, allowing a generous fudge factor for clock + asyncio dispatch.
    assert timedelta(days=6, hours=23) < delta < timedelta(days=7, hours=1), (
        f"cutoff was {delta} ago, expected ~7 days"
    )
