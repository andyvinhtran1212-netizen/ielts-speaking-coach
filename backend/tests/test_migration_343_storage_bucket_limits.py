"""343: offline SQL contract plus a disposable LOCAL PostgreSQL database.

Set TEST_PG_URL to a local cluster and REQUIRE_PG=1 to require execution.
No hosted database is contacted; each test drops its own disposable database.
"""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
from urllib.parse import urlparse
from uuid import uuid4

import pytest

from test_storage_limits import EXPECTED

MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"
NAME = "343_storage_bucket_limits.sql"
SQL = (MIGRATIONS / NAME).read_text()
CODE = re.sub(r"--[^\n]*", "", SQL)
DOWN = "\n".join(line.removeprefix("-- ") for line in SQL.split("-- DOWN BEGIN", 1)[1].split("-- DOWN END", 1)[0].splitlines()[1:])


def test_transaction_lock_policy_and_rollback_contract():
    assert CODE.strip().startswith("BEGIN;") and CODE.strip().endswith("COMMIT;")
    assert "SET LOCAL lock_timeout = '5s';" in CODE
    assert "FOR UPDATE" in CODE
    assert "storage_limits_missing_bucket" in CODE
    assert "storage_limits_postcondition_failed" in CODE
    for code in (CODE, DOWN):
        assert not re.search(r"\b(public|objects)\b", code, re.I)
        assert not re.search(r"\b(INSERT|DELETE|ALTER|DROP|TRUNCATE)\b", code, re.I)
    assert "file_size_limit = NULL, allowed_mime_types = NULL" in DOWN
    rows = [line.split("\t") for line in (MIGRATIONS / "forward-policy.tsv").read_text().splitlines() if line.startswith(NAME)]
    assert len(rows) == 1 and rows[0][1:3] == ["pending_feature", "storage_bucket_limits"]
    assert "Migration `343`" in (MIGRATIONS / "README.md").read_text()


@pytest.fixture
def pg():
    raw = os.environ.get("TEST_PG_URL", "")
    parsed = urlparse(raw)
    if not raw or not shutil.which("psql"):
        if os.environ.get("REQUIRE_PG") == "1":
            pytest.fail("343 requires a local PostgreSQL cluster")
        pytest.skip("TEST_PG_URL not configured")
    assert parsed.scheme in {"postgres", "postgresql"}
    assert parsed.hostname in {"127.0.0.1", "localhost", "::1"} and not parsed.query
    db = "storage343_" + uuid4().hex
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
        values = ",".join("('%s',%s)" % (bucket, "true" if bucket == "vocab-audio" else "false") for bucket in EXPECTED)
        run(db, f"""CREATE SCHEMA storage;
          CREATE TABLE storage.buckets(id text PRIMARY KEY, public boolean, file_size_limit bigint, allowed_mime_types text[], marker text DEFAULT 'unchanged');
          CREATE TABLE storage.objects(id int PRIMARY KEY, bucket_id text, metadata jsonb);
          INSERT INTO storage.buckets(id,public) VALUES {values},('unrelated',true);
          INSERT INTO storage.objects VALUES (1,'writing-images','{{"size":300}}');""")
        yield lambda sql, check=True: run(db, sql, check)
    finally:
        run("postgres", f"DROP DATABASE {db} WITH (FORCE);")


def state(pg):
    return json.loads(pg("SELECT json_agg(b ORDER BY id) FROM storage.buckets b;").stdout)


def test_apply_twice_exact_limits_public_objects_unchanged_and_down(pg):
    before = state(pg)
    assert all(row["file_size_limit"] is None and row["allowed_mime_types"] is None for row in before)
    pg(SQL)
    after = state(pg)
    by_id = {row["id"]: row for row in after}
    for bucket, (size, types) in EXPECTED.items():
        assert by_id[bucket]["file_size_limit"] == size
        assert by_id[bucket]["allowed_mime_types"] == list(types)
    assert [(r["id"], r["public"], r["marker"]) for r in after] == [(r["id"], r["public"], r["marker"]) for r in before]
    assert by_id["unrelated"] == next(row for row in before if row["id"] == "unrelated")
    pg(SQL)
    assert state(pg) == after
    assert json.loads(pg("SELECT json_agg(o) FROM storage.objects o;").stdout) == [{"id": 1, "bucket_id": "writing-images", "metadata": {"size": 300}}]
    pg(DOWN)
    assert state(pg) == before
    pg(SQL)
    assert state(pg) == after


@pytest.mark.parametrize("missing", EXPECTED)
def test_missing_bucket_aborts_without_partial_updates(pg, missing):
    pg("DELETE FROM storage.buckets WHERE id = '%s';" % missing)
    before = state(pg)
    result = pg(SQL, check=False)
    assert result.returncode != 0 and "storage_limits_missing_bucket" in result.stderr
    assert state(pg) == before


def test_postcondition_aborts_if_storage_does_not_keep_requested_value(pg):
    pg("""CREATE FUNCTION storage.corrupt_limit() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN NEW.file_size_limit := NULL; RETURN NEW; END $$;
       CREATE TRIGGER corrupt_limit BEFORE UPDATE ON storage.buckets FOR EACH ROW EXECUTE FUNCTION storage.corrupt_limit();""")
    before = state(pg)
    result = pg(SQL, check=False)
    assert result.returncode != 0 and "storage_limits_postcondition_failed" in result.stderr
    assert state(pg) == before
