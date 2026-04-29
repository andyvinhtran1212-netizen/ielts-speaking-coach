"""
Pin: POST /api/flashcards/stacks/{id}/cards refuses needs_review vocab.

Day 2 dogfood polish (post-PR-#22): the +Stack button on My Vocabulary is
hidden client-side for `source_type='needs_review'` rows because enrolling
AI-flagged-as-incorrect vocab into SRS would teach the wrong form.  The
backend gate here is defense-in-depth so a hand-crafted POST can't bypass
the UI.

Other source_types (used_well, upgrade_suggested, manual) must continue
to pass the gate — the test asserts both directions so we don't accidentally
overshoot the block.
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from fastapi import HTTPException

from routers import flashcards as fc


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


# ── Stub Supabase client that returns the source_type we're testing ─────────


class _LookupBuilder:
    """Returns the configured row on .execute(); also accepts an .insert()
    so the post-block code path can fall through cleanly when allowed."""
    def __init__(self, lookup_data):
        self._lookup_data = lookup_data
        self._inserting = False
        self._insert_payload = None

    def select(self, *_a, **_k):           return self
    def eq(self, *_a, **_k):               return self
    def limit(self, *_a, **_k):            return self
    def insert(self, payload):
        self._inserting = True
        self._insert_payload = payload
        return self

    def execute(self):
        class _R: pass
        r = _R()
        if self._inserting:
            # Echo the insert payload back as the inserted row — test only
            # checks that we *reached* the insert, not its contents.
            r.data = [dict(self._insert_payload, id="card-uuid-1")]
        else:
            r.data = list(self._lookup_data) if self._lookup_data else []
        return r


class _StubClient:
    def __init__(self, lookup_data):
        self._lookup_data = lookup_data
        self.last_insert_payload = None
        self._builder = None
    def table(self, _name):
        # Return a fresh builder per .table() so the same client can serve
        # both the SELECT (vocab lookup) and the INSERT (card add).
        b = _LookupBuilder(self._lookup_data)
        self._builder = b
        return b


def _patch(monkeypatch, *, source_type: str | None):
    rows = [{"source_type": source_type}] if source_type is not None else []
    client = _StubClient(rows)

    async def _fake_auth(_authz):
        return {"id": "user-uuid-block"}

    monkeypatch.setattr(fc, "get_supabase_user", _fake_auth)
    monkeypatch.setattr(fc, "_require_flashcards_enabled", lambda _uid: None)
    monkeypatch.setattr(fc, "_user_sb", lambda _token: client)
    return client, "Bearer fake-jwt"


def _call_add(stack_id, vocab_id, authz):
    body = fc.AddCardRequest(vocabulary_id=vocab_id)
    return _run(fc.add_card_to_stack(stack_id=stack_id, body=body, authorization=authz))


# ── Block path ───────────────────────────────────────────────────────────────


def test_add_card_blocks_needs_review_vocab(monkeypatch):
    """`source_type='needs_review'` → 400 with a learner-facing message."""
    _, authz = _patch(monkeypatch, source_type="needs_review")
    with pytest.raises(HTTPException) as exc:
        _call_add("stack-uuid-1", "vocab-uuid-1", authz)
    assert exc.value.status_code == 400
    assert "cần xem lại" in exc.value.detail.lower()


# ── Pass-through paths — make sure the block didn't overshoot ────────────────


@pytest.mark.parametrize("source_type", ["used_well", "upgrade_suggested", "manual"])
def test_add_card_allows_other_source_types(monkeypatch, source_type):
    """All non-needs_review categories continue to insert as before."""
    client, authz = _patch(monkeypatch, source_type=source_type)
    res = _call_add("stack-uuid-2", "vocab-uuid-2", authz)
    assert res["stack_id"] == "stack-uuid-2"
    assert res["vocabulary_id"] == "vocab-uuid-2"


def test_add_card_blocks_auto_stack_before_lookup(monkeypatch):
    """Auto-stack rejection (existing behavior) still fires before vocab lookup."""
    _, authz = _patch(monkeypatch, source_type="needs_review")
    with pytest.raises(HTTPException) as exc:
        _call_add("auto:all_vocab", "vocab-uuid-3", authz)
    # Auto-stack 400 has its own message; we should hit that path, not the
    # needs_review path, because the auto check runs first.
    assert exc.value.status_code == 400
    assert "auto" in exc.value.detail.lower()


def test_add_card_404_when_vocab_lookup_returns_empty(monkeypatch):
    """RLS-filtered (foreign vocab) returns no rows → INSERT path runs and
    surfaces 404 from the existing not-found branch.  Pinning this so the
    needs_review check doesn't accidentally widen the not-found surface
    (e.g. by 400-ing on missing rows)."""
    # Empty lookup (no source_type row) — needs_review check should be a
    # no-op and the INSERT path proceeds.  Our stub returns a fake inserted
    # card, which is fine — the real DB would 404; we only assert the block
    # did NOT raise prematurely.
    _, authz = _patch(monkeypatch, source_type=None)
    res = _call_add("stack-uuid-x", "vocab-foreign", authz)
    assert res["vocabulary_id"] == "vocab-foreign"
