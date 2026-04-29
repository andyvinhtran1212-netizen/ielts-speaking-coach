"""
Tests for POST /api/vocabulary/bank/{id}/mark-fixed.

Wave 2 Day 1 dogfood: the auto-stack "Cần ôn tập" used to study `needs_review`
vocab directly. The new triage view promotes vocab to `manual` only after the
user has fixed the underlying grammar/usage and clicks "Đã sửa".

Endpoint mirrors POST /accept but gates on source_type='needs_review' instead
of 'upgrade_suggested', so the two flows share the same default stack and the
same idempotency story.
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


# ── Reuse the multi-table stub pattern from test_vocab_accept_suggestion ────


class _StubBuilder:
    def __init__(self, parent, table):
        self._parent = parent
        self._table = table
        self._mode = None
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
            if self._table == "flashcard_stacks":
                stack_id = self._parent.next_stack_id
                self._parent.next_stack_id = "stack-2"
                r.data = [{"id": stack_id, **self._payload}]
                self._parent.rows.setdefault("flashcard_stacks", []).append(
                    {"id": stack_id, **self._payload}
                )
            else:
                r.data = [self._payload]
            return r

        if self._mode == "update":
            self._parent.updates.setdefault(self._table, []).append(self._payload)
            r.data = []
            return r

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
           source_type="needs_review",
           user_owns=True,
           flag_enabled=True,
           existing_stack_id: str | None = None):
    client = _StubClient()
    if user_owns:
        client.rows["user_vocabulary"] = [
            {"id": "vocab-nr", "source_type": source_type}
        ]
    if existing_stack_id is not None:
        client.rows["flashcard_stacks"] = [
            {"id": existing_stack_id, "name": vb.DEFAULT_ACCEPT_STACK_NAME}
        ]

    async def _fake_auth(_authz):
        return {"id": "user-uuid-mark-fixed"}

    monkeypatch.setattr(vb, "_require_auth", _fake_auth)
    monkeypatch.setattr(vb, "_vocab_bank_enabled", lambda _uid: flag_enabled)
    monkeypatch.setattr(vb, "_user_sb", lambda _token: client)
    monkeypatch.setattr(vb, "_fire_event", lambda *_a, **_k: None)
    return client, "Bearer fake-jwt"


# ── Happy path ──────────────────────────────────────────────────────────────


def test_mark_fixed_promotes_needs_review_to_manual(monkeypatch):
    client, authz = _patch(monkeypatch, source_type="needs_review")
    res = _run(vb.mark_vocab_fixed(vocab_id="vocab-nr", authorization=authz))
    assert res["ok"] is True
    assert res["source_type"] == "manual"
    assert res["promoted"] is True
    assert {"source_type": "manual"} in client.updates.get("user_vocabulary", [])


def test_mark_fixed_creates_default_stack_on_first_call(monkeypatch):
    """No existing stack → handler inserts the canonical accept stack and adds the card."""
    client, authz = _patch(monkeypatch, source_type="needs_review")
    res = _run(vb.mark_vocab_fixed(vocab_id="vocab-nr", authorization=authz))
    assert res["flashcard_added"] is True
    assert res["stack_name"] == vb.DEFAULT_ACCEPT_STACK_NAME
    inserted_stacks = client.inserts.get("flashcard_stacks", [])
    assert len(inserted_stacks) == 1
    assert inserted_stacks[0]["name"] == vb.DEFAULT_ACCEPT_STACK_NAME
    assert len(client.inserts.get("flashcard_cards", [])) == 1


def test_mark_fixed_reuses_existing_default_stack(monkeypatch):
    """When the same default stack exists from a prior /accept call, reuse it."""
    client, authz = _patch(
        monkeypatch,
        source_type="needs_review",
        existing_stack_id="stack-shared",
    )
    res = _run(vb.mark_vocab_fixed(vocab_id="vocab-nr", authorization=authz))
    assert res["stack_id"] == "stack-shared"
    assert "flashcard_stacks" not in client.inserts
    assert len(client.inserts.get("flashcard_cards", [])) == 1


# ── Skip-flashcard / idempotency / failure paths ────────────────────────────


def test_mark_fixed_skips_flashcard_when_param_false(monkeypatch):
    client, authz = _patch(monkeypatch, source_type="needs_review")
    res = _run(vb.mark_vocab_fixed(
        vocab_id="vocab-nr", add_to_default_stack=False, authorization=authz,
    ))
    assert res["promoted"] is True
    assert res["flashcard_added"] is False
    assert res["stack_id"] is None
    assert "flashcard_stacks" not in client.inserts


def test_mark_fixed_idempotent_for_already_manual(monkeypatch):
    """Already-promoted row: no second source_type write, but flashcard add still attempted."""
    client, authz = _patch(monkeypatch, source_type="manual")
    res = _run(vb.mark_vocab_fixed(vocab_id="vocab-nr", authorization=authz))
    assert res["source_type"] == "manual"
    assert res["promoted"] is False
    assert "user_vocabulary" not in client.updates


def test_mark_fixed_promotes_even_if_stack_lookup_fails(monkeypatch):
    """Lookup error on flashcard_stacks → promote still succeeds, partial result."""
    client, authz = _patch(monkeypatch, source_type="needs_review")
    client.select_failures["flashcard_stacks"] = "boom"
    res = _run(vb.mark_vocab_fixed(vocab_id="vocab-nr", authorization=authz))
    assert res["promoted"] is True
    assert res["flashcard_added"] is False
    assert res["stack_id"] is None


# ── Source-type gate ────────────────────────────────────────────────────────


@pytest.mark.parametrize("src", ["used_well", "upgrade_suggested"])
def test_mark_fixed_rejects_other_source_types(monkeypatch, src):
    """Only `needs_review` (and idempotent `manual`) promotes here."""
    _, authz = _patch(monkeypatch, source_type=src)
    with pytest.raises(HTTPException) as exc:
        _run(vb.mark_vocab_fixed(vocab_id="vocab-nr", authorization=authz))
    assert exc.value.status_code == 409


def test_mark_fixed_404_when_row_missing(monkeypatch):
    _, authz = _patch(monkeypatch, user_owns=False)
    with pytest.raises(HTTPException) as exc:
        _run(vb.mark_vocab_fixed(vocab_id="vocab-missing", authorization=authz))
    assert exc.value.status_code == 404


def test_mark_fixed_403_when_feature_flag_off(monkeypatch):
    _, authz = _patch(monkeypatch, flag_enabled=False)
    with pytest.raises(HTTPException) as exc:
        _run(vb.mark_vocab_fixed(vocab_id="vocab-nr", authorization=authz))
    assert exc.value.status_code == 403
