"""Listening attempt renderer affinity is canonical, atomic and owner-scoped."""

from pathlib import Path
from unittest.mock import AsyncMock, patch
from uuid import UUID

import pytest
from fastapi import HTTPException

from routers import listening as mod


MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "migrations"
    / "219_listening_attempt_renderer_affinity.sql"
).read_text()
AID = UUID("11111111-1111-4111-8111-111111111111")
ACTIVE_ATTEMPT = {
    "status": "in_progress",
    "resume_expires_at": "2099-01-01T00:00:00+00:00",
}


class _Result:
    def __init__(self, data):
        self.data = data


class _Rpc:
    def __init__(self, data=None, error=None):
        self.data = data
        self.error = error

    def execute(self):
        if self.error:
            raise self.error
        return _Result(self.data)


class _ClaimDb:
    def __init__(self, data=None, error=None):
        self.data = data
        self.error = error
        self.calls = []

    def rpc(self, name, params):
        self.calls.append((name, params))
        return _Rpc(self.data, self.error)


class _Table:
    def __init__(self, owner, name):
        self.owner = owner
        self.name = name
        self.operation = "select"

    def select(self, *_args, **_kwargs):
        self.operation = "select"
        return self

    def update(self, *_args, **_kwargs):
        self.operation = "update"
        return self

    def insert(self, payload):
        self.operation = "insert"
        self.owner.payload = payload
        return self

    def eq(self, *_args, **_kwargs):
        return self

    def limit(self, *_args, **_kwargs):
        return self

    def execute(self):
        if self.name == "listening_tests" and self.operation == "select":
            return _Result([{
                "id": "22222222-2222-4222-8222-222222222222",
                "status": "published",
                "exam_only": False,
                "full_audio_storage_path": "tests/audio.mp3",
                "assembled_audio_storage_path": None,
            }])
        return _Result([self.owner.payload] if self.operation == "insert" else [])


class _StartDb:
    def __init__(self):
        self.payload = None

    def table(self, name):
        return _Table(self, name)


def test_migration_backfills_legacy_defaults_n_minus_one_and_claims_atomically():
    assert "ADD COLUMN renderer_affinity TEXT" in MIGRATION
    assert "IF NOT EXISTS" in MIGRATION
    assert "SET renderer_affinity = 'legacy'" in MIGRATION
    assert "ALTER COLUMN renderer_affinity SET DEFAULT 'legacy'" in MIGRATION
    assert "CHECK (renderer_affinity IN ('legacy', 'next'))" in MIGRATION
    assert "COALESCE(target.renderer_affinity, p_renderer_affinity)" in MIGRATION
    assert "target.user_id = p_user_id" in MIGRATION
    assert "FROM PUBLIC, anon, authenticated" in MIGRATION
    assert "TO service_role" in MIGRATION


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("body", "has_column", "response_affinity"),
    [
        (mod._ListeningAttemptStartRequest(renderer_affinity_protocol="claim-v1"), True, None),
        (None, False, "legacy"),
    ],
)
async def test_start_versions_affinity_aware_and_n_minus_one_inserts(
    body, has_column, response_affinity,
):
    db = _StartDb()
    with patch.object(mod, "_require_auth", AsyncMock(return_value={"id": "user-1"})), \
         patch.object(mod, "_assert_listening_exam_content_allowed"), \
         patch.object(mod, "supabase_admin", db):
        out = await mod.start_listening_test_attempt(
            "22222222-2222-4222-8222-222222222222",
            body=body,
        )

    assert ("renderer_affinity" in db.payload) is has_column
    if has_column:
        assert db.payload["renderer_affinity"] is None
    assert out["renderer_affinity"] == response_affinity


@pytest.mark.asyncio
async def test_claim_returns_canonical_affinity_and_owner_scopes_rpc():
    db = _ClaimDb([{"attempt_id": str(AID), "renderer_affinity": "next"}])
    with patch.object(mod, "_require_auth", AsyncMock(return_value={"id": "user-1"})), \
         patch.object(mod, "_fetch_attempt_or_404", return_value={
             "id": str(AID), "user_id": "user-1", **ACTIVE_ATTEMPT,
         }), \
         patch.object(mod, "supabase_admin", db):
        out = await mod.claim_listening_attempt_renderer_affinity(
            AID,
            mod._ListeningAttemptRendererAffinityRequest(renderer_affinity="next"),
            authorization="Bearer test",
        )

    assert out == {"attempt_id": str(AID), "renderer_affinity": "next"}
    assert db.calls == [("fn_claim_listening_attempt_renderer_affinity", {
        "p_attempt_id": str(AID),
        "p_user_id": "user-1",
        "p_renderer_affinity": "next",
    })]


@pytest.mark.asyncio
async def test_missing_or_failed_claim_never_invents_an_affinity():
    async def run(db):
        with patch.object(mod, "_require_auth", AsyncMock(return_value={"id": "user-1"})), \
             patch.object(mod, "_fetch_attempt_or_404", return_value={
                 "id": str(AID), "user_id": "user-1", **ACTIVE_ATTEMPT,
             }), \
             patch.object(mod, "supabase_admin", db):
            return await mod.claim_listening_attempt_renderer_affinity(
                AID,
                mod._ListeningAttemptRendererAffinityRequest(renderer_affinity="next"),
                authorization="Bearer test",
            )

    with pytest.raises(HTTPException) as missing:
        await run(_ClaimDb([]))
    assert missing.value.status_code == 404

    with pytest.raises(HTTPException) as failed:
        await run(_ClaimDb(error=RuntimeError("db down")))
    assert failed.value.status_code == 500

    with pytest.raises(HTTPException) as expired:
        await run(_ClaimDb(error=RuntimeError("active_player_expired")))
    assert expired.value.status_code == 410
