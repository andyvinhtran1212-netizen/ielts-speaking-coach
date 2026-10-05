"""Practice window delivery must prove practice access before reading payloads."""
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import HTTPException

from routers import listening


PAPER = "11111111-1111-4111-8111-111111111111"
USER = "22222222-2222-4222-8222-222222222222"


class PolicyDB:
    def __init__(self, decision):
        self.decision = decision
        self.rpc_calls = []
        self.paper = {"id": PAPER, "status": "published", "test_type": "practice",
                      "scoring_policy": "diagnostic", "metadata": {}}

    def table(self, name):
        assert name == "listening_tests", "content payload was queried before purpose authorization"
        return self

    def select(self, *_args): return self
    def eq(self, *_args): return self
    def limit(self, *_args): return self
    def execute(self): return SimpleNamespace(data=[self.paper])

    def rpc(self, name, params):
        assert name == "fn_resolve_mock_paper_access"
        self.rpc_calls.append(params)
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=self.decision))


def arrange(monkeypatch, decision):
    db = PolicyDB(decision)
    monkeypatch.setattr(listening, "supabase_admin", db)
    monkeypatch.setattr(listening, "_require_auth", AsyncMock(return_value={"id": USER}))
    payloads = Mock(return_value=[{"payload": {"audio_windows": {
        "1": {"start": 3.5, "end": 9}, "2": {"start": 12, "end": 18.5}},
        "answers": ["private key"], "transcript": "private transcript"}}])
    monkeypatch.setattr(listening, "_practice_exercise_payloads", payloads)
    return db, payloads


@pytest.mark.asyncio
@pytest.mark.parametrize("reservation", ["draft_planned_mock", "future_published_mock"])
async def test_reserved_private_practice_windows_denied_before_payload_read(monkeypatch, reservation):
    db, payloads = arrange(monkeypatch, {"allowed": False, "reason": reservation})

    with pytest.raises(HTTPException) as error:
        await listening.get_practice_audio_windows(PAPER, authorization="Bearer owner")

    assert error.value.status_code == 404
    assert db.rpc_calls == [{"p_skill": "listening", "p_test_id": PAPER, "p_user_id": USER,
        "p_purpose": "practice", "p_class_item_id": None, "p_sitting_id": None,
        "p_allow_admission": False}]
    payloads.assert_not_called()


@pytest.mark.asyncio
async def test_authorized_practice_windows_preserve_timings_and_strip_private_content(monkeypatch):
    db, payloads = arrange(monkeypatch, {"allowed": True, "attempt_purpose": "practice"})

    result = await listening.get_practice_audio_windows(PAPER, authorization="Bearer owner")

    assert result == {"test_id": PAPER, "windows": {
        "1": {"start": 3.5, "end": 9}, "2": {"start": 12, "end": 18.5}}}
    assert db.rpc_calls[0]["p_purpose"] == "practice"
    payloads.assert_called_once_with(PAPER)


@pytest.mark.asyncio
@pytest.mark.parametrize("test_type,scoring_policy,status,expected", [
    ("full", "diagnostic", "published", 422),
    ("mini", "diagnostic", "published", 422),
    ("drill", "diagnostic", "published", 422),
    ("practice", "report_only", "published", 422),
    ("practice", "diagnostic", "draft", 404),
])
async def test_practice_windows_preserve_existing_type_and_publication_gates(
        monkeypatch, test_type, scoring_policy, status, expected):
    db, payloads = arrange(monkeypatch, {"allowed": True, "attempt_purpose": "practice"})
    db.paper.update(test_type=test_type, scoring_policy=scoring_policy, status=status)

    with pytest.raises(HTTPException) as error:
        await listening.get_practice_audio_windows(PAPER, authorization="Bearer owner")

    assert error.value.status_code == expected
    assert db.rpc_calls == []
    payloads.assert_not_called()
