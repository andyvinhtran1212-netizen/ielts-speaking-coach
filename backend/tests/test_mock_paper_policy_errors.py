"""Policy conflicts disclose dependency details only on operator routes."""
import asyncio
import json

import pytest
from starlette.requests import Request

from services.mock_paper_policy import database_policy_error


@pytest.mark.parametrize("reason,status", [
    ("protected_dependency", 409),
    ("verification_unavailable", 503),
])
@pytest.mark.parametrize("path,operator", [
    ("/api/admin/exam-content/reading/paper/status", True),
    ("/admin/reading/content/tests/paper", True),
    ("/api/reading/test/share/TOK/boot", False),
    ("/api/listening/tests/paper/dictation", False),
])
def test_marker_handler_preserves_operator_conflict_and_redacts_student_dependencies(reason, status, path, operator):
    from main import unhandled_exception_handler

    detail = {
        "operation": "status", "reason": reason, "kind": "reading",
        "content_id": "PRIVATE-PAPER", "current_revision": 7,
        "dependencies": [{"type": "mock_exam", "id": "PRIVATE-EXAM", "reason": "planned_mock"}],
        "next_actions": ["inspect_policy"],
    }
    request = Request({"type": "http", "path": path, "method": "PATCH", "headers": []})
    error = RuntimeError("P0001: mock_paper_policy:" + json.dumps(detail))
    response = asyncio.run(unhandled_exception_handler(request, error))
    body = json.loads(response.body)
    assert response.status_code == status
    if operator:
        assert body == {"detail": detail}
    else:
        assert body == {"detail": {
            "operation": "paper_access",
            "reason": "verification_unavailable" if status == 503 else "paper_unavailable",
            "next_actions": ["retry"],
        }}
        assert b"PRIVATE-PAPER" not in response.body
        assert b"PRIVATE-EXAM" not in response.body


@pytest.mark.parametrize("message", [
    '{"reason":"protected_dependency"}',
    'mock_paper_policy_error:{"reason":"protected_dependency"}',
    'mock_paper_policy:{"dependencies":[]}',
    'mock_paper_policy:[{"reason":"protected_dependency"}]',
    "mock_paper_policy:invalid-json",
])
def test_noncontract_database_errors_are_not_reclassified(message):
    assert database_policy_error(RuntimeError(message)) is None
