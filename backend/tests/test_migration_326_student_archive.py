"""Migration 326 (STUDENTARCHIVE-0029): admin delete archives the learner.

The static half always runs: it pins the migration text to the approved design
(specs/0029-student-archive/research.md §4) and proves the step-4b bodies are
the 227 bodies (= the live staging bodies read in T002a) plus the archive guard.

The PostgreSQL half runs the real migration twice in a disposable schema that
mimics the parts of Supabase it touches: Supabase's default privileges, the
227 roster table/functions/trigger and their grants, the live class fan-out
writers (fn_create_class_assignment, fn_backfill_assignment_items — latest
migration bodies, verbatim), the 320 users guard, and the learner evidence
tables. It proves archive/restore (including repeated cycles and classes left
before the archive), idempotency, unchanged evidence counts, the membership
guards (single, bulk, legacy trigger), concurrent archive vs add, no class
fan-out or backfill to an archived learner (also concurrently), client-role
denial, the 320 precondition, the postconditions aborting the migration and
the rollback guard.

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
from urllib.parse import urlparse
from uuid import uuid4

import pytest

from test_migration_240_core_attempt_evidence import DB, psql

BACKEND = Path(__file__).resolve().parents[1]
MIGRATIONS = BACKEND / "migrations"
SQL = (BACKEND / "migrations/326_student_archive.sql").read_text(encoding="utf-8")
SQL_227 = (BACKEND / "migrations/227_student_cohort_memberships.sql").read_text(encoding="utf-8")
SQL_320 = (BACKEND / "migrations/320_client_write_privilege_lockdown.sql").read_text(encoding="utf-8")
# The class fan-out writers, loaded from the migration that last defines each.
FAN_OUT = ("fn_create_class_assignment", "fn_backfill_assignment_items")


def _strip_comments(sql: str) -> str:
    return re.sub(r"--[^\n]*", "", sql)


CODE = _strip_comments(SQL)


def _function(sql: str, name: str) -> str:
    """Text of the LAST `CREATE OR REPLACE FUNCTION [public.]name(...) ... $$;`."""
    starts = [m.start() for m in re.finditer(
        rf"CREATE OR REPLACE FUNCTION\s+(?:public\.)?{name}\s*\(", sql)]
    assert starts, f"{name} not defined"
    start = starts[-1]
    body = sql.index("AS $$", start) + len("AS $$")
    return sql[start:sql.index("$$;", body) + 3]


def _lines(text: str) -> list[str]:
    return [line.strip() for line in _strip_comments(text).splitlines() if line.strip()]


def _signature(fn: str) -> str:
    head = re.sub(r"\s+", " ", _strip_comments(fn[:fn.index("AS $$")])).replace("public.", "")
    return re.sub(r"\s*([(),])\s*", r"\1", head).strip()


def _tail(text: str, marker: str) -> list[str]:
    lines = _lines(text)
    index = next(i for i, line in enumerate(lines) if line.startswith(marker))
    return lines[index:]


# ── Static contract ─────────────────────────────────────────────────────────

def test_one_transaction_with_lock_timeout_and_no_destructive_ddl():
    assert CODE.strip().startswith("BEGIN;") and CODE.strip().endswith("COMMIT;")
    assert "SET LOCAL lock_timeout = '5s';" in CODE
    for forbidden in (r"DROP\s+TABLE", r"DROP\s+COLUMN", r"DELETE\s+FROM", r"^\s*TRUNCATE",
                      r"DROP\s+FUNCTION"):
        assert not re.search(forbidden, CODE, re.M), forbidden


def test_archive_and_restore_are_service_role_only_definers():
    for name, signature in (("fn_archive_student", "uuid, uuid, text, boolean"),
                            ("fn_restore_student", "uuid, uuid, text, boolean, boolean")):
        fn = _function(SQL, name)
        assert "SECURITY DEFINER SET search_path = public, pg_temp" in fn
        assert "FOR UPDATE" in fn
        assert (f"REVOKE ALL ON FUNCTION public.{name}({signature}) FROM PUBLIC, anon, authenticated;"
                in CODE)
        assert f"GRANT EXECUTE ON FUNCTION public.{name}({signature}) TO service_role;" in CODE


def test_audit_is_append_only_without_fk_and_rls_on():
    table = CODE[CODE.index("CREATE TABLE IF NOT EXISTS public.student_lifecycle_audit"):]
    table = table[:table.index(");") + 2]
    assert "REFERENCES" not in table, "the audit must survive a later purge of the student"
    assert "ALTER TABLE public.student_lifecycle_audit ENABLE ROW LEVEL SECURITY;" in CODE
    assert "REVOKE UPDATE, DELETE, TRUNCATE ON public.student_lifecycle_audit FROM service_role;" in CODE
    assert "GRANT SELECT, INSERT ON public.student_lifecycle_audit TO service_role;" in CODE


def test_archive_changes_only_memberships_archive_columns_account_and_audit():
    fn = _function(SQL, "fn_archive_student")
    writes = set(re.findall(r"\b(UPDATE|INSERT INTO|DELETE FROM)\s+public\.([a-z_]+)", fn))
    assert writes == {("UPDATE", "student_cohort_memberships"), ("UPDATE", "students"),
                      ("UPDATE", "users"), ("INSERT INTO", "student_lifecycle_audit")}
    restore = _function(SQL, "fn_restore_student")
    assert "DELETE" not in restore


@pytest.mark.parametrize("name,marker", [
    ("fn_add_student_cohort_membership", "IF NOT EXISTS (SELECT 1 FROM cohorts"),
    ("fn_add_students_cohort_membership", "WITH wanted AS ("),
    ("fn_sync_legacy_student_cohort_membership", "INSERT INTO student_cohort_memberships ("),
])
def test_guarded_bodies_are_the_227_bodies_plus_the_guard(name, marker):
    """T002a: staging's live bodies equal 227; 326 adds only the guard."""
    guarded, original = _function(SQL, name), _function(SQL_227, name)
    assert _tail(guarded, marker) == _tail(original, marker)
    assert "student_archived" in guarded
    # Signature, return type, language, security and search_path are unchanged.
    assert _signature(guarded) == _signature(original)


def test_add_guards_lock_the_student_row_and_bulk_refuses_whole_batch():
    single = _function(SQL, "fn_add_student_cohort_membership")
    assert "FROM students WHERE id = p_student_id FOR NO KEY UPDATE" in single
    assert single.index("student_archived") < single.index("INSERT INTO student_cohort_memberships")
    bulk = _function(SQL, "fn_add_students_cohort_membership")
    assert "ORDER BY id FOR NO KEY UPDATE" in bulk
    assert bulk.index("RAISE EXCEPTION 'student_archived'") < bulk.index("WITH wanted AS (")


def test_227_grants_are_not_rewritten_and_postcondition_checks_them():
    for name in ("fn_add_student_cohort_membership", "fn_add_students_cohort_membership",
                 "fn_sync_legacy_student_cohort_membership"):
        assert not re.search(rf"(GRANT|REVOKE)[^;]*{name}", CODE), name
    assert "membership_functions_client_executable" in CODE
    assert "membership_functions_service_grant_missing" in CODE
    assert "students_client_update_privilege" in CODE


def test_rollback_note_is_guarded_and_restores_227_bodies_first():
    note = _rollback_sql("public")
    assert "rollback_unsafe_archived_students_exist" in note
    assert "rollback_unsafe_audit_rows_exist" in note
    assert note.index("227_student_cohort_memberships.sql") < note.index("DROP FUNCTION")


@pytest.mark.parametrize("name", FAN_OUT)
def test_class_fan_out_reads_only_active_memberships(name):
    """326 ends memberships rather than guarding the fan-out writers; that is
    enough only while their live bodies select active memberships (T002a)."""
    fn = _function(_latest_function(name), name)
    assert re.search(r"FROM\s+(?:public\.)?student_cohort_memberships\s+(?:AS\s+)?m\b", fn)
    assert "m.is_active" in fn


# ── PostgreSQL execution ────────────────────────────────────────────────────

def _rollback_sql(schema: str) -> str:
    """The commented ROLLBACK block of the migration header, uncommented."""
    header = SQL[SQL.index("-- ROLLBACK"):SQL.index("\nBEGIN;\n")]
    lines = [line[5:] for line in header.splitlines() if line.startswith("--   ")]
    return _schema_sql("\n".join(lines), schema)


def _schema_sql(sql: str, schema: str) -> str:
    return (sql.replace("public.", f"{schema}.")
               .replace("'public'", f"'{schema}'")
               .replace("search_path = public,", f"search_path = {schema},"))


def _migrated(schema: str) -> str:
    return _schema_sql(SQL, schema)


def _227_writers(schema: str) -> str:
    """227's trigger + membership functions + their grants, verbatim."""
    start = SQL_227.index("CREATE OR REPLACE FUNCTION fn_sync_legacy_student_cohort_membership()")
    end = SQL_227.index("-- Keep the idempotent Writing path atomic")
    grants = "\n".join(
        statement + ";" for statement in re.findall(r"(?:REVOKE|GRANT) EXECUTE ON FUNCTION[^;]*", SQL_227)
        if re.search(r"fn_(add|remove)_students?_cohort_membership|fn_sync_legacy", statement))
    return f"SET search_path = {schema}, pg_temp;\n" + _schema_sql(SQL_227[start:end] + grants, schema)


def _latest_function(name: str) -> str:
    """Text of the migration that last (re)defines ``name``."""
    defining = [path for path in sorted(MIGRATIONS.glob("*.sql"))
                if re.search(rf"CREATE OR REPLACE FUNCTION\s+(?:public\.)?{name}\s*\(",
                             _strip_comments(path.read_text(encoding="utf-8")))]
    assert defining, f"{name} not defined by any migration"
    return defining[-1].read_text(encoding="utf-8")


def _grants(sql: str, name: str) -> str:
    return "\n".join(statement + ";" for statement in re.findall(r"(?:REVOKE|GRANT) EXECUTE ON FUNCTION[^;]*", sql)
                     if re.search(rf"\b{name}\s*\(", statement))


def _fan_out_writers(schema: str) -> str:
    """The live class fan-out (269) and late-joiner backfill (227) bodies and
    their grants, verbatim from the migration that last defines each."""
    parts = []
    for name in FAN_OUT:
        sql = _latest_function(name)
        parts += [_function(sql, name), _grants(sql, name)]
    return f"SET search_path = {schema}, pg_temp;\n" + _schema_sql("\n".join(parts), schema)


def _users_guard(schema: str) -> str:
    start = SQL_320.index("CREATE OR REPLACE FUNCTION public.fn_guard_users_privileged_columns()")
    end = SQL_320.index("-- ── 5. user_d1_questions")
    return _schema_sql(SQL_320[start:end], schema)


def _env() -> dict:
    parsed = urlparse(DB)
    if parsed.scheme not in {"postgres", "postgresql"} or parsed.hostname not in {"localhost", "127.0.0.1", "::1"} or parsed.query:
        raise RuntimeError("Migration tests require a local disposable database URL without query overrides")
    environment = {key: value for key, value in os.environ.items() if not key.startswith("PG")}
    environment["PGCONNECT_TIMEOUT"] = "3"
    return environment


def _spawn(sql: str, tag: str | None = None) -> subprocess.Popen:
    environment = _env()
    if tag:
        environment["PGAPPNAME"] = tag
    return subprocess.Popen(["psql", DB, "-X", "-v", "ON_ERROR_STOP=1", "-tAq", "-c", sql],
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=environment)


def _claims(role: str, user_id: str | None = None) -> str:
    claims = {"role": role} if user_id is None else {"sub": user_id, "role": role}
    return json.dumps(claims)


def _as(role: str, sql: str, user_id: str | None = None) -> str:
    out = psql(f"SET ROLE {role}; SELECT set_config('request.jwt.claims', '{_claims(role, user_id)}', false);"
               f" {sql}")
    return out.splitlines()[-1] if out else ""


def _denied(role: str, sql: str, user_id: str | None = None) -> str:
    with pytest.raises(RuntimeError) as error:
        _as(role, sql, user_id)
    return str(error.value)


def _fails(sql: str) -> str:
    with pytest.raises(RuntimeError) as error:
        psql(sql)
    return str(error.value)


def _build(schema: str) -> None:
    psql(f"""
        CREATE SCHEMA {schema};
        GRANT USAGE ON SCHEMA {schema} TO anon, authenticated, service_role;
        -- Supabase schema defaults: every new table/function is client-writable
        -- and executable unless a migration revokes it.
        ALTER DEFAULT PRIVILEGES IN SCHEMA {schema}
            GRANT ALL ON TABLES TO anon, authenticated, service_role;
        ALTER DEFAULT PRIVILEGES IN SCHEMA {schema}
            GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
        SET search_path = {schema}, pg_temp;
        CREATE TABLE users (
            id uuid PRIMARY KEY, email text, role text NOT NULL DEFAULT 'user',
            is_active boolean NOT NULL DEFAULT false, display_name text, target_band numeric,
            exam_date date, self_level text, preferred_topics text[], onboarding_completed boolean,
            timezone text, weekly_goal integer, notification_email boolean, updated_at timestamptz);
        CREATE TABLE cohorts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text);
        CREATE TABLE students (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            student_code text UNIQUE NOT NULL, full_name text NOT NULL,
            cohort_id uuid REFERENCES cohorts(id) ON DELETE SET NULL,
            instructor_id uuid REFERENCES users(id) ON DELETE SET NULL,
            user_id uuid REFERENCES users(id) ON DELETE SET NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now());
        {_227_table()}
        -- Learner evidence that a hard delete used to cascade away.
        CREATE TABLE writing_assignments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE);
        CREATE TABLE writing_drafts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
            assignment_id uuid REFERENCES writing_assignments(id) ON DELETE CASCADE);
        CREATE TABLE writing_essays (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE);
        CREATE TABLE writing_feedback (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            essay_id uuid NOT NULL REFERENCES writing_essays(id) ON DELETE CASCADE);
        -- The 177/183/193 columns the fan-out writers read and write.
        CREATE TABLE class_assignments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            cohort_id uuid NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
            lesson_id uuid, skill text NOT NULL, content_id uuid,
            content_config jsonb NOT NULL DEFAULT '{{}}'::jsonb, title text NOT NULL,
            instructions text, due_at timestamptz, publish_at timestamptz,
            status text NOT NULL DEFAULT 'published', assigned_by uuid REFERENCES users(id),
            kind text NOT NULL DEFAULT 'daily', recipient_scope text NOT NULL DEFAULT 'class',
            created_at timestamptz NOT NULL DEFAULT now());
        -- assignment_id NULL only for the evidence item _learner seeds.
        CREATE TABLE class_assignment_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            assignment_id uuid REFERENCES class_assignments(id) ON DELETE CASCADE,
            student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
            UNIQUE (assignment_id, student_id));
    """)
    psql(_227_writers(schema))
    psql(_fan_out_writers(schema))
    psql(_users_guard(schema))
    # Migration 320: no client writes on users/students.
    psql(f"""REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA {schema}
             FROM anon, authenticated;""")


def _227_table() -> str:
    start = SQL_227.index("CREATE TABLE IF NOT EXISTS student_cohort_memberships")
    end = SQL_227.index("-- A learner can now be in two cohorts")
    # auth.users is Supabase-owned; the FK target is irrelevant to this probe.
    return SQL_227[start:end].replace(" REFERENCES auth.users(id) ON DELETE SET NULL", "")


@pytest.fixture(scope="module")
def db():
    try:
        available = shutil.which("psql") and psql("SELECT 1") == "1"
    except Exception:
        available = False
    if not available:
        if os.environ.get("REQUIRE_PG") == "1":
            pytest.fail("Local PostgreSQL required for migration 326 verification")
        pytest.skip("Local PostgreSQL unavailable")
    if psql("SELECT usesuper FROM pg_user WHERE usename=current_user") != "t":
        pytest.fail("Migration 326 fixture requires a superuser on its disposable LOCAL cluster")
    psql("""DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
    END $$;""")
    psql("ALTER ROLE service_role BYPASSRLS")
    schema = "student_archive_" + uuid4().hex
    try:
        _build(schema)
        # Before 326 the guards do not exist: an add reactivates a membership.
        assert "fn_archive_student" not in psql(
            f"SELECT string_agg(proname, ',') FROM pg_proc WHERE pronamespace = '{schema}'::regnamespace")
        psql(_migrated(schema))
        psql(_migrated(schema))  # re-applying is safe
        yield schema
    finally:
        psql(f"DROP SCHEMA IF EXISTS {schema} CASCADE")


def _learner(s: str, *, cohorts: int = 1, linked: bool = True, active: bool = True) -> dict:
    """A learner with a drafted assignment, a graded essay, one class item and
    ``cohorts`` active class memberships (the first is the primary pointer)."""
    user = str(uuid4()) if linked else None
    if linked:
        psql(f"INSERT INTO {s}.users (id, email, is_active) VALUES ('{user}', '{user}@e.test', {str(active).lower()})")
    cohort_ids = [str(uuid4()) for _ in range(cohorts)]
    for cid in cohort_ids:
        psql(f"INSERT INTO {s}.cohorts (id, name) VALUES ('{cid}', 'class {cid[:6]}')")
    student = psql(f"""INSERT INTO {s}.students (student_code, full_name, user_id, cohort_id)
                       VALUES ('S-{uuid4().hex[:10]}', 'Learner', {f"'{user}'" if user else 'NULL'},
                               {f"'{cohort_ids[0]}'" if cohort_ids else 'NULL'}) RETURNING id""")
    for cid in cohort_ids[1:]:
        psql(f"SET ROLE service_role; SELECT {s}.fn_add_student_cohort_membership('{student}', '{cid}', NULL)")
    psql(f"""WITH a AS (INSERT INTO {s}.writing_assignments (student_id) VALUES ('{student}') RETURNING id)
             INSERT INTO {s}.writing_drafts (student_id, assignment_id) SELECT '{student}', id FROM a;
             WITH e AS (INSERT INTO {s}.writing_essays (student_id) VALUES ('{student}') RETURNING id)
             INSERT INTO {s}.writing_feedback (essay_id) SELECT id FROM e;
             INSERT INTO {s}.class_assignment_items (student_id) VALUES ('{student}');""")
    return {"student": student, "user": user, "cohorts": cohort_ids}


def _evidence(s: str, student: str) -> str:
    return psql(f"""SELECT concat_ws(',',
        (SELECT count(*) FROM {s}.writing_assignments WHERE student_id = '{student}'),
        (SELECT count(*) FROM {s}.writing_drafts WHERE student_id = '{student}'),
        (SELECT count(*) FROM {s}.writing_essays WHERE student_id = '{student}'),
        (SELECT count(*) FROM {s}.writing_feedback f JOIN {s}.writing_essays e ON e.id = f.essay_id
          WHERE e.student_id = '{student}'),
        (SELECT count(*) FROM {s}.class_assignment_items WHERE student_id = '{student}'),
        (SELECT count(*) FROM {s}.student_cohort_memberships WHERE student_id = '{student}'))""")


def _active(s: str, student: str) -> list[str]:
    out = psql(f"""SELECT string_agg(cohort_id::text, ',' ORDER BY cohort_id)
                   FROM {s}.student_cohort_memberships WHERE student_id = '{student}' AND is_active""")
    return out.split(",") if out else []


def _audit(s: str, student: str, action: str | None = None) -> int:
    where = f" AND action = '{action}'" if action else ""
    return int(psql(f"SELECT count(*) FROM {s}.student_lifecycle_audit WHERE student_id = '{student}'{where}"))


def _archive(s: str, student: str, actor: str, *, deactivate: bool = False, reason: str = "left") -> dict:
    out = _as("service_role", f"SELECT {s}.fn_archive_student('{student}', '{actor}', '{reason}', {str(deactivate).lower()})")
    return json.loads(out) if out else None


def _restore(s: str, student: str, actor: str, *, reactivate: bool = False) -> dict:
    out = _as("service_role", f"SELECT {s}.fn_restore_student('{student}', '{actor}', 'back', true, {str(reactivate).lower()})")
    return json.loads(out) if out else None


def _admin(s: str) -> str:
    admin = str(uuid4())
    psql(f"INSERT INTO {s}.users (id, email, role, is_active) VALUES ('{admin}', '{admin}@a.test', 'admin', true)")
    return admin


def test_schema_after_apply(db):
    s = db
    assert psql(f"""SELECT string_agg(column_name || ':' || data_type, ',' ORDER BY column_name)
                    FROM information_schema.columns WHERE table_schema = '{s}' AND table_name = 'students'
                     AND column_name IN ('archived_at', 'archived_by', 'archive_reason')""") == (
        "archive_reason:text,archived_at:timestamp with time zone,archived_by:uuid")
    assert psql(f"SELECT count(*) FROM pg_constraint WHERE conname = 'chk_students_archive_fields' "
                f"AND conrelid = '{s}.students'::regclass") == "1"
    assert psql(f"SELECT to_regclass('{s}.idx_students_archived_at') IS NOT NULL") == "t"
    assert psql(f"SELECT relrowsecurity FROM pg_class WHERE oid = '{s}.student_lifecycle_audit'::regclass") == "t"
    for role in ("anon", "authenticated"):
        for fn in ("fn_archive_student(uuid,uuid,text,boolean)",
                   "fn_restore_student(uuid,uuid,text,boolean,boolean)",
                   "fn_add_student_cohort_membership(uuid,uuid,uuid)",
                   "fn_add_students_cohort_membership(uuid[],uuid,uuid)"):
            assert psql(f"SELECT has_function_privilege('{role}', '{s}.{fn}', 'EXECUTE')") == "f", (role, fn)
        for privilege in ("SELECT", "INSERT", "UPDATE", "DELETE"):
            assert psql(f"SELECT has_table_privilege('{role}', '{s}.student_lifecycle_audit', '{privilege}')") == "f"
    assert psql(f"SELECT has_table_privilege('service_role', '{s}.student_lifecycle_audit', 'INSERT')") == "t"
    for privilege in ("UPDATE", "DELETE", "TRUNCATE"):
        assert psql(f"SELECT has_table_privilege('service_role', '{s}.student_lifecycle_audit', '{privilege}')") == "f"
    assert psql(f"SELECT has_function_privilege('service_role', '{s}.fn_archive_student(uuid,uuid,text,boolean)', 'EXECUTE')") == "t"


def test_archive_keeps_work_ends_memberships_and_audits_once(db):
    s, admin = db, _admin(db)
    learner = _learner(s, cohorts=2)
    other = _learner(s)
    before, other_before = _evidence(s, learner["student"]), _evidence(s, other["student"])
    assert len(_active(s, learner["student"])) == 2

    result = _archive(s, learner["student"], admin)
    assert result["status"] == "archived"
    assert sorted(result["ended_cohort_ids"]) == sorted(learner["cohorts"])
    assert result["account_deactivated"] is False
    # Every row count unchanged; only the memberships went inactive.
    assert _evidence(s, learner["student"]) == before
    assert _active(s, learner["student"]) == []
    row = psql(f"""SELECT archived_at IS NOT NULL, archived_by, archive_reason, cohort_id IS NULL
                   FROM {s}.students WHERE id = '{learner['student']}'""")
    assert row == f"t|{admin}|left|t"
    assert psql(f"SELECT is_active FROM {s}.users WHERE id = '{learner['user']}'") == "t"
    assert _audit(s, learner["student"], "archive") == 1
    detail = json.loads(psql(f"SELECT detail FROM {s}.student_lifecycle_audit WHERE student_id = '{learner['student']}'"))
    assert detail["previous_cohort_id"] == learner["cohorts"][0]
    assert sorted(detail["ended_cohort_ids"]) == sorted(learner["cohorts"])
    # Another learner is untouched (AC-12).
    assert _evidence(s, other["student"]) == other_before and len(_active(s, other["student"])) == 1

    # Idempotent: a repeat writes no second audit row.
    again = _archive(s, learner["student"], admin)
    assert again["status"] == "already_archived"
    assert _audit(s, learner["student"]) == 1
    # Unknown id → NULL (the route answers 404).
    assert _as("service_role", f"SELECT {s}.fn_archive_student('{uuid4()}', '{admin}', NULL, false) IS NULL") == "t"
    assert "archive_actor_required" in _denied(
        "service_role", f"SELECT {s}.fn_archive_student('{other['student']}', NULL, NULL, false)")


def test_restore_returns_previous_classes_and_skips_deleted_class(db):
    s, admin = db, _admin(db)
    learner = _learner(s, cohorts=3)
    before = _evidence(s, learner["student"])
    _archive(s, learner["student"], admin)
    deleted = learner["cohorts"][2]
    psql(f"DELETE FROM {s}.cohorts WHERE id = '{deleted}'")

    result = _restore(s, learner["student"], admin)
    assert result["status"] == "restored"
    assert sorted(result["restored_cohort_ids"]) == sorted(learner["cohorts"][:2])
    assert _active(s, learner["student"]) == sorted(learner["cohorts"][:2])
    assert psql(f"""SELECT archived_at IS NULL AND archived_by IS NULL AND archive_reason IS NULL,
                           cohort_id FROM {s}.students WHERE id = '{learner['student']}'""") == (
        f"t|{learner['cohorts'][0]}")
    assert _audit(s, learner["student"], "restore") == 1
    # Work intact (one membership row cascaded away with its deleted class).
    counts = before.split(",")
    counts[-1] = str(int(counts[-1]) - 1)
    assert _evidence(s, learner["student"]) == ",".join(counts)
    # Restoring a non-archived learner: not_archived, no audit row.
    assert _restore(s, learner["student"], admin) == {"status": "not_archived"}
    assert _audit(s, learner["student"], "restore") == 1
    assert _as("service_role", f"SELECT {s}.fn_restore_student('{uuid4()}', '{admin}') IS NULL") == "t"


def _leave(s: str, student: str, cohort: str) -> None:
    assert _as("service_role", f"SELECT {s}.fn_remove_student_cohort_membership('{student}', '{cohort}')") == "t"


def _membership(s: str, student: str, cohort: str) -> str:
    return psql(f"""SELECT is_active, left_at FROM {s}.student_cohort_memberships
                    WHERE student_id = '{student}' AND cohort_id = '{cohort}'""")


def _primary(s: str, student: str) -> str:
    return psql(f"SELECT cohort_id FROM {s}.students WHERE id = '{student}'")


def test_restore_keeps_a_class_left_before_the_archive_inactive(db):
    s, admin = db, _admin(db)
    learner = _learner(s, cohorts=3)
    sid, (left, *kept) = learner["student"], learner["cohorts"]
    _leave(s, sid, left)                       # the primary class: the pointer moves on
    left_row, primary = _membership(s, sid, left), _primary(s, sid)
    assert left_row.startswith("f|") and primary in kept

    assert sorted(_archive(s, sid, admin)["ended_cohort_ids"]) == sorted(kept)
    result = _restore(s, sid, admin)
    assert sorted(result["restored_cohort_ids"]) == sorted(kept)
    assert _active(s, sid) == sorted(kept)
    # The class left before the archive stays left, with its original left_at,
    # and does not become the primary class again.
    assert _membership(s, sid, left) == left_row
    assert _primary(s, sid) == primary


def test_archive_restore_twice_restores_the_latest_archive_only(db):
    s, admin = db, _admin(db)
    learner = _learner(s, cohorts=2)
    sid, (first, second) = learner["student"], learner["cohorts"]
    before = _evidence(s, sid)

    assert sorted(_archive(s, sid, admin)["ended_cohort_ids"]) == sorted([first, second])
    assert sorted(_restore(s, sid, admin)["restored_cohort_ids"]) == sorted([first, second])
    _leave(s, sid, second)                     # between the two cycles
    left_row = _membership(s, sid, second)
    assert _archive(s, sid, admin)["ended_cohort_ids"] == [first]
    # The second restore reads the second archive's classes, not the first's.
    assert _restore(s, sid, admin)["restored_cohort_ids"] == [first]
    assert _active(s, sid) == [first] and _primary(s, sid) == first
    assert _membership(s, sid, second) == left_row
    assert _audit(s, sid, "archive") == 2 and _audit(s, sid, "restore") == 2
    assert psql(f"""SELECT archived_at IS NULL AND archived_by IS NULL AND archive_reason IS NULL
                    FROM {s}.students WHERE id = '{sid}'""") == "t"
    assert _evidence(s, sid) == before


def test_deactivate_account_through_service_role_and_reactivate_on_restore(db):
    s, admin = db, _admin(db)
    learner = _learner(s, active=True)
    result = _archive(s, learner["student"], admin, deactivate=True)
    assert result["account_deactivated"] is True
    assert psql(f"SELECT is_active FROM {s}.users WHERE id = '{learner['user']}'") == "f"
    assert _restore(s, learner["student"], admin)["account_reactivated"] is False
    assert psql(f"SELECT is_active FROM {s}.users WHERE id = '{learner['user']}'") == "f"
    _archive(s, learner["student"], admin, deactivate=False)
    assert _restore(s, learner["student"], admin, reactivate=True)["account_reactivated"] is True
    assert psql(f"SELECT is_active FROM {s}.users WHERE id = '{learner['user']}'") == "t"
    unlinked = _learner(s, linked=False)
    assert _archive(s, unlinked["student"], admin, deactivate=True)["account_deactivated"] is False


def test_clients_cannot_archive_restore_or_rewrite_the_state(db):
    s, admin = db, _admin(db)
    learner = _learner(s)
    me = learner["user"]
    for role in ("authenticated", "anon"):
        for call in (f"SELECT {s}.fn_archive_student('{learner['student']}', '{me}', NULL, false)",
                     f"SELECT {s}.fn_restore_student('{learner['student']}', '{me}')",
                     f"SELECT {s}.fn_add_student_cohort_membership('{learner['student']}', '{learner['cohorts'][0]}', NULL)"):
            assert "permission denied for function" in _denied(role, call, me)
    _archive(s, learner["student"], admin, deactivate=True)
    # 320: no client UPDATE on users/students; the audit is not readable.
    assert "permission denied" in _denied(
        "authenticated", f"UPDATE {s}.users SET is_active = true WHERE id = '{me}'", me)
    assert "permission denied" in _denied(
        "authenticated", f"UPDATE {s}.students SET archived_at = NULL WHERE id = '{learner['student']}'", me)
    assert "permission denied" in _denied(
        "authenticated", f"SELECT count(*) FROM {s}.student_lifecycle_audit", me)
    # Even with a hand-granted column UPDATE, the 320 trigger keeps is_active server-owned.
    psql(f"GRANT UPDATE (is_active) ON {s}.users TO authenticated")
    try:
        assert "users_privileged_column_change_forbidden" in _denied(
            "authenticated", f"UPDATE {s}.users SET is_active = true WHERE id = '{me}'", me)
    finally:
        psql(f"REVOKE UPDATE (is_active) ON {s}.users FROM authenticated")
    assert psql(f"SELECT is_active FROM {s}.users WHERE id = '{me}'") == "f"
    # The audit is append-only even for the service role.
    assert "permission denied" in _denied(
        "service_role", f"DELETE FROM {s}.student_lifecycle_audit WHERE student_id = '{learner['student']}'")
    assert "permission denied" in _denied(
        "service_role", f"UPDATE {s}.student_lifecycle_audit SET reason = 'x'")


def test_archived_learner_cannot_rejoin_any_class(db):
    s, admin = db, _admin(db)
    learner, other = _learner(s, cohorts=2), _learner(s)
    sid, old = learner["student"], learner["cohorts"][0]
    _archive(s, sid, admin)
    memberships = psql(f"SELECT string_agg(is_active::text || left_at::text, ',' ORDER BY cohort_id) "
                       f"FROM {s}.student_cohort_memberships WHERE student_id = '{sid}'")

    assert "student_archived" in _denied(
        "service_role", f"SELECT {s}.fn_add_student_cohort_membership('{sid}', '{old}', '{admin}')")
    # Bulk: the whole batch is refused — the other learner is not added either.
    assert "student_archived" in _denied(
        "service_role",
        f"SELECT {s}.fn_add_students_cohort_membership(ARRAY['{other['student']}', '{sid}']::uuid[], '{old}', NULL)")
    assert old not in _active(s, other["student"])
    # Legacy pointer write (activation fold / rolling backend).
    assert "student_archived" in _fails(f"UPDATE {s}.students SET cohort_id = '{old}' WHERE id = '{sid}'")
    assert psql(f"SELECT string_agg(is_active::text || left_at::text, ',' ORDER BY cohort_id) "
                f"FROM {s}.student_cohort_memberships WHERE student_id = '{sid}'") == memberships
    assert _active(s, sid) == []
    # A NULL pointer write is the archive's own path: a no-op for the trigger.
    psql(f"UPDATE {s}.students SET cohort_id = NULL WHERE id = '{sid}'")
    assert _active(s, sid) == []
    # Unknown learner keeps the 227 error.
    assert "student_not_found" in _denied(
        "service_role", f"SELECT {s}.fn_add_student_cohort_membership('{uuid4()}', '{old}', NULL)")
    # After restore the guarded writers work again.
    _restore(s, sid, admin)
    new = str(uuid4())
    psql(f"INSERT INTO {s}.cohorts (id) VALUES ('{new}')")
    assert _as("service_role", f"SELECT {s}.fn_add_student_cohort_membership('{sid}', '{new}', NULL)") == "t"
    assert _as("service_role",
               f"SELECT {s}.fn_add_students_cohort_membership(ARRAY['{other['student']}', '{sid}']::uuid[], '{old}', NULL)") == "1"
    assert set(_active(s, sid)) == {*learner["cohorts"], new}


def _race(first: str, second: str, delay: float = 0.4) -> tuple[tuple, tuple]:
    """Run two sessions overlapping; → ((returncode, stdout, stderr), ...)."""
    a = _spawn(first)
    time.sleep(delay)
    b = _spawn(second)
    out_a = a.communicate(timeout=30)
    out_b = b.communicate(timeout=30)
    return (a.returncode, *out_a), (b.returncode, *out_b)


def _svc(sql: str) -> str:
    return f"SET ROLE service_role; SELECT set_config('request.jwt.claims', '{_claims('service_role')}', false); {sql}"


@pytest.mark.parametrize("writer", ["single", "bulk", "trigger"])
def test_archive_first_then_concurrent_add_is_refused(db, writer):
    s, admin = db, _admin(db)
    learner = _learner(s)
    sid, cid = learner["student"], learner["cohorts"][0]
    add = {
        "single": f"SELECT {s}.fn_add_student_cohort_membership('{sid}', '{cid}', NULL)",
        "bulk": f"SELECT {s}.fn_add_students_cohort_membership(ARRAY['{sid}']::uuid[], '{cid}', NULL)",
        "trigger": f"UPDATE {s}.students SET cohort_id = '{cid}' WHERE id = '{sid}'",
    }[writer]
    archive, adder = _race(
        _svc(f"BEGIN; SELECT {s}.fn_archive_student('{sid}', '{admin}', NULL, false); SELECT pg_sleep(1.5); COMMIT;"),
        _svc(add))
    assert archive[0] == 0, archive[2]
    assert adder[0] != 0 and "student_archived" in adder[2], adder
    assert _active(s, sid) == []


@pytest.mark.parametrize("writer", ["single", "bulk", "trigger"])
def test_add_first_then_concurrent_archive_ends_the_membership(db, writer):
    s, admin = db, _admin(db)
    learner = _learner(s)
    sid = learner["student"]
    psql(f"UPDATE {s}.students SET cohort_id = NULL WHERE id = '{sid}'")
    cid = str(uuid4())
    psql(f"INSERT INTO {s}.cohorts (id) VALUES ('{cid}')")
    add = {
        "single": f"SELECT {s}.fn_add_student_cohort_membership('{sid}', '{cid}', NULL);",
        "bulk": f"SELECT {s}.fn_add_students_cohort_membership(ARRAY['{sid}']::uuid[], '{cid}', NULL);",
        "trigger": f"UPDATE {s}.students SET cohort_id = '{cid}' WHERE id = '{sid}';",
    }[writer]
    adder, archive = _race(
        _svc(f"BEGIN; {add} SELECT pg_sleep(1.5); COMMIT;"),
        _svc(f"SELECT {s}.fn_archive_student('{sid}', '{admin}', NULL, false)"))
    assert adder[0] == 0, adder[2]
    assert archive[0] == 0, archive[2]
    assert cid in json.loads(archive[1].strip().splitlines()[-1])["ended_cohort_ids"]
    assert _active(s, sid) == []
    assert psql(f"SELECT archived_at IS NOT NULL AND cohort_id IS NULL FROM {s}.students WHERE id = '{sid}'") == "t"


def _give_class(s: str, cohort: str, students: list[str] | None = None) -> str:
    """fn_create_class_assignment as the backend calls it → SQL for 'id|student_count'."""
    subset = "NULL" if students is None else "ARRAY[" + ", ".join(f"'{x}'" for x in students) + "]::uuid[]"
    return (f"SELECT assignment ->> 'id', student_count FROM {s}.fn_create_class_assignment("
            f"'{cohort}', 'writing', 'Class work', p_student_ids => {subset});")


def _given(out: str) -> tuple[str, int]:
    assignment, count = next(line for line in out.splitlines() if "|" in line).split("|")
    return assignment, int(count)


def _backfill(s: str, assignment: str, students: list[str] | None = None) -> tuple[int, int]:
    subset = "NULL" if students is None else "ARRAY[" + ", ".join(f"'{x}'" for x in students) + "]::uuid[]"
    out = _as("service_role", f"SELECT added, student_count FROM {s}.fn_backfill_assignment_items('{assignment}', {subset})")
    added, total = out.split("|")
    return int(added), int(total)


def _items(s: str, assignment: str, student: str) -> int:
    return int(psql(f"""SELECT count(*) FROM {s}.class_assignment_items
                        WHERE assignment_id = '{assignment}' AND student_id = '{student}'"""))


def _class_items(s: str, student: str) -> int:
    return int(psql(f"""SELECT count(*) FROM {s}.class_assignment_items
                        WHERE assignment_id IS NOT NULL AND student_id = '{student}'"""))


def _classmates(s: str) -> tuple[dict, dict, str]:
    """Learner A (primary class) and classmate B added through the 227 writer."""
    a = _learner(s)
    cohort = a["cohorts"][0]
    b = _learner(s, cohorts=0)
    assert _as("service_role", f"SELECT {s}.fn_add_student_cohort_membership('{b['student']}', '{cohort}', NULL)") == "t"
    return a, b, cohort


def test_class_fan_out_skips_an_archived_classmate(db):
    s, admin = db, _admin(db)
    a, b, cohort = _classmates(s)
    # Control: before the archive the real fan-out reaches both learners.
    earlier, count = _given(_as("service_role", _give_class(s, cohort)))
    assert count == 2 and _items(s, earlier, a["student"]) == 1 and _items(s, earlier, b["student"]) == 1

    _archive(s, a["student"], admin)
    assignment, count = _given(_as("service_role", _give_class(s, cohort)))
    assert count == 1
    assert _items(s, assignment, a["student"]) == 0 and _items(s, assignment, b["student"]) == 1
    # Naming the archived learner in a subset give does not reach them either.
    subset, count = _given(_as("service_role", _give_class(s, cohort, [a["student"], b["student"]])))
    assert count == 1 and _items(s, subset, a["student"]) == 0
    given = psql(f"SELECT count(*) FROM {s}.class_assignments WHERE cohort_id = '{cohort}'")
    assert "empty_roster" in _denied("service_role", _give_class(s, cohort, [a["student"]]))
    assert psql(f"SELECT count(*) FROM {s}.class_assignments WHERE cohort_id = '{cohort}'") == given
    # The item given before the archive is kept (FR-005).
    assert _items(s, earlier, a["student"]) == 1 and _class_items(s, a["student"]) == 1


HOLD = 2.5               # seconds the first session keeps its locks before COMMIT
SESSION_TIMEOUT = 120    # generous: a slow host must not turn a correct wait into a failure


def _held_race(first: str, second: str) -> tuple[tuple, tuple]:
    """Session A runs ``first`` (ending in a lock-holding sleep); once A is
    observed sleeping, session B runs ``second``. → ((rc, stdout, stderr),
    (rc, stdout, stderr, seconds B took))."""
    tag = "student_archive_" + uuid4().hex[:12]
    a = _spawn(first, tag)
    try:
        deadline = time.monotonic() + 60
        while psql(f"SELECT count(*) FROM pg_stat_activity WHERE application_name = '{tag}' "
                   f"AND wait_event = 'PgSleep'") != "1":
            if a.poll() is not None:
                raise AssertionError(f"first session ended early: {a.communicate()}")
            if time.monotonic() > deadline:
                raise AssertionError("first session never reached its lock-holding sleep")
            time.sleep(0.05)
        started = time.monotonic()
        b = _spawn(second)
        out_b = b.communicate(timeout=SESSION_TIMEOUT)
        elapsed = time.monotonic() - started
        out_a = a.communicate(timeout=SESSION_TIMEOUT)
    finally:
        if a.poll() is None:
            a.kill()
    return (a.returncode, *out_a), (b.returncode, *out_b, elapsed)


def _held(sql: str) -> str:
    return _svc(f"BEGIN; {sql} SELECT pg_sleep({HOLD}); COMMIT;")


def test_archive_holding_its_lock_then_class_give_skips_the_learner(db):
    s, admin = db, _admin(db)
    a, b, cohort = _classmates(s)
    archive, give = _held_race(
        _held(f"SELECT {s}.fn_archive_student('{a['student']}', '{admin}', NULL, false);"),
        _svc(_give_class(s, cohort)))
    assert archive[0] == 0, archive[2]
    assert give[0] == 0, give[2]
    assert give[3] >= 1.0, f"the fan-out did not wait on the archive's locks ({give[3]:.2f}s)"
    assignment, count = _given(give[1])
    assert count == 1
    assert _items(s, assignment, a["student"]) == 0 and _items(s, assignment, b["student"]) == 1
    assert _class_items(s, a["student"]) == 0
    assert _active(s, a["student"]) == []


def test_class_give_holding_its_lock_then_archive_keeps_the_item_and_ends_the_class(db):
    s, admin = db, _admin(db)
    a, b, cohort = _classmates(s)
    give, archive = _held_race(
        _held(_give_class(s, cohort)),
        _svc(f"SELECT {s}.fn_archive_student('{a['student']}', '{admin}', NULL, false)"))
    assert give[0] == 0, give[2]
    assert archive[0] == 0, archive[2]
    assert archive[3] >= 1.0, f"the archive did not wait on the fan-out's locks ({archive[3]:.2f}s)"
    assignment, count = _given(give[1])
    # Given before the archive: kept as history (FR-005); the class is ended,
    # so the next give and any backfill skip the learner.
    assert count == 2 and _items(s, assignment, a["student"]) == 1
    assert cohort in json.loads(archive[1].strip().splitlines()[-1])["ended_cohort_ids"]
    assert _backfill(s, assignment) == (0, 2)
    later, count = _given(_as("service_role", _give_class(s, cohort)))
    assert count == 1 and _items(s, later, a["student"]) == 0
    assert _class_items(s, a["student"]) == 1


def test_backfill_after_archive_skips_the_learner_until_restore(db):
    s, admin = db, _admin(db)
    b = _learner(s)
    cohort = b["cohorts"][0]
    assignment, count = _given(_as("service_role", _give_class(s, cohort)))
    assert count == 1
    a, c = _learner(s, cohorts=0), _learner(s, cohorts=0)     # late joiners
    for late in (a, c):
        assert _as("service_role",
                   f"SELECT {s}.fn_add_student_cohort_membership('{late['student']}', '{cohort}', NULL)") == "t"
    _archive(s, a["student"], admin)

    assert _backfill(s, assignment) == (1, 2)                # C only
    assert _items(s, assignment, a["student"]) == 0 and _items(s, assignment, c["student"]) == 1
    assert _backfill(s, assignment, [a["student"]]) == (0, 2)
    assert _class_items(s, a["student"]) == 0
    # Restore re-activates the class; only then does the backfill reach A.
    assert _restore(s, a["student"], admin)["restored_cohort_ids"] == [cohort]
    assert _backfill(s, assignment) == (1, 3)
    assert _items(s, assignment, a["student"]) == 1


def test_rerun_aborts_on_conflicting_column_or_missing_320_guard(db):
    s = db
    psql(f"ALTER TABLE {s}.users DISABLE TRIGGER trg_users_guard_privileged_columns")
    try:
        assert "migration_320_guard_missing" in _fails(_migrated(s))
    finally:
        psql(f"ALTER TABLE {s}.users ENABLE TRIGGER trg_users_guard_privileged_columns")
    other = "student_archive_conflict_" + uuid4().hex
    try:
        _build(other)
        psql(f"ALTER TABLE {other}.students ADD COLUMN archived_at text")
        assert "students_archive_columns_conflict" in _fails(_migrated(other))
    finally:
        psql(f"DROP SCHEMA IF EXISTS {other} CASCADE")


POSTCONDITIONS = "-- 5. Postconditions"


def _drifted(schema: str, drift: str) -> str:
    """The real migration with ``drift`` run just before its postconditions — a
    stand-in for a body or an environment that breaks the invariant."""
    sql = _migrated(schema)
    assert sql.count(POSTCONDITIONS) == 1
    return sql.replace(POSTCONDITIONS, drift + "\n" + POSTCONDITIONS)


@pytest.fixture(scope="module")
def bare(db):
    """The harness schema without 326 (``db`` provides the roles)."""
    schema = "student_archive_bare_" + uuid4().hex
    try:
        _build(schema)
        yield schema
    finally:
        psql(f"DROP SCHEMA IF EXISTS {schema} CASCADE")


@pytest.mark.parametrize("drift,marker", [
    ("GRANT UPDATE ON {s}.students TO authenticated;", "students_client_update_privilege"),
    ("GRANT EXECUTE ON FUNCTION {s}.fn_archive_student(uuid,uuid,text,boolean) TO authenticated;",
     "student_archive_functions_client_executable"),
    ("GRANT EXECUTE ON FUNCTION {s}.fn_archive_student(uuid,uuid,text,boolean) TO anon;",
     "student_archive_functions_client_executable"),
])
def test_each_security_postcondition_aborts_the_whole_migration(bare, drift, marker):
    s = bare
    assert marker in _fails(_drifted(s, drift.format(s=s)))
    # Nothing of 326 survives the abort, the drift included.
    assert psql(f"SELECT count(*) FROM information_schema.columns WHERE table_schema = '{s}' "
                f"AND table_name = 'students' AND column_name LIKE 'archive%'") == "0"
    assert psql(f"SELECT to_regprocedure('{s}.fn_archive_student(uuid,uuid,text,boolean)') IS NULL") == "t"
    assert psql(f"SELECT has_table_privilege('authenticated', '{s}.students', 'UPDATE')") == "f"


def test_rerun_aborts_when_clients_can_update_students(db):
    s = db
    psql(f"GRANT UPDATE ON {s}.students TO authenticated")
    try:
        assert "students_client_update_privilege" in _fails(_migrated(s))
    finally:
        psql(f"REVOKE UPDATE ON {s}.students FROM authenticated")
    psql(_migrated(s))


def test_rollback_guard_aborts_with_archived_learners_or_audit_rows(db):
    s, admin = db, _admin(db)
    learner = _learner(s)
    _archive(s, learner["student"], admin)
    assert "rollback_unsafe_archived_students_exist" in _fails(_rollback_sql(s))
    psql(f"SET ROLE service_role; SELECT {s}.fn_restore_student(id, '{admin}') "
         f"FROM {s}.students WHERE archived_at IS NOT NULL")
    assert "rollback_unsafe_audit_rows_exist" in _fails(_rollback_sql(s))
    assert psql(f"SELECT count(*) FROM {s}.students WHERE archived_at IS NOT NULL") == "0"


def test_rollback_restores_unguarded_227_writers_before_dropping_columns():
    if not (shutil.which("psql") and DB):
        if os.environ.get("REQUIRE_PG") == "1":
            pytest.fail("Local PostgreSQL required for migration 326 verification")
        pytest.skip("Local PostgreSQL unavailable")
    schema = "student_archive_rollback_" + uuid4().hex
    try:
        _build(schema)
        psql(_migrated(schema))
        learner = _learner(schema)
        # The rollback must re-create the 227 bodies first (they are in the
        # header's instructions, verbatim from 227).
        rollback = _rollback_sql(schema)
        guard_end = rollback.index("END $$;") + len("END $$;")
        psql(rollback[:guard_end] + "\n" + _227_writers(schema) + rollback[guard_end:])
        assert psql(f"SELECT count(*) FROM information_schema.columns WHERE table_schema = '{schema}' "
                    f"AND table_name = 'students' AND column_name LIKE 'archive%'") == "0"
        assert psql(f"SELECT to_regclass('{schema}.student_lifecycle_audit') IS NULL") == "t"
        cid = str(uuid4())
        psql(f"INSERT INTO {schema}.cohorts (id) VALUES ('{cid}')")
        assert _as("service_role",
                   f"SELECT {schema}.fn_add_student_cohort_membership('{learner['student']}', '{cid}', NULL)") == "t"
        psql(f"UPDATE {schema}.students SET cohort_id = '{cid}' WHERE id = '{learner['student']}'")
        assert psql(f"SELECT has_function_privilege('authenticated', "
                    f"'{schema}.fn_add_student_cohort_membership(uuid,uuid,uuid)', 'EXECUTE')") == "f"
    finally:
        psql(f"DROP SCHEMA IF EXISTS {schema} CASCADE")
