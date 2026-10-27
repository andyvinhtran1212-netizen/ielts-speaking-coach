"""Migration 331 (GIVEARCHIVE-0031): no Writing give for an archived learner.

STUDENTARCHIVE-0029 refused gives to archived learners only with a Python
pre-check that runs before the insert, so an archive committing in between
still created a writing_assignments row. 331 moves the refusal into a
`BEFORE INSERT OR UPDATE OF student_id` trigger that locks the learner row
FOR KEY SHARE (conflicting with the FOR UPDATE of the 326 lifecycle functions).

The static half always runs. The PostgreSQL half builds the 326 harness
(test_migration_326_student_archive: Supabase default privileges, the 227
roster writers, the 320 users guard, migration 326) plus the 228 idempotent
RPC, its request ledger and a stand-in for the 249 origin trigger, then applies
331 twice. It proves the refusal for every writer, the whole-statement
rollback, the serialization against a concurrent archive in both orders, and —
on a schema built WITHOUT 331 (negative control) — that the same race really
creates the row, so the concurrency tests can detect it.

Set TEST_PG_URL to a LOCAL disposable cluster and REQUIRE_PG=1 to forbid skips.
"""

from __future__ import annotations

import json
import os
import random
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
REPO = BACKEND.parent
MIGRATIONS = BACKEND / "migrations"
NAME = "331_writing_assignment_archived_student_guard.sql"
SQL = (MIGRATIONS / NAME).read_text(encoding="utf-8")
SQL_228 = (MIGRATIONS / "228_writing_idempotency_optional_cohort.sql").read_text(encoding="utf-8")
CODE = m326._strip_comments(SQL)
TRIGGER = "archive_guard_writing_assignment_student"
FUNCTION = "fn_guard_writing_assignment_student_archived"


# ── Static contract ─────────────────────────────────────────────────────────

def test_one_transaction_with_lock_timeout_and_no_data_change():
    assert CODE.strip().startswith("BEGIN;") and CODE.strip().endswith("COMMIT;")
    assert "SET LOCAL lock_timeout = '5s';" in CODE
    for forbidden in (r"\bDROP\b", r"DELETE\s+FROM", r"^\s*TRUNCATE", r"^\s*UPDATE\s",
                      r"INSERT\s+INTO", r"ALTER\s+TABLE", r"DISABLE\s+TRIGGER"):
        assert not re.search(forbidden, CODE, re.M | re.I), forbidden


def test_trigger_is_row_level_before_insert_or_student_id_update():
    assert re.search(
        rf"CREATE OR REPLACE TRIGGER {TRIGGER}\s+BEFORE INSERT OR UPDATE OF student_id "
        rf"ON public\.writing_assignments\s+FOR EACH ROW EXECUTE FUNCTION public\.{FUNCTION}\(\);",
        CODE)


def test_guard_locks_for_key_share_and_raises_student_archived_with_detail():
    fn = m326._function(SQL, FUNCTION)
    assert "LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp" in fn
    assert re.search(r"FROM public\.students WHERE id = NEW\.student_id\s+FOR KEY SHARE;", fn)
    assert "RAISE EXCEPTION 'student_archived'" in fn
    assert "USING DETAIL = NEW.student_id::text" in fn
    # An UPDATE that keeps student_id never takes the lock or refuses.
    assert fn.index("NEW.student_id IS NOT DISTINCT FROM OLD.student_id") < fn.index("FOR KEY SHARE")
    # Refuse (RAISE) — never skip the row silently with RETURN NULL (decision 2).
    assert "RETURN NULL" not in fn
    assert f"REVOKE ALL ON FUNCTION public.{FUNCTION}()\n    FROM PUBLIC, anon, authenticated;" in CODE


def test_preconditions_require_326_and_for_update_lifecycle_functions():
    pre = CODE[:CODE.index(f"CREATE OR REPLACE FUNCTION public.{FUNCTION}")]
    assert "migration_326_missing" in pre
    assert "fn_archive_student(uuid,uuid,text,boolean)" in pre
    assert "fn_restore_student(uuid,uuid,text,boolean,boolean)" in pre
    assert "students WHERE id = p_student_id FOR UPDATE" in pre
    # And 326 really has that text in both functions today.
    sql_326 = (MIGRATIONS / "326_student_archive.sql").read_text(encoding="utf-8")
    for name in ("fn_archive_student", "fn_restore_student"):
        assert "students WHERE id = p_student_id FOR UPDATE" in m326._function(sql_326, name)


def test_postconditions_check_trigger_definer_and_client_privileges():
    post = CODE[CODE.rindex("DO $$"):]
    for marker in ("archive_guard_trigger_missing", "archive_guard_not_pinned_security_definer",
                   "archive_guard_client_executable", "students_client_update_privilege"):
        assert marker in post


def test_trigger_name_sorts_before_the_other_before_insert_triggers():
    """BEFORE ROW triggers fire in name order: refuse before any side effect."""
    assert TRIGGER < "core_capture_writing_origin" < "trg_guard_writing_give_cohort_active"


def test_no_other_migration_drops_replaces_or_bypasses_the_guard():
    """A-10 / migration 330 (not yet written) and every later file must keep
    the 331 guard: no drop/replace of the trigger or function, no insert into
    writing_assignments with triggers disabled."""
    for path in sorted(MIGRATIONS.glob("*.sql")):
        if path.name == NAME:
            continue
        code = m326._strip_comments(path.read_text(encoding="utf-8"))
        assert TRIGGER not in code and FUNCTION not in code, path.name
        assert not re.search(r"session_replication_role", code, re.I), path.name
        assert not re.search(r"ALTER\s+TABLE\s+(?:ONLY\s+)?(?:public\.)?writing_assignments\b[^;]*"
                             r"DISABLE\s+TRIGGER", code, re.I), path.name


def test_only_the_326_functions_write_archived_at():
    """The guard serializes only against FOR UPDATE writers of archived_at
    (fn_archive_student / fn_restore_student). No application code may write
    the column directly."""
    offenders = []
    for root in (BACKEND, REPO / "scripts"):
        for path in root.rglob("*"):
            if path.suffix not in {".py", ".sql", ".sh"} or not path.is_file():
                continue
            rel = path.relative_to(REPO).as_posix()
            if rel.startswith(("backend/migrations/", "backend/tests/")) or "/venv/" in rel or "/.venv/" in rel:
                continue
            text = path.read_text(encoding="utf-8", errors="ignore")
            if re.search(r"""["']archived_at["']\s*:|\bSET\s+archived_at\b""", text, re.I):
                offenders.append(rel)
    assert offenders == []


def test_rollback_note_drops_trigger_then_function():
    note = _rollback_sql("public")
    assert note.index("DROP TRIGGER IF EXISTS") < note.index("DROP FUNCTION IF EXISTS")
    assert "SET LOCAL lock_timeout = '5s';" in note


# ── PostgreSQL harness ──────────────────────────────────────────────────────

def _schema_sql(sql: str, schema: str) -> str:
    return m326._schema_sql(sql, schema).replace("search_path=public,", f"search_path={schema},")


def _migrated(schema: str) -> str:
    return _schema_sql(SQL, schema)


def _rollback_sql(schema: str) -> str:
    header = SQL[SQL.index("-- ROLLBACK"):SQL.index("\nBEGIN;\n")]
    lines = [line[5:] for line in header.splitlines() if line.startswith("--   ")]
    return _schema_sql("\n".join(lines), schema)


def _writing_tables(s: str) -> str:
    """The writing_assignments columns the 228 RPC writes, its request ledger
    (206) and a stand-in for the 249 origin side-effect trigger."""
    return f"""
        SET search_path = {s}, pg_temp;
        ALTER TABLE writing_assignments
            ADD COLUMN prompt_id uuid, ADD COLUMN cohort_id uuid,
            ADD COLUMN assignment_group_id uuid, ADD COLUMN name text,
            ADD COLUMN allow_soft_check boolean NOT NULL DEFAULT false,
            ADD COLUMN assigned_by uuid, ADD COLUMN deadline timestamptz,
            ADD COLUMN instructions text, ADD COLUMN is_timed boolean NOT NULL DEFAULT false,
            ADD COLUMN time_limit_minutes integer,
            ADD COLUMN analysis_level integer NOT NULL DEFAULT 3,
            ADD COLUMN status text NOT NULL DEFAULT 'pending',
            ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
        CREATE TABLE writing_assignment_requests (
            id uuid PRIMARY KEY,
            assigned_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
            request_payload jsonb NOT NULL, receipt jsonb,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now());
        CREATE TABLE core_writing_origins (assignment_id uuid PRIMARY KEY, student_id uuid NOT NULL);
        CREATE FUNCTION fn_capture_writing_origin() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            INSERT INTO {s}.core_writing_origins (assignment_id, student_id) VALUES (NEW.id, NEW.student_id);
            RETURN NEW;
        END $$;
        CREATE TRIGGER core_capture_writing_origin BEFORE INSERT ON writing_assignments
            FOR EACH ROW EXECUTE FUNCTION fn_capture_writing_origin();
        REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA {s} FROM anon, authenticated;
    """


def _build(schema: str, *, guard: bool = True) -> None:
    m326._build(schema)
    psql(m326._migrated(schema))
    psql(_writing_tables(schema))
    psql(_schema_sql(SQL_228, schema))
    if guard:
        psql(_migrated(schema))


def _require_pg() -> None:
    try:
        available = shutil.which("psql") and psql("SELECT 1") == "1"
    except Exception:
        available = False
    if not available:
        if os.environ.get("REQUIRE_PG") == "1":
            pytest.fail("Local PostgreSQL required for migration 331 verification")
        pytest.skip("Local PostgreSQL unavailable")
    if psql("SELECT usesuper FROM pg_user WHERE usename=current_user") != "t":
        pytest.fail("Migration 331 fixture requires a superuser on its disposable LOCAL cluster")
    psql("""DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
    END $$;""")
    psql("ALTER ROLE service_role BYPASSRLS")


@pytest.fixture(scope="module")
def db():
    _require_pg()
    schema = "give_guard_" + uuid4().hex
    try:
        _build(schema)
        psql(_migrated(schema))  # re-applying is a no-op
        yield schema
    finally:
        psql(f"DROP SCHEMA IF EXISTS {schema} CASCADE")


@pytest.fixture(scope="module")
def unguarded():
    """Negative control: the same schema with 326 but WITHOUT 331."""
    _require_pg()
    schema = "give_guard_control_" + uuid4().hex
    try:
        _build(schema, guard=False)
        yield schema
    finally:
        psql(f"DROP SCHEMA IF EXISTS {schema} CASCADE")


def _arr(ids) -> str:
    return "ARRAY[" + ", ".join(f"'{i}'" for i in ids) + "]::uuid[]"


def _insert(s: str, students, prompt: str) -> str:
    values = ", ".join(f"('{sid}', '{prompt}')" for sid in students)
    return f"INSERT INTO {s}.writing_assignments (student_id, prompt_id) VALUES {values};"


def _rpc(s: str, request: str, admin: str, students, prompts, cohort: str | None = None) -> str:
    payload = json.dumps({"cohort_id": cohort} if cohort else {"request": request})
    return (f"SELECT {s}.fn_create_writing_assignments_idempotent('{request}', '{admin}', "
            f"'{payload}'::jsonb, {_arr(prompts)}, {_arr(students)});")


def _rows(s: str, prompt: str) -> int:
    return int(psql(f"SELECT count(*) FROM {s}.writing_assignments WHERE prompt_id = '{prompt}'"))


def _ledger(s: str, request: str) -> int:
    return int(psql(f"SELECT count(*) FROM {s}.writing_assignment_requests WHERE id = '{request}'"))


def _orphan_origins(s: str) -> int:
    return int(psql(f"""SELECT count(*) FROM {s}.core_writing_origins o
                        WHERE NOT EXISTS (SELECT 1 FROM {s}.writing_assignments a WHERE a.id = o.assignment_id)"""))


def _archived(s: str, student: str) -> bool:
    return psql(f"SELECT archived_at IS NOT NULL FROM {s}.students WHERE id = '{student}'") == "t"


def _svc_fails(sql: str) -> str:
    with pytest.raises(RuntimeError) as error:
        psql(m326._svc(sql))
    return str(error.value)


def _setup(s: str) -> tuple[str, dict, dict]:
    admin = m326._admin(s)
    return admin, m326._learner(s), m326._learner(s)


# ── PostgreSQL: behaviour ───────────────────────────────────────────────────

def test_catalog_after_apply(db):
    s = db
    triggers = psql(f"""SELECT string_agg(tgname, ',' ORDER BY tgname) FROM pg_trigger
                        WHERE tgrelid = '{s}.writing_assignments'::regclass AND NOT tgisinternal""")
    assert triggers.split(",")[0] == TRIGGER
    assert psql(f"SELECT tgenabled FROM pg_trigger WHERE tgname = '{TRIGGER}' "
                f"AND tgrelid = '{s}.writing_assignments'::regclass") == "O"
    definition = psql(f"SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname = '{TRIGGER}' "
                      f"AND tgrelid = '{s}.writing_assignments'::regclass")
    assert "BEFORE INSERT OR UPDATE OF student_id" in definition and "FOR EACH ROW" in definition
    assert psql(f"SELECT prosecdef, proconfig FROM pg_proc WHERE oid = '{s}.{FUNCTION}()'::regprocedure") == (
        f"t|{{\"search_path={s}, pg_temp\"}}")
    for role in ("anon", "authenticated"):
        assert psql(f"SELECT has_function_privilege('{role}', '{s}.{FUNCTION}()', 'EXECUTE')") == "f"
    assert psql(f"SELECT count(*) FROM pg_trigger WHERE tgname = '{TRIGGER}'"
                f" AND tgrelid = '{s}.writing_assignments'::regclass") == "1", "re-run created no duplicate"


@pytest.mark.parametrize("writer", ["plain", "bulk", "rpc"])
def test_every_writer_is_refused_for_an_archived_learner_with_nothing_written(db, writer):
    s = db
    admin, learner, other = _setup(s)
    sid = learner["student"]
    m326._archive(s, sid, admin)
    prompt, request = str(uuid4()), str(uuid4())
    origins = _orphan_origins(s)
    sql = {
        "plain": _insert(s, [sid], prompt),
        # A mixed batch: the active learner gets nothing either.
        "bulk": _insert(s, [other["student"], sid], prompt),
        "rpc": _rpc(s, request, admin, [other["student"], sid], [prompt, str(uuid4())]),
    }[writer]
    error = _svc_fails(sql)
    assert "student_archived" in error and sid in error   # DETAIL names the learner
    assert _rows(s, prompt) == 0
    assert _ledger(s, request) == 0, "the RPC's ledger row rolled back with the insert"
    assert _orphan_origins(s) == origins
    # The refusal is the DB's, not a client privilege: the definer can lock
    # students even for a role that has no UPDATE on it.
    grant = f"INSERT ON {s}.writing_assignments, {s}.core_writing_origins"
    psql(f"GRANT {grant} TO authenticated")
    try:
        assert "student_archived" in m326._denied(
            "authenticated", _insert(s, [sid], prompt), learner["user"])
        m326._as("authenticated", _insert(s, [other["student"]], prompt), other["user"])
    finally:
        psql(f"REVOKE {grant} FROM authenticated")
    assert _rows(s, prompt) == 1


def test_changing_student_id_to_an_archived_learner_is_refused_but_other_updates_pass(db):
    s = db
    admin, learner, other = _setup(s)
    sid = learner["student"]
    prompt = str(uuid4())
    psql(m326._svc(_insert(s, [other["student"]], prompt) + _insert(s, [sid], prompt)))
    m326._archive(s, sid, admin)
    moved = psql(f"SELECT id FROM {s}.writing_assignments WHERE student_id = '{other['student']}' "
                 f"AND prompt_id = '{prompt}'")
    assert "student_archived" in _svc_fails(
        f"UPDATE {s}.writing_assignments SET student_id = '{sid}' WHERE id = '{moved}'")
    assert psql(f"SELECT student_id FROM {s}.writing_assignments WHERE id = '{moved}'") == other["student"]
    # The archived learner's existing give stays editable (status sync,
    # deadline, instructions), including a SET that repeats the same student_id.
    psql(m326._svc(f"""UPDATE {s}.writing_assignments
                         SET status = 'submitted', deadline = now(), instructions = 'x', student_id = student_id
                       WHERE student_id = '{sid}' AND prompt_id = '{prompt}'"""))
    assert psql(f"SELECT status FROM {s}.writing_assignments WHERE student_id = '{sid}' "
                f"AND prompt_id = '{prompt}'") == "submitted"
    # Moving a row to an active learner still works.
    third = m326._learner(s)
    psql(m326._svc(f"UPDATE {s}.writing_assignments SET student_id = '{third['student']}' WHERE id = '{moved}'"))
    # Deletes are untouched (E2E cleanup, A-08 guarded delete).
    psql(m326._svc(f"DELETE FROM {s}.writing_assignments WHERE prompt_id = '{prompt}'"))
    assert _rows(s, prompt) == 0


def test_restore_reopens_gives_and_active_learners_are_unaffected(db):
    s = db
    admin, learner, other = _setup(s)
    sid, prompt = learner["student"], str(uuid4())
    psql(m326._svc(_insert(s, [other["student"]], prompt)))
    m326._archive(s, sid, admin)
    assert "student_archived" in _svc_fails(_insert(s, [sid], prompt))
    m326._restore(s, sid, admin)
    psql(m326._svc(_insert(s, [sid], prompt)))
    request = str(uuid4())
    receipt = json.loads(psql(m326._svc(_rpc(s, request, admin, [sid, other["student"]], [prompt]))).splitlines()[-1])
    assert receipt["created_count"] == 2
    assert _rows(s, prompt) == 4 and _ledger(s, request) == 1


def test_unknown_student_keeps_the_fk_error(db):
    s = db
    error = _svc_fails(_insert(s, [str(uuid4())], str(uuid4())))
    assert "violates foreign key constraint" in error and "student_archived" not in error


def test_completed_request_replays_after_the_archive(db):
    s = db
    admin, learner, _ = _setup(s)
    sid, prompt, request = learner["student"], str(uuid4()), str(uuid4())
    first = json.loads(psql(m326._svc(_rpc(s, request, admin, [sid], [prompt]))).splitlines()[-1])
    m326._archive(s, sid, admin)
    replay = json.loads(psql(m326._svc(_rpc(s, request, admin, [sid], [prompt]))).splitlines()[-1])
    assert replay["replayed"] is True and replay["group_id"] == first["group_id"]
    assert _rows(s, prompt) == 1


def test_preconditions_abort_without_326_or_without_for_update(db):
    s = db
    other = "give_guard_pre_" + uuid4().hex
    try:
        m326._build(other)            # no 326: no archived_at column
        assert "migration_326_missing" in m326._fails(_migrated(other))
        assert psql(f"SELECT count(*) FROM pg_trigger WHERE tgname = '{TRIGGER}' "
                    f"AND tgrelid = '{other}.writing_assignments'::regclass") == "0"
    finally:
        psql(f"DROP SCHEMA IF EXISTS {other} CASCADE")
    body = psql(f"SELECT pg_get_functiondef('{s}.fn_restore_student(uuid,uuid,text,boolean,boolean)'::regprocedure)")
    weakened = body.replace("p_student_id FOR UPDATE", "p_student_id FOR NO KEY UPDATE")
    assert weakened != body
    psql(weakened)
    try:
        assert "student_lifecycle_functions_must_lock_for_update" in m326._fails(_migrated(s))
    finally:
        psql(body)
    psql(_migrated(s))


def test_rollback_reopens_the_race_and_331_reapplies():
    _require_pg()
    schema = "give_guard_rollback_" + uuid4().hex
    try:
        _build(schema)
        admin, learner, _ = _setup(schema)
        m326._archive(schema, learner["student"], admin)
        psql(_rollback_sql(schema))
        assert psql(f"SELECT to_regprocedure('{schema}.{FUNCTION}()') IS NULL") == "t"
        psql(m326._svc(_insert(schema, [learner["student"]], str(uuid4()))))   # 0029 behaviour
        psql(_migrated(schema))
        assert "student_archived" in _svc_fails(_insert(schema, [learner["student"]], str(uuid4())))
    finally:
        psql(f"DROP SCHEMA IF EXISTS {schema} CASCADE")


# ── PostgreSQL: concurrency ─────────────────────────────────────────────────

HOLD = 2.5               # seconds session A keeps its lock before COMMIT
SESSION_TIMEOUT = 120    # generous: a slow host must not turn a correct wait into a failure


def _spawn_tagged(sql: str, tag: str) -> subprocess.Popen:
    environment = m326._env()
    environment["PGAPPNAME"] = tag
    return subprocess.Popen(["psql", DB, "-X", "-v", "ON_ERROR_STOP=1", "-tAq", "-c", sql],
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=environment)


def _wait_until_holding(tag: str, process: subprocess.Popen, timeout: float = 60.0) -> None:
    """Block until session ``tag`` has done its first write and sleeps holding
    the lock — not a fixed delay, so a slow CI host cannot reorder the race."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise AssertionError(f"first session ended early: {process.communicate()}")
        if psql(f"SELECT count(*) FROM pg_stat_activity WHERE application_name = '{tag}' "
                f"AND wait_event = 'PgSleep'") == "1":
            return
        time.sleep(0.05)
    raise AssertionError("first session never reached its lock-holding sleep")


def _timed_race(first: str, second: str) -> tuple[tuple, tuple]:
    """Session A runs ``first`` (which ends in a lock-holding sleep); once it
    holds the lock, session B runs ``second``. → ((rc, stdout, stderr, seconds),
    ...); B's time is measured from its own start."""
    tag = "give_guard_" + uuid4().hex[:12]
    a = _spawn_tagged(first, tag)
    try:
        _wait_until_holding(tag, a)
        started = time.monotonic()
        b = m326._spawn(second)
        out_b = b.communicate(timeout=SESSION_TIMEOUT)
        elapsed_b = time.monotonic() - started
        out_a = a.communicate(timeout=SESSION_TIMEOUT)
    finally:
        if a.poll() is None:
            a.kill()
    return (a.returncode, *out_a, None), (b.returncode, *out_b, elapsed_b)


def _hold(sql: str, seconds: float = HOLD) -> str:
    return m326._svc(f"BEGIN; {sql} SELECT pg_sleep({seconds}); COMMIT;")


def _archive_sql(s: str, sid: str, admin: str) -> str:
    return f"SELECT {s}.fn_archive_student('{sid}', '{admin}', NULL, false);"


def _give(s: str, writer: str, admin: str, sid: str, other: str, prompt: str, request: str) -> str:
    return {
        "plain": _insert(s, [sid], prompt),
        "rpc": _rpc(s, request, admin, [sid], [prompt]),
        "bulk": _insert(s, [other, sid], prompt),
        "update": (f"UPDATE {s}.writing_assignments SET student_id = '{sid}' "
                   f"WHERE student_id = '{other}' AND prompt_id = '{prompt}';"),
    }[writer]


@pytest.mark.parametrize("writer", ["plain", "rpc", "bulk", "update"])
def test_archive_commits_first_then_the_waiting_give_is_refused(db, writer):
    """Scenario 1 — the Codex window: the give waits on the archive's lock
    and, once the archive commits, is refused with nothing written."""
    s = db
    admin, learner, other = _setup(s)
    sid, prompt, request = learner["student"], str(uuid4()), str(uuid4())
    if writer == "update":
        psql(m326._svc(_insert(s, [other["student"]], prompt)))
    before = _rows(s, prompt)
    archive, give = _timed_race(_hold(_archive_sql(s, sid, admin)),
                                m326._svc(_give(s, writer, admin, sid, other["student"], prompt, request)))
    assert archive[0] == 0, archive[2]
    assert give[0] != 0 and "student_archived" in give[2], give
    assert give[3] >= 1.0, f"the give did not wait on the archive's row lock ({give[3]:.2f}s)"
    assert _rows(s, prompt) == before
    assert psql(f"SELECT count(*) FROM {s}.writing_assignments WHERE student_id = '{sid}' "
                f"AND prompt_id = '{prompt}'") == "0"
    assert _ledger(s, request) == 0
    assert _archived(s, sid) and m326._active(s, sid) == []


@pytest.mark.parametrize("writer", ["plain", "rpc", "bulk"])
def test_give_commits_first_then_the_archive_waits_and_keeps_it(db, writer):
    """Scenario 2: the archive waits for the give; both succeed and the give
    is kept as history (0029 FR-005)."""
    s = db
    admin, learner, other = _setup(s)
    sid, prompt, request = learner["student"], str(uuid4()), str(uuid4())
    give, archive = _timed_race(_hold(_give(s, writer, admin, sid, other["student"], prompt, request)),
                                m326._svc(_archive_sql(s, sid, admin)))
    assert give[0] == 0, give[2]
    assert archive[0] == 0, archive[2]
    assert archive[3] >= 1.0, f"the archive did not wait on the give's lock ({archive[3]:.2f}s)"
    assert psql(f"SELECT count(*) FROM {s}.writing_assignments WHERE student_id = '{sid}' "
                f"AND prompt_id = '{prompt}'") == "1"
    assert _archived(s, sid) and m326._active(s, sid) == []


def _stale_precheck(s: str, sid: str, admin: str, prompt: str) -> None:
    """Scenario 3 in SQL: the route's pre-check, then the archive, then the write."""
    assert psql(f"SELECT archived_at IS NULL FROM {s}.students WHERE id = '{sid}'") == "t"
    m326._archive(s, sid, admin)
    psql(m326._svc(_insert(s, [sid], prompt)))


def test_stale_precheck_then_insert_is_refused(db):
    s = db
    admin, learner, _ = _setup(s)
    prompt = str(uuid4())
    with pytest.raises(RuntimeError, match="student_archived"):
        _stale_precheck(s, learner["student"], admin, prompt)
    assert _rows(s, prompt) == 0


@pytest.mark.parametrize("writer", ["plain", "rpc"])
def test_negative_control_without_331_the_race_creates_the_row(unguarded, writer):
    """The same interleavings on a schema without 331 DO create a give for the
    archived learner — so the tests above detect the race, not a no-op."""
    s = unguarded
    admin, learner, other = _setup(s)
    sid, prompt, request = learner["student"], str(uuid4()), str(uuid4())
    archive, give = _timed_race(_hold(_archive_sql(s, sid, admin)),
                                m326._svc(_give(s, writer, admin, sid, other["student"], prompt, request)))
    assert archive[0] == 0 and give[0] == 0, (archive[2], give[2])
    assert _archived(s, sid)
    assert psql(f"SELECT count(*) FROM {s}.writing_assignments WHERE student_id = '{sid}' "
                f"AND prompt_id = '{prompt}'") == "1"
    stale = m326._learner(s)
    _stale_precheck(s, stale["student"], admin, prompt)
    assert _archived(s, stale["student"])
    assert psql(f"SELECT count(*) FROM {s}.writing_assignments WHERE student_id = '{stale['student']}' "
                f"AND prompt_id = '{prompt}'") == "1"


def test_cohort_rpc_against_archive_never_leaves_partial_or_post_archive_state(db):
    """Edge case: the cohort RPC locks memberships FOR SHARE and then (FK and
    331) the learner row; the archive locks the learner FOR UPDATE and then ends
    the memberships. Under jittered interleavings every run ends with the give
    complete or absent (never partial, ledger iff rows), the learner archived
    with no active class unless the archive was the deadlock victim, and a give
    refused only with roster_changed / student_archived / deadlock."""
    s = db
    admin = m326._admin(s)
    rng = random.Random(331)
    outcomes: dict[str, int] = {}
    for _ in range(20):
        learner = m326._learner(s)
        cohort = learner["cohorts"][0]
        mate = m326._learner(s, cohorts=0)
        psql(m326._svc(f"SELECT {s}.fn_add_student_cohort_membership('{mate['student']}', '{cohort}', NULL)"))
        sid, prompts, request = learner["student"], [str(uuid4()), str(uuid4())], str(uuid4())
        # Random start offsets and hold times so both orders (and waits) occur.
        give_sql = m326._svc(
            f"SELECT pg_sleep({rng.uniform(0, 0.2):.3f}); "
            f"BEGIN; {_rpc(s, request, admin, [sid, mate['student']], prompts, cohort)} "
            f"SELECT pg_sleep({rng.uniform(0, 0.1):.3f}); COMMIT;")
        archive_sql = m326._svc(
            f"SELECT pg_sleep({rng.uniform(0, 0.2):.3f}); "
            f"BEGIN; {_archive_sql(s, sid, admin)} SELECT pg_sleep({rng.uniform(0, 0.1):.3f}); COMMIT;")
        give_p, archive_p = m326._spawn(give_sql), m326._spawn(archive_sql)
        give_out = give_p.communicate(timeout=SESSION_TIMEOUT)
        archive_out = archive_p.communicate(timeout=SESSION_TIMEOUT)
        give_ok, archive_ok = give_p.returncode == 0, archive_p.returncode == 0
        rows = sum(_rows(s, p) for p in prompts)
        assert rows in (0, 4), "partial batch"
        assert (rows == 4) == give_ok and _ledger(s, request) == int(give_ok)
        assert give_ok or archive_ok, (give_out[1], archive_out[1])
        if not give_ok:
            assert re.search(r"roster_changed|student_archived|deadlock detected", give_out[1]), give_out[1]
        if archive_ok:
            assert _archived(s, sid) and m326._active(s, sid) == []
        else:
            assert "deadlock detected" in archive_out[1], archive_out[1]
            assert not _archived(s, sid)
        key = f"give={'ok' if give_ok else 'refused'},archive={'ok' if archive_ok else 'deadlock'}"
        outcomes[key] = outcomes.get(key, 0) + 1
    print("cohort race outcomes:", outcomes)
