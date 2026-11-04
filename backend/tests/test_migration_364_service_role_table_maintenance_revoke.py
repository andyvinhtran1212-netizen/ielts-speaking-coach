"""mig 364 (PC-J544, SVCPRIV-0042 T001): no table maintenance rights for API roles.

Static checks always run. The PostgreSQL half uses two LOCAL harnesses, each
with genuine NOSUPERUSER anon/authenticated/service_role (P3-SA-8: every probe
runs ``SET LOCAL ROLE`` and ``ASSERT current_user`` in one transaction):

* a small synthetic database per test (NOSUPERUSER runner owning ``public``,
  Supabase-style schema and global default ACLs) for Scenarios 1–4 and 7–9,
  the FR-009 re-check and the NOTICE/WARNING reports, with red controls run
  before 364;
* the real migration chain of ``test_client_write_invariant_postgres``: every
  forward migration from 320 on (357, 341, 344, 356, …) applied through the
  locked runner, then 364. It compares the real backend RPCs before and after
  364 (FR-005), runs Scenario 10 on 344 + 356 + 357 + 364 (FR-008) and
  Scenario 11, a clone baseline through ``apply_migrations.sh`` (FR-007).

Set TEST_PG_URL and REQUIRE_PG=1 to forbid skips (PG16 and PG17).
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import time
from pathlib import Path
from uuid import uuid4

import pytest

import test_client_write_invariant_postgres as inv
import test_migration_334_activate_attempt_rate_limit as m334
from test_migration_320_client_write_lockdown import _strip_sql_comments
from test_service_role_table_privilege_guard import find_table_privilege_grants

BACKEND = Path(__file__).resolve().parents[1]
MIGRATIONS = BACKEND / "migrations"
NAME = "364_service_role_table_maintenance_revoke.sql"
GROUP = "service_role_table_maintenance_revoke"
SQL = (MIGRATIONS / NAME).read_text(encoding="utf-8")
CODE = _strip_sql_comments(SQL)
DOWN = (MIGRATIONS / "rollback" / NAME).read_text(encoding="utf-8")
API_ROLES = ("service_role", "anon", "authenticated")
RUNNER = "mig364_runner"
OTHER = "mig364_other"
POSTCONDITION = "-- ── 5. Postcondition"
PROBE = "-- A table the runner creates now must come out without the four privileges."
sql = m334.sql

# The read-only drift query of rollout.md (Staging step 2), table part.
DRIFT = """
WITH privileges(priv) AS (
  SELECT unnest(ARRAY['TRIGGER', 'REFERENCES', 'TRUNCATE']::text[] ||
    CASE WHEN current_setting('server_version_num')::int >= 170000
         THEN ARRAY['MAINTAIN']::text[] ELSE ARRAY[]::text[] END)
), relations AS (
  SELECT c.* FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','f')
)
SELECT c.relname || ':' || r.rolname || ':' || p.priv
  FROM relations c
 CROSS JOIN (VALUES ('service_role'), ('anon'), ('authenticated')) r(rolname)
 CROSS JOIN privileges p
 WHERE has_table_privilege(r.rolname, c.oid, p.priv)
UNION ALL
SELECT c.relname || ':PUBLIC:' || a.privilege_type
  FROM relations c
 CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
  JOIN privileges p ON p.priv = a.privilege_type
 WHERE a.grantee = 0
ORDER BY 1"""

# The same normalised CRUD + schema USAGE snapshot the migration compares.
KEPT = """
SELECT COALESCE(json_agg(s ORDER BY s), '[]') FROM (
  SELECT format('rel|%s|%s|%s|%s|%s', c.relname, pg_get_userbyid(a.grantor),
                CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
                a.privilege_type, a.is_grantable) AS s
    FROM pg_class c
   CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p','v','m','f')
     AND a.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
  UNION ALL
  SELECT format('col|%s|%s|%s|%s|%s|%s', c.relname, att.attname, pg_get_userbyid(a.grantor),
                CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
                a.privilege_type, a.is_grantable)
    FROM pg_class c JOIN pg_attribute att ON att.attrelid = c.oid
   CROSS JOIN LATERAL aclexplode(att.attacl) a
   WHERE c.relnamespace = 'public'::regnamespace AND att.attnum > 0 AND att.attacl IS NOT NULL
     AND a.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
  UNION ALL
  SELECT format('schema|%s|%s', CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
                a.privilege_type)
    FROM pg_namespace n CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) a
   WHERE n.nspname = 'public' AND a.privilege_type = 'USAGE'
) x"""


# ── Static contract ─────────────────────────────────────────────────────────

def _without_strings(code: str) -> str:
    return re.sub(r"'(?:[^']|'')*'", "''", code)


def test_one_transaction_lock_timeout_and_pinned_search_path():
    lines = [line for line in CODE.strip().splitlines() if line.strip()]
    assert lines[:3] == ["BEGIN;", "SET LOCAL lock_timeout = '5s';",
                         "SET LOCAL search_path = pg_catalog, pg_temp;"]
    assert lines[-1] == "COMMIT;" and CODE.count("BEGIN;") == 1 and CODE.count("COMMIT;") == 1


def test_revokes_only_and_no_grant_or_other_object_change():
    """FR-002/FR-008: no GRANT; only the probe table and pg_temp objects are created."""
    assert not re.search(r"\bGRANT\b", CODE, re.I)
    assert find_table_privilege_grants(SQL) == []
    bare = _without_strings(CODE)
    revoke, = re.findall(r"\bREVOKE\b[^;]+;", bare)
    assert " ".join(revoke.split()) == ("REVOKE TRIGGER, REFERENCES, TRUNCATE ON ALL TABLES IN SCHEMA public "
                                        "FROM PUBLIC, anon, authenticated, service_role;")
    assert re.findall(r"\bCREATE\b[^(;]*", bare) == [
        "CREATE TEMP VIEW mig364_kept_privileges AS\nSELECT ''::text AS kind, c.oid::regclass::text AS object, 0::int2 AS attnum,\n       a.grantor, a.grantee, a.privilege_type, a.is_grantable\n  FROM pg_catalog.pg_class c\n CROSS JOIN LATERAL pg_catalog.aclexplode",
        "CREATE TEMP TABLE mig364_kept_before ON COMMIT DROP AS\nSELECT * FROM pg_temp.mig364_kept_privileges",
        "CREATE TABLE public._svcpriv_default_probe ",
    ]
    assert re.findall(r"\bDROP\b\s+\w+[^;]*;", bare) == [
        "DROP AS\nSELECT * FROM pg_temp.mig364_kept_privileges;",   # ON COMMIT DROP
        "DROP TABLE public._svcpriv_default_probe;", "DROP VIEW pg_temp.mig364_kept_privileges;"]
    assert not re.search(r"\bALTER\b", bare, re.I)   # ALTER DEFAULT PRIVILEGES only inside format()
    for forbidden in (r"INSERT\s+INTO", r"DELETE\s+FROM", r"^\s*UPDATE\s", r"^\s*TRUNCATE\b",
                      r"\bPOLICY\b", r"\bFUNCTION\b", r"\bTRIGGER\s+\w+\s+(?:BEFORE|AFTER)",
                      r"\bOWNER\s+TO\b", r"\bCASCADE\b"):
        assert not re.search(forbidden, bare, re.M | re.I), forbidden
    assert ("'ALTER DEFAULT PRIVILEGES FOR ROLE %I%s REVOKE %s ON TABLES '\n"
            "                'FROM service_role, PUBLIC, anon, authenticated'") in CODE


def test_maintain_is_named_only_behind_the_pg17_gate():
    gate = (r"IF\s+(?:has_maintain|pg_catalog\.current_setting\('server_version_num'\)::int\s*>=\s*170000)"
            r"\s+THEN.*?END IF;")
    assert "MAINTAIN" in CODE
    assert "MAINTAIN" not in re.sub(gate, "", CODE, flags=re.S)
    assert CODE.count("has_maintain CONSTANT boolean :=\n        "
                      "pg_catalog.current_setting('server_version_num')::int >= 170000;") == 1


CATALOG_FUNCTIONS = {
    "aclexplode", "acldefault", "array_append", "array_to_string", "count", "current_setting",
    "format", "has_any_column_privilege", "has_schema_privilege", "has_table_privilege",
    "pg_get_userbyid", "pg_has_role", "quote_ident", "string_agg", "to_regclass", "unnest",
}


def test_catalog_functions_are_schema_qualified():
    """SA-R4-3: builtins resolve in pg_catalog even if search_path is changed."""
    bare = _without_strings(CODE)
    for name in CATALOG_FUNCTIONS:
        assert not re.search(rf"(?<![\w.]){name}\s*\(", bare), name
    assert set(re.findall(r"pg_catalog\.([a-z_]+)\(", bare)) == CATALOG_FUNCTIONS
    assert not re.search(r"\|\||@>", bare)


def test_fail_closed_markers_and_reports():
    for marker in ("svcpriv_public_schema_missing", "svcpriv_owned_by_api_role",
                   "svcpriv_default_probe_privilege", "svcpriv_priority_relation_privilege",
                   "svcpriv_relation_privilege_remains", "svcpriv_public_grantee_privilege_remains",
                   "svcpriv_kept_privileges_changed", "svcpriv_default_acl_remains",
                   "svcpriv_schema_create_remains", "svcpriv_schema_create_effective"):
        assert f"RAISE EXCEPTION '{marker}" in CODE, marker
    for notice in ("svcpriv_priority_relation_missing", "svcpriv_other_grantee",
                   "svcpriv_other_schema_create", "svcpriv_suspect_trigger"):
        assert f"RAISE NOTICE '{notice}" in CODE, notice
    assert "RAISE WARNING 'svcpriv_default_acl_not_actable" in CODE
    assert CODE.count("pg_catalog.pg_has_role(t.rolname, m.oid, 'MEMBER')") == 3
    assert "pg_catalog.has_any_column_privilege(m.oid, c.oid, 'REFERENCES')" in CODE


def test_priority_relations_are_the_research_list():
    listed = set(re.findall(r"'([a-z_]+)'", re.search(
        r"priority_relations CONSTANT text\[\] := ARRAY\[(.*?)\];", CODE, re.S).group(1)))
    assert listed == {
        "users", "students", "student_cohort_memberships", "student_lifecycle_audit", "cohorts",
        "class_lifecycle_audit", "access_codes", "user_code_assignments", "vocab_curated_cohort_events",
        "staff_security_audit", "owner_alert_outbox", "activation_attempts", "staff_mfa_status_throttle",
        "ai_model_overrides", "ai_model_override_audit", "staff_privilege_evidence", "class_action_log"}


def test_header_release_metadata_and_no_op_down():
    for text in ("357 (FR-009, REVOKE CREATE ON SCHEMA public) is applied before 364",
                 "merge KHÔNG áp", f"MIGRATION_FEATURES={GROUP}", "Rollback: none."):
        assert text in SQL, text
    assert "mig364_down_noop" in DOWN
    readme = (MIGRATIONS / "README.md").read_text(encoding="utf-8")
    assert "Migration `364` (PC-J544, SVCPRIV-0042 T001" in readme
    assert "`apply_migrations.sh --baseline` refuses a\nnon-empty `MIGRATION_FEATURES`" in readme


# ── PostgreSQL: synthetic database per test ─────────────────────────────────

def _psql(database: str, text: str, *, role: str | None = None) -> tuple[str, str]:
    """One psql session; return (stdout, stderr with NOTICE/WARNING lines)."""
    prefix = f"SET ROLE {role};\n" if role else ""
    result = subprocess.run([*m334._psql_args(database, app="mig364"), "-v", "VERBOSITY=verbose", "-f", "-"],
                            input=prefix + text, capture_output=True, text=True,
                            timeout=300, env=m334._env())
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip(), result.stderr


def _apply(database: str, text: str = SQL, *, role: str = RUNNER) -> str:
    return _psql(database, text, role=role)[1]


def _as(database: str, role: str, body: str) -> tuple[str, str]:
    """P3-SA-8: the genuine role, asserted, in the probe's own transaction."""
    return _psql(database, f"""BEGIN;
SET LOCAL ROLE {role};
DO $a$ BEGIN ASSERT current_user = '{role}'; END $a$;
{body}
COMMIT;""")


def _denied(database: str, role: str, body: str) -> str:
    with pytest.raises(RuntimeError, match="42501|permission denied") as error:
        _as(database, role, body)
    return str(error.value)


def _pg17(database: str = "postgres") -> bool:
    return sql(database, "SELECT current_setting('server_version_num')::int >= 170000") == "t"


def _privileges(database: str = "postgres") -> tuple[str, ...]:
    return ("TRIGGER", "REFERENCES", "TRUNCATE") + (("MAINTAIN",) if _pg17(database) else ())


def _drift(database: str) -> list[str]:
    out = sql(database, DRIFT)
    return out.splitlines() if out else []


def _kept(database: str) -> list[str]:
    return json.loads(sql(database, KEPT))


def _acl(database: str) -> str:
    return sql(database, "SELECT string_agg(relname || '=' || COALESCE(relacl::text, 'NULL'), ' ' "
                         "ORDER BY relname) FROM pg_class WHERE relnamespace = 'public'::regnamespace "
                         "AND relkind IN ('r','p','v','m','f')")


def _defaults(database: str) -> str:
    return sql(database, "SELECT string_agg(pg_get_userbyid(defaclrole) || '/' || defaclnamespace::regnamespace"
                         "::text || '/' || defaclobjtype::text || '=' || defaclacl::text, ' ' ORDER BY 1) "
                         "FROM pg_default_acl")


def _inject(text: str, *, before: str = POSTCONDITION) -> str:
    """Test seam: run `text` between the revokes and the given section."""
    assert SQL.count(before) == 1
    return SQL.replace(before, text + "\n" + before)


@pytest.fixture(scope="module")
def pg_roles():
    m334._require_pg()
    for role, options in (("anon", "NOSUPERUSER"), ("authenticated", "NOSUPERUSER"),
                          ("service_role", "NOSUPERUSER BYPASSRLS"),
                          (RUNNER, "NOSUPERUSER NOBYPASSRLS"), (OTHER, "NOSUPERUSER")):
        sql("postgres", f"""DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{role}') THEN
                CREATE ROLE {role} {options} NOLOGIN;
            END IF;
        END $$;""")
    sql("postgres", "ALTER ROLE service_role BYPASSRLS")
    # P3-SA-8: genuine roles, never superuser.
    assert sql("postgres", f"""SELECT string_agg(rolname || '=' || rolsuper, ',' ORDER BY rolname)
        FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role', '{RUNNER}')""") == (
        f"anon=false,authenticated=false,{RUNNER}=false,service_role=false")


SYNTHETIC = f"""
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO service_role;
CREATE TABLE public.users (id uuid PRIMARY KEY, email varchar(200), role text);
CREATE TABLE public.access_codes (code text PRIMARY KEY,
    issued_by uuid REFERENCES public.users(id) ON DELETE SET NULL ON UPDATE CASCADE);
CREATE TABLE public.user_code_assignments (id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE ON UPDATE CASCADE);
CREATE TABLE public.activation_attempts (id int);
REVOKE ALL ON public.activation_attempts FROM anon, authenticated, service_role;
GRANT SELECT ON public.activation_attempts TO service_role;
CREATE TABLE public.colonly (id int PRIMARY KEY, note text);
REVOKE ALL ON public.colonly FROM anon, authenticated, service_role;
GRANT SELECT, UPDATE (note), REFERENCES (id) ON public.colonly TO service_role;
GRANT SELECT ON public.users TO {OTHER} WITH GRANT OPTION;
CREATE TABLE public.nullacl (id int);
CREATE VIEW public.v_users AS SELECT id, email FROM public.users;
CREATE TABLE public.parts (id int) PARTITION BY RANGE (id);
CREATE TABLE public.parts_1 PARTITION OF public.parts FOR VALUES FROM (0) TO (10);
CREATE MATERIALIZED VIEW public.mv AS SELECT 1 AS x;
CREATE FOREIGN TABLE public.ft (id int) SERVER mig364_server;
CREATE TABLE public.mig364_marker (note text);
REVOKE ALL ON public.mig364_marker FROM anon, authenticated, service_role;
-- A typical owner-run definer (the fn_set_staff_privilege shape).
CREATE FUNCTION public.fn_touch_user(p_id uuid) RETURNS text LANGUAGE plpgsql
    SECURITY DEFINER SET search_path = public, pg_temp AS $f$
BEGIN
    UPDATE public.users SET email = lower(email) WHERE id = p_id;
    RETURN current_user;
END $f$;
REVOKE ALL ON FUNCTION public.fn_touch_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_touch_user(uuid) TO service_role;
"""
USER_ID = "00000000-0000-0000-0000-000000000364"


@pytest.fixture
def db(pg_roles):
    """Post-357 schema shape, Supabase default ACLs, 364 not applied yet."""
    database = f"mig364_{uuid4().hex[:12]}"
    sql("postgres", f"CREATE DATABASE {database}")
    try:
        sql(database, f"""ALTER SCHEMA public OWNER TO {RUNNER};
            CREATE FOREIGN DATA WRAPPER mig364_fdw;
            CREATE SERVER mig364_server FOREIGN DATA WRAPPER mig364_fdw;
            GRANT USAGE ON FOREIGN SERVER mig364_server TO {RUNNER}""")
        _psql(database, SYNTHETIC, role=RUNNER)
        sql(database, "UPDATE pg_class SET relacl = NULL WHERE oid = 'public.nullacl'::regclass")
        _psql(database, f"INSERT INTO public.users VALUES ('{USER_ID}', 'A@x.io', 'student');"
                        f"INSERT INTO public.access_codes VALUES ('C1', '{USER_ID}');"
                        f"INSERT INTO public.user_code_assignments (user_id) VALUES ('{USER_ID}');",
              role=RUNNER)
        yield database
    finally:
        sql("postgres", f"DROP DATABASE IF EXISTS {database} WITH (FORCE)")


def test_scenario_1_every_relkind_loses_the_four_privileges_and_reruns(db):
    relations = ("users", "v_users", "parts", "parts_1", "mv", "ft", "access_codes")
    before = set(_drift(db))
    for relation in relations:
        for privilege in _privileges(db):
            assert f"{relation}:service_role:{privilege}" in before, (relation, privilege)
    assert any(":anon:TRIGGER" in row for row in before)
    for _ in range(2):  # re-runnable
        _apply(db)
        assert _drift(db) == []
    assert sql(db, "SELECT to_regclass('public._svcpriv_default_probe') IS NULL") == "t"
    # Column-level REFERENCES alone would still allow an FK.
    assert sql(db, "SELECT has_column_privilege('service_role', 'public.colonly', 'id', 'REFERENCES')") == "f"


def test_scenario_2_crud_column_grants_grant_options_and_usage_unchanged(db):
    before = _kept(db)
    assert sql(db, "SELECT relacl IS NULL FROM pg_class WHERE oid = 'public.nullacl'::regclass") == "t"
    _apply(db)
    assert _kept(db) == before
    assert "col|colonly|note|mig364_runner|service_role|UPDATE|f" in before
    assert f"rel|users|mig364_runner|{OTHER}|SELECT|t" in before
    _as(db, "service_role", f"""
        INSERT INTO public.users VALUES ('{uuid4()}', 'b@x.io', 'user');
        UPDATE public.users SET role = 'student' WHERE id = '{USER_ID}';
        DELETE FROM public.users WHERE email = 'b@x.io';
        SELECT count(*) FROM public.v_users;
        UPDATE public.colonly SET note = 'x' WHERE id = 1;
        SELECT count(*) FROM public.activation_attempts;""")


def test_scenario_3_tables_created_later_do_not_get_them_back(db):
    _apply(db)
    _psql(db, "CREATE TABLE public.t_new (id int);", role=RUNNER)
    granted = {p: sql(db, f"SELECT has_table_privilege('service_role', 'public.t_new', '{p}')")
               for p in ("SELECT", "INSERT", "UPDATE", "DELETE", *_privileges(db))}
    assert granted == {**dict.fromkeys(("SELECT", "INSERT", "UPDATE", "DELETE"), "t"),
                       **dict.fromkeys(_privileges(db), "f")}
    assert _drift(db) == []
    for scope in ("public", "-"):
        acl = sql(db, f"""SELECT defaclacl::text FROM pg_default_acl WHERE defaclobjtype = 'r'
                          AND defaclnamespace = {"'public'::regnamespace" if scope == "public" else 0}""")
        assert acl and not re.search(r"(?:service_role|anon|authenticated)=[a-zA-Z]*[xDtm]", acl), acl


def test_default_acl_of_an_owner_the_runner_cannot_act_for_warns_with_the_support_statement(db):
    sql(db, f"GRANT CREATE ON SCHEMA public TO {OTHER}")
    _psql(db, "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;", role=OTHER)
    sql(db, f"REVOKE CREATE ON SCHEMA public FROM {OTHER}")
    warnings = _apply(db)
    assert (f"svcpriv_default_acl_not_actable: owner={OTHER} scope=public grantee=service_role "
            f"privilege=TRIGGER (Supabase support: ALTER DEFAULT PRIVILEGES FOR ROLE {OTHER} IN SCHEMA "
            f"public REVOKE TRIGGER ON TABLES FROM service_role;)") in warnings
    assert _drift(db) == []   # FR-001 on existing relations is never waived


def _plant(table: str, event: str = "BEFORE UPDATE", name: str = "aaa_mig364") -> str:
    return f"""CREATE FUNCTION pg_temp.{name}() RETURNS trigger LANGUAGE plpgsql AS $p$
BEGIN
    RAISE NOTICE 'mig364_planted:%:%', TG_TABLE_NAME, current_user;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END $p$;
CREATE TRIGGER {name} {event} ON public.{table} FOR EACH ROW EXECUTE FUNCTION pg_temp.{name}();"""


def test_scenario_4_p2_sa_1_runs_as_owner_before_and_stops_at_create_trigger_after(db):
    # Negative control without 364: the planted trigger runs as the owner.
    _, notices = _as(db, "service_role", _plant("users") + f"\nSELECT public.fn_touch_user('{USER_ID}');")
    assert f"mig364_planted:users:{RUNNER}" in notices
    _apply(db)
    before = sql(db, f"SELECT row_to_json(u) FROM public.users u WHERE id = '{USER_ID}'")
    acl = _acl(db)
    error = _denied(db, "service_role", _plant("users") + f"\nSELECT public.fn_touch_user('{USER_ID}');")
    assert "42501" in error and "permission denied for table users" in error
    assert sql(db, f"SELECT row_to_json(u) FROM public.users u WHERE id = '{USER_ID}'") == before
    assert _acl(db) == acl
    # The legitimate RPC is unchanged.
    assert _as(db, "service_role", f"SELECT public.fn_touch_user('{USER_ID}');")[0].endswith(RUNNER)


@pytest.mark.parametrize("role", API_ROLES)
def test_fr005_trigger_truncate_and_references_are_refused(db, role):
    _apply(db)
    for table in ("users", "access_codes", "user_code_assignments", "activation_attempts"):
        assert "42501" in _denied(db, role, _plant(table))
        assert "42501" in _denied(db, role, f"TRUNCATE public.{table};")
    sql(db, f"CREATE SCHEMA mig364_scratch_{role} AUTHORIZATION {role}")
    assert "42501" in _denied(db, role, f"CREATE TABLE mig364_scratch_{role}.child "
                                        f"(u uuid REFERENCES public.users(id));")
    assert "42501" in _denied(db, role, f"CREATE TABLE mig364_scratch_{role}.child "
                                        f"(i int REFERENCES public.colonly(id));")


def test_fr005_access_exclusive_lock_needs_maintain_on_pg17(db):
    if not _pg17(db):
        pytest.skip("MAINTAIN is a PostgreSQL 17 privilege")
    lock = "LOCK TABLE public.activation_attempts IN ACCESS EXCLUSIVE MODE;"
    sql(db, f"GRANT MAINTAIN ON public.activation_attempts TO service_role")   # red control
    _as(db, "service_role", lock)
    _apply(db)
    assert "42501" in _denied(db, "service_role", lock)
    _as(db, "service_role", "LOCK TABLE public.activation_attempts IN ACCESS SHARE MODE;")


def test_scenario_9_fk_actions_run_as_owner_before_and_planting_is_refused_after(db):
    plants = (_plant("access_codes", "BEFORE UPDATE", "aaa_codes")
              + _plant("user_code_assignments", "BEFORE DELETE", "aaa_assign")
              + _plant("user_code_assignments", "BEFORE UPDATE", "aaa_assign_u"))
    new_id = str(uuid4())
    # Red control: a direct UPDATE/DELETE of the parent fires the child triggers as the owner.
    _, notices = _as(db, "service_role", plants + f"""
        UPDATE public.users SET id = '{new_id}' WHERE id = '{USER_ID}';
        DELETE FROM public.users WHERE id = '{new_id}';
        ROLLBACK; BEGIN;""")
    for table in ("access_codes", "user_code_assignments"):
        assert f"mig364_planted:{table}:{RUNNER}" in notices, notices
    _apply(db)
    for table in ("access_codes", "user_code_assignments"):
        assert "42501" in _denied(db, "service_role", _plant(table, "BEFORE DELETE"))
    # The legitimate FK actions still run.
    _as(db, "service_role", f"""UPDATE public.users SET id = '{new_id}' WHERE id = '{USER_ID}';""")
    assert sql(db, "SELECT issued_by FROM public.access_codes") == new_id
    _as(db, "service_role", f"DELETE FROM public.users WHERE id = '{new_id}';")
    assert sql(db, "SELECT count(*) || '/' || count(issued_by) FROM public.access_codes") == "1/0"
    assert sql(db, "SELECT count(*) FROM public.user_code_assignments") == "0"


# Scenario 7 / FR-004: abort, and nothing (privilege or default ACL) is committed.

def _aborts(db: str, text: str, match: str) -> None:
    acl, defaults, kept = _acl(db), _defaults(db), _kept(db)
    with pytest.raises(RuntimeError, match=match):
        _apply(db, text)
    assert (_acl(db), _defaults(db), _kept(db)) == (acl, defaults, kept)


@pytest.mark.parametrize("owner", API_ROLES)
def test_relation_owned_by_an_api_role_aborts_before_any_revoke(db, owner):
    sql(db, f"GRANT CREATE ON SCHEMA public TO {owner}")
    _psql(db, "CREATE TABLE public.planted_by_api (id int);", role=owner)
    sql(db, f"REVOKE CREATE ON SCHEMA public FROM {owner}")
    _aborts(db, SQL, rf"svcpriv_owned_by_api_role: relation public\.planted_by_api owner {owner}")


def test_schema_owned_by_an_api_role_aborts(db):
    sql(db, f"ALTER SCHEMA public OWNER TO service_role; GRANT CREATE ON SCHEMA public TO {RUNNER}")
    _aborts(db, SQL, "svcpriv_owned_by_api_role: schema public owner service_role")


@pytest.mark.parametrize("inherit", ["TRUE", "FALSE"])
@pytest.mark.parametrize("table,marker", [("users", "svcpriv_priority_relation_privilege: users TRIGGER via"),
                                          ("colonly", "svcpriv_relation_privilege_remains: public.colonly TRIGGER via")])
def test_inherited_or_set_role_privilege_aborts(db, inherit, table, marker):
    _psql(db, f"GRANT TRIGGER ON public.{table} TO {OTHER};", role=RUNNER)
    sql("postgres", f"GRANT {OTHER} TO service_role WITH INHERIT {inherit}")
    try:
        _aborts(db, SQL, rf"{marker} {OTHER}")
    finally:
        sql("postgres", f"REVOKE {OTHER} FROM service_role")


def test_grant_by_another_grantor_is_not_revoked_and_aborts(db):
    _psql(db, f"GRANT USAGE ON SCHEMA public TO {OTHER}; "
              f"GRANT TRIGGER ON public.colonly TO {OTHER} WITH GRANT OPTION;", role=RUNNER)
    _psql(db, "GRANT TRIGGER ON public.colonly TO service_role;", role=OTHER)
    _aborts(db, SQL, "svcpriv_relation_privilege_remains: public.colonly TRIGGER via service_role")


@pytest.mark.parametrize("seam,match", [
    ("GRANT TRIGGER ON public.users TO service_role;", "svcpriv_priority_relation_privilege: users TRIGGER"),
    ("GRANT TRUNCATE ON public.v_users TO anon;", r"svcpriv_relation_privilege_remains: public\.v_users TRUNCATE"),
    ("GRANT REFERENCES ON public.colonly TO PUBLIC;", "svcpriv_relation_privilege_remains"),
    ("GRANT REFERENCES (note) ON public.colonly TO authenticated;",
     r"svcpriv_relation_privilege_remains: public\.colonly REFERENCES via authenticated"),
    ("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT TRIGGER ON TABLES TO anon;",
     "svcpriv_default_acl_remains: owner mig364_runner scope public grantee anon TRIGGER"),
    ("ALTER DEFAULT PRIVILEGES GRANT REFERENCES ON TABLES TO PUBLIC;",
     "svcpriv_default_acl_remains: owner mig364_runner scope global grantee PUBLIC REFERENCES"),
    ("REVOKE SELECT ON public.users FROM anon;", r"svcpriv_kept_privileges_changed: missing relation public\.users SELECT grantee=anon"),
    ("GRANT INSERT ON public.mig364_marker TO anon;", r"svcpriv_kept_privileges_changed: new relation public\.mig364_marker INSERT grantee=anon"),
    ("REVOKE UPDATE (note) ON public.colonly FROM service_role;", "svcpriv_kept_privileges_changed: missing column"),
    ("REVOKE GRANT OPTION FOR SELECT ON public.users FROM mig364_other;", "grantee=mig364_other grantor=mig364_runner grantable=t"),
    ("REVOKE USAGE ON SCHEMA public FROM anon;", "svcpriv_kept_privileges_changed: missing schema public USAGE grantee=anon"),
])
def test_drift_between_revoke_and_postcondition_aborts(db, seam, match):
    _aborts(db, _inject(seam), match)


def test_default_acl_regrant_before_the_probe_aborts_at_the_probe(db):
    _aborts(db, _inject("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT TRUNCATE ON TABLES TO service_role;",
                        before=PROBE), "svcpriv_default_probe_privilege: service_role TRUNCATE")


# FR-009 re-check: 364 needs 357 and aborts when schema CREATE is back.

@pytest.mark.parametrize("grantee", ["service_role", "anon", "authenticated", "PUBLIC"])
def test_missing_357_aborts(db, grantee):
    _psql(db, f"GRANT CREATE ON SCHEMA public TO {grantee};", role=RUNNER)
    _aborts(db, SQL, rf"svcpriv_schema_create_remains: {grantee} \(grantor {RUNNER}\) \(apply 357 first\)")


@pytest.mark.parametrize("member", API_ROLES)
def test_inherited_schema_create_aborts(db, member):
    _psql(db, f"GRANT CREATE ON SCHEMA public TO {OTHER};", role=RUNNER)
    sql("postgres", f"GRANT {OTHER} TO {member}")
    try:
        _aborts(db, SQL, rf"svcpriv_schema_create_effective: .*\b{member} via {OTHER}")
    finally:
        sql("postgres", f"REVOKE {OTHER} FROM {member}")


def test_357_then_364_from_the_staging_schema_shape(db):
    _psql(db, "GRANT CREATE ON SCHEMA public TO service_role;", role=RUNNER)   # staging before 357
    _apply(db, (MIGRATIONS / "357_public_schema_create_revoke.sql").read_text(encoding="utf-8"))
    _apply(db)
    assert _drift(db) == []
    assert sql(db, "SELECT has_schema_privilege('service_role', 'public', 'CREATE')") == "f"


def test_notices_report_missing_priority_tables_other_grantees_and_suspect_triggers(db):
    _psql(db, f"GRANT TRIGGER, TRUNCATE ON public.users, public.colonly TO {OTHER};", role=RUNNER)
    sql(db, f"CREATE SCHEMA mig364_other_fns AUTHORIZATION {OTHER}")
    _psql(db, "CREATE FUNCTION mig364_other_fns.f() RETURNS trigger LANGUAGE plpgsql "
              f"AS $f$ BEGIN RETURN NEW; END $f$; GRANT USAGE ON SCHEMA mig364_other_fns TO {RUNNER};",
          role=OTHER)
    _psql(db, "CREATE TRIGGER zzz_other BEFORE INSERT ON public.colonly "
              "FOR EACH ROW EXECUTE FUNCTION mig364_other_fns.f();", role=RUNNER)
    notices = _apply(db)
    assert "svcpriv_priority_relation_missing: students" in notices
    assert "svcpriv_priority_relation_missing: users" not in notices
    assert f"svcpriv_other_grantee: grantee={OTHER} privilege=TRIGGER relations=2" in notices
    assert f"svcpriv_other_grantee: grantee={OTHER} privilege=TRUNCATE relations=2" in notices
    assert (f"svcpriv_suspect_trigger: zzz_other on public.colonly function mig364_other_fns.f() "
            f"owner {OTHER} (relation owner {RUNNER})") in notices
    # FK triggers are internal and never reported.
    assert "RI_ConstraintTrigger" not in notices


def test_down_is_a_noop_after_364(db):
    _apply(db)
    acl = _acl(db)
    assert "mig364_down_noop" in _apply(db, DOWN)
    assert _acl(db) == acl and _drift(db) == []


# ── PostgreSQL: the real migration chain (320 … 363, then 364) ──────────────

def _chain_migrations() -> list[Path]:
    return [path for path in inv._forward_migrations() if path.name != NAME]


@pytest.fixture(scope="module")
def chain():
    """Template with every forward migration >= 320 except 364 (357/341/344/356 included)."""
    database, created_admin = inv._create_database()
    clones: list[str] = []
    try:
        inv._script(database, inv._pre_320() + inv._pre_320_history())
        for migration in _chain_migrations():
            inv._apply(database, migration)

        def clone(*, with_364: bool) -> tuple[str, str]:
            name = f"mig364c_{uuid4().hex[:12]}"
            for attempt in range(20):   # the template's last psql backend may still be exiting
                try:
                    sql("postgres", f"CREATE DATABASE {name} TEMPLATE {database}")
                    break
                except RuntimeError as error:
                    if "being accessed by other users" not in str(error) or attempt == 19:
                        raise
                    time.sleep(0.5)
            clones.append(name)
            warnings = ""
            if with_364:
                warnings = inv._apply(name, MIGRATIONS / NAME)
                inv._script(name, SQL)   # second apply, outside the ledger
            return name, warnings

        yield clone
    finally:
        for name in clones:
            m334._drop_database(name)
        inv._drop_database(database, created_admin)


def test_chain_includes_the_prerequisites_and_364_itself():
    names = [path.name for path in inv._forward_migrations()]
    assert NAME in names
    for prefix in ("326_", "332_", "337_", "341_", "344_", "356_", "357_"):
        assert any(name.startswith(prefix) for name in names), prefix
    assert names.index("357_public_schema_create_revoke.sql") < names.index(NAME)


def test_chain_red_before_364_and_clean_after(chain):
    before, _ = chain(with_364=False)
    after, warnings = chain(with_364=True)
    red = _drift(before)
    assert len({row.split(":")[0] for row in red if ":service_role:TRIGGER" in row}) > 30, red
    assert _drift(after) == []
    assert _kept(after) == _kept(before)
    # supabase_admin's public default ACL cannot be changed by the hosted runner.
    for grantee in API_ROLES:
        assert (f"svcpriv_default_acl_not_actable: owner=supabase_admin scope=public grantee={grantee} "
                f"privilege=TRIGGER") in warnings
    assert sql(after, f"""SELECT count(*) FROM pg_default_acl d, aclexplode(d.defaclacl) a
        WHERE d.defaclrole = '{inv.OWNER}'::regrole AND d.defaclobjtype = 'r'
          AND a.privilege_type IN ('TRIGGER', 'REFERENCES', 'TRUNCATE')""") == "0"
    for relation in ("users", "students", "student_cohort_memberships", "cohorts", "access_codes"):
        assert f"svcpriv_priority_relation_missing: {relation}" not in warnings


def _priority_tables(database: str) -> list[str]:
    names = re.search(r"priority_relations CONSTANT text\[\] := ARRAY\[(.*?)\];", CODE, re.S).group(1)
    return [name for name in re.findall(r"'([a-z_]+)'", names)
            if sql(database, f"SELECT to_regclass('public.{name}') IS NOT NULL") == "t"]


def test_chain_genuine_service_role_is_refused_on_every_priority_table(chain):
    after, _ = chain(with_364=True)
    tables = _priority_tables(after)
    assert len(tables) >= 14, tables
    for table in tables:
        assert "42501" in _denied(after, "service_role", _plant(table))
        assert "42501" in _denied(after, "service_role", f"TRUNCATE public.{table};")
    sql(after, "CREATE SCHEMA svc_scratch AUTHORIZATION service_role")
    assert "42501" in _denied(after, "service_role",
                              "CREATE TABLE svc_scratch.child (u uuid REFERENCES public.users(id));")
    assert "42501" in _denied(after, "service_role", "CREATE FUNCTION public.lower(v varchar) RETURNS text "
                                                     "LANGUAGE sql AS 'SELECT 1::text';")


def test_chain_access_exclusive_lock_on_activation_attempts_is_refused_on_pg17(chain):
    after, _ = chain(with_364=True)
    if not _pg17(after):
        pytest.skip("MAINTAIN is a PostgreSQL 17 privilege")
    assert sql(after, "SELECT has_table_privilege('service_role', 'public.activation_attempts', 'SELECT')") == "t"
    assert "42501" in _denied(after, "service_role",
                              "LOCK TABLE public.activation_attempts IN ACCESS EXCLUSIVE MODE;")


IDS = {name: f"00000000-0000-0000-0000-0000000003{n:02d}" for n, name in enumerate(
    ("admin", "instructor", "learner", "student", "class_a", "class_b"))}
VOLATILE = {"audit_id", "archived_at", "suspended_at"}
WRITTEN = ("student_lifecycle_audit", "class_lifecycle_audit", "staff_security_audit", "owner_alert_outbox",
           "student_cohort_memberships", "class_action_log", "staff_privilege_evidence")


def _normalise(value):
    if isinstance(value, dict):
        return {k: "<volatile>" if k in VOLATILE and v is not None else _normalise(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_normalise(v) for v in value]
    return value


def _rpc_suite(database: str) -> dict:
    """The seven backend RPCs of FR-005 as genuine service_role, rolled back."""
    i = IDS
    counts = ", ".join(f"'{t}', (SELECT count(*) FROM public.{t})" for t in WRITTEN)
    out, _ = _psql(database, f"""BEGIN;
INSERT INTO public.users (id, email, role, is_active) VALUES
    ('{i["admin"]}', 'admin@q364.test', 'admin', true),
    ('{i["instructor"]}', 'instructor@q364.test', 'instructor', true),
    ('{i["learner"]}', 'learner@q364.test', 'student', true);
INSERT INTO public.cohorts (id, name) VALUES ('{i["class_a"]}', 'A'), ('{i["class_b"]}', 'B');
INSERT INTO public.students (id, student_code, full_name, user_id)
    VALUES ('{i["student"]}', 'Q364', 'Learner', '{i["learner"]}');
SET LOCAL ROLE service_role;
DO $a$ BEGIN ASSERT current_user = 'service_role'; END $a$;
SELECT 'add|' || (public.fn_add_student_cohort_membership('{i["student"]}', '{i["class_a"]}', '{i["admin"]}')::text);
SELECT 'add_b|' || (public.fn_add_student_cohort_membership('{i["student"]}', '{i["class_b"]}', NULL)::text);
SELECT 'remove|' || (public.fn_remove_student_cohort_membership('{i["student"]}', '{i["class_b"]}')::text);
SELECT 'archive_student|' || (public.fn_archive_student('{i["student"]}', '{i["admin"]}', 'left', false)::text);
SELECT 'restore_student|' || (public.fn_restore_student('{i["student"]}', '{i["admin"]}', NULL, false, false)::text);
SELECT 'archive_cohort|' || (public.fn_archive_cohort('{i["class_b"]}', '{i["admin"]}', 'done')::text);
SELECT 'restore_cohort|' || (public.fn_restore_cohort('{i["class_b"]}', '{i["admin"]}', NULL)::text);
SELECT 'staff|' || row_to_json(r)::text FROM public.fn_set_staff_privilege(
    '{i["admin"]}', '{i["instructor"]}', NULL, false, 'compromised', 'req-364') r;
RESET ROLE;
SELECT 'written|' || json_build_object({counts})::text;
SELECT 'instructor|' || json_build_object('role', role, 'is_active', is_active,
                                          'suspended', suspended_at IS NOT NULL)::text
  FROM public.users WHERE id = '{i["instructor"]}';
ROLLBACK;""")
    rows = dict(line.split("|", 1) for line in out.splitlines() if "|" in line)
    return {key: _normalise(json.loads(value)) if value[:1] in "{[" else value for key, value in rows.items()}


def test_chain_backend_rpcs_behave_exactly_as_before_364(chain):
    before, _ = chain(with_364=False)
    after, _ = chain(with_364=True)
    expected = _rpc_suite(before)
    assert set(expected) == {"add", "add_b", "remove", "archive_student", "restore_student",
                             "archive_cohort", "restore_cohort", "staff", "written", "instructor"}
    assert expected["staff"]["changed"] is True
    assert expected["instructor"] == {"role": "instructor", "is_active": False, "suspended": True}
    assert expected["archive_student"]["status"] == "archived"
    assert _rpc_suite(after) == expected


def test_chain_planted_trigger_runs_as_owner_before_364_and_is_refused_after(chain):
    """P2-SA-1 shape on a table 341 did not harden: students, written by fn_archive_student."""
    before, _ = chain(with_364=False)
    after, _ = chain(with_364=True)
    setup = (f"INSERT INTO public.users (id, email, role, is_active) VALUES ('{IDS['admin']}', "
             f"'a@q364.test', 'admin', true);\nINSERT INTO public.students (id, student_code, full_name) "
             f"VALUES ('{IDS['student']}', 'Q364', 'Learner');")
    attack = _plant("students") + (f"\nSELECT public.fn_archive_student('{IDS['student']}', "
                                   f"'{IDS['admin']}', 'left', false);")
    for database in (before, after):
        _psql(database, setup)
    _, notices = _as(before, "service_role", attack)
    assert f"mig364_planted:students:{inv.OWNER}" in notices
    assert "42501" in _denied(after, "service_role", attack)
    assert "42501" in _denied(after, "service_role", _plant("users"))


# Scenario 10 (FR-008): 344, 356, 357 and 364 applied, then the down of 356.

def _scenario_10_violations(database: str) -> list[str]:
    found = []
    if sql(database, "SELECT count(*) FROM pg_policy WHERE polrelid = 'public.class_action_log'::regclass "
                     "AND polname IN ('cal_admin_append', 'cal_admin_read')") != "0":
        found.append("policy")
    for role in ("anon", "authenticated"):
        for privilege in ("SELECT", "INSERT", "UPDATE", "DELETE", *_privileges(database)):
            if sql(database, f"SELECT has_table_privilege('{role}', 'public.class_action_log', '{privilege}')") == "t":
                found.append(f"{role}:{privilege}")
        if sql(database, f"SELECT has_any_column_privilege('{role}', 'public.class_action_log', "
                         f"'SELECT,INSERT,UPDATE,REFERENCES')") == "t":
            found.append(f"{role}:column")
    probes = {"update": "UPDATE public.class_action_log SET action = action;",
              "delete": "DELETE FROM public.class_action_log;",
              "trigger": _plant("class_action_log"),
              "function": "CREATE FUNCTION public.mig364_probe() RETURNS int LANGUAGE sql AS 'SELECT 1';"}
    for name, statement in probes.items():
        try:
            _as(database, "service_role", statement + "\nROLLBACK; BEGIN;")
            found.append(f"service_role:{name}")
        except RuntimeError as error:
            if "42501" not in str(error):
                raise
    return found + [row for row in _drift(database) if row.startswith("class_action_log:")]


def test_scenario_10_down_of_356_cannot_reopen_class_action_log(chain):
    after, _ = chain(with_364=True)
    assert _scenario_10_violations(after) == []
    downs = sorted((MIGRATIONS / "rollback").glob("356_*.sql"))
    # CALAPPEND-0041 T001 owns the down; until it lands there is none to run
    # (README: "There is no 356 down script"). Each one that lands runs here.
    for down in downs:
        _apply(after, down.read_text(encoding="utf-8"), role=inv.OWNER)
        assert _scenario_10_violations(after) == [], down.name
    # Negative control: a down that re-grants UPDATE/DELETE/TRIGGER is caught by
    # this check and by the FR-006 guard.
    mutated = "GRANT UPDATE, DELETE, TRIGGER ON public.class_action_log TO service_role;\n"
    assert find_table_privilege_grants(mutated) == [(1, "table")]
    _apply(after, mutated, role=inv.OWNER)
    assert {"service_role:update", "service_role:delete", "service_role:trigger"} <= set(
        _scenario_10_violations(after))


# Scenario 11 (FR-007): clone without 357/364 → baseline → explicit feature apply.

def _runner(database: str, *args: str, features: str | None = None) -> subprocess.CompletedProcess:
    env = m334._env()
    env.pop("MIGRATION_FEATURES", None)
    if features is not None:
        env["MIGRATION_FEATURES"] = features
    return subprocess.run([str(BACKEND / "scripts" / "apply_migrations.sh"), *args, m334._url(database)],
                          capture_output=True, text=True, timeout=1200, env=env)


def _ledger(database: str) -> set[str]:
    out = sql(database, "SELECT string_agg(filename, E'\\n') FROM public._schema_migrations")
    return set(out.splitlines()) if out else set()


def test_scenario_11_clone_baseline_leaves_364_pending_and_the_feature_apply_runs_357_then_364(chain):
    clone, _ = chain(with_364=False)
    # The clone source lacks 357 and 364 and the ledger comes back empty.
    sql(clone, "GRANT CREATE ON SCHEMA public TO service_role; DROP TABLE public._schema_migrations")
    red = _drift(clone)
    assert red and sql(clone, "SELECT has_schema_privilege('service_role', 'public', 'CREATE')") == "t"

    refused = _runner(clone, "--baseline", features=GROUP)
    assert refused.returncode == 1 and "REFUSED: --baseline with MIGRATION_FEATURES" in refused.stderr
    assert sql(clone, "SELECT to_regclass('public._schema_migrations') IS NULL") == "t"

    baseline = _runner(clone, "--baseline")
    assert baseline.returncode == 0, baseline.stderr
    ledger = _ledger(clone)
    assert NAME not in ledger and "357_public_schema_create_revoke.sql" not in ledger
    assert f"policy skip: {NAME} [pending_feature:{GROUP}]" in baseline.stdout
    assert _drift(clone) == red   # baselining executed nothing

    plain = _runner(clone)
    assert plain.returncode == 0 and NAME not in _ledger(clone)

    applied = _runner(clone, features=f"public_schema_create_revoke,{GROUP}")
    assert applied.returncode == 0, applied.stderr
    order = [line[3:] for line in applied.stdout.splitlines() if line.startswith("== ")]
    assert order == ["357_public_schema_create_revoke.sql", NAME], applied.stdout
    assert _ledger(clone) - ledger == {"357_public_schema_create_revoke.sql", NAME}
    assert _drift(clone) == []
    assert sql(clone, "SELECT has_schema_privilege('service_role', 'public', 'CREATE')") == "f"


def test_scenario_11_without_357_the_feature_apply_of_364_alone_aborts(chain):
    clone, _ = chain(with_364=False)
    sql(clone, "GRANT CREATE ON SCHEMA public TO service_role; DROP TABLE public._schema_migrations")
    assert _runner(clone, "--baseline").returncode == 0
    ledger, red = _ledger(clone), _drift(clone)
    result = _runner(clone, features=GROUP)
    assert result.returncode != 0 and "svcpriv_schema_create_remains: service_role" in result.stderr
    assert _ledger(clone) == ledger and _drift(clone) == red
