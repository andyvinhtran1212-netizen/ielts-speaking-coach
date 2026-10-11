import asyncio
from unittest.mock import AsyncMock

import pytest
from pydantic import ValidationError

from routers import admin_mock_exams
from services import mock_exam_service


def test_cached_create_client_defaults_to_private_copy_without_explanations(monkeypatch):
    captured = []
    monkeypatch.setattr(admin_mock_exams, "require_admin", AsyncMock(return_value={"id": "admin-1"}))
    monkeypatch.setattr(admin_mock_exams.svc, "admin_create_exam",
                        lambda payload, actor: captured.append((payload, actor)) or {"id": "draft-1"})
    result = asyncio.run(admin_mock_exams.create_exam(
        admin_mock_exams.ExamCreate(code="C1", title="Class mock", reading_test_id="source-1"),
        authorization="Bearer admin"))
    assert result == {"id": "draft-1"}
    assert captured[0][0]["private_content_copy"] is True
    assert captured[0][0]["web_explanation_mode"] == "disabled"
    assert captured[0][1] == "admin-1"
    with pytest.raises(ValidationError):
        admin_mock_exams.ExamCreate(code="C1", title="Class mock", private_content_copy=False)


def test_service_passes_create_only_copy_command_to_one_atomic_rpc(monkeypatch):
    calls = []

    class Result:
        def execute(self):
            return type("Response", (), {"data": {"id": "draft-1", "reading_test_id": "private-1"}})()

    monkeypatch.setattr(mock_exam_service, "supabase_admin", type("DB", (), {
        "rpc": staticmethod(lambda name, args: calls.append((name, args)) or Result()),
    })())
    result = mock_exam_service.admin_create_exam({"code": "C1", "title": "Class mock",
        "reading_test_id": "source-1", "private_content_copy": True, "id": "client-id"}, "admin-1")
    assert result["reading_test_id"] == "private-1"
    assert calls == [("fn_create_mock_exam_with_paper_policy", {"p_payload": {
        "code": "C1", "title": "Class mock", "reading_test_id": "source-1", "private_content_copy": True,
    }, "p_actor_id": "admin-1"})]
    assert "private_content_copy" not in mock_exam_service._EXAM_WRITABLE
