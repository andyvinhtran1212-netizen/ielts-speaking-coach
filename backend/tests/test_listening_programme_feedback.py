"""Reveal-scoped feedback never returns another question's protected key."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from routers import listening as listening_router
from services.listening_programme_feedback import (
    FeedbackUnavailable,
    build_guided_feedback,
)


ROWS = [{"payload": {
    "variant": "programme_form_v1",
    "questions": [
        {"q_num": 1, "response_type": "single_choice", "source_item_id": "one"},
        {"q_num": 2, "response_type": "open_rubric", "source_item_id": "two"},
        {"q_num": 3, "response_type": "single_choice", "source_item_id": "three"},
    ],
    "answers": [
        {"q_num": 1, "answers": ["B"]},
        {"q_num": 3, "answers": ["SECRET_THREE"]},
    ],
    "solutions": {
        "1": {"rationale": "The speaker says B.", "other_secret": "do not send"},
        "3": {"rationale": "Hidden rationale"},
    },
    "self_review": {
        "2": {"reference_answers": ["The train is late."],
              "required_facts": ["train", "late"],
              "rationale": "Compare the two key facts.",
              "scoring_rule": "SECRET_TEACHER_RUBRIC"},
    },
    "audio_windows": {
        "1": {"start": 2, "end": 5},
        "2": {"start": 6, "end": 9},
    },
    "controlled_transcripts": {"stimulus": [{"text": "SECRET_TRANSCRIPT"}]},
}}]


def test_objective_reveal_is_one_question_only():
    item = build_guided_feedback(1, "A", ROWS, "allowed")
    assert item["state"] == "checked"
    assert item["correct"] is False
    assert item["expected"] == ["B"]
    assert item["audio_window"] == {"start": 2, "end": 5}
    assert item["rationale"] == "The speaker says B."
    assert "SECRET_THREE" not in str(item)
    assert "SECRET_TRANSCRIPT" not in str(item)
    assert "other_secret" not in str(item)


def test_text_reveal_is_unscored_and_once_policy_hides_window():
    item = build_guided_feedback(2, "It is delayed", ROWS, "once")
    assert item["state"] == "unscored"
    assert item["correct"] is None
    assert item["reference_answers"] == ["The train is late."]
    assert item["required_facts"] == ["train", "late"]
    assert item["audio_window"] is None
    assert "SECRET_TEACHER_RUBRIC" not in str(item)


def test_missing_key_or_self_review_fails_without_feedback():
    broken = [{"payload": {"variant": "programme_form_v1", "questions": [
        {"q_num": 1, "response_type": "single_choice"},
        {"q_num": 2, "response_type": "written"},
    ]}}]
    with pytest.raises(FeedbackUnavailable):
        build_guided_feedback(1, "A", broken, "allowed")
    with pytest.raises(FeedbackUnavailable):
        build_guided_feedback(2, "text", broken, "allowed")
    with pytest.raises(FeedbackUnavailable):
        build_guided_feedback(99, "text", ROWS, "allowed")


def _route_context(monkeypatch, *, rpc_error: str | None = None):
    attempt_id = uuid4()
    calls: list[tuple[str, object]] = []

    async def auth(_authorization):
        return {"id": "owner-id"}

    def fetch(_attempt_id, user_id):
        calls.append(("owner", user_id))
        return {"id": str(attempt_id), "test_id": "test-id"}

    class Query:
        def select(self, *_args): return self
        def eq(self, *_args): return self
        def order(self, *_args): return self
        def execute(self):
            return SimpleNamespace(data=[{
                "q_num": 1, "first_answer": "A",
                "revealed_at": "2026-09-23T09:00:00+00:00",
            }])

    class Rpc:
        def execute(self):
            if rpc_error:
                raise RuntimeError(rpc_error)
            return SimpleNamespace(data=[{
                "first_answer": "A",
                "revealed_at": "2026-09-23T09:00:00+00:00",
                "was_created": True,
            }])

    class Admin:
        def table(self, name):
            calls.append(("table", name))
            return Query()

        def rpc(self, name, args):
            calls.append(("rpc", (name, args)))
            return Rpc()

    monkeypatch.setattr(listening_router, "_require_auth", auth)
    monkeypatch.setattr(listening_router, "_fetch_attempt_or_404", fetch)
    monkeypatch.setattr(
        listening_router, "_programme_guided_context",
        lambda _attempt: ({"replay_policy": "allowed"}, ROWS),
    )
    monkeypatch.setattr(listening_router, "supabase_admin", Admin())
    return attempt_id, calls


def test_reveal_route_returns_only_requested_question_after_owner_gate(monkeypatch):
    attempt_id, calls = _route_context(monkeypatch)
    result = asyncio.run(listening_router.reveal_listening_programme_question(
        attempt_id, 1, authorization="Bearer fixture",
    ))
    assert calls[0] == ("owner", "owner-id")
    assert calls[1][0] == "rpc"
    assert result["assisted"] is True
    assert [item["q_num"] for item in result["items"]] == [1]
    assert "SECRET_THREE" not in str(result)
    assert "SECRET_TRANSCRIPT" not in str(result)


def test_guided_state_returns_only_persisted_reveals(monkeypatch):
    attempt_id, calls = _route_context(monkeypatch)
    result = asyncio.run(listening_router.get_listening_programme_guided_state(
        attempt_id, authorization="Bearer fixture",
    ))
    assert calls[0] == ("owner", "owner-id")
    assert result["assisted"] is True
    assert len(result["items"]) == 1
    assert result["items"][0]["first_answer"] == "A"


def test_failed_answer_save_cannot_reveal_key(monkeypatch):
    attempt_id, _calls = _route_context(
        monkeypatch, rpc_error="listening_programme_feedback_answer_required",
    )
    with pytest.raises(HTTPException) as error:
        asyncio.run(listening_router.reveal_listening_programme_question(
            attempt_id, 1, authorization="Bearer fixture",
        ))
    assert error.value.status_code == 422
    assert "SECRET_THREE" not in str(error.value.detail)


def test_guided_payload_lookup_excludes_unpublished_children(monkeypatch):
    calls = []

    class Query:
        def __init__(self, table): self.table = table
        def select(self, *_args): return self
        def eq(self, name, value): calls.append((self.table, name, value)); return self
        def in_(self, name, value): calls.append((self.table, name, value)); return self
        def execute(self):
            return SimpleNamespace(data=[{"id": "section-1"}] if self.table == "listening_content" else ROWS)

    class Admin:
        def table(self, name): return Query(name)

    monkeypatch.setattr(listening_router, "supabase_admin", Admin())
    assert listening_router._practice_exercise_payloads("test-id", published_only=True) == ROWS
    assert ("listening_content", "status", "published") in calls
    assert ("listening_exercises", "status", "published") in calls
