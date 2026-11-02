"""CLASSARCHIVE-0030 T003: class_archive_service and the admin cohort routes.

- `PATCH /admin/cohorts/{id}` routes an `is_active` change to
  `fn_archive_cohort` / `fn_restore_cohort` FIRST (research.md §4.2 W14); if the
  RPC fails nothing else is written; name/description are then a plain UPDATE.
- `GET /admin/cohorts/{id}/archive-preview` returns `fn_cohort_archive_counts`.
- Both are admin-only, run their DB calls off the event loop, and never echo
  database text (no-echo pattern: GENERIC_MESSAGE + new_ref()).

The PostgreSQL half drives the same route helpers against the real migration
337 RPCs (the 337 harness), so parameter names and receipt shapes are the live
ones. Set TEST_PG_URL to a LOCAL disposable cluster and REQUIRE_PG=1 to forbid
skips. T009 extends this file with W1–W14 and the learner entry points.
"""

from __future__ import annotations

import asyncio
import json
import logging
import threading
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import test_migration_326_student_archive as m326
import test_migration_337_class_archive as m337
from routers import admin as admin_router
from routers import cohorts as mod
from services import class_archive_service as svc
from services.errors import GENERIC_MESSAGE
from test_migration_240_core_attempt_evidence import psql

CID = "aaaaaaaa-0000-0000-0000-000000000001"
ADMIN = {"id": "00000000-0000-0000-0000-00000000aaaa", "email": "admin@x"}
AUTH = {"Authorization": "Bearer fake.jwt"}
COUNTS = {"active_members": 3, "open_writing_gives": 4, "open_class_items": 2, "unused_class_codes": 1}
DB_ERROR = 'relation "cohorts" column secret_col contains private-db-value'
INTERNALS = (DB_ERROR, "relation", "secret_col", "private-db-value", "fn_archive_cohort",
             "fn_restore_cohort", "fn_cohort_archive_counts", "archive_actor_required")


# ── Fake PostgREST client ────────────────────────────────────────────────

class _Q:
    def __init__(self, db, table):
        self.db, self.table, self.mode, self.payload = db, table, "select", None

    def select(self, *_a, **_k): return self
    def limit(self, *_a): return self
    def eq(self, *_a): return self

    def update(self, payload):
        self.mode, self.payload = "update", payload
        return self

    def execute(self):
        self.db.calls.append((f"{self.table}.{self.mode}", self.payload))
        self.db.threads.append(threading.get_ident())
        failure = self.db.fail.get(f"{self.table}.{self.mode}")
        if failure:
            raise failure
        if self.mode == "update":
            self.db.row.update(self.payload)
        return SimpleNamespace(data=[dict(self.db.row)] if self.db.row else [])


class _Rpc:
    def __init__(self, db, name, params):
        self.db, self.name, self.params = db, name, params

    def execute(self):
        self.db.calls.append((self.name, self.params))
        self.db.threads.append(threading.get_ident())
        failure = self.db.fail.get(self.name)
        if failure:
            raise failure
        return SimpleNamespace(data=self.db.rpc_result.get(self.name))


class _Db:
    def __init__(self, row=None):
        self.row = dict(row) if row else None
        self.calls: list = []
        self.threads: list = []
        self.fail: dict = {}
        self.rpc_result: dict = {}

    def table(self, name): return _Q(self, name)
    def rpc(self, name, params): return _Rpc(self, name, params)

    def names(self):
        return [name for name, _ in self.calls]


def _row(**over):
    return {"id": CID, "name": "C2-K12", "is_active": True, "archived_at": None,
            "archived_by": None, "archive_reason": None, **over}


ARCHIVED = {"status": "archived", "archived_at": "2026-11-02T12:00:00+00:00",
            "counts": COUNTS, "legacy_upgrade": False}
RESTORED = {"status": "restored", "counts": COUNTS, "was_legacy": False}


@pytest.fixture
def fake(monkeypatch):
    db = _Db(_row())
    monkeypatch.setattr(mod, "supabase_admin", db)
    return db


@pytest.fixture
def client(fake):
    from main import app
    with patch.object(mod, "require_admin", AsyncMock(return_value=ADMIN)):
        with TestClient(app) as c:
            yield c


# ── Service: state, reason, 409 mapping ──────────────────────────────────

@pytest.mark.parametrize("row,archived,legacy", [
    (_row(), False, False),
    (_row(is_active=False, archived_at="2026-11-02T12:00:00Z"), True, False),
    (_row(is_active=False), False, True),                 # pre-337 "Lưu trữ"
    ({"id": CID, "is_active": False}, False, True),       # schema without 337 columns
    (None, False, False),
    ({}, False, False),
])
def test_archived_and_legacy_follow_the_spec_definitions(row, archived, legacy):
    assert svc.is_cohort_archived(row) is archived
    assert svc.is_legacy_inactive(row) is legacy


def test_reason_is_trimmed_empty_is_null_and_500_is_the_limit():
    assert svc.normalize_reason(None) is None
    assert svc.normalize_reason("   \n") is None
    assert svc.normalize_reason("  Kết thúc khoá ") == "Kết thúc khoá"
    assert svc.normalize_reason(" " + "x" * 500 + " ") == "x" * 500
    with pytest.raises(ValueError):
        svc.normalize_reason("x" * 501)


def test_cohort_archived_error_maps_to_one_409_shape_per_audience():
    staff = svc.cohort_archived_error()
    learner = svc.cohort_archived_error(learner=True)
    assert staff.status_code == learner.status_code == 409
    assert staff.detail == {"code": "cohort_archived", "message": svc.COHORT_ARCHIVED_STAFF_MESSAGE}
    assert learner.detail == {"code": "cohort_archived", "message": svc.COHORT_ARCHIVED_LEARNER_MESSAGE}

    guard = Exception("{'code': 'P0001', 'message': 'cohort_archived', 'details': '" + CID + "'}")
    assert svc.is_cohort_archived_error(guard)
    with pytest.raises(HTTPException) as caught:
        svc.raise_if_cohort_archived(guard)
    assert caught.value.detail == staff.detail
    assert caught.value.__cause__ is None and caught.value.__suppress_context__
    assert CID not in json.dumps(caught.value.detail)

    # Other errors (and an already-mapped 409) pass through untouched.
    svc.raise_if_cohort_archived(Exception("student_archived"))
    assert not svc.is_cohort_archived_error(svc.cohort_archived_error())


def test_cohort_accepts_work_is_false_for_an_archived_class_only():
    assert svc.cohort_accepts_work(_Db(_row()), CID)
    assert svc.cohort_accepts_work(_Db(_row(is_active=False)), CID)          # legacy
    assert not svc.cohort_accepts_work(
        _Db(_row(is_active=False, archived_at="2026-11-02T12:00:00Z")), CID)
    assert svc.cohort_accepts_work(_Db(None), CID)                           # caller 404s
    none = _Db(_row(is_active=False, archived_at="x"))
    assert svc.cohort_accepts_work(none, None) and none.calls == []
    failing = _Db(_row())
    failing.fail["cohorts.select"] = RuntimeError(DB_ERROR)
    with pytest.raises(RuntimeError):                                        # never opens on a failed read
        svc.cohort_accepts_work(failing, CID)


# ── Service: RPC receipts ────────────────────────────────────────────────

def test_rpcs_are_called_with_the_337_parameter_names():
    db = _Db()
    db.rpc_result = {"fn_archive_cohort": ARCHIVED, "fn_restore_cohort": [RESTORED],
                     "fn_cohort_archive_counts": {**COUNTS, "extra": 9}}
    assert svc.archive_class(db, cohort_id=CID, actor_id=ADMIN["id"], reason="r") == ARCHIVED
    assert svc.restore_class(db, cohort_id=CID, actor_id=ADMIN["id"]) == RESTORED
    assert svc.archive_preview(db, CID) == COUNTS
    assert db.calls == [
        ("fn_archive_cohort", {"p_cohort_id": CID, "p_actor": ADMIN["id"], "p_reason": "r"}),
        ("fn_restore_cohort", {"p_cohort_id": CID, "p_actor": ADMIN["id"], "p_reason": None}),
        ("fn_cohort_archive_counts", {"p_cohort_id": CID}),
    ]


def test_unknown_class_is_none_and_idempotent_repeats_pass():
    db = _Db()
    assert svc.archive_class(db, cohort_id=CID, actor_id="a") is None
    assert svc.restore_class(db, cohort_id=CID, actor_id="a") is None
    assert svc.archive_preview(db, CID) is None
    db.rpc_result = {"fn_archive_cohort": {"status": "already_archived", "archived_at": "x"},
                     "fn_restore_cohort": {"status": "not_archived"}}
    assert svc.archive_class(db, cohort_id=CID, actor_id="a")["status"] == "already_archived"
    assert svc.restore_class(db, cohort_id=CID, actor_id="a")["status"] == "not_archived"


@pytest.mark.parametrize("fn,name,result", [
    (svc.archive_class, "fn_archive_cohort", {"status": "done"}),
    (svc.archive_class, "fn_archive_cohort", {**ARCHIVED, "counts": None}),
    (svc.archive_class, "fn_archive_cohort", {**ARCHIVED, "legacy_upgrade": None}),
    (svc.restore_class, "fn_restore_cohort", "restored"),
    (svc.restore_class, "fn_restore_cohort", {**RESTORED, "counts": {**COUNTS, "active_members": True}}),
    (svc.restore_class, "fn_restore_cohort", {**RESTORED, "was_legacy": "no"}),
])
def test_a_malformed_receipt_is_an_error_not_a_success(fn, name, result):
    db = _Db()
    db.rpc_result = {name: result}
    with pytest.raises(svc.ClassArchiveReceiptError):
        fn(db, cohort_id=CID, actor_id="a")


def test_a_malformed_preview_is_an_error():
    db = _Db()
    db.rpc_result = {"fn_cohort_archive_counts": {"active_members": 1}}
    with pytest.raises(svc.ClassArchiveReceiptError):
        svc.archive_preview(db, CID)


# ── Route: permissions ───────────────────────────────────────────────────

@pytest.mark.parametrize("role", ["instructor", "user", None])
@pytest.mark.parametrize("method,path,body", [
    ("patch", f"/admin/cohorts/{CID}", {"is_active": False}),
    ("patch", f"/admin/cohorts/{CID}", {"is_active": True}),
    ("get", f"/admin/cohorts/{CID}/archive-preview", None),
])
def test_only_an_admin_can_archive_restore_or_preview(monkeypatch, fake, role, method, path, body):
    """The real staff guard: an instructor, a learner or an unknown account is
    refused before any class read, RPC or write."""
    from main import app
    monkeypatch.setattr(admin_router, "get_supabase_user", AsyncMock(return_value={"id": "u1"}))
    monkeypatch.setattr(admin_router, "_staff_role_row", AsyncMock(
        return_value=SimpleNamespace(data=[{"role": role}] if role else [])))
    with TestClient(app) as c:
        kwargs = {"json": body} if body is not None else {}
        response = getattr(c, method)(path, headers=AUTH, **kwargs)
    assert response.status_code == 403
    assert fake.calls == []


# ── Route: PATCH archive / restore ───────────────────────────────────────

def test_archive_goes_through_the_rpc_and_returns_the_row_with_the_receipt(client, fake):
    fake.rpc_result["fn_archive_cohort"] = ARCHIVED
    fake.row.update(is_active=False, archived_at=ARCHIVED["archived_at"])   # what the RPC committed
    response = client.patch(f"/admin/cohorts/{CID}", headers=AUTH,
                            json={"is_active": False, "archive_reason": "  Kết thúc khoá "})
    assert response.status_code == 200
    body = response.json()
    assert body["is_active"] is False and body["archived_at"] == ARCHIVED["archived_at"]
    assert body["archive_receipt"] == ARCHIVED
    assert fake.calls == [
        ("fn_archive_cohort", {"p_cohort_id": CID, "p_actor": ADMIN["id"], "p_reason": "Kết thúc khoá"}),
        ("cohorts.select", None),                       # canonical row, no flag UPDATE
    ]


def test_restore_goes_through_the_rpc(client, fake):
    fake.rpc_result["fn_restore_cohort"] = RESTORED
    response = client.patch(f"/admin/cohorts/{CID}", headers=AUTH, json={"is_active": True})
    assert response.status_code == 200
    assert response.json()["archive_receipt"] == RESTORED
    assert fake.names() == ["fn_restore_cohort", "cohorts.select"]


def test_a_repeat_is_idempotent(client, fake):
    fake.rpc_result["fn_archive_cohort"] = {"status": "already_archived", "archived_at": "x"}
    response = client.patch(f"/admin/cohorts/{CID}", headers=AUTH, json={"is_active": False})
    assert response.status_code == 200
    assert response.json()["archive_receipt"]["status"] == "already_archived"


def test_lifecycle_runs_first_then_the_plain_update_without_is_active(client, fake):
    fake.rpc_result["fn_archive_cohort"] = ARCHIVED
    response = client.patch(f"/admin/cohorts/{CID}", headers=AUTH,
                            json={"is_active": False, "name": "C2-K12 (cũ)", "description": None})
    assert response.status_code == 200
    assert fake.names() == ["fn_archive_cohort", "cohorts.update"]
    payload = fake.calls[1][1]
    assert payload["name"] == "C2-K12 (cũ)" and payload["description"] is None
    assert "is_active" not in payload and "archived_at" not in payload


def test_a_name_only_edit_never_calls_an_rpc(client, fake):
    response = client.patch(f"/admin/cohorts/{CID}", headers=AUTH, json={"name": "Đổi tên"})
    assert response.status_code == 200
    assert "archive_receipt" not in response.json()
    assert fake.names() == ["cohorts.update"]


@pytest.mark.parametrize("cohort_id", [str(uuid4()), "not-a-uuid"])
def test_unknown_class_is_404_and_writes_nothing_else(client, fake, cohort_id):
    for body in ({"is_active": False}, {"is_active": True, "name": "x"}):
        fake.calls.clear()
        response = client.patch(f"/admin/cohorts/{cohort_id}", headers=AUTH, json=body)
        assert response.status_code == 404
        assert "cohorts.update" not in fake.names()


def test_reason_rules(client, fake):
    long = client.patch(f"/admin/cohorts/{CID}", headers=AUTH,
                        json={"is_active": False, "archive_reason": "x" * 501})
    assert long.status_code == 422 and fake.calls == []
    orphan = client.patch(f"/admin/cohorts/{CID}", headers=AUTH,
                          json={"name": "x", "archive_reason": "lý do"})
    assert orphan.status_code == 400 and fake.calls == []
    # The RPC's own limit is mapped too (no DB text).
    fake.fail["fn_archive_cohort"] = Exception("archive_reason_too_long " + DB_ERROR)
    rpc_long = client.patch(f"/admin/cohorts/{CID}", headers=AUTH, json={"is_active": False})
    assert rpc_long.status_code == 422
    assert all(internal not in rpc_long.text for internal in INTERNALS)


def test_empty_patch_is_still_400(client, fake):
    assert client.patch(f"/admin/cohorts/{CID}", headers=AUTH, json={}).status_code == 400
    assert fake.calls == []


# ── Route: errors never echo DB text and never half-write silently ───────

def _assert_clean_500(response, error_code):
    assert response.status_code == 500
    detail = response.json()["detail"]
    assert detail["error_code"] == error_code and detail["ref"]
    for internal in INTERNALS:
        assert internal not in response.text
    return detail


@pytest.mark.parametrize("is_active,rpc", [(False, "fn_archive_cohort"), (True, "fn_restore_cohort")])
def test_rpc_failure_is_generic_and_nothing_else_is_written(client, fake, caplog, is_active, rpc):
    fake.fail[rpc] = Exception(DB_ERROR)
    with caplog.at_level(logging.ERROR, logger=mod.logger.name):
        response = client.patch(f"/admin/cohorts/{CID}", headers=AUTH,
                                json={"is_active": is_active, "name": "x"})
    detail = _assert_clean_500(response, "cohort_lifecycle_failed")
    assert detail["message"] == GENERIC_MESSAGE
    assert fake.names() == [rpc]                        # no name UPDATE after a failed RPC
    assert any(detail["ref"] in record.getMessage() and record.exc_info
               and str(record.exc_info[1]) == DB_ERROR for record in caplog.records)


def test_a_malformed_receipt_is_a_generic_500(client, fake):
    fake.rpc_result["fn_archive_cohort"] = {"status": "weird"}
    response = client.patch(f"/admin/cohorts/{CID}", headers=AUTH,
                            json={"is_active": False, "name": "x"})
    _assert_clean_500(response, "cohort_lifecycle_failed")
    assert fake.names() == ["fn_archive_cohort"]


@pytest.mark.parametrize("body,step", [
    ({"is_active": False, "name": "x"}, "cohorts.update"),
    ({"is_active": False}, "cohorts.select"),
])
def test_failure_after_a_committed_archive_says_so(client, fake, body, step):
    """The archive committed; a later failure must not read as "nothing happened"."""
    fake.rpc_result["fn_archive_cohort"] = ARCHIVED
    fake.fail[step] = Exception(DB_ERROR)
    response = client.patch(f"/admin/cohorts/{CID}", headers=AUTH, json=body)
    detail = _assert_clean_500(response, "cohort_update_partial")
    assert detail["message"].startswith("Đã lưu trữ lớp")


def test_failure_after_an_idempotent_repeat_is_not_reported_as_partial(client, fake):
    fake.rpc_result["fn_restore_cohort"] = {"status": "not_archived"}
    fake.fail["cohorts.update"] = Exception(DB_ERROR)
    response = client.patch(f"/admin/cohorts/{CID}", headers=AUTH,
                            json={"is_active": True, "name": "x"})
    assert response.status_code == 500
    assert all(internal not in response.text for internal in INTERNALS)
    assert "Đã khôi phục" not in response.text


# ── Route: archive-preview ───────────────────────────────────────────────

def test_preview_returns_the_counts(client, fake):
    fake.rpc_result["fn_cohort_archive_counts"] = COUNTS
    response = client.get(f"/admin/cohorts/{CID}/archive-preview", headers=AUTH)
    assert response.status_code == 200
    assert response.json() == {"cohort_id": CID, "counts": COUNTS}
    assert fake.calls == [("fn_cohort_archive_counts", {"p_cohort_id": CID})]   # read only


@pytest.mark.parametrize("cohort_id", [str(uuid4()), "not-a-uuid"])
def test_preview_unknown_class_is_404(client, fake, cohort_id):
    assert client.get(f"/admin/cohorts/{cohort_id}/archive-preview", headers=AUTH).status_code == 404


@pytest.mark.parametrize("result,error", [(None, Exception(DB_ERROR)), ({"active_members": 1}, None)])
def test_preview_failure_is_generic(client, fake, result, error):
    fake.rpc_result["fn_cohort_archive_counts"] = result
    if error:
        fake.fail["fn_cohort_archive_counts"] = error
    detail = _assert_clean_500(
        client.get(f"/admin/cohorts/{CID}/archive-preview", headers=AUTH), "cohort_lifecycle_failed")
    assert detail["message"] == GENERIC_MESSAGE


# ── Off-loop ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_db_calls_run_off_the_event_loop(monkeypatch):
    db = _Db(_row())
    db.rpc_result = {"fn_archive_cohort": ARCHIVED, "fn_cohort_archive_counts": COUNTS}
    monkeypatch.setattr(mod, "supabase_admin", db)
    monkeypatch.setattr(mod, "require_admin", AsyncMock(return_value=ADMIN))
    loop_thread = threading.get_ident()
    await mod.update_cohort(CID, mod.CohortPatchRequest(is_active=False, name="x"), None)
    await mod.update_cohort(CID, mod.CohortPatchRequest(name="y"), None)
    await mod.cohort_archive_preview(CID, None)
    assert len(db.threads) == 4 and loop_thread not in db.threads


# ── PostgreSQL: the routes against the real 337 RPCs ─────────────────────

db = m337.db   # module-scoped 337 harness (legacy inactive class + member + open give)


def _literal(value) -> str:
    return "NULL" if value is None else "'" + str(value).replace("'", "''") + "'"


class _PgClient:
    """Just enough PostgREST for the cohort routes, on the 337 harness schema.

    RPCs are called with NAMED arguments, so a wrong parameter name fails as it
    would on PostgREST. Calls run as service_role, like supabase_admin.
    """

    def __init__(self, schema):
        self.s = schema

    def rpc(self, name, params):
        args = ", ".join(f"{key} => {_literal(value)}" for key, value in params.items())
        # An SQL NULL prints nothing, and _as() would then return the
        # set_config line; emit JSON null instead.
        sql = f"SELECT coalesce(({self.s}.{name}({args}))::text, 'null')"
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=m337._rpc_json(sql)))

    def table(self, name):
        assert name == "cohorts", name
        pg, state = self, {"payload": None, "id": None}

        class _T:
            def select(self, *_a): return self
            def limit(self, *_a): return self
            def update(self, payload):
                state["payload"] = payload
                return self
            def eq(self, _col, value):
                state["id"] = value
                return self
            def execute(self):
                where = f"WHERE id = {_literal(state['id'])}"
                if state["payload"]:
                    sets = ", ".join(f"{k} = {_literal(v)}" for k, v in state["payload"].items())
                    out = m326._as("service_role",
                                   f"UPDATE {pg.s}.cohorts SET {sets} {where} RETURNING row_to_json(cohorts)")
                else:
                    out = m326._as("service_role", f"SELECT row_to_json(c) FROM {pg.s}.cohorts c {where}")
                return SimpleNamespace(data=[json.loads(line) for line in out.splitlines() if line])
        return _T()


def _call(coro):
    return asyncio.run(coro)


def test_pg_archive_preview_and_restore_through_the_route(db, monkeypatch):
    s, admin = db["s"], db["admin"]
    learner = m326._learner(s)
    sid, cid = learner["student"], learner["cohorts"][0]
    psql(m326._svc(m337._give_rpc(s, admin, [sid], cid)))
    psql(f"INSERT INTO {s}.access_codes (cohort_id) VALUES ('{cid}')")
    counts = {"active_members": 1, "open_writing_gives": 1, "open_class_items": 0, "unused_class_codes": 1}
    monkeypatch.setattr(mod, "supabase_admin", _PgClient(s))
    monkeypatch.setattr(mod, "require_admin", AsyncMock(return_value={"id": admin}))

    assert _call(mod.cohort_archive_preview(cid, None)) == {"cohort_id": cid, "counts": counts}

    row = _call(mod.update_cohort(cid, mod.CohortPatchRequest(
        is_active=False, archive_reason="  Kết thúc khoá  ", name="renamed"), None))
    assert row["is_active"] is False and row["archived_at"] and row["name"] == "renamed"
    assert row["archive_receipt"]["status"] == "archived"
    assert row["archive_receipt"]["counts"] == counts
    assert row["archive_receipt"]["legacy_upgrade"] is False
    assert m337._class_state(s, cid) == f"f|t|{admin}|Kết thúc khoá"   # rename kept the archive
    assert m337._audits(s, cid, "archive") == 1

    again = _call(mod.update_cohort(cid, mod.CohortPatchRequest(is_active=False), None))
    assert again["archive_receipt"]["status"] == "already_archived"
    assert m337._audits(s, cid) == 1                                     # no audit on a repeat

    restored = _call(mod.update_cohort(cid, mod.CohortPatchRequest(is_active=True), None))
    assert restored["is_active"] is True and restored["archived_at"] is None
    assert restored["archive_receipt"] == {"status": "restored", "counts": counts, "was_legacy": False}
    assert m337._class_state(s, cid) == "t|f|-|-" and m337._audits(s, cid, "restore") == 1

    with pytest.raises(HTTPException) as unknown:
        _call(mod.update_cohort(str(uuid4()), mod.CohortPatchRequest(is_active=False), None))
    assert unknown.value.status_code == 404
    with pytest.raises(HTTPException) as unknown_preview:
        _call(mod.cohort_archive_preview(str(uuid4()), None))
    assert unknown_preview.value.status_code == 404


def test_pg_apply_archive_to_the_legacy_class_through_the_route(db, monkeypatch):
    """FR-009: "Áp dụng lưu trữ" on the pre-337 inactive class is an explicit,
    audited legacy upgrade; the preview counts its member and open give."""
    s, admin, legacy = db["s"], db["admin"], db["legacy"]
    monkeypatch.setattr(mod, "supabase_admin", _PgClient(s))
    monkeypatch.setattr(mod, "require_admin", AsyncMock(return_value={"id": admin}))
    preview = _call(mod.cohort_archive_preview(legacy, None))
    assert preview["counts"]["active_members"] == 1 and preview["counts"]["open_writing_gives"] == 1

    row = _call(mod.update_cohort(legacy, mod.CohortPatchRequest(is_active=False), None))
    assert row["archive_receipt"]["status"] == "archived"
    assert row["archive_receipt"]["legacy_upgrade"] is True
    assert row["archive_receipt"]["counts"] == preview["counts"]
    detail = json.loads(psql(f"SELECT detail FROM {s}.class_lifecycle_audit "
                             f"WHERE cohort_id = '{legacy}' AND action = 'archive'"))
    assert detail["legacy_upgrade"] is True
