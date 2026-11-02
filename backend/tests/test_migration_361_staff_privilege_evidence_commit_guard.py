"""Migration 361 (PC-J358): forward hardening of the applied migration 341.

341 is applied on staging and must stay byte-identical to that file, so the
SA findings on #2180 ship here: a deferred commit guard on the evidence table
(P3-2), the audit consuming evidence by OLD.id (P3-7), the stricter
postconditions (SA-R4-1/2/3) and a pinned search_path with qualified array
operators (SA-2180-1).

The static half pins the 341 blob and the 361 text. The PostgreSQL half
reuses the 341 harness (NOSUPERUSER owner, Supabase default privileges, 322,
332, 336), applies 341, records it in a schema-local `_schema_migrations`
and applies 361 (twice). It proves both release paths (on top of an applied
341 with history, as on staging; back to back after 341, as on production),
the precondition and postcondition aborts, the operator-shadow repro, the
header rollback, and re-runs the 332, 336 and 341 behaviour suites on the
361 schema.

Set TEST_PG_URL to a LOCAL disposable cluster and REQUIRE_PG=1 to forbid skips.
"""

from __future__ import annotations

import hashlib
import inspect
import os
import re
import subprocess
from pathlib import Path
from uuid import uuid4

import pytest

import test_migration_240_core_attempt_evidence as m240
import test_migration_326_student_archive as m326
import test_migration_331_archived_student_give_guard as m331
import test_migration_332_staff_security_audit as m332
import test_migration_336_suspended_account_role_guard as m336
import test_migration_341_staff_guc_and_ai_override_hardening as m341
from test_migration_240_core_attempt_evidence import psql

BACKEND = Path(__file__).resolve().parents[1]
MIGRATIONS = BACKEND / "migrations"
NAME = "361_staff_privilege_evidence_commit_guard.sql"
SQL = (MIGRATIONS / NAME).read_text(encoding="utf-8")
CODE = m326._strip_comments(SQL)
NAME_341 = m341.NAME
# 341 as applied on staging 2026-11-02 06:40:15Z (origin/staging 5d84042ba).
APPLIED_341_BLOB = "91c3ed7a4aedfaa4830d27981b71354f519b918c"
APPLIED_341_SHA256 = "bc7027fb1df632ca59672c51829e82e7245fccf9d88324e66d91e87158b9551f"
OWNER = m332.OWNER
EVIDENCE = m341.EVIDENCE
GUARD_FN = "fn_staff_privilege_evidence_consumed"
GUARD_TRIGGER = "trg_staff_privilege_evidence_consumed"

_user, _state, _audit = m332._user, m332._state, m332._audit
_rpc, _rpc_sql, _suspend, _bootstrap_sql = m332._rpc, m332._rpc_sql, m332._suspend, m332._bootstrap_sql
_svc, _owner, _fails = m332._svc, m332._owner, m332._fails


def _do_blocks(code: str) -> list[str]:
    return re.findall(r"DO \$\$(.*?)END \$\$;", code, flags=re.S)


def _without_strings(code: str) -> str:
    return re.sub(r"'(?:[^']|'')*'", "''", code)


# ── Static contract ─────────────────────────────────────────────────────────

def test_341_is_byte_identical_to_the_blob_applied_on_staging():
    data = (MIGRATIONS / NAME_341).read_bytes()
    assert hashlib.sha256(data).hexdigest() == APPLIED_341_SHA256
    assert hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest() == APPLIED_341_BLOB


def test_one_transaction_with_pinned_search_path_lock_timeout_and_no_data_change():
    lines = [line for line in CODE.strip().splitlines() if line.strip()]
    assert lines[:3] == ["BEGIN;", "SET LOCAL search_path = pg_catalog, pg_temp;",
                         "SET LOCAL lock_timeout = '5s';"]
    assert lines[-1] == "COMMIT;" and CODE.count("BEGIN;") == 1 and CODE.count("COMMIT;") == 1
    top = m332._without_bodies(CODE)
    for forbidden in (r"\bDROP\b", r"DELETE\s+FROM", r"\bTRUNCATE\b", r"^\s*UPDATE\s", r"INSERT\s+INTO",
                      r"DISABLE\s+TRIGGER", r"session_replication_role", r"\bPOLICY\b", r"\bGRANT\b",
                      r"ALTER\s+(?:TABLE|FUNCTION|ROLE)"):
        assert not re.search(forbidden, top, re.M | re.I), forbidden


def test_do_blocks_qualify_catalog_functions_and_array_operators():
    """SA-R4-3 / SA-2180-1: defence in depth behind the pinned search_path."""
    listed = set(re.findall(r"'([a-z_]+)'", re.search(
        r"catalog_functions CONSTANT text\[\] := ARRAY\[(.*?)\];", CODE, re.S).group(1)))
    blocks = _do_blocks(CODE)
    assert len(blocks) == 3   # precondition, commit trigger, postcondition
    for block in blocks:
        bare = _without_strings(block)
        assert not re.search(r"(?<!OPERATOR\(pg_catalog\.)(\|\||@>)", bare), "unqualified || or @>"
        for name in listed:
            assert not re.search(rf"(?<![\w.]){name}\(", bare), name
        assert set(re.findall(r"pg_catalog\.([a-z_]+)\(", bare)) <= listed
    # The installed bodies call catalog functions unqualified at run time
    # (their search_path is pinned); the precondition still lists them.
    audit = m326._function(CODE, "fn_users_privilege_audit")
    for name in ("gen_random_uuid", "current_setting", "pg_current_xact_id", "jsonb_build_object"):
        assert f"{name}(" in audit and name in listed, name
    operators = re.search(r"catalog_operators CONSTANT text\[\] := ARRAY\[(.*?)\];", CODE, re.S).group(1)
    assert {"'||'", "'@>'", "'='", "'->>'"} <= set(re.findall(r"'[^']+'", operators))


def test_commit_guard_is_an_owner_only_definer_behind_a_deferred_constraint_trigger():
    fn = m326._function(CODE, GUARD_FN)
    assert "RETURNS trigger" in fn and "SECURITY DEFINER" in fn
    assert "SET search_path = pg_catalog, pg_temp" in fn
    assert "IF EXISTS (SELECT 1 FROM public.staff_privilege_evidence) THEN" in fn
    assert "RAISE EXCEPTION 'staff_privilege_evidence_not_consumed'" in fn
    assert (f"REVOKE ALL ON FUNCTION public.{GUARD_FN}() FROM PUBLIC, anon, authenticated, service_role;"
            in CODE)
    trigger = CODE[CODE.index(f"CREATE CONSTRAINT TRIGGER {GUARD_TRIGGER}"):]
    assert re.match(rf"CREATE CONSTRAINT TRIGGER {GUARD_TRIGGER}\s+AFTER INSERT ON "
                    rf"public\.{EVIDENCE}\s+DEFERRABLE INITIALLY DEFERRED\s+FOR EACH ROW "
                    rf"EXECUTE FUNCTION public\.{GUARD_FN}\(\);", trigger)
    guard = CODE[:CODE.index(f"CREATE CONSTRAINT TRIGGER {GUARD_TRIGGER}")]
    assert guard.rstrip().endswith(f"AND tgname = '{GUARD_TRIGGER}') THEN")


def test_audit_body_is_341s_consuming_evidence_by_old_id():
    old = m326._function(m326._strip_comments(m341.SQL), "fn_users_privilege_audit")
    new = m326._function(CODE, "fn_users_privilege_audit")
    key = "e.xact_id = pg_current_xact_id() AND e.target_user_id = {}.id"
    assert old.count(key.format("NEW")) == 1
    assert new == old.replace(key.format("NEW"), key.format("OLD"))
    assert ("REVOKE ALL ON FUNCTION public.fn_users_privilege_audit() "
            "FROM PUBLIC, anon, authenticated, service_role;") in CODE


def test_preconditions_come_first_and_cover_ledger_objects_shadowing_and_evidence():
    pre = _do_blocks(CODE)[0]
    assert CODE.index(pre) < CODE.index("CREATE OR REPLACE FUNCTION")
    for marker in ("migration_341_missing: no ledger row", "migration_341_missing: objects",
                   "catalog_name_shadowed_in_public", "staff_privilege_evidence_not_empty"):
        assert marker in pre, marker
    assert f"m.filename = '{NAME_341}'" in pre
    assert "p.pronamespace = 'public'::regnamespace" in pre
    assert "o.oprnamespace = 'public'::regnamespace" in pre


def test_postconditions_cover_341_and_361():
    post = _do_blocks(CODE)[-1]
    old = _do_blocks(m326._strip_comments(m341.SQL))[-1]
    for marker in set(re.findall(r"RAISE EXCEPTION '([a-z_0-9]+)", old)) | {
            "staff_privilege_evidence_commit_guard_wrong", "staff_privilege_audit_evidence_key_wrong",
            "users_client_role_privileges_wrong"}:
        assert f"RAISE EXCEPTION '{marker}" in post, marker
    assert "g.tgtype = 5 AND g.tgconstraint <> 0" in post
    assert "g.tgdeferrable AND g.tginitdeferred" in post
    assert "pg_catalog.pg_has_role('service_role'::name, m.oid, 'MEMBER')" in post
    assert "pg_catalog.has_any_column_privilege(m.oid, 'public.users', p.priv)" in post
    assert f"('public.{GUARD_FN}()', 'public.{EVIDENCE}')" in post   # owner check


def test_header_documents_release_order_known_gaps_and_a_grant_free_rollback():
    header = SQL[:SQL.index("\nBEGIN;\n")]
    for needle in ("341 is applied", "never edited", "P3-5", "P3-6", "DO NOT", "pg_dump --exclude-table-data",
                   "MIGRATION_FEATURES=admin_aal2", "after 341", "re-run 361 after it"):
        assert needle in header, needle
    note = header[header.index("-- ROLLBACK"):]
    assert "grants nothing" in note and not re.search(r"--\s+GRANT\b", note)
    body = _rollback_sql("public")
    assert f"DROP TRIGGER IF EXISTS {GUARD_TRIGGER} ON public.{EVIDENCE};" in body
    assert f"DROP FUNCTION IF EXISTS public.{GUARD_FN}();" in body
    assert "e.target_user_id = NEW.id" in body and "GRANT" not in body


def test_release_metadata_holds_361_behind_the_admin_aal2_group():
    policy = (MIGRATIONS / "forward-policy.tsv").read_text(encoding="utf-8")
    rows = {line.split("\t")[0]: line.split("\t") for line in policy.splitlines()
            if line and not line.startswith("#")}
    assert len(rows[NAME]) == 4 and rows[NAME][1:3] == ["pending_feature", "admin_aal2"]
    assert rows[NAME_341][1:3] == ["pending_feature", "admin_aal2"]
    readme = (MIGRATIONS / "README.md").read_text(encoding="utf-8")
    paragraph = readme[readme.index("Migration `361`"):readme.index("Migration `355`")]
    for needle in ("MIGRATION_FEATURES=admin_aal2", "after SA review", "after 341", "never",
                   "staff_privilege_evidence_not_consumed", "OLD.id", "catalog_name_shadowed_in_public"):
        assert needle in paragraph, needle


# ── PostgreSQL harness ──────────────────────────────────────────────────────

def _migrated(schema: str, sql: str = SQL) -> str:
    return m331._schema_sql(sql, schema)


def _postcondition_sql(schema: str) -> str:
    return m331._schema_sql(SQL[SQL.rindex("DO $$"):SQL.rindex("COMMIT;")], schema)


def _rollback_sql(schema: str) -> str:
    header = SQL[SQL.index("-- ROLLBACK"):SQL.index("\nBEGIN;\n")]
    lines = [line[5:] for line in header.splitlines() if line.startswith("--   ")]
    audit_341 = m326._function(m341.SQL, "fn_users_privilege_audit")
    text = "\n".join(lines).replace("-- <the 341 fn_users_privilege_audit block, verbatim>", audit_341)
    return m331._schema_sql(text, schema)


def _record(schema: str, filename: str = NAME_341) -> None:
    """The runner's ledger, schema-local (the harness maps public. to it)."""
    _owner(f"CREATE TABLE IF NOT EXISTS {schema}._schema_migrations ("
           f"filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()); "
           f"INSERT INTO {schema}._schema_migrations (filename) VALUES ('{filename}') "
           f"ON CONFLICT (filename) DO NOTHING;")


def _build(schema: str, *, with_341: bool = True, ledger: bool = True) -> None:
    m332._require_pg()
    m341._build(schema)
    if with_341:
        m341._apply(schema)
    if ledger:
        _record(schema)


def _apply(schema: str) -> None:
    _owner(_migrated(schema))


def _schema(prefix: str) -> str:
    schema = prefix + uuid4().hex
    _build(schema)
    _apply(schema)
    return schema


def _drop(schema: str | None) -> None:
    if schema:
        psql(f"DROP SCHEMA IF EXISTS {schema} CASCADE")


@pytest.fixture(scope="module")
def db():
    schema = None
    try:
        schema = _schema("ev361_")
        _apply(schema)   # re-applying is a no-op
        yield schema
    finally:
        _drop(schema)


@pytest.fixture
def fresh():
    schema = None
    try:
        schema = _schema("ev361_fresh_")
        yield schema
    finally:
        _drop(schema)


@pytest.fixture
def only_341():
    """341 applied and recorded, 361 not yet: the staging state today."""
    m332._require_pg()   # before the name exists, so a skip never reaches _drop
    schema = None
    try:
        schema = "ev361_pre_" + uuid4().hex
        _build(schema)
        yield schema
    finally:
        _drop(schema)


def _evidence_rows(s: str) -> str:
    return psql(f"SELECT count(*) FROM {s}.{EVIDENCE}")


def _guard_installed(s: str) -> bool:
    return psql(f"SELECT to_regprocedure('{s}.{GUARD_FN}()') IS NOT NULL") == "t"


def _audit_key(s: str) -> str:
    src = psql(f"SELECT prosrc FROM pg_proc WHERE oid = '{s}.fn_users_privilege_audit()'::regprocedure")
    return re.search(r"e\.target_user_id = (OLD|NEW)\.id", src).group(1)


def _catalog(s: str, *, oids: bool) -> list[str]:
    """Functions (definition + ACL), triggers and relation ACLs of a schema."""
    out = psql(f"""
        SELECT string_agg(x, E'\\n' ORDER BY x) FROM (
            SELECT 'fn ' || p.oid::regprocedure::text || ' ' || md5(replace(pg_get_functiondef(p.oid), '{s}', 'S'))
                   || ' ' || COALESCE(p.proacl::text, '-') || ' ' || pg_get_userbyid(p.proowner)
              FROM pg_proc p WHERE p.pronamespace = '{s}'::regnamespace
            UNION ALL
            SELECT 'tg ' || c.relname || ' ' || g.tgname || ' ' || g.tgenabled::text || ' ' || g.tgtype
                   || ' ' || g.tgdeferrable || g.tginitdeferred || ' ' || g.tgfoid::regprocedure::text
                   || CASE WHEN {str(oids).lower()} THEN ' ' || g.oid::text ELSE '' END
              FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid
             WHERE c.relnamespace = '{s}'::regnamespace AND NOT g.tgisinternal
            UNION ALL
            SELECT 'rel ' || c.relname || ' ' || COALESCE(c.relacl::text, '-') || ' ' || c.relrowsecurity
              FROM pg_class c WHERE c.relnamespace = '{s}'::regnamespace AND c.relname <> '_schema_migrations'
        ) t(x)""")
    return [line.replace(s, "S") for line in out.splitlines()]


def _psql_all(sql: str) -> tuple[int, str]:
    """psql that also returns NOTICE output, which psql() drops on success."""
    environment = {key: value for key, value in os.environ.items() if not key.startswith("PG")}
    environment["PGCONNECT_TIMEOUT"] = "3"
    result = subprocess.run(["psql", m240.DB, "-X", "-v", "ON_ERROR_STOP=1", "-tAq", "-c", sql],
                            capture_output=True, text=True, timeout=60, env=environment)
    return result.returncode, result.stdout + result.stderr


def _require_pg17() -> None:
    if psql("SELECT current_setting('server_version_num')::int >= 170000") != "t":
        pytest.skip("MAINTAIN is a PostgreSQL 17 privilege")


def test_harness_roles_are_nosuperuser():
    """SA P3-4: every role these suites switch to is NOSUPERUSER."""
    m332._require_pg()
    assert psql(f"SELECT count(*) FROM pg_roles WHERE rolname IN "
                f"('anon', 'authenticated', 'service_role', '{OWNER}') AND NOT rolsuper") == "4"


# ── PostgreSQL: the 332, 336 and 341 suites on the 361 schema ───────────────

# 341's own pre/postcondition and rollback tests drive the 341 file; 361 has
# its own below (341's not-empty drift case commits evidence, which 361
# forbids). 332's trigger-list catalog test predates 336.
_NOT_RERUN = {
    m332: {"test_catalog_after_apply_and_rerun"},
    m341: {"test_header_rollback_reopens_f1_and_341_reapplies"},
}


def _rerun(module, prefix: str) -> None:
    for name, fn in inspect.getmembers(module, inspect.isfunction):
        params = set(inspect.signature(fn).parameters)
        if (name.startswith("test_") and fn.__module__ == module.__name__
                and params & {"db", "fresh"} and name not in _NOT_RERUN.get(module, set())
                and not (module is m341 and name.startswith("test_postcondition_"))):
            globals()[f"test_{prefix}_{name[5:]}"] = fn


_rerun(m332, "rerun332")
_rerun(m336, "rerun336")
_rerun(m341, "rerun341")


# ── PostgreSQL: P3-2, the commit guard ──────────────────────────────────────

def test_negative_control_341_alone_commits_owner_planted_evidence(only_341):
    """Without 361 an owner-planted row survives its transaction (probe2)."""
    s = only_341
    _owner(f"INSERT INTO {s}.{EVIDENCE}(target_user_id, kind, audit_id) "
           f"VALUES (gen_random_uuid(), 'rpc', gen_random_uuid())")
    assert _evidence_rows(s) == "1"
    assert _audit_key(s) == "NEW"


def test_owner_planted_evidence_aborts_at_commit(db):
    s = db
    error = _fails(_owner, f"BEGIN; INSERT INTO {s}.{EVIDENCE}(target_user_id, kind, audit_id) "
                           f"VALUES (gen_random_uuid(), 'bootstrap', gen_random_uuid()); COMMIT;")
    assert "staff_privilege_evidence_not_consumed" in error
    assert _evidence_rows(s) == "0"


@pytest.mark.parametrize("rekey", [False, True])
def test_leftover_evidence_aborts_at_commit_after_an_unrelated_rpc(fresh, rekey):
    """SA probe2/P3-2: an owner-planted row must not survive the RPC's commit."""
    s = fresh
    admin, victim, other = (_user(s, role, True) for role in ("admin", "instructor", "instructor"))
    sql = f"""
        BEGIN;
        INSERT INTO {s}.{EVIDENCE}(target_user_id, kind, audit_id, actor_user_id, reason)
        VALUES ('{victim}', 'rpc', gen_random_uuid(), '{admin}', 'probe2 leftover');
        {_rpc_sql(s, admin, other, active=False, reason='routine suspend')};
        {f"UPDATE {s}.{EVIDENCE} SET target_user_id = gen_random_uuid(), xact_id = '1'::xid8;" if rekey else ''}
        DO $$ BEGIN
            ASSERT (SELECT count(*) FROM {s}.{EVIDENCE}) = 1, 'insert/RPC must finish before COMMIT';
        END $$;
        COMMIT;
    """
    assert "staff_privilege_evidence_not_consumed" in _fails(_owner, sql)
    assert _evidence_rows(s) == "0"
    assert _state(s, other)["is_active"] is True


def test_consumed_evidence_commits_with_a_deferred_owner_check(db):
    s = db
    admin, target = _user(s, "admin", True), _user(s, "instructor", True)
    _rpc(s, admin, target, active=False, reason="deferred check under service_role")
    assert _evidence_rows(s) == "0"
    assert _state(s, target)["is_active"] is False
    assert psql(f"SELECT tgdeferrable AND tginitdeferred FROM pg_trigger "
                f"WHERE tgrelid = '{s}.{EVIDENCE}'::regclass AND tgname = '{GUARD_TRIGGER}'") == "t"


def test_bootstrap_commits_with_the_commit_guard(fresh):
    s = fresh
    admin, target = _user(s, "admin", True), _user(s, "admin", True)
    _suspend(s, admin, target)
    _owner(f"UPDATE {s}.users SET is_active = false WHERE id = '{admin}'")
    audit_id = _owner(_bootstrap_sql(s, target))
    assert _audit(s, target)[-1]["id"] == audit_id and _evidence_rows(s) == "0"
    assert _state(s, target)["is_active"] is True


def test_no_api_role_can_execute_or_replace_the_commit_guard(db):
    s = db
    for role in ("anon", "authenticated", "service_role"):
        assert psql(f"SELECT has_function_privilege('{role}', '{s}.{GUARD_FN}()', 'EXECUTE')") == "f", role
    assert psql(f"SELECT prosecdef::text || '|' || array_to_string(proconfig, ';') || '|' || "
                f"pg_get_userbyid(proowner) FROM pg_proc WHERE oid = '{s}.{GUARD_FN}()'::regprocedure") == (
        f"true|search_path=pg_catalog, pg_temp|{OWNER}")
    assert "must be owner" in _fails(_svc, f"ALTER TABLE {s}.{EVIDENCE} DISABLE TRIGGER {GUARD_TRIGGER}")


# ── PostgreSQL: P3-7, OLD.id ────────────────────────────────────────────────

def test_audit_consumes_old_id_evidence_when_owner_changes_user_id(fresh):
    s = fresh
    target, replacement, audit_id = _user(s, "instructor", True), str(uuid4()), str(uuid4())
    _owner(f"""BEGIN;
        INSERT INTO {s}.{EVIDENCE}(target_user_id, kind, audit_id, operator)
        VALUES ('{target}', 'bootstrap', '{audit_id}', 'synthetic owner');
        UPDATE {s}.users SET id = '{replacement}', is_active = false WHERE id = '{target}';
        DO $$ BEGIN ASSERT NOT EXISTS (SELECT 1 FROM {s}.{EVIDENCE}); END $$;
        COMMIT;
    """)
    rows = _audit(s, replacement)
    assert len(rows) == 1 and rows[0]["id"] == audit_id
    assert rows[0]["event"] == "bootstrap_recovery"
    assert rows[0]["detail"] == {"operator": "synthetic owner"}


# ── PostgreSQL: release paths and idempotency ───────────────────────────────

def test_staging_path_applies_on_top_of_an_applied_341_with_history(only_341):
    """Staging: 341 ran earlier and the RPC/bootstrap have written audit rows."""
    s = only_341
    admin, target, other = _user(s, "admin", True), _user(s, "admin", True), _user(s, "instructor", True)
    _suspend(s, admin, target)
    _rpc(s, admin, other, role="student")
    _owner(f"UPDATE {s}.users SET is_active = false WHERE id = '{admin}'")
    _owner(_bootstrap_sql(s, target))
    history = psql(f"SELECT count(*) FROM {s}.staff_security_audit"), _state(s, target), _state(s, other)
    assert not _guard_installed(s) and _audit_key(s) == "NEW"

    _apply(s)
    assert _guard_installed(s) and _audit_key(s) == "OLD"
    assert (psql(f"SELECT count(*) FROM {s}.staff_security_audit"), _state(s, target), _state(s, other)) == history
    _owner(_postcondition_sql(s))
    snapshot = _catalog(s, oids=True)
    _apply(s)
    assert _catalog(s, oids=True) == snapshot, "second run must change nothing"
    assert _rpc(s, target, other, role="instructor")["changed"] is True and _evidence_rows(s) == "0"


def test_production_path_runs_341_then_361_back_to_back_and_matches_staging(only_341):
    """Production: one promotion runs 341, records it, then runs 361."""
    staging = only_341
    _apply(staging)
    schema = "ev361_prod_" + uuid4().hex
    try:
        _build(schema, with_341=False, ledger=False)
        assert psql(f"SELECT to_regclass('{schema}.{EVIDENCE}') IS NULL") == "t"
        _owner(f"{m341._migrated(schema)}\n"
               f"CREATE TABLE IF NOT EXISTS {schema}._schema_migrations (filename text PRIMARY KEY, "
               f"applied_at timestamptz NOT NULL DEFAULT now());\n"
               f"INSERT INTO {schema}._schema_migrations (filename) VALUES ('{NAME_341}');\n"
               f"{_migrated(schema)}")
        assert _guard_installed(schema) and _audit_key(schema) == "OLD"
        assert _catalog(schema, oids=False) == _catalog(staging, oids=False)
        snapshot = _catalog(schema, oids=True)
        _apply(schema)
        assert _catalog(schema, oids=True) == snapshot
    finally:
        _drop(schema)


def test_rerunning_341_after_361_is_caught_and_361_restores_old_id(fresh):
    s = fresh
    m341._apply(s)
    assert _audit_key(s) == "NEW" and _guard_installed(s)
    assert "staff_privilege_audit_evidence_key_wrong" in _fails(_owner, _postcondition_sql(s))
    _apply(s)
    assert _audit_key(s) == "OLD"
    _owner(_postcondition_sql(s))


# ── PostgreSQL: preconditions ───────────────────────────────────────────────

def _created_nothing(s: str) -> None:
    assert not _guard_installed(s)
    if psql(f"SELECT to_regprocedure('{s}.fn_users_privilege_audit()') IS NOT NULL") == "t" \
            and psql(f"SELECT to_regclass('{s}.{EVIDENCE}') IS NOT NULL") == "t":
        assert _audit_key(s) == "NEW"


@pytest.mark.parametrize("with_341,ledger,row,marker", [
    (True, False, False, "migration_341_missing: no ledger row"),
    (True, True, False, "migration_341_missing: no ledger row"),
    (False, True, True, "migration_341_missing: objects"),
])
def test_precondition_requires_341_recorded_and_applied(with_341, ledger, row, marker):
    m332._require_pg()
    schema = "ev361_noprereq_" + uuid4().hex
    try:
        _build(schema, with_341=with_341, ledger=False)
        if ledger:
            _record(schema, NAME_341 if row else "340_ai_budget_hardening.sql")
        assert marker in _fails(_owner, _migrated(schema))
        _created_nothing(schema)
    finally:
        _drop(schema)


def test_precondition_refuses_leftover_evidence(only_341):
    s = only_341
    _owner(f"INSERT INTO {s}.{EVIDENCE}(target_user_id, kind, audit_id) "
           f"VALUES (gen_random_uuid(), 'rpc', gen_random_uuid())")
    assert "staff_privilege_evidence_not_empty" in _fails(_owner, _migrated(s))
    _created_nothing(s)


def _plant_shadows(s: str, *, functions: bool = False) -> None:
    """A non-owner role with CREATE on the schema plants exact text[] array
    operators that hide drift (|| drops privileges, @> always matches) and
    leave a NOTICE when they run as the migration owner (SA-2180-1)."""
    _owner(f"GRANT CREATE ON SCHEMA {s} TO service_role")
    sql = f"""
        CREATE FUNCTION {s}.sa2180_cat(text[], text[]) RETURNS text[] LANGUAGE plpgsql AS $$
        BEGIN RAISE NOTICE 'attacker_operator_called % ||', current_user; RETURN ARRAY[]::text[]; END $$;
        CREATE FUNCTION {s}.sa2180_contains(text[], text[]) RETURNS boolean LANGUAGE plpgsql AS $$
        BEGIN RAISE NOTICE 'attacker_operator_called % @>', current_user; RETURN true; END $$;
        CREATE OPERATOR {s}.|| (LEFTARG = text[], RIGHTARG = text[], FUNCTION = {s}.sa2180_cat);
        CREATE OPERATOR {s}.@> (LEFTARG = text[], RIGHTARG = text[], FUNCTION = {s}.sa2180_contains);
    """
    if functions:
        sql += f"""
        CREATE FUNCTION {s}.has_table_privilege(text, text, text) RETURNS boolean LANGUAGE plpgsql AS $$
        BEGIN RAISE NOTICE 'attacker_function_called %', current_user; RETURN false; END $$;
        """
    _svc(sql)
    assert psql(f"SELECT pg_get_userbyid(oprowner) FROM pg_operator "
                f"WHERE oprnamespace = '{s}'::regnamespace AND oprname = '||'") == "service_role"


@pytest.mark.parametrize("path", ["{s}", "{s}, pg_catalog"])
def test_precondition_refuses_public_shadows_before_any_check_runs(only_341, path):
    s = only_341
    _plant_shadows(s, functions=True)
    rc, out = _psql_all(f"SET ROLE {OWNER}; SET search_path = {path.format(s=s)}; {_migrated(s)}")
    assert rc != 0 and "catalog_name_shadowed_in_public: function has_table_privilege" in out, out
    assert "operator @>" in out and "operator ||" in out
    assert "attacker_" not in out, out
    _created_nothing(s)


# ── PostgreSQL: postconditions ──────────────────────────────────────────────

_DRIFT = [
    ("GRANT TRIGGER ON {s}.users TO service_role",
     "REVOKE TRIGGER ON {s}.users FROM service_role", "users_service_role_privileges_wrong"),
    ("GRANT REFERENCES ON {s}.users TO service_role",
     "REVOKE REFERENCES ON {s}.users FROM service_role", "users_service_role_privileges_wrong"),
    ("GRANT TRUNCATE ON {s}.users TO service_role",
     "REVOKE TRUNCATE ON {s}.users FROM service_role", "users_service_role_privileges_wrong"),
    ("GRANT REFERENCES(id) ON {s}.users TO service_role",
     "REVOKE REFERENCES(id) ON {s}.users FROM service_role", "users_service_role_privileges_wrong"),
    ("GRANT SELECT ON {s}." + EVIDENCE + " TO service_role",
     "REVOKE SELECT ON {s}." + EVIDENCE + " FROM service_role", "staff_privilege_evidence_privileges_wrong"),
    ("GRANT INSERT ON {s}." + EVIDENCE + " TO PUBLIC",
     "REVOKE INSERT ON {s}." + EVIDENCE + " FROM PUBLIC", "staff_privilege_evidence_privileges_wrong"),
    ("ALTER TABLE {s}." + EVIDENCE + " DISABLE ROW LEVEL SECURITY",
     "ALTER TABLE {s}." + EVIDENCE + " ENABLE ROW LEVEL SECURITY", "staff_privilege_evidence_rls_off"),
    ("ALTER TABLE {s}." + EVIDENCE + " DISABLE TRIGGER " + GUARD_TRIGGER,
     "ALTER TABLE {s}." + EVIDENCE + " ENABLE TRIGGER " + GUARD_TRIGGER,
     "staff_privilege_evidence_commit_guard_wrong"),
    ("ALTER TABLE {s}." + EVIDENCE + " ENABLE REPLICA TRIGGER " + GUARD_TRIGGER,
     "ALTER TABLE {s}." + EVIDENCE + " ENABLE TRIGGER " + GUARD_TRIGGER,
     "staff_privilege_evidence_commit_guard_wrong"),
    ("ALTER FUNCTION {s}." + GUARD_FN + "() SECURITY INVOKER",
     "ALTER FUNCTION {s}." + GUARD_FN + "() SECURITY DEFINER", "staff_privilege_evidence_commit_guard_wrong"),
    ("ALTER FUNCTION {s}." + GUARD_FN + "() SET search_path = public, pg_temp",
     "ALTER FUNCTION {s}." + GUARD_FN + "() SET search_path = pg_catalog, pg_temp",
     "staff_privilege_evidence_commit_guard_wrong"),
    ("GRANT EXECUTE ON FUNCTION {s}." + GUARD_FN + "() TO service_role",
     "REVOKE EXECUTE ON FUNCTION {s}." + GUARD_FN + "() FROM service_role",
     "staff_privilege_evidence_commit_guard_wrong"),
    ("GRANT EXECUTE ON FUNCTION {s}." + GUARD_FN + "() TO PUBLIC",
     "REVOKE EXECUTE ON FUNCTION {s}." + GUARD_FN + "() FROM PUBLIC",
     "staff_privilege_evidence_commit_guard_wrong"),
    ("ALTER TABLE {s}.users DISABLE TRIGGER trg_users_suspension_role_guard",
     "ALTER TABLE {s}.users ENABLE TRIGGER trg_users_suspension_role_guard", "staff_security_trigger_missing"),
    ("ALTER FUNCTION {s}.fn_ai_model_override_audit() SECURITY INVOKER",
     "ALTER FUNCTION {s}.fn_ai_model_override_audit() SECURITY DEFINER", "staff_security_function_wrong"),
    ("GRANT EXECUTE ON FUNCTION {s}.fn_users_privilege_audit() TO service_role",
     "REVOKE EXECUTE ON FUNCTION {s}.fn_users_privilege_audit() FROM service_role", "staff_security_function_wrong"),
    ("ALTER FUNCTION {s}.fn_users_suspension_guard() SET search_path = pg_temp",
     "ALTER FUNCTION {s}.fn_users_suspension_guard() SET search_path = {s}, pg_temp",
     "staff_security_function_wrong"),
    ("GRANT USAGE ON SEQUENCE {s}.ai_provider_failures_id_seq TO anon",
     "REVOKE USAGE ON SEQUENCE {s}.ai_provider_failures_id_seq FROM anon", "ai_override_sequence_privileges_wrong"),
    ("GRANT SELECT ON SEQUENCE {s}.ai_model_override_audit_id_seq TO PUBLIC",
     "REVOKE SELECT ON SEQUENCE {s}.ai_model_override_audit_id_seq FROM PUBLIC",
     "ai_override_sequence_privileges_wrong"),
    ("GRANT INSERT ON {s}.ai_model_override_audit TO service_role",
     "REVOKE INSERT ON {s}.ai_model_override_audit FROM service_role", "ai_model_override_audit_privileges_wrong"),
    ("ALTER TABLE {s}.ai_model_override_audit DISABLE TRIGGER trg_ai_model_override_audit_no_truncate",
     "ALTER TABLE {s}.ai_model_override_audit ENABLE TRIGGER trg_ai_model_override_audit_no_truncate",
     "ai_model_override_audit_trigger_missing"),
    *[(f"GRANT {priv} ON {{s}}.users TO {role}",
       f"REVOKE {priv} ON {{s}}.users FROM {role}", f"users_client_role_privileges_wrong: {role}:{priv}")
      for role in ("anon", "authenticated")
      for priv in ("TRIGGER", "REFERENCES", "TRUNCATE", "INSERT", "UPDATE", "DELETE")],
    *[(f"GRANT {priv}(id) ON {{s}}.users TO {role}",
       f"REVOKE {priv}(id) ON {{s}}.users FROM {role}", f"users_client_role_privileges_wrong: {role}:{priv}")
      for role in ("anon", "authenticated") for priv in ("INSERT", "UPDATE", "REFERENCES")],
]


def _repaired_by_361(tamper: str) -> bool:
    return f"FUNCTION {{s}}.{GUARD_FN}()" in tamper or "FUNCTION {s}.fn_users_privilege_audit()" in tamper


@pytest.mark.parametrize("tamper,revert,marker", _DRIFT)
def test_postcondition_block_aborts_on_drift(db, tamper, revert, marker):
    s = db
    _owner(_postcondition_sql(s))   # clean state passes
    _owner(tamper.format(s=s))
    try:
        assert marker in _fails(_owner, _postcondition_sql(s))
        if _repaired_by_361(tamper):
            _apply(s)   # CREATE OR REPLACE / REVOKE restore what 361 owns
            _owner(_postcondition_sql(s))
        else:
            assert marker in _fails(_owner, _migrated(s))
    finally:
        _owner(revert.format(s=s))
    _owner(_postcondition_sql(s))


def test_postcondition_refuses_evidence_inside_its_transaction(db):
    """P3-2 forbids committing the fixture row: check before the commit guard."""
    s = db
    tamper = (f"INSERT INTO {s}.{EVIDENCE} (target_user_id, kind, audit_id) "
              f"VALUES (gen_random_uuid(), 'rpc', gen_random_uuid())")
    assert "staff_privilege_evidence_not_empty" in _fails(
        _owner, f"BEGIN; {tamper}; {_postcondition_sql(s)}; COMMIT;")
    assert _evidence_rows(s) == "0"


def test_postcondition_refuses_maintain_on_pg17(db):
    _require_pg17()
    test_postcondition_block_aborts_on_drift(
        db, "GRANT MAINTAIN ON {s}.users TO service_role",
        "REVOKE MAINTAIN ON {s}.users FROM service_role", "users_service_role_privileges_wrong")


@pytest.mark.parametrize("role", ["anon", "authenticated"])
def test_postcondition_refuses_client_maintain_on_pg17(db, role):
    _require_pg17()
    test_postcondition_block_aborts_on_drift(
        db, f"GRANT MAINTAIN ON {{s}}.users TO {role}",
        f"REVOKE MAINTAIN ON {{s}}.users FROM {role}", f"users_client_role_privileges_wrong: {role}:MAINTAIN")


@pytest.mark.parametrize("role", ["anon", "authenticated", "service_role"])
def test_postcondition_refuses_users_privileges_via_set_role(db, role):
    """SA-R4-1: NOINHERIT membership still permits SET ROLE on PG16/17."""
    s, group = db, "ev361_member_" + uuid4().hex
    psql(f"CREATE ROLE {group} NOSUPERUSER NOLOGIN")
    try:
        _owner(f"GRANT USAGE ON SCHEMA {s} TO {group}; GRANT TRUNCATE ON {s}.users TO {group}")
        psql(f"GRANT {group} TO {role} WITH INHERIT FALSE, SET TRUE")
        assert psql(f"SELECT has_table_privilege('{role}', '{s}.users', 'TRUNCATE')") == "f"
        assert psql(f"BEGIN; SET LOCAL ROLE {role}; SET LOCAL ROLE {group}; "
                    f"SELECT has_table_privilege(current_user, '{s}.users', 'TRUNCATE'); ROLLBACK") == "t"
        marker = ("users_service_role_privileges_wrong" if role == "service_role"
                  else "users_client_role_privileges_wrong")
        assert marker in _fails(_owner, _postcondition_sql(s))
        assert marker in _fails(_owner, _migrated(s))
    finally:
        psql(f"REVOKE {group} FROM {role}")
        _owner(f"REVOKE ALL ON {s}.users FROM {group}; REVOKE USAGE ON SCHEMA {s} FROM {group}")
        psql(f"DROP ROLE {group}")


def test_postcondition_refuses_old_new_id_audit_body(db):
    s = db
    _owner(m331._schema_sql(m326._function(m341.SQL, "fn_users_privilege_audit"), s))
    try:
        assert "staff_privilege_audit_evidence_key_wrong" in _fails(_owner, _postcondition_sql(s))
    finally:
        _apply(s)
    assert _audit_key(s) == "OLD"


def test_postcondition_refuses_a_commit_guard_that_does_not_own_its_table(fresh):
    s = fresh
    psql("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ev361_other') THEN "
         "CREATE ROLE ev361_other NOSUPERUSER NOLOGIN; END IF; END $$;")
    psql(f"ALTER FUNCTION {s}.{GUARD_FN}() OWNER TO ev361_other")
    error = _fails(psql, _postcondition_sql(s))
    assert "staff_privilege_evidence_commit_guard_wrong" in error or "staff_definer_owner_mismatch" in error
    psql(f"ALTER FUNCTION {s}.{GUARD_FN}() OWNER TO {OWNER}; "
         f"REVOKE ALL ON FUNCTION {s}.{GUARD_FN}() FROM ev361_other")
    psql(f"ALTER TABLE {s}.{EVIDENCE} OWNER TO ev361_other")
    error = _fails(psql, _postcondition_sql(s))
    assert "staff_definer_owner_mismatch" in error and GUARD_FN in error, error


@pytest.mark.parametrize("tamper,marker", [
    ("GRANT TRIGGER ON {s}.users TO anon, authenticated, service_role", "users_service_role_privileges_wrong"),
    ("ALTER FUNCTION {s}." + GUARD_FN + "() SET search_path = public, pg_temp",
     "staff_privilege_evidence_commit_guard_wrong"),
    ("ALTER FUNCTION {s}.fn_users_suspension_guard() SET search_path = pg_temp", "staff_security_function_wrong"),
])
@pytest.mark.parametrize("path", ["{s}", "{s}, pg_catalog"])
def test_postcondition_ignores_attacker_array_operators(fresh, tamper, marker, path):
    """SA-2180-1: an exact text[] `||` / `@>` in a schema on the runner's path
    beat the anyarray built-ins in 341's checks, so drift passed and attacker
    code ran as the owner. 361 qualifies them and pins search_path."""
    s = fresh
    _plant_shadows(s)
    _owner(tamper.format(s=s))
    run = f"SET ROLE {OWNER}; SET search_path = {path.format(s=s)}; "
    for sql in (_postcondition_sql(s), f"BEGIN; SET LOCAL search_path = pg_catalog, pg_temp; "
                                       f"{_postcondition_sql(s)} COMMIT;"):
        rc, out = _psql_all(run + sql)
        assert rc != 0 and marker in out, out
        assert "attacker_operator_called" not in out, out


def test_negative_control_341_postcondition_runs_attacker_operators(only_341):
    """The SA-2180-1 repro against the applied 341: drift passes unseen."""
    s = only_341
    _plant_shadows(s)
    _owner(f"GRANT TRIGGER ON {s}.users TO service_role")
    post_341 = m331._schema_sql(m341.SQL[m341.SQL.rindex("DO $$"):m341.SQL.rindex("COMMIT;")], s)
    rc, out = _psql_all(f"SET ROLE {OWNER}; SET search_path = {s}, pg_catalog; {post_341}")
    assert rc == 0 and f"attacker_operator_called {OWNER}" in out, out


# ── PostgreSQL: rollback ────────────────────────────────────────────────────

def test_header_rollback_reopens_p3_2_grants_nothing_and_361_reapplies(fresh):
    s = fresh
    before = [line for line in _catalog(s, oids=False)
              if GUARD_FN not in line and "fn_users_privilege_audit" not in line]
    _owner(_rollback_sql(s))
    assert not _guard_installed(s) and _audit_key(s) == "NEW"
    after = [line for line in _catalog(s, oids=False) if "fn_users_privilege_audit" not in line]
    assert after == before, "rollback must not change any other ACL or trigger"
    # Negative control: an owner-planted row commits again.
    _owner(f"INSERT INTO {s}.{EVIDENCE}(target_user_id, kind, audit_id) "
           f"VALUES (gen_random_uuid(), 'rpc', gen_random_uuid())")
    assert _evidence_rows(s) == "1"
    assert "staff_privilege_evidence_not_empty" in _fails(_owner, _migrated(s))
    _owner(f"DELETE FROM {s}.{EVIDENCE}")
    _apply(s)
    assert _guard_installed(s) and _audit_key(s) == "OLD"
