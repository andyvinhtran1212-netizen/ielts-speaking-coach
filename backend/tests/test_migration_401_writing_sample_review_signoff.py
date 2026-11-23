"""LIBRARY-0061 T002b: migration 401 offline contract plus a disposable LOCAL PostgreSQL run.

The Writing sample publish gate (FR-019, E_NOT_APPROVED) is stored in the DB:
an approved row names who signed and when, and a published row is approved.
Set TEST_PG_URL to a local cluster and REQUIRE_PG=1 to require execution.
"""
import re
from pathlib import Path

import pytest

from tests.test_library_schema import SQL as SQL_400, TOPIC, pg, writing  # noqa: F401 (pg is a fixture)

MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"
NAME = "401_writing_sample_review_signoff.sql"
SQL = (MIGRATIONS / NAME).read_text()
DOWN = (MIGRATIONS / "rollback" / NAME).read_text()
CODE = re.sub(r"--[^\n]*", "", SQL)
CONSTRAINTS = ("writing_samples_review_status_valid", "writing_samples_review_signed",
               "writing_samples_published_approved")


def test_offline_transaction_columns_and_checks():
    assert CODE.strip().startswith("BEGIN;") and CODE.strip().endswith("COMMIT;")
    assert "SET LOCAL lock_timeout = '5s';" in CODE
    for column in ("review_status text NOT NULL DEFAULT 'needs_review'", "reviewed_by   text",
                   "reviewed_at   timestamptz"):
        assert f"ADD COLUMN IF NOT EXISTS {column}" in CODE
    for name in CONSTRAINTS:
        assert f"ADD CONSTRAINT {name}" in CODE and f"conname = '{name}'" in CODE
    assert "CHECK (NOT published OR review_status = 'approved')" in CODE
    assert "CHECK (review_status IN ('approved', 'needs_review', 'excluded'))" in CODE
    # No client access is opened: still no grant and no policy.
    assert not re.search(r"\b(GRANT|CREATE POLICY)\b", CODE, re.I)
    assert "NOTIFY pgrst, 'reload schema';" in CODE


def test_register_policy_and_rollback_rows():
    register = [line.split("\t") for line in (MIGRATIONS / "register.tsv").read_text().splitlines()]
    assert [row[:5] for row in register if row[0] == "401"] == [
        ["401", NAME, "present", "G06-T02b", "LIBRARY-0061"]]
    policy = [line.split("\t") for line in (MIGRATIONS / "forward-policy.tsv").read_text().splitlines()
              if line.startswith(NAME)]
    assert len(policy) == 1 and policy[0][1:3] == ["pending_feature", "public_library"]
    assert "No apply on merge" in policy[0][3]
    assert "WHERE published OR reviewed_by IS NOT NULL OR reviewed_at IS NOT NULL" in DOWN
    for column in ("reviewed_at", "reviewed_by", "review_status"):
        assert f"DROP COLUMN IF EXISTS {column}" in DOWN


SIGNED = "review_status = 'approved', reviewed_by = 'andy', reviewed_at = '2026-11-23'"


def _count(pg, where):
    return pg(f"SELECT count(*) FROM public.writing_samples WHERE {where};").stdout.strip()


def test_apply_twice_and_defaults(pg):
    pg(SQL_400)
    pg(TOPIC + writing())
    pg(SQL)
    pg(SQL)
    assert _count(pg, "review_status = 'needs_review' AND reviewed_by IS NULL AND reviewed_at IS NULL") == "1"
    names = pg("SELECT string_agg(conname, ',' ORDER BY conname) FROM pg_constraint "
               "WHERE conrelid = 'public.writing_samples'::regclass AND conname = ANY(ARRAY['writing_samples_review_status_valid', "
               "'writing_samples_review_signed', 'writing_samples_published_approved']);").stdout.strip()
    assert names.split(",") == sorted(CONSTRAINTS)
    assert pg("SELECT relrowsecurity FROM pg_class WHERE oid = 'public.writing_samples'::regclass;").stdout.strip() == "t"


@pytest.mark.parametrize("update", [
    "published = true",                                             # publish without a sign-off
    "review_status = 'approved'",                                  # approval with no signer
    "review_status = 'approved', reviewed_by = ' ', reviewed_at = now()",  # blank signer
    "review_status = 'approved', reviewed_by = 'andy'",            # no date
    "review_status = 'signed'",                                    # unknown status
    f"{SIGNED.replace('approved', 'needs_review')}, published = true",  # signed but not approved
])
def test_publish_gate_refuses(pg, update):
    pg(SQL_400)
    pg(TOPIC + writing())
    pg(SQL)
    result = pg(f"UPDATE public.writing_samples SET {update};", check=False)
    assert result.returncode != 0 and "violates check constraint" in result.stderr
    assert _count(pg, "published") == "0"


def test_signed_row_publishes_and_unpublish_stays_open(pg):
    pg(SQL_400)
    pg(TOPIC + writing())
    pg(SQL)
    pg(f"UPDATE public.writing_samples SET {SIGNED}, published = true, published_at = now();")
    assert _count(pg, "published AND review_status = 'approved'") == "1"
    # Withdrawing the approval while published is refused; unpublishing first works.
    assert pg("UPDATE public.writing_samples SET review_status = 'needs_review';", check=False).returncode != 0
    pg("UPDATE public.writing_samples SET published = false;")
    pg("UPDATE public.writing_samples SET review_status = 'excluded';")


def test_refuses_on_published_rows_without_sign_off(pg):
    pg(SQL_400)
    pg(TOPIC + writing(pub="true"))
    result = pg(SQL, check=False)
    assert result.returncode != 0 and "no stored sign-off" in result.stderr
    has_column = pg("SELECT count(*) FROM information_schema.columns WHERE table_name = 'writing_samples' "
                    "AND column_name = 'review_status';").stdout.strip()
    assert has_column == "0"


def test_rollback_refuses_signed_rows_then_drops_columns(pg):
    pg(SQL_400)
    pg(TOPIC + writing())
    pg(SQL)
    pg(f"UPDATE public.writing_samples SET {SIGNED};")
    result = pg(DOWN, check=False)
    assert result.returncode != 0 and "signed or published rows" in result.stderr
    pg("UPDATE public.writing_samples SET review_status = 'needs_review', reviewed_by = NULL, reviewed_at = NULL;")
    pg(DOWN)
    left = pg("SELECT count(*) FROM information_schema.columns WHERE table_name = 'writing_samples' "
              "AND column_name IN ('review_status', 'reviewed_by', 'reviewed_at');").stdout.strip()
    assert left == "0"
    pg(SQL)  # re-apply after rollback
