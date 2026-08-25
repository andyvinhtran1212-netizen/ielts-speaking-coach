"""Speaking renderer affinity is canonical, atomic and owner-scoped."""

from pathlib import Path
from unittest.mock import AsyncMock, patch
from uuid import UUID

import pytest
from fastapi import HTTPException

from routers import sessions as mod


MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "migrations"
    / "215_speaking_session_renderer_affinity.sql"
).read_text()
CREATE_MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "migrations"
    / "216_version_session_renderer_affinity_create.sql"
).read_text()
GAP_BACKFILL_MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "migrations"
    / "217_backfill_renderer_affinity_migration_gap.sql"
).read_text()
SID = UUID("11111111-1111-4111-8111-111111111111")


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


class _Db:
    def __init__(self, data=None, error=None):
        self.data = data
        self.error = error
        self.calls = []

    def rpc(self, name, params):
        self.calls.append((name, params))
        return _Rpc(self.data, self.error)


async def _claim(db, requested="next"):
    with patch.object(mod, "get_supabase_user", AsyncMock(return_value={"id": "user-1"})), \
         patch.object(mod, "supabase_admin", db):
        return await mod.claim_renderer_affinity(
            SID,
            mod.ClaimRendererAffinityBody(renderer_affinity=requested),
            authorization="Bearer test",
        )


def test_migration_backfills_only_preexisting_sessions_and_claims_atomically():
    assert "ADD COLUMN renderer_affinity TEXT" in MIGRATION
    assert "UPDATE public.sessions" in MIGRATION
    assert "COALESCE(target.renderer_affinity, p_renderer_affinity)" in MIGRATION
    assert "target.user_id = p_user_id" in MIGRATION
    assert "CHECK (renderer_affinity IN ('legacy', 'next'))" in MIGRATION
    assert "TO service_role" in MIGRATION
    assert "FROM PUBLIC, anon, authenticated" in MIGRATION
    assert "DEFAULT 'legacy'" not in MIGRATION


def test_create_protocol_pins_n_minus_one_and_versions_affinity_aware_inserts():
    assert "ALTER COLUMN renderer_affinity SET DEFAULT 'legacy'" in CREATE_MIGRATION
    assert "fn_create_session_daily_capped_v3" in CREATE_MIGRATION
    assert "p_renderer_affinity" in CREATE_MIGRATION
    assert "status, renderer_affinity" in CREATE_MIGRATION
    assert "p_renderer_affinity\n    )" in CREATE_MIGRATION
    assert "TO service_role" in CREATE_MIGRATION
    assert "FROM PUBLIC, anon, authenticated" in CREATE_MIGRATION
    assert "SET renderer_affinity = 'legacy'" in GAP_BACKFILL_MIGRATION
    assert "WHERE renderer_affinity IS NULL" in GAP_BACKFILL_MIGRATION


@pytest.mark.asyncio
async def test_claim_returns_the_canonical_renderer_and_owner_scopes_the_rpc():
    db = _Db([{"session_id": str(SID), "renderer_affinity": "next"}])
    out = await _claim(db)
    assert out == {"session_id": str(SID), "renderer_affinity": "next"}
    assert db.calls == [("fn_claim_session_renderer_affinity", {
        "p_session_id": str(SID),
        "p_user_id": "user-1",
        "p_renderer_affinity": "next",
    })]


@pytest.mark.asyncio
async def test_existing_legacy_claim_wins_over_a_next_reopen_request():
    db = _Db([{"session_id": str(SID), "renderer_affinity": "legacy"}])
    out = await _claim(db, requested="next")
    assert out["renderer_affinity"] == "legacy"


@pytest.mark.asyncio
async def test_missing_or_failed_claim_never_invents_an_affinity():
    with pytest.raises(HTTPException) as missing:
        await _claim(_Db([]))
    assert missing.value.status_code == 404

    with pytest.raises(HTTPException) as failed:
        await _claim(_Db(error=RuntimeError("db down")))
    assert failed.value.status_code == 500
