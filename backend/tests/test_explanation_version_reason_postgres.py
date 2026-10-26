"""Migration 319 on LOCAL disposable PG: the approval gate names WHY a paper has
no single current explanation version, and still never picks one itself.

Regression for Cam19 T1 REV01 (Course 5, 2026-10-25): the REVxx copy has no
objects of its own — all 40 are bound to the original Cambridge paper — and the
class assignment failed with an opaque "no unique current version" message.
"""
import asyncio
import os
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4

import asyncpg
import pytest

DB = os.environ.get("TEST_PG_URL", "")
MIGRATION = (Path(__file__).resolve().parents[1]
             / "migrations/319_explanation_version_unavailable_reason.sql").read_text()
SKILLS = ("reading", "listening")


async def _run(sql, *args):
    connection = await asyncpg.connect(DB)
    try:
        if not args and ";" in sql:
            await connection.execute(sql)
            return []
        return await connection.fetch(sql, *args)
    finally:
        await connection.close()


def query(sql, *args):
    return asyncio.run(_run(sql, *args))


@pytest.fixture
def schema():
    parsed = urlparse(DB)
    if parsed.scheme not in {"postgres", "postgresql"} or parsed.hostname not in {"localhost", "127.0.0.1", "::1"}:
        if os.environ.get("REQUIRE_PG") == "1":
            pytest.fail("319 requires an explicitly LOCAL disposable PostgreSQL URL")
        pytest.skip("Local PostgreSQL unavailable")
    name = "explanation_reason_" + uuid4().hex
    query("""DO $$ BEGIN
        IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
        IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
        IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
    END $$""")
    query(f"""
        CREATE SCHEMA {name};
        CREATE TABLE {name}.web_explanation_objects(
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(), object_id text NOT NULL,
            content_version text NOT NULL, skill text NOT NULL, question_number int NOT NULL,
            reading_test_id uuid, listening_test_id uuid, is_current boolean NOT NULL DEFAULT false,
            rights_status text NOT NULL DEFAULT 'BLOCKED_PENDING_RIGHTS_REVIEW',
            editorial_status text NOT NULL DEFAULT 'GENERATED_REQUIRES_EDITORIAL_REVIEW',
            serving_status text NOT NULL DEFAULT 'ELIGIBLE_AFTER_GLOBAL_RELEASE_GATES',
            UNIQUE(object_id, content_version));
        CREATE UNIQUE INDEX ON {name}.web_explanation_objects(object_id) WHERE is_current;
        CREATE TABLE {name}.mock_correction_release_events(
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(), scope_type text, scope_id text,
            action text, previous_state jsonb, new_state jsonb, reason text, actor_id uuid,
            created_at timestamptz DEFAULT now());
    """)
    sql = (MIGRATION.replace("public.", name + ".")
           .replace("search_path = public,", "search_path = " + name + ","))
    try:
        query(sql)
        query(sql)  # forward re-application is safe
        yield name
    finally:
        query(f"DROP SCHEMA IF EXISTS {name} CASCADE")


def bind(schema, skill, paper, version, *, prefix, current=True):
    query(f"""INSERT INTO {schema}.web_explanation_objects(
            object_id, content_version, skill, question_number, {skill}_test_id, is_current)
        SELECT $1 || '-' || $2 || '-q' || lpad(n::text, 2, '0'), $3, $2, n, $4, $5
          FROM generate_series(1, 40) n""", prefix, skill, version, paper, current)


def approve(schema, skill, paper, version=None):
    rows = query(f"SELECT {schema}.fn_approve_web_explanation_paper($1,$2,$3,$4,$5) r",
                 skill, paper, uuid4(), version, "test")
    return rows[0]["r"]


def state(schema, skill, paper):
    rows = query(f"""SELECT count(*) FILTER (WHERE rights_status='APPROVED') approved, count(*) total
                       FROM {schema}.web_explanation_objects WHERE {skill}_test_id=$1""", paper)
    events = query(f"SELECT count(*) n FROM {schema}.mock_correction_release_events")[0]["n"]
    return rows[0]["approved"], rows[0]["total"], events


def refused(schema, skill, paper, version=None):
    with pytest.raises(asyncpg.exceptions.RaiseError) as caught:
        approve(schema, skill, paper, version)
    return str(caught.value)


@pytest.mark.parametrize("skill", SKILLS)
def test_revision_copy_without_own_objects_reports_none_and_leaves_source_untouched(schema, skill):
    source, revision = uuid4(), uuid4()
    bind(schema, skill, source, "cambridge-web-explanations/2026-09-10-v1", prefix="cambridge-19-test-1")

    assert refused(schema, skill, revision) == "web_explanation_content_version_unavailable:none"
    # The refusal approved nothing and did not borrow the source paper's set.
    assert state(schema, skill, source) == (0, 40, 0)
    assert state(schema, skill, revision) == (0, 0, 0)


@pytest.mark.parametrize("skill", SKILLS)
def test_multiple_current_versions_are_refused_not_chosen(schema, skill):
    paper = uuid4()
    bind(schema, skill, paper, "v1", prefix="mock-a")
    bind(schema, skill, paper, "v2", prefix="mock-b")

    assert refused(schema, skill, paper) == "web_explanation_content_version_unavailable:multiple:2"
    assert state(schema, skill, paper) == (0, 80, 0)


@pytest.mark.parametrize("skill", SKILLS)
def test_pinned_version_that_is_no_longer_current_is_named(schema, skill):
    paper = uuid4()
    bind(schema, skill, paper, "v1", prefix="mock-old", current=False)
    bind(schema, skill, paper, "v2", prefix="mock-new")

    assert refused(schema, skill, paper, "v1") == "web_explanation_content_version_unavailable:pinned_not_current"
    assert state(schema, skill, paper) == (0, 80, 0)


@pytest.mark.parametrize("skill", SKILLS)
def test_only_historical_objects_count_as_none(schema, skill):
    paper = uuid4()
    bind(schema, skill, paper, "v1", prefix="mock-old", current=False)

    assert refused(schema, skill, paper) == "web_explanation_content_version_unavailable:none"


@pytest.mark.parametrize("skill", SKILLS)
def test_single_current_version_is_still_approved_once(schema, skill):
    paper = uuid4()
    bind(schema, skill, paper, "v1", prefix="mock-one")

    first = approve(schema, skill, paper)
    second = approve(schema, skill, paper)
    assert '"content_version": "v1"' in first and '"approved_now": true' in first
    assert '"approved_now": false' in second
    assert state(schema, skill, paper) == (40, 40, 1)
