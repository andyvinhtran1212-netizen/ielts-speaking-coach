"""Execute migration 295 and its immutable package contract on disposable PG."""

from __future__ import annotations

import json
import os
import shutil
from pathlib import Path
from uuid import uuid4

import pytest

from test_migration_240_core_attempt_evidence import psql


SQL = (
    Path(__file__).resolve().parents[1]
    / "migrations"
    / "295_listening_content_programmes.sql"
).read_text(encoding="utf-8")


def _literal(value: object) -> str:
    return "'" + str(value).replace("'", "''") + "'"


@pytest.fixture(scope="module")
def programme_probe():
    try:
        available = shutil.which("psql") and psql("SELECT 1") == "1"
    except Exception:
        available = False
    if not available:
        if os.environ.get("REQUIRE_PG") == "1":
            pytest.fail("Local PostgreSQL required for migration 295 verification")
        pytest.skip("Local PostgreSQL unavailable")

    schema = "listening_programme_probe_" + uuid4().hex
    psql(
        """DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
        END $$;"""
    )
    psql(f"CREATE SCHEMA {schema}")
    migrated = SQL.replace("public.", f"{schema}.").replace(
        "search_path = public,", f"search_path = {schema},"
    )
    try:
        psql(
            f"""
            CREATE TABLE {schema}.users (id UUID PRIMARY KEY);
            CREATE TABLE {schema}.listening_tests (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                test_id TEXT NOT NULL UNIQUE,
                title TEXT NOT NULL,
                version TEXT NOT NULL DEFAULT '1.0',
                metadata JSONB NOT NULL DEFAULT '{{}}'::JSONB,
                status TEXT NOT NULL DEFAULT 'draft',
                test_type TEXT NOT NULL DEFAULT 'practice',
                is_public BOOLEAN NOT NULL DEFAULT FALSE,
                full_audio_storage_path TEXT,
                full_audio_duration_seconds INTEGER,
                full_audio_size_bytes INTEGER,
                audio_assembly_mode TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            CREATE TABLE {schema}.listening_content (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                source_type TEXT NOT NULL,
                audio_storage_path TEXT,
                audio_duration_seconds INTEGER NOT NULL,
                audio_size_bytes INTEGER NOT NULL,
                accent_tag TEXT NOT NULL,
                topic_tags TEXT[] NOT NULL DEFAULT '{{}}',
                transcript TEXT NOT NULL,
                transcript_segments JSONB NOT NULL DEFAULT '[]'::JSONB,
                status TEXT NOT NULL DEFAULT 'draft',
                title TEXT NOT NULL,
                description TEXT,
                test_id UUID REFERENCES {schema}.listening_tests(id) ON DELETE CASCADE,
                section_num INTEGER,
                metadata JSONB NOT NULL DEFAULT '{{}}'::JSONB,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            CREATE TABLE {schema}.listening_exercises (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                content_id UUID NOT NULL REFERENCES {schema}.listening_content(id) ON DELETE CASCADE,
                exercise_type TEXT NOT NULL,
                payload JSONB NOT NULL DEFAULT '{{}}'::JSONB,
                order_num INTEGER NOT NULL DEFAULT 1,
                status TEXT NOT NULL DEFAULT 'draft',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            CREATE TABLE {schema}.listening_test_attempts (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID NOT NULL,
                score NUMERIC,
                band_estimate NUMERIC,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
        psql(migrated)
        psql(migrated)

        package = {
            "package_id": "fixture-general-v1",
            "programme_id": "general-listening-practice",
            "title": "Fixture programme",
            "manifest_sha256": "a" * 64,
            "source_counts": {
                "lessons": 1,
                "forms": 1,
                "items": 1,
                "stimuli": 1,
                "timing_segments": 1,
            },
            "validation_summary": {"errors": 0},
            "transform_version": "fixture-v1",
        }
        lessons = [{
            "source_lesson_id": "lesson-1",
            "title": "Lesson 1",
            "sequence_num": 1,
        }]
        stimuli = [{
            "source_stimulus_id": "stimulus-1",
            "source_audio_path": "audio/one.wav",
            "source_timing_path": "timing/one.json",
            "source_audio_sha256": "b" * 64,
            "source_timing_sha256": "c" * 64,
            "controlled_transcript_sha256": "d" * 64,
            "duration_seconds": 2,
            "metadata": {"timing_segment_count": 1},
        }]
        forms = [{
            "test_id": "pkg-fixture-form-1",
            "source_lesson_id": "lesson-1",
            "source_form_id": "form-1",
            "title": "Form 1",
            "audio_storage_path": "packages/form-1.wav",
            "audio_duration_seconds": 2,
            "audio_size_bytes": 64,
            "purpose": "practice",
            "replay_policy": "allowed",
            "support_policy": "available",
            "claim_policy": "report_only",
            "item_count": 1,
            "exercise_payload": {"variant": "programme_form_v1"},
            "stimuli": [{
                "source_stimulus_id": "stimulus-1",
                "sequence_num": 1,
                "derived_offset_seconds": 0,
                "derived_end_seconds": 2,
            }],
        }]
        args = ",".join(
            _literal(json.dumps(value, separators=(",", ":"))) + "::JSONB"
            for value in (package, lessons, stimuli, forms)
        )
        assert psql(
            f"SELECT action FROM {schema}.import_listening_content_package_atomic({args})"
        ) == "created"
        assert psql(
            f"SELECT action FROM {schema}.import_listening_content_package_atomic({args})"
        ) == "reused"
        yield schema
    finally:
        psql(f"DROP SCHEMA {schema} CASCADE")


@pytest.mark.parametrize(
    "mutation",
    [
        "INSERT INTO {schema}.listening_content_packages (package_id,programme_id,title,manifest_sha256,transform_version) VALUES ('rogue','general-listening-practice','Rogue','eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee','v1')",
        "UPDATE {schema}.listening_content_packages SET title='tampered' WHERE package_id='fixture-general-v1'",
        "UPDATE {schema}.listening_lessons SET title='tampered' WHERE source_lesson_id='lesson-1'",
        "UPDATE {schema}.listening_package_stimuli SET metadata='{{}}'::JSONB WHERE source_stimulus_id='stimulus-1'",
        "UPDATE {schema}.listening_form_stimuli SET metadata='{{\"tampered\":true}}'::JSONB",
        "UPDATE {schema}.listening_tests SET title='tampered' WHERE source_form_id='form-1'",
        "UPDATE {schema}.listening_content SET transcript='tampered' WHERE title='Form 1'",
        "UPDATE {schema}.listening_exercises SET payload='{{}}'::JSONB",
        "INSERT INTO {schema}.listening_exercises (content_id,exercise_type,payload) SELECT id,'programme_form','{{}}'::JSONB FROM {schema}.listening_content LIMIT 1",
        "DELETE FROM {schema}.listening_tests WHERE source_form_id='form-1'",
    ],
)
def test_package_rows_reject_generic_mutations(programme_probe: str, mutation: str):
    with pytest.raises(RuntimeError, match="listening_package_(child_)?immutable"):
        psql(mutation.format(schema=programme_probe))


def test_manifest_bound_publish_and_archive_remain_atomic(programme_probe: str):
    manifest = "a" * 64
    publish = psql(
        f"SELECT status FROM {programme_probe}.set_listening_content_package_status("
        f"'fixture-general-v1','{manifest}','publish',NULL)"
    )
    assert publish == "published"
    assert psql(
        f"SELECT string_agg(DISTINCT status, ',') FROM {programme_probe}.listening_tests"
    ) == "published"
    assert psql(
        f"SELECT bool_and(is_public) FROM {programme_probe}.listening_tests"
    ) == "t"

    archive = psql(
        f"SELECT status FROM {programme_probe}.set_listening_content_package_status("
        f"'fixture-general-v1','{manifest}','archive',NULL)"
    )
    assert archive == "archived"
    assert psql(
        f"SELECT string_agg(DISTINCT status, ',') FROM {programme_probe}.listening_exercises"
    ) == "archived"
    assert psql(
        f"SELECT bool_or(is_public) FROM {programme_probe}.listening_tests"
    ) == "f"
