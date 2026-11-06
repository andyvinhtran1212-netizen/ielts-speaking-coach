"""CLASSARCHIVE-0030 T004/T005: instructor class list, mint and gives; admin
Writing fan-out; late-joiner backfill (W2); the roster and seed scripts.

research.md §4.1/§4.2:
  • W7  instructor `POST /instructor/codes` with an archived class → 409 staff;
  • W9  instructor `/assignments/fan-out` and admin `/admin/writing/assignments/
        fan-out` into an archived class → 409 staff, nothing written. A request
        that completed before the archive still replays its receipt (FR-003). The
        337 give guard (`cohort_archived`) is mapped to the same 409, after
        `student_archived` (precedence);
  • W2  `backfill_cohort_writing_assignments` returns
        {"created_count": 0, "skipped": "cohort_archived"} for an archived class;
        `scripts/backfill_class_enrollment_roster.py` logs and skips it;
  • T004 `GET /instructor/cohorts` passes `is_active` / `archived_*` through.
A legacy inactive class (`is_active=false`, `archived_at` NULL) keeps today's
behaviour everywhere. No response carries database text.
"""

from __future__ import annotations

import contextlib
import logging
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from postgrest.exceptions import APIError

import instructor_give_fake
from services import class_archive_service as archive_svc
from services.cohort_assignment_service import (
    backfill_cohort_writing_assignments,
    fan_out_assignment,
)
from tests.test_cohort_backfill_late_joiner import _FakeSB as _BackfillSB, _give
from tests.test_instructor_routes_isolation import AB, AA, B, CB, PB, _FakeSB, _rid, _seed

HDR = {"Authorization": "Bearer x"}
FAN_OUT = "/instructor/assignments/fan-out"
LEDGER = "instructor_writing_assignment_requests"
ARCHIVED_AT = "2026-11-02T12:00:00+00:00"
STAFF_409 = {"code": "cohort_archived", "message": archive_svc.COHORT_ARCHIVED_STAFF_MESSAGE}
DB_TEXT = "cohort_archived"
SECRET_DETAIL = "private-cohort-detail-xyz"


def _guard_error() -> APIError:
    """The 337 give guard as PostgREST raises it (DETAIL = cohort id)."""
    return APIError({"code": "P0001", "message": "cohort_archived", "details": SECRET_DETAIL})


def _archive(store, cohort_id=CB, *, legacy=False):
    for row in store["cohorts"]:
        if row["id"] == cohort_id:
            row.update(is_active=False, archived_at=None if legacy else ARCHIVED_AT,
                       archived_by=None if legacy else "admin-1",
                       archive_reason=None if legacy else "Kết thúc khoá")


def _no_db_text(response) -> None:
    assert SECRET_DETAIL not in response.text
    assert "P0001" not in response.text


# ── Instructor routes on the filtering fake ─────────────────────────────────

class _CountingSB(_FakeSB):
    def __init__(self, store):
        super().__init__(store)
        self.calls: list[str] = []
        self.rpc_error: Exception | None = None

    def table(self, name):
        self.calls.append(name)
        return super().table(name)

    def rpc(self, name, params):
        self.calls.append(f"rpc:{name}")
        if self.rpc_error is not None:
            error = self.rpc_error
            return SimpleNamespace(execute=lambda: (_ for _ in ()).throw(error))
        return super().rpc(name, params)


@contextlib.contextmanager
def _as(me, store):
    fake = _CountingSB(store)
    with contextlib.ExitStack() as es:
        es.enter_context(patch("routers.instructor.require_instructor",
                               new=AsyncMock(return_value={"id": me})))
        for target in ("routers.instructor.supabase_admin",
                       "services.instructor_access.supabase_admin"):
            es.enter_context(patch(target, fake))
        from main import app
        yield TestClient(app, raise_server_exceptions=False), fake


def _new_gives(store) -> list[dict]:
    return [r for r in store["writing_assignments"] if r["id"] not in (AA, AB)]


def _fan_out_body(request_id: str) -> dict:
    return {"request_id": request_id, "prompt_ids": [PB], "cohort_id": CB}


def test_instructor_fan_out_into_an_archived_class_is_409_and_writes_nothing():
    store = _seed()
    _archive(store)
    with _as(B, store) as (client, fake):
        r = client.post(FAN_OUT, json=_fan_out_body(_rid()), headers=HDR)
    assert r.status_code == 409, r.text
    assert r.json()["detail"] == STAFF_409
    assert not any(c.startswith("rpc:") for c in fake.calls)
    assert _new_gives(store) == [] and store.get(LEDGER, []) == []


@pytest.mark.parametrize("legacy", [True, False])
def test_instructor_fan_out_into_an_active_or_legacy_class_still_gives(legacy):
    store = _seed()
    if legacy:
        _archive(store, legacy=True)
    with _as(B, store) as (client, _fake):
        r = client.post(FAN_OUT, json=_fan_out_body(_rid()), headers=HDR)
    assert r.status_code == 201, r.text
    assert len(_new_gives(store)) == 1


def test_instructor_fan_out_completed_before_the_archive_replays_its_receipt():
    store = _seed()
    rid = _rid()
    with _as(B, store) as (client, _fake):
        first = client.post(FAN_OUT, json=_fan_out_body(rid), headers=HDR)
        assert first.status_code == 201, first.text
        rows = [dict(r) for r in _new_gives(store)]
        _archive(store)
        again = client.post(FAN_OUT, json=_fan_out_body(rid), headers=HDR)
        fresh = client.post(FAN_OUT, json=_fan_out_body(_rid()), headers=HDR)
    assert again.status_code == 201, again.text
    assert again.json() == first.json()
    assert _new_gives(store) == rows
    assert fresh.status_code == 409 and fresh.json()["detail"] == STAFF_409


def test_instructor_fan_out_not_my_class_stays_403_even_when_archived():
    store = _seed()
    with _as(B, store) as (client, _fake):
        r = client.post(FAN_OUT, json={"request_id": _rid(), "prompt_ids": [PB],
                                       "cohort_id": "00000000-0000-0000-0000-0000000000c9"},
                        headers=HDR)
    assert r.status_code == 403, r.text
    assert "cohort_archived" not in r.text


def test_instructor_fan_out_archive_after_the_precheck_maps_the_guard_to_409():
    store = _seed()
    with _as(B, store) as (client, fake):
        fake.rpc_error = _guard_error()
        r = client.post(FAN_OUT, json=_fan_out_body(_rid()), headers=HDR)
    assert r.status_code == 409, r.text
    assert r.json()["detail"] == STAFF_409
    _no_db_text(r)
    assert _new_gives(store) == []


def test_instructor_fan_out_student_archived_wins_over_cohort_archived():
    store = _seed()
    with _as(B, store) as (client, fake):
        # create_give maps `student_archived` first; the route must not re-map it.
        with patch("routers.instructor.instructor_give_service.create_give",
                   side_effect=HTTPException(409, {"code": "student_archived", "message": "m",
                                                   "student_ids": ["s"]})):
            r = client.post(FAN_OUT, json=_fan_out_body(_rid()), headers=HDR)
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "student_archived"


def test_instructor_fan_out_other_rpc_errors_are_not_mapped_to_cohort_archived():
    store = _seed()
    with _as(B, store) as (client, fake):
        fake.rpc_error = APIError({"code": "P0001", "message": "cohort_archived_but_not_really"})
        r = client.post(FAN_OUT, json=_fan_out_body(_rid()), headers=HDR)
    assert r.status_code == 500
    assert "cohort_archived" not in r.text


@pytest.mark.parametrize("legacy,status", [(False, 409), (True, 201)])
def test_instructor_mint_for_an_archived_class_is_409_and_inserts_no_code(legacy, status):
    store = _seed()
    _archive(store, legacy=legacy)
    before = len(store["access_codes"])
    with _as(B, store) as (client, _fake):
        r = client.post("/instructor/codes", json={"cohort_id": CB, "count": 2}, headers=HDR)
    assert r.status_code == status, r.text
    if status == 409:
        assert r.json()["detail"] == STAFF_409
        assert len(store["access_codes"]) == before
        assert not [a for a in store["access_code_audit"] if a["action"] == "code_mint"]
    else:
        assert r.json()["created"] == 2


def test_instructor_mint_without_a_class_or_for_an_active_class_is_unchanged():
    store = _seed()
    with _as(B, store) as (client, _fake):
        mass = client.post("/instructor/codes", json={"count": 1}, headers=HDR)
        direct = client.post("/instructor/codes", json={"cohort_id": CB}, headers=HDR)
    assert mass.status_code == direct.status_code == 201, (mass.text, direct.text)


def test_instructor_mint_not_my_class_stays_403_before_the_archive_check():
    store = _seed()
    with _as(B, store) as (client, _fake):
        r = client.post("/instructor/codes",
                        json={"cohort_id": "00000000-0000-0000-0000-0000000000c9"}, headers=HDR)
    assert r.status_code == 403
    assert "cohort_archived" not in r.text


def test_instructor_cohorts_list_passes_the_archive_state_through():
    store = _seed()
    _archive(store)
    with _as(B, store) as (client, _fake), \
            patch("routers.instructor.test_data_visibility.hide_for", return_value=False):
        r = client.get("/instructor/cohorts", headers=HDR)
    assert r.status_code == 200, r.text
    [row] = [c for c in r.json() if c["id"] == CB]
    assert row["is_active"] is False
    assert row["archived_at"] == ARCHIVED_AT
    assert row["archived_by"] == "admin-1" and row["archive_reason"] == "Kết thúc khoá"


# ── Admin Writing fan-out ───────────────────────────────────────────────────

ADMIN = {"id": "00000000-0000-0000-0000-00000000aaaa", "email": "admin@x"}
ADMIN_COHORT = "00000000-0000-4000-8000-000000000004"
ADMIN_STUDENT = "00000000-0000-4000-8000-000000000005"
ADMIN_PROMPT = "00000000-0000-4000-8000-000000000003"


class _AdminDb:
    def __init__(self, cohort):
        self.cohort = cohort
        self.rpcs: list = []
        self.rpc_error: Exception | None = None
        self.rpc_result = {"created_count": 1, "group_id": "g", "replayed": False}

    def table(self, name):
        assert name == "cohorts", name
        rows = [dict(self.cohort)] if self.cohort else []
        query = SimpleNamespace()
        query.select = lambda *_a, **_k: query
        query.eq = lambda *_a, **_k: query
        query.limit = lambda *_a, **_k: query
        query.execute = lambda: SimpleNamespace(data=rows)
        return query

    def rpc(self, name, params):
        def execute():
            self.rpcs.append(name)
            if self.rpc_error is not None:
                raise self.rpc_error
            return SimpleNamespace(data=self.rpc_result)
        return SimpleNamespace(execute=execute)


@contextlib.contextmanager
def _admin(cohort, *, replay=None):
    from routers import admin_writing_assignments as mod
    db = _AdminDb(cohort)
    with patch.object(mod, "require_admin", AsyncMock(return_value=ADMIN)), \
            patch.object(mod, "supabase_admin", db), \
            patch.object(mod, "_read_assignment_request_receipt", return_value=replay), \
            patch.object(mod, "active_student_ids_for_cohort", return_value=[ADMIN_STUDENT]):
        from main import app
        yield TestClient(app, raise_server_exceptions=False), db


def _admin_body() -> dict:
    return {"request_id": _rid(), "prompt_id": ADMIN_PROMPT, "cohort_id": ADMIN_COHORT}


def _cohort_row(**over):
    return {"id": ADMIN_COHORT, "name": "C", "is_active": True, "archived_at": None, **over}


def test_admin_fan_out_into_an_archived_class_is_409_before_the_rpc():
    with _admin(_cohort_row(is_active=False, archived_at=ARCHIVED_AT)) as (client, db):
        r = client.post("/admin/writing/assignments/fan-out", json=_admin_body(), headers=HDR)
    assert r.status_code == 409, r.text
    assert r.json()["detail"] == STAFF_409
    assert db.rpcs == []


@pytest.mark.parametrize("row", [_cohort_row(), _cohort_row(is_active=False)])
def test_admin_fan_out_into_an_active_or_legacy_class_still_gives(row):
    with _admin(row) as (client, db):
        r = client.post("/admin/writing/assignments/fan-out", json=_admin_body(), headers=HDR)
    assert r.status_code == 201, r.text
    assert db.rpcs == ["fn_create_writing_assignments_idempotent"]


def test_admin_fan_out_completed_before_the_archive_replays_its_receipt():
    receipt = {"created_count": 3, "group_id": "g-old", "replayed": True}
    with _admin(_cohort_row(is_active=False, archived_at=ARCHIVED_AT),
                replay=receipt) as (client, db):
        r = client.post("/admin/writing/assignments/fan-out", json=_admin_body(), headers=HDR)
    assert r.status_code == 201, r.text
    assert r.json() == receipt
    assert db.rpcs == []


def test_admin_fan_out_archive_after_the_precheck_maps_the_guard_to_409():
    with _admin(_cohort_row()) as (client, db):
        db.rpc_error = _guard_error()
        with patch("services.student_service.archived_student_ids", return_value=[]):
            r = client.post("/admin/writing/assignments/fan-out", json=_admin_body(), headers=HDR)
    assert r.status_code == 409, r.text
    assert r.json()["detail"] == STAFF_409
    _no_db_text(r)


def test_admin_fan_out_student_archived_takes_precedence():
    from services import student_service
    with _admin(_cohort_row()) as (client, db):
        db.rpc_error = _guard_error()
        with patch.object(student_service, "raise_if_student_archived",
                          side_effect=student_service.student_archived_error([ADMIN_STUDENT])):
            r = client.post("/admin/writing/assignments/fan-out", json=_admin_body(), headers=HDR)
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "student_archived"


def test_admin_individual_give_has_no_class_gate():
    """`POST /admin/writing/assignments` takes student_ids only (no cohort_id):
    an individual give to a learner whose class is archived stays allowed."""
    from routers import admin_writing_assignments as mod
    assert "cohort_id" not in mod.AssignmentCreate.model_fields


# ── W2: late-joiner backfill + legacy fan_out_assignment ────────────────────

COHORT = "c-700"
NEW = "s-new"


def _backfill_store(**cohort):
    return {"writing_assignments": [_give()],
            "cohorts": [{"id": COHORT, "is_active": True, "archived_at": None, **cohort}]}


def test_backfill_skips_an_archived_class_and_creates_nothing():
    store = _backfill_store(is_active=False, archived_at=ARCHIVED_AT)
    res = backfill_cohort_writing_assignments(_BackfillSB(store), student_id=NEW, cohort_id=COHORT)
    assert res["created_count"] == 0 and res["skipped"] == "cohort_archived"
    assert res["assignment_ids"] == []
    assert [w for w in store["writing_assignments"] if w["student_id"] == NEW] == []


def test_backfill_of_a_legacy_inactive_class_is_unchanged():
    store = _backfill_store(is_active=False)
    res = backfill_cohort_writing_assignments(_BackfillSB(store), student_id=NEW, cohort_id=COHORT)
    assert res["created_count"] == 1 and "skipped" not in res


def test_backfill_archive_during_the_insert_is_the_same_skip():
    class _GuardedSB(_BackfillSB):
        def table(self, name):
            query = super().table(name)
            if name == "writing_assignments":
                query.insert = lambda _payload: SimpleNamespace(
                    execute=lambda: (_ for _ in ()).throw(_guard_error()))
            return query

    store = _backfill_store()
    with patch("services.cohort_assignment_service.raise_if_student_archived"):
        res = backfill_cohort_writing_assignments(_GuardedSB(store), student_id=NEW, cohort_id=COHORT)
    assert res == {"created_count": 0, "assignment_ids": [], "skipped": "cohort_archived"}


def test_backfill_skip_results_do_not_share_state():
    store = _backfill_store(is_active=False, archived_at=ARCHIVED_AT)
    first = backfill_cohort_writing_assignments(_BackfillSB(store), student_id=NEW, cohort_id=COHORT)
    first["assignment_ids"].append("mutated")
    second = backfill_cohort_writing_assignments(_BackfillSB(store), student_id=NEW, cohort_id=COHORT)
    assert second["assignment_ids"] == []


def test_backfill_archive_lookup_failure_propagates():
    class _BrokenSB(_BackfillSB):
        def table(self, name):
            if name == "cohorts":
                raise RuntimeError("down")
            return super().table(name)

    with pytest.raises(RuntimeError):
        backfill_cohort_writing_assignments(_BrokenSB(_backfill_store()), student_id=NEW,
                                            cohort_id=COHORT)


def test_legacy_fan_out_assignment_maps_the_give_guard_to_409():
    class _GuardedSB(_BackfillSB):
        def table(self, name):
            query = super().table(name)
            if name == "writing_assignments":
                query.insert = lambda _payload: SimpleNamespace(
                    execute=lambda: (_ for _ in ()).throw(_guard_error()))
            return query

    store = {"writing_assignments": [], "students": [{"id": NEW, "cohort_id": COHORT}],
             "student_cohort_memberships": []}
    with patch("services.cohort_assignment_service.raise_if_student_archived"), \
            patch("services.cohort_assignment_service._fan_out_roster", return_value=[NEW]), \
            pytest.raises(HTTPException) as exc:
        fan_out_assignment(_GuardedSB(store), prompt_ids=["p-1"], cohort_id=COHORT,
                           assigned_by="admin")
    assert exc.value.status_code == 409 and exc.value.detail == STAFF_409


# ── Scripts ─────────────────────────────────────────────────────────────────

class _ScriptQ:
    def __init__(self, sb, table):
        self.sb, self.table, self.filters, self.op, self.payload = sb, table, [], "select", None
        self.negate = False

    def select(self, *_a, **_k): return self
    def limit(self, *_a): return self
    def order(self, *_a, **_k): return self
    def range(self, *_a): return self

    @property
    def not_(self):
        self.negate = True
        return self

    def eq(self, col, val):
        self.filters.append(lambda r, c=col, v=val: str(r.get(c)) == str(v)); return self

    def in_(self, col, vals):
        self.filters.append(lambda r, c=col, v=list(vals): str(r.get(c)) in v); return self

    def is_(self, col, _null):
        neg, self.negate = self.negate, False
        self.filters.append(lambda r, c=col, n=neg: (r.get(c) is not None) if n else (r.get(c) is None))
        return self

    def update(self, payload):
        self.op, self.payload = "update", payload; return self

    def execute(self):
        rows = self.sb.store.setdefault(self.table, [])
        matched = [r for r in rows if all(f(r) for f in self.filters)]
        if self.op == "update":
            self.sb.updates.append((self.table, dict(self.payload)))
            for r in matched:
                r.update(self.payload)
        return SimpleNamespace(data=[dict(r) for r in matched])


class _ScriptSB:
    def __init__(self, store):
        self.store, self.updates = store, []

    def table(self, name): return _ScriptQ(self, name)


def _run_roster_script(store, *, apply: bool, backfill):
    import database
    from scripts import backfill_class_enrollment_roster as script
    from services import class_membership_service, cohort_assignment_service
    db = _ScriptSB(store)
    argv = ["backfill_class_enrollment_roster"] + (["--apply"] if apply else [])
    with patch.object(database, "supabase_admin", db), \
            patch.object(sys, "argv", argv), \
            patch.object(class_membership_service, "active_student_ids_for_cohort",
                         lambda _db, cid: [s["id"] for s in store["students"]
                                           if s.get("cohort_id") == cid]), \
            patch.object(cohort_assignment_service, "backfill_cohort_writing_assignments",
                         backfill):
        assert script.main() == 0
    return db


def _roster_store():
    return {
        "students": [{"id": "s-arch", "instructor_id": None, "cohort_id": "c-arch"},
                     {"id": "s-live", "instructor_id": None, "cohort_id": "c-live"}],
        "student_cohort_memberships": [
            {"id": "m1", "student_id": "s-arch", "cohort_id": "c-arch", "is_active": True},
            {"id": "m2", "student_id": "s-live", "cohort_id": "c-live", "is_active": True}],
        "cohorts": [
            {"id": "c-arch", "created_by": "gv-1", "is_active": False, "archived_at": ARCHIVED_AT},
            {"id": "c-live", "created_by": "gv-2", "is_active": True, "archived_at": None}],
        "writing_assignments": [{"id": "w1", "cohort_id": "c-arch"},
                                {"id": "w2", "cohort_id": "c-live"}],
    }


def test_roster_script_skips_an_archived_class_in_e1_and_logs_it(caplog):
    calls = []

    def backfill(_db, *, student_id, cohort_id):
        calls.append((student_id, cohort_id))
        return {"created_count": 1, "assignment_ids": ["x"]}

    with caplog.at_level(logging.INFO, logger="backfill_class_enrollment_roster"):
        _run_roster_script(_roster_store(), apply=True, backfill=backfill)
    assert calls == [("s-live", "c-live")]
    assert "E1 skipped archived cohort=c-arch" in caplog.text
    assert "skipped_archived_cohorts=1" in caplog.text


def test_roster_script_dry_run_also_skips_the_archived_class(caplog):
    with caplog.at_level(logging.INFO, logger="backfill_class_enrollment_roster"):
        _run_roster_script(_roster_store(), apply=False,
                           backfill=lambda *_a, **_k: pytest.fail("dry-run wrote"))
    assert "E1 would backfill student=s-arch" not in caplog.text
    assert "E1 would backfill student=s-live cohort=c-live" in caplog.text


def test_roster_script_counts_an_archive_during_the_run_as_a_skip(caplog):
    store = _roster_store()
    store["cohorts"][0].update(is_active=True, archived_at=None)
    store["students"].append({"id": "s-arch-2", "instructor_id": "gv-1", "cohort_id": "c-arch"})
    calls = []

    def backfill(_db, *, student_id, cohort_id):
        calls.append(student_id)
        if cohort_id == "c-arch":
            return {"created_count": 0, "assignment_ids": [], "skipped": "cohort_archived"}
        return {"created_count": 0, "assignment_ids": []}

    with caplog.at_level(logging.INFO, logger="backfill_class_enrollment_roster"):
        _run_roster_script(store, apply=True, backfill=backfill)
    # The first refusal stops the class; its other member is not attempted.
    assert calls.count("s-arch") + calls.count("s-arch-2") == 1
    assert "archived during the run" in caplog.text
    assert "skipped_archived_cohorts=1" in caplog.text


def test_roster_script_e6_still_stamps_the_owner_of_an_archived_class():
    db = _run_roster_script(_roster_store(), apply=True,
                            backfill=lambda *_a, **_k: {"created_count": 0, "assignment_ids": []})
    stamped = {r["id"]: r["instructor_id"] for r in db.store["students"]}
    assert stamped == {"s-arch": "gv-1", "s-live": "gv-2"}


def test_staging_seed_creates_no_class_membership_or_give():
    """T005 lists staging_seed.py: it seeds identities and codes only, so it has
    nothing to skip. Pin that, so a future class seed must face the archive rule."""
    source = (Path(__file__).resolve().parents[1] / "scripts" / "staging_seed.py").read_text()
    for table in ("cohorts", "student_cohort_memberships", "writing_assignments",
                  "class_assignments", "class_lessons", "cohort_id"):
        assert f'"{table}"' not in source and f"'{table}'" not in source, table
