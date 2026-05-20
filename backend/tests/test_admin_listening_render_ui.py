"""Tests for Sprint 13.3 — ElevenLabs render UI backend endpoints.

Pinned contracts:
  - GET /admin/listening/render/feature-flag returns {enabled, message}
    based on LISTENING_AI_RENDER_ENABLED + ELEVENLABS_API_KEY env state.
  - POST /admin/listening/render/validate dry-runs validation + returns
    cost estimate (credits + USD + render seconds). No ElevenLabs call,
    no DB write.
  - POST /admin/listening/render applies the new 100-char script floor
    and returns content_id + estimated_render_seconds in the response.
  - Auth gate (require_admin) on all three.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from routers import listening as listening_router
from tests.test_listening_router import (
    _FakeAdminClient,
    _patch_admin_auth,
    _patch_admin_client,
    _run,
)


# A real ID-like script (~140 chars) that clears the new 100-char floor.
_GOOD_SCRIPT = (
    "The exhibition opens on Saturday at the new convention "
    "centre downtown, and admission will be free throughout "
    "the weekend for residents and visitors alike."
)


# ── GET /render/feature-flag ─────────────────────────────────────────────────


def test_ff_endpoint_returns_enabled_when_flag_and_key_set(monkeypatch):
    _patch_admin_client(monkeypatch, _FakeAdminClient())
    authz = _patch_admin_auth(monkeypatch)
    monkeypatch.setattr(listening_router.settings, "LISTENING_AI_RENDER_ENABLED", True)
    monkeypatch.setattr(listening_router.settings, "ELEVENLABS_API_KEY", "sk_test")

    out = _run(listening_router.admin_render_feature_flag(authorization=authz))
    assert out["enabled"] is True
    assert out["message"] is None


def test_ff_endpoint_returns_disabled_with_message_when_flag_off(monkeypatch):
    _patch_admin_client(monkeypatch, _FakeAdminClient())
    authz = _patch_admin_auth(monkeypatch)
    monkeypatch.setattr(listening_router.settings, "LISTENING_AI_RENDER_ENABLED", False)
    monkeypatch.setattr(listening_router.settings, "ELEVENLABS_API_KEY", "sk_test")

    out = _run(listening_router.admin_render_feature_flag(authorization=authz))
    assert out["enabled"] is False
    assert "LISTENING_AI_RENDER_ENABLED" in (out["message"] or "")


def test_ff_endpoint_returns_disabled_when_key_missing(monkeypatch):
    _patch_admin_client(monkeypatch, _FakeAdminClient())
    authz = _patch_admin_auth(monkeypatch)
    monkeypatch.setattr(listening_router.settings, "LISTENING_AI_RENDER_ENABLED", True)
    monkeypatch.setattr(listening_router.settings, "ELEVENLABS_API_KEY", "")

    out = _run(listening_router.admin_render_feature_flag(authorization=authz))
    assert out["enabled"] is False
    assert "ELEVENLABS_API_KEY" in (out["message"] or "")


# ── POST /render/validate ────────────────────────────────────────────────────


def test_validate_happy_path_returns_cost_estimate(monkeypatch):
    _patch_admin_client(monkeypatch, _FakeAdminClient())
    authz = _patch_admin_auth(monkeypatch)

    body = listening_router.ListeningRenderValidateRequest(
        script_text=_GOOD_SCRIPT,
        voice_id="EXAVITQu4vr4xnSDxMaL",
        model="eleven_multilingual_v2",
        accent_tag="us_general",
        cefr_level="B2",
        ielts_section=1,
    )
    out = _run(listening_router.admin_render_validate(body=body, authorization=authz))
    assert out["ok"] is True
    assert out["errors"] == []
    assert out["estimated_cost_credits"] == 2 * len(_GOOD_SCRIPT)
    assert out["estimated_cost_usd"] > 0
    assert out["estimated_render_seconds"] >= 3


def test_validate_short_script_returns_error(monkeypatch):
    _patch_admin_client(monkeypatch, _FakeAdminClient())
    authz = _patch_admin_auth(monkeypatch)

    body = listening_router.ListeningRenderValidateRequest(
        script_text="Too short.",
        voice_id="EXAVITQu4vr4xnSDxMaL",
        model="eleven_multilingual_v2",
        accent_tag="us_general",
    )
    out = _run(listening_router.admin_render_validate(body=body, authorization=authz))
    assert out["ok"] is False
    codes = {e["code"] for e in out["errors"]}
    assert "script_too_short" in codes


def test_validate_empty_script_returns_error(monkeypatch):
    _patch_admin_client(monkeypatch, _FakeAdminClient())
    authz = _patch_admin_auth(monkeypatch)

    body = listening_router.ListeningRenderValidateRequest(
        script_text="",
        voice_id="EXAVITQu4vr4xnSDxMaL",
        model="eleven_multilingual_v2",
        accent_tag="us_general",
    )
    out = _run(listening_router.admin_render_validate(body=body, authorization=authz))
    assert out["ok"] is False
    codes = {e["code"] for e in out["errors"]}
    assert "script_empty" in codes


def test_validate_invalid_model_returns_error(monkeypatch):
    _patch_admin_client(monkeypatch, _FakeAdminClient())
    authz = _patch_admin_auth(monkeypatch)

    body = listening_router.ListeningRenderValidateRequest(
        script_text=_GOOD_SCRIPT,
        voice_id="EXAVITQu4vr4xnSDxMaL",
        model="gpt-4o",
        accent_tag="us_general",
    )
    out = _run(listening_router.admin_render_validate(body=body, authorization=authz))
    assert out["ok"] is False
    codes = {e["code"] for e in out["errors"]}
    assert "model_invalid" in codes


def test_validate_premium_plus_nc_raises_422(monkeypatch):
    _patch_admin_client(monkeypatch, _FakeAdminClient())
    authz = _patch_admin_auth(monkeypatch)

    body = listening_router.ListeningRenderValidateRequest(
        script_text=_GOOD_SCRIPT,
        voice_id="EXAVITQu4vr4xnSDxMaL",
        model="eleven_multilingual_v2",
        accent_tag="us_general",
        is_premium=True,
        external_license="CC BY-NC-ND 4.0",
        external_source_url="https://example.com",
    )
    with pytest.raises(HTTPException) as exc:
        _run(listening_router.admin_render_validate(body=body, authorization=authz))
    assert exc.value.status_code == 422


def test_validate_non_locked_voice_emits_warning(monkeypatch):
    _patch_admin_client(monkeypatch, _FakeAdminClient())
    authz = _patch_admin_auth(monkeypatch)

    body = listening_router.ListeningRenderValidateRequest(
        script_text=_GOOD_SCRIPT,
        voice_id="not_a_locked_voice_id_12345",
        model="eleven_multilingual_v2",
        accent_tag="us_general",
    )
    out = _run(listening_router.admin_render_validate(body=body, authorization=authz))
    assert out["ok"] is True
    codes = {w["code"] for w in out["warnings"]}
    assert "voice_not_locked" in codes


def test_validate_cost_lower_for_flash_model(monkeypatch):
    _patch_admin_client(monkeypatch, _FakeAdminClient())
    authz = _patch_admin_auth(monkeypatch)

    base = dict(
        script_text=_GOOD_SCRIPT,
        voice_id="EXAVITQu4vr4xnSDxMaL",
        accent_tag="us_general",
    )
    multi = _run(listening_router.admin_render_validate(
        body=listening_router.ListeningRenderValidateRequest(model="eleven_multilingual_v2", **base),
        authorization=authz,
    ))
    flash = _run(listening_router.admin_render_validate(
        body=listening_router.ListeningRenderValidateRequest(model="eleven_flash_v2_5", **base),
        authorization=authz,
    ))
    assert flash["estimated_cost_credits"] < multi["estimated_cost_credits"]


# ── POST /render — augmented response + 100-char floor ──────────────────────


def test_render_endpoint_rejects_below_100_char_floor(monkeypatch):
    _patch_admin_client(monkeypatch, _FakeAdminClient())
    authz = _patch_admin_auth(monkeypatch)
    monkeypatch.setattr(listening_router.settings, "LISTENING_AI_RENDER_ENABLED", True)
    monkeypatch.setattr(listening_router.settings, "ELEVENLABS_API_KEY", "sk_test")

    body = listening_router.ListeningRenderRequest(
        script_text="Short " * 6,  # >10 (Pydantic floor) but <100 (Sprint 13.3 gate)
        voice_id="EXAVITQu4vr4xnSDxMaL",
        model="eleven_multilingual_v2",
        title="x",
        accent_tag="us_general",
    )
    bg = MagicMock()
    with pytest.raises(HTTPException) as exc:
        _run(listening_router.admin_render_listening(
            body=body, background_tasks=bg, authorization=authz,
        ))
    assert exc.value.status_code == 422
    assert "100" in str(exc.value.detail)
    assert bg.add_task.call_count == 0


def test_render_endpoint_returns_content_id_and_render_seconds(monkeypatch):
    _patch_admin_client(monkeypatch, _FakeAdminClient())
    authz = _patch_admin_auth(monkeypatch)
    monkeypatch.setattr(listening_router.settings, "LISTENING_AI_RENDER_ENABLED", True)
    monkeypatch.setattr(listening_router.settings, "ELEVENLABS_API_KEY", "sk_test")

    body = listening_router.ListeningRenderRequest(
        script_text=_GOOD_SCRIPT,
        voice_id="EXAVITQu4vr4xnSDxMaL",
        model="eleven_multilingual_v2",
        title="Section 1 booking",
        accent_tag="us_general",
    )
    bg = MagicMock()
    out = _run(listening_router.admin_render_listening(
        body=body, background_tasks=bg, authorization=authz,
    ))
    # job_id and content_id are the same UUID (renderer writes id=job_id).
    assert out["job_id"] == out["content_id"]
    assert isinstance(out["content_id"], str) and len(out["content_id"]) >= 8
    assert out["estimated_render_seconds"] >= 3
    assert out["estimated_cost_credits"] == 2 * len(_GOOD_SCRIPT)
    assert bg.add_task.call_count == 1
