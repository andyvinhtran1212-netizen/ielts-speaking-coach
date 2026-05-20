"""Sprint 11.2 — pin POST /api/listening/attempts + grader contract
(DEBT-LISTENING-MODULE 2/5).

Three layers exercised:

  1. services.listening_grader — pure-Python word-level diff. Unit
     tests cover normalisation (case, smart quotes, trailing punct),
     diff op kinds (match/miss/wrong/extra), empty input, and the
     score == correct_words / total_words contract.
  2. router POST /api/listening/attempts — fetches transcript, runs
     grader, lazy-upserts the dictation exercise row, INSERTs the
     attempt, returns the diff payload.
  3. first-attempt rule — second submission stores a new row but
     reports is_first_attempt=False.

Mock pattern: extends the Sprint 10.4 builder used in
test_listening_router.py with .order() + .range() + count=exact.
"""

from __future__ import annotations

import asyncio
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from routers import listening as listening_router
from services import listening_grader


# ── Grader unit tests ────────────────────────────────────────────────


def test_grader_exact_match_scores_100():
    out = listening_grader.grade_dictation(
        reference_transcript="The cat sat on the mat.",
        user_transcript="The cat sat on the mat.",
    )
    assert out["score"] == 1.0
    assert out["is_correct"] is True
    assert out["correct_words"] == 6
    assert out["total_words"] == 6
    assert all(op["op"] == "match" for op in out["diff"])


def test_grader_case_insensitive():
    out = listening_grader.grade_dictation(
        reference_transcript="The cat SAT on the mat.",
        user_transcript="the CAT sat on THE Mat.",
    )
    assert out["score"] == 1.0


def test_grader_smart_quotes_normalised():
    """Smart-quote MS-Word paste is the #1 source of false misses."""
    out = listening_grader.grade_dictation(
        reference_transcript="It's a long road.",
        user_transcript="It\u2019s a long road.",   # curly apostrophe
    )
    assert out["score"] == 1.0


def test_grader_trailing_punct_stripped():
    out = listening_grader.grade_dictation(
        reference_transcript="Yes, please.",
        user_transcript="Yes please",
    )
    assert out["score"] == 1.0


def test_grader_missed_word_marked():
    out = listening_grader.grade_dictation(
        reference_transcript="The exhibition opens on Saturday.",
        user_transcript="The exhibition opens Saturday.",  # missed 'on'
    )
    assert out["correct_words"] == 4
    assert out["total_words"] == 5
    miss = [op for op in out["diff"] if op["op"] == "miss"]
    assert len(miss) == 1
    assert miss[0]["expected"] == "on"


def test_grader_extra_word_marked():
    out = listening_grader.grade_dictation(
        reference_transcript="Hello world.",
        user_transcript="Hello new world.",
    )
    assert out["correct_words"] == 2
    extra = [op for op in out["diff"] if op["op"] == "extra"]
    assert len(extra) == 1
    assert extra[0]["actual"] == "new"


def test_grader_wrong_word_marked():
    """Adjacent miss+extra collapses into a single 'wrong' op."""
    out = listening_grader.grade_dictation(
        reference_transcript="The cat sat.",
        user_transcript="The dog sat.",
    )
    wrong = [op for op in out["diff"] if op["op"] == "wrong"]
    assert len(wrong) == 1
    assert wrong[0]["expected"] == "cat"
    assert wrong[0]["actual"] == "dog"


def test_grader_empty_user_input_scores_zero():
    out = listening_grader.grade_dictation(
        reference_transcript="Hello world.",
        user_transcript="",
    )
    assert out["score"] == 0.0
    assert out["correct_words"] == 0
    assert out["total_words"] == 2
    assert all(op["op"] == "miss" for op in out["diff"])


def test_grader_partial_score_is_ratio():
    out = listening_grader.grade_dictation(
        reference_transcript="one two three four five",
        user_transcript="one two three",
    )
    assert out["score"] == 0.6  # 3/5


def test_grader_total_words_one_when_reference_empty():
    """Defensive: empty reference shouldn't div-by-zero."""
    out = listening_grader.grade_dictation(
        reference_transcript="",
        user_transcript="anything",
    )
    # total_words counted from tokens (0), but score denom min=1.
    assert out["total_words"] == 0
    assert out["score"] == 0.0


# ── Fake Supabase admin client (router-side) ─────────────────────────


class _FakeRes:
    def __init__(self, data, count=None):
        self.data = data
        self.count = count


class _FakeTableQuery:
    """Mirrors Sprint 10.4 builder + extends for .order() + .range() +
    count='exact' (used by the admin list endpoint)."""

    def __init__(self, parent, table_name: str):
        self._parent = parent
        self._table = table_name
        self._filters: list[tuple[str, object]] = []
        self._insert: dict | None = None
        self._count_mode: str | None = None
        self._range: tuple[int, int] | None = None
        self._order: tuple[str, bool] | None = None  # (col, desc)

    def select(self, *_a, count=None, **_k):
        self._count_mode = count
        return self

    def limit(self, *_a, **_k): return self

    def order(self, col, desc=False):
        self._order = (col, desc)
        return self

    def range(self, lo, hi):
        self._range = (lo, hi)
        return self

    def eq(self, col, val):
        self._filters.append((col, val))
        return self

    def insert(self, payload):
        self._insert = payload
        self._parent.inserts.append((self._table, payload))
        return self

    def execute(self):
        if self._insert is not None:
            return _FakeRes([self._insert])
        rows = list(self._parent.canned.get(self._table, []))
        for col, val in self._filters:
            rows = [r for r in rows if r.get(col) == val]
        total = len(rows)
        if self._range is not None:
            lo, hi = self._range
            rows = rows[lo:hi + 1]
        return _FakeRes(rows, count=total if self._count_mode == "exact" else None)


class _FakeStorageBucket:
    def __init__(self, parent, bucket_name: str):
        self._parent = parent
        self._bucket = bucket_name

    def create_signed_url(self, path: str, ttl: int):
        return {"signedURL": f"https://storage.test/{self._bucket}/{path}?ttl={ttl}"}


class _FakeStorage:
    def __init__(self, parent):
        self._parent = parent

    def from_(self, bucket_name: str):
        return _FakeStorageBucket(self._parent, bucket_name)


class _FakeAdminClient:
    def __init__(self, canned=None):
        self.canned = canned or {}
        self.inserts: list[tuple] = []
        self.storage = _FakeStorage(self)

    def table(self, name: str):
        return _FakeTableQuery(self, name)


def _patch_user_auth(monkeypatch, user_id="user-1"):
    async def _fake(_authz):
        return {"id": user_id}
    monkeypatch.setattr(listening_router, "get_supabase_user", _fake)
    return "Bearer fake-user-jwt"


def _patch_admin_auth(monkeypatch, user_id="admin-1"):
    async def _fake(_authz):
        return {"id": user_id, "email": "admin@example.com"}
    monkeypatch.setattr(listening_router, "require_admin", _fake)
    return "Bearer fake-admin-jwt"


def _patch_admin_client(monkeypatch, fake):
    monkeypatch.setattr(listening_router, "supabase_admin", fake)


def _run(coro):
    return asyncio.run(coro)


# ── POST /api/listening/attempts ─────────────────────────────────────


def _published_content(content_id="c1", transcript="The cat sat on the mat."):
    return {
        "listening_content": [{
            "id": content_id,
            "status": "published",
            "transcript": transcript,
            "audio_storage_path": f"ai/{content_id}.mp3",
        }],
    }


def test_post_attempt_happy_path_first_attempt(monkeypatch):
    fake = _FakeAdminClient(_published_content())
    _patch_admin_client(monkeypatch, fake)
    authz = _patch_user_auth(monkeypatch)

    body = listening_router.ListeningAttemptRequest(
        content_id="c1",
        mode="dictation",
        user_transcript="The cat sat on the mat.",
        listen_count=2,
    )
    out = _run(listening_router.post_listening_attempt(
        body=body, authorization=authz,
    ))
    assert out["is_first_attempt"] is True
    assert out["score"] == 1.0
    assert out["is_correct"] is True
    assert out["correct_words"] == 6
    assert out["total_words"] == 6
    assert out["attempt_id"]

    # INSERTed both an exercise row (lazy upsert) AND the attempt row.
    tables_written = [t for t, _ in fake.inserts]
    assert "listening_exercises" in tables_written
    assert "listening_attempts" in tables_written

    # Attempt row carries the diff inside user_answer.
    attempt_payload = next(p for t, p in fake.inserts if t == "listening_attempts")
    assert attempt_payload["user_id"] == "user-1"
    assert attempt_payload["user_answer"]["text"] == "The cat sat on the mat."
    assert "diff" in attempt_payload["user_answer"]
    assert attempt_payload["score"] == 1.0
    assert attempt_payload["is_correct"] is True
    # listen_count=2 → replay_count=1, audio_play_completed=True
    assert attempt_payload["replay_count"] == 1
    assert attempt_payload["audio_play_completed"] is True


def test_post_attempt_partial_score(monkeypatch):
    fake = _FakeAdminClient(_published_content(
        transcript="The exhibition opens on Saturday."
    ))
    _patch_admin_client(monkeypatch, fake)
    authz = _patch_user_auth(monkeypatch)

    body = listening_router.ListeningAttemptRequest(
        content_id="c1",
        mode="dictation",
        user_transcript="The exhibition opens Saturday.",  # missing 'on'
        listen_count=1,
    )
    out = _run(listening_router.post_listening_attempt(
        body=body, authorization=authz,
    ))
    assert out["correct_words"] == 4
    assert out["total_words"] == 5
    assert out["score"] == 0.8
    assert out["is_correct"] is False
    assert any(op["op"] == "miss" for op in out["diff"])


def test_post_attempt_second_submission_marks_not_first(monkeypatch):
    """First-attempt rule (Sprint 10.3 carryover)."""
    canned = _published_content()
    # Pre-populate: existing exercise row + a prior attempt by same user.
    canned["listening_exercises"] = [{
        "id": "ex-1",
        "content_id": "c1",
        "exercise_type": "dictation",
        "status": "published",
    }]
    canned["listening_attempts"] = [{
        "id": "prev-1",
        "user_id": "user-1",
        "exercise_id": "ex-1",
        "score": 0.5,
        "is_correct": False,
    }]
    fake = _FakeAdminClient(canned)
    _patch_admin_client(monkeypatch, fake)
    authz = _patch_user_auth(monkeypatch)

    body = listening_router.ListeningAttemptRequest(
        content_id="c1",
        mode="dictation",
        user_transcript="The cat sat on the mat.",
        listen_count=1,
    )
    out = _run(listening_router.post_listening_attempt(
        body=body, authorization=authz,
    ))
    assert out["is_first_attempt"] is False
    # Fresh score still computed (perfect this time).
    assert out["score"] == 1.0
    # New attempt INSERTed (no overwrite of prior).
    attempt_inserts = [p for t, p in fake.inserts if t == "listening_attempts"]
    assert len(attempt_inserts) == 1
    # Exercise row was NOT duplicated (lazy upsert short-circuits when
    # an existing dictation row matches the content_id).
    exercise_inserts = [p for t, p in fake.inserts if t == "listening_exercises"]
    assert exercise_inserts == []


def test_post_attempt_404_for_draft_content(monkeypatch):
    canned = {
        "listening_content": [{
            "id": "c1",
            "status": "draft",
            "transcript": "x",
        }],
    }
    _patch_admin_client(monkeypatch, _FakeAdminClient(canned))
    authz = _patch_user_auth(monkeypatch)

    body = listening_router.ListeningAttemptRequest(
        content_id="c1", mode="dictation", user_transcript="anything",
    )
    with pytest.raises(HTTPException) as exc:
        _run(listening_router.post_listening_attempt(
            body=body, authorization=authz,
        ))
    assert exc.value.status_code == 404


def test_post_attempt_422_for_unsupported_mode(monkeypatch):
    """Sprint 11.5 promotes mcq to LIVE; only an unknown mode returns 422."""
    _patch_admin_client(monkeypatch, _FakeAdminClient(_published_content()))
    authz = _patch_user_auth(monkeypatch)

    body = listening_router.ListeningAttemptRequest(
        content_id="c1", mode="essay", user_transcript="x",
    )
    with pytest.raises(HTTPException) as exc:
        _run(listening_router.post_listening_attempt(
            body=body, authorization=authz,
        ))
    assert exc.value.status_code == 422
    # Supported modes are surfaced in the error message.
    assert "dictation" in str(exc.value.detail)
    assert "mcq" in str(exc.value.detail)


# ── Admin GET /admin/listening/content/{id} (draft preview) ──────────


def test_admin_get_content_returns_draft(monkeypatch):
    canned = {
        "listening_content": [{
            "id": "c1",
            "status": "draft",  # admin can see drafts
            "transcript": "x",
            "audio_storage_path": "ai/c1.mp3",
            "title": "Pre-publish review",
        }],
    }
    _patch_admin_client(monkeypatch, _FakeAdminClient(canned))
    authz = _patch_admin_auth(monkeypatch)

    out = _run(listening_router.admin_get_listening_content(
        content_id="c1", authorization=authz,
    ))
    assert out["id"] == "c1"
    assert out["status"] == "draft"
    assert out["audio_signed_url"]


def test_admin_get_content_404_when_missing(monkeypatch):
    _patch_admin_client(monkeypatch, _FakeAdminClient({"listening_content": []}))
    authz = _patch_admin_auth(monkeypatch)
    with pytest.raises(HTTPException) as exc:
        _run(listening_router.admin_get_listening_content(
            content_id="nope", authorization=authz,
        ))
    assert exc.value.status_code == 404


# ── Admin GET /admin/listening/content (list + pagination) ───────────


def test_admin_list_content_pagination(monkeypatch):
    rows = [
        {"id": f"c{i}", "status": "draft" if i % 2 else "published",
         "title": f"Row {i}", "created_at": f"2026-05-{18 - i:02d}"}
        for i in range(5)
    ]
    _patch_admin_client(monkeypatch, _FakeAdminClient({"listening_content": rows}))
    authz = _patch_admin_auth(monkeypatch)

    out = _run(listening_router.admin_list_listening_content(
        status="all", limit=3, offset=0, authorization=authz,
    ))
    assert out["limit"] == 3
    assert out["offset"] == 0
    assert out["total"] == 5
    assert len(out["items"]) == 3


def test_admin_list_content_filter_by_status(monkeypatch):
    rows = [
        {"id": "c1", "status": "draft", "title": "d"},
        {"id": "c2", "status": "published", "title": "p"},
        {"id": "c3", "status": "draft", "title": "d2"},
    ]
    _patch_admin_client(monkeypatch, _FakeAdminClient({"listening_content": rows}))
    authz = _patch_admin_auth(monkeypatch)

    out = _run(listening_router.admin_list_listening_content(
        status="draft", limit=20, offset=0, authorization=authz,
    ))
    assert out["total"] == 2
    assert all(r["status"] == "draft" for r in out["items"])


def test_admin_list_content_rejects_unknown_status(monkeypatch):
    _patch_admin_client(monkeypatch, _FakeAdminClient({"listening_content": []}))
    authz = _patch_admin_auth(monkeypatch)
    with pytest.raises(HTTPException) as exc:
        _run(listening_router.admin_list_listening_content(
            status="banana", limit=20, offset=0, authorization=authz,
        ))
    assert exc.value.status_code == 422


# ── Voice fallback (Sprint 11.2 P1/4) ────────────────────────────────


def test_render_uses_voice_fallback_when_voice_id_omitted(monkeypatch):
    """Sprint 11.2 — voice_id became optional. Omit + set accent_tag and
    the locked default for that accent is used."""
    _patch_admin_client(monkeypatch, _FakeAdminClient())
    authz = _patch_admin_auth(monkeypatch)
    monkeypatch.setattr(listening_router.settings, "LISTENING_AI_RENDER_ENABLED", True)
    monkeypatch.setattr(listening_router.settings, "ELEVENLABS_API_KEY", "sk_test")
    monkeypatch.setattr(listening_router.settings,
                        "LISTENING_VOICE_US_FEMALE_DEFAULT", "fallback-sarah")

    body = listening_router.ListeningRenderRequest(
        # Sprint 13.3 added a 100-char floor — bumped to clear it.
        script_text=(
            "The exhibition opens on Saturday at the new convention "
            "centre downtown, and admission will be free throughout "
            "the weekend for residents and visitors alike."
        ),
        # voice_id omitted on purpose
        model="eleven_multilingual_v2",
        title="Section 1 booking",
        accent_tag="us_general",
    )
    bg = MagicMock()
    out = _run(listening_router.admin_render_listening(
        body=body, background_tasks=bg, authorization=authz,
    ))
    assert out["status"] == "queued"
    _, kwargs = bg.add_task.call_args
    assert kwargs["voice_id"] == "fallback-sarah"


def test_render_rejects_when_no_default_for_accent(monkeypatch):
    """AU (or any accent without a configured default) + omitted voice_id → 422."""
    _patch_admin_client(monkeypatch, _FakeAdminClient())
    authz = _patch_admin_auth(monkeypatch)
    monkeypatch.setattr(listening_router.settings, "LISTENING_AI_RENDER_ENABLED", True)
    monkeypatch.setattr(listening_router.settings, "ELEVENLABS_API_KEY", "sk_test")

    body = listening_router.ListeningRenderRequest(
        # Sprint 13.3 added a 100-char floor — bumped to clear it.
        script_text=(
            "A long script for the AU narration test about the "
            "history of public transport in Sydney, including the "
            "ferry network and the recent light-rail extensions."
        ),
        model="eleven_multilingual_v2",
        title="AU sample",
        accent_tag="au",
    )
    bg = MagicMock()
    with pytest.raises(HTTPException) as exc:
        _run(listening_router.admin_render_listening(
            body=body, background_tasks=bg, authorization=authz,
        ))
    assert exc.value.status_code == 422
    assert "voice_id" in str(exc.value.detail)
    assert bg.add_task.call_count == 0
