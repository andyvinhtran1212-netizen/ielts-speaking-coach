"""501: service_role may evaluate the 309 quiz_banks CHECK predicate again.

Since 309 the CHECK quiz_banks_grammar_revision_shape calls
grammar_quiz_allowed_code(text), whose EXECUTE 309/314/339 revoke from
service_role, so every service_role write of quiz_banks failed with 42501.
The actual-PostgreSQL tests reuse the Grammar quiz fixture (309/314/339
applied to a random schema with its own anon/authenticated/service_role).
"""
from __future__ import annotations

import re
from uuid import uuid4

import asyncpg
import pytest

from test_grammar_quiz_revision_boundary import MIGRATIONS, pg  # noqa: F401 (fixture)

NAME = "501_grammar_quiz_allowed_code_service_execute.sql"
SQL = (MIGRATIONS / NAME).read_text()
DOWN = (MIGRATIONS / "rollback" / NAME).read_text()
FN = "grammar_quiz_allowed_code(text)"


def _code(sql):
    return "\n".join(line.split("--", 1)[0] for line in sql.splitlines())


def test_grants_exactly_one_function_to_service_role_and_revokes_nothing():
    code = _code(SQL)
    assert re.findall(r"\bGRANT\b[^;]*;", code) == [
        "GRANT EXECUTE ON FUNCTION public.grammar_quiz_allowed_code(text) TO service_role;"]
    assert not re.search(r"\b(REVOKE|ALTER|CREATE|DROP|INSERT|UPDATE|DELETE)\b", code)
    assert code.strip().startswith("BEGIN;") and code.strip().endswith("COMMIT;")


def test_rollback_only_revokes_that_grant():
    code = _code(DOWN)
    assert re.findall(r"\bREVOKE\b[^;]*;", code) == [
        "REVOKE EXECUTE ON FUNCTION public.grammar_quiz_allowed_code(text) FROM service_role;"]
    assert not re.search(r"\bGRANT\b", code)


def test_forward_policy_holds_501_until_an_explicit_feature_run():
    rows = [line.split("\t") for line in (MIGRATIONS / "forward-policy.tsv").read_text().splitlines()]
    row = next(r for r in rows if r[0] == NAME)
    assert row[1:3] == ["pending_feature", "course_bank_service_write"]


async def _ledger(pg, *names):
    await pg.c.execute("CREATE TABLE IF NOT EXISTS _schema_migrations (filename text PRIMARY KEY)")
    for name in names:
        await pg.c.execute("INSERT INTO _schema_migrations VALUES ($1) ON CONFLICT DO NOTHING", name)


async def _ready(pg):
    await _ledger(pg, "339_grammar_quiz_followup_codes.sql")


async def _service_insert(pg):
    await pg.c.execute("SET ROLE " + pg.roles["service_role"])
    try:
        await pg.c.execute("INSERT INTO quiz_banks(code,title,skill_area,is_published) "
                           "VALUES($1,'Lab','course',FALSE)", "C5-SL-T" + uuid4().hex[:6])
    finally:
        await pg.c.execute("RESET ROLE")


async def _can(pg, role):
    return await pg.c.fetchval("SELECT has_function_privilege($1,$2::regprocedure,'EXECUTE')",
                               pg.roles[role], f"{pg.schema}.{FN}")


async def _fails(pg, sql):
    with pytest.raises(asyncpg.PostgresError) as error:
        await pg.c.execute(sql)
    await pg.c.execute("ROLLBACK")
    return str(error.value)


@pytest.mark.asyncio
async def test_service_role_bank_write_fails_before_and_succeeds_after(pg):
    with pytest.raises(asyncpg.InsufficientPrivilegeError, match="grammar_quiz_allowed_code"):
        await _service_insert(pg)
    await _ready(pg)
    await pg.c.execute(pg.adapted(SQL))
    await _service_insert(pg)
    assert await _can(pg, "service_role")
    assert not await _can(pg, "anon") and not await _can(pg, "authenticated")


@pytest.mark.asyncio
async def test_rerun_is_idempotent_and_leaves_other_helpers_revoked(pg):
    await _ready(pg)
    await pg.c.execute(pg.adapted(SQL))
    await pg.c.execute(pg.adapted(SQL))
    granted = await pg.c.fetch(
        "SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace "
        "WHERE n.nspname=$1 AND p.proname LIKE 'grammar_quiz_%' "
        "AND has_function_privilege($2,p.oid,'EXECUTE') ORDER BY 1", pg.schema, pg.roles["service_role"])
    assert [r["proname"] for r in granted] == sorted([
        "grammar_quiz_allowed_code", "grammar_quiz_end_service", "grammar_quiz_progress_service",
        "grammar_quiz_reset_service", "grammar_quiz_start_service", "grammar_quiz_start_service",
        "grammar_quiz_state"])


@pytest.mark.asyncio
async def test_missing_ledger_aborts_without_grant(pg):
    await _ledger(pg, "309_grammar_quiz_revision_cutover.sql", "314_grammar_audit_reviewed_publication.sql")
    assert "migration_501_prerequisite_missing: no ledger row" in await _fails(pg, pg.adapted(SQL))
    assert not await _can(pg, "service_role")


@pytest.mark.asyncio
async def test_definer_function_is_refused(pg):
    await _ready(pg)
    await pg.c.execute(f"ALTER FUNCTION {pg.schema}.{FN} SECURITY DEFINER")
    assert "migration_501_unexpected_function" in await _fails(pg, pg.adapted(SQL))
    assert not await _can(pg, "service_role")


@pytest.mark.asyncio
async def test_rollback_restores_the_309_refusal(pg):
    await _ready(pg)
    await pg.c.execute(pg.adapted(SQL))
    await pg.c.execute(pg.adapted(DOWN))
    assert not await _can(pg, "service_role")
    with pytest.raises(asyncpg.InsufficientPrivilegeError):
        await _service_insert(pg)
