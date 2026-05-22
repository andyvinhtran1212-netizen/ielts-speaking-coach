"""
backend/tests/test_custom_questions_cue_card.py — Sprint 14.4

POST /sessions/{id}/questions/custom must accept both legacy string
payloads AND the new structured cue-card payload (Sprint 14.4 L8
backward compat) while routing cue cards to the right schema row
(`question_type=cue_card`, `cue_card_bullets` populated, `part=2`).

These tests use FastAPI's TestClient + a stub Supabase admin so we
can pin the row shape inserted into the DB without touching a real
Postgres.
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent.parent))

from routers import questions as questions_router  # noqa: E402


# ── Fixtures ────────────────────────────────────────────────────────────────


def _stub_supabase(*, session_part: int = 2,
                   inserted_sink: list | None = None) -> MagicMock:
    """Build a duck-typed `supabase_admin` whose `.table(...)` returns a
    chainable object. The session lookup returns one row with the given
    part; the questions insert echoes the inserted rows back as `data`
    so the endpoint's `result.data[0]["order_num"]` sort works."""

    sink = inserted_sink if inserted_sink is not None else []

    class _Result:
        def __init__(self, data):
            self.data = data

    class _SessionsQuery:
        def select(self, *_a, **_kw): return self
        def eq(self, *_a, **_kw):     return self
        def limit(self, *_a, **_kw):  return self
        def execute(self):
            return _Result([{"id": "sess-1", "part": session_part}])

    class _QuestionsQuery:
        def insert(self, rows):
            sink.extend(rows)
            # Pretend Supabase returned each row with an id appended.
            return _InsertExec(rows)

    class _InsertExec:
        def __init__(self, rows):
            self._rows = [dict(r, id=f"q-{i}") for i, r in enumerate(rows)]
        def execute(self):
            return _Result(self._rows)

    class _Sb:
        def table(self, name):
            return _QuestionsQuery() if name == "questions" else _SessionsQuery()

    return _Sb()


@pytest.fixture
def client(monkeypatch):
    """Build an isolated FastAPI app with just the questions router
    mounted, plus stubbed auth + supabase so tests don't hit real
    services."""
    from fastapi import FastAPI

    app = FastAPI()
    app.include_router(questions_router.router)

    async def _fake_auth(_authorization):
        return {"id": "user-1"}

    monkeypatch.setattr(questions_router, "get_supabase_user", _fake_auth)
    return TestClient(app)


# ── Backward compat (L8): legacy list[str] payload ──────────────────────────


def test_legacy_string_payload_still_works(monkeypatch, client):
    """Pre-Sprint-14.4 clients post a plain list of strings — the
    endpoint must keep accepting that shape verbatim."""
    sink: list = []
    monkeypatch.setattr(questions_router, "supabase_admin",
                        _stub_supabase(session_part=1, inserted_sink=sink))

    r = client.post(
        "/sessions/sess-1/questions/custom",
        json={"questions": ["Q1?", "Q2?", "Q3?"]},
    )
    assert r.status_code == 200
    assert len(sink) == 3
    for row in sink:
        assert row["question_type"] == "custom"
        assert row["cue_card_bullets"] is None
        assert row["part"] == 1


def test_legacy_payload_trims_blank_lines(monkeypatch, client):
    sink: list = []
    monkeypatch.setattr(questions_router, "supabase_admin",
                        _stub_supabase(session_part=1, inserted_sink=sink))

    r = client.post(
        "/sessions/sess-1/questions/custom",
        json={"questions": ["Q1", "  ", "", "Q2"]},
    )
    assert r.status_code == 200
    texts = [row["question_text"] for row in sink]
    assert texts == ["Q1", "Q2"]


# ── New structured cue-card payload (L7) ────────────────────────────────────


def test_cue_card_payload_lights_up_cue_card_bullets_column(monkeypatch, client):
    """The whole point of Sprint 14.4: when the frontend ships a
    detected cue card, the insert must (1) use `question_type=cue_card`,
    (2) populate `cue_card_bullets`, (3) clamp `part=2`."""
    sink: list = []
    monkeypatch.setattr(questions_router, "supabase_admin",
                        _stub_supabase(session_part=2, inserted_sink=sink))

    r = client.post(
        "/sessions/sess-1/questions/custom",
        json={"questions": [{
            "type":    "cue_card",
            "prompt":  "Describe a time when you helped someone. ...",
            "topic":   "Describe a time when you helped someone.",
            "bullets": ["who you helped", "how you helped them",
                        "why they needed help", "how you felt afterwards"],
        }]},
    )
    assert r.status_code == 200
    assert len(sink) == 1
    row = sink[0]
    assert row["question_type"]    == "cue_card"
    assert row["cue_card_bullets"] == [
        "who you helped", "how you helped them",
        "why they needed help", "how you felt afterwards",
    ]
    assert row["part"] == 2
    assert row["question_text"].startswith("Describe a time")


def test_cue_card_with_empty_bullets_stores_null_not_empty_array(monkeypatch, client):
    """Frontend forces cue-card mode on a paste whose heuristic missed;
    bullets array is []. We store NULL so SQL queries like
    `WHERE cue_card_bullets IS NULL` still find these rows alongside
    legacy non-cue-card customs."""
    sink: list = []
    monkeypatch.setattr(questions_router, "supabase_admin",
                        _stub_supabase(session_part=2, inserted_sink=sink))

    r = client.post(
        "/sessions/sess-1/questions/custom",
        json={"questions": [{
            "type":    "cue_card",
            "prompt":  "Describe X.",
            "topic":   "Describe X.",
            "bullets": [],
        }]},
    )
    assert r.status_code == 200
    assert sink[0]["cue_card_bullets"] is None


def test_cue_card_on_non_part_2_session_returns_422(monkeypatch, client):
    """L9 — cue card belongs to Part 2. If a stale client posts a cue
    card against a Part 1 or Part 3 session (because of a UI race),
    we surface a 422 so the user gets a clean re-record path instead
    of being stranded in a wrong-part session."""
    sink: list = []
    monkeypatch.setattr(questions_router, "supabase_admin",
                        _stub_supabase(session_part=1, inserted_sink=sink))

    r = client.post(
        "/sessions/sess-1/questions/custom",
        json={"questions": [{
            "type":    "cue_card",
            "prompt":  "Describe X. You should say: ...",
            "topic":   "Describe X.",
            "bullets": ["a", "b"],
        }]},
    )
    assert r.status_code == 422
    assert "Part 2" in r.json()["detail"]
    assert sink == []


def test_mixed_list_str_and_cue_card_accepted(monkeypatch, client):
    """A defensive test: the Pydantic union accepts a mixed list (a
    paste-then-toggle UX could conceivably produce this). Each item
    is normalised through its own branch."""
    sink: list = []
    monkeypatch.setattr(questions_router, "supabase_admin",
                        _stub_supabase(session_part=2, inserted_sink=sink))

    r = client.post(
        "/sessions/sess-1/questions/custom",
        json={"questions": [
            {
                "type": "cue_card",
                "prompt": "Describe X. ...",
                "topic": "Describe X.",
                "bullets": ["a", "b"],
            },
            "And how about you?",
        ]},
    )
    assert r.status_code == 200
    assert len(sink) == 2
    assert sink[0]["question_type"] == "cue_card"
    assert sink[1]["question_type"] == "custom"
    assert sink[1]["cue_card_bullets"] is None


def test_cue_card_missing_prompt_returns_422(monkeypatch, client):
    """Pydantic validates `prompt` as min_length=1. Empty prompt is
    a client bug, not a content choice — surface as 422 not silent skip."""
    monkeypatch.setattr(questions_router, "supabase_admin",
                        _stub_supabase(session_part=2))

    r = client.post(
        "/sessions/sess-1/questions/custom",
        json={"questions": [{
            "type": "cue_card", "prompt": "", "topic": "", "bullets": [],
        }]},
    )
    assert r.status_code == 422


def test_empty_questions_list_returns_422(monkeypatch, client):
    monkeypatch.setattr(questions_router, "supabase_admin",
                        _stub_supabase(session_part=1))
    r = client.post("/sessions/sess-1/questions/custom",
                    json={"questions": []})
    assert r.status_code == 422


def test_order_num_is_sequential_across_mixed_types(monkeypatch, client):
    """`order_num` drives the practice-page question carousel. Mixed
    cue-card-then-string lists must still get 1, 2, 3, … not skip."""
    sink: list = []
    monkeypatch.setattr(questions_router, "supabase_admin",
                        _stub_supabase(session_part=2, inserted_sink=sink))

    r = client.post(
        "/sessions/sess-1/questions/custom",
        json={"questions": [
            {"type": "cue_card", "prompt": "Describe A.",
             "topic": "A", "bullets": ["x", "y"]},
            "Follow-up question?",
        ]},
    )
    assert r.status_code == 200
    assert [row["order_num"] for row in sink] == [1, 2]
