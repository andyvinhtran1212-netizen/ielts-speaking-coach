"""Dump parsing tests; no environment files, network or database connections."""

import json
from pathlib import Path
import subprocess
import sys

import pytest

from scripts.staging_clone_preflight import referenced_roles


SCRIPT = Path(__file__).resolve().parents[1] / "scripts/staging_clone_preflight.py"
BASE_ROLES = {"postgres", "anon", "authenticated", "service_role"}


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
     '\\restrict local_key\nGRANT EXECUTE ON FUNCTION public.f() TO PUBLIC;\n'
     '\\unrestrict local_key\n', set()),
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


@pytest.mark.parametrize("global_acl, missing", [(True, False), (False, True), (False, False)])
def test_preflight_cli_fails_closed_before_reset(tmp_path, global_acl, missing):
    dump = tmp_path / "dump.sql"
    dump.write_text('GRANT SELECT ON public.t TO "Missing, Role";')
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
