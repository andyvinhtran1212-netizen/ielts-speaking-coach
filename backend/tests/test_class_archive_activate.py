"""CLASSARCHIVE-0030 FR-002/FR-008: activation refuses an archived class.

Use the bare router so main.py's 5xx sanitizer cannot hide a route-level leak.
The fake enforces projections and migration 099's actual audit columns; the
PostgreSQL cases below exercise the real 227 → 337 enrollment trigger chain.
"""

from copy import deepcopy
import json
import logging
import threading
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
        self.null_filters = set()

    def select(self, fields):
        self.fields = fields
        return self

    def eq(self, field, value):
        self.filters[field] = value
        return self

    def is_(self, field, value):
        assert value == "null"
        self.null_filters.add(field)
        return self

    def limit(self, _limit):
        return self

    def insert(self, values):
        self.op, self.values = "insert", deepcopy(values)
        return self

    def update(self, values):
        self.op, self.values = "update", deepcopy(values)
        return self

    def delete(self):
        self.op = "delete"
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
        matches = [row for row in rows if all(_eq(row.get(k), v) for k, v in self.filters.items())
                   and all(row.get(k) is None for k in self.null_filters)]
        if self.op == "select":
            if self.fields != "*":
                fields = [f.strip() for f in self.fields.split(",")]
                assert all(f in row for row in matches for f in fields), "42703: unknown projection"
                matches = [{f: row[f] for f in fields} for row in matches]
        elif self.op == "insert":
            row = {"id": str(uuid4()), **self.values}
            if self.name == "students":
                row = {"archived_at": None, **row}
            if self.name == "users":
                row = {"permissions": None, "access_code_used": None, **row}
            rows.append(row)
            matches = [row]
        elif self.op == "update":
            for row in matches:
                row.update(self.values)
        elif self.op == "delete":
            rows[:] = [row for row in rows if row not in matches]
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
        if name == "fn_activation_serialize":
            if hasattr(self, "schema"):
                from test_migration_240_core_attempt_evidence import psql
                def execute():
                    callback, self.after_activate = self.after_activate, None
                    if callback:
                        callback()
                    args = ",".join("'" + json.dumps(v).replace("'", "''") + "'::jsonb" if isinstance(v, dict)
                                    else "'" + str(v).replace("'", "''") + "'" for v in _params.values())
                    return SimpleNamespace(data=json.loads(psql(
                        f"SET ROLE service_role; SELECT {self.schema}.fn_activation_serialize({args})")))
                return SimpleNamespace(execute=execute)
            from activation_rpc_fake import activation_rpc
            return activation_rpc(self, name, _params)
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
    assert db.tables["users"] == []
    assert db.tables["students"] == []
    assert_unused(db)


def test_compensation_retries_once_then_returns_generic_400(world):
    db, client = world
    before = deepcopy(db.tables["users"])
    db.archive_race = True
    response = activate(client)
    assert response.status_code == 400, response.text
    assert db.tables["students"] == []
    assert db.tables["users"][0]["access_code_used"] == "PREVIOUS"
    assert db.tables["users"] == before
    assert not audit_detail(db).get("compensation_failed")
    assert_unused(db)


@pytest.mark.parametrize("empty", [False, True])
def test_failed_compensation_is_503_with_critical_request_id_and_audit(world, caplog, empty):
    db, client = world
    db.transaction_receipt = {} if empty else None
    db.transaction_unconfirmed = not empty
    with request_id_scope("j152-request"), caplog.at_level(logging.CRITICAL):
        response = activate(client)
    assert response.status_code == 503, response.text
    assert response.json()["detail"]["error_code"] == "activation_incomplete"
    assert "Mã CHƯA được sử dụng" in response.json()["detail"]["message"]
    assert db.tables["students"] == []
    assert db.tables["users"][0]["access_code_used"] == "PREVIOUS"
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

        where = " AND ".join([
            *(f"{key} = {literal(value)}" for key, value in self.filters.items()),
            *(f"{key} IS NULL" for key in self.null_filters),
        ]) or "true"
        if self.op == "select":
            statement = f"SELECT {self.fields} FROM {table} WHERE {where}"
        elif self.op == "delete":
            statement = f"DELETE FROM {table} WHERE {where} RETURNING *"
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
            ALTER TABLE {schema}.users ADD COLUMN access_code_used text, ADD COLUMN permissions jsonb,
                ADD COLUMN avatar_url text;
            ALTER TABLE {schema}.cohorts ADD COLUMN created_by uuid;
            ALTER TABLE {schema}.students ADD COLUMN created_by uuid;
            ALTER TABLE {schema}.access_codes ADD COLUMN code text, ADD COLUMN permissions jsonb,
                ADD COLUMN used_by uuid, ADD COLUMN used_at timestamptz, ADD COLUMN issued_by uuid,
                ADD COLUMN grants_role text, ADD COLUMN intended_email text;
        """)
        audit = (m337.MIGRATIONS / "099_access_code_audit.sql").read_text()
        psql(f"SET search_path = {schema}, pg_temp; {audit}")
        from test_migration_359_activation_serialize import SQL, migrated
        psql(migrated(SQL, schema))
        admin = m337.m326._admin(schema)
        yield schema, admin, legacy
    finally:
        psql(f"DROP SCHEMA IF EXISTS {schema} CASCADE")


@pytest.mark.parametrize("scenario", [
    "w1", "race_insert", "race_update", "normal", "legacy", "normal_null", "race_insert_null",
])
def test_real_pg_337_activation_contract(world, pg_activation, monkeypatch, scenario):
    import test_migration_337_class_archive as m337

    _, client = world
    schema, admin, legacy = pg_activation
    nullable = scenario.endswith("_null")
    scenario = scenario.removesuffix("_null")
    uid, cid, code_id = str(uuid4()), legacy if scenario == "legacy" else m337._new_class(schema), str(uuid4())
    code_text = CODE + uid[:8].upper()
    db = Database()
    db.schema, db.after_activate = schema, None
    db.table = lambda name: PgQuery(db, name)
    monkeypatch.setattr(auth, "supabase_admin", db)
    monkeypatch.setattr(auth, "get_supabase_user", AsyncMock(return_value={
        "id": uid, "email": "learner@example.test", "user_metadata": {},
    }))
    db.table("users").insert({"id": uid, "is_active": not nullable,
                              "permissions": None if nullable else ["writing"],
                              "access_code_used": None if nullable else "OLD"}).execute()
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


@pytest.mark.parametrize("membership", ["inactive", "missing"])
@pytest.mark.parametrize("variant", ["linked_instructor_code", "unlinked_bridge_admin_code"])
def test_real_pg_classless_code_never_writes_archived_primary_class(pg_activation, variant, membership):
    """Codex r4426581235: like the staging router, a code without a class must
    not touch students.cohort_id. Writing it (even unchanged) fires 227's
    membership sync, which 337 refuses for the archived old class."""
    import test_migration_337_class_archive as m337
    from test_migration_240_core_attempt_evidence import psql

    schema, admin, _ = pg_activation
    user, teacher, student, code_id = (str(uuid4()) for _ in range(4))
    old_class = m337._new_class(schema)
    code_text = "R10" + code_id[:8].upper()
    linked = variant == "linked_instructor_code"
    psql(f"""SET ROLE service_role;
      INSERT INTO {schema}.users(id,is_active) VALUES ('{user}',false);
      INSERT INTO {schema}.users(id,role,is_active) VALUES ('{teacher}','instructor',true);
      INSERT INTO {schema}.students(id,user_id,student_code,full_name,cohort_id)
        VALUES ('{student}',{f"'{user}'" if linked else 'NULL'},
                '{"OLD" + student[:8] if linked else code_text}','Synthetic learner','{old_class}');
      INSERT INTO {schema}.access_codes(id,code,is_used,issued_by,permissions)
        VALUES ('{code_id}','{code_text}',false,'{teacher if linked else admin}','["writing"]');""")
    m337._archive_class(schema, old_class, admin)
    if membership == "inactive":
        psql(f"SET ROLE service_role; UPDATE {schema}.student_cohort_memberships "
             f"SET is_active=false WHERE student_id='{student}'")
    else:
        psql(f"DELETE FROM {schema}.student_cohort_memberships WHERE student_id='{student}'")
    memberships_before = psql(f"SELECT coalesce(jsonb_agg(m ORDER BY cohort_id), '[]') "
                              f"FROM {schema}.student_cohort_memberships m WHERE student_id='{student}'")

    result = json.loads(psql(f"SET ROLE service_role; SELECT {schema}.fn_activation_serialize("
                             f"'{user}','{code_id}','{code_text}','synthetic@example.test','{{}}')"))

    assert result == {"status": "ok", "role": "user", "student_id": student,
                      "cohort_id": None, "promote_role": None}
    row = json.loads(psql(f"SELECT to_jsonb(s) FROM {schema}.students s WHERE id='{student}'"))
    assert row["cohort_id"] == old_class and row["user_id"] == user
    assert row["instructor_id"] == (teacher if linked else None)
    # The archived class is neither re-joined nor re-activated.
    assert psql(f"SELECT coalesce(jsonb_agg(m ORDER BY cohort_id), '[]') "
                f"FROM {schema}.student_cohort_memberships m WHERE student_id='{student}'") == memberships_before
    account = json.loads(psql(f"SELECT jsonb_build_object('active', u.is_active, 'used_by', c.used_by, "
                              f"'is_used', c.is_used) FROM {schema}.users u, {schema}.access_codes c "
                              f"WHERE u.id='{user}' AND c.id='{code_id}'"))
    assert account == {"active": True, "used_by": user, "is_used": True}


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
    db.transaction_receipt = {} if empty else None
    db.transaction_unconfirmed = not empty
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

    db.after_transaction = lambda *_: db.tables["users"][0].update(is_active=False, permissions=[])
    db.archive_race = True
    response = activate(client)
    assert response.status_code == 400, response.text
    user = db.tables["users"][0]
    assert user["is_active"] is False and user["permissions"] == []
    assert user["access_code_used"] == "PREVIOUS" and user["role"] == "user"
    assert db.tables["students"] == []
    assert db.tables["access_codes"][0]["used_by"] is None
    assert_unused(db)


OTHER_ACTIVATION = {"is_active": True, "access_code_used": "OTHERCODE", "permissions": ["practice_single"]}


@pytest.mark.parametrize("nullable", [False, True])
@pytest.mark.parametrize("outcome", ["archive", "lost", "indeterminate"])
def test_activation_refreshes_stale_snapshot_before_rollback(world, monkeypatch, nullable, outcome):
    """r4422565648: B completes between A's snapshot and activation write.

    A must refresh both its compensation snapshot and was_already_active before
    retrying, so neither archive compensation nor a failed claim locks B out.
    """
    db, client = world
    if nullable:
        db.tables["users"][0].update(access_code_used=None, permissions=None)
    db.tables["access_codes"].append({
        "id": "code-b", "code": "OTHERCODE", "cohort_id": None,
        "is_used": False, "used_by": None, "used_at": None,
        "permissions": OTHER_ACTIVATION["permissions"],
    })
    def interleave(params):
        if params["p_code"] != CODE:
            return
        with TestClient(client.app) as other_client:
            other_response = activate(other_client, "OTHERCODE")
        assert other_response.status_code == 200, other_response.text
        assert db.tables["access_codes"][1]["used_by"] == USER
        db.archive_race = outcome == "archive"
        if outcome == "indeterminate":
            db.transaction_receipt = {"status": "activation_conflict"}
        elif outcome == "lost":
            db.tables["access_codes"][0].update(is_used=True, used_by="learner-2")

    db.before_transaction = interleave
    response = activate(client)
    assert response.status_code == (503 if outcome == "indeterminate" else 400), response.text
    user = db.tables["users"][0]
    assert user["is_active"] is True
    assert user["permissions"] == OTHER_ACTIVATION["permissions"]
    assert db.tables["access_codes"][1]["is_used"] is True
    assert db.tables["access_codes"][1]["used_by"] == USER
    assert db.tables["access_codes"][0]["used_by"] != USER
    assert db.tables["students"] == []
    assert user["access_code_used"] == "OTHERCODE"
    assert not db.tables.get("student_cohort_memberships")
    if outcome == "archive":
        assert {key: user[key] for key in OTHER_ACTIVATION} == OTHER_ACTIVATION
        assert not audit_detail(db)["compensation_failed"]
        assert ("access_codes", "update") in db.calls  # B claimed; A never did


@pytest.mark.parametrize("field, changes", [
    ("is_active", [False, True]),
    ("access_code_used", ["OTHER1", "OTHER2"]),
    ("permissions", [[], ["writing"]]),
])
def test_activation_snapshot_cas_stops_after_second_miss(world, monkeypatch, field, changes):
    db, client = world
    db.tables["users"][0].update(is_active=None, access_code_used=None, permissions=None)
    def contention(_params):
        db.tables["users"][0][field] = changes[1]
    db.before_transaction = contention
    db.transaction_receipt = {"status": "activation_conflict"}
    with request_id_scope("snapshot-contention"):
        response = activate(client)
    assert response.status_code == 503, response.text
    assert response.json()["detail"]["ref"] == "snapshot-contention"
    assert "Mã CHƯA được sử dụng" in response.json()["detail"]["message"]
    assert response.json()["detail"]["error_code"] == "activation_conflict"
    assert db.tables["students"] == []
    assert db.tables["users"][0][field] == changes[1]
    assert all(db.tables["users"][0][key] is None
               for key in {"is_active", "access_code_used", "permissions"} - {field})
    assert all(table != "students" or op == "select" for table, op in db.calls)
    assert_unused(db)


@pytest.mark.parametrize("concurrent_role", [None, "admin", "student"])
def test_promote_null_role_uses_compare_and_swap(world, monkeypatch, concurrent_role):
    db, client = world
    use_instructor_code(db)
    db.tables["users"][0]["role"] = None
    null_filters = []

    def change_role_before_promote(query):
        if query.name == "users" and query.op == "update" and query.values == {"role": "instructor"}:
            null_filters.append(set(query.null_filters))
            if concurrent_role is not None:
                db.tables["users"][0]["role"] = concurrent_role

    record_writes(monkeypatch, change_role_before_promote)
    response = activate(client)
    assert response.status_code == (503 if concurrent_role == "student" else 200), response.text
    assert db.tables["users"][0]["role"] == (concurrent_role or "instructor")
    assert null_filters == [{"role"}]
    assert db.tables["access_codes"][0]["used_by"] == USER
    audits = promote_audits(db)
    if concurrent_role == "admin":
        assert [(row["action"], row["after"]) for row in audits] == [
            ("promote_role", {"role": "admin", "noop": True})]
    elif concurrent_role == "student":
        assert [(row["action"], row["after"]["reason"]) for row in audits] == [
            ("promote_role_failed", "role_changed")]
    else:
        assert [row["action"] for row in audits] == ["promote_role"]


@pytest.mark.parametrize("failure", ["missing", "error"])
def test_activation_snapshot_refresh_failure_stops_before_claim(world, monkeypatch, caplog, failure):
    db, client = world
    before = deepcopy(db.tables)
    db.transaction_receipt = {} if failure == "missing" else None
    db.transaction_unconfirmed = failure == "error"
    response = activate(client)
    assert response.status_code == 503, response.text
    assert db.tables["users"] == before["users"]
    assert db.tables["students"] == before["students"]
    assert "Mã CHƯA được sử dụng" in response.json()["detail"]["message"]
    assert DB_TEXT not in response.text and DB_TEXT not in caplog.text
    assert all(table != "students" or op == "select" for table, op in db.calls)
    assert_unused(db)


@pytest.mark.parametrize("outcome", ["indeterminate", "lost"])
def test_unclaimed_activation_deletes_only_its_inserted_student(world, monkeypatch, caplog, outcome):
    db, client = world
    unrelated = {"id": "unrelated", "user_id": "another-learner", "student_code": "OTHERSTUDENT",
                 "instructor_id": None, "cohort_id": None, "archived_at": None}
    db.tables["students"] = [deepcopy(unrelated)]
    deletes = []

    def claim_fails(query):
        if query.name == "access_codes" and query.op == "update":
            inserted = [row for row in db.tables["students"] if row["user_id"] == USER]
            assert len(inserted) == 1
            deletes.append(inserted[0]["id"])
            if outcome == "indeterminate":
                raise RuntimeError(DB_TEXT)
            db.tables["access_codes"][0].update(is_used=True, used_by="learner-2")
        if query.name == "students" and query.op == "delete":
            assert query.filters == {"id": deletes[0]}

    record_writes(monkeypatch, claim_fails)
    response = activate(client)
    assert response.status_code == (503 if outcome == "indeterminate" else 400), response.text
    assert len(deletes) == 1
    assert db.tables["users"][0]["is_active"] is False
    assert db.tables["users"][0]["access_code_used"] == "PREVIOUS"
    assert db.tables["students"] == [unrelated]
    assert "rollback of inserted student FAILED" not in caplog.text
    assert not db.tables.get("user_code_assignments")


@pytest.mark.parametrize("window", ["before_read", "before_write"])
def test_compensation_never_undoes_a_newer_successful_activation(world, monkeypatch, window):
    """Codex r4422345951: request B (another code, same user) succeeds while
    request A (archived class code) is between its Step 3 write and its undo.
    B's activation must survive: the row now belongs to B's code."""
    db, client = world
    db.tables["users"][0].update(is_active=False, access_code_used=None, permissions=None)

    if window == "before_read":
        db.before_transaction = lambda *_: db.tables["users"][0].update(OTHER_ACTIVATION)
    else:
        db.after_transaction = lambda *_: db.tables["users"][0].update(OTHER_ACTIVATION)
    db.archive_race = True
    response = activate(client)
    assert response.status_code == 400, response.text
    assert response.json()["detail"] == GENERIC
    user = db.tables["users"][0]
    assert {key: user[key] for key in OTHER_ACTIVATION} == OTHER_ACTIVATION
    assert user["role"] == "user"
    # Every undo write is guarded by this request's own code (CAS ownership).
    assert db.tables["students"] == []
    assert db.tables["access_codes"][0]["is_used"] is False
    assert not audit_detail(db)["compensation_failed"]
    assert_unused(db)


def test_compensation_permissions_compare_and_swap(world, monkeypatch):
    """P3 :569-571: an admin permission change between the undo's read and its
    write wins; the other fields Step 3 wrote are still restored."""
    db, client = world
    db.tables["users"][0].update(is_active=False)

    db.after_transaction = lambda *_: db.tables["users"][0].update(permissions=[])
    db.archive_race = True
    response = activate(client)
    assert response.status_code == 400, response.text
    user = db.tables["users"][0]
    assert user["permissions"] == []
    assert user["is_active"] is False and user["access_code_used"] == "PREVIOUS"
    assert db.tables["students"] == []
    assert db.tables["access_codes"][0]["used_by"] is None
    assert not audit_detail(db)["compensation_failed"]
    assert_unused(db)


@pytest.mark.parametrize("outcome", ["indeterminate", "lost"])
def test_unclaimed_rollback_keeps_a_newer_successful_activation(world, monkeypatch, outcome):
    """P3 :1056-1069: the lost/indeterminate-claim undo is guarded the same way."""
    db, client = world

    db.before_transaction = lambda *_: db.tables["users"][0].update(OTHER_ACTIVATION)
    if outcome == "indeterminate":
        db.transaction_receipt = {"status": "activation_conflict"}
    else:
        original_before = db.before_transaction
        def before(params):
            original_before(params)
            db.tables["access_codes"][0].update(is_used=True, used_by="learner-2")
        db.before_transaction = before
    response = activate(client)
    assert response.status_code == (503 if outcome == "indeterminate" else 400), response.text
    user = db.tables["users"][0]
    assert {key: user[key] for key in OTHER_ACTIVATION} == OTHER_ACTIVATION


# ── PC-J420: two overlapping activations of one user with two different codes ─

PAIR_FIELDS = ("is_active", "access_code_used", "permissions")


def overlap_activations(monkeypatch, query_class, app, requests, fail):
    """A rolls back; B times out while the activation advisory key is held.

    The former schedule required B to observe A's provisional user writes.
    Here B gets the same safe conflict response without seeing partial data.
    The PostgreSQL variant uses the real advisory key and real RPC timeout.
    """
    original = auth.supabase_admin.rpc
    a_waiting, b_done = threading.Event(), threading.Event()
    lock_ready, lock_release = threading.Event(), threading.Event()
    lockers, lock_errors = [], []
    by_code = {value[0]: (name, value) for name, value in requests.items()}

    def rpc(name, params):
        if name != "fn_activation_serialize":
            return original(name, params)
        who, request = by_code[params["p_code"]]
        def execute():
            if who == "B" and not hasattr(auth.supabase_admin, "schema"):
                return SimpleNamespace(data={"status": "activation_conflict"})
            if who == "A":
                if hasattr(auth.supabase_admin, "schema"):
                    # Hold the exact activation key on another PG connection.
                    # B's real RPC must hit its bounded lock timeout.
                    def hold_lock():
                        import asyncio
                        import asyncpg
                        from test_migration_240_core_attempt_evidence import DB
                        async def hold():
                            conn = await asyncpg.connect(DB)
                            try:
                                async with conn.transaction():
                                    await conn.execute("SELECT pg_advisory_xact_lock(hashtextextended('activate:' || $1,0))",
                                                       params["p_user_id"])
                                    lock_ready.set()
                                    assert await asyncio.to_thread(lock_release.wait, 20)
                            finally:
                                await conn.close()
                        try:
                            asyncio.run(hold())
                        except BaseException as exc:
                            lock_errors.append(exc)
                            lock_ready.set()
                    locker = threading.Thread(target=hold_lock)
                    lockers.append(locker)
                    locker.start()
                    assert lock_ready.wait(20) and not lock_errors, lock_errors
                a_waiting.set()
                assert b_done.wait(20), "B never completed its activation transaction"
                lock_release.set()
                for locker in lockers:
                    locker.join(60)
                assert not lock_errors, lock_errors
            fail(request, None)
            if not hasattr(auth.supabase_admin, "schema") and request[2] == "archive":
                return SimpleNamespace(data={"status": "cohort_archived"})
            return original(name, params).execute()
        return SimpleNamespace(execute=execute)

    monkeypatch.setattr(auth.supabase_admin, "rpc", rpc)
    responses, errors = {}, []
    def run():
        try:
            with TestClient(app) as client:
                responses["A"] = activate(client, requests["A"][0])
        except BaseException as exc:
            errors.append(exc)
    first = threading.Thread(target=run)
    first.start()
    try:
        assert a_waiting.wait(20), "A never reached its transaction"
        with TestClient(app) as client:
            responses["B"] = activate(client, requests["B"][0])
    finally:
        b_done.set()
        lock_release.set()
        first.join(60)
        for locker in lockers:
            locker.join(60)
    assert not first.is_alive() and not errors, errors
    return responses["A"], responses["B"]


def assert_pair_left_no_orphan_activation(user, codes, user_id, before):
    owned = [c for c in codes if c["used_by"] is not None and str(c["used_by"]) == str(user_id)]
    assert not owned, "both activations failed, so neither code may be the user's"
    assert not [c for c in codes if c["is_used"] and c["used_by"] is None], "used code without owner"
    assert user["access_code_used"] not in {c["code"] for c in codes}, "row keeps a rejected code"
    assert {key: user[key] for key in PAIR_FIELDS} == before, "account not back at its committed state"


@pytest.mark.parametrize("start_active", [False, True])
@pytest.mark.parametrize("kind_a, kind_b", [
    ("archive", "archive"), ("lost", "lost"), ("archive", "lost"), ("lost", "archive"),
])
def test_overlapping_failed_activations_never_leave_a_provisional_state(
        world, monkeypatch, kind_a, kind_b, start_active):
    """PC-J420 (Codex r4423531637 + CR lost/lost): B never builds on A's
    uncommitted Step 3, so the account ends at its committed state."""
    db, client = world
    db.tables["users"][0].update(is_active=start_active)
    before = {key: db.tables["users"][0][key] for key in PAIR_FIELDS}
    db.tables["cohorts"].append({"id": "class-2", "is_active": True, "archived_at": None, "created_by": None})
    requests = {"A": ("PAIRA", "code-a", kind_a), "B": ("PAIRB", "code-b", kind_b)}
    db.tables["access_codes"] = [
        {"id": code_id, "code": code, "is_used": False, "used_by": None, "used_at": None,
         "cohort_id": ("class-1" if name == "A" else "class-2") if kind == "archive" else None,
         "permissions": [f"perm-{name}"]}
        for name, (code, code_id, kind) in requests.items()
    ]
    db.archive_race = "archive" in (kind_a, kind_b)

    def fail(request, _query):
        if request[2] == "lost":
            row = next(c for c in db.tables["access_codes"] if c["id"] == request[1])
            row.update(is_used=True, used_by="learner-2", used_at="2026-10-30T00:00:00Z")

    response_a, response_b = overlap_activations(monkeypatch, Query, client.app, requests, fail)
    assert_pair_left_no_orphan_activation(db.tables["users"][0], db.tables["access_codes"], USER, before)
    assert response_a.status_code == 400, response_a.text
    assert response_b.status_code == 503, response_b.text
    assert response_b.json()["detail"]["error_code"] == "activation_conflict"
    assert "Mã CHƯA được sử dụng" in response_b.json()["detail"]["message"]
    assert db.tables["users"][0]["is_active"] is start_active
    assert not db.tables["students"]
    assert not db.tables.get("user_code_assignments")


@pytest.mark.parametrize("owner", [None, "learner-2", USER, "assigned"])
def test_compensation_never_restores_another_requests_provisional_snapshot(world, owner):
    """Codex r4423531637 at helper level: A's undo was skipped (the row carries
    B's code) and B's snapshot is A's Step 3. B restores it only when A's code
    is this user's (claimed, or granted); otherwise the account ends inactive."""
    db, client = world
    committed = owner in (USER, "assigned")
    db.tables["users"][0].update(is_active=committed, access_code_used="PAIRA" if committed else None,
                                  permissions=["practice_single"] if committed else None)
    if owner == "assigned":
        db.tables["user_code_assignments"] = [{"user_id": USER, "code_id": "code-a", "is_active": False}]
    a_written = {"is_active": True, "access_code_used": "PAIRA", "permissions": ["practice_single"]}
    s0 = {"is_active": False, "access_code_used": None, "permissions": None}
    before = deepcopy(db.tables)
    db.archive_race = True
    response = activate(client)
    assert response.status_code == 400, response.text
    assert response.json()["detail"] == GENERIC
    assert db.tables["users"] == before["users"]
    user = db.tables["users"][0]
    assert {key: user[key] for key in PAIR_FIELDS} == (a_written if committed else s0)
    assert db.tables["students"] == before["students"]
    assert db.tables.get("user_code_assignments") == before.get("user_code_assignments")
    assert_unused_code = db.tables["access_codes"][0]
    assert assert_unused_code["is_used"] is False and assert_unused_code["used_by"] is None


@pytest.mark.parametrize("outcome", ["lost", "indeterminate"])
def test_lost_claim_of_an_active_account_restores_its_code_and_permissions(world, monkeypatch, outcome):
    """CR lost/lost: an already-active learner who loses the claim keeps
    neither the lost code nor its permissions; is_active is not touched."""
    db, client = world
    db.tables["users"][0].update(is_active=True)
    before = {key: db.tables["users"][0][key] for key in PAIR_FIELDS}

    def claim_fails(query):
        if query.name == "access_codes" and query.op == "update":
            if outcome == "indeterminate":
                raise RuntimeError(DB_TEXT)
            db.tables["access_codes"][0].update(is_used=True, used_by="learner-2")

    writes = record_writes(monkeypatch, claim_fails)
    response = activate(client)
    assert response.status_code == (503 if outcome == "indeterminate" else 400), response.text
    assert {key: db.tables["users"][0][key] for key in PAIR_FIELDS} == before
    reverts = [w[2] for w in writes if w[0] == "users" and w[2].get("is_active") is not True]
    assert db.tables["students"] == []
    assert not db.tables.get("user_code_assignments")


def test_duplicate_submit_of_the_same_code_is_not_a_rival_activation(world, monkeypatch):
    """The ownership gate refuses only another code: a second submit of the
    same code over the first one's Step 3 still claims normally."""
    db, client = world
    db.tables["users"][0].update(is_active=True, access_code_used=CODE, permissions=["practice_single"])
    response = activate(client)
    assert response.status_code == 200, response.text
    assert db.tables["access_codes"][0]["used_by"] == USER


def test_snapshot_ownership_lookup_failure_is_503_before_any_write(world, monkeypatch, caplog):
    db, client = world
    db.tables["users"][0].update(is_active=True, access_code_used="PAIRA")
    db.tables["access_codes"].append({"id": "code-a", "code": "PAIRA", "is_used": False, "used_by": None})
    before = deepcopy(db.tables)
    db.transaction_receipt = {"status": "activation_conflict"}
    response = activate(client)
    assert response.status_code == 503, response.text
    assert "Mã CHƯA được sử dụng" in response.text
    assert DB_TEXT not in response.text and DB_TEXT not in caplog.text
    assert all(op == "select" for table, op in db.calls)
    assert db.tables["users"] == before["users"]
    assert db.tables["students"] == before["students"]
    assert_unused(db)


def test_real_pg_overlapping_failed_activations(world, pg_activation, monkeypatch):
    """PC-J420 on real PostgreSQL: every statement commits on its own, as over
    PostgREST. Pairs run inside one test so the module fixture builds once."""
    import test_migration_337_class_archive as m337
    from test_migration_240_core_attempt_evidence import psql

    _, client = world
    schema, admin, _ = pg_activation
    psql(f"""CREATE TABLE IF NOT EXISTS {schema}.user_code_assignments (
        user_id uuid NOT NULL, code_id uuid NOT NULL, assigned_at timestamptz,
        is_active boolean NOT NULL DEFAULT true, PRIMARY KEY (user_id, code_id))""")
    original = PgQuery.execute
    for kind_a, kind_b in [("archive", "archive"), ("lost", "lost"), ("archive", "lost")]:
        monkeypatch.setattr(PgQuery, "execute", original)
        uid = str(uuid4())
        db = Database()
        db.schema, db.after_activate = schema, None
        db.table = lambda name, db=db: PgQuery(db, name)
        monkeypatch.setattr(auth, "supabase_admin", db)
        monkeypatch.setattr(auth, "get_supabase_user", AsyncMock(return_value={
            "id": uid, "email": "learner@example.test", "user_metadata": {},
        }))
        db.table("users").insert({"id": uid, "is_active": False}).execute()
        requests, classes = {}, {}
        for name, kind in (("A", kind_a), ("B", kind_b)):
            code_id = str(uuid4())
            classes[code_id] = m337._new_class(schema) if kind == "archive" else None
            requests[name] = (f"PAIR{name}" + uid[:8].upper(), code_id, kind)
            db.table("access_codes").insert({"id": code_id, "code": requests[name][0],
                                             "cohort_id": classes[code_id],
                                             "permissions": [f"perm-{name}"]}).execute()
        before = {key: value for key, value in
                  db.table("users").select("*").eq("id", uid).execute().data[0].items()
                  if key in PAIR_FIELDS}

        def fail(request, _query):
            if request[2] == "archive":
                m337._archive_class(schema, classes[request[1]], admin)
            else:
                psql(f"UPDATE {schema}.access_codes SET is_used = true, used_by = '{uuid4()}', "
                     f"used_at = now() WHERE id = '{request[1]}'")

        response_a, response_b = overlap_activations(monkeypatch, PgQuery, client.app, requests, fail)
        monkeypatch.setattr(PgQuery, "execute", original)
        pair = f"{kind_a}/{kind_b}"
        user = db.table("users").select("*").eq("id", uid).execute().data[0]
        codes = [db.table("access_codes").select("*").eq("id", code_id).execute().data[0]
                 for _, code_id, _ in requests.values()]
        assert_pair_left_no_orphan_activation(user, codes, uid, before)
        assert response_a.status_code == 400, (pair, response_a.text)
        assert response_b.status_code == 503, (pair, response_b.text)
        assert response_b.json()["detail"]["error_code"] == "activation_conflict", pair
        assert not db.table("students").select("*").eq("user_id", uid).execute().data, pair


def overlap_same_code_activation(monkeypatch, query_class, app, code, outcome, before_b, archive):
    """B completes while A waits at enrollment (archive) or its claim (uncertain).

    Request context follows asyncio.to_thread, so the seam distinguishes the
    two requests even though their user, code and Step 3 values are identical.
    """
    from services.request_context import current_request_id
    a_waiting, b_done = threading.Event(), threading.Event()
    original = auth.supabase_admin.rpc
    responses, errors = {}, []
    def rpc(name, params):
        if name != "fn_activation_serialize" or current_request_id() != "same-code-A":
            return original(name, params)
        def execute():
            a_waiting.set()
            assert b_done.wait(20), "B did not finish its successful activation"
            if outcome == "archive":
                archive()
                return SimpleNamespace(data={"status": "cohort_archived"})
            # The entire RPC committed; the response was lost after the commit.
            raise RuntimeError(DB_TEXT)
        return SimpleNamespace(execute=execute)
    monkeypatch.setattr(auth.supabase_admin, "rpc", rpc)
    def run_a():
        try:
            with request_id_scope("same-code-A"), TestClient(app) as client:
                responses["A"] = activate(client, code)
        except BaseException as exc:
            errors.append(exc)
    first = threading.Thread(target=run_a)
    first.start()
    try:
        assert a_waiting.wait(20), "A never reached its failure point"
        before_b()
        with request_id_scope("same-code-B"), TestClient(app) as client:
            responses["B"] = activate(client, code)
        assert responses["B"].status_code == 200, responses["B"].text
    finally:
        b_done.set()
        first.join(60)
    assert not first.is_alive(), "A did not finish compensation"
    assert not errors, errors
    return responses["A"]


@pytest.mark.parametrize("outcome", ["archive", "uncertain"])
def test_same_code_success_survives_an_overlapping_failed_request(world, monkeypatch, outcome):
    db, client = world
    db.tables["users"][0].update(is_active=False, access_code_used=None, permissions=None)

    def before_b():
        if outcome == "archive":
            # A already chose INSERT. A concurrent roster import gives B a
            # profile with a different student_code to fold into; A's stale
            # insert then reaches the archive guard, not a duplicate-code error.
            db.table("students").insert({
                "user_id": USER, "student_code": "OLD-ROSTER", "full_name": "QA learner",
                "instructor_id": None, "cohort_id": None, "archived_at": None,
            }).execute()
        else:
            # Match the nullable DB default on A's freshly inserted profile.
            assert db.tables["students"] == []

    def archive():
        db.archive_race = True
        db.tables["cohorts"][0].update(is_active=False, archived_at="2026-10-30T00:00:00Z")

    response = overlap_same_code_activation(monkeypatch, Query, client.app, CODE, outcome, before_b, archive)
    user, code = db.tables["users"][0], db.tables["access_codes"][0]
    assert {key: user[key] for key in PAIR_FIELDS} == {
        "is_active": True, "access_code_used": CODE, "permissions": ["practice_single"],
    }
    assert code["is_used"] is True and code["used_by"] == USER and code["used_at"]
    assert len(db.tables["students"]) == 1
    assert db.tables["students"][0]["cohort_id"] == COHORT
    assert db.tables["user_code_assignments"]
    assert response.status_code == (400 if outcome == "archive" else 200), response.text
    if outcome == "archive":
        assert response.json()["detail"] == GENERIC


@pytest.mark.parametrize("outcome", ["archive", "uncertain"])
def test_real_pg_same_code_success_survives_an_overlapping_failed_request(
        world, pg_activation, monkeypatch, outcome):
    """Real 337 archive refusal and autocommitted claim; no simulated DB state."""
    import test_migration_337_class_archive as m337
    from test_migration_240_core_attempt_evidence import psql

    _, client = world
    schema, admin, _ = pg_activation
    psql(f"""CREATE TABLE IF NOT EXISTS {schema}.user_code_assignments (
        user_id uuid NOT NULL, code_id uuid NOT NULL, assigned_at timestamptz,
        is_active boolean NOT NULL DEFAULT true, PRIMARY KEY (user_id, code_id))""")
    uid, code_id, cid = str(uuid4()), str(uuid4()), m337._new_class(schema)
    code_text = CODE + uid[:8].upper()
    db = Database()
    db.schema, db.after_activate = schema, None
    db.table = lambda name: PgQuery(db, name)
    monkeypatch.setattr(auth, "supabase_admin", db)
    monkeypatch.setattr(auth, "get_supabase_user", AsyncMock(return_value={
        "id": uid, "email": "learner@example.test", "user_metadata": {},
    }))
    db.table("users").insert({"id": uid, "is_active": False}).execute()
    db.table("access_codes").insert({"id": code_id, "code": code_text, "cohort_id": cid,
                                     "permissions": ["practice_single"]}).execute()

    def before_b():
        if outcome == "archive":
            db.table("students").insert({"user_id": uid, "student_code": "OLD-" + uid,
                                         "full_name": "QA learner"}).execute()

    response = overlap_same_code_activation(
        monkeypatch, PgQuery, client.app, code_text, outcome, before_b,
        lambda: m337._archive_class(schema, cid, admin),
    )
    user = db.table("users").select("*").eq("id", uid).execute().data[0]
    code = db.table("access_codes").select("*").eq("id", code_id).execute().data[0]
    assert {key: user[key] for key in PAIR_FIELDS} == {
        "is_active": True, "access_code_used": code_text, "permissions": ["practice_single"],
    }
    assert code["is_used"] is True and code["used_by"] == uid and code["used_at"]
    students = db.table("students").select("*").eq("user_id", uid).execute().data
    assert len(students) == 1 and students[0]["cohort_id"] == cid
    memberships = db.table("student_cohort_memberships").select("*").eq("student_id", students[0]["id"]).execute().data
    assert len(memberships) == 1 and memberships[0]["is_active"] is True
    assert db.table("user_code_assignments").select("*").eq("user_id", uid).eq("code_id", code_id).execute().data
    assert response.status_code == (400 if outcome == "archive" else 200), response.text
    if outcome == "archive":
        assert response.json()["detail"] == GENERIC
        audits = db.table("access_code_audit").select("*").eq("code_id", code_id).execute().data
        assert len(audits) == 1
        assert audits[0]["after"]["detail"]["race"] is True
        assert audits[0]["after"]["detail"]["compensation_failed"] is False


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


def test_cross_instructor_rejection_preserves_account_and_allows_valid_retry(world):
    """Codex r4424260839: terminal 403 cannot poison the next valid activation."""
    db, client = world
    db.tables["users"] += [{"id": "gv-x", "role": "instructor"}, {"id": "gv-y", "role": "instructor"}]
    db.tables["users"][0].update(is_active=True)
    db.tables["students"] = [{"id": "st-1", "user_id": USER, "student_code": "S1",
                              "instructor_id": "gv-x", "cohort_id": None, "archived_at": None}]
    db.tables["access_codes"] = [
        {"id": "code-y", "code": "YCODE", "is_used": False, "used_by": None,
         "issued_by": "gv-y", "permissions": ["practice_full"]},
        {"id": "code-x", "code": "XCODE", "is_used": False, "used_by": None,
         "issued_by": "gv-x", "permissions": ["practice_single"]},
    ]
    before = deepcopy(db.tables)
    rejected = activate(client, "YCODE")
    assert rejected.status_code == 403, rejected.text
    assert db.tables["users"] == before["users"]
    assert db.tables["students"] == before["students"]
    assert db.tables["access_codes"] == before["access_codes"]
    valid = activate(client, "XCODE")
    assert valid.status_code == 200, valid.text
    assert db.tables["users"][0]["is_active"] is True
    assert db.tables["users"][0]["access_code_used"] == "XCODE"
    assert db.tables["access_codes"][1]["used_by"] == USER
    assert db.tables["students"][0]["instructor_id"] == "gv-x"


@pytest.mark.parametrize("receipt", [None, {}, [], {"status": "unrecognized"}])
def test_unconfirmed_rpc_receipt_changes_no_activation_data(world, caplog, receipt):
    db, client = world
    before = deepcopy(db.tables)
    db.transaction_receipt = receipt
    db.transaction_unconfirmed = receipt is None
    response = activate(client)
    assert response.status_code == 503, response.text
    assert response.json()["detail"]["error_code"] == "activation_incomplete"
    assert db.tables["users"] == before["users"]
    assert db.tables["students"] == before["students"]
    assert_unused(db)
    assert CODE not in caplog.text and DB_TEXT not in caplog.text


def test_cancellation_does_not_undo_an_atomic_activation(world, monkeypatch):
    import asyncio

    db, _ = world
    entered, release, committed = threading.Event(), threading.Event(), threading.Event()
    original = db.rpc
    def rpc(name, params):
        if name != "fn_activation_serialize":
            return original(name, params)
        def execute():
            entered.set()
            assert release.wait(20), "cancelled request never released its DB worker"
            try:
                return original(name, params).execute()
            finally:
                committed.set()
        return SimpleNamespace(execute=execute)
    monkeypatch.setattr(db, "rpc", rpc)

    async def run():
        task = asyncio.create_task(auth.activate_account(auth.ActivateRequest(access_code=CODE), "Bearer fake"))
        try:
            assert await asyncio.to_thread(entered.wait, 20)
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
            release.set()
            assert await asyncio.to_thread(committed.wait, 20)
        finally:
            release.set()
            if not task.done():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
    asyncio.run(run())
    assert db.tables["users"][0]["is_active"] is True
    assert db.tables["users"][0]["access_code_used"] == CODE
    assert db.tables["access_codes"][0]["used_by"] == USER
    assert len(db.tables["students"]) == 1
    assert db.tables["students"][0]["cohort_id"] == COHORT
