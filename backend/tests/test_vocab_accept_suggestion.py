"""
Tests for POST /api/vocabulary/bank/{id}/accept.

Day 2 dogfood added a one-click promote flow for `upgrade_suggested`
entries.  PR #24 (post-#23 polish) extended it: a single call now
promotes source_type → 'manual' AND enrols the row into the default
manual stack "Từ vựng đã chấp nhận", auto-creating that stack on first
use.  Stack/card writes are best-effort — a failure does not reverse
the promote.

These tests exercise the handler against a multi-table stub Supabase
client so we cover both the promote path and the new flashcard path
without standing up a real DB.
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from fastapi import HTTPException

from routers import vocabulary_bank as vb


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


# ── Multi-table Supabase stub ────────────────────────────────────────────────
#
# The handler queries 3 tables and writes to 2 (user_vocabulary, plus
# flashcard_stacks/flashcard_cards on the new path).  The stub records
# every insert/update so each test can assert on the exact write set.


class _StubBuilder:
    def __init__(self, parent, table):
        self._parent = parent
        self._table = table
        self._mode = None  # 'select' | 'insert' | 'update'
        self._payload = None

    def select(self, *_a, **_k):
        self._mode = "select"
        return self

    def insert(self, payload):
        self._mode = "insert"
        self._payload = dict(payload) if isinstance(payload, dict) else payload
        return self

    def update(self, payload):
        self._mode = "update"
        self._payload = dict(payload)
        return self

    def eq(self, *_a, **_k):     return self
    def limit(self, *_a, **_k):  return self

    def execute(self):
        class _R: pass
        r = _R()
        if self._mode == "insert":
            self._parent.inserts.setdefault(self._table, []).append(self._payload)
            # Some inserts (flashcard_stacks) need to echo back an id so the
            # handler can use it; flashcard_cards inserts only need ack.
            if self._table == "flashcard_stacks":
                stack_id = self._parent.next_stack_id
                self._parent.next_stack_id = f"stack-{int(stack_id.split('-')[-1]) + 1}" \
                    if stack_id.startswith("stack-") else "stack-2"
                r.data = [{"id": stack_id, **self._payload}]
                # Reflect the new stack into the lookup pool so subsequent
                # SELECTs find it (test_idempotent_second_accept_reuses_stack).
                self._parent.rows.setdefault("flashcard_stacks", []).append({"id": stack_id, **self._payload})
            else:
                r.data = [self._payload]
            return r

        if self._mode == "update":
            self._parent.updates.setdefault(self._table, []).append(self._payload)
            r.data = []
            return r

        # SELECT
        if self._parent.select_failures.get(self._table):
            raise RuntimeError(self._parent.select_failures[self._table])
        r.data = list(self._parent.rows.get(self._table, []))
        return r


class _StubClient:
    def __init__(self):
        self.rows: dict[str, list[dict]] = {}
        self.inserts: dict[str, list] = {}
        self.updates: dict[str, list] = {}
        self.select_failures: dict[str, str] = {}
        self.next_stack_id = "stack-1"

    def table(self, name):
        return _StubBuilder(self, name)


def _patch(monkeypatch, *,
           source_type="upgrade_suggested",
           user_owns=True,
           flag_enabled=True,
           existing_stack_id: str | None = None,
           card_already_present: bool = False):
    client = _StubClient()
    if user_owns:
        client.rows["user_vocabulary"] = [
            {"id": "vocab-1", "source_type": source_type}
        ]
    if existing_stack_id is not None:
        client.rows["flashcard_stacks"] = [
            {"id": existing_stack_id, "name": vb.DEFAULT_ACCEPT_STACK_NAME}
        ]
    if card_already_present:
        client.rows["flashcard_cards"] = [
            {"id": "card-1", "stack_id": existing_stack_id, "vocabulary_id": "vocab-1"}
        ]

    async def _fake_auth(_authz):
        return {"id": "user-uuid-accept"}

    monkeypatch.setattr(vb, "_require_auth", _fake_auth)
    monkeypatch.setattr(vb, "_vocab_bank_enabled", lambda _uid: flag_enabled)
    monkeypatch.setattr(vb, "_user_sb", lambda _token: client)
    monkeypatch.setattr(vb, "_fire_event", lambda *_a, **_k: None)
    return client, "Bearer fake-jwt"


# ── Promote-only path (legacy + add_to_default_stack=False) ──────────────────


def test_accept_promotes_upgrade_suggested_to_manual(monkeypatch):
    """Default call: promote + create stack + add card."""
    client, authz = _patch(monkeypatch, source_type="upgrade_suggested")
    res = _run(vb.accept_suggestion(vocab_id="vocab-1", authorization=authz))
    assert res["ok"] is True
    assert res["source_type"] == "manual"
    assert res["promoted"] is True
    # Promote write happened.
    assert {"source_type": "manual"} in client.updates.get("user_vocabulary", [])


def test_accept_skips_flashcard_when_param_false(monkeypatch):
    """add_to_default_stack=False → only promote, no stack/card writes."""
    client, authz = _patch(monkeypatch, source_type="upgrade_suggested")
    res = _run(vb.accept_suggestion(
        vocab_id="vocab-1", add_to_default_stack=False, authorization=authz,
    ))
    assert res["promoted"] is True
    assert res["flashcard_added"] is False
    assert res["stack_id"] is None
    assert res["stack_name"] is None
    assert "flashcard_stacks" not in client.inserts
    assert "flashcard_cards" not in client.inserts


def test_accept_idempotent_for_already_manual(monkeypatch):
    """Accept on an already-promoted row still adds to default stack
    (idempotent retry surface) but does not re-write source_type."""
    client, authz = _patch(monkeypatch, source_type="manual")
    res = _run(vb.accept_suggestion(vocab_id="vocab-1", authorization=authz))
    assert res["source_type"] == "manual"
    assert res["promoted"] is False
    assert "user_vocabulary" not in client.updates


def test_accept_rejects_ai_verdict_sources(monkeypatch):
    """`used_well` / `needs_review` are AI verdicts; reject with 409."""
    for src in ("used_well", "needs_review"):
        _, authz = _patch(monkeypatch, source_type=src)
        with pytest.raises(HTTPException) as exc:
            _run(vb.accept_suggestion(vocab_id="vocab-1", authorization=authz))
        assert exc.value.status_code == 409


def test_accept_404_when_row_missing_or_not_owned(monkeypatch):
    _, authz = _patch(monkeypatch, user_owns=False)
    with pytest.raises(HTTPException) as exc:
        _run(vb.accept_suggestion(vocab_id="vocab-missing", authorization=authz))
    assert exc.value.status_code == 404


def test_accept_403_when_feature_flag_off(monkeypatch):
    _, authz = _patch(monkeypatch, flag_enabled=False)
    with pytest.raises(HTTPException) as exc:
        _run(vb.accept_suggestion(vocab_id="vocab-1", authorization=authz))
    assert exc.value.status_code == 403


# ── Default-stack creation + reuse ───────────────────────────────────────────


def test_accept_creates_default_stack_on_first_call(monkeypatch):
    """No existing stack → handler inserts one with the canonical name."""
    client, authz = _patch(monkeypatch, source_type="upgrade_suggested")
    res = _run(vb.accept_suggestion(vocab_id="vocab-1", authorization=authz))
    assert res["flashcard_added"] is True
    assert res["stack_name"] == vb.DEFAULT_ACCEPT_STACK_NAME
    inserted_stacks = client.inserts.get("flashcard_stacks", [])
    assert len(inserted_stacks) == 1
    assert inserted_stacks[0]["name"] == vb.DEFAULT_ACCEPT_STACK_NAME
    assert inserted_stacks[0]["type"] == "manual"
    # Card was inserted into the stack.
    assert len(client.inserts.get("flashcard_cards", [])) == 1


def test_accept_reuses_existing_default_stack(monkeypatch):
    """Existing stack with the canonical name → reuse, do not insert."""
    client, authz = _patch(
        monkeypatch,
        source_type="upgrade_suggested",
        existing_stack_id="stack-existing",
    )
    res = _run(vb.accept_suggestion(vocab_id="vocab-1", authorization=authz))
    assert res["stack_id"] == "stack-existing"
    assert res["flashcard_added"] is True
    assert "flashcard_stacks" not in client.inserts
    assert len(client.inserts.get("flashcard_cards", [])) == 1


def test_accept_skips_duplicate_card(monkeypatch):
    """Card already in stack → flashcard_added=True (idempotent), no insert."""
    client, authz = _patch(
        monkeypatch,
        source_type="upgrade_suggested",
        existing_stack_id="stack-existing",
        card_already_present=True,
    )
    res = _run(vb.accept_suggestion(vocab_id="vocab-1", authorization=authz))
    assert res["flashcard_added"] is True
    assert "flashcard_cards" not in client.inserts


def test_accept_promotes_even_if_stack_lookup_fails(monkeypatch):
    """Lookup error on flashcard_stacks → promote still succeeds, partial result."""
    client, authz = _patch(monkeypatch, source_type="upgrade_suggested")
    client.select_failures["flashcard_stacks"] = "boom"
    res = _run(vb.accept_suggestion(vocab_id="vocab-1", authorization=authz))
    assert res["promoted"] is True
    assert res["source_type"] == "manual"
    assert res["flashcard_added"] is False
    assert res["stack_id"] is None
    # Promote write happened.
    assert {"source_type": "manual"} in client.updates.get("user_vocabulary", [])
