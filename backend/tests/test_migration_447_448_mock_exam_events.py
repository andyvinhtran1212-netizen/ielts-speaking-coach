"""MOCKORG-0086 G09-T33: migrations 447 and 448 offline contract plus a disposable LOCAL PostgreSQL run.

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
N447 = "447_mock_exam_events.sql"
N448 = "448_mock_exam_release_parts.sql"
UP447 = (MIGRATIONS / N447).read_text()
UP448 = (MIGRATIONS / N448).read_text()
DOWN447 = (MIGRATIONS / "rollback" / N447).read_text()
DOWN448 = (MIGRATIONS / "rollback" / N448).read_text()

BASE = """
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
CREATE TABLE public.mock_exams (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE public.mock_exam_sittings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    mock_exam_id uuid REFERENCES public.mock_exams(id) ON DELETE CASCADE);
CREATE TABLE public.mock_exam_reviews (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sitting_id uuid UNIQUE REFERENCES public.mock_exam_sittings(id) ON DELETE CASCADE,
    status text NOT NULL, final_bands jsonb NOT NULL DEFAULT '{}');
INSERT INTO public.mock_exams VALUES ('00000000-0000-0000-0000-0000000000e1');
INSERT INTO public.mock_exam_sittings VALUES ('00000000-0000-0000-0000-0000000000f1',
    '00000000-0000-0000-0000-0000000000e1');
INSERT INTO public.mock_exam_reviews (sitting_id, status, final_bands) VALUES
    ('00000000-0000-0000-0000-0000000000f1', 'released',
     '{"listening": 6.0, "reading": 6.5, "writing": 6.0, "overall": 6.0}');
"""
EXAM = "'00000000-0000-0000-0000-0000000000e1'"
SITTING = "'00000000-0000-0000-0000-0000000000f1'"


def _code(sql: str) -> str:
    return re.sub(r"--[^\n]*", "", sql)


@pytest.fixture
def pg():
    raw = os.environ.get("TEST_PG_URL", "")
    parsed = urlparse(raw)
    if not raw or not shutil.which("psql"):
        if os.environ.get("REQUIRE_PG") == "1":
            pytest.fail("447/448 require a local PostgreSQL cluster")
        pytest.skip("TEST_PG_URL not configured")
    assert parsed.scheme in {"postgres", "postgresql"}
    assert parsed.hostname in {"127.0.0.1", "localhost", "::1"} and not parsed.query
    db = "mock447_" + uuid4().hex
    env = {k: v for k, v in os.environ.items() if not k.startswith("PG")}
    env["PGCONNECT_TIMEOUT"] = "5"

    def run(database, sql, check=True, role=None):
        url = parsed._replace(path="/" + database).geturl()
        if role:
            sql = f"SET ROLE {role};\n" + sql
        result = subprocess.run(["psql", url, "-X", "-tAq", "-v", "ON_ERROR_STOP=1", "-f", "-"],
                                input=sql, capture_output=True, text=True, env=env, timeout=30)
        if check:
            assert result.returncode == 0, result.stderr
        return result

    run("postgres", f"CREATE DATABASE {db};")
    try:
        run(db, BASE)
        yield lambda sql, check=True, role=None: run(db, sql, check, role)
    finally:
        run("postgres", f"DROP DATABASE IF EXISTS {db} WITH (FORCE);", check=False)


def one(pg, sql, **kw):
    return pg(sql, **kw).stdout.strip()


def test_offline_contract():
    for sql in (UP447, UP448):
        code = _code(sql)
        assert code.strip().startswith("BEGIN;")
        assert "SET LOCAL lock_timeout = '5s';" in code
        assert not re.search(r"\bCREATE POLICY\b", code)
        assert not re.search(r"GRANT[^;]*\b(anon|authenticated)\b", code)
        assert "GRANT SELECT, INSERT ON" in code and "UPDATE, DELETE" not in code
        assert "NOTIFY pgrst, 'reload schema';" in code
    # Plan row 448: a full release keeps mock_exam_reviews.released_at.
    assert "ADD COLUMN IF NOT EXISTS released_at" not in _code(UP448)


def test_register_policy_readme_rows():
    register = [line.split("\t") for line in (MIGRATIONS / "register.tsv").read_text().splitlines()]
    assert [row[:5] for row in register if row[0] in ("447", "448")] == [
        ["447", N447, "present", "G09-T33", "MOCKORG-0086"],
        ["448", N448, "present", "G09-T33", "MOCKORG-0086"]]
    policy = {line.split("\t")[0]: line.split("\t")
              for line in (MIGRATIONS / "forward-policy.tsv").read_text().splitlines()}
    assert policy[N447][1:3] == ["pending_feature", "mock_exam_events"]
    assert policy[N448][1:3] == ["pending_feature", "mock_exam_release_parts"]
    assert all("No apply on merge" in policy[n][3] for n in (N447, N448))
    readme = (MIGRATIONS / "README.md").read_text()
    assert "`447` is `pending_feature mock_exam_events`" in readme
    assert "mock_exam_release_parts" in readme


def test_448_needs_447(pg):
    result = pg(UP448, check=False)
    assert result.returncode != 0 and "mock_exam_448_requires_447" in result.stderr


def test_apply_twice_and_constraints(pg):
    for _ in range(2):
        pg(UP447)
        pg(UP448)
    assert one(pg, "SELECT extra_seconds::text || '|' || array_length(released_skills, 1) IS NULL "
                   "FROM public.mock_exam_sittings;") == "t"
    pg(f"UPDATE public.mock_exam_sittings SET extra_seconds = '{{\"reading\": 300}}', "
       "released_skills = ARRAY['listening','reading'];")
    pg("UPDATE public.mock_exam_sittings SET extra_seconds = '{\"reading\": 300, \"writing\": 0}', "
       "released_skills = ARRAY['listening','reading','writing','speaking'];")
    refused = [
        "UPDATE public.mock_exam_sittings SET extra_seconds = '[]';",
        "UPDATE public.mock_exam_sittings SET extra_seconds = '{\"maths\": 1}';",
        "UPDATE public.mock_exam_sittings SET released_skills = ARRAY['maths'];",
        # SA #2612 nits: value type and range, no Speaking key, no skill twice.
        "UPDATE public.mock_exam_sittings SET extra_seconds = '{\"reading\": \"abc\"}';",
        "UPDATE public.mock_exam_sittings SET extra_seconds = '{\"reading\": -1}';",
        "UPDATE public.mock_exam_sittings SET extra_seconds = '{\"reading\": 1.5}';",
        "UPDATE public.mock_exam_sittings SET extra_seconds = '{\"reading\": 86401}';",
        "UPDATE public.mock_exam_sittings SET extra_seconds = '{\"reading\": [1]}';",
        "UPDATE public.mock_exam_sittings SET extra_seconds = '{\"reading\": {\"a\": 1}}';",
        "UPDATE public.mock_exam_sittings SET extra_seconds = '{\"speaking\": 60}';",
        "UPDATE public.mock_exam_sittings SET released_skills = ARRAY['reading','reading'];",
        "UPDATE public.mock_exam_sittings SET released_skills = ARRAY['listening','reading','listening'];",
        f"INSERT INTO public.mock_exam_events (exam_id, kind) VALUES ({EXAM}, 'Bad Kind');",
        f"INSERT INTO public.mock_exam_events (exam_id, kind, payload) VALUES ({EXAM}, 'room_opened', '[]');",
        f"INSERT INTO public.mock_exam_room_messages (exam_id, body) VALUES ({EXAM}, '   ');",
        f"INSERT INTO public.mock_exam_score_edits (sitting_id, skill, new_band, reason) "
        f"VALUES ({SITTING}, 'reading', 6.3, 'sai đáp án');",
        f"INSERT INTO public.mock_exam_score_edits (sitting_id, skill, new_band, reason) "
        f"VALUES ({SITTING}, 'reading', 6.5, 'x');",
    ]
    for sql in refused:
        assert pg(sql, check=False).returncode != 0, sql


def test_service_role_is_append_only_and_clients_have_nothing(pg):
    pg(UP447)
    pg(UP448)
    pg(f"INSERT INTO public.mock_exam_events (exam_id, sitting_id, kind, payload) "
       f"VALUES ({EXAM}, {SITTING}, 'extra_time', '{{\"seconds\": 300}}');", role="service_role")
    pg(f"INSERT INTO public.mock_exam_score_edits (sitting_id, skill, old_band, new_band, reason) "
       f"VALUES ({SITTING}, 'reading', 6.0, 6.5, 'chấm sót câu 12');", role="service_role")
    for t in ("mock_exam_events", "mock_exam_room_messages", "mock_exam_score_edits"):
        assert pg(f"UPDATE public.{t} SET id = id;", check=False, role="service_role").returncode != 0, t
        assert pg(f"DELETE FROM public.{t};", check=False, role="service_role").returncode != 0, t
        for role in ("anon", "authenticated"):
            assert pg(f"SELECT 1 FROM public.{t};", check=False, role=role).returncode != 0, (t, role)


def test_release_request_key_is_unique_per_exam(pg):
    pg(UP447)
    pg(UP448)
    ins = (f"INSERT INTO public.mock_exam_events (exam_id, kind, payload) "
           f"VALUES ({EXAM}, 'released', '{{\"request_key\": \"k1\"}}');")
    pg(ins)
    assert pg(ins, check=False).returncode != 0
    pg(f"INSERT INTO public.mock_exam_events (exam_id, kind, payload) "
       f"VALUES ({EXAM}, 'released', '{{\"request_key\": \"k2\"}}');")
    # Other kinds may repeat a key-looking payload.
    pg(f"INSERT INTO public.mock_exam_events (exam_id, kind, payload) "
       f"VALUES ({EXAM}, 'score_edited', '{{\"request_key\": \"k1\"}}');" * 2)


def test_deletes_cascade_or_detach(pg):
    pg(UP447)
    pg(UP448)
    pg(f"INSERT INTO public.mock_exam_events (exam_id, sitting_id, kind) VALUES ({EXAM}, {SITTING}, 'extra_time');"
       f"INSERT INTO public.mock_exam_score_edits (sitting_id, skill, new_band, reason) "
       f"VALUES ({SITTING}, 'reading', 7.0, 'chấm lại');")
    pg(f"DELETE FROM public.mock_exam_sittings WHERE id = {SITTING};")
    assert one(pg, "SELECT count(*) || '|' || bool_and(sitting_id IS NULL) FROM public.mock_exam_events;") == "1|true"
    assert one(pg, "SELECT count(*) FROM public.mock_exam_score_edits;") == "0"
    pg(f"DELETE FROM public.mock_exams WHERE id = {EXAM};")
    assert one(pg, "SELECT count(*) FROM public.mock_exam_events;") == "0"


def test_rollbacks_guard_then_drop(pg):
    pg(UP447)
    pg(UP448)
    assert "448 is applied" in pg(DOWN447, check=False).stderr
    pg(f"INSERT INTO public.mock_exam_score_edits (sitting_id, skill, new_band, reason) "
       f"VALUES ({SITTING}, 'reading', 7.0, 'chấm lại');")
    assert "mock_exam_score_edits has rows" in pg(DOWN448, check=False).stderr
    pg("TRUNCATE public.mock_exam_score_edits;")
    pg("UPDATE public.mock_exam_sittings SET released_skills = ARRAY['reading'];")
    assert "partial releases" in pg(DOWN448, check=False).stderr
    pg("UPDATE public.mock_exam_sittings SET released_skills = '{}';")
    pg(DOWN448)
    pg(f"INSERT INTO public.mock_exam_events (exam_id, kind) VALUES ({EXAM}, 'room_opened');")
    assert "mock_exam_events has rows" in pg(DOWN447, check=False).stderr
    pg("TRUNCATE public.mock_exam_events;")
    pg("UPDATE public.mock_exam_sittings SET extra_seconds = '{\"reading\": 60}';")
    assert "extra time" in pg(DOWN447, check=False).stderr
    pg("UPDATE public.mock_exam_sittings SET extra_seconds = '{}';")
    pg(DOWN447)
    assert one(pg, "SELECT to_regclass('public.mock_exam_events') IS NULL;") == "t"
    pg(UP447)
    pg(UP448)  # re-applies cleanly


OLD = '{"listening": 6.0, "reading": 6.5, "writing": 6.0, "overall": 6.0}'
NEW = '{"listening": 6.0, "reading": 7.0, "writing": 6.0, "overall": 6.5}'


def _edit(expected=OLD, new=NEW, exam=EXAM):
    return (f"SELECT public.fn_mock_exam_score_edit({exam}, {SITTING}, 'reading', ' chấm sót câu 12 ', "
            f"NULL, '{expected}'::jsonb, '{new}'::jsonb)->>'final_bands';")


def test_score_edit_is_atomic_and_compare_and_set(pg):
    pg(UP447)
    pg(UP448)
    assert '"reading": 7.0' in one(pg, _edit(), role="service_role")
    assert one(pg, "SELECT skill || '|' || old_band || '|' || new_band || '|' || reason "
                   "FROM public.mock_exam_score_edits;") == "reading|6.5|7.0|chấm sót câu 12"
    assert one(pg, "SELECT kind || '|' || (payload->>'new_band') FROM public.mock_exam_events;") \
        == "score_edited|7.0"
    # The bands moved: the same request is a conflict, and nothing is logged twice.
    stale = pg(_edit(), check=False, role="service_role")
    assert stale.returncode != 0 and "mock_score_edit_conflict" in stale.stderr
    # A review that is not released cannot be edited; nor a sitting of another exam.
    pg("UPDATE public.mock_exam_reviews SET status = 'reviewed';")
    assert pg(_edit(expected=NEW), check=False).returncode != 0
    pg("UPDATE public.mock_exam_reviews SET status = 'released';")
    other = "'00000000-0000-0000-0000-0000000000e9'"
    assert pg(_edit(expected=NEW, exam=other), check=False).returncode != 0
    assert one(pg, "SELECT count(*) FROM public.mock_exam_score_edits;") == "1"
    for role in ("anon", "authenticated"):
        assert pg(_edit(expected=NEW), check=False, role=role).returncode != 0, role
