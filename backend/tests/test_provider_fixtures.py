"""Deterministic provider fixture mode (plan Phase 0 / B2).

Pins:
  * fixture payloads are production-shaped (superset of the grader's
    _REQUIRED_FIELDS / _REQUIRED_FIELDS_PRACTICE, Whisper + Azure shapes)
  * the startup guard ABORTS fixture mode on production env/project
  * fault injection raises the same failure surface the pipeline handles
  * the three seams (whisper / grader / azure) return fixtures without
    touching the network when GRADING_PROVIDER_MODE=fixture
"""

from __future__ import annotations

import asyncio

import pytest

from config import settings
from services import provider_fixtures
from services.grading_providers.errors import AllProvidersFailedError


@pytest.fixture(autouse=True)
def _reset_mode(monkeypatch):
    monkeypatch.setattr(settings, "GRADING_PROVIDER_MODE", "real")
    monkeypatch.setattr(settings, "GRADING_FIXTURE_FAULT", "")
    yield


# ── Payload shapes ─────────────────────────────────────────────────────


def test_test_mode_payload_satisfies_required_fields():
    from services.claude_grader import _REQUIRED_FIELDS
    payload = provider_fixtures.fixture_speaking_grade("test")
    for field, typ in _REQUIRED_FIELDS.items():
        assert field in payload, f"fixture missing required field {field}"
        assert isinstance(payload[field], typ), f"{field} has wrong type"


def test_practice_mode_payload_satisfies_required_fields():
    from services.claude_grader import _REQUIRED_FIELDS_PRACTICE
    payload = provider_fixtures.fixture_speaking_grade("practice")
    for field, typ in _REQUIRED_FIELDS_PRACTICE.items():
        assert field in payload, f"fixture missing required practice field {field}"
        assert isinstance(payload[field], typ), f"{field} has wrong type"


def test_transcription_shape():
    out = provider_fixtures.fixture_transcription()
    for key in ("transcript", "duration_seconds", "language", "confidence",
                "transcript_model", "segments"):
        assert key in out
    assert out["segments"] and {"start", "end", "text", "avg_logprob",
                                "no_speech_prob"} <= set(out["segments"][0])


def test_pronunciation_shape():
    out = provider_fixtures.fixture_pronunciation()
    for key in ("pronunciation_score", "fluency_score", "accuracy_score",
                "completeness_score", "words", "weak_phonemes",
                "short_summary", "raw_payload"):
        assert key in out


# ── Startup guard: fixture mode fails closed on production ────────────


def test_guard_blocks_production_environment(monkeypatch):
    monkeypatch.setattr(settings, "GRADING_PROVIDER_MODE", "fixture")
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")
    monkeypatch.setattr(settings, "SUPABASE_URL", "https://zjphffoujxkpltixsbzj.supabase.co")
    with pytest.raises(RuntimeError, match="FORBIDDEN"):
        provider_fixtures.assert_fixture_mode_safe()


def test_guard_blocks_production_supabase_project(monkeypatch):
    monkeypatch.setattr(settings, "GRADING_PROVIDER_MODE", "fixture")
    monkeypatch.setattr(settings, "ENVIRONMENT", "staging")
    monkeypatch.setattr(settings, "SUPABASE_URL", "https://huwsmtubwulikhlmcirx.supabase.co")
    with pytest.raises(RuntimeError, match="FORBIDDEN"):
        provider_fixtures.assert_fixture_mode_safe()


def test_guard_allows_staging_fixture_and_production_real(monkeypatch):
    monkeypatch.setattr(settings, "GRADING_PROVIDER_MODE", "fixture")
    monkeypatch.setattr(settings, "ENVIRONMENT", "staging")
    monkeypatch.setattr(settings, "SUPABASE_URL", "https://zjphffoujxkpltixsbzj.supabase.co")
    provider_fixtures.assert_fixture_mode_safe()  # no raise

    monkeypatch.setattr(settings, "GRADING_PROVIDER_MODE", "real")
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")
    monkeypatch.setattr(settings, "SUPABASE_URL", "https://huwsmtubwulikhlmcirx.supabase.co")
    provider_fixtures.assert_fixture_mode_safe()  # no raise


# ── Fault injection ────────────────────────────────────────────────────


def test_fault_timeout(monkeypatch):
    monkeypatch.setattr(settings, "GRADING_FIXTURE_FAULT", "timeout")
    with pytest.raises(asyncio.TimeoutError):
        provider_fixtures.fixture_speaking_grade("test")


@pytest.mark.parametrize("fault", ["429", "5xx"])
def test_fault_provider_failure(monkeypatch, fault):
    monkeypatch.setattr(settings, "GRADING_FIXTURE_FAULT", fault)
    with pytest.raises(AllProvidersFailedError):
        provider_fixtures.fixture_speaking_grade("test")


def test_fault_malformed(monkeypatch):
    from services.claude_grader import _REQUIRED_FIELDS
    monkeypatch.setattr(settings, "GRADING_FIXTURE_FAULT", "malformed")
    payload = provider_fixtures.fixture_speaking_grade("test")
    missing = [f for f in _REQUIRED_FIELDS if f not in payload]
    assert missing, "malformed fault must drop required fields"


# ── Seams return fixtures without network in fixture mode ─────────────


@pytest.mark.asyncio
async def test_whisper_seam(monkeypatch):
    monkeypatch.setattr(settings, "GRADING_PROVIDER_MODE", "fixture")
    from services.whisper import transcribe_from_bytes
    out = await transcribe_from_bytes(b"not-real-audio", "e2e.webm")
    assert out["transcript_model"] == "fixture"


@pytest.mark.asyncio
async def test_grader_seam_runs_validator_and_postprocessing(monkeypatch):
    monkeypatch.setattr(settings, "GRADING_PROVIDER_MODE", "fixture")
    from services.claude_grader import grade_response
    out = await grade_response(question="Q?", transcript="hello", part=1, mode="test")
    assert out["rubric_version"] == "fixture-v1"
    assert out["band_fc"] == 6


@pytest.mark.asyncio
async def test_grader_seam_practice_attaches_grammar_recommendations(monkeypatch):
    # Review 2026-07-13: the fixture is injected at the RAW level so the real
    # practice post-processing runs — grading.py persists this key to the
    # grammar_recommendations table, which is exactly what E2E must exercise.
    monkeypatch.setattr(settings, "GRADING_PROVIDER_MODE", "fixture")
    from services.claude_grader import grade_response
    out = await grade_response(question="Q?", transcript="hello", part=1, mode="practice")
    assert "grammar_recommendations" in out, "practice post-processing must run on fixtures"


@pytest.mark.asyncio
async def test_grader_seam_malformed_walks_terminal_path(monkeypatch):
    # malformed fixture fails the REAL validator on both attempts -> the
    # production terminal ValueError, not a synthetic shortcut.
    monkeypatch.setattr(settings, "GRADING_PROVIDER_MODE", "fixture")
    monkeypatch.setattr(settings, "GRADING_FIXTURE_FAULT", "malformed")
    from services.claude_grader import grade_response
    with pytest.raises(ValueError):
        await grade_response(question="Q?", transcript="hello", part=1, mode="test")


@pytest.mark.asyncio
async def test_azure_seam(monkeypatch):
    monkeypatch.setattr(settings, "GRADING_PROVIDER_MODE", "fixture")
    from services.azure_pronunciation import assess_pronunciation
    out = await assess_pronunciation(b"not-real-audio")
    assert out["raw_payload"] == {"fixture": True}
    assert out["pronunciation_score"] == 78.0


@pytest.mark.asyncio
async def test_off_topic_judge_seam(monkeypatch):
    # The judge is a REAL Haiku call outside fixture mode; on the fixed
    # transcript it can rule off-topic and skew the fixture band (observed
    # live on staging: 6.0 -> 5). Fixture mode pins it on-topic.
    monkeypatch.setattr(settings, "GRADING_PROVIDER_MODE", "fixture")
    from services.off_topic_judge import get_judge
    verdict = await get_judge().judge(
        question="Do you enjoy your work?", transcript="hello", part_num=1,
    )
    assert verdict is not None and verdict.is_on_topic is True


@pytest.mark.asyncio
async def test_grammar_check_seam(monkeypatch):
    monkeypatch.setattr(settings, "GRADING_PROVIDER_MODE", "fixture")
    from services.grammar_check import get_grammar_check_service
    result = await get_grammar_check_service().check("hello world")
    assert result is not None
    assert result.errors == [] and result.total_count == 0
