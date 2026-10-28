"""Migration 324 (A-08B, ASSIGNDRAFT-0027): a writing assignment can never be
deleted while a learner's draft references it.

`writing_drafts.assignment_id` was ON DELETE CASCADE (mig 037), so any delete
of an assignment silently erased the draft. 324 makes the FK ON DELETE NO
ACTION: Postgres refuses the delete with 23503 for every role and path, and
`services/writing_assignment_delete_guard.py` maps that to the existing 409.

The static half always runs. The PostgreSQL half builds the 037/224 shape
(FK, UNIQUE, draft guard trigger that locks the parent FOR UPDATE) in a
disposable schema, first proves the CASCADE hole, then applies the migration
twice and proves FR-001…FR-004: delete with draft → 23503, delete without
draft → OK, a single-statement student delete that cascades to both rows → OK
(the reason for NO ACTION over RESTRICT), the draft-vs-delete race never loses
the draft, re-apply is a no-op and the prechecks abort on orphans, unexpected
FK actions and a remaining cascading child.

Set TEST_PG_URL to a LOCAL disposable cluster and REQUIRE_PG=1 to forbid skips.
"""

from __future__ import annotations

import asyncio
import os
import re
import shutil
from pathlib import Path
from uuid import uuid4

import asyncpg
import pytest

from test_migration_240_core_attempt_evidence import DB, psql

BACKEND = Path(__file__).resolve().parents[1]
MIGRATION = BACKEND / "migrations/324_writing_drafts_assignment_fk_no_action.sql"
SQL = MIGRATION.read_text(encoding="utf-8")
GUARD_224 = (BACKEND / "migrations/224_active_player_resume_ttl.sql").read_text(encoding="utf-8")
FK = "writing_drafts_assignment_id_fkey"


def _code(sql: str) -> str:
    sql = re.sub(r"/\*.*?\*/", "", sql, flags=re.S)
    return re.sub(r"--[^\n]*", "", sql)


CODE = _code(SQL)


# ── Static contract ─────────────────────────────────────────────────────────

def test_single_transaction_with_fail_fast_lock_timeout():
    assert re.match(r"\s*BEGIN;", CODE)
    assert CODE.rstrip().endswith("COMMIT;")
    assert "SET LOCAL lock_timeout = '5s';" in CODE


def test_replaces_only_the_draft_fk_with_validated_no_action():
    assert re.search(
        rf"ADD CONSTRAINT {FK}\s+FOREIGN KEY \(assignment_id\) REFERENCES "
        r"public\.writing_assignments\(id\)\s+ON DELETE NO ACTION NOT VALID;", CODE)
    assert f"VALIDATE CONSTRAINT {FK};" in CODE
    # RESTRICT is checked immediately and could break a two-branch cascade.
    assert "RESTRICT" not in CODE
    assert "CASCADE" not in CODE
    assert set(re.findall(r"ALTER TABLE\s+(public\.\w+)", CODE)) == {"public.writing_drafts"}


def test_changes_no_row_and_no_privilege():
    for verb in (r"INSERT\s+INTO", r"UPDATE\s+public", r"DELETE\s+FROM", r"TRUNCATE",
                 r"GRANT", r"REVOKE", r"POLICY", r"TRIGGER"):
        assert not re.search(verb, CODE, re.I), verb


def test_decides_on_catalog_action_not_definition_text():
    assert "confdeltype" in CODE
    assert "pg_get_constraintdef" not in CODE
    for marker in ("writing_drafts_orphans_exist", "writing_drafts_assignment_fk_unexpected",
                   "writing_drafts_assignment_fk_postcondition_failed",
                   "writing_assignments_still_has_cascading_child"):
        assert f"'{marker}'" in CODE


# ── PostgreSQL ──────────────────────────────────────────────────────────────

def _draft_guard(schema: str) -> str:
    """The live draft trigger from 224, rewritten into the probe schema."""
    start = GUARD_224.index("CREATE OR REPLACE FUNCTION public.fn_guard_writing_draft_mutation()")
    end_marker = "FOR EACH ROW EXECUTE FUNCTION public.fn_guard_writing_draft_mutation();"
    end = GUARD_224.index(end_marker, start) + len(end_marker)
    return (GUARD_224[start:end]
            .replace("SET search_path = public, pg_temp", f"SET search_path = {schema}, pg_temp")
            .replace("public.", f"{schema}."))


def _build(schema: str, fk_action: str | None = "ON DELETE CASCADE") -> None:
    """037/224 shape. `fk_action=None` leaves the draft FK out entirely."""
    fk = (f"CONSTRAINT {FK} REFERENCES {schema}.writing_assignments(id) {fk_action}"
          if fk_action is not None else "")
    psql(f"""
        CREATE SCHEMA {schema};
        CREATE TABLE {schema}.users (id UUID PRIMARY KEY);
        CREATE TABLE {schema}.students (
            id UUID PRIMARY KEY,
            user_id UUID REFERENCES {schema}.users(id) ON DELETE SET NULL);
        CREATE TABLE {schema}.writing_prompts (id UUID PRIMARY KEY);
        CREATE TABLE {schema}.writing_essays (id UUID PRIMARY KEY);
        CREATE TABLE {schema}.writing_assignments (
            id UUID PRIMARY KEY,
            prompt_id  UUID NOT NULL REFERENCES {schema}.writing_prompts(id) ON DELETE RESTRICT,
            student_id UUID NOT NULL REFERENCES {schema}.students(id)        ON DELETE CASCADE,
            essay_id   UUID REFERENCES {schema}.writing_essays(id)           ON DELETE SET NULL,
            status TEXT NOT NULL DEFAULT 'pending' CHECK (
                status IN ('pending', 'in_progress', 'submitted', 'graded', 'delivered')),
            started_at TIMESTAMPTZ,
            assigned_by UUID REFERENCES {schema}.users(id) ON DELETE SET NULL,
            renderer_affinity TEXT,
            renderer_affinity_claimed_at TIMESTAMPTZ,
            renderer_affinity_expires_at TIMESTAMPTZ);
        CREATE TABLE {schema}.writing_drafts (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            assignment_id UUID NOT NULL {fk},
            student_id    UUID NOT NULL REFERENCES {schema}.students(id) ON DELETE CASCADE,
            draft_text TEXT NOT NULL DEFAULT '',
            UNIQUE (assignment_id));
        {_draft_guard(schema)}
        GRANT USAGE ON SCHEMA {schema} TO service_role;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA {schema} TO service_role;
    """)


def _migrate(schema: str) -> str:
    return psql(SQL.replace("public.", f"{schema}."))


def _seed(schema: str, *, draft: bool = True, user: str | None = None) -> dict[str, str]:
    ids = {k: str(uuid4()) for k in ("user", "student", "prompt", "assignment")}
    if user:
        ids["user"] = user
    psql(f"""
        INSERT INTO {schema}.users (id) VALUES ('{ids['user']}') ON CONFLICT DO NOTHING;
        INSERT INTO {schema}.students (id, user_id) VALUES ('{ids['student']}', '{ids['user']}');
        INSERT INTO {schema}.writing_prompts (id) VALUES ('{ids['prompt']}');
        INSERT INTO {schema}.writing_assignments (id, prompt_id, student_id, status)
             VALUES ('{ids['assignment']}', '{ids['prompt']}', '{ids['student']}',
                     '{'in_progress' if draft else 'pending'}');
    """)
    if draft:
        psql(f"INSERT INTO {schema}.writing_drafts (assignment_id, student_id, draft_text) "
             f"VALUES ('{ids['assignment']}', '{ids['student']}', 'my half-written essay')")
    return ids


def _count(schema: str, table: str, where: str = "TRUE") -> int:
    return int(psql(f"SELECT count(*) FROM {schema}.{table} WHERE {where}"))


def _sqlstate(sql: str, role: str | None = None) -> str | None:
    """Run `sql` in its own transaction; return the SQLSTATE it raised, or None."""
    async def run():
        conn = await asyncpg.connect(DB)
        try:
            if role:
                await conn.execute(f"SET ROLE {role}")
            await conn.execute(sql)
            return None
        except asyncpg.PostgresError as exc:
            return exc.sqlstate
        finally:
            await conn.close()
    return asyncio.run(run())


def _fk_row(schema: str) -> str:
    return psql(f"SELECT oid, confdeltype, convalidated FROM pg_constraint "
                f"WHERE conrelid = '{schema}.writing_drafts'::regclass AND conname = '{FK}'")


@pytest.fixture(scope="module")
def pg():
    try:
        available = shutil.which("psql") and psql("SELECT 1") == "1"
    except Exception:
        available = False
    if not available:
        if os.environ.get("REQUIRE_PG") == "1":
            pytest.fail("Local PostgreSQL required for migration 324 verification")
        pytest.skip("Local PostgreSQL unavailable")
    if psql("SELECT usesuper FROM pg_user WHERE usename=current_user") != "t":
        pytest.skip("migration 324 probe needs a superuser to SET ROLE")
    psql("""DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
    END $$;""")
    created: list[str] = []

    def make(fk_action: str | None = "ON DELETE CASCADE") -> str:
        schema = "draft_fk_324_" + uuid4().hex
        created.append(schema)
        _build(schema, fk_action)
        return schema

    try:
        yield make
    finally:
        # Only the exact unique schemas created by this fixture are removed.
        for schema in created:
            psql(f"DROP SCHEMA IF EXISTS {schema} CASCADE")


@pytest.fixture(scope="module")
def migrated(pg):
    schema = pg()
    # Before 324: the 037 CASCADE erases the draft with its assignment.
    hole = _seed(schema)
    psql(f"DELETE FROM {schema}.writing_assignments WHERE id = '{hole['assignment']}'")
    assert _count(schema, "writing_drafts", f"assignment_id = '{hole['assignment']}'") == 0
    _migrate(schema)
    _migrate(schema)
    return schema


def test_catalog_has_validated_no_action_and_no_cascading_child(migrated):
    rows = psql(f"SELECT conrelid::regclass::text || ':' || conname || ':' || confdeltype::text || ':' || convalidated "
                f"FROM pg_constraint WHERE contype = 'f' "
                f"AND confrelid = '{migrated}.writing_assignments'::regclass")
    assert rows == f"{migrated}.writing_drafts:{FK}:a:true"


@pytest.mark.parametrize("role", [None, "service_role"])
def test_delete_with_draft_is_refused_for_every_role(migrated, role):
    ids = _seed(migrated)
    assert _sqlstate(f"DELETE FROM {migrated}.writing_assignments WHERE id = '{ids['assignment']}'",
                     role) == "23503"
    assert psql(f"SELECT draft_text FROM {migrated}.writing_drafts "
                f"WHERE assignment_id = '{ids['assignment']}'") == "my half-written essay"
    assert _count(migrated, "writing_assignments", f"id = '{ids['assignment']}'") == 1


def test_unstarted_assignment_without_draft_still_deletes(migrated):
    ids = _seed(migrated, draft=False)
    assert _sqlstate(f"DELETE FROM {migrated}.writing_assignments WHERE id = '{ids['assignment']}'",
                     "service_role") is None
    assert _count(migrated, "writing_assignments", f"id = '{ids['assignment']}'") == 0


def test_submit_deletes_the_draft_and_then_nothing_blocks(migrated):
    """037: submit hard-deletes the draft. That delete, and any later
    assignment delete once no draft remains, is not affected by the FK."""
    ids = _seed(migrated)
    psql(f"DELETE FROM {migrated}.writing_drafts WHERE assignment_id = '{ids['assignment']}'; "
         f"UPDATE {migrated}.writing_assignments SET status = 'submitted' WHERE id = '{ids['assignment']}'")
    assert _sqlstate(f"DELETE FROM {migrated}.writing_assignments WHERE id = '{ids['assignment']}'") is None


def test_single_statement_student_delete_cascades_to_assignment_and_draft(migrated):
    """FR-003: the student_id CASCADE removes the assignment and (through its
    own student_id CASCADE) the draft in one statement; NO ACTION checks at the
    end of the statement, when no draft references the assignment any more."""
    ids = _seed(migrated)
    second = str(uuid4())
    psql(f"INSERT INTO {migrated}.writing_assignments (id, prompt_id, student_id, status) "
         f"VALUES ('{second}', '{ids['prompt']}', '{ids['student']}', 'in_progress'); "
         f"INSERT INTO {migrated}.writing_drafts (assignment_id, student_id, draft_text) "
         f"VALUES ('{second}', '{ids['student']}', 'second draft')")
    bystander = _seed(migrated)
    assert _sqlstate(f"DELETE FROM {migrated}.students WHERE id = '{ids['student']}'",
                     "service_role") is None
    assert _count(migrated, "writing_assignments", f"student_id = '{ids['student']}'") == 0
    assert _count(migrated, "writing_drafts", f"student_id = '{ids['student']}'") == 0
    assert _count(migrated, "writing_drafts", f"assignment_id = '{bystander['assignment']}'") == 1


def test_user_delete_e2e_cleanup_path_is_not_blocked(migrated):
    """staging_seed --cleanup deletes users; students.user_id is SET NULL, so
    the learner's assignment and draft survive and nothing is refused."""
    ids = _seed(migrated)
    assert _sqlstate(f"DELETE FROM {migrated}.users WHERE id = '{ids['user']}'", "service_role") is None
    assert _count(migrated, "writing_drafts", f"assignment_id = '{ids['assignment']}'") == 1


async def _blocked_on_lock(observer, pid: int) -> bool:
    for _ in range(200):
        await observer.execute("SELECT pg_stat_clear_snapshot()")
        if await observer.fetchval(
                "SELECT wait_event_type = 'Lock' FROM pg_stat_activity WHERE pid = $1", pid):
            return True
        await asyncio.sleep(0.01)
    return False


def _race(schema: str, first_sql: str, second_sql: str) -> str | None:
    """Hold `first_sql` uncommitted until PG confirms `second_sql` waits on its
    lock, commit, and return the SQLSTATE the second statement ended with."""
    async def run():
        first, second = await asyncpg.connect(DB), await asyncpg.connect(DB)
        task = None
        try:
            for conn in (first, second):
                await conn.execute("SET ROLE service_role")
            tx = first.transaction()
            await tx.start()
            await first.execute(first_sql)
            task = asyncio.create_task(second.execute(second_sql))
            await first.execute("RESET ROLE")
            assert await _blocked_on_lock(first, second.get_server_pid()), "statements did not overlap"
            await tx.commit()
            try:
                await asyncio.wait_for(task, timeout=5)
                return None
            except asyncpg.PostgresError as exc:
                return exc.sqlstate
        finally:
            if task is not None and not task.done():
                task.cancel()
            await first.close()
            await second.close()
    return asyncio.run(run())


def test_race_draft_commits_before_delete_keeps_draft(migrated):
    """Scenario 2: the guard read the assignment as unstarted; the learner's
    draft insert commits before the DELETE → 23503 and the draft remains."""
    ids = _seed(migrated, draft=False)
    state = _race(
        migrated,
        f"INSERT INTO {migrated}.writing_drafts (assignment_id, student_id, draft_text) "
        f"VALUES ('{ids['assignment']}', '{ids['student']}', 'raced draft')",
        f"DELETE FROM {migrated}.writing_assignments WHERE id = '{ids['assignment']}' AND status = 'pending'",
    )
    assert state == "23503"
    assert psql(f"SELECT draft_text FROM {migrated}.writing_drafts "
                f"WHERE assignment_id = '{ids['assignment']}'") == "raced draft"
    assert _count(migrated, "writing_assignments", f"id = '{ids['assignment']}'") == 1


def test_race_delete_commits_before_draft_insert_leaves_no_orphan(migrated):
    """The other order: the delete wins, the blocked draft write is rejected
    (no draft ever existed, so none is lost) and no orphan draft is left."""
    ids = _seed(migrated, draft=False)
    state = _race(
        migrated,
        f"DELETE FROM {migrated}.writing_assignments WHERE id = '{ids['assignment']}'",
        f"INSERT INTO {migrated}.writing_drafts (assignment_id, student_id, draft_text) "
        f"VALUES ('{ids['assignment']}', '{ids['student']}', 'late draft')",
    )
    assert state in {"55000", "23503"}
    assert _count(migrated, "writing_drafts", f"assignment_id = '{ids['assignment']}'") == 0


def test_reapply_is_a_no_op(migrated):
    ids = _seed(migrated)
    before = (_fk_row(migrated), _count(migrated, "writing_assignments"), _count(migrated, "writing_drafts"))
    _migrate(migrated)
    after = (_fk_row(migrated), _count(migrated, "writing_assignments"), _count(migrated, "writing_drafts"))
    assert before == after
    assert _count(migrated, "writing_drafts", f"assignment_id = '{ids['assignment']}'") == 1


def test_apply_changes_no_row(pg):
    schema = pg()
    for draft in (True, False, True):
        _seed(schema, draft=draft)
    snapshot = f"""SELECT md5(string_agg(t, '|' ORDER BY t)) FROM (
        SELECT a::text AS t FROM {schema}.writing_assignments a
        UNION ALL SELECT d::text FROM {schema}.writing_drafts d) s"""
    before = psql(snapshot)
    _migrate(schema)
    assert psql(snapshot) == before


def test_missing_fk_is_added(pg):
    schema = pg(fk_action=None)
    _migrate(schema)
    assert _fk_row(schema).endswith("|a|t")


def test_orphan_drafts_abort_and_leave_schema_unchanged(pg):
    schema = pg()
    ids = _seed(schema)
    psql(f"ALTER TABLE {schema}.writing_drafts DROP CONSTRAINT {FK}; "
         f"DELETE FROM {schema}.writing_assignments WHERE id = '{ids['assignment']}'")
    with pytest.raises(RuntimeError, match="writing_drafts_orphans_exist"):
        _migrate(schema)
    assert _fk_row(schema) == ""
    assert _count(schema, "writing_drafts") == 1


@pytest.mark.parametrize("action,code", [("ON DELETE RESTRICT", "r"), ("ON DELETE SET DEFAULT", "d")])
def test_unexpected_fk_action_aborts(pg, action, code):
    schema = pg(fk_action=action)
    with pytest.raises(RuntimeError, match="writing_drafts_assignment_fk_unexpected"):
        _migrate(schema)
    assert _fk_row(schema).split("|")[1] == code


def test_remaining_cascading_child_fails_the_postcondition(pg):
    schema = pg()
    psql(f"CREATE TABLE {schema}.other_child (assignment_id UUID "
         f"REFERENCES {schema}.writing_assignments(id) ON DELETE CASCADE)")
    with pytest.raises(RuntimeError, match="writing_assignments_still_has_cascading_child"):
        _migrate(schema)
    # The whole transaction rolled back: the draft FK is still the 037 CASCADE.
    assert _fk_row(schema).split("|")[1] == "c"
