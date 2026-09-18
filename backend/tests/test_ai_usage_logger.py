import asyncio
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from services import ai_usage_logger


def _db(monkeypatch):
    table = MagicMock()
    table.insert.return_value.execute.return_value = None
    table.upsert.return_value.execute.return_value = None
    db = MagicMock()
    db.table.return_value = table
    monkeypatch.setattr(ai_usage_logger, "supabase_admin", db)
    return table


def test_gemini_row_is_model_aware_and_keeps_thinking_split(monkeypatch):
    table = _db(monkeypatch)
    ai_usage_logger.log_gemini(
        user_id="u1", session_id="s1", model="gemini-3.5-flash",
        input_tokens=100, output_tokens=200, thinking_tokens=300,
        feature="speaking_grading", operation="grade",
    )
    row = table.insert.call_args.args[0]
    assert row["cost_usd_est"] == round((100 * 1.5 + 500 * 9.0) / 1_000_000, 8)
    assert row["output_tokens"] == 200
    assert row["thinking_tokens"] == 300
    assert row["pricing_version"].startswith("google:gemini-3.5-flash:")
    assert row["feature"] == "speaking_grading"


def test_gemini_legacy_sdk_metadata_derives_hidden_thinking_tokens():
    from google.ai.generativelanguage_v1beta.types.generative_service import (
        GenerateContentResponse,
    )

    usage = GenerateContentResponse.UsageMetadata(
        prompt_token_count=100,
        candidates_token_count=50,
        total_token_count=1050,
    )
    assert ai_usage_logger.gemini_usage_tokens(usage) == {
        "input_tokens": 100,
        "output_tokens": 50,
        "thinking_tokens": 900,
    }


def test_error_code_is_persisted_after_ledger_migration(monkeypatch):
    table = _db(monkeypatch)
    ai_usage_logger.log_unpriced_usage(
        service="gemini", model="gemini-2.5-flash",
        status="error", error_code="ServiceUnavailable",
    )
    row = table.insert.call_args.args[0]
    assert row["error_code"] == "ServiceUnavailable"


def test_unknown_model_is_kept_as_unpriced_instead_of_using_wrong_rate(monkeypatch):
    table = _db(monkeypatch)
    ai_usage_logger.log_gemini(
        user_id=None, session_id=None, model="gemini-future",
        input_tokens=100, output_tokens=200,
    )
    row = table.insert.call_args.args[0]
    assert row["cost_usd_est"] is None
    assert row["pricing_version"] is None
    assert row["cost_source"] == "unpriced"


def test_usage_event_id_uses_idempotent_upsert(monkeypatch):
    table = _db(monkeypatch)
    ai_usage_logger.log_whisper(
        user_id="u1", session_id="s1", model="whisper-1",
        audio_seconds=60, usage_event_id="stt:response-1:attempt-1",
    )
    table.upsert.assert_called_once()
    assert table.upsert.call_args.kwargs == {
        "on_conflict": "usage_event_id", "ignore_duplicates": True,
    }
    assert table.insert.call_count == 0


def test_usage_event_unique_index_is_postgrest_compatible():
    sql = (
        Path(__file__).parent.parent / "migrations" / "284_ai_usage_ledger.sql"
    ).read_text(encoding="utf-8")
    index_sql = sql.split(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_usage_event_id", 1,
    )[1].split(";", 1)[0].lower()
    assert "on ai_usage_logs (usage_event_id)" in index_sql
    assert " where " not in index_sql


def test_unpriced_provider_keeps_raw_reconciliation_units(monkeypatch):
    table = _db(monkeypatch)
    ai_usage_logger.log_unpriced_usage(
        service="azure_speech", model="pronunciation-assessment",
        audio_seconds=12.5, feature="pronunciation",
        metadata={"locale": "en-US", "prosody": True},
    )
    row = table.insert.call_args.args[0]
    assert row["cost_source"] == "unpriced"
    assert row["audio_seconds"] == 12.5
    assert row["metadata"]["prosody"] is True


def test_ledger_failure_warns_but_does_not_break_request(monkeypatch, caplog):
    db = MagicMock()
    db.table.side_effect = RuntimeError("db unavailable")
    monkeypatch.setattr(ai_usage_logger, "supabase_admin", db)
    ai_usage_logger.log_tts(
        user_id="u1", session_id=None, model="tts-1", text_chars=10,
    )
    assert "ledger write failed" in caplog.text


def test_elevenlabs_tts_uses_its_character_price(monkeypatch):
    table = _db(monkeypatch)
    ai_usage_logger.log_tts(
        user_id=None,
        session_id=None,
        service="elevenlabs",
        model="eleven_multilingual_v2",
        text_chars=1_000,
    )
    row = table.insert.call_args.args[0]
    assert row["service"] == "elevenlabs"
    assert row["cost_usd_est"] == 0.10
    assert row["cost_source"] == "catalog_estimate"


def test_unknown_context_is_ignored_without_breaking_user_flow(monkeypatch, caplog):
    table = _db(monkeypatch)
    ai_usage_logger.log_gemini(
        user_id="u1",
        session_id=None,
        model="gemini-2.5-flash",
        input_tokens=10,
        output_tokens=5,
        accidental_field="ignored",
    )
    row = table.insert.call_args.args[0]
    assert "accidental_field" not in row
    assert "ignored unsupported context fields" in caplog.text


def test_missing_migration_retries_with_legacy_columns(monkeypatch, caplog):
    table = _db(monkeypatch)
    error = RuntimeError("Could not find the 'pricing_version' column in schema cache")
    error.code = "PGRST204"
    table.insert.return_value.execute.side_effect = [error, None]

    ai_usage_logger.log_gemini(
        user_id="u1", session_id=None, model="gemini-2.5-flash",
        input_tokens=10, output_tokens=5, feature="question_generation",
    )

    fallback = table.insert.call_args_list[-1].args[0]
    assert "pricing_version" not in fallback
    assert "feature" not in fallback
    assert fallback["input_tokens"] == 10
    assert "legacy-compatible row" in caplog.text


def test_legacy_schema_drops_unpriced_failure_instead_of_inventing_success(
    monkeypatch, caplog,
):
    table = _db(monkeypatch)
    error = RuntimeError("Could not find the 'status' column in schema cache")
    error.code = "PGRST204"
    table.insert.return_value.execute.side_effect = error

    ai_usage_logger.log_unpriced_usage(
        service="gemini",
        model="gemini-2.5-flash",
        status="error",
        error_code="timeout",
    )

    assert table.insert.call_count == 1
    assert "skipped legacy fallback" in caplog.text


def test_legacy_schema_skips_writing_rows_that_feedback_already_supplies(
    monkeypatch, caplog,
):
    table = _db(monkeypatch)
    error = RuntimeError("Could not find the 'feature' column in schema cache")
    error.code = "PGRST204"
    table.upsert.return_value.execute.side_effect = error

    ai_usage_logger.log_gemini(
        user_id="u1",
        session_id=None,
        model="gemini-2.5-pro",
        input_tokens=100,
        output_tokens=50,
        feature="writing_grading",
        usage_event_id="writing:j1:attempt:1:run:r1:pass1:api:1",
    )

    table.upsert.assert_called_once()
    table.insert.assert_not_called()
    assert "skipped legacy fallback" in caplog.text


@pytest.mark.asyncio
async def test_async_logger_uses_async_supabase_client(monkeypatch):
    table = MagicMock()
    table.insert.return_value.execute = AsyncMock(return_value=None)
    client = MagicMock()
    client.table.return_value = table
    monkeypatch.setattr(
        ai_usage_logger, "get_supabase_async", AsyncMock(return_value=client),
    )

    await ai_usage_logger.log_gemini_async(
        user_id="u1", session_id=None, model="gemini-2.5-flash",
        input_tokens=10, output_tokens=5,
    )

    table.insert.assert_called_once()


@pytest.mark.asyncio
async def test_scheduled_usage_write_is_retained_without_blocking_caller():
    started = asyncio.Event()
    release = asyncio.Event()

    async def slow_write():
        started.set()
        await release.wait()

    task = ai_usage_logger.schedule_usage_log(slow_write())
    await started.wait()
    assert not task.done()
    assert task in ai_usage_logger._PENDING_USAGE_TASKS
    release.set()
    await task
    assert task not in ai_usage_logger._PENDING_USAGE_TASKS
