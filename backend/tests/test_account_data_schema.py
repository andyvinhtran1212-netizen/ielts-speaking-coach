"""Migration 500 (ACCOUNTDATA-0100 T002): account deletion requests, data
export jobs and the private account-exports bucket.

Runs the committed SQL on a LOCAL disposable PostgreSQL database (TEST_PG_URL;
with REQUIRE_PG=1 a missing cluster fails instead of skipping). A fresh
database per test holds minimal ``users`` and Supabase-like ``storage``
tables. Checks what the migration promises: client roles get nothing, the
partial unique indexes allow one open request and one running export per
learner, object paths are scoped to ``<user_id>/<export_id>/<uuid>.zip``,
state shapes are enforced, the bucket is private with a restrictive guard,
the file re-runs, and the rollback refuses while anything is stored.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4

import pytest

MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"
NAME = "500_account_data_rights.sql"
SQL = (MIGRATIONS / NAME).read_text(encoding="utf-8")
DOWN = (MIGRATIONS / "rollback" / NAME).read_text(encoding="utf-8")
U1 = "00000000-0000-0000-0000-0000000005a1"
U2 = "00000000-0000-0000-0000-0000000005a2"


def test_static_contract():
    code = "\n".join(line for line in SQL.splitlines() if not line.lstrip().startswith("--"))
    assert code.strip().startswith("BEGIN;") and code.strip().endswith("COMMIT;")
    assert "SET LOCAL lock_timeout = '5s';" in code
    assert "email" not in code.lower()  # FR: neither table stores an email
    assert "ON DELETE CASCADE" not in code  # users rows are anonymised, never deleted
    rows = [line.split("\t") for line in (MIGRATIONS / "forward-policy.tsv").read_text().splitlines()
            if line.startswith(NAME)]
    assert len(rows) == 1 and rows[0][1:3] == ["pending_feature", "account_data_rights"]
    reg = [line.split("\t") for line in (MIGRATIONS / "register.tsv").read_text().splitlines()
           if line.startswith("500\t")]
    assert len(reg) == 1 and reg[0][1:5] == [NAME, "present", "G04-T18", "ACCOUNTDATA-0100"]


@pytest.fixture
def pg():
    raw = os.environ.get("TEST_PG_URL", "")
    parsed = urlparse(raw)
    if not raw or not shutil.which("psql"):
        if os.environ.get("REQUIRE_PG") == "1":
            pytest.fail("migration 500 requires a local PostgreSQL cluster")
        pytest.skip("TEST_PG_URL not configured")
    assert parsed.scheme in {"postgres", "postgresql"}
    assert parsed.hostname in {"127.0.0.1", "localhost", "::1"} and not parsed.query
    db = "accountdata500_" + uuid4().hex
    env = {k: v for k, v in os.environ.items() if not k.startswith("PG")}
    env["PGCONNECT_TIMEOUT"] = "5"

    def run(database, sql, check=True):
        url = parsed._replace(path="/" + database).geturl()
        result = subprocess.run(["psql", url, "-X", "-tAq", "-v", "ON_ERROR_STOP=1", "-f", "-"],
                                input=sql, capture_output=True, text=True, env=env, timeout=30)
        if check:
            assert result.returncode == 0, result.stderr
        return result

    run("postgres", f"CREATE DATABASE {db};")
    try:
        run(db, f"""
          DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
          END $$;
          CREATE EXTENSION IF NOT EXISTS pgcrypto;
          GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
          CREATE TABLE public.users (id uuid PRIMARY KEY, email text);
          INSERT INTO public.users VALUES ('{U1}', 'a@example.test'), ('{U2}', 'b@example.test');
          CREATE SCHEMA storage;
          CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean,
              file_size_limit bigint, allowed_mime_types text[]);
          CREATE TABLE storage.objects (id bigserial PRIMARY KEY, bucket_id text, name text);
          ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
          INSERT INTO storage.buckets VALUES ('audio-responses', 'audio-responses', false, 52428800, NULL);
        """)
        yield lambda sql, check=True: run(db, sql, check)
    finally:
        run("postgres", f"DROP DATABASE IF EXISTS {db} WITH (FORCE);")


def _one(pg, sql):
    return pg(sql).stdout.strip()


def _fails(pg, sql):
    result = pg(sql, check=False)
    assert result.returncode != 0, sql
    return result.stderr


def _request(user, status="pending", **extra):
    cols = {"user_id": f"'{user}'", "status": f"'{status}'", "erase_after": "now() + interval '30 days'"}
    cols.update(extra)
    return (f"INSERT INTO public.account_deletion_requests ({', '.join(cols)}) "
            f"VALUES ({', '.join(cols.values())});")


def test_runs_twice_and_locks_out_clients(pg):
    pg(SQL)
    pg(SQL)
    for table in ("account_deletion_requests", "account_data_exports"):
        assert _one(pg, f"SELECT relrowsecurity FROM pg_class WHERE oid = 'public.{table}'::regclass") == "t"
        assert _one(pg, f"SELECT count(*) FROM pg_policy WHERE polrelid = 'public.{table}'::regclass") == "0"
        for role in ("anon", "authenticated"):
            assert "permission denied" in _fails(pg, f"SET ROLE {role}; SELECT * FROM public.{table};")
        assert _one(pg, f"SET ROLE service_role; SELECT count(*) FROM public.{table};") == "0"
    assert _one(pg, "SELECT public::text || '|' || file_size_limit || '|' || allowed_mime_types::text "
                    "FROM storage.buckets WHERE id = 'account-exports'") == "false|220200960|{application/zip}"
    assert _one(pg, "SELECT polpermissive FROM pg_policy WHERE polname = 'account_exports_backend_only'") == "f"
    # the other bucket is untouched
    assert _one(pg, "SELECT file_size_limit FROM storage.buckets WHERE id = 'audio-responses'") == "52428800"


def test_one_open_request_per_learner_and_shapes(pg):
    pg(SQL)
    pg(_request(U1))
    assert "account_deletion_requests_one_open" in _fails(pg, _request(U1))
    pg(_request(U2))
    # cancel frees the slot; a cancelled row must carry cancelled_at
    assert "cancelled_shape" in _fails(pg, f"UPDATE public.account_deletion_requests SET status='cancelled' WHERE user_id='{U1}';")
    pg(f"UPDATE public.account_deletion_requests SET status='cancelled', cancelled_at=now() WHERE user_id='{U1}';")
    pg(_request(U1))
    # erasing needs an owner and a lease; erased needs erased_at
    assert "lease_shape" in _fails(pg, f"UPDATE public.account_deletion_requests SET status='erasing' WHERE user_id='{U2}';")
    pg(f"UPDATE public.account_deletion_requests SET status='erasing', erasing_owner='w1', "
       f"lease_until=now() + interval '5 minutes' WHERE user_id='{U2}';")
    assert "account_deletion_requests_one_open" in _fails(pg, _request(U2))
    assert "erased_shape" in _fails(pg, f"UPDATE public.account_deletion_requests SET status='erased' WHERE user_id='{U2}';")
    assert "account_deletion_requests_status" in _fails(pg, _request(U2, status="done"))
    assert "window" in _fails(pg, _request(U2, status="failed", erase_after="now() - interval '1 day'"))
    # users rows are never deleted while a request points at them
    assert "violates foreign key" in _fails(pg, f"DELETE FROM public.users WHERE id='{U2}';")


def test_export_path_scope_and_one_running_job(pg):
    pg(SQL)
    eid = _one(pg, f"INSERT INTO public.account_data_exports (user_id) VALUES ('{U1}') RETURNING id;")
    assert "account_data_exports_one_running" in _fails(
        pg, f"INSERT INTO public.account_data_exports (user_id) VALUES ('{U1}');")
    token = str(uuid4())
    assert "building_shape" in _fails(pg, f"UPDATE public.account_data_exports SET status='building' WHERE id='{eid}';")
    pg(f"UPDATE public.account_data_exports SET status='building', export_owner='x', claim_token='{token}', "
       f"lease_until=now() + interval '5 minutes' WHERE id='{eid}';")
    for bad in (f"{U2}/{eid}/{token}.zip", f"{U1}/{uuid4()}/{token}.zip", f"{U1}/{eid}/../{token}.zip",
                f"{U1}/{eid}/{token}.zip.exe", f"{U1}/{eid}/x.zip"):
        assert "object_path_shape" in _fails(
            pg, f"UPDATE public.account_data_exports SET object_path='{bad}' WHERE id='{eid}';")
    assert "ready_shape" in _fails(pg, f"UPDATE public.account_data_exports SET status='ready' WHERE id='{eid}';")
    pg(f"UPDATE public.account_data_exports SET status='ready', ready_at=now(), expires_at=now() + interval '7 days', "
       f"object_path='{U1}/{eid}/{token}.zip', lease_until=NULL WHERE id='{eid}';")
    # a ready package frees the running slot
    pg(f"INSERT INTO public.account_data_exports (user_id) VALUES ('{U1}');")


def test_rollback_refuses_while_anything_is_stored(pg):
    pg(SQL)
    pg(DOWN)
    assert _one(pg, "SELECT to_regclass('public.account_deletion_requests') IS NULL "
                    "AND NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id='account-exports')") == "t"
    pg(SQL)
    pg(_request(U1))
    assert "account_deletion_requests has rows" in _fails(pg, DOWN)
    pg("DELETE FROM public.account_deletion_requests;")
    pg(f"INSERT INTO public.account_data_exports (user_id) VALUES ('{U1}');")
    assert "account_data_exports has rows" in _fails(pg, DOWN)
    pg("DELETE FROM public.account_data_exports;")
    pg(f"INSERT INTO storage.objects (bucket_id, name) VALUES ('account-exports', '{U1}/x/y.zip');")
    assert "account-exports still has objects" in _fails(pg, DOWN)
    assert _one(pg, "SELECT to_regclass('public.account_data_exports') IS NOT NULL") == "t"
