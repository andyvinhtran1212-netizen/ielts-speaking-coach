"""Writing assignment renderer affinity is atomic, owner-scoped and nullable until claim."""

from pathlib import Path
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from uuid import UUID

import pytest
from fastapi import HTTPException

from routers import writing_student as mod


MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "migrations"
    / "221_writing_assignment_renderer_affinity.sql"
).read_text()
AID = UUID("11111111-1111-4111-8111-111111111111")
STUDENT = {"id": "student-1", "user_id": "user-1"}


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


def test_migration_preserves_ambiguous_history_and_claims_active_rows_atomically():
    assert "ADD COLUMN IF NOT EXISTS renderer_affinity TEXT" in MIGRATION
    assert "CHECK (renderer_affinity IN ('legacy', 'next'))" in MIGRATION
    assert "COALESCE(target.renderer_affinity, p_renderer_affinity)" in MIGRATION
    assert "target.student_id = p_student_id" in MIGRATION
    assert "target.status IN ('pending', 'in_progress')" in MIGRATION
    assert "FROM PUBLIC, anon, authenticated" in MIGRATION
    assert "TO service_role" in MIGRATION
    assert "SET renderer_affinity = 'legacy'" not in MIGRATION
    assert "ALTER COLUMN renderer_affinity SET DEFAULT" not in MIGRATION


def test_expired_writing_lease_is_presented_as_reclaimable_without_losing_data():
    now = datetime(2026, 8, 20, 12, 0, tzinfo=timezone.utc)
    row = {
        "id": str(AID),
        "status": "in_progress",
        "renderer_affinity": "legacy",
        "renderer_affinity_claimed_at": (now - timedelta(days=2)).isoformat(),
        "renderer_affinity_expires_at": (now - timedelta(days=1)).isoformat(),
        "writing_prompts": {"title": "kept"},
    }

    assert mod._writing_renderer_lease_active(row, now=now) is False
    effective = mod._effective_writing_renderer(row)
    assert effective["renderer_affinity"] is None
    assert effective["renderer_affinity_expires_at"] is None
    assert effective["writing_prompts"] == {"title": "kept"}
    assert row["renderer_affinity"] == "legacy"


def test_active_writing_lease_remains_sticky():
    now = datetime(2026, 8, 20, 12, 0, tzinfo=timezone.utc)
    row = {
        "status": "in_progress",
        "renderer_affinity": "next",
        "renderer_affinity_expires_at": (now + timedelta(seconds=1)).isoformat(),
    }
    assert mod._writing_renderer_lease_active(row, now=now) is True
    assert mod._effective_writing_renderer(row) is row


@pytest.mark.asyncio
async def test_claim_returns_canonical_affinity_and_owner_scopes_rpc():
    db = _Db([{"assignment_id": str(AID), "renderer_affinity": "next"}])
    with patch.object(mod, "_resolve_active_assignment", return_value={
        "id": str(AID), "student_id": STUDENT["id"], "status": "in_progress",
    }), patch.object(mod, "supabase_admin", db):
        out = await mod.claim_writing_assignment_renderer_affinity(
            AID,
            mod.WritingAssignmentRendererAffinityRequest(renderer_affinity="next"),
            student=STUDENT,
        )

    assert out == {"assignment_id": str(AID), "renderer_affinity": "next"}
    assert db.calls == [("fn_claim_writing_assignment_renderer_affinity", {
        "p_assignment_id": str(AID),
        "p_student_id": STUDENT["id"],
        "p_renderer_affinity": "next",
    })]


@pytest.mark.asyncio
async def test_existing_affinity_wins_over_conflicting_claim():
    db = _Db([{"assignment_id": str(AID), "renderer_affinity": "legacy"}])
    with patch.object(mod, "_resolve_active_assignment", return_value={
        "id": str(AID), "student_id": STUDENT["id"], "status": "in_progress",
    }), patch.object(mod, "supabase_admin", db):
        out = await mod.claim_writing_assignment_renderer_affinity(
            AID,
            mod.WritingAssignmentRendererAffinityRequest(renderer_affinity="next"),
            student=STUDENT,
        )

    assert out["renderer_affinity"] == "legacy"


@pytest.mark.asyncio
async def test_terminal_concurrent_or_failed_claim_never_invents_affinity():
    with patch.object(mod, "_resolve_active_assignment", return_value={
        "id": str(AID), "student_id": STUDENT["id"], "status": "submitted",
    }), patch.object(mod, "supabase_admin", _Db([])):
        with pytest.raises(HTTPException) as terminal:
            await mod.claim_writing_assignment_renderer_affinity(
                AID,
                mod.WritingAssignmentRendererAffinityRequest(renderer_affinity="next"),
                student=STUDENT,
            )
    assert terminal.value.status_code == 409

    with patch.object(mod, "_resolve_active_assignment", return_value={
        "id": str(AID), "student_id": STUDENT["id"], "status": "in_progress",
    }), patch.object(mod, "supabase_admin", _Db([])):
        with pytest.raises(HTTPException) as raced:
            await mod.claim_writing_assignment_renderer_affinity(
                AID,
                mod.WritingAssignmentRendererAffinityRequest(renderer_affinity="next"),
                student=STUDENT,
            )
    assert raced.value.status_code == 409

    with patch.object(mod, "_resolve_active_assignment", return_value={
        "id": str(AID), "student_id": STUDENT["id"], "status": "in_progress",
    }), patch.object(mod, "supabase_admin", _Db(error=RuntimeError("db down"))):
        with pytest.raises(HTTPException) as failed:
            await mod.claim_writing_assignment_renderer_affinity(
                AID,
                mod.WritingAssignmentRendererAffinityRequest(renderer_affinity="next"),
                student=STUDENT,
            )
    assert failed.value.status_code == 500
