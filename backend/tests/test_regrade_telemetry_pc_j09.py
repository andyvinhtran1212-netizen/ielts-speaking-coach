"""PC-J09 — Speaking regrade telemetry (S3), Speaking ledger fields (BL-09) and
the Writing revoke lane (BL-23).

S3: an admin regrade must leave the same grading_events audit trail as live
grading (routers/grading.py), success or failure, with per-attempt latency.
BL-09: every Speaking grading provider call writes its ai_usage_logs row with
usage_event_id (distinct per call), request_id and latency_ms.
BL-23: revoking a returned essay puts it back in the "Chờ trả" lane (reviewed),
never "Cần duyệt" (graded), while W-ASSIGN-STATUS (#1740) still steps the
assignment delivered → graded.
"""

from __future__ import annotations

import asyncio
import logging
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from services.grading_providers.errors import AllProvidersFailedError, FallbackEvent  # noqa: E402

_SESSION = "00000000-0000-0000-0000-0000000000a1"
_QUESTION = "00000000-0000-0000-0000-0000000000b2"
_RESPONSE = "00000000-0000-0000-0000-0000000000c3"
_USER = "00000000-0000-0000-0000-0000000000d4"

_EVENTS = [
    FallbackEvent(provider="anthropic_primary", attempt=0, outcome="retryable_error",
                  latency_ms=1200, error_status="529", error_type="APIStatusError"),
    FallbackEvent(provider="grading_primary", attempt=0, outcome="success", latency_ms=845),
]


def _resp() -> dict:
    return {
        "id": _RESPONSE, "session_id": _SESSION, "question_id": _QUESTION,
        "transcript": "I really enjoy hiking with my friends on weekends because it relaxes me.",
        "regrade_count": 1,
    }


def _session() -> dict:
    return {"id": _SESSION, "part": 1, "mode": "practice", "user_id": _USER}


class _Recorder:
    """grading_events insert sink for services.grading_telemetry.supabase_admin."""

    def __init__(self):
        self.rows: list[dict] = []
        self.tables: list[str] = []

    def table(self, name):
        self.tables.append(name)
        recorder = self

        class _T:
            def insert(self, rows):
                recorder.rows.extend(rows)
                return SimpleNamespace(execute=lambda: SimpleNamespace(data=rows))
        return _T()


def _run_regrade(grade_side_effect, recorder):
    from routers import admin

    async def _grade(**kwargs):
        sink = kwargs["fallback_events"]
        sink.extend(_EVENTS)
        if isinstance(grade_side_effect, BaseException):
            raise grade_side_effect
        return dict(grade_side_effect)

    with patch.object(admin, "_claude_grade", new=_grade), \
         patch.object(admin, "_reattach_pronunciation_for_regrade", new=lambda *a, **k: None), \
         patch.object(admin, "supabase_admin", MagicMock()), \
         patch("services.grading_telemetry.supabase_admin", recorder):
        return asyncio.run(admin._run_regrade_response(_resp(), _session(), "Do you like hiking?", "admin@x"))


def test_s3_regrade_writes_grading_events_with_latency(caplog):
    recorder = _Recorder()
    caplog.set_level(logging.INFO, logger="routers.admin")
    result = _run_regrade({"overall_band": 6.5}, recorder)

    assert result["overall_band"] == 6.5
    assert recorder.tables == ["grading_events"]
    assert [(r["provider"], r["outcome"], r["latency_ms"]) for r in recorder.rows] == [
        ("anthropic_primary", "retryable_error", 1200),
        ("grading_primary", "success", 845),
    ]
    for row in recorder.rows:
        assert row["session_id"] == _SESSION
        assert row["question_id"] == _QUESTION
        assert row["response_id"] == _RESPONSE
        assert row["event_kind"] == "grading"
    line = next(r.getMessage() for r in caplog.records if "graded response=" in r.getMessage())
    assert "outcome=success" in line and "latency_ms=" in line and "attempts=2" in line


def test_s3_failed_regrade_still_writes_grading_events():
    """The audit trail matters most when every provider failed."""
    recorder = _Recorder()
    with pytest.raises(AllProvidersFailedError):
        _run_regrade(AllProvidersFailedError(events=list(_EVENTS)), recorder)
    assert len(recorder.rows) == 2
    assert all(r["response_id"] == _RESPONSE and r["latency_ms"] > 0 for r in recorder.rows)


def test_s3_telemetry_failure_never_blocks_the_regrade():
    """Best-effort, as in live grading: a failing grading_events insert is logged."""
    broken = MagicMock()
    broken.table.return_value.insert.return_value.execute.side_effect = RuntimeError("db down")
    result = _run_regrade({"overall_band": 7.0}, broken)
    assert result["overall_band"] == 7.0


# ── BL-09 — Speaking provider ledger fields ─────────────────────────────────


def _claude(response=None, side_effect=None):
    from services.grading_providers.claude import ClaudeHaikuProvider

    client = MagicMock()
    client.beta.prompt_caching.messages.create = AsyncMock(return_value=response, side_effect=side_effect)
    return ClaudeHaikuProvider(client=client)


def _claude_response(text='{"overall_band": 6.5}'):
    return SimpleNamespace(
        content=[SimpleNamespace(text=text)],
        usage=SimpleNamespace(input_tokens=10, output_tokens=20,
                              cache_read_input_tokens=0, cache_creation_input_tokens=0),
    )


def _gemini(response=None, side_effect=None):
    from services.grading_providers.gemini import GeminiProvider

    model = MagicMock()
    model.generate_content_async = AsyncMock(return_value=response, side_effect=side_effect)
    return GeminiProvider(model=model)


async def _invoke_in_request(provider, request_id="req-bl09"):
    from services.request_context import request_id_scope

    with request_id_scope(request_id):
        return await provider.invoke("sys", "user", user_id=_USER, session_id=_SESSION)


def _capture(monkeypatch, *names):
    import services.ai_usage_logger as usage_logger

    logged: list[dict] = []

    async def _log(**kwargs):
        logged.append(kwargs)
    for name in names:
        monkeypatch.setattr(usage_logger, name, _log)
    return logged


def _assert_ledger_fields(row, request_id="req-bl09"):
    assert row["feature"] == "speaking_grading"
    assert row["request_id"] == request_id
    assert isinstance(row["latency_ms"], int) and row["latency_ms"] >= 0
    assert row["usage_event_id"].startswith("speaking_grading:")


def test_bl09_claude_success_and_failure_rows_carry_ledger_fields(monkeypatch):
    from services.grading_providers import RetryableError

    logged = _capture(monkeypatch, "log_claude_async", "log_unpriced_usage_async")

    async def scenario():
        await _invoke_in_request(_claude(_claude_response()))
        await _invoke_in_request(_claude(_claude_response()))
        from tests.test_grading_providers import _fake_anthropic_status_error
        with pytest.raises(RetryableError):
            await _invoke_in_request(_claude(side_effect=_fake_anthropic_status_error(529)))
        await asyncio.sleep(0)
    asyncio.run(scenario())

    assert [row["status"] for row in logged] == ["success", "success", "error"]
    for row in logged:
        _assert_ledger_fields(row)
        assert ":claude_haiku:" in row["usage_event_id"]
    # The ledger dedupes on usage_event_id: calls must never share one.
    assert len({row["usage_event_id"] for row in logged}) == 3


def test_bl09_gemini_success_and_failure_rows_carry_ledger_fields(monkeypatch):
    from google.api_core import exceptions as gexc
    from services.grading_providers import RetryableError

    logged = _capture(monkeypatch, "log_gemini_async", "log_unpriced_usage_async")
    ok = SimpleNamespace(text='{"overall_band": 7.0}',
                         usage_metadata=SimpleNamespace(prompt_token_count=15, candidates_token_count=25))

    async def scenario():
        await _invoke_in_request(_gemini(ok))
        with pytest.raises(RetryableError):
            await _invoke_in_request(_gemini(side_effect=gexc.ServiceUnavailable("503")))
        await asyncio.sleep(0)
    asyncio.run(scenario())

    assert [row["status"] for row in logged] == ["success", "error"]
    for row in logged:
        _assert_ledger_fields(row)
    assert len({row["usage_event_id"] for row in logged}) == 2


def test_bl09_background_call_has_no_request_id(monkeypatch):
    logged = _capture(monkeypatch, "log_claude_async")

    async def scenario():
        await _claude(_claude_response()).invoke("sys", "user", user_id=_USER, session_id=_SESSION)
        await asyncio.sleep(0)
    asyncio.run(scenario())

    assert logged[0]["request_id"] is None
    assert logged[0]["usage_event_id"] and logged[0]["latency_ms"] >= 0


def test_bl09_request_id_middleware_scopes_the_grading_request():
    """The X-Request-ID the response echoes is what providers below the route
    read, including inside tasks the route spawns (grading runs in tasks)."""
    from fastapi.testclient import TestClient
    from main import app
    from services.request_context import current_request_id

    seen: dict = {}

    async def _route():
        seen["route"] = current_request_id()
        seen["task"] = await asyncio.create_task(asyncio.sleep(0, result=current_request_id()))
        return {}

    app.add_api_route("/__pc_j09_request_id", _route, methods=["GET"])
    try:
        response = TestClient(app).get("/__pc_j09_request_id", headers={"X-Request-ID": "req-from-client"})
    finally:
        app.router.routes = [r for r in app.router.routes if getattr(r, "path", "") != "/__pc_j09_request_id"]
    assert response.headers["X-Request-ID"] == "req-from-client"
    assert seen == {"route": "req-from-client", "task": "req-from-client"}
    assert current_request_id() is None


# ── BL-23 — revoke lane (+ W-ASSIGN-STATUS #1740) ───────────────────────────

_ESSAY = "00000000-0000-0000-0000-0000000000e5"
_REVIEW = "00000000-0000-0000-0000-0000000000f6"
_TEACHER = "00000000-0000-0000-0000-0000000000a7"


class _Store:
    """Tiny stateful PostgREST stand-in: select/update with eq filters."""

    def __init__(self, tables: dict[str, list[dict]]):
        self.tables = tables

    def table(self, name):
        return _StoreQuery(self.tables.setdefault(name, []))


class _StoreQuery:
    def __init__(self, rows):
        self.rows, self.filters, self.payload = rows, [], None

    def select(self, *_a, **_k): return self
    def update(self, payload): self.payload = payload; return self
    def eq(self, column, value): self.filters.append((column, str(value))); return self
    def is_(self, *_a, **_k): return self
    def limit(self, *_a, **_k): return self

    def execute(self):
        hits = [r for r in self.rows if all(str(r.get(c)) == v for c, v in self.filters)]
        if self.payload is not None:
            for row in hits:
                row.update(self.payload)
        return SimpleNamespace(data=[dict(r) for r in hits])


def test_bl23_admin_revoke_returns_the_essay_to_the_awaiting_return_lane():
    from fastapi.testclient import TestClient
    from main import app

    store = _Store({
        "writing_essays": [{"id": _ESSAY, "status": "delivered", "delivered_at": "2026-10-28T03:00:00Z",
                            "grading_tier": "instructor"}],
        "writing_assignments": [{"id": "wa-1", "essay_id": _ESSAY, "status": "delivered",
                                 "graded_at": "2026-10-28T02:00:00Z", "delivered_at": "2026-10-28T03:00:00Z"}],
        "instructor_reviews": [{"id": _REVIEW, "essay_id": _ESSAY, "status": "delivered",
                                "claimed_by": _TEACHER, "claimed_at": "2026-10-28T02:30:00Z",
                                "delivered_at": "2026-10-28T03:00:00Z",
                                "created_at": "2026-10-28T02:00:00Z", "updated_at": "2026-10-28T03:00:00Z"}],
    })
    with patch("routers.admin_writing.require_admin", new=AsyncMock(return_value={"id": "admin-1"})), \
         patch("routers.admin_writing.supabase_admin", store), \
         patch("services.instructor_workflow.supabase_admin", store), \
         patch("services.writing_assignment_status_sync.supabase_admin", store), \
         patch("routers.admin_writing.note_writing_mutation"), \
         patch("routers.admin_writing.observe_writing_batch", new=AsyncMock()):
        r = TestClient(app).post(f"/admin/writing/essays/{_ESSAY}/revoke-delivery", json={},
                                 headers={"Authorization": "Bearer x"})

    assert r.status_code == 200, r.text
    essay = store.tables["writing_essays"][0]
    # Queue lanes are pure essay.status (fn_admin_writing_queue_page):
    # reviewed = "Chờ trả", graded = "Cần duyệt".
    assert essay["status"] == "reviewed"
    assert essay["delivered_at"] is None
    # W-ASSIGN-STATUS (#1740): the assignment leaves 'delivered' for 'graded',
    # keeping graded_at; the review returns to the same instructor's queue.
    assignment = store.tables["writing_assignments"][0]
    assert (assignment["status"], assignment["delivered_at"], assignment["graded_at"]) == (
        "graded", None, "2026-10-28T02:00:00Z")
    review = store.tables["instructor_reviews"][0]
    assert (review["status"], review["claimed_by"], review["delivered_at"]) == ("claimed", _TEACHER, None)
