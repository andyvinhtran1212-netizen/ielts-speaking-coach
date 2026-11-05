"""PC-J399 (CR #2059 P3 A1/A2) on real local PG: the /auth/activate router
and fn_activation_serialize (migration 359) leave an already-active account
exactly as it was when this request's code is lost or its profile archived.

A1: an active learner (code X) loses class code A to another user; a request
B for another code of the same learner may succeed around A. The account must
end on X's state (no B) or B's state, never A's code/permissions.
A2: the learner's profile is archived during A and the account is re-activated
meanwhile; A must not write is_active=false over that newer state.
"""
import threading
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import routers.auth as auth
from test_class_archive_activate import world  # noqa: F401
from test_migration_359_router_matrix import FIELDS, REQ, _read, _setup, pg359  # noqa: F401


def _code(db, uid, prefix, *, cohort_id=None, used=False, permissions):
    code_id, code = str(uuid4()), prefix + uid[:8].upper()
    db.table("access_codes").insert({
        "id": code_id, "code": code, "cohort_id": cohort_id, "permissions": permissions,
        **({"is_used": True, "used_by": uid} if used else {}),
    }).execute()
    return code_id, code


def _post(name, code, out):
    app = FastAPI()
    app.include_router(auth.router)
    with TestClient(app) as client:
        response = client.post("/auth/activate", json={"access_code": code},
                               headers={"Authorization": f"Bearer {name}"})
    out[name] = response


def _active_learner(db, uid):
    old_id, old = _code(db, uid, "J399X", used=True, permissions=["writing"])
    db.table("users").insert({"id": uid, "is_active": True, "access_code_used": old,
                              "permissions": ["writing"]}).execute()
    db.table("user_code_assignments").insert({"user_id": uid, "code_id": old_id}).execute()
    return old


@pytest.mark.parametrize("outcome", ["lost", "never_sent"])
@pytest.mark.parametrize("b_mode", ["none", "between", "concurrent"])
def test_active_learner_losing_a_class_code_keeps_its_own_activation(world, pg359, monkeypatch,
                                                                     outcome, b_mode):
    import test_migration_337_class_archive as m337
    from test_migration_240_core_attempt_evidence import psql
    schema, _admin = pg359
    uid, rival = str(uuid4()), str(uuid4())
    db = _setup(monkeypatch, schema, uid)
    _active_learner(db, uid)
    a_id, a_code = _code(db, uid, "J399A", cohort_id=m337._new_class(schema), permissions=["perm-a"])
    b_id, b_code = _code(db, uid, "J399B", permissions=["perm-b"])
    before = _read(db, uid, a_id)[0]
    out, errors = {}, []
    barrier = threading.Barrier(2, timeout=20)

    def run_b():
        try:
            _post("B", b_code, out)
        except BaseException as exc:  # surfaced below; a thread cannot fail the test
            errors.append(exc)

    b_thread = threading.Thread(target=run_b)

    def pre_rpc(params):
        if b_mode == "concurrent":
            barrier.wait()
        if REQ.get() != "A":
            return
        if b_mode == "between":
            # B commits after A's read-only pre-checks and before A's transaction.
            b_thread.start()
            b_thread.join(60)
        psql(f"UPDATE {schema}.access_codes SET is_used = true, used_by = '{rival}', "
             f"used_at = now() WHERE id = '{a_id}'")
        if outcome == "never_sent":
            raise RuntimeError("simulated lost request (never reached PG)")

    db.pre_rpc = pre_rpc
    if b_mode == "concurrent":
        b_thread.start()
    _post("A", a_code, out)
    if b_mode != "none":
        b_thread.join(60)
    db.pre_rpc = None
    assert not errors, errors

    if outcome == "lost":
        assert out["A"].status_code == 400, out["A"].text
        assert out["A"].json()["detail"] == "Access code này đã được sử dụng rồi"
    else:
        assert out["A"].status_code == 503, out["A"].text
        assert out["A"].json()["detail"]["error_code"] == "activation_incomplete"
    user, code_a, students, a_assignment = _read(db, uid, a_id)
    assert code_a == {"is_used": True, "used_by": rival}
    assert students == [] and a_assignment == []
    state = {key: user[key] for key in FIELDS}
    if b_mode == "none":
        assert state == {key: before[key] for key in FIELDS}
    else:
        assert out["B"].status_code == 200, out["B"].text
        assert state == {"is_active": True, "access_code_used": b_code, "permissions": ["perm-b"]}
        assert _read(db, uid, b_id)[1] == {"is_used": True, "used_by": uid}


@pytest.mark.parametrize("start", ["inactive_then_reactivated", "active"])
def test_archive_during_activation_never_deactivates_a_newer_account_state(world, pg359, monkeypatch,
                                                                           start):
    import test_migration_326_student_archive as m326
    import test_migration_337_class_archive as m337
    from test_migration_240_core_attempt_evidence import psql
    schema, admin = pg359
    uid = str(uuid4())
    db = _setup(monkeypatch, schema, uid)
    if start == "active":
        _active_learner(db, uid)
    else:
        db.table("users").insert({"id": uid, "is_active": False}).execute()
    student = db.table("students").insert({"user_id": uid, "student_code": "J399S" + uid[:8].upper(),
                                           "full_name": "Synthetic learner"}).execute().data[0]["id"]
    a_id, a_code = _code(db, uid, "J399A", cohort_id=m337._new_class(schema), permissions=["perm-a"])

    def pre_rpc(params):
        assert m326._archive(schema, student, admin) is not None
        # An admin re-activates the account while A is still in flight.
        psql(f"UPDATE {schema}.users SET is_active = true WHERE id = '{uid}'")

    db.pre_rpc = pre_rpc
    expected = {key: value for key, value in _read(db, uid, a_id)[0].items() if key in FIELDS}
    expected["is_active"] = True
    out = {}
    _post("A", a_code, out)
    db.pre_rpc = None

    assert out["A"].status_code == 403, out["A"].text
    assert "Mã CHƯA được sử dụng" in out["A"].json()["detail"]
    user, code_a, _students, a_assignment = _read(db, uid, a_id)
    assert {key: user[key] for key in FIELDS} == expected
    assert code_a == {"is_used": False, "used_by": None} and a_assignment == []
