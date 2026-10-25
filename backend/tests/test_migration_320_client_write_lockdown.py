"""Migration 320: client roles cannot write privilege, score or session tables.

Staging security audit 2026-10-25:
  F01 — `authenticated` had table-wide UPDATE on public.users and the
        dashboard policy "Users can update own data" only checks the row, so
        PATCH /rest/v1/users?id=eq.<self> {"role": "admin"} escalated to admin.
  F03 — own-row write policies let a student rewrite their own scores/bands.
  F04 — an account that never redeemed an access code could INSERT a session
        directly and obtain AI grading.

The static half always runs and pins the contract between the migration and
the code that writes as `authenticated` (FastAPI's learner-JWT routers) or
could write as a client (the browser). The PostgreSQL half runs the real
migration in a disposable schema that mimics Supabase's default grants: it
first proves the exploit works there, then applies the migration twice and
proves each finding is closed while the learner-owned practice writes and the
service-role/owner paths still work.

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

USER_JWT_ROUTERS = ("flashcards.py", "vocabulary_bank.py", "exercises.py")
# Learner-JWT RPCs (SECURITY INVOKER) and the tables they write.
INVOKER_RPC_TABLES = {
    "fn_apply_srs_review_idempotent": ("212_flashcard_review_idempotency.sql",
                                       {"flashcard_reviews", "flashcard_review_log"}),
    "fn_finalize_d1_attempt": ("211_d1_attempt_session_reliability.sql",
                               {"flashcard_reviews", "vocabulary_exercise_attempts"}),
}


def _strip_sql_comments(sql: str) -> str:
    sql = re.sub(r"/\*.*?\*/", "", sql, flags=re.S)
    return re.sub(r"--[^\n]*", "", sql)


CODE = _strip_sql_comments(SQL)


def _array(name: str, text: str = CODE) -> list[set[str]]:
    blocks = re.findall(name + r"\s+CONSTANT\s+TEXT\[\]\s*:=\s*ARRAY\[(.*?)\]", text, re.S)
    return [set(re.findall(r"'([a-z_0-9]+)'", block)) for block in blocks]


# ── Static contract ─────────────────────────────────────────────────────────

def _user_jwt_writes() -> set[str]:
    """Tables FastAPI writes with the learner's JWT (`_user_sb`)."""
    tables: set[str] = set()
    for name in USER_JWT_ROUTERS:
        source = (BACKEND / "routers" / name).read_text(encoding="utf-8")
        assert "def _user_sb" in source, f"{name} no longer defines _user_sb"
        for match in re.finditer(r"\bsb\s*\.\s*table\(\s*[\"']([a-z_0-9]+)[\"']\s*\)", source):
            chain = source[match.end():match.end() + 600].split(".execute()")[0]
            if re.search(r"\.(insert|update|upsert|delete)\(", chain):
                tables.add(match.group(1))
        for rpc in re.findall(r"\bsb\s*\.\s*rpc\(\s*[\"']([a-z_0-9]+)[\"']", source):
            assert rpc in INVOKER_RPC_TABLES, f"{name} calls unreviewed learner-JWT RPC {rpc}"
    for rpc, (migration, written) in INVOKER_RPC_TABLES.items():
        body = (BACKEND / "migrations" / migration).read_text(encoding="utf-8")
        assert "SECURITY DEFINER" not in _strip_sql_comments(body).upper(), (
            f"{rpc} became SECURITY DEFINER; its tables no longer need client grants")
        tables |= written
    return tables


def test_client_write_allowlist_is_exactly_the_learner_jwt_write_surface():
    allowlists = _array("client_write_tables")
    assert len(allowlists) == 2, "step 1 and the postcondition must both declare the allowlist"
    assert allowlists[0] == allowlists[1]
    detected = _user_jwt_writes()
    assert len(detected) >= 6, f"scanner found only {sorted(detected)} — regex broken?"
    assert allowlists[0] == detected, (
        "a learner-JWT write was added or removed; update migration 320's allowlist "
        f"deliberately. migration={sorted(allowlists[0])} code={sorted(detected)}")
    # F01/F03/F04 tables must never be on it.
    assert not allowlists[0] & {"users", "sessions", "responses", "access_codes",
                                "user_code_assignments", "students", "quiz_sessions"}


def test_users_column_grant_matches_patch_auth_profile():
    from routers.auth import ProfileUpdate

    grant = re.search(r"GRANT\s+UPDATE\s*\((.*?)\)\s*ON\s+public\.users\s+TO\s+authenticated",
                      CODE, re.S | re.I)
    assert grant, "missing column-level UPDATE grant on public.users"
    granted = {column.strip() for column in grant.group(1).split(",")}
    assert granted == set(ProfileUpdate.model_fields)
    trigger_safe, postcondition_safe = _array("profile_columns")
    assert trigger_safe - {"updated_at"} == granted
    assert postcondition_safe == granted
    privileged = {"role", "is_active", "permissions", "feature_flags", "access_code_used",
                  "email", "id"}
    assert not granted & privileged and not trigger_safe & privileged


def test_every_client_write_privilege_is_revoked_for_every_relation_kind():
    assert re.search(r"relkind\s+IN\s*\(\s*'r'\s*,\s*'p'\s*,\s*'v'\s*,\s*'m'\s*,\s*'f'\s*\)", CODE)
    statements = re.findall(r"REVOKE\s+(.*?)\s+ON\s+%s\s+FROM\s+([^']+)'", CODE, re.S)
    assert ("INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER", "PUBLIC, anon") in statements
    assert ("INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER", "authenticated") in statements
    assert ("TRUNCATE, REFERENCES, TRIGGER", "authenticated") in statements
    assert re.search(r"ALTER\s+DEFAULT\s+PRIVILEGES\s+IN\s+SCHEMA\s+public\s+REVOKE\s+INSERT,\s*"
                     r"UPDATE,\s*DELETE,\s*TRUNCATE,\s*REFERENCES,\s*TRIGGER\s+ON\s+TABLES\s+FROM\s+"
                     r"PUBLIC,\s*anon,\s*authenticated", CODE)
    # SELECT/RLS reads are out of scope and must stay untouched.
    assert not re.search(r"REVOKE[^;]*\bSELECT\b", CODE)
    assert "client_write_privilege_lockdown_incomplete" in CODE


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
                         r"(?:from\(\s*['\"`][a-z_]+['\"`]\s*\)|rpc\()")
    offenders = []
    for folder in ("app", "lib", "components", "public/js"):
        for path in (ROOT / "frontend" / folder).rglob("*"):
            if path.suffix not in {".ts", ".tsx", ".js", ".mjs"} or "node_modules" in path.parts:
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


def _denied(role: str, user_id: str | None, sql: str) -> str:
    with pytest.raises(RuntimeError) as error:
        _as(role, user_id, sql)
    return str(error.value)


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
    sub = "(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid"
    psql("""DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
    END $$;""")
    learner_ddl = "\n".join(
        f"CREATE TABLE {schema}.{table} (id UUID PRIMARY KEY DEFAULT gen_random_uuid(),"
        f" user_id UUID NOT NULL, note TEXT);"
        f" ALTER TABLE {schema}.{table} ENABLE ROW LEVEL SECURITY;"
        f" CREATE POLICY own ON {schema}.{table} USING (user_id = {sub}) WITH CHECK (user_id = {sub});"
        for table in LEARNER_TABLES)
    try:
        psql(f"""
            CREATE SCHEMA {schema};
            GRANT USAGE ON SCHEMA {schema} TO anon, authenticated, service_role;
            -- Supabase's schema default: every new table is fully client-writable.
            ALTER DEFAULT PRIVILEGES IN SCHEMA {schema}
                GRANT ALL ON TABLES TO anon, authenticated, service_role;
            CREATE TABLE {schema}.users (
                id UUID PRIMARY KEY, email TEXT, role TEXT NOT NULL DEFAULT 'user',
                is_active BOOLEAN NOT NULL DEFAULT FALSE, permissions TEXT[],
                feature_flags JSONB NOT NULL DEFAULT '{{}}', access_code_used TEXT,
                display_name VARCHAR(100), target_band NUMERIC(2,1), exam_date DATE,
                self_level VARCHAR(20), preferred_topics TEXT[], onboarding_completed BOOLEAN,
                timezone VARCHAR(50), weekly_goal INTEGER, notification_email BOOLEAN,
                updated_at TIMESTAMPTZ);
            ALTER TABLE {schema}.users ENABLE ROW LEVEL SECURITY;
            CREATE POLICY "Users can view own data" ON {schema}.users FOR SELECT USING (id = {sub});
            CREATE POLICY "Users can update own data" ON {schema}.users FOR UPDATE USING (id = {sub});
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
            {"".join(f'''
            ALTER TABLE {schema}.{t} ENABLE ROW LEVEL SECURITY;
            CREATE POLICY own ON {schema}.{t} USING (user_id = {sub}) WITH CHECK (user_id = {sub});'''
                     for t in ("sessions", "responses", "quiz_sessions"))}
            CREATE VIEW {schema}.sessions_passthrough AS SELECT * FROM {schema}.sessions;
            {learner_ddl}
            INSERT INTO {schema}.users (id, email) VALUES ('{student}', 's@example.test'),
                                                          ('{other}', 'o@example.test');
            INSERT INTO {schema}.responses (user_id, overall_band) VALUES ('{student}', 5.0);
            INSERT INTO {schema}.quiz_sessions (user_id, score) VALUES ('{student}', 3);
        """)
        # Before 320 the probe reproduces F01 exactly.
        _as("authenticated", student, f"UPDATE {schema}.users SET role = 'admin' WHERE id = '{student}'")
        assert psql(f"SELECT role FROM {schema}.users WHERE id = '{student}'") == "admin"
        psql(f"UPDATE {schema}.users SET role = 'user' WHERE id = '{student}'")

        migrated = (SQL.replace("public.", f"{schema}.")
                       .replace("'public'", f"'{schema}'")
                       .replace("IN SCHEMA public", f"IN SCHEMA {schema}")
                       .replace("search_path = public,", f"search_path = {schema},"))
        psql(migrated)
        psql(migrated)  # forward re-application is safe
        yield {"schema": schema, "student": student, "other": other}
    finally:
        psql(f"DROP SCHEMA IF EXISTS {schema} CASCADE")


def test_f01_student_cannot_escalate_role_or_activate(db):
    s, me = db["schema"], db["student"]
    for change in ("role = 'admin'", "is_active = TRUE", "permissions = ARRAY['practice_full']",
                   "feature_flags = '{\"vocab_curated_enabled\": true}'", "access_code_used = 'X'"):
        assert "permission denied" in _denied("authenticated", me, f"UPDATE {s}.users SET {change} WHERE id = '{me}'")
    # Mixing a privileged column into a profile PATCH is rejected as a whole.
    assert "permission denied" in _denied(
        "authenticated", me, f"UPDATE {s}.users SET display_name = 'x', role = 'admin' WHERE id = '{me}'")
    for statement in (f"INSERT INTO {s}.users (id, role) VALUES (gen_random_uuid(), 'admin')",
                      f"DELETE FROM {s}.users WHERE id = '{me}'"):
        assert "permission denied" in _denied("authenticated", me, statement)
    assert psql(f"SELECT role || ':' || is_active FROM {s}.users WHERE id = '{me}'") == "user:false"


def test_f01_definer_wrapper_called_with_client_jwt_is_still_blocked(db):
    s, me = db["schema"], db["student"]
    psql(f"""CREATE OR REPLACE FUNCTION {s}.promote(p UUID) RETURNS VOID LANGUAGE sql
             SECURITY DEFINER AS $$ UPDATE {s}.users SET role = 'admin' WHERE id = p $$;
             GRANT EXECUTE ON FUNCTION {s}.promote(UUID) TO authenticated;""")
    assert "users_privileged_column_change_forbidden" in _denied(
        "authenticated", me, f"SELECT {s}.promote('{me}')")
    assert psql(f"SELECT role FROM {s}.users WHERE id = '{me}'") == "user"


def test_profile_columns_stay_self_editable_and_row_scoped(db):
    s, me, other = db["schema"], db["student"], db["other"]
    _as("authenticated", me, f"UPDATE {s}.users SET display_name = 'Lan', target_band = 7.0,"
                             f" weekly_goal = 5, timezone = 'Asia/Ho_Chi_Minh' WHERE id = '{me}'")
    assert psql(f"SELECT display_name || ':' || target_band FROM {s}.users WHERE id = '{me}'") == "Lan:7.0"
    _as("authenticated", me, f"UPDATE {s}.users SET display_name = 'hijack' WHERE id = '{other}'")
    assert psql(f"SELECT display_name IS NULL FROM {s}.users WHERE id = '{other}'") == "t"


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
                                 f" UPDATE {s}.{table} SET note = 'b' WHERE user_id = '{me}';"
                                 f" DELETE FROM {s}.{table} WHERE user_id = '{me}'")
        assert "row-level security" in _denied(
            "authenticated", me, f"INSERT INTO {s}.{table} (user_id) VALUES ('{other}')")
        assert "permission denied" in _denied("authenticated", me, f"TRUNCATE {s}.{table}")
        assert "permission denied" in _denied("anon", None, f"INSERT INTO {s}.{table} (user_id) VALUES ('{me}')")


def test_tables_created_later_are_read_only_to_clients(db):
    s = db["schema"]
    psql(f"CREATE TABLE {s}.created_after_320 (id INT)")
    assert psql(f"""SELECT has_table_privilege('authenticated', '{s}.created_after_320', 'SELECT')::text
                    || has_table_privilege('authenticated', '{s}.created_after_320', 'INSERT')::text
                    || has_table_privilege('anon', '{s}.created_after_320', 'UPDATE')::text
                    || has_table_privilege('service_role', '{s}.created_after_320', 'INSERT')::text""") \
        == "truefalsefalsetrue"
