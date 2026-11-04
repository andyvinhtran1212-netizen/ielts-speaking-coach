"""BUCKET50 a: forward correction after immutable 343, on local PostgreSQL only."""
import json
import re

from test_migration_343_storage_bucket_limits import MIGRATIONS, SQL as ORIGINAL, pg, state
from test_storage_limits import EXPECTED

NAME = "362_listening_audio_bucket_50_mib.sql"
SQL = (MIGRATIONS / NAME).read_text()
CODE = re.sub(r"--[^\n]*", "", SQL)
DOWN = "\n".join(line.removeprefix("-- ") for line in SQL.split("-- DOWN BEGIN", 1)[1].split("-- DOWN END", 1)[0].splitlines()[1:])


def test_transaction_scope_policy_and_historical_rollback():
    assert CODE.strip().startswith("BEGIN;") and CODE.strip().endswith("COMMIT;")
    assert "SET LOCAL lock_timeout = '5s';" in CODE and "FOR UPDATE" in CODE
    assert "listening_audio_limit_missing_bucket" in CODE
    assert "listening_audio_limit_postcondition_failed" in CODE
    for code in (CODE, DOWN):
        assert not re.search(r"\b(public|objects|allowed_mime_types|INSERT|DELETE|ALTER|DROP|TRUNCATE)\b", code, re.I)
        assert set(re.findall(r"WHERE id = '([^']+)'", code)) == {"listening-audio"}
    assert "file_size_limit = 52428800" in CODE
    assert "file_size_limit = 134217728" in DOWN
    rows = [line.split("\t") for line in (MIGRATIONS / "forward-policy.tsv").read_text().splitlines() if line.startswith(NAME)]
    assert len(rows) == 1 and rows[0][1:3] == ["pending_feature", "storage_bucket_limits"]
    assert "Migration `362`" in (MIGRATIONS / "README.md").read_text()


def test_343_then_362_exact_limits_repeat_rollback_and_reapply(pg):
    pg(ORIGINAL)
    before = state(pg)
    assert next(row for row in before if row["id"] == "listening-audio")["file_size_limit"] == 134217728
    objects = json.loads(pg("SELECT json_agg(o) FROM storage.objects o;").stdout)
    pg(SQL)
    after = state(pg)
    for row in after:
        if row["id"] in EXPECTED:
            size, types = EXPECTED[row["id"]]
            assert row["file_size_limit"] == size
            assert row["allowed_mime_types"] == list(types)
    expected = [{**row, "file_size_limit": 52428800} if row["id"] == "listening-audio" else row for row in before]
    assert after == expected
    pg(SQL)
    assert state(pg) == after
    pg(DOWN)
    assert state(pg) == before
    pg(SQL)
    assert state(pg) == after
    assert json.loads(pg("SELECT json_agg(o) FROM storage.objects o;").stdout) == objects


def test_missing_listening_bucket_aborts_without_changing_other_rows(pg):
    pg(ORIGINAL)
    pg("DELETE FROM storage.buckets WHERE id = 'listening-audio';")
    before = state(pg)
    result = pg(SQL, check=False)
    assert result.returncode != 0 and "listening_audio_limit_missing_bucket" in result.stderr
    assert state(pg) == before


def test_failed_postcondition_rolls_back(pg):
    pg(ORIGINAL)
    pg("""CREATE FUNCTION storage.corrupt_limit() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN NEW.file_size_limit := NULL; RETURN NEW; END $$;
       CREATE TRIGGER corrupt_limit BEFORE UPDATE ON storage.buckets FOR EACH ROW EXECUTE FUNCTION storage.corrupt_limit();""")
    before = state(pg)
    result = pg(SQL, check=False)
    assert result.returncode != 0 and "listening_audio_limit_postcondition_failed" in result.stderr
    assert state(pg) == before
