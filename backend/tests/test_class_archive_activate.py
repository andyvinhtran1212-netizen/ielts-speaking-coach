"""CLASSARCHIVE-0030 FR-002/FR-008: activation refuses an archived class.

Use the bare router so main.py's 5xx sanitizer cannot hide a route-level leak.
The fake enforces projections and migration 099's actual audit columns; the
PostgreSQL cases below exercise the real 227 → 337 enrollment trigger chain.
"""

from copy import deepcopy
import json
import logging
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

import routers.auth as auth
from services.request_context import request_id_scope


USER = "learner-1"
CODE = "ARCHIVEQA"
COHORT = "class-1"
GENERIC = "Access code không hợp lệ hoặc không thể sử dụng. Kiểm tra lại mã hoặc liên hệ admin."
DB_TEXT = "private-db-marker 42P01"
AUDIT_COLUMNS = {
    "id", "actor_user_id", "action", "code_id", "target_user_id", "before", "after", "created_at",
}


def _eq(stored, value):
    # PostgREST compares a jsonb column with its JSON text (eq.["a"]).
    if isinstance(stored, (list, dict)) and isinstance(value, str):
        return stored == json.loads(value)
    return stored == value


class Query:
    def __init__(self, db, table):
        self.db, self.name = db, table
        self.op, self.fields, self.values, self.filters = "select", "*", None, {}

    def select(self, fields):
        self.fields = fields
        return self

    def eq(self, field, value):
        self.filters[field] = value
        return self

    def limit(self, _limit):
        return self

    def insert(self, values):
        self.op, self.values = "insert", deepcopy(values)
        return self

    def update(self, values):
        self.op, self.values = "update", deepcopy(values)
        return self

    def upsert(self, values, **_kwargs):
        return self.insert(values)

    def execute(self):
        db = self.db
        db.calls.append((self.name, self.op))
        if db.fail_at == (self.name, self.op):
            raise RuntimeError(DB_TEXT)
        if self.name == "users" and self.op == "update":
            if self.values.get("is_active") is True:
                db.activated = True
                if db.archive_race:
                    db.tables["cohorts"][0].update(is_active=False, archived_at="2026-10-29T00:00:00Z")
            elif db.activated:
                db.reverts += 1
                if db.reverts <= db.revert_failures:
                    raise RuntimeError(DB_TEXT)
                if db.empty_revert:
                    return SimpleNamespace(data=[])
        if self.name == "students" and self.op != "select" and db.archive_race:
            from postgrest.exceptions import APIError
            raise APIError({"message": "cohort_archived", "code": "P0001",
                            "details": DB_TEXT, "hint": None})
        if self.name == "access_code_audit" and self.op == "insert":
            assert self.values.keys() <= AUDIT_COLUMNS, "migration 099 has no detail column"
        rows = db.tables.setdefault(self.name, [])
        matches = [row for row in rows if all(_eq(row.get(k), v) for k, v in self.filters.items())]
        if self.op == "select":
            if self.fields != "*":
                fields = [f.strip() for f in self.fields.split(",")]
                assert all(f in row for row in matches for f in fields), "42703: unknown projection"
                matches = [{f: row[f] for f in fields} for row in matches]
        elif self.op == "insert":
            row = {"id": str(uuid4()), **self.values}
            if self.name == "users":
                row = {"permissions": None, "access_code_used": None, **row}
            rows.append(row)
            matches = [row]
        elif self.op == "update":
            for row in matches:
                row.update(self.values)
        return SimpleNamespace(data=deepcopy(matches))


class Database:
    def __init__(self):
        self.calls = []
        self.attempts = self.reverts = 0
        self.revert_failures = 0
        self.archive_race = self.activated = self.empty_revert = False
        self.fail_at = None
        self.tables = {
            "users": [{"id": USER, "role": "user", "is_active": False,
                       "access_code_used": "PREVIOUS", "permissions": ["writing"], "suspended_at": None}],
            "students": [],
            "cohorts": [{"id": COHORT, "is_active": True, "archived_at": None, "created_by": None}],
            "access_codes": [{"id": "code-1", "code": CODE, "cohort_id": COHORT,
                              "is_used": False, "used_by": None, "used_at": None,
                              "permissions": ["practice_single"]}],
        }

    def table(self, name):
        return Query(self, name)

    def rpc(self, name, _params):
        assert name == "fn_activate_attempt_check"
        self.attempts += 1
        return SimpleNamespace(execute=lambda: SimpleNamespace(data={"allowed": True, "retry_after_s": 0}))


@pytest.fixture
def world(monkeypatch, live_activate_rate_limit):
    db = Database()
    monkeypatch.setattr(auth, "supabase_admin", db)
    monkeypatch.setattr(auth, "get_supabase_user", AsyncMock(return_value={
        "id": USER, "email": "learner@example.test", "user_metadata": {},
    }))
    monkeypatch.setattr(auth, "student_is_active_in_cohort", lambda *_args: False)
    monkeypatch.setattr("services.cohort_assignment_service.backfill_cohort_writing_assignments", lambda *_a, **_kw: None)
    app = FastAPI()
    app.include_router(auth.router)
    with TestClient(app) as client:
        yield db, client


def activate(client, code=CODE):
    return client.post("/auth/activate", json={"access_code": code}, headers={"Authorization": "Bearer fake"})


def assert_unused(db):
    assert db.tables["access_codes"][0]["is_used"] is False
    assert db.tables["access_codes"][0]["used_by"] is None
    assert db.tables["access_codes"][0]["used_at"] is None
    assert ("access_codes", "update") not in db.calls
    assert not db.tables.get("user_code_assignments")


def audit_detail(db):
    rows = [r for r in db.tables.get("access_code_audit", [])
            if r["action"] == "enroll_rejected_cohort_archived"]
    assert len(rows) == 1
    assert rows[0]["target_user_id"] == USER
    assert rows[0]["code_id"] == "code-1"
    return rows[0]["after"]["detail"]


@pytest.mark.parametrize("has_user", [True, False])
def test_w1_refuses_before_any_activation_or_enrollment_write(world, has_user):
    db, client = world
    if not has_user:
        db.tables["users"] = []
    db.tables["cohorts"][0].update(is_active=False, archived_at="2026-10-29T00:00:00Z")
    before = deepcopy(db.tables)
    response = activate(client)
    assert response.status_code == 400, response.text
    assert response.json()["detail"] == GENERIC
    for table in ("users", "students", "access_codes"):
        assert db.tables[table] == before[table]
    assert all(op == "select" or table == "access_code_audit" for table, op in db.calls)
    assert not audit_detail(db).get("race")
    assert db.attempts == 1
    assert_unused(db)


@pytest.mark.parametrize("active", [False, True])
@pytest.mark.parametrize("fold", [False, True])
@pytest.mark.parametrize("role", ["user", "admin"])
def test_archive_race_restores_exact_snapshot_and_does_not_promote(world, active, fold, role):
    db, client = world
    db.tables["users"][0].update(is_active=active, role=role)
    db.tables["access_codes"][0].update(grants_role="instructor", intended_email="learner@example.test")
    if fold:
        db.tables["students"] = [{"id": "student-1", "user_id": USER, "instructor_id": None,
                                  "cohort_id": None, "archived_at": None}]
    before = deepcopy(db.tables)
    db.archive_race = True
    response = activate(client)
    assert response.status_code == 400, response.text
    assert response.json()["detail"] == GENERIC
    assert db.tables["users"] == before["users"]
    assert db.tables["students"] == before["students"]
    assert audit_detail(db)["race"] is True
    assert not [r for r in db.tables["access_code_audit"] if r["action"] == "promote_role"]
    assert_unused(db)


def test_archive_race_restores_null_fields_on_new_user(world):
    db, client = world
    db.tables["users"] = []
    db.archive_race = True
    response = activate(client)
    assert response.status_code == 400, response.text
    row = db.tables["users"][0]
    assert row["is_active"] is False
    assert row["access_code_used"] is None and row["permissions"] is None
    assert_unused(db)


def test_compensation_retries_once_then_returns_generic_400(world):
    db, client = world
    before = deepcopy(db.tables["users"])
    db.archive_race, db.revert_failures = True, 1
    response = activate(client)
    assert response.status_code == 400, response.text
    assert db.reverts == 2
    assert db.tables["users"] == before
    assert not audit_detail(db).get("compensation_failed")
    assert_unused(db)


@pytest.mark.parametrize("empty", [False, True])
def test_failed_compensation_is_503_with_critical_request_id_and_audit(world, caplog, empty):
    db, client = world
    db.archive_race, db.revert_failures, db.empty_revert = True, 0 if empty else 2, empty
    with request_id_scope("j152-request"), caplog.at_level(logging.CRITICAL):
        response = activate(client)
    assert response.status_code == 503, response.text
    assert response.json()["detail"]["error_code"] == "activation_incomplete"
    assert "Mã CHƯA được sử dụng" in response.json()["detail"]["message"]
    assert db.reverts == 2
    assert audit_detail(db)["compensation_failed"] is True
    critical = [r for r in caplog.records if r.levelno == logging.CRITICAL]
    assert any(USER in r.message and "j152-request" in r.message for r in critical)
    assert DB_TEXT not in response.text and "cohort_archived" not in response.text
    assert_unused(db)


@pytest.mark.parametrize("schema", ["pre337", "active", "legacy"])
def test_usable_class_claims_code_in_both_schemas(world, schema):
    db, client = world
    if schema == "pre337":
        del db.tables["cohorts"][0]["archived_at"]
    elif schema == "legacy":
        db.tables["cohorts"][0]["is_active"] = False
    response = activate(client)
    assert response.status_code == 200, response.text
    assert db.tables["users"][0]["is_active"] is True
    assert db.tables["access_codes"][0]["is_used"] is True
    assert db.tables["students"][0]["cohort_id"] == COHORT


def test_class_lookup_failure_is_503_without_writes(world):
    db, client = world
    db.fail_at = ("cohorts", "select")
    before = deepcopy(db.tables)
    response = activate(client)
    assert response.status_code == 503, response.text
    assert "Mã CHƯA được sử dụng" in response.text
    assert db.tables == before
    assert all(op == "select" for _, op in db.calls)
    assert DB_TEXT not in response.text
    assert_unused(db)


def test_plain_code_needs_no_cohort_lookup(world):
    db, client = world
    db.tables["access_codes"][0]["cohort_id"] = None
    db.fail_at = ("cohorts", "select")
    response = activate(client)
    assert response.status_code == 200, response.text
    assert db.tables["access_codes"][0]["is_used"] is True
    assert not db.tables["students"]


def test_unrelated_guard_detail_cannot_be_mistaken_for_archive_race(world, monkeypatch):
    from postgrest.exceptions import APIError

    db, client = world
    original = Query.execute

    def fail_enrollment(query):
        if query.name == "students" and query.op == "insert":
            raise APIError({"message": "foreign key failure", "code": "23503", "details": "cohort_archived"})
        return original(query)

    monkeypatch.setattr(Query, "execute", fail_enrollment)
    response = activate(client)
    assert response.status_code == 500, response.text
    assert "cohort_archived" not in response.text
    assert not db.tables.get("access_code_audit")
    assert_unused(db)


def test_archive_after_enrollment_commit_does_not_undo_activation(world, monkeypatch):
    db, client = world

    def archive_at_backfill(*_args, **_kwargs):
        db.tables["cohorts"][0].update(is_active=False, archived_at="2026-10-29T00:00:00Z")
        raise RuntimeError("cohort_archived")

    monkeypatch.setattr("services.cohort_assignment_service.backfill_cohort_writing_assignments", archive_at_backfill)
    response = activate(client)
    assert response.status_code == 200, response.text
    assert db.tables["users"][0]["is_active"] is True
    assert db.tables["access_codes"][0]["is_used"] is True
    assert db.tables["students"][0]["cohort_id"] == COHORT


def test_own_already_used_code_keeps_existing_response_even_after_archive(world):
    db, client = world
    db.tables["access_codes"][0].update(is_used=True, used_by=USER)
    db.tables["cohorts"][0].update(is_active=False, archived_at="2026-10-29T00:00:00Z")
    response = activate(client)
    assert response.status_code == 400
    assert response.json()["detail"] == "Bạn đã kích hoạt mã này rồi."
    assert db.calls == [("access_codes", "select")]
    assert db.attempts == 1


@pytest.mark.parametrize("failure", [
    ("access_codes", "select"), ("students", "select"), ("users", "select"),
    ("users", "insert"), ("users", "update"), ("students", "insert"),
])
def test_database_errors_never_escape_bare_activation_router(world, failure):
    db, client = world
    db.fail_at = failure
    if failure == ("users", "insert"):
        db.tables["users"] = []
    response = activate(client)
    assert response.status_code == 500, response.text
    assert DB_TEXT not in response.text
    if failure == ("students", "insert"):
        assert "Mã CHƯA được sử dụng" in response.text
    assert_unused(db)


class PgQuery(Query):
    """Small PostgREST adapter; every table read/write runs on real local PG."""

    def execute(self):
        from postgrest.exceptions import APIError
        from test_migration_240_core_attempt_evidence import psql

        table = f"{self.db.schema}.{self.name}"
        def literal(value):
            return "'" + str(value).replace("'", "''") + "'"

        where = " AND ".join(f"{key} = {literal(value)}" for key, value in self.filters.items()) or "true"
        if self.op == "select":
            statement = f"SELECT {self.fields} FROM {table} WHERE {where}"
        else:
            fields = list(self.values)
            source = f"json_populate_record(NULL::{table}, {literal(json.dumps(self.values))})"
            if self.op == "insert":
                statement = (f"INSERT INTO {table} ({', '.join(fields)}) "
                             f"SELECT {', '.join(fields)} FROM {source} RETURNING *")
            else:
                statement = (f"UPDATE {table} SET ({', '.join(fields)}) = "
                             f"(SELECT {', '.join(fields)} FROM {source}) WHERE {where} RETURNING *")
        sql = (f"SELECT coalesce(json_agg(r), '[]'::json) FROM ({statement}) r" if self.op == "select"
               else f"WITH r AS ({statement}) SELECT coalesce(json_agg(r), '[]'::json) FROM r")
        try:
            rows = json.loads(psql(f"BEGIN; SET LOCAL ROLE service_role; {sql}; COMMIT;"))
        except RuntimeError as exc:
            if "ERROR:  cohort_archived\n" in str(exc):
                raise APIError({"message": "cohort_archived", "code": "P0001", "details": str(exc)}) from None
            raise
        if self.name == "users" and self.op == "update" and self.values.get("is_active") is True:
            callback, self.db.after_activate = self.db.after_activate, None
            if callback:
                callback()
        return SimpleNamespace(data=rows)


@pytest.fixture(scope="module")
def pg_activation():
    import test_migration_337_class_archive as m337
    from test_migration_240_core_attempt_evidence import psql

    m337.m331._require_pg()
    schema = "activate_archive_" + uuid4().hex
    try:
        m337._build(schema)
        legacy = m337._new_class(schema, active=False)
        psql(m337._migrated(schema))
        # Complete only the auth columns absent from the migration harness.
        psql(f"""
            ALTER TABLE {schema}.users ADD COLUMN access_code_used text, ADD COLUMN permissions jsonb;
            ALTER TABLE {schema}.cohorts ADD COLUMN created_by uuid;
            ALTER TABLE {schema}.students ADD COLUMN created_by uuid;
            ALTER TABLE {schema}.access_codes ADD COLUMN code text, ADD COLUMN permissions jsonb,
                ADD COLUMN used_by uuid, ADD COLUMN used_at timestamptz;
        """)
        audit = (m337.MIGRATIONS / "099_access_code_audit.sql").read_text()
        psql(f"SET search_path = {schema}, pg_temp; {audit}")
        admin = m337.m326._admin(schema)
        yield schema, admin, legacy
    finally:
        psql(f"DROP SCHEMA IF EXISTS {schema} CASCADE")


@pytest.mark.parametrize("scenario", ["w1", "race_insert", "race_update", "normal", "legacy"])
def test_real_pg_337_activation_contract(world, pg_activation, monkeypatch, scenario):
    import test_migration_337_class_archive as m337

    _, client = world
    schema, admin, legacy = pg_activation
    uid, cid, code_id = str(uuid4()), legacy if scenario == "legacy" else m337._new_class(schema), str(uuid4())
    code_text = CODE + uid[:8].upper()
    db = Database()
    db.schema, db.after_activate = schema, None
    db.table = lambda name: PgQuery(db, name)
    monkeypatch.setattr(auth, "supabase_admin", db)
    monkeypatch.setattr(auth, "get_supabase_user", AsyncMock(return_value={
        "id": uid, "email": "learner@example.test", "user_metadata": {},
    }))
    db.table("users").insert({"id": uid, "is_active": True, "permissions": ["writing"],
                              "access_code_used": "OLD"}).execute()
    db.table("access_codes").insert({"id": code_id, "code": code_text, "cohort_id": cid,
                                     "permissions": ["practice_single"]}).execute()
    if scenario == "race_update":
        db.table("students").insert({"user_id": uid, "student_code": "OLD-" + uid,
                                     "full_name": "QA learner"}).execute()
    users_before = db.table("users").select("*").eq("id", uid).execute().data
    students_before = db.table("students").select("*").eq("user_id", uid).execute().data
    if scenario == "w1":
        m337._archive_class(schema, cid, admin)
    elif scenario.startswith("race"):
        db.after_activate = lambda: m337._archive_class(schema, cid, admin)
    response = activate(client, code_text)
    code = db.table("access_codes").select("*").eq("id", code_id).execute().data[0]
    if scenario in ("normal", "legacy"):
        assert response.status_code == 200, response.text
        assert code["is_used"] is True and code["used_by"] == uid
        return
    assert response.status_code == 400, response.text
    assert response.json()["detail"] == GENERIC
    assert code["is_used"] is False and code["used_by"] is None and code["used_at"] is None
    assert db.table("users").select("*").eq("id", uid).execute().data == users_before
    assert db.table("students").select("*").eq("user_id", uid).execute().data == students_before
    assert not db.table("student_cohort_memberships").select("*").eq("cohort_id", cid).execute().data
    audits = db.table("access_code_audit").select("*").eq("code_id", code_id).execute().data
    assert len(audits) == 1
    assert audits[0]["action"] == "enroll_rejected_cohort_archived"
    assert audits[0]["after"]["detail"]["race"] is scenario.startswith("race")


# ── SA-REVIEW-152: promote only after the claim; compensation and logs ───────

def use_instructor_code(db):
    db.tables["access_codes"][0].update(grants_role="instructor", intended_email="learner@example.test")


def promote_audits(db):
    return [r for r in db.tables.get("access_code_audit", []) if r["action"].startswith("promote_role")]


def record_writes(monkeypatch, hook=None):
    """Patch Query.execute to log (table, op, values) in order; `hook` may act first."""
    original, writes = Query.execute, []

    def execute(query):
        if query.op != "select":
            writes.append((query.name, query.op, deepcopy(query.values)))
        if hook:
            hook(query)
        return original(query)

    monkeypatch.setattr(Query, "execute", execute)
    return writes


@pytest.mark.parametrize("empty", [False, True])
def test_double_compensation_failure_never_leaves_instructor_role(world, empty):
    db, client = world
    use_instructor_code(db)
    db.archive_race, db.revert_failures, db.empty_revert = True, 0 if empty else 2, empty
    response = activate(client)
    assert response.status_code == 503, response.text
    assert response.json()["detail"]["error_code"] == "activation_incomplete"
    assert db.tables["users"][0]["role"] == "user"
    assert not promote_audits(db)
    detail = audit_detail(db)
    assert detail["compensation_failed"] is True
    assert detail["unrestored_fields"] == ["access_code_used", "is_active", "permissions"]
    assert_unused(db)


def test_enrollment_write_error_leaves_role_untouched(world):
    db, client = world
    use_instructor_code(db)
    db.fail_at = ("students", "insert")
    response = activate(client)
    assert response.status_code == 500, response.text
    assert "Mã CHƯA được sử dụng" in response.text
    assert db.tables["users"][0]["role"] == "user"
    assert not promote_audits(db)
    assert_unused(db)


@pytest.mark.parametrize("outcome", ["indeterminate", "lost"])
def test_unclaimed_code_leaves_role_untouched(world, monkeypatch, outcome):
    db, client = world
    use_instructor_code(db)
    if outcome == "indeterminate":
        db.fail_at = ("access_codes", "update")
    else:
        def other_user_claims_first(query):
            if query.name == "access_codes" and query.op == "update":
                db.tables["access_codes"][0].update(is_used=True, used_by="learner-2")
        record_writes(monkeypatch, other_user_claims_first)
    response = activate(client)
    assert response.status_code == (503 if outcome == "indeterminate" else 400), response.text
    user = db.tables["users"][0]
    assert user["role"] == "user" and user["is_active"] is False
    assert not promote_audits(db)
    assert db.tables["access_codes"][0]["used_by"] != USER


def test_instructor_code_promotes_only_after_claim(world, monkeypatch):
    db, client = world
    use_instructor_code(db)
    writes = record_writes(monkeypatch)
    response = activate(client)
    assert response.status_code == 200, response.text
    assert db.tables["users"][0]["role"] == "instructor"
    claim = writes.index(next(w for w in writes if w[0] == "access_codes"))
    promote = [i for i, w in enumerate(writes) if w[0] == "users" and "role" in w[2]]
    assert promote == [claim + 1] and writes[promote[0]][2] == {"role": "instructor"}
    audits = promote_audits(db)
    assert [(a["action"], a["before"], a["after"]) for a in audits] == [
        ("promote_role", {"role": "user"}, {"role": "instructor"})]


@pytest.mark.parametrize("mode, final_role, reason", [
    ("error", "user", "write_failed"),
    ("role_changed", "student", "role_changed"),
])
def test_promote_failure_after_claim_is_audited_with_final_state(
    world, monkeypatch, caplog, mode, final_role, reason,
):
    db, client = world
    use_instructor_code(db)

    def promote_does_not_land(query):
        if query.name == "users" and query.op == "update" and query.values == {"role": "instructor"}:
            if mode == "error":
                raise RuntimeError(DB_TEXT)
            db.tables["users"][0]["role"] = "student"  # changed since Step 2: never overwritten

    record_writes(monkeypatch, promote_does_not_land)
    with request_id_scope("sa152-request"), caplog.at_level(logging.DEBUG):
        response = activate(client)
    assert response.status_code == 503, response.text
    assert response.json()["detail"]["error_code"] == "promote_incomplete"
    assert response.json()["detail"]["ref"] == "sa152-request"
    user, code = db.tables["users"][0], db.tables["access_codes"][0]
    assert user["role"] == final_role and user["is_active"] is True
    assert code["is_used"] is True and code["used_by"] == USER
    assert db.tables["user_code_assignments"][0]["user_id"] == USER
    audits = promote_audits(db)
    assert [a["action"] for a in audits] == ["promote_role_failed"]
    assert audits[0]["before"] == {"role": "user"}
    assert audits[0]["after"] == {"role": final_role, "reason": reason, "code_claimed": True,
                                  "request_id": "sa152-request"}
    assert any(r.levelno == logging.CRITICAL and "sa152-request" in r.getMessage()
               for r in caplog.records)
    assert DB_TEXT not in response.text and DB_TEXT not in caplog.text


@pytest.mark.parametrize("concurrent_role", [None, "admin"])
def test_promote_cas_miss_is_labelled_by_what_happened(world, monkeypatch, concurrent_role):
    """P3 :599-606 / :1114-1116: a 0-row promote with the role unchanged is a
    write failure; a role someone else raised is audited as a no-op."""
    db, client = world
    use_instructor_code(db)
    original = Query.execute

    def promote_matches_no_row(query):
        if query.name == "users" and query.op == "update" and query.values == {"role": "instructor"}:
            if concurrent_role is None:
                return SimpleNamespace(data=[])
            db.tables["users"][0]["role"] = concurrent_role  # Step 2 role CAS now misses
        return original(query)

    monkeypatch.setattr(Query, "execute", promote_matches_no_row)
    response = activate(client)
    audits = [(a["action"], a["after"]) for a in promote_audits(db)]
    if concurrent_role is None:
        assert response.status_code == 503, response.text
        assert db.tables["users"][0]["role"] == "user"
        assert [(action, after["reason"]) for action, after in audits] == [
            ("promote_role_failed", "write_failed")]
    else:
        assert response.status_code == 200, response.text
        assert db.tables["users"][0]["role"] == "admin"
        assert audits == [("promote_role", {"role": "admin", "noop": True})]


@pytest.mark.parametrize("guard", ["account_suspended", "account_suspended_role_change"])
def test_suspension_during_promote_returns_suspended_and_audits(world, monkeypatch, guard):
    from postgrest.exceptions import APIError

    db, client = world
    use_instructor_code(db)

    def suspended_now(query):
        if query.name == "users" and query.op == "update" and query.values == {"role": "instructor"}:
            raise APIError({"message": guard, "code": "P0001", "details": None})

    record_writes(monkeypatch, suspended_now)
    response = activate(client)
    assert response.status_code == 403, response.text
    assert response.json()["detail"]["code"] == "account_suspended"
    assert db.tables["users"][0]["role"] == "user"
    assert [(a["action"], a["after"]["reason"]) for a in promote_audits(db)] == [
        ("promote_role_failed", "account_suspended")]


def test_compensation_keeps_concurrent_admin_changes(world, monkeypatch):
    """CR P3-1: an admin deactivation / permission strip in the window wins."""
    db, client = world
    db.tables["users"][0].update(is_active=True, permissions=["writing"])

    def admin_acts_after_activation(query):
        if query.name == "students" and query.op != "select":
            db.tables["users"][0].update(is_active=False, permissions=[])

    writes = record_writes(monkeypatch, admin_acts_after_activation)
    db.archive_race = True
    response = activate(client)
    assert response.status_code == 400, response.text
    user = db.tables["users"][0]
    assert user["is_active"] is False and user["permissions"] == []
    assert user["access_code_used"] == "PREVIOUS" and user["role"] == "user"
    reverts = [w[2] for w in writes if w[0] == "users" and w[2].get("is_active") is not True]
    assert reverts == [{"access_code_used": "PREVIOUS"}]
    assert_unused(db)


OTHER_ACTIVATION = {"is_active": True, "access_code_used": "OTHERCODE", "permissions": ["practice_single"]}


@pytest.mark.parametrize("window", ["before_read", "before_write"])
def test_compensation_never_undoes_a_newer_successful_activation(world, monkeypatch, window):
    """Codex r4422345951: request B (another code, same user) succeeds while
    request A (archived class code) is between its Step 3 write and its undo.
    B's activation must survive: the row now belongs to B's code."""
    db, client = world
    db.tables["users"][0].update(is_active=False, access_code_used=None, permissions=None)

    def other_activation_succeeds(query):
        is_revert = (query.name == "users" and query.op == "update"
                     and query.values.get("is_active") is not True)
        if (window == "before_read" and query.name == "students" and query.op != "select") or (
                window == "before_write" and is_revert):
            db.tables["users"][0].update(OTHER_ACTIVATION)

    writes = record_writes(monkeypatch, other_activation_succeeds)
    db.archive_race = True
    response = activate(client)
    assert response.status_code == 400, response.text
    assert response.json()["detail"] == GENERIC
    user = db.tables["users"][0]
    assert {key: user[key] for key in OTHER_ACTIVATION} == OTHER_ACTIVATION
    assert user["role"] == "user"
    # Every undo write is guarded by this request's own code (CAS ownership).
    reverts = [w for w in writes if w[0] == "users" and w[2].get("is_active") is not True]
    assert len(reverts) == (0 if window == "before_read" else 1)
    assert not audit_detail(db)["compensation_failed"]
    assert_unused(db)


def test_compensation_permissions_compare_and_swap(world, monkeypatch):
    """P3 :569-571: an admin permission change between the undo's read and its
    write wins; the other fields Step 3 wrote are still restored."""
    db, client = world
    db.tables["users"][0].update(is_active=False)

    def admin_strips_permissions_mid_undo(query):
        if (query.name == "users" and query.op == "update" and query.values.get("is_active") is False
                and "permissions" in query.values):
            db.tables["users"][0]["permissions"] = []

    writes = record_writes(monkeypatch, admin_strips_permissions_mid_undo)
    db.archive_race = True
    response = activate(client)
    assert response.status_code == 400, response.text
    user = db.tables["users"][0]
    assert user["permissions"] == []
    assert user["is_active"] is False and user["access_code_used"] == "PREVIOUS"
    reverts = [w[2] for w in writes if w[0] == "users" and w[2].get("is_active") is not True]
    assert reverts == [
        {"is_active": False, "access_code_used": "PREVIOUS", "permissions": ["writing"]},
        {"is_active": False, "access_code_used": "PREVIOUS"},
    ]
    assert not audit_detail(db)["compensation_failed"]
    assert_unused(db)


@pytest.mark.parametrize("outcome", ["indeterminate", "lost"])
def test_unclaimed_rollback_keeps_a_newer_successful_activation(world, monkeypatch, outcome):
    """P3 :1056-1069: the lost/indeterminate-claim undo is guarded the same way."""
    db, client = world

    def other_activation_then_claim(query):
        if query.name == "access_codes" and query.op == "update":
            db.tables["users"][0].update(OTHER_ACTIVATION)
            if outcome == "indeterminate":
                raise RuntimeError(DB_TEXT)
            db.tables["access_codes"][0].update(is_used=True, used_by="learner-2")

    record_writes(monkeypatch, other_activation_then_claim)
    response = activate(client)
    assert response.status_code == (503 if outcome == "indeterminate" else 400), response.text
    user = db.tables["users"][0]
    assert {key: user[key] for key in OTHER_ACTIVATION} == OTHER_ACTIVATION


def test_student_code_conflict_log_has_code_id_not_code(world, caplog):
    db, client = world
    db.tables["students"] = [{"id": "student-2", "user_id": "learner-2", "student_code": CODE,
                              "instructor_id": None, "cohort_id": None, "archived_at": None}]
    with caplog.at_level(logging.DEBUG):
        response = activate(client)
    assert response.status_code == 200, response.text
    assert CODE not in caplog.text
    assert any("code-1" in r.getMessage() and "learner-2" in r.getMessage() for r in caplog.records)


@pytest.mark.parametrize("failure", [
    ("access_codes", "select"), ("students", "select"), ("users", "select"),
    ("users", "update"), ("students", "insert"), ("access_codes", "update"),
    ("user_code_assignments", "insert"), "race",
])
def test_activation_logs_never_carry_db_text(world, caplog, failure):
    db, client = world
    if failure == "race":
        db.archive_race, db.revert_failures = True, 2
    else:
        db.fail_at = failure
    with caplog.at_level(logging.DEBUG):
        response = activate(client)
    assert DB_TEXT not in response.text
    assert DB_TEXT not in caplog.text
    assert CODE not in caplog.text
