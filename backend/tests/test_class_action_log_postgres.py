"""Execute migration 198's append-only contract on disposable LOCAL PostgreSQL.

TEST_PG_URL/REQUIRE_PG use the shared localhost-only psql harness. Each test owns
one random schema; no hosted database or product data is used.
"""

import os
from pathlib import Path
from uuid import uuid4

import pytest

from test_migration_240_core_attempt_evidence import psql


SQL = (Path(__file__).resolve().parents[1] / "migrations/198_class_action_log.sql").read_text(encoding="utf-8")
MESSAGE = (
    "class_action_log chỉ THÊM: không sửa, không xoá (mig 198). Cần dọn thì "
    "tắt trigger trg_class_action_log_append_only một cách có ý thức."
)


@pytest.fixture
def log_schema():
    try:
        available = psql("SELECT 1") == "1"
    except (RuntimeError, OSError):
        available = False
    if not available:
        if os.environ.get("REQUIRE_PG") == "1":
            pytest.fail("Local PostgreSQL required for migration 198 verification")
        pytest.skip("Local PostgreSQL unavailable")
    assert psql("SELECT rolsuper FROM pg_roles WHERE rolname=current_user") == "t", "Disposable cluster requires a superuser"
    psql("""DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    END $$;""")
    schema = "class_log_" + uuid4().hex
    psql(f"CREATE SCHEMA {schema}")
    try:
        # 198 has no foreign keys. Only its policy predicate is a dependency;
        # no manual table/trigger/function copy or compensating privilege revoke.
        psql(f"CREATE FUNCTION {schema}.is_current_user_admin() RETURNS boolean "
             "LANGUAGE sql AS $$ SELECT false $$")
        migrated = SQL.replace("public.", f"{schema}.").replace("search_path = public,", f"search_path = {schema},")
        psql(f"SET search_path = {schema}, pg_temp;\n" + migrated)
        yield schema
    finally:
        psql(f"DROP SCHEMA {schema} CASCADE")


def _insert(schema):
    row, cohort = uuid4(), uuid4()
    assert psql(f"INSERT INTO {schema}.class_action_log (id, action, cohort_id, details) "
                f"VALUES ('{row}', 'due_change', '{cohort}', '{{\"before\":1}}') RETURNING id") == str(row)
    return row


def test_insert_preserves_the_audit_record(log_schema):
    row = _insert(log_schema)
    assert psql(f"SELECT action, details->>'before', created_at IS NOT NULL "
                f"FROM {log_schema}.class_action_log WHERE id='{row}'") == "due_change|1|t"


@pytest.mark.parametrize("operation", ["UPDATE", "DELETE"])
def test_update_and_delete_reject_real_rows_with_the_append_only_message(log_schema, operation):
    row = _insert(log_schema)
    command = (f"UPDATE {log_schema}.class_action_log SET action='return_work'" if operation == "UPDATE"
               else f"DELETE FROM {log_schema}.class_action_log")
    # Run as the table owner (bypasses RLS), so the trigger must do the work.
    with pytest.raises(RuntimeError) as error:
        psql(command + f" WHERE id='{row}'")
    assert MESSAGE in str(error.value)
    assert psql(f"SELECT action, details->>'before' FROM {log_schema}.class_action_log WHERE id='{row}'") == "due_change|1"


@pytest.mark.parametrize("role", ["anon", "authenticated"])
def test_client_roles_cannot_truncate_update_or_delete(log_schema, role):
    assert psql(f"SELECT rolsuper FROM pg_roles WHERE rolname='{role}'") == "f"
    for privilege in ("TRUNCATE", "UPDATE", "DELETE"):
        assert psql(f"SELECT has_table_privilege('{role}', '{log_schema}.class_action_log', '{privilege}')") == "f", (role, privilege)


def test_append_only_function_has_a_pinned_search_path(log_schema):
    assert psql(f"SELECT array_to_string(proconfig, ';') FROM pg_proc "
                f"WHERE oid='{log_schema}.fn_class_action_log_append_only()'::regprocedure") == f"search_path={log_schema}, pg_temp"
