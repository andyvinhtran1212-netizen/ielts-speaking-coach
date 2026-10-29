"""Migration 345 (PC-J119, ADMINAAL2-0032): no RLS policy grants admin reads
on an inline `users.role = 'admin'` check, and the 283 grammar trigger
functions have a pinned search_path.

Before 345, seven permissive policies (021, 063, 100, 138, 220 and the
dashboard-created access_codes "Admin only") let any admin JWT read the
dictation tables, user_feedback, lemma_overrides, draft vocabulary exercises
and access codes through /rest/v1/, at AAL1, deactivated, or suspended with a
token that is still valid. 345 drops them, narrows vocab_exercises_select to
published rows, revokes client privileges on the two tables left without a
policy and pins search_path on the four grammar triggers.

The static half always runs. It pins the drop list to the original policies,
the rollback note to the drops, and Step 0 of the job: no frontend
PostgREST call and no JWT-scoped backend client reads these tables, except
routers/exercises.py reading published vocabulary exercises.

The PostgreSQL half builds a disposable database on the LOCAL cluster in
TEST_PG_URL that mimics hosted Supabase (NOSUPERUSER migration runner owning
the tables, default ACLs granting ALL to anon/authenticated/service_role, the
post-320 SELECT-only client grants read from the staging catalog on
2026-10-29), replays the ORIGINAL CREATE POLICY statements from the migration
files plus "Admin only" verbatim from the catalog, and loads the four grammar
functions verbatim from 283. It proves the exploit there (an AAL1, an
inactive and a suspended admin read every row; a hostile search_path bypasses
the release immutability guard), applies 345 twice as the runner, and proves
every admin JWT (AAL1 or AAL2, active, inactive or suspended) now reads no
row, learners still read exactly their own dictation rows and the published
exercises, service_role still reads everything, the row counts and the other
policies are unchanged; the rollback note reopens the hole and re-applying
closes it again; every postcondition fires on the state it guards.

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
NAME = "345_admin_inline_policies_strict.sql"
SQL = (MIGRATIONS / NAME).read_text(encoding="utf-8")
CODE = _strip_sql_comments(SQL)
RUNNER = "admin345_runner"

# (table, policy) → the migration file that created it. "Admin only" exists
# only in the hosted catalogs (dashboard-created); its definition below is the
# staging pg_policies row of 2026-10-29.
DROPPED = {
    ("dictation_sessions", "admins read dictation sessions"): "138_dictation_sessions.sql",
    ("dictation_attempts", "admins read dictation attempts"): "220_dictation_attempt_affinity.sql",
    ("dictation_attempt_answers", "admins read dictation attempt answers"): "220_dictation_attempt_affinity.sql",
    ("user_feedback", "admins read feedback"): "100_user_feedback.sql",
    ("lemma_overrides", "Admins manage lemma overrides"): "063_lemma_overrides.sql",
    ("vocabulary_exercises", "vocab_exercises_admin_write"): "021_vocabulary_exercises.sql",
    ("access_codes", "Admin only"): None,
}
ADMIN_ONLY_CATALOG = (
    'CREATE POLICY "Admin only" ON public.access_codes FOR ALL USING '
    "(EXISTS (SELECT 1 FROM users WHERE ((users.id = auth.uid()) AND (users.role = 'admin'::text))));")
KEPT = {
    ("dictation_sessions", "users read own dictation sessions"): "138_dictation_sessions.sql",
    ("dictation_attempts", "users read own dictation attempts"): "220_dictation_attempt_affinity.sql",
    ("dictation_attempt_answers", "users read own dictation attempt answers"): "220_dictation_attempt_affinity.sql",
    ("vocabulary_exercises", "vocab_exercises_select"): "021_vocabulary_exercises.sql",
}
TABLES = sorted({table for table, _ in DROPPED})
REVOKED = ("lemma_overrides", "user_feedback")
GRAMMAR_FUNCTIONS = ("prevent_grammar_evidence_mutation", "prevent_completed_grammar_session_mutation",
                     "prevent_grammar_release_content_mutation", "prevent_validated_grammar_release_rewrite")
GRAMMAR_SQL = (MIGRATIONS / "283_master30_grammar_diagnostic.sql").read_text(encoding="utf-8")
PINNED = '{"search_path=public, pg_temp"}'
CLIENT_PRIVILEGES = ("SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER")


def _array(name: str) -> str:
    match = re.search(name + r"\s+CONSTANT\s+TEXT\[\]\s*:=\s*ARRAY\[(.*?)\];", CODE, re.S)
    assert match, name
    return match.group(1)


def _policy_name(raw: str) -> str:
    return raw[1:-1] if raw.startswith('"') else raw


def _create_policy_statements(path: str, table: str) -> list[tuple[str, str]]:
    code = _strip_sql_comments((MIGRATIONS / path).read_text(encoding="utf-8"))
    pattern = rf'CREATE POLICY\s+("[^"]+"|\w+)\s+ON\s+(?:public\.)?{table}\b.*?;'
    return [(_policy_name(m.group(1)), m.group(0)) for m in re.finditer(pattern, code, re.S)]


def _rollback_sql() -> str:
    note = SQL[SQL.index("-- Rollback"):SQL.index("-- (Leave out the access_codes line")]
    lines = [line[5:] if line.startswith("--   ") else line[3:]
             for line in note.splitlines() if line.startswith("--   ")]
    return "\n".join(lines)


# ── Static contract ─────────────────────────────────────────────────────────

def test_one_transaction_with_lock_timeout_and_no_data_change():
    assert CODE.strip().startswith("BEGIN;") and CODE.strip().endswith("COMMIT;")
    assert "SET LOCAL lock_timeout = '5s';" in CODE
    for forbidden in (r"DELETE\s+FROM", r"\bTRUNCATE\s+(?:TABLE\s+)?\w", r"^\s*UPDATE\s", r"INSERT\s+INTO",
                      r"ALTER\s+TABLE", r"\bGRANT\b", r"CREATE\s+POLICY", r"CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION",
                      r"SECURITY\s+DEFINER", r"DISABLE\s+ROW\s+LEVEL"):
        assert not re.search(forbidden, CODE, re.M | re.I), forbidden


def test_drop_list_is_exactly_the_inline_admin_policies_and_matches_the_static_drops():
    declared = set(re.findall(r"\['(\w+)',\s*'([^']+)'\]", _array("admin_policies")))
    assert declared == set(DROPPED)
    dropped = {(t, _policy_name(p)) for p, t in re.findall(
        r'DROP POLICY IF EXISTS ("[^"]+"|\w+) ON public\.(\w+);', CODE)}
    assert dropped == set(DROPPED), "the bookkeeping array and the DROP statements must agree"
    for table in TABLES:
        assert f"IF to_regclass('public.{table}') IS NOT NULL THEN" in CODE, table
    # Every original definition really is an admin-only inline role check, and
    # every kept policy has no admin branch left except vocab_exercises_select.
    for (table, policy), path in DROPPED.items():
        statements = dict(_create_policy_statements(path, table)) if path else {"Admin only": ADMIN_ONLY_CATALOG}
        body = statements[policy]
        assert re.search(r"role\s*=\s*'admin'", body) and "auth.uid()" in body, policy
        assert "is_active" not in body and "suspended_at" not in body and "aal" not in body, policy
    for (table, policy), path in KEPT.items():
        body = dict(_create_policy_statements(path, table))[policy]
        assert ("'admin'" in body) == (policy == "vocab_exercises_select"), policy


def test_vocab_select_keeps_name_roles_and_command_and_loses_only_the_admin_branch():
    assert re.search(r"ALTER POLICY vocab_exercises_select ON public\.vocabulary_exercises\s+"
                     r"USING \(status = 'published'\);", CODE)
    original = dict(_create_policy_statements("021_vocabulary_exercises.sql", "vocabulary_exercises"))
    assert "status = 'published'" in original["vocab_exercises_select"]


def test_revokes_only_the_tables_left_without_policy_or_jwt_reader():
    assert set(re.findall(r"'(\w+)'", _array("revoked_tables"))) == set(REVOKED)
    assert ("REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'\n"
            "                           ' ON public.%I FROM PUBLIC, anon, authenticated'") in CODE
    assert "current_setting('server_version_num')::int >= 170000" in CODE
    assert "service_role" not in CODE, "service_role grants are not touched"


def test_grammar_functions_are_the_283_trigger_functions_and_bodies_are_untouched():
    assert set(re.findall(r"'(\w+)'", _array("grammar_functions"))) == set(GRAMMAR_FUNCTIONS)
    altered = re.findall(r"ALTER FUNCTION public\.(\w+)\(\) SET search_path = public, pg_temp;", CODE)
    assert sorted(altered) == sorted(GRAMMAR_FUNCTIONS)
    grammar = _strip_sql_comments(GRAMMAR_SQL)
    for name in GRAMMAR_FUNCTIONS:
        assert re.search(rf"CREATE OR REPLACE FUNCTION {name}\(\)\s+RETURNS TRIGGER LANGUAGE plpgsql AS \$\$",
                         grammar), name
        for path in sorted(MIGRATIONS.glob("*.sql")):
            if path.name in {NAME, "283_master30_grammar_diagnostic.sql"}:
                continue
            assert not re.search(rf"FUNCTION\s+(?:public\.)?{name}\b",
                                 _strip_sql_comments(path.read_text(encoding="utf-8"))), (path.name, name)


def test_postconditions_are_catalog_driven():
    post = CODE[CODE.rindex("SET search_path = public, pg_temp;"):]
    for marker in ("inline_admin_policy_remains", "non_target_policy_changed",
                   "vocab_exercises_select_not_published_only", "rls_disabled",
                   "client_privilege_remains", "grammar_function_search_path_not_pinned",
                   "row_count_changed"):
        assert marker in post, marker
    # The inline check scans every public policy, not the drop list.
    assert "pg_get_expr(p.polwithcheck, p.polrelid)) ~* '''admin'''" in post


def test_rollback_note_restores_every_dropped_policy_and_resets_every_function():
    rollback = _rollback_sql()
    assert rollback.startswith("BEGIN;") and rollback.rstrip().endswith("COMMIT;")
    for table, policy in DROPPED:
        assert re.search(rf'CREATE POLICY "?{re.escape(policy)}"? ON public\.{table}\b', rollback), policy
    assert "ALTER POLICY vocab_exercises_select ON public.vocabulary_exercises" in rollback
    for name in GRAMMAR_FUNCTIONS:
        assert f"ALTER FUNCTION public.{name}() RESET search_path;" in rollback
    assert "GRANT SELECT ON public.user_feedback, public.lemma_overrides TO anon, authenticated;" in rollback
    assert "REOPENS F1" in SQL


def test_forward_policy_and_readme_record_345():
    rows = [line.split("\t") for line in (MIGRATIONS / "forward-policy.tsv").read_text(
        encoding="utf-8").splitlines() if line.startswith(NAME)]
    assert len(rows) == 1 and rows[0][1:3] == ["pending_feature", "rls_admin_inline"]
    readme = (MIGRATIONS / "README.md").read_text(encoding="utf-8")
    assert "Migration `345` (PC-J119)" in readme and "345 is\nPC-J119" in readme


# Step 0 of the job, pinned: nobody reads these tables with a user JWT.

def _tracked(prefix: str) -> list[Path]:
    out = subprocess.run(["git", "ls-files", prefix], cwd=REPO, capture_output=True, text=True, check=True)
    return [REPO / line for line in out.stdout.splitlines()
            if line.endswith((".js", ".mjs", ".ts", ".tsx", ".jsx", ".html"))]


def test_step0_frontend_makes_no_postgrest_call_on_these_tables():
    files = _tracked("frontend")
    assert len(files) > 100
    pattern = re.compile(r"""\.from\(\s*['"`](%s)['"`]|/rest/v1/(%s)\b""" % (("|".join(TABLES),) * 2))
    hits = [f"{path.relative_to(REPO)}:{m.group(0)}" for path in files if path.is_file()
            for m in pattern.finditer(path.read_text(encoding="utf-8", errors="ignore"))]
    assert hits == []


def test_step0_jwt_scoped_backend_clients_read_only_published_vocabulary_exercises():
    jwt_clients = [path for path in sorted((BACKEND).rglob("*.py"))
                   if "tests" not in path.parts and "scripts" not in path.parts
                   and "postgrest.auth(" in path.read_text(encoding="utf-8")]
    assert {p.name for p in jwt_clients} == {"dashboard.py", "exercises.py", "flashcards.py",
                                             "vocabulary_bank.py"}
    for path in jwt_clients:
        text = path.read_text(encoding="utf-8")
        for table in TABLES:
            if path.name == "exercises.py" and table == "vocabulary_exercises":
                continue
            assert table not in text, (path.name, table)
    exercises = (BACKEND / "routers" / "exercises.py").read_text(encoding="utf-8")
    jwt_reads = re.findall(r'\bsb\.table\("vocabulary_exercises"\)(.*?)\.execute\(\)', exercises, re.S)
    # Two pool reads filter on published, two by-id reads 404 anything else,
    # and complete_session rebuilds pre-211 snapshots of exercises the
    # session already served from the published pool.
    assert len(jwt_reads) == 5
    assert sum('.eq("status", "published")' in read for read in jwt_reads) == 2
    assert exercises.count('res.data[0].get("status") != "published"') == 2
    assert '.in_("id", unresolved)' in jwt_reads[4]


# ── PostgreSQL execution ────────────────────────────────────────────────────

sql = m334.sql


def _run(database: str, text: str, *, role: str | None = None) -> str:
    prefix = f"SET ROLE {role};\n" if role else ""
    result = subprocess.run([*m334._psql_args(database, app="adm345"), "-f", "-"],
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
            pytest.fail("Local PostgreSQL required for migration 345 verification")
        pytest.skip("Local PostgreSQL unavailable")
    if sql("postgres", "SELECT usesuper FROM pg_user WHERE usename = current_user") != "t":
        pytest.fail("Migration 345 fixture requires a superuser on its disposable LOCAL cluster")
    sql("postgres", f"""DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='{RUNNER}') THEN
        CREATE ROLE {RUNNER} NOSUPERUSER NOBYPASSRLS NOLOGIN;
      END IF;
    END $$;""")
    sql("postgres", "ALTER ROLE service_role BYPASSRLS")


USERS = {
    "learner": ("student", True, None),
    "learner2": ("student", True, None),
    "admin": ("admin", True, None),
    "admin_inactive": ("admin", False, None),
    "admin_suspended": ("admin", True, "now()"),
}


def _shape(database: str) -> dict[str, str]:
    """Hosted-Supabase shape of the seven tables before 345; returns user ids."""
    ids = {name: str(uuid4()) for name in USERS}
    sql(database, f"""
        GRANT USAGE, CREATE ON SCHEMA public TO {RUNNER};
        GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
        ALTER DEFAULT PRIVILEGES FOR ROLE {RUNNER} IN SCHEMA public
            GRANT ALL ON TABLES TO anon, authenticated, service_role;
        ALTER DEFAULT PRIVILEGES FOR ROLE {RUNNER} IN SCHEMA public
            GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
        CREATE SCHEMA auth;
        CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
          SELECT (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
        $$;
        GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role, {RUNNER};
        GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role, {RUNNER};""")
    tables = """
        CREATE TABLE users (id uuid PRIMARY KEY, role text NOT NULL, is_active boolean,
                            suspended_at timestamptz);
        ALTER TABLE users ENABLE ROW LEVEL SECURITY;
        CREATE POLICY "Users can view own data" ON users FOR SELECT USING (auth.uid() = id);
        CREATE TABLE dictation_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid,
                                         results text);
        CREATE TABLE dictation_attempts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid);
        CREATE TABLE dictation_attempt_answers (attempt_id uuid, sentence_idx int, typed text);
        CREATE TABLE user_feedback (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_by uuid,
                                    message text);
        CREATE TABLE lemma_overrides (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                                      original_word text, lemma text);
        CREATE TABLE vocabulary_exercises (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                                           status varchar(16) NOT NULL, content_payload text);
        CREATE TABLE access_codes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text, used_by uuid);
        CREATE TABLE grammar_content_releases (id uuid PRIMARY KEY, status text NOT NULL);
        CREATE TABLE grammar_lessons (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), release_id uuid,
                                      title text);
        CREATE TABLE grammar_exposure_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), note text);
    """
    enable = "\n".join(f"ALTER TABLE {t} ENABLE ROW LEVEL SECURITY;" for t in TABLES)
    policies = []
    for (table, _), path in {**DROPPED, **KEPT}.items():
        if path:
            policies += [stmt for name, stmt in _create_policy_statements(path, table)
                         if (table, name) in DROPPED or (table, name) in KEPT]
    policies = list(dict.fromkeys(policies)) + [ADMIN_ONLY_CATALOG]
    assert len(policies) == len(DROPPED) + len(KEPT)
    grammar_code = _strip_sql_comments(GRAMMAR_SQL)
    functions = [re.search(rf"CREATE OR REPLACE FUNCTION {name}\(\).*?\n\$\$;", grammar_code, re.S).group(0)
                 for name in GRAMMAR_FUNCTIONS]
    triggers = [re.search(rf"CREATE TRIGGER {name}\b.*?;", grammar_code, re.S).group(0)
                for name in ("grammar_lessons_release_immutable", "grammar_exposure_immutable")]
    # 320 left the client roles SELECT only on these tables (staging relacl).
    grants = "\n".join(f"REVOKE ALL ON {t} FROM anon, authenticated; GRANT SELECT ON {t} TO anon, authenticated;"
                       for t in [*TABLES, "users"])
    _run(database, "\n".join([tables, enable, *policies, *functions, *triggers, grants]), role=RUNNER)

    def value(v):
        return "NULL" if v is None else v
    sql(database, "INSERT INTO users VALUES " + ", ".join(
        f"('{ids[n]}', '{r}', {str(a).lower()}, {value(s)})" for n, (r, a, s) in USERS.items()))
    learner, learner2 = ids["learner"], ids["learner2"]
    a1, a2 = str(uuid4()), str(uuid4())
    sql(database, f"""
        INSERT INTO dictation_sessions (user_id, results) VALUES
            ('{learner}', 'transcript 1'), ('{learner}', 'transcript 2'), ('{learner2}', 'transcript 3');
        INSERT INTO dictation_attempts (id, user_id) VALUES ('{a1}', '{learner}'), ('{a2}', '{learner2}');
        INSERT INTO dictation_attempt_answers VALUES ('{a1}', 0, 'x'), ('{a1}', 1, 'y'), ('{a2}', 0, 'z');
        INSERT INTO user_feedback (created_by, message) VALUES ('{learner}', 'a'), ('{learner2}', 'b');
        INSERT INTO lemma_overrides (original_word, lemma) VALUES ('data', 'data'), ('went', 'go');
        INSERT INTO vocabulary_exercises (status, content_payload) VALUES
            ('published', 'p1'), ('published', 'p2'), ('draft', 'd1'), ('rejected', 'r1');
        INSERT INTO access_codes (code, used_by) VALUES ('AVR-1', '{learner}'), ('AVR-2', NULL);""")
    return ids


def _claims(user: str | None, aal: str = "aal1") -> str:
    return json.dumps({"role": "authenticated", "aal": aal, **({"sub": user} if user else {})})


def _count(database: str, role: str, user: str | None, table: str, *, aal: str = "aal1",
           where: str = "true") -> str:
    """Rows `user`'s JWT sees, or the SQLSTATE when the read is refused."""
    query = (f"SELECT set_config('request.jwt.claims', '{_claims(user, aal)}', false);"
             f" SELECT count(*) FROM public.{table} WHERE {where};")
    try:
        return _run(database, query, role=role).splitlines()[-1]
    except RuntimeError as error:
        assert "permission denied" in str(error), error
        return "42501"


def _visible(database: str, ids: dict[str, str]) -> dict[str, dict[str, str]]:
    actors = {
        "admin_aal1": ("authenticated", ids["admin"], "aal1"),
        "admin_aal2": ("authenticated", ids["admin"], "aal2"),
        "admin_inactive_aal2": ("authenticated", ids["admin_inactive"], "aal2"),
        "admin_suspended_aal2": ("authenticated", ids["admin_suspended"], "aal2"),
        "learner": ("authenticated", ids["learner"], "aal1"),
        "anon": ("anon", None, "aal1"),
        "service_role": ("service_role", None, "aal1"),
    }
    return {name: {table: _count(database, role, user, table, aal=aal) for table in TABLES}
            | {"vocabulary_exercises:unpublished": _count(database, role, user, "vocabulary_exercises",
                                                          aal=aal, where="status <> 'published'")}
            for name, (role, user, aal) in actors.items()}


def _hostile_search_path_update(database: str) -> str:
    """A lesson of a validated release, updated with a search_path whose first
    schema shadows grammar_content_releases. Returns 'updated' or the error."""
    try:
        return _run(database, """
            BEGIN;
            SET LOCAL search_path = evil, public;
            UPDATE public.grammar_lessons SET title = 'rewritten';
            SELECT 'updated';
            ROLLBACK;""").splitlines()[-1]
    except RuntimeError as error:
        return str(error)


def _catalog(database: str) -> dict:
    return json.loads(sql(database, """SELECT json_build_object(
        'policies', (SELECT json_object_agg(c.relname || '.' || p.polname,
                        concat_ws(' | ', p.polcmd, p.polroles::regrole[]::text,
                                  pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid)))
                       FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
                      WHERE c.relnamespace = 'public'::regnamespace),
        'acl', (SELECT json_object_agg(relname, relacl::text) FROM pg_class
                 WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'),
        'rls', (SELECT json_object_agg(relname, relrowsecurity) FROM pg_class
                 WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'),
        'functions', (SELECT json_object_agg(proname, json_build_object(
                          'config', proconfig::text, 'src', md5(prosrc), 'definer', prosecdef))
                        FROM pg_proc WHERE pronamespace = 'public'::regnamespace))"""))


def _fresh(prefix: str) -> tuple[str, dict[str, str]]:
    database = f"{prefix}_{uuid4().hex[:12]}"
    sql("postgres", f"CREATE DATABASE {database}")
    ids = _shape(database)
    # The shadow schema an attacker-controlled session search_path would name.
    sql(database, f"""
        CREATE SCHEMA evil;
        CREATE TABLE evil.grammar_content_releases (id uuid PRIMARY KEY, status text);
        INSERT INTO public.grammar_content_releases VALUES ('{uuid4()}', 'validated');
        ALTER TABLE public.grammar_lessons DISABLE TRIGGER USER;
        INSERT INTO public.grammar_lessons (release_id, title)
             SELECT id, 'lesson' FROM public.grammar_content_releases;
        ALTER TABLE public.grammar_lessons ENABLE TRIGGER USER;""")
    return database, ids


@pytest.fixture(scope="module")
def world():
    _require_pg()
    database, ids = _fresh("adm345")
    try:
        before = {"visible": _visible(database, ids), "catalog": _catalog(database),
                  "hostile": _hostile_search_path_update(database)}
        _apply(database)
        _apply(database)  # re-running is a no-op
        yield {"db": database, "ids": ids, "before": before}
    finally:
        sql("postgres", f"DROP DATABASE IF EXISTS {database} WITH (FORCE)")


@pytest.fixture()
def pre():
    """A pre-345 database for the rollback and negative-control cases."""
    _require_pg()
    database, ids = _fresh("adm345pre")
    try:
        yield database, ids
    finally:
        sql("postgres", f"DROP DATABASE IF EXISTS {database} WITH (FORCE)")


ALL_ROWS = {"dictation_sessions": "3", "dictation_attempts": "2", "dictation_attempt_answers": "3",
            "user_feedback": "2", "lemma_overrides": "2", "vocabulary_exercises": "4",
            "access_codes": "2", "vocabulary_exercises:unpublished": "2"}


def test_the_exploit_exists_before_345(world):
    visible = world["before"]["visible"]
    for admin in ("admin_aal1", "admin_inactive_aal2", "admin_suspended_aal2"):
        assert visible[admin] == ALL_ROWS, admin
    assert world["before"]["hostile"] == "updated", "the hostile search_path bypassed the guard"


@pytest.mark.parametrize("admin", ["admin_aal1", "admin_aal2", "admin_inactive_aal2", "admin_suspended_aal2"])
def test_no_admin_jwt_reads_any_row_after_345(world, admin):
    visible = _visible(world["db"], world["ids"])[admin]
    assert visible == {
        "dictation_sessions": "0", "dictation_attempts": "0", "dictation_attempt_answers": "0",
        "user_feedback": "42501", "lemma_overrides": "42501", "access_codes": "0",
        "vocabulary_exercises": "2", "vocabulary_exercises:unpublished": "0"}


def test_learners_anon_and_service_role_are_unchanged_except_feedback_and_lemma(world):
    after = _visible(world["db"], world["ids"])
    before = world["before"]["visible"]
    assert before["learner"] == {
        "dictation_sessions": "2", "dictation_attempts": "1", "dictation_attempt_answers": "2",
        "user_feedback": "0", "lemma_overrides": "0", "access_codes": "0",
        "vocabulary_exercises": "2", "vocabulary_exercises:unpublished": "0"}
    assert after["learner"] == {**before["learner"], "user_feedback": "42501", "lemma_overrides": "42501"}
    assert after["anon"] == {**before["anon"], "user_feedback": "42501", "lemma_overrides": "42501"}
    assert after["anon"]["vocabulary_exercises"] == "2" and after["anon"]["dictation_sessions"] == "0"
    assert after["service_role"] == before["service_role"] == ALL_ROWS
    # The learner sees exactly their own rows, not just the right number.
    db, learner = world["db"], world["ids"]["learner"]
    assert _count(db, "authenticated", learner, "dictation_sessions", where=f"user_id <> '{learner}'") == "0"
    assert _count(db, "authenticated", learner, "dictation_attempt_answers",
                  where="typed = 'z'") == "0"


def test_catalog_after_double_apply(world):
    before, after = world["before"]["catalog"], _catalog(world["db"])
    gone = {f"{t}.{p}" for t, p in DROPPED}
    assert set(before["policies"]) - set(after["policies"]) == gone
    assert set(after["policies"]) <= set(before["policies"])
    for key, value in after["policies"].items():
        assert "'admin'" not in value, key
        if key != "vocabulary_exercises.vocab_exercises_select":
            assert value == before["policies"][key], key
    # {-} is PUBLIC (role oid 0), as before: anon keeps published exercises.
    assert after["policies"]["vocabulary_exercises.vocab_exercises_select"] == (
        "r | {-} | ((status)::text = 'published'::text)")
    assert after["rls"] == before["rls"]
    for table, acl in after["acl"].items():
        entries = set(acl.strip("{}").split(","))
        old = set(before["acl"][table].strip("{}").split(","))
        if table in REVOKED:
            assert {e for e in entries if e.startswith(("anon=", "authenticated=", "="))} == set()
            assert entries == {e for e in old if not e.startswith(("anon=", "authenticated=", "="))}
        else:
            assert entries == old, table
    for name in GRAMMAR_FUNCTIONS:
        assert after["functions"][name] == {**before["functions"][name], "config": PINNED}
        assert before["functions"][name]["config"] is None and not after["functions"][name]["definer"]
    assert {k: v for k, v in after["functions"].items() if k not in GRAMMAR_FUNCTIONS} == (
        {k: v for k, v in before["functions"].items() if k not in GRAMMAR_FUNCTIONS})


def test_revoked_tables_have_no_client_privilege_but_service_role_keeps_all(world):
    for table in REVOKED:
        for role in ("public", "anon", "authenticated"):
            for privilege in CLIENT_PRIVILEGES:
                assert sql(world["db"], f"SELECT has_table_privilege('{role}', 'public.{table}', "
                                        f"'{privilege}')") == "f", (table, role, privilege)
        assert sql(world["db"], f"SELECT has_table_privilege('service_role', 'public.{table}', "
                                "'SELECT, INSERT, UPDATE, DELETE')") == "t"


def test_grammar_guards_ignore_a_hostile_search_path_and_still_fire(world):
    assert "validated grammar release content is immutable" in _hostile_search_path_update(world["db"])
    with pytest.raises(RuntimeError, match="grammar diagnostic evidence is immutable"):
        sql(world["db"], "INSERT INTO grammar_exposure_events (note) VALUES ('x');"
                         " UPDATE grammar_exposure_events SET note = 'y'")
    # A normal session (search_path = public) is unaffected.
    sql(world["db"], f"INSERT INTO grammar_content_releases VALUES ('{uuid4()}', 'staging')")


def test_row_counts_unchanged(world):
    for table, rows in ALL_ROWS.items():
        if ":" not in table:
            assert sql(world["db"], f"SELECT count(*) FROM public.{table}") == rows


def test_rollback_note_reopens_the_hole_and_re_apply_closes_it(pre):
    database, ids = pre
    _apply(database)
    _apply(database, _rollback_sql())
    reopened = _visible(database, ids)
    for admin in ("admin_aal1", "admin_inactive_aal2", "admin_suspended_aal2"):
        assert reopened[admin] == ALL_ROWS, admin
    assert _hostile_search_path_update(database) == "updated"
    _apply(database)
    assert _visible(database, ids)["admin_aal1"]["dictation_sessions"] == "0"
    assert "immutable" in _hostile_search_path_update(database)


def _mutated(old: str, new: str) -> str:
    assert old in SQL, old
    return SQL.replace(old, new)


@pytest.mark.parametrize(("setup", "text", "marker"), [
    ("CREATE TABLE other (id int); ALTER TABLE other ENABLE ROW LEVEL SECURITY;"
     " CREATE POLICY staff_read ON other FOR SELECT USING (EXISTS (SELECT 1 FROM users u"
     " WHERE u.id = auth.uid() AND u.role IN ('admin', 'instructor')));",
     SQL, "inline_admin_policy_remains: other.staff_read"),
    ("CREATE POLICY jwt_admin ON access_codes FOR SELECT USING ((auth.uid() IS NOT NULL)"
     " AND (current_setting('request.jwt.claims', true)::jsonb ->> 'user_role') = 'admin');",
     SQL, "inline_admin_policy_remains: access_codes.jwt_admin"),
    ("ALTER TABLE dictation_sessions DISABLE ROW LEVEL SECURITY;", SQL, "rls_disabled: dictation_sessions"),
    ("DROP POLICY vocab_exercises_select ON vocabulary_exercises;", SQL, "vocab_exercises_select_missing"),
    ("DROP FUNCTION prevent_grammar_evidence_mutation() CASCADE;"
     " CREATE FUNCTION prevent_grammar_evidence_mutation(p int) RETURNS int LANGUAGE sql AS 'SELECT 1';",
     SQL, "grammar_function_signature_drift: prevent_grammar_evidence_mutation"),
    ("", _mutated('ALTER POLICY vocab_exercises_select ON public.vocabulary_exercises\n'
                  "            USING (status = 'published');", "NULL;"),
     "inline_admin_policy_remains: vocabulary_exercises.vocab_exercises_select"),
    ("", _mutated("USING (status = 'published');", "USING (status IN ('published', 'draft'));"),
     "vocab_exercises_select_not_published_only"),
    ("", _mutated('DROP POLICY IF EXISTS "admins read feedback" ON public.user_feedback;',
                  'DROP POLICY IF EXISTS "admins read feedback" ON public.user_feedback;'
                  ' DROP POLICY "users read own dictation sessions" ON public.dictation_sessions;'),
     "non_target_policy_changed"),
    ("", _mutated("revoked_tables CONSTANT TEXT[] := ARRAY['user_feedback', 'lemma_overrides'];",
                  "revoked_tables CONSTANT TEXT[] := ARRAY['user_feedback', 'lemma_overrides'];"
                  " skip TEXT[] := ARRAY['lemma_overrides'];").replace(
         "        IF to_regclass('public.' || t) IS NOT NULL THEN\n            EXECUTE format('REVOKE",
         "        IF to_regclass('public.' || t) IS NOT NULL AND NOT t = ANY (skip) THEN\n"
         "            EXECUTE format('REVOKE"),
     "client_privilege_remains: lemma_overrides:anon:SELECT"),
    ("", _mutated("        ALTER FUNCTION public.prevent_grammar_evidence_mutation() SET search_path = public, pg_temp;",
                  "        NULL;"),
     "grammar_function_search_path_not_pinned: prevent_grammar_evidence_mutation"),
    ("", _mutated("    -- ── 6. Postconditions", "    DELETE FROM public.lemma_overrides WHERE lemma = 'go';\n"
                                                "    -- ── 6. Postconditions"),
     "row_count_changed"),
], ids=lambda value: value.split(":")[0] if value.startswith(("inline", "rls", "vocab", "grammar",
                                                                    "non_", "client", "row_")) else "")
def test_postcondition_rejects_an_unsafe_state(pre, setup, text, marker):
    database, ids = pre
    if setup:
        _run(database, setup, role=RUNNER)
    before = _catalog(database)
    with pytest.raises(RuntimeError, match=re.escape(marker)):
        _apply(database, text)
    # The failed run left nothing behind (one transaction).
    assert _catalog(database) == before
    assert sql(database, "SELECT count(*) FROM lemma_overrides") == "2"
