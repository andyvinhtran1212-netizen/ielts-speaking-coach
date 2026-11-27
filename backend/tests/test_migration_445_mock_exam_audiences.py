"""MOCKORG-0086 G09-T31: migration 445 offline contract plus a disposable LOCAL PostgreSQL run.

Set TEST_PG_URL to a local cluster and REQUIRE_PG=1 to require execution.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4

import pytest

MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"
NAME = "445_mock_exam_audiences.sql"
SQL = (MIGRATIONS / NAME).read_text()
DOWN = (MIGRATIONS / "rollback" / NAME).read_text()
CODE = re.sub(r"--[^\n]*", "", SQL)

BASE = """
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
CREATE TABLE public.users (id uuid PRIMARY KEY);
CREATE TABLE public.students (id uuid PRIMARY KEY, user_id uuid REFERENCES public.users(id));
CREATE TABLE public.cohorts (id uuid PRIMARY KEY);
CREATE TABLE public.mock_exams (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cohort_id uuid,
    exam_mode text NOT NULL DEFAULT 'sequential',
    CONSTRAINT mock_exams_exam_mode_chk CHECK (exam_mode IN ('sequential', 'retake'))
);
INSERT INTO public.users VALUES ('00000000-0000-0000-0000-0000000000a1');
INSERT INTO public.students VALUES
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000b2', NULL);
INSERT INTO public.cohorts VALUES ('00000000-0000-0000-0000-0000000000c1');
INSERT INTO public.mock_exams (id, exam_mode) VALUES
  ('00000000-0000-0000-0000-0000000000e1', 'sequential'),
  ('00000000-0000-0000-0000-0000000000e2', 'retake');
"""
EXAM = "'00000000-0000-0000-0000-0000000000e1'"
USER = "'00000000-0000-0000-0000-0000000000a1'"
STUDENT = "'00000000-0000-0000-0000-0000000000b1'"
NO_ACCOUNT = "'00000000-0000-0000-0000-0000000000b2'"
COHORT = "'00000000-0000-0000-0000-0000000000c1'"


@pytest.fixture
def pg():
    raw = os.environ.get("TEST_PG_URL", "")
    parsed = urlparse(raw)
    if not raw or not shutil.which("psql"):
        if os.environ.get("REQUIRE_PG") == "1":
            pytest.fail("445 requires a local PostgreSQL cluster")
        pytest.skip("TEST_PG_URL not configured")
    assert parsed.scheme in {"postgres", "postgresql"}
    assert parsed.hostname in {"127.0.0.1", "localhost", "::1"} and not parsed.query
    db = "mock445_" + uuid4().hex
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
        run(db, BASE)
        yield lambda sql, check=True: run(db, sql, check)
    finally:
        run("postgres", f"DROP DATABASE IF EXISTS {db} WITH (FORCE);")


def _audience(**overrides):
    row = {"exam_id": EXAM, "user_id": USER, "student_id": STUDENT, "source_kind": "'cohort'",
           "source_cohort_id": COHORT, "skills": "ARRAY['listening','reading']"}
    row.update(overrides)
    cols = ", ".join(row)
    vals = ", ".join(row.values())
    return f"INSERT INTO public.mock_exam_audiences ({cols}) VALUES ({vals});"


def test_offline_contract():
    assert CODE.strip().startswith("BEGIN;")
    assert "SET LOCAL lock_timeout = '5s';" in CODE
    assert "CHECK (exam_mode IN ('sequential', 'retake', 'live', 'self_paced'))" in CODE
    assert "UNIQUE (exam_id, student_id, purpose)" in CODE
    # Backend-only: no policy, no client grant; no data rename (that is 446).
    assert not re.search(r"\bCREATE POLICY\b", CODE)
    assert not re.search(r"GRANT[^;]*\b(anon|authenticated)\b", CODE)
    assert not re.search(r"UPDATE\s+public\.mock_exams", CODE)
    assert "NOTIFY pgrst, 'reload schema';" in CODE


def test_register_policy_readme_rows():
    register = [line.split("\t") for line in (MIGRATIONS / "register.tsv").read_text().splitlines()]
    assert [row[:5] for row in register if row[0] == "445"] == [
        ["445", NAME, "present", "G09-T31", "MOCKORG-0086"]]
    policy = [line.split("\t") for line in (MIGRATIONS / "forward-policy.tsv").read_text().splitlines()
              if line.startswith(NAME)]
    assert len(policy) == 1 and policy[0][1:3] == ["pending_feature", "mock_exam_audiences"]
    assert "No apply on merge" in policy[0][3]
    assert "`445` is `pending_feature mock_exam_audiences`" in (MIGRATIONS / "README.md").read_text()


def test_apply_twice_keeps_legacy_rows_and_accepts_new_names(pg):
    pg(SQL)
    pg(SQL)
    assert pg("SELECT string_agg(exam_mode, ',' ORDER BY exam_mode) FROM public.mock_exams;").stdout.strip() \
        == "retake,sequential"
    assert pg("SELECT count(*) FROM public.mock_exams WHERE skills IS NULL AND NOT allow_early_advance "
              "AND starts_at IS NULL AND draft_state IS NULL;").stdout.strip() == "2"
    pg("INSERT INTO public.mock_exams (exam_mode) VALUES ('live'), ('self_paced');")
    assert pg("INSERT INTO public.mock_exams (exam_mode) VALUES ('practice');", check=False).returncode != 0
    assert pg("UPDATE public.mock_exams SET skills = ARRAY[]::text[];", check=False).returncode != 0
    assert pg("UPDATE public.mock_exams SET skills = ARRAY['maths'];", check=False).returncode != 0
    pg(f"UPDATE public.mock_exams SET skills = ARRAY['listening','reading'] WHERE id = {EXAM};")


def test_backend_only_table(pg):
    pg(SQL)
    out = pg("SELECT relrowsecurity, (SELECT count(*) FROM pg_policy WHERE polrelid = c.oid), "
             "has_table_privilege('anon', c.oid, 'SELECT'), has_table_privilege('authenticated', c.oid, 'SELECT'), "
             "has_table_privilege('service_role', c.oid, 'INSERT') "
             "FROM pg_class c WHERE oid = 'public.mock_exam_audiences'::regclass;").stdout.strip()
    assert out == "t|0|f|f|t"


def test_audience_constraints(pg):
    pg(SQL)
    pg(_audience())
    refused = [
        _audience(),  # duplicate (exam, student, main)
        _audience(purpose="'retry'"),
        _audience(student_id=NO_ACCOUNT, user_id="NULL"),  # no account but selected
        _audience(student_id=NO_ACCOUNT, user_id="NULL", selected="false", skills="ARRAY[]::text[]"),
        _audience(student_id=NO_ACCOUNT, user_id="NULL", selected="false", skills="ARRAY['maths']"),
        _audience(source_kind="'learner'", purpose="'makeup'"),  # learner source with a cohort id
        _audience(source_kind="'group'", source_cohort_id="NULL", purpose="'makeup'"),  # group without id
        _audience(purpose="'makeup'", open_from="'2026-12-02'", open_until="'2026-12-01'"),
    ]
    for sql in refused:
        assert pg(sql, check=False).returncode != 0, sql
    pg(_audience(purpose="'makeup'", source_kind="'learner'", source_cohort_id="NULL"))
    pg(_audience(student_id=NO_ACCOUNT, user_id="NULL", selected="false", excluded_reason="'no_account'"))
    assert pg("SELECT count(*) FROM public.mock_exam_audiences;").stdout.strip() == "3"
    pg(f"DELETE FROM public.mock_exams WHERE id = {EXAM};")
    assert pg("SELECT count(*) FROM public.mock_exam_audiences;").stdout.strip() == "0"


def test_deleting_a_user_keeps_the_row_as_no_account(pg):
    """CR #2565: ON DELETE SET NULL must not collide with the selected CHECK."""
    pg(SQL)
    pg(_audience())
    pg(f"UPDATE public.students SET user_id = NULL WHERE id = {STUDENT};")
    pg(f"DELETE FROM public.users WHERE id = {USER};")
    assert pg("SELECT user_id IS NULL, selected, excluded_reason FROM public.mock_exam_audiences;"
              ).stdout.strip() == "t|f|no_account"
    # A direct write of a missing account while selected is still refused.
    assert pg(_audience(student_id=NO_ACCOUNT, user_id="NULL"), check=False).returncode != 0
    assert pg("UPDATE public.mock_exam_audiences SET selected = true;", check=False).returncode != 0


def test_deleting_a_cohort_keeps_the_row_as_a_snapshot(pg):
    """CR #2565 (comment 7098971861): the cohort FK SET NULL must not collide
    with mock_exam_audiences_source_matches."""
    pg(SQL)
    pg(_audience())
    pg(f"DELETE FROM public.cohorts WHERE id = {COHORT};")
    assert pg("SELECT source_kind, source_cohort_id IS NULL, source_removed_at IS NOT NULL, selected "
              "FROM public.mock_exam_audiences;").stdout.strip() == "cohort|t|t|t"
    # A direct write of a cohort row without its class is still refused.
    assert pg(_audience(source_cohort_id="NULL", purpose="'makeup'"), check=False).returncode != 0


def test_drifted_mode_check_is_refused(pg):
    pg("ALTER TABLE public.mock_exams DROP CONSTRAINT mock_exams_exam_mode_chk;")
    result = pg(SQL, check=False)
    assert result.returncode != 0 and "mock_exams_exam_mode_chk_drift" in result.stderr
    assert pg("SELECT to_regclass('public.mock_exam_audiences') IS NULL;").stdout.strip() == "t"


def test_rollback_guards_then_restores(pg):
    pg(SQL)
    pg(_audience())
    assert "mock_exam_audiences has rows" in pg(DOWN, check=False).stderr
    pg("DELETE FROM public.mock_exam_audiences;")
    pg("INSERT INTO public.mock_exams (exam_mode) VALUES ('live');")
    assert "446 ran" in pg(DOWN, check=False).stderr
    pg("DELETE FROM public.mock_exams WHERE exam_mode = 'live';")
    pg(f"UPDATE public.mock_exams SET starts_at = now() WHERE id = {EXAM};")
    assert "new columns hold data" in pg(DOWN, check=False).stderr
    pg("UPDATE public.mock_exams SET starts_at = NULL;")
    pg(DOWN)
    assert pg("SELECT to_regclass('public.mock_exam_audiences') IS NULL;").stdout.strip() == "t"
    assert pg("SELECT to_regprocedure('public.fn_mock_exam_audiences_account_removed()') IS NULL;"
              ).stdout.strip() == "t"
    assert pg("INSERT INTO public.mock_exams (exam_mode) VALUES ('live');", check=False).returncode != 0
    pg(SQL)  # re-applies cleanly
