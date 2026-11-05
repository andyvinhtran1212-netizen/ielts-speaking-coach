"""PC-J668: legacy timed Course attempts with ``pct`` but no ``next_action``.

Python reads such a row through ``_recorded_next_action`` and derives the
decision from ``pass_pct`` (a 75% attempt under ``pass_pct=80`` is a near-pass
``retake``).  Migrations 270 and 279 try to do the same, but guard the
derivation with ``v_prior_action NOT IN (...)``.  For a missing or JSON-null
``next_action`` that predicate is NULL, the derivation is skipped, and every
later ``IN`` / ``=`` check is NULL too.  The RPCs then treat the item as if no
attempt existed: a full ``run`` is admitted where only a short ``retake`` is
entitled, an old run tab created before the attempt can keep writing, and
the retake that the learner UI offers is refused.

The xfail cases assert the intended (Python-parity) contract and fail on the
current function bodies.  They become XPASS -> hard failure once the fix
lands, so the marker must be removed in the fix PR.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import uuid
from pathlib import Path

import pytest

from services import quiz_service


_MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"
_DB = os.environ.get("TEST_PG_URL", "postgres://localhost/postgres")
_SCHEMA_NAME = "null_next_action_probe_668"
_FIX_PENDING = (
    "PC-J668: 270/279 skip the pass_pct derivation when next_action is "
    "missing/NULL (NULL NOT IN (...)); fix needs a function-body migration "
    "(number not yet assigned by Leader)"
)


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

_needs_pg = pytest.mark.skipif(
    not _have_pg(), reason="local PostgreSQL is required for the real RPC probe",
)


def _function_sql(filename: str, marker: str) -> str:
    source = (_MIGRATIONS / filename).read_text(encoding="utf-8")
    start = source.index(marker)
    end = source.index("$$;", start) + len("$$;")
    return source[start:end].replace("public.", f"{_SCHEMA_NAME}.").replace(
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
    state TEXT NOT NULL DEFAULT 'opened',
    opened_at TIMESTAMPTZ,
    passed_at TIMESTAMPTZ,
    mastery JSONB,
    updated_at TIMESTAMPTZ
);
CREATE TABLE quiz_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    bank_id UUID NOT NULL,
    code TEXT,
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

# How the latest attempt stores its decision.  "missing" is the pre-6ee71c32c
# legacy shape; "json_null" is the same row after a JSON round-trip that kept
# the key.  "retake" is the control: an explicit decision the RPCs honour.
_LEGACY_SHAPES = {
    "missing": "",
    "json_null": ", 'next_action', NULL",
}


@pytest.fixture()
def probe():
    _psql(
        _SCHEMA
        + _function_sql(
            "270_atomic_timed_course_session_creation.sql",
            "CREATE FUNCTION public.quiz_start_timed_course_session",
        )
        + _function_sql(
            "279_reject_superseded_timed_course_progress.sql",
            "CREATE OR REPLACE FUNCTION public.quiz_insert_timed_course_attempts",
        )
    )
    try:
        yield
    finally:
        _psql(f"DROP SCHEMA IF EXISTS {_SCHEMA_NAME} CASCADE;", check=False)


def _seed_near_pass(next_action_sql: str, *, old_run_session: bool = False) -> dict:
    """One opened timed item whose latest completed attempt is 75% (pass=80)."""
    ids = {k: uuid.uuid4() for k in (
        "user", "student", "cohort", "bank", "assignment", "item", "session",
    )}
    old_session = f"""
    INSERT INTO quiz_sessions
        (id, user_id, bank_id, class_assignment_item_id, kind, created_at)
    VALUES ('{ids["session"]}', '{ids["user"]}', '{ids["bank"]}',
            '{ids["item"]}', 'run', clock_timestamp() - interval '2 minutes');
    """ if old_run_session else ""
    _psql(f"""
    SET search_path = {_SCHEMA_NAME};
    INSERT INTO quiz_banks VALUES ('{ids["bank"]}', 'course');
    INSERT INTO class_assignments VALUES (
        '{ids["assignment"]}', '{ids["cohort"]}', '{ids["bank"]}', 'course',
        'published', NULL, clock_timestamp() + interval '30 minutes',
        '{{"time_limit_minutes": 60, "pass_pct": 80}}'::jsonb
    );
    INSERT INTO students VALUES ('{ids["student"]}', '{ids["user"]}');
    INSERT INTO student_cohort_memberships
        VALUES ('{ids["student"]}', '{ids["cohort"]}', TRUE);
    INSERT INTO class_assignment_items
        (id, assignment_id, student_id, opened_at, mastery)
    VALUES (
        '{ids["item"]}', '{ids["assignment"]}', '{ids["student"]}',
        clock_timestamp() - interval '5 minutes',
        jsonb_build_object('attempts', jsonb_build_array(jsonb_build_object(
            'phase', 'run', 'pct', 75, 'completed', TRUE,
            'at', (clock_timestamp() - interval '1 minute')::text
            {next_action_sql}
        )))
    );
    {old_session}
    """)
    return ids


def _start(ids: dict, kind: str) -> subprocess.CompletedProcess[str]:
    return _psql(
        f"SELECT session_id FROM {_SCHEMA_NAME}.quiz_start_timed_course_session("
        f"'{ids['item']}', '{ids['user']}', '{ids['bank']}', NULL, "
        f"'{kind}', TRUE);",
        check=False,
    )


def _write_progress(ids: dict) -> subprocess.CompletedProcess[str]:
    payload = (
        "jsonb_build_array(jsonb_build_object("
        f"'client_id', '{uuid.uuid4()}', 'item_key', 'q1', 'qid', 'q1', "
        "'skill', 'grammar', 'type', 'mcq', 'subtype', 'midterm', "
        "'is_correct', TRUE, 'answer_given', '0', "
        "'response_time_ms', 1000, 'attempt_no', 1))"
    )
    return _psql(
        f"SELECT count(*) FROM {_SCHEMA_NAME}.quiz_insert_timed_course_attempts("
        f"'{ids['session']}', '{ids['user']}', {payload});",
        check=False,
    )


def _session_count() -> int:
    return int(_psql(
        f"SELECT count(*) FROM {_SCHEMA_NAME}.quiz_sessions;"
    ).stdout.strip())


def test_python_reader_derives_retake_for_the_legacy_row():
    """The contract the SQL must mirror: legacy rows derive from pass_pct."""
    attempt = {"phase": "run", "pct": 75, "completed": True, "at": "x"}
    assert quiz_service._recorded_next_action(attempt, 80) == "retake"
    assert quiz_service._recorded_next_action(
        {**attempt, "next_action": None}, 80,
    ) == "retake"


@_needs_pg
def test_control_explicit_retake_blocks_a_full_run(probe):
    ids = _seed_near_pass(", 'next_action', 'retake'")
    result = _start(ids, "run")
    assert result.returncode != 0
    assert "timed_course_session_not_entitled" in result.stderr
    assert _session_count() == 0


@_needs_pg
@pytest.mark.xfail(strict=True, reason=_FIX_PENDING)
@pytest.mark.parametrize("shape", sorted(_LEGACY_SHAPES))
def test_start_rpc_refuses_full_run_after_legacy_near_pass(probe, shape):
    ids = _seed_near_pass(_LEGACY_SHAPES[shape])
    result = _start(ids, "run")
    assert result.returncode != 0, (
        f"full run admitted after a near-pass, session {result.stdout.strip()}"
    )
    assert "timed_course_session_not_entitled" in result.stderr
    assert _session_count() == 0


@_needs_pg
@pytest.mark.xfail(strict=True, reason=_FIX_PENDING)
@pytest.mark.parametrize("shape", sorted(_LEGACY_SHAPES))
def test_start_rpc_admits_the_retake_python_offers(probe, shape):
    ids = _seed_near_pass(_LEGACY_SHAPES[shape])
    result = _start(ids, "retake")
    assert result.returncode == 0, result.stderr.strip()
    assert _session_count() == 1


@_needs_pg
@pytest.mark.xfail(strict=True, reason=_FIX_PENDING)
@pytest.mark.parametrize("shape", sorted(_LEGACY_SHAPES))
def test_progress_rpc_rejects_old_run_tab_after_legacy_near_pass(probe, shape):
    ids = _seed_near_pass(_LEGACY_SHAPES[shape], old_run_session=True)
    result = _write_progress(ids)
    assert result.returncode != 0, "old run tab wrote progress after a near-pass"
    assert "timed_course_progress_not_entitled" in result.stderr
