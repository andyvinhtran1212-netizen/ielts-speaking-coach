"""INSTRUCTORGIVE-0044 (PC-J192) — request_id on both /instructor give routes.

Route contract on the filtering fake of test_instructor_routes_isolation, with
`instructor_give_fake` standing in for migration 360's RPC (the SQL, including
two concurrent sessions, is proven in test_migration_360_*):

  • no / malformed request_id → 422 before any DB call;
  • the same request_id + body again → the same response, no new row;
  • the same request_id + another body (or the other give route) → 409;
  • a request_id first used by another instructor → 409, nothing written;
  • a completed give replays even after its pre-check would now refuse;
  • RPC refusals map to the route contract (403 generic, 400, 409, 422).
"""

from __future__ import annotations

import contextlib
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

import instructor_give_fake
from tests.test_instructor_routes_isolation import A, AA, AB, B, CB, PB, SB, _FakeSB, _rid, _seed

HDR = {"Authorization": "Bearer x"}
INDIVIDUAL = "/instructor/assignments"
FAN_OUT = "/instructor/assignments/fan-out"
LEDGER = "instructor_writing_assignment_requests"


class _CountingSB(_FakeSB):
    def __init__(self, store):
        super().__init__(store)
        self.calls: list[str] = []

    def table(self, name):
        self.calls.append(name)
        return super().table(name)

    def rpc(self, name, params):
        self.calls.append(f"rpc:{name}")
        return super().rpc(name, params)


@contextlib.contextmanager
def _as(me, store):
    fake = _CountingSB(store)
    with contextlib.ExitStack() as es:
        es.enter_context(patch("routers.instructor.require_instructor",
                               new=AsyncMock(return_value={"id": me})))
        for target in ("routers.instructor.supabase_admin", "services.instructor_access.supabase_admin"):
            es.enter_context(patch(target, fake))
        from main import app
        yield TestClient(app, raise_server_exceptions=False), fake


def _body(path: str, request_id: str, **extra) -> dict:
    base = ({"prompt_id": PB, "student_id": SB} if path == INDIVIDUAL
            else {"prompt_ids": [PB], "cohort_id": CB})
    return {"request_id": request_id, **base, **extra}


def _rows(store) -> list[dict]:
    """Rows this test's gives created (the seed holds AA and AB)."""
    return [r for r in store["writing_assignments"] if r["id"] not in (AA, AB)]


@pytest.mark.parametrize("path", [INDIVIDUAL, FAN_OUT])
@pytest.mark.parametrize("request_id", [None, "not-a-uuid", ""])
def test_missing_or_malformed_request_id_is_422_before_any_db_call(path, request_id):
    store = _seed()
    body = _body(path, "x")
    if request_id is None:
        body.pop("request_id")
    else:
        body["request_id"] = request_id
    with _as(B, store) as (client, fake):
        r = client.post(path, json=body, headers=HDR)
    assert r.status_code == 422, r.text
    assert fake.calls == [] and _rows(store) == []


@pytest.mark.parametrize("path", [INDIVIDUAL, FAN_OUT])
def test_retry_with_the_same_request_id_returns_the_same_result_and_writes_nothing(path):
    store = _seed()
    rid = _rid()
    body = _body(path, rid, name="Buổi 5", grading_tier="deep", deadline="2026-12-01T19:00:00+07:00")
    with _as(B, store) as (client, _fake):
        first = client.post(path, json=body, headers=HDR)
        rows_after_first = [dict(r) for r in _rows(store)]
        second = client.post(path, json=body, headers=HDR)
    assert first.status_code == second.status_code == 201, (first.text, second.text)
    assert second.json() == first.json()
    assert _rows(store) == rows_after_first and len(rows_after_first) == 1
    assert rows_after_first[0]["grading_tier"] == "deep" and rows_after_first[0]["name"] == "Buổi 5"
    [receipt] = store[LEDGER]
    assert receipt["id"] == rid and receipt["assigned_by"] == B
    assert "request_id" not in receipt["request_payload"]
    assert store.get("writing_assignment_requests", []) == []   # never the admin-tools ledger (W-05)


@pytest.mark.parametrize("path", [INDIVIDUAL, FAN_OUT])
@pytest.mark.parametrize("change", [{"name": "Buổi khác"}, {"analysis_level": 4}, {"grading_tier": "deep"}])
def test_same_request_id_with_another_body_is_409_and_writes_nothing(path, change):
    store = _seed()
    rid = _rid()
    with _as(B, store) as (client, _fake):
        assert client.post(path, json=_body(path, rid), headers=HDR).status_code == 201
        before = [dict(r) for r in _rows(store)]
        r = client.post(path, json=_body(path, rid, **change), headers=HDR)
    assert r.status_code == 409, r.text
    assert r.json()["detail"] == "Yêu cầu giao bài này đã được gửi trước đó với nội dung khác. Vui lòng tải lại trang rồi giao lại."
    assert _rows(store) == before


def test_a_request_id_cannot_move_between_the_two_give_routes():
    store = _seed()
    rid = _rid()
    with _as(B, store) as (client, _fake):
        assert client.post(INDIVIDUAL, json=_body(INDIVIDUAL, rid), headers=HDR).status_code == 201
        r = client.post(FAN_OUT, json=_body(FAN_OUT, rid), headers=HDR)
    assert r.status_code == 409, r.text
    assert len(_rows(store)) == 1


@pytest.mark.parametrize("path", [INDIVIDUAL, FAN_OUT])
def test_another_instructor_cannot_reuse_a_request_id(path):
    store = _seed()
    rid = _rid()
    with _as(B, store) as (client, _fake):
        first = client.post(path, json=_body(path, rid), headers=HDR)
    assert first.status_code == 201
    before = [dict(r) for r in store["writing_assignments"]]
    with _as(A, store) as (client, _fake):
        # A replays B's id with B's exact body: refused, and B's result is not disclosed.
        r = client.post(path, json=_body(path, rid), headers=HDR)
    assert r.status_code == 409, r.text
    assert r.json()["detail"] == "Yêu cầu giao bài này không thuộc tài khoản của bạn. Vui lòng tải lại trang rồi thử lại."
    assert str(first.json().get("id") or first.json().get("group_id")) not in r.text
    assert store["writing_assignments"] == before


def test_completed_give_replays_even_after_the_learner_was_archived():
    """The ledger is canonical for a retry: the pre-check that would now say
    409 student_archived runs only for a NEW request."""
    store = _seed()
    rid = _rid()
    with _as(B, store) as (client, _fake):
        first = client.post(INDIVIDUAL, json=_body(INDIVIDUAL, rid), headers=HDR)
        next(s for s in store["students"] if s["id"] == SB)["archived_at"] = "2026-10-31T00:00:00Z"
        again = client.post(INDIVIDUAL, json=_body(INDIVIDUAL, rid), headers=HDR)
        fresh = client.post(INDIVIDUAL, json=_body(INDIVIDUAL, _rid()), headers=HDR)
    assert first.status_code == again.status_code == 201 and again.json() == first.json()
    assert fresh.status_code == 409 and fresh.json()["detail"]["code"] == "student_archived"
    assert len(_rows(store)) == 1


def test_fan_out_replay_survives_a_roster_change():
    store = _seed()
    rid = _rid()
    with _as(B, store) as (client, _fake):
        first = client.post(FAN_OUT, json=_body(FAN_OUT, rid), headers=HDR)
        store["students"].append({"id": "00000000-0000-0000-0000-0000000009aa", "instructor_id": B,
                                  "cohort_id": CB, "full_name": "Late", "student_code": "LATE", "user_id": None})
        again = client.post(FAN_OUT, json=_body(FAN_OUT, rid), headers=HDR)
    assert again.status_code == 201 and again.json() == first.json()
    assert first.json()["student_count"] == 1 and len(_rows(store)) == 1


def test_fan_out_response_shape_is_unchanged():
    store = _seed()
    with _as(B, store) as (client, _fake):
        r = client.post(FAN_OUT, json=_body(FAN_OUT, _rid()), headers=HDR)
    assert r.status_code == 201, r.text
    assert set(r.json()) == {"student_count", "created_count", "group_id", "duplicates_warning", "assignment_ids"}


def test_rpc_receives_the_auth_owner_and_the_give_options():
    store = _seed()
    seen: list[dict] = []
    real = instructor_give_fake.emulate_instructor_give

    def spy(db, params):
        seen.append(params)
        return real(db, params)

    with patch.object(instructor_give_fake, "emulate_instructor_give", spy), _as(B, store) as (client, _fake):
        r = client.post(FAN_OUT, json=_body(FAN_OUT, _rid(), analysis_level=5, grading_tier="deep",
                                             instructions="Viết 250 từ", allow_soft_check=True), headers=HDR)
    assert r.status_code == 201, r.text
    [params] = seen
    assert params["p_owner"] == B and params["p_give_kind"] == "fan_out" and params["p_cohort_id"] == CB
    assert (params["p_analysis_level"], params["p_grading_tier"], params["p_instructions"],
            params["p_allow_soft_check"]) == (5, "deep", "Viết 250 từ", True)
    assert params["p_request_payload"]["grading_tier"] == "deep"
    assert "request_id" not in params["p_request_payload"]


@pytest.mark.parametrize("path", [INDIVIDUAL, FAN_OUT])
@pytest.mark.parametrize("raised,status,detail", [
    ("instructor_give_not_owned", 403, "Bạn không có quyền với tài nguyên này."),
    ("instructor_give_owner_not_staff", 403, "Bạn không có quyền với tài nguyên này."),
    ("instructor_give_request_incomplete", 409, "Yêu cầu giao bài đang được xử lý. Vui lòng thử lại."),
    ("instructor_give_request_invalid", 422, "Dữ liệu giao bài không hợp lệ."),
    ("instructor_give_request_owned_by_other", 409, "Yêu cầu giao bài này không thuộc tài khoản của bạn. Vui lòng tải lại trang rồi thử lại."),
    ("instructor_give_request_payload_mismatch", 409, "Yêu cầu giao bài này đã được gửi trước đó với nội dung khác. Vui lòng tải lại trang rồi giao lại."),
])
def test_rpc_refusals_map_to_the_route_contract(path, raised, status, detail):
    store = _seed()

    def refuse(db, params):
        raise instructor_give_fake.FakeRpcError(raised)

    with patch.object(instructor_give_fake, "emulate_instructor_give", refuse), _as(B, store) as (client, _fake):
        r = client.post(path, json=_body(path, _rid()), headers=HDR)
    assert r.status_code == status, r.text
    assert r.json()["detail"] == detail
    assert _rows(store) == []


def test_rpc_empty_roster_maps_to_the_existing_400():
    store = _seed()

    def refuse(db, params):
        raise instructor_give_fake.FakeRpcError("instructor_give_roster_empty")

    with patch.object(instructor_give_fake, "emulate_instructor_give", refuse), _as(B, store) as (client, _fake):
        r = client.post(FAN_OUT, json=_body(FAN_OUT, _rid()), headers=HDR)
    assert r.status_code == 400 and r.json()["detail"] == "Lớp này chưa có học viên nào."


def test_empty_class_is_400_before_the_rpc():
    store = _seed()
    store["students"] = [s for s in store["students"] if s["cohort_id"] != CB]
    with _as(B, store) as (client, fake):
        r = client.post(FAN_OUT, json=_body(FAN_OUT, _rid()), headers=HDR)
    assert r.status_code == 400 and r.json()["detail"] == "Lớp này chưa có học viên nào."
    assert not [c for c in fake.calls if c.startswith("rpc:")] and store.get(LEDGER, []) == []
