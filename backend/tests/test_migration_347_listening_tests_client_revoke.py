"""Migration 347 (PC-J163, LISTENING-0005 FR-004): no client role holds any
privilege on public.listening_tests.

295 revoked every client privilege on the Listening content tables but missed
listening_tests, which kept the Supabase default grant narrowed to SELECT by
320 (staging relacl 2026-10-29: anon=r, authenticated=r). RLS with no policy
hides the rows today; one broad SELECT policy would expose every Listening
form and its answers through /rest/v1/listening_tests. 347 revokes ALL from
PUBLIC, anon and authenticated.

The static half always runs. It pins the single REVOKE, the rollback note to
the exact pre-347 grant, the forward-policy row, and Step 0 of the job: no
frontend PostgREST call and no JWT-scoped backend client names the table.

The PostgreSQL half builds a disposable database on the LOCAL cluster in
TEST_PG_URL that mimics hosted Supabase (NOSUPERUSER migration runner owning
the table, default ACLs granting ALL to anon/authenticated/service_role, the
post-320 SELECT-only client grant, RLS on with no policy, the 306 catalog view
granted to service_role only). Red: before 347 the privilege check fails and
a broad policy exposes every row to anon and authenticated. Green: after 347
(applied twice) the check passes, the same policy exposes nothing, and
service_role still reads and writes the table and the view. The rollback
note restores the exact old ACL and re-applying closes it again; every
postcondition fires on the state it guards.

Set TEST_PG_URL to a LOCAL disposable cluster and REQUIRE_PG=1 to forbid skips.
"""

from __future__ import annotations

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
NAME = "347_listening_tests_client_revoke.sql"
SQL = (MIGRATIONS / NAME).read_text(encoding="utf-8")
CODE = _strip_sql_comments(SQL)
RUNNER = "lt347_runner"
OTHER_GRANTOR = "lt347_other_grantor"
TABLE = "listening_tests"
CLIENT_ROLES = ("public", "anon", "authenticated")
TABLE_PRIVILEGES = ("SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER")
COLUMN_PRIVILEGES = ("SELECT", "INSERT", "UPDATE", "REFERENCES")
# The 295 Listening content tables that were already closed.
CLOSED_BY_295 = ("listening_content_packages", "listening_lessons", "listening_package_stimuli",
                 "listening_form_stimuli", "listening_exercises")


def _rollback_sql() -> str:
    note = SQL[SQL.index("-- Rollback"):SQL.index("\nBEGIN;")]
    return "\n".join(line[5:] for line in note.splitlines() if line.startswith("--   "))


# ── Static contract ─────────────────────────────────────────────────────────

def test_one_transaction_with_lock_timeout_and_only_the_revoke():
    assert CODE.strip().startswith("BEGIN;") and CODE.strip().endswith("COMMIT;")
    assert "SET LOCAL lock_timeout = '5s';" in CODE
    assert re.findall(r"\bREVOKE\b[^;]*;", CODE) == [
        "REVOKE ALL ON TABLE public.listening_tests FROM PUBLIC, anon, authenticated;"]
    for forbidden in (r"\bGRANT\b", r"DELETE\s+FROM", r"\bTRUNCATE\s+(?:TABLE\s+)?\w", r"^\s*UPDATE\s",
                      r"INSERT\s+INTO", r"ALTER\s+TABLE", r"CREATE\s+POLICY", r"DROP\s+POLICY",
                      r"ROW\s+LEVEL", r"CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|VIEW)", r"\bCASCADE\b"):
        assert not re.search(forbidden, CODE, re.M | re.I), forbidden


def test_295_closed_the_sibling_tables_but_not_listening_tests():
    code_295 = _strip_sql_comments((MIGRATIONS / "295_listening_content_programmes.sql").read_text(
        encoding="utf-8"))
    revoked = set(re.findall(r"REVOKE ALL ON TABLE public\.(\w+)\s+FROM PUBLIC, anon, authenticated;",
                             code_295))
    assert revoked == set(CLOSED_BY_295)
    assert TABLE not in revoked


def test_postconditions_cover_select_every_privilege_columns_and_service_role():
    post = CODE[CODE.index("REVOKE ALL"):]
    for marker in ("listening_tests_client_select_remains", "listening_tests_client_privilege_remains",
                   "listening_tests_service_role_privilege_missing"):
        assert marker in post, marker
    assert "has_table_privilege(r, 'public.listening_tests', 'SELECT')" in post
    assert "has_any_column_privilege(r, 'public.listening_tests', p)" in post
    assert "current_setting('server_version_num')::int >= 170000" in post
    assert "privileges := array_append(privileges, 'MAINTAIN');" in post
    # A multi-privilege has_table_privilege is true if ANY is held: each
    # service_role privilege is checked on its own.
    assert "NOT has_table_privilege('service_role', 'public.listening_tests', p)" in post


def test_rollback_note_restores_exactly_the_pre_347_grant_and_warns():
    assert _rollback_sql().split("\n") == [
        "BEGIN;", "SET LOCAL lock_timeout = '5s';",
        "GRANT SELECT ON public.listening_tests TO anon, authenticated;", "COMMIT;"]
    assert "DO NOT USE except in an emergency" in SQL
    assert "anon=r/postgres,authenticated=r/postgres" in SQL


def test_forward_policy_and_readme_record_347():
    rows = [line.split("\t") for line in (MIGRATIONS / "forward-policy.tsv").read_text(
        encoding="utf-8").splitlines() if line.startswith(NAME)]
    assert len(rows) == 1 and rows[0][1:3] == ["pending_feature", "listening_tests_revoke"]
    readme = (MIGRATIONS / "README.md").read_text(encoding="utf-8")
    assert "Migration `347` (PC-J163)" in readme and "347 is PC-J163" in readme


# Step 0 of the job, pinned: nobody reads listening_tests with a user JWT.

def _tracked(prefix: str) -> list[Path]:
    out = subprocess.run(["git", "ls-files", prefix], cwd=REPO, capture_output=True, text=True, check=True)
    return [REPO / line for line in out.stdout.splitlines()
            if line.endswith((".js", ".mjs", ".ts", ".tsx", ".jsx", ".html"))]


def test_step0_frontend_makes_no_postgrest_call_on_listening_tests():
    files = _tracked("frontend")
    assert len(files) > 100
    pattern = re.compile(r"""\.from\(\s*['"`]listening_tests['"`]|/rest/v1/listening_tests\b""")
    hits = [f"{path.relative_to(REPO)}:{m.group(0)}" for path in files if path.is_file()
            for m in pattern.finditer(path.read_text(encoding="utf-8", errors="ignore"))]
    assert hits == []


def test_step0_no_jwt_scoped_backend_client_names_listening_tests():
    jwt_clients = [path for path in sorted(BACKEND.rglob("*.py"))
                   if "tests" not in path.parts and "venv" not in path.parts
                   and ".venv" not in path.parts
                   and "postgrest.auth(" in path.read_text(encoding="utf-8")]
    assert {p.name for p in jwt_clients} == {"dashboard.py", "exercises.py", "flashcards.py",
                                             "vocabulary_bank.py"}
    for path in jwt_clients:
        assert TABLE not in path.read_text(encoding="utf-8"), path.name
    # Every runtime module that queries the table gets a service_role client.
    readers = [path for path in sorted((BACKEND / "routers").glob("*.py")) + sorted(
        (BACKEND / "services").glob("*.py"))
               if re.search(r"""\.table\(\s*["']listening_tests["']\)""", path.read_text(encoding="utf-8"))]
    assert readers
    for path in readers:
        text = path.read_text(encoding="utf-8")
        assert "SUPABASE_ANON_KEY" not in text, path.name
        if path.name in {"listening_source_collection.py", "listening_package_import.py"} and \
                path.parent.name == "services":
            continue  # takes `db` from routers/listening*.py, which pass supabase_admin
        assert "supabase_admin" in text, path.name
    source_router = (BACKEND / "routers" / "listening_source_collection.py").read_text(encoding="utf-8")
    assert re.findall(r"service\.\w+\((\w+)", source_router) and set(
        re.findall(r"service\.(?:published_package|source_lessons|source_forms)\((\w+)", source_router)) == {
        "supabase_admin"}


# ── PostgreSQL execution ────────────────────────────────────────────────────

sql = m334.sql


def _run(database: str, text: str, *, role: str | None = None) -> str:
    prefix = f"SET ROLE {role};\n" if role else ""
    result = subprocess.run([*m334._psql_args(database, app="lt347"), "-f", "-"],
                            input=prefix + text, capture_output=True, text=True,
                            timeout=180, env=m334._env())
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()


def _apply(database: str, text: str = SQL) -> str:
    return _run(database, text, role=RUNNER)


def _require_pg() -> None:
    try:
        available = bool(shutil.which("psql")) and sql("postgres", "SELECT 1") == "1"
    except Exception:
        available = False
    if not available:
        if os.environ.get("REQUIRE_PG") == "1":
            pytest.fail("Local PostgreSQL required for migration 347 verification")
        pytest.skip("Local PostgreSQL unavailable")
    if sql("postgres", "SELECT usesuper FROM pg_user WHERE usename = current_user") != "t":
        pytest.fail("Migration 347 fixture requires a superuser on its disposable LOCAL cluster")
    sql("postgres", f"""DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='{RUNNER}') THEN
        CREATE ROLE {RUNNER} NOSUPERUSER NOBYPASSRLS NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='{OTHER_GRANTOR}') THEN
        CREATE ROLE {OTHER_GRANTOR} NOSUPERUSER NOLOGIN;
      END IF;
    END $$;""")
    sql("postgres", "ALTER ROLE service_role BYPASSRLS")


def _maintain(database: str) -> tuple[str, ...]:
    return ("MAINTAIN",) if int(sql(database, "SHOW server_version_num")) >= 170000 else ()


def _shape(database: str) -> None:
    """Hosted-Supabase shape of listening_tests on 2026-10-29 (staging relacl)."""
    sql(database, f"""
        GRANT USAGE, CREATE ON SCHEMA public TO {RUNNER};
        GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, {OTHER_GRANTOR};
        ALTER DEFAULT PRIVILEGES FOR ROLE {RUNNER} IN SCHEMA public
            GRANT ALL ON TABLES TO anon, authenticated, service_role;""")
    _run(database, """
        CREATE TABLE listening_tests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text,
                                      status text NOT NULL, answers jsonb);
        ALTER TABLE listening_tests ENABLE ROW LEVEL SECURITY;
        -- 320 narrowed the default grant to SELECT for the client roles.
        REVOKE ALL ON listening_tests FROM anon, authenticated;
        GRANT SELECT ON listening_tests TO anon, authenticated;
        -- 306: owner view, service_role only.
        CREATE VIEW listening_public_practice_catalog WITH (security_barrier=true) AS
            SELECT t.* FROM listening_tests t WHERE t.status = 'published';
        REVOKE ALL ON listening_public_practice_catalog FROM PUBLIC, anon, authenticated;
        GRANT SELECT ON listening_public_practice_catalog TO service_role;""", role=RUNNER)
    sql(database, """INSERT INTO listening_tests (title, status, answers) VALUES
        ('Test 1', 'published', '{"1": "B"}'), ('Test 2', 'published', '{"1": "C"}'),
        ('Draft', 'draft', '{"1": "A"}')""")


def _fresh(prefix: str) -> str:
    database = f"{prefix}_{uuid4().hex[:12]}"
    sql("postgres", f"CREATE DATABASE {database}")
    _shape(database)
    return database


def _drop(database: str) -> None:
    sql("postgres", f"DROP DATABASE IF EXISTS {database} WITH (FORCE)")


def client_privilege_violations(database: str) -> list[str]:
    """The red/green check: every (role, privilege) a client role holds on
    listening_tests, table or column level. Empty is the goal."""
    out = []
    for role in CLIENT_ROLES:
        for privilege in (*TABLE_PRIVILEGES, *_maintain(database)):
            if sql(database, f"SELECT has_table_privilege('{role}', 'public.{TABLE}', '{privilege}')") == "t":
                out.append(f"{role}:{privilege}")
            elif privilege in COLUMN_PRIVILEGES and sql(
                    database, f"SELECT has_any_column_privilege('{role}', 'public.{TABLE}', "
                              f"'{privilege}')") == "t":
                out.append(f"{role}:{privilege}(column)")
    return out


def _read(database: str, role: str, relation: str = TABLE) -> str:
    """Rows `role` sees, or 42501 when the read is refused."""
    claims = json.dumps({"role": role, "sub": str(uuid4())} if role == "authenticated" else {"role": role})
    try:
        return _run(database, f"SELECT set_config('request.jwt.claims', '{claims}', false);"
                              f" SELECT count(*) FROM public.{relation};", role=role).splitlines()[-1]
    except RuntimeError as error:
        assert "permission denied" in str(error), error
        return "42501"


def _broad_policy(database: str) -> None:
    """The risk the SA named: one broad SELECT policy added later."""
    _run(database, "CREATE POLICY broad_read ON listening_tests FOR SELECT USING (true);", role=RUNNER)


def _catalog(database: str) -> dict:
    return json.loads(sql(database, """SELECT json_build_object(
        'acl', (SELECT json_object_agg(relname, relacl::text) FROM pg_class
                 WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r', 'v')),
        'rls', (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.listening_tests'::regclass),
        'policies', (SELECT json_agg(polname ORDER BY polname) FROM pg_policy
                      WHERE polrelid = 'public.listening_tests'::regclass),
        'owner', (SELECT relowner::regrole::text FROM pg_class WHERE oid = 'public.listening_tests'::regclass))"""))


def _acl(database: str) -> set[str]:
    return set(_catalog(database)["acl"][TABLE].strip("{}").split(","))


@pytest.fixture(scope="module")
def world():
    _require_pg()
    database = _fresh("lt347")
    try:
        before = {"violations": client_privilege_violations(database), "catalog": _catalog(database),
                  "reads": {r: _read(database, r) for r in ("anon", "authenticated", "service_role")}}
        _apply(database)
        _apply(database)  # re-running is a no-op
        yield {"db": database, "before": before}
    finally:
        _drop(database)


@pytest.fixture()
def pre():
    """A pre-347 database for the exploit, rollback and negative-control cases."""
    _require_pg()
    database = _fresh("lt347pre")
    try:
        yield database
    finally:
        _drop(database)


def test_red_before_347_the_client_privilege_check_fails(world):
    assert world["before"]["violations"] == ["anon:SELECT", "authenticated:SELECT"]
    # RLS with no policy is all that hides the rows today.
    assert world["before"]["reads"] == {"anon": "0", "authenticated": "0", "service_role": "3"}
    assert world["before"]["catalog"]["rls"] is True and world["before"]["catalog"]["policies"] is None


def test_green_after_347_the_client_privilege_check_passes(world):
    assert client_privilege_violations(world["db"]) == []
    for role in ("anon", "authenticated"):
        assert sql(world["db"], f"SELECT has_table_privilege('{role}', 'public.{TABLE}', 'SELECT')") == "f"


def test_a_broad_policy_exposes_every_row_before_347_and_nothing_after(pre):
    _broad_policy(pre)
    assert _read(pre, "anon") == "3" and _read(pre, "authenticated") == "3"
    _apply(pre)
    assert _read(pre, "anon") == "42501" and _read(pre, "authenticated") == "42501"
    assert _read(pre, "service_role") == "3"


def test_service_role_view_owner_rls_and_rows_are_unchanged(world):
    database, before = world["db"], world["before"]["catalog"]
    after = _catalog(database)
    assert after["rls"] == before["rls"] and after["policies"] == before["policies"]
    assert after["owner"] == before["owner"] == RUNNER
    old = set(before["acl"][TABLE].strip("{}").split(","))
    assert _acl(database) == {e for e in old if not e.startswith(("anon=", "authenticated=", "="))}
    assert {k: v for k, v in after["acl"].items() if k != TABLE} == (
        {k: v for k, v in before["acl"].items() if k != TABLE})
    assert _read(database, "service_role") == "3"
    assert _read(database, "service_role", "listening_public_practice_catalog") == "2"
    for role in ("anon", "authenticated"):
        assert _read(database, role, "listening_public_practice_catalog") == "42501"
    # The backend path still writes (import, publish, delete).
    _run(database, """BEGIN;
        INSERT INTO listening_tests (title, status) VALUES ('New', 'draft');
        UPDATE listening_tests SET status = 'published' WHERE title = 'New';
        DELETE FROM listening_tests WHERE title = 'New';
        ROLLBACK;""", role="service_role")
    assert sql(database, "SELECT count(*) FROM listening_tests") == "3"


def test_rollback_note_restores_the_exact_old_acl_and_re_apply_closes_it(pre):
    old = _acl(pre)
    _apply(pre)
    _apply(pre, _rollback_sql())
    assert _acl(pre) == old
    assert client_privilege_violations(pre) == ["anon:SELECT", "authenticated:SELECT"]
    _apply(pre)
    assert client_privilege_violations(pre) == []


def _mutated(old: str, new: str) -> str:
    assert old in SQL, old
    return SQL.replace(old, new)


NEGATIVE = {
    # A client grant made by another grantor survives the runner's REVOKE.
    "other_grantor_select": (
        f"GRANT SELECT ON listening_tests TO {OTHER_GRANTOR} WITH GRANT OPTION;"
        f" SET ROLE {OTHER_GRANTOR}; GRANT SELECT ON listening_tests TO anon;",
        SQL, "listening_tests_client_select_remains: anon"),
    "other_grantor_column": (
        f"GRANT SELECT (id, answers) ON listening_tests TO {OTHER_GRANTOR} WITH GRANT OPTION;"
        f" SET ROLE {OTHER_GRANTOR}; GRANT SELECT (answers) ON listening_tests TO authenticated;",
        SQL, "listening_tests_client_privilege_remains: authenticated:SELECT"),
    "other_grantor_public_write": (
        f"GRANT INSERT ON listening_tests TO {OTHER_GRANTOR} WITH GRANT OPTION;"
        f" SET ROLE {OTHER_GRANTOR}; GRANT INSERT ON listening_tests TO PUBLIC;",
        SQL, "listening_tests_client_privilege_remains: anon:INSERT, authenticated:INSERT, public:INSERT"),
    "service_role_lost_insert": (
        "REVOKE INSERT ON listening_tests FROM service_role;",
        SQL, "listening_tests_service_role_privilege_missing: INSERT"),
    "table_missing": (
        "DROP TABLE listening_tests CASCADE;", SQL, "listening_tests_missing"),
    "revoke_skips_authenticated": (
        "", _mutated("FROM PUBLIC, anon, authenticated;", "FROM PUBLIC, anon;"),
        "listening_tests_client_select_remains: authenticated"),
}


@pytest.mark.parametrize("case", sorted(NEGATIVE))
def test_postcondition_rejects_an_unsafe_state(pre, case):
    setup, text, marker = NEGATIVE[case]
    if setup:
        sql(pre, setup)
    before = _catalog(pre) if case != "table_missing" else None
    with pytest.raises(RuntimeError, match=re.escape(marker)):
        _apply(pre, text)
    if before is not None:
        # The failed run left nothing behind (one transaction).
        assert _catalog(pre) == before
        assert sql(pre, "SELECT count(*) FROM listening_tests") == "3"
