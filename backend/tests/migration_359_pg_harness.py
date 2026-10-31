"""Schema builder imported from SA-DESIGN-359/tests/sa359_harness.py.

Synthetic data and a disposable local PostgreSQL only; the shared psql helper
rejects hosted databases. Unused SA seed helpers are kept in the audit package.
"""
import os
from pathlib import Path
from uuid import uuid4

import pytest

import test_migration_326_student_archive as m326
import test_migration_331_archived_student_give_guard as m331
from test_migration_240_core_attempt_evidence import DB, psql

MIG = Path(m326.__file__).resolve().parents[1] / "migrations"
SQL359 = (MIG / "359_activation_serialize.sql").read_text()
RB359 = (MIG / "rollback/359_activation_serialize.sql").read_text()
SIG = "fn_activation_serialize(uuid,uuid,text,text,jsonb)"


def migrated(sql, schema):
    return sql.replace("public.", schema + ".").replace(
        "pg_catalog, public, pg_temp", f"pg_catalog, {schema}, pg_temp")


def require_pg():
    """Use the loopback-only shared helper; REQUIRE_PG=1 forbids missing PG."""
    try:
        available = psql("SELECT 1") == "1"
    except Exception:
        available = False
    if not available:
        if DB or os.environ.get("REQUIRE_PG") == "1":
            pytest.fail("Local PostgreSQL required for migration 359 router matrix")
        pytest.skip("Local PostgreSQL unavailable for migration 359 router matrix")
    if psql("SELECT usesuper FROM pg_user WHERE usename=current_user") == "t":
        m331._require_pg()


def build(variant):
    """no337: 326/227 harness without 337/346. with337: 337 class-archive harness (coexistence)."""
    schema = f"sa359_{variant}_" + uuid4().hex[:12]
    require_pg()
    if variant == "no337":
        m326._build(schema)
        psql(m326._migrated(schema))
        psql(f"""
            ALTER TABLE {schema}.cohorts ADD COLUMN is_active boolean DEFAULT true, ADD COLUMN created_by uuid;
            CREATE TABLE {schema}.access_codes (
                id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cohort_id uuid REFERENCES {schema}.cohorts(id),
                is_used boolean DEFAULT false, is_revoked boolean DEFAULT false);""")
    else:
        import test_migration_337_class_archive as m337
        m337._build(schema)
        psql(m337._migrated(schema))
        psql(f"ALTER TABLE {schema}.cohorts ADD COLUMN created_by uuid")
    psql(f"""
        ALTER TABLE {schema}.users ADD COLUMN avatar_url text, ADD COLUMN permissions jsonb,
            ADD COLUMN access_code_used text, ADD COLUMN suspended_at timestamptz;
        ALTER TABLE {schema}.students ADD COLUMN created_by uuid;
        ALTER TABLE {schema}.access_codes ADD COLUMN code text UNIQUE, ADD COLUMN permissions jsonb,
            ADD COLUMN used_by uuid, ADD COLUMN used_at timestamptz,
            ADD COLUMN issued_by uuid REFERENCES {schema}.users(id), ADD COLUMN expires_at timestamptz,
            ADD COLUMN grants_role text, ADD COLUMN intended_email text;
        CREATE TABLE {schema}.user_code_assignments (
            user_id uuid NOT NULL, code_id uuid NOT NULL, assigned_at timestamptz, assigned_by uuid,
            is_active boolean NOT NULL DEFAULT true, PRIMARY KEY (user_id, code_id));""")
    psql(f"SET search_path = {schema}, pg_temp; " + (MIG / "099_access_code_audit.sql").read_text())
    psql(migrated(SQL359, schema))
    return schema
