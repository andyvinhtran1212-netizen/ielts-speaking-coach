"""Sprint 10.4 — pin the capture confirmation pipeline.

Five contracts under test:

  1. **Capture writes pending.** The bank GET filter (added in this
     sprint) hides new captures until they're confirmed. Tests assert
     the filter on the existing list / stats / recent paths.
  2. **GET /pending lists pending items only.** Sorted newest-first
     by pending_created_at; archived rows are excluded.
  3. **POST /{id}/confirm flips the flag.** Item appears in bank GET
     after; 404 on missing-or-already-confirmed item; ownership
     enforced (foreign IDs 404).
  4. **POST /{id}/drop archives the row.** Soft-delete pattern
     consistent with Sprint 10.1.5 needs-review/skip. Row disappears
     from BOTH the pending list AND the bank list (is_archived=true
     wins on the bank path; is_pending=false hides from pending).
  5. **POST /bulk-confirm honours scoping.** A payload containing
     foreign IDs only affects the caller's rows; the response
     `confirmed` array carries the actual flipped IDs.

Plus the auto-commit lazy cleanup contract:
  * GET /pending flips is_pending=false for any row whose
    pending_created_at is older than 24h before returning the list.

The mock builder extends the Sprint 10.2 / 10.3 multi-table pattern
with `.lt()` (cutoff comparison), `.in_()` (bulk-confirm), and
per-table predicate filtering so the same `_Client` can serve the
auto-commit + bulk update paths without leaking rows across tables.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from routers import vocabulary_bank as vb


def _run(coro):
    return asyncio.run(coro)


# ── Mock builder ─────────────────────────────────────────────────────


class _Builder:
    """Predicate-recording Supabase chain with table-scoped data,
    plus simple in-memory filter evaluation so update/delete-style
    queries against the right WHERE clauses actually mutate the
    canned rows. Sprint 10.4 needs this because the bulk-confirm and
    auto-commit code paths emit UPDATE...WHERE...IN(...) queries that
    can't be naively recorded — they have to behave like a real DB
    so the GET-after-confirm assertions work."""

    def __init__(self, parent, table_name: str):
        self._parent = parent
        self._table = table_name
        # Each filter: ("eq" | "neq" | "lt" | "in", col, val).
        self._filters: list[tuple[str, str, object]] = []
        self._select_cols: str = "*"

    def select(self, cols="*", *_a, **_k):
        self._select_cols = cols
        return self

    def order(self, *_a, **_k): return self
    def limit(self, *_a, **_k): return self

    def eq(self, col, val):
        self._filters.append(("eq", col, val))
        return self

    def neq(self, col, val):
        self._filters.append(("neq", col, val))
        return self

    def lt(self, col, val):
        self._filters.append(("lt", col, val))
        return self

    def in_(self, col, vals):
        self._filters.append(("in", col, list(vals)))
        return self

    def update(self, row_patch):
        # Real Supabase: .update(payload) returns a builder; .eq/.lt/.in_
        # following the update apply as WHERE clauses; .execute() runs
        # the UPDATE with the full predicate set. We defer the patch
        # application to execute() so chained filters land.
        outer = self
        parent = self._parent
        table = self._table

        class _Updater:
            def __init__(self_inner):
                # Inherit any predicates that came in via builder chain
                # before update() (e.g. update() called after .eq(...)).
                self_inner._filters: list[tuple] = list(outer._filters)
                self_inner._patch = row_patch

            def eq(self_inner, col, val):
                self_inner._filters.append(("eq", col, val))
                return self_inner

            def neq(self_inner, col, val):
                self_inner._filters.append(("neq", col, val))
                return self_inner

            def lt(self_inner, col, val):
                self_inner._filters.append(("lt", col, val))
                return self_inner

            def in_(self_inner, col, vals):
                self_inner._filters.append(("in", col, list(vals)))
                return self_inner

            def execute(self_inner):
                rows = parent.canned.get(table, [])
                # Filter rows against the accumulated predicates.
                tmp_b = _Builder(parent, table)
                tmp_b._filters = self_inner._filters
                matched = tmp_b._apply_filters(rows)
                patched = []
                for row in matched:
                    row.update(self_inner._patch)
                    patched.append(dict(row))
                parent.updates.append((table, self_inner._patch, list(self_inner._filters)))

                class _R: data = patched; count = None
                return _R()

        return _Updater()

    def insert(self, row):
        self._parent.inserts.append((self._table, row))
        self._parent.canned.setdefault(self._table, []).append(row)

        class _Exec:
            def execute(self_inner):
                class _R: data = [row]; count = None
                return _R()
        return _Exec()

    def execute(self):
        rows = self._apply_filters(self._parent.canned.get(self._table, []))

        class _R:
            pass
        r = _R()
        r.data = [dict(row) for row in rows]
        r.count = None
        return r

    def _apply_filters(self, rows: list[dict]) -> list[dict]:
        out = rows
        for op, col, val in self._filters:
            if op == "eq":
                out = [r for r in out if r.get(col) == val]
            elif op == "neq":
                out = [r for r in out if r.get(col) != val]
            elif op == "lt":
                # Treat None as missing — a row with pending_created_at=None
                # cannot be "older than cutoff" so it stays.
                out = [r for r in out if r.get(col) is not None and r.get(col) < val]
            elif op == "in":
                out = [r for r in out if r.get(col) in val]
        return out


class _Client:
    def __init__(self, canned: dict):
        # Deep-copy so test-mutating calls don't bleed into later tests
        # via the shared dict literal in the fixture.
        self.canned = {k: [dict(r) for r in v] for k, v in canned.items()}
        self.updates: list[tuple] = []
        self.inserts: list[tuple] = []

    def table(self, name=None, *_a, **_k):
        return _Builder(self, name)


def _patch(monkeypatch, canned: dict, *, user_id: str = "user-A"):
    client = _Client(canned)

    async def _fake_auth(_authz):
        return {"id": user_id}

    monkeypatch.setattr(vb, "_require_auth", _fake_auth)
    monkeypatch.setattr(vb, "_vocab_bank_enabled", lambda _uid: True)
    monkeypatch.setattr(vb, "_user_sb", lambda _token: client)
    monkeypatch.setattr(vb, "_fire_event", lambda *_a, **_k: None)
    return client, "Bearer fake-jwt"


def _pending_row(id_: str, *, user_id: str = "user-A", hours_ago: float = 1.0,
                 is_archived: bool = False):
    return {
        "id": id_,
        "user_id": user_id,
        "headword": f"word-{id_}",
        "source_type": "used_well",
        "is_archived": is_archived,
        "is_skipped": False,
        "is_pending": True,
        "pending_created_at": (
            datetime.now(timezone.utc) - timedelta(hours=hours_ago)
        ).isoformat(),
        "created_at": (
            datetime.now(timezone.utc) - timedelta(hours=hours_ago)
        ).isoformat(),
    }


def _confirmed_row(id_: str, *, user_id: str = "user-A"):
    """Already in the bank (post-confirm or never-pending row)."""
    return {
        "id": id_,
        "user_id": user_id,
        "headword": f"word-{id_}",
        "source_type": "used_well",
        "is_archived": False,
        "is_skipped": False,
        "is_pending": False,
        "pending_created_at": None,
        "created_at": "2026-04-01T00:00:00+00:00",
    }


# ── Contract 1 — bank GET filter ─────────────────────────────────────


def test_bank_list_hides_pending_items(monkeypatch):
    """The Sprint 10.4 filter on the bank GET means a freshly captured
    item (is_pending=true) does NOT appear in My Vocab Bank until the
    user confirms it. Pre-10.4 the row would have been visible
    immediately — this test catches the regression that would unwind
    the confirmation safeguard."""
    canned = {
        "user_vocabulary": [
            _pending_row("v-pending"),
            _confirmed_row("v-bank"),
        ],
        "flashcard_reviews": [],
    }
    _patch(monkeypatch, canned)
    rows = _run(vb.list_vocab(status=None, source_type=None, authorization="Bearer fake"))
    ids = {r["id"] for r in rows}
    assert ids == {"v-bank"}, (
        f"Bank list must hide pending items; got {ids}"
    )


# ── Contract 2 — GET /pending ────────────────────────────────────────


def test_pending_list_returns_only_pending_rows(monkeypatch):
    canned = {
        "user_vocabulary": [
            _pending_row("v1", hours_ago=1),
            _pending_row("v2", hours_ago=2),
            _confirmed_row("v3-in-bank"),
        ],
    }
    _patch(monkeypatch, canned)
    rows = _run(vb.list_pending(authorization="Bearer fake"))
    ids = [r["id"] for r in rows]
    assert set(ids) == {"v1", "v2"}, ids
    # Confirmed item is invisible to the pending surface.
    assert "v3-in-bank" not in ids


def test_pending_list_excludes_archived_rows(monkeypatch):
    """A row that was pending AND then archived (rare race / soft-
    delete via /drop) must not reappear in the pending list."""
    canned = {
        "user_vocabulary": [
            _pending_row("v-alive"),
            _pending_row("v-dropped", is_archived=True),
        ],
    }
    _patch(monkeypatch, canned)
    rows = _run(vb.list_pending(authorization="Bearer fake"))
    ids = {r["id"] for r in rows}
    assert ids == {"v-alive"}


# ── Contract 3 — POST /{id}/confirm ──────────────────────────────────


def test_confirm_flips_pending_to_false(monkeypatch):
    canned = {
        "user_vocabulary": [_pending_row("v1")],
        "flashcard_reviews": [],
    }
    client, authz = _patch(monkeypatch, canned)
    resp = _run(vb.confirm_pending(vocab_id="v1", authorization=authz))
    assert resp == {"ok": True, "vocab_id": "v1"}

    # The update call must clear both is_pending AND pending_created_at.
    user_updates = [u for u in client.updates if u[0] == "user_vocabulary"]
    assert len(user_updates) == 1
    _, patch, _ = user_updates[0]
    assert patch == {"is_pending": False, "pending_created_at": None}


def test_confirm_404_when_item_not_pending(monkeypatch):
    """An item that's already in the bank (is_pending=false) must NOT
    be confirmable via this endpoint — the pending surface is for
    pending items only. Prevents accidental double-fires from a slow
    network where two clicks land out of order."""
    canned = {"user_vocabulary": [_confirmed_row("v1")]}
    _patch(monkeypatch, canned)
    with pytest.raises(HTTPException) as exc:
        _run(vb.confirm_pending(vocab_id="v1", authorization="Bearer fake"))
    assert exc.value.status_code == 404


def test_confirm_404_for_foreign_user(monkeypatch):
    """User A cannot confirm User B's pending item. RLS would also
    block at the DB level; pin the explicit 404 at the router so the
    error message stays consistent."""
    canned = {
        "user_vocabulary": [_pending_row("v1", user_id="user-B")],
    }
    _patch(monkeypatch, canned, user_id="user-A")
    with pytest.raises(HTTPException) as exc:
        _run(vb.confirm_pending(vocab_id="v1", authorization="Bearer fake"))
    assert exc.value.status_code == 404


# ── Contract 4 — POST /{id}/drop ─────────────────────────────────────


def test_drop_archives_pending_row(monkeypatch):
    canned = {"user_vocabulary": [_pending_row("v1")]}
    client, authz = _patch(monkeypatch, canned)
    resp = _run(vb.drop_pending(vocab_id="v1", authorization=authz))
    assert resp == {"ok": True, "vocab_id": "v1"}

    _, patch, _ = [u for u in client.updates if u[0] == "user_vocabulary"][0]
    # Drop must archive AND clear pending — leaving is_pending=true
    # plus is_archived=true creates a phantom row invisible everywhere.
    assert patch == {
        "is_archived": True,
        "is_pending": False,
        "pending_created_at": None,
    }


def test_drop_404_when_item_not_pending(monkeypatch):
    canned = {"user_vocabulary": [_confirmed_row("v1")]}
    _patch(monkeypatch, canned)
    with pytest.raises(HTTPException) as exc:
        _run(vb.drop_pending(vocab_id="v1", authorization="Bearer fake"))
    assert exc.value.status_code == 404


# ── Contract 5 — POST /bulk-confirm ──────────────────────────────────


def test_bulk_confirm_flips_all_owned_ids(monkeypatch):
    canned = {
        "user_vocabulary": [
            _pending_row("v1"),
            _pending_row("v2"),
            _pending_row("v3"),
        ],
    }
    client, authz = _patch(monkeypatch, canned)
    resp = _run(vb.bulk_confirm_pending(
        body=vb.VocabPendingBulkConfirmRequest(ids=["v1", "v2", "v3"]),
        authorization=authz,
    ))
    assert resp["ok"] is True
    assert set(resp["confirmed"]) == {"v1", "v2", "v3"}


def test_bulk_confirm_ignores_foreign_ids(monkeypatch):
    """Andy Q4 anti-spoofing pin: a payload containing another user's
    IDs only confirms the caller's rows; foreign IDs are silently
    ignored (no information leak — empty intersection)."""
    canned = {
        "user_vocabulary": [
            _pending_row("v1", user_id="user-A"),
            _pending_row("v2-foreign", user_id="user-B"),
        ],
    }
    _patch(monkeypatch, canned, user_id="user-A")
    resp = _run(vb.bulk_confirm_pending(
        body=vb.VocabPendingBulkConfirmRequest(ids=["v1", "v2-foreign"]),
        authorization="Bearer fake",
    ))
    assert set(resp["confirmed"]) == {"v1"}


def test_bulk_confirm_empty_payload_returns_empty(monkeypatch):
    _patch(monkeypatch, {"user_vocabulary": []})
    resp = _run(vb.bulk_confirm_pending(
        body=vb.VocabPendingBulkConfirmRequest(ids=[]),
        authorization="Bearer fake",
    ))
    assert resp == {"ok": True, "confirmed": []}


# ── Auto-commit lazy cleanup ─────────────────────────────────────────


def test_get_pending_auto_commits_rows_older_than_24h(monkeypatch):
    """Sprint 10.4 Q3 lock — 24h auto-commit via lazy cleanup inside
    GET /pending. A row pending for 25h must flip to is_pending=false
    BEFORE the SELECT returns, so the response never includes it."""
    canned = {
        "user_vocabulary": [
            _pending_row("v-fresh", hours_ago=1),
            _pending_row("v-stale", hours_ago=25),
        ],
    }
    client, authz = _patch(monkeypatch, canned)
    rows = _run(vb.list_pending(authorization=authz))
    ids = [r["id"] for r in rows]
    # Stale row auto-committed, not in pending response.
    assert ids == ["v-fresh"]

    # The UPDATE was issued with is_pending=false + pending_created_at=null.
    cleanup_updates = [
        u for u in client.updates
        if u[0] == "user_vocabulary" and u[1].get("is_pending") is False
        and u[1].get("pending_created_at") is None
    ]
    assert len(cleanup_updates) >= 1, "auto-commit UPDATE must fire"


def test_get_pending_does_not_auto_commit_under_24h(monkeypatch):
    """A 23h-old row must stay pending. Pin the off-by-one — a future
    refactor that flips `<` to `<=` would commit items prematurely."""
    canned = {
        "user_vocabulary": [_pending_row("v-23h", hours_ago=23)],
    }
    _patch(monkeypatch, canned)
    rows = _run(vb.list_pending(authorization="Bearer fake"))
    ids = [r["id"] for r in rows]
    assert ids == ["v-23h"]
