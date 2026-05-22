"""
backend/tests/test_grading_telemetry_event_kind.py — Sprint 14.7

Pin the `event_kind` discriminator added by migration 074. The Sprint
14.3 grading flow writes `event_kind='grading'` (the default); the
Sprint 14.7 off-topic judge writes `event_kind='off_topic_judge'`.
Future workflows extend the table CHECK constraint, but the telemetry
helper signature must already support arbitrary kinds today so the
endpoint can wire them in cheaply.
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock

sys.path.insert(0, str(Path(__file__).parent.parent))

from services import grading_telemetry                              # noqa: E402
from services.grading_providers.errors import FallbackEvent          # noqa: E402


def _capture_insert(monkeypatch):
    """Patch the supabase insert path; return the captured rows."""
    rows_captured: list[dict] = []
    fake_table = MagicMock()
    fake_table.insert.return_value.execute.return_value = MagicMock(data=[])

    def _patched_table(name):
        rows_captured.append({"_table_called": name})  # noqa: P103
        return fake_table

    # Intercept the .insert(...) so we can inspect its argument.
    def _insert(rows):
        rows_captured.extend(rows)
        return MagicMock(execute=MagicMock(return_value=MagicMock(data=[])))

    fake_table.insert = _insert
    monkeypatch.setattr(grading_telemetry.supabase_admin, "table", _patched_table)
    return rows_captured


def test_default_event_kind_is_grading_for_backward_compat(monkeypatch):
    """Sprint 14.3 callers do NOT pass event_kind. Their rows must
    continue to land with event_kind='grading' (matching the migration
    074 column default) so existing analytics queries don't lose
    rows."""
    rows = _capture_insert(monkeypatch)

    grading_telemetry.log_fallback_events(
        session_id="s",
        question_id="q",
        response_id="r",
        events=[FallbackEvent(provider="claude_haiku", attempt=0,
                              outcome="success", latency_ms=100)],
    )
    # First entry is the _table_called marker; second is the actual row.
    rows_only = [r for r in rows if "_table_called" not in r]
    assert len(rows_only) == 1
    assert rows_only[0]["event_kind"] == "grading"


def test_event_kind_off_topic_judge_threaded_through(monkeypatch):
    rows = _capture_insert(monkeypatch)

    grading_telemetry.log_fallback_events(
        session_id="s",
        question_id="q",
        response_id="r",
        events=[FallbackEvent(provider="claude_haiku", attempt=0,
                              outcome="non_retryable", latency_ms=50,
                              error_status="401")],
        event_kind="off_topic_judge",
    )
    rows_only = [r for r in rows if "_table_called" not in r]
    assert len(rows_only) == 1
    assert rows_only[0]["event_kind"] == "off_topic_judge"
    # Other columns preserved (Sprint 14.3 contract).
    assert rows_only[0]["provider"]     == "claude_haiku"
    assert rows_only[0]["outcome"]      == "non_retryable"
    assert rows_only[0]["error_status"] == "401"


def test_empty_events_short_circuits_without_db_write(monkeypatch):
    """log_fallback_events([]) must not call Supabase at all — protects
    the judge's silent-skip path from spurious empty inserts when no
    fallback occurred."""
    called = {"count": 0}

    def _table(_name):
        called["count"] += 1
        return MagicMock()
    monkeypatch.setattr(grading_telemetry.supabase_admin, "table", _table)

    grading_telemetry.log_fallback_events(
        session_id="s", question_id="q", response_id="r", events=[],
        event_kind="off_topic_judge",
    )
    assert called["count"] == 0
