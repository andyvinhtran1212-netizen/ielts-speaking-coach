"""Owner/capability boundaries and truthful retry receipts for flag transport."""
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError
import pytest

from models.mock_attempt_flags import ReviewFlagPatchRequest
from routers import mock_attempt_flags as router
from services.mock_attempt_flags import patch_review_flag, review_flag_state

AID = UUID("11111111-1111-4111-8111-111111111111")
UID = "22222222-2222-4222-8222-222222222222"


class DB:
    def __init__(self, rows=None, receipt=None, error=None):
        self.rows, self.receipt, self.error = rows or [], receipt, error
        self.calls = []
        self.is_rpc = False
    def table(self, name):
        self.is_rpc = False
        self.calls.append(("table", name)); return self
    def select(self, *_): return self
    def eq(self, *_): return self
    def limit(self, *_): return self
    def order(self, *_): return self
    def rpc(self, name, params):
        self.is_rpc = True
        self.calls.append((name, params)); return self
    def execute(self):
        if self.error: raise self.error
        return SimpleNamespace(data=self.receipt if self.is_rpc else self.rows)


def body(**kw):
    return ReviewFlagPatchRequest(q_num=20, flagged=True, expected_revision=0,
                                  operation_id=uuid4(), **kw)


def receipt(request, **kw):
    return dict(attempt_id=str(AID), q_num=request.q_num, question_id="q20",
                flagged=request.flagged, revision=1, updated_at=None,
                operation_id=str(request.operation_id), accepted=True,
                reason="applied", **kw)


def client():
    app = FastAPI(); app.include_router(router.router)
    return TestClient(app, raise_server_exceptions=False)


@pytest.mark.parametrize("field,value", [("q_num", True), ("q_num", 41),
    ("flagged", "false"), ("expected_revision", -1), ("expected_revision", True)])
def test_invalid_wire_values_fail_validation(field, value):
    values = dict(q_num=20, flagged=True, expected_revision=0, operation_id=uuid4())
    values[field] = value
    with pytest.raises(ValidationError): ReviewFlagPatchRequest(**values)


def test_false_tombstone_and_revision_survive_readback():
    db = DB(rows=[dict(q_num=20, question_id="original-q20", flagged=False,
                       revision=5, updated_at=None)])
    result = review_flag_state(db, "reading", {"id": str(AID)})
    assert result["review_flags"][0]["flagged"] is False
    assert result["review_flags"][0]["revision"] == 5
    assert db.calls == [("table", "mock_attempt_review_flags")]


def test_lost_ack_and_invalid_receipt_are_truthful_retry_errors():
    request = body()
    with pytest.raises(HTTPException) as error:
        patch_review_flag(DB(error=RuntimeError("connection lost")), "reading",
                          {"id": str(AID)}, request, user_id=UID)
    assert error.value.status_code == 503
    forged = receipt(request); forged["attempt_id"] = str(uuid4())
    with pytest.raises(HTTPException) as error:
        patch_review_flag(DB(receipt=forged), "reading", {"id": str(AID)}, request, user_id=UID)
    assert error.value.status_code == 503


def test_conflict_returns_canonical_state_without_false_acknowledgement():
    request = body()
    canonical = receipt(request)
    canonical.update(flagged=False, revision=9, operation_id=str(uuid4()),
                     accepted=False, reason="conflict")
    out = patch_review_flag(DB(receipt=canonical), "reading", {"id": str(AID)}, request, user_id=UID)
    assert (out.accepted, out.flagged, out.revision) == (False, False, 9)


@pytest.mark.parametrize("skill", ["reading", "listening"])
def test_owner_failure_precedes_purpose_guard_and_private_reads(skill):
    owned = "_reading_owner" if skill == "reading" else "_listening_owner"
    prefix = "/api/reading/test" if skill == "reading" else "/api/listening/tests"
    db = DB()
    with patch.object(router, owned, AsyncMock(side_effect=HTTPException(403, "wrong owner"))), \
         patch.object(router, "_guard") as guard, patch.object(router, "supabase_admin", db):
        response = client().get(f"{prefix}/attempts/{AID}/review-flags")
    assert response.status_code == 403 and not db.calls
    guard.assert_not_called()


def test_signed_in_share_write_uses_capability_owner_instead_of_jwt_identity():
    request = body()
    attempt = {"id": str(AID), "user_id": None, "anon_id": "share-secret"}
    db = DB(rows=[attempt], receipt=receipt(request))
    with patch.object(router.reading_student, "_optional_auth", AsyncMock(return_value={"id": UID})), \
         patch.object(router.reading_student, "supabase_admin", db), \
         patch.object(router, "supabase_admin", db), patch.object(router, "_guard") as guard:
        response = client().patch(f"/api/reading/test/attempts/{AID}/review-flags",
            headers={"Authorization": "Bearer synthetic", "X-Reading-Anon": "share-secret"},
            json=request.model_dump(mode="json"))
    assert response.status_code == 200
    params = db.calls[-1][1]
    assert params["p_user_id"] is None and params["p_anon_id"] == "share-secret"
    guard.assert_called_once_with("reading", attempt, write=True)


def test_wrong_anonymous_capability_cannot_read_flags_even_with_valid_jwt():
    attempt = {"id": str(AID), "user_id": None, "anon_id": "original-secret"}
    db = DB(rows=[attempt])
    with patch.object(router.reading_student, "_optional_auth", AsyncMock(return_value={"id": UID})), \
         patch.object(router.reading_student, "supabase_admin", db), \
         patch.object(router, "supabase_admin", db), patch.object(router, "_guard") as guard:
        response = client().get(f"/api/reading/test/attempts/{AID}/review-flags",
            headers={"Authorization": "Bearer synthetic", "X-Reading-Anon": "other-secret"})
    assert response.status_code == 403 and db.calls == [("table", "reading_test_attempts")]
    guard.assert_not_called()


def test_denied_delivery_gate_precedes_private_flags():
    with patch.object(router, "_reading_owner", AsyncMock(return_value={"id": str(AID)})), \
         patch.object(router, "_guard", side_effect=HTTPException(409, "invalid section")), \
         patch.object(router, "supabase_admin", DB()) as db:
        result = client().get(f"/api/reading/test/attempts/{AID}/review-flags")
    assert result.status_code == 409 and not db.calls
