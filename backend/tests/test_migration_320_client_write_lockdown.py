"""Migration 320: client roles cannot write privilege, score or session data.

Staging security audit 2026-10-25 and the Project Coordinator review of
2026-10-26:
  F01 — `authenticated` (and `anon`) had table-wide UPDATE on public.users and
        the dashboard policy "Users can update own data" only checks the row,
        so PATCH /rest/v1/users?id=eq.<self> {"role": "admin"} escalated.
  F03 — own-row write policies let a student rewrite their own scores/bands,
        including d1_sessions counts and vocabulary_exercise_attempts results.
  F04 — an account that never redeemed an access code could INSERT a session
        directly and obtain AI grading.
  F14 — SECURITY DEFINER trigger functions were EXECUTE-able by client roles.
  Default privileges must be changed FOR the owner role that holds them.

The static half always runs and pins the contract between the migration and
the code that writes as `authenticated` (FastAPI's learner-JWT routers) or
could write as a client (the browser). The PostgreSQL half runs the real
migration in a disposable schema that mimics Supabase's default grants, default
ACLs, dashboard policy and auth.uid(): it first proves the exploits work there,
then applies the migration twice and proves each finding is closed while the
learner-owned practice writes, the trigger guards and the service-role/owner
paths still work.

Set TEST_PG_URL to a LOCAL disposable cluster and REQUIRE_PG=1 to forbid skips.
"""

from __future__ import annotations

import json
import os
import re
import shutil
from pathlib import Path
from uuid import uuid4

import pytest

from test_migration_240_core_attempt_evidence import psql

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
SQL = (BACKEND / "migrations/320_client_write_privilege_lockdown.sql").read_text(encoding="utf-8")

USER_JWT_ROUTERS = ("flashcards.py", "vocabulary_bank.py", "exercises.py", "dashboard.py")
# Learner-JWT RPCs (SECURITY INVOKER) and the tables they write.
INVOKER_RPC_TABLES = {
    "fn_apply_srs_review_idempotent": ("212_flashcard_review_idempotency.sql",
                                       {"flashcard_reviews", "flashcard_review_log"}),
}
# Server-computed D1 results: never writable with the learner JWT.
SERVER_SCORED_TABLES = {"vocabulary_exercise_attempts", "d1_sessions"}
# The one column-scoped learner write (archive/restore cascade).
COLUMN_SCOPED = {"user_d1_questions": {"is_active"}}
F14_DEFINERS = (
    "advanced_vocab_complete_practice_after_answer", "advanced_vocab_guard_course_section",
    "advanced_vocab_guard_listening_attempt", "advanced_vocab_guard_question_attempt",
    "advanced_vocab_guard_selection", "guard_advanced_vocab_assignment_snapshot",
    "guard_grammar_assignment_evidence_write",
)


def _strip_sql_comments(sql: str) -> str:
    sql = re.sub(r"/\*.*?\*/", "", sql, flags=re.S)
    return re.sub(r"--[^\n]*", "", sql)


CODE = _strip_sql_comments(SQL)


def _array(name: str, text: str = CODE) -> list[set[str]]:
    blocks = re.findall(name + r"\s+CONSTANT\s+TEXT\[\]\s*:=\s*ARRAY\[(.*?)\]", text, re.S)
    return [set(re.findall(r"'([a-z_0-9]+)'", block)) for block in blocks]


# ── Static contract ─────────────────────────────────────────────────────────

_LEARNER_TABLE = re.compile(r"(?:\bsb|\b_user_sb\([^)]*\))\s*\.\s*table\(\s*[\"']([a-z_0-9]+)[\"']\s*\)")


def _learner_writes() -> dict[str, list[str]]:
    """Tables FastAPI writes with the learner's JWT → the write chains."""
    writes: dict[str, list[str]] = {}
    for name in USER_JWT_ROUTERS:
        source = (BACKEND / "routers" / name).read_text(encoding="utf-8")
        assert "def _user_sb" in source, f"{name} no longer defines _user_sb"
        for match in _LEARNER_TABLE.finditer(source):
            chain = source[match.end():match.end() + 600].split(".execute()")[0]
            if re.search(r"\.(insert|update|upsert|delete)\(", chain):
                writes.setdefault(match.group(1), []).append(chain)
        for rpc in re.findall(r"\bsb\s*\.\s*rpc\(\s*[\"']([a-z_0-9]+)[\"']", source):
            assert rpc in INVOKER_RPC_TABLES, f"{name} calls unreviewed learner-JWT RPC {rpc}"
    for rpc, (migration, written) in INVOKER_RPC_TABLES.items():
        body = (BACKEND / "migrations" / migration).read_text(encoding="utf-8")
        assert "SECURITY DEFINER" not in _strip_sql_comments(body).upper(), (
            f"{rpc} became SECURITY DEFINER; its tables no longer need client grants")
        for table in written:
            writes.setdefault(table, []).append(f"rpc:{rpc}")
    return writes


def test_client_write_allowlist_is_exactly_the_learner_jwt_write_surface():
    allowlists = _array("client_write_tables")
    assert len(allowlists) == 2, "step 1 and the postcondition must both declare the allowlist"
    assert allowlists[0] == allowlists[1]
    writes = _learner_writes()
    assert len(writes) >= 5, f"scanner found only {sorted(writes)} — regex broken?"
    assert allowlists[0] == set(writes) - set(COLUMN_SCOPED), (
        "a learner-JWT write was added or removed; update migration 320's allowlist "
        f"deliberately. migration={sorted(allowlists[0])} code={sorted(writes)}")
    # F01/F03/F04 tables and server-scored D1 results must never be on it.
    assert not allowlists[0] & ({"users", "sessions", "responses", "access_codes",
                                 "user_code_assignments", "students", "quiz_sessions",
                                 "user_d1_questions"} | SERVER_SCORED_TABLES)


def test_d1_results_are_written_by_the_service_client_with_the_verified_user():
    writes = _learner_writes()
    assert not SERVER_SCORED_TABLES & set(writes), (
        "learner JWT writes a server-computed D1 table again: "
        f"{sorted(SERVER_SCORED_TABLES & set(writes))}")
    source = (BACKEND / "routers/exercises.py").read_text(encoding="utf-8")
    assert re.search(r"def _service_sb\(\):\s*(?:\"\"\".*?\"\"\"\s*)?return supabase_admin", source, re.S)
    for table in SERVER_SCORED_TABLES:
        assert re.search(rf"_service_sb\(\)\s*\.\s*table\(\s*\"{table}\"\s*\)\s*\.\s*insert\(",
                         source), f"{table} insert no longer goes through _service_sb"
    update = re.search(r"_service_sb\(\)\.table\(\"d1_sessions\"\)\.update\(\{.*?\}\)(.*?)\.execute\(\)",
                       source, re.S)
    assert update and '.eq("user_id", user_id)' in update.group(1), (
        "the service-role completion write must be scoped to the verified user")
    assert '_service_sb().rpc("fn_finalize_d1_attempt_for_user"' in source
    assert '"p_user_id": user_id' in source
    assert '"fn_finalize_d1_attempt"' not in source


def test_column_scoped_learner_writes_match_their_grants():
    writes = _learner_writes()
    for table, columns in COLUMN_SCOPED.items():
        assert writes.get(table), f"{table} is no longer written with the learner JWT; drop its grant"
        for chain in writes[table]:
            assert re.match(r"\s*\.update\(\s*\{", chain), f"{table}: only UPDATE is granted: {chain}"
            written = set(re.findall(r"\{\s*\"([a-z_]+)\"\s*:", chain))
            assert written <= columns, f"{table}: learner writes {written - columns}"
        grant = re.search(rf"GRANT\s+UPDATE\s*\(([^)]*)\)\s*ON\s+public\.{table}\s+TO\s+authenticated", CODE)
        assert grant and {c.strip() for c in grant.group(1).split(",")} == columns


def test_users_has_no_client_update_grant_and_the_policy_is_hardened():
    from routers.auth import ProfileUpdate

    assert not re.search(r"GRANT[^;]*ON\s+public\.users\b", CODE, re.I), (
        "PATCH /auth/profile writes with service_role; a client grant only bypasses its validation")
    (trigger_safe,) = _array("profile_columns")
    assert trigger_safe - {"updated_at"} == set(ProfileUpdate.model_fields)
    privileged = {"role", "is_active", "permissions", "feature_flags", "access_code_used",
                  "email", "id"}
    assert not trigger_safe & privileged
    policy = re.search(r"ALTER POLICY \"Users can update own data\" ON public\.users(.*?);", CODE, re.S)
    assert policy, "dashboard users UPDATE policy is not hardened"
    assert re.search(r"TO\s+authenticated\s+USING\s*\(auth\.uid\(\)\s*=\s*id\)\s+"
                     r"WITH\s+CHECK\s*\(auth\.uid\(\)\s*=\s*id\)", policy.group(1))
    assert "policyname = 'Users can update own data'" in CODE, "ALTER POLICY must be IF EXISTS-guarded"
    assert "users_update_policy_not_hardened" in CODE
    # Out of scope for this PR (batch 3): both role constraints stay.
    assert "users_role_check" not in CODE and "DROP CONSTRAINT" not in CODE.upper()


def test_every_client_write_privilege_is_revoked_for_every_relation_kind():
    assert re.search(r"relkind\s+IN\s*\(\s*'r'\s*,\s*'p'\s*,\s*'v'\s*,\s*'m'\s*,\s*'f'\s*\)", CODE)
    statements = re.findall(r"REVOKE\s+(.*?)\s+ON\s+%s\s+FROM\s+([^']+)'", CODE, re.S)
    assert ("INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER", "PUBLIC, anon") in statements
    assert ("INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER", "authenticated") in statements
    assert ("TRUNCATE, REFERENCES, TRIGGER", "authenticated") in statements
    assert re.search(r"REVOKE UPDATE ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated", CODE)
    # SELECT/RLS reads are out of scope and must stay untouched.
    assert not re.search(r"REVOKE[^;]*\bSELECT\b", CODE)
    assert "client_write_privilege_lockdown_incomplete" in CODE


def test_default_privileges_target_the_owner_roles_with_a_guard():
    # Every ALTER DEFAULT PRIVILEGES names its owner role: a bare one only
    # changes the runner's own ACL and leaves `postgres`'s grants in place.
    statements = re.findall(r"ALTER DEFAULT PRIVILEGES(.*?)(?:'|;)", CODE, re.S)
    assert statements and all(s.strip().startswith("FOR ROLE %I") for s in statements), statements
    assert re.search(r"rolname IN \('postgres', 'supabase_admin', current_user\)", CODE)
    assert "pg_has_role(current_user, r.oid, 'MEMBER')" in CODE, "must skip roles the runner cannot act for"
    assert "REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER '\n            'ON TABLES" in SQL
    assert "REVOKE UPDATE ON SEQUENCES" in CODE
    assert "client_default_write_privilege_survives" in CODE and "pg_default_acl" in CODE
    # Function EXECUTE defaults are documented as unchanged (see header).
    assert not re.search(r"ON\s+FUNCTIONS", CODE)


def test_f14_definer_triggers_and_finalize_functions_are_not_client_rpcs():
    for name in F14_DEFINERS:
        assert name in SQL, f"{name} missing from the F14 note"
    assert re.search(r"p\.prosecdef\s+AND p\.prorettype = 'trigger'::regtype", CODE)
    assert "REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated" in CODE
    assert "client_executable_privileged_function" in CODE
    finalize = re.search(r"CREATE OR REPLACE FUNCTION public\.fn_finalize_d1_attempt_for_user\((.*?)\$\$;",
                         CODE, re.S)
    assert finalize and "SECURITY DEFINER" not in finalize.group(1).split("AS $$")[0].upper()
    assert "auth.uid()" not in finalize.group(1), "service-role function must use p_user_id"
    assert re.search(r"GRANT EXECUTE ON FUNCTION public\.fn_finalize_d1_attempt_for_user\(.*?\)\s*TO service_role",
                     CODE, re.S)


def test_users_guard_is_invoker_trigger_with_no_client_execute():
    function = re.search(r"CREATE OR REPLACE FUNCTION public\.fn_guard_users_privileged_columns\(\)"
                         r"(.*?)\$\$;", CODE, re.S)
    assert function, "users guard function missing"
    header = function.group(1).split("AS $$")[0]
    assert "SECURITY DEFINER" not in header.upper(), "current_user must be the writer"
    assert "request.jwt.claims" in function.group(1) and "current_user" in function.group(1)
    assert "REVOKE ALL ON FUNCTION public.fn_guard_users_privileged_columns() FROM PUBLIC, anon, authenticated" in CODE
    assert re.search(r"CREATE TRIGGER trg_users_guard_privileged_columns\s+BEFORE UPDATE ON public\.users",
                     CODE)
    assert CODE.strip().startswith("BEGIN;") and CODE.strip().endswith("COMMIT;")


def test_browser_performs_no_direct_postgrest_writes():
    """The migration's premise: every browser write goes through FastAPI."""
    pattern = re.compile(r"(?<![A-Za-z])(?:sb|supabase|client|db|getSupabase\(\))\s*\??\.\s*"
                         r"(?:from\(\s*['\"`][a-z_]+['\"`]\s*\)|rpc\()|/rest/v1/")
    offenders = []
    for folder in ("app", "lib", "components", "public/js", "js", "pages"):
        base = ROOT / "frontend" / folder
        if not base.exists():
            continue
        for path in base.rglob("*"):
            if (path.suffix not in {".ts", ".tsx", ".js", ".mjs", ".html"}
                    or "node_modules" in path.parts or not path.is_file()):
                continue
            text = path.read_text(encoding="utf-8", errors="ignore")
            offenders += [f"{path.relative_to(ROOT)}:{text[:m.start()].count(chr(10)) + 1}"
                          for m in pattern.finditer(text)]
    assert offenders == [], (
        "the browser now talks to PostgREST directly; grant that exact privilege in a "
        f"forward migration and add it to migration 320's contract: {offenders}")


# ── PostgreSQL execution ────────────────────────────────────────────────────

LEARNER_TABLES = sorted(_array("client_write_tables")[0])


def _claims(user_id: str | None, role: str) -> str:
    claims = {"role": role} if user_id is None else {"sub": user_id, "role": role}
    return json.dumps(claims)


def _as(role: str, user_id: str | None, sql: str) -> str:
    return psql(
        f"SET ROLE {role}; SELECT set_config('request.jwt.claims', '{_claims(user_id, role)}', false);"
        f" {sql}")


def _last(role: str, user_id: str | None, sql: str) -> str:
    """The final output line (after the set_config echo)."""
    return _as(role, user_id, sql).splitlines()[-1]


def _denied(role: str, user_id: str | None, sql: str) -> str:
    with pytest.raises(RuntimeError) as error:
        _as(role, user_id, sql)
    return str(error.value)


def _migrated(schema: str) -> str:
    return (SQL.replace("public.", f"{schema}.")
               .replace("'public'", f"'{schema}'")
               .replace("IN SCHEMA public", f"IN SCHEMA {schema}")
               .replace("search_path = public,", f"search_path = {schema},"))


def _client_definers(schema: str) -> str:
    return psql(f"""SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                    WHERE n.nspname = '{schema}' AND p.prosecdef
                      AND (has_function_privilege('anon', p.oid, 'EXECUTE')
                           OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))""")


def _client_default_writes(schema: str) -> str:
    return psql(f"""SELECT count(*) FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
                    WHERE d.defaclnamespace = '{schema}'::regnamespace
                      AND pg_get_userbyid(a.grantee) IN ('anon', 'authenticated')
                      AND ((d.defaclobjtype = 'r' AND a.privilege_type <> 'SELECT')
                           OR (d.defaclobjtype = 'S' AND a.privilege_type = 'UPDATE'))""")


@pytest.fixture(scope="module")
def db():
    try:
        available = shutil.which("psql") and psql("SELECT 1") == "1"
    except Exception:
        available = False
    if not available:
        if os.environ.get("REQUIRE_PG") == "1":
            pytest.fail("Local PostgreSQL required for migration 320 verification")
        pytest.skip("Local PostgreSQL unavailable")
    if psql("SELECT usesuper FROM pg_user WHERE usename=current_user") != "t":
        pytest.skip("migration 320 probe needs a superuser to SET ROLE")

    schema = "client_write_lockdown_" + uuid4().hex
    student, other = str(uuid4()), str(uuid4())
    created_admin = psql("SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='supabase_admin')") == "t"
    created_uid = psql("SELECT to_regprocedure('auth.uid()') IS NULL") == "t"
    psql("""DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='supabase_admin') THEN CREATE ROLE supabase_admin; END IF;
    END $$;""")
    if created_uid:
        # Supabase's auth.uid(): the JWT `sub` claim PostgREST puts in the GUCs.
        psql("""CREATE SCHEMA IF NOT EXISTS auth;
                CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
                  SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.sub', true), ''),
                                  NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
                $$;
                GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
                GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;""")
    own = "USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid())"
    generic = {"flashcard_stacks", "flashcard_cards"}
    learner_ddl = "\n".join(
        f"CREATE TABLE {schema}.{t} (id UUID PRIMARY KEY DEFAULT gen_random_uuid(),"
        f" user_id UUID NOT NULL, note TEXT);" for t in sorted(generic))
    definers = "\n".join(
        f"""CREATE FUNCTION {schema}.{name}() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
              SET search_path = {schema}, pg_temp AS $$
              BEGIN NEW.note := COALESCE(NEW.note, '') || '+{name}'; RETURN NEW; END $$;"""
        for name in F14_DEFINERS)
    try:
        psql(f"""
            CREATE SCHEMA {schema};
            GRANT USAGE ON SCHEMA {schema} TO anon, authenticated, service_role;
            GRANT USAGE, CREATE ON SCHEMA {schema} TO supabase_admin;
            -- Supabase's schema defaults (owner postgres, plus supabase_admin):
            -- every new table/sequence/function is client-writable/executable.
            ALTER DEFAULT PRIVILEGES IN SCHEMA {schema}
                GRANT ALL ON TABLES TO anon, authenticated, service_role;
            ALTER DEFAULT PRIVILEGES IN SCHEMA {schema}
                GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
            ALTER DEFAULT PRIVILEGES IN SCHEMA {schema}
                GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
            ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA {schema}
                GRANT ALL ON TABLES TO anon, authenticated, service_role;
            ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA {schema}
                GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
            CREATE TABLE {schema}.users (
                id UUID PRIMARY KEY, email TEXT, role TEXT NOT NULL DEFAULT 'user',
                is_active BOOLEAN NOT NULL DEFAULT FALSE, permissions TEXT[],
                feature_flags JSONB NOT NULL DEFAULT '{{}}', access_code_used TEXT,
                display_name VARCHAR(100), target_band NUMERIC(2,1), exam_date DATE,
                self_level VARCHAR(20), preferred_topics TEXT[], onboarding_completed BOOLEAN,
                timezone VARCHAR(50), weekly_goal INTEGER, notification_email BOOLEAN,
                updated_at TIMESTAMPTZ);
            ALTER TABLE {schema}.users ENABLE ROW LEVEL SECURITY;
            CREATE POLICY "Users can view own data" ON {schema}.users FOR SELECT USING (auth.uid() = id);
            -- Dashboard-created on staging: roles {{public}}, no WITH CHECK.
            CREATE POLICY "Users can update own data" ON {schema}.users FOR UPDATE USING (auth.uid() = id);
            CREATE POLICY service ON {schema}.users TO service_role USING (TRUE) WITH CHECK (TRUE);
            CREATE TABLE {schema}.sessions (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL,
                status TEXT NOT NULL DEFAULT 'in_progress', overall_band NUMERIC(2,1));
            CREATE TABLE {schema}.responses (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(), session_id UUID,
                user_id UUID NOT NULL, overall_band NUMERIC(2,1));
            CREATE TABLE {schema}.quiz_sessions (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL,
                score INTEGER);
            CREATE TABLE {schema}.grammar_assignment_evidence (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL, note TEXT);
            CREATE VIEW {schema}.sessions_passthrough AS SELECT * FROM {schema}.sessions;
            {learner_ddl}
            CREATE TABLE {schema}.user_vocabulary (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL, note TEXT,
                is_archived BOOLEAN NOT NULL DEFAULT FALSE, is_pending BOOLEAN NOT NULL DEFAULT FALSE);
            CREATE TABLE {schema}.flashcard_reviews (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL, note TEXT,
                vocabulary_id UUID, interval_days INTEGER, ease_factor REAL,
                review_count INTEGER NOT NULL DEFAULT 0, lapse_count INTEGER NOT NULL DEFAULT 0,
                last_reviewed_at TIMESTAMPTZ, next_review_at TIMESTAMPTZ, updated_at TIMESTAMPTZ,
                UNIQUE (user_id, vocabulary_id));
            CREATE TABLE {schema}.flashcard_review_log (
                id BIGSERIAL PRIMARY KEY, user_id UUID NOT NULL, note TEXT);
            CREATE TABLE {schema}.user_d1_questions (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL,
                vocabulary_id UUID, target_answer TEXT NOT NULL, is_active BOOLEAN NOT NULL DEFAULT TRUE);
            CREATE TABLE {schema}.d1_sessions (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL,
                exercise_ids UUID[] NOT NULL DEFAULT '{{}}', exercise_snapshot JSONB,
                correct_count INTEGER NOT NULL DEFAULT 0, total_count INTEGER NOT NULL DEFAULT 1,
                status TEXT NOT NULL DEFAULT 'active', completed_at TIMESTAMPTZ);
            CREATE TABLE {schema}.vocabulary_exercise_attempts (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL,
                exercise_id UUID, exercise_type TEXT NOT NULL DEFAULT 'D1', user_answer TEXT,
                is_correct BOOLEAN, score REAL, feedback JSONB, session_id UUID,
                client_attempt_id UUID, post_processed_at TIMESTAMPTZ);
            {"".join(f'''
            ALTER TABLE {schema}.{t} ENABLE ROW LEVEL SECURITY;
            CREATE POLICY own ON {schema}.{t} {own};'''
                     for t in ("sessions", "responses", "quiz_sessions", "grammar_assignment_evidence",
                               "user_d1_questions", "d1_sessions", "vocabulary_exercise_attempts",
                               *LEARNER_TABLES))}
            {definers}
            CREATE TRIGGER guard_selection BEFORE INSERT ON {schema}.user_vocabulary
                FOR EACH ROW EXECUTE FUNCTION {schema}.advanced_vocab_guard_selection();
            CREATE TRIGGER guard_evidence BEFORE INSERT ON {schema}.grammar_assignment_evidence
                FOR EACH ROW EXECUTE FUNCTION {schema}.guard_grammar_assignment_evidence_write();
            -- The retired learner-JWT finalize RPC (211) with its explicit grant.
            CREATE FUNCTION {schema}.fn_finalize_d1_attempt(uuid, uuid, integer, real, integer,
                timestamptz, timestamptz, jsonb) RETURNS JSONB LANGUAGE sql AS $$ SELECT '{{}}'::jsonb $$;
            GRANT EXECUTE ON FUNCTION {schema}.fn_finalize_d1_attempt(uuid, uuid, integer, real, integer,
                timestamptz, timestamptz, jsonb) TO authenticated;
            INSERT INTO {schema}.users (id, email) VALUES ('{student}', 's@example.test'),
                                                          ('{other}', 'o@example.test');
            INSERT INTO {schema}.responses (user_id, overall_band) VALUES ('{student}', 5.0);
            INSERT INTO {schema}.quiz_sessions (user_id, score) VALUES ('{student}', 3);
            INSERT INTO {schema}.d1_sessions (user_id, total_count) VALUES ('{student}', 10);
            INSERT INTO {schema}.user_d1_questions (user_id, target_answer)
                VALUES ('{student}', 'ephemeral'), ('{other}', 'ubiquitous');
        """)
        # Before 320 the probe reproduces the findings exactly.
        _as("authenticated", student, f"UPDATE {schema}.users SET role = 'admin' WHERE id = '{student}'")
        assert psql(f"SELECT role FROM {schema}.users WHERE id = '{student}'") == "admin"
        assert psql(f"SELECT has_column_privilege('anon', '{schema}.users', 'role', 'UPDATE')") == "t"
        _as("authenticated", student, f"UPDATE {schema}.d1_sessions SET correct_count = 10, status = 'completed'")
        assert psql(f"SELECT correct_count FROM {schema}.d1_sessions") == "10"
        assert _client_definers(schema) == str(len(F14_DEFINERS))
        assert int(_client_default_writes(schema)) > 0
        psql(f"UPDATE {schema}.users SET role = 'user'; UPDATE {schema}.d1_sessions"
             f" SET correct_count = 0, status = 'active'")

        psql(_migrated(schema))
        psql(_migrated(schema))  # forward re-application is safe
        yield {"schema": schema, "student": student, "other": other}
    finally:
        psql(f"DROP SCHEMA IF EXISTS {schema} CASCADE")
        if created_uid:
            psql("DROP FUNCTION IF EXISTS auth.uid(); DROP SCHEMA IF EXISTS auth")
        if created_admin:
            psql("DROP OWNED BY supabase_admin; DROP ROLE IF EXISTS supabase_admin")


def test_f01_student_cannot_escalate_role_or_activate(db):
    s, me = db["schema"], db["student"]
    for role in ("authenticated", "anon"):
        for change in ("role = 'admin'", "is_active = TRUE", "permissions = ARRAY['practice_full']",
                       "feature_flags = '{\"vocab_curated_enabled\": true}'", "access_code_used = 'X'",
                       "display_name = 'x'"):
            assert "permission denied" in _denied(role, me, f"UPDATE {s}.users SET {change} WHERE id = '{me}'")
    for statement in (f"INSERT INTO {s}.users (id, role) VALUES (gen_random_uuid(), 'admin')",
                      f"DELETE FROM {s}.users WHERE id = '{me}'"):
        assert "permission denied" in _denied("authenticated", me, statement)
    assert psql(f"SELECT role || ':' || is_active FROM {s}.users WHERE id = '{me}'") == "user:false"


def test_users_update_policy_is_authenticated_only_with_check(db):
    s = db["schema"]
    assert psql(f"""SELECT roles::text || ':' || (with_check IS NOT NULL)::text FROM pg_policies
                    WHERE schemaname = '{s}' AND policyname = 'Users can update own data'""") \
        == "{authenticated}:true"


def test_f01_definer_wrapper_called_with_client_jwt_is_still_blocked(db):
    s, me = db["schema"], db["student"]
    psql(f"""CREATE FUNCTION {s}.promote(p UUID) RETURNS VOID LANGUAGE sql
             SECURITY DEFINER AS $$ UPDATE {s}.users SET role = 'admin' WHERE id = p $$;
             GRANT EXECUTE ON FUNCTION {s}.promote(UUID) TO authenticated;""")
    try:
        assert "users_privileged_column_change_forbidden" in _denied(
            "authenticated", me, f"SELECT {s}.promote('{me}')")
        assert psql(f"SELECT role FROM {s}.users WHERE id = '{me}'") == "user"
        # …and such a function is exactly what the F14 postcondition refuses.
        with pytest.raises(RuntimeError) as error:
            psql(_migrated(s))
        assert "client_executable_privileged_function" in str(error.value)
    finally:
        psql(f"DROP FUNCTION {s}.promote(UUID)")


def test_profile_update_runs_through_service_role_only(db):
    """PATCH /auth/profile writes with supabase_admin (service_role)."""
    s, me = db["schema"], db["student"]
    _as("service_role", None, f"UPDATE {s}.users SET display_name = 'Lan', target_band = 7.0,"
                              f" weekly_goal = 5, timezone = 'Asia/Ho_Chi_Minh' WHERE id = '{me}'")
    assert psql(f"SELECT display_name || ':' || target_band FROM {s}.users WHERE id = '{me}'") == "Lan:7.0"
    assert "permission denied" in _denied("authenticated", me,
                                          f"UPDATE {s}.users SET weekly_goal = 999 WHERE id = '{me}'")


def test_service_role_and_owner_keep_managing_privileges(db):
    s, me = db["schema"], db["student"]
    _as("service_role", None, f"UPDATE {s}.users SET is_active = TRUE, permissions = ARRAY['practice_full'],"
                              f" role = 'instructor' WHERE id = '{me}'")
    psql(f"UPDATE {s}.users SET role = 'user', is_active = FALSE WHERE id = '{me}'")
    assert psql(f"SELECT role || ':' || is_active FROM {s}.users WHERE id = '{me}'") == "user:false"
    assert psql(f"SELECT has_table_privilege('service_role', '{s}.sessions', 'INSERT, UPDATE, DELETE')") == "t"


def test_f03_student_cannot_rewrite_scores(db):
    s, me = db["schema"], db["student"]
    for statement in (f"UPDATE {s}.responses SET overall_band = 9.0 WHERE user_id = '{me}'",
                      f"UPDATE {s}.quiz_sessions SET score = 100 WHERE user_id = '{me}'",
                      f"INSERT INTO {s}.responses (user_id, overall_band) VALUES ('{me}', 9.0)",
                      f"DELETE FROM {s}.responses WHERE user_id = '{me}'"):
        assert "permission denied" in _denied("authenticated", me, statement)
    assert psql(f"SELECT overall_band FROM {s}.responses WHERE user_id = '{me}'") == "5.0"


def test_f03_d1_results_are_server_written(db):
    s, me = db["schema"], db["student"]
    for statement in (
            f"UPDATE {s}.d1_sessions SET correct_count = 10, status = 'completed', completed_at = now()",
            f"UPDATE {s}.d1_sessions SET total_count = 1",
            f"INSERT INTO {s}.d1_sessions (user_id, total_count, correct_count) VALUES ('{me}', 1, 1)",
            f"DELETE FROM {s}.d1_sessions",
            f"INSERT INTO {s}.vocabulary_exercise_attempts (user_id, is_correct, score)"
            f" VALUES ('{me}', TRUE, 1.0)",
            f"UPDATE {s}.vocabulary_exercise_attempts SET is_correct = TRUE, score = 1, feedback = '{{}}'",
            f"UPDATE {s}.user_d1_questions SET target_answer = 'x' WHERE user_id = '{me}'",
            f"INSERT INTO {s}.user_d1_questions (user_id, target_answer) VALUES ('{me}', 'x')",
            f"DELETE FROM {s}.user_d1_questions WHERE user_id = '{me}'"):
        assert "permission denied" in _denied("authenticated", me, statement), statement
    # Reads stay on the learner JWT under RLS.
    assert _last("authenticated", me, f"SELECT count(*) FROM {s}.d1_sessions") == "1"
    assert _last("authenticated", db["other"], f"SELECT count(*) FROM {s}.d1_sessions") == "0"
    assert psql(f"SELECT correct_count || ':' || status FROM {s}.d1_sessions") == "0:active"


def test_learner_may_only_toggle_own_d1_question_activity(db):
    s, me, other = db["schema"], db["student"], db["other"]
    _as("authenticated", me, f"UPDATE {s}.user_d1_questions SET is_active = FALSE")
    assert psql(f"SELECT string_agg(target_answer || ':' || is_active, ',' ORDER BY target_answer)"
                f" FROM {s}.user_d1_questions") == "ephemeral:false,ubiquitous:true"
    _as("authenticated", me, f"UPDATE {s}.user_d1_questions SET is_active = TRUE")


def test_d1_finalize_runs_only_as_service_role_for_the_named_user(db):
    s, me, other = db["schema"], db["student"], db["other"]
    vocab = psql(f"INSERT INTO {s}.user_vocabulary (user_id) VALUES ('{me}') RETURNING id").splitlines()[0]
    attempt = _last("service_role", None, f"INSERT INTO {s}.vocabulary_exercise_attempts"
                                          f" (user_id, is_correct, score) VALUES ('{me}', TRUE, 1)"
                                          f" RETURNING id")
    args = (f"'{attempt}', '{vocab}', 7, 2.5, 0, now(), now() + interval '7 days',"
            f" '{{\"is_correct\": true}}'::jsonb")
    for role in ("authenticated", "anon"):
        assert "permission denied" in _denied(
            role, me, f"SELECT {s}.fn_finalize_d1_attempt_for_user('{me}', {args})")
        assert "permission denied" in _denied(
            role, me, f"SELECT {s}.fn_finalize_d1_attempt('{attempt}', NULL, NULL, NULL, 0,"
                      f" NULL, NULL, NULL)")
    assert "D1 attempt not found" in _denied(
        "service_role", None, f"SELECT {s}.fn_finalize_d1_attempt_for_user('{other}', {args})")
    finalize = f"SELECT {s}.fn_finalize_d1_attempt_for_user('{me}', {args}) ->> 'finalized'"
    assert (_last("service_role", None, finalize), _last("service_role", None, finalize)) == ("true", "false")
    assert psql(f"SELECT review_count || ':' || interval_days FROM {s}.flashcard_reviews"
                f" WHERE vocabulary_id = '{vocab}'") == "1:7"
    assert psql(f"SELECT (feedback ->> 'is_correct') || ':' || (post_processed_at IS NOT NULL)"
                f" FROM {s}.vocabulary_exercise_attempts WHERE id = '{attempt}'") == "true:true"


def test_f04_unactivated_account_cannot_create_a_session(db):
    s, me = db["schema"], db["student"]
    for target in ("sessions", "sessions_passthrough"):
        assert "permission denied" in _denied(
            "authenticated", me, f"INSERT INTO {s}.{target} (user_id) VALUES ('{me}')")
    assert psql(f"SELECT count(*) FROM {s}.sessions") == "0"


def test_anon_writes_nothing(db):
    s = db["schema"]
    assert psql(f"""SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                    CROSS JOIN unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE']) p
                    WHERE n.nspname = '{s}' AND c.relkind IN ('r','v')
                      AND has_table_privilege('anon', c.oid, p)""") == "0"


def test_learner_practice_writes_keep_working_under_owner_rls(db):
    s, me, other = db["schema"], db["student"], db["other"]
    for table in LEARNER_TABLES:
        _as("authenticated", me, f"INSERT INTO {s}.{table} (user_id, note) VALUES ('{me}', 'a');"
                                 f" UPDATE {s}.{table} SET note = 'b' WHERE user_id = '{me}' AND note LIKE 'a%';"
                                 f" DELETE FROM {s}.{table} WHERE user_id = '{me}' AND note = 'b'")
        assert psql(f"SELECT count(*) FROM {s}.{table} WHERE note LIKE 'a%' OR note = 'b'") == "0"
        assert "row-level security" in _denied(
            "authenticated", me, f"INSERT INTO {s}.{table} (user_id) VALUES ('{other}')")
        assert "permission denied" in _denied("authenticated", me, f"TRUNCATE {s}.{table}")
        assert "permission denied" in _denied("anon", None, f"INSERT INTO {s}.{table} (user_id) VALUES ('{me}')")


def test_sequences_keep_nextval_but_lose_setval(db):
    s, me = db["schema"], db["student"]
    _as("authenticated", me, f"INSERT INTO {s}.flashcard_review_log (user_id) VALUES ('{me}')")
    for role in ("authenticated", "anon"):
        assert "permission denied" in _denied(
            role, me, f"SELECT setval('{s}.flashcard_review_log_id_seq', 1)")


def test_f14_definer_triggers_are_not_rpcs_but_still_fire(db):
    s, me = db["schema"], db["student"]
    assert _client_definers(s) == "0"
    for name in ("advanced_vocab_guard_selection", "guard_grammar_assignment_evidence_write"):
        for role in ("authenticated", "anon"):
            assert "permission denied" in _denied(role, me, f"SELECT {s}.{name}()")
    # Trigger firing does not check EXECUTE: the guard runs for the learner
    # JWT path and for the service-role path alike.
    _as("authenticated", me, f"INSERT INTO {s}.user_vocabulary (user_id, note) VALUES ('{me}', 'jwt')")
    _as("service_role", None, f"INSERT INTO {s}.grammar_assignment_evidence (user_id, note) VALUES ('{me}', 'svc')")
    assert psql(f"SELECT note FROM {s}.user_vocabulary WHERE note LIKE 'jwt%'") \
        == "jwt+advanced_vocab_guard_selection"
    assert psql(f"SELECT note FROM {s}.grammar_assignment_evidence") \
        == "svc+guard_grammar_assignment_evidence_write"


def test_default_acls_of_postgres_and_supabase_admin_grant_no_client_writes(db):
    s = db["schema"]
    assert _client_default_writes(s) == "0"
    # Both owners keep their SELECT and service_role defaults.
    assert psql(f"""SELECT string_agg(DISTINCT pg_get_userbyid(d.defaclrole)::text, ','
                                      ORDER BY pg_get_userbyid(d.defaclrole)::text)
                    FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
                    WHERE d.defaclnamespace = '{s}'::regnamespace AND d.defaclobjtype = 'r'
                      AND pg_get_userbyid(a.grantee) = 'authenticated'
                      AND a.privilege_type = 'SELECT'""") == "postgres,supabase_admin"


@pytest.mark.parametrize("owner", ["postgres", "supabase_admin"])
def test_objects_created_later_are_read_only_to_clients(db, owner):
    s = db["schema"]
    table = f"{s}.created_after_320_{owner}"
    psql(f"SET ROLE {owner}; CREATE TABLE {table} (id BIGSERIAL PRIMARY KEY)")
    assert psql(f"""SELECT has_table_privilege('authenticated', '{table}', 'SELECT')::text
                    || has_table_privilege('authenticated', '{table}', 'INSERT')::text
                    || has_table_privilege('anon', '{table}', 'UPDATE')::text
                    || has_table_privilege('service_role', '{table}', 'INSERT')::text
                    || has_sequence_privilege('authenticated', '{table}_id_seq', 'UPDATE')::text""") \
        == "truefalsefalsetruefalse"


def test_function_execute_defaults_are_unchanged(db):
    """Documented choice: new INVOKER RPCs stay callable; step 7 guards definers."""
    s = db["schema"]
    psql(f"CREATE FUNCTION {s}.created_after_320() RETURNS INT LANGUAGE sql AS $$ SELECT 1 $$")
    assert psql(f"SELECT has_function_privilege('authenticated', '{s}.created_after_320()', 'EXECUTE')") == "t"


def test_reapplying_restores_a_hand_regranted_default(db):
    s = db["schema"]
    psql(f"ALTER DEFAULT PRIVILEGES IN SCHEMA {s} GRANT INSERT ON TABLES TO authenticated")
    assert _client_default_writes(s) == "1"
    psql(_migrated(s))
    assert _client_default_writes(s) == "0"
