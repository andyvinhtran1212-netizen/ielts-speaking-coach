"""Authenticated identity/profile payloads must remain concrete in OpenAPI."""

import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent.parent))

import routers.auth as auth_module  # noqa: E402
import services.runtime_flags as runtime_flags  # noqa: E402
from models.auth import (  # noqa: E402
    AuthActivateResponse,
    AuthActiveStatusResponse,
    AuthMeResponse,
    AuthProfileResponse,
    AuthProfileUpdateResponse,
)
from routers.auth import router  # noqa: E402


BASE_PROFILE = {
    "id": "00000000-0000-4000-8000-000000000101",
    "email": "learner@example.test",
    "display_name": "Learner",
    "avatar_url": None,
    "role": "user",
    "is_active": True,
    "onboarding_completed": True,
    "target_band": 7.0,
    "exam_date": "2026-12-01",
    "self_level": "upper_intermediate",
    "preferred_topics": ["education"],
    "timezone": "Asia/Ho_Chi_Minh",
    "weekly_goal": 5,
    "notification_email": True,
}


def test_auth_payload_models_validate_the_live_route_shapes():
    AuthMeResponse.model_validate({
        **{key: BASE_PROFILE[key] for key in (
            "id", "email", "display_name", "avatar_url", "role", "is_active",
            "onboarding_completed", "target_band", "exam_date", "self_level",
            "preferred_topics",
        )},
        "permissions": ["practice_single"],
        "vocab_bank_enabled": True,
        "d1_enabled": False,
        "d3_enabled": False,
        "flashcard_enabled": True,
        "vocab_curated_enabled": False,
    })
    AuthActiveStatusResponse.model_validate({"is_active": True})
    AuthProfileUpdateResponse.model_validate(BASE_PROFILE)
    AuthProfileResponse.model_validate({
        **BASE_PROFILE,
        "joined_at": "2026-01-01T00:00:00+00:00",
        "stats": {"total_sessions": 3, "avg_band": 6.5, "joined_at": None},
    })
    AuthActivateResponse.model_validate({"success": True, "message": "ok"})


def test_every_auth_route_exposes_its_response_model():
    expected = {
        ("GET", "/auth/me"): AuthMeResponse,
        ("GET", "/auth/check-active"): AuthActiveStatusResponse,
        ("GET", "/auth/profile"): AuthProfileResponse,
        ("POST", "/auth/activate"): AuthActivateResponse,
        ("PATCH", "/auth/profile"): AuthProfileUpdateResponse,
    }
    routes = {
        (method, route.path): route.response_model
        for route in router.routes
        for method in getattr(route, "methods", set())
    }
    for key, model in expected.items():
        assert routes[key] == model


def test_profile_patch_can_persist_only_onboarding_completed(monkeypatch):
    """Skipping onboarding must preserve all existing profile preferences."""
    row = {**BASE_PROFILE, "onboarding_completed": False}
    original = dict(row)
    query = Mock()
    query.update.return_value = query
    query.eq.return_value = query

    def execute():
        assert query.eq.call_args.args == ("id", row["id"])
        row.update(query.update.call_args.args[0])
        return SimpleNamespace(data=[dict(row)])

    query.execute.side_effect = execute
    admin = Mock()
    admin.table.return_value = query

    async def fake_user(_authorization):
        return {"id": row["id"], "email": row["email"]}

    monkeypatch.setattr(auth_module, "get_supabase_user", fake_user)
    monkeypatch.setattr(auth_module, "supabase_admin", admin)
    monkeypatch.setattr(runtime_flags, "is_enabled", lambda _key, default=True: default)
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        response = client.patch(
            "/auth/profile",
            headers={"Authorization": "Bearer fixture"},
            json={"onboarding_completed": True},
        )

    assert response.status_code == 200, response.text
    assert response.json()["onboarding_completed"] is True
    assert response.headers["cache-control"] == "private, no-store"
    admin.table.assert_called_once_with("users")
    query.update.assert_called_once_with({"onboarding_completed": True})
    assert row == {**original, "onboarding_completed": True}
