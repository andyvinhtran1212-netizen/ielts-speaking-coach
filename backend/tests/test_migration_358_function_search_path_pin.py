"""Migration 358 (PC-J406, widened by PC-J510 under PGTEMP option a;
SVCPRIV-0042 FR-010): every function and procedure in schemas public and
app_private has a search_path whose last entry is pg_temp, so a caller's temp
objects cannot shadow the names a routine resolves while it runs as the owner.

SA P2-R2-1 (SA-SPEC-357-R2, 2026-10-30): the four trigger functions of 283
have no SET search_path. service_role, even without TRIGGER and schema CREATE
(the state after NNN), keeps the database TEMP privilege. It creates
TEMP VIEW grammar_content_releases calling pg_temp.evil() and deletes a draft
release; the ON DELETE CASCADE runs as the owner of grammar_lessons, its
BEFORE DELETE trigger reads the unqualified name, pg_temp comes first, and
evil() runs as the owner: GRANT TRIGGER ON public.users TO service_role.
Q-0600-PGTEMP (job 001iv finding, SA PC-J455): a path that does not name
pg_temp (`pg_catalog, public` of the fn_admin_* definers, `''` of 334/335)
searches pg_temp first for types too, so a TEMP DOMAIN named jsonb or
timestamptz with a CHECK calling pg_temp code runs that code as the definer.

The static half pins the migration's shape. The PostgreSQL half builds a
disposable database on the LOCAL cluster in TEST_PG_URL: a NOSUPERUSER runner
owns everything; 283 runs verbatim up to its four trigger functions, 334 runs
verbatim, and the routines fn_admin_exam_content_levels (299),
app_private.is_current_user_active (335) and
fn_guard_active_player_terminal_mutation (224) are created from their
migrations verbatim; the NNN end state is emulated (service_role keeps CRUD
only, no schema CREATE). Roles follow the P3-SA-8 pattern: rolsuper is false
for anon, authenticated and service_role (rolbypassrls f/f/t), and every
exploit runs after SET LOCAL ROLE service_role with ASSERT current_user in the
same transaction. Before 358 each exploit succeeds (control); after 358 it
records nothing. Owner paths give the same results before and after; a
hostile session search_path stops working too; a second apply is a no-op; the
preconditions and the postcondition fire on the states they guard.

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
SQL_224 = (MIGRATIONS / "224_active_player_resume_ttl.sql").read_text(encoding="utf-8")
SQL_299 = (MIGRATIONS / "299_admin_exam_content_page.sql").read_text(encoding="utf-8")
SQL_334 = (MIGRATIONS / "334_activate_attempt_rate_limit.sql").read_text(encoding="utf-8")
SQL_335 = (MIGRATIONS / "335_learner_jwt_writes_require_active_account.sql").read_text(encoding="utf-8")
RUNNER = "fn358_runner"
PIN = "search_path=public, pg_temp"
CATALOG_PIN = "search_path=pg_catalog, pg_temp"
GRAMMAR_FUNCTIONS = ("prevent_completed_grammar_session_mutation", "prevent_grammar_evidence_mutation",
                     "prevent_grammar_release_content_mutation", "prevent_validated_grammar_release_rewrite")
# proconfig of every routine in the fixture: before 358 -> after 358.
EXPECTED = {
    **{f"{name}()": ("", PIN) for name in GRAMMAR_FUNCTIONS},
    "fn_admin_exam_content_levels(text)": ("search_path=pg_catalog, public",
                                           "search_path=pg_catalog, public, pg_temp"),
    "fn_activate_attempt_check(uuid)": ('search_path=""', CATALOG_PIN),
    "app_private.is_current_user_active()": ('search_path=""', CATALOG_PIN),
    "fn_guard_active_player_terminal_mutation()": (PIN, CATALOG_PIN),
}
DRAFT = "00000000-0000-0000-0000-0000000000a1"
VALIDATED = "00000000-0000-0000-0000-0000000000a2"
LEARNER = "00000000-0000-0000-0000-0000000000b1"
INACTIVE = "00000000-0000-0000-0000-0000000000b2"
SESSION = "00000000-0000-0000-0000-0000000000c1"
# The 358 postcondition, as a query: routines whose search_path is missing,
# empty or not pg_temp-last.
UNPINNED = """SELECT coalesce(string_agg(p.oid::regprocedure::text, ',' ORDER BY p.oid::regprocedure::text), '')
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname IN ('public', 'app_private') AND p.prokind IN ('f', 'p')
   AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}'::text[])) c
                    WHERE c ~ '^search_path=(.+, )?pg_temp$' AND c !~ '(=|, )pg_temp, ')"""


def _create_statement(migration: str, signature: str) -> str:
    """One CREATE OR REPLACE FUNCTION statement of a migration, verbatim."""
    start = migration.index(f"CREATE OR REPLACE FUNCTION {signature}")
    body = re.search(r"\$\$.*?\$\$;", migration[start:], re.S)
    return migration[start:start + body.end()]


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
    assert "EXECUTE format('ALTER ROUTINE %s SET search_path = %s', r.fn, r.pinned);" in CODE


def test_pin_values_keep_pg_temp_last_and_are_never_empty():
    code = re.sub(r"\s+", " ", CODE)
    # The three fixed values; every other value is the old list with pg_temp
    # removed and appended.
    assert re.findall(r"THEN '([\w, ]+)'", code) == ["pg_catalog, pg_temp", "public, pg_temp",
                                                      "pg_catalog, pg_temp"]
    assert ("ELSE array_to_string(array_remove(string_to_array(path, ', '), 'pg_temp') "
            "|| 'pg_temp'::text, ', ')") in code
    assert "search_path = ''" not in CODE
    # Entries are checked before they are spliced into ALTER ROUTINE.
    assert code.count("""e !~ '^([a-z_][a-z0-9_$]*|"\\$user")$'""") == 1
    assert "RAISE EXCEPTION 'search_path_unparsed" in CODE


def test_every_scan_is_public_and_app_private_without_exclusions():
    code = re.sub(r"\s+", " ", CODE)
    assert code.count("n.nspname IN ('public', 'app_private')") == 3
    assert code.count("p.prokind IN ('f', 'p')") == 3
    assert code.count("path !~ '^(.+, )?pg_temp$' OR path ~ '(^|, )pg_temp, '") == 2
    # PostgreSQL keeps the first pg_temp of a list, so a second one at the end does not help.
    assert code.count("WHERE c ~ '^search_path=(.+, )?pg_temp$' AND c !~ '(=|, )pg_temp, '") == 1
    assert "deptype" not in CODE and "pg_depend" not in CODE, "no extension exclusion (header says why)"
    assert not re.search(r"\bproname\b", CODE), "no name list: every non-compliant routine is pinned"
    # The one named routine is the Leader-ordered 224 narrowing.
    assert set(re.findall(r"to_regprocedure\('([^']+)'\)", CODE)) == {
        "public.fn_guard_active_player_terminal_mutation()"}
    for marker in ("unpinned_function_not_owned_by_runner", "search_path_unparsed", "search_path_pin_not_applied",
                   "routine_search_path_not_pg_temp_last"):
        assert f"RAISE EXCEPTION '{marker}" in CODE, marker
    assert "pg_has_role(current_user, proowner, 'USAGE')" in CODE


def test_header_documents_no_op_rollback_scope_and_the_345_interaction():
    header = SQL[:SQL.index("BEGIN;")]
    assert "Rollback: none. The down of 358 is a deliberate no-op." in header
    assert "header rollback of 345" in header
    assert "Extension members are not excluded" in header
    assert "PGTEMP option a" in header and "t1246u" in header
    for name in (*GRAMMAR_FUNCTIONS, "fn_admin_*", "fn_activate_attempt_check", "is_current_user_active",
                 "fn_guard_active_player_terminal_mutation"):
        assert name in header, name


def test_forward_policy_and_readme_record_358():
    rows = [line.split("\t") for line in (MIGRATIONS / "forward-policy.tsv").read_text(
        encoding="utf-8").splitlines() if line.startswith(NAME)]
    assert len(rows) == 1 and rows[0][1:3] == ["pending_feature", "function_search_path_pin"]
    assert "SVCPRIV-0042 FR-010" in rows[0][3] and "PGTEMP" in rows[0][3]
    readme = (MIGRATIONS / "README.md").read_text(encoding="utf-8")
    assert "Migration `358` (PC-J406" in readme and "PGTEMP option a" in readme


def test_the_fixture_routines_have_the_unsafe_paths_in_their_migrations():
    grammar = _strip_sql_comments(GRAMMAR_SQL)
    for name in GRAMMAR_FUNCTIONS:
        body = re.search(rf"CREATE OR REPLACE FUNCTION {name}\(\).*?\n\$\$;", grammar, re.S)
        assert body and "search_path" not in body.group(0), name
    assert "SET search_path = pg_catalog, public\n" in _create_statement(
        SQL_299, "public.fn_admin_exam_content_levels(p_kind text)")
    assert "SET search_path = ''" in _create_statement(SQL_334, "public.fn_activate_attempt_check(p_user_id uuid)")
    assert "SET search_path = ''" in _create_statement(SQL_335, "app_private.is_current_user_active()")
    assert "SET search_path = public, pg_temp\n" in _create_statement(
        SQL_224, "public.fn_guard_active_player_terminal_mutation()")
    for migration in (GRAMMAR_SQL, SQL_224, SQL_299, SQL_334, SQL_335):
        assert NAME not in migration


def test_the_former_empty_path_bodies_name_no_public_object_unqualified():
    """FR-010 rule 3: `''` becomes `pg_catalog, pg_temp`, which is safe only
    if every relation and function outside pg_catalog is schema-qualified.
    The PostgreSQL tests below also run every statement of both bodies."""
    for migration, signature in ((SQL_334, "public.fn_activate_attempt_check(p_user_id uuid)"),
                                 (SQL_335, "app_private.is_current_user_active()")):
        body = _strip_sql_comments(_create_statement(migration, signature).split("$$", 1)[1])
        body = re.sub(r"EXTRACT\s*\(\s*EPOCH\s+FROM", "EXTRACT(EPOCH", body, flags=re.I)
        relations = re.findall(r"\b(?:FROM|JOIN|UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+([\w.]+)", body, re.I)
        assert relations and all(r.startswith("public.") for r in relations), (signature, relations)
        calls = {c for c in re.findall(r"\b([\w.]+)\s*\(", body)
                 if "." in c and not c.startswith(("pg_catalog.", "public.", "auth."))}
        assert calls == set(), (signature, calls)


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
        CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp
            AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
        GRANT USAGE ON SCHEMA auth TO {RUNNER}, anon, authenticated, service_role;
        GRANT REFERENCES ON auth.users TO {RUNNER};
        INSERT INTO auth.users VALUES ('{LEARNER}');
        CREATE SCHEMA app_private AUTHORIZATION {RUNNER};""")
    _ok(database, f"""
        CREATE TABLE users (id uuid PRIMARY KEY, role text, is_active boolean);
        CREATE TABLE class_assignment_items (id uuid PRIMARY KEY);
        CREATE TABLE owner_marker (cu text NOT NULL, at timestamptz NOT NULL DEFAULT now());
        {_grammar_283_through_trigger_functions()}
        """, role=RUNNER)
    _ok(database, SQL_334, role=RUNNER)
    _ok(database, f"""
        -- 299: one fn_admin_* definer (pg_catalog, public), verbatim, and its ACL.
        CREATE TABLE reading_tests (course_level text);
        CREATE TABLE listening_tests (course_level text);
        CREATE TABLE writing_prompts (course_level text);
        INSERT INTO reading_tests VALUES ('B1'), (' A2 '), (NULL);
        {_create_statement(SQL_299, "public.fn_admin_exam_content_levels(p_kind text)")}
        REVOKE ALL ON FUNCTION public.fn_admin_exam_content_levels(text) FROM PUBLIC, anon, authenticated;
        GRANT EXECUTE ON FUNCTION public.fn_admin_exam_content_levels(text) TO service_role;
        -- 335: the '' helper in app_private, verbatim, and its ACL.
        GRANT USAGE ON SCHEMA app_private TO authenticated;
        {_create_statement(SQL_335, "app_private.is_current_user_active()")}
        REVOKE ALL ON FUNCTION app_private.is_current_user_active() FROM PUBLIC;
        GRANT EXECUTE ON FUNCTION app_private.is_current_user_active() TO authenticated;
        INSERT INTO users (id, role, is_active) VALUES ('{LEARNER}', 'user', true), ('{INACTIVE}', 'user', false);
        -- 224: the terminal-mutation guard (public, pg_temp), verbatim, on sessions.
        CREATE TABLE sessions (id uuid PRIMARY KEY, status text, resume_expires_at timestamptz);
        {_create_statement(SQL_224, "public.fn_guard_active_player_terminal_mutation()")}
        CREATE TRIGGER trg_guard_session_terminal_mutation
            BEFORE UPDATE OF status ON public.sessions
            FOR EACH ROW EXECUTE FUNCTION public.fn_guard_active_player_terminal_mutation();
        REVOKE ALL ON FUNCTION public.fn_guard_active_player_terminal_mutation() FROM PUBLIC, anon, authenticated;
        -- NNN end state: service_role keeps CRUD only on every public table.
        REVOKE TRIGGER, REFERENCES, TRUNCATE ON ALL TABLES IN SCHEMA public
            FROM PUBLIC, anon, authenticated, service_role;
        DO $$ BEGIN
            IF current_setting('server_version_num')::int >= 170000 THEN
                EXECUTE 'REVOKE MAINTAIN ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated, service_role';
            END IF;
        END $$;
        GRANT SELECT, INSERT, UPDATE, DELETE ON users, sessions TO service_role;
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
                         "has_table_privilege('service_role', 'public.grammar_content_releases', 'DELETE'), "
                         "has_function_privilege('service_role', 'public.fn_admin_exam_content_levels(text)', "
                         "'EXECUTE'), "
                         "has_function_privilege('service_role', 'public.fn_activate_attempt_check(uuid)', 'EXECUTE')"
               ) == "f|t|f|f|f|t|t|t", "fixture must be the NNN end state with TEMP"
    return database


def _drop_database(database: str) -> None:
    sql("postgres", f"DROP DATABASE IF EXISTS {database} WITH (FORCE)")


def _catalog(database: str) -> dict[str, str]:
    """proconfig, body hash, owner, ACL, security and volatility of every
    public/app_private routine."""
    rows = sql(database, """
        SELECT p.oid::regprocedure, coalesce(array_to_string(p.proconfig, ';'), ''), md5(p.prosrc),
               pg_get_userbyid(p.proowner), coalesce(p.proacl::text, ''), p.prosecdef, p.provolatile
          FROM pg_proc p WHERE p.pronamespace IN ('public'::regnamespace, 'app_private'::regnamespace)
         ORDER BY 1""")
    return {line.split("|", 1)[0]: line.split("|", 1)[1] for line in rows.splitlines()}


def _triggers(database: str) -> str:
    return sql(database, "SELECT string_agg(tgrelid::regclass || ':' || tgname || ':' || tgfoid::regprocedure "
                         "|| ':' || tgenabled::text, ',' ORDER BY 1) FROM pg_trigger WHERE NOT tgisinternal")


@pytest.fixture(scope="module")
def dbs():
    """Two databases built the same way: `pre` without 358, `post` with 358 applied twice."""
    _require_pg()
    created = []
    try:
        pre, post = _new_database(), _new_database()
        created += [pre, post]
        before, triggers = _catalog(post), _triggers(post)
        first = _apply(post)
        second = _apply(post)
        yield {"pre": pre, "post": post, "before": before, "triggers": triggers, "first": first,
               "second": second}
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
    assert sql(dbs["pre"], UNPINNED).split(",") == sorted(
        signature for signature, (old, _) in EXPECTED.items() if not old.endswith("pg_temp"))
    assert _temp_view_attack(dbs["pre"]) == {
        "deleted": True, "marker": RUNNER, "svc_trigger_on_users": "t", "draft_lessons_left": "0"}


def test_after_358_the_temp_view_shadow_runs_nothing(dbs):
    assert _temp_view_attack(dbs["post"]) == {
        "deleted": True, "marker": "", "svc_trigger_on_users": "f", "draft_lessons_left": "0"}


def test_after_358_every_routine_ends_with_pg_temp_and_nothing_else_changed(dbs):
    assert sql(dbs["post"], UNPINNED) == ""
    after = _catalog(dbs["post"])
    assert set(after) == set(dbs["before"]) == set(EXPECTED)
    for signature, row in after.items():
        config, *rest = row.split("|")
        old_config, *old_rest = dbs["before"][signature].split("|")
        assert (old_config, config) == EXPECTED[signature], signature
        # Body, owner, ACL, SECURITY DEFINER/INVOKER and volatility are unchanged.
        assert rest == old_rest and rest[1] == RUNNER, signature
    assert _triggers(dbs["post"]) == dbs["triggers"]
    notices = sorted(line.split("358: ", 1)[1] for line in dbs["first"].splitlines() if "358: " in line)
    assert notices == sorted(
        f"{'' if s.startswith('app_private.') else 'public.'}{s} search_path "
        f"{old.split('=', 1)[1] if old else '(none)'} -> {new.split('=', 1)[1]}"
        for s, (old, new) in EXPECTED.items())


def test_second_apply_is_a_no_op(dbs):
    assert "358: " not in dbs["second"]
    assert {s: row.split("|")[0] for s, row in _catalog(dbs["post"]).items()} == {
        s: new for s, (_, new) in EXPECTED.items()}


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


# ── PGTEMP a (FR-010 b): temp-domain shadow on a fn_admin_* definer and a former '' routine ──

def _temp_domain_attack(database: str, type_name: str, call: str) -> dict[str, str]:
    """service_role creates a TEMP DOMAIN named like a built-in type the
    definer body declares, with a CHECK that runs pg_temp code, then calls the
    definer RPC it is granted."""
    sql(database, "DELETE FROM public.owner_marker; REVOKE TRIGGER ON public.users FROM service_role")
    result = _run(database, f"""
        BEGIN;
        SET LOCAL ROLE service_role;
        DO $$ BEGIN ASSERT current_user = 'service_role', current_user; END $$;
        CREATE FUNCTION pg_temp.evil(pg_catalog.{type_name}) RETURNS boolean LANGUAGE plpgsql AS $f$
        BEGIN
            INSERT INTO public.owner_marker (cu) VALUES (current_user);
            EXECUTE 'GRANT TRIGGER ON public.users TO service_role';
            RETURN true;
        END $f$;
        CREATE DOMAIN pg_temp.{type_name} AS pg_catalog.{type_name} CHECK (pg_temp.evil(VALUE));
        SELECT {call};
        COMMIT;""")
    outcome = {
        "result": result.stdout.strip() if result.returncode == 0 else _error(result.stderr),
        "marker": sql(database, "SELECT coalesce(string_agg(DISTINCT cu, ','), '') FROM public.owner_marker"),
        "svc_trigger_on_users": sql(database, "SELECT has_table_privilege('service_role', 'public.users', 'TRIGGER')"),
    }
    sql(database, f"DELETE FROM public.owner_marker; DELETE FROM public.activation_attempts; "
                  f"SET ROLE {RUNNER}; REVOKE TRIGGER ON public.users FROM service_role")
    return outcome


def test_fn_admin_definer_temp_domain_shadow_red_before_358_green_after(dbs):
    call = "public.fn_admin_exam_content_levels('reading')"
    assert _temp_domain_attack(dbs["pre"], "jsonb", call) == {
        "result": '["A2", "B1"]', "marker": RUNNER, "svc_trigger_on_users": "t"}
    assert _temp_domain_attack(dbs["post"], "jsonb", call) == {
        "result": '["A2", "B1"]', "marker": "", "svc_trigger_on_users": "f"}


def test_former_empty_path_definer_temp_domain_shadow_red_before_358_green_after(dbs):
    call = f"public.fn_activate_attempt_check('{LEARNER}')"
    expected = '{"allowed": true, "retry_after_s": 0}'
    assert _temp_domain_attack(dbs["pre"], "timestamptz", call) == {
        "result": expected, "marker": RUNNER, "svc_trigger_on_users": "t"}
    assert _temp_domain_attack(dbs["post"], "timestamptz", call) == {
        "result": expected, "marker": "", "svc_trigger_on_users": "f"}


def _definer_owner_paths(database: str) -> dict[str, object]:
    """Every statement of the two former '' bodies and the fn_admin_* RPC,
    run through their real callers: same answers before and after 358."""
    sql(database, "DELETE FROM public.activation_attempts")
    attempts = [sql(database, f"SET ROLE service_role; SELECT public.fn_activate_attempt_check('{LEARNER}')")
                for _ in range(11)]
    sql(database, "DELETE FROM public.activation_attempts")

    def active(user: str) -> str:
        return sql(database, f"BEGIN; SET LOCAL ROLE authenticated; "
                             f"SET LOCAL request.jwt.claim.sub = '{user}'; "
                             f"SELECT app_private.is_current_user_active(); COMMIT;")

    levels = {kind: sql(database, f"SET ROLE service_role; SELECT public.fn_admin_exam_content_levels('{kind}')")
              for kind in ("reading", "listening")}
    bad_kind = _run(database, "SELECT public.fn_admin_exam_content_levels('speaking')", role="service_role")
    return {
        "allowed": [a for a in attempts if '"allowed": true' in a] == [attempts[0]] * 10,
        "eleventh": re.sub(r'"retry_after_s": \d+', '"retry_after_s": N', attempts[10]),
        "active": active(LEARNER), "inactive": active(INACTIVE), "anonymous": active(""),
        "levels": levels, "bad_kind": _error(bad_kind.stderr),
    }


def test_negative_control_definer_owner_paths_behave_exactly_as_before(dbs):
    before, after = _definer_owner_paths(dbs["pre"]), _definer_owner_paths(dbs["post"])
    assert after == before == {
        "allowed": True, "eleventh": '{"allowed": false, "retry_after_s": N}',
        "active": "t", "inactive": "f", "anonymous": "f",
        "levels": {"reading": '["A2", "B1"]', "listening": "[]"},
        "bad_kind": "invalid_admin_exam_content_level_kind",
    }


# ── Leader 08:50 addendum (SA via PR-2116): 224 trigger narrowed to pg_catalog, pg_temp ──

def _to_jsonb_overload(database: str) -> dict[str, str]:
    """The owner (only it can create in public after 357) plants an exact-type
    public.to_jsonb(public.sessions); service_role then moves a session out of
    in_progress. With public on the trigger's path the overload wins over
    pg_catalog.to_jsonb(anyelement)."""
    _ok(database, """
        CREATE FUNCTION public.to_jsonb(public.sessions) RETURNS jsonb LANGUAGE plpgsql
            SET search_path = pg_catalog, pg_temp AS $f$
        BEGIN
            RAISE NOTICE 'captured_by_public_to_jsonb';
            RETURN pg_catalog.to_jsonb($1);
        END $f$;""", role=RUNNER)
    session_open, session_expired = str(uuid4()), str(uuid4())
    try:
        sql(database, f"""INSERT INTO public.sessions VALUES
            ('{session_open}', 'in_progress', now() + interval '1 hour'),
            ('{session_expired}', 'in_progress', now() - interval '1 hour')""")
        cases = {}
        for name, target in (("open", session_open), ("expired", session_expired)):
            result = _run(database, f"""BEGIN; SET LOCAL ROLE service_role;
                DO $$ BEGIN ASSERT current_user = 'service_role', current_user; END $$;
                UPDATE public.sessions SET status = 'submitted' WHERE id = '{target}';
                COMMIT;""")
            cases[name] = ("ok" if result.returncode == 0 else _error(result.stderr),
                           "captured" if "captured_by_public_to_jsonb" in result.stderr else "not captured")
        return cases
    finally:
        sql(database, f"DELETE FROM public.sessions; SET ROLE {RUNNER}; "
                      "DROP FUNCTION public.to_jsonb(public.sessions)")


def test_224_trigger_public_to_jsonb_overload_captured_before_358_not_after(dbs):
    assert _to_jsonb_overload(dbs["pre"]) == {
        "open": ("ok", "captured"), "expired": ("active_player_expired", "captured")}
    assert _to_jsonb_overload(dbs["post"]) == {
        "open": ("ok", "not captured"), "expired": ("active_player_expired", "not captured")}


def _postcondition() -> str:
    start = CODE.rindex("DO $$")
    return "BEGIN;\n" + CODE[start:CODE.rindex("COMMIT;")] + "ROLLBACK;"


def test_postcondition_fires_on_the_unsafe_state(dbs):
    assert "routine_search_path_not_pg_temp_last" in _postcondition()
    result = _run(dbs["pre"], _postcondition(), role=RUNNER)
    assert result.returncode != 0
    gaps = _error(result.stderr)
    # The snippet runs without the migration's SET LOCAL search_path, so public
    # names print unqualified here.
    assert gaps == "routine_search_path_not_pg_temp_last: " + ", ".join(sorted(
        s for s, (old, _) in EXPECTED.items() if not old.endswith("pg_temp")))
    assert _run(dbs["post"], _postcondition(), role=RUNNER).returncode == 0
    # The 224 narrowing is checked on its own: `public, pg_temp` ends with pg_temp.
    narrowed_back = ("BEGIN;\nALTER FUNCTION public.fn_guard_active_player_terminal_mutation() "
                     "SET search_path = public, pg_temp;\n" + _postcondition().split("\n", 1)[1])
    result = _run(dbs["post"], narrowed_back, role=RUNNER)
    assert result.returncode != 0
    assert _error(result.stderr) == \
        "search_path_pin_not_applied: public.fn_guard_active_player_terminal_mutation()"
    assert _catalog(dbs["post"])["fn_guard_active_player_terminal_mutation()"].split("|")[0] == CATALOG_PIN


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


def test_pins_every_unsafe_path_keeps_other_settings_and_leaves_safe_ones_and_other_schemas_alone(scratch):
    sql(scratch, f"CREATE SCHEMA other358 AUTHORIZATION {RUNNER}")
    _ok(scratch, """
        CREATE PROCEDURE public.proc_unpinned() LANGUAGE sql AS $$ SELECT 1 $$;
        CREATE FUNCTION public.fn_timeout() RETURNS int LANGUAGE sql SET statement_timeout = '5s'
            AS $$ SELECT 1 $$;
        CREATE FUNCTION public.fn_catalog_first() RETURNS int LANGUAGE sql
            SET search_path = pg_catalog, public AS $$ SELECT 1 $$;
        CREATE FUNCTION public.fn_public_only() RETURNS int LANGUAGE sql SET search_path = public AS $$ SELECT 1 $$;
        CREATE FUNCTION public.fn_user_first() RETURNS int LANGUAGE sql
            SET search_path = "$user", public SET statement_timeout = '7s' AS $$ SELECT 1 $$;
        CREATE FUNCTION public.fn_pg_temp_first() RETURNS int LANGUAGE sql
            SET search_path = pg_temp, public AS $$ SELECT 1 $$;
        CREATE FUNCTION public.fn_pg_temp_twice() RETURNS int LANGUAGE sql
            SET search_path = pg_temp, public, pg_temp AS $$ SELECT 1 $$;
        CREATE FUNCTION public.fn_empty() RETURNS int LANGUAGE sql SET search_path = '' AS $$ SELECT 1 $$;
        CREATE FUNCTION public.fn_safe() RETURNS int LANGUAGE sql SET search_path = public, pg_temp AS $$ SELECT 1 $$;
        CREATE FUNCTION public.fn_safe_catalog() RETURNS int LANGUAGE sql
            SET search_path = pg_catalog, pg_temp AS $$ SELECT 1 $$;
        CREATE FUNCTION public.fn_overloaded(int) RETURNS int LANGUAGE sql AS $$ SELECT $1 $$;
        CREATE FUNCTION public.fn_overloaded(text) RETURNS text LANGUAGE sql AS $$ SELECT $1 $$;
        CREATE FUNCTION app_private.fn_private() RETURNS int LANGUAGE sql SET search_path = '' AS $$ SELECT 1 $$;
        CREATE PROCEDURE app_private.proc_private() LANGUAGE sql AS $$ SELECT 1 $$;
        CREATE FUNCTION other358.fn_other_schema() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;
        CREATE AGGREGATE public.agg_sum(int) (SFUNC = int4pl, STYPE = int);""", role=RUNNER)
    _apply(scratch)
    rows = dict(line.split("|", 1) for line in sql(scratch, """
        SELECT p.oid::regprocedure, coalesce(array_to_string(p.proconfig, ';'), '')
          FROM pg_proc p
         WHERE p.pronamespace IN ('public'::regnamespace, 'app_private'::regnamespace, 'other358'::regnamespace)
         ORDER BY 1""").splitlines())
    assert rows == {
        "proc_unpinned()": PIN,
        "fn_timeout()": f"statement_timeout=5s;{PIN}",
        "fn_catalog_first()": "search_path=pg_catalog, public, pg_temp",
        "fn_public_only()": PIN,
        "fn_user_first()": 'search_path="$user", public, pg_temp;statement_timeout=7s',
        "fn_pg_temp_first()": PIN,
        "fn_pg_temp_twice()": PIN,
        "fn_empty()": CATALOG_PIN,
        # Already pg_temp-last: left exactly as they were.
        "fn_safe()": PIN,
        "fn_safe_catalog()": CATALOG_PIN,
        "fn_overloaded(integer)": PIN,
        "fn_overloaded(text)": PIN,
        "app_private.fn_private()": CATALOG_PIN,
        "app_private.proc_private()": PIN,
        # Other schemas and aggregates (no proconfig) are out of scope.
        "other358.fn_other_schema()": "",
        "agg_sum(integer)": "",
    }
    assert sql(scratch, UNPINNED) == ""


def test_precondition_aborts_without_any_change_on_an_entry_it_cannot_parse(scratch):
    _ok(scratch, """
        CREATE FUNCTION public.fn_unpinned() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;
        CREATE FUNCTION public.fn_odd_schema() RETURNS int LANGUAGE sql
            SET search_path = "Odd Schema", public AS $$ SELECT 1 $$;
        CREATE FUNCTION public.fn_one_literal() RETURNS int LANGUAGE sql
            SET search_path = 'public, pg_temp' AS $$ SELECT 1 $$;""", role=RUNNER)
    result = _run(scratch, SQL, role=RUNNER)
    assert result.returncode != 0
    assert _error(result.stderr) == ('search_path_unparsed: public.fn_odd_schema() (search_path="Odd Schema", '
                                     'public), public.fn_one_literal() (search_path="public, pg_temp")')
    # Rolled back: nothing was pinned.
    assert sql(scratch, UNPINNED) == "fn_odd_schema(),fn_one_literal(),fn_unpinned()"


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
