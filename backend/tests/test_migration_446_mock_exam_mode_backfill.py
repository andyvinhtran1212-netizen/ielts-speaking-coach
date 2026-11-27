"""MOCKORG-0086 G09-T31 PR2: migration 446 offline contract plus a disposable LOCAL PostgreSQL run.

Set TEST_PG_URL to a local cluster and REQUIRE_PG=1 to require execution. The
five functions 446 rewrites are loaded from their own migrations (302, 306,
169) so the exact-snippet rewrite is tested against the real definitions.
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
NAME = "446_mock_exam_mode_backfill.sql"
SQL = (MIGRATIONS / NAME).read_text()
DOWN = (MIGRATIONS / "rollback" / NAME).read_text()
M445 = (MIGRATIONS / "445_mock_exam_audiences.sql").read_text()
CODE = re.sub(r"--[^\n]*", "", SQL)
REWRITTEN_306 = ("fn_mock_section_valid", "fn_mock_paper_dependencies",
                 "fn_guard_mock_paper_policy", "fn_guard_owned_mock_attempt")


def _from_306(name: str) -> str:
    text = (MIGRATIONS / "306_mock_paper_policy_and_admission.sql").read_text()
    match = re.search(rf"CREATE OR REPLACE FUNCTION public\.{name}\(.*?\nEND \$\$;", text, re.S)
    assert match, name
    return match.group(0)


BASE = """
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE public.users (id uuid PRIMARY KEY);
CREATE TABLE public.cohorts (id uuid PRIMARY KEY);
CREATE TABLE public.students (id uuid PRIMARY KEY, user_id uuid REFERENCES public.users(id),
    full_name text, cohort_id uuid, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.student_cohort_memberships (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id uuid NOT NULL, cohort_id uuid NOT NULL, is_active boolean NOT NULL DEFAULT true);
CREATE TABLE public.mock_exams (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cohort_id uuid,
    exam_mode text NOT NULL DEFAULT 'sequential',
    status text NOT NULL DEFAULT 'draft', is_open boolean NOT NULL DEFAULT false,
    active_section text NOT NULL DEFAULT 'not_started',
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT mock_exams_exam_mode_chk CHECK (exam_mode IN ('sequential', 'retake')));
CREATE TABLE public.mock_exam_sittings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    mock_exam_id uuid, status text NOT NULL DEFAULT 'registered');
CREATE TABLE public.mock_exam_reviews (sitting_id uuid, status text);
CREATE TABLE public.mock_exam_assignments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    exam_id uuid NOT NULL, user_id uuid NOT NULL, skills text[] NOT NULL DEFAULT '{}',
    open_from timestamptz, open_until timestamptz);
"""
SEED = """
INSERT INTO public.users VALUES ('00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000a2'), ('00000000-0000-0000-0000-0000000000a9');
INSERT INTO public.cohorts VALUES ('00000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-0000000000c2');
INSERT INTO public.students (id, user_id, full_name, cohort_id) VALUES
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'An', NULL),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a2', 'Bình', NULL),
  ('00000000-0000-0000-0000-0000000000b3', NULL, 'Chi', NULL),
  ('00000000-0000-0000-0000-0000000000b4', NULL, 'Dũng', '00000000-0000-0000-0000-0000000000c2');
INSERT INTO public.student_cohort_memberships (student_id, cohort_id) VALUES
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000c1');
INSERT INTO public.mock_exams (id, cohort_id, exam_mode, is_open) VALUES
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000c1', 'sequential', false),
  ('00000000-0000-0000-0000-0000000000e2', NULL, 'retake', false),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000c1', 'sequential', true),
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000c2', 'sequential', false);
INSERT INTO public.mock_exam_assignments (exam_id, user_id, skills, open_from, open_until) VALUES
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000a1',
   ARRAY['reading', 'listening'], '2026-12-01', '2026-12-03'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000a9',
   ARRAY['reading'], NULL, '2026-12-03');
"""
E1, E2, E3, E4 = (f"'00000000-0000-0000-0000-0000000000e{i}'" for i in range(1, 5))


@pytest.fixture
def pg():
    raw = os.environ.get("TEST_PG_URL", "")
    parsed = urlparse(raw)
    if not raw or not shutil.which("psql"):
        if os.environ.get("REQUIRE_PG") == "1":
            pytest.fail("446 requires a local PostgreSQL cluster")
        pytest.skip("TEST_PG_URL not configured")
    assert parsed.scheme in {"postgres", "postgresql"}
    assert parsed.hostname in {"127.0.0.1", "localhost", "::1"} and not parsed.query
    db = "mock446_" + uuid4().hex
    env = {k: v for k, v in os.environ.items() if not k.startswith("PG")}
    env["PGCONNECT_TIMEOUT"] = "5"

    def run(database, sql, check=True):
        url = parsed._replace(path="/" + database).geturl()
        result = subprocess.run(["psql", url, "-X", "-tAq", "-v", "ON_ERROR_STOP=1", "-f", "-"],
                                input=sql, capture_output=True, text=True, env=env, timeout=60)
        if check:
            assert result.returncode == 0, result.stderr
        return result

    run("postgres", f"CREATE DATABASE {db};")
    try:
        run(db, BASE)
        run(db, (MIGRATIONS / "169_fn_set_exam_mode.sql").read_text())
        run(db, (MIGRATIONS / "302_admin_mock_review_list_snapshot.sql").read_text())
        run(db, "\n".join(_from_306(n) for n in REWRITTEN_306))
        run(db, SEED)
        yield lambda sql, check=True: run(db, sql, check)
    finally:
        run("postgres", f"DROP DATABASE IF EXISTS {db} WITH (FORCE);", check=False)


def one(pg, sql):
    return pg(sql).stdout.strip()


def test_offline_contract():
    assert CODE.strip().startswith("BEGIN;")
    assert "SET LOCAL lock_timeout = '5s';" in CODE
    assert "mock_exam_446_requires_445" in CODE
    for fn in REWRITTEN_306 + ("fn_admin_mock_exams_with_review_eligibility",):
        assert f"public.{fn}(" in CODE
    assert "ON CONFLICT (exam_id, student_id, purpose) DO NOTHING" in CODE
    assert "is_open IS NOT TRUE" in CODE
    assert "NOTIFY pgrst, 'reload schema';" in CODE
    # Every 306 snippet 446 replaces is in the 306 source exactly once.
    for fn, old in (("fn_mock_section_valid", "p_exam->>'exam_mode'='retake'"),
                    ("fn_mock_paper_dependencies", "e.row->>'exam_mode'='retake'"),
                    ("fn_guard_mock_paper_policy", "m.exam_mode IS DISTINCT FROM 'retake'"),
                    ("fn_guard_owned_mock_attempt", "(exam->>'exam_mode'='retake' AND"),
                    ("fn_guard_owned_mock_attempt", "(exam->>'exam_mode'='sequential' AND")):
        assert _from_306(fn).count(old) == 1, (fn, old)


def test_register_policy_readme_rows():
    register = [line.split("\t") for line in (MIGRATIONS / "register.tsv").read_text().splitlines()]
    assert [row[:5] for row in register if row[0] == "446"] == [
        ["446", NAME, "present", "G09-T31", "MOCKORG-0086"]]
    policy = [line.split("\t") for line in (MIGRATIONS / "forward-policy.tsv").read_text().splitlines()
              if line.startswith(NAME)]
    assert len(policy) == 1 and policy[0][1:3] == ["pending_feature", "mock_exam_mode_names"]
    assert "No apply on merge" in policy[0][3]
    assert "`446` is `pending_feature mock_exam_mode_names`" in (MIGRATIONS / "README.md").read_text()


def test_needs_445_first(pg):
    result = pg(SQL, check=False)
    assert result.returncode != 0 and "mock_exam_446_requires_445" in result.stderr


def test_backfill_rename_and_rerun(pg):
    pg(M445)
    pg(SQL)
    modes = one(pg, "SELECT string_agg(id::text || '=' || exam_mode, ',' ORDER BY id) FROM public.mock_exams;")
    assert modes == ("00000000-0000-0000-0000-0000000000e1=live,"
                     "00000000-0000-0000-0000-0000000000e2=self_paced,"
                     "00000000-0000-0000-0000-0000000000e3=sequential,"   # open: skipped
                     "00000000-0000-0000-0000-0000000000e4=live")
    rows = one(pg, "SELECT string_agg(concat_ws(':', right(exam_id::text, 2), right(student_id::text, 2), "
                   "source_kind, selected, coalesce(excluded_reason, '-'), array_to_string(skills, '+')), "
                   "',' ORDER BY exam_id, student_id) FROM public.mock_exam_audiences;")
    assert rows == ("e1:b1:cohort:t:-:listening+reading+writing+speaking,"
                    "e1:b2:cohort:t:-:listening+reading+writing+speaking,"
                    "e1:b3:cohort:f:no_account:listening+reading+writing+speaking,"
                    "e2:b1:learner:t:-:listening+reading,"
                    "e4:b4:cohort:f:no_account:listening+reading+writing+speaking")
    # a9 has no students row: not copied, reported in a NOTICE on the first run.
    before = one(pg, "SELECT count(*) FROM public.mock_exam_audiences;")
    # CR #2595: a learner joining class c1 after the first run is not added to
    # e1 by a re-run (only "Cập nhật theo lớp" does that).
    pg("INSERT INTO public.students (id, user_id, full_name) VALUES "
       "('00000000-0000-0000-0000-0000000000b5', NULL, 'Em');"
       "INSERT INTO public.student_cohort_memberships (student_id, cohort_id) VALUES "
       "('00000000-0000-0000-0000-0000000000b5', '00000000-0000-0000-0000-0000000000c1');")
    out = pg(SQL)
    assert "0 from class rosters, 0 from assignments" in out.stderr
    assert "1 open exams skipped" in out.stderr
    assert one(pg, "SELECT count(*) FROM public.mock_exam_audiences;") == before
    # The open exam is filled and renamed on a re-run after it closes.
    pg(f"UPDATE public.mock_exams SET is_open = false WHERE id = {E3};")
    pg(SQL)
    assert one(pg, f"SELECT exam_mode FROM public.mock_exams WHERE id = {E3};") == "live"
    assert one(pg, f"SELECT count(*) FROM public.mock_exam_audiences WHERE exam_id = {E3};") == "4"


def test_first_run_notice(pg):
    pg(M445)
    out = pg(SQL)
    assert "1 assignments have no students row" in out.stderr
    assert "0 exams kept their existing list" in out.stderr


def test_existing_list_is_never_widened(pg):
    """CR #2595: an exam whose list was already set through the audience API
    keeps exactly that list, even when a class member is missing from it."""
    pg(M445)
    pg(f"INSERT INTO public.mock_exam_audiences (exam_id, user_id, student_id, source_kind, "
       f"source_cohort_id, skills) VALUES ({E1}, '00000000-0000-0000-0000-0000000000a1', "
       "'00000000-0000-0000-0000-0000000000b1', 'cohort', '00000000-0000-0000-0000-0000000000c1', "
       "ARRAY['reading']);")
    out = pg(SQL)
    assert "1 exams kept their existing list" in out.stderr
    assert one(pg, f"SELECT string_agg(right(student_id::text, 2) || ':' || array_to_string(skills, '+'), ',') "
                   f"FROM public.mock_exam_audiences WHERE exam_id = {E1};") == "b1:reading"
    assert one(pg, f"SELECT exam_mode FROM public.mock_exams WHERE id = {E1};") == "live"


def test_functions_accept_both_names(pg):
    pg(M445)
    pg(SQL)
    for fn in REWRITTEN_306 + ("fn_admin_mock_exams_with_review_eligibility",):
        src = one(pg, f"SELECT prosrc FROM pg_proc WHERE proname = '{fn}';")
        assert "self_paced" in src, fn
    # The SQL list function: a self-paced exam with a queued review is eligible.
    pg(f"INSERT INTO public.mock_exam_sittings (id, mock_exam_id, status) VALUES "
       f"('00000000-0000-0000-0000-0000000000f1', {E2}, 'all_submitted');"
       "INSERT INTO public.mock_exam_reviews VALUES ('00000000-0000-0000-0000-0000000000f1', 'queued');"
       f"UPDATE public.mock_exams SET status = 'published' WHERE id = {E2};")
    eligible = one(pg, "SELECT e->>'review_eligible' FROM jsonb_array_elements("
                       "public.fn_admin_mock_exams_with_review_eligibility()->'exams') e "
                       f"WHERE e->>'id' = {E2}::text;")
    assert eligible == "true"
    # Grants survive the CREATE OR REPLACE rewrite.
    assert one(pg, "SELECT has_function_privilege('authenticated', "
                   "'public.fn_admin_mock_exams_with_review_eligibility()', 'EXECUTE');") == "f"


def test_set_exam_mode_and_trigger_store_the_new_name(pg):
    pg(M445)
    pg(SQL)
    pg("INSERT INTO public.mock_exams (id, exam_mode) VALUES ('00000000-0000-0000-0000-0000000000e5', 'retake');")
    assert one(pg, "SELECT exam_mode FROM public.mock_exams WHERE id = '00000000-0000-0000-0000-0000000000e5';") \
        == "self_paced"
    pg("INSERT INTO public.mock_exams (id) VALUES ('00000000-0000-0000-0000-0000000000e6');")
    assert one(pg, "SELECT exam_mode FROM public.mock_exams WHERE id = '00000000-0000-0000-0000-0000000000e6';") \
        == "live"
    # Same mode under its old name is not a change; a real change stores the new name.
    assert one(pg, "SELECT public.fn_set_exam_mode('00000000-0000-0000-0000-0000000000e6', 'sequential') IS NULL;") == "t"
    assert one(pg, "SELECT public.fn_set_exam_mode('00000000-0000-0000-0000-0000000000e6', 'retake')->>'exam_mode';") \
        == "self_paced"
    assert pg("SELECT public.fn_set_exam_mode('00000000-0000-0000-0000-0000000000e6', 'practice');",
              check=False).returncode != 0
    # Dependents still block a change (migration 169 rule).
    assert one(pg, f"SELECT public.fn_set_exam_mode({E2}, 'live') IS NULL;") == "t"


def test_drifted_function_is_refused(pg):
    pg(M445)
    pg("CREATE OR REPLACE FUNCTION public.fn_mock_section_valid(p_skill TEXT,p_exam JSONB,p_sitting JSONB) "
       "RETURNS boolean LANGUAGE sql AS $$ SELECT p_exam->>'exam_mode' = 'retake' $$;")
    result = pg(SQL, check=False)
    assert result.returncode != 0 and "mock_exam_446_function_drift" in result.stderr
    assert one(pg, "SELECT count(*) FROM public.mock_exams WHERE exam_mode IN ('live','self_paced');") == "0"


def test_rollback_restores_legacy_names(pg):
    pg(M445)
    pg(SQL)
    pg(DOWN)
    assert one(pg, "SELECT string_agg(DISTINCT exam_mode, ',' ORDER BY exam_mode) FROM public.mock_exams;") \
        == "retake,sequential"
    assert one(pg, "SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_mock_exams_new_mode_name';") == "0"
    assert pg("SELECT public.fn_set_exam_mode('00000000-0000-0000-0000-0000000000e4', 'live');",
              check=False).returncode != 0                       # 169 version again
    pg(SQL)                                                       # re-applies cleanly
    assert one(pg, f"SELECT exam_mode FROM public.mock_exams WHERE id = {E1};") == "live"
