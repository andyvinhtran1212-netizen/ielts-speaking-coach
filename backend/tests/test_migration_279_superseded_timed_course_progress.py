"""Executable regression for migration 279's current-generation progress gate."""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import uuid
from pathlib import Path

import pytest


_MIG = (
    Path(__file__).resolve().parents[1]
    / "migrations"
    / "279_reject_superseded_timed_course_progress.sql"
)
_DB = os.environ.get("TEST_PG_URL", "postgres://localhost/postgres")
_SCHEMA_NAME = "progress_probe_279"


def _psql(sql: str, *, check: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        ["psql", _DB, "-v", "ON_ERROR_STOP=1", "-At", "-c", sql],
        check=False,
        capture_output=True,
        text=True,
    )
    if check and result.returncode:
        raise RuntimeError(result.stderr.strip())
    return result


def _have_pg() -> bool:
    if not shutil.which("psql"):
        return False
    try:
        return _psql("SELECT 1;").stdout.strip() == "1"
    except Exception:
        return False


if os.environ.get("REQUIRE_PG") == "1" and not _have_pg():
    raise RuntimeError(f"REQUIRE_PG=1 but PostgreSQL is unavailable at {_DB}")

pytestmark = pytest.mark.skipif(
    not _have_pg(), reason="local PostgreSQL is required for the real RPC probe",
)


def _function_sql() -> str:
    source = _MIG.read_text(encoding="utf-8")
    start = source.index(
        "CREATE OR REPLACE FUNCTION public.quiz_insert_timed_course_attempts"
    )
    end = source.index("$$;", start) + len("$$;")
    body = source[start:end]
    return body.replace("public.", f"{_SCHEMA_NAME}.").replace(
        "SET search_path = public", f"SET search_path = {_SCHEMA_NAME}",
    )


_SCHEMA = f"""
DROP SCHEMA IF EXISTS {_SCHEMA_NAME} CASCADE;
CREATE SCHEMA {_SCHEMA_NAME};
SET search_path = {_SCHEMA_NAME};

CREATE TABLE quiz_banks (id UUID PRIMARY KEY, skill_area TEXT NOT NULL);
CREATE TABLE class_assignments (
    id UUID PRIMARY KEY,
    cohort_id UUID NOT NULL,
    content_id UUID NOT NULL,
    skill TEXT NOT NULL,
    status TEXT NOT NULL,
    publish_at TIMESTAMPTZ,
    due_at TIMESTAMPTZ,
    content_config JSONB NOT NULL
);
CREATE TABLE students (id UUID PRIMARY KEY, user_id UUID NOT NULL);
CREATE TABLE student_cohort_memberships (
    student_id UUID NOT NULL,
    cohort_id UUID NOT NULL,
    is_active BOOLEAN NOT NULL
);
CREATE TABLE class_assignment_items (
    id UUID PRIMARY KEY,
    assignment_id UUID NOT NULL,
    student_id UUID NOT NULL,
    opened_at TIMESTAMPTZ,
    passed_at TIMESTAMPTZ,
    mastery JSONB
);
CREATE TABLE quiz_sessions (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    bank_id UUID NOT NULL,
    class_assignment_item_id UUID NOT NULL,
    kind TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    ended_at TIMESTAMPTZ,
    ended_by TEXT
);
CREATE TABLE quiz_attempts (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL,
    session_id UUID NOT NULL,
    bank_id UUID NOT NULL,
    client_id UUID UNIQUE,
    item_key TEXT,
    qid TEXT,
    skill TEXT,
    type TEXT,
    subtype TEXT,
    is_correct BOOLEAN,
    answer_given TEXT,
    response_time_ms INTEGER,
    attempt_no INTEGER,
    created_at TIMESTAMPTZ
);
"""


@pytest.fixture()
def progress_probe():
    _psql(_SCHEMA + _function_sql())
    try:
        yield
    finally:
        _psql(f"DROP SCHEMA IF EXISTS {_SCHEMA_NAME} CASCADE;", check=False)


def test_old_run_cannot_write_after_near_pass_but_current_retake_can(progress_probe):
    user_id, student_id, cohort_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    bank_id, assignment_id, item_id, session_id = (
        uuid.uuid4(), uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    )
    stale_client, current_client = uuid.uuid4(), uuid.uuid4()
    setup = f"""
    SET search_path = {_SCHEMA_NAME};
    INSERT INTO quiz_banks VALUES ('{bank_id}', 'course');
    INSERT INTO class_assignments VALUES (
        '{assignment_id}', '{cohort_id}', '{bank_id}', 'course', 'published',
        NULL, clock_timestamp() + interval '30 minutes',
        '{{"time_limit_minutes": 60, "pass_pct": 80}}'::jsonb
    );
    INSERT INTO students VALUES ('{student_id}', '{user_id}');
    INSERT INTO student_cohort_memberships
        VALUES ('{student_id}', '{cohort_id}', TRUE);
    INSERT INTO class_assignment_items
        (id, assignment_id, student_id, opened_at, mastery)
    VALUES (
        '{item_id}', '{assignment_id}', '{student_id}',
        clock_timestamp() - interval '5 minutes',
        jsonb_build_object('attempts', jsonb_build_array(jsonb_build_object(
            'phase', 'run', 'pct', 75, 'completed', TRUE,
            'next_action', 'retake',
            'at', (clock_timestamp() - interval '1 minute')::text
        )))
    );
    INSERT INTO quiz_sessions
        (id, user_id, bank_id, class_assignment_item_id, kind, created_at)
    VALUES (
        '{session_id}', '{user_id}', '{bank_id}', '{item_id}', 'run',
        clock_timestamp() - interval '2 minutes'
    );
    """
    _psql(setup)

    payload = (
        "jsonb_build_array(jsonb_build_object("
        "'client_id', '{client}', 'item_key', 'q1', 'qid', 'q1', "
        "'skill', 'grammar', 'type', 'mcq', 'subtype', 'midterm', "
        "'is_correct', TRUE, 'answer_given', '0', "
        "'response_time_ms', 1000, 'attempt_no', 1))"
    )
    stale = _psql(
        f"SELECT count(*) FROM {_SCHEMA_NAME}.quiz_insert_timed_course_attempts("
        f"'{session_id}', '{user_id}', {payload.format(client=stale_client)});",
        check=False,
    )
    assert stale.returncode != 0
    assert "timed_course_progress_not_entitled" in stale.stderr
    assert _psql(
        f"SELECT count(*) FROM {_SCHEMA_NAME}.quiz_attempts;"
    ).stdout.strip() == "0"

    _psql(
        f"UPDATE {_SCHEMA_NAME}.quiz_sessions "
        "SET kind = 'retake', created_at = clock_timestamp() "
        f"WHERE id = '{session_id}';"
    )
    accepted = _psql(
        f"SELECT count(*) FROM {_SCHEMA_NAME}.quiz_insert_timed_course_attempts("
        f"'{session_id}', '{user_id}', {payload.format(client=current_client)});"
    )
    assert accepted.stdout.strip() == "1"
    assert _psql(
        f"SELECT count(*) FROM {_SCHEMA_NAME}.quiz_attempts;"
    ).stdout.strip() == "1"


def test_progress_gate_mirrors_full_retry_generation_boundaries():
    sql = _MIG.read_text(encoding="utf-8")
    assert "v_session_kind = 'run'" in sql
    assert "v_prior_action IN ('retake', 'passed', 'timed_out')" in sql
    assert "v_prior_action = 'retry_full'" in sql
    assert "v_session_created_at < v_latest_at" in sql
    assert "v_session_created_at < v_generation_started_at" in sql
    assert re.search(r"FOR UPDATE OF qs, cai, ca, scm", sql)
    assert "TO service_role" in sql
