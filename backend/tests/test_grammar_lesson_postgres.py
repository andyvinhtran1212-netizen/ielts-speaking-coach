"""Execute migration312 and its authorization/persistence contract on local PG."""
import asyncio
import json
import os
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4

import asyncpg
import pytest

DB = os.environ.get("TEST_PG_URL", "")
SQL = (Path(__file__).resolve().parents[1] / "migrations/312_assigned_master30_grammar_lessons.sql").read_text()


async def run(sql, *args):
    connection = await asyncpg.connect(DB)
    try:
        if not args and ";" in sql:
            await connection.execute(sql)
            return []
        return await connection.fetch(sql, *args)
    finally:
        await connection.close()


def query(sql, *args):
    return asyncio.run(run(sql, *args))


@pytest.fixture(scope="module")
def probe():
    parsed = urlparse(DB)
    if parsed.scheme not in {"postgres", "postgresql"} or parsed.hostname not in {"localhost", "127.0.0.1", "::1"} or parsed.query:
        if os.environ.get("REQUIRE_PG") == "1":
            pytest.fail("Grammar lesson migration requires a LOCAL disposable PG URL")
        pytest.skip("Local PostgreSQL unavailable")
    s = "grammar_lesson_probe_" + uuid4().hex
    query("""DO $$ BEGIN
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
      END $$;""")
    try:
        query(f"""
          CREATE SCHEMA {s};
          GRANT USAGE ON SCHEMA {s} TO anon, authenticated, service_role;
          CREATE TABLE {s}.users(id uuid PRIMARY KEY);
          CREATE TABLE {s}.grammar_content_releases(id uuid PRIMARY KEY);
          CREATE TABLE {s}.students(id uuid PRIMARY KEY, user_id uuid);
          CREATE TABLE {s}.student_cohort_memberships(student_id uuid, cohort_id uuid, is_active boolean);
          CREATE TABLE {s}.class_assignments(id uuid PRIMARY KEY, cohort_id uuid, skill text,
            status text, publish_at timestamptz, due_at timestamptz, content_config jsonb);
          CREATE TABLE {s}.class_assignment_items(id uuid PRIMARY KEY, assignment_id uuid,
            student_id uuid, state text, opened_at timestamptz, submitted_at timestamptz,
            updated_at timestamptz, score numeric, artifact_kind text, artifact_id uuid, mastery jsonb);
          CREATE TABLE {s}.runtime_flags(key text PRIMARY KEY, enabled boolean, note text);
        """)
        migrated = SQL.replace("public.", s + ".").replace("auth.users", s + ".users").replace("search_path = public,", "search_path = " + s + ",")
        query(migrated)
        query(migrated)
        yield s
    finally:
        query(f"DROP SCHEMA IF EXISTS {s} CASCADE;")


def assigned(s):
    user, student, cohort, assignment, item, release = [uuid4() for _ in range(6)]
    config = dict(assignment_type="grammar_lesson", release_id=str(release), lesson_id="M30-B02",
                  content_version="v2", content_sha256="a" * 64, give_request_id=str(uuid4()))
    query(f"INSERT INTO {s}.users VALUES($1)", user)
    query(f"INSERT INTO {s}.students VALUES($1,$2)", student, user)
    query(f"INSERT INTO {s}.student_cohort_memberships VALUES($1,$2,true)", student, cohort)
    query(f"INSERT INTO {s}.grammar_content_releases VALUES($1)", release)
    query(f"INSERT INTO {s}.class_assignments VALUES($1,$2,'grammar','published',NULL,NULL,$3::jsonb)", assignment, cohort, json.dumps(config))
    query(f"INSERT INTO {s}.class_assignment_items(id,assignment_id,student_id,state) VALUES($1,$2,$3,'assigned')", item, assignment, student)
    snapshot = dict(lesson_id="M30-B02", version="v2", lesson_notes="Frozen teaching",
                    questions=[dict(id=f"q{n}", options=["correct", "wrong"], correct_index=0) for n in range(12)])
    return dict(user=user, student=student, cohort=cohort, assignment=assignment, item=item,
                release=release, config=config, snapshot=snapshot)


def start(s, a, snapshot=None):
    return query(f"SELECT * FROM {s}.create_assigned_grammar_lesson_attempt($1,$2,$3,'M30-B02','v2',$4,$5::jsonb)",
                 a["user"], a["item"], a["release"], "a" * 64, json.dumps(snapshot or a["snapshot"]))[0]


def answer(s, a, n, choice=0):
    return query(f"SELECT * FROM {s}.record_assigned_grammar_lesson_answer($1,$2,$3,$4)",
                 a["user"], a["item"], f"q{n}", choice)[0]


def test_start_retry_preserves_snapshot_and_terminal_ledger(probe):
    s = probe; a = assigned(s)
    first = start(s, a)
    changed = dict(a["snapshot"], lesson_notes="Changed later")
    assert start(s, a, changed)["id"] == first["id"]
    assert json.loads(first["content_snapshot"])["lesson_notes"] == "Frozen teaching"
    for n in range(12):
        result = answer(s, a, n, 1 if n == 0 else 0)
    assert result["status"] == "completed" and result["correct_count"] == 11
    assert result["completed_at"] is not None
    ledger = query(f"SELECT * FROM {s}.class_assignment_items WHERE id=$1", a["item"])[0]
    assert ledger["state"] == "submitted" and ledger["artifact_id"] == first["id"]
    assert ledger["artifact_kind"] == "grammar_lesson_attempt" and ledger["score"] is None
    assert json.loads(ledger["mastery"])["percent"] == 91.7
    assert answer(s, a, 0, 1)["completed_at"] == result["completed_at"]
    with pytest.raises(asyncpg.UniqueViolationError, match="answer_conflict"):
        answer(s, a, 0, 0)
    # Explicit repeat for the same learner/cohort is a fresh assignment, with
    # its own frozen teaching and no answers copied from the completed attempt.
    repeat = dict(a, assignment=uuid4(), item=uuid4())
    repeat_config = dict(a["config"], give_request_id=str(uuid4()))
    query(f"INSERT INTO {s}.class_assignments VALUES($1,$2,'grammar','published',NULL,NULL,$3::jsonb)", repeat["assignment"], a["cohort"], json.dumps(repeat_config))
    query(f"INSERT INTO {s}.class_assignment_items(id,assignment_id,student_id,state) VALUES($1,$2,$3,'assigned')", repeat["item"], repeat["assignment"], a["student"])
    fresh = start(s, repeat, changed)
    assert fresh["id"] != first["id"] and json.loads(fresh["answers"]) == {}
    assert fresh["status"] == "in_progress" and fresh["correct_count"] == 0
    assert json.loads(fresh["content_snapshot"])["lesson_notes"] == "Changed later"
    assert json.loads(start(s, a)["content_snapshot"])["lesson_notes"] == "Frozen teaching"


@pytest.mark.parametrize("field", ["assignment_type", "release_id", "lesson_id", "content_version", "content_sha256"])
def test_missing_config_fails_closed(probe, field):
    a = assigned(probe)
    query(f"UPDATE {probe}.class_assignments SET content_config=content_config-$2 WHERE id=$1", a["assignment"], field)
    with pytest.raises(asyncpg.PostgresError, match="grammar_lesson_not_(accessible|accepting)"):
        start(probe, a)
    assert query(f"SELECT id FROM {probe}.grammar_lesson_attempts WHERE class_assignment_item_id=$1", a["item"]) == []


def test_owner_membership_deadline_and_answer_validation(probe):
    s = probe; a = assigned(s)
    other = dict(a, user=uuid4())
    with pytest.raises(asyncpg.InsufficientPrivilegeError, match="not_accessible"):
        start(s, other)
    start(s, a)
    with pytest.raises(asyncpg.InvalidParameterValueError, match="invalid_answer"):
        answer(s, a, 0, 8)
    query(f"UPDATE {s}.class_assignments SET due_at=now()-interval '1 minute' WHERE id=$1", a["assignment"])
    with pytest.raises(asyncpg.ObjectNotInPrerequisiteStateError, match="not_accepting"):
        answer(s, a, 0)
    query(f"UPDATE {s}.student_cohort_memberships SET is_active=false WHERE student_id=$1", a["student"])
    with pytest.raises(asyncpg.InsufficientPrivilegeError, match="not_accessible"):
        start(s, a)


def test_roles_flag_and_assignment_idempotency(probe):
    s = probe; a = assigned(s)
    assert query(f"SELECT enabled FROM {s}.runtime_flags WHERE key='master30_grammar_lesson_assignments'")[0]["enabled"] is False
    for role in ("anon", "authenticated"):
        assert query("SELECT has_table_privilege($1,$2,'SELECT') allowed", role, f"{s}.grammar_lesson_attempts")[0]["allowed"] is False
        for signature in (f"{s}.create_assigned_grammar_lesson_attempt(uuid,uuid,uuid,text,text,text,jsonb)", f"{s}.record_assigned_grammar_lesson_answer(uuid,uuid,text,integer)"):
            assert query("SELECT has_function_privilege($1,$2,'EXECUTE') allowed", role, signature)[0]["allowed"] is False
    assert query("SELECT has_table_privilege('service_role',$1,'SELECT') allowed", f"{s}.grammar_lesson_attempts")[0]["allowed"] is True
    with pytest.raises(asyncpg.UniqueViolationError):
        query(f"INSERT INTO {s}.class_assignments VALUES($1,$2,'grammar','published',NULL,NULL,$3::jsonb)", uuid4(), a["cohort"], json.dumps(a["config"]))


def test_concurrent_start_and_answer_retry_are_atomic(probe):
    a = assigned(probe)
    async def concurrent_start():
        sql = f"SELECT * FROM {probe}.create_assigned_grammar_lesson_attempt($1,$2,$3,'M30-B02','v2',$4,$5::jsonb)"
        return await asyncio.gather(*(run(sql, a["user"], a["item"], a["release"], "a" * 64, json.dumps(a["snapshot"])) for _ in range(3)))
    starts = asyncio.run(concurrent_start())
    assert len({rows[0]["id"] for rows in starts}) == 1
    async def concurrent_answer():
        sql = f"SELECT * FROM {probe}.record_assigned_grammar_lesson_answer($1,$2,'q0',0)"
        return await asyncio.gather(*(run(sql, a["user"], a["item"]) for _ in range(3)))
    answers = asyncio.run(concurrent_answer())
    assert all(len(json.loads(rows[0]["answers"])) == 1 for rows in answers)
