"""Migration 360 (INSTRUCTORGIVE-0044, PC-J192): idempotent /instructor Writing gives.

The static half always runs. The PostgreSQL half builds a minimal schema with
the columns the RPC reads and writes (writing_assignments with the
grading_tier enum, prompts, classes, learners, active memberships), plus a
stand-in for the 331 archived-learner trigger, then applies 360 twice. It
proves replay, the payload/owner refusals, the in-transaction ownership and
roster checks, whole-transaction rollback of the ledger row on any refusal,
the privileges, and — with two real sessions — that two requests with the same
request_id create exactly one give and answer the same receipt.

Set TEST_PG_URL to a LOCAL disposable cluster and REQUIRE_PG=1 to forbid skips.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import time
from pathlib import Path
from uuid import uuid4

import pytest

import test_migration_326_student_archive as m326
from test_migration_240_core_attempt_evidence import DB, psql

BACKEND = Path(__file__).resolve().parents[1]
MIGRATIONS = BACKEND / "migrations"
NAME = "360_instructor_writing_give_idempotency.sql"
SQL = (MIGRATIONS / NAME).read_text(encoding="utf-8")
CODE = m326._strip_comments(SQL)
RPC = "fn_create_instructor_writing_give_idempotent"
LEDGER = "instructor_writing_assignment_requests"
SIGNATURE = ("uuid, uuid, text, jsonb, uuid[], uuid, uuid, text, boolean, "
             "timestamptz, text, integer, text")


# ── Static contract ─────────────────────────────────────────────────────────

def test_one_additive_transaction_with_lock_timeout():
    assert CODE.strip().startswith("BEGIN;") and CODE.strip().endswith("COMMIT;")
    assert "SET LOCAL lock_timeout = '5s';" in CODE
    for forbidden in (r"\bDROP\b", r"DELETE\s+FROM", r"^\s*TRUNCATE", r"ALTER\s+TABLE\s+(?!public\.instructor_writing)",
                      r"DISABLE\s+TRIGGER", r"session_replication_role"):
        assert not re.search(forbidden, CODE, re.M | re.I), forbidden
    # The only UPDATE is the RPC writing its own receipt.
    assert re.findall(r"UPDATE\s+(\S+)", CODE) == [f"public.{LEDGER}"]


def test_never_touches_the_admin_ledger_or_the_admin_rpc():
    """W-05 reads writing_assignment_requests receipts as "admin tools"."""
    assert not re.search(r"(?<!instructor_)writing_assignment_requests", CODE)
    assert "fn_create_writing_assignments_idempotent" not in CODE


def test_rpc_is_pinned_definer_executable_by_service_role_only():
    fn = m326._function(SQL, RPC)
    assert "SECURITY DEFINER\nSET search_path = pg_catalog, pg_temp\nAS $$" in fn
    assert re.search(rf"REVOKE ALL ON FUNCTION public\.{RPC}\([^)]*\)\s*FROM PUBLIC, anon, authenticated;", CODE)
    assert re.search(rf"GRANT EXECUTE ON FUNCTION public\.{RPC}\([^)]*\)\s*TO service_role;", CODE)
    assert f"REVOKE ALL ON public.{LEDGER}\n    FROM PUBLIC, anon, authenticated, service_role;" in CODE
    assert f"GRANT SELECT ON public.{LEDGER} TO service_role;" in CODE


def test_rpc_writes_grading_tier_and_replays_before_any_ownership_read():
    fn = m326._function(SQL, RPC)
    assert "p_grading_tier::public.grading_tier_enum" in fn
    assert fn.index("ON CONFLICT (id) DO NOTHING") < fn.index("instructor_give_not_owned")
    assert "FOR SHARE OF m" in fn


# Every relation and type the definer names. With public on its search_path, a
# function created in public with an exact-type signature (SA-1: e.g.
# public.array_length(uuid[], int)) beats the polymorphic built-in and runs as
# the owner, so the path is pg_catalog, pg_temp and each of these is public.-named.
RELATIONS = ("instructor_writing_assignment_requests", "writing_assignments", "writing_prompts",
             "cohorts", "students", "student_cohort_memberships", "users", "grading_tier_enum")


def test_rpc_search_path_excludes_public_and_every_relation_is_schema_qualified():
    fn = m326._function(SQL, RPC)
    assert re.findall(r"SET search_path\s*=\s*([^\n]+)", fn) == ["pg_catalog, pg_temp"]
    body = m326._strip_comments(fn[fn.index("AS $$"):])
    for name in RELATIONS:
        assert not re.findall(rf"(?<![\w.]){name}\b", body), f"unqualified {name}"
        assert re.search(rf"\bpublic\.{name}\b", body), name
    # The postcondition pins the same path and the owner.
    assert "proconfig @> ARRAY['search_path=pg_catalog, pg_temp']" in CODE
    assert "instructor_give_rpc_unexpected_owner" in CODE
    # ... and the owner is not a client role (SA P3, PC-J502).
    assert re.search(r"IN \('service_role', 'anon', 'authenticated'\) THEN\s*"
                     r"RAISE EXCEPTION 'instructor_give_rpc_client_owner: %'", CODE)


def test_rpc_requires_an_active_staff_owner_before_the_ledger():
    fn = m326._function(SQL, RPC)
    guard = fn.index("instructor_give_owner_not_staff")
    assert "role IN ('instructor', 'admin') AND is_active" in fn[:guard]
    assert guard < fn.index("ON CONFLICT (id) DO NOTHING")


def test_forward_policy_holds_it_out_of_the_merge_apply():
    rows = [line.split("\t") for line in
            (MIGRATIONS / "forward-policy.tsv").read_text(encoding="utf-8").splitlines()
            if line.startswith(NAME)]
    assert [(r[1], r[2]) for r in rows] == [("pending_feature", "instructor_give_idempotency")]


def test_rollback_note_drops_function_then_table():
    header = SQL[:SQL.index("\nBEGIN;\n")]
    assert header.index("DROP FUNCTION IF EXISTS") < header.index("DROP TABLE IF EXISTS")


# ── PostgreSQL harness ──────────────────────────────────────────────────────

def _schema_sql(sql: str, schema: str) -> str:
    return m326._schema_sql(sql, schema).replace("search_path=public,", f"search_path={schema},")


OWNER, OTHER = str(uuid4()), str(uuid4())


def _build(schema: str, *, apply: bool = True) -> None:
    psql(f"""
        CREATE SCHEMA {schema};
        GRANT USAGE ON SCHEMA {schema} TO anon, authenticated, service_role;
        -- Supabase defaults: new tables/functions are client-accessible unless revoked.
        ALTER DEFAULT PRIVILEGES IN SCHEMA {schema}
            GRANT ALL ON TABLES TO anon, authenticated, service_role;
        ALTER DEFAULT PRIVILEGES IN SCHEMA {schema}
            GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
        SET search_path = {schema}, pg_temp;
        CREATE TYPE grading_tier_enum AS ENUM ('quick', 'standard', 'deep', 'instructor');
        CREATE TABLE users (id uuid PRIMARY KEY, role text NOT NULL DEFAULT 'instructor',
                            is_active boolean NOT NULL DEFAULT true);
        CREATE TABLE cohorts (id uuid PRIMARY KEY, created_by uuid REFERENCES users(id));
        CREATE TABLE students (id uuid PRIMARY KEY, instructor_id uuid REFERENCES users(id),
                               archived_at timestamptz);
        CREATE TABLE student_cohort_memberships (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            student_id uuid NOT NULL REFERENCES students(id),
            cohort_id uuid NOT NULL REFERENCES cohorts(id),
            is_active boolean NOT NULL DEFAULT true,
            UNIQUE (student_id, cohort_id));
        CREATE TABLE writing_prompts (id uuid PRIMARY KEY, created_by uuid REFERENCES users(id));
        CREATE TABLE writing_assignments (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            prompt_id uuid NOT NULL REFERENCES writing_prompts(id),
            student_id uuid NOT NULL REFERENCES students(id),
            cohort_id uuid REFERENCES cohorts(id),
            assignment_group_id uuid, name text,
            allow_soft_check boolean NOT NULL DEFAULT false,
            assigned_by uuid REFERENCES users(id) ON DELETE SET NULL,
            deadline timestamptz, instructions text,
            analysis_level integer NOT NULL DEFAULT 3 CHECK (analysis_level BETWEEN 1 AND 5),
            grading_tier grading_tier_enum NOT NULL DEFAULT 'standard'
                CHECK (grading_tier IN ('standard', 'deep')),
            status text NOT NULL DEFAULT 'pending',
            created_at timestamptz NOT NULL DEFAULT now());
        -- Stand-in for the 331 guard: an archived learner refuses the insert.
        CREATE FUNCTION guard_archived() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF (SELECT archived_at FROM {schema}.students WHERE id = NEW.student_id) IS NOT NULL THEN
                RAISE EXCEPTION 'student_archived' USING DETAIL = NEW.student_id::text;
            END IF;
            RETURN NEW;
        END $$;
        CREATE TRIGGER archive_guard BEFORE INSERT ON writing_assignments
            FOR EACH ROW EXECUTE FUNCTION guard_archived();
        INSERT INTO users VALUES ('{OWNER}'), ('{OTHER}');
    """)
    if apply:
        migrated = _schema_sql(SQL, schema)
        psql(migrated)
        psql(migrated)   # re-runnable


@pytest.fixture(scope="module")
def schema(probe):
    name = "give360_" + uuid4().hex[:12]
    _build(name)
    try:
        yield name
    finally:
        psql(f"DROP SCHEMA {name} CASCADE")


@pytest.fixture(scope="module")
def probe():
    try:
        available = shutil.which("psql") and psql("SELECT 1") == "1"
    except Exception:
        available = False
    if not available:
        if os.environ.get("REQUIRE_PG") == "1":
            pytest.fail("Local PostgreSQL required for migration 360 verification")
        pytest.skip("Local PostgreSQL unavailable")
    if psql("SELECT usesuper FROM pg_user WHERE usename=current_user") != "t":
        pytest.fail("Migration 360 fixture requires a superuser on its disposable LOCAL cluster")
    psql("""DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
    END $$;""")
    yield


def _lit(value) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return str(value).lower()
    if isinstance(value, int):
        return str(value)
    if isinstance(value, dict):
        return "'" + json.dumps(value).replace("'", "''") + "'::jsonb"
    return "'" + str(value).replace("'", "''") + "'"


def _call_sql(schema: str, *, request_id, owner=OWNER, kind="fan_out", payload=None,
              prompts=(), cohort=None, student=None, name=None, tier="standard", level=3,
              instructions=None) -> str:
    payload = payload if payload is not None else {"k": kind, "p": list(prompts), "c": cohort,
                                                   "s": student, "n": name, "t": tier, "l": level}
    prompts_sql = "ARRAY[" + ",".join(f"'{p}'" for p in prompts) + "]::uuid[]"
    return (f"SELECT {schema}.{RPC}({_lit(request_id)}, {_lit(owner)}, {_lit(kind)}, {_lit(payload)}, "
            f"{prompts_sql}, {_lit(cohort)}::uuid, {_lit(student)}::uuid, {_lit(name)}, false, NULL, "
            f"{_lit(instructions)}, {level}, {_lit(tier)})")


def _call(schema: str, **kw) -> dict:
    return json.loads(psql("SET ROLE service_role; " + _call_sql(schema, **kw)))


def _q(schema: str, sql: str) -> str:
    return psql(f"SET search_path = {schema}, pg_temp; {sql}")


def _class(schema: str, *, owner=OWNER, members=2, member_owner=None) -> tuple[str, list[str], list[str]]:
    """A class with `members` active learners and two prompts, all owned by `owner`."""
    cohort, prompts = str(uuid4()), [str(uuid4()), str(uuid4())]
    students = [str(uuid4()) for _ in range(members)]
    mo = member_owner or owner
    _q(schema, f"INSERT INTO cohorts VALUES ('{cohort}', '{owner}');"
               + "".join(f"INSERT INTO writing_prompts VALUES ('{p}', '{owner}');" for p in prompts)
               + "".join(f"INSERT INTO students VALUES ('{s}', '{mo}', NULL);"
                         f"INSERT INTO student_cohort_memberships (student_id, cohort_id) VALUES ('{s}', '{cohort}');"
                         for s in students))
    return cohort, prompts, students


def _count(schema: str, where: str = "true") -> int:
    return int(_q(schema, f"SELECT count(*) FROM writing_assignments WHERE {where}"))


def _ledger(schema: str, request_id: str) -> int:
    return int(_q(schema, f"SELECT count(*) FROM {LEDGER} WHERE id = '{request_id}'"))


# ── PostgreSQL: behaviour ───────────────────────────────────────────────────

def test_fan_out_creates_one_group_with_grading_tier_and_replays(schema):
    cohort, prompts, students = _class(schema)
    rid = str(uuid4())
    first = _call(schema, request_id=rid, prompts=prompts, cohort=cohort, tier="deep", name="Buổi 5")
    assert first["replayed"] is False
    assert first["student_count"] == 2 and first["created_count"] == 4
    assert first["duplicates_warning"] == []
    rows = _q(schema, f"SELECT DISTINCT assignment_group_id || '|' || cohort_id || '|' || grading_tier "
                      f"|| '|' || assigned_by || '|' || name FROM writing_assignments WHERE cohort_id = '{cohort}'")
    assert rows == f"{first['group_id']}|{cohort}|deep|{OWNER}|Buổi 5"

    again = _call(schema, request_id=rid, prompts=prompts, cohort=cohort, tier="deep", name="Buổi 5")
    assert again.pop("replayed") is True and first.pop("replayed") is False
    assert again == first
    assert _count(schema, f"cohort_id = '{cohort}'") == 4 and _ledger(schema, rid) == 1


def test_individual_give_replays_the_original_row(schema):
    _cohort, prompts, students = _class(schema, members=1)
    rid = str(uuid4())
    first = _call(schema, request_id=rid, kind="individual", prompts=prompts[:1], student=students[0])
    row = first["assignment"]
    assert row["assignment_group_id"] is None and row["cohort_id"] is None and row["assigned_by"] == OWNER
    named = _call(schema, request_id=str(uuid4()), kind="individual", prompts=prompts[:1],
                  student=students[0], name="Buổi 6")
    assert named["assignment"]["assignment_group_id"]          # a named give gets its own group
    assert named["assignment"]["id"] != row["id"]
    _q(schema, f"UPDATE writing_assignments SET status = 'submitted' WHERE id = '{row['id']}'")
    again = _call(schema, request_id=rid, kind="individual", prompts=prompts[:1], student=students[0])
    assert again["assignment"] == row                          # the original result, not today's row
    assert _count(schema, f"student_id = '{students[0]}'") == 2


@pytest.mark.parametrize("change", [
    {"name": "Buổi khác"}, {"tier": "deep"}, {"level": 4}, {"prompts": "first-only"}, {"kind": "individual"},
])
def test_same_request_id_with_another_body_is_refused_and_writes_nothing(schema, change):
    cohort, prompts, students = _class(schema)
    rid = str(uuid4())
    _call(schema, request_id=rid, prompts=prompts, cohort=cohort)
    kw = dict(request_id=rid, prompts=prompts, cohort=cohort)
    if change.get("prompts") == "first-only":
        kw["prompts"] = prompts[:1]
    elif change.get("kind") == "individual":
        kw.update(kind="individual", prompts=prompts[:1], cohort=None, student=students[0],
                  payload={"k": "fan_out", "p": prompts, "c": cohort, "s": None, "n": None,
                           "t": "standard", "l": 3})
    else:
        kw.update({"name": change.get("name"), "tier": change.get("tier", "standard"),
                   "level": change.get("level", 3)})
    with pytest.raises(RuntimeError, match="instructor_give_request_payload_mismatch"):
        _call(schema, **kw)
    assert _count(schema, f"student_id IN ('{students[0]}', '{students[1]}')") == 4


def test_another_instructor_cannot_reuse_a_request_id(schema):
    cohort, prompts, _students = _class(schema)
    rid = str(uuid4())
    receipt = _call(schema, request_id=rid, prompts=prompts, cohort=cohort)
    with pytest.raises(RuntimeError, match="instructor_give_request_owned_by_other") as error:
        _call(schema, request_id=rid, owner=OTHER, prompts=prompts, cohort=cohort)
    assert receipt["group_id"] not in str(error.value)          # no receipt leak
    assert _count(schema, f"cohort_id = '{cohort}'") == 4


@pytest.mark.parametrize("case", ["prompt", "cohort", "foreign_member", "individual_student"])
def test_ownership_is_rechecked_inside_the_transaction(schema, case):
    if case == "foreign_member":
        cohort, prompts, students = _class(schema, member_owner=OTHER)
        kw = dict(prompts=prompts, cohort=cohort)
    elif case == "cohort":
        cohort, prompts, students = _class(schema, owner=OTHER)
        _q(schema, "".join(f"UPDATE writing_prompts SET created_by = '{OWNER}' WHERE id = '{p}';" for p in prompts))
        kw = dict(prompts=prompts, cohort=cohort)
    elif case == "prompt":
        cohort, prompts, students = _class(schema)
        _q(schema, f"UPDATE writing_prompts SET created_by = '{OTHER}' WHERE id = '{prompts[1]}'")
        kw = dict(prompts=prompts, cohort=cohort)
    else:
        _cohort, prompts, students = _class(schema, member_owner=OTHER)
        kw = dict(kind="individual", prompts=prompts[:1], student=students[0])
    rid = str(uuid4())
    with pytest.raises(RuntimeError, match="instructor_give_not_owned"):
        _call(schema, request_id=rid, **kw)
    assert _ledger(schema, rid) == 0                            # rolled back with the refusal
    assert _count(schema, "student_id IN (" + ",".join(f"'{s}'" for s in students) + ")") == 0


def test_roster_is_the_active_memberships_and_empty_is_refused(schema):
    cohort, prompts, students = _class(schema, members=2)
    _q(schema, f"UPDATE student_cohort_memberships SET is_active = false WHERE student_id = '{students[1]}'")
    receipt = _call(schema, request_id=str(uuid4()), prompts=prompts[:1], cohort=cohort)
    assert receipt["student_count"] == 1
    assert _count(schema, f"student_id = '{students[1]}'") == 0
    _q(schema, f"UPDATE student_cohort_memberships SET is_active = false WHERE cohort_id = '{cohort}'")
    rid = str(uuid4())
    with pytest.raises(RuntimeError, match="instructor_give_roster_empty"):
        _call(schema, request_id=rid, prompts=prompts[1:], cohort=cohort)
    assert _ledger(schema, rid) == 0


def test_replay_after_the_roster_changed_returns_the_original_receipt(schema):
    cohort, prompts, students = _class(schema, members=1)
    rid = str(uuid4())
    first = _call(schema, request_id=rid, prompts=prompts[:1], cohort=cohort)
    late = str(uuid4())
    _q(schema, f"INSERT INTO students VALUES ('{late}', '{OWNER}', NULL);"
               f"INSERT INTO student_cohort_memberships (student_id, cohort_id) VALUES ('{late}', '{cohort}')")
    again = _call(schema, request_id=rid, prompts=prompts[:1], cohort=cohort)
    assert again["student_count"] == first["student_count"] == 1
    assert again["assignment_ids"] == first["assignment_ids"] and _count(schema, f"student_id = '{late}'") == 0


def test_duplicates_warning_reports_learners_who_already_hold_the_prompt(schema):
    cohort, prompts, students = _class(schema)
    _call(schema, request_id=str(uuid4()), kind="individual", prompts=prompts[:1], student=students[1])
    receipt = _call(schema, request_id=str(uuid4()), prompts=prompts, cohort=cohort)
    assert receipt["duplicates_warning"] == [students[1]] and receipt["created_count"] == 4


def test_archived_learner_refusal_rolls_back_the_ledger_so_the_retry_runs(schema):
    cohort, prompts, students = _class(schema)
    _q(schema, f"UPDATE students SET archived_at = now() WHERE id = '{students[0]}'")
    rid = str(uuid4())
    with pytest.raises(RuntimeError, match="student_archived"):
        _call(schema, request_id=rid, prompts=prompts, cohort=cohort)
    assert _ledger(schema, rid) == 0 and _count(schema, f"cohort_id = '{cohort}'") == 0
    _q(schema, f"UPDATE students SET archived_at = NULL WHERE id = '{students[0]}'")
    assert _call(schema, request_id=rid, prompts=prompts, cohort=cohort)["created_count"] == 4


@pytest.mark.parametrize("kw", [
    {"kind": "bulk"},
    {"prompts": "21"},
    {"prompts": "duplicate"},
    {"level": 6},
    {"tier": "instructor"},
    {"kind": "individual"},          # no student
])
def test_invalid_requests_are_refused_before_any_write(schema, kw):
    cohort, prompts, _students = _class(schema)
    args = dict(request_id=str(uuid4()), prompts=prompts, cohort=cohort)
    if kw.get("prompts") == "21":
        args["prompts"] = [str(uuid4()) for _ in range(21)]
    elif kw.get("prompts") == "duplicate":
        args["prompts"] = [prompts[0], prompts[0]]
    else:
        args.update({k: v for k, v in kw.items()})
    if args.get("kind") == "individual":
        args["cohort"] = None
    with pytest.raises(RuntimeError, match="instructor_give_request_invalid"):
        _call(schema, **args)
    assert _ledger(schema, args["request_id"]) == 0


@pytest.mark.parametrize("role,active", [("student", True), ("user", True), ("instructor", False),
                                         ("admin", False)])
def test_owner_must_be_an_active_instructor_or_admin(schema, role, active):
    cohort, prompts, _students = _class(schema)
    owner = str(uuid4())
    _q(schema, f"INSERT INTO users VALUES ('{owner}', 'instructor', true);"
               f"UPDATE cohorts SET created_by = '{owner}' WHERE id = '{cohort}';"
               f"UPDATE writing_prompts SET created_by = '{owner}' WHERE id IN ('{prompts[0]}', '{prompts[1]}');"
               f"UPDATE students SET instructor_id = '{owner}' WHERE id IN (SELECT student_id "
               f"FROM student_cohort_memberships WHERE cohort_id = '{cohort}')")
    replayed = str(uuid4())
    _call(schema, request_id=replayed, owner=owner, prompts=prompts, cohort=cohort)
    _q(schema, f"UPDATE users SET role = '{role}', is_active = {str(active).lower()} WHERE id = '{owner}'")
    rid = str(uuid4())
    with pytest.raises(RuntimeError, match="instructor_give_owner_not_staff"):
        _call(schema, request_id=rid, owner=owner, prompts=prompts[:1], cohort=cohort)
    with pytest.raises(RuntimeError, match="instructor_give_owner_not_staff"):   # no replay either
        _call(schema, request_id=replayed, owner=owner, prompts=prompts, cohort=cohort)
    assert _ledger(schema, rid) == 0
    assert _count(schema, f"cohort_id = '{cohort}'") == 4


def test_functions_created_in_the_schema_do_not_shadow_the_built_ins(schema):
    """SA-1 repro shape: exact-type overloads of polymorphic built-ins the RPC
    calls. With the old `search_path = public, pg_temp` they were picked and
    raised here; with pg_catalog, pg_temp they are never resolved."""
    shadows = {
        "array_length(uuid[], integer)": "integer",
        "array_position(uuid[], uuid)": "integer",
        "jsonb_build_object(text, boolean)": "jsonb",
    }
    for signature, returns in shadows.items():
        psql(f"CREATE FUNCTION {schema}.{signature} RETURNS {returns} LANGUAGE plpgsql AS "
             f"$$ BEGIN RAISE EXCEPTION 'shadow_resolved'; END $$; "
             f"GRANT EXECUTE ON FUNCTION {schema}.{signature} TO service_role")
    try:
        cohort, prompts, _students = _class(schema)
        rid = str(uuid4())
        first = _call(schema, request_id=rid, prompts=prompts, cohort=cohort)
        again = _call(schema, request_id=rid, prompts=prompts, cohort=cohort)
        assert first["created_count"] == 4 and again["replayed"] is True
        # The probes are reachable: the same call text outside the definer resolves them.
        with pytest.raises(RuntimeError, match="shadow_resolved"):
            psql(f"SET search_path = {schema}, pg_temp; SELECT array_length(ARRAY[gen_random_uuid()], 1)")
    finally:
        for signature in shadows:
            psql(f"DROP FUNCTION {schema}.{signature}")


def test_postcondition_aborts_when_the_rpc_was_planted_by_another_role(probe):
    """CREATE OR REPLACE keeps an existing function's owner (SA-5)."""
    other = "give360_own_" + uuid4().hex[:8]
    try:
        _build(other, apply=False)
        psql(f"CREATE FUNCTION {other}.{RPC}(p_request_id uuid, p_owner uuid, p_give_kind text, "
             "p_request_payload jsonb, p_prompt_ids uuid[], p_cohort_id uuid DEFAULT NULL, "
             "p_student_id uuid DEFAULT NULL, p_name text DEFAULT NULL, "
             "p_allow_soft_check boolean DEFAULT false, p_deadline timestamptz DEFAULT NULL, "
             "p_instructions text DEFAULT NULL, p_analysis_level integer DEFAULT 3, "
             "p_grading_tier text DEFAULT 'standard') RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$; "
             f"ALTER FUNCTION {other}.{RPC}({SIGNATURE}) OWNER TO service_role")
        with pytest.raises(RuntimeError, match="instructor_give_rpc_unexpected_owner: service_role"):
            psql(_schema_sql(SQL, other))
        assert psql(f"SELECT to_regclass('{other}.{LEDGER}') IS NULL") == "t"   # whole file rolled back
    finally:
        psql(f"DROP SCHEMA IF EXISTS {other} CASCADE")


def test_postcondition_aborts_when_applied_by_a_client_role(probe):
    """Owner == current_user still passes if service_role applies the file (SA P3, PC-J502)."""
    other = "give360_cli_" + uuid4().hex[:8]
    try:
        _build(other, apply=False)
        psql(f"GRANT CREATE ON SCHEMA {other} TO service_role")
        with pytest.raises(RuntimeError, match="instructor_give_rpc_client_owner: service_role"):
            psql("SET ROLE service_role; " + _schema_sql(SQL, other))
        assert psql(f"SELECT to_regclass('{other}.{LEDGER}') IS NULL") == "t"   # whole file rolled back
        assert psql(f"SELECT count(*) FROM pg_proc WHERE proname = '{RPC}' "
                    f"AND pronamespace = '{other}'::regnamespace") == "0"
    finally:
        psql(f"DROP SCHEMA IF EXISTS {other} CASCADE")


def test_clients_cannot_execute_the_rpc_or_touch_the_ledger(schema):
    fn = f"{schema}.{RPC}({SIGNATURE})"
    for role in ("anon", "authenticated"):
        assert psql(f"SELECT has_function_privilege('{role}', '{fn}', 'EXECUTE')") == "f"
        with pytest.raises(RuntimeError, match="permission denied"):
            psql(f"SET ROLE {role}; SELECT count(*) FROM {schema}.{LEDGER}")
    assert psql(f"SELECT has_function_privilege('service_role', '{fn}', 'EXECUTE')") == "t"
    assert psql(f"SET ROLE service_role; SELECT count(*) >= 0 FROM {schema}.{LEDGER}") == "t"
    with pytest.raises(RuntimeError, match="permission denied"):
        psql(f"SET ROLE service_role; INSERT INTO {schema}.{LEDGER} (id, assigned_by, give_kind, request_payload) "
             f"VALUES (gen_random_uuid(), '{OWNER}', 'fan_out', '{{}}')")


def test_postcondition_aborts_when_a_client_keeps_a_grant(probe):
    other = "give360_neg_" + uuid4().hex[:8]
    try:
        _build(other, apply=False)
        migrated = _schema_sql(SQL, other)
        broken = migrated.replace(f"GRANT SELECT ON {other}.{LEDGER} TO service_role;",
                                  f"GRANT SELECT ON {other}.{LEDGER} TO service_role, authenticated;")
        assert broken != migrated
        with pytest.raises(RuntimeError, match="instructor_give_ledger_client_grant"):
            psql(broken)
        assert psql(f"SELECT to_regclass('{other}.{LEDGER}') IS NULL") == "t"   # whole file rolled back
    finally:
        psql(f"DROP SCHEMA IF EXISTS {other} CASCADE")


# ── PostgreSQL: two sessions, same request_id ───────────────────────────────

SESSION_TIMEOUT = 120


def _spawn(sql: str, tag: str) -> subprocess.Popen:
    environment = m326._env()
    environment["PGAPPNAME"] = tag
    process = subprocess.Popen(["psql", DB, "-X", "-v", "ON_ERROR_STOP=1", "-tAq", "-f", "-"],
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               text=True, env=environment)
    process.stdin.write(sql)
    process.stdin.close()
    process.stdin = None   # communicate() must not touch the closed pipe
    return process


def _wait_for(tag: str, condition: str, process: subprocess.Popen, timeout: float = 60.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise AssertionError(f"session {tag} ended early: {process.stdout.read()} {process.stderr.read()}")
        if psql(f"SELECT count(*) FROM pg_stat_activity WHERE application_name = '{tag}' AND {condition}") == "1":
            return
        time.sleep(0.05)
    raise AssertionError(f"session {tag} never reached {condition}")


def _receipt(process: subprocess.Popen) -> dict:
    out, err = process.communicate(timeout=SESSION_TIMEOUT)
    assert process.returncode == 0, err
    return json.loads(next(line for line in out.splitlines() if line.startswith("{")))


@pytest.mark.parametrize("kind", ["fan_out", "individual"])
def test_concurrent_same_request_id_creates_one_give_and_the_same_receipt(schema, kind):
    """A writes its ledger row and then blocks on an advisory lock held by a
    gate session; B starts only once A is observed holding, and must wait on
    A's primary key. Releasing the gate lets A commit; B then replays. Lock
    observation, not a fixed sleep, so a slow host cannot reorder the race."""
    cohort, prompts, students = _class(schema)
    rid = str(uuid4())
    kw = (dict(prompts=prompts, cohort=cohort) if kind == "fan_out"
          else dict(kind="individual", prompts=prompts[:1], student=students[0]))
    call = _call_sql(schema, request_id=rid, **kw)
    key = int(uuid4().int % 2**31)
    suffix = uuid4().hex[:8]
    gate = _spawn(f"SELECT pg_advisory_lock({key});\nSELECT pg_sleep({SESSION_TIMEOUT});\n", "give360g_" + suffix)
    a = b = None
    try:
        _wait_for("give360g_" + suffix, "wait_event = 'PgSleep'", gate)
        a = _spawn(f"BEGIN;\nSET ROLE service_role;\n{call};\nRESET ROLE;\n"
                   f"SELECT pg_advisory_xact_lock({key});\nCOMMIT;\n", "give360a_" + suffix)
        _wait_for("give360a_" + suffix, "wait_event = 'advisory'", a)      # A holds the ledger row
        b = _spawn(f"SET ROLE service_role;\n{call};\n", "give360b_" + suffix)
        _wait_for("give360b_" + suffix, "wait_event_type = 'Lock' AND wait_event <> 'advisory'", b)
    finally:
        psql(f"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'give360g_{suffix}'")
        gate.wait(timeout=SESSION_TIMEOUT)
    first, second = _receipt(a), _receipt(b)
    assert (first.pop("replayed"), second.pop("replayed")) == (False, True)
    assert first == second
    expected = 4 if kind == "fan_out" else 1
    assert _count(schema, "student_id IN (" + ",".join(f"'{s}'" for s in students) + ")") == expected
    assert _ledger(schema, rid) == 1


def test_simultaneous_bursts_never_create_a_second_group(schema):
    for _ in range(5):
        cohort, prompts, students = _class(schema)
        call = _call_sql(schema, request_id=str(uuid4()), prompts=prompts, cohort=cohort)
        sessions = [_spawn(f"SET ROLE service_role;\n{call};\n", "give360burst") for _ in range(3)]
        receipts = [_receipt(s) for s in sessions]
        assert sorted(r.pop("replayed") for r in receipts) == [False, True, True]
        assert receipts[0] == receipts[1] == receipts[2]
        assert int(_q(schema, f"SELECT count(DISTINCT assignment_group_id) FROM writing_assignments "
                              f"WHERE cohort_id = '{cohort}'")) == 1
        assert _count(schema, f"cohort_id = '{cohort}'") == 4


def test_negative_control_distinct_request_ids_are_distinct_gives(schema):
    """Allow + warn is unchanged: two intents (two ids) at once give twice,
    so the burst test above would detect a ledger that did not deduplicate."""
    cohort, prompts, _students = _class(schema)
    sessions = [_spawn("SET ROLE service_role;\n"
                       + _call_sql(schema, request_id=str(uuid4()), prompts=prompts, cohort=cohort) + ";\n",
                       "give360neg") for _ in range(2)]
    receipts = [_receipt(s) for s in sessions]
    assert [r["replayed"] for r in receipts] == [False, False]
    assert receipts[0]["group_id"] != receipts[1]["group_id"]
    assert _count(schema, f"cohort_id = '{cohort}'") == 8
