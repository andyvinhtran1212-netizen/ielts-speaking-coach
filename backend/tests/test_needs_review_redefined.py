"""
PR-B: redefine `auto:needs_review` from "AI grammar verdict" → "SRS struggle".

After PR-B the stack list/count/cards endpoints all source `auto:needs_review`
from `flashcard_reviews.lapse_count > 0` (joined back to user_vocabulary
with the standard exclusions: archived, skipped, source_type='needs_review').
The old filter (source_type='needs_review') moved to the My Vocabulary
triage UI.

These tests stub Supabase and drive the helpers directly so the contract
holds offline.
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest

from routers import flashcards as fc


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


# ── Multi-table stub: flashcard_reviews + user_vocabulary ──────────────────


class _Builder:
    def __init__(self, parent, table):
        self._parent = parent
        self._table = table
        self._mode = None
        self._predicates: list = []   # records eq/gt/in_/neq for assertions
        self._order_calls: list = []
        self._limit_call: int | None = None

    def select(self, *_a, **_k):
        self._mode = "select"
        return self

    def eq(self, col, val):
        self._predicates.append(("eq", col, val)); return self

    def neq(self, col, val):
        self._predicates.append(("neq", col, val)); return self

    def gt(self, col, val):
        self._predicates.append(("gt", col, val)); return self

    def in_(self, col, vals):
        self._predicates.append(("in", col, list(vals))); return self

    def order(self, col, desc=False):
        self._order_calls.append((col, bool(desc))); return self

    def limit(self, n):
        self._limit_call = n; return self

    def execute(self):
        rows = self._parent.rows.get(self._table, [])
        # Apply predicates so the resolver's filtering is exercised end-to-end.
        out = list(rows)
        for op, col, val in self._predicates:
            if op == "eq":
                out = [r for r in out if r.get(col) == val]
            elif op == "neq":
                out = [r for r in out if r.get(col) != val]
            elif op == "gt":
                out = [r for r in out if (r.get(col) or 0) > val]
            elif op == "in":
                out = [r for r in out if r.get(col) in set(val)]
        # Apply orders (last applied wins last).  Reverse iteration keeps
        # multi-key sort stable (later .order() calls become primary).
        for col, desc in reversed(self._order_calls):
            out.sort(key=lambda r: r.get(col) if r.get(col) is not None else 0,
                     reverse=desc)

        class _R: pass
        r = _R()
        r.data = out
        r.count = len(out)
        return r


class _Client:
    def __init__(self):
        self.rows: dict[str, list[dict]] = {}
    def table(self, name): return _Builder(self, name)


# ── Fixtures: helpers to build review/vocab rows ────────────────────────────


def _vocab(id, source_type="manual", is_archived=False, is_skipped=False):
    return {
        "id": id,
        "headword": f"word-{id}",
        "definition_vi": "vi", "definition_en": "en",
        "ipa": "/x/", "example_sentence": "x", "context_sentence": "x",
        "topic": None, "category": "topic",
        "source_type": source_type,
        "created_at": "2026-04-30T00:00:00+00:00",
        "is_archived": is_archived,
        "is_skipped": is_skipped,
    }


def _review(vocab_id, lapse_count=1, ease_factor=2.5,
            last_reviewed_at="2026-04-30T00:00:00+00:00"):
    return {
        "vocabulary_id": vocab_id,
        "lapse_count": lapse_count,
        "ease_factor": ease_factor,
        "interval_days": 1, "review_count": 1,
        "last_reviewed_at": last_reviewed_at,
        "next_review_at":  "2026-05-01T00:00:00+00:00",
    }


# ── _count_struggling_vocab ─────────────────────────────────────────────────


def test_count_struggling_only_counts_lapsed_vocab():
    """flashcard_reviews with lapse_count > 0 → counted; lapse_count=0 → not."""
    c = _Client()
    c.rows["flashcard_reviews"] = [
        _review("v1", lapse_count=1),
        _review("v2", lapse_count=0),  # excluded by gt(lapse_count, 0)
        _review("v3", lapse_count=3),
    ]
    c.rows["user_vocabulary"] = [_vocab("v1"), _vocab("v2"), _vocab("v3")]
    assert fc._count_struggling_vocab(c) == 2


def test_count_struggling_excludes_skipped():
    c = _Client()
    c.rows["flashcard_reviews"] = [_review("v1"), _review("v2")]
    c.rows["user_vocabulary"] = [
        _vocab("v1"),
        _vocab("v2", is_skipped=True),
    ]
    assert fc._count_struggling_vocab(c) == 1


def test_count_struggling_excludes_unfixed_grammar_verdicts():
    """source_type='needs_review' rows are AI grammar verdicts, not SRS-eligible."""
    c = _Client()
    c.rows["flashcard_reviews"] = [_review("v1"), _review("v2")]
    c.rows["user_vocabulary"] = [
        _vocab("v1"),
        _vocab("v2", source_type="needs_review"),
    ]
    assert fc._count_struggling_vocab(c) == 1


def test_count_struggling_excludes_archived():
    c = _Client()
    c.rows["flashcard_reviews"] = [_review("v1"), _review("v2")]
    c.rows["user_vocabulary"] = [
        _vocab("v1"),
        _vocab("v2", is_archived=True),
    ]
    assert fc._count_struggling_vocab(c) == 1


def test_count_struggling_zero_for_new_user():
    c = _Client()
    c.rows["flashcard_reviews"] = []
    c.rows["user_vocabulary"] = []
    assert fc._count_struggling_vocab(c) == 0


# ── list_cards_in_stack: auto:needs_review redefine ─────────────────────────
#
# We exercise the handler end-to-end with patched auth + sb.  The handler
# returns {"stack_id", "cards": [...]}; cards come from the resolver above.


def _patch(monkeypatch, client):
    async def _fake_auth(_authz):
        return {"id": "user-uuid-redefined"}
    monkeypatch.setattr(fc, "get_supabase_user", _fake_auth)
    monkeypatch.setattr(fc, "_require_flashcards_enabled", lambda _uid: None)
    monkeypatch.setattr(fc, "_user_sb", lambda _token: client)
    return "Bearer fake-jwt"


def test_list_cards_auto_needs_review_returns_struggling_only(monkeypatch):
    c = _Client()
    c.rows["flashcard_reviews"] = [
        _review("v-easy", lapse_count=0),       # excluded
        _review("v-hard", lapse_count=3),
        _review("v-medium", lapse_count=1),
    ]
    c.rows["user_vocabulary"] = [
        _vocab("v-hard"),
        _vocab("v-medium"),
        _vocab("v-easy"),
    ]
    authz = _patch(monkeypatch, c)
    res = _run(fc.list_cards_in_stack(stack_id="auto:needs_review",
                                      authorization=authz))
    ids = [card["id"] for card in res["cards"]]
    assert "v-easy" not in ids
    assert set(ids) == {"v-hard", "v-medium"}


def test_list_cards_auto_needs_review_sorted_by_lapse_desc(monkeypatch):
    """Highest lapse_count first; ease_factor is tiebreaker (lower = harder)."""
    c = _Client()
    c.rows["flashcard_reviews"] = [
        _review("v-3", lapse_count=3, ease_factor=2.5),
        _review("v-1", lapse_count=1, ease_factor=2.0),
        _review("v-3-harder", lapse_count=3, ease_factor=1.5),
    ]
    c.rows["user_vocabulary"] = [
        _vocab("v-3"), _vocab("v-1"), _vocab("v-3-harder"),
    ]
    authz = _patch(monkeypatch, c)
    res = _run(fc.list_cards_in_stack(stack_id="auto:needs_review",
                                      authorization=authz))
    ids = [card["id"] for card in res["cards"]]
    # v-3-harder before v-3 (lower ease wins the tiebreak); both before v-1.
    assert ids == ["v-3-harder", "v-3", "v-1"]


def test_list_cards_auto_needs_review_excludes_skipped(monkeypatch):
    c = _Client()
    c.rows["flashcard_reviews"] = [_review("v1"), _review("v2")]
    c.rows["user_vocabulary"] = [
        _vocab("v1"),
        _vocab("v2", is_skipped=True),
    ]
    authz = _patch(monkeypatch, c)
    res = _run(fc.list_cards_in_stack(stack_id="auto:needs_review",
                                      authorization=authz))
    assert {c["id"] for c in res["cards"]} == {"v1"}


def test_list_cards_auto_needs_review_excludes_grammar_verdicts(monkeypatch):
    """A review row pointing at a source_type='needs_review' vocab is filtered out."""
    c = _Client()
    c.rows["flashcard_reviews"] = [_review("v1"), _review("v2")]
    c.rows["user_vocabulary"] = [
        _vocab("v1"),
        _vocab("v2", source_type="needs_review"),
    ]
    authz = _patch(monkeypatch, c)
    res = _run(fc.list_cards_in_stack(stack_id="auto:needs_review",
                                      authorization=authz))
    assert {c["id"] for c in res["cards"]} == {"v1"}


def test_list_cards_auto_needs_review_empty_for_new_user(monkeypatch):
    c = _Client()
    c.rows["flashcard_reviews"] = []
    c.rows["user_vocabulary"] = []
    authz = _patch(monkeypatch, c)
    res = _run(fc.list_cards_in_stack(stack_id="auto:needs_review",
                                      authorization=authz))
    assert res["cards"] == []


def test_list_cards_auto_all_vocab_unaffected(monkeypatch):
    """Wave 2 flagship: auto:all_vocab still returns ALL non-skipped vocab."""
    c = _Client()
    c.rows["user_vocabulary"] = [
        _vocab("v1"),
        _vocab("v2"),
        _vocab("v-skipped", is_skipped=True),
    ]
    authz = _patch(monkeypatch, c)
    res = _run(fc.list_cards_in_stack(stack_id="auto:all_vocab",
                                      authorization=authz))
    ids = {card["id"] for card in res["cards"]}
    assert ids == {"v1", "v2"}
    # No flashcard_reviews query was needed for this branch (regression
    # check: auto:all_vocab must not accidentally adopt the lapse path).
