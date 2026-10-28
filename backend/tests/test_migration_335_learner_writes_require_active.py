"""Migration 335 (SEC-20261028-02, INACTIVEWRITE-0035): an inactive account
cannot write its Vocabulary/flashcard rows directly through PostgREST.

Migration 320 kept INSERT/UPDATE/DELETE for `authenticated` on the five
learner-owned Vocabulary/flashcard tables (plus UPDATE (is_active) on
user_d1_questions) because FastAPI writes them with the learner's JWT. Their
policies check only ownership, so `POST /rest/v1/user_vocabulary` worked for an
account FastAPI refuses with 403 (W-03). 335 adds one RESTRICTIVE policy per
write command that requires app_private.is_current_user_active().

The static half always runs and pins the migration to the learner-JWT write
surface that test_migration_320 derives from the routers. The PostgreSQL half
rebuilds the post-320 staging shape (grants and the permissive owner policies
read from the staging catalog on 2026-10-28), first proves the exploit there,
then applies 335 twice and proves inactive, NULL and missing-row accounts write
nothing while active learners, the invoker SRS RPC, service_role and reads keep
working; the rollback note reopens the hole (so the policies are what close it)
and the postcondition rejects any client-writable table without the check.

Set TEST_PG_URL to a LOCAL disposable cluster and REQUIRE_PG=1 to forbid skips.
"""

from __future__ import annotations

import os
import re
import shutil
from pathlib import Path
from uuid import uuid4

import pytest

import test_migration_320_client_write_lockdown as m320
from test_migration_240_core_attempt_evidence import psql

BACKEND = Path(__file__).resolve().parents[1]
MIGRATIONS = BACKEND / "migrations"
NAME = "335_learner_jwt_writes_require_active_account.sql"
SQL = (MIGRATIONS / NAME).read_text(encoding="utf-8")
CODE = m320._strip_sql_comments(SQL)
HELPER = "app_private.is_current_user_active()"
POLICIES = ("require_active_account_insert", "require_active_account_update",
            "require_active_account_delete")


def _learner_tables() -> list[set[str]]:
    return m320._array("learner_tables", CODE)


# ── Static contract ─────────────────────────────────────────────────────────

def test_one_transaction_with_lock_timeout_and_no_data_change():
    assert CODE.strip().startswith("BEGIN;") and CODE.strip().endswith("COMMIT;")
    assert "SET LOCAL lock_timeout = '5s';" in CODE
    for forbidden in (r"DELETE\s+FROM", r"^\s*TRUNCATE", r"^\s*UPDATE\s", r"INSERT\s+INTO",
                      r"ALTER\s+TABLE", r"\bGRANT\s+(?:INSERT|UPDATE|DELETE|ALL)\b"):
        assert not re.search(forbidden, CODE, re.M | re.I), forbidden


def test_covered_tables_are_exactly_the_learner_jwt_write_surface():
    declared = _learner_tables()
    assert len(declared) == 2 and declared[0] == declared[1], (
        "the precondition and the policy loop must declare the same tables")
    surface = set(m320._learner_writes())
    assert declared[0] == surface == m320._array("client_write_tables")[0] | set(m320.COLUMN_SCOPED), (
        f"learner-JWT write surface changed: migration={sorted(declared[0])} code={sorted(surface)}")


def test_helper_is_a_private_pinned_stable_definer_keyed_on_the_caller():
    fn = re.search(r"CREATE OR REPLACE FUNCTION app_private\.is_current_user_active\(\)(.*?)\$\$;",
                   CODE, re.S)
    assert fn, "helper must take no argument (it cannot be asked about another account)"
    body = fn.group(1)
    assert "LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''" in body
    assert re.search(r"COALESCE\(\s*\(SELECT u\.is_active FROM public\.users u WHERE u\.id = auth\.uid\(\)\),"
                     r"\s*FALSE\)", body), "missing row / NULL must count as inactive"
    # 320's postcondition forbids client-executable SECURITY DEFINER in public.
    assert "FUNCTION public." not in CODE
    assert "WHERE ns.nspname = 'public'" in m320.CODE and "p.prosecdef" in m320.CODE
    for stmt in (f"REVOKE ALL ON FUNCTION {HELPER} FROM PUBLIC;",
                 f"REVOKE ALL ON FUNCTION {HELPER} FROM anon;",
                 f"GRANT EXECUTE ON FUNCTION {HELPER} TO authenticated;",
                 "REVOKE ALL ON SCHEMA app_private FROM PUBLIC;",
                 "GRANT USAGE ON SCHEMA app_private TO authenticated;"):
        assert stmt in CODE, stmt


def test_policies_are_restrictive_per_write_command_and_evaluated_once_per_statement():
    once = f"(SELECT {HELPER})"
    assert f"' AS RESTRICTIVE FOR INSERT TO authenticated'\n                       ' WITH CHECK ({once})'" in CODE
    assert (f"' AS RESTRICTIVE FOR UPDATE TO authenticated'\n                       ' USING ({once})'"
            f"\n                       ' WITH CHECK ({once})'") in CODE
    assert f"' AS RESTRICTIVE FOR DELETE TO authenticated'\n                       ' USING ({once})'" in CODE
    assert "FOR SELECT" not in CODE and "FOR ALL" not in CODE, "reads stay unchanged"
    assert "PERMISSIVE" not in CODE, "the owner policies are not rewritten"


def test_postconditions_cover_every_client_writable_table():
    post = CODE[CODE.rindex("DO $$"):]
    for marker in ("active_helper_missing", "active_helper_not_pinned_stable_security_definer",
                   "active_helper_executable_by_anon", "active_helper_not_executable_by_authenticated",
                   "active_helper_owner_subject_to_users_rls",
                   "client_write_without_active_account_check"):
        assert marker in post
    # Catalog-driven, not list-driven: any table authenticated can write counts.
    assert "has_any_column_privilege('authenticated', c.oid, priv)" in post
    assert "has_table_privilege('authenticated', c.oid, priv)" in post


def test_no_other_migration_drops_or_replaces_the_policies_or_helper():
    for path in sorted(MIGRATIONS.glob("*.sql")):
        if path.name == NAME:
            continue
        code = m320._strip_sql_comments(path.read_text(encoding="utf-8"))
        assert "is_current_user_active" not in code, path.name
        assert "require_active_account_" not in code, path.name


def test_fastapi_learner_jwt_write_routes_are_all_behind_the_activation_gate():
    """The policies must not break FastAPI: every route that writes these
    tables with the learner JWT already requires an active account."""
    from services.activation_gate import ACTIVATION_EXEMPT_ROUTES, STAFF_PATH_PREFIXES

    for method, path in ACTIVATION_EXEMPT_ROUTES:
        if path.startswith(("/api/flashcards", "/api/vocabulary/bank", "/api/exercises", "/api/dashboard")):
            assert method == "GET", f"exempt learner-JWT write route {method} {path}"
    for prefix in ("/api/flashcards", "/api/vocabulary/bank"):
        assert not prefix.startswith(STAFF_PATH_PREFIXES)


# ── PostgreSQL execution ────────────────────────────────────────────────────

_as, _last, _denied = m320._as, m320._last, m320._denied
WRITE_TABLES = ("user_vocabulary", "flashcard_stacks", "flashcard_cards",
                "flashcard_reviews", "flashcard_review_log")


def _migrated(schema: str, sql: str = SQL) -> str:
    return (sql.replace("app_private", f"{schema}_private")
               .replace("public.", f"{schema}.")
               .replace("'public'", f"'{schema}'"))


def _rollback(schema: str) -> str:
    note = SQL[SQL.index("-- Rollback"):SQL.index("-- (Leave the app_private")]
    body = "\n".join(line[3:] if line.startswith("-- ") else line[2:]
                     for line in note.splitlines()[2:])
    return _migrated(schema, body)


def _insert(s: str, table: str, user: str, ids: dict) -> str:
    return {
        "user_vocabulary": f"INSERT INTO {s}.user_vocabulary (user_id, headword) VALUES ('{user}', 'spam')",
        "flashcard_stacks": f"INSERT INTO {s}.flashcard_stacks (user_id, name) VALUES ('{user}', 'spam')",
        "flashcard_cards": f"INSERT INTO {s}.flashcard_cards (stack_id, vocabulary_id)"
                           f" VALUES ('{ids['stack']}', '{ids['vocab2']}')",
        "flashcard_reviews": f"INSERT INTO {s}.flashcard_reviews (user_id, vocabulary_id, interval_days)"
                             f" VALUES ('{user}', '{ids['vocab2']}', 1)",
        "flashcard_review_log": f"INSERT INTO {s}.flashcard_review_log (user_id, rating)"
                                f" VALUES ('{user}', 'good')",
    }[table]


def _rows(s: str, user: str) -> str:
    """Owner-visible fingerprint of every learner row of `user` (as superuser)."""
    return psql(f"""SELECT concat_ws('|',
        (SELECT string_agg(headword, ',' ORDER BY headword) FROM {s}.user_vocabulary WHERE user_id = '{user}'),
        (SELECT string_agg(name, ',' ORDER BY name) FROM {s}.flashcard_stacks WHERE user_id = '{user}'),
        (SELECT count(*) FROM {s}.flashcard_cards c JOIN {s}.flashcard_stacks st ON st.id = c.stack_id
          WHERE st.user_id = '{user}'),
        (SELECT string_agg(interval_days::text, ',') FROM {s}.flashcard_reviews WHERE user_id = '{user}'),
        (SELECT count(*) FROM {s}.flashcard_review_log WHERE user_id = '{user}'),
        (SELECT string_agg(is_active::text, ',') FROM {s}.user_d1_questions WHERE user_id = '{user}'))""")


def _seed(s: str, user: str) -> dict:
    """Rows created for `user` by the service role (e.g. before deactivation)."""
    vocab = psql(f"INSERT INTO {s}.user_vocabulary (user_id, headword) VALUES ('{user}', 'kept') RETURNING id")
    vocab2 = psql(f"INSERT INTO {s}.user_vocabulary (user_id, headword) VALUES ('{user}', 'kept2') RETURNING id")
    stack = psql(f"INSERT INTO {s}.flashcard_stacks (user_id, name) VALUES ('{user}', 'kept') RETURNING id")
    psql(f"INSERT INTO {s}.flashcard_cards (stack_id, vocabulary_id) VALUES ('{stack}', '{vocab}');"
         f" INSERT INTO {s}.flashcard_reviews (user_id, vocabulary_id, interval_days) VALUES ('{user}', '{vocab}', 3);"
         f" INSERT INTO {s}.flashcard_review_log (user_id, rating) VALUES ('{user}', 'easy');"
         f" INSERT INTO {s}.user_d1_questions (user_id, target_answer) VALUES ('{user}', 'kept')")
    return {"vocab": vocab, "vocab2": vocab2, "stack": stack}


def _try_every_write(s: str, user: str, ids: dict) -> None:
    """Every direct-REST write an account can attempt on its own rows."""
    for table in WRITE_TABLES:
        assert "row-level security" in _denied("authenticated", user, _insert(s, table, user, ids)), table
    assert "row-level security" in _denied("authenticated", user, f"SELECT {s}.srs_review('{ids['vocab2']}')")
    for sql in (f"UPDATE {s}.user_vocabulary SET headword = 'x' WHERE user_id = '{user}' RETURNING 1",
                f"UPDATE {s}.flashcard_stacks SET name = 'x' WHERE user_id = '{user}' RETURNING 1",
                f"UPDATE {s}.flashcard_cards SET vocabulary_id = vocabulary_id RETURNING 1",
                f"UPDATE {s}.flashcard_reviews SET interval_days = 99 WHERE user_id = '{user}' RETURNING 1",
                f"UPDATE {s}.user_d1_questions SET is_active = false WHERE user_id = '{user}' RETURNING 1",
                f"DELETE FROM {s}.user_vocabulary WHERE user_id = '{user}' RETURNING 1",
                f"DELETE FROM {s}.flashcard_stacks WHERE user_id = '{user}' RETURNING 1",
                f"DELETE FROM {s}.flashcard_cards RETURNING 1",
                f"DELETE FROM {s}.flashcard_reviews WHERE user_id = '{user}' RETURNING 1"):
        assert _as("authenticated", user, sql).splitlines()[1:] == [], sql


@pytest.fixture(scope="module")
def db():
    try:
        available = shutil.which("psql") and psql("SELECT 1") == "1"
    except Exception:
        available = False
    if not available:
        if os.environ.get("REQUIRE_PG") == "1":
            pytest.fail("Local PostgreSQL required for migration 335 verification")
        pytest.skip("Local PostgreSQL unavailable")
    if psql("SELECT usesuper FROM pg_user WHERE usename=current_user") != "t":
        pytest.skip("migration 335 probe needs a superuser to SET ROLE")

    s = "learner_active_" + uuid4().hex[:20]
    active, inactive, unset, ghost = (str(uuid4()) for _ in range(4))
    created_uid = psql("SELECT to_regprocedure('auth.uid()') IS NULL") == "t"
    psql("""DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
    END $$;""")
    psql("ALTER ROLE service_role BYPASSRLS")
    if created_uid:
        psql("""CREATE SCHEMA IF NOT EXISTS auth;
                CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
                  SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.sub', true), ''),
                                  NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
                $$;
                GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
                GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;""")
    own = "(auth.uid() = user_id)"
    owns_stack = (f"(EXISTS (SELECT 1 FROM {s}.flashcard_stacks st"
                  f" WHERE st.id = flashcard_cards.stack_id AND st.user_id = auth.uid()))")
    try:
        # Post-320 staging shape (pg_policies / privileges read 2026-10-28).
        psql(f"""
            CREATE SCHEMA {s};
            GRANT USAGE ON SCHEMA {s} TO anon, authenticated, service_role;
            CREATE TABLE {s}.users (id UUID PRIMARY KEY, is_active BOOLEAN DEFAULT FALSE);
            ALTER TABLE {s}.users ENABLE ROW LEVEL SECURITY;
            CREATE POLICY "Users can read own data" ON {s}.users FOR SELECT USING (auth.uid() = id);
            CREATE TABLE {s}.user_vocabulary (id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID NOT NULL, headword TEXT NOT NULL, ipa TEXT);
            CREATE TABLE {s}.flashcard_stacks (id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID NOT NULL, name TEXT NOT NULL);
            CREATE TABLE {s}.flashcard_cards (id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                stack_id UUID NOT NULL REFERENCES {s}.flashcard_stacks(id) ON DELETE CASCADE,
                vocabulary_id UUID NOT NULL REFERENCES {s}.user_vocabulary(id) ON DELETE CASCADE);
            CREATE TABLE {s}.flashcard_reviews (id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID NOT NULL, vocabulary_id UUID, interval_days INTEGER,
                UNIQUE (user_id, vocabulary_id));
            CREATE TABLE {s}.flashcard_review_log (id BIGSERIAL PRIMARY KEY,
                user_id UUID NOT NULL, rating TEXT NOT NULL);
            CREATE TABLE {s}.user_d1_questions (id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID NOT NULL, target_answer TEXT NOT NULL, is_active BOOLEAN NOT NULL DEFAULT TRUE);
            {"".join(f"ALTER TABLE {s}.{t} ENABLE ROW LEVEL SECURITY;"
                     for t in (*WRITE_TABLES, "user_d1_questions"))}
            {"".join(f'''
            CREATE POLICY {t}_select ON {s}.{t} FOR SELECT USING {own};
            CREATE POLICY {t}_insert ON {s}.{t} FOR INSERT WITH CHECK {own};
            CREATE POLICY {t}_update ON {s}.{t} FOR UPDATE USING {own} WITH CHECK {own};
            CREATE POLICY {t}_delete ON {s}.{t} FOR DELETE USING {own};'''
                     for t in ("user_vocabulary", "flashcard_stacks", "flashcard_reviews"))}
            CREATE POLICY flashcard_review_log_select ON {s}.flashcard_review_log FOR SELECT USING {own};
            CREATE POLICY flashcard_review_log_insert ON {s}.flashcard_review_log FOR INSERT WITH CHECK {own};
            CREATE POLICY flashcard_cards_select ON {s}.flashcard_cards FOR SELECT USING {owns_stack};
            CREATE POLICY flashcard_cards_insert ON {s}.flashcard_cards FOR INSERT WITH CHECK ({owns_stack}
                AND EXISTS (SELECT 1 FROM {s}.user_vocabulary v
                             WHERE v.id = flashcard_cards.vocabulary_id AND v.user_id = auth.uid()));
            CREATE POLICY flashcard_cards_update ON {s}.flashcard_cards FOR UPDATE
                USING {owns_stack} WITH CHECK {owns_stack};
            CREATE POLICY flashcard_cards_delete ON {s}.flashcard_cards FOR DELETE USING {owns_stack};
            CREATE POLICY "Users own their D1 questions" ON {s}.user_d1_questions
                USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
            GRANT SELECT ON ALL TABLES IN SCHEMA {s} TO anon, authenticated;
            GRANT ALL ON ALL TABLES IN SCHEMA {s} TO service_role;
            GRANT USAGE ON ALL SEQUENCES IN SCHEMA {s} TO authenticated, service_role;
            GRANT INSERT, UPDATE, DELETE ON {", ".join(f"{s}.{t}" for t in WRITE_TABLES)} TO authenticated;
            GRANT UPDATE (is_active) ON {s}.user_d1_questions TO authenticated;
            -- Stand-in for the SECURITY INVOKER fn_apply_srs_review_idempotent (212).
            CREATE FUNCTION {s}.srs_review(p_vocab UUID) RETURNS VOID LANGUAGE sql SECURITY INVOKER AS $$
                INSERT INTO {s}.flashcard_reviews (user_id, vocabulary_id, interval_days)
                VALUES (auth.uid(), p_vocab, 1)
                ON CONFLICT (user_id, vocabulary_id) DO UPDATE SET interval_days = EXCLUDED.interval_days + 1;
                INSERT INTO {s}.flashcard_review_log (user_id, rating) VALUES (auth.uid(), 'good');
            $$;
            REVOKE ALL ON FUNCTION {s}.srs_review(UUID) FROM PUBLIC;
            GRANT EXECUTE ON FUNCTION {s}.srs_review(UUID) TO authenticated;
            INSERT INTO {s}.users (id, is_active) VALUES ('{active}', TRUE), ('{inactive}', FALSE),
                                                         ('{unset}', NULL);
        """)
        ids = {user: _seed(s, user) for user in (active, inactive, unset, ghost)}

        # Before 335 the probe reproduces SEC-20261028-02.
        _as("authenticated", inactive, _insert(s, "user_vocabulary", inactive, ids[inactive]))
        _as("authenticated", inactive, f"SELECT {s}.srs_review('{ids[inactive]['vocab2']}')")
        _as("authenticated", inactive, f"UPDATE {s}.user_d1_questions SET is_active = false"
                                       f" WHERE user_id = '{inactive}'")
        assert psql(f"SELECT count(*) FROM {s}.user_vocabulary WHERE user_id = '{inactive}'"
                    f" AND headword = 'spam'") == "1"
        psql(f"DELETE FROM {s}.user_vocabulary WHERE headword = 'spam';"
             f" DELETE FROM {s}.flashcard_reviews WHERE vocabulary_id = '{ids[inactive]['vocab2']}';"
             f" DELETE FROM {s}.flashcard_review_log WHERE user_id = '{inactive}' AND rating = 'good';"
             f" UPDATE {s}.user_d1_questions SET is_active = true")

        psql(_migrated(s))
        psql(_migrated(s))  # forward re-application is safe
        yield {"schema": s, "active": active, "inactive": inactive, "unset": unset,
               "ghost": ghost, "ids": ids}
    finally:
        psql(f"DROP SCHEMA IF EXISTS {s} CASCADE; DROP SCHEMA IF EXISTS {s}_private CASCADE")
        if created_uid:
            psql("DROP FUNCTION IF EXISTS auth.uid(); DROP SCHEMA IF EXISTS auth")


@pytest.mark.parametrize("who", ["inactive", "unset", "ghost"])
def test_account_that_is_not_active_writes_nothing_through_rest(db, who):
    s, user, ids = db["schema"], db[who], db["ids"][db[who]]
    before = _rows(s, user)
    _try_every_write(s, user, ids)
    assert _rows(s, user) == before


def test_not_active_account_keeps_reading_its_own_rows(db):
    s, me = db["schema"], db["inactive"]
    assert _last("authenticated", me, f"SELECT count(*) FROM {s}.user_vocabulary") == "2"
    assert _last("authenticated", me, f"SELECT count(*) FROM {s}.flashcard_cards") == "1"


def test_active_learner_keeps_every_write_and_owner_rls(db):
    s, me, ids, other = db["schema"], db["active"], db["ids"][db["active"]], db["inactive"]
    for table in WRITE_TABLES:
        _as("authenticated", me, _insert(s, table, me, ids))
    _as("authenticated", me, f"SELECT {s}.srs_review('{ids['vocab2']}')")
    assert _last("authenticated", me, f"SELECT interval_days FROM {s}.flashcard_reviews"
                                      f" WHERE vocabulary_id = '{ids['vocab2']}'") == "2"
    assert _as("authenticated", me, f"UPDATE {s}.user_d1_questions SET is_active = false"
                                    f" WHERE user_id = '{me}' RETURNING 1").splitlines()[1:] == ["1"]
    assert _as("authenticated", me, f"UPDATE {s}.user_vocabulary SET headword = 'spam2'"
                                    f" WHERE headword = 'spam' RETURNING 1").splitlines()[1:] == ["1"]
    assert _as("authenticated", me, f"DELETE FROM {s}.flashcard_stacks WHERE name = 'spam'"
                                    f" RETURNING 1").splitlines()[1:] == ["1"]
    assert _as("authenticated", me, f"DELETE FROM {s}.user_vocabulary WHERE headword = 'spam2'"
                                    f" RETURNING 1").splitlines()[1:] == ["1"]
    # Ownership checks are untouched: still no write for another account.
    assert "row-level security" in _denied(
        "authenticated", me, f"INSERT INTO {s}.user_vocabulary (user_id, headword) VALUES ('{other}', 'x')")
    assert _as("authenticated", me, f"DELETE FROM {s}.user_vocabulary WHERE user_id = '{other}'"
                                    f" RETURNING 1").splitlines()[1:] == []
    psql(f"UPDATE {s}.user_d1_questions SET is_active = true;"
         f" DELETE FROM {s}.flashcard_reviews WHERE vocabulary_id = '{ids['vocab2']}';"
         f" DELETE FROM {s}.flashcard_review_log WHERE user_id = '{me}' AND rating = 'good'")


def test_activation_change_takes_effect_on_the_next_statement(db):
    s, me, ids = db["schema"], db["active"], db["ids"][db["active"]]
    try:
        psql(f"UPDATE {s}.users SET is_active = false WHERE id = '{me}'")
        _try_every_write(s, me, ids)
        psql(f"UPDATE {s}.users SET is_active = true WHERE id = '{me}'")
        _as("authenticated", me, _insert(s, "user_vocabulary", me, ids))
    finally:
        psql(f"UPDATE {s}.users SET is_active = true WHERE id = '{me}';"
             f" DELETE FROM {s}.user_vocabulary WHERE headword = 'spam'")


def test_service_role_still_writes_for_an_inactive_account(db):
    s, me = db["schema"], db["inactive"]
    _as("service_role", None, f"INSERT INTO {s}.user_vocabulary (user_id, headword) VALUES ('{me}', 'svc');"
                              f" UPDATE {s}.user_vocabulary SET ipa = '/s/' WHERE headword = 'svc';"
                              f" DELETE FROM {s}.user_vocabulary WHERE headword = 'svc'")
    assert psql(f"SELECT count(*) FROM {s}.user_vocabulary WHERE headword = 'svc'") == "0"


def test_helper_answers_only_for_the_caller_and_is_not_an_anon_rpc(db):
    s = db["schema"]
    fn = f"{s}_private.is_current_user_active()"
    assert _last("authenticated", db["active"], f"SELECT {fn}") == "t"
    assert _last("authenticated", db["inactive"], f"SELECT {fn}") == "f"
    assert _last("authenticated", db["unset"], f"SELECT {fn}") == "f"
    assert _last("authenticated", db["ghost"], f"SELECT {fn}") == "f"
    assert "permission denied" in _denied("anon", None, f"SELECT {fn}")
    assert psql(f"SELECT has_function_privilege('anon', '{fn}', 'EXECUTE')") == "f"
    assert psql(f"SELECT proconfig::text FROM pg_proc WHERE oid = '{fn}'::regprocedure") == '{"search_path=\\"\\""}'


def test_every_learner_table_has_the_three_restrictive_policies(db):
    s = db["schema"]
    got = psql(f"""SELECT string_agg(tablename || ':' || cmd, ',' ORDER BY tablename, cmd) FROM pg_policies
                   WHERE schemaname = '{s}' AND permissive = 'RESTRICTIVE'
                     AND roles = ARRAY['authenticated']::name[]""")
    want = sorted(f"{t}:{c}" for t in (*WRITE_TABLES, "user_d1_questions") for c in ("DELETE", "INSERT", "UPDATE"))
    assert got.split(",") == want


def test_rollback_note_reopens_the_hole_and_reapply_closes_it(db):
    s, me, ids = db["schema"], db["inactive"], db["ids"][db["inactive"]]
    try:
        psql(_rollback(s))
        assert psql(f"SELECT to_regprocedure('{s}_private.is_current_user_active()') IS NULL") == "t"
        _as("authenticated", me, _insert(s, "user_vocabulary", me, ids))
        psql(f"DELETE FROM {s}.user_vocabulary WHERE headword = 'spam'")
    finally:
        psql(_migrated(s))
    _try_every_write(s, me, ids)


def test_postcondition_rejects_a_client_writable_table_without_the_check(db):
    s = db["schema"]
    try:
        psql(f"CREATE TABLE {s}.new_learner_table (id INT, user_id UUID);"
             f" ALTER TABLE {s}.new_learner_table ENABLE ROW LEVEL SECURITY;"
             f" GRANT INSERT ON {s}.new_learner_table TO authenticated")
        with pytest.raises(RuntimeError, match="client_write_without_active_account_check: new_learner_table:INSERT"):
            psql(_migrated(s))
        psql(f"REVOKE INSERT ON {s}.new_learner_table FROM authenticated;"
             f" GRANT UPDATE (user_id) ON {s}.new_learner_table TO authenticated")
        with pytest.raises(RuntimeError, match="new_learner_table:UPDATE"):
            psql(_migrated(s))
    finally:
        psql(f"DROP TABLE IF EXISTS {s}.new_learner_table")
    psql(_migrated(s))


def test_reapply_revokes_a_hand_granted_anon_execute(db):
    s = db["schema"]
    fn = f"{s}_private.is_current_user_active()"
    psql(f"GRANT EXECUTE ON FUNCTION {fn} TO anon")
    psql(_migrated(s))
    assert psql(f"SELECT has_function_privilege('anon', '{fn}', 'EXECUTE')") == "f"


def test_precondition_aborts_before_migration_320(db):
    s = db["schema"]
    try:
        psql(f"GRANT INSERT ON {s}.user_vocabulary TO anon")
        with pytest.raises(RuntimeError, match="migration_320_missing"):
            psql(_migrated(s))
    finally:
        psql(f"REVOKE INSERT ON {s}.user_vocabulary FROM anon")
