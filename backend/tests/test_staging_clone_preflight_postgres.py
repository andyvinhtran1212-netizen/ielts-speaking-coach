"""Run the real clone script with TWO disposable loopback-only SCRAM clusters.

Opt in with STAGING_CLONE_PG_BIN=/path/to/postgresql/17/bin. Only a copied
script tree and generated local .env files are used; no checkout .env is read.
The migration runner is a fixture stub: acceptance covers reset/restore/ACLs,
not live baselining or curated-vocabulary migrations (covered separately).
"""

from contextlib import ExitStack, contextmanager
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import sys

import pytest


SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
STAGING_REF = "zjphffoujxkpltixsbzj"
PROD_REF = "huwsmtubwulikhlmcirx"
LEDGER = [f"{number}_{name}.sql" for number, name in [
    (234, "vocab_curated_identity_and_editorial"),
    (235, "vocab_curated_tasks_attempts_mastery"),
    (236, "vocab_curated_recommendations_and_flags"),
    (237, "vocab_curated_speaking_signal_maps"),
    (238, "vocab_curated_pilot_metrics"),
    (239, "vocab_curated_context_lookups"),
]]


def run(args, env):
    result = subprocess.run(args, env=env, capture_output=True, text=True, timeout=45)
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()


class Cluster:
    def __init__(self, directory, binaries, password_file, pgpass):
        self.directory = directory
        self.binaries = binaries
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            self.port = sock.getsockname()[1]
        self.env = {"PATH": f"{binaries}:/usr/local/bin:/usr/bin:/bin",
                    "LC_ALL": "C.UTF-8", "PGPASSFILE": str(pgpass)}
        run([str(binaries / "initdb"), "-D", str(directory / "data"),
             "--username=postgres", "--auth-host=scram-sha-256", "--auth-local=scram-sha-256",
             "--pwfile", str(password_file), "--no-locale", "--encoding=UTF8"], self.env)

    def dsn(self, database="postgres", *, staging=False):
        # The clone script requires each URL to name its own project ref.
        app = STAGING_REF if staging else f"synthetic_source_{PROD_REF}"
        return f"postgresql://postgres@127.0.0.1:{self.port}/{database}?application_name={app}"

    def sql(self, sql, name, database="postgres"):
        # Keep the exact local request and captured result as test evidence.
        request = self.directory / f"{name}.sql"
        request.write_text(sql, encoding="utf-8")
        result = subprocess.run(
            [str(self.binaries / "psql"), self.dsn(database), "-X", "-qAt",
             "-v", "ON_ERROR_STOP=1", "-f", str(request)],
            env=self.env, capture_output=True, text=True, timeout=45,
        )
        request.with_suffix(".result").write_text(result.stdout + result.stderr)
        assert result.returncode == 0, result.stderr
        return result.stdout.strip()


@contextmanager
def local_cluster(directory, binaries, password_file, pgpass):
    directory.mkdir(mode=0o700)
    cluster = Cluster(directory, binaries, password_file, pgpass)
    try:
        run([str(binaries / "pg_ctl"), "-D", str(directory / "data"),
             "-l", str(directory / "server.log"), "-o",
             # DSNs use loopback TCP; disable the unused Unix socket so long
             # evidence/basetemp paths cannot exceed AF_UNIX's path limit.
             f"-h 127.0.0.1 -k '' -p {cluster.port} -F", "-w", "start"], cluster.env)
        yield cluster
    finally:
        try:
            if (directory / "data/postmaster.pid").exists():
                run([str(binaries / "pg_ctl"), "-D", str(directory / "data"),
                     "-m", "immediate", "-w", "stop"], cluster.env)
        finally:
            if not (directory / "data/postmaster.pid").exists():
                shutil.rmtree(directory / "data", ignore_errors=True)
                assert not (directory / "data").exists()
                (directory / "cleanup.result").write_text("cluster stopped; data directory removed\n")


@pytest.fixture(scope="module")
def clusters(tmp_path_factory):
    bindir = os.environ.get("STAGING_CLONE_PG_BIN")
    if not bindir:
        pytest.skip("set STAGING_CLONE_PG_BIN to run disposable SCRAM PG17.6+ clusters")
    binaries = Path(bindir).resolve()
    assert all((binaries / tool).is_file() for tool in ("initdb", "pg_ctl", "pg_dump", "psql"))
    root = tmp_path_factory.mktemp("clone-pg")
    root.chmod(0o700)
    password = secrets.token_urlsafe(32)
    password_file = root / "init-password"
    pgpass = root / "pgpass"
    for path, content in [(password_file, password), (pgpass, f"127.0.0.1:*:*:postgres:{password}\n")]:
        path.touch(mode=0o600)
        path.write_text(content)
    try:
        with ExitStack() as stack:
            source, target = [stack.enter_context(local_cluster(root / name, binaries, password_file, pgpass))
                              for name in ("source", "target")]
            for cluster in (source, target):
                cluster.sql("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;", "roles")
                assert cluster.sql("SHOW listen_addresses;", "listen") == "127.0.0.1"
                assert cluster.sql("SHOW password_encryption;", "scram") == "scram-sha-256"
                hba = (cluster.directory / "data/pg_hba.conf").read_text()
                assert all("trust" not in line for line in hba.splitlines() if not line.startswith("#"))
            yield source, target
    finally:
        password_file.unlink(missing_ok=True)
        pgpass.unlink(missing_ok=True)


def sandbox(tmp_path, source, target, database, injection="", appended=""):
    root = tmp_path / "sandbox"
    scripts = root / "backend/scripts"
    (scripts / "sql").mkdir(parents=True)
    for filename in ("staging_clone_schema_from_prod.sh", "staging_clone_preflight.py",
                     "sql/staging_clone_reset.sql", "sql/staging_clone_postconditions.sql"):
        shutil.copyfile(SCRIPTS / filename, scripts / filename)
    (root / "backend/.env").write_text(f"DATABASE_URL={source.dsn(database)}\n")
    (root / "backend/.env.staging").write_text(f"DATABASE_URL={target.dsn(database, staging=True)}\n")
    ledger = root / "fixture-ledger.sql"
    ledger.write_text("INSERT INTO public._schema_migrations(filename) VALUES " +
                      ",".join(f"('{filename}')" for filename in LEDGER) + ";\n")
    runner = scripts / "apply_migrations.sh"
    runner.write_text('#!/usr/bin/env bash\nset -euo pipefail\n'
                      'if [[ "${1:-}" == "--baseline" ]]; then\n'
                      '  touch "$TEST_BASELINE_MARKER"\n'
                      '  psql "$2" -X -q -v ON_ERROR_STOP=1 -f "$TEST_LEDGER_SQL"\nfi\n')
    runner.chmod(0o700)
    # Instrument pg_dump, without replacing the real dump. Inject SQL AFTER the
    # actual ACLs, inside the \restrict block (just before \unrestrict), to
    # prove rollback even when preflight succeeded; `appended` follows the
    # \unrestrict line, as a hand-edited dump would. @KEY@ becomes the dump's
    # own \restrict key: whoever edits the dump file can read it there.
    wrapper = root / "bin"
    wrapper.mkdir()
    dump = wrapper / "pg_dump"
    dump.write_text('#!/usr/bin/env bash\nset -euo pipefail\n'
                    '"$TEST_REAL_PG_DUMP" "$@"\n'
                    'for arg in "$@"; do\n'
                    '  [[ "$arg" != --restrict-key=* ]] || printf %s "${arg#*=}" > "$TEST_RESTRICT_KEY"\n'
                    'done\n'
                    'while [[ "$1" != "-f" ]]; do shift; done\n'
                    'grep -q \'^\\\\unrestrict \' "$2"\n'
                    'awk -v inj="$TEST_INJECTION_SQL" -v app="$TEST_APPENDED_SQL" \''
                    'function emit(file, line) { while ((getline line < file) > 0) '
                    '{ gsub(/@KEY@/, key, line); print line } } '
                    '/^\\\\restrict / { key = $2 } /^\\\\unrestrict / { emit(inj) } { print } '
                    'END { emit(app) }\' "$2" > "$2.inj"\n'
                    'mv "$2.inj" "$2"\n'
                    'stat -c %a "$2" > "$TEST_DUMP_MODE"\n')
    dump.chmod(0o700)
    # Observe generated keys without putting either value in test output or
    # argv. The restore key must differ from the old, on-disk dump frame key.
    python = wrapper / "python3"
    python.write_text('#!/usr/bin/env bash\nset -euo pipefail\n'
                      'if [[ "${1:-}" == -c && "${2:-}" == "import secrets; print(secrets.token_hex(32))" ]]; then\n'
                      '  key=$("$TEST_REAL_PYTHON" "$@")\n'
                      '  printf "%s\\n" "$key" >> "$TEST_GENERATED_KEYS"\n'
                      '  printf "%s\\n" "$key"\n'
                      'else exec "$TEST_REAL_PYTHON" "$@"; fi\n')
    python.chmod(0o700)
    psql = wrapper / "psql"
    psql.write_text('#!/usr/bin/env python3\n'
                    'import json, os, sys\nfrom pathlib import Path\n'
                    'if "-1" in sys.argv:\n'
                    '    sys.path.insert(0, os.environ["TEST_PREFLIGHT_DIR"])\n'
                    '    from staging_clone_preflight import lex\n'
                    '    keys = Path(os.environ["TEST_GENERATED_KEYS"]).read_text().splitlines()\n'
                    '    dumps = list(Path(os.environ["TMPDIR"]).glob("prod_schema_*.sql"))\n'
                    '    sql = dumps[0].read_bytes().decode("utf-8")\n'
                    '    audit = {"dump_count": len(dumps), "restore_key_on_disk": keys[-1] in sql,\n'
                    '             "meta_commands": sum(t.startswith("\\\\") for t in lex(sql))}\n'
                    '    Path(os.environ["TEST_RESTORE_AUDIT"]).write_text(json.dumps(audit))\n'
                    'os.execv(os.environ["TEST_REAL_PSQL"], ["psql", *sys.argv[1:]])\n')
    psql.chmod(0o700)
    # Preserve CR bytes in the actual dump, including its framing/header.
    if injection == "@CRLF_DUMP@":
        dump.write_text(dump.read_text() +
                        'python3 - "$2" <<\'PY\'\n'
                        'from pathlib import Path\nimport sys\n'
                        'p = Path(sys.argv[1]); p.write_bytes(p.read_bytes().replace(b"\\n", b"\\r\\n"))\n'
                        'PY\n')
        injection = ""
    injection_sql = root / "injection.sql"
    injection_sql.write_text(injection)
    appended_sql = root / "appended.sql"
    appended_sql.write_text(appended)
    temporary = root / "temporary"
    temporary.mkdir(mode=0o700)
    env = dict(source.env, PATH=f"{wrapper}:{source.env['PATH']}", TMPDIR=str(temporary),
               TEST_REAL_PG_DUMP=str(source.binaries / "pg_dump"),
               TEST_INJECTION_SQL=str(injection_sql), TEST_APPENDED_SQL=str(appended_sql),
               TEST_DUMP_MODE=str(root / "dump-mode"), TEST_RESTRICT_KEY=str(root / "restrict-key"),
               TEST_REAL_PYTHON=sys.executable, TEST_GENERATED_KEYS=str(root / "generated-keys"),
               TEST_REAL_PSQL=str(source.binaries / "psql"), TEST_PREFLIGHT_DIR=str(scripts),
               TEST_RESTORE_AUDIT=str(root / "restore-audit.json"),
               TEST_BASELINE_MARKER=str(root / "baseline-reached"), TEST_LEDGER_SQL=str(ledger))
    return root, scripts / "staging_clone_schema_from_prod.sh", env


@pytest.mark.parametrize("case, diagnostic", [
    ("missing_role", 'target missing roles: ["Reader, X missing_role"]'),
    ("role_present", None),
    ("natural_dump", None),
    ("allowed_ddl", None),
    ("restore_error", "division by zero"),
    ("global_acl", "global default ACL"),
    ("global_other", "global default ACL"),
    ("session_auth", "SET SESSION AUTHORIZATION"),
    ("other_defaults", "FOR ROLE postgres"),
    ("postcondition_error", "client_write_privilege_lockdown_incomplete"),
    ("log_truncate", "service_role_can_maintain_or_truncate_class_action_log"),
    ("definer_execute", "client_executable_privileged_function"),
    ("column_update", "server_owned_column_still_client_writable"),
    ("default_write", "client_default_write_privilege_survives"),
    ("sequence_update", "client_sequence_update_survives"),
    ("users_policy", "users_update_policy_not_hardened"),
    # PC-J367: hand-edited dumps (SA retest P2-P6, P8, P9, P11) stop before reset.
    ("set_local_role", "changes the restore role (SET ROLE)"),
    ("set_session_role", "changes the restore role (SET ROLE)"),
    ("set_config_role", "changes the restore role (set_config)"),
    ("local_session_auth", "changes the restore role (SET SESSION AUTHORIZATION)"),
    ("commit_then_error", "transaction control"),
    ("begin_commit", "transaction control"),
    ("shell_meta_appended", "meta-command"),
    ("shell_meta_inline", "meta-command"),
    ("connect_meta", "meta-command"),
    # PC-J394 (CR P2-1/P2-2 PoCs): psql and the scanner must not disagree on
    # where a literal ends, even when the dump knows its own \restrict key.
    ("numeric_junk_unrestrict", "numeric literal followed by identifier characters"),
    ("sco_off_commit", "lex differently with standard_conforming_strings on and off"),
    ("set_config_sco_off", "set_config outside pg_dump's search_path header"),
    # PC-J417: these must fail BEFORE reset, not only in a postcondition.
    ("adp_no_schema", "IN SCHEMA public"),
    ("alter_database_sco", "dump alters a role, database or system setting (ALTER DATABASE)"),
    ("alter_system", "dump alters a role, database or system setting (ALTER SYSTEM)"),
    ("create_schema_evil", "dump creates a role, database or schema (CREATE SCHEMA)"),
    ("alter_role_bypassrls", "dump alters a role, database or system setting (ALTER ROLE)"),
    ("grant_role_membership", "dump grants or revokes role membership"),
    ("create_rule", "dump contains CREATE RULE"),
    ("crlf_dump", "carriage return"),
    ("bare_cr_dump", "carriage return"),
    ("hidden_sjis_old_key", "wrong key"),
    ("hidden_gbk_old_key", "wrong key"),
    ("hidden_sjis_other_key", "wrong key"),
    ("hidden_gbk_other_key", "wrong key"),
    # A switch hidden in a function body passes preflight; the postcondition
    # rolls the restore back on ownership or the final role.
    ("hidden_role_switch", "restored_object_not_owned_by_restore_role"),
    ("hidden_role_left", "restore_role_changed"),
])
def test_clone_preflight_and_atomic_restore(clusters, tmp_path, case, diagnostic):
    source, target = clusters
    database = f"clone_{case}"
    for cluster in clusters:
        cluster.sql(f"CREATE DATABASE {database};", f"create-{case}")
    seed = ["CREATE TABLE public.users(id int);",
            "CREATE TABLE public.user_d1_questions(id int, is_active boolean);",
            "GRANT UPDATE(is_active) ON public.user_d1_questions TO authenticated;",
            "CREATE TABLE public.user_vocabulary(id int);",
            "GRANT INSERT, UPDATE, DELETE ON public.user_vocabulary TO authenticated;",
            "CREATE TABLE public.class_action_log(id int);",
            "GRANT SELECT, INSERT ON public.class_action_log TO service_role;",
            "CREATE TABLE public._schema_migrations(filename text);",
            "CREATE FUNCTION public.private_definer() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;",
            "REVOKE ALL ON FUNCTION public.private_definer() FROM PUBLIC;",
            "ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON TABLES TO anon;"]
    seed += [f"CREATE TABLE public.filler_{i}(id int);" for i in range(30)]
    seed += [f"CREATE TABLE public.{name}(id int);" for name in (
        "vocab_learning_units", "vocab_unit_tasks", "vocab_unit_recommendations",
        "vocab_speaking_signal_maps", "vocab_context_lookup_terms")]
    if case in {"missing_role", "role_present"}:
        source.sql(f'CREATE ROLE "Reader, X {case}";', f"reader-{case}")
        seed.append(f'GRANT SELECT ON public.users TO "Reader, X {case}";')
        if case == "role_present":
            target.sql(f'CREATE ROLE "Reader, X {case}";', "target-reader")
    if case == "session_auth":
        source.sql("CREATE ROLE grantor; CREATE ROLE chained_reader;", "chain-roles")
        seed += ["GRANT SELECT ON public.users TO grantor WITH GRANT OPTION;",
                 "SET SESSION AUTHORIZATION grantor;",
                 "GRANT SELECT ON public.users TO chained_reader; RESET SESSION AUTHORIZATION;"]
    if case == "other_defaults":
        source.sql("CREATE ROLE other_owner;", "other-owner")
        seed.append("ALTER DEFAULT PRIVILEGES FOR ROLE other_owner IN SCHEMA public GRANT SELECT ON TABLES TO anon;")
    if case == "postcondition_error":
        seed.append("GRANT UPDATE ON public.users TO anon;")
    if case == "log_truncate":
        seed.append("GRANT TRUNCATE ON public.class_action_log TO service_role;")
    if case == "definer_execute":
        seed.append("GRANT EXECUTE ON FUNCTION public.private_definer() TO PUBLIC;")
    if case == "column_update":
        seed.append("GRANT UPDATE(id) ON public.user_d1_questions TO authenticated;")
    if case == "default_write":
        seed.append("ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT INSERT ON TABLES TO anon;")
    if case == "sequence_update":
        seed.append("CREATE SEQUENCE public.seq; GRANT UPDATE ON SEQUENCE public.seq TO anon;")
    if case == "users_policy":
        seed.append('CREATE POLICY "Users can update own data" ON public.users FOR UPDATE TO authenticated USING (true);')
    source.sql("\n".join(seed), f"seed-{case}", database)
    target.sql("CREATE TABLE public.decoy(id int); INSERT INTO public.decoy VALUES (42);",
               f"decoy-{case}", database)
    if case == "global_acl":
        target.sql("ALTER DEFAULT PRIVILEGES GRANT TRUNCATE ON TABLES TO anon;", "global-acl", database)
    if case == "global_other":
        target.sql("CREATE ROLE global_reader; ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO global_reader;",
                   "global-other", database)
    catalog_sql = ("SELECT json_build_object("
                   "'evil_schema', EXISTS(SELECT FROM pg_namespace WHERE nspname = 'evil'), "
                   "'settings', (SELECT coalesce(json_agg(s ORDER BY setdatabase, setrole)::text, '[]') "
                   "FROM pg_db_role_setting s), "
                   "'global_acl', (SELECT coalesce(json_agg(a ORDER BY oid)::text, '[]') "
                   "FROM pg_default_acl a WHERE defaclnamespace = 0), "
                   "'anon_bypassrls', (SELECT rolbypassrls FROM pg_roles WHERE rolname = 'anon'), "
                   "'memberships', (SELECT json_agg(m ORDER BY roleid, member, grantor)::text "
                   "FROM pg_auth_members m));")
    catalog_before = target.sql(catalog_sql, f"catalog-before-{case}", database)
    decoy_oid = target.sql("SELECT 'public.decoy'::regclass::oid;", f"decoy-oid-{case}", database)
    marker = tmp_path / "meta-command-ran"
    # A non-volatile ADD COLUMN default is evaluated once, at restore time.
    # service_role holds USAGE only on public (SVCPRIV-0042 FR-007), so a role
    # switched to it can no longer create. The switch case grants CREATE to
    # another role inside the dump, so the ownership postcondition still runs.
    become = ("CREATE FUNCTION public.become(r text) RETURNS text LANGUAGE sql STABLE "
              "AS $$ SELECT set_config('role', r, false) $$;\n"
              "ALTER TABLE public.filler_1 ADD COLUMN switch_1 text DEFAULT public.become('service_role');\n")
    switch = ("GRANT CREATE ON SCHEMA public TO authenticated;\n"
              + become.replace("'service_role'", "'authenticated'")
              + "CREATE TABLE public.svc_owned(id int);\n")
    injection, appended = {
        "adp_no_schema": ("ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT SELECT ON TABLES TO anon;\n", ""),
        "alter_database_sco": (f"ALTER DATABASE {database} SET standard_conforming_strings TO off;\n", ""),
        "alter_system": ("ALTER SYSTEM SET log_statement = 'none';\n", ""),
        "create_schema_evil": ("CREATE SCHEMA evil; GRANT USAGE ON SCHEMA evil TO anon;\n", ""),
        "alter_role_bypassrls": ("ALTER ROLE anon BYPASSRLS;\n", ""),
        "grant_role_membership": ("GRANT service_role TO anon;\n", ""),
        "create_rule": ("CREATE RULE r AS ON INSERT TO public.users DO ALSO NOTIFY x;\n", ""),
        "crlf_dump": ("@CRLF_DUMP@", ""),
        "bare_cr_dump": ("COMMENT ON TABLE public.users\r IS 'x';\n", ""),
        # Positive peers: ALTER FUNCTION, object ACLs, and DDL words in an
        # opaque routine body/comment are not top-level cluster commands.
        "allowed_ddl": ("ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA \"public\" "
                        "REVOKE ALL ON FUNCTIONS FROM PUBLIC;\n"
                        "CREATE OR REPLACE FUNCTION public.ddl_words() RETURNS text LANGUAGE sql AS $$ "
                        "SELECT 'ALTER DATABASE app SET standard_conforming_strings TO off; "
                        "ALTER SYSTEM SET log_statement = ''none''; CREATE RULE r;' $$;\n"
                        "ALTER FUNCTION public.ddl_words() SET search_path TO '';\n"
                        "GRANT USAGE ON SCHEMA public TO anon;\n"
                        "REVOKE ALL ON TABLE public.users FROM PUBLIC;\n"
                        "COMMENT ON SCHEMA public IS 'CREATE SCHEMA evil; ALTER ROLE anon BYPASSRLS;';\n"
                        "COMMENT ON TABLE public.users IS 'C:\\r';\n", ""),
        # Runtime error after the real ACLs; a top-level SELECT and CREATE
        # TABLE ... AS are now refused, an ADD COLUMN default still runs.
        "restore_error": ("ALTER TABLE public.filler_0 ADD COLUMN boom integer DEFAULT (1/0);\n", ""),
        "set_local_role": ("SET LOCAL ROLE service_role;\nCREATE TABLE public.svc_owned(id int);\n"
                           "RESET ROLE;\n", ""),
        "set_session_role": ("SET SESSION ROLE service_role;\nCREATE TABLE public.svc_owned(id int);\n"
                             "RESET ROLE;\n", ""),
        "set_config_role": ("SELECT pg_catalog.set_config('role', 'service_role', true);\n"
                            "CREATE TABLE public.svc_owned(id int);\n", ""),
        "local_session_auth": ("SET LOCAL SESSION AUTHORIZATION service_role;\n", ""),
        "commit_then_error": ("COMMIT;\nCREATE TABLE public.boom AS SELECT 1/0 AS x;\n", ""),
        "begin_commit": ("BEGIN;\nGRANT SELECT ON TABLE public.filler_6 TO anon;\nCOMMIT;\n", ""),
        "shell_meta_appended": ("", f"\\! touch {marker}\n"),
        "shell_meta_inline": (f"GRANT SELECT ON TABLE public.filler_6 TO anon; \\! touch {marker}\n", ""),
        "connect_meta": ("", "\\connect postgres\nCREATE TABLE public.boom AS SELECT 1/0 AS x;\n"),
        "hidden_role_switch": (switch + "ALTER TABLE public.svc_owned ADD COLUMN switch_2 text "
                               "DEFAULT public.become('none');\n", ""),
        # CR P2-1: psql >= 15 reads 1e as one junk token, so E'x\' is no string.
        "numeric_junk_unrestrict": ("COMMENT ON TABLE public.filler_0 IS 1e'x\\'\n\\unrestrict @KEY@\n"
                                    f"\\! touch {marker}\n\\restrict @KEY@\n-- '\n;\n", ""),
        # CR P2-2: once a routine turns standard_conforming_strings off, psql
        # reads '\' ' as one literal and sends the COMMIT.
        "sco_off_commit": ("CREATE TABLE public.z AS SELECT pg_catalog.set_config("
                           "'standard_conforming_strings', 'off', false) AS x;\n"
                           "COMMENT ON TABLE public.filler_0 IS '\\' '; COMMIT; "
                           "COMMENT ON TABLE public.filler_0 IS 'q' -- '\n;\n"
                           "CREATE TABLE public.boom AS SELECT 1/0 AS x;\n", ""),
        # The set_config layer alone, without a desynchronizing literal.
        "set_config_sco_off": ("ALTER TABLE public.filler_0 ADD COLUMN x text DEFAULT "
                               "pg_catalog.set_config('standard_conforming_strings', 'off', false);\n", ""),
        "hidden_role_left": (become, ""),
    }.get(case, ("", ""))
    if case.startswith("hidden_sjis_") or case.startswith("hidden_gbk_"):
        encoding, char = ("SJIS", "Á") if "sjis" in case else ("GBK", "ặ")
        unlock = "@KEY@" if case.endswith("old_key") else "notThisRunsKey"
        injection = ("CREATE FUNCTION public.enc() RETURNS integer LANGUAGE sql STABLE AS $$ "
                     f"SELECT 0 FROM pg_catalog.set_config('client_encoding', '{encoding}', false) $$;\n"
                     "ALTER TABLE public.filler_1 ADD COLUMN enc integer DEFAULT public.enc();\n"
                     f"COMMENT ON TABLE public.filler_2 IS '{char}' || '\n"
                     f"\\unrestrict {unlock}\n\\! touch {marker}\n\\restrict {unlock}\n';\n")
    root, script, env = sandbox(tmp_path, source, target, database, injection, appended)
    result = subprocess.run(["bash", str(script)], env=env, capture_output=True, text=True, timeout=60)
    (root / "clone.result").write_text(result.stdout + result.stderr)
    assert (root / "dump-mode").read_text().strip() == "600"
    # A fresh key per run went to pg_dump; it is never printed.
    key = (root / "restrict-key").read_text()
    assert len(key) == 64 and int(key, 16) >= 0
    assert key not in result.stdout + result.stderr
    generated_keys = (root / "generated-keys").read_text().splitlines()
    assert all(value not in result.stdout + result.stderr for value in generated_keys)
    if "preflight passed" in result.stdout:
        assert len(generated_keys) == 2
        assert generated_keys[0] != generated_keys[1]
        assert json.loads((root / "restore-audit.json").read_text()) == {
            "dump_count": 1, "restore_key_on_disk": False, "meta_commands": 0}
    assert not marker.exists(), "no psql meta-command from the dump may run"
    assert not list((root / "temporary").iterdir()), "dump and .tmp must be removed"
    if diagnostic:
        assert result.returncode != 0
        assert diagnostic in result.stderr
        assert not (root / "baseline-reached").exists()
        assert target.sql("SELECT id FROM public.decoy;", f"decoy-survived-{case}", database) == "42"
        assert target.sql("SELECT 'public.decoy'::regclass::oid;", f"decoy-oid-after-{case}", database) == decoy_oid
        assert target.sql(catalog_sql, f"catalog-after-{case}", database) == catalog_before
        assert target.sql("SELECT NOT EXISTS(SELECT FROM pg_namespace WHERE nspname = 'evil');",
                          f"no-evil-{case}", database) == "t"
        assert target.sql("SELECT to_regclass('public.users') IS NULL;",
                          f"no-partial-restore-{case}", database) == "t"
        if case in {"restore_error", "postcondition_error", "log_truncate", "definer_execute",
                    "column_update", "default_write", "sequence_update", "users_policy",
                    "hidden_role_switch", "hidden_role_left", "hidden_sjis_old_key", "hidden_gbk_old_key",
                    "hidden_sjis_other_key", "hidden_gbk_other_key"}:
            assert "preflight passed" in result.stdout
            assert "restoring atomically" in result.stdout
        else:
            assert "REFUSED:" in result.stderr
            assert "== resetting" not in result.stdout
            assert "restoring atomically" not in result.stdout
    else:
        assert result.returncode == 0, result.stderr
        assert (root / "baseline-reached").exists()
        assert target.sql("SELECT to_regclass('public.decoy') IS NULL;", "decoy-replaced", database) == "t"
        assert target.sql("SELECT has_table_privilege('anon','public.users','UPDATE'), "
                          "has_table_privilege('service_role','public.class_action_log','TRUNCATE'), "
                          "has_function_privilege('anon','public.private_definer()','EXECUTE');",
                          f"restored-acls-{case}", database) == "f|f|f"
        if case == "role_present":
            assert target.sql("SELECT has_table_privilege('Reader, X role_present','public.users','SELECT');",
                              "restored-reader", database) == "t"
