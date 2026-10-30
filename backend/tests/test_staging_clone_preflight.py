"""Dump parsing tests; no environment files, network or database connections."""

import json
from pathlib import Path
import subprocess
import sys

import pytest

from scripts.staging_clone_preflight import preflight_dump, referenced_roles


SCRIPT = Path(__file__).resolve().parents[1] / "scripts/staging_clone_preflight.py"
BASE_ROLES = {"postgres", "anon", "authenticated", "service_role"}
# pg_dump 17.6+ framing: one \restrict before and one \unrestrict after all SQL.
HEADER = ("--\n-- PostgreSQL database dump\n--\n\n\\restrict k3Y\n\n"
          "SET statement_timeout = 0;\nSET client_encoding = 'UTF8';\n"
          "SET standard_conforming_strings = on;\n"
          "SELECT pg_catalog.set_config('search_path', '', false);\n"
          "SET check_function_bodies = false;\nSET row_security = off;\n")
FOOTER = "\n--\n-- PostgreSQL database dump complete\n--\n\n\\unrestrict k3Y\n\n"


def framed(sql: str) -> str:
    return HEADER + sql + FOOTER


@pytest.mark.parametrize("sql, expected", [
    ('GRANT SELECT ON TABLE public.t TO missing_x;', {"missing_x"}),
    ('REVOKE ALL ON TABLE public.t FROM "Mixed, Role", PUBLIC;', {"Mixed, Role"}),
    ('GRANT SELECT\nON TABLE public.t\nTO "quote""role", "public", "PUBLIC";',
     {'quote"role', 'public', 'PUBLIC'}),
    ('ALTER TABLE public.t OWNER TO "Owner X";', {"Owner X"}),
    ('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON TABLES TO x;', {"x"}),
    ('CREATE POLICY p ON public.t FOR SELECT TO policy_reader USING (true);', {"policy_reader"}),
    ('CREATE SCHEMA x AUTHORIZATION schema_owner;', {"schema_owner"}),
    ('GRANT role_x TO role_y GRANTED BY role_z;', {"role_x", "role_y", "role_z"}),
    ('GRANT UPDATE (a, b) ON TABLE public.t TO x WITH GRANT OPTION;', {"x"}),
    ('REVOKE GRANT OPTION FOR SELECT ON TABLE public.t FROM x CASCADE;', {"x"}),
    ('-- GRANT SELECT ON public.t TO ghost;\n'
     'CREATE FUNCTION public.f() RETURNS text LANGUAGE sql AS $body$ '
     "SELECT 'SET SESSION AUTHORIZATION ghost; GRANT ALL TO ghost;' $body$;\n"
     'GRANT EXECUTE ON FUNCTION public.f() TO PUBLIC;\n', set()),
    ('\\restrict localKey9\nGRANT EXECUTE ON FUNCTION public.f() TO PUBLIC;\n'
     '\\unrestrict localKey9\n', set()),
    # Ordinary uses of a column named role, and pg_dump function SET clauses.
    ("ALTER TABLE ONLY public.users ALTER COLUMN role SET DEFAULT 'user'::text;\n"
     "CREATE INDEX users_role ON public.users USING btree (role);\n"
     "CREATE FUNCTION public.g() RETURNS void LANGUAGE sql SET search_path TO '' AS $$ $$;\n"
     "CREATE TRIGGER t BEFORE UPDATE OF role ON public.users FOR EACH ROW EXECUTE FUNCTION public.h();\n"
     "COMMENT ON TABLE public.users IS 'C:\\path\\x';\n", set()),
])
def test_extracts_role_references_from_pg_dump_statements(sql, expected):
    assert referenced_roles(sql) == BASE_ROLES | expected


@pytest.mark.parametrize("sql, error", [
    ('SET SESSION AUTHORIZATION postgres;', 'SET SESSION AUTHORIZATION'),
    ('SET\nSESSION AUTHORIZATION "grantor";', 'SET SESSION AUTHORIZATION'),
    ('SET ROLE postgres;', 'SET ROLE'),
    ('ALTER DEFAULT PRIVILEGES FOR ROLE other IN SCHEMA public GRANT SELECT ON TABLES TO anon;',
     'FOR ROLE postgres'),
    ('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO anon;', 'FOR ROLE postgres'),
    ('GRANT SELECT ON public.t TO x', 'unterminated'),
])
def test_refuses_unsupported_restore_authority(sql, error):
    with pytest.raises(ValueError, match=error):
        referenced_roles(sql)


ROLE_CHANGE = "changes the restore role"


# P3-N1: every SET/RESET role form at any token position, and set_config.
@pytest.mark.parametrize("sql", [
    'SET LOCAL ROLE service_role;',
    'SET SESSION ROLE service_role;',
    'set   session\n\tauthorization   dashboard_user;',
    'SET LOCAL SESSION AUTHORIZATION dashboard_user;',
    'SET role = service_role;',
    'SET "role" TO service_role;',
    "SET session_authorization TO 'x';",
    'RESET ROLE;',
    'RESET SESSION AUTHORIZATION;',
    'ALTER FUNCTION public.f() SET role TO service_role;',
    'CREATE FUNCTION public.f() RETURNS int LANGUAGE sql SET role = service_role AS $$ SELECT 1 $$;',
])
def test_refuses_every_role_change_form(sql):
    with pytest.raises(ValueError, match=ROLE_CHANGE):
        referenced_roles(sql)


@pytest.mark.parametrize("sql, error", [
    ("SELECT pg_catalog.set_config('role', 'service_role', true);", ROLE_CHANGE),
    ("SELECT set_config('ROLE', 'service_role', false);", ROLE_CHANGE),
    ("SELECT \"set_config\"('session_authorization', 'x', false);", ROLE_CHANGE),
    ("CREATE TABLE public.t AS SELECT set_config('role', 'service_role', false);", ROLE_CHANGE),
    # A non-literal name could be anything, including role.
    ("CREATE TABLE public.t AS SELECT set_config(E'role', 'x', false);", "set_config"),
    ("CREATE TABLE public.t AS SELECT set_config('ro' || 'le', 'x', false);", "set_config"),
    # Code that pg_dump --schema-only never runs at restore time.
    ("SELECT public.switch_role();", "top-level SELECT"),
    ("SELECT pg_catalog.set_config('statement_timeout', '0', false);", "top-level SELECT"),
    ("DO $$BEGIN PERFORM set_config('role', 'service_role', false); END$$;", "DO"),
    ("CALL public.switch_role();", "CALL"),
    ("EXECUTE switch_role;", "EXECUTE"),
    ("WITH x AS (SELECT public.switch_role()) SELECT 1;", "WITH"),
    ("COPY (SELECT public.switch_role()) TO STDOUT;", "COPY"),
    ("REFRESH MATERIALIZED VIEW public.mv;", "REFRESH"),
    ("SELECT pg_catalog.set_config('search_path', '', false), public.switch_role();", "top-level SELECT"),
])
def test_refuses_set_config_role_and_restore_time_code(sql, error):
    with pytest.raises(ValueError, match=error):
        referenced_roles(sql)


# P3-N2: transaction control breaks the atomicity of psql -1.
@pytest.mark.parametrize("sql", [
    "BEGIN;", "begin\n  transaction;", "START TRANSACTION;", "COMMIT;", "commit\n;", "END;",
    "ROLLBACK;", "ABORT;", "SAVEPOINT s;", "RELEASE SAVEPOINT s;", "RELEASE s;",
    "ROLLBACK TO SAVEPOINT s;", "PREPARE TRANSACTION 'x';", "COMMIT PREPARED 'x';",
    "ROLLBACK PREPARED 'x';", "PREPARE p AS SELECT 1;",
])
def test_refuses_transaction_control(sql):
    with pytest.raises(ValueError, match="transaction control"):
        referenced_roles(sql)


# P3-N3: only one \restrict/\unrestrict pair, at the edges; no other meta-command
# anywhere, and no lexer state that would make psql see a backslash we did not.
@pytest.mark.parametrize("sql, error", [
    ("\\! touch /tmp/x\n", "meta-command"),
    ("GRANT SELECT ON public.t TO anon; \\! touch /tmp/x\n", "meta-command"),
    ("\\connect app\n", "meta-command"),
    ("\\c app\n", "meta-command"),
    ("\\o /tmp/out\n", "meta-command"),
    ("\\i /tmp/other.sql\n", "meta-command"),
    ("\\copy public.t from '/tmp/x'\n", "meta-command"),
    ("\\set ON_ERROR_STOP 0\n", "meta-command"),
    ("GRANT SELECT ON public.t TO anon \\gexec\n", "meta-command"),
    # psql reads E'\'' as one string, so the \! after it is live.
    ("COMMENT ON TABLE public.t IS E'\\'' \\! touch /tmp/x ';\n", "meta-command"),
    # psql dollar tags may use any non-ASCII letter.
    ("COMMENT ON TABLE public.t IS $\u00e9$ ' $\u00e9$; \\! touch /tmp/x\n';\n", "meta-command"),
    # Block comments nest in psql; a non-nesting scan would hide the \!.
    ("/* /* */ ' */ \\! touch /tmp/x\n';\n", "nested block comment"),
    ("/* never closed\n", "unterminated block comment"),
    ("SET standard_conforming_strings = off;", "standard_conforming_strings"),
    ("SET client_encoding = 'SJIS';", "client_encoding"),
    ("RESET ALL;", "RESET"),
])
def test_refuses_meta_commands_and_lexer_desync(sql, error):
    with pytest.raises(ValueError, match=error):
        preflight_dump(framed(sql))


@pytest.mark.parametrize("dump, error", [
    ("GRANT SELECT ON public.t TO anon;\n", "exactly one"),
    ("\\restrict k3Y\nGRANT SELECT ON public.t TO anon;\n", "exactly one"),
    ("\\restrict k3Y\nGRANT SELECT ON public.t TO anon;\n\\unrestrict other\n", "same key"),
    ("GRANT SELECT ON public.t TO anon;\n\\restrict k3Y\n\\unrestrict k3Y\n", "before"),
    ("\\restrict k3Y\n\\unrestrict k3Y\nGRANT SELECT ON public.t TO anon;\n", "after"),
    ("\\restrict k3Y\n\\restrict k3Y\nGRANT SELECT ON public.t TO anon;\n\\unrestrict k3Y\n",
     "exactly one"),
    ("\\restrict k3Y\nGRANT SELECT ON public.t TO anon;\n\\unrestrict k3Y\n\\! touch /tmp/x\n",
     "meta-command"),
    ("\\restrict k3Y \\! touch /tmp/x\nGRANT SELECT ON public.t TO anon;\n\\unrestrict k3Y\n",
     "restrict"),
    ("SET row_security = off; \\restrict k3Y\nGRANT SELECT ON public.t TO anon;\n\\unrestrict k3Y\n",
     "before"),
])
def test_requires_one_restrict_pair_at_the_edges(dump, error):
    with pytest.raises(ValueError, match=error):
        preflight_dump(dump)


def test_pg_dump_framing_passes():
    assert preflight_dump(framed("GRANT SELECT ON TABLE public.t TO anon;\n")) == BASE_ROLES


@pytest.mark.parametrize("global_acl, missing", [(True, False), (False, True), (False, False)])
def test_preflight_cli_fails_closed_before_reset(tmp_path, global_acl, missing):
    dump = tmp_path / "dump.sql"
    dump.write_text(framed('GRANT SELECT ON public.t TO "Missing, Role";'))
    roles = BASE_ROLES | (set() if missing else {"Missing, Role"})
    result = subprocess.run(
        [sys.executable, str(SCRIPT), str(dump)],
        input=json.dumps({"roles": sorted(roles), "global_default_acl": global_acl}),
        capture_output=True, text=True,
    )
    assert result.returncode == int(global_acl or missing)
    if global_acl:
        assert "global default ACL" in result.stderr
    elif missing:
        assert '"Missing, Role"' in result.stderr
    else:
        assert "preflight passed" in result.stdout


@pytest.mark.parametrize("version, identical, error", [
    ("17.5", False, "psql >= 17.6"),
    ("16.11", False, "psql >= 17.6"),
    ("unknown", False, "psql >= 17.6"),
    ("17.6", True, "source and target URLs are identical"),
    ("18.0", True, "source and target URLs are identical"),
])
def test_client_version_and_identical_url_guards_precede_dump(tmp_path, version, identical, error):
    root = tmp_path / "sandbox"
    scripts = root / "backend/scripts"
    scripts.mkdir(parents=True)
    clone = scripts / "staging_clone_schema_from_prod.sh"
    clone.write_text(SCRIPT.with_name(clone.name).read_text())
    # Synthetic URL includes the staging reference, to exercise equality even
    # when the existing positive project-ref guard would otherwise pass.
    url = "postgresql://postgres@127.0.0.1:1/test?application_name=zjphffoujxkpltixsbzj"
    (root / "backend/.env").write_text(f"DATABASE_URL={url}\n")
    (root / "backend/.env.staging").write_text(f"DATABASE_URL={url if identical else url + 'different'}\n")
    wrapper = root / "bin"
    wrapper.mkdir()
    psql = wrapper / "psql"
    psql.write_text(f"#!/bin/sh\nprintf '%s\\n' 'psql (PostgreSQL) {version}'\n")
    psql.chmod(0o700)
    dump = wrapper / "pg_dump"
    dump.write_text('#!/bin/sh\ntouch "$TEST_DUMP_MARKER"\nexit 99\n')
    dump.chmod(0o700)
    marker = root / "dump-reached"
    result = subprocess.run(["bash", str(clone)], capture_output=True, text=True,
                            env={"PATH": f"{wrapper}:/usr/bin:/bin", "LC_ALL": "C.UTF-8",
                                 "TEST_DUMP_MARKER": str(marker)})
    assert result.returncode != 0
    assert error in result.stderr
    assert not marker.exists()


# P3-8: different strings can still name one database (pooler vs direct host),
# so the source must positively name production and never staging.
@pytest.mark.parametrize("prod_url, error", [
    ("postgresql://postgres@127.0.0.1:1/test?application_name=some_other_project",
     "production URL does not name the production project"),
    ("postgresql://postgres.huwsmtubwulikhlmcirx@127.0.0.1:1/test?application_name=zjphffoujxkpltixsbzj",
     "production URL names the staging project"),
])
def test_source_url_must_name_production_and_not_staging(tmp_path, prod_url, error):
    root = tmp_path / "sandbox"
    scripts = root / "backend/scripts"
    scripts.mkdir(parents=True)
    clone = scripts / "staging_clone_schema_from_prod.sh"
    clone.write_text(SCRIPT.with_name(clone.name).read_text())
    staging_url = "postgresql://postgres.zjphffoujxkpltixsbzj@127.0.0.1:2/test"
    (root / "backend/.env").write_text(f"DATABASE_URL={prod_url}\n")
    (root / "backend/.env.staging").write_text(f"DATABASE_URL={staging_url}\n")
    wrapper = root / "bin"
    wrapper.mkdir()
    psql = wrapper / "psql"
    psql.write_text("#!/bin/sh\nprintf '%s\\n' 'psql (PostgreSQL) 17.6'\n")
    psql.chmod(0o700)
    dump = wrapper / "pg_dump"
    dump.write_text('#!/bin/sh\ntouch "$TEST_DUMP_MARKER"\nexit 99\n')
    dump.chmod(0o700)
    marker = root / "dump-reached"
    result = subprocess.run(["bash", str(clone)], capture_output=True, text=True,
                            env={"PATH": f"{wrapper}:/usr/bin:/bin", "LC_ALL": "C.UTF-8",
                                 "TEST_DUMP_MARKER": str(marker)})
    assert result.returncode != 0
    assert error in result.stderr
    assert not marker.exists()
    # Neither the URLs nor the project refs are echoed to the operator log.
    for secret in (prod_url, staging_url, "huwsmtubwulikhlmcirx", "zjphffoujxkpltixsbzj"):
        assert secret not in result.stdout + result.stderr
