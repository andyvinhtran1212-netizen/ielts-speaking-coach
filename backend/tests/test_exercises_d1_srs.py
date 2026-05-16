"""Sprint 10.3 — pin the D1 → SRS feedback loop at the router layer.

Three contracts under test:

  1. **First attempt wires SRS.** A correct first attempt upserts
     flashcard_reviews with rating='good'; a wrong first attempt
     upserts with rating='again' AND the gated demotion floor (7).
     Sprint 10.3.1-hotfix flipped the wrong-path rating from 'hard'
     to 'again' — SM-2 'hard' is slower-growth (×1.2), not demotion,
     so layering it on top of floor=7 made the floor a no-op for
     mastered cards. 'again' resets interval to 0 (then floor clamps
     up to 7) AND bumps lapse_count, so a single wrong answer flips
     mastery to 'learning' — the pedagogically intended outcome.

  2. **Retry attempts skip SRS.** When a vocabulary_exercise_attempts
     row already exists for (user_id, exercise_id), the handler logs
     the new attempt but MUST NOT touch flashcard_reviews. Andy Q2
     lock — prevents "spam retry to recover rating" gaming.

  3. **Skip conditions short-circuit cleanly.**
       * target_vocab_id is NULL on the exercise row → log + skip SRS
       * user_vocabulary row is archived → log + skip SRS
       * (vocab missing entirely) → log + skip SRS

Response contract: `{srs_updated: bool, srs_rating: str | None}`
fields appear on every D1 attempt response post-10.3. srs_rating is
null when srs_updated is false so pre-10.3 clients that ignore the
fields stay correct, and post-10.3 clients can render the
"✓ Đã ghi nhận / 📝 Lưu ý" indicator gated on srs_updated.

The mock builder extends the Sprint 10.2 pattern (test_vocab_bank_
mastery_derivation.py) with attempt insertion support — the D1 handler
calls `.insert(...).execute()` on vocabulary_exercise_attempts.
"""

from __future__ import annotations

import asyncio
from unittest.mock import patch

import pytest

from routers import exercises as ex


# ── Test doubles ─────────────────────────────────────────────────────


def _run(coro):
    """asyncio.run to dodge event-loop contamination across the suite."""
    return asyncio.run(coro)


class _Builder:
    """Multi-table Supabase chain stub. Routes by table name so a
    single client serves vocabulary_exercises, d1_sessions,
    vocabulary_exercise_attempts, user_vocabulary, and
    flashcard_reviews with distinct canned data per table."""

    def __init__(self, parent, table_name: str):
        self._parent = parent
        self._table = table_name

    def select(self, *_a, **_k): return self
    def order(self, *_a, **_k): return self
    def limit(self, *_a, **_k): return self
    def eq(self, *_a, **_k): return self
    def neq(self, *_a, **_k): return self

    def insert(self, row):
        self._parent.inserts.append((self._table, row))

        class _Exec:
            def execute(self_inner):
                class _R: data = [row]; count = None
                return _R()
        return _Exec()

    def upsert(self, row, on_conflict=None):
        self._parent.upserts.append((self._table, row, on_conflict))

        class _Exec:
            def execute(self_inner):
                class _R: data = [row]; count = None
                return _R()
        return _Exec()

    def update(self, row):
        self._parent.updates.append((self._table, row))

        class _Exec:
            def eq(self_inner, *_a, **_k): return self_inner
            def execute(self_inner):
                class _R: data = [row]; count = None
                return _R()
        return _Exec()

    def execute(self):
        class _R: pass
        r = _R()
        r.data = self._parent.canned.get(self._table, [])
        r.count = None
        return r


class _Client:
    def __init__(self, canned: dict):
        self.canned = canned
        self.inserts: list[tuple] = []
        self.upserts: list[tuple] = []
        self.updates: list[tuple] = []

    def table(self, name=None, *_a, **_k):
        return _Builder(self, name)

    # The D1 handler hits sb.postgrest.auth(token) indirectly via
    # _user_sb in the real code; we patch _user_sb itself in the
    # test fixture so postgrest isn't touched.


def _patch(monkeypatch, canned: dict, *, user_id: str = "user-A"):
    """Wire auth + feature flag + Supabase factory to test doubles."""
    client = _Client(canned)

    async def _fake_auth(_authz):
        return {"id": user_id}

    # The rate-limit decorator (services/rate_limit.py) does its own
    # `from routers.auth import get_supabase_user` at call time and
    # then verifies the user via that imported function. So we must
    # patch the source module — patching `ex.get_supabase_user` won't
    # reach the decorator's lazy re-import.
    from routers import auth as auth_mod
    monkeypatch.setattr(auth_mod, "get_supabase_user", _fake_auth)
    monkeypatch.setattr(ex, "get_supabase_user", _fake_auth)
    monkeypatch.setattr(ex, "_require_d1_enabled", lambda _uid: None)
    monkeypatch.setattr(ex, "_user_sb", lambda _token: client)
    monkeypatch.setattr(ex, "_safe_event", lambda *_a, **_k: None)
    return client, "Bearer fake-jwt"


@pytest.fixture(autouse=True)
def _bypass_rate_limit(monkeypatch):
    """Disable the rate-limit usage counter so tests don't need to
    stub a daily-usage Supabase row. The decorator is applied at
    import time on the handler so we can't replace the decorator
    itself; instead we patch the enforcement function it calls."""
    from services import rate_limit
    monkeypatch.setattr(rate_limit, "enforce_exercise_rate_limit", lambda **_k: None)


def _exercise_row(*, target_vocab_id: str | None = "v-target",
                  answer: str = "ephemeral"):
    return {
        "id": "ex-1",
        "exercise_type": "D1",
        "content_payload": {"sentence": "...", "answer": answer},
        "status": "published",
        "target_vocab_id": target_vocab_id,
    }


def _vocab_row(*, vocab_id: str = "v-target", is_archived: bool = False):
    return {"id": vocab_id, "is_archived": is_archived, "user_id": "user-A"}


def _attempt_body(answer: str = "ephemeral"):
    return ex.D1AttemptRequest(user_answer=answer, session_id=None)


# ── First attempt + correct → SRS upsert with rating='good' ──────────


def test_first_correct_attempt_upserts_srs_with_good_rating(monkeypatch):
    canned = {
        "vocabulary_exercises": [_exercise_row()],
        "vocabulary_exercise_attempts": [],  # no prior attempts
        "user_vocabulary": [_vocab_row()],
        "flashcard_reviews": [],  # no prior review
    }
    client, authz = _patch(monkeypatch, canned)
    resp = _run(ex.submit_d1_attempt(
        exercise_id="ex-1", body=_attempt_body("ephemeral"), authorization=authz,
    ))

    assert resp["is_correct"] is True
    assert resp["srs_updated"] is True, (
        f"first correct attempt must fire SRS; got resp={resp}"
    )
    assert resp["srs_rating"] == "good"

    # Exactly one upsert on flashcard_reviews.
    fc_upserts = [u for u in client.upserts if u[0] == "flashcard_reviews"]
    assert len(fc_upserts) == 1
    _, row, on_conflict = fc_upserts[0]
    assert on_conflict == "user_id,vocabulary_id"
    assert row["user_id"] == "user-A"
    assert row["vocabulary_id"] == "v-target"
    # update_srs('good', prev defaults ease=2.5/interval=1) → int(1*2.5)=2.
    # Floor=7 lifts to 7.
    assert row["interval_days"] >= 7


def test_first_wrong_attempt_upserts_srs_with_again_rating_and_floor(monkeypatch):
    """Sprint 10.3.1-hotfix — wrong first attempt → rating='again'
    (SM-2 reset) + floor=7. The 'again' rating sets new_interval=0
    AND bumps lapse_count; the floor then clamps interval UP to 7.
    Combined: any wrong-first-attempt lands the card at exactly
    interval=7 with lapse_count+1, regardless of the prior interval.

    Pre-10.3.1 used 'hard' (slow growth ×1.2) under the misreading
    that 'hard' was a softer demote than 'again'. SM-2 'hard' is
    actually growth-attenuation, not demotion — wrong on
    interval=25 grew to ~30 and the floor was a no-op. This test
    catches a regression back to that mistake."""
    canned = {
        "vocabulary_exercises": [_exercise_row()],
        "vocabulary_exercise_attempts": [],
        "user_vocabulary": [_vocab_row()],
        "flashcard_reviews": [{
            "user_id": "user-A", "vocabulary_id": "v-target",
            "ease_factor": 2.5, "interval_days": 3,
            "review_count": 1, "lapse_count": 0,
        }],
    }
    client, authz = _patch(monkeypatch, canned)
    resp = _run(ex.submit_d1_attempt(
        exercise_id="ex-1", body=_attempt_body("wrong"), authorization=authz,
    ))

    assert resp["is_correct"] is False
    assert resp["srs_updated"] is True
    assert resp["srs_rating"] == "again", (
        f"Sprint 10.3.1-hotfix: wrong-first-attempt must map to "
        f"rating='again', not 'hard'. Got {resp['srs_rating']!r}."
    )

    fc_upserts = [u for u in client.upserts if u[0] == "flashcard_reviews"]
    assert len(fc_upserts) == 1
    _, row, _ = fc_upserts[0]
    # SM-2 again on any interval → 0. Floor=7 lifts to 7.
    assert row["interval_days"] == 7
    # 'again' increments lapse_count (was 0 → 1).
    assert row["lapse_count"] == 1, (
        f"'again' must increment lapse_count; got {row['lapse_count']}"
    )


def test_wrong_attempt_on_mastered_card_demotes_to_floor_with_lapse(monkeypatch):
    """Sprint 10.3.1-hotfix — the canonical pedagogical case.

    Pre-10.3.1 (rating='hard'): wrong on mastered card (interval=25)
    grew to ~30, lapse_count stayed at 0, mastery stayed 'mastered'.
    Floor=7 was a no-op for mastered cards — the safeguard was
    half-dead.

    Post-10.3.1 (rating='again'): wrong on mastered card resets
    interval to 0 → floor clamps to 7. lapse_count bumps to 1 →
    derive_mastery_status flips to 'learning' (any lapse
    disqualifies). The user gets a meaningful "you missed this"
    signal AND the card returns to active rotation."""
    canned = {
        "vocabulary_exercises": [_exercise_row()],
        "vocabulary_exercise_attempts": [],
        "user_vocabulary": [_vocab_row()],
        "flashcard_reviews": [{
            "user_id": "user-A", "vocabulary_id": "v-target",
            "ease_factor": 2.5, "interval_days": 25,
            "review_count": 3, "lapse_count": 0,
        }],
    }
    client, authz = _patch(monkeypatch, canned)
    _run(ex.submit_d1_attempt(
        exercise_id="ex-1", body=_attempt_body("wrong"), authorization=authz,
    ))

    fc_upserts = [u for u in client.upserts if u[0] == "flashcard_reviews"]
    _, row, _ = fc_upserts[0]
    # 'again' resets interval to 0; floor=7 clamps up.
    assert row["interval_days"] == 7
    # lapse_count++ — this is what flips mastery to 'learning' on
    # the next derive_mastery_status read (Sprint 10.2 threshold).
    # Sprint 10.6 (migration 055) dropped the user_vocabulary.mastery_status
    # column, so there is no column UPDATE to assert anymore — the
    # SRS row above IS the source of truth.
    assert row["lapse_count"] == 1
    assert [u for u in client.updates if u[0] == "user_vocabulary"] == [], (
        "Post-Sprint 10.6 the handler must not write user_vocabulary.mastery_status."
    )


# ── Retry attempts skip SRS ──────────────────────────────────────────


def test_second_attempt_logs_but_does_not_touch_srs(monkeypatch):
    """A prior attempt exists for (user_id, exercise_id) → retry
    detected → handler MUST NOT upsert flashcard_reviews even on a
    correct answer. The attempt log is still written (analytics
    still needs the row)."""
    canned = {
        "vocabulary_exercises": [_exercise_row()],
        "vocabulary_exercise_attempts": [{"id": "prior-attempt"}],
        "user_vocabulary": [_vocab_row()],
        "flashcard_reviews": [],
    }
    client, authz = _patch(monkeypatch, canned)
    resp = _run(ex.submit_d1_attempt(
        exercise_id="ex-1", body=_attempt_body("ephemeral"), authorization=authz,
    ))

    assert resp["is_correct"] is True
    assert resp["srs_updated"] is False, (
        "Retry must not fire SRS — pin Andy Q2 anti-gaming guard."
    )
    assert resp["srs_rating"] is None

    # Attempt log still written.
    att_inserts = [i for i in client.inserts if i[0] == "vocabulary_exercise_attempts"]
    assert len(att_inserts) == 1
    # No flashcard_reviews touch.
    fc_upserts = [u for u in client.upserts if u[0] == "flashcard_reviews"]
    assert fc_upserts == []
    # Sprint 10.6 — column was dropped; no user_vocabulary writes either way.
    col_updates = [u for u in client.updates if u[0] == "user_vocabulary"]
    assert col_updates == []


def test_second_attempt_wrong_also_skips_srs(monkeypatch):
    """Symmetry pin — wrong retry must also skip. The first-attempt
    guard is independent of the answer's correctness."""
    canned = {
        "vocabulary_exercises": [_exercise_row()],
        "vocabulary_exercise_attempts": [{"id": "prior"}],
        "user_vocabulary": [_vocab_row()],
        "flashcard_reviews": [],
    }
    client, authz = _patch(monkeypatch, canned)
    resp = _run(ex.submit_d1_attempt(
        exercise_id="ex-1", body=_attempt_body("nope"), authorization=authz,
    ))
    assert resp["srs_updated"] is False
    assert [u for u in client.upserts if u[0] == "flashcard_reviews"] == []


# ── Skip conditions ──────────────────────────────────────────────────


def test_exercise_with_null_target_vocab_id_skips_srs(monkeypatch):
    """Some legacy exercises were created before target_vocab_id was
    populated, and admin-authored exercises may leave it null for
    generic drills. Either way: no SRS write, no error."""
    canned = {
        "vocabulary_exercises": [_exercise_row(target_vocab_id=None)],
        "vocabulary_exercise_attempts": [],
        "user_vocabulary": [],
        "flashcard_reviews": [],
    }
    client, authz = _patch(monkeypatch, canned)
    resp = _run(ex.submit_d1_attempt(
        exercise_id="ex-1", body=_attempt_body("ephemeral"), authorization=authz,
    ))
    assert resp["srs_updated"] is False
    assert resp["srs_rating"] is None
    assert [u for u in client.upserts if u[0] == "flashcard_reviews"] == []


def test_archived_target_vocab_skips_srs(monkeypatch):
    """User soft-deleted the vocab → archived rows must not see SRS
    updates. The user's intent is "hide this"; demoting/promoting
    silently would surprise them when they restore."""
    canned = {
        "vocabulary_exercises": [_exercise_row()],
        "vocabulary_exercise_attempts": [],
        "user_vocabulary": [_vocab_row(is_archived=True)],
        "flashcard_reviews": [],
    }
    client, authz = _patch(monkeypatch, canned)
    resp = _run(ex.submit_d1_attempt(
        exercise_id="ex-1", body=_attempt_body("ephemeral"), authorization=authz,
    ))
    assert resp["srs_updated"] is False
    assert [u for u in client.upserts if u[0] == "flashcard_reviews"] == []


def test_missing_target_vocab_row_skips_srs(monkeypatch):
    """target_vocab_id references a vocab row that no longer exists
    (rare — the FK is ON DELETE SET NULL, but a stale read could
    show this state). Handler must fail-soft, not 500."""
    canned = {
        "vocabulary_exercises": [_exercise_row()],
        "vocabulary_exercise_attempts": [],
        "user_vocabulary": [],  # no matching row
        "flashcard_reviews": [],
    }
    client, authz = _patch(monkeypatch, canned)
    resp = _run(ex.submit_d1_attempt(
        exercise_id="ex-1", body=_attempt_body("ephemeral"), authorization=authz,
    ))
    assert resp["srs_updated"] is False


# ── Sprint 10.6 — no user_vocabulary column write on SRS path ────────


def test_successful_srs_update_does_not_write_user_vocabulary(monkeypatch):
    """Sprint 10.6 (migration 055) dropped the user_vocabulary.mastery_status
    column. Pre-10.6 the handler issued a secondary UPDATE to keep the
    column in sync with derive_mastery_status. That sync has been removed
    — the response field is now derived on every read from
    flashcard_reviews. This test pins the negative contract: the SRS path
    must NOT touch user_vocabulary.mastery_status (or any column)."""
    canned = {
        "vocabulary_exercises": [_exercise_row()],
        "vocabulary_exercise_attempts": [],
        "user_vocabulary": [_vocab_row()],
        "flashcard_reviews": [{
            "user_id": "user-A", "vocabulary_id": "v-target",
            "ease_factor": 2.5, "interval_days": 10,
            "review_count": 2, "lapse_count": 0,
        }],
    }
    client, authz = _patch(monkeypatch, canned)
    _run(ex.submit_d1_attempt(
        exercise_id="ex-1", body=_attempt_body("ephemeral"), authorization=authz,
    ))
    # SRS upsert still happens — that's the canonical write now.
    assert [u for u in client.upserts if u[0] == "flashcard_reviews"], (
        "SRS upsert must still fire — Sprint 10.6 only removed the secondary column sync."
    )
    # But no user_vocabulary write.
    assert [u for u in client.updates if u[0] == "user_vocabulary"] == [], (
        "Sprint 10.6 — the deprecated user_vocabulary.mastery_status column "
        "has been dropped; the handler must not attempt to write it."
    )


# ── Response contract — pre-10.3 compat ──────────────────────────────


def test_response_always_carries_srs_fields_even_when_skipped(monkeypatch):
    """Backwards-compat pin: a pre-10.3 frontend ignores unknown keys.
    A post-10.3 frontend can rely on srs_updated being present on
    EVERY D1 attempt response (true or false) so it doesn't need an
    `'srs_updated' in resp` guard in every code path."""
    canned = {
        "vocabulary_exercises": [_exercise_row(target_vocab_id=None)],
        "vocabulary_exercise_attempts": [],
        "user_vocabulary": [],
        "flashcard_reviews": [],
    }
    _patch(monkeypatch, canned)
    resp = _run(ex.submit_d1_attempt(
        exercise_id="ex-1", body=_attempt_body("ephemeral"), authorization="Bearer fake",
    ))
    assert "srs_updated" in resp
    assert "srs_rating" in resp
    # When srs_updated=false, srs_rating must be null (not "good"/"again")
    # so the frontend doesn't render a misleading indicator.
    assert resp["srs_updated"] is False
    assert resp["srs_rating"] is None
