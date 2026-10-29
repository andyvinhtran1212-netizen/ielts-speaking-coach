"""Response-model coverage for `/admin/cohorts` picker and rollup modes."""

import json
import re
from datetime import datetime
from pathlib import Path
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from fastapi import FastAPI
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from pydantic import ValidationError
import pytest

import test_migration_326_student_archive as m326
import test_migration_331_archived_student_give_guard as m331
from models.cohorts import ARCHIVE_FIELDS, AdminCohortListOut, AdminCohortOut
from routers.cohorts import router
from test_migration_240_core_attempt_evidence import psql


def _base_row():
    return {
        "id": "cohort-1",
        "name": "Khoá 1",
        "code_prefix": "C1",
        "description": None,
        "is_active": True,
        "created_by": None,
        "created_at": "2026-09-14T00:00:00+00:00",
        "updated_at": "2026-09-14T00:00:00+00:00",
        "course_id": None,
    }


def test_route_uses_one_superset_and_preserves_picker_shape():
    route = next(
        item for item in router.routes
        if isinstance(item, APIRoute) and item.path == "/admin/cohorts"
    )
    assert route.response_model is AdminCohortListOut
    assert route.response_model_exclude_unset is True

    value = AdminCohortListOut.model_validate({"cohorts": [_base_row()]})
    dumped = value.model_dump(mode="json", exclude_unset=True)
    assert "course" not in dumped["cohorts"][0]
    assert "member_count" not in dumped["cohorts"][0]
    assert "rollup_failed" not in dumped


def test_rollup_mode_keeps_course_counts_and_failure_truth():
    row = {
        **_base_row(),
        "course_id": "course-1",
        "course": {
            "id": "course-1",
            "code": "C1",
            "name": "Khóa nền tảng tiếng Anh",
            "sort_order": 1,
            "is_active": True,
        },
        "member_count": None,
        "unactivated_count": None,
    }
    dumped = AdminCohortListOut.model_validate({
        "cohorts": [row],
        "rollup_failed": True,
    }).model_dump(mode="json", exclude_unset=True)
    assert dumped["cohorts"][0]["course"]["code"] == "C1"
    assert dumped["cohorts"][0]["member_count"] is None
    assert dumped["rollup_failed"] is True


@pytest.mark.parametrize(
    "payload",
    [
        {"cohorts": [{**_base_row(), "member_count": -1}]},
        {"cohorts": [{**_base_row(), "unknown": True}]},
        {"cohorts": "not-a-list"},
    ],
)
def test_malformed_cohort_payloads_fail_closed(payload):
    with pytest.raises(ValidationError):
        AdminCohortListOut.model_validate(payload)


# ── Migration 337 archive columns (PC-J151, PC-J106 F1) ─────────────────────
#
# The service reads cohorts with select("*") and the model forbids extra keys,
# so every column a migration adds to cohorts must be a model field, or the
# list answers 500 for every class the moment the migration is applied.

MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"
ROLLUP_ONLY = {"course", "member_count", "unactivated_count"}
ADMIN = {"id": "00000000-0000-0000-0000-00000000aaaa", "email": "admin@x"}
COURSE = {"id": "course-1", "code": "C1", "name": "Khóa nền tảng tiếng Anh",
          "sort_order": 1, "is_active": True}
ARCHIVED = {
    "archived_at": "2026-10-29T08:00:00+00:00",
    "archived_by": "00000000-0000-0000-0000-00000000bbbb",
    "archive_reason": "Kết thúc khoá",
}


def _strip_sql_comments(sql: str) -> str:
    return re.sub(r"--[^\n]*", "", sql)


def _top_level_split(body: str) -> list[str]:
    parts, depth, current = [], 0, []
    for char in body:
        depth += char == "("
        depth -= char == ")"
        if char == "," and depth == 0:
            parts.append("".join(current))
            current = []
        else:
            current.append(char)
    parts.append("".join(current))
    return [part.strip() for part in parts if part.strip()]


def _cohorts_columns_from_migrations() -> tuple[set[str], dict[str, set[str]]]:
    """Replay every CREATE/ALTER TABLE on public.cohorts, in file order."""
    table = r"(?:IF\s+(?:NOT\s+)?EXISTS\s+)?(?:ONLY\s+)?(?:public\.)?cohorts\b"
    columns: set[str] = set()
    added_by: dict[str, set[str]] = {}
    for path in sorted(MIGRATIONS.glob("[0-9][0-9][0-9]_*.sql")):
        if path.name.endswith("_rollback.sql"):
            continue
        code = _strip_sql_comments(path.read_text(encoding="utf-8"))
        for match in re.finditer(rf"\bCREATE\s+TABLE\s+{table}\s*\((.*?)\);", code, re.I | re.S):
            for item in _top_level_split(match.group(1)):
                name = item.split()[0].lower()
                if name not in {"primary", "unique", "check", "constraint", "foreign", "exclude"}:
                    columns.add(name)
                    added_by.setdefault(path.name, set()).add(name)
        for match in re.finditer(rf"\bALTER\s+TABLE\s+{table}(.*?);", code, re.I | re.S):
            body = match.group(1)
            for name in re.findall(r"\bADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(\w+)", body, re.I):
                if name.lower() not in {"constraint", "primary", "unique", "check", "foreign"}:
                    columns.add(name.lower())
                    added_by.setdefault(path.name, set()).add(name.lower())
            for name in re.findall(r"\bDROP\s+(?:COLUMN\s+)?(?:IF\s+EXISTS\s+)?(\w+)", body, re.I):
                columns.discard(name.lower())
            for old, new in re.findall(r"\bRENAME\s+(?:COLUMN\s+)?(\w+)\s+TO\s+(\w+)", body, re.I):
                columns.discard(old.lower())
                columns.add(new.lower())
    return columns, added_by


def test_every_cohorts_column_any_migration_adds_is_a_model_field():
    columns, added_by = _cohorts_columns_from_migrations()
    # The parser is not vacuous: it sees the 060 table, 175 and 337.
    assert added_by["060_cohorts_table.sql"] == {
        "id", "name", "code_prefix", "description", "is_active", "created_by",
        "created_at", "updated_at"}
    assert added_by["175_courses.sql"] == {"course_id"}
    assert added_by["337_class_archive_enforcement.sql"] == set(ARCHIVE_FIELDS)
    fields = set(AdminCohortOut.model_fields) - ROLLUP_ONLY
    assert columns - fields == set(), "add the new cohorts column to AdminCohortOut"
    # ...and the model invents no column the table does not have.
    assert fields - columns == set()


class _Query:
    def __init__(self, rows):
        self.rows = rows

    def __getattr__(self, _name):          # select / eq / in_ / order / range
        return lambda *_a, **_k: self

    def execute(self):
        return type("R", (), {"data": self.rows})()


class _Db:
    def __init__(self, cohorts):
        self.tables = {"cohorts": cohorts, "courses": [COURSE],
                       "student_cohort_memberships": [], "students": []}

    def table(self, name):
        return _Query(self.tables[name])


def _app_client(db):
    from routers import cohorts as cohorts_router
    app = FastAPI()
    app.include_router(cohorts_router.router)
    return patch.multiple(cohorts_router, supabase_admin=db,
                          require_admin=AsyncMock(return_value=ADMIN)), TestClient(
                              app, raise_server_exceptions=False)


def _get(db, query=""):
    patcher, client = _app_client(db)
    with patcher, client:
        return client.get("/admin/cohorts" + query, headers={"Authorization": "Bearer x"})


QUERIES = ["", "?is_active=true", "?with_rollup=true"]


@pytest.mark.parametrize("query", QUERIES)
def test_pre_337_row_answers_200_with_null_archive_fields(query):
    """(a) Schema before 337: the nine old columns only."""
    response = _get(_Db([_base_row()]), query)
    assert response.status_code == 200, response.text
    row = response.json()["cohorts"][0]
    # Stable shape (Leader 29/10): the keys are there before 337 too.
    assert {key: row[key] for key in ARCHIVE_FIELDS} == dict.fromkeys(ARCHIVE_FIELDS)
    rollup = query == "?with_rollup=true"
    assert ("member_count" in row) is rollup and ("course" in row) is rollup


@pytest.mark.parametrize("query", QUERIES)
def test_post_337_live_class_row_answers_200(query):
    """(b) After 337 a live class carries the three keys as null."""
    response = _get(_Db([{**_base_row(), **dict.fromkeys(ARCHIVE_FIELDS)}]), query)
    assert response.status_code == 200, response.text
    row = response.json()["cohorts"][0]
    assert {key: row[key] for key in ARCHIVE_FIELDS} == dict.fromkeys(ARCHIVE_FIELDS)


@pytest.mark.parametrize("query", ["", "?is_active=false", "?with_rollup=true"])
def test_post_337_archived_class_row_answers_200_with_its_metadata(query):
    """(c) An archived class returns its metadata unchanged."""
    db = _Db([{**_base_row(), "is_active": False, "course_id": "course-1", **ARCHIVED}])
    response = _get(db, query)
    assert response.status_code == 200, response.text
    row = response.json()["cohorts"][0]
    assert datetime.fromisoformat(row["archived_at"]) == datetime.fromisoformat(ARCHIVED["archived_at"])
    assert row["archived_by"] == ARCHIVED["archived_by"]
    assert row["archive_reason"] == ARCHIVED["archive_reason"]
    assert row["is_active"] is False
    if query == "?with_rollup=true":
        assert row["course"]["code"] == "C1" and row["member_count"] == 0


def test_an_unknown_cohorts_column_still_fails_closed():
    """The model stays strict: only the columns a migration adds are accepted."""
    response = _get(_Db([{**_base_row(), "archived_note": "x"}]))
    assert response.status_code == 500


# ── PostgreSQL: the real route before and after the real 337 ────────────────
#
# Builds the 331 harness (326 + 228 + 331), gives cohorts its pre-337
# production columns (060 + 175) and the class tables 337 reads, then serves
# GET /admin/cohorts from that schema through a select-only PostgREST stand-in.
# The rows are json_agg output, so timestamps and uuids reach the model as
# PostgREST would send them. 337 itself is applied unmodified (schema-renamed).

SQL_337 = (MIGRATIONS / "337_class_archive_enforcement.sql").read_text(encoding="utf-8")
PRE_337 = {"id", "name", "code_prefix", "description", "is_active", "created_by",
           "created_at", "updated_at", "course_id"}
_IDENT = re.compile(r"^[a-z_][a-z0-9_]*$")


def _literal(value) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    return "'" + str(value).replace("'", "''") + "'"


class _PgQuery:
    def __init__(self, schema: str, table: str):
        assert _IDENT.match(table)
        self.schema, self.table = schema, table
        self.columns, self.where, self.order_by, self.window = "*", [], "", ""

    def select(self, columns="*"):
        names = [c.strip() for c in columns.split(",")]
        assert columns == "*" or all(_IDENT.match(n) for n in names), columns
        self.columns = columns
        return self

    def eq(self, column, value):
        assert _IDENT.match(column)
        self.where.append(f"{column} = {_literal(value)}")
        return self

    def in_(self, column, values):
        assert _IDENT.match(column)
        values = list(values)
        self.where.append(f"{column} IN ({', '.join(map(_literal, values))})" if values else "false")
        return self

    def order(self, column, desc=False):
        assert _IDENT.match(column)
        self.order_by = f" ORDER BY {column}{' DESC' if desc else ''}"
        return self

    def range(self, start, end):
        self.window = f" OFFSET {int(start)} LIMIT {int(end) - int(start) + 1}"
        return self

    def execute(self):
        where = f" WHERE {' AND '.join(self.where)}" if self.where else ""
        out = psql(f"""SELECT coalesce(json_agg(t), '[]') FROM (
                           SELECT {self.columns} FROM {self.schema}.{self.table}{where}
                           {self.order_by}{self.window}) t""")
        return type("R", (), {"data": json.loads(out)})()


class _PgDb:
    def __init__(self, schema: str):
        self.schema = schema

    def table(self, name):
        return _PgQuery(self.schema, name)


def _pre_337_production_shape(s: str) -> str:
    """cohorts as 060 + 175 left it, plus the class/code columns 337 reads that
    the 326 harness does not model. IF NOT EXISTS: the harness may own some."""
    return f"""
        SET search_path = {s}, pg_temp;
        CREATE TABLE IF NOT EXISTS courses (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE,
            name text NOT NULL, description text, sort_order integer NOT NULL DEFAULT 0,
            is_active boolean NOT NULL DEFAULT true);
        ALTER TABLE cohorts
            ADD COLUMN IF NOT EXISTS code_prefix text,
            ADD COLUMN IF NOT EXISTS description text,
            ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
            ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
            ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
            ADD COLUMN IF NOT EXISTS course_id uuid REFERENCES courses(id) ON DELETE SET NULL;
        CREATE TABLE IF NOT EXISTS class_assignments (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            cohort_id uuid NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
            title text NOT NULL DEFAULT 'work', status text NOT NULL DEFAULT 'published');
        ALTER TABLE class_assignment_items
            ADD COLUMN IF NOT EXISTS assignment_id uuid REFERENCES class_assignments(id) ON DELETE CASCADE,
            ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'assigned',
            ADD COLUMN IF NOT EXISTS opened_at timestamptz;
        CREATE TABLE IF NOT EXISTS access_codes (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            cohort_id uuid REFERENCES cohorts(id) ON DELETE SET NULL,
            is_active boolean NOT NULL DEFAULT true,
            is_used boolean DEFAULT false, is_revoked boolean DEFAULT false);
        REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA {s} FROM anon, authenticated;
        REVOKE ALL ON TABLE student_cohort_memberships FROM PUBLIC, anon, authenticated;
    """


def _cohort_columns(s: str) -> set[str]:
    return set(psql(f"""SELECT string_agg(column_name, ',') FROM information_schema.columns
                        WHERE table_schema = '{s}' AND table_name = 'cohorts'""").split(","))


def _pg_get(s: str, query: str):
    patcher, client = _app_client(_PgDb(s))
    with patcher, client:
        return client.get("/admin/cohorts" + query, headers={"Authorization": "Bearer x"})


# What the five pickers (access-codes, users, writing-queue, mock-exams,
# exam-content) and the Lớp & Học viên page send.
ROUTE_QUERIES = ["?is_active=true", "", "?is_active=false", "?with_rollup=true"]


@pytest.fixture(scope="module")
def pg_classes():
    m331._require_pg()
    s = "cohorts_n1_" + uuid4().hex
    try:
        m331._build(s)
        psql(_pre_337_production_shape(s))
        course = psql(f"""INSERT INTO {s}.courses (code, name, sort_order)
                          VALUES ('C1', 'Khóa nền tảng tiếng Anh', 1) RETURNING id""")
        live, gone = str(uuid4()), str(uuid4())
        psql(f"""INSERT INTO {s}.cohorts (id, name, code_prefix, course_id) VALUES
                     ('{live}', 'Lớp đang học', 'L1', '{course}'),
                     ('{gone}', 'Lớp sẽ lưu trữ', 'L2', NULL)""")
        learner = m326._learner(s, cohorts=0)
        psql(m326._svc(f"SELECT {s}.fn_add_student_cohort_membership('{learner['student']}', '{live}', NULL);"))
        yield {"s": s, "live": live, "gone": gone, "admin": m326._admin(s)}
    finally:
        psql(f"DROP SCHEMA IF EXISTS {s} CASCADE")


def _rows(response) -> dict[str, dict]:
    assert response.status_code == 200, response.text
    return {row["id"]: row for row in response.json()["cohorts"]}


def test_pg_route_before_and_after_the_real_337(pg_classes):
    s, live, gone = pg_classes["s"], pg_classes["live"], pg_classes["gone"]
    assert _cohort_columns(s) == PRE_337

    # Before 337: every mode answers 200 and the archive keys are null.
    for query in ROUTE_QUERIES:
        rows = _rows(_pg_get(s, query))
        expected = {"?is_active=true": {live, gone}, "?is_active=false": set()}.get(query, {live, gone})
        assert set(rows) == expected, query
        for row in rows.values():
            assert {key: row[key] for key in ARCHIVE_FIELDS} == dict.fromkeys(ARCHIVE_FIELDS), query
    rollup = _rows(_pg_get(s, "?with_rollup=true"))
    assert rollup[live]["member_count"] == 1 and rollup[live]["course"]["code"] == "C1"

    psql(m331._schema_sql(SQL_337, s))
    assert _cohort_columns(s) == PRE_337 | set(ARCHIVE_FIELDS)

    # After 337, live classes only: the keys exist on every row as null.
    for query in ROUTE_QUERIES:
        for row in _rows(_pg_get(s, query)).values():
            assert {key: row[key] for key in ARCHIVE_FIELDS} == dict.fromkeys(ARCHIVE_FIELDS), query

    # Archive one class through the real 337 RPC.
    admin = pg_classes["admin"]
    receipt = m326._as("service_role", f"SELECT {s}.fn_archive_cohort('{gone}', '{admin}', 'Kết thúc khoá')")
    assert receipt and json.loads(receipt)
    stamped = psql(f"SELECT to_json(archived_at) FROM {s}.cohorts WHERE id = '{gone}'")

    active = _rows(_pg_get(s, "?is_active=true"))
    assert set(active) == {live}
    for query in ("?is_active=false", "", "?with_rollup=true"):
        rows = _rows(_pg_get(s, query))
        archived = rows[gone]
        assert archived["is_active"] is False, query
        assert datetime.fromisoformat(archived["archived_at"]) == datetime.fromisoformat(json.loads(stamped))
        assert archived["archived_by"] == admin and archived["archive_reason"] == "Kết thúc khoá", query
        if live in rows:
            assert rows[live]["archived_at"] is None, query
    rollup = _rows(_pg_get(s, "?with_rollup=true"))
    assert rollup[live]["member_count"] == 1 and rollup[gone]["member_count"] == 0
