"""Reading attempt renderer affinity is canonical, atomic and owner-scoped."""

from pathlib import Path
from unittest.mock import AsyncMock, patch
from uuid import UUID

import pytest
from fastapi import HTTPException

from routers import reading_student as mod


MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "migrations"
    / "218_reading_attempt_renderer_affinity.sql"
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


class _Db:
    def __init__(self, data=None, error=None):
        self.data = data
        self.error = error
        self.calls = []

    def rpc(self, name, params):
        self.calls.append((name, params))
        return _Rpc(self.data, self.error)


class _InsertDb:
    def __init__(self):
        self.payload = None
        self.current_table = None
        self.rpc_calls = []
        self.flag_filters = []

    def table(self, name):
        assert name in {"reading_test_attempts", "mock_attempt_review_flags"}
        self.current_table = name
        return self

    def rpc(self, name, params):
        assert name == "fn_resolve_mock_paper_access"
        assert params["p_skill"] == "reading"
        assert params["p_test_id"] == "22222222-2222-4222-8222-222222222222"
        assert params["p_user_id"] == "user-1"
        assert params["p_purpose"] == "delivery"
        assert params["p_sitting_id"] is None
        assert params["p_allow_admission"] is True
        self.rpc_calls.append((name, dict(params)))
        return _Rpc({"allowed": True, "attempt_purpose": "practice", "paper_revision": 0, "policy_revision": 0})

    def select(self, columns):
        assert self.current_table == "mock_attempt_review_flags"
        assert columns == "q_num,question_id,flagged,revision,updated_at"
        return self

    def eq(self, column, value):
        self.flag_filters.append((column, value))
        return self

    def order(self, column):
        assert column == "q_num"
        return self

    def insert(self, payload):
        assert self.current_table == "reading_test_attempts"
        self.payload = payload
        return self

    def execute(self):
        if self.current_table == "mock_attempt_review_flags":
            assert self.flag_filters == [("skill", "reading"), ("attempt_id", self.payload["id"])]
            return _Result([])
        return _Result([{**self.payload, "attempt_purpose": "practice", "paper_revision": 0, "policy_revision": 0}])


def test_migration_backfills_legacy_defaults_n_minus_one_and_claims_atomically():
    assert "ADD COLUMN renderer_affinity TEXT" in MIGRATION
    assert "IF NOT EXISTS" in MIGRATION
    assert "SET renderer_affinity = 'legacy'" in MIGRATION
    assert "ALTER COLUMN renderer_affinity SET DEFAULT 'legacy'" in MIGRATION
    assert "CHECK (renderer_affinity IN ('legacy', 'next'))" in MIGRATION
    assert "COALESCE(target.renderer_affinity, p_renderer_affinity)" in MIGRATION
    assert "target.user_id = p_user_id" in MIGRATION
    assert "target.anon_id = p_anon_id" in MIGRATION
    assert "FROM PUBLIC, anon, authenticated" in MIGRATION
    assert "TO service_role" in MIGRATION


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("body", "has_column", "response_affinity"),
    [
        (mod._ReadingAttemptStartRequest(renderer_affinity_protocol="claim-v1"), True, None),
        (None, False, "legacy"),
    ],
)
async def test_authenticated_start_versions_affinity_aware_and_n_minus_one_inserts(
    body, has_column, response_affinity,
):
    db = _InsertDb()
    test = {
        "id": "22222222-2222-4222-8222-222222222222",
        "test_id": "READ-1",
        "time_limit_minutes": 60,
        "status": "published", "is_public": True,
    }
    with patch.object(mod, "_require_auth", AsyncMock(return_value={"id": "user-1"})), \
         patch.object(mod, "_fetch_published_test", return_value=test), \
         patch.object(mod, "_require_test_unlocked"), \
         patch.object(mod, "_abandon_open_attempts"), \
         patch.object(mod, "supabase_admin", db):
        out = await mod.start_reading_test_attempt("READ-1", body=body)

    assert ("renderer_affinity" in db.payload) is has_column
    assert db.payload["attempt_purpose"] == "practice"
    if has_column:
        assert db.payload["renderer_affinity"] is None
    assert out["renderer_affinity"] == response_affinity
    assert out["attempt_purpose"] == "practice"
    assert out["paper_revision"] == out["policy_revision"] == 0
    assert out["flag_protocol"] == "question-cas-v1"
    assert out["review_flags"] == []
    assert len(db.rpc_calls) == 1


@pytest.mark.asyncio
async def test_authenticated_claim_returns_canonical_affinity_and_owner_scopes_rpc():
    db = _Db([{"attempt_id": str(AID), "renderer_affinity": "next"}])
    with patch.object(mod, "_optional_auth", AsyncMock(return_value={"id": "user-1"})), \
         patch.object(mod, "_fetch_attempt_owned", return_value={
             "id": str(AID), "user_id": "user-1", **ACTIVE_ATTEMPT,
         }), \
         patch.object(mod, "supabase_admin", db):
        out = await mod.claim_reading_attempt_renderer_affinity(
            AID,
            mod._ReadingAttemptRendererAffinityRequest(renderer_affinity="next"),
            authorization="Bearer test",
        )

    assert out == {"attempt_id": str(AID), "renderer_affinity": "next"}
    assert db.calls == [("fn_claim_reading_attempt_renderer_affinity", {
        "p_attempt_id": str(AID),
        "p_user_id": "user-1",
        "p_anon_id": None,
        "p_renderer_affinity": "next",
    })]


@pytest.mark.asyncio
async def test_signed_in_share_claim_still_uses_only_the_anonymous_capability_owner():
    db = _Db([{"attempt_id": str(AID), "renderer_affinity": "legacy"}])
    with patch.object(mod, "_optional_auth", AsyncMock(return_value={"id": "signed-in-user"})), \
         patch.object(mod, "_fetch_attempt_owned", return_value={
             "id": str(AID), "user_id": None, "anon_id": "secret-capability",
             **ACTIVE_ATTEMPT,
         }), \
         patch.object(mod, "supabase_admin", db):
        out = await mod.claim_reading_attempt_renderer_affinity(
            AID,
            mod._ReadingAttemptRendererAffinityRequest(renderer_affinity="next"),
            x_reading_anon="secret-capability",
        )

    assert out["renderer_affinity"] == "legacy"
    assert db.calls[0][1] == {
        "p_attempt_id": str(AID),
        "p_user_id": None,
        "p_anon_id": "secret-capability",
        "p_renderer_affinity": "next",
    }


@pytest.mark.asyncio
async def test_missing_or_failed_claim_never_invents_an_affinity():
    async def run(db):
        with patch.object(mod, "_optional_auth", AsyncMock(return_value={"id": "user-1"})), \
             patch.object(mod, "_fetch_attempt_owned", return_value={
                 "id": str(AID), "user_id": "user-1", **ACTIVE_ATTEMPT,
             }), \
             patch.object(mod, "supabase_admin", db):
            return await mod.claim_reading_attempt_renderer_affinity(
                AID,
                mod._ReadingAttemptRendererAffinityRequest(renderer_affinity="next"),
                authorization="Bearer test",
            )

    with pytest.raises(HTTPException) as missing:
        await run(_Db([]))
    assert missing.value.status_code == 404

    with pytest.raises(HTTPException) as failed:
        await run(_Db(error=RuntimeError("db down")))
    assert failed.value.status_code == 500

    with pytest.raises(HTTPException) as expired:
        await run(_Db(error=RuntimeError("active_player_expired")))
    assert expired.value.status_code == 410
