"""Migration 332 (ADMINAAL2-0032, T002/T005): staff security audit, suspension
marker, privilege RPC and owner-only bootstrap.

The static half always runs: it pins the migration text to plan.md "Migration
332" and rollout.md (trigger events, lock order, owner-only bootstrap, rollback
order, forward-policy group).

The PostgreSQL half builds a disposable schema owned by a NOSUPERUSER role (the
hosted-Supabase runner `postgres` is not a superuser). The schema has
Supabase's default privileges, the 227 roster pieces, the 320 users guard and
migration 326 (for fn_restore_student). It applies 332 twice and proves:

- source classification (admin_api / service / out_of_band) and exactly one
  audit row per change;
- append-only enforcement for the owner and a superuser;
- grants;
- the RPC's actor, self, non-staff and no-op rules;
- `last_admin` and mutual suspension under two concurrent sessions;
- the suspension guard against every activation path, including a concurrent
  activation blocked on the suspension lock;
- N-1 activation with the trigger installed;
- the bootstrap recovery cases;
- the postcondition and precondition aborts, and the header rollback.

Set TEST_PG_URL to a LOCAL disposable cluster and REQUIRE_PG=1 to forbid skips.
"""

from __future__ import annotations

import json
import os
import re
import shutil
from pathlib import Path
from uuid import uuid4

import pytest

import test_migration_326_student_archive as m326
import test_migration_331_archived_student_give_guard as m331
from test_migration_240_core_attempt_evidence import psql

BACKEND = Path(__file__).resolve().parents[1]
REPO = BACKEND.parent
MIGRATIONS = BACKEND / "migrations"
NAME = "332_staff_security_audit.sql"
SQL = (MIGRATIONS / NAME).read_text(encoding="utf-8")
CODE = m326._strip_comments(SQL)
ROLLOUT = (REPO / "specs/0032-admin-aal2-staff-guard/rollout.md").read_text(encoding="utf-8")
OWNER = "m332_owner"
RPC_SIG = "fn_set_staff_privilege(uuid,uuid,text,boolean,text,text)"
BOOTSTRAP_SIG = "fn_bootstrap_admin_recovery(uuid,text,text)"
TABLES = ("staff_security_audit", "owner_alert_outbox", "staff_mfa_factor_snapshot",
          "staff_security_sweep_cursor")


def _without_bodies(code: str) -> str:
    return re.sub(r"\$\$.*?\$\$", "$$ $$", code, flags=re.S)


# ── Static contract ─────────────────────────────────────────────────────────

def test_one_transaction_with_lock_timeout_and_no_data_change():
    assert CODE.strip().startswith("BEGIN;") and CODE.strip().endswith("COMMIT;")
    assert "SET LOCAL lock_timeout = '5s';" in CODE
    top = _without_bodies(CODE)
    for forbidden in (r"\bDROP\b", r"DELETE\s+FROM", r"\bTRUNCATE\s+(?:TABLE\s+)?public", r"^\s*UPDATE\s",
                      r"INSERT\s+INTO", r"DISABLE\s+TRIGGER", r"session_replication_role"):
        assert not re.search(forbidden, top, re.M | re.I), forbidden


def test_users_triggers_fire_on_the_planned_columns():
    assert re.search(
        r"CREATE OR REPLACE TRIGGER trg_users_suspension_guard\s+BEFORE UPDATE OF is_active, "
        r"suspended_at, suspended_by, suspension_reason ON public\.users\s+FOR EACH ROW "
        r"EXECUTE FUNCTION public\.fn_users_suspension_guard\(\);", CODE)
    assert re.search(
        r"CREATE OR REPLACE TRIGGER trg_users_privilege_audit\s+AFTER INSERT OR UPDATE OF role, "
        r"is_active, suspended_at ON public\.users\s+FOR EACH ROW "
        r"EXECUTE FUNCTION public\.fn_users_privilege_audit\(\);", CODE)
    # 320's client guard sorts first, so a client role is refused before ours runs.
    assert "trg_users_guard_privileged_columns" < "trg_users_suspension_guard"


def test_suspension_guard_raises_account_suspended_unless_the_rpc_bypass_is_on():
    fn = m326._function(SQL, "fn_users_suspension_guard")
    assert "SECURITY DEFINER" not in fn
    assert fn.index("current_setting('aver.staff_privilege', true), '') = 'on'") < fn.index("RAISE")
    assert "NEW.is_active AND NOT OLD.is_active AND OLD.suspended_at IS NOT NULL" in fn
    assert re.findall(r"RAISE EXCEPTION '([a-z_]+)'", fn) == [
        "account_suspended", "account_suspended_marker_protected"]
    assert fn.count("ERRCODE = 'P0001'") == 2


def test_audit_is_append_only_without_fk_and_service_role_select_insert_only():
    table = CODE[CODE.index("CREATE TABLE IF NOT EXISTS public.staff_security_audit"):]
    table = table[:table.index(");") + 2]
    assert "REFERENCES" not in table, "the audit must survive user deletion"
    assert re.search(r"CREATE OR REPLACE TRIGGER trg_staff_security_audit_append_only\s+"
                     r"BEFORE UPDATE OR DELETE ON public\.staff_security_audit\s+FOR EACH ROW", CODE)
    assert re.search(r"CREATE OR REPLACE TRIGGER trg_staff_security_audit_no_truncate\s+"
                     r"BEFORE TRUNCATE ON public\.staff_security_audit\s+FOR EACH STATEMENT", CODE)
    assert ("REVOKE ALL ON public.staff_security_audit FROM PUBLIC, anon, authenticated, service_role;"
            in CODE)
    assert "GRANT SELECT, INSERT ON public.staff_security_audit TO service_role;" in CODE
    for table in TABLES:
        assert f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY;" in CODE


def test_rpc_locks_in_id_order_before_reading_the_actor_and_resets_its_settings():
    fn = m326._function(SQL, "fn_set_staff_privilege")
    assert "LANGUAGE plpgsql\nSECURITY DEFINER\nSET search_path = public, pg_temp" in fn
    lock = fn.index("ORDER BY id FOR UPDATE;")
    assert "WHERE id IN (p_actor, p_target) OR (role = 'admin' AND is_active)" in fn[:lock]
    assert lock < fn.index("SELECT * INTO v_actor") < fn.index("RAISE EXCEPTION 'last_admin'")
    update = fn.index("UPDATE public.users")
    assert fn.index("set_config('aver.staff_privilege', 'on', true)") < update
    reset = fn[update:]
    for name in ("staff_privilege", "actor_id", "reason", "request_id", "audit_id"):
        assert f"set_config('aver.{name}', '', true)" in reset, name
    assert ("GRANT EXECUTE ON FUNCTION public.fn_set_staff_privilege(uuid, uuid, text, boolean, text, text) "
            "TO service_role;") in CODE


def test_bootstrap_is_owner_only_invoker_and_writes_its_own_single_row():
    fn = m326._function(SQL, "fn_bootstrap_admin_recovery")
    assert "SECURITY INVOKER" in fn and "SECURITY DEFINER" not in fn
    assert fn.index("RAISE EXCEPTION 'admins_exist'") < fn.index("UPDATE public.users")
    assert "set_config('aver.bootstrap', 'on', true)" in fn
    assert "'bootstrap_recovery'" in fn and "'out_of_band'" in fn
    assert re.search(r"REVOKE ALL ON FUNCTION public\.fn_bootstrap_admin_recovery\(uuid, text, text\)\s+"
                     r"FROM PUBLIC, anon, authenticated, service_role;", CODE)
    assert not re.search(r"GRANT[^;]*fn_bootstrap_admin_recovery", CODE)
    # The trigger skips exactly that UPDATE, so the change has one row only.
    audit = m326._function(SQL, "fn_users_privilege_audit")
    assert "current_setting('aver.bootstrap', true), '') = 'on'" in audit


def test_bootstrap_takes_its_own_advisory_key_before_the_admin_check():
    fn = m326._function(CODE, "fn_bootstrap_admin_recovery")
    guard = fn.index("IF current_setting('transaction_isolation') <> 'read committed' THEN")
    lock = fn.index("PERFORM pg_advisory_xact_lock(332, 1);")
    assert guard < lock < fn.index("ORDER BY id FOR UPDATE;") < fn.index("RAISE EXCEPTION 'admins_exist'")
    # Not the runner's session key, and the RPC does not share it.
    assert "173204" not in fn
    assert "pg_advisory" not in m326._function(CODE, "fn_set_staff_privilege")


def test_no_public_function_reaches_the_auth_schema():
    """Session revocation stays on the backend's direct connection (lot 06)."""
    assert not re.search(r"\bauth\.", CODE)


def test_postconditions_cover_the_s2_checks():
    post = CODE[CODE.rindex("DO $$"):]
    for marker in ("users_suspension_columns_missing", "users_suspension_check_missing",
                   "staff_security_trigger_missing", "staff_security_rls_off",
                   "staff_security_table_privileges_wrong", "users_privilege_columns_client_writable",
                   "staff_security_function_acl_wrong", "trg_users_privilege_audit",
                   "trg_users_suspension_guard", "server_version_num"):
        assert marker in post, marker


def test_rollback_note_matches_rollout_and_keeps_the_tables():
    note = _rollback_sql("public")
    assert note.index("DROP TRIGGER IF EXISTS trg_users_privilege_audit") < note.index("DROP FUNCTION")
    assert note.index("DROP TRIGGER IF EXISTS trg_users_suspension_guard") < note.index(
        "DROP FUNCTION IF EXISTS public.fn_users_suspension_guard()")
    assert "rollback_unsafe_suspended_accounts_exist" in note
    assert "DROP TABLE" not in note and "fn_bootstrap_admin_recovery" not in note
    for statement in re.findall(r"DROP (?:TRIGGER|FUNCTION) IF EXISTS [^;]+;", note):
        assert statement in ROLLOUT, statement


def test_forward_policy_holds_332_behind_the_admin_aal2_group():
    rows = [line.split("\t") for line in (MIGRATIONS / "forward-policy.tsv").read_text(
        encoding="utf-8").splitlines() if line.startswith(NAME)]
    assert len(rows) == 1 and rows[0][1:3] == ["pending_feature", "admin_aal2"]
    readme = (MIGRATIONS / "README.md").read_text(encoding="utf-8")
    assert "Migration `332` (ADMINAAL2-0032)" in readme and "MIGRATION_FEATURES=admin_aal2" in readme


def test_no_other_migration_drops_or_bypasses_the_332_guards():
    for path in sorted(MIGRATIONS.glob("*.sql")):
        if path.name == NAME:
            continue
        code = m326._strip_comments(path.read_text(encoding="utf-8"))
        for name in ("trg_users_suspension_guard", "fn_users_suspension_guard",
                     "trg_users_privilege_audit", "staff_security_audit", "aver.staff_privilege"):
            assert name not in code, (path.name, name)


# ── PostgreSQL harness ──────────────────────────────────────────────────────

def _schema_sql(sql: str, schema: str) -> str:
    return m331._schema_sql(sql, schema)


def _migrated(schema: str) -> str:
    return _schema_sql(SQL, schema)


def _rollback_sql(schema: str) -> str:
    header = SQL[SQL.index("-- ROLLBACK"):SQL.index("\nBEGIN;\n")]
    lines = [line[5:] for line in header.splitlines() if line.startswith("--   ")]
    return _schema_sql("\n".join(lines), schema)


def _postcondition_sql(schema: str) -> str:
    return _schema_sql(SQL[SQL.rindex("DO $$"):SQL.rindex("COMMIT;")], schema)


def _owner(sql: str) -> str:
    """Run as the NOSUPERUSER schema owner, like the hosted migration runner."""
    return psql(f"SET ROLE {OWNER}; {sql}")


def _svc(sql: str) -> str:
    return psql(m326._svc(sql))


def _fails(run, sql: str) -> str:
    with pytest.raises(RuntimeError) as error:
        run(sql)
    return str(error.value)


def _require_pg() -> None:
    try:
        available = shutil.which("psql") and psql("SELECT 1") == "1"
    except Exception:
        available = False
    if not available:
        if os.environ.get("REQUIRE_PG") == "1":
            pytest.fail("Local PostgreSQL required for migration 332 verification")
        pytest.skip("Local PostgreSQL unavailable")
    if psql("SELECT usesuper FROM pg_user WHERE usename=current_user") != "t":
        pytest.fail("Migration 332 fixture requires a superuser on its disposable LOCAL cluster")
    psql(f"""DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='{OWNER}') THEN
        CREATE ROLE {OWNER} NOSUPERUSER NOLOGIN NOBYPASSRLS;
      END IF;
    END $$;""")
    psql("ALTER ROLE service_role BYPASSRLS")


def _build(schema: str, *, guard_320: bool = True) -> None:
    psql(f"CREATE SCHEMA {schema} AUTHORIZATION {OWNER}; "
         f"GRANT USAGE ON SCHEMA {schema} TO anon, authenticated, service_role;")
    _owner(f"""
        -- Supabase schema defaults: every new table/function is client-writable
        -- and executable unless a migration revokes it.
        ALTER DEFAULT PRIVILEGES IN SCHEMA {schema}
            GRANT ALL ON TABLES TO anon, authenticated, service_role;
        ALTER DEFAULT PRIVILEGES IN SCHEMA {schema}
            GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
        SET search_path = {schema}, pg_temp;
        CREATE TABLE users (
            id uuid PRIMARY KEY, email text,
            role text NOT NULL DEFAULT 'user'
                CONSTRAINT chk_users_role CHECK (role IN ('user', 'student', 'instructor', 'admin')),
            is_active boolean NOT NULL DEFAULT false, display_name text, avatar_url text,
            access_code_used text, permissions text[], feature_flags jsonb, last_seen_at timestamptz,
            target_band numeric, exam_date date, self_level text, preferred_topics text[],
            onboarding_completed boolean, timezone text, weekly_goal integer,
            notification_email boolean, updated_at timestamptz);
        CREATE TABLE cohorts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text);
        CREATE TABLE students (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            student_code text UNIQUE NOT NULL, full_name text NOT NULL,
            cohort_id uuid REFERENCES cohorts(id) ON DELETE SET NULL,
            instructor_id uuid REFERENCES users(id) ON DELETE SET NULL,
            user_id uuid REFERENCES users(id) ON DELETE SET NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now());
        {m326._227_table()}
    """)
    _owner(m326._227_writers(schema))
    if guard_320:
        _owner(m326._users_guard(schema))
    _owner(f"REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA {schema} "
           f"FROM anon, authenticated;")
    if guard_320:
        _owner(m326._migrated(schema))   # 326: fn_restore_student(p_reactivate_account)


def _apply(schema: str) -> None:
    _owner(_migrated(schema))


@pytest.fixture(scope="module")
def db():
    _require_pg()
    schema = "staff_sec_" + uuid4().hex
    try:
        _build(schema)
        _apply(schema)
        _apply(schema)   # re-applying is a no-op
        yield schema
    finally:
        psql(f"DROP SCHEMA IF EXISTS {schema} CASCADE")


@pytest.fixture
def fresh():
    """A new schema per test, for cases that depend on the whole admin set."""
    _require_pg()
    schema = "staff_sec_fresh_" + uuid4().hex
    try:
        _build(schema)
        _apply(schema)
        yield schema
    finally:
        psql(f"DROP SCHEMA IF EXISTS {schema} CASCADE")


def _user(s: str, role: str = "user", active: bool = False) -> str:
    uid = str(uuid4())
    psql(f"INSERT INTO {s}.users (id, email, role, is_active) "
         f"VALUES ('{uid}', '{uid}@q332.test', '{role}', {str(active).lower()})")
    return uid


def _state(s: str, uid: str) -> dict:
    return json.loads(psql(
        f"SELECT json_build_object('role', role, 'is_active', is_active, "
        f"'suspended', suspended_at IS NOT NULL, 'suspended_by', suspended_by, "
        f"'reason', suspension_reason) FROM {s}.users WHERE id = '{uid}'"))


def _audit(s: str, uid: str) -> list[dict]:
    out = psql(f"""SELECT COALESCE(json_agg(json_build_object(
                     'id', id, 'event', event, 'source', source, 'actor', actor_user_id,
                     'before', before, 'after', after, 'reason', reason,
                     'request_id', request_id, 'detail', detail) ORDER BY occurred_at, id), '[]')
                   FROM {s}.staff_security_audit WHERE target_user_id = '{uid}'""")
    return json.loads(out)


def _outbox(s: str, uid: str) -> list[dict]:
    out = psql(f"""SELECT COALESCE(json_agg(json_build_object(
                     'audit_id', o.audit_id, 'event', o.event, 'payload', o.payload,
                     'status', o.status, 'attempts', o.attempts)
                     ORDER BY a.occurred_at, o.created_at, o.id), '[]')
                   FROM {s}.owner_alert_outbox o JOIN {s}.staff_security_audit a ON a.id = o.audit_id
                  WHERE a.target_user_id = '{uid}'""")
    return json.loads(out)


def _sql_text(value) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return str(value).lower()
    return "'" + str(value).replace("'", "''") + "'"


def _rpc_sql(s: str, actor, target, *, role=None, active=None, reason="security review",
             request="req-332") -> str:
    return (f"SELECT row_to_json(r) FROM {s}.fn_set_staff_privilege("
            f"{_sql_text(actor)}::uuid, {_sql_text(target)}::uuid, {_sql_text(role)}::text, "
            f"{_sql_text(active)}::boolean, {_sql_text(reason)}::text, {_sql_text(request)}::text) r;")


def _rpc(s: str, actor, target, **kwargs) -> dict:
    return json.loads(_svc(_rpc_sql(s, actor, target, **kwargs)).splitlines()[-1])


def _suspend(s: str, actor: str, target: str, reason: str = "compromised") -> dict:
    return _rpc(s, actor, target, active=False, reason=reason)


def _bootstrap_sql(s: str, target: str, operator: str = "Vinh", reason: str = "drill (e)") -> str:
    return (f"SELECT {s}.fn_bootstrap_admin_recovery('{target}', {_sql_text(operator)}, "
            f"{_sql_text(reason)});")


def _active_admins(s: str) -> int:
    return int(psql(f"SELECT count(*) FROM {s}.users WHERE role = 'admin' AND is_active"))


# ── PostgreSQL: catalog ─────────────────────────────────────────────────────

def test_catalog_after_apply_and_rerun(db):
    s = db
    assert psql(f"""SELECT string_agg(column_name || ':' || data_type, ',' ORDER BY column_name)
                    FROM information_schema.columns WHERE table_schema = '{s}' AND table_name = 'users'
                     AND column_name IN ('suspended_at', 'suspended_by', 'suspension_reason')""") == (
        "suspended_at:timestamp with time zone,suspended_by:uuid,suspension_reason:text")
    assert psql(f"SELECT count(*) FROM pg_constraint WHERE conrelid = '{s}.users'::regclass "
                f"AND conname = 'chk_users_suspension_marker' AND convalidated") == "1"
    triggers = psql(f"""SELECT string_agg(tgname || ':' || tgenabled::text, ',' ORDER BY tgname) FROM pg_trigger
                        WHERE tgrelid = '{s}.users'::regclass AND NOT tgisinternal""")
    assert triggers == ("trg_users_guard_privileged_columns:O,trg_users_privilege_audit:O,"
                        "trg_users_suspension_guard:O"), "a re-run created no duplicate"
    for table in TABLES:
        assert psql(f"SELECT relrowsecurity FROM pg_class WHERE oid = '{s}.{table}'::regclass") == "t"
    assert psql(f"SELECT count(*) FROM pg_indexes WHERE schemaname = '{s}' "
                f"AND indexname = 'ux_staff_security_audit_auth_log_entry'") == "1"
    for sig, definer in ((RPC_SIG, "true"), ("fn_users_privilege_audit()", "true"),
                         (BOOTSTRAP_SIG, "false"), ("fn_users_suspension_guard()", "false")):
        assert psql(f"SELECT prosecdef::text || '|' || array_to_string(proconfig, ';') FROM pg_proc "
                    f"WHERE oid = '{s}.{sig}'::regprocedure") == f"{definer}|search_path={s}, pg_temp"
        assert psql(f"SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid = '{s}.{sig}'::regprocedure") == OWNER


def test_grants_on_tables_and_functions(db):
    s = db
    maintain = psql("SELECT current_setting('server_version_num')::int >= 170000") == "t"
    privileges = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]
    privileges += ["MAINTAIN"] if maintain else []
    service = {"staff_security_audit": {"SELECT", "INSERT"},
               "owner_alert_outbox": {"SELECT", "INSERT", "UPDATE"},
               "staff_mfa_factor_snapshot": {"SELECT", "INSERT", "UPDATE", "DELETE"},
               "staff_security_sweep_cursor": {"SELECT", "INSERT", "UPDATE", "DELETE"}}
    for table, granted in service.items():
        for role in ("anon", "authenticated", "service_role"):
            for priv in privileges:
                expected = role == "service_role" and priv in granted
                assert psql(f"SELECT has_table_privilege('{role}', '{s}.{table}', '{priv}')") == (
                    "t" if expected else "f"), (table, role, priv)
    for role in ("anon", "authenticated"):
        assert psql(f"SELECT has_function_privilege('{role}', '{s}.{RPC_SIG}', 'EXECUTE')") == "f"
    assert psql(f"SELECT has_function_privilege('service_role', '{s}.{RPC_SIG}', 'EXECUTE')") == "t"
    for role in ("anon", "authenticated", "service_role"):
        assert psql(f"SELECT has_function_privilege('{role}', '{s}.{BOOTSTRAP_SIG}', 'EXECUTE')") == "f"
    # Clients reach neither the RPC nor the audit through any path.
    target = _user(s, "instructor", True)
    admin = _user(s, "admin", True)
    for role in ("anon", "authenticated"):
        assert "permission denied" in m326._denied(role, _rpc_sql(s, admin, target, role="student"), admin)
        assert "permission denied" in m326._denied(role, f"SELECT count(*) FROM {s}.staff_security_audit")
        assert "permission denied" in m326._denied(
            role, f"INSERT INTO {s}.staff_security_audit (event, target_user_id, source) "
                  f"VALUES ('role_changed', '{target}', 'service')")
    assert _state(s, target)["role"] == "instructor"


# ── PostgreSQL: audit trigger ───────────────────────────────────────────────

def test_source_classification_and_one_row_per_change(db):
    s = db
    admin = _user(s, "admin", True)
    target = _user(s, "instructor", True)

    # service: the PostgREST service_role JWT (the deployed backend's writes).
    _svc(f"UPDATE {s}.users SET role = 'student' WHERE id = '{target}'")
    # out_of_band: SQL editor / runner, as the owner and as a superuser.
    _owner(f"UPDATE {s}.users SET role = 'instructor' WHERE id = '{target}'")
    psql(f"UPDATE {s}.users SET is_active = false WHERE id = '{target}'")
    # admin_api: the RPC sets the actor, reason and request id.
    _rpc(s, admin, target, active=True, reason="back from leave", request="req-ab")
    rows = _audit(s, target)[1:]   # [0] is the out-of-band insert of the fixture row
    assert [(r["event"], r["source"]) for r in rows] == [
        ("role_changed", "service"), ("role_changed", "out_of_band"),
        ("active_changed", "out_of_band"), ("active_changed", "admin_api")]
    assert [r["actor"] for r in rows] == [None, None, None, admin]
    assert rows[3]["reason"] == "back from leave" and rows[3]["request_id"] == "req-ab"
    assert rows[0]["before"] == {"role": "instructor", "is_active": True, "suspended_at": None}
    assert rows[0]["after"] == {"role": "student", "is_active": True, "suspended_at": None}
    # Instructor events are audit-only (Q4): no owner email.
    assert _outbox(s, target) == []

    # Role and is_active in one UPDATE → one row; no-op updates → none.
    _svc(f"UPDATE {s}.users SET role = 'student', is_active = false WHERE id = '{target}'")
    _svc(f"UPDATE {s}.users SET role = role, is_active = is_active, display_name = 'x' WHERE id = '{target}'")
    rows = _audit(s, target)
    assert len(rows) == 6 and rows[-1]["event"] == "role_changed"
    assert rows[-1]["after"] == {"role": "student", "is_active": False, "suspended_at": None}


def test_inserts_are_audited_only_for_staff_rows(db):
    s = db
    learner, instructor, admin = _user(s), _user(s, "instructor"), _user(s, "admin", True)
    assert _audit(s, learner) == []
    assert [(r["event"], r["source"]) for r in _audit(s, instructor)] == [("staff_row_inserted", "out_of_band")]
    assert _outbox(s, instructor) == []
    assert [r["event"] for r in _audit(s, admin)] == ["staff_row_inserted"]
    assert [o["event"] for o in _outbox(s, admin)] == ["staff_row_inserted"]
    svc_admin = str(uuid4())
    _svc(f"INSERT INTO {s}.users (id, email, role, is_active) VALUES ('{svc_admin}', 'a@q332.test', 'admin', false)")
    assert [(r["event"], r["source"], r["before"]) for r in _audit(s, svc_admin)] == [
        ("staff_row_inserted", "service", None)]


def test_admin_events_queue_one_email_safe_alert_each(db):
    s = db
    actor, other = _user(s, "admin", True), _user(s, "admin", True)
    learner = _user(s)
    _svc(f"UPDATE {s}.users SET role = 'admin' WHERE id = '{learner}'")            # gains admin
    _suspend(s, actor, other, reason="phone stolen; secret=hunter2")               # admin suspended
    alerts = _outbox(s, other)
    assert len(alerts) == 2 and alerts[1]["event"] == "active_changed"           # [0] = insert
    payload = alerts[1]["payload"]
    assert set(payload) == {"audit_id", "event", "occurred_at", "source", "target_user_id",
                            "target_email", "actor_user_id", "actor_email", "before", "after", "operator"}
    assert payload["target_email"] == f"{other}@q332.test" and payload["actor_email"] == f"{actor}@q332.test"
    assert payload["source"] == "admin_api" and payload["operator"] is None
    assert "hunter2" not in json.dumps(alerts), "the free-text reason never goes into an email"
    assert alerts[1]["status"] == "pending" and alerts[1]["attempts"] == 0
    gained = _outbox(s, learner)
    assert len(gained) == 1 and gained[0]["payload"]["actor_email"] is None
    assert gained[0]["payload"]["before"]["role"] == "user" and gained[0]["payload"]["after"]["role"] == "admin"


def test_n_minus_1_learner_activation_and_archive_write_one_audit_row_and_no_alert(db):
    """The deployed backend's activation (/auth/activate Step 3) and the 326
    archive keep working with the trigger installed."""
    s = db
    learner = _user(s)
    _svc(f"UPDATE {s}.users SET is_active = true, access_code_used = 'CODE-1', "
         f"permissions = ARRAY['practice_single'] WHERE id = '{learner}'")
    # Activating an already-active account again is not a change.
    _svc(f"UPDATE {s}.users SET is_active = true, access_code_used = 'CODE-2' WHERE id = '{learner}'")
    student = psql(f"INSERT INTO {s}.students (student_code, full_name, user_id) "
                   f"VALUES ('S-{uuid4().hex[:8]}', 'L', '{learner}') RETURNING id")
    admin = _user(s, "admin", True)
    assert m326._archive(s, student, admin, deactivate=True)["account_deactivated"] is True
    assert m326._restore(s, student, admin, reactivate=True)["account_reactivated"] is True
    rows = _audit(s, learner)
    assert [(r["event"], r["source"], r["after"]["is_active"]) for r in rows] == [
        ("active_changed", "service", True), ("active_changed", "service", False),
        ("active_changed", "service", True)]
    assert _outbox(s, learner) == []


def test_append_only_for_service_role_owner_and_superuser(db):
    s = db
    target = _user(s, "instructor")
    row = _audit(s, target)[0]["id"]
    for sql in (f"UPDATE {s}.staff_security_audit SET reason = 'x' WHERE id = '{row}'",
                f"DELETE FROM {s}.staff_security_audit WHERE id = '{row}'",
                f"TRUNCATE {s}.staff_security_audit CASCADE"):
        assert "permission denied" in _fails(_svc, sql)
        assert "staff_security_audit_append_only" in _fails(_owner, sql)
        assert "staff_security_audit_append_only" in _fails(psql, sql)
    assert len(_audit(s, target)) == 1
    # service_role may append (sweep, revocation results) and read.
    _svc(f"INSERT INTO {s}.staff_security_audit (event, target_user_id, source, detail) "
         f"VALUES ('sessions_revoke_failed', '{target}', 'service', '{{}}')")
    assert len(_audit(s, target)) == 2


def test_auth_log_entry_id_is_unique_so_a_sweep_rerun_cannot_duplicate(db):
    s = db
    admin = _user(s, "admin", True)
    entry = str(uuid4())
    insert = (f"INSERT INTO {s}.staff_security_audit (event, target_user_id, source, detail) "
              f"VALUES ('mfa_factor_verified', '{admin}', 'auth', "
              f"'{{\"auth_log_entry_id\": \"{entry}\", \"factor_id\": \"{uuid4()}\"}}')")
    _svc(insert)
    assert "ux_staff_security_audit_auth_log_entry" in _fails(_svc, insert)
    assert [r["event"] for r in _audit(s, admin)] == ["staff_row_inserted", "mfa_factor_verified"]


def test_client_roles_cannot_change_role_active_or_marker_even_with_a_grant(db):
    """320's guard refuses the new marker columns too (added after 320)."""
    s = db
    user = _user(s, "instructor")
    psql(f"GRANT UPDATE ON {s}.users TO authenticated")
    try:
        for assignment in ("is_active = true", "role = 'admin'", "suspended_at = now()"):
            assert "users_privileged_column_change_forbidden" in m326._denied(
                "authenticated", f"UPDATE {s}.users SET {assignment} WHERE id = '{user}'", user)
    finally:
        psql(f"REVOKE UPDATE ON {s}.users FROM authenticated")
    assert _state(s, user) == {"role": "instructor", "is_active": False, "suspended": False,
                               "suspended_by": None, "reason": None}


# ── PostgreSQL: fn_set_staff_privilege ──────────────────────────────────────

def test_suspend_sets_marker_audits_once_and_repeat_is_a_no_op(db):
    s = db
    actor, target = _user(s, "admin", True), _user(s, "instructor", True)
    first = _suspend(s, actor, target, reason="  shared password  ")
    assert first["changed"] is True and first["audit_id"]
    assert first["before"]["is_active"] is True and first["after"]["is_active"] is False
    assert first["after"]["suspended_at"] is not None
    assert _state(s, target) == {"role": "instructor", "is_active": False, "suspended": True,
                                 "suspended_by": actor, "reason": "shared password"}
    rows = _audit(s, target)
    assert rows[-1]["id"] == first["audit_id"] and rows[-1]["source"] == "admin_api"
    again = _suspend(s, actor, target, reason="other reason")
    assert again == {"changed": False, "audit_id": None, "before": first["after"], "after": first["after"]}
    assert len(_audit(s, target)) == len(rows)
    assert _state(s, target)["reason"] == "shared password"

    back = _rpc(s, actor, target, active=True, reason="cleared")
    assert back["changed"] is True
    assert _state(s, target) == {"role": "instructor", "is_active": True, "suspended": False,
                                 "suspended_by": None, "reason": None}
    assert _rpc(s, actor, target, active=True, reason="cleared")["changed"] is False
    assert [r["event"] for r in _audit(s, target)][-2:] == ["active_changed", "active_changed"]


def test_suspending_a_never_activated_instructor_still_writes_the_marker(db):
    """Suspended ≠ never activated: the marker blocks a later code activation."""
    s = db
    actor, target = _user(s, "admin", True), _user(s, "instructor", False)
    result = _suspend(s, actor, target)
    assert result["changed"] is True and _state(s, target)["suspended"] is True
    assert _audit(s, target)[-1]["event"] == "active_changed"
    assert "account_suspended" in _fails(_svc, f"UPDATE {s}.users SET is_active = true WHERE id = '{target}'")
    # A never-activated instructor without the marker still activates normally.
    plain = _user(s, "instructor", False)
    _svc(f"UPDATE {s}.users SET is_active = true WHERE id = '{plain}'")
    assert _state(s, plain)["is_active"] is True


def test_role_changes_through_the_rpc(db):
    s = db
    actor, target = _user(s, "admin", True), _user(s, "admin", True)
    demoted = _rpc(s, actor, target, role="student", reason=None)
    assert demoted["changed"] is True and demoted["after"]["role"] == "student"
    assert _audit(s, target)[-1]["event"] == "role_changed"
    assert [o["event"] for o in _outbox(s, target)][-1] == "role_changed"   # loses admin → email
    assert _rpc(s, actor, target, role="student", reason=None)["changed"] is False


@pytest.mark.parametrize("case,expected", [
    ("non_admin_actor", "actor_not_admin"),
    ("inactive_actor", "actor_not_admin"),
    ("suspended_actor", "actor_not_admin"),
    ("unknown_actor", "actor_not_admin"),
    ("null_actor", "actor_not_admin"),
    ("self", "self_change_forbidden"),
    ("unknown_target", "target_not_found"),
    ("learner_suspension", "target_not_staff"),
    ("bad_role", "invalid_role"),
    ("short_reason", "invalid_reason"),
    ("long_reason", "invalid_reason"),
    ("nothing", "invalid_privilege_change"),
])
def test_rpc_refusals_change_nothing(db, case, expected):
    s = db
    admin = _user(s, "admin", True)
    target = _user(s, "instructor", True)
    actor = admin
    kwargs = {"active": False}
    if case == "non_admin_actor":
        actor = _user(s, "instructor", True)
    elif case == "inactive_actor":
        actor = _user(s, "admin", False)
    elif case == "suspended_actor":
        actor = _user(s, "admin", True)
        _suspend(s, admin, actor)
    elif case == "unknown_actor":
        actor = str(uuid4())
    elif case == "null_actor":
        actor = None
    elif case == "self":
        target = admin
    elif case == "unknown_target":
        target = str(uuid4())
    elif case == "learner_suspension":
        target = _user(s, "student", True)
    elif case == "bad_role":
        kwargs = {"role": "user"}
    elif case == "short_reason":
        kwargs = {"active": False, "reason": " x "}
    elif case == "long_reason":
        kwargs = {"active": False, "reason": "x" * 501}
    elif case == "nothing":
        kwargs = {}
    before_state = psql(f"SELECT md5(string_agg(u::text, ',' ORDER BY id)) FROM {s}.users u")
    before_audit = psql(f"SELECT count(*) FROM {s}.staff_security_audit")
    error = _fails(_svc, _rpc_sql(s, actor, target, **kwargs))
    assert re.search(rf"ERROR:\s+{expected}\b", error), error
    assert psql(f"SELECT md5(string_agg(u::text, ',' ORDER BY id)) FROM {s}.users u") == before_state
    assert psql(f"SELECT count(*) FROM {s}.staff_security_audit") == before_audit


def test_rpc_settings_do_not_leak_into_the_rest_of_the_transaction(db):
    s = db
    actor, target, other, third = (_user(s, "admin", True), _user(s, "instructor", True),
                                   _user(s, "instructor", True), _user(s, "instructor", True))
    _svc(f"BEGIN; {_rpc_sql(s, actor, target, active=False)} "
         f"UPDATE {s}.users SET role = 'student' WHERE id = '{other}'; COMMIT;")
    assert _audit(s, other)[-1]["source"] == "service" and _audit(s, other)[-1]["actor"] is None
    # …and the guard bypass is gone: a later reactivation in the same
    # transaction is refused.
    error = _fails(_svc, f"BEGIN; {_rpc_sql(s, actor, third, active=False)} "
                         f"UPDATE {s}.users SET is_active = true WHERE id = '{target}'; COMMIT;")
    assert "account_suspended" in error
    assert _state(s, third)["suspended"] is False, "the failed transaction rolled back"


def test_last_admin_refusal_is_defence_in_depth(fresh):
    """Through the RPC the actor (a different active admin) always remains, so
    last_admin can only fire if the actor rule is weakened. Prove the check
    itself on a copy without the actor rule."""
    s = fresh
    only, other = _user(s, "admin", True), _user(s, "admin", False)
    body = psql(f"SELECT pg_get_functiondef('{s}.{RPC_SIG}'::regprocedure)")
    weakened = re.sub(r"IF NOT FOUND OR v_actor\.role IS DISTINCT FROM 'admin'.*?END IF;", "",
                      body, count=1, flags=re.S)
    weakened = weakened.replace("IF p_actor = p_target THEN", "IF false THEN")
    assert weakened != body
    _owner(weakened)
    try:
        error = _fails(_svc, _rpc_sql(s, other, only, role="student"))
        assert re.search(r"ERROR:\s+last_admin\b", error), error
        assert _state(s, only)["role"] == "admin" and _active_admins(s) == 1
    finally:
        _owner(body)


# ── PostgreSQL: concurrency ─────────────────────────────────────────────────

def _race(s: str, first: str, second: str):
    return m331._timed_race(m331._hold(first), m326._svc(second))


@pytest.mark.parametrize("change", ["demote", "suspend"])
def test_concurrent_mutual_change_of_the_only_two_admins_leaves_exactly_one(fresh, change):
    """Concurrent last_admin (role) and mutual suspension (is_active): the
    second session waits on the first's lock, then finds its own actor no
    longer an active admin. Zero admins is never reached."""
    s = fresh
    a, b = _user(s, "admin", True), _user(s, "admin", True)
    kwargs = {"role": "student", "reason": None} if change == "demote" else {"active": False}
    first, second = _race(s, _rpc_sql(s, a, b, **kwargs), _rpc_sql(s, b, a, **kwargs))
    assert first[0] == 0, first[2]
    assert second[0] != 0 and re.search(r"ERROR:\s+actor_not_admin\b", second[2]), second
    assert second[3] >= 1.0, f"the second session did not wait on the lock ({second[3]:.2f}s)"
    assert _active_admins(s) == 1
    assert _state(s, a) == {"role": "admin", "is_active": True, "suspended": False,
                            "suspended_by": None, "reason": None}
    assert len(_audit(s, b)) == 2 and _audit(s, a)[-1]["event"] == "staff_row_inserted"


def test_concurrent_identical_suspensions_write_one_audit_row(db):
    s = db
    a, b, target = _user(s, "admin", True), _user(s, "admin", True), _user(s, "instructor", True)
    first, second = _race(s, _rpc_sql(s, a, target, active=False), _rpc_sql(s, b, target, active=False))
    assert first[0] == 0 and second[0] == 0, (first[2], second[2])
    assert json.loads(second[1].splitlines()[-1])["changed"] is False
    assert [r["event"] for r in _audit(s, target)] == ["staff_row_inserted", "active_changed"]
    assert _state(s, target)["suspended_by"] == a


@pytest.mark.parametrize("initially_active", [True, False])
def test_activation_waiting_on_a_suspension_is_refused_after_it_commits(db, initially_active):
    """FR-018 under concurrency: /auth/activate Step 3 runs while the
    suspension holds the row lock; it re-reads the committed row and fails."""
    s = db
    admin, target = _user(s, "admin", True), _user(s, "instructor", initially_active)
    activation = (f"UPDATE {s}.users SET is_active = true, access_code_used = 'CODE-RACE', "
                  f"permissions = ARRAY['practice_single'] WHERE id = '{target}';")
    suspension, activate = _race(s, _rpc_sql(s, admin, target, active=False), activation)
    assert suspension[0] == 0, suspension[2]
    assert activate[0] != 0 and "account_suspended" in activate[2], activate
    assert activate[3] >= 1.0, f"the activation did not wait on the suspension ({activate[3]:.2f}s)"
    assert _state(s, target)["is_active"] is False and _state(s, target)["suspended"] is True
    assert psql(f"SELECT access_code_used IS NULL FROM {s}.users WHERE id = '{target}'") == "t"


def test_suspension_waiting_on_an_activation_suspends_after_it(db):
    s = db
    admin, target = _user(s, "admin", True), _user(s, "instructor", False)
    activation = f"UPDATE {s}.users SET is_active = true WHERE id = '{target}';"
    activate, suspension = m331._timed_race(m331._hold(activation),
                                            m326._svc(_rpc_sql(s, admin, target, active=False)))
    assert activate[0] == 0 and suspension[0] == 0, (activate[2], suspension[2])
    assert suspension[3] >= 1.0
    assert _state(s, target)["is_active"] is False and _state(s, target)["suspended"] is True
    assert [r["after"]["is_active"] for r in _audit(s, target)[1:]] == [True, False]


# ── PostgreSQL: suspension guard against every activation path ──────────────

def _suspended_instructor(s: str) -> tuple[str, str]:
    admin, target = _user(s, "admin", True), _user(s, "instructor", True)
    _suspend(s, admin, target)
    return admin, target


@pytest.mark.parametrize("path", ["self_service_activate", "self_service_promote",
                                  "admin_issued_code", "upsert", "owner_sql", "superuser_sql"])
def test_suspended_account_cannot_be_reactivated_by_any_direct_write(db, path):
    s = db
    _, target = _suspended_instructor(s)
    before = _audit(s, target)
    run, sql = {
        # routers/auth.py activate_account Step 3 (service_role, PostgREST)
        "self_service_activate": (_svc, f"UPDATE {s}.users SET is_active = true, access_code_used = 'C1', "
                                        f"permissions = ARRAY['practice_single'] WHERE id = '{target}'"),
        # …with the W-2 promote folded into the same update
        "self_service_promote": (_svc, f"UPDATE {s}.users SET is_active = true, role = 'instructor', "
                                       f"access_code_used = 'C1' WHERE id = '{target}'"),
        # routers/admin.py _activate_user_for_code
        "admin_issued_code": (_svc, f"UPDATE {s}.users SET is_active = true, access_code_used = 'C2', "
                                    f"permissions = ARRAY['practice_full'] WHERE id = '{target}'"),
        "upsert": (_svc, f"INSERT INTO {s}.users (id, email, is_active) VALUES ('{target}', 'x', true) "
                         f"ON CONFLICT (id) DO UPDATE SET is_active = true"),
        "owner_sql": (_owner, f"UPDATE {s}.users SET is_active = true WHERE id = '{target}'"),
        "superuser_sql": (psql, f"UPDATE {s}.users SET is_active = true WHERE id = '{target}'"),
    }[path]
    error = _fails(run, sql)
    assert re.search(r"ERROR:\s+account_suspended\b", error) and target in error, error
    assert _state(s, target)["is_active"] is False and _state(s, target)["suspended"] is True
    assert _audit(s, target) == before


@pytest.mark.parametrize("run", ["service", "owner", "superuser"])
def test_marker_cannot_be_cleared_or_forged_out_of_band(db, run):
    s = db
    runner = {"service": _svc, "owner": _owner, "superuser": psql}[run]
    _, target = _suspended_instructor(s)
    for sql in (f"UPDATE {s}.users SET suspended_at = NULL, suspended_by = NULL, suspension_reason = NULL "
                f"WHERE id = '{target}'",
                f"UPDATE {s}.users SET is_active = true, suspended_at = NULL, suspended_by = NULL, "
                f"suspension_reason = NULL WHERE id = '{target}'",
                f"UPDATE {s}.users SET suspension_reason = 'edited' WHERE id = '{target}'"):
        assert "account_suspended" in _fails(runner, sql)
    other = _user(s, "instructor", False)
    assert "account_suspended_marker_protected" in _fails(
        runner, f"UPDATE {s}.users SET suspended_at = now(), suspended_by = '{other}', "
                f"suspension_reason = 'forged' WHERE id = '{other}'")
    assert _state(s, target)["suspended"] is True and _state(s, other)["suspended"] is False


def test_restore_student_cannot_reactivate_a_suspended_account(db):
    """fn_restore_student(p_reactivate_account) (326) is refused as a whole."""
    s = db
    admin, target = _suspended_instructor(s)
    student = psql(f"INSERT INTO {s}.students (student_code, full_name, user_id) "
                   f"VALUES ('S-{uuid4().hex[:8]}', 'Instructor as learner', '{target}') RETURNING id")
    m326._archive(s, student, admin)
    error = _fails(lambda sql: m326._as("service_role", sql),
                   f"SELECT {s}.fn_restore_student('{student}', '{admin}', 'back', true, true)")
    assert "account_suspended" in error
    assert psql(f"SELECT archived_at IS NOT NULL FROM {s}.students WHERE id = '{student}'") == "t"
    assert _state(s, target)["is_active"] is False
    # Restoring without reactivation is unaffected.
    assert m326._restore(s, student, admin)["status"] == "restored"


def test_deactivation_without_the_marker_stays_allowed(db):
    """rollout S7 setup and the learner archive set is_active false out of band."""
    s = db
    target = _user(s, "instructor", True)
    _owner(f"UPDATE {s}.users SET is_active = false WHERE id = '{target}'")
    _owner(f"UPDATE {s}.users SET is_active = true WHERE id = '{target}'")
    assert [r["source"] for r in _audit(s, target)][1:] == ["out_of_band", "out_of_band"]


# ── PostgreSQL: fn_bootstrap_admin_recovery ─────────────────────────────────

def test_bootstrap_is_not_executable_by_service_role_or_clients(db):
    s = db
    target = _user(s, "instructor", True)
    assert "permission denied for function fn_bootstrap_admin_recovery" in _fails(_svc, _bootstrap_sql(s, target))
    for role in ("anon", "authenticated"):
        assert "permission denied" in m326._denied(role, _bootstrap_sql(s, target), target)
    assert _state(s, target)["role"] == "instructor"


def test_bootstrap_refuses_while_an_eligible_admin_exists(fresh):
    s = fresh
    _user(s, "admin", True)
    target = _user(s, "instructor", True)
    audit = psql(f"SELECT count(*) FROM {s}.staff_security_audit")
    for run in (_owner, psql):
        assert re.search(r"ERROR:\s+admins_exist\b", _fails(run, _bootstrap_sql(s, target)))
    assert _state(s, target)["role"] == "instructor"
    assert psql(f"SELECT count(*) FROM {s}.staff_security_audit") == audit


def test_bootstrap_from_zero_eligible_admins_restores_exactly_the_target(fresh):
    """rollout S7 (e): out-of-band setup to zero admins, bootstrap, revert."""
    s = fresh
    owner_admin, compromised, spare = (_user(s, "admin", True) for _ in range(3))
    learner = _user(s, "student", True)
    _suspend(s, owner_admin, compromised)
    ids = set(_owner(f"UPDATE {s}.users SET is_active = false WHERE role = 'admin' AND is_active "
                     f"AND suspended_at IS NULL RETURNING id").split())
    assert ids == {owner_admin, spare} and _active_admins(s) == 0
    # Path (d) no longer works: no actor is an active admin.
    assert "actor_not_admin" in _fails(_svc, _rpc_sql(s, owner_admin, spare, active=True))
    snapshot = psql(f"SELECT md5(string_agg(u::text, ',' ORDER BY id)) FROM {s}.users u "
                    f"WHERE id <> '{owner_admin}'")
    audit_before = psql(f"SELECT count(*) FROM {s}.staff_security_audit")
    outbox_before = psql(f"SELECT count(*) FROM {s}.owner_alert_outbox")

    audit_id = _owner(_bootstrap_sql(s, owner_admin, operator=" Vinh ", reason="drill (e) 2026-10-28"))
    assert _state(s, owner_admin) == {"role": "admin", "is_active": True, "suspended": False,
                                      "suspended_by": None, "reason": None}
    assert psql(f"SELECT md5(string_agg(u::text, ',' ORDER BY id)) FROM {s}.users u "
                f"WHERE id <> '{owner_admin}'") == snapshot, "no other account changed"
    assert int(psql(f"SELECT count(*) FROM {s}.staff_security_audit")) == int(audit_before) + 1
    assert int(psql(f"SELECT count(*) FROM {s}.owner_alert_outbox")) == int(outbox_before) + 1
    row = _audit(s, owner_admin)[-1]
    assert row["id"] == audit_id and row["event"] == "bootstrap_recovery"
    assert row["source"] == "out_of_band" and row["actor"] is None
    assert row["detail"] == {"operator": "Vinh"} and row["reason"] == "drill (e) 2026-10-28"
    assert row["before"]["is_active"] is False and row["after"]["is_active"] is True
    alert = _outbox(s, owner_admin)[-1]
    assert alert["audit_id"] == audit_id and alert["event"] == "bootstrap_recovery"
    assert alert["payload"]["operator"] == "Vinh" and alert["payload"]["actor_email"] is None

    # Once one admin exists the bootstrap refuses again, and path (d) works.
    assert "admins_exist" in _fails(_owner, _bootstrap_sql(s, spare))
    assert _rpc(s, owner_admin, spare, active=True, reason="restored by (d)")["changed"] is True
    assert _state(s, compromised)["suspended"] is True and _state(s, learner)["role"] == "student"


def test_bootstrap_clears_the_marker_of_a_suspended_target_and_validates_input(fresh):
    s = fresh
    a, b = _user(s, "admin", True), _user(s, "admin", True)
    _suspend(s, a, b)
    _owner(f"UPDATE {s}.users SET is_active = false WHERE id = '{a}'")
    for operator, reason, code in (("", "drill", "bootstrap_operator_required"),
                                   ("Vinh", "x", "invalid_reason")):
        assert code in _fails(_owner, _bootstrap_sql(s, b, operator=operator, reason=reason))
    assert "target_not_found" in _fails(_owner, _bootstrap_sql(s, str(uuid4())))
    _owner(_bootstrap_sql(s, b))
    assert _state(s, b) == {"role": "admin", "is_active": True, "suspended": False,
                            "suspended_by": None, "reason": None}
    assert _active_admins(s) == 1


def test_concurrent_bootstraps_with_no_admin_row_recover_exactly_one(fresh):
    """No users row has role='admin', so the two targets' row locks are
    disjoint. Session B must wait for A's bootstrap, then see A's admin and
    refuse admins_exist instead of recovering a second admin."""
    s = fresh
    x, y = _user(s, "instructor", True), _user(s, "instructor", False)
    _user(s, "student", True)
    assert psql(f"SELECT count(*) FROM {s}.users WHERE role = 'admin'") == "0"
    audit_before = int(psql(f"SELECT count(*) FROM {s}.staff_security_audit"))
    first, second = m331._timed_race(
        f"SET ROLE {OWNER}; BEGIN; {_bootstrap_sql(s, x, reason='race A')} "
        f"SELECT pg_sleep({m331.HOLD}); COMMIT;",
        f"SET ROLE {OWNER}; {_bootstrap_sql(s, y, reason='race B')}")
    assert first[0] == 0, first[2]
    assert second[0] != 0 and re.search(r"ERROR:\s+admins_exist\b", second[2]), second
    assert second[3] >= 1.0, f"the second bootstrap did not wait for the first ({second[3]:.2f}s)"
    assert _active_admins(s) == 1 and _state(s, x)["role"] == "admin"
    assert _state(s, y) == {"role": "instructor", "is_active": False, "suspended": False,
                            "suspended_by": None, "reason": None}
    assert int(psql(f"SELECT count(*) FROM {s}.staff_security_audit")) == audit_before + 1
    assert [r["event"] for r in _audit(s, y)] == ["staff_row_inserted"]


def test_bootstrap_refuses_a_repeatable_read_snapshot(fresh):
    """A REPEATABLE READ snapshot is taken before the advisory wait, so it
    could miss a concurrent bootstrap's admin; the function refuses it."""
    s = fresh
    target = _user(s, "instructor", True)
    for level in ("REPEATABLE READ", "SERIALIZABLE"):
        error = _fails(_owner, f"BEGIN ISOLATION LEVEL {level}; {_bootstrap_sql(s, target)} COMMIT;")
        assert re.search(r"ERROR:\s+bootstrap_requires_read_committed\b", error), error
    assert _active_admins(s) == 0 and _state(s, target)["role"] == "instructor"


# ── PostgreSQL: preconditions, postconditions, rollback ─────────────────────

def test_precondition_aborts_without_the_320_guard_and_creates_nothing():
    _require_pg()
    schema = "staff_sec_pre_" + uuid4().hex
    try:
        _build(schema, guard_320=False)
        assert "migration_320_guard_missing" in _fails(_owner, _migrated(schema))
        assert psql(f"SELECT to_regclass('{schema}.staff_security_audit') IS NULL") == "t"
        assert psql(f"SELECT count(*) FROM information_schema.columns WHERE table_schema = '{schema}' "
                    f"AND table_name = 'users' AND column_name = 'suspended_at'") == "0"
    finally:
        psql(f"DROP SCHEMA IF EXISTS {schema} CASCADE")


@pytest.mark.parametrize("tamper,revert,marker", [
    ("GRANT UPDATE ON {s}.staff_security_audit TO service_role",
     "REVOKE UPDATE ON {s}.staff_security_audit FROM service_role", "staff_security_table_privileges_wrong"),
    ("GRANT SELECT ON {s}.owner_alert_outbox TO authenticated",
     "REVOKE SELECT ON {s}.owner_alert_outbox FROM authenticated", "staff_security_table_privileges_wrong"),
    ("GRANT EXECUTE ON FUNCTION {s}." + BOOTSTRAP_SIG + " TO service_role",
     "REVOKE EXECUTE ON FUNCTION {s}." + BOOTSTRAP_SIG + " FROM service_role", "staff_security_function_acl_wrong"),
    ("GRANT EXECUTE ON FUNCTION {s}." + RPC_SIG + " TO PUBLIC",
     "REVOKE EXECUTE ON FUNCTION {s}." + RPC_SIG + " FROM PUBLIC", "staff_security_function_acl_wrong"),
    ("ALTER TABLE {s}.users DISABLE TRIGGER trg_users_suspension_guard",
     "ALTER TABLE {s}.users ENABLE TRIGGER trg_users_suspension_guard", "staff_security_trigger_missing"),
    ("ALTER TABLE {s}.staff_mfa_factor_snapshot DISABLE ROW LEVEL SECURITY",
     "ALTER TABLE {s}.staff_mfa_factor_snapshot ENABLE ROW LEVEL SECURITY", "staff_security_rls_off"),
])
def test_postcondition_block_aborts_on_drift(db, tamper, revert, marker):
    s = db
    _owner(_postcondition_sql(s))   # clean state passes
    _owner(tamper.format(s=s))
    try:
        assert marker in _fails(_owner, _postcondition_sql(s))
    finally:
        _owner(revert.format(s=s))
    _owner(_postcondition_sql(s))


def test_header_rollback_runs_keeps_the_audit_and_332_reapplies(fresh):
    s = fresh
    admin, target = _user(s, "admin", True), _user(s, "instructor", True)
    _suspend(s, admin, target)
    assert "rollback_unsafe_suspended_accounts_exist" in _fails(_owner, _rollback_sql(s))
    _rpc(s, admin, target, active=True, reason="before rollback")
    rows = psql(f"SELECT count(*) FROM {s}.staff_security_audit")
    _owner(_rollback_sql(s))
    assert psql(f"SELECT to_regprocedure('{s}.{RPC_SIG}') IS NULL") == "t"
    assert psql(f"SELECT to_regprocedure('{s}.{BOOTSTRAP_SIG}') IS NOT NULL") == "t"
    assert psql(f"SELECT count(*) FROM {s}.staff_security_audit") == rows, "audit kept"
    _svc(f"UPDATE {s}.users SET role = 'student' WHERE id = '{target}'")   # no longer audited
    assert psql(f"SELECT count(*) FROM {s}.staff_security_audit") == rows
    _apply(s)
    _svc(f"UPDATE {s}.users SET role = 'instructor' WHERE id = '{target}'")
    assert _audit(s, target)[-1]["source"] == "service"
