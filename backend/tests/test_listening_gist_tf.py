"""Sprint 11.4 — pin gist + true/false contracts (DEBT-LISTENING-
MODULE 4/5).

Coverage:
  1. listening_grader.grade_true_false pure helper (exact, partial,
     answer-normalisation, missing answers).
  2. listening_gist_grader.grade_gist_response (keyword fallback when
     ANTHROPIC_API_KEY is absent, empty input, ai_used flag).
  3. Admin upsert payload validators (gist + true_false): required
     fields, IELTS 3-12 range for true_false, answer normalisation.
  4. POST /api/listening/attempts dispatch by mode: gist + true_false
     happy paths, mode↔exercise_type mismatch 422, missing exercise 404.
"""

from __future__ import annotations

import asyncio
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from routers import listening as listening_router
from services import listening_grader, listening_gist_grader


# ── grade_true_false unit tests ──────────────────────────────────────


def _stmts():
    return [
        {"idx": 0, "text": "The Earth is flat.",          "answer": "F"},
        {"idx": 1, "text": "Water boils at 100°C at 1atm.","answer": "T"},
        {"idx": 2, "text": "Mars has 3 moons.",            "answer": "NG"},
    ]


def test_tf_all_correct():
    out = listening_grader.grade_true_false(
        statements=_stmts(), user_answers=["F", "T", "NG"],
    )
    assert out["score"] == 1.0
    assert out["is_correct"] is True
    assert out["correct"] == 3
    assert all(d["is_correct"] for d in out["details"])


def test_tf_partial():
    out = listening_grader.grade_true_false(
        statements=_stmts(), user_answers=["F", "F", "NG"],
    )
    assert out["correct"] == 2
    assert out["total"] == 3
    # Round to 4 decimals; 2/3 ≈ 0.6667.
    assert abs(out["score"] - 2 / 3) < 0.001
    assert out["is_correct"] is False


def test_tf_normalises_true_false_notgiven_synonyms():
    """User-facing client may send "True" / "FALSE" / "Not Given" — all
    should normalise into T/F/NG."""
    out = listening_grader.grade_true_false(
        statements=_stmts(),
        user_answers=["FALSE", "True", "Not Given"],
    )
    assert out["score"] == 1.0


def test_tf_missing_answers_count_wrong():
    out = listening_grader.grade_true_false(
        statements=_stmts(), user_answers=["F"],   # only 1 answer
    )
    assert out["correct"] == 1
    assert out["total"] == 3
    assert out["details"][1]["actual"] == ""    # missing → wrong


def test_tf_empty_statements_safe():
    out = listening_grader.grade_true_false(statements=[], user_answers=[])
    assert out == {"score": 0.0, "correct": 0, "total": 0,
                   "is_correct": False, "details": []}


# ── Gist grader (keyword fallback, no API key needed) ────────────────


def test_gist_fallback_when_no_api_key(monkeypatch):
    """When ANTHROPIC_API_KEY is empty, the grader scores on keyword
    coverage alone (Sprint 11.4 fail-soft contract)."""
    monkeypatch.setattr(listening_gist_grader.settings, "ANTHROPIC_API_KEY", "")
    out = listening_gist_grader.grade_gist_response(
        user_response="The speaker discusses coastal erosion and climate change effects.",
        model_answer="Coastal erosion is accelerating due to climate change.",
        rubric_keywords=["coastal", "erosion", "climate"],
    )
    assert out["ai_used"] is False
    # All 3 keywords match → 60 (fallback cap).
    assert out["score"] == 60
    assert set(out["keyword_matches"]) == {"coastal", "erosion", "climate"}


def test_gist_empty_response_scores_zero(monkeypatch):
    monkeypatch.setattr(listening_gist_grader.settings, "ANTHROPIC_API_KEY", "")
    out = listening_gist_grader.grade_gist_response(
        user_response="",
        model_answer="anything",
        rubric_keywords=["foo"],
    )
    assert out["score"] == 0
    assert out["ai_used"] is False


def test_gist_partial_keyword_match(monkeypatch):
    monkeypatch.setattr(listening_gist_grader.settings, "ANTHROPIC_API_KEY", "")
    out = listening_gist_grader.grade_gist_response(
        user_response="erosion",
        model_answer="anything",
        rubric_keywords=["coastal", "erosion", "climate"],
    )
    # 1/3 keywords → fallback gives floor(60 * 1/3) = 20.
    assert out["score"] == 20
    assert out["keyword_matches"] == ["erosion"]


# ── Payload validators (admin upsert side) ───────────────────────────


def test_gist_payload_validator_happy():
    out = listening_router._validate_gist_payload({
        "prompt_text":     "What is the main idea?",
        "model_answer":    "The speaker discusses erosion.",
        "rubric_keywords": ["erosion", "climate", "  trimmed  "],
    })
    assert out["prompt_text"] == "What is the main idea?"
    assert "  trimmed  " not in out["rubric_keywords"]
    assert "trimmed" in out["rubric_keywords"]


def test_gist_payload_validator_caps_keywords_at_10():
    out = listening_router._validate_gist_payload({
        "prompt_text":  "x",
        "model_answer": "y",
        "rubric_keywords": [f"kw{i}" for i in range(15)],
    })
    assert len(out["rubric_keywords"]) == 10


def test_gist_payload_validator_rejects_missing_prompt():
    with pytest.raises(HTTPException) as exc:
        listening_router._validate_gist_payload({"model_answer": "y"})
    assert exc.value.status_code == 422
    assert "prompt_text" in str(exc.value.detail)


def test_gist_payload_validator_rejects_missing_model_answer():
    with pytest.raises(HTTPException) as exc:
        listening_router._validate_gist_payload({"prompt_text": "x"})
    assert exc.value.status_code == 422
    assert "model_answer" in str(exc.value.detail)


def test_tf_payload_validator_happy():
    out = listening_router._validate_true_false_payload({
        "statements": [
            {"idx": 0, "text": "A.", "answer": "True"},
            {"idx": 1, "text": "B.", "answer": "FALSE"},
            {"idx": 2, "text": "C.", "answer": "Not Given"},
        ],
    })
    answers = [s["answer"] for s in out["statements"]]
    assert answers == ["T", "F", "NG"]


def test_tf_payload_validator_rejects_too_few():
    with pytest.raises(HTTPException) as exc:
        listening_router._validate_true_false_payload({
            "statements": [{"idx": 0, "text": "a", "answer": "T"}],
        })
    assert exc.value.status_code == 422
    assert "3-12" in str(exc.value.detail)


def test_tf_payload_validator_rejects_too_many():
    with pytest.raises(HTTPException) as exc:
        listening_router._validate_true_false_payload({
            "statements": [
                {"idx": i, "text": f"s{i}", "answer": "T"} for i in range(13)
            ],
        })
    assert exc.value.status_code == 422


def test_tf_payload_validator_rejects_non_contiguous_idx():
    with pytest.raises(HTTPException) as exc:
        listening_router._validate_true_false_payload({
            "statements": [
                {"idx": 0, "text": "a", "answer": "T"},
                {"idx": 5, "text": "b", "answer": "F"},
                {"idx": 2, "text": "c", "answer": "NG"},
            ],
        })
    assert exc.value.status_code == 422


def test_tf_payload_validator_rejects_bad_answer():
    with pytest.raises(HTTPException) as exc:
        listening_router._validate_true_false_payload({
            "statements": [
                {"idx": 0, "text": "a", "answer": "maybe"},
                {"idx": 1, "text": "b", "answer": "T"},
                {"idx": 2, "text": "c", "answer": "F"},
            ],
        })
    assert exc.value.status_code == 422


# ── Fake admin client + auth shims (reused minimal pattern) ──────────


class _FakeRes:
    def __init__(self, data, count=None):
        self.data = data
        self.count = count


class _FakeTableQuery:
    def __init__(self, parent, table):
        self._parent = parent
        self._table = table
        self._filters: list[tuple[str, object]] = []
        self._insert: dict | None = None
        self._update: dict | None = None

    def select(self, *_a, **_k): return self
    def limit(self, *_a, **_k): return self
    def order(self, *_a, **_k): return self

    def eq(self, col, val):
        self._filters.append((col, val))
        return self

    def insert(self, payload):
        self._insert = payload
        self._parent.inserts.append((self._table, payload))
        return self

    def update(self, payload):
        self._update = payload
        self._parent.updates.append((self._table, list(self._filters), payload))
        return self

    def execute(self):
        if self._insert is not None:
            return _FakeRes([self._insert])
        if self._update is not None:
            return _FakeRes([self._update])
        rows = list(self._parent.canned.get(self._table, []))
        for col, val in self._filters:
            rows = [r for r in rows if r.get(col) == val]
        return _FakeRes(rows)


class _FakeStorageBucket:
    def __init__(self, parent, bucket):
        self._parent = parent
        self._bucket = bucket

    def create_signed_url(self, path, ttl):
        return {"signedURL": f"https://test/{self._bucket}/{path}"}


class _FakeStorage:
    def __init__(self, parent): self._parent = parent
    def from_(self, b): return _FakeStorageBucket(self._parent, b)


class _FakeAdminClient:
    def __init__(self, canned=None):
        self.canned = canned or {}
        self.inserts: list[tuple] = []
        self.updates: list[tuple] = []
        self.storage = _FakeStorage(self)

    def table(self, name):
        return _FakeTableQuery(self, name)


def _patch_user(monkeypatch, user_id="user-1"):
    async def _f(_): return {"id": user_id}
    monkeypatch.setattr(listening_router, "get_supabase_user", _f)
    return "Bearer fake-user"


def _patch_admin_client(monkeypatch, fake):
    monkeypatch.setattr(listening_router, "supabase_admin", fake)


def _run(c): return asyncio.run(c)


def _content_row():
    return {
        "id": "c1", "status": "published",
        "transcript": "Coastal erosion is accelerating...",
        "audio_storage_path": "ai/c1.mp3",
        "audio_duration_seconds": 270,
    }


# ── POST /api/listening/attempts — gist dispatch ─────────────────────


def test_attempt_gist_happy_path(monkeypatch):
    """Gist attempt grades against payload.model_answer via the keyword
    fallback (no API key in test env)."""
    monkeypatch.setattr(listening_gist_grader.settings, "ANTHROPIC_API_KEY", "")

    canned = {
        "listening_content": [_content_row()],
        "listening_exercises": [{
            "id": "ex-gist",
            "content_id": "c1",
            "exercise_type": "gist",
            "status": "published",
            "payload": {
                "prompt_text":     "What is the main idea?",
                "model_answer":    "Coastal erosion accelerating due to climate change.",
                "rubric_keywords": ["coastal", "erosion", "climate"],
            },
        }],
        "listening_attempts": [],
    }
    fake = _FakeAdminClient(canned)
    _patch_admin_client(monkeypatch, fake)
    authz = _patch_user(monkeypatch)

    body = listening_router.ListeningAttemptRequest(
        exercise_id="ex-gist",
        mode="gist",
        user_transcript="The speaker covers coastal erosion and climate change.",
    )
    out = _run(listening_router.post_listening_attempt(
        body=body, authorization=authz,
    ))
    assert out["mode"] == "gist"
    assert out["score"] == 60          # 3/3 keywords matched, fallback cap
    assert out["ai_used"] is False
    assert out["is_first_attempt"] is True

    inserts = [p for t, p in fake.inserts if t == "listening_attempts"]
    assert len(inserts) == 1
    # listening_attempts.score is 0-1, derived from the 0-100 gist score.
    assert inserts[0]["score"] == 0.6
    assert inserts[0]["segment_idx"] is None


def test_attempt_gist_404_when_no_published_exercise(monkeypatch):
    canned = {
        "listening_content": [_content_row()],
        "listening_exercises": [],
    }
    _patch_admin_client(monkeypatch, _FakeAdminClient(canned))
    authz = _patch_user(monkeypatch)
    body = listening_router.ListeningAttemptRequest(
        content_id="c1", mode="gist", user_transcript="x",
    )
    with pytest.raises(HTTPException) as exc:
        _run(listening_router.post_listening_attempt(
            body=body, authorization=authz,
        ))
    assert exc.value.status_code == 404


def test_attempt_mode_exercise_type_mismatch_422(monkeypatch):
    """Body says mode=gist but the resolved exercise is dictation
    → 422 instead of a silently-mis-graded attempt."""
    canned = {
        "listening_content": [_content_row()],
        "listening_exercises": [{
            "id": "ex-dict",
            "content_id": "c1",
            "exercise_type": "dictation",
            "status": "published",
        }],
    }
    _patch_admin_client(monkeypatch, _FakeAdminClient(canned))
    authz = _patch_user(monkeypatch)
    body = listening_router.ListeningAttemptRequest(
        exercise_id="ex-dict", mode="gist", user_transcript="x",
    )
    with pytest.raises(HTTPException) as exc:
        _run(listening_router.post_listening_attempt(
            body=body, authorization=authz,
        ))
    assert exc.value.status_code == 422
    assert "mode" in str(exc.value.detail)


# ── POST /api/listening/attempts — true_false dispatch ───────────────


def test_attempt_tf_happy_path(monkeypatch):
    canned = {
        "listening_content": [_content_row()],
        "listening_exercises": [{
            "id": "ex-tf",
            "content_id": "c1",
            "exercise_type": "true_false",
            "status": "published",
            "payload": {"statements": _stmts()},
        }],
        "listening_attempts": [],
    }
    fake = _FakeAdminClient(canned)
    _patch_admin_client(monkeypatch, fake)
    authz = _patch_user(monkeypatch)

    body = listening_router.ListeningAttemptRequest(
        exercise_id="ex-tf",
        mode="true_false",
        answers=["F", "T", "NG"],
    )
    out = _run(listening_router.post_listening_attempt(
        body=body, authorization=authz,
    ))
    assert out["mode"] == "true_false"
    assert out["score"] == 1.0
    assert out["correct"] == 3
    assert out["total"] == 3
    assert out["is_first_attempt"] is True
    # All 3 details flagged correct.
    assert all(d["is_correct"] for d in out["details"])


def test_attempt_tf_requires_answers_array(monkeypatch):
    canned = {
        "listening_content": [_content_row()],
        "listening_exercises": [{
            "id": "ex-tf",
            "content_id": "c1",
            "exercise_type": "true_false",
            "status": "published",
            "payload": {"statements": _stmts()},
        }],
    }
    _patch_admin_client(monkeypatch, _FakeAdminClient(canned))
    authz = _patch_user(monkeypatch)
    body = listening_router.ListeningAttemptRequest(
        exercise_id="ex-tf", mode="true_false", answers=[],
    )
    with pytest.raises(HTTPException) as exc:
        _run(listening_router.post_listening_attempt(
            body=body, authorization=authz,
        ))
    assert exc.value.status_code == 422
    assert "answers" in str(exc.value.detail)


def test_attempt_tf_first_attempt_rule(monkeypatch):
    canned = {
        "listening_content": [_content_row()],
        "listening_exercises": [{
            "id": "ex-tf",
            "content_id": "c1",
            "exercise_type": "true_false",
            "status": "published",
            "payload": {"statements": _stmts()},
        }],
        "listening_attempts": [{
            "id": "prev-1", "user_id": "user-1", "exercise_id": "ex-tf",
            "segment_idx": None, "score": 0.5,
        }],
    }
    _patch_admin_client(monkeypatch, _FakeAdminClient(canned))
    authz = _patch_user(monkeypatch)
    body = listening_router.ListeningAttemptRequest(
        exercise_id="ex-tf", mode="true_false", answers=["F", "T", "NG"],
    )
    out = _run(listening_router.post_listening_attempt(
        body=body, authorization=authz,
    ))
    assert out["is_first_attempt"] is False


# ── Mode allowlist ────────────────────────────────────────────────────


def test_attempt_unknown_mode_422(monkeypatch):
    _patch_admin_client(monkeypatch, _FakeAdminClient())
    authz = _patch_user(monkeypatch)
    body = listening_router.ListeningAttemptRequest(
        content_id="c1", mode="mcq", user_transcript="x",
    )
    with pytest.raises(HTTPException) as exc:
        _run(listening_router.post_listening_attempt(
            body=body, authorization=authz,
        ))
    assert exc.value.status_code == 422
    assert "mcq" in str(exc.value.detail)
