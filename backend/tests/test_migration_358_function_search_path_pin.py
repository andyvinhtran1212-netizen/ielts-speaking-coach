"""Migration 358 (PC-J406, SVCPRIV-0042 FR-010): every function in schema
public has a pinned search_path, so a caller's temp objects cannot shadow the
names a trigger resolves while it runs as the table owner.

SA P2-R2-1 (SA-SPEC-357-R2, 2026-10-30): the four trigger functions of 283
have no SET search_path. service_role, even without TRIGGER and schema CREATE
(the state after NNN), keeps the database TEMP privilege. It creates
TEMP VIEW grammar_content_releases calling pg_temp.evil() and deletes a draft
release; the ON DELETE CASCADE runs as the owner of grammar_lessons, its
BEFORE DELETE trigger reads the unqualified name, pg_temp comes first, and
evil() runs as the owner: GRANT TRIGGER ON public.users TO service_role.

The static half pins the migration's shape. The PostgreSQL half builds a
disposable database on the LOCAL cluster in TEST_PG_URL: a NOSUPERUSER runner
owns everything, 283 runs verbatim up to its four trigger functions, and the
NNN end state is emulated (service_role keeps CRUD only, no schema CREATE).
Roles follow the P3-SA-8 pattern: rolsuper is false for anon, authenticated
and service_role (rolbypassrls f/f/t), and every exploit runs after
SET LOCAL ROLE service_role with ASSERT current_user in the same transaction.
Before 358 the exploit succeeds (control); after 358 it records nothing.
Owner paths of the two table-reading functions give the same results before
and after; a hostile session search_path stops working too; a second apply is
a no-op; the precondition and postcondition fire on the states they guard.

Set TEST_PG_URL to a LOCAL disposable cluster and REQUIRE_PG=1 to forbid skips.
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

BACKEND = Path(__file__).resolve().parents[1]
MIGRATIONS = BACKEND / "migrations"
NAME = "358_public_function_search_path_pin.sql"
SQL = (MIGRATIONS / NAME).read_text(encoding="utf-8")
CODE = _strip_sql_comments(SQL)
GRAMMAR_SQL = (MIGRATIONS / "283_master30_grammar_diagnostic.sql").read_text(encoding="utf-8")
RUNNER = "fn358_runner"
PIN = "search_path=public, pg_temp"
GRAMMAR_FUNCTIONS = ("prevent_completed_grammar_session_mutation", "prevent_grammar_evidence_mutation",
                     "prevent_grammar_release_content_mutation", "prevent_validated_grammar_release_rewrite")
DRAFT = "00000000-0000-0000-0000-0000000000a1"
VALIDATED = "00000000-0000-0000-0000-0000000000a2"
LEARNER = "00000000-0000-0000-0000-0000000000b1"
UNPINNED = """SELECT coalesce(string_agg(p.oid::regprocedure::text, ',' ORDER BY p.oid::regprocedure::text), '')
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p')
   AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}'::text[])) c
                    WHERE c LIKE 'search_path=%')"""


# ── Static contract ─────────────────────────────────────────────────────────

def test_one_transaction_with_lock_timeout_and_no_other_change():
    assert CODE.strip().startswith("BEGIN;") and CODE.strip().endswith("COMMIT;")
    assert "SET LOCAL lock_timeout = '5s';" in CODE
    for forbidden in (r"DELETE\s+FROM", r"\bTRUNCATE\b", r"^\s*UPDATE\s", r"INSERT\s+INTO", r"ALTER\s+TABLE",
                      r"\bGRANT\b", r"\bREVOKE\b", r"CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)",
                      r"\bDROP\b", r"\bRESET\b", r"OWNER\s+TO", r"pg_temp\.\w"):
        assert not re.search(forbidden, CODE, re.M | re.I), forbidden
    # The only object change: ALTER ROUTINE ... SET search_path, built per routine.
    assert re.findall(r"ALTER\s+\w+", CODE) == ["ALTER ROUTINE"]
    assert "EXECUTE format('ALTER ROUTINE %s SET search_path = public, pg_temp', r.fn);" in CODE


def test_pin_value_keeps_pg_temp_last_and_is_never_empty():
    values = set(re.findall(r"search_path\s*=\s*([\w, ]+?)(?=[';\n]| on )", CODE))
    # The runner's own session path (regprocedure output stays schema-qualified)
    # and the pinned value; nothing else.
    assert values == {"pg_catalog, pg_temp", "public, pg_temp"}, values
    assert "search_path = ''" not in CODE
    assert f"c = '{PIN}'" in CODE


def test_every_scan_is_the_whole_public_schema_without_exclusions():
    code = re.sub(r"\s+", " ", CODE)
    predicate = ("NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}'::text[])) AS c "
                 "WHERE c LIKE 'search_path=%')")
    assert code.count("p.prokind IN ('f', 'p')") == 3
    assert code.count(predicate) == 3
    assert "deptype" not in CODE and "pg_depend" not in CODE, "no extension exclusion (header says why)"
    assert not re.search(r"\bproname\b", CODE), "no name list: every unpinned routine is pinned"
    for marker in ("unpinned_function_not_owned_by_runner", "search_path_pin_not_applied",
                   "public_function_search_path_not_pinned"):
        assert f"RAISE EXCEPTION '{marker}" in CODE, marker
    assert "pg_has_role(current_user, p.proowner, 'USAGE')" in CODE


def test_header_documents_no_op_rollback_and_the_345_interaction():
    header = SQL[:SQL.index("BEGIN;")]
    assert "Rollback: none. The down of 358 is a deliberate no-op." in header
    assert "header rollback of 345" in header
    assert "Extension members are not excluded" in header
    for name in GRAMMAR_FUNCTIONS:
        assert name in header


def test_forward_policy_and_readme_record_358():
    rows = [line.split("\t") for line in (MIGRATIONS / "forward-policy.tsv").read_text(
        encoding="utf-8").splitlines() if line.startswith(NAME)]
    assert len(rows) == 1 and rows[0][1:3] == ["pending_feature", "function_search_path_pin"]
    assert "SVCPRIV-0042 FR-010" in rows[0][3]
    readme = (MIGRATIONS / "README.md").read_text(encoding="utf-8")
    assert "Migration `358` (PC-J406" in readme


def test_the_four_283_functions_are_unpinned_in_283_and_untouched_elsewhere():
    grammar = _strip_sql_comments(GRAMMAR_SQL)
    for name in GRAMMAR_FUNCTIONS:
        body = re.search(rf"CREATE OR REPLACE FUNCTION {name}\(\).*?\n\$\$;", grammar, re.S)
        assert body and "search_path" not in body.group(0), name
    assert NAME not in GRAMMAR_SQL


# ── PostgreSQL execution ────────────────────────────────────────────────────

sql = m334.sql


def _run(database: str, text: str, *, role: str | None = None) -> subprocess.CompletedProcess:
    prefix = f"SET ROLE {role};\n" if role else ""
    return subprocess.run([*m334._psql_args(database, app="fn358"), "-f", "-"],
                          input=prefix + text, capture_output=True, text=True,
                          timeout=180, env=m334._env())


def _ok(database: str, text: str, *, role: str | None = None) -> str:
    result = _run(database, text, role=role)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()


def _error(stderr: str) -> str:
    """The first line of the psql ERROR (no CONTEXT)."""
    return stderr.split("ERROR:", 1)[-1].strip().splitlines()[0]


def _apply(database: str) -> str:
    """358 verbatim as the NOSUPERUSER runner; returns its NOTICE output."""
    result = _run(database, SQL, role=RUNNER)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stderr


def _require_pg() -> None:
    try:
        available = bool(shutil.which("psql")) and sql("postgres", "SELECT 1") == "1"
    except Exception:
        available = False
    if not available:
        if os.environ.get("REQUIRE_PG") == "1":
            pytest.fail("Local PostgreSQL required for migration 358 verification")
        pytest.skip("Local PostgreSQL unavailable")
    if sql("postgres", "SELECT usesuper FROM pg_user WHERE usename = current_user") != "t":
        pytest.fail("Migration 358 fixture requires a superuser on its disposable LOCAL cluster")
    sql("postgres", f"""DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='{RUNNER}') THEN
        CREATE ROLE {RUNNER} NOSUPERUSER NOBYPASSRLS NOLOGIN;
      END IF;
    END $$;""")
    # P3-SA-8: genuine roles, or every result below proves nothing.
    for role, bypass in (("anon", "f"), ("authenticated", "f"), ("service_role", "t"), (RUNNER, "f")):
        assert sql("postgres", f"SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = '{role}'") \
            == f"f|{bypass}", f"{role} must have rolsuper=f and rolbypassrls={bypass}"


def _grammar_283_through_trigger_functions() -> str:
    """283 verbatim up to (excluding) the assignment guards, which need class tables."""
    cut = GRAMMAR_SQL.index("-- The application rechecks assignment state")
    return GRAMMAR_SQL[:cut] + "COMMIT;\n"


def _new_database() -> str:
    database = f"fn358_{uuid4().hex[:12]}"
    sql("postgres", f"CREATE DATABASE {database}")
    # Hosted shape: the runner creates in public; API roles get USAGE only
    # (no schema CREATE, as after NNN); PUBLIC keeps the default TEMP.
    sql(database, f"""
        GRANT USAGE, CREATE ON SCHEMA public TO {RUNNER};
        REVOKE CREATE ON SCHEMA public FROM PUBLIC;
        GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
        CREATE SCHEMA auth;
        CREATE TABLE auth.users (id uuid PRIMARY KEY);
        GRANT USAGE ON SCHEMA auth TO {RUNNER}, anon, authenticated, service_role;
        GRANT REFERENCES ON auth.users TO {RUNNER};
        INSERT INTO auth.users VALUES ('{LEARNER}');""")
    _ok(database, f"""
        CREATE TABLE users (id uuid PRIMARY KEY, role text);
        CREATE TABLE class_assignment_items (id uuid PRIMARY KEY);
        CREATE TABLE owner_marker (cu text NOT NULL, at timestamptz NOT NULL DEFAULT now());
        {_grammar_283_through_trigger_functions()}
        -- NNN end state: service_role keeps CRUD only on every public table.
        REVOKE TRIGGER, REFERENCES, TRUNCATE ON ALL TABLES IN SCHEMA public
            FROM PUBLIC, anon, authenticated, service_role;
        DO $$ BEGIN
            IF current_setting('server_version_num')::int >= 170000 THEN
                EXECUTE 'REVOKE MAINTAIN ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated, service_role';
            END IF;
        END $$;
        GRANT SELECT, INSERT, UPDATE, DELETE ON users TO service_role;
        INSERT INTO grammar_content_releases (id, release_key, manifest_sha256, manifest)
            VALUES ('{DRAFT}', 'draft', 'sha-draft', '{{}}'), ('{VALIDATED}', 'validated', 'sha-val', '{{}}');
        INSERT INTO grammar_lessons (release_id, lesson_id, lesson_no, title)
            VALUES ('{VALIDATED}', 'L01', 1, 'validated lesson');
        UPDATE grammar_content_releases SET status = 'validated', validated_at = now() WHERE id = '{VALIDATED}';
        """, role=RUNNER)
    assert sql(database, "SELECT has_schema_privilege('service_role', 'public', 'CREATE'), "
                         f"has_database_privilege('service_role', '{database}', 'TEMP'), "
                         "has_table_privilege('service_role', 'public.grammar_lessons', 'TRIGGER'), "
                         "has_table_privilege('service_role', 'public.users', 'TRIGGER'), "
                         "has_table_privilege('service_role', 'public.owner_marker', 'INSERT'), "
                         "has_table_privilege('service_role', 'public.grammar_content_releases', 'DELETE')"
               ) == "f|t|f|f|f|t", "fixture must be the NNN end state with TEMP"
    return database


def _drop_database(database: str) -> None:
    sql("postgres", f"DROP DATABASE IF EXISTS {database} WITH (FORCE)")


def _catalog(database: str) -> dict[str, str]:
    """proconfig, body hash, owner, ACL and security of every public routine."""
    rows = sql(database, """
        SELECT p.oid::regprocedure, coalesce(array_to_string(p.proconfig, ';'), ''), md5(p.prosrc),
               pg_get_userbyid(p.proowner), coalesce(p.proacl::text, ''), p.prosecdef
          FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace ORDER BY 1""")
    return {line.split("|", 1)[0]: line.split("|", 1)[1] for line in rows.splitlines()}


@pytest.fixture(scope="module")
def dbs():
    """Two databases built the same way: `pre` without 358, `post` with 358 applied twice."""
    _require_pg()
    created = []
    try:
        pre, post = _new_database(), _new_database()
        created += [pre, post]
        before = _catalog(post)
        first = _apply(post)
        second = _apply(post)
        yield {"pre": pre, "post": post, "before": before, "first": first, "second": second}
    finally:
        for database in created:
            _drop_database(database)


def _seed_draft(database: str) -> None:
    sql(database, f"""
        DELETE FROM public.owner_marker;
        DELETE FROM public.grammar_lessons WHERE release_id = '{DRAFT}';
        DELETE FROM public.grammar_content_releases WHERE id = '{DRAFT}';
        INSERT INTO public.grammar_content_releases (id, release_key, manifest_sha256, manifest)
            VALUES ('{DRAFT}', 'draft', 'sha-draft', '{{}}');
        INSERT INTO public.grammar_lessons (release_id, lesson_id, lesson_no, title)
            VALUES ('{DRAFT}', 'L01', 1, 'draft lesson');""")


def _temp_view_attack(database: str) -> dict[str, str]:
    """SA P2-R2-1 verbatim in shape: service_role shadows grammar_content_releases
    with a temp view and deletes a draft release; the FK cascade fires the
    283 trigger as the owner of grammar_lessons."""
    _seed_draft(database)
    sql(database, "REVOKE TRIGGER ON public.users FROM service_role")
    out = _ok(database, f"""
        BEGIN;
        SET LOCAL ROLE service_role;
        DO $$ BEGIN ASSERT current_user = 'service_role', current_user; END $$;
        CREATE FUNCTION pg_temp.evil() RETURNS text LANGUAGE plpgsql AS $f$
        BEGIN
            INSERT INTO public.owner_marker (cu) VALUES (current_user);
            EXECUTE 'GRANT TRIGGER ON public.users TO service_role';
            RETURN 'staging';
        END $f$;
        CREATE TEMP VIEW grammar_content_releases AS
            SELECT '{DRAFT}'::uuid AS id, pg_temp.evil() AS status;
        GRANT SELECT ON pg_temp.grammar_content_releases TO PUBLIC;
        DELETE FROM public.grammar_content_releases WHERE id = '{DRAFT}' RETURNING 'deleted';
        COMMIT;""")
    result = {
        "deleted": "deleted" in out.splitlines(),
        "marker": sql(database, "SELECT coalesce(string_agg(DISTINCT cu, ','), '') FROM public.owner_marker"),
        "svc_trigger_on_users": sql(database, "SELECT has_table_privilege('service_role', 'public.users', 'TRIGGER')"),
        "draft_lessons_left": sql(database, f"SELECT count(*) FROM public.grammar_lessons WHERE release_id = '{DRAFT}'"),
    }
    sql(database, f"REVOKE TRIGGER ON public.users FROM service_role; SET ROLE {RUNNER}; "
                  "REVOKE TRIGGER ON public.users FROM service_role")
    return result


def test_control_before_358_the_temp_view_shadow_runs_code_as_the_owner(dbs):
    """Without 358 the exploit works: the harness reproduces P2-R2-1."""
    assert sql(dbs["pre"], UNPINNED).split(",") == [f"{name}()" for name in GRAMMAR_FUNCTIONS]
    assert _temp_view_attack(dbs["pre"]) == {
        "deleted": True, "marker": RUNNER, "svc_trigger_on_users": "t", "draft_lessons_left": "0"}


def test_after_358_the_temp_view_shadow_runs_nothing(dbs):
    assert _temp_view_attack(dbs["post"]) == {
        "deleted": True, "marker": "", "svc_trigger_on_users": "f", "draft_lessons_left": "0"}


def test_after_358_no_public_function_lacks_search_path(dbs):
    assert sql(dbs["post"], UNPINNED) == ""
    after = _catalog(dbs["post"])
    assert set(after) == set(dbs["before"]) == {f"{name}()" for name in GRAMMAR_FUNCTIONS}
    for signature, row in after.items():
        config, body, owner, acl, definer = row.split("|")
        old_config, old_body, old_owner, old_acl, old_definer = dbs["before"][signature].split("|")
        assert (old_config, config) == ("", PIN), signature
        # Bodies, owner, ACL and SECURITY INVOKER are unchanged.
        assert (body, owner, acl, definer) == (old_body, old_owner, old_acl, old_definer) == \
               (old_body, RUNNER, old_acl, "f"), signature
    assert dbs["first"].count("358: pinned search_path = public, pg_temp on public.") == 4


def test_second_apply_is_a_no_op(dbs):
    assert "358: pinned" not in dbs["second"]
    assert all(row.split("|")[0] == PIN for row in _catalog(dbs["post"]).values())


def _owner_paths(database: str) -> dict[str, str]:
    """Legitimate owner writes through both table-reading functions (and the
    other two). Each runs in a rolled-back transaction; returns 'ok' or the error."""
    session = str(uuid4())
    cases = {
        "update_validated_lesson": "UPDATE grammar_lessons SET title = 'x' "
                                   f"WHERE release_id = '{VALIDATED}'",
        "delete_validated_lesson": f"DELETE FROM grammar_lessons WHERE release_id = '{VALIDATED}'",
        "move_draft_lesson_into_validated": f"UPDATE grammar_lessons SET release_id = '{VALIDATED}', "
                                            f"lesson_no = 2, lesson_id = 'L02' WHERE release_id = '{DRAFT}'",
        "update_draft_lesson": f"UPDATE grammar_lessons SET title = 'y' WHERE release_id = '{DRAFT}'",
        "delete_draft_release": f"DELETE FROM grammar_content_releases WHERE id = '{DRAFT}'",
        "delete_validated_release": f"DELETE FROM grammar_content_releases WHERE id = '{VALIDATED}'",
        "complete_session_without_report": (
            f"UPDATE grammar_diagnostic_sessions SET status = 'completed', current_phase = 'COMPLETED', "
            f"completed_at = now() WHERE id = '{session}'"),
        "complete_session_with_report": (
            f"INSERT INTO grammar_diagnostic_reports (session_id, user_id, release_id, evidence_sha256, "
            f"learner_report, educator_report) VALUES ('{session}', '{LEARNER}', '{VALIDATED}', 'e', '{{}}', '{{}}'); "
            f"UPDATE grammar_diagnostic_sessions SET status = 'completed', current_phase = 'COMPLETED', "
            f"completed_at = now() WHERE id = '{session}'"),
        "rewrite_report": (
            f"INSERT INTO grammar_diagnostic_reports (session_id, user_id, release_id, evidence_sha256, "
            f"learner_report, educator_report) VALUES ('{session}', '{LEARNER}', '{VALIDATED}', 'e', '{{}}', '{{}}'); "
            f"UPDATE grammar_diagnostic_reports SET evidence_sha256 = 'f' WHERE session_id = '{session}'"),
    }
    _seed_draft(database)
    seed_session = (f"INSERT INTO grammar_diagnostic_sessions (id, user_id, release_id, mode, module, "
                    f"test_length, objective_limit) VALUES ('{session}', '{LEARNER}', '{VALIDATED}', "
                    f"'ENTRY', 'GENERAL', 'QUICK', 28);")
    outcome = {}
    for name, statement in cases.items():
        result = _run(database, f"BEGIN;\nSET search_path = public, pg_temp;\n{seed_session}\n"
                                f"{statement};\nROLLBACK;", role=RUNNER)
        outcome[name] = "ok" if result.returncode == 0 else _error(result.stderr)
    return outcome


def test_negative_control_owner_paths_behave_exactly_as_before(dbs):
    before, after = _owner_paths(dbs["pre"]), _owner_paths(dbs["post"])
    assert after == before
    assert after == {
        "update_validated_lesson": "validated grammar release content is immutable",
        "delete_validated_lesson": "validated grammar release content is immutable",
        "move_draft_lesson_into_validated": "validated grammar release content is immutable",
        "update_draft_lesson": "ok",
        "delete_draft_release": "ok",
        "delete_validated_release": "validated grammar release is immutable",
        "complete_session_without_report": "invalid grammar diagnostic completion transition",
        "complete_session_with_report": "ok",
        "rewrite_report": "grammar diagnostic evidence is immutable",
    }


def _hostile_schema_path(database: str) -> dict[str, str]:
    """An owner session whose search_path starts with a schema that shadows
    both tables the triggers read (the 345 variant, without pg_temp)."""
    session = str(uuid4())
    sql(database, f"""
        CREATE SCHEMA IF NOT EXISTS evil358;
        GRANT USAGE ON SCHEMA evil358 TO {RUNNER};
        CREATE OR REPLACE VIEW evil358.grammar_content_releases AS
            SELECT id, 'staging'::text AS status FROM public.grammar_content_releases;
        CREATE OR REPLACE VIEW evil358.grammar_diagnostic_reports AS
            SELECT id AS session_id FROM public.grammar_diagnostic_sessions;
        GRANT SELECT ON ALL TABLES IN SCHEMA evil358 TO {RUNNER};""")
    cases = {
        "rewrite_validated_lesson": f"UPDATE grammar_lessons SET title = 'rewritten' WHERE release_id = '{VALIDATED}'",
        "complete_without_report": (
            f"INSERT INTO grammar_diagnostic_sessions (id, user_id, release_id, mode, module, test_length, "
            f"objective_limit) VALUES ('{session}', '{LEARNER}', '{DRAFT}', 'ENTRY', 'GENERAL', 'QUICK', 28); "
            f"UPDATE grammar_diagnostic_sessions SET status = 'completed', current_phase = 'COMPLETED', "
            f"completed_at = now() WHERE id = '{session}'"),
    }
    _seed_draft(database)
    outcome = {}
    for name, statement in cases.items():
        result = _run(database, f"BEGIN;\nSET LOCAL search_path = evil358, public;\n{statement};\nROLLBACK;",
                      role=RUNNER)
        outcome[name] = "bypassed" if result.returncode == 0 else _error(result.stderr)
    return outcome


def test_hostile_session_search_path_no_longer_bypasses_the_guards(dbs):
    assert _hostile_schema_path(dbs["pre"]) == {
        "rewrite_validated_lesson": "bypassed", "complete_without_report": "bypassed"}
    assert _hostile_schema_path(dbs["post"]) == {
        "rewrite_validated_lesson": "validated grammar release content is immutable",
        "complete_without_report": "invalid grammar diagnostic completion transition"}


def _postcondition() -> str:
    start = CODE.rindex("DO $$")
    return "BEGIN;\n" + CODE[start:CODE.rindex("COMMIT;")] + "ROLLBACK;"


def test_postcondition_fires_on_the_unpinned_state(dbs):
    assert "public_function_search_path_not_pinned" in _postcondition()
    result = _run(dbs["pre"], _postcondition(), role=RUNNER)
    assert result.returncode != 0
    error = result.stderr
    assert "public_function_search_path_not_pinned" in error
    for name in GRAMMAR_FUNCTIONS:
        assert f"{name}()" in error
    assert _run(dbs["post"], _postcondition(), role=RUNNER).returncode == 0


@pytest.fixture
def scratch():
    _require_pg()
    database = f"fn358s_{uuid4().hex[:12]}"
    sql("postgres", f"CREATE DATABASE {database}")
    sql(database, f"GRANT USAGE, CREATE ON SCHEMA public TO {RUNNER}; "
                  f"CREATE SCHEMA app_private AUTHORIZATION {RUNNER};")
    try:
        yield database
    finally:
        _drop_database(database)


def test_pins_procedures_keeps_other_settings_and_leaves_pinned_and_other_schemas_alone(scratch):
    _ok(scratch, """
        CREATE PROCEDURE public.proc_unpinned() LANGUAGE sql AS $$ SELECT 1 $$;
        CREATE FUNCTION public.fn_timeout() RETURNS int LANGUAGE sql SET statement_timeout = '5s'
            AS $$ SELECT 1 $$;
        CREATE FUNCTION public.fn_catalog_first() RETURNS int LANGUAGE sql
            SET search_path = pg_catalog, public AS $$ SELECT 1 $$;
        CREATE FUNCTION public.fn_empty() RETURNS int LANGUAGE sql SET search_path = '' AS $$ SELECT 1 $$;
        CREATE FUNCTION public.fn_overloaded(int) RETURNS int LANGUAGE sql AS $$ SELECT $1 $$;
        CREATE FUNCTION public.fn_overloaded(text) RETURNS text LANGUAGE sql AS $$ SELECT $1 $$;
        CREATE FUNCTION app_private.fn_other_schema() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;
        CREATE AGGREGATE public.agg_sum(int) (SFUNC = int4pl, STYPE = int);""", role=RUNNER)
    _apply(scratch)
    rows = dict(line.split("|", 1) for line in sql(scratch, """
        SELECT p.oid::regprocedure, coalesce(array_to_string(p.proconfig, ';'), '')
          FROM pg_proc p WHERE p.pronamespace IN ('public'::regnamespace, 'app_private'::regnamespace)
         ORDER BY 1""").splitlines())
    assert rows == {
        "proc_unpinned()": PIN,
        "fn_timeout()": f"statement_timeout=5s;{PIN}",
        # Already pinned: outside FR-010, left exactly as it was.
        "fn_catalog_first()": "search_path=pg_catalog, public",
        "fn_empty()": 'search_path=""',
        "fn_overloaded(integer)": PIN,
        "fn_overloaded(text)": PIN,
        "app_private.fn_other_schema()": "",
        "agg_sum(integer)": "",
    }
    assert sql(scratch, UNPINNED) == ""


def test_precondition_aborts_without_any_change_when_the_runner_cannot_alter_a_function(scratch):
    sql(scratch, """DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fn358_other_owner') THEN
            CREATE ROLE fn358_other_owner NOSUPERUSER NOLOGIN;
        END IF; END $$;""")
    _ok(scratch, "CREATE FUNCTION public.fn_runner_owned() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;",
        role=RUNNER)
    sql(scratch, "CREATE FUNCTION public.fn_foreign_owned() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$; "
                 "ALTER FUNCTION public.fn_foreign_owned() OWNER TO fn358_other_owner;")
    result = _run(scratch, SQL, role=RUNNER)
    assert result.returncode != 0
    assert "unpinned_function_not_owned_by_runner: public.fn_foreign_owned() (owner fn358_other_owner)" \
        in result.stderr
    assert "fn_runner_owned" not in result.stderr.split("unpinned_function_not_owned_by_runner")[1]
    # Rolled back: the runner's own function was not pinned either.
    assert sql(scratch, UNPINNED) == "fn_foreign_owned(),fn_runner_owned()"
    sql(scratch, "DROP FUNCTION public.fn_foreign_owned()")
