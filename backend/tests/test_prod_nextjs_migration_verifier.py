"""Contracts for the read-only production 213-225 postcondition verifier."""

import importlib.util
from pathlib import Path
import re
import subprocess

import pytest


BACKEND_ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = BACKEND_ROOT / "scripts" / "verify_prod_nextjs_migrations.py"
VERIFY_PATH = BACKEND_ROOT / "scripts" / "verify_prod_nextjs_migrations_213_225.sql"
AFFINITY_VERIFY_PATH = BACKEND_ROOT / "scripts" / "verify_staging_nextjs_reconcile.sql"
TTL_VERIFY_PATH = BACKEND_ROOT / "scripts" / "verify_active_player_ttl_224.sql"

_SPEC = importlib.util.spec_from_file_location(
    "prod_nextjs_migration_verifier",
    SCRIPT_PATH,
)
assert _SPEC and _SPEC.loader
VERIFIER = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(VERIFIER)


def _pooler_url() -> str:
    return (
        "postgresql://postgres."
        f"{VERIFIER.PRODUCTION_PROJECT_REF}:secret@"
        f"{next(iter(VERIFIER.PRODUCTION_POOLER_HOSTS))}/postgres"
    )


def test_target_pin_accepts_only_exact_production_url_shapes():
    VERIFIER._assert_production_target(_pooler_url())
    VERIFIER._assert_production_target(
        "postgresql://postgres:secret@db."
        f"{VERIFIER.PRODUCTION_PROJECT_REF}.supabase.co/postgres"
    )

    for spoofed in (
        "postgresql://postgres:secret@production.example/postgres",
        "postgresql://postgres."
        f"{VERIFIER.PRODUCTION_PROJECT_REF}:secret@production.example/postgres",
        "postgresql://postgres:password-"
        f"{VERIFIER.PRODUCTION_PROJECT_REF}@production.example/postgres",
    ):
        with pytest.raises(VERIFIER.VerificationError, match="pinned production"):
            VERIFIER._assert_production_target(spoofed)


def test_verify_refuses_wrong_target_before_starting_psql(monkeypatch):
    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *_args, **_kwargs: pytest.fail("must refuse before database access"),
    )
    with pytest.raises(VERIFIER.VerificationError, match="pinned production"):
        VERIFIER.verify("postgresql://postgres:secret@production.example/postgres")


def test_verify_invokes_only_the_pinned_read_only_sql(monkeypatch):
    calls = []

    def capture(command, **kwargs):
        calls.append((command, kwargs))

    monkeypatch.setattr(subprocess, "run", capture)
    VERIFIER.verify(_pooler_url())

    assert len(calls) == 1
    command, kwargs = calls[0]
    assert command[0] == "psql"
    assert "-X" in command
    assert command[-2:] == ["-f", str(VERIFY_PATH)]
    assert kwargs == {"check": True, "text": True}


def test_sql_is_read_only_and_covers_the_exact_forward_gap():
    sql = VERIFY_PATH.read_text(encoding="utf-8")
    affinity_sql = AFFINITY_VERIFY_PATH.read_text(encoding="utf-8")
    assert "BEGIN TRANSACTION READ ONLY" in sql
    assert "\\ir verify_staging_nextjs_reconcile.sql" in sql
    assert "\\ir verify_active_player_ttl_224.sql" in sql
    assert "\\set REQUIRE_GAP_CLOSED 0" in sql
    assert "\\set REQUIRE_ACTIVE_PLAYER_TTL 1" in sql
    assert "verified Next.js migration contracts 215-221" in affinity_sql
    assert "renderer_columns_ready boolean := true" in affinity_sql
    assert "IF renderer_columns_ready THEN" in affinity_sql
    assert "aver.verify_active_player_ttl_contract" in affinity_sql
    assert "post_224_body_md5" in affinity_sql
    assert "dictation_attempt_resume_expiry_within_ttl" in affinity_sql
    assert "con.contype <> 'n'" in affinity_sql

    expected = [
        f"{number}_{suffix}"
        for number, suffix in (
            (213, "mock_collection_flush_ack.sql"),
            (214, "mock_collection_sweep_completion.sql"),
            (215, "speaking_session_renderer_affinity.sql"),
            (216, "version_session_renderer_affinity_create.sql"),
            (217, "backfill_renderer_affinity_migration_gap.sql"),
            (218, "reading_attempt_renderer_affinity.sql"),
            (219, "listening_attempt_renderer_affinity.sql"),
            (220, "dictation_attempt_affinity.sql"),
            (221, "writing_assignment_renderer_affinity.sql"),
            (222, "course_pronunciation_submissions.sql"),
            (223, "course_pronunciation_service_role_grants.sql"),
            (224, "active_player_resume_ttl.sql"),
            (225, "allow_admitted_speaking_grade_after_submit.sql"),
        )
    ]
    assert re.findall(r"'((?:21[3-9]|22[0-5])_[^']+\.sql)'", sql) == expected
    assert "direct-client-table-grant" in sql
    assert "service-role-" in sql
    assert "unexpected-client-policy" in sql
    assert re.search(
        r"\('course_pronunciation_submissions',\s*"
        r"'5dba1a9cdba1722d03789db62a08b185', 21,\s*"
        r"'033f197219448de8299798632d1d4e4d', 10\)",
        sql,
    ), "post-226 duration_sec must be part of the exact production fingerprint"

    for source in (sql, affinity_sql, TTL_VERIFY_PATH.read_text(encoding="utf-8")):
        statements = re.sub(r"--[^\n]*", "", source)
        assert not re.search(
            r"^\s*(?:INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|"
            r"GRANT|REVOKE)\b",
            statements,
            flags=re.IGNORECASE | re.MULTILINE,
        )


def test_main_redacts_database_url_when_psql_fails(monkeypatch, capsys):
    secret_url = _pooler_url().replace(":secret@", ":top-secret@")

    def fail(_database_url):
        raise subprocess.CalledProcessError(7, ["psql", secret_url])

    monkeypatch.setattr(VERIFIER, "verify", fail)
    assert VERIFIER.main(["verify", secret_url]) == 1
    output = capsys.readouterr().err
    assert "status 7" in output
    assert "top-secret" not in output
