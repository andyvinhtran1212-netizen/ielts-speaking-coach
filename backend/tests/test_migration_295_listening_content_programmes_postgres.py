"""Execute migration 295 and its immutable package contract on disposable PG."""

from __future__ import annotations

import asyncio
import json
import os
import shutil
from pathlib import Path
from uuid import uuid4

import asyncpg
import pytest

from test_migration_240_core_attempt_evidence import psql


SQL = (
    Path(__file__).resolve().parents[1]
    / "migrations"
    / "295_listening_content_programmes.sql"
).read_text(encoding="utf-8")
DB = os.environ.get("TEST_PG_URL", "")


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
                test_id UUID NOT NULL REFERENCES {schema}.listening_tests(id),
                user_id UUID NOT NULL REFERENCES {schema}.users(id),
                status TEXT NOT NULL DEFAULT 'in_progress',
                answers JSONB NOT NULL DEFAULT '[]'::JSONB,
                score NUMERIC,
                band_estimate NUMERIC,
                started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                submitted_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                resume_expires_at TIMESTAMPTZ NOT NULL
                    DEFAULT (NOW() + INTERVAL '24 hours'),
                renderer_affinity TEXT DEFAULT 'legacy',
                class_assignment_item_id UUID,
                sitting_id UUID
            );
            INSERT INTO {schema}.listening_tests (test_id, title)
            VALUES ('legacy-ielts-fixture', 'Legacy IELTS fixture');
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
        created_action = psql(
            f"SELECT action FROM {schema}.import_listening_content_package_atomic({args})"
        )
        reused_action = psql(
            f"SELECT action FROM {schema}.import_listening_content_package_atomic({args})"
        )
        yield {
            "schema": schema,
            "args": args,
            "created_action": created_action,
            "reused_action": reused_action,
            "package": package,
            "lessons": lessons,
            "stimuli": stimuli,
            "forms": forms,
        }
    finally:
        psql(f"DROP SCHEMA {schema} CASCADE")


def test_atomic_import_retry_is_idempotent_and_identity_conflicts_fail_closed(
    programme_probe: dict[str, object],
):
    schema = str(programme_probe["schema"])
    assert programme_probe["created_action"] == "created"
    assert programme_probe["reused_action"] == "reused"
    assert psql(
        f"SELECT action FROM {schema}.import_listening_content_package_atomic("
        f"{programme_probe['args']})"
    ) == "reused"

    counts = psql(
        f"""
        SELECT concat_ws(',',
          (SELECT count(*) FROM {schema}.listening_content_packages WHERE package_id='fixture-general-v1'),
          (SELECT count(*) FROM {schema}.listening_lessons l JOIN {schema}.listening_content_packages p ON p.id=l.package_id WHERE p.package_id='fixture-general-v1'),
          (SELECT count(*) FROM {schema}.listening_tests t JOIN {schema}.listening_content_packages p ON p.id=t.content_package_id WHERE p.package_id='fixture-general-v1'),
          (SELECT count(*) FROM {schema}.listening_content c JOIN {schema}.listening_tests t ON t.id=c.test_id JOIN {schema}.listening_content_packages p ON p.id=t.content_package_id WHERE p.package_id='fixture-general-v1'),
          (SELECT count(*) FROM {schema}.listening_exercises e JOIN {schema}.listening_content c ON c.id=e.content_id JOIN {schema}.listening_tests t ON t.id=c.test_id JOIN {schema}.listening_content_packages p ON p.id=t.content_package_id WHERE p.package_id='fixture-general-v1'),
          (SELECT count(*) FROM {schema}.listening_package_stimuli s JOIN {schema}.listening_content_packages p ON p.id=s.package_id WHERE p.package_id='fixture-general-v1'),
          (SELECT count(*) FROM {schema}.listening_form_stimuli fs JOIN {schema}.listening_content_packages p ON p.id=fs.package_id WHERE p.package_id='fixture-general-v1'))
        """
    )
    assert counts == "1,1,1,1,1,1,1"

    conflicting_package = {
        **dict(programme_probe["package"]),
        "manifest_sha256": "f" * 64,
    }
    conflicting_args = ",".join(
        _literal(json.dumps(value, separators=(",", ":"))) + "::JSONB"
        for value in (
            conflicting_package,
            programme_probe["lessons"],
            programme_probe["stimuli"],
            programme_probe["forms"],
        )
    )
    with pytest.raises(RuntimeError, match="listening_package_identity_conflict"):
        psql(
            f"SELECT action FROM {schema}.import_listening_content_package_atomic("
            f"{conflicting_args})"
        )
    assert psql(
        f"SELECT manifest_sha256 FROM {schema}.listening_content_packages "
        "WHERE package_id='fixture-general-v1'"
    ) == "a" * 64


def test_import_persists_complete_canonical_projection_and_legacy_defaults(
    programme_probe: dict[str, object],
):
    schema = str(programme_probe["schema"])
    assert psql(
        f"SELECT programme_id || '|' || scoring_policy FROM {schema}.listening_tests "
        "WHERE test_id='legacy-ielts-fixture'"
    ) == "ielts|diagnostic"

    projection = json.loads(psql(
        f"""
        SELECT jsonb_build_object(
          'package', (SELECT jsonb_build_object(
            'package_id', p.package_id, 'programme_id', p.programme_id,
            'manifest_sha256', p.manifest_sha256, 'status', p.status,
            'lessons', p.source_counts->>'lessons', 'forms', p.source_counts->>'forms',
            'items', p.source_counts->>'items', 'stimuli', p.source_counts->>'stimuli')
            FROM {schema}.listening_content_packages p WHERE p.package_id='fixture-general-v1'),
          'lesson', (SELECT jsonb_build_object(
            'source_lesson_id', l.source_lesson_id, 'programme_id', l.programme_id,
            'sequence_num', l.sequence_num, 'status', l.status)
            FROM {schema}.listening_lessons l JOIN {schema}.listening_content_packages p ON p.id=l.package_id
            WHERE p.package_id='fixture-general-v1'),
          'form', (SELECT jsonb_build_object(
            'test_id', t.test_id, 'programme_id', t.programme_id,
            'scoring_policy', t.scoring_policy, 'source_lesson_id', t.source_lesson_id,
            'source_form_id', t.source_form_id, 'source_manifest_sha256', t.source_manifest_sha256,
            'purpose', t.form_purpose, 'replay', t.replay_policy, 'support', t.support_policy,
            'claim', t.claim_policy, 'items', t.source_item_count,
            'audio_path', t.full_audio_storage_path, 'audio_duration', t.full_audio_duration_seconds,
            'audio_bytes', t.full_audio_size_bytes, 'assembly', t.audio_assembly_mode,
            'status', t.status, 'is_public', t.is_public)
            FROM {schema}.listening_tests t JOIN {schema}.listening_content_packages p ON p.id=t.content_package_id
            WHERE p.package_id='fixture-general-v1'),
          'content', (SELECT jsonb_build_object(
            'source_type', c.source_type, 'audio_path', c.audio_storage_path,
            'audio_duration', c.audio_duration_seconds, 'audio_bytes', c.audio_size_bytes,
            'status', c.status, 'section_num', c.section_num)
            FROM {schema}.listening_content c JOIN {schema}.listening_tests t ON t.id=c.test_id
            JOIN {schema}.listening_content_packages p ON p.id=t.content_package_id
            WHERE p.package_id='fixture-general-v1'),
          'exercise', (SELECT jsonb_build_object(
            'type', e.exercise_type, 'variant', e.payload->>'variant', 'status', e.status)
            FROM {schema}.listening_exercises e JOIN {schema}.listening_content c ON c.id=e.content_id
            JOIN {schema}.listening_tests t ON t.id=c.test_id JOIN {schema}.listening_content_packages p ON p.id=t.content_package_id
            WHERE p.package_id='fixture-general-v1'),
          'stimulus', (SELECT jsonb_build_object(
            'id', s.source_stimulus_id, 'audio_path', s.source_audio_path,
            'timing_path', s.source_timing_path, 'audio_sha', s.source_audio_sha256,
            'timing_sha', s.source_timing_sha256, 'transcript_sha', s.controlled_transcript_sha256,
            'duration', s.duration_seconds, 'timing_segments', s.metadata->>'timing_segment_count')
            FROM {schema}.listening_package_stimuli s JOIN {schema}.listening_content_packages p ON p.id=s.package_id
            WHERE p.package_id='fixture-general-v1'),
          'mapping', (SELECT jsonb_build_object(
            'sequence_num', fs.sequence_num, 'offset', fs.derived_offset_seconds,
            'end', fs.derived_end_seconds)
            FROM {schema}.listening_form_stimuli fs JOIN {schema}.listening_content_packages p ON p.id=fs.package_id
            WHERE p.package_id='fixture-general-v1')
        )::TEXT
        """
    ))
    assert projection["package"] == {
        "package_id": "fixture-general-v1",
        "programme_id": "general-listening-practice",
        "manifest_sha256": "a" * 64,
        "status": "validated",
        "lessons": "1",
        "forms": "1",
        "items": "1",
        "stimuli": "1",
    }
    assert projection["lesson"] == {
        "source_lesson_id": "lesson-1",
        "programme_id": "general-listening-practice",
        "sequence_num": 1,
        "status": "draft",
    }
    assert projection["form"] == {
        "test_id": "pkg-fixture-form-1",
        "programme_id": "general-listening-practice",
        "scoring_policy": "report_only",
        "source_lesson_id": "lesson-1",
        "source_form_id": "form-1",
        "source_manifest_sha256": "a" * 64,
        "purpose": "practice",
        "replay": "allowed",
        "support": "available",
        "claim": "report_only",
        "items": 1,
        "audio_path": "packages/form-1.wav",
        "audio_duration": 2,
        "audio_bytes": 64,
        "assembly": "full_premixed",
        "status": "draft",
        "is_public": False,
    }
    assert projection["content"] == {
        "source_type": "programme_form",
        "audio_path": "packages/form-1.wav",
        "audio_duration": 2,
        "audio_bytes": 64,
        "status": "draft",
        "section_num": 1,
    }
    assert projection["exercise"] == {
        "type": "programme_form",
        "variant": "programme_form_v1",
        "status": "draft",
    }
    assert projection["stimulus"] == {
        "id": "stimulus-1",
        "audio_path": "audio/one.wav",
        "timing_path": "timing/one.json",
        "audio_sha": "b" * 64,
        "timing_sha": "c" * 64,
        "transcript_sha": "d" * 64,
        "duration": 2.0,
        "timing_segments": "1",
    }
    assert projection["mapping"] == {"sequence_num": 1, "offset": 0.0, "end": 2.0}


def test_programme_attempt_acquire_serializes_two_browser_starts(
    programme_probe: dict[str, object],
):
    schema = str(programme_probe["schema"])
    user_id = uuid4()
    test_id = uuid4()
    psql(
        f"INSERT INTO {schema}.users (id) VALUES ('{user_id}'); "
        f"INSERT INTO {schema}.listening_tests "
        "(id,test_id,title,status,scoring_policy) VALUES "
        f"('{test_id}','atomic-programme-{test_id}','Atomic programme',"
        "'published','report_only')"
    )

    async def overlap():
        first = await asyncpg.connect(DB)
        second = await asyncpg.connect(DB)
        task = None
        query = (
            f"SELECT * FROM {schema}.fn_acquire_listening_programme_attempt("
            "$1,$2,'legacy')"
        )
        try:
            transaction = first.transaction()
            await transaction.start()
            first_row = await first.fetchrow(query, test_id, user_id)
            task = asyncio.create_task(second.fetchrow(query, test_id, user_id))

            blocked = False
            for _ in range(100):
                await first.execute("SELECT pg_stat_clear_snapshot()")
                blocked = await first.fetchval(
                    "SELECT wait_event_type = 'Lock' "
                    "FROM pg_stat_activity WHERE pid=$1",
                    second.get_server_pid(),
                )
                if blocked:
                    break
                await asyncio.sleep(0.01)
            assert blocked, "second programme acquire did not wait on the advisory lock"

            await transaction.commit()
            second_row = await asyncio.wait_for(task, timeout=5)
            return first_row, second_row
        finally:
            if task is not None and not task.done():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
            await first.close()
            await second.close()

    first_row, second_row = asyncio.run(overlap())
    assert first_row["attempt_id"] == second_row["attempt_id"]
    assert [first_row["created"], second_row["created"]] == [True, False]
    assert psql(
        f"SELECT count(*) FROM {schema}.listening_test_attempts "
        f"WHERE test_id='{test_id}' AND user_id='{user_id}' "
        "AND status='in_progress' AND class_assignment_item_id IS NULL "
        "AND sitting_id IS NULL"
    ) == "1"
    for role in ("anon", "authenticated"):
        assert psql(
            f"SELECT has_function_privilege('{role}', "
            f"'{schema}.fn_acquire_listening_programme_attempt(uuid,uuid,text)', "
            "'EXECUTE')"
        ) == "f"
    assert psql(
        "SELECT has_function_privilege('service_role', "
        f"'{schema}.fn_acquire_listening_programme_attempt(uuid,uuid,text)', "
        "'EXECUTE')"
    ) == "t"


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
def test_package_rows_reject_generic_mutations(
    programme_probe: dict[str, object], mutation: str,
):
    schema = str(programme_probe["schema"])
    with pytest.raises(RuntimeError, match="listening_package_(child_)?immutable"):
        psql(mutation.format(schema=schema))


def test_manifest_bound_publish_and_archive_remain_atomic(
    programme_probe: dict[str, object],
):
    schema = str(programme_probe["schema"])
    manifest = "a" * 64
    publish = psql(
        f"SELECT status FROM {schema}.set_listening_content_package_status("
        f"'fixture-general-v1','{manifest}','publish',NULL)"
    )
    assert publish == "published"
    assert psql(
        f"SELECT string_agg(DISTINCT status, ',') FROM {schema}.listening_tests "
        "WHERE content_package_id IS NOT NULL"
    ) == "published"
    assert psql(
        f"SELECT bool_and(is_public) FROM {schema}.listening_tests "
        "WHERE content_package_id IS NOT NULL"
    ) == "t"

    archive = psql(
        f"SELECT status FROM {schema}.set_listening_content_package_status("
        f"'fixture-general-v1','{manifest}','archive',NULL)"
    )
    assert archive == "archived"
    assert psql(
        f"SELECT string_agg(DISTINCT status, ',') FROM {schema}.listening_exercises"
    ) == "archived"
    assert psql(
        f"SELECT bool_or(is_public) FROM {schema}.listening_tests "
        "WHERE content_package_id IS NOT NULL"
    ) == "f"
