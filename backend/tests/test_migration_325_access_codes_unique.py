"""Migration 325: access_codes.code is unique and canonical (CODEUNIQ-0028, F07).

`access_codes_code_key UNIQUE (code)` existed only outside the repository
(dashboard drift on staging). 325 codifies it with CREATE UNIQUE INDEX
CONCURRENTLY IF NOT EXISTS, refuses an invalid leftover index, and adds
`chk_access_codes_code_canonical` so plain uniqueness equals uniqueness of every
way a learner can type the code (/auth/activate does `strip().upper()`).

The static half pins the file's shape: no transaction around the CONCURRENTLY
build, precheck before it, no data writes, postcondition. The PostgreSQL half
runs the real file — through `scripts/apply_migration_locked.sql`, exactly as
`apply_migrations.sh` does — in a disposable database per test, both on a
repo-built table (no unique) and on the staging shape (unique already present).

Set TEST_PG_URL to a LOCAL disposable cluster and REQUIRE_PG=1 to forbid skips.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path
from urllib.parse import urlparse, urlunparse
from uuid import uuid4

import pytest

from test_migration_240_core_attempt_evidence import DB, psql

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
MIGRATION = BACKEND / "migrations" / "325_access_codes_code_unique_canonical.sql"
LOCKED_APPLIER = BACKEND / "scripts" / "apply_migration_locked.sql"
SQL = MIGRATION.read_text(encoding="utf-8")


def _strip_comments(sql: str) -> str:
    return re.sub(r"--[^\n]*", "", sql)


CODE = _strip_comments(SQL)
# Top level only: DO bodies ($$ … $$) carry their own PL/pgSQL BEGIN/END.
TOP_LEVEL = re.sub(r"\$\$.*?\$\$", "$$<body>$$", CODE, flags=re.S)


# ── Static contract ─────────────────────────────────────────────────────────

def test_concurrent_build_is_outside_any_transaction_block():
    build = TOP_LEVEL.index("CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS access_codes_code_key")
    statements = [s.strip().upper() for s in TOP_LEVEL.split(";")]
    assert "BEGIN" in statements and "COMMIT" in statements, "the CHECK step runs in its own transaction"
    begin = re.search(r"(?m)^\s*BEGIN\s*;", TOP_LEVEL)
    assert begin and begin.start() > build, "no BEGIN may precede CREATE INDEX CONCURRENTLY"
    assert not re.search(r"START\s+TRANSACTION", TOP_LEVEL, re.I)
    # The runner never wraps a file (CONCURRENTLY would fail inside one).
    runner = (BACKEND / "scripts" / "apply_migrations.sh").read_text(encoding="utf-8")
    assert "--single-transaction" not in runner and not re.search(r"psql[^\n]*\s-1\b", runner)
    assert r"\i :MIGRATION_PATH" in LOCKED_APPLIER.read_text(encoding="utf-8")


def test_precheck_runs_first_and_postcondition_closes_the_transaction():
    precheck = CODE.index("access_codes_code_not_unique_or_not_canonical")
    build = CODE.index("CREATE UNIQUE INDEX CONCURRENTLY")
    invalid = CODE.index("access_codes_code_key_invalid")
    attach = CODE.index("UNIQUE USING INDEX access_codes_code_key")
    check = CODE.index("ADD CONSTRAINT chk_access_codes_code_canonical")
    validate = CODE.index("VALIDATE CONSTRAINT chk_access_codes_code_canonical")
    post = CODE.index("access_codes_code_unique_postcondition_failed")
    commit = re.search(r"(?m)^\s*COMMIT\s*;", CODE).start()
    assert precheck < build < invalid < attach < check < validate < post < commit
    for counter in ("exact_dup_groups", "normalized_dup_groups", "non_canonical"):
        assert counter in CODE
    assert "SET lock_timeout = '5s'" in CODE and "RESET lock_timeout" in CODE


def test_canonical_check_matches_the_activation_lookup():
    assert "CHECK (code = upper(btrim(code)) AND code <> '') NOT VALID" in CODE
    auth = (BACKEND / "routers" / "auth.py").read_text(encoding="utf-8")
    assert "payload.access_code.strip().upper()" in auth


def test_migration_changes_no_rows_and_adds_no_expression_index():
    assert not re.search(r"\b(INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|TRUNCATE)\b", CODE, re.I)
    assert not re.search(r"ON\s+public\.access_codes\s*\(\s*(lower|upper)", CODE, re.I)
    statements_only = re.sub(r"'[^']*'", "''", CODE)   # the HINT literal names the repair DROP
    assert not re.search(r"\bDROP\b", statements_only, re.I)


# ── PostgreSQL ──────────────────────────────────────────────────────────────

REPO_TABLE = """
CREATE TABLE public.access_codes (
    id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code    text NOT NULL,
    is_used boolean NOT NULL DEFAULT false
);"""
# Staging today: the dashboard-created constraint already exists.
STAGING_TABLE = """
CREATE TABLE public.access_codes (
    id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code    text NOT NULL CONSTRAINT access_codes_code_key UNIQUE,
    is_used boolean NOT NULL DEFAULT false
);"""


def _env() -> dict[str, str]:
    environment = {key: value for key, value in os.environ.items() if not key.startswith("PG")}
    environment["PGCONNECT_TIMEOUT"] = "3"
    return environment


def _run(url: str, *args: str) -> subprocess.CompletedProcess:
    # VERBOSITY=verbose puts the SQLSTATE in every error line.
    return subprocess.run(["psql", url, "-X", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose",
                           "-tAq", *args], capture_output=True, text=True, timeout=60, env=_env())


def _sql(url: str, sql: str) -> str:
    result = _run(url, "-c", sql)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()


def _sqlstate(url: str, sql: str) -> str:
    result = _run(url, "-c", sql)
    assert result.returncode, f"expected an error from {sql!r}"
    match = re.search(r"ERROR:\s+([0-9A-Z]{5}):", result.stderr)
    assert match, result.stderr
    return match.group(1)


def _apply_file(url: str) -> subprocess.CompletedProcess:
    return _run(url, "-f", str(MIGRATION))


def _apply_locked(url: str) -> subprocess.CompletedProcess:
    """What apply_migrations.sh runs for one unapplied file."""
    _sql(url, "CREATE TABLE IF NOT EXISTS _schema_migrations "
              "(filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())")
    return _run(url, "-v", f"MIGRATION_NAME={MIGRATION.name}", "-v", f"MIGRATION_PATH={MIGRATION}",
                "-v", "BASELINE=0", "-v", "DRY_RUN=0", "-f", str(LOCKED_APPLIER))


def _catalog(url: str) -> str:
    return _sql(url, """
        SELECT string_agg(format('%s:%s:%s', conname, contype, oid), ',' ORDER BY conname)
          FROM pg_constraint WHERE conrelid = 'public.access_codes'::regclass
        UNION ALL
        SELECT string_agg(format('%s:%s', indexrelid::regclass, indexrelid), ',' ORDER BY indexrelid::regclass::text)
          FROM pg_index WHERE indrelid = 'public.access_codes'::regclass""")


def _code_indexes(url: str) -> int:
    return int(_sql(url, """
        SELECT count(*) FROM pg_index i
         WHERE i.indrelid = 'public.access_codes'::regclass AND i.indisunique
           AND i.indkey[0] = (SELECT attnum FROM pg_attribute
                               WHERE attrelid = 'public.access_codes'::regclass AND attname = 'code')"""))


def _assert_final_schema(url: str) -> None:
    unique = _sql(url, """
        SELECT format('%s|%s|%s|%s', i.indisvalid, i.indisunique, i.indnatts, pg_get_constraintdef(c.oid))
          FROM pg_constraint c JOIN pg_index i ON i.indexrelid = c.conindid
         WHERE c.conrelid = 'public.access_codes'::regclass AND c.conname = 'access_codes_code_key'
           AND c.contype = 'u'""")
    assert unique == "t|t|1|UNIQUE (code)"
    check = _sql(url, """
        SELECT format('%s|%s', convalidated, pg_get_constraintdef(oid)) FROM pg_constraint
         WHERE conrelid = 'public.access_codes'::regclass AND conname = 'chk_access_codes_code_canonical'""")
    assert check.startswith("t|CHECK (") and "upper(btrim(code))" in check
    assert _code_indexes(url) == 1, "no duplicate unique index on code"


@pytest.fixture(scope="module")
def cluster():
    try:
        available = shutil.which("psql") and psql("SELECT 1") == "1"
    except Exception:
        available = False
    if not available:
        if os.environ.get("REQUIRE_PG") == "1":
            pytest.fail("Local PostgreSQL required for migration 325 verification")
        pytest.skip("Local PostgreSQL unavailable")
    if psql("SELECT usesuper FROM pg_user WHERE usename=current_user") != "t":
        pytest.fail("Migration 325 fixture requires a superuser on its disposable LOCAL cluster")
    return DB


@pytest.fixture
def database(cluster):
    """A fresh database per test: 325 targets public.access_codes and the
    locked runner writes public._schema_migrations, so a schema rewrite would
    not be faithful. Only this exact database is dropped."""
    name = "codeuniq_" + uuid4().hex
    psql(f"CREATE DATABASE {name}")
    url = urlunparse(urlparse(cluster)._replace(path="/" + name))
    try:
        yield url
    finally:
        psql(f"DROP DATABASE {name} WITH (FORCE)")


def test_repo_built_table_gains_unique_and_canonical_check_via_the_runner(database):
    _sql(database, REPO_TABLE)
    _sql(database, "INSERT INTO public.access_codes (code) VALUES ('AB12-CD34'), ('K7MP-Q2XR-9HTW')")
    result = _apply_locked(database)
    assert result.returncode == 0, result.stderr
    assert "__apply_migration_status__=processed" in result.stdout
    _assert_final_schema(database)
    assert _sql(database, "SELECT count(*) FROM _schema_migrations WHERE filename = "
                          f"'{MIGRATION.name}'") == "1"
    assert _sql(database, "SELECT string_agg(code, ',' ORDER BY code) FROM public.access_codes") \
        == "AB12-CD34,K7MP-Q2XR-9HTW", "325 must not change any row"

    # FR-002: lower-case, padded or empty codes are rejected (23514) …
    for bad in ("abcd-1234", "Abcd-EFGH-JKMN", " ABCD-1234", "ABCD-1234 ", "", "  "):
        assert _sqlstate(database, f"INSERT INTO public.access_codes (code) VALUES ('{bad}')") == "23514", bad
    # … FR-001: exact duplicates are rejected (23505) …
    assert _sqlstate(database, "INSERT INTO public.access_codes (code) VALUES ('AB12-CD34')") == "23505"
    # … and canonical codes in both formats still insert.
    _sql(database, "INSERT INTO public.access_codes (code) VALUES ('ZZ99-YY88'), ('ABCD-EFGH-JKMN')")
    assert _sql(database, "SELECT count(*) FROM public.access_codes") == "4"


def test_staging_shape_keeps_its_existing_index_and_only_adds_the_check(database):
    _sql(database, STAGING_TABLE)
    _sql(database, "INSERT INTO public.access_codes (code) VALUES ('AB12-CD34'), ('K7MP-Q2XR-9HTW')")
    index_oid = _sql(database, "SELECT 'public.access_codes_code_key'::regclass::oid")
    constraint_oid = _sql(database, "SELECT oid FROM pg_constraint WHERE conname = 'access_codes_code_key'")
    result = _apply_locked(database)
    assert result.returncode == 0, result.stderr
    _assert_final_schema(database)
    assert _sql(database, "SELECT 'public.access_codes_code_key'::regclass::oid") == index_oid
    assert _sql(database, "SELECT oid FROM pg_constraint WHERE conname = 'access_codes_code_key'") \
        == constraint_oid
    assert _sql(database, "SELECT count(*) FROM pg_index "
                          "WHERE indrelid = 'public.access_codes'::regclass") == "2"   # pkey + code


@pytest.mark.parametrize("table", [REPO_TABLE, STAGING_TABLE], ids=["repo", "staging"])
def test_reapplying_is_a_no_op(database, table):
    _sql(database, table)
    _sql(database, "INSERT INTO public.access_codes (code) VALUES ('AB12-CD34')")
    first = _apply_file(database)
    assert first.returncode == 0, first.stderr
    before = _catalog(database)
    second = _apply_file(database)
    assert second.returncode == 0, second.stderr
    assert _catalog(database) == before
    _assert_final_schema(database)
    # AC-8: once in the ledger the runner skips the file.
    _sql(database, "CREATE TABLE _schema_migrations (filename text PRIMARY KEY, "
                   f"applied_at timestamptz NOT NULL DEFAULT now()); "
                   f"INSERT INTO _schema_migrations (filename) VALUES ('{MIGRATION.name}')")
    skipped = _apply_locked(database)
    assert skipped.returncode == 0, skipped.stderr
    assert "__apply_migration_status__=skipped" in skipped.stdout


@pytest.mark.parametrize("codes,detail", [
    (["ABCD-1234", "ABCD-1234"], "exact_dup_groups=1 normalized_dup_groups=1 non_canonical=0"),
    (["ABCD-1234", "abcd-1234"], "exact_dup_groups=0 normalized_dup_groups=1 non_canonical=1"),
    (["ABCD-1234", " ABCD-1234 "], "exact_dup_groups=0 normalized_dup_groups=1 non_canonical=1"),
    (["abcd-1234"], "exact_dup_groups=0 normalized_dup_groups=0 non_canonical=1"),
    ([""], "exact_dup_groups=0 normalized_dup_groups=0 non_canonical=1"),
], ids=["exact-dup", "case-dup", "padded-dup", "lower-case", "empty"])
def test_precheck_aborts_with_counts_and_changes_nothing(database, codes, detail):
    _sql(database, REPO_TABLE)
    values = ",".join("('" + code + "')" for code in codes)
    _sql(database, f"INSERT INTO public.access_codes (code) VALUES {values}")
    rows_before = _sql(database, "SELECT string_agg(id || '=' || code, ',' ORDER BY id) FROM public.access_codes")
    catalog_before = _catalog(database)

    result = _apply_locked(database)
    assert result.returncode != 0
    assert "access_codes_code_not_unique_or_not_canonical" in result.stderr
    assert detail in result.stderr
    assert "__apply_migration_status__" not in result.stdout
    assert _catalog(database) == catalog_before, "an aborted precheck must leave the schema untouched"
    assert _sql(database, "SELECT string_agg(id || '=' || code, ',' ORDER BY id) FROM public.access_codes") \
        == rows_before
    assert _sql(database, "SELECT count(*) FROM _schema_migrations") == "0", "an abort is not recorded"


def test_invalid_leftover_index_aborts_with_a_drop_hint(database):
    _sql(database, REPO_TABLE)
    _sql(database, "INSERT INTO public.access_codes (code) VALUES ('AB12-CD34')")
    # Simulate a failed CREATE INDEX CONCURRENTLY (superuser-only, disposable DB).
    _sql(database, "CREATE UNIQUE INDEX access_codes_code_key ON public.access_codes (code)")
    _sql(database, "UPDATE pg_index SET indisvalid = false "
                   "WHERE indexrelid = 'public.access_codes_code_key'::regclass")
    result = _apply_file(database)
    assert result.returncode != 0
    assert "access_codes_code_key_invalid" in result.stderr
    assert "DROP INDEX CONCURRENTLY public.access_codes_code_key" in result.stderr
    assert _sql(database, "SELECT count(*) FROM pg_constraint WHERE conrelid = "
                          "'public.access_codes'::regclass AND contype IN ('u', 'c')") == "0"

    # The documented repair: drop concurrently, re-run.
    _sql(database, "DROP INDEX CONCURRENTLY public.access_codes_code_key")
    retry = _apply_file(database)
    assert retry.returncode == 0, retry.stderr
    _assert_final_schema(database)
