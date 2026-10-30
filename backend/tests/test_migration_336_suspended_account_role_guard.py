"""Migration 336 (ADMINAAL2-0032 FR-019, T015): the role of a suspended
account is frozen until an admin reactivates it (Vinh, decision 1A,
2026-10-28 17:53).

The static half pins the migration text: the trigger event, its name order
after 332's suspension guard, the single error code, the bootstrap-only
exemption and the forward-policy group.

The PostgreSQL half reuses the 332 harness (NOSUPERUSER owner, Supabase default
privileges, 320 guard, 326, 332). It applies 336 twice and proves:

- a role change of a suspended account is refused through
  fn_set_staff_privilege (alone, combined with reactivation, any target role)
  and every direct path (service REST, upsert, owner, superuser), and nothing
  changes;
- the same change succeeds once the account is reactivated;
- repeating the current role stays a no-op, and activation with a role still
  fails as `account_suspended`;
- a demotion waiting on a suspension's row lock is refused after it commits;
- the owner-only bootstrap still restores a suspended target;
- the precondition, postcondition and header rollback.

Set TEST_PG_URL to a LOCAL disposable cluster and REQUIRE_PG=1 to forbid skips.
"""

from __future__ import annotations

import re
from pathlib import Path
from uuid import uuid4

import pytest

import test_migration_326_student_archive as m326
import test_migration_331_archived_student_give_guard as m331
import test_migration_332_staff_security_audit as m332
from test_migration_240_core_attempt_evidence import psql

BACKEND = Path(__file__).resolve().parents[1]
MIGRATIONS = BACKEND / "migrations"
NAME = "336_suspended_account_role_guard.sql"
SQL = (MIGRATIONS / NAME).read_text(encoding="utf-8")
CODE = m326._strip_comments(SQL)
FN_SIG = "fn_users_suspension_role_guard()"
ERROR = "account_suspended_role_change"

_user, _state, _audit, _rpc, _rpc_sql, _suspend = (
    m332._user, m332._state, m332._audit, m332._rpc, m332._rpc_sql, m332._suspend)
_svc, _owner, _fails = m332._svc, m332._owner, m332._fails


# ── Static contract ─────────────────────────────────────────────────────────

def test_one_transaction_with_lock_timeout_and_no_data_change():
    assert CODE.strip().startswith("BEGIN;") and CODE.strip().endswith("COMMIT;")
    assert "SET LOCAL lock_timeout = '5s';" in CODE
    top = m332._without_bodies(CODE)
    for forbidden in (r"\bDROP\b", r"DELETE\s+FROM", r"\bTRUNCATE\b", r"^\s*UPDATE\s",
                      r"INSERT\s+INTO", r"DISABLE\s+TRIGGER", r"session_replication_role"):
        assert not re.search(forbidden, top, re.M | re.I), forbidden


def test_trigger_fires_on_role_and_sorts_after_the_332_guard():
    assert re.search(
        r"CREATE OR REPLACE TRIGGER trg_users_suspension_role_guard\s+BEFORE UPDATE OF role "
        r"ON public\.users\s+FOR EACH ROW EXECUTE FUNCTION public\.fn_users_suspension_role_guard\(\);",
        CODE)
    # BEFORE triggers fire in name order: 320's client guard, then 332's
    # activation guard (so activation + promote stays `account_suspended`).
    assert "trg_users_guard_privileged_columns" < "trg_users_suspension_guard" < "trg_users_suspension_role_guard"


def test_guard_raises_one_code_and_exempts_only_the_bootstrap():
    fn = m326._function(SQL, "fn_users_suspension_role_guard")
    assert "SECURITY DEFINER" not in fn
    assert "NEW.role IS DISTINCT FROM OLD.role AND OLD.suspended_at IS NOT NULL" in fn
    assert re.findall(r"RAISE EXCEPTION '([a-z_]+)'", fn) == [ERROR]
    assert fn.count("ERRCODE = 'P0001'") == 1 and "DETAIL = OLD.id::text" in fn
    assert fn.index("current_setting('aver.bootstrap', true), '') = 'on'") < fn.index("RAISE")
    # The RPC's bypass must not open this guard: the RPC itself is refused.
    assert "staff_privilege" not in m326._strip_comments(fn)
    # …and only the owner-only bootstrap sets aver.bootstrap in 332.
    sets = [m.start() for m in re.finditer(r"set_config\('aver\.bootstrap', 'on', true\)", m332.SQL)]
    bootstrap = m326._function(m332.SQL, "fn_bootstrap_admin_recovery")
    assert len(sets) == 1 and "set_config('aver.bootstrap', 'on', true)" in bootstrap
    assert re.search(r"REVOKE ALL ON FUNCTION public\.fn_users_suspension_role_guard\(\)\s+"
                     r"FROM PUBLIC, anon, authenticated, service_role;", CODE)
    assert not re.search(r"GRANT[^;]*fn_users_suspension_role_guard", CODE)


def test_forward_policy_no_longer_holds_336_or_332_after_their_production_release():
    # PC-J354: both are in the staging and production ledgers; no policy row.
    rows = {line.split("\t")[0]: line.split("\t")[1:3] for line in (MIGRATIONS / "forward-policy.tsv").read_text(
        encoding="utf-8").splitlines() if line and not line.startswith("#")}
    assert NAME not in rows and m332.NAME not in rows
    assert all(group != "admin_aal2" for _state, group in rows.values())
    readme = (MIGRATIONS / "README.md").read_text(encoding="utf-8")
    assert "Migration `336` (ADMINAAL2-0032 FR-019" in readme and ERROR in readme


def test_role_route_maps_only_the_exact_database_error():
    admin = (BACKEND / "routers" / "admin.py").read_text(encoding="utf-8")
    assert f'_SUSPENDED_ROLE_CHANGE_CODE = "{ERROR}"' in admin
    assert 'str(code or "") == "P0001" and message == _SUSPENDED_ROLE_CHANGE_CODE' in admin


# ── PostgreSQL harness ──────────────────────────────────────────────────────

def _migrated(schema: str) -> str:
    return m331._schema_sql(SQL, schema)


def _rollback_sql(schema: str) -> str:
    header = SQL[SQL.index("-- ROLLBACK"):SQL.index("\nBEGIN;\n")]
    lines = [line[5:] for line in header.splitlines() if line.startswith("--   ")]
    return m331._schema_sql("\n".join(lines), schema)


def _postcondition_sql(schema: str) -> str:
    return m331._schema_sql(SQL[SQL.rindex("DO $$"):SQL.rindex("COMMIT;")], schema)


def _apply(schema: str) -> None:
    _owner(_migrated(schema))


def _schema(prefix: str, *, with_336: bool = True):
    m332._require_pg()
    schema = prefix + uuid4().hex
    m332._build(schema)
    m332._apply(schema)
    if with_336:
        _apply(schema)
    return schema


@pytest.fixture(scope="module")
def db():
    schema = None
    try:
        schema = _schema("susp_role_")
        _apply(schema)   # re-applying is a no-op
        yield schema
    finally:
        if schema:
            psql(f"DROP SCHEMA IF EXISTS {schema} CASCADE")


@pytest.fixture
def fresh():
    schema = None
    try:
        schema = _schema("susp_role_fresh_")
        yield schema
    finally:
        if schema:
            psql(f"DROP SCHEMA IF EXISTS {schema} CASCADE")


def _snapshot(s: str) -> tuple[str, str]:
    return (psql(f"SELECT md5(string_agg(u::text, ',' ORDER BY id)) FROM {s}.users u"),
            psql(f"SELECT count(*) FROM {s}.staff_security_audit"))


def _suspended(s: str, role: str = "instructor") -> tuple[str, str]:
    admin, target = _user(s, "admin", True), _user(s, role, True)
    _suspend(s, admin, target)
    return admin, target


def _refused(error: str, target: str) -> None:
    assert re.search(rf"ERROR:\s+{ERROR}\b", error) and target in error, error


# ── PostgreSQL: catalog ─────────────────────────────────────────────────────

def test_catalog_after_apply_and_rerun(db):
    s = db
    triggers = psql(f"""SELECT string_agg(tgname || ':' || tgenabled::text, ',' ORDER BY tgname) FROM pg_trigger
                        WHERE tgrelid = '{s}.users'::regclass AND NOT tgisinternal""")
    assert triggers == ("trg_users_guard_privileged_columns:O,trg_users_privilege_audit:O,"
                        "trg_users_suspension_guard:O,trg_users_suspension_role_guard:O"), triggers
    for role in ("anon", "authenticated", "service_role"):
        assert psql(f"SELECT has_function_privilege('{role}', '{s}.{FN_SIG}', 'EXECUTE')") == "f", role
    assert psql(f"SELECT prosecdef FROM pg_proc WHERE oid = '{s}.{FN_SIG}'::regprocedure") == "f"


# ── PostgreSQL: FR-019 refusals ─────────────────────────────────────────────

@pytest.mark.parametrize("target_role,kwargs", [
    ("instructor", {"role": "student", "reason": None}),
    ("instructor", {"role": "admin", "reason": None}),
    ("instructor", {"role": "student", "active": True, "reason": "back, as a learner"}),
    ("admin", {"role": "instructor", "reason": None}),
    ("admin", {"role": "student", "active": True, "reason": "back, demoted"}),
])
def test_rpc_refuses_a_role_change_of_a_suspended_account(db, target_role, kwargs):
    s = db
    admin, target = _suspended(s, target_role)
    before = _snapshot(s)
    _refused(_fails(_svc, _rpc_sql(s, admin, target, **kwargs)), target)
    assert _snapshot(s) == before, "role, marker and audit unchanged"
    assert _state(s, target)["role"] == target_role and _state(s, target)["suspended"] is True


def test_rpc_repeating_the_current_role_of_a_suspended_account_is_a_no_op(db):
    s = db
    admin, target = _suspended(s)
    before = _snapshot(s)
    result = _rpc(s, admin, target, role="instructor", reason=None)
    assert result["changed"] is False and _snapshot(s) == before
    # Re-suspending the same account is the 332 no-op as well.
    assert _suspend(s, admin, target)["changed"] is False


@pytest.mark.parametrize("path", ["service_update", "upsert", "owner_sql", "superuser_sql"])
def test_every_direct_path_is_refused_too(db, path):
    """PATCH /admin/users/{id}/role still writes users.role directly (service
    REST); the SQL editor runs as the owner or a superuser."""
    s = db
    _, target = _suspended(s)
    before = _snapshot(s)
    run, sql = {
        "service_update": (_svc, f"UPDATE {s}.users SET role = 'student' WHERE id = '{target}'"),
        "upsert": (_svc, f"INSERT INTO {s}.users (id, email, role) VALUES ('{target}', 'x', 'student') "
                         f"ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role"),
        "owner_sql": (_owner, f"UPDATE {s}.users SET role = 'student' WHERE id = '{target}'"),
        "superuser_sql": (psql, f"UPDATE {s}.users SET role = 'student' WHERE id = '{target}'"),
    }[path]
    _refused(_fails(run, sql), target)
    assert _snapshot(s) == before
    # Writing the same role again is not a change and stays allowed.
    run(f"UPDATE {s}.users SET role = 'instructor', display_name = 'same role' WHERE id = '{target}'")
    assert _state(s, target)["role"] == "instructor"


def test_activation_with_a_role_on_a_suspended_account_is_still_account_suspended(db):
    """FR-018 mapping is unchanged: the 332 guard fires first by name order."""
    s = db
    _, target = _suspended(s, "admin")
    error = _fails(_svc, f"UPDATE {s}.users SET is_active = true, role = 'instructor', "
                         f"access_code_used = 'C1' WHERE id = '{target}'")
    assert re.search(r"ERROR:\s+account_suspended\n", error) and ERROR not in error, error
    assert _state(s, target)["role"] == "admin"


# ── PostgreSQL: reactivate first, then change the role ─────────────────────

def test_role_change_succeeds_after_reactivation_through_the_rpc(db):
    s = db
    admin, target = _suspended(s)
    _refused(_fails(_svc, _rpc_sql(s, admin, target, role="student", reason=None)), target)

    reactivated = _rpc(s, admin, target, active=True, reason="cleared after review")
    assert reactivated["changed"] is True and _state(s, target)["suspended"] is False
    demoted = _rpc(s, admin, target, role="student", reason=None)
    assert demoted["changed"] is True and demoted["after"]["role"] == "student"
    assert [r["event"] for r in _audit(s, target)][-3:] == ["active_changed", "active_changed", "role_changed"]


def test_role_change_succeeds_after_reactivation_through_the_direct_route(db):
    s = db
    admin, target = _suspended(s)
    _refused(_fails(_svc, f"UPDATE {s}.users SET role = 'student' WHERE id = '{target}'"), target)
    _rpc(s, admin, target, active=True, reason="cleared after review")
    _svc(f"UPDATE {s}.users SET role = 'student' WHERE id = '{target}'")
    assert _state(s, target)["role"] == "student"
    assert _audit(s, target)[-1]["event"] == "role_changed" and _audit(s, target)[-1]["source"] == "service"


def test_accounts_without_the_marker_are_unaffected(db):
    s = db
    active, never, deactivated = (_user(s, "instructor", True), _user(s, "instructor", False),
                                  _user(s, "instructor", True))
    _owner(f"UPDATE {s}.users SET is_active = false WHERE id = '{deactivated}'")   # no marker
    for uid in (active, never, deactivated):
        _svc(f"UPDATE {s}.users SET role = 'student' WHERE id = '{uid}'")
        assert _state(s, uid)["role"] == "student"


def test_demotion_waiting_on_a_suspension_is_refused_after_it_commits(db):
    """The direct role write waits on the suspension's row lock, re-reads the
    committed row and is refused."""
    s = db
    admin, target = _user(s, "admin", True), _user(s, "instructor", True)
    demotion = f"UPDATE {s}.users SET role = 'student' WHERE id = '{target}';"
    suspension, demote = m332._race(s, _rpc_sql(s, admin, target, active=False), demotion)
    assert suspension[0] == 0, suspension[2]
    assert demote[0] != 0 and ERROR in demote[2], demote
    assert demote[3] >= 1.0, f"the demotion did not wait on the suspension ({demote[3]:.2f}s)"
    assert _state(s, target)["role"] == "instructor" and _state(s, target)["suspended"] is True


# ── PostgreSQL: the bootstrap stays the one exemption ───────────────────────

def test_bootstrap_still_restores_a_suspended_instructor_to_admin(fresh):
    s = fresh
    admin, target = _suspended(s)
    _owner(f"UPDATE {s}.users SET is_active = false WHERE id = '{admin}'")   # rollout S7: zero admins
    _owner(m332._bootstrap_sql(s, target))
    assert _state(s, target) == {"role": "admin", "is_active": True, "suspended": False,
                                 "suspended_by": None, "reason": None}
    assert _audit(s, target)[-1]["event"] == "bootstrap_recovery"
    # The exemption is transaction-local: the next write is guarded again.
    other = _user(s, "instructor", True)
    _suspend(s, target, other)
    _refused(_fails(_owner, f"UPDATE {s}.users SET role = 'student' WHERE id = '{other}'"), other)


# ── PostgreSQL: preconditions, postconditions, rollback ─────────────────────

def test_precondition_aborts_without_332_and_creates_nothing():
    m332._require_pg()
    schema = "susp_role_pre_" + uuid4().hex
    try:
        m332._build(schema)
        assert "migration_332_missing" in _fails(_owner, _migrated(schema))
        assert psql(f"SELECT to_regprocedure('{schema}.{FN_SIG}') IS NULL") == "t"
    finally:
        psql(f"DROP SCHEMA IF EXISTS {schema} CASCADE")


def test_aborts_while_a_suspended_row_holds_a_non_staff_role_then_applies_after_repair():
    """The exact 1A failure mode: before 336 the RPC demotes a suspended
    instructor, leaving a row FR-006 cannot reactivate (target_not_staff)."""
    schema = None
    try:
        schema = _schema("susp_role_dirty_", with_336=False)
        s = schema
        admin, target = _suspended(s)
        assert _rpc(s, admin, target, role="student", reason=None)["changed"] is True
        assert "target_not_staff" in _fails(_svc, _rpc_sql(s, admin, target, active=True, reason="restore"))

        error = _fails(_owner, _migrated(s))
        assert "suspended_non_staff_account_exists: 1" in error, error
        assert psql(f"SELECT to_regprocedure('{s}.{FN_SIG}') IS NULL") == "t", "rolled back"

        _owner(f"UPDATE {s}.users SET role = 'instructor' WHERE id = '{target}'")   # out-of-band repair
        _apply(s)
        assert _rpc(s, admin, target, active=True, reason="restore")["changed"] is True
    finally:
        if schema:
            psql(f"DROP SCHEMA IF EXISTS {schema} CASCADE")


@pytest.mark.parametrize("tamper,revert,marker", [
    ("GRANT EXECUTE ON FUNCTION {s}." + FN_SIG + " TO service_role",
     "REVOKE EXECUTE ON FUNCTION {s}." + FN_SIG + " FROM service_role", "suspension_role_guard_function_acl_wrong"),
    ("GRANT EXECUTE ON FUNCTION {s}." + FN_SIG + " TO PUBLIC",
     "REVOKE EXECUTE ON FUNCTION {s}." + FN_SIG + " FROM PUBLIC", "suspension_role_guard_function_acl_wrong"),
    ("ALTER FUNCTION {s}." + FN_SIG + " SECURITY DEFINER",
     "ALTER FUNCTION {s}." + FN_SIG + " SECURITY INVOKER", "suspension_role_guard_function_acl_wrong"),
    ("ALTER TABLE {s}.users DISABLE TRIGGER trg_users_suspension_role_guard",
     "ALTER TABLE {s}.users ENABLE TRIGGER trg_users_suspension_role_guard", "suspension_role_guard_trigger_missing"),
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


def test_header_rollback_runs_and_336_reapplies(fresh):
    s = fresh
    admin, target = _suspended(s)
    _owner(_rollback_sql(s))
    assert psql(f"SELECT to_regprocedure('{s}.{FN_SIG}') IS NULL") == "t"
    assert psql(f"SELECT count(*) FROM pg_trigger WHERE tgrelid = '{s}.users'::regclass "
                f"AND tgname = 'trg_users_suspension_role_guard'") == "0"
    # 332's guards stay; only the role freeze is gone.
    assert "account_suspended" in _fails(_svc, f"UPDATE {s}.users SET is_active = true WHERE id = '{target}'")
    _apply(s)
    _refused(_fails(_svc, _rpc_sql(s, admin, target, role="student", reason=None)), target)
