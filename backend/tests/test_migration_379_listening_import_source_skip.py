"""Migration 379 (PAPERUPDATEDAT-0037 FR-008, PC-J562, Q-J252-IMPORT "IMPORT a").

After 353, importing a NEW Listening package with 306 active still raised 55000
`listening_package_child_immutable`: every child INSERT fired 306's source
guard, whose `mock_content_revision` UPDATE of the parent paper was refused by
295's package guard. 379 replaces only the 353 source guard body: a child
INSERT/UPDATE whose paper belongs to the package named by the 295 import's
transaction-local `app.listening_package_import` (still validated, never
published, never attempted) does not bump the revision.

The static half always runs: it pins the new body to the verbatim 353 body
plus the documented edit, and the rollback to the verbatim 353 body. The
PostgreSQL half runs on the real 306/315/316/338 + 295 + 353 stack
(`package_policy_probe`) with 379 applied twice: the real import of a new
package with every guard enabled, the hand-set setting cases of Scenario 5,
client roles (Scenario 6), publish/archive afterwards, the 338/353 package
tests re-run on this stack, and a rollback negative control.

Set TEST_PG_URL to a LOCAL disposable cluster and REQUIRE_PG=1 to forbid skips.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
from urllib.parse import urlparse
from uuid import uuid4

import asyncpg
import pytest

import test_migration_338_paper_updated_at_triggers as m338
import test_migration_353_listening_package_status_revision as m353
from test_migration_295_listening_content_programmes_postgres import _literal
from test_mock_paper_policy_postgres import DB, query
from test_migration_338_paper_updated_at_triggers import (  # noqa: F401 (fixtures)
    MIGRATIONS, _rolled_back, events, m353_rows, migrated_353, package_policy_probe, paper_probe,
    private_probe, programme_probe, source_bundle,
)

M379 = MIGRATIONS / "379_listening_import_source_skip.sql"
NAME = M379.name
SQL = M379.read_text(encoding="utf-8")
ROLLBACK = MIGRATIONS / "rollback" / NAME
ROLLBACK_SQL = ROLLBACK.read_text(encoding="utf-8")
SOURCE = m353.SOURCE
_code, _function = m353._code, m353._function

FR008 = """        -- 379 (0037 FR-008): a Listening child INSERT/UPDATE whose paper
        -- belongs to the package the 295 import is creating (its
        -- transaction-local setting), still validated, never published and
        -- never attempted, is not a content revision. Checked per paper, so
        -- any other paper touched by the same write still bumps.
        import_skip:=FALSE;
        IF TG_OP<>'DELETE' AND TG_TABLE_NAME IN ('listening_content','listening_exercises')
           AND NULLIF(current_setting('app.listening_package_import',TRUE),'') IS NOT NULL THEN
            import_skip:=EXISTS(SELECT 1 FROM public.listening_tests t
                JOIN public.listening_content_packages p ON p.id=t.content_package_id
                WHERE t.id=x.id::UUID
                  AND t.content_package_id::TEXT=NULLIF(current_setting('app.listening_package_import',TRUE),'')
                  AND p.status='validated' AND p.published_at IS NULL
                  AND NOT EXISTS(SELECT 1 FROM public.listening_test_attempts a WHERE a.test_id=t.id));
        END IF;
"""


def migrated_379(schema: str) -> str:
    return migrated_353(schema, M379)


def _body(sql: str) -> str:
    """A migration without its BEGIN/COMMIT, to run inside a test transaction."""
    return _code(sql).strip()[len("BEGIN;"):-len("COMMIT;")]


def _transaction_body(sql: str) -> str:
    """The statements between BEGIN; and COMMIT;, byte-identical (function
    bodies keep their comment lines, as psql installs them), so the rollback's
    prosrc hashes see what production sees."""
    _, begin, rest = sql.partition("\nBEGIN;\n")
    body, commit, tail = rest.rpartition("\nCOMMIT;")
    assert begin and commit and not tail.strip()
    return body


# ── Static contract ─────────────────────────────────────────────────────────

def test_one_transaction_that_only_replaces_the_source_guard():
    code = _code(SQL).strip()
    assert code.startswith("BEGIN;") and code.endswith("COMMIT;")
    assert "SET LOCAL lock_timeout = '5s';" in code
    assert "SET LOCAL search_path = pg_catalog, pg_temp;" in code
    # Outside dollar-quoted bodies: no data, trigger, table or owner change.
    outside = re.sub(r"\$(\w*)\$.*?\$\1\$", "", code, flags=re.S)
    for forbidden in (r"\bINSERT\b", r"\bUPDATE\b", r"\bDELETE\b", r"\bTRUNCATE\b", r"\bALTER\b",
                      r"\bDROP\b", r"\bCREATE\s+(OR\s+REPLACE\s+)?TRIGGER\b", r"\bDISABLE\b", r"\bOWNER\b",
                      r"\bPOLICY\b", r"\bset_config\b"):
        assert not re.search(forbidden, outside, re.I), forbidden
    assert re.findall(r"CREATE OR REPLACE FUNCTION (\S+)", outside) == ["public.fn_guard_mock_paper_source()"]
    assert re.findall(r"^(?:REVOKE|GRANT) .*$", outside, re.M) == [
        "REVOKE ALL ON FUNCTION public.fn_guard_mock_paper_source() FROM PUBLIC, anon, authenticated;",
        "GRANT EXECUTE ON FUNCTION public.fn_guard_mock_paper_source() TO service_role;"]
    assert "RAISE EXCEPTION 'listening_package_379_requires_353';" in code
    assert "RAISE EXCEPTION 'listening_package_379_function_shape';" in code
    assert "RAISE EXCEPTION 'listening_package_379_source_guard_client_execute';" in code
    # The prerequisite looks for 353's FR-007 statement verbatim.
    assert m353.FR007_STATUS_ONLY.splitlines()[2].strip() in code


def test_source_guard_is_353_plus_only_the_fr008_import_skip():
    new = _function(SQL, SOURCE)
    assert f"SECURITY DEFINER SET search_path = {m353.PIN} AS $$" in new
    assert new.count(FR008) == 1
    restored = (new.replace(" import_skip BOOLEAN;\n", "\n").replace(FR008, "")
                .replace(" AND NOT status_only AND NOT import_skip THEN\n", " AND NOT status_only THEN\n"))
    assert "import_skip" not in restored
    assert restored == _function(m353.SQL, SOURCE)
    # The match is the text form FR-008 prescribes; no other setting is read.
    assert set(re.findall(r"current_setting\('([^']+)'", new)) == {"app.listening_package_import"}


def _prosrc_sha256(sql: str) -> str:
    """sha256 of the source guard's dollar-quoted body, i.e. pg_proc.prosrc."""
    function = _function(sql, SOURCE)
    start = function.index("$$") + 2
    return hashlib.sha256(function[start:function.index("$$", start)].encode()).hexdigest()


def test_rollback_restores_the_exact_353_body_and_nothing_else():
    assert not list(MIGRATIONS.glob("379_*rollback*"))  # outside the forward glob
    code = _code(ROLLBACK_SQL).strip()
    assert code.startswith("BEGIN;") and code.endswith("COMMIT;")
    source = _function(m353.SQL, SOURCE)
    assert ROLLBACK_SQL.count(source) == 1
    rest = _code(ROLLBACK_SQL.replace(source, ""))
    outside = re.sub(r"\$(\w*)\$.*?\$\1\$", "", rest, flags=re.S)
    assert re.sub(r"\s+", " ", outside).strip() == (
        "BEGIN; SET LOCAL lock_timeout = '5s'; SET LOCAL search_path = pg_catalog, pg_temp; "
        "DO ; "
        "REVOKE ALL ON FUNCTION public.fn_guard_mock_paper_source() FROM PUBLIC, anon, authenticated; "
        "GRANT EXECUTE ON FUNCTION public.fn_guard_mock_paper_source() TO service_role; "
        "DO ; COMMIT;")
    assert f"DELETE FROM public._schema_migrations WHERE filename='{NAME}';" in ROLLBACK_SQL


def test_rollback_is_fail_closed_on_the_installed_body_acl_and_triggers():
    """SA-2284-F1: refuses unless 379's exact body is installed, and verifies
    353's exact body, definer, pinned path, ACL and every 306 trigger after."""
    code = _code(ROLLBACK_SQL)
    pre = code[code.index("DO $precondition$"):code.index("$precondition$;")]
    post = code[code.index("DO $postcondition$"):code.index("$postcondition$;")]
    assert code.index("$precondition$;") < code.index(SOURCE) < code.index("DO $postcondition$")
    assert f"<> '{_prosrc_sha256(SQL)}' THEN" in pre
    assert f"<> '{_prosrc_sha256(m353.SQL)}'" in post
    assert _prosrc_sha256(SQL) != _prosrc_sha256(m353.SQL) == _prosrc_sha256(ROLLBACK_SQL)
    raises = re.findall(r"RAISE EXCEPTION '(\w+)' USING ERRCODE = '(\w+)';", code)
    assert raises == [("rollback_379_not_installed", "55000"), ("rollback_379_function_shape", "55000"),
                      ("rollback_379_source_guard_client_execute", "55000"),
                      ("rollback_379_source_trigger_missing", "55000")]
    assert code.count("RAISE") == len(raises)
    assert f"pinned CONSTANT TEXT[] := ARRAY['search_path={m353.PIN}'];" in post
    assert "OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = source)" in post
    assert "(acl.grantee = 0 OR r.rolname IN ('anon', 'authenticated'))" in post
    # Every table 306 puts trg_mock_paper_source on.
    [loop] = re.findall(r"FOREACH name IN ARRAY ARRAY\[([^\]]+)\] LOOP\s+EXECUTE format\('DROP TRIGGER IF EXISTS "
                        r"trg_mock_paper_source", (MIGRATIONS / "306_mock_paper_policy_and_admission.sql").read_text())
    tables = re.findall(r"'(\w+)'", loop)
    assert re.findall(r"'public\.(\w+)'", post[post.index("tables CONSTANT"):post.index("installed TEXT;")]) == tables
    assert "t.tgfoid = source AND t.tgenabled = 'O' AND NOT t.tgisinternal" in post


def test_forward_policy_holds_379_in_its_own_feature_group():
    rows = [line.split("\t") for line in (MIGRATIONS / "forward-policy.tsv").read_text(encoding="utf-8").splitlines()
            if line.startswith(NAME + "\t")]
    assert len(rows) == 1 and rows[0][1:3] == ["pending_feature", "listening_import_source_skip"]
    assert "379_listening_import_source_skip" in (MIGRATIONS / "README.md").read_text(encoding="utf-8")


# ── PostgreSQL behaviour ────────────────────────────────────────────────────

@pytest.fixture
def import_probe(package_policy_probe):  # noqa: F811
    """The 353 stack with 379 applied twice (re-runnable, changes no row)."""
    s = package_policy_probe['schema']
    seeded = m353_rows(s)
    query(migrated_379(s))
    query(migrated_379(s))
    assert m353_rows(s) == seeded
    assert "import_skip" in query(
        f"SELECT prosrc FROM pg_proc WHERE oid = '{s}.fn_guard_mock_paper_source()'::regprocedure")[0]['prosrc']
    yield package_policy_probe


def _new_package(probe, name):
    """A NEW package for the real 295 import: same lessons/stimuli, own id,
    manifest and form test_ids."""
    package = {**probe['package'], 'package_id': f'fixture-{name}-v1',
               'manifest_sha256': hashlib.sha256(name.encode()).hexdigest()}
    forms = [{**form, 'test_id': f'pkg-{name}-form-{i}'} for i, form in enumerate(probe['forms'], start=1)]
    args = ",".join(_literal(json.dumps(value, separators=(",", ":"))) + "::JSONB"
                    for value in (package, probe['lessons'], probe['stimuli'], forms))
    return package, forms, args


def _import(probe, name):
    """Commit the real import of a new package; returns (package, papers)."""
    s = probe['schema']
    package, _, args = _new_package(probe, name)
    [receipt] = query(f"SELECT * FROM {s}.import_listening_content_package_atomic({args})")
    assert receipt['action'] == 'created'
    return {**package, 'uuid': receipt['package_uuid']}, _papers(s, receipt['package_uuid'])


def _papers(s, package_uuid):
    return [dict(r) for r in query(
        f"SELECT * FROM {s}.listening_tests WHERE content_package_id=$1 ORDER BY id", package_uuid)]


def _children(s, paper_id):
    [r] = query(f"""SELECT (SELECT count(*) FROM {s}.listening_content WHERE test_id=$1) c,
                           (SELECT count(*) FROM {s}.listening_exercises e JOIN {s}.listening_content c
                               ON c.id=e.content_id WHERE c.test_id=$1) e,
                           (SELECT count(*) FROM {s}.listening_form_stimuli WHERE test_id=$1) f""", paper_id)
    return dict(r)


async def _revision(connection, s, paper_id):
    return await connection.fetchval(f"SELECT mock_content_revision FROM {s}.listening_tests WHERE id=$1", paper_id)


def test_a_new_package_imports_with_306_active_and_keeps_its_revision(import_probe):
    """Scenario 4: the real 295 RPC, every guard enabled, contract active."""
    s, old = import_probe['schema'], import_probe['paper']
    assert query(f"SELECT {s}.fn_mock_admission_contract_active() a")[0]['a'] is True
    guards = query(
        "SELECT c.relname, t.tgname, t.tgenabled::text e FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid "
        "WHERE c.relnamespace=to_regnamespace($1) AND c.relname IN ('listening_tests','listening_content',"
        "'listening_exercises') AND t.tgname IN ('trg_mock_paper_source','trg_protect_listening_package_child',"
        "'trg_mock_paper_policy') ORDER BY 1,2", s)
    assert [(r['relname'], r['tgname'], r['e']) for r in guards] == [
        ('listening_content', 'trg_mock_paper_source', 'O'),
        ('listening_content', 'trg_protect_listening_package_child', 'O'),
        ('listening_exercises', 'trg_mock_paper_source', 'O'),
        ('listening_exercises', 'trg_protect_listening_package_child', 'O'),
        ('listening_tests', 'trg_mock_paper_policy', 'O'),
        ('listening_tests', 'trg_protect_listening_package_child', 'O')]

    package, forms, args = _new_package(import_probe, 'import')

    async def steps():
        connection = await asyncpg.connect(DB)
        try:
            async with connection.transaction():
                created = await connection.fetchrow(
                    f"SELECT * FROM {s}.import_listening_content_package_atomic({args})")
                # The import clears its transaction-local setting before returning.
                assert await connection.fetchval(
                    "SELECT current_setting('app.listening_package_import', true)") == ''
            reused = await connection.fetchrow(f"SELECT * FROM {s}.import_listening_content_package_atomic({args})")
            return created, reused
        finally:
            await connection.close()

    created, reused = asyncio.run(steps())
    assert created['action'] == 'created' and created['forms_written'] == len(forms)
    assert reused['action'] == 'reused' and reused['package_uuid'] == created['package_uuid']
    papers = _papers(s, created['package_uuid'])
    assert [p['test_id'] for p in papers] == [f['test_id'] for f in forms]
    for paper in papers:
        assert (paper['mock_content_revision'], paper['policy_revision']) == (0, 0)
        assert (paper['status'], paper['is_public']) == ('draft', False)
        assert _children(s, paper['id']) == {'c': 1, 'e': 1, 'f': 1}
        assert not events(s, paper['id'])
    [stored] = query(f"SELECT status, published_at FROM {s}.listening_content_packages WHERE id=$1",
                     created['package_uuid'])
    assert (stored['status'], stored['published_at']) == ('validated', None)
    # The pre-existing package is untouched.
    assert m338.row(s, 'listening', old['id']) == old


@pytest.mark.parametrize('statement', [
    "UPDATE {s}.listening_content SET title='Edited' WHERE test_id=$1",
    "UPDATE {s}.listening_exercises SET payload='{{\"q\":1}}' "
    "WHERE content_id IN (SELECT id FROM {s}.listening_content WHERE test_id=$1)",
    "DELETE FROM {s}.listening_exercises WHERE content_id IN (SELECT id FROM {s}.listening_content WHERE test_id=$1)",
    "DELETE FROM {s}.listening_content WHERE test_id=$1",
    "INSERT INTO {s}.listening_content(test_id,section_num,title,source_type,audio_duration_seconds,"
    "audio_size_bytes,accent_tag,transcript) VALUES($1,2,'Extra','programme_form',1,1,'other','')",
])
def test_after_the_import_package_child_writes_are_still_refused(import_probe, statement):
    """Outside the import (setting cleared) a content write to the imported
    package takes the 306 bump path and 295 refuses it; nothing persists."""
    s = import_probe['schema']
    _, [paper] = _import(import_probe, 'after')
    children = _children(s, paper['id'])

    async def steps(connection):
        assert await connection.fetchval("SELECT current_setting('app.listening_package_import', true)") is None
        with pytest.raises(asyncpg.PostgresError, match='listening_package_child_immutable') as raised:
            async with connection.transaction():
                await connection.execute(statement.format(s=s), paper['id'])
        assert raised.value.sqlstate == '55000'
        assert dict(await connection.fetchrow(f"SELECT * FROM {s}.listening_tests WHERE id=$1", paper['id'])) == paper

    asyncio.run(_rolled_back(steps))
    assert _papers(s, paper['content_package_id']) == [paper]
    assert _children(s, paper['id']) == children


def test_after_the_import_the_source_guard_bumps_exactly_as_fr007(import_probe):
    """What the source guard itself does after the import. 295's package guard
    would refuse every one of these writes (previous test), so it is suspended
    on the three tables inside this rolled-back transaction only, to observe the
    revision the source guard derives: one bump per content write, none for a
    status-only write, still one while the import setting names another
    package, none once it names this still-validated package, and DELETE
    unchanged."""
    s = import_probe['schema']
    package, [paper] = _import(import_probe, 'observe')
    tables = ('listening_tests', 'listening_content', 'listening_exercises')
    exercises = f"content_id IN (SELECT id FROM {s}.listening_content WHERE test_id=$1)"

    async def steps(connection):
        for table in tables:
            await connection.execute(f"ALTER TABLE {s}.{table} DISABLE TRIGGER trg_protect_listening_package_child")
        expected = 0
        for statement, bump in (
                (f"UPDATE {s}.listening_content SET title='Edited' WHERE test_id=$1", 1),
                (f"UPDATE {s}.listening_content SET status='published' WHERE test_id=$1", 0),
                (f"UPDATE {s}.listening_exercises SET payload='{{\"q\":1}}' WHERE {exercises}", 1),
                (f"UPDATE {s}.listening_exercises SET status='archived' WHERE {exercises}", 0),
                (f"INSERT INTO {s}.listening_exercises(content_id,exercise_type,payload) "
                 f"SELECT id,'programme_form','{{}}' FROM {s}.listening_content WHERE test_id=$1", 1)):
            await connection.execute(statement, paper['id'])
            expected += bump
            assert await _revision(connection, s, paper['id']) == expected, statement
        # Another validated, never-published, unattempted package is named.
        await connection.execute("SELECT set_config('app.listening_package_import', $1, true)",
                                 str(import_probe['package_uuid']))
        await connection.execute(f"UPDATE {s}.listening_content SET title='Edited again' WHERE test_id=$1",
                                 paper['id'])
        expected += 1
        assert await _revision(connection, s, paper['id']) == expected
        await connection.execute("SELECT set_config('app.listening_package_import', $1, true)", str(package['uuid']))
        await connection.execute(f"UPDATE {s}.listening_content SET title='Edited once more' WHERE test_id=$1",
                                 paper['id'])
        assert await _revision(connection, s, paper['id']) == expected
        await connection.execute(f"DELETE FROM {s}.listening_exercises WHERE {exercises}", paper['id'])
        assert await _revision(connection, s, paper['id']) == expected + 2  # DELETE is unchanged

    asyncio.run(_rolled_back(steps))
    enabled = query("SELECT count(*) n FROM pg_trigger WHERE tgname='trg_protect_listening_package_child' "
                    "AND tgenabled='O' AND tgrelid = ANY($1::regclass[])", [f"{s}.{t}" for t in tables])
    assert enabled[0]['n'] == 3
    assert _papers(s, package['uuid']) == [paper]


def test_publish_then_archive_the_imported_package(import_probe):
    """FR-006/FR-007 on the freshly imported package: revision kept,
    policy_revision +1 and one release event per transition."""
    s = import_probe['schema']
    package, [paper] = _import(import_probe, 'publish')

    async def steps(connection):
        for revision, (action, status, public) in enumerate(
                (("publish", "published", True), ("archive", "archived", False)), start=1):
            receipt = await connection.fetchrow(
                f"SELECT * FROM {s}.set_listening_content_package_status($1,$2,$3,NULL)",
                package['package_id'], package['manifest_sha256'], action)
            assert receipt['status'] == status and receipt['forms_changed'] == 1
            after = await connection.fetchrow(f"SELECT * FROM {s}.listening_tests WHERE id=$1", paper['id'])
            assert m353._paper_state(after) == {"status": status, "is_public": public,
                                                "policy_revision": revision, "mock_content_revision": 0}
            assert await connection.fetchval(
                f"SELECT count(*) FROM {s}.mock_correction_release_events WHERE scope_id=$1",
                str(paper['id'])) == revision

    asyncio.run(_rolled_back(steps))
    assert _papers(s, package['uuid']) == [paper]


async def _make(connection, s, probe, state):
    """Put the pre-existing package into `state`; returns the uuid to name in
    app.listening_package_import."""
    package, paper = probe['package'], probe['paper']
    if state in ('published', 'archived'):
        await connection.fetchrow(f"SELECT * FROM {s}.set_listening_content_package_status($1,$2,'publish',NULL)",
                                  package['package_id'], package['manifest_sha256'])
    if state == 'archived':
        await connection.fetchrow(f"SELECT * FROM {s}.set_listening_content_package_status($1,$2,'archive',NULL)",
                                  package['package_id'], package['manifest_sha256'])
        assert await connection.fetchval(
            f"SELECT published_at IS NOT NULL FROM {s}.listening_content_packages WHERE id=$1",
            probe['package_uuid']) is True
    if state in ('published-at-only', 'status-only'):
        # Every reachable non-validated package also carries published_at, and
        # no RPC returns one to 'validated'. Hand-made rows (295's identity
        # guard bypassed for this single UPDATE) show each condition alone:
        # validated with published_at, or archived without it.
        assignment = "published_at=now()" if state == 'published-at-only' else "status='archived'"
        await connection.execute("SET LOCAL session_replication_role = replica")
        await connection.execute(f"UPDATE {s}.listening_content_packages SET {assignment} WHERE id=$1",
                                 probe['package_uuid'])
        await connection.execute("SET LOCAL session_replication_role = origin")
        stored = await connection.fetchrow(
            f"SELECT status, published_at IS NULL never FROM {s}.listening_content_packages WHERE id=$1",
            probe['package_uuid'])
        assert (stored['status'] == 'validated') is (not stored['never'])
    if state == 'attempted':
        # 306 admission refuses a new attempt on this draft paper, so seed one
        # as legacy data written before admission existed (triggers off for
        # this single INSERT only).
        await connection.execute("SET LOCAL session_replication_role = replica")
        await connection.execute(
            f"INSERT INTO {s}.listening_test_attempts(test_id,user_id,attempt_purpose) VALUES($1,$2,'practice')",
            paper['id'], uuid4())
        await connection.execute("SET LOCAL session_replication_role = origin")
    if state == 'other-package':
        [receipt] = await connection.fetch(
            f"SELECT * FROM {s}.import_listening_content_package_atomic({_new_package(probe, 'other')[2]})")
        assert receipt['action'] == 'created'
        return receipt['package_uuid']
    return probe['package_uuid']


CHILD_INSERT = {
    'listening_content': "INSERT INTO {s}.listening_content(test_id,section_num,title) VALUES($1,2,'Forged')",
    'listening_exercises': "INSERT INTO {s}.listening_exercises(content_id,exercise_type,payload) "
                           "SELECT id,'programme_form','{{}}' FROM {s}.listening_content WHERE test_id=$1",
}


@pytest.mark.parametrize('table', sorted(CHILD_INSERT))
@pytest.mark.parametrize('state', ['published', 'archived', 'published-at-only', 'status-only', 'attempted',
                                   'other-package'])
def test_a_hand_set_import_setting_does_not_skip_a_protected_package(import_probe, state, table):
    """Scenario 5: naming a published, once-published or attempted package, or
    another package, keeps the bump path; 295 refuses it with 55000 and the
    child write and revision roll back. ('other-package' is also refused by
    295's INSERT check; the per-paper match itself is observed in
    test_after_the_import_the_source_guard_bumps_exactly_as_fr007.)"""
    s, paper = import_probe['schema'], import_probe['paper']

    async def steps(connection):
        named = await _make(connection, s, import_probe, state)
        before = dict(await connection.fetchrow(f"SELECT * FROM {s}.listening_tests WHERE id=$1", paper['id']))
        counts = await connection.fetchrow(
            f"SELECT (SELECT count(*) FROM {s}.listening_content) c, (SELECT count(*) FROM {s}.listening_exercises) e")
        await connection.execute("SELECT set_config('app.listening_package_import', $1, true)", str(named))
        with pytest.raises(asyncpg.PostgresError, match='listening_package_child_immutable') as raised:
            async with connection.transaction():
                await connection.execute(CHILD_INSERT[table].format(s=s), paper['id'])
        assert raised.value.sqlstate == '55000'
        assert dict(await connection.fetchrow(f"SELECT * FROM {s}.listening_tests WHERE id=$1", paper['id'])) == before
        assert await connection.fetchrow(
            f"SELECT (SELECT count(*) FROM {s}.listening_content) c, "
            f"(SELECT count(*) FROM {s}.listening_exercises) e") == counts

    asyncio.run(_rolled_back(steps))
    assert m338.row(s, 'listening', paper['id']) == paper


@pytest.mark.parametrize('table', sorted(CHILD_INSERT))
def test_a_hand_set_setting_on_a_validated_unattempted_package_is_the_only_skip(import_probe, table):
    """Control for the previous test: the same insert with the package still
    validated, never published and unattempted is what FR-008 lets through."""
    s, paper = import_probe['schema'], import_probe['paper']

    async def steps(connection):
        await connection.execute("SELECT set_config('app.listening_package_import', $1, true)",
                                 str(import_probe['package_uuid']))
        assert await connection.execute(CHILD_INSERT[table].format(s=s), paper['id']) == "INSERT 0 1"
        assert await _revision(connection, s, paper['id']) == paper['mock_content_revision']

    asyncio.run(_rolled_back(steps))


def test_package_less_and_other_papers_in_the_same_transaction_still_bump(import_probe):
    """Scenario 5: with the setting naming a package, a package-less paper's
    child INSERTs commit with the usual bump; the named package's paper does
    not bump, per paper, in the same transaction."""
    s = import_probe['schema']
    package, [imported] = _import(import_probe, 'mixed')
    plain = query(f"INSERT INTO {s}.listening_tests(test_id,title,status,is_public) "
                  f"VALUES($1,'Plain','published',true) RETURNING id", uuid4().hex)[0]['id']
    start = m338.row(s, 'listening', plain)['mock_content_revision']

    async def steps():
        connection = await asyncpg.connect(DB)
        try:
            async with connection.transaction():
                await connection.execute("SELECT set_config('app.listening_package_import', $1, true)",
                                         str(package['uuid']))
                section = await connection.fetchval(
                    f"INSERT INTO {s}.listening_content(test_id,section_num,title) VALUES($1,1,'S1') RETURNING id",
                    plain)
                assert await _revision(connection, s, plain) == start + 1
                await connection.execute(
                    f"INSERT INTO {s}.listening_exercises(content_id,exercise_type,payload) VALUES($1,'programme_form','{{}}')",
                    section)
                assert await _revision(connection, s, plain) == start + 2
                await connection.execute(CHILD_INSERT['listening_exercises'].format(s=s), imported['id'])
                assert await _revision(connection, s, imported['id']) == 0
        finally:
            await connection.close()

    asyncio.run(steps())
    assert m338.row(s, 'listening', plain)['mock_content_revision'] == start + 2  # committed
    assert _papers(s, package['uuid'])[0]['mock_content_revision'] == 0


@pytest.mark.parametrize('role', ['anon', 'authenticated'])
def test_client_roles_cannot_reach_the_skip(import_probe, role):
    """Scenario 6: a forged setting gives a client role nothing."""
    s = import_probe['schema']
    package, [paper] = _import(import_probe, 'client')
    _, _, args = _new_package(import_probe, 'client-forged')
    for table in ('listening_content', 'listening_exercises', 'listening_tests'):
        privileges = query("SELECT has_table_privilege($1, $2, 'INSERT') i, has_table_privilege($1, $2, 'UPDATE') u, "
                           "has_table_privilege($1, $2, 'DELETE') d", role, f"{s}.{table}")[0]
        assert dict(privileges) == {'i': False, 'u': False, 'd': False}, table
    for function in ('fn_guard_mock_paper_source()',
                     'import_listening_content_package_atomic(jsonb,jsonb,jsonb,jsonb)'):
        assert query("SELECT has_function_privilege($1, $2, 'EXECUTE') x", role, f"{s}.{function}")[0]['x'] is False

    async def steps(connection):
        await connection.execute(f"SET LOCAL ROLE {role}")
        await connection.execute("SELECT set_config('app.listening_package_import', $1, true)", str(package['uuid']))
        for statement, parameters in ((CHILD_INSERT['listening_content'].format(s=s), [paper['id']]),
                                      (CHILD_INSERT['listening_exercises'].format(s=s), [paper['id']]),
                                      (f"SELECT * FROM {s}.import_listening_content_package_atomic({args})", []),
                                      (f"SELECT {s}.fn_guard_mock_paper_source()", [])):
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                async with connection.transaction():
                    await connection.execute(statement, *parameters)
        await connection.execute("RESET ROLE")

    asyncio.run(_rolled_back(steps))
    assert _papers(s, package['uuid']) == [paper]
    assert not query(f"SELECT 1 FROM {s}.listening_content_packages WHERE package_id='fixture-client-forged-v1'")


REUSED = [
    pytest.param(m338.test_package_policy_guards_are_real_enabled_and_run_before_338, {}, id='338-guards'),
    pytest.param(m338.test_package_visibility_rpc_with_real_306_is_refused_atomically_by_295, {},
                 id='338-visibility'),
    pytest.param(m338.test_package_status_transition_with_real_306_advances_timestamp_and_policy,
                 {'path': 'status-update'}, id='338-transition-status-update'),
    pytest.param(m338.test_package_status_transition_with_real_306_advances_timestamp_and_policy,
                 {'path': 'package-publish-rpc'}, id='338-transition-publish-rpc'),
    pytest.param(m338.test_package_raw_content_edit_with_real_306_is_refused_atomically,
                 {'in_transition': False}, id='338-raw-edit'),
    pytest.param(m338.test_package_raw_content_edit_with_real_306_is_refused_atomically,
                 {'in_transition': True}, id='338-raw-edit-in-transition'),
    pytest.param(m353.test_publish_then_archive_through_the_real_rpc, {}, id='353-publish-archive'),
    pytest.param(m353.test_status_only_child_update_in_a_package_transition_keeps_the_revision,
                 {'table': 'listening_content'}, id='353-status-only-content'),
    pytest.param(m353.test_status_only_child_update_in_a_package_transition_keeps_the_revision,
                 {'table': 'listening_exercises'}, id='353-status-only-exercises'),
    pytest.param(m353.test_other_package_row_changes_in_a_transition_are_still_refused, {},
                 id='353-other-row-changes'),
    pytest.param(m353.test_content_insert_update_delete_on_a_plain_listening_paper_still_bump, {},
                 id='353-plain-paper-bumps'),
    pytest.param(m353.test_functions_are_pinned_and_the_source_guard_stays_service_role_only, {},
                 id='353-pinned-service-role-only'),
]


@pytest.mark.parametrize('test, kwargs', REUSED)
def test_the_338_and_353_package_tests_still_pass_with_379(import_probe, test, kwargs):
    test(import_probe, **kwargs)


def test_rollback_restores_the_353_body_and_the_import_failure(import_probe):
    """Negative control: without 379 the new-package import fails with 55000."""
    s = import_probe['schema']
    package, _, args = _new_package(import_probe, 'rollback')

    async def steps(connection):
        await connection.execute(_transaction_body(migrated_353(s, ROLLBACK)))
        source = await connection.fetchval(
            f"SELECT prosrc FROM pg_proc WHERE oid = '{s}.fn_guard_mock_paper_source()'::regprocedure")
        assert "import_skip" not in source and "status_only" in source
        with pytest.raises(asyncpg.PostgresError, match='listening_package_child_immutable') as raised:
            async with connection.transaction():
                await connection.fetch(f"SELECT * FROM {s}.import_listening_content_package_atomic({args})")
        assert raised.value.sqlstate == '55000'
        assert await connection.fetchval(
            f"SELECT count(*) FROM {s}.listening_content_packages WHERE package_id=$1", package['package_id']) == 0
        # Re-applying 379 inside the same transaction restores the import.
        await connection.execute(_body(migrated_379(s)))
        [receipt] = await connection.fetch(f"SELECT * FROM {s}.import_listening_content_package_atomic({args})")
        assert receipt['action'] == 'created'

    asyncio.run(_rolled_back(steps))
    assert "import_skip" in query(
        f"SELECT prosrc FROM pg_proc WHERE oid = '{s}.fn_guard_mock_paper_source()'::regprocedure")[0]['prosrc']
    assert not query(f"SELECT 1 FROM {s}.listening_content_packages WHERE package_id=$1", package['package_id'])


async def _source(connection, s):
    return await connection.fetchrow(
        f"SELECT prosrc, proconfig, prosecdef, proacl::TEXT[] acl FROM pg_proc "
        f"WHERE oid = '{s}.fn_guard_mock_paper_source()'::regprocedure")


async def _refused(connection, sql, message):
    with pytest.raises(asyncpg.PostgresError, match=message) as raised:
        async with connection.transaction():
            await connection.execute(sql)
    assert raised.value.sqlstate == '55000'


def test_rollback_on_379_holds_its_postconditions(import_probe):
    s = import_probe['schema']

    async def steps(connection):
        await connection.execute(_transaction_body(migrated_353(s, ROLLBACK)))
        source = await _source(connection, s)
        assert source['prosrc'] == _function(migrated_353(s), SOURCE.replace("public.", f"{s}.")).split("$$")[1]
        assert source['prosecdef'] and source['proconfig'] == [f'search_path=pg_catalog, {s}, pg_temp']
        assert await connection.fetchval(
            f"SELECT has_function_privilege('service_role', '{s}.fn_guard_mock_paper_source()', 'EXECUTE')")
        for role in ('public', 'anon', 'authenticated'):
            assert not await connection.fetchval(
                "SELECT bool_or(acl.privilege_type = 'EXECUTE') FROM pg_proc p "
                "CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl "
                f"WHERE p.oid = '{s}.fn_guard_mock_paper_source()'::regprocedure "
                "AND acl.grantee = CASE WHEN $1 = 'public' THEN 0 ELSE to_regrole($1)::OID END", role)
        assert await connection.fetchval(
            f"SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_mock_paper_source' AND tgenabled = 'O' "
            f"AND tgfoid = '{s}.fn_guard_mock_paper_source()'::regprocedure") == 5
        # Not re-runnable: the second run finds 353's body, not 379's.
        await _refused(connection, _transaction_body(migrated_353(s, ROLLBACK)), 'rollback_379_not_installed')
        assert await _source(connection, s) == source

    asyncio.run(_rolled_back(steps))


@pytest.mark.parametrize('installed', ['353', '306', 'foreign'])
def test_rollback_refuses_unless_379_is_installed(import_probe, installed):
    s = import_probe['schema']

    async def steps(connection):
        if installed == '353':
            await connection.execute(_transaction_body(migrated_353(s)))
        elif installed == '306':
            await connection.execute(_transaction_body(migrated_353(s, m353.ROLLBACK)))
        else:  # 379's body with one byte changed
            body = _function(migrated_379(s), SOURCE.replace("public.", f"{s}."))
            await connection.execute(body.replace("import_skip:=FALSE;", "import_skip:=FALSE; "))
        before = await _source(connection, s)
        await _refused(connection, _transaction_body(migrated_353(s, ROLLBACK)), 'rollback_379_not_installed')
        assert await _source(connection, s) == before

    asyncio.run(_rolled_back(steps))


@pytest.mark.parametrize('table', ['listening_content', 'web_explanation_objects'])
@pytest.mark.parametrize('broken', ['disabled', 'dropped'])
def test_rollback_aborts_when_a_source_trigger_is_not_enabled(import_probe, table, broken):
    s = import_probe['schema']

    async def steps(connection):
        if broken == 'disabled':
            await connection.execute(f"ALTER TABLE {s}.{table} DISABLE TRIGGER trg_mock_paper_source")
        else:
            await connection.execute(f"DROP TRIGGER trg_mock_paper_source ON {s}.{table}")
        before = await _source(connection, s)
        await _refused(connection, _transaction_body(migrated_353(s, ROLLBACK)), 'rollback_379_source_trigger_missing')
        assert "import_skip" in (await _source(connection, s))['prosrc'] and await _source(connection, s) == before

    asyncio.run(_rolled_back(steps))


def test_refuses_over_the_306_body_without_353(import_probe):
    s = import_probe['schema']

    async def steps(connection):
        await connection.execute(_body(migrated_353(s, m353.ROLLBACK)))  # back to the 295/306 bodies
        before = await connection.fetchval(
            f"SELECT prosrc FROM pg_proc WHERE oid = '{s}.fn_guard_mock_paper_source()'::regprocedure")
        with pytest.raises(asyncpg.RaiseError, match='listening_package_379_requires_353'):
            async with connection.transaction():
                await connection.execute(_body(migrated_379(s)))
        assert await connection.fetchval(
            f"SELECT prosrc FROM pg_proc WHERE oid = '{s}.fn_guard_mock_paper_source()'::regprocedure") == before

    asyncio.run(_rolled_back(steps))


def test_refuses_without_the_source_guard():
    parsed = urlparse(DB)
    if parsed.scheme not in {"postgres", "postgresql"} or parsed.hostname not in {"localhost", "127.0.0.1", "::1"} or parsed.query:
        if os.environ.get("REQUIRE_PG") == "1":
            pytest.fail("379 requires an explicitly LOCAL disposable PostgreSQL URL")
        pytest.skip("Local PostgreSQL unavailable")
    s = "mig379_empty_" + uuid4().hex
    query(f"CREATE SCHEMA {s}")
    try:
        with pytest.raises(asyncpg.RaiseError, match='listening_package_379_requires_353'):
            query(migrated_379(s))
        assert query("SELECT count(*) n FROM pg_proc WHERE pronamespace = to_regnamespace($1)", s)[0]['n'] == 0
    finally:
        query(f"DROP SCHEMA {s} CASCADE")


def test_rollback_refuses_without_the_source_guard():
    parsed = urlparse(DB)
    if parsed.scheme not in {"postgres", "postgresql"} or parsed.hostname not in {"localhost", "127.0.0.1", "::1"} or parsed.query:
        if os.environ.get("REQUIRE_PG") == "1":
            pytest.fail("379 requires an explicitly LOCAL disposable PostgreSQL URL")
        pytest.skip("Local PostgreSQL unavailable")
    s = "mig379_rollback_empty_" + uuid4().hex
    query(f"CREATE SCHEMA {s}")
    try:
        with pytest.raises(asyncpg.PostgresError, match='rollback_379_not_installed') as raised:
            query(migrated_353(s, ROLLBACK))
        assert raised.value.sqlstate == '55000'
        assert query("SELECT count(*) n FROM pg_proc WHERE pronamespace = to_regnamespace($1)", s)[0]['n'] == 0
    finally:
        query(f"DROP SCHEMA {s} CASCADE")
