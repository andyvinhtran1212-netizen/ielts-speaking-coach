"""Execute reveal ledger migration on a disposable local PostgreSQL schema."""

from __future__ import annotations

import json
import os
import shutil
from pathlib import Path
from uuid import uuid4

import pytest

from test_migration_240_core_attempt_evidence import psql


SQL = (Path(__file__).resolve().parents[1] / "migrations"
       / "296_listening_programme_feedback_reveals.sql").read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def reveal_probe():
    try:
        available = shutil.which("psql") and psql("SELECT 1") == "1"
    except Exception:
        available = False
    if not available:
        if os.environ.get("REQUIRE_PG") == "1":
            pytest.fail("Local PostgreSQL required for migration 296 verification")
        pytest.skip("Local PostgreSQL unavailable")

    schema = "listening_feedback_probe_" + uuid4().hex
    psql("""DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
    END $$;""")
    psql(f"CREATE SCHEMA {schema}")
    psql(f"GRANT USAGE ON SCHEMA {schema} TO service_role, authenticated")
    migrated = SQL.replace("public.", f"{schema}.").replace(
        "search_path = public,", f"search_path = {schema},"
    )
    try:
        psql(f"""
            CREATE TABLE {schema}.users (id UUID PRIMARY KEY);
            CREATE TABLE {schema}.listening_content_packages (
                id UUID PRIMARY KEY, status TEXT NOT NULL);
            CREATE TABLE {schema}.listening_tests (
                id UUID PRIMARY KEY, content_package_id UUID,
                scoring_policy TEXT, programme_id TEXT, status TEXT,
                is_public BOOLEAN);
            CREATE TABLE {schema}.listening_test_attempts (
                id UUID PRIMARY KEY, test_id UUID, user_id UUID, status TEXT,
                scoring_policy TEXT, class_assignment_item_id UUID, sitting_id UUID,
                resume_expires_at TIMESTAMPTZ, answers JSONB NOT NULL);
            CREATE TABLE {schema}.listening_content (
                id UUID PRIMARY KEY, test_id UUID, status TEXT);
            CREATE TABLE {schema}.listening_exercises (
                id UUID PRIMARY KEY, content_id UUID, status TEXT,
                payload JSONB NOT NULL);
        """)
        psql(migrated)
        psql(migrated)
        owner, other, package, test, attempt, content, exercise = [
            str(uuid4()) for _ in range(7)
        ]
        payload = json.dumps({
            "variant": "programme_form_v1",
            "questions": [{"q_num": 1, "response_type": "single_choice"}],
        }).replace("'", "''")
        psql(f"""
            INSERT INTO {schema}.users VALUES ('{owner}'), ('{other}');
            INSERT INTO {schema}.listening_content_packages
                VALUES ('{package}', 'published');
            INSERT INTO {schema}.listening_tests VALUES (
                '{test}', '{package}', 'report_only',
                'general-listening-practice', 'published', TRUE);
            INSERT INTO {schema}.listening_test_attempts VALUES (
                '{attempt}', '{test}', '{owner}', 'in_progress',
                'report_only', NULL, NULL, NOW() + INTERVAL '1 hour',
                '[{{"q_num":1,"user_answer":"A"}}]'::JSONB);
            INSERT INTO {schema}.listening_content
                VALUES ('{content}', '{test}', 'published');
            INSERT INTO {schema}.listening_exercises VALUES (
                '{exercise}', '{content}', 'published', '{payload}'::JSONB);
        """)
        yield {"schema": schema, "owner": owner, "other": other,
               "attempt": attempt, "test": test}
    finally:
        psql(f"DROP SCHEMA {schema} CASCADE")


def _record(probe: dict[str, str], *, user: str | None = None, q_num: int = 1):
    schema, attempt = probe["schema"], probe["attempt"]
    return psql(
        f"SELECT row_to_json(row)::TEXT FROM {schema}."
        "fn_record_listening_programme_feedback_reveal("
        f"'{attempt}','{user or probe['owner']}',{q_num}) AS row"
    )


def test_reveal_snapshots_first_answer_and_retries_are_idempotent(reveal_probe):
    first = json.loads(_record(reveal_probe))
    assert first["first_answer"] == "A"
    assert first["was_created"] is True
    schema, attempt = reveal_probe["schema"], reveal_probe["attempt"]
    psql(f"UPDATE {schema}.listening_test_attempts SET answers="
         "'[{\"q_num\":1,\"user_answer\":\"B\"}]'::JSONB "
         f"WHERE id='{attempt}'")
    second = json.loads(_record(reveal_probe))
    assert second["first_answer"] == "A"
    assert second["revealed_at"] == first["revealed_at"]
    assert second["was_created"] is False
    assert psql(f"SELECT count(*) FROM {schema}.listening_programme_feedback_reveals") == "1"
    assert psql(
        "SET ROLE service_role; "
        f"SELECT first_answer FROM {schema}.fn_record_listening_programme_feedback_reveal("
        f"'{attempt}','{reveal_probe['owner']}',1)"
    ) == "A"
    with pytest.raises(RuntimeError, match="permission denied"):
        psql(f"SET ROLE authenticated; SELECT * FROM {schema}."
             "listening_programme_feedback_reveals")
    with pytest.raises(RuntimeError, match="permission denied"):
        psql(f"SET ROLE authenticated; SELECT * FROM {schema}."
             "fn_record_listening_programme_feedback_reveal("
             f"'{attempt}','{reveal_probe['owner']}',1)")
    with pytest.raises(RuntimeError, match="listening_programme_feedback_reveal_immutable"):
        psql(f"UPDATE {schema}.listening_programme_feedback_reveals "
             "SET first_answer='B'")


def test_reveal_rejects_other_owner_invalid_question_and_closed_attempt(reveal_probe):
    with pytest.raises(RuntimeError, match="listening_programme_feedback_not_available"):
        _record(reveal_probe, user=reveal_probe["other"])
    with pytest.raises(RuntimeError, match="listening_programme_feedback_question_not_found"):
        _record(reveal_probe, q_num=2)
    schema, attempt = reveal_probe["schema"], reveal_probe["attempt"]
    psql(f"UPDATE {schema}.listening_test_attempts SET status='submitted' "
         f"WHERE id='{attempt}'")
    with pytest.raises(RuntimeError, match="listening_programme_feedback_attempt_closed"):
        _record(reveal_probe)
