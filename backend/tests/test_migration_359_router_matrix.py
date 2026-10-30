"""SA-DESIGN-359 backend-level probes: the real /auth/activate router whose table
reads/writes AND the fn_activation_serialize RPC run on real local PG (337 coexistence).
Adapts SA's P2-R6-4 repro (delta-9844/test_sa2059e_samecode.py) to the RPC design."""
import asyncio
import contextvars
import json
import random
import threading
import time
from types import SimpleNamespace
from uuid import uuid4
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import routers.auth as auth
from migration_359_pg_harness import build, psql
from test_class_archive_activate import Database, PgQuery, world  # noqa: F401

REQ = contextvars.ContextVar("sa359_req", default=None)
FIELDS = ("is_active", "access_code_used", "permissions")
N = {"barrier": 6, "jitter": 10,
     "b_first": 2, "a_first": 2}


@pytest.fixture(scope="module")
def pg359():
    import test_migration_326_student_archive as m326
    schema = build("with337")
    try:
        yield schema, m326._admin(schema)
    finally:
        psql(f"DROP SCHEMA IF EXISTS {schema} CASCADE")


class RpcDB(Database):
    def __init__(self, schema):
        super().__init__()
        self.schema, self.after_activate = schema, None
        self.pre_rpc = self.post_rpc = None
        self.tables = {}

    def table(self, name):
        return PgQuery(self, name)

    def rpc(self, name, params):
        if name == "fn_activate_attempt_check":
            return SimpleNamespace(execute=lambda: SimpleNamespace(data={"allowed": True, "retry_after_s": 0}))
        assert name == "fn_activation_serialize", name

        def execute():
            if self.pre_rpc:
                self.pre_rpc(params)
            lit = lambda v: "NULL" if v is None else "'" + str(v).replace("'", "''") + "'"
            out = psql(f"BEGIN; SET LOCAL ROLE service_role; SELECT {self.schema}.fn_activation_serialize("
                       f"{lit(params['p_user_id'])}, {lit(params['p_code_id'])}, {lit(params['p_code'])}, "
                       f"{lit(params['p_email'])}, {lit(json.dumps(params['p_metadata']))}::jsonb); COMMIT;")
            data = json.loads(out.splitlines()[-1] if "\n" in out else out)
            if self.post_rpc:
                self.post_rpc(params, data)
            return SimpleNamespace(data=data)
        return SimpleNamespace(execute=execute)


def _setup(monkeypatch, schema, uid, *, email="learner@example.test"):
    db = RpcDB(schema)
    monkeypatch.setattr(auth, "supabase_admin", db)

    async def who(authorization, uid=uid):
        REQ.set(authorization.split()[-1])
        return {"id": uid, "email": email, "user_metadata": {}}
    monkeypatch.setattr(auth, "get_supabase_user", AsyncMock(side_effect=who))
    return db


def _read(db, uid, code_id):
    u = {k: v for k, v in db.table("users").select("*").eq("id", uid).execute().data[0].items() if k in FIELDS | {"role"}}
    c = db.table("access_codes").select("is_used, used_by").eq("id", code_id).execute().data[0]
    studs = db.table("students").select("id, archived_at").eq("user_id", uid).execute().data
    uca = db.table("user_code_assignments").select("user_id").eq("user_id", uid).eq("code_id", code_id).execute().data
    return u, c, studs, uca


FIELDS = set(FIELDS)


# ── adapted P2-R6-4 matrix (3 kinds × 2 start states × 4 orderings = 24) ──────────────
@pytest.mark.parametrize("mode", ["barrier", "jitter", "b_first", "a_first"])
@pytest.mark.parametrize("start_active", [False, True])
@pytest.mark.parametrize("kind", ["archive", "uncertain_commit", "uncertain_nocommit"])
def test_same_code_duplicate_rpc(world, pg359, monkeypatch, kind, start_active, mode):
    import test_migration_337_class_archive as m337
    schema, admin = pg359
    stats = {}
    for it in range(N[mode]):
        uid = str(uuid4())
        db = _setup(monkeypatch, schema, uid)
        cid, code_id = m337._new_class(schema), str(uuid4())
        code = "SR" + uid[:8].upper()
        db.table("access_codes").insert({"id": code_id, "code": code, "cohort_id": cid,
                                         "permissions": ["perm-x"]}).execute()
        if start_active:
            old_id, old = str(uuid4()), "SROLD" + uid[:8].upper()
            db.table("access_codes").insert({"id": old_id, "code": old, "cohort_id": None, "is_used": True,
                                             "used_by": uid, "permissions": ["writing"]}).execute()
            db.table("users").insert({"id": uid, "is_active": True, "access_code_used": old,
                                      "permissions": ["writing"]}).execute()
            db.table("user_code_assignments").insert({"user_id": uid, "code_id": old_id}).execute()
        else:
            db.table("users").insert({"id": uid, "is_active": False}).execute()
        before = _read(db, uid, code_id)[0]
        ev = {k: threading.Event() for k in ("A_at_rpc", "A_done", "B_done")}
        barrier = threading.Barrier(2, timeout=10)
        rng = random.Random(it)
        seen = set()

        def pre_rpc(params):
            name = REQ.get()
            if mode == "jitter":
                time.sleep(rng.random() * 0.008)
            if mode == "barrier":
                barrier.wait()
            if name == "B" and mode == "a_first":
                assert ev["A_done"].wait(10)
            if name != "A" or "fail" in seen:
                return
            seen.add("fail")
            ev["A_at_rpc"].set()
            if mode == "b_first":
                assert ev["B_done"].wait(10)
            if kind == "archive":
                m337._archive_class(schema, cid, admin)
            elif kind == "uncertain_nocommit":
                raise RuntimeError("simulated lost request (never reached PG)")

        def post_rpc(params, data):
            if REQ.get() == "A" and kind == "uncertain_commit" and "lost" not in seen:
                seen.add("lost")
                raise RuntimeError("simulated lost response after commit")

        db.pre_rpc, db.post_rpc = pre_rpc, post_rpc
        out = {}

        def run(name):
            try:
                app = FastAPI()
                app.include_router(auth.router)
                with TestClient(app) as c:
                    r = c.post("/auth/activate", json={"access_code": code},
                               headers={"Authorization": f"Bearer {name}"})
                    out[name] = (r.status_code, r.json().get("detail") if r.status_code != 200 else "ok")
            finally:
                ev[f"{name}_done"].set()

        ta = threading.Thread(target=run, args=("A",))
        tb = threading.Thread(target=run, args=("B",))
        ta.start()
        if mode in ("b_first", "a_first"):
            assert ev["A_at_rpc"].wait(10)
        tb.start()
        ta.join(60); tb.join(60)
        db.pre_rpc = db.post_rpc = None
        u, c, studs, uca = _read(db, uid, code_id)
        owned = c["used_by"] == uid
        print(f"CONC kind={kind} mode={mode} start_active={start_active} it={it} A={out.get('A')} "
              f"B={out.get('B')} user={ {k: u[k] for k in FIELDS} } owned={owned} students={len(studs)} uca={len(uca)}")
        key = (out.get("A", (None,))[0], out.get("B", (None,))[0])
        stats[key] = stats.get(key, 0) + 1
        assert not ta.is_alive() and not tb.is_alive(), "a request hung"
        assert set(out) == {"A", "B"}, "a request hung"
        assert all(v[0] in (200, 400, 403, 503) for v in out.values()), out
        assert c["used_by"] in (None, uid)
        if owned:
            # the P2-R6-4 bad end state: code spent but account inactive / students row gone
            assert u["is_active"] is True and u["access_code_used"] == code, f"code spent, account not active: {u}"
            assert u["permissions"] == ["perm-x"], u
            assert len(studs) == 1, f"code spent but students row missing: {studs}"
            memberships = db.table("student_cohort_memberships").select("*").eq("student_id", studs[0]["id"]).execute().data
            assert len(memberships) == 1 and memberships[0]["is_active"] is True
            assert len(uca) == 1
        else:
            assert not c["is_used"]
            assert {k: u[k] for k in FIELDS} == {k: before[k] for k in FIELDS}, f"user not at committed state: {u}"
            assert studs == []
            assert uca == []
            assert not any(v[0] == 200 for v in out.values())
        if any(v[0] == 200 for v in out.values()):
            assert owned and u["is_active"] is True and len(studs) == 1
    print(f"SUMMARY kind={kind} mode={mode} start_active={start_active} outcomes(A,B)={stats}")


# ── lost response AFTER commit (also = client disconnect/cancel after commit) ─────────
@pytest.mark.parametrize("instructor_code", [False, True])
def test_lost_rpc_response_after_commit_is_reconciled(world, pg359, monkeypatch, instructor_code):
    """Design: 'Never claim that a lost response proves the code is unused'. Expected: the router
    confirms (read-only) that the code is now this user's and finishes the post-claim steps
    (instructor promotion, user_code_assignments), or a retry does so."""
    import test_migration_337_class_archive as m337
    schema, _ = pg359
    uid = str(uuid4())
    email = f"gv{uid[:6]}@example.test"
    db = _setup(monkeypatch, schema, uid, email=email)
    cid, code_id, code = m337._new_class(schema), str(uuid4()), "SL" + uid[:8].upper()
    row = {"id": code_id, "code": code, "cohort_id": cid, "permissions": ["perm-x"]}
    if instructor_code:
        psql(f"UPDATE {schema}.access_codes SET grants_role=grants_role WHERE false")
        row.update(grants_role="instructor", intended_email=email)
    db.table("access_codes").insert(row).execute()
    db.table("users").insert({"id": uid, "is_active": False}).execute()
    lost = []

    def post_rpc(params, data):
        if not lost:
            lost.append(data)
            raise RuntimeError("simulated lost response after commit")
    db.post_rpc = post_rpc
    app = FastAPI()
    app.include_router(auth.router)
    with TestClient(app) as c:
        r1 = c.post("/auth/activate", json={"access_code": code}, headers={"Authorization": "Bearer A"})
        r2 = c.post("/auth/activate", json={"access_code": code}, headers={"Authorization": "Bearer A"})
    u, cd, studs, uca = _read(db, uid, code_id)
    print("LOST_AFTER_COMMIT", instructor_code, "r1=", r1.status_code, r1.text[:200], "| r2=", r2.status_code,
          r2.text[:120], "| user=", u, "code=", cd, "students=", len(studs), "uca=", len(uca))
    assert len(lost) == 1
    assert r1.status_code == 200, r1.text
    assert r2.status_code == 400, r2.text
    assert cd["used_by"] == uid and u["is_active"] is True        # DB committed atomically
    assert not (r1.status_code == 503 and "Mã CHƯA được sử dụng" in r1.text), \
        "router tells the user the code is UNUSED although it was spent"
    assert len(uca) == 1, "post-claim user_code_assignments never written (retry short-circuits)"
    if instructor_code:
        assert u["role"] == "instructor", "instructor code spent but role never promoted"


# ── cancellation of the request coroutine while the RPC runs in to_thread (R6-1) ───────
def test_cancel_during_rpc_thread_is_atomic(world, pg359, monkeypatch):
    import test_migration_337_class_archive as m337
    schema, _ = pg359
    uid = str(uuid4())
    db = _setup(monkeypatch, schema, uid)
    cid, code_id, code = m337._new_class(schema), str(uuid4()), "SC" + uid[:8].upper()
    db.table("access_codes").insert({"id": code_id, "code": code, "cohort_id": cid, "permissions": ["perm-x"]}).execute()
    db.table("users").insert({"id": uid, "is_active": False}).execute()
    in_rpc = threading.Event()

    def pre(params):
        in_rpc.set()
        time.sleep(0.4)
    db.pre_rpc = pre

    async def main():
        REQ.set("A")
        task = asyncio.create_task(auth.activate_account(auth.ActivateRequest(access_code=code), "Bearer A"))
        for _ in range(500):
            if in_rpc.is_set():
                break
            await asyncio.sleep(0.01)
        assert in_rpc.is_set(), "request never reached the RPC"
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        await asyncio.sleep(1.5)
    asyncio.run(main())
    u, cd, studs, uca = _read(db, uid, code_id)
    print("CANCEL_RPC user=", u, "code=", cd, "students=", len(studs), "uca=", len(uca))
    # atomic: the worker thread commits the whole activation (no provisional state, R6-1 closed)
    assert cd["used_by"] == uid and u["is_active"] is True and u["access_code_used"] == code and len(studs) == 1
    # post-claim steps were skipped by the cancellation (reported, not asserted here)
    print("CANCEL_RPC post-claim user_code_assignments rows:", len(uca))
