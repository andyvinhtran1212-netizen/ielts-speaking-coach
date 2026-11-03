"""mig 357 (PC-J365/1h1, SVCPRIV-0042 FR-009): no CREATE on schema public for API roles.

Static checks always run. The PostgreSQL half builds disposable databases on
the LOCAL cluster in TEST_PG_URL with a NOSUPERUSER runner and genuine
NOSUPERUSER anon/authenticated/service_role (P3-SA-8: every probe runs
``SET LOCAL ROLE`` and ``ASSERT current_user`` in one transaction). It proves,
red before 357 and green after it:

* Scenario 8 / SA P2-SA-2: ``service_role`` plants ``public.lower(varchar)``
  and ``public.jsonb_build_object(text,uuid,text,text)`` and an owner-run
  ``SECURITY DEFINER`` RPC (``search_path = public, pg_temp``) runs them as the
  owner, with table maintenance rights already revoked; after 357 both CREATEs
  fail with 42501 and the RPC is unchanged.
* SA-R4-3 (#2050): a planted ``public.has_table_privilege(text,text,text)``
  hides TRIGGER drift from the real 341 users postcondition, even with
  ``pg_catalog`` first in search_path; after 357 it cannot be planted.

It also covers the staging and production schema ACL shapes, idempotence, the
no-op down and every fail-closed postcondition. Set TEST_PG_URL and
REQUIRE_PG=1 to forbid skips (PG16 and PG17).
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path
from uuid import uuid4

import pytest

import test_migration_334_activate_attempt_rate_limit as m334
from test_migration_320_client_write_lockdown import _strip_sql_comments
from test_public_schema_create_guard import find_public_schema_create_grants

BACKEND = Path(__file__).resolve().parents[1]
MIGRATIONS = BACKEND / "migrations"
NAME = "357_public_schema_create_revoke.sql"
SQL = (MIGRATIONS / NAME).read_text(encoding="utf-8")
CODE = _strip_sql_comments(SQL)
DOWN = (MIGRATIONS / "rollback" / NAME).read_text(encoding="utf-8")
SQL_341 = (MIGRATIONS / "341_staff_guc_and_ai_override_hardening.sql").read_text(encoding="utf-8")
API_ROLES = ("service_role", "anon", "authenticated")
RUNNER = "mig357_runner"
OTHER = "mig357_other"
USER_ID = "00000000-0000-0000-0000-000000000001"
RPC_RESULT = f'{{"id": "{USER_ID}", "email": "a@x.io"}}'
OVERLOADS = {
    "public.lower(v varchar)": "RETURNS text LANGUAGE plpgsql AS $f$ BEGIN "
    "INSERT INTO public.mig357_marker VALUES ('lower:' || current_user); "
    "RETURN pg_catalog.lower(v::text); END $f$",
    "public.jsonb_build_object(a text, b uuid, c text, d text)": "RETURNS jsonb LANGUAGE plpgsql AS $f$ BEGIN "
    "INSERT INTO public.mig357_marker VALUES ('jsonb:' || current_user); "
    "RETURN pg_catalog.jsonb_build_object(a, b, c, d); END $f$",
}
DROP_SIGNATURES = {
    "public.lower(v varchar)": "public.lower(varchar)",
    "public.jsonb_build_object(a text, b uuid, c text, d text)": "public.jsonb_build_object(text, uuid, text, text)",
}
HAS_TABLE_PRIVILEGE_PLANT = """CREATE FUNCTION public.has_table_privilege(text, text, text)
    RETURNS boolean LANGUAGE sql VOLATILE AS $f$
    INSERT INTO public.mig357_marker VALUES ('has_table_privilege:' || current_user);
    SELECT CASE WHEN $2 LIKE '%.users' THEN false
                ELSE pg_catalog.has_table_privilege($1::name, $2, $3) END $f$"""
STAGING_ACL = (f"{{{RUNNER}=UC/{RUNNER},anon=U/{RUNNER},authenticated=U/{RUNNER},"
               f"service_role=UC/{RUNNER}}}")
sql = m334.sql


# ── Static contract ─────────────────────────────────────────────────────────

def test_transaction_lock_timeout_search_path_and_exact_revoke():
    code = CODE.strip()
    assert code.startswith("BEGIN;") and code.endswith("COMMIT;")
    assert "SET LOCAL lock_timeout = '5s';" in code
    assert "SET LOCAL search_path = pg_catalog, pg_temp;" in code
    revoke, = re.findall(r"\bREVOKE\b[^;]+;", code)
    assert revoke == "REVOKE CREATE ON SCHEMA public FROM service_role, anon, authenticated, PUBLIC;"
    for forbidden in (r"\bGRANT\b", r"\bALTER\b", r"\bDROP\b", r"\bCREATE\s+(?:OR\s+REPLACE\s+)?"
                      r"(?:FUNCTION|TABLE|POLICY|VIEW|TRIGGER|OPERATOR|TYPE)", r"INSERT\s+INTO",
                      r"DELETE\s+FROM", r"^\s*UPDATE\s", r"\bTRUNCATE\b", r"\bCASCADE\b"):
        assert not re.search(forbidden, code, re.M | re.I), forbidden


def test_postconditions_are_fail_closed():
    for marker in ("public_schema_missing", "public_schema_owned_by_api_role",
                   "public_schema_create_acl_remains", "public_schema_create_effective",
                   "public_pg_catalog_name_shadow"):
        assert f"RAISE EXCEPTION '{marker}" in CODE
    for notice in ("public_schema_create_grant: grantee=% grantor=%",
                   "public_routine_owned_by_api_role"):
        assert f"RAISE NOTICE '{notice}" in CODE
    assert "shadow_allowlist CONSTANT text[] := ARRAY[]::text[];" in CODE
    assert "pg_catalog.pg_has_role(r.rolname, m.oid, 'MEMBER')" in CODE
    assert "pg_catalog.has_schema_privilege(m.oid, 'public', 'CREATE')" in CODE
    assert CODE.count("COALESCE(n.nspacl, pg_catalog.acldefault('n', n.nspowner))") == 2
    assert "FROM pg_catalog.pg_proc p" in CODE and "FROM pg_catalog.pg_operator o" in CODE


def test_down_is_a_noop_and_the_guard_would_catch_a_regrant():
    down = _strip_sql_comments(DOWN)
    assert "mig357_down_noop" in down
    assert not re.search(r"\b(?:GRANT|REVOKE|ALTER|CREATE|DROP)\b", re.sub(r"'[^']*'", "''", down), re.I)
    assert find_public_schema_create_grants(DOWN) == []
    assert find_public_schema_create_grants(SQL) == []
    # Minimal FR-006 check on this down: a re-grant would be flagged.
    for grantee in ("service_role", "anon", "authenticated", "PUBLIC"):
        mutated = DOWN + f"\nGRANT CREATE ON SCHEMA public TO {grantee};\n"
        assert find_public_schema_create_grants(mutated) == [DOWN.count("\n") + 2]


def test_forward_policy_row():
    rows = [line.split("\t") for line in (MIGRATIONS / "forward-policy.tsv").read_text(
        encoding="utf-8").splitlines() if line.startswith(NAME)]
    assert len(rows) == 1 and rows[0][1:3] == ["pending_feature", "public_schema_create_revoke"]
    assert "Merge KHÔNG áp" in rows[0][3] and "mig 357 (PC-J365/1h1" in rows[0][3]


# ── PostgreSQL harness ──────────────────────────────────────────────────────

def _psql(database: str, text: str, *, role: str | None = None) -> tuple[str, str]:
    """Run a script in one psql session; return (stdout, stderr incl. NOTICEs)."""
    prefix = f"SET ROLE {role};\n" if role else ""
    result = subprocess.run(
        [*m334._psql_args(database, app="mig357"), "-v", "VERBOSITY=verbose", "-f", "-"],
        input=prefix + text, capture_output=True, text=True, timeout=120, env=m334._env())
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip(), result.stderr


def _runner(database: str, text: str) -> str:
    return _psql(database, text, role=RUNNER)[0]


def _apply(database: str, text: str = SQL) -> str:
    return _psql(database, text, role=RUNNER)[1]


def _as(database: str, role: str, body: str) -> str:
    """P3-SA-8: genuine role in one transaction."""
    return _psql(database, f"""BEGIN;
SET LOCAL ROLE {role};
DO $a$ BEGIN ASSERT current_user = '{role}'; END $a$;
{body}
COMMIT;""")[0]


def _acl(database: str) -> str:
    return sql(database, "SELECT nspacl::text FROM pg_namespace WHERE nspname = 'public'")


def _can_create(database: str) -> dict[str, bool]:
    return {role: sql(database, f"SELECT has_schema_privilege('{role}', 'public', 'CREATE')") == "t"
            for role in API_ROLES}


def _usage(database: str) -> dict[str, bool]:
    return {role: sql(database, f"SELECT has_schema_privilege('{role}', 'public', 'USAGE')") == "t"
            for role in API_ROLES}


def _marker(database: str) -> list[str]:
    out = sql(database, "SELECT note FROM public.mig357_marker ORDER BY note")
    return out.splitlines() if out else []


@pytest.fixture(scope="module")
def pg_roles():
    try:
        available = bool(shutil.which("psql")) and sql("postgres", "SELECT 1") == "1"
    except Exception:
        available = False
    if not available:
        if os.environ.get("REQUIRE_PG") == "1":
            pytest.fail("Local PostgreSQL required for migration 357 verification")
        pytest.skip("Local PostgreSQL unavailable")
    assert sql("postgres", "SELECT usesuper FROM pg_user WHERE usename = current_user") == "t"
    for role, options in (("anon", "NOSUPERUSER"), ("authenticated", "NOSUPERUSER"),
                          ("service_role", "NOSUPERUSER BYPASSRLS"),
                          (RUNNER, "NOSUPERUSER NOBYPASSRLS"), (OTHER, "NOSUPERUSER")):
        sql("postgres", f"""DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{role}') THEN
                CREATE ROLE {role} {options} NOLOGIN;
            END IF;
        END $$;""")
    sql("postgres", "ALTER ROLE service_role BYPASSRLS")
    assert sql("postgres", f"""SELECT string_agg(rolname || '=' || rolsuper, ',' ORDER BY rolname)
        FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role', '{RUNNER}')""") == (
        f"anon=false,authenticated=false,{RUNNER}=false,service_role=false")


def _new_database(owner: str | None = None) -> str:
    database = f"mig357_{uuid4().hex[:12]}"
    sql("postgres", f"CREATE DATABASE {database}" + (f" OWNER {owner}" if owner else ""))
    return database


def _build_app(database: str) -> None:
    """Runner-owned table, private marker and a typical definer RPC (probe_overload)."""
    _runner(database, f"""
        CREATE TABLE public.users (id uuid PRIMARY KEY, email varchar(200), role text);
        GRANT SELECT, INSERT, UPDATE, DELETE ON public.users TO service_role;
        INSERT INTO public.users VALUES ('{USER_ID}', 'A@x.io', 'student');
        CREATE TABLE public.mig357_marker (note text);
        REVOKE ALL ON public.mig357_marker FROM PUBLIC;
        CREATE FUNCTION public.fn_rpc(p_id uuid) RETURNS jsonb LANGUAGE plpgsql
            SECURITY DEFINER SET search_path = public, pg_temp AS $f$
        DECLARE r public.users;
        BEGIN
            SELECT * INTO r FROM public.users WHERE id = p_id;
            RETURN jsonb_build_object('id', r.id, 'email', lower(r.email));
        END $f$;
        REVOKE ALL ON FUNCTION public.fn_rpc(uuid) FROM PUBLIC;
        GRANT EXECUTE ON FUNCTION public.fn_rpc(uuid) TO service_role;
    """)


@pytest.fixture
def staging_db(pg_roles):
    """Staging shape (SA read 2026-10-31): runner-owned public, service_role=UC."""
    database = _new_database()
    try:
        sql(database, f"ALTER SCHEMA public OWNER TO {RUNNER}")
        _runner(database, """
            REVOKE ALL ON SCHEMA public FROM PUBLIC;
            GRANT USAGE ON SCHEMA public TO anon, authenticated;
            GRANT USAGE, CREATE ON SCHEMA public TO service_role;
        """)
        assert _acl(database) == STAGING_ACL
        _build_app(database)
        yield database
    finally:
        sql("postgres", f"DROP DATABASE {database} WITH (FORCE)")


def _rpc(database: str) -> str:
    return _as(database, "service_role", f"SELECT public.fn_rpc('{USER_ID}');")


def _plant(database: str, signature: str, body: str) -> str:
    return _as(database, "service_role", f"CREATE FUNCTION {signature} {body};")


def test_overload_shadow_red_before_357_and_42501_after(staging_db):
    db = staging_db
    # Table maintenance rights are already gone (FR-001 end state); CREATE is the only path.
    assert sql(db, "SELECT has_table_privilege('service_role', 'public.users', 'TRIGGER')") == "f"
    assert _can_create(db) == {"service_role": True, "anon": False, "authenticated": False}
    assert _rpc(db) == RPC_RESULT and _marker(db) == []

    # Negative control (before 357): each planted overload runs as the RPC owner.
    for signature, body in OVERLOADS.items():
        _plant(db, signature, body)
        assert _rpc(db) == RPC_RESULT
        _as(db, "service_role", f"DROP FUNCTION {DROP_SIGNATURES[signature]};")
    assert _marker(db) == [f"jsonb:{RUNNER}", f"lower:{RUNNER}"]
    _runner(db, "TRUNCATE public.mig357_marker;")

    before = _acl(db)
    for _ in range(2):  # re-runnable
        _apply(db)
        assert _acl(db) == STAGING_ACL.replace("service_role=UC/", "service_role=U/")
    assert before == STAGING_ACL
    assert _can_create(db) == dict.fromkeys(API_ROLES, False)
    assert _usage(db) == dict.fromkeys(API_ROLES, True)

    for role in API_ROLES:
        for signature, body in OVERLOADS.items():
            with pytest.raises(RuntimeError, match=r"42501: permission denied for schema public"):
                _plant(db, signature, body) if role == "service_role" else _as(
                    db, role, f"CREATE FUNCTION {signature} {body};")
    assert _rpc(db) == RPC_RESULT and _marker(db) == []
    assert sql(db, """SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace
                      AND proname IN ('lower', 'jsonb_build_object')""") == "0"

    # Owner control: the runner still creates in public and in a scratch schema.
    _runner(db, """
        CREATE FUNCTION public.mig357_owner_probe() RETURNS int LANGUAGE sql AS 'SELECT 357';
        DROP FUNCTION public.mig357_owner_probe();
    """)
    sql(db, f"CREATE SCHEMA mig357_scratch AUTHORIZATION {RUNNER}")
    _runner(db, """
        CREATE FUNCTION mig357_scratch.probe() RETURNS int LANGUAGE sql AS 'SELECT 357';
        DROP SCHEMA mig357_scratch CASCADE;
    """)
    # service_role keeps CRUD through USAGE.
    _as(db, "service_role", f"UPDATE public.users SET role = 'student' WHERE id = '{USER_ID}';")


def _users_postcondition_341() -> str:
    """The real 341 users postcondition (341.sql DO block), unqualified as shipped."""
    start = SQL_341.index("    -- P2-SA-1: effective privileges include inherited and PUBLIC grants.")
    end_marker = "RAISE EXCEPTION 'users_service_role_privileges_wrong: %', v_wrong;\n    END IF;"
    end = SQL_341.index(end_marker, start) + len(end_marker)
    snippet = SQL_341[start:end]
    assert "has_table_privilege('service_role', 'public.users', p.priv)" in snippet
    return f"DO $$\nDECLARE v_wrong text;\nBEGIN\n{snippet}\nEND $$;"


@pytest.mark.parametrize("search_path", ['"$user", public, extensions', "pg_catalog, public"])
def test_sa_r4_3_planted_has_table_privilege_red_before_357_and_42501_after(staging_db, search_path):
    db = staging_db
    check = f"SET search_path = {search_path};\n" + _users_postcondition_341()
    _runner(db, "GRANT TRIGGER ON public.users TO service_role;")  # drift 341 must catch
    with pytest.raises(RuntimeError, match="users_service_role_privileges_wrong: TRIGGER"):
        _runner(db, check)

    # RED (before 357): the plant hides the drift and its body runs as the runner.
    _as(db, "service_role", HAS_TABLE_PRIVILEGE_PLANT + ";")
    _runner(db, check)
    assert _marker(db) and set(_marker(db)) == {f"has_table_privilege:{RUNNER}"}
    _as(db, "service_role", "DROP FUNCTION public.has_table_privilege(text, text, text);")
    _runner(db, "TRUNCATE public.mig357_marker;")

    _apply(db)
    for role in API_ROLES:
        with pytest.raises(RuntimeError, match=r"42501: permission denied for schema public"):
            _as(db, role, HAS_TABLE_PRIVILEGE_PLANT + ";")
    # GREEN: nothing to shadow, so the 341 check sees the drift again.
    with pytest.raises(RuntimeError, match="users_service_role_privileges_wrong: TRIGGER"):
        _runner(db, check)
    assert _marker(db) == []


@pytest.mark.parametrize("runner_owns_database", [True, False])
def test_production_shape_is_a_noop(pg_roles, runner_owns_database):
    """Prod ACL (Leader 2026-10-30 16:09): pg_database_owner=UC, U for the rest."""
    db = _new_database(RUNNER if runner_owns_database else None)
    try:
        sql(db, f"GRANT USAGE ON SCHEMA public TO {RUNNER}, anon, authenticated, service_role")
        acl = _acl(db)
        assert acl == ("{pg_database_owner=UC/pg_database_owner,=U/pg_database_owner,"
                       f"{RUNNER}=U/pg_database_owner,anon=U/pg_database_owner,"
                       "authenticated=U/pg_database_owner,service_role=U/pg_database_owner}")
        assert _can_create(db) == dict.fromkeys(API_ROLES, False)
        for _ in range(2):
            notices = _apply(db)
            assert _acl(db) == acl
        assert "public_schema_create_grant: grantee=pg_database_owner grantor=pg_database_owner" in notices
        assert _can_create(db) == dict.fromkeys(API_ROLES, False)
        assert _usage(db) == dict.fromkeys(API_ROLES, True)
        with pytest.raises(RuntimeError, match="42501"):
            _as(db, "service_role", "CREATE FUNCTION public.lower(v varchar) RETURNS text "
                "LANGUAGE sql AS 'SELECT 1::text';")
    finally:
        sql("postgres", f"DROP DATABASE {db} WITH (FORCE)")


def test_public_create_and_null_acl_are_revoked(pg_roles):
    db = _new_database()
    try:
        sql(db, f"ALTER SCHEMA public OWNER TO {RUNNER}")
        _runner(db, "GRANT CREATE ON SCHEMA public TO PUBLIC;")  # PG14-style default
        assert _can_create(db) == dict.fromkeys(API_ROLES, True)
        _apply(db)
        assert _can_create(db) == dict.fromkeys(API_ROLES, False)
        assert sql(db, """SELECT count(*) FROM pg_namespace n,
            aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) a
            WHERE n.nspname = 'public' AND a.grantee = 0""") == "1"  # PUBLIC keeps USAGE
        assert _usage(db) == dict.fromkeys(API_ROLES, True)
        # NULL nspacl (owner default only) passes too.
        sql(db, "UPDATE pg_namespace SET nspacl = NULL WHERE nspname = 'public'")
        _apply(db)
        assert _can_create(db) == dict.fromkeys(API_ROLES, False)
    finally:
        sql("postgres", f"DROP DATABASE {db} WITH (FORCE)")


def test_down_is_a_noop_after_357(staging_db):
    _apply(staging_db)
    after = _acl(staging_db)
    notices = _apply(staging_db, DOWN)
    assert "mig357_down_noop" in notices and _acl(staging_db) == after
    with pytest.raises(RuntimeError, match="42501"):
        _plant(staging_db, *next(iter(OVERLOADS.items())))


def test_notices_list_grants_with_grantor_and_api_owned_routines(staging_db):
    _as(staging_db, "service_role",
        "CREATE FUNCTION public.mig357_svc_probe() RETURNS int LANGUAGE sql AS 'SELECT 1';")
    notices = _apply(staging_db)
    assert f"public_schema_create_grant: grantee={RUNNER} grantor={RUNNER}" in notices
    assert "grantee=service_role" not in notices
    assert "public_routine_owned_by_api_role: public.mig357_svc_probe() owner=service_role" in notices


# ── Fail closed: the whole migration rolls back ─────────────────────────────

@pytest.mark.parametrize("grantee", ["service_role", "anon", "authenticated", "PUBLIC"])
def test_create_from_another_grantor_aborts_naming_the_grantor(staging_db, grantee):
    _runner(staging_db, f"GRANT CREATE ON SCHEMA public TO {OTHER} WITH GRANT OPTION;")
    _psql(staging_db, f"GRANT CREATE ON SCHEMA public TO {grantee};", role=OTHER)
    before = _acl(staging_db)
    shown = "PUBLIC" if grantee == "PUBLIC" else grantee
    with pytest.raises(RuntimeError, match=rf"public_schema_create_acl_remains: .*{shown} \(grantor {OTHER}\)"):
        _apply(staging_db)
    assert _acl(staging_db) == before  # the runner's own revoke rolled back too


@pytest.mark.parametrize("inherit", ["TRUE", "FALSE"])
@pytest.mark.parametrize("member", API_ROLES)
def test_inherited_or_set_role_create_aborts(staging_db, member, inherit):
    _runner(staging_db, f"GRANT CREATE ON SCHEMA public TO {OTHER};")
    sql("postgres", f"GRANT {OTHER} TO {member} WITH INHERIT {inherit}")
    try:
        before = _acl(staging_db)
        with pytest.raises(RuntimeError, match=rf"public_schema_create_effective: .*{member} via {OTHER}"):
            _apply(staging_db)
        assert _acl(staging_db) == before
    finally:
        sql("postgres", f"REVOKE {OTHER} FROM {member}")


@pytest.mark.parametrize("owner", API_ROLES)
def test_schema_owned_by_api_role_aborts_before_revoke(staging_db, owner):
    sql(staging_db, f"ALTER SCHEMA public OWNER TO {owner}; GRANT CREATE ON SCHEMA public TO {RUNNER}")
    before = _acl(staging_db)
    with pytest.raises(RuntimeError, match=f"public_schema_owned_by_api_role: {owner}"):
        _apply(staging_db)
    assert _acl(staging_db) == before


@pytest.mark.parametrize("planter,ddl,shown", [
    ("service_role", "CREATE FUNCTION public.lower(v varchar) RETURNS text LANGUAGE sql AS 'SELECT 1::text'",
     "function public.lower(character varying) owner service_role"),
    (RUNNER, "CREATE FUNCTION public.has_table_privilege(text, text, text) RETURNS boolean "
     "LANGUAGE sql AS 'SELECT true'",
     f"function public.has_table_privilege(text,text,text) owner {RUNNER}"),
    (RUNNER, "CREATE OPERATOR public.|| (LEFTARG = int4, RIGHTARG = int4, FUNCTION = int4pl)",
     f"operator public.||(integer,integer) owner {RUNNER}"),
])
def test_existing_pg_catalog_name_shadow_aborts(staging_db, planter, ddl, shown):
    if planter == "service_role":
        _as(staging_db, planter, ddl + ";")
    else:
        _runner(staging_db, ddl + ";")
    before = _acl(staging_db)
    with pytest.raises(RuntimeError, match=re.escape(f"public_pg_catalog_name_shadow: {shown}")):
        _apply(staging_db)
    assert _acl(staging_db) == before == STAGING_ACL
