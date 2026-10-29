"""PC-J220: four dashboard RPCs stay callable only through the backend.

Static caller/policy checks always run. PostgreSQL checks use the real 139
definitions, Supabase default function grants, a NOSUPERUSER owner/runner and
synthetic data in disposable LOCAL databases. Set TEST_PG_URL and REQUIRE_PG=1
to require execution (PG16/PG17); no hosted environment is contacted.
"""

from __future__ import annotations

import ast
import json
import os
import re
import shutil
import subprocess
from pathlib import Path
from uuid import uuid4

import pytest

import test_migration_334_activate_attempt_rate_limit as m334
from test_migration_320_client_write_lockdown import _strip_sql_comments

BACKEND = Path(__file__).resolve().parents[1]
REPO = BACKEND.parent
MIGRATIONS = BACKEND / "migrations"
NAME = "351_dashboard_rpcs_client_revoke.sql"
SQL = (MIGRATIONS / NAME).read_text(encoding="utf-8")
CODE = _strip_sql_comments(SQL)
FUNCTIONS = (
    "fn_dashboard_daily_tokens", "fn_dashboard_tokens_called",
    "fn_dashboard_daily_visitors", "fn_dashboard_visitors",
)
SIGNATURES = tuple(f"public.{name}(timestamptz)" for name in FUNCTIONS)
RUNNER = "dashboard351_runner"
OTHER_GRANTOR = "dashboard351_other_grantor"
SINCE = "'2026-10-01T00:00:00Z'::timestamptz"
EXPECTED = {
    "fn_dashboard_daily_tokens": [{"day": "2026-10-29", "value": 4515}],
    "fn_dashboard_tokens_called": [4515],
    "fn_dashboard_daily_visitors": [{"day": "2026-10-29", "value": 3}],
    "fn_dashboard_visitors": [{"authenticated": 1, "anonymous": 2}],
}
sql = m334.sql


def _rollback_sql() -> str:
    header = SQL[SQL.index("-- Rollback."):SQL.index("\nBEGIN;")]
    return "\n".join(line[5:] for line in header.splitlines() if line.startswith("--   "))


def test_transaction_signatures_and_only_function_execute_changes():
    assert CODE.strip().startswith("BEGIN;") and CODE.strip().endswith("COMMIT;")
    assert "SET LOCAL lock_timeout = '5s';" in CODE
    revoke, = re.findall(r"REVOKE\b[^;]+;", CODE)
    assert re.sub(r"\s+", " ", revoke) == (
        f"REVOKE EXECUTE ON FUNCTION {', '.join(SIGNATURES)} FROM PUBLIC, anon, authenticated;")
    for forbidden in (r"INSERT\s+INTO", r"DELETE\s+FROM", r"^\s*UPDATE\s", r"\bTRUNCATE\b",
                      r"\b(?:CREATE|ALTER|DROP)\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|TABLE|POLICY|VIEW)",
                      r"\bCASCADE\b"):
        assert not re.search(forbidden, CODE, re.M | re.I), forbidden
    assert "fn_dashboard_daily_practices" not in CODE
    assert "to_regprocedure(signature)" in CODE and "SELECT prosecdef" in CODE
    assert "dashboard_rpcs_missing" in CODE and "dashboard_rpcs_not_security_invoker" in CODE
    for signature in SIGNATURES:
        assert CODE.count(f"'{signature}'") == 2


def test_postconditions_preserve_service_and_reject_all_client_grantors():
    assert "has_function_privilege('anon', target, 'EXECUTE')" in CODE
    assert "has_function_privilege('authenticated', target, 'EXECUTE')" in CODE
    assert "NOT has_function_privilege('service_role', target, 'EXECUTE')" in CODE
    assert "aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner)))" in CODE
    assert "a.grantee = 0" in CODE
    assert "a.grantee = 'service_role'::regrole" in CODE
    assert "GRANT EXECUTE ON FUNCTION %s TO service_role" in CODE
    for marker in ("dashboard_rpcs_client_execute_remains", "dashboard_rpcs_public_acl_remains",
                   "dashboard_rpcs_service_role_execute_missing"):
        assert marker in CODE


def test_rollback_restores_the_old_client_acl_and_warns():
    assert _rollback_sql().splitlines() == [
        "BEGIN;", "SET LOCAL lock_timeout = '5s';",
        f"GRANT EXECUTE ON FUNCTION {', '.join(SIGNATURES)} TO PUBLIC, anon, authenticated;",
        "COMMIT;",
    ]
    assert "DO NOT USE except in an emergency" in SQL
    assert "{=X/postgres,postgres=X/postgres,anon=X/postgres," in SQL


def test_forward_policy_and_readme():
    rows = [line.split("\t") for line in (MIGRATIONS / "forward-policy.tsv").read_text(
        encoding="utf-8").splitlines() if line.startswith(NAME)]
    assert len(rows) == 1 and rows[0][1:3] == ["pending_feature", "dashboard_rpcs_revoke"]
    assert "merge KHÔNG áp" in rows[0][3]
    readme = (MIGRATIONS / "README.md").read_text(encoding="utf-8")
    assert "Migration `351` (PC-J220)" in readme and "351 is PC-J220" in readme


def _tracked(prefix: str) -> list[Path]:
    result = subprocess.run(["git", "ls-files", prefix], cwd=REPO,
                            capture_output=True, text=True, check=True)
    return [REPO / line for line in result.stdout.splitlines()]


def test_step0_frontend_has_no_dashboard_rpc_calls():
    files = [path for path in _tracked("frontend")
             if path.suffix in {".js", ".mjs", ".ts", ".tsx", ".jsx", ".html"}
             and "tests" not in path.parts and "e2e" not in path.parts]
    assert len(files) > 100
    names = "(?:" + "|".join(FUNCTIONS) + ")"
    pattern = re.compile(r"\.rpc\s*\(\s*['\"`]" + names + r"['\"`]|/rest/v1/rpc/" + names + r"\b")
    assert not [str(path.relative_to(REPO)) for path in files if path.is_file()
                and pattern.search(path.read_text(encoding="utf-8", errors="ignore"))]


def test_step0_only_admin_dashboard_calls_via_supabase_admin():
    runtime = [path for directory in (BACKEND / "routers", BACKEND / "services")
               for path in directory.glob("*.py")]
    callers = [path for path in runtime
               if any(name in path.read_text(encoding="utf-8") for name in FUNCTIONS)]
    assert callers == [BACKEND / "services/admin_dashboard.py"]
    text = callers[0].read_text(encoding="utf-8")
    assert "from database import supabase_admin" in text
    tree = ast.parse(text)
    rpc_calls = [node for node in ast.walk(tree) if isinstance(node, ast.Call)
                 and isinstance(node.func, ast.Attribute) and node.func.attr == "rpc"]
    assert rpc_calls
    assert all(ast.unparse(node.func.value) == "supabase_admin" for node in rpc_calls)
    direct = {node.args[0].value for node in rpc_calls if isinstance(node.args[0], ast.Constant)}
    assert {"fn_dashboard_visitors", "fn_dashboard_tokens_called"} <= direct
    helper, = [node for node in ast.walk(tree) if isinstance(node, ast.FunctionDef)
               and node.name == "_rpc_daily"]
    assert "supabase_admin.rpc(fn_name," in ast.unparse(helper)
    helper_calls = {node.args[0].value for node in ast.walk(tree)
                    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
                    and node.func.id == "_rpc_daily" and isinstance(node.args[0], ast.Constant)}
    assert {"fn_dashboard_daily_visitors", "fn_dashboard_daily_tokens"} <= helper_calls
    for filename in ("dashboard.py", "exercises.py", "flashcards.py", "vocabulary_bank.py"):
        assert not any(name in (BACKEND / "routers" / filename).read_text(encoding="utf-8")
                       for name in FUNCTIONS)


def test_step0_admin_routes_authorize_before_reading_dashboard_data():
    tree = ast.parse((BACKEND / "routers/admin.py").read_text(encoding="utf-8"))
    for name in ("dashboard_overview", "dashboard_trends"):
        route, = [node for node in tree.body if isinstance(node, ast.AsyncFunctionDef)
                  and node.name == name]
        assert ast.unparse(route.body[1]) == "await require_admin(authorization)"


def _run(database: str, text: str, *, role: str = RUNNER) -> str:
    result = subprocess.run(
        [*m334._psql_args(database, app="dashboard351"), "-v", "VERBOSITY=verbose", "-f", "-"],
        input=f"SET ROLE {role};\n{text}", capture_output=True, text=True,
        timeout=120, env=m334._env())
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()


def _apply(database: str, text: str = SQL) -> None:
    _run(database, text)


@pytest.fixture(scope="module")
def pg_roles():
    try:
        available = bool(shutil.which("psql")) and sql("postgres", "SELECT 1") == "1"
    except Exception:
        available = False
    if not available:
        if os.environ.get("REQUIRE_PG") == "1":
            pytest.fail("Local PostgreSQL required for migration 351 verification")
        pytest.skip("Local PostgreSQL unavailable")
    assert sql("postgres", "SELECT usesuper FROM pg_user WHERE usename = current_user") == "t"
    for role, options in (("anon", "NOSUPERUSER"), ("authenticated", "NOSUPERUSER"),
                          ("service_role", "NOSUPERUSER BYPASSRLS"),
                          (RUNNER, "NOSUPERUSER NOBYPASSRLS"), (OTHER_GRANTOR, "NOSUPERUSER")):
        sql("postgres", f"""DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{role}') THEN
                CREATE ROLE {role} {options} NOLOGIN;
            END IF;
        END $$;""")
    sql("postgres", "ALTER ROLE service_role BYPASSRLS")


@pytest.fixture
def db(pg_roles):
    database = f"dashboard351_{uuid4().hex[:12]}"
    sql("postgres", f"CREATE DATABASE {database}")
    try:
        sql(database, f"""
            GRANT USAGE, CREATE ON SCHEMA public TO {RUNNER};
            GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, {OTHER_GRANTOR};
            ALTER DEFAULT PRIVILEGES FOR ROLE {RUNNER} IN SCHEMA public
                GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
        """)
        _run(database, """
            CREATE TABLE analytics_events (user_id uuid, event_name text, created_at timestamptz);
            CREATE TABLE ai_usage_logs (input_tokens int, output_tokens int, created_at timestamptz);
            CREATE TABLE sessions (status text, completed_at timestamptz);
            GRANT SELECT ON analytics_events, ai_usage_logs, sessions TO anon, authenticated, service_role;
            ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;
            ALTER TABLE ai_usage_logs ENABLE ROW LEVEL SECURITY;
            ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
            INSERT INTO analytics_events VALUES
                ('00000000-0000-0000-0000-000000000001', 'page_view', '2026-10-29T01:00:00Z'),
                ('00000000-0000-0000-0000-000000000001', 'page_view', '2026-10-29T02:00:00Z'),
                (NULL, 'page_view', '2026-10-29T03:00:00Z'),
                (NULL, 'page_view', '2026-10-29T04:00:00Z'),
                (NULL, 'click', '2026-10-29T05:00:00Z'),
                (NULL, 'page_view', '2026-09-29T01:00:00Z');
            INSERT INTO ai_usage_logs SELECT 2, 1, '2026-10-29T01:00:00Z'::timestamptz
                FROM generate_series(1, 1505);
            INSERT INTO ai_usage_logs VALUES (5000, 5000, '2026-09-29T01:00:00Z');
            INSERT INTO sessions VALUES ('completed', '2026-10-29T01:00:00Z');
        """)
        _run(database, (MIGRATIONS / "139_admin_dashboard_exact_count_rpcs.sql").read_text(
            encoding="utf-8"))
        _run(database, """
            CREATE FUNCTION fn_dashboard_visitors(text) RETURNS int LANGUAGE sql AS 'SELECT 351';
            CREATE FUNCTION unrelated_rpc() RETURNS int LANGUAGE sql AS 'SELECT 42';
        """)
        yield database
    finally:
        sql("postgres", f"DROP DATABASE {database} WITH (FORCE)")


def _call(database: str, name: str, role: str) -> list:
    expression = (f"{name}({SINCE})" if name == "fn_dashboard_tokens_called"
                  else f"to_jsonb(r) FROM public.{name}({SINCE}) r")
    out = _run(database, f"SELECT {expression};", role=role)
    return [json.loads(line) for line in out.splitlines()]


def _catalog(database: str) -> dict:
    # Normalize ACL order to compare privileges, grantors and grant options.
    return json.loads(sql(database, """SELECT jsonb_object_agg(p.oid::regprocedure::text,
        jsonb_build_object('owner', p.proowner, 'definer', p.prosecdef, 'body', p.prosrc,
            'config', p.proconfig, 'acl', (SELECT jsonb_agg(to_jsonb(a) ORDER BY
                a.grantor, a.grantee, a.privilege_type, a.is_grantable)
                FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a)))
        FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace"""))


def _tables(database: str) -> str:
    return sql(database, """SELECT jsonb_agg(to_jsonb(t) ORDER BY t.relname) FROM
        (SELECT relname, relacl, relrowsecurity, relforcerowsecurity FROM pg_class
         WHERE relnamespace = 'public'::regnamespace AND relkind = 'r') t""")


def test_revoke_twice_preserves_service_data_other_acls_and_exact_rollback(db):
    before = _catalog(db)
    tables = _tables(db)
    for role in ("anon", "authenticated"):
        assert _call(db, "fn_dashboard_tokens_called", role) == [0]
        assert _call(db, "fn_dashboard_visitors", role) == [{"authenticated": 0, "anonymous": 0}]
        assert _call(db, "fn_dashboard_daily_tokens", role) == []
        assert _call(db, "fn_dashboard_daily_visitors", role) == []
    # Prove client EXECUTE exists independently of RLS; a broad policy exposes data.
    _run(db, """CREATE POLICY probe ON analytics_events FOR SELECT USING (true);
                CREATE POLICY probe ON ai_usage_logs FOR SELECT USING (true);""")
    for role in ("anon", "authenticated", "service_role"):
        for name in FUNCTIONS:
            assert _call(db, name, role) == EXPECTED[name]
    for _ in range(2):
        _apply(db)
        for name in FUNCTIONS:
            for role in ("anon", "authenticated"):
                with pytest.raises(RuntimeError, match="42501.*permission denied for function"):
                    _call(db, name, role)
            assert _call(db, name, "service_role") == EXPECTED[name]
        after = _catalog(db)
        for signature, original in before.items():
            if signature not in {f"{name}(timestamp with time zone)" for name in FUNCTIONS}:
                assert after[signature] == original
                continue
            assert {k: v for k, v in after[signature].items() if k != "acl"} == {
                k: v for k, v in original.items() if k != "acl"}
            assert after[signature]["acl"] == [a for a in original["acl"]
                if a["grantee"] in {original["owner"], sql(db, "SELECT 'service_role'::regrole::oid")}]
        assert _tables(db) == tables
        assert sql(db, "SELECT count(*) FROM pg_policies WHERE schemaname = 'public'") == "2"
    _apply(db, _rollback_sql())
    assert _catalog(db) == before
    for role in ("anon", "authenticated"):
        for name in FUNCTIONS:
            assert _call(db, name, role) == EXPECTED[name]
    _apply(db)
    with pytest.raises(RuntimeError, match="42501"):
        _call(db, FUNCTIONS[0], "anon")


def test_service_role_gets_an_explicit_grant_when_only_public(db):
    _run(db, f"REVOKE EXECUTE ON FUNCTION {', '.join(SIGNATURES)} FROM service_role;")
    assert sql(db, f"SELECT has_function_privilege('service_role', '{SIGNATURES[0]}', 'EXECUTE')") == "t"
    _apply(db)
    for name, signature in zip(FUNCTIONS, SIGNATURES):
        assert _call(db, name, "service_role") == EXPECTED[name]
        assert sql(db, f"""SELECT count(*) FROM pg_proc p, aclexplode(p.proacl) a
            WHERE p.oid = '{signature}'::regprocedure AND a.grantee = 'service_role'::regrole
              AND a.privilege_type = 'EXECUTE'""") == "1"


def test_existing_service_role_grant_option_and_grantor_are_preserved(db):
    signature = SIGNATURES[-1]
    _run(db, f"GRANT EXECUTE ON FUNCTION {signature} TO {OTHER_GRANTOR} WITH GRANT OPTION;")
    _run(db, f"GRANT EXECUTE ON FUNCTION {signature} TO service_role WITH GRANT OPTION;",
         role=OTHER_GRANTOR)
    before = _catalog(db)
    _apply(db)
    after = _catalog(db)
    service_oid = sql(db, "SELECT 'service_role'::regrole::oid")
    for key in before:
        assert [a for a in after[key]["acl"] if a["grantee"] == service_oid] == [
            a for a in before[key]["acl"] if a["grantee"] == service_oid]
    assert _call(db, FUNCTIONS[-1], "service_role") == EXPECTED[FUNCTIONS[-1]]


@pytest.mark.parametrize("signature", SIGNATURES)
@pytest.mark.parametrize("tamper,marker", [("missing", "dashboard_rpcs_missing"),
                                          ("definer", "dashboard_rpcs_not_security_invoker")])
def test_preconditions_abort_without_changing_any_acl(db, signature, tamper, marker):
    _run(db, f"DROP FUNCTION {signature};" if tamper == "missing"
         else f"ALTER FUNCTION {signature} SECURITY DEFINER;")
    before = _catalog(db)
    with pytest.raises(RuntimeError, match=marker):
        _apply(db)
    assert _catalog(db) == before


@pytest.mark.parametrize("grantee", ["PUBLIC", "anon", "authenticated"])
def test_surviving_other_grantor_aborts_and_restores_all_acls(db, grantee):
    signature = SIGNATURES[-1]  # Check the last target: earlier revokes must roll back too.
    _run(db, f"GRANT EXECUTE ON FUNCTION {signature} TO {OTHER_GRANTOR} WITH GRANT OPTION;")
    _run(db, f"GRANT EXECUTE ON FUNCTION {signature} TO {grantee};", role=OTHER_GRANTOR)
    before = _catalog(db)
    with pytest.raises(RuntimeError, match="dashboard_rpcs_client_execute_remains"):
        _apply(db)
    assert _catalog(db) == before


def test_inherited_client_execute_also_aborts(db):
    signature = SIGNATURES[-1]
    _run(db, f"GRANT EXECUTE ON FUNCTION {signature} TO {OTHER_GRANTOR};")
    sql(db, f"GRANT {OTHER_GRANTOR} TO authenticated")
    try:
        before = _catalog(db)
        with pytest.raises(RuntimeError, match="dashboard_rpcs_client_execute_remains"):
            _apply(db)
        assert _catalog(db) == before
    finally:
        sql(db, f"REVOKE {OTHER_GRANTOR} FROM authenticated")
