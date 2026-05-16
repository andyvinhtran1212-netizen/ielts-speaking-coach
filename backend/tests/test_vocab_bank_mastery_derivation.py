"""Sprint 10.2 — pin the Mastery-SRS derivation at the router layer.
Sprint 10.6 (migration 055) dropped the user_vocabulary.mastery_status
column — the response field `mastery_status` is now derived on every
read from flashcard_reviews via services.mastery.derive_mastery_status.
The Sprint 10.2.1-hotfix sync tests have been removed (no column to
sync).

Contracts under test:

  1. **GET endpoints derive mastery_status from SRS state.** Response
     shape always reflects what `derive_mastery_status(flashcard_reviews_row)`
     computes. Seeded rows include canned SRS state — assertions verify
     the derived field on the response.

  2. **PATCH /{vocab_id} body schema is `{mastered: bool}`.** The
     handler upserts flashcard_reviews; the response carries the
     derived status. No user_vocabulary column write after Sprint 10.6.

  3. **PATCH ownership gate stays 404 on cross-user attempts.** A
     vocab_id that exists for user B must 404 when user A PATCHes
     it. (RLS would also block at the DB level, but the 404 is
     explicit so the test pins it at the router layer.)

The mock builder here supports `.upsert(on_conflict=...)` — the
Sprint 10.1.5-hotfix lesson formalised as Gate 9.6 — so the PATCH
path can be exercised end-to-end without a live Supabase.
"""

from __future__ import annotations

import asyncio
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from routers import vocabulary_bank as vb


# ── Test doubles ─────────────────────────────────────────────────────


def _run(coro):
    """Sync wrapper around an async route handler. Use `asyncio.run`
    so each call gets a fresh event loop — pytest fixtures across
    other tests close/recreate loops and `get_event_loop()` ends up
    pointing at a closed one when this module runs late in the suite."""
    return asyncio.run(coro)


class _Builder:
    """Multi-table Supabase chain stub. Routes by table name so the
    same client can serve user_vocabulary, flashcard_reviews, and
    others without cross-contamination of canned data.

    Supports the chain shapes the router uses:

      sb.table(t).select(...).eq(...).eq(...).limit(...).execute()
      sb.table(t).select(...).eq(...).eq(...).order(...).execute()
      sb.table(t).upsert(row, on_conflict="...").execute()
      sb.table(t).update(row).eq(...).execute()
    """

    def __init__(self, parent, table_name: str):
        self._parent = parent
        self._table = table_name
        self._filters: list[tuple[str, str, object]] = []

    def select(self, *_a, **_k): return self
    def order(self, *_a, **_k): return self
    def limit(self, *_a, **_k): return self

    def eq(self, col, val):
        self._filters.append(("eq", col, val))
        return self

    def neq(self, col, val):
        self._filters.append(("neq", col, val))
        return self

    def upsert(self, row, on_conflict=None):
        self._parent.upserts.append((self._table, row, on_conflict))

        class _Exec:
            def execute(self_inner): return _R([row])
        return _Exec()

    def update(self, row):
        self._parent.updates.append((self._table, row))

        class _Exec:
            def eq(self_inner, *_a, **_k): return self_inner
            def execute(self_inner): return _R([row])
        return _Exec()

    def execute(self):
        return _R(self._parent.canned.get(self._table, []))


class _R:
    def __init__(self, data):
        self.data = data
        self.count = None


class _Client:
    def __init__(self, canned: dict):
        self.canned = canned
        self.upserts: list[tuple] = []
        self.updates: list[tuple] = []

    def table(self, name=None, *_a, **_k):
        return _Builder(self, name)


def _patch(monkeypatch, canned: dict, *, user_id: str = "user-A"):
    """Wire the router's auth + Supabase factories to test doubles."""
    client = _Client(canned)

    async def _fake_auth(_authz):
        return {"id": user_id}

    monkeypatch.setattr(vb, "_require_auth", _fake_auth)
    monkeypatch.setattr(vb, "_vocab_bank_enabled", lambda _uid: True)
    monkeypatch.setattr(vb, "_user_sb", lambda _token: client)
    monkeypatch.setattr(vb, "_fire_event", lambda *_a, **_k: None)
    return client, "Bearer fake-jwt"


# ── GET derives mastery_status from SRS ──────────────────────────────


def test_list_endpoint_derives_mastered_when_srs_meets_threshold(monkeypatch):
    """A vocab row whose SRS state meets the threshold (interval ≥21
    AND review_count ≥3 AND lapse_count == 0) must respond as
    `mastered` — derived on the fly from flashcard_reviews via
    services.mastery.derive_mastery_status."""
    canned = {
        "user_vocabulary": [{
            "id": "v1", "user_id": "user-A", "headword": "ephemeral",
            "source_type": "manual", "is_archived": False, "is_skipped": False,
            "created_at": "2026-04-01T00:00:00+00:00",
        }],
        "flashcard_reviews": [{
            "vocabulary_id": "v1",
            "interval_days": 30, "lapse_count": 0, "review_count": 5,
            "ease_factor": 2.5,
            "next_review_at": None, "last_reviewed_at": None,
        }],
    }
    _patch(monkeypatch, canned)
    rows = _run(vb.list_vocab(status=None, source_type=None, authorization="Bearer fake"))
    assert len(rows) == 1
    assert rows[0]["mastery_status"] == "mastered", (
        "GET must derive mastery from flashcard_reviews."
    )


def test_list_endpoint_derives_learning_when_srs_has_lapse(monkeypatch):
    """A card with lapse_count > 0 in SRS must respond as learning,
    even if a long review history might otherwise look 'mastered'."""
    canned = {
        "user_vocabulary": [{
            "id": "v1", "user_id": "user-A", "headword": "phenomena",
            "source_type": "manual", "is_archived": False, "is_skipped": False,
            "created_at": "2026-04-01T00:00:00+00:00",
        }],
        "flashcard_reviews": [{
            "vocabulary_id": "v1",
            "interval_days": 50, "lapse_count": 2, "review_count": 10,
            "ease_factor": 2.5,
            "next_review_at": None, "last_reviewed_at": None,
        }],
    }
    _patch(monkeypatch, canned)
    rows = _run(vb.list_vocab(status=None, source_type=None, authorization="Bearer fake"))
    assert rows[0]["mastery_status"] == "learning", (
        "lapse_count>0 must demote to learning."
    )


def test_list_endpoint_derives_learning_when_no_srs_row(monkeypatch):
    """Newly captured vocab (no SRS row yet) must default to
    learning."""
    canned = {
        "user_vocabulary": [{
            "id": "v_new", "user_id": "user-A", "headword": "newcomer",
            "source_type": "manual", "is_archived": False, "is_skipped": False,
            "created_at": "2026-05-15T00:00:00+00:00",
        }],
        "flashcard_reviews": [],  # never reviewed
    }
    _patch(monkeypatch, canned)
    rows = _run(vb.list_vocab(status=None, source_type=None, authorization="Bearer fake"))
    assert rows[0]["mastery_status"] == "learning"


def test_status_filter_applies_to_derived_value(monkeypatch):
    """?status=mastered must return rows whose DERIVED status is
    mastered. Two rows seeded: one with SRS lapse (→ learning) and
    one mastered by derivation. Filter must pick only the second."""
    canned = {
        "user_vocabulary": [
            {"id": "v_lapsed", "user_id": "user-A", "headword": "lapsed_one",
             "source_type": "manual",
             "is_archived": False, "is_skipped": False,
             "created_at": "2026-04-01T00:00:00+00:00"},
            {"id": "v_real_mastered", "user_id": "user-A", "headword": "real_one",
             "source_type": "manual",
             "is_archived": False, "is_skipped": False,
             "created_at": "2026-04-02T00:00:00+00:00"},
        ],
        "flashcard_reviews": [
            {"vocabulary_id": "v_lapsed",
             "interval_days": 30, "lapse_count": 4, "review_count": 10,
             "ease_factor": 2.5, "next_review_at": None, "last_reviewed_at": None},
            {"vocabulary_id": "v_real_mastered",
             "interval_days": 25, "lapse_count": 0, "review_count": 4,
             "ease_factor": 2.5, "next_review_at": None, "last_reviewed_at": None},
        ],
    }
    _patch(monkeypatch, canned)
    rows = _run(vb.list_vocab(status="mastered", source_type=None, authorization="Bearer fake"))
    assert len(rows) == 1
    assert rows[0]["id"] == "v_real_mastered", (
        f"Filter must respect derived value; got rows: "
        f"{[(r['id'], r['mastery_status']) for r in rows]}"
    )


# ── PATCH writes flashcard_reviews, not user_vocabulary ──────────────


def test_patch_mastered_true_upserts_srs_at_threshold(monkeypatch):
    """`{mastered: true}` writes an SRS row that — when fed back
    through derive_mastery_status — yields 'mastered'. Pin the
    exact upsert payload so a future refactor of the threshold
    constants without updating the handler fails here loudly."""
    canned = {
        "user_vocabulary": [{
            "id": "v1", "user_id": "user-A", "headword": "articulate",
            "source_type": "manual", "is_archived": False, "is_skipped": False,
        }],
        "flashcard_reviews": [],
    }
    client, authz = _patch(monkeypatch, canned)
    resp = _run(vb.update_vocab_status(
        vocab_id="v1",
        body=vb.VocabUpdateStatusRequest(mastered=True),
        authorization=authz,
    ))

    assert resp == {"ok": True, "mastery_status": "mastered"}
    assert len(client.upserts) == 1
    table, row, on_conflict = client.upserts[0]
    # Sprint 10.6 — flashcard_reviews is the only write; the
    # mastery_status column has been dropped, so no secondary sync.
    assert table == "flashcard_reviews"
    assert on_conflict == "user_id,vocabulary_id"
    assert row["user_id"] == "user-A"
    assert row["vocabulary_id"] == "v1"
    assert row["interval_days"] == 21
    assert row["lapse_count"] == 0
    assert row["review_count"] == 3  # Bumped to threshold (no existing row)
    assert row["ease_factor"] == 2.5


def test_patch_mastered_true_preserves_existing_higher_review_count(monkeypatch):
    """If the user has already reviewed the card 7 times, we must
    NOT regress review_count to 3 on Mark-as-known. Same for
    ease_factor."""
    canned = {
        "user_vocabulary": [{
            "id": "v1", "user_id": "user-A", "headword": "articulate",
            "source_type": "manual", "is_archived": False, "is_skipped": False,
        }],
        "flashcard_reviews": [{
            "vocabulary_id": "v1",
            "interval_days": 5, "lapse_count": 1, "review_count": 7,
            "ease_factor": 2.8,
            "next_review_at": "2026-05-01T00:00:00+00:00",
            "last_reviewed_at": "2026-04-30T00:00:00+00:00",
        }],
    }
    client, authz = _patch(monkeypatch, canned)
    _run(vb.update_vocab_status(
        vocab_id="v1",
        body=vb.VocabUpdateStatusRequest(mastered=True),
        authorization=authz,
    ))
    _, row, _ = client.upserts[0]
    assert row["review_count"] == 7, "Real history must not be clobbered."
    assert row["ease_factor"] == 2.8, "Higher ease_factor must persist."
    assert row["lapse_count"] == 0, "Mark-as-known clears prior lapses."


def test_patch_mastered_false_resets_to_learning(monkeypatch):
    """`{mastered: false}` writes SRS that derives to 'learning' —
    interval_days=1, lapse_count=0 (we DON'T fabricate a lapse),
    and the response status is 'learning'."""
    canned = {
        "user_vocabulary": [{
            "id": "v1", "user_id": "user-A", "headword": "articulate",
            "source_type": "manual", "is_archived": False, "is_skipped": False,
        }],
        "flashcard_reviews": [{
            "vocabulary_id": "v1",
            "interval_days": 21, "lapse_count": 0, "review_count": 3,
            "ease_factor": 2.5,
            "next_review_at": "2026-06-05T00:00:00+00:00",
            "last_reviewed_at": "2026-05-15T00:00:00+00:00",
        }],
    }
    client, authz = _patch(monkeypatch, canned)
    resp = _run(vb.update_vocab_status(
        vocab_id="v1",
        body=vb.VocabUpdateStatusRequest(mastered=False),
        authorization=authz,
    ))
    assert resp == {"ok": True, "mastery_status": "learning"}
    _, row, _ = client.upserts[0]
    assert row["interval_days"] == 1
    assert row["lapse_count"] == 0, (
        "Unmark is a triage gesture, not a forgetting event — "
        "we must not fabricate a lapse."
    )
    assert row["review_count"] == 3, "Preserve existing review history."


def test_patch_404_when_vocab_id_does_not_exist(monkeypatch):
    """Ownership gate: a vocab_id that returns zero rows must 404
    BEFORE any flashcard_reviews write. Pin both the status code and
    the no-write contract."""
    canned = {
        "user_vocabulary": [],  # no row owned by this user
        "flashcard_reviews": [],
    }
    client, authz = _patch(monkeypatch, canned)
    with pytest.raises(HTTPException) as exc:
        _run(vb.update_vocab_status(
            vocab_id="missing",
            body=vb.VocabUpdateStatusRequest(mastered=True),
            authorization=authz,
        ))
    assert exc.value.status_code == 404
    assert client.upserts == [], "404 path must not touch flashcard_reviews."
    assert client.updates == [], "404 path must not write to user_vocabulary."


# ── /stats counters reflect derived mastery ──────────────────────────


def test_stats_counts_derived_mastery_not_column(monkeypatch):
    """Dashboard counter on home.html must agree with the bank list.
    Three rows: one truly mastered (SRS), one stale-mastered (SRS
    lapse), one learning (no SRS). Expect 1 mastered / 2 learning."""
    canned = {
        "user_vocabulary": [
            {"id": "real_m", "user_id": "user-A", "is_archived": False, "is_skipped": False},
            {"id": "stale_m", "user_id": "user-A", "is_archived": False, "is_skipped": False},
            {"id": "newbie", "user_id": "user-A", "is_archived": False, "is_skipped": False},
        ],
        "flashcard_reviews": [
            {"vocabulary_id": "real_m",
             "interval_days": 30, "lapse_count": 0, "review_count": 5,
             "ease_factor": 2.5,
             "next_review_at": None, "last_reviewed_at": None},
            {"vocabulary_id": "stale_m",
             "interval_days": 30, "lapse_count": 2, "review_count": 8,
             "ease_factor": 2.5,
             "next_review_at": None, "last_reviewed_at": None},
        ],
    }
    _patch(monkeypatch, canned)
    stats = _run(vb.get_vocab_stats(authorization="Bearer fake"))
    assert stats == {"total": 3, "learning": 2, "mastered": 1}
