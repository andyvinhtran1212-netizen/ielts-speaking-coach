"""Shared fixture for ACCOUNTDATA-0100 service/route tests: a fresh local
PostgreSQL database with Supabase-like ``auth``/``storage`` stubs, a minimal
``users`` table and migration 500 applied. Same rules as
``test_account_data_schema.py``: TEST_PG_URL on localhost only; REQUIRE_PG=1
turns a missing cluster into a failure.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4

import pytest

MIGRATION = (Path(__file__).resolve().parents[1] / "migrations" / "500_account_data_rights.sql").read_text(
    encoding="utf-8")

BASE_SQL = """
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
END $$;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, deleted_at timestamptz);
CREATE TABLE auth.sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL);
CREATE TABLE public.users (
    id uuid PRIMARY KEY, email text NOT NULL, display_name text, role text DEFAULT 'student',
    is_active boolean DEFAULT true, created_at timestamptz DEFAULT now());
CREATE SCHEMA storage;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean,
    file_size_limit bigint, allowed_mime_types text[]);
CREATE TABLE storage.objects (id bigserial PRIMARY KEY, bucket_id text, name text);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
"""


def pg_database(extra_sql: str = ""):
    """Generator: yields ``(sqlalchemy_url, run_sql)``; drops the database after."""
    raw = os.environ.get("TEST_PG_URL", "")
    parsed = urlparse(raw)
    if not raw or not shutil.which("psql"):
        if os.environ.get("REQUIRE_PG") == "1":
            pytest.fail("ACCOUNTDATA-0100 tests require a local PostgreSQL cluster")
        pytest.skip("TEST_PG_URL not configured")
    assert parsed.scheme in {"postgres", "postgresql"}
    assert parsed.hostname in {"127.0.0.1", "localhost", "::1"} and not parsed.query
    db = "accountdata_" + uuid4().hex
    env = {k: v for k, v in os.environ.items() if not k.startswith("PG")}
    env["PGCONNECT_TIMEOUT"] = "5"

    def run(database, sql):
        url = parsed._replace(path="/" + database).geturl()
        result = subprocess.run(["psql", url, "-X", "-tAq", "-v", "ON_ERROR_STOP=1", "-f", "-"],
                                input=sql, capture_output=True, text=True, env=env, timeout=60)
        assert result.returncode == 0, result.stderr
        return result.stdout.strip()

    run("postgres", f"CREATE DATABASE {db};")
    try:
        run(db, BASE_SQL + extra_sql)
        run(db, MIGRATION)
        url = parsed._replace(scheme="postgresql+asyncpg", path="/" + db).geturl()
        yield url, (lambda sql: run(db, sql))
    finally:
        run("postgres", f"DROP DATABASE IF EXISTS {db} WITH (FORCE);")


def make_engine(url: str):
    from sqlalchemy.pool import NullPool

    from services.async_pg_engine import create_asyncpg_engine
    # NullPool: TestClient runs the app on its own event loop; pooled asyncpg
    # connections must not cross loops.
    return create_asyncpg_engine(url, poolclass=NullPool)
