"""
backend/tests/test_cuecard_generate_endpoint.py — Sprint 14.6.2

The custom-Q AI cue-card endpoint is a thin wrapper around the
production-tested `services.gemini.generate_part2_cuecard` (used today
for /sessions/.../questions/generate on Part 2 topics). These tests
focus on the endpoint's CONTRACT — shape translation, error surfaces,
auth — not Gemini-internal behaviour (the Gemini module has its own
test coverage).
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent.parent))

from routers import questions as questions_router  # noqa: E402


# ── Fixtures ────────────────────────────────────────────────────────────────


@pytest.fixture
def client(monkeypatch):
    """Isolated FastAPI app with the questions router + stubbed auth.

    Tests that need to control the Gemini side patch `services.gemini.
    generate_part2_cuecard` independently per-test (it's imported lazily
    inside the endpoint so the patch lands cleanly)."""
    from fastapi import FastAPI

    app = FastAPI()
    app.include_router(questions_router.router)

    async def _fake_auth(_authorization):
        return {"id": "user-1"}

    monkeypatch.setattr(questions_router, "get_supabase_user", _fake_auth)
    return TestClient(app)


def _patch_generator(monkeypatch, *, return_value=None, side_effect=None):
    """Patch services.gemini.generate_part2_cuecard for one test."""
    from services import gemini
    monkeypatch.setattr(
        gemini, "generate_part2_cuecard",
        AsyncMock(return_value=return_value, side_effect=side_effect),
    )


# ── Happy path: shape translation ─────────────────────────────────────────


def test_endpoint_translates_gemini_shape_to_cue_card_payload(monkeypatch, client):
    """Gemini returns {question_text, cue_card_bullets, cue_card_reflection};
    the endpoint must map that to the same Sprint-14.4 CueCardQuestion
    shape the /sessions/{id}/questions/custom body expects, so the
    client can forward verbatim."""
    _patch_generator(monkeypatch, return_value={
        "question_text":       "Describe a memorable trip you have taken.",
        "cue_card_bullets":    ["Where you went",
                                "Who you went with",
                                "What you did there"],
        "cue_card_reflection": "and explain why this trip was memorable.",
    })

    r = client.post("/sessions/cuecard/generate",
                    json={"trigger": "A memorable trip"})
    assert r.status_code == 200
    body = r.json()
    assert body["type"]    == "cue_card"
    assert body["topic"]   == "Describe a memorable trip you have taken."
    assert body["bullets"] == [
        "Where you went", "Who you went with", "What you did there",
    ]
    # The prompt is the rendered cue card the user (and Part 2 state
    # machine) will see — must include each piece so the rendered
    # output matches Cambridge format.
    assert "Describe a memorable trip you have taken." in body["prompt"]
    assert "You should say:" in body["prompt"]
    assert "- Where you went"      in body["prompt"]
    assert "and explain why this trip was memorable." in body["prompt"]
    # Provenance fields — the client uses these for audit + the
    # source-vs-ai-generated UI distinction.
    assert body["source"]  == "ai_generated"
    assert body["trigger"] == "A memorable trip"


def test_endpoint_drops_empty_bullets_from_gemini_output(monkeypatch, client):
    """services.gemini pads short bullet lists with empty strings to
    always return 3. The endpoint must filter those out so the
    rendered prompt doesn't get blank `- ` lines."""
    _patch_generator(monkeypatch, return_value={
        "question_text":       "Describe X.",
        "cue_card_bullets":    ["A", "B", ""],   # padded shape
        "cue_card_reflection": "and explain.",
    })
    r = client.post("/sessions/cuecard/generate", json={"trigger": "X"})
    assert r.status_code == 200
    body = r.json()
    assert body["bullets"] == ["A", "B"]
    assert "- A" in body["prompt"]
    assert "- B" in body["prompt"]
    # No blank bullet line in the rendered prompt.
    assert "- \n" not in body["prompt"]


def test_endpoint_handles_missing_reflection(monkeypatch, client):
    """Some gemini outputs lack the reflection clause; endpoint must
    still render a usable cue card without it."""
    _patch_generator(monkeypatch, return_value={
        "question_text":    "Describe X.",
        "cue_card_bullets": ["a", "b", "c"],
        # cue_card_reflection deliberately absent
    })
    r = client.post("/sessions/cuecard/generate", json={"trigger": "X"})
    assert r.status_code == 200
    assert r.json()["topic"] == "Describe X."


# ── Error paths ────────────────────────────────────────────────────────────


def test_endpoint_returns_503_with_actionable_detail_on_gemini_failure(monkeypatch, client):
    """When services.gemini raises (rate limit, network, JSON parse
    fail twice, etc.) we surface 503 with a Vietnamese message that
    nudges the user to the paste-manually workaround. L8 / L11 from
    the commission."""
    _patch_generator(monkeypatch, side_effect=ValueError("gemini boom"))

    r = client.post("/sessions/cuecard/generate", json={"trigger": "X"})
    assert r.status_code == 503
    detail = r.json()["detail"]
    assert detail["code"] == "cue_card_generation_unavailable"
    # The message must contain the manual-paste hint so the frontend
    # can show a clean fallback path without translating server copy.
    assert "paste" in detail["message"].lower()
    assert detail["trigger"] == "X"


def test_endpoint_rejects_empty_trigger(client):
    """Pydantic enforces min_length=1; an extra strip-then-reject in
    the endpoint catches whitespace-only triggers too."""
    r = client.post("/sessions/cuecard/generate", json={"trigger": ""})
    assert r.status_code == 422


def test_endpoint_rejects_whitespace_only_trigger(monkeypatch, client):
    """Pydantic min_length=1 lets `'   '` through; the endpoint's own
    .strip()+empty check is the second line of defence."""
    # Ensure Gemini isn't called even if validation slips.
    from services import gemini
    called = {"count": 0}
    async def _spy(*_args, **_kw):
        called["count"] += 1
        return {}
    monkeypatch.setattr(gemini, "generate_part2_cuecard", _spy)

    r = client.post("/sessions/cuecard/generate", json={"trigger": "   "})
    assert r.status_code == 422
    assert called["count"] == 0


def test_endpoint_rejects_trigger_over_max_length(client):
    """`max_length=400` keeps the prompt budget bounded. A user paste
    of a whole essay should fail validation, not balloon the LLM call."""
    r = client.post("/sessions/cuecard/generate",
                    json={"trigger": "x" * 401})
    assert r.status_code == 422


def test_endpoint_requires_auth(monkeypatch, client):
    """The fixture stubs auth as `user-1`; clearing the stub should
    surface the auth-required path. Pin the wire-up so a future
    refactor can't accidentally drop the dependency."""
    from routers.auth import get_supabase_user as _real_auth  # noqa: F401

    async def _reject(_authorization):
        from fastapi import HTTPException
        raise HTTPException(status_code=401, detail="auth required")

    monkeypatch.setattr(questions_router, "get_supabase_user", _reject)
    r = client.post("/sessions/cuecard/generate", json={"trigger": "X"})
    assert r.status_code == 401


def test_endpoint_passes_user_id_to_generator_for_ai_usage_logging(monkeypatch, client):
    """services.gemini.generate_part2_cuecard takes an optional
    `user_id` for ai_usage_logs attribution. Endpoint must forward
    the authenticated user so cost tracking stays accurate."""
    captured = {}

    async def _spy(topic, user_id=None):
        captured["topic"]   = topic
        captured["user_id"] = user_id
        return {
            "question_text":    "Describe X.",
            "cue_card_bullets": ["a", "b", "c"],
            "cue_card_reflection": "and explain.",
        }

    from services import gemini
    monkeypatch.setattr(gemini, "generate_part2_cuecard", _spy)

    r = client.post("/sessions/cuecard/generate", json={"trigger": "X"})
    assert r.status_code == 200
    assert captured["user_id"] == "user-1"
    assert captured["topic"] == "X"


def test_endpoint_uses_strict_trigger_as_topic(monkeypatch, client):
    """The Gemini-side cache key is `(part=2, topic.lower().strip())`.
    The endpoint must pass `trigger.strip()` so the cache hit rate
    survives variations in user whitespace input (`'  Describe X  '`
    must hit the same cache entry as `'Describe X'`)."""
    captured = {}

    async def _spy(topic, user_id=None):
        captured["topic"] = topic
        return {
            "question_text": "Describe X.",
            "cue_card_bullets": ["a", "b", "c"],
            "cue_card_reflection": "and explain.",
        }
    from services import gemini
    monkeypatch.setattr(gemini, "generate_part2_cuecard", _spy)

    r = client.post("/sessions/cuecard/generate",
                    json={"trigger": "   Describe X.   "})
    assert r.status_code == 200
    assert captured["topic"] == "Describe X."
