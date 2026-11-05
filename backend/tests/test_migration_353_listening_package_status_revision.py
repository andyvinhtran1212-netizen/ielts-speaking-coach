"""Migration 353 (PAPERUPDATEDAT-0037 FR-006 + FR-007, PC-J252 / PC-J512).

With 306/308 active, a Listening package publish/archive
(`set_listening_content_package_status`, 295) raised 55000
`listening_package_child_immutable` twice over: 306's policy guard raised
`listening_tests.policy_revision` (refused by 295's package guard), and 306's
source guard raised `mock_content_revision` from the RPC's status-only child
UPDATEs (refused by 295 in a nested UPDATE). 353 replaces only those two
function bodies.

The static half always runs: it pins each new body to the verbatim 295/306
body plus the documented edit, and the rollback to the verbatim originals.
The PostgreSQL half runs on the real 306/315/316/338 + 295 package fixture
(`package_policy_probe`, which applies 353 twice and checks no row changed),
including a rollback negative control. Importing a NEW package with 306 active
still raises 55000 (Q-J252-IMPORT, open; not covered by 353).

Set TEST_PG_URL to a LOCAL disposable cluster and REQUIRE_PG=1 to forbid skips.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
from urllib.parse import urlparse
from uuid import uuid4

import asyncpg
import pytest

from test_mock_paper_policy_postgres import DB, query
from test_migration_338_paper_updated_at_triggers import (  # noqa: F401 (fixtures)
    M353, MIGRATIONS, _rolled_back, events, migrated_353, package_policy_probe, paper_probe,
    private_probe, programme_probe, source_bundle,
)

NAME = M353.name
SQL = M353.read_text(encoding="utf-8")
ROLLBACK = MIGRATIONS / "rollback" / NAME
ROLLBACK_SQL = ROLLBACK.read_text(encoding="utf-8")
PIN = "pg_catalog, public, pg_temp"
CHILD = "CREATE OR REPLACE FUNCTION public.fn_protect_listening_package_child()"
SOURCE = "CREATE OR REPLACE FUNCTION public.fn_guard_mock_paper_source()"


def _code(sql: str) -> str:
    return "\n".join(line for line in sql.splitlines() if not line.lstrip().startswith("--"))


def _function(sql: str, header: str) -> str:
    start = sql.index(header)
    body = sql.index("$$", sql.index("$$", start) + 2)
    return sql[start:sql.index(";", body) + 1]


def _original(number: str, header: str) -> str:
    [path] = MIGRATIONS.glob(f"{number}_*.sql")
    return _function(path.read_text(encoding="utf-8"), header)


FR006 = """        -- 353 (0037 FR-006): also accept the policy_revision step that the
        -- active 306 policy guard (trg_mock_paper_policy, which fires first
        -- and always overwrites policy_revision) derives from a status or
        -- visibility change. The package transition GUC and every other
        -- column are still checked below.
        IF TG_OP = 'UPDATE' THEN
            IF NEW.policy_revision = OLD.policy_revision + 1
               AND (NEW.status IS DISTINCT FROM OLD.status
                    OR NEW.is_public IS DISTINCT FROM OLD.is_public) THEN
                IF public.fn_mock_admission_contract_active() THEN
                    v_allowed_columns := v_allowed_columns || 'policy_revision'::TEXT;
                END IF;
            END IF;
        END IF;
"""
FR007_STATUS_ONLY = """    -- 353 (0037 FR-007): a Listening child UPDATE of only status (and
    -- updated_at) is not paper content and keeps mock_content_revision.
    status_only:=TG_OP='UPDATE' AND TG_TABLE_NAME IN ('listening_content','listening_exercises')
        AND n-ARRAY['status','updated_at'] IS NOT DISTINCT FROM b-ARRAY['status','updated_at'];
"""


# ── Static contract ─────────────────────────────────────────────────────────

def test_one_transaction_that_only_replaces_the_two_functions():
    code = _code(SQL).strip()
    assert code.startswith("BEGIN;") and code.endswith("COMMIT;")
    assert "SET LOCAL lock_timeout = '5s';" in code
    assert "SET LOCAL search_path = pg_catalog, pg_temp;" in code
    # Outside dollar-quoted bodies: no data, trigger, table or owner change.
    outside = re.sub(r"\$(\w*)\$.*?\$\1\$", "", code, flags=re.S)
    for forbidden in (r"\bINSERT\b", r"\bUPDATE\b", r"\bDELETE\b", r"\bTRUNCATE\b", r"\bALTER\b",
                      r"\bDROP\b", r"\bCREATE\s+(OR\s+REPLACE\s+)?TRIGGER\b", r"\bDISABLE\b", r"\bOWNER\b", r"\bPOLICY\b"):
        assert not re.search(forbidden, outside, re.I), forbidden
    assert re.findall(r"CREATE OR REPLACE FUNCTION (\S+)", outside) == [
        "public.fn_protect_listening_package_child()", "public.fn_guard_mock_paper_source()"]
    assert re.findall(r"^(?:REVOKE|GRANT) .*$", outside, re.M) == [
        "REVOKE ALL ON FUNCTION public.fn_guard_mock_paper_source() FROM PUBLIC, anon, authenticated;",
        "GRANT EXECUTE ON FUNCTION public.fn_guard_mock_paper_source() TO service_role;"]
    assert "RAISE EXCEPTION 'listening_package_353_requires_295_306';" in code
    assert "RAISE EXCEPTION 'listening_package_353_function_shape';" in code
    assert "RAISE EXCEPTION 'listening_package_353_source_guard_client_execute';" in code


def test_package_guard_is_295_plus_only_the_fr006_policy_revision_step():
    new = _function(SQL, CHILD)
    assert f"SET search_path = {PIN}\n" in new
    assert new.count(FR006) == 1
    assert new.replace(f"SET search_path = {PIN}\n", "SET search_path = public, pg_temp\n").replace(FR006, "") \
        == _original("295", CHILD)


def test_source_guard_is_306_plus_only_the_fr007_status_only_skip():
    new = _function(SQL, SOURCE)
    assert f"SECURITY DEFINER SET search_path = {PIN} AS $$" in new
    restored = (new.replace(f"SET search_path = {PIN} AS", "SET search_path=public,pg_temp AS")
                .replace(" status_only BOOLEAN;\n", "\n").replace(FR007_STATUS_ONLY, "")
                .replace(" AND NOT status_only THEN\n", " THEN\n"))
    assert "status_only" not in restored
    assert restored == _original("306", SOURCE)


def test_rollback_restores_the_exact_295_and_306_bodies_and_nothing_else():
    assert not list(MIGRATIONS.glob("353_*rollback*"))  # outside the forward glob
    code = _code(ROLLBACK_SQL).strip()
    assert code.startswith("BEGIN;") and code.endswith("COMMIT;")
    assert "SET LOCAL lock_timeout = '5s';" in code
    child, source = _original("295", CHILD), _original("306", SOURCE)
    assert ROLLBACK_SQL.count(child) == 1 and ROLLBACK_SQL.count(source) == 1
    rest = code.replace(child, "").replace(source, "")
    assert re.sub(r"\s+", " ", rest).strip() == (
        "BEGIN; SET LOCAL lock_timeout = '5s'; SET LOCAL search_path = pg_catalog, pg_temp; COMMIT;")
    assert f"DELETE FROM public._schema_migrations WHERE filename='{NAME}';" in ROLLBACK_SQL


def test_forward_policy_holds_353_in_its_own_feature_group():
    rows = [line.split("\t") for line in (MIGRATIONS / "forward-policy.tsv").read_text(encoding="utf-8").splitlines()
            if line.startswith(NAME + "\t")]
    assert len(rows) == 1 and rows[0][1:3] == ["pending_feature", "listening_package_status_revision"]
    assert "353_listening_package_status_revision" in (MIGRATIONS / "README.md").read_text(encoding="utf-8")


# ── PostgreSQL behaviour ────────────────────────────────────────────────────

def _paper_state(row):
    return {k: row[k] for k in ("status", "is_public", "policy_revision", "mock_content_revision")}


async def _overlap_valid(connection, s, paper_id, granted_revision):
    """306's overlap check for a grant approved at `granted_revision`."""
    return await connection.fetchval(
        f"""SELECT {s}.fn_mock_overlap_valid(
                to_jsonb(t) || jsonb_build_object('approved_public_overlap', jsonb_build_object(
                    'reason', 'probe', 'actor_id', gen_random_uuid(),
                    'references', {s}.fn_mock_protected_references({s}.fn_mock_paper_dependencies('listening', t.id)),
                    'paper_revision', $2::bigint)),
                {s}.fn_mock_paper_dependencies('listening', t.id))
              FROM {s}.listening_tests t WHERE t.id = $1""", paper_id, granted_revision)


def test_publish_then_archive_through_the_real_rpc(package_policy_probe):
    s, before = package_policy_probe['schema'], package_policy_probe['paper']
    pkg = package_policy_probe['package']

    async def steps(connection):
        assert await _overlap_valid(connection, s, before['id'], before['mock_content_revision']) is True
        for revision, (action, status, public) in enumerate(
                (("publish", "published", True), ("archive", "archived", False)), start=1):
            receipt = await connection.fetchrow(
                f"SELECT * FROM {s}.set_listening_content_package_status($1,$2,$3,NULL)",
                pkg['package_id'], pkg['manifest_sha256'], action)
            assert receipt['status'] == status and receipt['forms_changed'] == 1
            after = await connection.fetchrow(f"SELECT * FROM {s}.listening_tests WHERE id=$1", before['id'])
            assert _paper_state(after) == {"status": status, "is_public": public,
                                           "policy_revision": before['policy_revision'] + revision,
                                           "mock_content_revision": before['mock_content_revision']}
            assert after['updated_at'] > before['updated_at']
            rows = await connection.fetch(
                f"SELECT * FROM {s}.mock_correction_release_events WHERE scope_id=$1 "
                f"ORDER BY (new_state::jsonb->>'policy_revision')::bigint",
                str(before['id']))
            assert len(rows) == revision  # one event per paper per transition
            current = json.loads(rows[-1]['new_state'])
            assert current['status'] == status and current['policy_revision'] == after['policy_revision']
            children = await connection.fetch(
                f"SELECT c.status AS c, e.status AS e FROM {s}.listening_content c "
                f"JOIN {s}.listening_exercises e ON e.content_id = c.id WHERE c.test_id=$1", before['id'])
            assert children and {(r['c'], r['e']) for r in children} == {(status, status)}
            # The overlap grant approved at the original revision stays valid.
            assert await _overlap_valid(connection, s, before['id'], before['mock_content_revision']) is True

    asyncio.run(_rolled_back(steps))
    assert not events(s, before['id'])


@pytest.mark.parametrize('table', ['listening_content', 'listening_exercises'])
def test_status_only_child_update_in_a_package_transition_keeps_the_revision(package_policy_probe, table):
    s, before = package_policy_probe['schema'], package_policy_probe['paper']
    where = ("test_id=$1" if table == 'listening_content'
             else f"content_id IN (SELECT id FROM {s}.listening_content WHERE test_id=$1)")

    async def steps(connection):
        await connection.execute("SELECT set_config('app.listening_package_status_transition', $1, true)",
                                 str(package_policy_probe['package_uuid']))
        assert await connection.execute(f"UPDATE {s}.{table} SET status='published' WHERE {where}", before['id']) \
            != "UPDATE 0"
        after = await connection.fetchrow(f"SELECT * FROM {s}.listening_tests WHERE id=$1", before['id'])
        assert dict(after) == dict(before)
        # A content column on the same package child is still refused by 295.
        with pytest.raises(asyncpg.PostgresError, match='listening_package_child_immutable'):
            async with connection.transaction():
                column = "title" if table == 'listening_content' else "payload"
                value = "'Edited'" if table == 'listening_content' else "'{}'::jsonb"
                await connection.execute(f"UPDATE {s}.{table} SET status='archived', {column}={value} WHERE {where}",
                                         before['id'])

    asyncio.run(_rolled_back(steps))


def test_other_package_row_changes_in_a_transition_are_still_refused(package_policy_probe):
    s, before = package_policy_probe['schema'], package_policy_probe['paper']

    async def steps(connection):
        await connection.execute("SELECT set_config('app.listening_package_status_transition', $1, true)",
                                 str(package_policy_probe['package_uuid']))
        # exam_only is a policy column: 306 still derives policy_revision + 1,
        # but 295 accepts that step only with a status/is_public-only change.
        for assignment in ("status='archived', exam_only=NOT exam_only", "exam_only=NOT exam_only",
                           "status='archived', mock_content_revision=mock_content_revision+1"):
            with pytest.raises(asyncpg.PostgresError, match='listening_package_child_immutable'):
                async with connection.transaction():
                    await connection.execute(f"UPDATE {s}.listening_tests SET {assignment} WHERE id=$1", before['id'])
        assert dict(await connection.fetchrow(f"SELECT * FROM {s}.listening_tests WHERE id=$1", before['id'])) \
            == dict(before)
        assert await connection.fetchval(
            f"SELECT count(*) FROM {s}.mock_correction_release_events WHERE scope_id=$1", str(before['id'])) == 0

    asyncio.run(_rolled_back(steps))


def test_content_insert_update_delete_on_a_plain_listening_paper_still_bump(package_policy_probe):
    """FR-007 changes only the status-only UPDATE; INSERT/DELETE and every other
    column still raise mock_content_revision (one bump per row write)."""
    s = package_policy_probe['schema']

    async def steps(connection):
        paper = await connection.fetchval(
            f"INSERT INTO {s}.listening_tests(test_id,title,status,is_public) VALUES($1,'Plain','published',true) "
            f"RETURNING id",
            uuid4().hex)
        revision = lambda: connection.fetchval(  # noqa: E731
            f"SELECT mock_content_revision FROM {s}.listening_tests WHERE id=$1", paper)
        user = uuid4()
        attempt = await connection.fetchval(
            f"INSERT INTO {s}.listening_test_attempts(test_id,user_id,attempt_purpose) VALUES($1,$2,'practice') "
            f"RETURNING id", paper, user)
        start = await revision()
        section = await connection.fetchval(
            f"INSERT INTO {s}.listening_content(test_id,section_num,title) VALUES($1,1,'S1') RETURNING id", paper)
        assert await revision() == start + 1
        exercise = await connection.fetchval(
            f"INSERT INTO {s}.listening_exercises(content_id,payload) VALUES($1,'{{}}') RETURNING id", section)
        assert await revision() == start + 2
        base = start + 2
        snapshot = await connection.fetchrow(f"SELECT * FROM {s}.listening_test_attempts WHERE id=$1", attempt)
        dependencies = await connection.fetchval(f"SELECT {s}.fn_mock_paper_dependencies('listening',$1)", paper)
        steps_ = (
            # (statement, expected bump)
            (f"UPDATE {s}.listening_content SET status='published' WHERE id=$1", section, 0),
            (f"UPDATE {s}.listening_exercises SET status='published' WHERE id=$1", exercise, 0),
            (f"UPDATE {s}.listening_content SET status='archived', updated_at=now() WHERE id=$1", section, 0),
            (f"UPDATE {s}.listening_content SET status=status WHERE id=$1", section, 0),
            (f"UPDATE {s}.listening_content SET title='S1 edited' WHERE id=$1", section, 1),
            (f"UPDATE {s}.listening_content SET status='published', title='S1 again' WHERE id=$1", section, 1),
            (f"UPDATE {s}.listening_exercises SET status='archived', payload='{{\"q\":1}}' WHERE id=$1", exercise, 1),
            (f"UPDATE {s}.listening_exercises SET order_num=2 WHERE id=$1", exercise, 1),
        )
        expected = base
        for statement, row_id, bump in steps_:
            await connection.execute(statement, row_id)
            expected += bump
            assert await revision() == expected, statement
            if expected == base:
                # Status-only: attempts and their dependency view are untouched.
                assert dict(await connection.fetchrow(
                    f"SELECT * FROM {s}.listening_test_attempts WHERE id=$1", attempt)) == dict(snapshot)
                assert await connection.fetchval(
                    f"SELECT {s}.fn_mock_paper_dependencies('listening',$1)", paper) == dependencies
        await connection.execute(f"DELETE FROM {s}.listening_exercises WHERE id=$1", exercise)
        assert await revision() == expected + 1
        await connection.execute(f"DELETE FROM {s}.listening_content WHERE id=$1", section)
        assert await revision() == expected + 2
        # Reading children are outside FR-007: a change still bumps.
        reading = await connection.fetchval(
            f"INSERT INTO {s}.reading_tests(test_id,title) VALUES($1,'R') RETURNING id", uuid4().hex)
        passage = await connection.fetchval(
            f"INSERT INTO {s}.reading_passages(test_id,passage_order,title) VALUES($1,1,'P') RETURNING id", reading)
        r0 = await connection.fetchval(f"SELECT mock_content_revision FROM {s}.reading_tests WHERE id=$1", reading)
        await connection.execute(f"UPDATE {s}.reading_passages SET title='P2' WHERE id=$1", passage)
        assert await connection.fetchval(
            f"SELECT mock_content_revision FROM {s}.reading_tests WHERE id=$1", reading) == r0 + 1

    asyncio.run(_rolled_back(steps))


def test_functions_are_pinned_and_the_source_guard_stays_service_role_only(package_policy_probe):
    s = package_policy_probe['schema']
    rows = query(
        "SELECT p.proname, p.proconfig, p.prosecdef, "
        "has_function_privilege('anon', p.oid, 'EXECUTE') anon, "
        "has_function_privilege('authenticated', p.oid, 'EXECUTE') authed, "
        "has_function_privilege('service_role', p.oid, 'EXECUTE') service "
        "FROM pg_proc p WHERE p.pronamespace = to_regnamespace($1) "
        "AND p.proname IN ('fn_protect_listening_package_child','fn_guard_mock_paper_source') ORDER BY 1", s)
    pinned = [f"search_path=pg_catalog, {s}, pg_temp"]
    assert [(r['proname'], r['proconfig'], r['prosecdef']) for r in rows] == [
        ('fn_guard_mock_paper_source', pinned, True), ('fn_protect_listening_package_child', pinned, False)]
    source = rows[0]
    assert (source['anon'], source['authed'], source['service']) == (False, False, True)


def test_rollback_restores_the_originals_and_the_publish_failure(package_policy_probe):
    """Negative control: without 353 the real RPC fails exactly as PC-J242 found."""
    s, before = package_policy_probe['schema'], package_policy_probe['paper']
    pkg = package_policy_probe['package']
    down = (ROLLBACK_SQL.replace("public.", s + ".").replace("search_path = public,", f"search_path = {s},")
            .replace("search_path=public,", f"search_path={s},"))
    body = _code(down).strip()
    body = body[len("BEGIN;"):-len("COMMIT;")]

    async def steps(connection):
        await connection.execute(body)
        source = await connection.fetchval(
            f"SELECT prosrc FROM pg_proc WHERE oid = '{s}.fn_guard_mock_paper_source()'::regprocedure")
        assert "status_only" not in source
        with pytest.raises(asyncpg.PostgresError, match='listening_package_child_immutable'):
            async with connection.transaction():
                await connection.fetch(f"SELECT * FROM {s}.set_listening_content_package_status($1,$2,'publish',NULL)",
                                       pkg['package_id'], pkg['manifest_sha256'])
        assert dict(await connection.fetchrow(f"SELECT * FROM {s}.listening_tests WHERE id=$1", before['id'])) \
            == dict(before)
        # Re-applying 353 inside the same transaction restores the fix.
        await connection.execute(_code(migrated_353(s)).strip()[len("BEGIN;"):-len("COMMIT;")])
        receipt = await connection.fetchrow(
            f"SELECT * FROM {s}.set_listening_content_package_status($1,$2,'publish',NULL)",
            pkg['package_id'], pkg['manifest_sha256'])
        assert receipt['status'] == 'published'

    asyncio.run(_rolled_back(steps))
    assert "status_only" in query(
        f"SELECT prosrc FROM pg_proc WHERE oid = '{s}.fn_guard_mock_paper_source()'::regprocedure")[0]['prosrc']


def test_refuses_without_the_295_and_306_functions():
    parsed = urlparse(DB)
    if parsed.scheme not in {"postgres", "postgresql"} or parsed.hostname not in {"localhost", "127.0.0.1", "::1"} or parsed.query:
        if os.environ.get("REQUIRE_PG") == "1":
            pytest.fail("353 requires an explicitly LOCAL disposable PostgreSQL URL")
        pytest.skip("Local PostgreSQL unavailable")
    s = "mig353_empty_" + uuid4().hex
    query(f"CREATE SCHEMA {s}")
    try:
        with pytest.raises(asyncpg.RaiseError, match='listening_package_353_requires_295_306'):
            query(migrated_353(s))
        assert query("SELECT count(*) n FROM pg_proc WHERE pronamespace = to_regnamespace($1)", s)[0]['n'] == 0
    finally:
        query(f"DROP SCHEMA {s} CASCADE")
