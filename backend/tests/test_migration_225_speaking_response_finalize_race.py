"""Migration 225 preserves an admitted grade across concurrent finalization."""

from __future__ import annotations

import os
import re
import subprocess
import threading
import uuid
from pathlib import Path

import pytest


MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "migrations"
    / "225_allow_admitted_speaking_grade_after_submit.sql"
)
SQL = MIGRATION.read_text(encoding="utf-8")
_DB = os.environ.get("TEST_PG_URL", "postgres://localhost/postgres")


def _psql(sql: str) -> str:
    result = subprocess.run(
        ["psql", _DB, "-X", "-v", "ON_ERROR_STOP=1", "-tAq", "-c", sql],
        capture_output=True,
        text=True,
        timeout=60,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip())
    return result.stdout.strip()


def _have_pg() -> bool:
    try:
        return _psql("SELECT 1") == "1"
    except Exception:
        return False


if os.environ.get("REQUIRE_PG") == "1" and not _have_pg():
    raise RuntimeError(f"REQUIRE_PG=1 but PostgreSQL is unavailable at {_DB}")


def _function_sql() -> str:
    start = SQL.index("CREATE OR REPLACE FUNCTION")
    end = SQL.index("$$;", start) + len("$$;")
    body = SQL[start:end]
    return (
        body.replace(
            "public.fn_guard_speaking_response_mutation",
            "response_race_probe.fn_guard_speaking_response_mutation",
        )
        .replace("public.sessions", "response_race_probe.sessions")
        .replace("SET search_path = public", "SET search_path = response_race_probe")
    )


def test_forward_migration_keeps_new_requests_closed_but_allows_admitted_submit_race():
    assert "parent_status IS DISTINCT FROM 'in_progress'" in SQL
    assert "parent_status IS DISTINCT FROM 'submitted'" in SQL
    assert "parent_expiry IS NULL OR parent_expiry <= now()" in SQL
    assert "TG_OP = 'INSERT'" in SQL
    assert "DROP TABLE" not in SQL.upper()
    assert "DROP COLUMN" not in SQL.upper()


@pytest.mark.skipif(
    not _have_pg(), reason="PostgreSQL unavailable; CI runs this with REQUIRE_PG=1",
)
def test_admitted_grade_persists_after_submit_and_final_aggregate_completes():
    """Pause after admission, submit the parent, then release the grade INSERT."""
    session_id = uuid.uuid4()
    question_id = uuid.uuid4()
    response_id = uuid.uuid4()
    schema = f"""
        DROP SCHEMA IF EXISTS response_race_probe CASCADE;
        CREATE SCHEMA response_race_probe;
        CREATE TABLE response_race_probe.sessions (
            id uuid PRIMARY KEY,
            status text NOT NULL,
            resume_expires_at timestamptz NOT NULL,
            overall_band numeric
        );
        CREATE TABLE response_race_probe.responses (
            id uuid PRIMARY KEY,
            session_id uuid NOT NULL REFERENCES response_race_probe.sessions(id),
            question_id uuid NOT NULL,
            audio_url text,
            audio_storage_path text,
            transcript text,
            raw_transcript_text text,
            duration_seconds numeric,
            overall_band numeric NOT NULL
        );
        {_function_sql()}
        CREATE TRIGGER trg_guard_speaking_response_mutation
          BEFORE INSERT OR UPDATE ON response_race_probe.responses
          FOR EACH ROW EXECUTE FUNCTION
            response_race_probe.fn_guard_speaking_response_mutation();
        INSERT INTO response_race_probe.sessions
          (id, status, resume_expires_at)
        VALUES ('{session_id}', 'in_progress', now() + interval '1 hour');
    """
    _psql(schema)

    admitted = threading.Event()
    release_persistence = threading.Event()
    outcome: list[BaseException] = []

    def persist_admitted_grade() -> None:
        admitted.set()
        if not release_persistence.wait(timeout=10):
            outcome.append(TimeoutError("grade persistence was not released"))
            return
        try:
            _psql(
                "INSERT INTO response_race_probe.responses "
                "(id, session_id, question_id, transcript, overall_band) VALUES "
                f"('{response_id}', '{session_id}', '{question_id}', 'answer', 7.0)"
            )
        except BaseException as exc:
            outcome.append(exc)

    grader = threading.Thread(target=persist_admitted_grade, daemon=True)
    grader.start()
    assert admitted.wait(timeout=10)

    _psql(
        "UPDATE response_race_probe.sessions SET status='submitted' "
        f"WHERE id='{session_id}'"
    )
    release_persistence.set()
    grader.join(timeout=10)
    assert not grader.is_alive()
    assert outcome == []

    _psql(
        "UPDATE response_race_probe.sessions s SET status='completed', "
        "overall_band=(SELECT avg(r.overall_band) FROM "
        "response_race_probe.responses r WHERE r.session_id=s.id) "
        f"WHERE s.id='{session_id}'"
    )
    assert _psql(
        "SELECT status || '|' || round(overall_band, 1)::text || '|' || "
        "(SELECT count(*) FROM response_race_probe.responses r "
        "WHERE r.session_id=s.id)::text "
        f"FROM response_race_probe.sessions s WHERE id='{session_id}'"
    ) == "completed|7.0|1"


def test_verifier_requires_the_225_submitted_parent_clause():
    verifier = (
        Path(__file__).resolve().parents[1]
        / "scripts"
        / "verify_active_player_ttl_224.sql"
    ).read_text(encoding="utf-8")
    assert "parent_status IS DISTINCT FROM ''submitted''" in verifier
    statements = re.sub(r"--[^\n]*", "", verifier)
    assert not re.search(
        r"^\s*(?:INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|"
        r"GRANT|REVOKE)\b",
        statements,
        flags=re.IGNORECASE | re.MULTILINE,
    )
