"""
Tests for the /api/dashboard/init aggregate endpoint.

Stubs Supabase with a builder-recording fake (same pattern as
test_needs_review_redefined.py / test_sessions_search.py) so the contract
holds offline.  The aggregator is intentionally self-contained — these
tests pin its key invariants:

  * happy-path payload shape (summary + sessions + recent_updates +
    flashcard_due_count) so frontend swap from /sessions/stats is safe;
  * partial-response semantics — a failure in one sub-query lands the key
    in `_errors` but doesn't blank the rest;
  * filter discipline — recent_updates excludes archived AND skipped rows;
  * chart-data ordering + completed-only constraint;
  * the service does NOT touch supabase_admin (HIGH-1 decoupling).
"""

import asyncio
import importlib
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest

from routers import dashboard as dashboard_router
from services import dashboard_aggregator


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


# ── Multi-table stub (adapted from test_needs_review_redefined.py) ──────────


class _Builder:
    def __init__(self, parent, table):
        self._parent = parent
        self._table = table
        self._predicates: list = []
        self._order_calls: list = []
        self._limit_call: int | None = None
        self._count_mode: str | None = None
        self._head: bool = False

    def select(self, *_a, count=None, head=False):
        self._count_mode = count
        self._head = bool(head)
        return self

    def eq(self, col, val):
        self._predicates.append(("eq", col, val)); return self

    def neq(self, col, val):
        self._predicates.append(("neq", col, val)); return self

    def gt(self, col, val):
        self._predicates.append(("gt", col, val)); return self

    def gte(self, col, val):
        self._predicates.append(("gte", col, val)); return self

    def lte(self, col, val):
        self._predicates.append(("lte", col, val)); return self

    def in_(self, col, vals):
        self._predicates.append(("in", col, list(vals))); return self

    def order(self, col, desc=False):
        self._order_calls.append((col, bool(desc))); return self

    def limit(self, n):
        self._limit_call = n; return self

    def execute(self):
        rows = self._parent.rows.get(self._table, [])
        out = list(rows)
        for op, col, val in self._predicates:
            if op == "eq":
                out = [r for r in out if r.get(col) == val]
            elif op == "neq":
                out = [r for r in out if r.get(col) != val]
            elif op == "gt":
                out = [r for r in out if (r.get(col) or 0) > val]
            elif op == "gte":
                out = [r for r in out if (r.get(col) or "") >= val]
            elif op == "lte":
                out = [r for r in out if (r.get(col) or "") <= val]
            elif op == "in":
                out = [r for r in out if r.get(col) in set(val)]
        for col, desc in reversed(self._order_calls):
            out.sort(
                key=lambda r: r.get(col) if r.get(col) is not None else "",
                reverse=desc,
            )
        full_count = len(out)
        if self._limit_call is not None:
            out = out[: self._limit_call]

        class _R: ...
        r = _R()
        r.data = [] if self._head else out
        r.count = full_count if self._count_mode == "exact" else None
        return r


class _Client:
    def __init__(self):
        self.rows: dict[str, list[dict]] = {}

    def table(self, name):
        return _Builder(self, name)


# ── Fixture builders ────────────────────────────────────────────────────────


def _session(session_id, *, user_id="u-1", overall_band=7.0,
             status="completed",
             started_at=None, topic="Travel", part=1, mode="practice"):
    return {
        "id": session_id,
        "user_id": user_id,
        "started_at": started_at or _today_iso(),
        "mode": mode,
        "part": part,
        "topic": topic,
        "band_fc":  6.5,
        "band_lr":  7.0,
        "band_gra": 7.0,
        "band_p":   7.5,
        "overall_band": overall_band,
        "status": status,
    }


def _vocab(vocab_id, *, user_id="u-1", session_id=None,
           is_archived=False, is_skipped=False,
           source_type="used_well", created_at=None):
    return {
        "id": vocab_id,
        "user_id": user_id,
        "headword": f"word-{vocab_id}",
        "source_type": source_type,
        "session_id": session_id,
        "is_archived": is_archived,
        "is_skipped": is_skipped,
        "created_at": created_at or _today_iso(),
    }


def _review(*, user_id="u-1", next_review_at=None):
    return {
        "user_id": user_id,
        "id": f"rev-{next_review_at}",
        "next_review_at": next_review_at or _today_iso(),
    }


def _today_iso():
    return datetime.now(timezone.utc).isoformat()


def _days_ago_iso(n):
    return (datetime.now(timezone.utc) - timedelta(days=n)).isoformat()


# ── Happy path ──────────────────────────────────────────────────────────────


def test_returns_complete_payload_shape():
    """summary, sessions, recent_updates, flashcard_due_count all present."""
    c = _Client()
    c.rows["sessions"] = [
        _session("s1", started_at=_days_ago_iso(0)),
        _session("s2", started_at=_days_ago_iso(1)),
    ]
    c.rows["user_vocabulary"] = [
        _vocab("v1", session_id="s1"),
        _vocab("v2", session_id="s1"),
    ]
    c.rows["flashcard_reviews"] = [
        _review(next_review_at=_days_ago_iso(0)),
        _review(next_review_at=_days_ago_iso(1)),
    ]
    payload = dashboard_aggregator.get_dashboard_payload(c, "u-1")

    assert set(payload.keys()) >= {
        "summary", "sessions", "recent_updates", "flashcard_due_count",
    }
    assert "_errors" not in payload  # nothing failed
    assert payload["summary"]["total_sessions"] == 2
    assert len(payload["sessions"]) == 2
    assert payload["sessions"][0]["id"] == "s1"  # most recent first
    assert payload["recent_updates"][0]["vocab_count"] == 2
    assert payload["flashcard_due_count"] == 2


# ── Partial response ────────────────────────────────────────────────────────


def test_partial_response_on_subquery_failure(monkeypatch):
    """If one sub-builder raises, others still populate + _errors lands."""
    c = _Client()
    c.rows["sessions"] = [_session("s1")]
    c.rows["user_vocabulary"] = [_vocab("v1")]
    c.rows["flashcard_reviews"] = [_review(next_review_at=_today_iso())]

    def _boom(*_a, **_k):
        raise RuntimeError("simulated outage")

    monkeypatch.setattr(
        dashboard_aggregator, "_build_recent_vocab_updates", _boom
    )
    payload = dashboard_aggregator.get_dashboard_payload(c, "u-1")

    assert payload["summary"] is not None  # stats still built
    assert payload["flashcard_due_count"] is not None
    assert payload["recent_updates"] is None  # the failing one
    assert "recent_updates" in payload["_errors"]
    assert "simulated outage" in payload["_errors"]["recent_updates"]


def test_subquery_error_message_truncated(monkeypatch):
    """Long exception strings don't dump verbatim into the JSON response."""
    long = "x" * 5000

    def _boom(*_a, **_k):
        raise RuntimeError(long)

    monkeypatch.setattr(
        dashboard_aggregator, "_build_flashcard_due_count", _boom
    )
    c = _Client()
    payload = dashboard_aggregator.get_dashboard_payload(c, "u-1")
    assert len(payload["_errors"]["flashcard_due_count"]) <= 200


# ── Empty state ─────────────────────────────────────────────────────────────


def test_empty_state_for_new_user():
    """Fresh user with zero rows everywhere → defaults, no errors."""
    c = _Client()  # no rows
    payload = dashboard_aggregator.get_dashboard_payload(c, "u-new")

    assert "_errors" not in payload
    assert payload["summary"]["total_sessions"] == 0
    assert payload["summary"]["avg_band_30d"] is None
    assert payload["summary"]["current_streak"] == 0
    assert payload["summary"]["last_session_at"] is None
    assert payload["sessions"] == []
    assert payload["recent_updates"] == []
    assert payload["flashcard_due_count"] == 0


# ── Filter discipline (recent_updates) ──────────────────────────────────────


def test_recent_updates_excludes_skipped():
    c = _Client()
    c.rows["user_vocabulary"] = [
        _vocab("v-keep"),
        _vocab("v-skip", is_skipped=True),
    ]
    payload = dashboard_aggregator.get_dashboard_payload(c, "u-1")
    seen = {
        h
        for ev in payload["recent_updates"]
        for h in ev["vocab_preview"]
    }
    assert "word-v-keep" in seen
    assert "word-v-skip" not in seen


def test_recent_updates_excludes_archived():
    c = _Client()
    c.rows["user_vocabulary"] = [
        _vocab("v-keep"),
        _vocab("v-arch", is_archived=True),
    ]
    payload = dashboard_aggregator.get_dashboard_payload(c, "u-1")
    seen = {
        h
        for ev in payload["recent_updates"]
        for h in ev["vocab_preview"]
    }
    assert "word-v-keep" in seen
    assert "word-v-arch" not in seen


# ── Chart-data invariants ───────────────────────────────────────────────────


def test_chart_data_completed_only_and_recent_first():
    """sessions list filters status='completed' and orders by started_at desc."""
    c = _Client()
    c.rows["sessions"] = [
        _session("s-old",     started_at=_days_ago_iso(10)),
        _session("s-mid",     started_at=_days_ago_iso(2)),
        _session("s-new",     started_at=_days_ago_iso(0)),
        _session("s-pending", started_at=_days_ago_iso(0), status="pending"),
    ]
    payload = dashboard_aggregator.get_dashboard_payload(c, "u-1")
    ids = [s["id"] for s in payload["sessions"]]
    assert ids == ["s-new", "s-mid", "s-old"]  # pending excluded
    assert all(s["status"] == "completed" for s in payload["sessions"])


def test_chart_data_respects_limit():
    c = _Client()
    c.rows["sessions"] = [
        _session(f"s{i}", started_at=_days_ago_iso(i)) for i in range(30)
    ]
    payload = dashboard_aggregator.get_dashboard_payload(
        c, "u-1", chart_limit=20,
    )
    assert len(payload["sessions"]) == 20
    assert payload["summary"]["total_sessions"] == 30


# ── HIGH-1 decoupling ───────────────────────────────────────────────────────


_ADMIN_IMPORT_RE = re.compile(
    r"^\s*from\s+\S+\s+import\s+[^\n#]*supabase_admin", re.MULTILINE,
)
_ADMIN_USE_RE = re.compile(r"\bsupabase_admin\s*\.")


def _admin_used(src: str) -> bool:
    return bool(_ADMIN_IMPORT_RE.search(src) or _ADMIN_USE_RE.search(src))


def test_aggregator_does_not_use_supabase_admin():
    """Regression-pin: HIGH-1 decoupling rule.  The aggregator service must
    remain JWT-scoped — no transitive supabase_admin import or call.  If a
    future refactor pulls in a helper that uses supabase_admin, this test
    surfaces it before it ships.  (Module docstring is allowed to mention
    the term to explain the rule itself.)"""
    importlib.reload(dashboard_aggregator)
    src = Path(dashboard_aggregator.__file__).read_text()
    assert not _admin_used(src), (
        "services/dashboard_aggregator.py must not import or call "
        "supabase_admin (HIGH-1 decoupling rule — aggregator is "
        "JWT-scoped only)"
    )


def test_router_does_not_use_supabase_admin():
    """Same rule for the route handler."""
    src = Path(dashboard_router.__file__).read_text()
    assert not _admin_used(src), (
        "routers/dashboard.py must not import or call supabase_admin "
        "(HIGH-1 decoupling rule)"
    )
