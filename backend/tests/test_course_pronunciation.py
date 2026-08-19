"""Course B05 pronunciation: content, batching and normalized feedback."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from pydub import AudioSegment

from services import course_pronunciation as cp
from scripts.setup_course_pronunciation import _load


ROOT = Path(__file__).resolve().parents[1]
CONTENT = ROOT / "data" / "course_pronunciation" / "C1-B05.json"
MIGRATION = ROOT / "migrations" / "215_course_pronunciation_submissions.sql"


def _decoded(order: int, *, duration_ms: int = 4_000, text: str | None = None):
    return cp.DecodedRecording(
        sentence={
            "id": f"S{order}",
            "order": order,
            "text": text or f"Sentence number {order}",
        },
        audio=AudioSegment.silent(duration=duration_ms, frame_rate=16_000),
    )


def test_b05_content_has_exactly_twelve_ordered_british_shadowing_sentences():
    data = json.loads(CONTENT.read_text(encoding="utf-8"))
    assert data["bank_code"] == "C1-B05"
    assert data["locale"] == "en-GB"
    assert (data["voice_engine"], data["voice"]) == ("kokoro", "bf_emma")
    assert data["playback_rates"] == [0.85, 1.0]
    assert [row["order"] for row in data["sentences"]] == list(range(1, 13))
    assert len({row["id"] for row in data["sentences"]}) == 12
    assert data["sentences"][0]["text"] == (
        "The air in the mountains is cleaner than the city air."
    )
    assert data["sentences"][-1]["text"] == (
        "The new solar power plant is the largest energy project in the whole northern region."
    )


def test_setup_dry_validation_does_not_need_database_credentials():
    data, content_hash = _load(CONTENT)
    assert data["bank_code"] == "C1-B05"
    assert len(content_hash) == 64


def test_batching_caps_each_azure_call_at_three_sentences():
    batches = cp._pack_batches([_decoded(order) for order in range(1, 13)])
    assert [len(batch) for batch in batches] == [3, 3, 3, 3]


def test_invalid_browser_audio_fails_before_any_azure_call(monkeypatch):
    monkeypatch.setattr(cp.azure_pronunciation, "_convert_to_wav", lambda _data: None)
    with pytest.raises(cp.CoursePronunciationError) as caught:
        cp._decode_recording(
            cp.Recording("S1", b"not-audio", "audio/webm"),
            {"id": "S1", "order": 1, "text": "The air is cleaner."},
        )
    assert caught.value.status_code == 422
    assert "câu 1" in caught.value.message


def test_batching_also_respects_short_audio_limit():
    batches = cp._pack_batches([
        _decoded(1, duration_ms=13_800),
        _decoded(2, duration_ms=13_800),
        _decoded(3, duration_ms=1_000),
    ])
    assert [[item.sentence["order"] for item in batch] for batch in batches] == [
        [1], [2, 3],
    ]
    assert all(
        sum(len(item.audio) for item in batch)
        + cp.SENTENCE_GAP_MS * (len(batch) - 1) <= cp.MAX_BATCH_MS
        for batch in batches
    )


def test_sentence_feedback_marks_omissions_and_weak_words():
    batch = [_decoded(1, text="The air is cleaner"), _decoded(2, text="Buses start earlier")]
    provider = {"words": [
        {"word": "The", "accuracy_score": 92, "error_type": "None", "phonemes": []},
        {"word": "air", "accuracy_score": 66, "error_type": "None", "phonemes": []},
        {"word": "cleaner", "accuracy_score": 81, "error_type": "None", "phonemes": []},
        {"word": "Buses", "accuracy_score": 90, "error_type": "None", "phonemes": []},
        {"word": "start", "accuracy_score": 88, "error_type": "None", "phonemes": []},
        {"word": "earlier", "accuracy_score": 85, "error_type": "None", "phonemes": []},
    ]}
    rows = cp._align_sentence_results(batch, provider)
    assert rows[0]["completeness_score"] == 75.0
    assert [(word["word"], word["error_type"]) for word in rows[0]["weak_words"]] == [
        ("air", "None"), ("is", "Omission"),
    ]
    assert rows[1]["accuracy_score"] == 87.7


@pytest.mark.asyncio
async def test_course_batches_use_strict_british_reading_without_prosody_addon(monkeypatch):
    calls = []

    async def assess(**kwargs):
        calls.append(kwargs)
        return {"pronunciation_score": 80}

    monkeypatch.setattr(cp.azure_pronunciation, "assess_pronunciation", assess)
    batches = [[
        _decoded(1, duration_ms=500, text="The air is cleaner."),
        _decoded(2, duration_ms=500, text="The metro is reliable."),
    ]]
    assert await cp._grade_batches(batches, locale="en-GB") == [
        {"pronunciation_score": 80},
    ]
    assert calls[0]["locale"] == "en-GB"
    assert calls[0]["content_type"] == "audio/wav"
    assert calls[0]["enable_miscue"] is True
    assert calls[0]["enable_prosody"] is False
    assert calls[0]["reference_text"] == (
        "The air is cleaner. The metro is reliable."
    )


def test_migration_keeps_results_service_role_only_and_preserves_history():
    sql = MIGRATION.read_text(encoding="utf-8")
    assert "ALTER TABLE course_pronunciation_sets ENABLE ROW LEVEL SECURITY" in sql
    assert "ALTER TABLE course_pronunciation_submissions ENABLE ROW LEVEL SECURITY" in sql
    assert "UNIQUE (user_id, client_id)" in sql
    assert "course_pronunciation_sets(id) ON DELETE SET NULL" in sql
    assert "CREATE POLICY" not in sql


def test_router_is_mounted_on_the_backend_app():
    main_source = (ROOT / "main.py").read_text(encoding="utf-8")
    assert "course_pronunciation_router" in main_source
    assert "app.include_router(course_pronunciation_router)" in main_source


def test_public_attempt_returns_idempotency_key_without_provider_payloads():
    public = cp._public_attempt({
        "id": "sub-1",
        "client_id": "client-1",
        "status": "completed",
        "results": {"sentences": [], "provider_payloads": [{"private": True}]},
    })
    assert public["client_id"] == "client-1"
    assert "provider_payloads" not in public["results"]


@pytest.mark.asyncio
async def test_two_retries_cannot_both_spend_azure_calls(monkeypatch):
    failed = {"id": "sub-1", "bank_id": "bank-1", "status": "failed"}
    states = iter([failed, {**failed, "status": "processing"}])
    exercise = {
        "id": "set-1", "title": "Shadowing", "locale": "en-GB",
        "provider": "azure", "voice": "bf_emma",
        "sentences": [{"id": "S1", "order": 1, "text": "The air is cleaner."}],
    }

    class EmptyUpdate:
        data = []

    class Query:
        def update(self, _payload): return self
        def eq(self, *_args): return self
        def execute(self): return EmptyUpdate()

    db = type("DB", (), {"table": lambda self, _name: Query()})()
    grade = AsyncMock()
    monkeypatch.setattr(cp, "supabase_admin", db)
    monkeypatch.setattr(cp, "_assignment_item", lambda *_args: {"id": "item-1"})
    monkeypatch.setattr(cp, "_set_for_bank", lambda *_args: exercise)
    monkeypatch.setattr(cp, "_existing_by_client", lambda *_args: next(states))
    monkeypatch.setattr(cp, "_decode_all", lambda *_args: [_decoded(1, text="The air is cleaner.")])
    monkeypatch.setattr(cp, "_grade_batches", grade)

    with pytest.raises(cp.CoursePronunciationError) as caught:
        await cp.submit(
            user_id="user-1", bank_id="bank-1", client_id="client-1",
            recordings=[cp.Recording("S1", b"audio", "audio/webm")],
        )
    assert caught.value.status_code == 409
    grade.assert_not_awaited()
